import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseFormData } from './formdata-parser';

// ── helpers ──────────────────────────────────────────────────────────

const BOUNDARY = '----TestBoundary';
const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

/** Build a multipart body from field entries. */
function buildMultipart(
  fields: Array<{ name: string; value: string }>,
): Buffer {
  let body = '';
  for (const f of fields) {
    body += `--${BOUNDARY}\r\n`;
    body += `Content-Disposition: form-data; name="${f.name}"\r\n`;
    body += `\r\n`;
    body += `${f.value}\r\n`;
  }
  body += `--${BOUNDARY}--\r\n`;
  return Buffer.from(body);
}

/**
 * Arbitrary for safe field names: starts with a letter, followed by
 * alphanumeric or underscore chars. Avoids special chars that break
 * multipart format or collide with framework prefixes.
 */
const safeFieldName = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,19}$/);

/**
 * Arbitrary for safe string values: printable ASCII without \r, \n,
 * or characters that could break multipart boundaries.
 */
const safeValue = fc.stringMatching(/^[a-zA-Z0-9 _.,!?@#%^&*()+=:;'-]{0,50}$/);

/**
 * Property P3: FormData Parse Round-Trip Consistency (FormData 解析往返一致性)
 * Validates: Requirements 2.1, 2.2, 2.10, 2.11, 2.12, 2.13
 */
describe('P3: FormData Parse Round-Trip Consistency', () => {
  /**
   * **Validates: Requirements 2.1, 2.2**
   * Simple field round-trip: For any set of simple key-value string pairs
   * (no brackets, no $ prefix), parsing the multipart body should produce
   * fields containing all those keys with their values.
   */
  it('simple field round-trip: all plain key-value pairs are preserved', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ name: safeFieldName, value: safeValue }),
          { minLength: 1, maxLength: 10 },
        ),
        async (entries) => {
          // Deduplicate keys – keep last value per key to match simple expectation
          const uniqueMap = new Map<string, string>();
          for (const e of entries) {
            uniqueMap.set(e.name, e.value);
          }
          // Filter out keys that appear more than once (tested separately in duplicate test)
          const keyCounts = new Map<string, number>();
          for (const e of entries) {
            keyCounts.set(e.name, (keyCounts.get(e.name) ?? 0) + 1);
          }
          const singleKeys = [...uniqueMap.entries()].filter(
            ([k]) => keyCounts.get(k) === 1,
          );

          if (singleKeys.length === 0) return; // skip degenerate case

          const fields = singleKeys.map(([name, value]) => ({ name, value }));
          const buf = buildMultipart(fields);
          const result = await parseFormData(buf, CONTENT_TYPE);

          for (const [name, value] of singleKeys) {
            expect(result.fields).toHaveProperty(name);
            // parseFormData tries JSON.parse, so numeric strings become numbers
            const expected = (() => {
              if (value === '') return '';
              try { return JSON.parse(value); } catch { return value; }
            })();
            expect(result.fields[name]).toEqual(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.10**
   * Bracket notation round-trip: For any key using bracket notation like
   * `user[name]`, the parsed result should contain the nested structure.
   */
  it('bracket notation round-trip: nested objects are created correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeFieldName,
        safeFieldName,
        safeValue.filter((v) => v.length > 0),
        async (root, nested, value) => {
          fc.pre(root !== nested); // avoid degenerate case
          const key = `${root}[${nested}]`;
          const buf = buildMultipart([{ name: key, value }]);
          const result = await parseFormData(buf, CONTENT_TYPE);

          expect(result.fields).toHaveProperty(root);
          const rootObj = result.fields[root] as Record<string, unknown>;
          expect(typeof rootObj).toBe('object');
          expect(rootObj).not.toBeNull();

          const expected = (() => {
            try { return JSON.parse(value); } catch { return value; }
          })();
          expect(rootObj[nested]).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.11**
   * Array push notation: For any key using `tags[]` with multiple values,
   * the parsed result should contain an array with all values in order.
   */
  it('array push notation: tags[] collects values in order', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeFieldName,
        fc.array(safeValue, { minLength: 1, maxLength: 8 }),
        async (root, values) => {
          const key = `${root}[]`;
          const fields = values.map((v) => ({ name: key, value: v }));
          const buf = buildMultipart(fields);
          const result = await parseFormData(buf, CONTENT_TYPE);

          expect(result.fields).toHaveProperty(root);
          const arr = result.fields[root];
          expect(Array.isArray(arr)).toBe(true);
          expect((arr as unknown[]).length).toBe(values.length);

          for (let i = 0; i < values.length; i++) {
            const expected = (() => {
              if (values[i] === '') return '';
              try { return JSON.parse(values[i]); } catch { return values[i]; }
            })();
            expect((arr as unknown[])[i]).toEqual(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.12**
   * Indexed array notation: For keys like `items[0]`, `items[1]`, the
   * parsed result should contain an ordered array.
   */
  it('indexed array notation: items[i] produces ordered array', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeFieldName,
        fc.array(safeValue, { minLength: 1, maxLength: 8 }),
        async (root, values) => {
          const fields = values.map((v, i) => ({
            name: `${root}[${i}]`,
            value: v,
          }));
          const buf = buildMultipart(fields);
          const result = await parseFormData(buf, CONTENT_TYPE);

          expect(result.fields).toHaveProperty(root);
          const arr = result.fields[root];
          expect(Array.isArray(arr)).toBe(true);
          expect((arr as unknown[]).length).toBe(values.length);

          for (let i = 0; i < values.length; i++) {
            const expected = (() => {
              if (values[i] === '') return '';
              try { return JSON.parse(values[i]); } catch { return values[i]; }
            })();
            expect((arr as unknown[])[i]).toEqual(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.13**
   * Duplicate key collection: For any key appearing multiple times, the
   * parsed result should contain an array of all values.
   */
  it('duplicate key collection: repeated plain keys become arrays', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeFieldName,
        fc.array(safeValue, { minLength: 2, maxLength: 8 }),
        async (key, values) => {
          const fields = values.map((v) => ({ name: key, value: v }));
          const buf = buildMultipart(fields);
          const result = await parseFormData(buf, CONTENT_TYPE);

          expect(result.fields).toHaveProperty(key);
          const arr = result.fields[key];
          expect(Array.isArray(arr)).toBe(true);
          expect((arr as unknown[]).length).toBe(values.length);

          for (let i = 0; i < values.length; i++) {
            const expected = (() => {
              if (values[i] === '') return '';
              try { return JSON.parse(values[i]); } catch { return values[i]; }
            })();
            expect((arr as unknown[])[i]).toEqual(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
