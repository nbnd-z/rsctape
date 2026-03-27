/* eslint-disable @typescript-eslint/no-var-requires */
import { PassThrough } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';
import type { InterceptorOptions, Fixture, FixtureMeta } from './types';
import { parseFormData } from './formdata-parser';
import { saveFixture } from './fixture-store';
import { loadConfig } from './config';
import { detectFramework } from './framework-detect';

// Use require to get the mutable CJS module object.
// ESM `import * as http` produces a frozen namespace that cannot be patched.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule = require('http') as typeof import('http');

const PREFIX = '[rsc-tape]';

let registered = false;
let _originalCreateServer: typeof httpModule.createServer | null = null;

/**
 * Register the HTTP interceptor by monkey-patching http.createServer.
 * Only activates when NODE_ENV=development or RSCTAPE_ENABLED=true.
 */
export function register(options?: Partial<InterceptorOptions>): void {
  // Environment gate (Req 1.12, 10.1, 10.2)
  const nodeEnv = process.env.NODE_ENV;
  const enabled = process.env.RSCTAPE_ENABLED;
  if (nodeEnv !== 'development' && enabled !== 'true') {
    return;
  }

  // Prevent double-registration
  if (registered) {
    return;
  }
  registered = true;

  const verbose = options?.verbose ?? process.env.RSCTAPE_VERBOSE === 'true';
  const fixtureDir = options?.fixtureDir ?? './fixtures/actions';
  const ignore = options?.ignore ?? [];

  // Load config asynchronously in background, merge with options
  let resolvedFixtureDir = fixtureDir;
  let resolvedIgnore = ignore;

  loadConfig().then((config) => {
    if (!options?.fixtureDir) resolvedFixtureDir = config.fixtureDir;
    if (!options?.ignore) resolvedIgnore = config.ignore;
  }).catch(() => {
    // Config load failure is non-fatal, use defaults
  });

  // Detect framework and log startup (Req 10.4, 10.5)
  detectFramework().then((framework) => {
    console.log(`${PREFIX} Recording server actions...`);
    console.log(`${PREFIX} Detected framework: ${framework}`);
  }).catch(() => {
    console.log(`${PREFIX} Recording server actions...`);
  });

  // Monkey-patch http.createServer (Req 1.5, 1.7, 1.13)
  _originalCreateServer = httpModule.createServer;
  const originalCreateServer = _originalCreateServer;

  httpModule.createServer = function patchedCreateServer(...args: any[]): any {
    // Find the request handler — it's the last function argument
    const handlerIndex = args.findIndex((a: unknown) => typeof a === 'function');

    if (handlerIndex === -1) {
      return originalCreateServer.apply(httpModule, args as any);
    }

    const originalHandler = args[handlerIndex] as (
      req: IncomingMessage,
      res: ServerResponse,
    ) => void;

    const wrappedHandler = (req: IncomingMessage, res: ServerResponse) => {
      try {
        interceptRequest(req, res, originalHandler, {
          verbose,
          fixtureDir: resolvedFixtureDir,
          ignore: resolvedIgnore,
        });
      } catch (err) {
        // Error isolation (Req 1.4): never break the original handler
        console.error(`${PREFIX} Interceptor error:`, err);
        originalHandler(req, res);
      }
    };

    const newArgs = [...args];
    newArgs[handlerIndex] = wrappedHandler;
    return originalCreateServer.apply(httpModule, newArgs as any);
  } as any;
}

function shouldIgnore(actionId: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Escape regex special chars, then convert glob * to .*
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
    if (regex.test(actionId)) return true;
  }
  return false;
}

