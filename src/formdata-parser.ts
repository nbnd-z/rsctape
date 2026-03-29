import Busboy from 'busboy';
import type { ParsedFormData, FormDataMetadata } from './types.js';
import { detectFrameworkFromFormData } from './framework-detect.js';

/**
 * Parse a key like "user[name]" or "tags[]" or "items[0]" into path segments.
 * Returns null if the key has no bracket notation.
 */
function parseBracketPath(key: string): { root: string; segments: string[] } | null {
  const match = key.match(/^([^[]+)(\[.*\])$/);
  if (!match) return null;

  const root = match[1];
  const bracketPart = match[2];
  const segments: string[] = [];
  const re = /\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bracketPart)) !== null) {
    segments.push(m[1]);
  }
  return { root, segments };
}

/**
 * Set a value in a nested object following bracket-notation path segments.
 * Handles:
 *   user[name]           → obj.user.name = value
 *   user[address][city]  → obj.user.address.city = value
 *   tags[]               → obj.tags = [..., value]  (push)
 *   items[0]             → obj.items[0] = value
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  root: string,
  segments: string[],
  value: unknown,
): void {
  if (segments.length === 0) {
    obj[root] = value;
    return;
  }

  // Ensure root container exists
  if (!(root in obj) || typeof obj[root] !== 'object' || obj[root] === null) {
    // Decide if root should be array or object based on first segment
    const first = segments[0];
    if (first === '' || /^\d+$/.test(first)) {
      obj[root] = [];
    } else {
      obj[root] = {};
    }
  }

  let current: unknown = obj[root];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    if (isLast) {
      if (seg === '') {
        // push notation: tags[]
        if (Array.isArray(current)) {
          (current as unknown[]).push(value);
        }
      } else if (/^\d+$/.test(seg)) {
        // indexed: items[0]
        if (Array.isArray(current)) {
          (current as unknown[])[parseInt(seg, 10)] = value;
        }
      } else {
        // named: user[name]
        (current as Record<string, unknown>)[seg] = value;
      }
    } else {
      // intermediate segment – ensure container exists
      const nextSeg = segments[i + 1];
      const needArray = nextSeg === '' || /^\d+$/.test(nextSeg);

      if (Array.isArray(current)) {
        const idx = /^\d+$/.test(seg) ? parseInt(seg, 10) : 0;
        if (current[idx] === undefined || current[idx] === null || typeof current[idx] !== 'object') {
          current[idx] = needArray ? [] : {};
        }
        current = current[idx];
      } else {
        const rec = current as Record<string, unknown>;
        if (rec[seg] === undefined || rec[seg] === null || typeof rec[seg] !== 'object') {
          rec[seg] = needArray ? [] : {};
        }
        current = rec[seg];
      }
    }
  }
}

/**
 * Try to JSON.parse a string value. Returns the parsed value on success,
 * or the original string on failure.
 */
function tryJsonParse(value: string): unknown {
  if (value === '') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Insert a value into the fields object, handling duplicate keys
 * by collecting values into arrays.
 */
function insertField(
  fields: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const bracket = parseBracketPath(key);
  if (bracket) {
    setNestedValue(fields, bracket.root, bracket.segments, value);
    return;
  }

  // Plain key – handle duplicates
  if (key in fields) {
    const existing = fields[key];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      fields[key] = [existing, value];
    }
  } else {
    fields[key] = value;
  }
}

/**
 * Parse a multipart/form-data Buffer into structured JSON fields
 * and framework metadata.
 *
 * Requirements: 2.1–2.17
 */
export async function parseFormData(
  body: Buffer,
  contentType: string,
): Promise<ParsedFormData> {
  const fields: Record<string, unknown> = {};
  const metadata: FormDataMetadata = {
    invocationType: 'form',
    frameworkHint: 'unknown',
  };

  // Collect all original keys for framework detection
  const allKeys: string[] = [];

  // Ordered args collected from numbered prefix keys
  const argsMap = new Map<number, unknown>();

  // Track unknown $ prefixes
  const unknownPrefixes: string[] = [];

  // Track checkbox candidates
  const checkboxCandidates: string[] = [];

  return new Promise<ParsedFormData>((resolve) => {
    let bb: Busboy.Busboy;
    try {
      bb = Busboy({ headers: { 'content-type': contentType } });
    } catch {
      // busboy constructor failed – return raw fallback
      resolve({
        fields: { raw: body.toString() },
        metadata: { ...metadata, parseFailed: true },
      });
      return;
    }

    let resolved = false;
    const finish = (result: ParsedFormData) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    // Safety timeout: if busboy never emits close/error, resolve with raw fallback
    const timer = setTimeout(() => {
      finish({
        fields: { raw: body.toString() },
        metadata: { ...metadata, parseFailed: true },
      });
    }, 5000);

    bb.on('field', (name: string, value: string) => {
      allKeys.push(name);

      // --- $ACTION_ID_ prefix (plain) ---
      if (name.startsWith('$ACTION_ID_')) {
        metadata.actionId = value;
        return;
      }

      // --- $ACTION_REF_ prefix (plain) ---
      if (name.startsWith('$ACTION_REF_')) {
        metadata.actionRef = value;
        return;
      }

      // --- Numbered prefix: e.g. 1_$ACTION_ID_xxx ---
      const numberedMatch = name.match(/^(\d+)_\$ACTION_(ID|REF)_/);
      if (numberedMatch) {
        const idx = parseInt(numberedMatch[1], 10);
        const parsed = tryJsonParse(value);
        argsMap.set(idx, parsed);
        return;
      }

      // --- Unknown $ prefix ---
      if (name.startsWith('$') && !name.startsWith('$ACTION_ID_') && !name.startsWith('$ACTION_REF_')) {
        unknownPrefixes.push(name);
        // Still keep in fields
      }

      // --- Regular field ---
      const parsed = tryJsonParse(value);
      insertField(fields, name, parsed);

      // Checkbox detection: simple string value "on"
      if (value === 'on' && typeof parsed === 'string') {
        checkboxCandidates.push(name);
      }
    });

    bb.on('file', (name: string, stream: NodeJS.ReadableStream, info: { filename: string; encoding: string; mimeType: string }) => {
      allKeys.push(name);
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      stream.on('end', () => {
        const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
        const stub = {
          __type: 'file' as const,
          name: info.filename,
          type: info.mimeType,
          size: totalSize,
        };
        insertField(fields, name, stub);
      });
    });

    bb.on('close', () => {
      // Determine invocationType
      if (argsMap.size > 0) {
        metadata.invocationType = 'programmatic';
        // Build ordered args array
        const maxIdx = Math.max(...argsMap.keys());
        const args: unknown[] = [];
        for (let i = 0; i <= maxIdx; i++) {
          args.push(argsMap.has(i) ? argsMap.get(i) : undefined);
        }
        metadata.args = args;
      }

      // Framework hint
      metadata.frameworkHint = detectFrameworkFromFormData(allKeys);

      // Unknown prefixes
      if (unknownPrefixes.length > 0) {
        metadata.unknownPrefixes = unknownPrefixes;
      }

      // Checkbox fields
      if (checkboxCandidates.length > 0) {
        metadata.checkboxFields = checkboxCandidates;
      }

      finish({ fields, metadata });
    });

    bb.on('error', () => {
      finish({
        fields: { raw: body.toString() },
        metadata: { ...metadata, parseFailed: true },
      });
    });

    bb.end(body);
  });
}
