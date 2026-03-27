import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import http from 'http';
import { register, _resetForTesting } from './interceptor';

// Use require to get the same mutable CJS module the interceptor patches
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule = require('http') as typeof import('http');

/** Helper: make an HTTP request and return status + body */
function makeRequest(
  port: number,
  options: {
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ statusCode: number; body: string }> {
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
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body != null) req.write(options.body);
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

/** Arbitrary: random response bodies */
const responseBodyArb = fc.string({ minLength: 1, maxLength: 200 });

/**
 * Property P13: Error Isolation (錯誤隔離性)
 * Validates: Requirements 1.4
 *
 * Interceptor errors during capture (e.g., fixture save failures due to
 * invalid/unwritable directories) must NOT affect the original request
 * processing. The client must still receive the correct response.
 */
describe('P13: Error Isolation', () => {
  let server: http.Server | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    _resetForTesting();
    vi.unstubAllEnvs();
  });

  function setupInterceptorWithBadDir() {
    vi.stubEnv('NODE_ENV', 'development');
    // Use an impossible path that will cause fixture save to fail
    register({ fixtureDir: '/dev/null/impossible/path', verbose: false, ignore: [] });
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
   * **Validates: Requirements 1.4**
   * Even when the fixture directory is invalid/unwritable, the interceptor
   * still passes through the response correctly to the client.
   */
  it('handler errors in fixture saving do not affect response', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        responseBodyArb,
        async (actionId, responsePayload) => {
          _resetForTesting();

          const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
            const chunks: Buffer[] = [];
            _req.on('data', (chunk) => chunks.push(chunk));
            _req.on('end', () => {
              res.writeHead(200, { 'Content-Type': 'text/x-component' });
              res.end(responsePayload);
            });
          };

          setupInterceptorWithBadDir();
          const port = await createTestServer(handler);

          try {
            const result = await makeRequest(port, {
              headers: {
                'next-action': actionId,
                'content-type': 'text/plain',
              },
              body: 'test-body',
            });

            // Response must be correct despite fixture save errors
            expect(result.statusCode).toBe(200);
            expect(result.body).toBe(responsePayload);
          } finally {
            // Wait briefly for async error logging to complete
            await new Promise((r) => setTimeout(r, 50));
            server?.close();
            server = null;
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   * For any random response body, when the handler writes a response and
   * the interceptor encounters an error during async processing, the client
   * still receives the correct response.
   */
  it('response is correct even with interceptor active on error paths', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        responseBodyArb,
        async (actionId, responsePayload) => {
          _resetForTesting();

          const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
            const chunks: Buffer[] = [];
            _req.on('data', (chunk) => chunks.push(chunk));
            _req.on('end', () => {
              // Write response in multiple chunks to exercise res.write path
              res.writeHead(200, { 'Content-Type': 'text/x-component' });
              const mid = Math.floor(responsePayload.length / 2);
              if (mid > 0) {
                res.write(responsePayload.slice(0, mid));
              }
              res.end(responsePayload.slice(mid));
            });
          };

          setupInterceptorWithBadDir();
          const port = await createTestServer(handler);

          try {
            const result = await makeRequest(port, {
              headers: {
                'next-action': actionId,
                'content-type': 'text/plain',
              },
              body: 'some-request-data',
            });

            // Client must receive the exact response despite interceptor errors
            expect(result.statusCode).toBe(200);
            expect(result.body).toBe(responsePayload);
          } finally {
            await new Promise((r) => setTimeout(r, 50));
            server?.close();
            server = null;
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});
