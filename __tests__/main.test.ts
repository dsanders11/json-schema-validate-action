import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as cache from '@actions/cache';
import * as core from '@actions/core';

import * as main from '../src/main';
import {
  mockGetBooleanInput,
  mockGetInput,
  mockGetMultilineInput,
  mockGlobGenerator,
  mockHttpGet
} from './utils';

jest.mock('@actions/cache');
jest.mock('@actions/core');
jest.mock('node:fs/promises');

// Spy the action's entrypoint
const runSpy = jest.spyOn(main, 'run');

describe('action', () => {
  const schema = '/foo/bar';
  const remoteSchema = 'https://foo.bar/schema.json';
  const files = ['/foo/bar/baz/**.yml'];

  const schemaContents: string = jest
    .requireActual('node:fs')
    .readFileSync(
      path.join(__dirname, 'fixtures', 'evm-config.schema.json'),
      'utf-8'
    );
  const invalidSchemaContents: string = jest
    .requireActual('node:fs')
    .readFileSync(
      path.join(__dirname, 'fixtures', 'invalid.schema.json'),
      'utf-8'
    );
  const instanceContents: string = jest
    .requireActual('node:fs')
    .readFileSync(path.join(__dirname, 'fixtures', 'evm-config.yml'), 'utf-8');

  beforeAll(() => {
    // jest.mocked(core.debug).mockImplementation(console.debug);
  });

  beforeEach(() => {
    jest.clearAllMocks();
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

    jest.mocked(fs.readFile).mockImplementation(() => {
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

    jest.mocked(fs.readFile).mockImplementation(() => {
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

    jest.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(fs.readFile).toHaveBeenCalledWith(schema, 'utf-8');
  });

  it('does not cache local schema', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    jest.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);

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

    jest.spyOn(cache, 'restoreCache').mockResolvedValue(undefined);
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

    jest.spyOn(cache, 'restoreCache').mockResolvedValue(undefined);
    const httpGetSpy = mockHttpGet(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(httpGetSpy).toHaveBeenCalledWith(remoteSchema);

    // Confirm cache calls use the same paths and key
    expect(cache.restoreCache).toHaveBeenCalledTimes(1);
    const [paths, key] = jest.mocked(cache.restoreCache).mock.calls[0];
    expect(cache.saveCache).toHaveBeenCalledTimes(1);
    expect(cache.saveCache).toHaveBeenLastCalledWith(paths, key);
  });

  it('does not fetch remote schema on cache hit', async () => {
    mockGetBooleanInput({ 'cache-remote-schema': true });
    mockGetInput({ schema: remoteSchema });
    mockGetMultilineInput({ files });

    jest.spyOn(cache, 'restoreCache').mockResolvedValue('cache-key');
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

    jest.spyOn(cache, 'restoreCache').mockResolvedValue('cache-key');
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

      jest.spyOn(cache, 'restoreCache').mockImplementation(async () => {
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

      jest.spyOn(cache, 'restoreCache').mockResolvedValue(undefined);
      jest.spyOn(cache, 'saveCache').mockImplementation(async () => {
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

    jest
      .mocked(fs.readFile)
      .mockResolvedValueOnce(schemaContents.replace('$schema', '_schema'));

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setFailed).toHaveBeenLastCalledWith(
      'JSON schema missing $schema key'
    );
  });

  it('fails if no files to validate', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    jest.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setFailed).toHaveBeenLastCalledWith('No files to validate');
  });

  it('sets valid output correctly on all valid', async () => {
    mockGetBooleanInput({});
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    jest
      .mocked(fs.readFile)
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

    jest
      .mocked(fs.readFile)
      .mockResolvedValueOnce(schemaContents)
      .mockResolvedValueOnce('invalid content')
      .mockResolvedValueOnce(instanceContents);
    mockGlobGenerator(['/foo/bar/baz/config.yml', '/foo/bar/baz/e/config.yml']);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).toEqual(1);

    expect(core.setOutput).toHaveBeenCalledTimes(1);
    expect(core.setOutput).toHaveBeenLastCalledWith('valid', false);
  });

  it('sets valid output correctly on some invalid', async () => {
    mockGetBooleanInput({ 'fail-on-invalid': false });
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    jest
      .mocked(fs.readFile)
      .mockResolvedValueOnce(schemaContents)
      .mockResolvedValueOnce('invalid content')
      .mockResolvedValueOnce(instanceContents);
    mockGlobGenerator(['/foo/bar/baz/config.yml', '/foo/bar/baz/e/config.yml']);

    await main.run();
    expect(runSpy).toHaveReturned();
    expect(process.exitCode).not.toBeDefined();

    expect(core.setOutput).toHaveBeenCalledTimes(1);
    expect(core.setOutput).toHaveBeenLastCalledWith('valid', false);
  });

  it('debug logs each file', async () => {
    mockGetBooleanInput({ 'fail-on-invalid': false });
    mockGetInput({ schema });
    mockGetMultilineInput({ files });

    const paths = ['/foo/bar/baz/config.yml', '/foo/bar/baz/e/config.yml'];

    jest
      .mocked(fs.readFile)
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

    jest
      .mocked(fs.readFile)
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

  describe('can validate schemas', () => {
    beforeEach(() => {
      mockGetBooleanInput({});
      mockGetInput({ schema: 'json-schema' });
      mockGetMultilineInput({ files });

      mockGlobGenerator(['/foo/bar/baz/config.yml']);
    });

    it('which are valid', async () => {
      jest.mocked(fs.readFile).mockResolvedValueOnce(schemaContents);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.setOutput).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenLastCalledWith('valid', true);
    });

    it('which are invalid', async () => {
      mockGetBooleanInput({ 'fail-on-invalid': false });

      jest.mocked(fs.readFile).mockResolvedValueOnce(invalidSchemaContents);

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.setOutput).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenLastCalledWith('valid', false);
    });

    it('using JSON Schema draft-04', async () => {
      jest
        .mocked(fs.readFile)
        .mockResolvedValueOnce(
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

    it('but fails if $schema key is missing', async () => {
      jest
        .mocked(fs.readFile)
        .mockResolvedValueOnce(schemaContents.replace('$schema', '_schema'));

      await main.run();
      expect(runSpy).toHaveReturned();
      expect(process.exitCode).not.toBeDefined();

      expect(core.setFailed).toHaveBeenLastCalledWith(
        'JSON schema missing $schema key'
      );
    });
  });
});
