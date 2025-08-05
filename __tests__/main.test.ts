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

  it('requires the schema input', async () => {
    mockGetBooleanInput({});
    mockGetInput({});
    mockGetMultilineInput({});

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setFailed).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenLastCalledWith(
      'Input required and not supplied: schema'
    );
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
      throw 42; // eslint-disable-line no-throw-literal
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
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    vi.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setFailed).toHaveBeenLastCalledWith('No files to validate');
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

    expect(core.setOutput).toHaveBeenCalledTimes(1);
    expect(core.setOutput).toHaveBeenLastCalledWith('valid', true);
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

    expect(core.setOutput).toHaveBeenCalledTimes(1);
    expect(core.setOutput).toHaveBeenLastCalledWith('valid', false);
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
    expect(core.setOutput).toHaveBeenCalledTimes(1);
    expect(core.setOutput).toHaveBeenLastCalledWith('valid', false);
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

    expect(core.setOutput).toHaveBeenCalledTimes(1);
    expect(core.setOutput).toHaveBeenLastCalledWith('valid', true);
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
    expect(core.setOutput).toHaveBeenCalledTimes(1);
    expect(core.setOutput).toHaveBeenLastCalledWith('valid', false);
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

      expect(core.setOutput).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenLastCalledWith('valid', true);
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
      expect(core.setOutput).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenLastCalledWith('valid', false);
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

      expect(core.setOutput).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenLastCalledWith('valid', true);
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

      expect(core.setOutput).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenLastCalledWith('valid', true);
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

      expect(core.setOutput).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenLastCalledWith('valid', true);
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
      expect(core.setOutput).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenLastCalledWith('valid', false);
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

      expect(core.setOutput).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenLastCalledWith('valid', false);
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

      expect(core.setOutput).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenLastCalledWith('valid', false);
    });
  });
});
