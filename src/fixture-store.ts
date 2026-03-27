import * as fs from 'fs';
import * as path from 'path';
import { sanitizeName as apiTapeSanitize } from 'api-tape';
import type { Fixture, FixtureMeta } from './types';

/**
 * Sanitize a string for use as a filename.
 * Wraps api-tape's sanitizeName with empty-string fallback.
 */
export function sanitizeName(name: string): string {
  if (!name || name.trim().length === 0) return '_unnamed';
  try {
    return apiTapeSanitize(name);
  } catch {
    return '_unnamed';
  }
}

/**
 * Save fixture data and metadata to disk as .json and .meta.json files.
 * Creates the fixture directory recursively if it doesn't exist.
 * Overwrites existing files when the same actionId is saved again.
 */
export async function saveFixture(
  fixtureDir: string,
  actionId: string,
  fixture: Fixture,
  meta: FixtureMeta
): Promise<void> {
  await fs.promises.mkdir(fixtureDir, { recursive: true });
  const baseName = sanitizeName(actionId);
  const dataPath = path.join(fixtureDir, `${baseName}.json`);
  const metaPath = path.join(fixtureDir, `${baseName}.meta.json`);

  // Write data first, then meta
  await fs.promises.writeFile(dataPath, JSON.stringify(fixture, null, 2), 'utf-8');
  await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Load a fixture by action ID. Returns null if the files don't exist.
 */
export async function loadFixture(
  fixtureDir: string,
  actionId: string
): Promise<{ fixture: Fixture; meta: FixtureMeta } | null> {
  const baseName = sanitizeName(actionId);
  const dataPath = path.join(fixtureDir, `${baseName}.json`);
  const metaPath = path.join(fixtureDir, `${baseName}.meta.json`);

  try {
    const [dataRaw, metaRaw] = await Promise.all([
      fs.promises.readFile(dataPath, 'utf-8'),
      fs.promises.readFile(metaPath, 'utf-8'),
    ]);
    return {
      fixture: JSON.parse(dataRaw) as Fixture,
      meta: JSON.parse(metaRaw) as FixtureMeta,
    };
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * List all saved fixtures by reading .meta.json files in the directory.
 */
export async function listFixtures(
  fixtureDir: string
): Promise<Array<{ actionId: string; meta: FixtureMeta }>> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(fixtureDir);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const metaFiles = entries.filter((f) => f.endsWith('.meta.json'));
  const results: Array<{ actionId: string; meta: FixtureMeta }> = [];

  for (const file of metaFiles) {
    const raw = await fs.promises.readFile(path.join(fixtureDir, file), 'utf-8');
    const meta = JSON.parse(raw) as FixtureMeta;
    results.push({ actionId: meta.actionId, meta });
  }

  return results;
}

/**
 * Delete a fixture and its metadata file.
 * Silently succeeds if the files don't exist.
 */
export async function deleteFixture(
  fixtureDir: string,
  actionId: string
): Promise<void> {
  const baseName = sanitizeName(actionId);
  const dataPath = path.join(fixtureDir, `${baseName}.json`);
  const metaPath = path.join(fixtureDir, `${baseName}.meta.json`);

  await Promise.all([
    fs.promises.unlink(dataPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    }),
    fs.promises.unlink(metaPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    }),
  ]);
}
