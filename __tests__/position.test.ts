import { describe, expect, it } from 'vitest';

import type { ErrorObject } from 'ajv';
import * as yaml from 'yaml';

import { errorPosition } from '../src/main.js';

type Position = ReturnType<typeof errorPosition>;

function positionOf(source: string, error: Partial<ErrorObject>): Position {
  const lineCounter = new yaml.LineCounter();
  const doc = yaml.parseDocument(source, { lineCounter });
  return errorPosition(doc, lineCounter, {
    keyword: 'type',
    schemaPath: '#',
    params: {},
    ...error
  } as ErrorObject);
}

describe('errorPosition', () => {
  it('points at a nested YAML value', () => {
    const source = [
      'root: /src',
      'gen:',
      '  out: Testing',
      '  args: 42',
      ''
    ].join('\n');

    expect(positionOf(source, { instancePath: '/gen/args' })).toEqual({
      startLine: 4,
      endLine: 4,
      startColumn: 9,
      endColumn: 11
    });
  });

  it('points at a value in a JSON file', () => {
    const source = '{\n  "name": "app",\n  "port": "8080"\n}\n';

    expect(positionOf(source, { instancePath: '/port' })).toEqual({
      startLine: 3,
      endLine: 3,
      startColumn: 11,
      endColumn: 17
    });
  });

  it('points at an item in a list', () => {
    const source = ['items:', '  - a', '  - 2', '  - c', ''].join('\n');

    expect(positionOf(source, { instancePath: '/items/1' })).toMatchObject({
      startLine: 3,
      endLine: 3
    });
  });

  it('points at the key of a property that is not allowed', () => {
    const source = [
      'root: /src',
      'remotes:',
      '  electron: {}',
      'typo: true',
      ''
    ].join('\n');

    expect(
      positionOf(source, {
        instancePath: '',
        keyword: 'additionalProperties',
        params: { additionalProperty: 'typo' }
      })
    ).toEqual({ startLine: 4, endLine: 4, startColumn: 1, endColumn: 5 });
  });

  it('handles escaped characters in the path', () => {
    const source = ['paths:', '  a/b~c: 1', ''].join('\n');

    expect(
      positionOf(source, { instancePath: '/paths/a~1b~0c' })
    ).toMatchObject({ startLine: 2 });
  });

  it('gives only lines for a value spanning several lines', () => {
    const source = ['env:', '  A: 1', '  B: 2', 'other: x', ''].join('\n');

    expect(positionOf(source, { instancePath: '/env' })).toEqual({
      startLine: 2,
      endLine: 3
    });
  });

  it('returns nothing when the path is not in the file', () => {
    expect(positionOf('a: 1\n', { instancePath: '/b/c' })).toEqual({});
  });
});
