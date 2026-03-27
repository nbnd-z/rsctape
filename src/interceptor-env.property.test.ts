import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { register, _resetForTesting } from './interceptor';

// Use require to get the same mutable CJS module the interceptor patches
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule = require('http') as typeof import('http');

/**
 * Arbitrary: random NODE_ENV values that are NOT 'development'.
 * Generates alphanumeric strings and filters out 'development'.
 */
const nonDevelopmentNodeEnvArb = fc
  .oneof(
    fc.constantFrom('production', 'test', 'staging', 'ci', ''),
    fc.string({ minLength: 0, maxLength: 30 }),
  )
  .filter((v) => v !== 'development');

/**
 * Arbitrary: random RSCTAPE_ENABLED values that are NOT 'true'.
 * Generates various strings and filters out 'true'.
 */
const nonTrueEnabledArb = fc
  .oneof(
    fc.constantFrom('false', '0', 'yes', 'TRUE', 'True', '1', ''),
    fc.string({ minLength: 0, maxLength: 20 }),
  )
  .filter((v) => v !== 'true');

/**
 * Arbitrary: any random NODE_ENV value (including 'development' and others).
 */
const anyNodeEnvArb = fc.oneof(
  fc.constantFrom('production', 'test', 'staging', 'development', ''),
  fc.string({ minLength: 0, maxLength: 30 }),
);

/**
 * Property P9: Environment Safety (環境安全性)
 * Validates: Requirements 1.12, 10.1, 10.2
 *
 * When NODE_ENV is not 'development' AND RSCTAPE_ENABLED is not 'true',
 * register() must NOT modify http.createServer.
 * When NODE_ENV IS 'development' OR RSCTAPE_ENABLED IS 'true',
 * register() MUST patch http.createServer.
 */
describe('P9: Environment Safety', () => {
  afterEach(() => {
    _resetForTesting();
    vi.unstubAllEnvs();
  });

  /**
   * **Validates: Requirements 1.12, 10.1**
   * For any NODE_ENV value that is NOT 'development' and any RSCTAPE_ENABLED
   * value that is NOT 'true', calling register() should NOT modify
   * http.createServer — the function reference must remain identical.
   */
  it('register() does NOT patch when NODE_ENV !== "development" and RSCTAPE_ENABLED !== "true"', () => {
    fc.assert(
      fc.property(nonDevelopmentNodeEnvArb, nonTrueEnabledArb, (nodeEnv, enabled) => {
        _resetForTesting();
        vi.unstubAllEnvs();

        vi.stubEnv('NODE_ENV', nodeEnv);
        vi.stubEnv('RSCTAPE_ENABLED', enabled);

        const before = httpModule.createServer;
        register();
        expect(httpModule.createServer).toBe(before);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 10.2**
   * When NODE_ENV is 'development', register() MUST patch http.createServer
   * regardless of the value of RSCTAPE_ENABLED.
   */
  it('register() DOES patch when NODE_ENV is "development"', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom('true', 'false', '0', '1', ''), fc.string({ minLength: 0, maxLength: 20 })),
        (enabled) => {
          _resetForTesting();
          vi.unstubAllEnvs();

          vi.stubEnv('NODE_ENV', 'development');
          vi.stubEnv('RSCTAPE_ENABLED', enabled);

          const before = httpModule.createServer;
          register();
          expect(httpModule.createServer).not.toBe(before);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 10.2**
   * When RSCTAPE_ENABLED is 'true', register() MUST patch http.createServer
   * regardless of the value of NODE_ENV.
   */
  it('register() DOES patch when RSCTAPE_ENABLED is "true"', () => {
    fc.assert(
      fc.property(anyNodeEnvArb, (nodeEnv) => {
        _resetForTesting();
        vi.unstubAllEnvs();

        vi.stubEnv('NODE_ENV', nodeEnv);
        vi.stubEnv('RSCTAPE_ENABLED', 'true');

        const before = httpModule.createServer;
        register();
        expect(httpModule.createServer).not.toBe(before);
      }),
      { numRuns: 50 },
    );
  });
});
