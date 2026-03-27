import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { register, _resetForTesting } from './interceptor';
import { loadFixture } from './fixture-store';

// Use require to get the same mutable CJS module the interceptor patches
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule = require('http') as typeof import('http');

/** Helper: create a temp directory and clean up after use */
function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsctape-stream-'));
  return fn(dir).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

/** Helper: make an HTTP request and return status + body as string */
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
            body: Buffer.concat(chunks).toString('utf-8'),
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

/** Helper: wait for fixture to be written to disk (async write) */
async function waitForFixture(
  fixtureDir: string,
  actionId: string,
  timeoutMs = 3000,
): Promise<{ fixture: { input: Record<string, unknown>; output: string }; meta: any }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await loadFixture(fixtureDir, actionId);
    if (result) return result;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Fixture for ${actionId} not written within ${timeoutMs}ms`);
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

/** Arbitrary: random string chunks (1-200 chars each) */
const chunkArb = fc.string({ minLength: 1, maxLength: 200 });

/** Arbitrary: random arrays of string chunks (1-10 chunks) */
const chunksArb = fc.array(chunkArb, { minLength: 1, maxLength: 10 });

/**
 * Property P10: Streamed Response Completeness (串流回應完整性)
 * Validates: Requirements 1.8, 1.9, 3.3, 3.4
 *
 * For any random sequence of response chunks written via multiple res.write()
 * calls, the client receives the concatenation of all chunks in order, and
 * the saved fixture's output field equals the concatenation of all chunks.
 */
describe('P10: Streamed Response Completeness', () => {
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
   * **Validates: Requirements 1.8, 1.9**
   * For any random sequence of response chunks written via multiple res.write()
   * calls, the client receives the concatenation of all chunks in order.
   */
  it('chunked response is fully reassembled by client', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        chunksArb,
        async (actionId, chunks) => {
          await withTmpDir(async (fixtureDir) => {
            _resetForTesting();

            const expectedBody = chunks.join('');

            const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
              const bodyChunks: Buffer[] = [];
              _req.on('data', (chunk) => bodyChunks.push(chunk));
              _req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'text/x-component' });
                // Write each chunk separately via res.write()
                for (const chunk of chunks) {
                  res.write(chunk);
                }
                res.end();
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
                body: 'test-body',
              });

              // Client must receive all chunks concatenated in order
              expect(result.body).toBe(expectedBody);
            } finally {
              server?.close();
              server = null;
            }
          });
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * **Validates: Requirements 3.3, 3.4**
   * After the interceptor captures a chunked response, the saved fixture's
   * output field equals the concatenation of all response chunks.
   */
  it('fixture output matches concatenated chunks', async () => {
    await fc.assert(
      fc.asyncProperty(
        actionIdArb,
        chunksArb,
        async (actionId, chunks) => {
          await withTmpDir(async (fixtureDir) => {
            _resetForTesting();

            const expectedOutput = chunks.join('');

            const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
              const bodyChunks: Buffer[] = [];
              _req.on('data', (chunk) => bodyChunks.push(chunk));
              _req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'text/x-component' });
                for (const chunk of chunks) {
                  res.write(chunk);
                }
                res.end();
              });
            };

            setupInterceptor(fixtureDir);
            const port = await createTestServer(handler);

            try {
              await makeRequest(port, {
                headers: {
                  'next-action': actionId,
                  'content-type': 'text/plain',
                },
                body: 'test-body',
              });

              // Wait for async fixture write to complete
              const loaded = await waitForFixture(fixtureDir, actionId);

              // Fixture output must equal all chunks concatenated
              expect(loaded.fixture.output).toBe(expectedOutput);
            } finally {
              server?.close();
              server = null;
            }
          });
        },
      ),
      { numRuns: 15 },
    );
  });
});
