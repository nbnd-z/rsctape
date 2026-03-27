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

/** Arbitrary for random alphanumeric action IDs. */
const actionIdArb = fc.stringMatching(/^[a-zA-Z0-9]{4,20}$/);

/** Arbitrary for safe string values (no multipart-breaking chars). */
const safeValue = fc.stringMatching(/^[a-zA-Z0-9 _.,!?@#%^&*()+=:;'-]{0,50}$/);

/**
 * Property P4: Framework Prefix Separation (框架前綴分離)
 * Validates: Requirements 2.4, 2.5, 2.6
 */
describe('P4: Framework Prefix Separation', () => {
  /**
   * **Validates: Requirements 2.4**
   * $ACTION_ID_ keys never appear in fields: For any FormData containing
   * a key starting with `$ACTION_ID_`, that key must NOT appear in
   * `parsed.fields` and `parsed.metadata.actionId` must be defined.
   */
  it('$ACTION_ID_ keys never appear in fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        safeValue,
        async (actionId, value) => {
          const prefixKey = `$ACTION_ID_${actionId}`;
          const buf = buildMultipart([
            { name: prefixKey, value },
          ]);
          const result = await parseFormData(buf, CONTENT_TYPE);

          // The prefix key must NOT appear in fields
          expect(result.fields).not.toHaveProperty(prefixKey);
          // metadata.actionId must be defined
          expect(result.metadata.actionId).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.5**
   * $ACTION_REF_ keys never appear in fields: For any FormData containing
   * a key starting with `$ACTION_REF_`, that key must NOT appear in
   * `parsed.fields` and `parsed.metadata.actionRef` must be defined.
   */
  it('$ACTION_REF_ keys never appear in fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        safeValue,
        async (actionId, value) => {
          const prefixKey = `$ACTION_REF_${actionId}`;
          const buf = buildMultipart([
            { name: prefixKey, value },
          ]);
          const result = await parseFormData(buf, CONTENT_TYPE);

          // The prefix key must NOT appear in fields
          expect(result.fields).not.toHaveProperty(prefixKey);
          // metadata.actionRef must be defined
          expect(result.metadata.actionRef).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.6**
   * Numbered prefix keys produce ordered args: For any FormData containing
   * keys like `1_$ACTION_ID_xxx`, `2_$ACTION_ID_xxx`, the metadata must
   * have `invocationType: 'programmatic'` and `args` array with values
   * at the correct indices.
   */
  it('numbered prefix keys produce ordered args with correct invocationType', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        fc.array(safeValue.filter((v) => v.length > 0), { minLength: 1, maxLength: 5 }),
        async (actionId, values) => {
          const fields = [
            { name: `$ACTION_ID_${actionId}`, value: actionId },
          ];
          // Add numbered prefix keys starting at index 1
          for (let i = 0; i < values.length; i++) {
            fields.push({
              name: `${i + 1}_$ACTION_ID_${actionId}`,
              value: JSON.stringify(values[i]),
            });
          }

          const buf = buildMultipart(fields);
          const result = await parseFormData(buf, CONTENT_TYPE);

          // Must be programmatic invocation
          expect(result.metadata.invocationType).toBe('programmatic');
          // args must be defined
          expect(result.metadata.args).toBeDefined();
          const args = result.metadata.args!;
          // Each numbered value should be at the correct index
          for (let i = 0; i < values.length; i++) {
            expect(args[i + 1]).toEqual(values[i]);
          }
          // Numbered prefix keys must NOT appear in fields
          for (let i = 0; i < values.length; i++) {
            const numberedKey = `${i + 1}_$ACTION_ID_${actionId}`;
            expect(result.fields).not.toHaveProperty(numberedKey);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
