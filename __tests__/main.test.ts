import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as cache from '@actions/cache';
import * as core from '@actions/core';

import * as main from '../src/main.js';
import {
  mockGetBooleanInput,
  mockGetInput,
  mockGetMultilineInput,
  mockGlobGenerator,
  mockHttpGet
} from './utils.js';

vi.mock('@actions/cache');
vi.mock('@actions/core');
vi.mock('@actions/glob');
vi.mock('node:fs/promises');

// Spy the action's entrypoint
const runSpy = vi.spyOn(main, 'run');

let schemaContents: string;
let invalidSchemaContents: string;
let instanceContents: string;

describe('action', () => {
  const schema = '/foo/bar';
  const remoteSchema = 'https://foo.bar/schema.json';
  const files = ['/foo/bar/baz/**.yml'];

  beforeAll(async () => {
    // jest.mocked(core.debug).mockImplementation(console.debug);

    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

    schemaContents = actualFs.readFileSync(
      path.join(__dirname, 'fixtures', 'evm-config.schema.json'),
      'utf-8'
    );
    invalidSchemaContents = actualFs.readFileSync(
      path.join(__dirname, 'fixtures', 'invalid.schema.json'),
      'utf-8'
    );
    instanceContents = actualFs.readFileSync(
      path.join(__dirname, 'fixtures', 'evm-config.yml'),
      'utf-8'
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('requires the files input', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({});

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setFailed).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenLastCalledWith(
      'Input required and not supplied: files'
    );
  });

  it('handles generic errors', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile).mockImplementation(() => {
      throw new Error('File read error');
    });

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setFailed).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenLastCalledWith('File read error');
  });

  it('stringifies non-errors', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile).mockImplementation(() => {
      throw 42; // oxlint-disable-line no-throw-literal
    });

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setFailed).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenLastCalledWith('42');
  });

  it('reads local schema', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(fs.readFile).toHaveBeenCalledWith(schema, 'utf-8');
  });

  it('does not cache local schema', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(cache.saveCache).not.toHaveBeenCalled();
    expect(cache.restoreCache).not.toHaveBeenCalled();
  });

  it('fetches remote schema on cache miss', async () => {
    mockGetBooleanInput({ 'cache-remote-schema': true });
    mockGetInput({ schema: remoteSchema });
    mockGetMultilineInput({ files });

    vi.spyOn(cache, 'restoreCache').mockResolvedValue(undefined);
    const httpGetSpy = mockHttpGet(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(httpGetSpy).toHaveBeenCalledWith(remoteSchema);
  });

  it('fails if fetching remote schema fails', async () => {
    mockGetBooleanInput({ 'cache-remote-schema': true });
    mockGetInput({ schema: remoteSchema });
    mockGetMultilineInput({ files });

    const httpGetSpy = mockHttpGet(schemaContents, 404, 'Not Found');

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(httpGetSpy).toHaveBeenCalledWith(remoteSchema);
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenLastCalledWith(
      'Failed to fetch remote schema: 404 - Not Found'
    );
  });

  it('caches remote schema on cache miss', async () => {
    mockGetBooleanInput({ 'cache-remote-schema': true });
    mockGetInput({ schema: remoteSchema });
    mockGetMultilineInput({ files });

    vi.spyOn(cache, 'restoreCache').mockResolvedValue(undefined);
    const httpGetSpy = mockHttpGet(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(httpGetSpy).toHaveBeenCalledWith(remoteSchema);

    // Confirm cache calls use the same paths and key
    expect(cache.restoreCache).toHaveBeenCalledTimes(1);
    const [paths, key] = vi.mocked(cache.restoreCache).mock.calls[0];
    expect(cache.saveCache).toHaveBeenCalledTimes(1);
    expect(cache.saveCache).toHaveBeenLastCalledWith(paths, key);
  });

  it('does not fetch remote schema on cache hit', async () => {
    mockGetBooleanInput({ 'cache-remote-schema': true });
    mockGetInput({ schema: remoteSchema });
    mockGetMultilineInput({ files });

    vi.spyOn(cache, 'restoreCache').mockResolvedValue('cache-key');
    const httpGetSpy = mockHttpGet(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(httpGetSpy).not.toHaveBeenCalled();
  });

  it('does not cache remote schema on cache hit', async () => {
    mockGetBooleanInput({ 'cache-remote-schema': true });
    mockGetInput({ schema: remoteSchema });
    mockGetMultilineInput({ files });

    vi.spyOn(cache, 'restoreCache').mockResolvedValue('cache-key');
    mockHttpGet(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(cache.restoreCache).toHaveBeenCalledTimes(1);
    expect(cache.saveCache).not.toHaveBeenCalled();
  });

  it('does not cache remote schema if cache-remote-schema input is false', async () => {
    mockGetBooleanInput({ 'cache-remote-schema': false });
    mockGetInput({ schema: remoteSchema });
    mockGetMultilineInput({ files });

    const httpGetSpy = mockHttpGet(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(httpGetSpy).toHaveBeenCalledWith(remoteSchema);
    expect(cache.saveCache).not.toHaveBeenCalled();
    expect(cache.restoreCache).not.toHaveBeenCalled();
  });

  it('warns on cache restore error', async () => {
    for (const error of [42, new Error('Server error')]) {
      mockGetBooleanInput({ 'cache-remote-schema': true });
      mockGetInput({ schema: remoteSchema });
      mockGetMultilineInput({ files });

      vi.spyOn(cache, 'restoreCache').mockImplementation(async () => {
        throw error;
      });

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      expect(core.warning).toHaveBeenCalledWith(
        `Error while trying to restore cache: ${message}`
      );
    }
  });

  it('warns on cache save error', async () => {
    for (const error of [42, new Error('Server error')]) {
      mockGetBooleanInput({ 'cache-remote-schema': true });
      mockGetInput({ schema: remoteSchema });
      mockGetMultilineInput({ files });

      vi.spyOn(cache, 'restoreCache').mockResolvedValue(undefined);
      vi.spyOn(cache, 'saveCache').mockImplementation(async () => {
        throw error;
      });

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      expect(core.warning).toHaveBeenCalledWith(
        `Error while trying to save cache: ${message}`
      );
    }
  });

  it('fails if schema missing $schema key', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile).mockResolvedValueOnce(
      schemaContents.replace('$schema', '_schema')
    );

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).toEqual(1);

    expect(core.error).toHaveBeenLastCalledWith(
      'JSON schema missing $schema key',
      {
        title: 'JSON Schema Validation Error',
        file: '/foo/bar'
      }
    );
  });

  it('fails if no files to validate', async () => {
    mockGetBooleanInput({ 'fail-on-no-files': true });
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);
    mockGlobGenerator([]);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setFailed).toHaveBeenLastCalledWith('No files to validate');
  });

  it('does not fail or warn if fail-on-no-files is false', async () => {
    mockGetBooleanInput({ 'fail-on-no-files': false });
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);
    mockGlobGenerator([]);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.warning).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('valid', true);
    expect(core.setOutput).toHaveBeenCalledWith('files-total', 0);
    expect(core.setOutput).toHaveBeenCalledWith('valid-total', 0);
    expect(core.setOutput).toHaveBeenCalledWith('invalid-total', 0);
    expect(core.setOutput).toHaveBeenCalledWith('no-schema-total', 0);
  });

  it('sets valid output correctly on all valid', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(schemaContents)
      .mockResolvedValueOnce(instanceContents);
    mockGlobGenerator(['/foo/bar/baz/config.yml']);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setOutput).toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('valid', true);
  });

  it('fails on invalid if fail-on-invalid is true', async () => {
    mockGetBooleanInput({ 'fail-on-invalid': true });
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(schemaContents)
      .mockResolvedValueOnce('invalid content')
      .mockResolvedValueOnce(instanceContents);
    mockGlobGenerator(['/foo/bar/baz/config.yml', '/foo/bar/baz/e/config.yml']);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).toEqual(1);

    expect(core.error).toHaveBeenCalledWith(
      'Error while validating file: /foo/bar/baz/config.yml'
    );
    expect(core.error).toHaveBeenLastCalledWith(
      JSON.stringify(
        {
          instancePath: '',
          schemaPath: '#/oneOf',
          keyword: 'oneOf',
          params: {
            passingSchemas: [0, 1]
          },
          message: 'must match exactly one schema in oneOf'
        },
        null,
        4
      ),
      {
        title: 'JSON Schema Validation Error',
        file: '/foo/bar/baz/config.yml'
      }
    );

    expect(core.setOutput).toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('valid', false);
  });

  it('sets valid output correctly on some invalid', async () => {
    mockGetBooleanInput({ 'fail-on-invalid': false });
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(schemaContents)
      .mockResolvedValueOnce('invalid content')
      .mockResolvedValueOnce(instanceContents);
    mockGlobGenerator(['/foo/bar/baz/config.yml', '/foo/bar/baz/e/config.yml']);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.error).toHaveBeenCalledTimes(2);
    expect(core.setOutput).toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('valid', false);
  });

  it('debug logs each file', async () => {
    mockGetBooleanInput({ 'fail-on-invalid': false });
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    const paths = ['/foo/bar/baz/config.yml', '/foo/bar/baz/e/config.yml'];

    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(schemaContents)
      .mockResolvedValueOnce('invalid content')
      .mockResolvedValueOnce(instanceContents);
    mockGlobGenerator(paths);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.debug).toHaveBeenCalledWith(`𐄂 ${paths[0]} is not valid`);
    expect(core.debug).toHaveBeenCalledWith(`✓ ${paths[1]} is valid`);
  });

  it('supports JSON Schema draft-04', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(
        schemaContents.replace(
          'http://json-schema.org/draft-07/schema#',
          'http://json-schema.org/draft-04/schema#'
        )
      )
      .mockResolvedValueOnce(instanceContents);
    mockGlobGenerator(['/foo/bar/baz/config.yml']);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setOutput).toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('valid', true);
  });

  it('reports all errors if all-errors input is true', async () => {
    mockGetBooleanInput({ 'all-errors': true, 'fail-on-invalid': false });
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(schemaContents)
      .mockResolvedValueOnce('invalid content')
      .mockResolvedValueOnce(instanceContents);
    mockGlobGenerator(['/foo/bar/baz/config.yml', '/foo/bar/baz/e/config.yml']);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.error).toHaveBeenCalledTimes(4);
    expect(core.setOutput).toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('valid', false);
  });

  describe('can validate schemas', () => {
    beforeEach(() => {
      mockGetBooleanInput({});
      mockGetInput({ schema: 'json-schema' });
      mockGetMultilineInput({ files });

      mockGlobGenerator(['/foo/bar/baz/config.yml']);
    });

    it('which are valid', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.setOutput).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
    });

    it('which are invalid', async () => {
      mockGetBooleanInput({ 'fail-on-invalid': true });

      vi.mocked(fs.readFile).mockResolvedValueOnce(invalidSchemaContents);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).toEqual(1);

      expect(core.error).toHaveBeenCalledWith(
        'Error while validating file: /foo/bar/baz/config.yml'
      );
      expect(core.error).toHaveBeenLastCalledWith(
        JSON.stringify(
          {
            instancePath: '/properties/foobar/minLength',
            schemaPath: '#/definitions/nonNegativeInteger/type',
            keyword: 'type',
            params: {
              type: 'integer'
            },
            message: 'must be integer'
          },
          null,
          4
        ),
        {
          title: 'JSON Schema Validation Error',
          file: '/foo/bar/baz/config.yml'
        }
      );
      expect(core.setOutput).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('valid', false);
    });

    it('using JSON Schema draft-04', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        schemaContents.replace(
          'http://json-schema.org/draft-07/schema#',
          'http://json-schema.org/draft-04/schema#'
        )
      );

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.setOutput).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
    });

    it('using JSON Schema draft-2019-09', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        schemaContents.replace(
          'http://json-schema.org/draft-07/schema#',
          'https://json-schema.org/draft/2019-09/schema'
        )
      );

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.setOutput).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
    });

    it('using JSON Schema draft-2020-12', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        schemaContents.replace(
          'http://json-schema.org/draft-07/schema#',
          'https://json-schema.org/draft/2020-12/schema'
        )
      );

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.setOutput).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
    });

    it('but fails if $schema key is missing', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        schemaContents.replace('$schema', '_schema')
      );

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).toEqual(1);

      expect(core.error).toHaveBeenLastCalledWith(
        'JSON schema missing $schema key',
        {
          title: 'JSON Schema Validation Error',
          file: '/foo/bar/baz/config.yml'
        }
      );
    });
  });

  describe('custom error messages', () => {
    it('forces allErrors to true when custom-errors is enabled', async () => {
      mockGetBooleanInput({ 'custom-errors': true, 'all-errors': false });
      mockGetInput({ schema });
      mockGetMultilineInput({ files });

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(schemaContents)
        .mockResolvedValueOnce('invalid content');
      mockGlobGenerator(['/foo/bar/baz/config.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      // Should report multiple errors even though all-errors was false
      expect(core.error).toHaveBeenCalledTimes(4);
      expect(core.setOutput).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('valid', false);
    });

    it('provides custom error messages when validation fails', async () => {
      mockGetBooleanInput({ 'custom-errors': true, 'fail-on-invalid': true });
      mockGetInput({ schema });
      mockGetMultilineInput({ files });

      // Create a schema with custom error messages
      const customErrorSchemaContents = JSON.stringify({
        title: 'Test schema with custom errors',
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 }
        },
        required: ['name'],
        errorMessage: {
          properties: {
            name: 'Name must be a non-empty string'
          }
        }
      });

      const invalidInstanceContents = JSON.stringify({ name: '' });

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(customErrorSchemaContents)
        .mockResolvedValueOnce(invalidInstanceContents);
      mockGlobGenerator(['/foo/bar/baz/config.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).toEqual(1);

      expect(core.error).toHaveBeenCalledWith(
        'Error while validating file: /foo/bar/baz/config.yml'
      );

      // Check that we get our custom error message in the JSON output
      const errorCalls = vi.mocked(core.error).mock.calls;
      const hasCustomMessage = errorCalls.some(
        call =>
          typeof call[0] === 'string' &&
          call[0].includes('Name must be a non-empty string')
      );
      expect(hasCustomMessage).toBe(true);

      expect(core.setOutput).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('valid', false);
    });

    it('works without custom-errors when disabled', async () => {
      mockGetBooleanInput({ 'custom-errors': false, 'fail-on-invalid': false });
      mockGetInput({ schema });
      mockGetMultilineInput({ files });

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(schemaContents)
        .mockResolvedValueOnce('invalid content');
      mockGlobGenerator(['/foo/bar/baz/config.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.error).toHaveBeenCalledWith(
        'Error while validating file: /foo/bar/baz/config.yml'
      );

      // Should NOT have any custom error messages (no errorMessage keyword)
      const errorCalls = vi.mocked(core.error).mock.calls;
      const hasCustomErrors = errorCalls.some(
        call =>
          typeof call[0] === 'string' &&
          call[0].includes('"keyword":"errorMessage"')
      );
      expect(hasCustomErrors).toBe(false);

      expect(core.setOutput).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('valid', false);
    });
  });

  describe('per-file $schema (no schema input)', () => {
    const localSchemaRef = '/path/to/schema.json';
    const remoteSchemaRef = 'https://example.com/schema.json';

    it('uses each file $schema when schema input is omitted', async () => {
      mockGetBooleanInput({});
      mockGetInput({});
      mockGetMultilineInput({ files });

      const instanceWithSchema = instanceContents.replace(
        /\$schema:.*$/m,
        `$schema: ${localSchemaRef}`
      );

      vi.mocked(fs.readFile)
        // First read: the per-file instance
        .mockResolvedValueOnce(instanceWithSchema)
        // Second read: the schema referenced by $schema
        .mockResolvedValueOnce(schemaContents);
      mockGlobGenerator(['/foo/bar/baz/config.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(fs.readFile).toHaveBeenCalledWith(localSchemaRef, 'utf-8');
      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
    });

    it('caches per-file schemas across files', async () => {
      mockGetBooleanInput({});
      mockGetInput({});
      mockGetMultilineInput({ files });

      const instanceWithSchema = instanceContents.replace(
        /\$schema:.*$/m,
        `$schema: ${localSchemaRef}`
      );

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(instanceWithSchema)
        .mockResolvedValueOnce(schemaContents)
        .mockResolvedValueOnce(instanceWithSchema);
      mockGlobGenerator(['/foo/bar/baz/a.yml', '/foo/bar/baz/b.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      // Schema should only be read once even though two files reference it
      const allReadCalls = vi.mocked(fs.readFile).mock.calls;
      const schemaReads = allReadCalls.filter(
        call => call[0] === localSchemaRef
      );
      expect(schemaReads.length).toBe(1);
    });

    it('fetches remote schema from $schema field', async () => {
      mockGetBooleanInput({ 'cache-remote-schema': false });
      mockGetInput({});
      mockGetMultilineInput({ files });

      const instanceWithSchema = instanceContents.replace(
        /\$schema:.*$/m,
        `$schema: ${remoteSchemaRef}`
      );

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(instanceWithSchema)
        .mockResolvedValueOnce(schemaContents);
      mockGlobGenerator(['/foo/bar/baz/config.yml']);
      const httpGetSpy = mockHttpGet(schemaContents);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(httpGetSpy).toHaveBeenCalledWith(remoteSchemaRef);
      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
    });

    it('fails when file has no $schema and if-no-schema defaults to error', async () => {
      mockGetBooleanInput({});
      mockGetInput({});
      mockGetMultilineInput({ files });

      const instanceWithoutSchema = instanceContents.replace(
        /\$schema:.*$/m,
        ''
      );

      vi.mocked(fs.readFile).mockResolvedValueOnce(instanceWithoutSchema);
      mockGlobGenerator(['/foo/bar/baz/config.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();

      expect(core.setFailed).toHaveBeenCalledTimes(1);
      expect(core.setFailed).toHaveBeenLastCalledWith(
        '/foo/bar/baz/config.yml has no $schema field'
      );
    });

    it('warns when file has no $schema and if-no-schema is warn', async () => {
      mockGetBooleanInput({});
      mockGetInput({ 'if-no-schema': 'warn' });
      mockGetMultilineInput({ files });

      const instanceWithoutSchema = instanceContents.replace(
        /\$schema:.*$/m,
        ''
      );

      vi.mocked(fs.readFile).mockResolvedValueOnce(instanceWithoutSchema);
      mockGlobGenerator(['/foo/bar/baz/config.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.warning).toHaveBeenCalledWith(
        '/foo/bar/baz/config.yml has no $schema field',
        expect.objectContaining({
          title: 'JSON Schema Validation Warning',
          file: '/foo/bar/baz/config.yml'
        })
      );
      expect(core.setFailed).not.toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
    });

    it('ignores silently when file has no $schema and if-no-schema is ignore', async () => {
      mockGetBooleanInput({});
      mockGetInput({ 'if-no-schema': 'ignore' });
      mockGetMultilineInput({ files });

      const instanceWithoutSchema = instanceContents.replace(
        /\$schema:.*$/m,
        ''
      );

      vi.mocked(fs.readFile).mockResolvedValueOnce(instanceWithoutSchema);
      mockGlobGenerator(['/foo/bar/baz/config.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.warning).not.toHaveBeenCalled();
      expect(core.setFailed).not.toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
    });

    it('continues to next file when one is ignored', async () => {
      mockGetBooleanInput({});
      mockGetInput({ 'if-no-schema': 'ignore' });
      mockGetMultilineInput({ files });

      const instanceWithoutSchema = instanceContents.replace(
        /\$schema:.*$/m,
        ''
      );
      const instanceWithSchema = instanceContents.replace(
        /\$schema:.*$/m,
        `$schema: ${localSchemaRef}`
      );

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(instanceWithoutSchema)
        .mockResolvedValueOnce(instanceWithSchema)
        .mockResolvedValueOnce(schemaContents);
      mockGlobGenerator([
        '/foo/bar/baz/no-schema.yml',
        '/foo/bar/baz/has-schema.yml'
      ]);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(fs.readFile).toHaveBeenCalledWith(localSchemaRef, 'utf-8');
      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
    });

    it('rejects an invalid if-no-schema value', async () => {
      mockGetBooleanInput({});
      mockGetInput({ 'if-no-schema': 'bogus' });
      mockGetMultilineInput({ files });

      await main.run();
      expect(runSpy).toHaveReturned();

      expect(core.setFailed).toHaveBeenCalledTimes(1);
      expect(core.setFailed).toHaveBeenLastCalledWith(
        "Invalid value for if-no-schema: 'bogus' (must be 'error', 'warn', or 'ignore')"
      );
    });

    it('aborts if per-file remote schema fetch fails', async () => {
      mockGetBooleanInput({ 'cache-remote-schema': false });
      mockGetInput({});
      mockGetMultilineInput({ files });

      const instanceWithSchema = instanceContents.replace(
        /\$schema:.*$/m,
        `$schema: ${remoteSchemaRef}`
      );

      vi.mocked(fs.readFile).mockResolvedValueOnce(instanceWithSchema);
      mockGlobGenerator(['/foo/bar/baz/config.yml']);
      mockHttpGet('', 500, 'Server Error');

      await main.run();
      expect(runSpy).toHaveReturned();

      expect(core.setFailed).toHaveBeenLastCalledWith(
        'Failed to fetch remote schema: 500 - Server Error'
      );
    });

    it('aborts if per-file schema is missing $schema key', async () => {
      mockGetBooleanInput({});
      mockGetInput({});
      mockGetMultilineInput({ files });

      const instanceWithSchema = instanceContents.replace(
        /\$schema:.*$/m,
        `$schema: ${localSchemaRef}`
      );

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(instanceWithSchema)
        .mockResolvedValueOnce(schemaContents.replace('$schema', '_schema'));
      mockGlobGenerator(['/foo/bar/baz/config.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).toEqual(1);

      expect(core.error).toHaveBeenCalledWith(
        'JSON schema missing $schema key',
        expect.objectContaining({
          title: 'JSON Schema Validation Error',
          file: localSchemaRef
        })
      );
    });
  });

  describe('counter outputs', () => {
    it('sets all counter outputs when everything is valid', async () => {
      mockGetBooleanInput({});
      mockGetInput({ schema });
      mockGetMultilineInput({ files });

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(schemaContents)
        .mockResolvedValueOnce(instanceContents)
        .mockResolvedValueOnce(instanceContents);
      mockGlobGenerator(['/foo/bar/baz/a.yml', '/foo/bar/baz/b.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
      expect(core.setOutput).toHaveBeenCalledWith('files-total', 2);
      expect(core.setOutput).toHaveBeenCalledWith('valid-total', 2);
      expect(core.setOutput).toHaveBeenCalledWith('invalid-total', 0);
      expect(core.setOutput).toHaveBeenCalledWith('no-schema-total', 0);
    });

    it('counts invalid files separately', async () => {
      mockGetBooleanInput({ 'fail-on-invalid': false });
      mockGetInput({ schema });
      mockGetMultilineInput({ files });

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(schemaContents)
        .mockResolvedValueOnce('invalid content')
        .mockResolvedValueOnce(instanceContents);
      mockGlobGenerator(['/foo/bar/baz/a.yml', '/foo/bar/baz/b.yml']);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.setOutput).toHaveBeenCalledWith('valid', false);
      expect(core.setOutput).toHaveBeenCalledWith('files-total', 2);
      expect(core.setOutput).toHaveBeenCalledWith('valid-total', 1);
      expect(core.setOutput).toHaveBeenCalledWith('invalid-total', 1);
      expect(core.setOutput).toHaveBeenCalledWith('no-schema-total', 0);
    });

    it('counts files missing $schema when if-no-schema is warn', async () => {
      mockGetBooleanInput({});
      mockGetInput({ 'if-no-schema': 'warn' });
      mockGetMultilineInput({ files });

      const localSchemaRef = '/path/to/schema.json';
      const instanceWithoutSchema = instanceContents.replace(
        /\$schema:.*$/m,
        ''
      );
      const instanceWithSchema = instanceContents.replace(
        /\$schema:.*$/m,
        `$schema: ${localSchemaRef}`
      );

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(instanceWithoutSchema)
        .mockResolvedValueOnce(instanceWithSchema)
        .mockResolvedValueOnce(schemaContents)
        .mockResolvedValueOnce(instanceWithoutSchema);
      mockGlobGenerator([
        '/foo/bar/baz/no-schema-a.yml',
        '/foo/bar/baz/has-schema.yml',
        '/foo/bar/baz/no-schema-b.yml'
      ]);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.setOutput).toHaveBeenCalledWith('valid', true);
      expect(core.setOutput).toHaveBeenCalledWith('files-total', 3);
      expect(core.setOutput).toHaveBeenCalledWith('valid-total', 1);
      expect(core.setOutput).toHaveBeenCalledWith('invalid-total', 0);
      expect(core.setOutput).toHaveBeenCalledWith('no-schema-total', 2);
    });

    it('does not emit outputs when no files matched and fail-on-no-files is true', async () => {
      mockGetBooleanInput({ 'fail-on-no-files': true });
      mockGetInput({ schema });
      mockGetMultilineInput({ files });

      vi.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);
      mockGlobGenerator([]);

      await main.run();
      expect(runSpy).toHaveReturned();

      expect(core.setFailed).toHaveBeenLastCalledWith('No files to validate');
      expect(core.setOutput).not.toHaveBeenCalled();
    });
  });
});
