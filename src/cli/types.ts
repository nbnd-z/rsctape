import type { Command } from 'commander';
import { inferType, toPascalCase } from 'api-tape';
import { loadFixture, listFixtures } from '../fixture-store.js';
import { loadConfig } from '../config.js';

// Re-export for testing
export { toPascalCase, inferType };

/**
 * Generate a TypeScript interface from an object.
 * Uses api-tape's inferType for individual field types.
 */
export function generateTypeScript(name: string, obj: Record<string, unknown>): string {
  const lines = [`export interface ${name} {`];
  for (const [key, value] of Object.entries(obj)) {
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`;
    lines.push(`  ${safeKey}: ${inferType(value)};`);
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * Generate a JSDoc typedef from an object.
 * Uses api-tape's inferType for individual field types.
 */
export function generateJSDoc(name: string, obj: Record<string, unknown>): string {
  const lines = ['/**', ` * @typedef {Object} ${name}`];
  for (const [key, value] of Object.entries(obj)) {
    lines.push(` * @property {${inferType(value)}} ${key}`);
  }
  lines.push(' */');
  return lines.join('\n');
}

/**
 * Generate a TypeScript tuple type from a programmatic invocation's args array.
 */
export function generateArgsType(name: string, args: unknown[]): string {
  const types = args.map((a) => inferType(a));
  return `export type ${name} = [${types.join(', ')}];`;
}

/**
 * Generate a JSDoc tuple type from a programmatic invocation's args array.
 */
export function generateArgsJSDoc(name: string, args: unknown[]): string {
  const types = args.map((a) => inferType(a));
  return `/** @typedef {[${types.join(', ')}]} ${name} */`;
}

/**
 * Generate type output for a single fixture, choosing between
 * interface (form invocation) and tuple (programmatic invocation).
 */
function generateTypeForFixture(
  typeName: string,
  loaded: { fixture: { input: Record<string, unknown> }; meta: { formDataMetadata?: { invocationType?: string; args?: unknown[] } } },
  jsdoc: boolean,
): string {
  const meta = loaded.meta.formDataMetadata;
  if (meta?.invocationType === 'programmatic' && meta.args && meta.args.length > 0) {
    return jsdoc
      ? generateArgsJSDoc(typeName, meta.args)
      : generateArgsType(typeName, meta.args);
  }
  return jsdoc
    ? generateJSDoc(typeName, loaded.fixture.input)
    : generateTypeScript(typeName, loaded.fixture.input);
}

export function typesCommand(program: Command): void {
  program
    .command('types [actionId]')
    .description('Generate type definitions from fixture input')
    .option('-d, --dir <path>', 'Fixture directory')
    .option('--jsdoc', 'Generate JSDoc typedef instead of TypeScript interface')
    .action(async (actionId: string | undefined, options) => {
      const config = await loadConfig();
      const fixtureDir = options.dir ?? config.fixtureDir;

      if (actionId) {
        const loaded = await loadFixture(fixtureDir, actionId);
        if (!loaded) {
          console.error(`Fixture not found: ${actionId}`);
          process.exit(1);
        }
        const typeName = toPascalCase(actionId) + 'Input';
        console.log(generateTypeForFixture(typeName, loaded, !!options.jsdoc));
      } else {
        const fixtures = await listFixtures(fixtureDir);
        for (const { actionId: id } of fixtures) {
          const loaded = await loadFixture(fixtureDir, id);
          if (!loaded) continue;
          const typeName = toPascalCase(id) + 'Input';
          console.log(generateTypeForFixture(typeName, loaded, !!options.jsdoc));
          console.log('');
        }
      }
    });
}
