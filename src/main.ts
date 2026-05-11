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

type IfNoSchema = 'error' | 'warn' | 'ignore';

type Validate = (
  data: Record<string, unknown>
) => Promise<ErrorObject<string, Record<string, unknown>, unknown>[]>;

function newAjv(
  schema: Record<string, unknown>,
  options: Options,
  customErrors = false
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

  return ajv;
}

/**
 * Resolves a schema source (URL or local path) to a local file path on disk,
 * downloading and optionally caching the file when remote.
 *
 * Returns `undefined` if the remote fetch failed (in which case `setFailed`
 * has already been called).
 */
async function resolveSchemaPath(
  schemaSource: string,
  cacheRemoteSchema: boolean
): Promise<string | undefined> {
  if (
    !schemaSource.startsWith('http://') &&
    !schemaSource.startsWith('https://')
  ) {
    return schemaSource;
  }

  const schemaUrl = schemaSource;
  const schemaHash = createHash('sha256').update(schemaSource).digest('hex');
  const localPath = path.join(
    process.env.RUNNER_TEMP ?? '/tmp/',
    `schema-${schemaHash}.json`
  );

  const cacheKey = `schema-${schemaHash}`;
  let cacheHit = false;

  if (cacheRemoteSchema) {
    try {
      cacheHit =
        (await cache.restoreCache([localPath], cacheKey)) !== undefined;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      core.warning(`Error while trying to restore cache: ${message}`);
    }
  }

  if (!cacheHit) {
    const client = new http.HttpClient();
    const res = await client.get(schemaUrl);

    if (res.message.statusCode !== 200) {
      core.setFailed(
        `Failed to fetch remote schema: ${res.message.statusCode} - ${res.message.statusMessage}`
      );
      return undefined;
    }

    await fs.writeFile(localPath, await res.readBody(), 'utf-8');

    if (cacheRemoteSchema) {
      try {
        await cache.saveCache([localPath], cacheKey);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : JSON.stringify(error);
        core.warning(`Error while trying to save cache: ${message}`);
      }
    }
  }

  return localPath;
}

/**
 * Loads and compiles a schema, returning a validate function. Returns
 * `undefined` if the schema could not be loaded or is invalid (in which case
 * `setFailed` / `process.exitCode = 1` has already been set).
 */
