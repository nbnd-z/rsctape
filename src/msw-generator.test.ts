import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateSingleHandler, generateHandlers } from './msw-generator';
import { saveFixture } from './fixture-store';
import type { Fixture, FixtureMeta } from './types';

function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    input: { username: 'alice' },
    output: '0:{"result":"ok"}\n',
    ...overrides,
  };
}

function makeMeta(overrides: Partial<FixtureMeta> = {}): FixtureMeta {
  return {
    actionId: 'test-action',
    url: '/api/action',
    method: 'POST',
    statusCode: 200,
    contentType: 'text/x-component',
    timestamp: '2024-01-15T10:30:00.000Z',
    ...overrides,
  };
}

describe('generateSingleHandler', () => {
  it('produces handler that matches Next-Action header', () => {
    const code = generateSingleHandler('abc123', makeFixture());
    expect(code).toContain("request.headers.get('Next-Action') !== 'abc123'");
  });

  it('uses http.post method', () => {
    const code = generateSingleHandler('abc123', makeFixture());
    expect(code).toContain("http.post('*'");
  });

  it('returns RSC Payload with text/x-component content type', () => {
    const code = generateSingleHandler('abc123', makeFixture());
    expect(code).toContain("'Content-Type': 'text/x-component'");
  });

  it('includes JSDoc comment with action ID', () => {
    const code = generateSingleHandler('my-action-id', makeFixture());
    expect(code).toContain('/** Handler for action: my-action-id */');
  });

  it('sanitizes action ID to valid JS identifier', () => {
    const code = generateSingleHandler('abc/def:ghi', makeFixture());
    expect(code).toContain('handle_abc_def_ghi');
  });

  it('prefixes identifier with underscore when starting with digit', () => {
    const code = generateSingleHandler('123action', makeFixture());
    expect(code).toContain('handle__123action');
  });

  it('escapes backticks in RSC payload', () => {
    const fixture = makeFixture({ output: 'payload with `backtick`' });
    const code = generateSingleHandler('act', fixture);
    expect(code).toContain('\\`backtick\\`');
  });

  it('escapes dollar signs in RSC payload to prevent interpolation', () => {
    const fixture = makeFixture({ output: 'cost is $100' });
    const code = generateSingleHandler('act', fixture);
    expect(code).toContain('\\$100');
  });

  it('escapes backslashes in RSC payload', () => {
    const fixture = makeFixture({ output: 'path\\to\\file' });
    const code = generateSingleHandler('act', fixture);
    expect(code).toContain('path\\\\to\\\\file');
  });

  it('handles multiline RSC payload', () => {
    const fixture = makeFixture({
      output: '0:{"result":"ok"}\n1:I["mod",["default"]]\n',
    });
    const code = generateSingleHandler('multi', fixture);
    expect(code).toContain('0:{"result":"ok"}');
    expect(code).toContain('1:I["mod",["default"]]');
  });

  it('preserves exact action ID in header check (not sanitized)', () => {
    const code = generateSingleHandler('abc/def:ghi', makeFixture());
    expect(code).toContain("!== 'abc/def:ghi'");
  });
});

describe('generateHandlers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsctape-msw-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes msw import statement', async () => {
    await saveFixture(tmpDir, 'a1', makeFixture(), makeMeta({ actionId: 'a1' }));
    const code = await generateHandlers({ fixtureDir: tmpDir, outputPath: '' });
    expect(code).toContain("import { http, HttpResponse } from 'msw';");
  });

  it('generates handlers for all fixtures', async () => {
    await saveFixture(tmpDir, 'a1', makeFixture(), makeMeta({ actionId: 'a1' }));
    await saveFixture(tmpDir, 'a2', makeFixture(), makeMeta({ actionId: 'a2' }));
    const code = await generateHandlers({ fixtureDir: tmpDir, outputPath: '' });
    expect(code).toContain('handle_a1');
    expect(code).toContain('handle_a2');
  });

  it('exports handlers array with all handler names', async () => {
    await saveFixture(tmpDir, 'x', makeFixture(), makeMeta({ actionId: 'x' }));
    await saveFixture(tmpDir, 'y', makeFixture(), makeMeta({ actionId: 'y' }));
    const code = await generateHandlers({ fixtureDir: tmpDir, outputPath: '' });
    expect(code).toContain('export const handlers = [');
    expect(code).toContain('handle_x');
    expect(code).toContain('handle_y');
  });

  it('filters by actionIds when provided', async () => {
    await saveFixture(tmpDir, 'keep', makeFixture(), makeMeta({ actionId: 'keep' }));
    await saveFixture(tmpDir, 'skip', makeFixture(), makeMeta({ actionId: 'skip' }));
    const code = await generateHandlers({
      fixtureDir: tmpDir,
      outputPath: '',
      actionIds: ['keep'],
    });
    expect(code).toContain('handle_keep');
    expect(code).not.toContain('handle_skip');
  });

  it('writes to outputPath when provided', async () => {
    await saveFixture(tmpDir, 'w', makeFixture(), makeMeta({ actionId: 'w' }));
    const outPath = path.join(tmpDir, 'output', 'handlers.ts');
    const code = await generateHandlers({ fixtureDir: tmpDir, outputPath: outPath });
    expect(fs.existsSync(outPath)).toBe(true);
    const written = fs.readFileSync(outPath, 'utf-8');
    expect(written).toBe(code);
  });

  it('returns code string even when writing to file', async () => {
    await saveFixture(tmpDir, 'r', makeFixture(), makeMeta({ actionId: 'r' }));
    const outPath = path.join(tmpDir, 'out.ts');
    const code = await generateHandlers({ fixtureDir: tmpDir, outputPath: outPath });
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
  });

  it('returns empty handlers array when no fixtures exist', async () => {
    const code = await generateHandlers({ fixtureDir: tmpDir, outputPath: '' });
    expect(code).toContain('export const handlers = [];');
  });

  it('returns empty handlers array when directory does not exist', async () => {
    const code = await generateHandlers({
      fixtureDir: path.join(tmpDir, 'nonexistent'),
      outputPath: '',
    });
    expect(code).toContain('export const handlers = [];');
  });

  it('includes JSDoc for each handler in combined output', async () => {
    await saveFixture(tmpDir, 'act1', makeFixture(), makeMeta({ actionId: 'act1' }));
    const code = await generateHandlers({ fixtureDir: tmpDir, outputPath: '' });
    expect(code).toContain('/** Handler for action: act1 */');
  });
});
