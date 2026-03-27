import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { register, _resetForTesting } from './interceptor';

// Use require to get the same mutable CJS module the interceptor patches
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule = require('http') as typeof import('http');

/** Helper: create a temp directory and clean up after use */
function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsctape-sel-prop-'));
  return fn(dir).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

/** Helper: make an HTTP request and return status + body */
function makeRequest(
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path ?? '/',
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

/** Arbitrary: random Next-Action header values (non-empty alphanumeric strings) */
const nextActionArb = fc.stringOf(
  fc.oneof(
    fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)),
    fc.constant('-'),
    fc.constant('_'),
  ),
  { minLength: 1, maxLength: 60 },
);

/** Arbitrary: random URL paths */
const pathArb = fc
  .array(
    fc.stringOf(fc.char().filter((c) => /[a-zA-Z0-9\-_]/.test(c)), {
      minLength: 1,
      maxLength: 20,
    }),
    { minLength: 0, maxLength: 4 },
  )
  .map((segments) => '/' + segments.join('/'));

/** Arbitrary: HTTP methods that are NOT POST */
const nonPostMethodArb = fc.constantFrom('GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD');

/** Arbitrary: random safe header names (lowercase, no special chars) */
const safeHeaderNameArb = fc.stringOf(
  fc.char().filter((c) => /[a-z]/.test(c)),
  { minLength: 2, maxLength: 12 },
).filter((h) => h !== 'next-action' && h !== 'host' && h !== 'content-length' && h !== 'transfer-encoding');

/** Arbitrary: random header values */
const headerValueArb = fc.string({ minLength: 1, maxLength: 30 }).filter((v) => !/[\r\n]/.test(v));

/**
 * Property P2: Interception Selectivity (攔截選擇性)
 * Validates: Requirements 1.1, 1.2
 *
 * Interceptor ONLY captures requests that contain the `Next-Action` header.
 * All other requests pass through without any capture logic.
 */
describe('P2: Interception Selectivity', () => {
  let server: http.Server | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    _resetForTesting();
    vi.unstubAllEnvs();
  });

  function setupInterceptor(fixtureDir: string) {
    vi.stubEnv('NODE_ENV', 'development');
    register({ fixtureDir, verbose: false, ignore: [] });
  }

  function createTestServer(
    handler: http.RequestListener,
  ): Promise<number> {
    return new Promise((resolve) => {
      server = httpModule.createServer(handler);
      server!.listen(0, () => {
        const addr = server!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
  }

  /**
   * **Validates: Requirements 1.1**
   * For any HTTP POST request with a random Next-Action header value,
   * the interceptor captures the request (fixture file is created)
   * and the response is still returned correctly to the client.
   */
  it('requests WITH Next-Action header are captured and response is preserved', async () => {
    await fc.assert(
      fc.asyncProperty(
        nextActionArb,
        fc.string({ minLength: 0, maxLength: 100 }),
        async (actionId, requestBody) => {
          await withTmpDir(async (fixtureDir) => {
            _resetForTesting();

            const responsePayload = '0:{"result":"ok"}\n';
            const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
              const chunks: Buffer[] = [];
              _req.on('data', (chunk) => chunks.push(chunk));
              _req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'text/x-component' });
                res.end(responsePayload);
              });
            };

            setupInterceptor(fixtureDir);
            const port = await createTestServer(handler);

            try {
              const result = await makeRequest(port, {
                method: 'POST',
                headers: {
                  'next-action': actionId,
                  'content-type': 'text/plain',
                },
                body: requestBody,
              });

              // Response must be unchanged
              expect(result.statusCode).toBe(200);
              expect(result.body).toBe(responsePayload);

              // Wait briefly for async fixture write
              await new Promise((r) => setTimeout(r, 100));

              // Fixture file should be created (capture happened)
              const files = fs.existsSync(fixtureDir)
                ? fs.readdirSync(fixtureDir)
                : [];
              const jsonFiles = files.filter(
                (f) => f.endsWith('.json') && !f.endsWith('.meta.json'),
              );
              expect(jsonFiles.length).toBeGreaterThanOrEqual(1);
            } finally {
              server?.close();
              server = null;
            }
          });
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   * For any HTTP request WITHOUT a Next-Action header (any method, any path,
   * any other headers), the interceptor does NOT create any fixture files
   * and the response passes through unchanged.
   */
  it('requests WITHOUT Next-Action header are NOT captured', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonPostMethodArb,
        pathArb,
        fc.array(fc.tuple(safeHeaderNameArb, headerValueArb), {
          minLength: 0,
          maxLength: 3,
        }),
        async (method, urlPath, extraHeaders) => {
          await withTmpDir(async (fixtureDir) => {
            _resetForTesting();

            const responseBody = 'pass-through-ok';
            const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end(responseBody);
            };

            setupInterceptor(fixtureDir);
            const port = await createTestServer(handler);

            const headers: Record<string, string> = {};
            for (const [k, v] of extraHeaders) {
              headers[k] = v;
            }
            // Ensure no Next-Action header
            delete headers['next-action'];

            try {
              const result = await makeRequest(port, {
                method,
                path: urlPath,
                headers,
              });

              // Response must pass through unchanged
              expect(result.statusCode).toBe(200);
              // HEAD requests don't return body
              if (method !== 'HEAD') {
                expect(result.body).toBe(responseBody);
              }

              // Wait briefly to ensure no async writes happen
              await new Promise((r) => setTimeout(r, 100));

              // No fixture files should be created
              const dirExists = fs.existsSync(fixtureDir);
              if (dirExists) {
                const files = fs.readdirSync(fixtureDir);
                expect(files).toHaveLength(0);
              }
            } finally {
              server?.close();
              server = null;
            }
          });
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   * POST requests without Next-Action header are also NOT captured.
   * This specifically tests that the method alone (POST) is not sufficient —
   * the Next-Action header is required.
   */
  it('POST requests WITHOUT Next-Action header are NOT captured', async () => {
    await fc.assert(
      fc.asyncProperty(
        pathArb,
        fc.string({ minLength: 0, maxLength: 50 }),
        async (urlPath, body) => {
          await withTmpDir(async (fixtureDir) => {
            _resetForTesting();

            const responseBody = 'post-no-action';
            const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
              const chunks: Buffer[] = [];
              _req.on('data', (chunk) => chunks.push(chunk));
              _req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(responseBody);
              });
            };

            setupInterceptor(fixtureDir);
            const port = await createTestServer(handler);

            try {
              const result = await makeRequest(port, {
                method: 'POST',
                path: urlPath,
                headers: { 'content-type': 'text/plain' },
                body,
              });

              expect(result.statusCode).toBe(200);
              expect(result.body).toBe(responseBody);

              await new Promise((r) => setTimeout(r, 100));

              const dirExists = fs.existsSync(fixtureDir);
              if (dirExists) {
                const files = fs.readdirSync(fixtureDir);
                expect(files).toHaveLength(0);
              }
            } finally {
              server?.close();
              server = null;
            }
          });
        },
      ),
      { numRuns: 20 },
    );
  });
});
