declare module 'api-tape' {
  export class ApitapeError extends Error {}
  export class ConfigError extends Error {}
  export class FixtureNotFoundError extends Error {}

  export function sanitizeName(name: string): string;
  export function toPascalCase(str: string): string;
  export function hashValue(value: unknown): string;

  interface DiffChange {
    path: string;
    type: string;
    oldValue?: unknown;
    newValue?: unknown;
  }

  interface DiffResult {
    added: DiffChange[];
    removed: DiffChange[];
    typeChanged: DiffChange[];
    valueChanged: DiffChange[];
    status: 'fresh' | 'drifted';
  }

  export function diffObjects(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
  ): DiffResult;

  export function formatDiffResult(diff: DiffResult): string;

  export function inferType(value: unknown): string;
  export function generateTypeScript(name: string, obj: Record<string, unknown>): string;
  export function generateJSDoc(name: string, obj: Record<string, unknown>): string;

  export function pAll<T>(
    tasks: Array<() => Promise<T>>,
    concurrency?: number,
  ): Promise<T[]>;
}
