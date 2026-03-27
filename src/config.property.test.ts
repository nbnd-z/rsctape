import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, ConfigError } from './config';

function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsctape-prop-'));
  return fn(dir).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

/**
 * Property P11: Config Fault Tolerance (設定檔容錯性)
 * Validates: Requirements 6.1, 6.2, 6.3, 6.5
 */
describe('P11: Config Fault Tolerance', () => {
  /**
   * **Validates: Requirements 6.1, 6.2**
   * When config file doesn't exist, loadConfig always returns default values.
   */
  it('returns default values when config file does not exist', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        await withTmpDir(async (dir) => {
          const config = await loadConfig(dir);
          expect(config.fixtureDir).toBe('./fixtures/actions');
          expect(config.ignore).toEqual([]);
        });
      }),
      { numRuns: 10 }
    );
  });

  /**
   * **Validates: Requirements 6.1, 6.3**
   * When config file contains valid fixtureDir and valid ignore,
   * loadConfig returns those values.
   */
  it('returns provided values for valid fixtureDir and ignore', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.array(fc.string({ minLength: 1 })),
        async (fixtureDir, ignore) => {
          await withTmpDir(async (dir) => {
            fs.writeFileSync(
              path.join(dir, 'rsctape.config.json'),
              JSON.stringify({ fixtureDir, ignore })
            );
            const config = await loadConfig(dir);
            expect(config.fixtureDir).toBe(fixtureDir);
            expect(config.ignore).toEqual(ignore);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.5**
   * When fixtureDir is not a string, loadConfig throws ConfigError.
   */
  it('throws ConfigError when fixtureDir is not a string', async () => {
    const nonStringArb = fc.oneof(
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.anything()),
      fc.dictionary(fc.string(), fc.anything())
    );

    await fc.assert(
      fc.asyncProperty(nonStringArb, async (invalidFixtureDir) => {
        await withTmpDir(async (dir) => {
          fs.writeFileSync(
            path.join(dir, 'rsctape.config.json'),
            JSON.stringify({ fixtureDir: invalidFixtureDir })
          );
          await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
        });
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.5**
   * When ignore is not an array, loadConfig throws ConfigError.
   */
  it('throws ConfigError when ignore is not an array', async () => {
    const nonArrayArb = fc.oneof(
      fc.integer(),
      fc.boolean(),
      fc.string(),
      fc.constant(null),
      fc.dictionary(fc.string(), fc.anything())
    );

    await fc.assert(
      fc.asyncProperty(nonArrayArb, async (invalidIgnore) => {
        await withTmpDir(async (dir) => {
          fs.writeFileSync(
            path.join(dir, 'rsctape.config.json'),
            JSON.stringify({ ignore: invalidIgnore })
          );
          await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
        });
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.5**
   * When ignore contains non-string elements, loadConfig throws ConfigError.
   */
  it('throws ConfigError when ignore contains non-string elements', async () => {
    const nonStringArb = fc.oneof(
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.anything()),
      fc.dictionary(fc.string(), fc.anything())
    );

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string(), { minLength: 0, maxLength: 3 }),
        nonStringArb,
        fc.array(fc.string(), { minLength: 0, maxLength: 3 }),
        async (prefix, badElement, suffix) => {
          await withTmpDir(async (dir) => {
            const ignore = [...prefix, badElement, ...suffix];
            fs.writeFileSync(
              path.join(dir, 'rsctape.config.json'),
              JSON.stringify({ ignore })
            );
            await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.5**
   * When config file contains invalid JSON, loadConfig throws ConfigError.
   */
  it('throws ConfigError for invalid JSON content', async () => {
    const invalidJsonArb = fc.oneof(
      fc.constant('{bad json'),
      fc.constant('{{}}'),
      fc.constant('{key: value}'),
      fc.constant("{'key': 'value'}"),
      fc.constant('{,}'),
      fc.string({ minLength: 1 }).filter((s) => {
        try {
          JSON.parse(s);
          return false;
        } catch {
          return true;
        }
      })
    );

    await fc.assert(
      fc.asyncProperty(invalidJsonArb, async (invalidJson) => {
        await withTmpDir(async (dir) => {
          fs.writeFileSync(
            path.join(dir, 'rsctape.config.json'),
            invalidJson
          );
          await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
        });
      }),
      { numRuns: 100 }
    );
  });
});
