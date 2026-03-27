import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { saveFixture, loadFixture } from './fixture-store';
import type { Fixture, FixtureMeta } from './types';

function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsctape-fixture-prop-'));
  return fn(dir).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

/** Arbitrary: alphanumeric action IDs (safe for filenames) */
const actionIdArb = fc.stringOf(
  fc.oneof(
    fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)),
    fc.constant('-'),
    fc.constant('_')
  ),
  { minLength: 1, maxLength: 60 }
);

/** Arbitrary: JSON-serializable objects for fixture input */
const jsonObjectArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.boolean(),
    fc.constant(null),
    fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()), { maxLength: 5 })
  ),
  { minKeys: 0, maxKeys: 10 }
) as fc.Arbitrary<Record<string, unknown>>;

/** Arbitrary: random RSC payload strings including multiline, unicode, special chars */
const rscPayloadArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 500 }),
  fc.unicodeString({ minLength: 0, maxLength: 300 }),
  // Realistic RSC line protocol payloads
  fc.array(
    fc.tuple(fc.nat({ max: 20 }), fc.string({ minLength: 1, maxLength: 100 })).map(
      ([idx, content]) => `${idx}:${content}`
    ),
    { minLength: 1, maxLength: 10 }
  ).map((lines) => lines.join('\n') + '\n')
);

/** Arbitrary: valid FixtureMeta values */
const fixtureMetaArb = fc.record({
  actionId: actionIdArb,
  url: fc.webUrl().map((u) => new URL(u).pathname),
  method: fc.constant('POST'),
  statusCode: fc.oneof(fc.constant(200), fc.constant(500), fc.constant(404), fc.nat({ max: 599 }).filter((n) => n >= 100)),
  contentType: fc.constant('text/x-component'),
  timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
  error: fc.option(fc.boolean(), { nil: undefined }),
}) as fc.Arbitrary<FixtureMeta>;

/**
 * Property P5: Fixture Storage Integrity (Fixture 儲存完整性)
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.7
 */
describe('P5: Fixture Storage Integrity', () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
   * Save-load round-trip: For any valid fixture and metadata,
   * saving then loading produces identical data.
   */
  it('save-load round-trip preserves fixture and meta fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        jsonObjectArb,
        rscPayloadArb,
        fixtureMetaArb,
        async (actionId, input, output, meta) => {
          await withTmpDir(async (dir) => {
            const fixture: Fixture = { input, output };
            // Align meta.actionId with the actionId used for storage
            const metaWithId: FixtureMeta = { ...meta, actionId };

            await saveFixture(dir, actionId, fixture, metaWithId);
            const loaded = await loadFixture(dir, actionId);

            expect(loaded).not.toBeNull();
            expect(loaded!.fixture.input).toEqual(fixture.input);
            expect(loaded!.fixture.output).toBe(fixture.output);
            expect(loaded!.meta.actionId).toBe(metaWithId.actionId);
            expect(loaded!.meta.statusCode).toBe(metaWithId.statusCode);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.7**
   * RSC Payload preserved as raw text: For any random string used as RSC payload
   * (including multiline, special chars, unicode), the output field after
   * save-load is identical to the original.
   */
  it('RSC Payload is preserved as raw text through save-load', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        rscPayloadArb,
        async (actionId, rscPayload) => {
          await withTmpDir(async (dir) => {
            const fixture: Fixture = { input: {}, output: rscPayload };
            const meta: FixtureMeta = {
              actionId,
              url: '/action',
              method: 'POST',
              statusCode: 200,
              contentType: 'text/x-component',
              timestamp: new Date().toISOString(),
            };

            await saveFixture(dir, actionId, fixture, meta);
            const loaded = await loadFixture(dir, actionId);

            expect(loaded).not.toBeNull();
            expect(loaded!.fixture.output).toBe(rscPayload);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.1, 4.2**
   * Two-file structure: After saving, exactly two files exist for the action ID:
   * a .json data file and a .meta.json metadata file.
   */
  it('saving creates exactly two files: .json and .meta.json', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        jsonObjectArb,
        rscPayloadArb,
        fixtureMetaArb,
        async (actionId, input, output, meta) => {
          await withTmpDir(async (dir) => {
            const fixture: Fixture = { input, output };
            await saveFixture(dir, actionId, fixture, { ...meta, actionId });

            const files = fs.readdirSync(dir);
            expect(files).toHaveLength(2);

            const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'));
            const metaFiles = files.filter((f) => f.endsWith('.meta.json'));
            expect(jsonFiles).toHaveLength(1);
            expect(metaFiles).toHaveLength(1);

            // The meta file name should be the data file name with .meta inserted
            const baseName = jsonFiles[0].replace('.json', '');
            expect(metaFiles[0]).toBe(`${baseName}.meta.json`);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property P6: Fixture Overwrite Idempotency (Fixture 覆寫冪等性)
 * Validates: Requirements 4.6
 */
describe('P6: Fixture Overwrite Idempotency', () => {
  /**
   * **Validates: Requirements 4.6**
   * Overwrite idempotency: For the same actionId, saving fixture1 then fixture2,
   * loading should return fixture2's data and meta (not fixture1's).
   */
  it('saving twice with same actionId keeps only the last fixture and meta', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        jsonObjectArb,
        rscPayloadArb,
        fixtureMetaArb,
        jsonObjectArb,
        rscPayloadArb,
        fixtureMetaArb,
        async (actionId, input1, output1, metaBase1, input2, output2, metaBase2) => {
          await withTmpDir(async (dir) => {
            const fixture1: Fixture = { input: input1, output: output1 };
            const meta1: FixtureMeta = { ...metaBase1, actionId };

            const fixture2: Fixture = { input: input2, output: output2 };
            const meta2: FixtureMeta = { ...metaBase2, actionId };

            // Save first, then overwrite with second
            await saveFixture(dir, actionId, fixture1, meta1);
            await saveFixture(dir, actionId, fixture2, meta2);

            const loaded = await loadFixture(dir, actionId);

            expect(loaded).not.toBeNull();
            // Data must match fixture2, not fixture1
            expect(loaded!.fixture.input).toEqual(fixture2.input);
            expect(loaded!.fixture.output).toBe(fixture2.output);
            // Meta must match meta2, not meta1
            expect(loaded!.meta.actionId).toBe(meta2.actionId);
            expect(loaded!.meta.statusCode).toBe(meta2.statusCode);
            expect(loaded!.meta.url).toBe(meta2.url);
            expect(loaded!.meta.timestamp).toBe(meta2.timestamp);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
