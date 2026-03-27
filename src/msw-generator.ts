import * as fs from 'fs';
import * as path from 'path';
import type { Fixture, GenerateOptions } from './types';
import { listFixtures, loadFixture } from './fixture-store';

/**
 * Convert an action ID to a valid JavaScript identifier.
 * Replaces non-alphanumeric characters with underscores,
 * and prefixes with underscore if it starts with a digit.
 */
function toIdentifier(actionId: string): string {
  let id = actionId.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^\d/.test(id)) id = '_' + id;
  return id;
}

/**
 * Escape a string for use inside a JavaScript template literal (backtick string).
 * Escapes backticks, dollar signs (to prevent interpolation), and backslashes.
 */
function escapeTemplateLiteral(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

/**
 * Generate MSW handler code for a single fixture that matches
 * the `Next-Action` header value against the given actionId.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.6
 */
export function generateSingleHandler(actionId: string, fixture: Fixture): string {
  const sanitized = toIdentifier(actionId);
  const escaped = escapeTemplateLiteral(fixture.output);
  const escapedId = actionId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const lines = [
    `/** Handler for action: ${actionId} */`,
    `export const handle_${sanitized} = http.post('*', ({ request }) => {`,
    `  if (request.headers.get('Next-Action') !== '${escapedId}') return;`,
    `  return new HttpResponse(\`${escaped}\`, {`,
    `    headers: { 'Content-Type': 'text/x-component' },`,
    `  });`,
    `});`,
  ];

  return lines.join('\n');
}

/**
 * Generate a combined MSW handlers module from fixtures on disk.
 *
 * 1. Lists fixtures from fixtureDir (optionally filtered by actionIds)
 * 2. Loads each fixture
 * 3. Generates a handler for each
 * 4. Combines into a module with import, handlers, and export array
 * 5. Writes to outputPath if provided, or returns the code string
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 9.6
 */
export async function generateHandlers(options: GenerateOptions): Promise<string> {
  const { fixtureDir, outputPath, actionIds } = options;

  let entries = await listFixtures(fixtureDir);

  if (actionIds && actionIds.length > 0) {
    const filterSet = new Set(actionIds);
    entries = entries.filter((e) => filterSet.has(e.actionId));
  }

  const handlerSnippets: string[] = [];
  const handlerNames: string[] = [];

  for (const entry of entries) {
    const loaded = await loadFixture(fixtureDir, entry.actionId);
    if (!loaded) continue;

    const name = `handle_${toIdentifier(entry.actionId)}`;
    handlerNames.push(name);
    handlerSnippets.push(generateSingleHandler(entry.actionId, loaded.fixture));
  }

  const parts: string[] = [
    `import { http, HttpResponse } from 'msw';`,
    '',
    ...handlerSnippets,
    '',
    `export const handlers = [${handlerNames.join(', ')}];`,
    '',
  ];

  const code = parts.join('\n');

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (dir && dir !== '.') {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    await fs.promises.writeFile(outputPath, code, 'utf-8');
  }

  return code;
}
