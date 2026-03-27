import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { register, _resetForTesting } from './interceptor';
import { loadFixture, listFixtures } from './fixture-store';
import { generateHandlers, generateSingleHandler } from './msw-generator';

// Use require to get the same mutable CJS module the interceptor patches
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule = require('http') as typeof import('http');

// ── helpers ──────────────────────────────────────────────────────────

const BOUNDARY = '----IntegrationTestBoundary';
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

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rsctape-integration-'));
}

function makeRequest(
  port: number,
  headers: Record<string, string>,
  body: Buffer | string,
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

// ── tests ────────────────────────────────────────────────────────────

describe('integration: full pipeline', () => {
  let server: http.Server | undefined;
  let tmpDir: string;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    _resetForTesting();
    vi.unstubAllEnvs();
    // Clean up temp dir
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  function createTestServer(handler: http.RequestListener): Promise<number> {
    return new Promise((resolve) => {
      server = httpModule.createServer(handler);
      server!.listen(0, () => {
        const addr = server!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
  }

  it('register → intercept → parse FormData → save fixture → generate MSW handler', async () => {
    tmpDir = makeTmpDir();
    vi.stubEnv('NODE_ENV', 'development');

    const actionId = 'test-action-full-pipeline';
    const rscPayload = '0:{"result":"success"}\n';

    register({ fixtureDir: tmpDir, verbose: false, ignore: [] });

    const handler = (_req: http.IncomingMessage, res: http.ServerResponse) => {
      const chunks: Buffer[] = [];
      _req.on('data', (c) => chunks.push(c));
      _req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/x-component' });
        res.end(rscPayload);
      });
    };

    const port = await createTestServer(handler);

    // Build a multipart FormData body with some fields
    const body = buildMultipart([
      { name: 'username', value: 'alice' },
      { name: 'age', value: '30' },
    ]);

    const result = await makeRequest(
      port,
      { 'next-action': actionId, 'content-type': CONTENT_TYPE },
      body,
    );

    // Verify response is correct (Req 1.7, 1.10 — transparency)
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(rscPayload);

    // Wait for async fixture write to complete
    await new Promise((r) => setTimeout(r, 500));

    // Load the fixture from disk and verify (Req 4.1)
    const loaded = await loadFixture(tmpDir, actionId);
    expect(loaded).not.toBeNull();

    // Input fields match the sent FormData (Req 2.1)
    expect(loaded!.fixture.input).toHaveProperty('username', 'alice');
    expect(loaded!.fixture.input).toHaveProperty('age', 30); // JSON-parsed

    // Output matches the response body
    expect(loaded!.fixture.output).toBe(rscPayload);

    // Meta has correct actionId, statusCode (Req 1.3)
    expect(loaded!.meta.actionId).toBe(actionId);
    expect(loaded!.meta.statusCode).toBe(200);
    expect(loaded!.meta.method).toBe('POST');

    // Generate MSW handler from the fixture (Req 5.1)
    const handlerCode = generateSingleHandler(actionId, loaded!.fixture);
    expect(handlerCode).toContain(actionId);
    expect(handlerCode).toContain('text/x-component');
    expect(handlerCode).toContain('http.post');
    expect(handlerCode).toContain('Next-Action');
  });

  it('handles multiple actions and generates combined handlers', async () => {
    tmpDir = makeTmpDir();
    vi.stubEnv('NODE_ENV', 'development');

    const actions = [
      { id: 'action-alpha', payload: '0:{"alpha":true}\n' },
      { id: 'action-beta', payload: '0:{"beta":true}\n' },
      { id: 'action-gamma', payload: '0:{"gamma":true}\n' },
    ];

    register({ fixtureDir: tmpDir, verbose: false, ignore: [] });

    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      const reqActionId = req.headers['next-action'] as string;
      const action = actions.find((a) => a.id === reqActionId);
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/x-component' });
        res.end(action?.payload ?? '');
      });
    };

    const port = await createTestServer(handler);

    // Send requests for each action
    for (const action of actions) {
      const body = buildMultipart([
        { name: 'action', value: action.id },
      ]);
      const result = await makeRequest(
        port,
        { 'next-action': action.id, 'content-type': CONTENT_TYPE },
        body,
      );
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe(action.payload);
    }

    // Wait for all async fixture writes
    await new Promise((r) => setTimeout(r, 800));

    // Verify all fixtures are saved
    const fixtures = await listFixtures(tmpDir);
    const savedIds = fixtures.map((f) => f.actionId).sort();
    expect(savedIds).toEqual(actions.map((a) => a.id).sort());

    // Generate combined handlers module
    const code = await generateHandlers({ fixtureDir: tmpDir, outputPath: '' });

    // Verify the combined handler module contains all action IDs
    for (const action of actions) {
      expect(code).toContain(action.id);
    }
    expect(code).toContain("import { http, HttpResponse } from 'msw'");
    expect(code).toContain('export const handlers');
  });
});
