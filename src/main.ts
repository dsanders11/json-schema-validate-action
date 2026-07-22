import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as http from '@actions/http-client';

import type Ajv from 'ajv';
import type { ErrorObject, Options } from 'ajv';
import Ajv2019 from 'ajv/dist/2019.js';
import Ajv2020 from 'ajv/dist/2020.js';
import AjvDraft04 from 'ajv-draft-04';
import AjvFormats from 'ajv-formats';
import AjvErrors from 'ajv-errors';
import draft06Schema from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' };
import draft07Schema from 'ajv/dist/refs/json-schema-draft-07.json' with { type: 'json' };
import * as yaml from 'yaml';

type Schema = Record<string, unknown>;

function newAjv(
  schema: Schema,
  options: Options,
  customErrors = false,
  additionalSchemas: Record<string, Schema> = {}
): Ajv.default {
  const draft04Schema =
    schema.$schema === 'http://json-schema.org/draft-04/schema#';
  const draft2020Schema =
    schema.$schema === 'https://json-schema.org/draft/2020-12/schema';

  // When using ajv-errors, allErrors must be true
  const ajvOptions = customErrors ? { ...options, allErrors: true } : options;

  const ajv = AjvFormats.default(
    draft04Schema
      ? new AjvDraft04.default(ajvOptions)
      : draft2020Schema
        ? new Ajv2020.default(ajvOptions)
        : new Ajv2019.default(ajvOptions)
  );

  if (!draft04Schema && !draft2020Schema) {
    ajv.addMetaSchema(draft06Schema);
    ajv.addMetaSchema(draft07Schema);
  }

  // Add ajv-errors support if requested
  if (customErrors) {
    AjvErrors.default(ajv);
  }

  // Register additional schemas so $refs to them can be resolved
  for (const [key, additionalSchema] of Object.entries(additionalSchemas)) {
    ajv.addSchema(additionalSchema, key);
  }

  return ajv;
}

function isRemoteSchema(schemaPath: string): boolean {
  return schemaPath.startsWith('http://') || schemaPath.startsWith('https://');
}

function quickValidateSchema(schemaPath: string, schema: Schema): void {
  if (typeof schema.$schema !== 'string') {
    const errorMessage = 'JSON schema missing $schema key';

    if (isRemoteSchema(schemaPath)) {
      core.error(errorMessage);
    } else {
      core.error(errorMessage, {
        title: 'JSON Schema Validation Error',
        file: schemaPath
      });
    }

    throw new Error(`Error while validating schema: ${schemaPath}`);
  }
}

async function fetchRemoteSchema(
  schemaUrl: string,
  options: { cache: boolean }
): Promise<Schema> {
  const schemaHash = createHash('sha256').update(schemaUrl).digest('hex');
  const schemaPath = path.join(
    process.env.RUNNER_TEMP ?? '/tmp/',
    `schema-${schemaHash}.json`
  );

  const cacheKey = `schema-${schemaHash}`;
  let cacheHit = false;

  if (options.cache) {
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
      throw new Error(
        `Failed to fetch remote schema: ${res.message.statusCode} - ${res.message.statusMessage}`
      );
    }

    await fs.writeFile(schemaPath, await res.readBody(), 'utf-8');

    if (options.cache) {
      try {
        await cache.saveCache([schemaPath], cacheKey);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : JSON.stringify(error);
        core.warning(`Error while trying to save cache: ${message}`);
      }
    }
  }

  try {
    return JSON.parse(await fs.readFile(schemaPath, 'utf-8'));
  } finally {
    // We no longer need the schema file so remove it
    await fs.rm(schemaPath, { force: true });
  }
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const schemaPath = core.getInput('schema', { required: true });
    const files = core.getMultilineInput('files', { required: true });
    const allErrors = core.getBooleanInput('all-errors');
    const cacheRemoteSchema = core.getBooleanInput('cache-remote-schema');
    const failOnInvalid = core.getBooleanInput('fail-on-invalid');
    const customErrors = core.getBooleanInput('custom-errors');
    const additionalSchemaPaths = core.getMultilineInput('additional-schemas');

    const validatingSchema = schemaPath === 'json-schema';
    const additionalSchemas: Record<string, Schema> = {};

    for (const additionalSchemaPath of additionalSchemaPaths) {
      let additionalSchema: Schema;
      let schemaKey: string;

      if (isRemoteSchema(additionalSchemaPath)) {
        additionalSchema = await fetchRemoteSchema(additionalSchemaPath, {
          cache: cacheRemoteSchema
        });
        // Strip any URL fragment (e.g. #bust-cache) so $refs
        // to the URL can resolve to the registered schema
        schemaKey = additionalSchemaPath.split('#')[0];
      } else {
        additionalSchema = JSON.parse(
          await fs.readFile(additionalSchemaPath, 'utf-8')
        );
        schemaKey = additionalSchemaPath;
      }

      quickValidateSchema(additionalSchemaPath, additionalSchema);
      if (Object.hasOwn(additionalSchemas, schemaKey)) {
        core.warning(
          `Duplicate additional schema path: ${additionalSchemaPath}. The last one will be used.`
        );
      }
      additionalSchemas[schemaKey] = additionalSchema;
    }

    let validate: (
      data: Record<string, unknown>
    ) => Promise<ErrorObject<string, Record<string, unknown>, unknown>[]>;

    if (validatingSchema) {
      validate = async (data: Record<string, unknown>) => {
        // Create a new Ajv instance per-schema since
        // they may require different draft versions
        const ajv = newAjv(
          data,
          { allErrors },
          customErrors,
          additionalSchemas
        );

        await ajv.validateSchema(data);
        return ajv.errors || [];
      };
    } else {
      let schema: Schema;

      if (isRemoteSchema(schemaPath)) {
        schema = await fetchRemoteSchema(schemaPath, {
          cache: cacheRemoteSchema
        });
      } else {
        schema = JSON.parse(await fs.readFile(schemaPath, 'utf-8'));
      }

      quickValidateSchema(schemaPath, schema);
      const ajv = newAjv(
        schema,
        { allErrors },
        customErrors,
        additionalSchemas
      );

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
        core.error(`Error while validating schema: ${file}`);
        core.error('JSON schema missing $schema key', {
          title: 'JSON Schema Validation Error',
          file
        });
        process.exitCode = 1;
        return;
      }

      const errors = await validate(instance);

      if (errors.length) {
        valid = false;
        core.debug(`𐄂 ${file} is not valid`);

        for (const error of errors) {
          core.error(`Error while validating file: ${file}`);
          core.error(JSON.stringify(error, null, 4), {
            title: 'JSON Schema Validation Error',
            file
          });
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