function interceptRequest(
  req: IncomingMessage,
  res: ServerResponse,
  originalHandler: (req: IncomingMessage, res: ServerResponse) => void,
  opts: { verbose: boolean; fixtureDir: string; ignore: string[] },
): void {
  const actionId = req.headers['next-action'];

  // Not a Server Action — pass through (Req 1.2)
  if (!actionId || typeof actionId !== 'string') {
    originalHandler(req, res);
    return;
  }

  // Check ignore patterns
  if (shouldIgnore(actionId, opts.ignore)) {
    originalHandler(req, res);
    return;
  }

  // Clone and buffer request body via PassThrough (Req 1.6)
  const bodyChunks: Buffer[] = [];
  const passThrough = new PassThrough();

  req.pipe(passThrough);
  passThrough.on('data', (chunk: Buffer) => {
    bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  // Wrap res.write() and res.end() to collect response chunks (Req 1.8, 1.9)
  const responseChunks: Buffer[] = [];
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.write = function interceptedWrite(
    chunk: any,
    encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void),
    callback?: (error: Error | null | undefined) => void,
  ): boolean {
    try {
      if (chunk != null) {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined);
        responseChunks.push(buf);
      }
    } catch (err) {
      console.error(`${PREFIX} Error buffering response chunk:`, err);
    }
    return originalWrite(chunk, encodingOrCallback as any, callback as any);
  } as any;

  res.end = function interceptedEnd(
    chunk?: any,
    encodingOrCallback?: BufferEncoding | (() => void),
    callback?: () => void,
  ): ServerResponse {
    try {
      if (chunk != null) {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined);
        responseChunks.push(buf);
      }
    } catch (err) {
      console.error(`${PREFIX} Error buffering final response chunk:`, err);
    }

    const result = originalEnd(chunk, encodingOrCallback as any, callback as any);

    // Async fixture write — don't block response (Req 1.11)
    // Note: bodyChunks may still be accumulating from the PassThrough stream.
    // We use setImmediate to give the event loop a tick for the PassThrough
    // to finish flushing before we process the capture.
    setImmediate(() => {
      processCapture(actionId, req, res, bodyChunks, responseChunks, opts).catch((err) => {
        console.error(`${PREFIX} Error saving fixture:`, err);
      });
    });

    return result;
  } as any;

  // Forward to original handler with original req (Req 1.7, 1.10)
  originalHandler(req, res);
}

async function processCapture(
  actionId: string,
  req: IncomingMessage,
  res: ServerResponse,
  bodyChunks: Buffer[],
  responseChunks: Buffer[],
  opts: { verbose: boolean; fixtureDir: string; ignore: string[] },
): Promise<void> {
  const requestBody = Buffer.concat(bodyChunks);
  const responseBody = Buffer.concat(responseChunks);
  const contentType = req.headers['content-type'] ?? '';
  const statusCode = res.statusCode;
  const timestamp = new Date().toISOString();

  // Parse FormData from request body
  let parsedInput: Record<string, unknown>;
  let formDataMetadata;
  try {
    const parsed = await parseFormData(requestBody, contentType);
    parsedInput = parsed.fields;
    formDataMetadata = parsed.metadata;
  } catch {
    parsedInput = { raw: requestBody.toString() };
  }

  const fixture: Fixture = {
    input: parsedInput,
    output: responseBody.toString(),
  };

  const meta: FixtureMeta = {
    actionId,
    url: req.url ?? '/',
    method: req.method ?? 'POST',
    statusCode,
    contentType: res.getHeader('content-type')?.toString() ?? 'text/x-component',
    timestamp,
    error: statusCode >= 500 ? true : undefined,
    formDataMetadata,
  };

  // Save fixture to disk (Req 1.3, 1.11)
  await saveFixture(opts.fixtureDir, actionId, fixture, meta);

  // Verbose logging (Req 10.6)
  if (opts.verbose) {
    console.log(`${PREFIX} Captured action: ${actionId} [${statusCode}]`);
  }
}

/**
 * Reset the interceptor state (for testing purposes).
 * Restores original http.createServer if it was patched.
 */
export function _resetForTesting(): void {
  if (_originalCreateServer) {
    httpModule.createServer = _originalCreateServer as any;
    _originalCreateServer = null;
  }
  registered = false;
}
