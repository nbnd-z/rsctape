import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  sanitizeName,
  saveFixture,
  loadFixture,
  listFixtures,
  deleteFixture,
} from './fixture-store';
import type { Fixture, FixtureMeta } from './types';

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

function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    input: { username: 'alice' },
    output: '0:{"result":"ok"}\n',
    ...overrides,
  };
}

describe('sanitizeName', () => {
  it('keeps alphanumeric, hyphens, and underscores', () => {
    expect(sanitizeName('abc-def_123')).toBe('abc-def_123');
  });

  it('replaces special characters with hyphens', () => {
    expect(sanitizeName('a/b:c.d')).toBe('a-b-c-d');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitizeName('hello world')).toBe('hello-world');
  });

  it('truncates long names', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeName(long).length).toBeLessThanOrEqual(300);
  });

  it('handles empty string', () => {
    expect(sanitizeName('')).toBe('_unnamed');
  });
});

describe('fixture-store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsctape-fixture-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('saveFixture', () => {
    it('creates fixture directory if it does not exist', async () => {
      const dir = path.join(tmpDir, 'nested', 'dir');
      await saveFixture(dir, 'action1', makeFixture(), makeMeta());
      expect(fs.existsSync(dir)).toBe(true);
    });

    it('writes .json and .meta.json files', async () => {
      await saveFixture(tmpDir, 'action1', makeFixture(), makeMeta());
      const files = fs.readdirSync(tmpDir);
      expect(files).toContain('action1.json');
      expect(files).toContain('action1.meta.json');
    });

    it('writes fixture data with 2-space indentation', async () => {
      const fixture = makeFixture();
      await saveFixture(tmpDir, 'act', fixture, makeMeta());
      const raw = fs.readFileSync(path.join(tmpDir, 'act.json'), 'utf-8');
      expect(raw).toBe(JSON.stringify(fixture, null, 2));
    });

    it('sanitizes action ID for filename', async () => {
      await saveFixture(tmpDir, 'a/b:c', makeFixture(), makeMeta());
      const files = fs.readdirSync(tmpDir);
      expect(files).toContain('a-b-c.json');
      expect(files).toContain('a-b-c.meta.json');
    });

    it('stores RSC Payload as raw text in output field', async () => {
      const rscPayload = '0:{"result":"success"}\n1:I["module-id",["default"]]\n';
      const fixture = makeFixture({ output: rscPayload });
      await saveFixture(tmpDir, 'rsc-test', fixture, makeMeta());
      const raw = fs.readFileSync(path.join(tmpDir, 'rsc-test.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.output).toBe(rscPayload);
    });

    it('overwrites existing files on same action ID', async () => {
      const fixture1 = makeFixture({ input: { v: 1 } });
      const fixture2 = makeFixture({ input: { v: 2 } });
      const meta1 = makeMeta({ timestamp: '2024-01-01T00:00:00.000Z' });
      const meta2 = makeMeta({ timestamp: '2024-02-01T00:00:00.000Z' });

      await saveFixture(tmpDir, 'dup', fixture1, meta1);
      await saveFixture(tmpDir, 'dup', fixture2, meta2);

      const raw = fs.readFileSync(path.join(tmpDir, 'dup.json'), 'utf-8');
      expect(JSON.parse(raw).input).toEqual({ v: 2 });

      const metaRaw = fs.readFileSync(path.join(tmpDir, 'dup.meta.json'), 'utf-8');
      expect(JSON.parse(metaRaw).timestamp).toBe('2024-02-01T00:00:00.000Z');
    });
  });

  describe('loadFixture', () => {
    it('returns fixture and meta when files exist', async () => {
      const fixture = makeFixture();
      const meta = makeMeta();
      await saveFixture(tmpDir, 'load-test', fixture, meta);

      const result = await loadFixture(tmpDir, 'load-test');
      expect(result).not.toBeNull();
      expect(result!.fixture).toEqual(fixture);
      expect(result!.meta).toEqual(meta);
    });

    it('returns null when files do not exist', async () => {
      const result = await loadFixture(tmpDir, 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when directory does not exist', async () => {
      const result = await loadFixture(path.join(tmpDir, 'no-dir'), 'x');
      expect(result).toBeNull();
    });

    it('preserves RSC Payload as raw text', async () => {
      const payload = '0:{"a":1}\n1:I["mod",["default"]]\n';
      await saveFixture(tmpDir, 'rsc', makeFixture({ output: payload }), makeMeta());
      const result = await loadFixture(tmpDir, 'rsc');
      expect(result!.fixture.output).toBe(payload);
    });
  });

  describe('listFixtures', () => {
    it('returns empty array when directory does not exist', async () => {
      const result = await listFixtures(path.join(tmpDir, 'nope'));
      expect(result).toEqual([]);
    });

    it('returns empty array when directory is empty', async () => {
      const result = await listFixtures(tmpDir);
      expect(result).toEqual([]);
    });

    it('lists all saved fixtures', async () => {
      await saveFixture(tmpDir, 'a1', makeFixture(), makeMeta({ actionId: 'a1' }));
      await saveFixture(tmpDir, 'a2', makeFixture(), makeMeta({ actionId: 'a2' }));

      const result = await listFixtures(tmpDir);
      const ids = result.map((r) => r.actionId).sort();
      expect(ids).toEqual(['a1', 'a2']);
    });

    it('ignores non-meta.json files', async () => {
      await saveFixture(tmpDir, 'x', makeFixture(), makeMeta({ actionId: 'x' }));
      // Write an extra non-meta file
      fs.writeFileSync(path.join(tmpDir, 'random.txt'), 'hello');

      const result = await listFixtures(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].actionId).toBe('x');
    });
  });

  describe('deleteFixture', () => {
    it('removes both .json and .meta.json files', async () => {
      await saveFixture(tmpDir, 'del', makeFixture(), makeMeta());
      await deleteFixture(tmpDir, 'del');

      expect(fs.existsSync(path.join(tmpDir, 'del.json'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'del.meta.json'))).toBe(false);
    });

    it('does not throw when files do not exist', async () => {
      await expect(deleteFixture(tmpDir, 'ghost')).resolves.toBeUndefined();
    });

    it('fixture is no longer loadable after deletion', async () => {
      await saveFixture(tmpDir, 'gone', makeFixture(), makeMeta());
      await deleteFixture(tmpDir, 'gone');
      const result = await loadFixture(tmpDir, 'gone');
      expect(result).toBeNull();
    });
  });
});
