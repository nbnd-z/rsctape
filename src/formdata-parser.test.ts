import { describe, it, expect } from 'vitest';
import { parseFormData, setNestedValue } from './formdata-parser';

// ── helpers ──────────────────────────────────────────────────────────

const BOUNDARY = '----TestBoundary';
const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

/** Build a multipart body from field entries. */
function buildMultipart(
  fields: Array<{ name: string; value: string; filename?: string; contentType?: string }>,
): Buffer {
  let body = '';
  for (const f of fields) {
    body += `--${BOUNDARY}\r\n`;
    if (f.filename) {
      body += `Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\n`;
      body += `Content-Type: ${f.contentType ?? 'application/octet-stream'}\r\n`;
    } else {
      body += `Content-Disposition: form-data; name="${f.name}"\r\n`;
    }
    body += `\r\n`;
    body += `${f.value}\r\n`;
  }
  body += `--${BOUNDARY}--\r\n`;
  return Buffer.from(body);
}

// ── setNestedValue ───────────────────────────────────────────────────

describe('setNestedValue', () => {
  it('sets a simple nested key: user[name]', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'user', ['name'], 'Alice');
    expect(obj).toEqual({ user: { name: 'Alice' } });
  });

  it('sets deeply nested key: user[address][city]', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'user', ['address', 'city'], 'Taipei');
    expect(obj).toEqual({ user: { address: { city: 'Taipei' } } });
  });

  it('handles push notation: tags[]', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'tags', [''], 'a');
    setNestedValue(obj, 'tags', [''], 'b');
    expect(obj).toEqual({ tags: ['a', 'b'] });
  });

  it('handles indexed notation: items[0], items[1]', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'items', ['0'], 'first');
    setNestedValue(obj, 'items', ['1'], 'second');
    expect(obj).toEqual({ items: ['first', 'second'] });
  });
});

// ── parseFormData ────────────────────────────────────────────────────

describe('parseFormData', () => {
  it('parses simple text fields', async () => {
    const buf = buildMultipart([
      { name: 'username', value: 'alice' },
      { name: 'email', value: 'alice@example.com' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.fields).toEqual({ username: 'alice', email: 'alice@example.com' });
    expect(result.metadata.invocationType).toBe('form');
  });

  it('preserves empty string values (req 2.16)', async () => {
    const buf = buildMultipart([{ name: 'note', value: '' }]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.fields.note).toBe('');
  });

  it('tries JSON.parse on string values (req 2.15)', async () => {
    const buf = buildMultipart([
      { name: 'count', value: '42' },
      { name: 'obj', value: '{"a":1}' },
      { name: 'plain', value: 'hello' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.fields.count).toBe(42);
    expect(result.fields.obj).toEqual({ a: 1 });
    expect(result.fields.plain).toBe('hello');
  });

  // ── Action prefix handling ──

  it('extracts $ACTION_ID_ into metadata.actionId (req 2.4)', async () => {
    const buf = buildMultipart([
      { name: '$ACTION_ID_abc123', value: 'abc123' },
      { name: 'username', value: 'bob' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.metadata.actionId).toBe('abc123');
    expect(result.fields).not.toHaveProperty('$ACTION_ID_abc123');
    expect(result.fields.username).toBe('bob');
  });

  it('extracts $ACTION_REF_ into metadata.actionRef (req 2.5)', async () => {
    const buf = buildMultipart([
      { name: '$ACTION_REF_ref456', value: 'ref456' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.metadata.actionRef).toBe('ref456');
  });

  it('parses numbered prefix as programmatic args (req 2.6)', async () => {
    const buf = buildMultipart([
      { name: '$ACTION_ID_abc', value: 'abc' },
      { name: '1_$ACTION_ID_abc', value: '"hello"' },
      { name: '2_$ACTION_ID_abc', value: '42' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.metadata.invocationType).toBe('programmatic');
    expect(result.metadata.args).toEqual([undefined, 'hello', 42]);
  });

  it('records unknown $ prefixes (req 2.8)', async () => {
    const buf = buildMultipart([
      { name: '$CUSTOM_foo', value: 'bar' },
      { name: 'normal', value: 'val' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.metadata.unknownPrefixes).toContain('$CUSTOM_foo');
    expect(result.fields).toHaveProperty('$CUSTOM_foo');
  });

  // ── Bracket notation ──

  it('handles bracket notation for nested objects (req 2.10)', async () => {
    const buf = buildMultipart([
      { name: 'user[name]', value: 'Alice' },
      { name: 'user[address][city]', value: 'Taipei' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.fields).toEqual({
      user: { name: 'Alice', address: { city: 'Taipei' } },
    });
  });

  it('handles array push notation tags[] (req 2.11)', async () => {
    const buf = buildMultipart([
      { name: 'tags[]', value: 'react' },
      { name: 'tags[]', value: 'typescript' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.fields.tags).toEqual(['react', 'typescript']);
  });

  it('handles indexed array notation items[0] (req 2.12)', async () => {
    const buf = buildMultipart([
      { name: 'items[0]', value: 'first' },
      { name: 'items[1]', value: 'second' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.fields.items).toEqual(['first', 'second']);
  });

  // ── Duplicate keys ──

  it('collects duplicate keys into arrays (req 2.13)', async () => {
    const buf = buildMultipart([
      { name: 'color', value: 'red' },
      { name: 'color', value: 'blue' },
      { name: 'color', value: 'green' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.fields.color).toEqual(['red', 'blue', 'green']);
  });

  // ── File fields ──

  it('stores file fields as stub objects (req 2.14)', async () => {
    const buf = buildMultipart([
      { name: 'avatar', value: 'binarydata', filename: 'photo.png', contentType: 'image/png' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    const stub = result.fields.avatar as Record<string, unknown>;
    expect(stub.__type).toBe('file');
    expect(stub.name).toBe('photo.png');
    expect(stub.type).toBe('image/png');
    expect(typeof stub.size).toBe('number');
  });

  // ── Checkbox detection ──

  it('records checkbox fields in metadata (req 2.17)', async () => {
    const buf = buildMultipart([
      { name: 'agree', value: 'on' },
      { name: 'name', value: 'Alice' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.metadata.checkboxFields).toContain('agree');
  });

  // ── Framework hint ──

  it('sets frameworkHint to "next" when action prefix keys present (req 2.9)', async () => {
    const buf = buildMultipart([
      { name: '$ACTION_ID_abc', value: 'abc' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.metadata.frameworkHint).toBe('next');
  });

  it('sets frameworkHint to "unknown" for plain form fields', async () => {
    const buf = buildMultipart([
      { name: 'username', value: 'alice' },
    ]);
    const result = await parseFormData(buf, CONTENT_TYPE);
    expect(result.metadata.frameworkHint).toBe('unknown');
  });

  // ── Error handling ──

  it('returns parseFailed on invalid content-type', async () => {
    const result = await parseFormData(Buffer.from('garbage'), 'text/plain');
    expect(result.metadata.parseFailed).toBe(true);
    expect(result.fields).toHaveProperty('raw');
  });
});