async function loadValidator(
  schemaSource: string,
  options: { allErrors: boolean; customErrors: boolean },
  cacheRemoteSchema: boolean
): Promise<Validate | undefined> {
  const localPath = await resolveSchemaPath(schemaSource, cacheRemoteSchema);
  if (!localPath) return undefined;

  const schema: Record<string, unknown> = JSON.parse(
    await fs.readFile(localPath, 'utf-8')
  );

  if (typeof schema.$schema !== 'string') {
    core.error(`Error while validating schema: ${schemaSource}`);
    core.error('JSON schema missing $schema key', {
      title: 'JSON Schema Validation Error',
      file: schemaSource
    });
    process.exitCode = 1;
    return undefined;
  }

  const ajv = newAjv(
    schema,
    { allErrors: options.allErrors },
    options.customErrors
  );

  return async (data: Record<string, unknown>) => {
    ajv.validate(schema, data);
    return ajv.errors || [];
  };
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const schemaInput = core.getInput('schema');
    const files = core.getMultilineInput('files', { required: true });
    const allErrors = core.getBooleanInput('all-errors');
    const cacheRemoteSchema = core.getBooleanInput('cache-remote-schema');
    const failOnInvalid = core.getBooleanInput('fail-on-invalid');
    const failOnNoFiles = core.getBooleanInput('fail-on-no-files');
    const customErrors = core.getBooleanInput('custom-errors');
    const ifNoSchemaInput = core.getInput('if-no-schema') || 'error';

    if (
      ifNoSchemaInput !== 'error' &&
      ifNoSchemaInput !== 'warn' &&
      ifNoSchemaInput !== 'ignore'
    ) {
      core.setFailed(
        `Invalid value for if-no-schema: '${ifNoSchemaInput}' (must be 'error', 'warn', or 'ignore')`
      );
      return;
    }
    const ifNoSchema: IfNoSchema = ifNoSchemaInput;

    const validatingSchema = schemaInput === 'json-schema';

    // Compiled-validator cache, keyed by schema source (URL or path), so the
    // same schema referenced by multiple files is only fetched/compiled once.
    const validatorCache = new Map<string, Validate>();

    async function getValidator(
      schemaSource: string
    ): Promise<Validate | undefined> {
      const cached = validatorCache.get(schemaSource);
      if (cached) return cached;

      const validate = await loadValidator(
        schemaSource,
        { allErrors, customErrors },
        cacheRemoteSchema
      );
      if (!validate) return undefined;

      validatorCache.set(schemaSource, validate);
      return validate;
    }

    // Validator used in `schema: json-schema` mode (validates each file as a
    // schema, using the draft indicated by its own `$schema` field).
    const validateAsSchema: Validate = async data => {
      const ajv = newAjv(data, { allErrors }, customErrors);
      await ajv.validateSchema(data);
      return ajv.errors || [];
    };

    // When a fixed `schema` input is provided, pre-load it up front so any
    // failures are reported once rather than per file.
    let fixedValidate: Validate | undefined;
    if (schemaInput && !validatingSchema) {
      fixedValidate = await getValidator(schemaInput);
      if (!fixedValidate) return;
    }

    let valid = true;
    let filesTotal = 0;
    let validTotal = 0;
    let invalidTotal = 0;
    let noSchemaTotal = 0;

    const globber = await glob.create(files.join('\n'));

    for await (const file of globber.globGenerator()) {
      filesTotal++;

      const instance = yaml.parse(await fs.readFile(file, 'utf-8'));

      let validate: Validate;

      if (validatingSchema) {
        if (typeof instance?.$schema !== 'string') {
          core.error(`Error while validating schema: ${file}`);
          core.error('JSON schema missing $schema key', {
            title: 'JSON Schema Validation Error',
            file
          });
          process.exitCode = 1;
          return;
        }
        validate = validateAsSchema;
      } else if (fixedValidate) {
        validate = fixedValidate;
      } else {
        // No `schema` input was provided; use the file's own `$schema`.
        const fileSchema =
          instance && typeof instance === 'object'
            ? (instance as Record<string, unknown>).$schema
            : undefined;

        if (typeof fileSchema !== 'string') {
          noSchemaTotal++;
          if (!handleMissingFileSchema(file, ifNoSchema)) return;
          continue;
        }

        const perFileValidate = await getValidator(fileSchema);
        if (!perFileValidate) return;
        validate = perFileValidate;
      }

      const errors = await validate(instance);

      if (errors.length) {
        valid = false;
        invalidTotal++;
        core.debug(`𐄂 ${file} is not valid`);

        for (const error of errors) {
          core.error(`Error while validating file: ${file}`);
          core.error(JSON.stringify(error, null, 4), {
            title: 'JSON Schema Validation Error',
            file
          });
        }
      } else {
        validTotal++;
        core.debug(`✓ ${file} is valid`);
      }
    }

    if (filesTotal === 0 && failOnNoFiles) {
      core.setFailed('No files to validate');
      return;
    }

    if (!valid && failOnInvalid) {
      process.exitCode = 1;
    }

    core.setOutput('valid', valid);
    core.setOutput('files-total', filesTotal);
    core.setOutput('valid-total', validTotal);
    core.setOutput('invalid-total', invalidTotal);
    core.setOutput('no-schema-total', noSchemaTotal);
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error && error.stack) core.debug(error.stack);
    core.setFailed(
      error instanceof Error ? error.message : JSON.stringify(error)
    );
  }
}

/**
 * Handles a file that has no `$schema` field. Returns `true` if iteration
 * should continue, or `false` if the action should abort.
 */
function handleMissingFileSchema(
  file: string,
  ifNoSchema: IfNoSchema
): boolean {
  const message = `${file} has no $schema field`;

  if (ifNoSchema === 'error') {
    core.error(message, {
      title: 'JSON Schema Validation Error',
      file
    });
    core.setFailed(message);
    return false;
  }

  if (ifNoSchema === 'warn') {
    core.warning(message, {
      title: 'JSON Schema Validation Warning',
      file
    });
  } else {
    core.debug(`- ${file} ignored (no $schema)`);
  }

  return true;
}
