import { describe, it, expect } from 'vitest';
import { toPascalCase, inferType, generateTypeScript, generateJSDoc } from './types';

describe('toPascalCase (api-tape)', () => {
  it('converts hyphenated strings', () => {
    expect(toPascalCase('my-action')).toBe('MyAction');
  });

  it('converts underscored strings', () => {
    expect(toPascalCase('create_user')).toBe('CreateUser');
  });

  it('handles single word', () => {
    expect(toPascalCase('action')).toBe('Action');
  });
});

describe('inferType (api-tape)', () => {
  it('infers string type', () => {
    expect(inferType('hello')).toBe('string');
  });

  it('infers number type', () => {
    expect(inferType(42)).toBe('number');
  });

  it('infers boolean type', () => {
    expect(inferType(true)).toBe('boolean');
  });

  it('infers null type', () => {
    expect(inferType(null)).toBe('null');
  });
});

describe('generateTypeScript', () => {
  it('generates an interface with fields', () => {
    const result = generateTypeScript('UserInput', { name: 'Alice', age: 30 });
    expect(result).toContain('export interface UserInput {');
    expect(result).toContain('name: string;');
    expect(result).toContain('age: number;');
    expect(result).toContain('}');
  });

  it('quotes keys that are not valid identifiers', () => {
    const result = generateTypeScript('Data', { 'my-key': 'val' });
    expect(result).toContain("'my-key': string;");
  });

  it('handles empty objects', () => {
    const result = generateTypeScript('Empty', {});
    expect(result).toContain('export interface Empty {');
    expect(result).toContain('}');
  });
});

describe('generateJSDoc', () => {
  it('generates a JSDoc typedef with properties', () => {
    const result = generateJSDoc('UserInput', { name: 'Alice', age: 30 });
    expect(result).toContain('/**');
    expect(result).toContain('@typedef {Object} UserInput');
    expect(result).toContain('@property {string} name');
    expect(result).toContain('@property {number} age');
    expect(result).toContain(' */');
  });
});
