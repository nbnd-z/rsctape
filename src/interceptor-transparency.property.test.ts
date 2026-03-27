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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsctape-transp-'));
  return fn(dir).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

/** Helper: make an HTTP request and return status + body as Buffer */
function makeRequest(
  port: number,
  options: {
    headers?: Record<string, string>;
    body?: Buffer | string;
  },
): Promise<{ statusCode: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: 'POST',
        path: '/',
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body != null) {
      req.write(options.body);
    }
    req.end();
  });
}

/** Arbitrary: random action IDs (non-empty alphanumeric + dash/underscore) */
const actionIdArb = fc.stringOf(
  fc.oneof(
    fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)),
    fc.constant('-'),
    fc.constant('_'),
  ),
  { minLength: 1, maxLength: 40 },
);

/** Arbitrary: random binary-safe request bodies */
const requestBodyArb = fc.oneof(
  // Random binary buffers
  fc.uint8Array({ minLength: 0, maxLength: 512 }).map((arr) => Buffer.from(arr)),
  // Random string bodies
  fc.string({ minLength: 0, maxLength: 256 }).map((s) => Buffer.from(s, 'utf-8')),
);

/** Arbitrary: random binary-safe response bodies */
const responseBodyArb = fc.oneof(
  // Random binary buffers
  fc.uint8Array({ minLength: 1, maxLength: 512 }).map((arr) => Buffer.from(arr)),
  // Random string bodies (non-empty to avoid ambiguity)
  fc.string({ minLength: 1, maxLength: 256 }).map((s) => Buffer.from(s, 'utf-8')),
);

/**
 * Property P1: Interception Transparency (攔截透明性)
 * Validates: Requirements 1.7, 1.10
 *
 * For any HTTP request R and response Resp, with the Interceptor enabled,
 * the original request handler receives the exact same request body bytes
 * and the client receives the exact same response body bytes.
 */
describe('P1: Interception Transparency', () => {
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

  function createTestServer(handler: http.RequestListener): Promise<number> {
    return new Promise((resolve) => {
      server = httpModule.createServer(handler);
      server!.listen(0, () => {
        const addr = server!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
  }

  /**
   * **Validates: Requirements 1.7**
   * For any random request body sent with a Next-Action header,
   * the original handler receives the exact same request body bytes.
   */
  it('request body is preserved through interception', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        requestBodyArb,
        async (actionId, sentBody) => {
          await withTmpDir(async (fixtureDir) => {
            _resetForTesting();

            let receivedBody: Buffer = Buffer.alloc(0);

            const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
              const chunks: Buffer[] = [];
              req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
              req.on('end', () => {
                receivedBody = Buffer.concat(chunks);
                res.writeHead(200, { 'Content-Type': 'text/x-component' });
                res.end('0:{"ok":true}\n');
              });
            };

            setupInterceptor(fixtureDir);
            const port = await createTestServer(handler);

            try {
              await makeRequest(port, {
                headers: {
                  'next-action': actionId,
                  'content-type': 'application/octet-stream',
                  'content-length': String(sentBody.length),
                },
                body: sentBody,
              });

              // The handler must receive the exact same bytes
              expect(receivedBody.equals(sentBody)).toBe(true);
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
   * **Validates: Requirements 1.10**
   * For any random response body written by the handler,
   * the client receives the exact same response body bytes.
   */
  it('response body is preserved through interception', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        responseBodyArb,
        async (actionId, handlerResponseBody) => {
          await withTmpDir(async (fixtureDir) => {
            _resetForTesting();

            const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
              const chunks: Buffer[] = [];
              _req.on('data', (chunk) => chunks.push(chunk));
              _req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'text/x-component' });
                res.end(handlerResponseBody);
              });
            };

            setupInterceptor(fixtureDir);
            const port = await createTestServer(handler);

            try {
              const result = await makeRequest(port, {
                headers: {
                  'next-action': actionId,
                  'content-type': 'text/plain',
                },
                body: 'test',
              });

              // The client must receive the exact same bytes
              expect(result.body.equals(handlerResponseBody)).toBe(true);
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
