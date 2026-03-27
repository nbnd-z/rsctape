import * as fs from 'fs';
import * as path from 'path';
import { ConfigError } from 'api-tape';
import type { RscTapeConfig } from './types';

export { ConfigError };

const DEFAULT_CONFIG: RscTapeConfig = {
  fixtureDir: './fixtures/actions',
  ignore: [],
};

/**
 * Load configuration from rsctape.config.json (async).
 * Falls back to defaults when the file does not exist.
 * Throws ConfigError for invalid values.
 */
export async function loadConfig(projectRoot?: string): Promise<RscTapeConfig> {
  const root = projectRoot ?? process.cwd();
  const configPath = path.join(root, 'rsctape.config.json');

  let raw: string;
  try {
    raw = await fs.promises.readFile(configPath, 'utf-8');
  } catch {
    return { ...DEFAULT_CONFIG, ignore: [...DEFAULT_CONFIG.ignore] };
  }

  return parseConfig(raw, configPath);
}

/**
 * Load configuration synchronously.
 * Used by the interceptor to avoid race conditions.
 */
export function loadConfigSync(projectRoot?: string): RscTapeConfig {
  const root = projectRoot ?? process.cwd();
  const configPath = path.join(root, 'rsctape.config.json');

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return { ...DEFAULT_CONFIG, ignore: [...DEFAULT_CONFIG.ignore] };
  }

  return parseConfig(raw, configPath);
}

function parseConfig(raw: string, configPath: string): RscTapeConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`Invalid JSON in config file: ${configPath}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`Config file must be a JSON object: ${configPath}`);
  }

  const obj = parsed as Record<string, unknown>;

  if ('fixtureDir' in obj && typeof obj.fixtureDir !== 'string') {
    throw new ConfigError(
      `Invalid config: "fixtureDir" must be a string, got ${typeof obj.fixtureDir}`
    );
  }

  if ('ignore' in obj) {
    if (!Array.isArray(obj.ignore)) {
      throw new ConfigError(
        `Invalid config: "ignore" must be an array, got ${typeof obj.ignore}`
      );
    }
    for (let i = 0; i < obj.ignore.length; i++) {
      if (typeof obj.ignore[i] !== 'string') {
        throw new ConfigError(
          `Invalid config: "ignore[${i}]" must be a string, got ${typeof obj.ignore[i]}`
        );
      }
    }
  }

  return {
    fixtureDir: typeof obj.fixtureDir === 'string' ? obj.fixtureDir : DEFAULT_CONFIG.fixtureDir,
    ignore: Array.isArray(obj.ignore) ? (obj.ignore as string[]) : [...DEFAULT_CONFIG.ignore],
  };
}
