import { describe, it, expect } from 'vitest';
import { hashValue, diffObjects, formatDiffResult } from './diff';

describe('hashValue (api-tape)', () => {
  it('returns a hex string', () => {
    const h = hashValue({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it('returns the same hash for identical values', () => {
    expect(hashValue({ x: 1, y: 2 })).toBe(hashValue({ x: 1, y: 2 }));
  });

  it('returns different hashes for different values', () => {
    expect(hashValue('hello')).not.toBe(hashValue('world'));
  });
});

describe('diffObjects (api-tape)', () => {
  it('returns non-drifted status for identical objects', () => {
    const result = diffObjects({ a: 1, b: 'x' }, { a: 1, b: 'x' });
    expect(result.status).not.toBe('drifted');
    expect(result.valueChanged).toHaveLength(0);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  it('returns drifted status for different objects', () => {
    const result = diffObjects({ a: 1 }, { a: 2 });
    expect(result.status).toBe('drifted');
  });

  it('detects value changes', () => {
    const result = diffObjects({ a: 1 }, { a: 2 });
    expect(result.valueChanged.length).toBeGreaterThan(0);
    expect(result.valueChanged[0].path).toBe('a');
  });

  it('detects added keys', () => {
    const result = diffObjects({}, { a: 1 });
    expect(result.added.length).toBeGreaterThan(0);
  });

  it('detects removed keys', () => {
    const result = diffObjects({ a: 1 }, {});
    expect(result.removed.length).toBeGreaterThan(0);
  });
});

describe('formatDiffResult (api-tape)', () => {
  it('reports no changes for identical objects', () => {
    const diff = diffObjects({ a: 1 }, { a: 1 });
    const output = formatDiffResult(diff);
    expect(output).toContain('No changes detected');
  });

  it('reports changes for different objects', () => {
    const diff = diffObjects({ a: 1 }, { a: 2 });
    const output = formatDiffResult(diff);
    expect(output).toContain('a');
  });
});
