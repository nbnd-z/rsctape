import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseFormData } from './formdata-parser';

// ── helpers ──────────────────────────────────────────────────────────

const BOUNDARY = '----TestBoundary';
const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

/** Common MIME types for file uploads. */
const MIME_TYPES = [
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'application/pdf',
  'text/plain',
  'application/json',
  'application/zip',
  'video/mp4',
  'audio/mpeg',
];

/** Build a multipart body containing a single file field with binary content. */
function buildMultipartWithFile(
  fieldName: string,
  fileName: string,
  mimeType: string,
  content: Buffer,
): Buffer {
  const header =
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `\r\n`;
  const footer = `\r\n--${BOUNDARY}--\r\n`;

  return Buffer.concat([
    Buffer.from(header),
    content,
    Buffer.from(footer),
  ]);
}

/** Arbitrary for safe field names (alphanumeric, starts with letter). */
const safeFieldName = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,19}$/);

/** Arbitrary for safe file names (alphanumeric + common extensions). */
const safeFileName = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,14}$/),
    fc.constantFrom('.bin', '.png', '.jpg', '.pdf', '.txt', '.json', '.zip'),
  )
  .map(([base, ext]) => `${base}${ext}`);

/** Arbitrary for MIME types from the common set. */
const mimeTypeArb = fc.constantFrom(...MIME_TYPES);

/** Arbitrary for random binary content (1–256 bytes). */
const binaryContentArb = fc
  .uint8Array({ minLength: 1, maxLength: 256 })
  .map((arr) => Buffer.from(arr));

/**
 * Property P12: File Field Safety (檔案欄位安全性)
 * Validates: Requirements 2.14
 */
describe('P12: File Field Safety', () => {
  /**
   * **Validates: Requirements 2.14**
   * File fields are always stored as stub objects: For any FormData
   * containing file fields with random binary content, the parsed result
   * must contain a stub object with `__type: "file"`, `name` (string),
   * `type` (string), and `size` (number). The stub must NOT contain the
   * actual binary content.
   */
  it('file fields are always stored as stub objects with correct shape', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeFieldName,
        safeFileName,
        mimeTypeArb,
        binaryContentArb,
        async (fieldName, fileName, mimeType, content) => {
          const buf = buildMultipartWithFile(fieldName, fileName, mimeType, content);
          const result = await parseFormData(buf, CONTENT_TYPE);

          expect(result.fields).toHaveProperty(fieldName);
          const stub = result.fields[fieldName] as Record<string, unknown>;

          // Must have __type: "file"
          expect(stub.__type).toBe('file');
          // name must be a string
          expect(typeof stub.name).toBe('string');
          // type must be a string
          expect(typeof stub.type).toBe('string');
          // size must be a number
          expect(typeof stub.size).toBe('number');
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.14**
   * File stub size matches original content size: The `size` field in the
   * stub must equal the byte length of the original file content.
   */
  it('file stub size matches original content byte length', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeFieldName,
        safeFileName,
        mimeTypeArb,
        binaryContentArb,
        async (fieldName, fileName, mimeType, content) => {
          const buf = buildMultipartWithFile(fieldName, fileName, mimeType, content);
          const result = await parseFormData(buf, CONTENT_TYPE);

          const stub = result.fields[fieldName] as Record<string, unknown>;
          expect(stub.size).toBe(content.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.14**
   * File stub never contains binary data: Serializing the stub to JSON
   * must not contain any of the original binary content bytes.
   */
  it('file stub JSON serialization does not contain original binary content', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeFieldName,
        safeFileName,
        mimeTypeArb,
        // Use content >= 4 bytes so we have a meaningful binary signature to check
        fc.uint8Array({ minLength: 4, maxLength: 256 }).map((arr) => Buffer.from(arr)),
        async (fieldName, fileName, mimeType, content) => {
          const buf = buildMultipartWithFile(fieldName, fileName, mimeType, content);
          const result = await parseFormData(buf, CONTENT_TYPE);

          const stub = result.fields[fieldName] as Record<string, unknown>;
          const serialized = JSON.stringify(stub);

          // The serialized stub must not contain the raw binary content
          // Check that the binary content (as a string) is not embedded
          const binaryStr = content.toString('binary');
          expect(serialized).not.toContain(binaryStr);

          // Also verify the stub only has the expected keys
          const keys = Object.keys(stub);
          expect(keys).toEqual(expect.arrayContaining(['__type', 'name', 'type', 'size']));
          expect(keys.length).toBe(4);
        },
      ),
      { numRuns: 100 },
    );
  });
});
