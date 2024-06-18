import { vi } from 'vitest';
import type { MockInstance } from 'vitest';

import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as http from '@actions/http-client';

function makeMockInputImplementation<T>(
  inputs: Record<string, T>,
  undefinedValue: T
) {
  return (name: string, options?: core.InputOptions) => {
    if (name in inputs) {
      return inputs[name];
    }

    if (options?.required) {
      throw new Error(`Input required and not supplied: ${name}`);
    }

    return undefinedValue;
  };
}

export function mockGetInput(inputs: Record<string, string>): void {
  vi.mocked(core.getInput).mockImplementation(
    makeMockInputImplementation(inputs, '')
  );
}

export function mockGetBooleanInput(inputs: Record<string, boolean>): void {
  vi.mocked(core.getBooleanInput).mockImplementation(
    makeMockInputImplementation(inputs, false)
  );
}

export function mockGetMultilineInput(inputs: Record<string, string[]>): void {
  vi.mocked(core.getMultilineInput).mockImplementation(
    makeMockInputImplementation(inputs, [])
  );
}

export function mockHttpGet(
  body: string,
  statusCode = 200,
  statusMessage = 'OK'
): MockInstance {
  const spy = vi.spyOn(http.HttpClient.prototype, 'get');
  spy.mockImplementation(async () => {
    return {
      message: {
        statusCode,
        statusMessage
      },
      readBody: async () => body
    } as http.HttpClientResponse;
  });

  return spy;
}

const createGlobber = glob.create;

export function mockGlobGenerator(files: string[]): void {
  vi.spyOn(glob, 'create').mockImplementation(
    async (patterns: string, options?: glob.GlobOptions) => {
      const globber = await createGlobber(patterns, options);

      vi.spyOn(globber, 'globGenerator').mockImplementation(async function* () {
        for (const file of files) {
          yield file;
        }
      });

      return globber;
    }
  );
}
