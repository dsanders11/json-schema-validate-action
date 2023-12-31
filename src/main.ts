import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as http from '@actions/http-client';

import type { default as Ajv } from 'ajv';
import { default as Ajv2019, ErrorObject } from 'ajv/dist/2019';
import AjvDraft04 from 'ajv-draft-04';
import AjvFormats from 'ajv-formats';
import * as yaml from 'yaml';

function newAjv(schema: Record<string, unknown>): Ajv {
  const draft04Schema =
    schema.$schema === 'http://json-schema.org/draft-04/schema#';

  const ajv = AjvFormats(draft04Schema ? new AjvDraft04() : new Ajv2019());

  if (!draft04Schema) {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    ajv.addMetaSchema(require('ajv/dist/refs/json-schema-draft-06.json'));
    ajv.addMetaSchema(require('ajv/dist/refs/json-schema-draft-07.json'));
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  }

  return ajv;
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    let schemaPath = core.getInput('schema', { required: true });
    const files = core.getMultilineInput('files', { required: true });
    const cacheRemoteSchema = core.getBooleanInput('cache-remote-schema');
    const failOnInvalid = core.getBooleanInput('fail-on-invalid');

    // Fetch and cache remote schemas
    if (schemaPath.startsWith('http://') || schemaPath.startsWith('https://')) {
      const schemaUrl = schemaPath;
      const schemaHash = createHash('sha256').update(schemaPath).digest('hex');
      schemaPath = path.join(
        process.env.RUNNER_TEMP ?? '/tmp/',
        `schema-${schemaHash}.json`
      );

      const cacheKey = `schema-${schemaHash}`;
      let cacheHit = false;

      if (cacheRemoteSchema) {
        try {
          cacheHit =
            (await cache.restoreCache([schemaPath], cacheKey)) !== undefined;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : JSON.stringify(error);
          core.warning(`Error while trying to restore cache: ${message}`);
        }
      }

      if (!cacheHit) {
        // Not found in cache, so download and cache it
        const client = new http.HttpClient();
        const res = await client.get(schemaUrl);

        if (res.message.statusCode !== 200) {
          core.setFailed(
            `Failed to fetch remote schema: ${res.message.statusCode} - ${res.message.statusMessage}`
          );
          return;
        }

        await fs.writeFile(schemaPath, await res.readBody(), 'utf-8');

        if (cacheRemoteSchema) {
          try {
            await cache.saveCache([schemaPath], cacheKey);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : JSON.stringify(error);
            core.warning(`Error while trying to save cache: ${message}`);
          }
        }
      }
    }

    const validatingSchema = schemaPath === 'json-schema';

    let validate: (
      data: Record<string, unknown>
    ) => Promise<ErrorObject<string, Record<string, unknown>, unknown>[]>;

    if (validatingSchema) {
      validate = async (data: Record<string, unknown>) => {
        // Create a new Ajv instance per-schema since
        // they may require different draft versions
        const ajv = newAjv(data);

        await ajv.validateSchema(data);
        return ajv.errors || [];
      };
    } else {
      // Load and compile the schema
      const schema: Record<string, unknown> = JSON.parse(
        await fs.readFile(schemaPath, 'utf-8')
      );

      if (typeof schema.$schema !== 'string') {
        core.setFailed('JSON schema missing $schema key');
        return;
      }

      const ajv = newAjv(schema);

      validate = async (data: object) => {
        ajv.validate(schema, data);
        return ajv.errors || [];
      };
    }

    let valid = true;
    let filesValidated = false;

    const globber = await glob.create(files.join('\n'));

    for await (const file of globber.globGenerator()) {
      filesValidated = true;

      const instance = yaml.parse(await fs.readFile(file, 'utf-8'));

      if (validatingSchema && typeof instance.$schema !== 'string') {
        core.setFailed('JSON schema missing $schema key');
        return;
      }

      const errors = await validate(instance);

      if (errors.length) {
        valid = false;
        core.debug(`𐄂 ${file} is not valid`);

        for (const error of errors) {
          core.error(JSON.stringify(error, null, 4));
        }
      } else {
        core.debug(`✓ ${file} is valid`);
      }
    }

    if (!filesValidated) {
      core.setFailed('No files to validate');
      return;
    }

    if (!valid && failOnInvalid) {
      process.exitCode = 1;
    }

    core.setOutput('valid', valid);
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error && error.stack) core.debug(error.stack);
    core.setFailed(
      error instanceof Error ? error.message : JSON.stringify(error)
    );
  }
}
