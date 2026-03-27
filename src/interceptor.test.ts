import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { register, _resetForTesting } from './interceptor';

// Use require to get the same mutable CJS module the interceptor patches
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule = require('http') as typeof import('http');

describe('interceptor', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
    vi.unstubAllEnvs();
  });

  describe('register() environment checks', () => {
    it('does nothing when NODE_ENV is not development and RSCTAPE_ENABLED is not true', () => {
      vi.stubEnv('NODE_ENV', 'production');
      delete process.env.RSCTAPE_ENABLED;

      const before = httpModule.createServer;
      register();
      expect(httpModule.createServer).toBe(before);
    });

    it('does nothing when NODE_ENV is test and RSCTAPE_ENABLED is not set', () => {
      vi.stubEnv('NODE_ENV', 'test');
      delete process.env.RSCTAPE_ENABLED;

      const before = httpModule.createServer;
      register();
      expect(httpModule.createServer).toBe(before);
    });

    it('patches http.createServer when NODE_ENV=development', () => {
      vi.stubEnv('NODE_ENV', 'development');

      const before = httpModule.createServer;
      register();
      expect(httpModule.createServer).not.toBe(before);
    });

    it('patches http.createServer when RSCTAPE_ENABLED=true regardless of NODE_ENV', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('RSCTAPE_ENABLED', 'true');

      const before = httpModule.createServer;
      register();
      expect(httpModule.createServer).not.toBe(before);
    });

    it('does not double-register on multiple calls', () => {
      vi.stubEnv('NODE_ENV', 'development');

      register();
      const afterFirst = httpModule.createServer;
      register();
      expect(httpModule.createServer).toBe(afterFirst);
    });
  });

  describe('request interception', () => {
    let server: http.Server;

    afterEach(() => {
      if (server) {
        server.close();
      }
    });

    function setupInterceptor() {
      vi.stubEnv('NODE_ENV', 'development');
      register({ fixtureDir: '/tmp/test-fixtures-interceptor', verbose: false });
    }

    function createTestServer(handler: http.RequestListener): Promise<number> {
      return new Promise((resolve) => {
        server = httpModule.createServer(handler);
        server.listen(0, () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
      });
    }

    function makeRequest(
      port: number,
      headers: Record<string, string>,
      body?: string,
    ): Promise<{ statusCode: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, method: 'POST', path: '/', headers },
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
        if (body) req.write(body);
        req.end();
      });
    }

    it('ignores requests without Next-Action header', async () => {
      const handlerSpy = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });

      setupInterceptor();
      const port = await createTestServer(handlerSpy);
      const result = await makeRequest(port, { 'content-type': 'text/plain' }, 'hello');

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('ok');
      expect(handlerSpy).toHaveBeenCalledOnce();
    });

    it('captures requests with Next-Action header without modifying response', async () => {
      const responsePayload = '0:{"result":"success"}\n';
      const handlerSpy = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/x-component' });
        res.end(responsePayload);
      });

      setupInterceptor();
      const port = await createTestServer(handlerSpy);
      const result = await makeRequest(
        port,
        { 'next-action': 'test-action-123', 'content-type': 'text/plain' },
        'test body',
      );

      // Response should be unchanged (Req 1.10)
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe(responsePayload);
      expect(handlerSpy).toHaveBeenCalledOnce();
    });

    it('preserves chunked response data', async () => {
      const chunk1 = '0:{"part":"one"}\n';
      const chunk2 = '1:{"part":"two"}\n';

      const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/x-component' });
        res.write(chunk1);
        res.write(chunk2);
        res.end();
      };

      setupInterceptor();
      const port = await createTestServer(handler);
      const result = await makeRequest(
        port,
        { 'next-action': 'chunked-action', 'content-type': 'text/plain' },
        'data',
      );

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe(chunk1 + chunk2);
    });

    it('does not modify request data passed to original handler', async () => {
      let receivedBody = '';

      const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          receivedBody = Buffer.concat(chunks).toString();
          res.writeHead(200);
          res.end('done');
        });
      };

      setupInterceptor();
      const port = await createTestServer(handler);
      const sentBody = 'original-request-body';
      await makeRequest(
        port,
        { 'next-action': 'body-test', 'content-type': 'text/plain' },
        sentBody,
      );

      expect(receivedBody).toBe(sentBody);
    });
  });
});
