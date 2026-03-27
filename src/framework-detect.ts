import * as fs from 'fs';
import * as path from 'path';
import type { FrameworkType } from './types';

/**
 * Detect the RSC framework used in the project by inspecting
 * package.json dependencies and characteristic config files.
 */
export async function detectFramework(projectRoot?: string): Promise<FrameworkType> {
  const root = projectRoot ?? process.cwd();

  // Check package.json dependencies
  const detected = detectFromPackageJson(root);
  if (detected !== 'unknown') return detected;

  // Fall back to characteristic files
  return detectFromFiles(root);
}

function detectFromPackageJson(root: string): FrameworkType {
  const pkgPath = path.join(root, 'package.json');
  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, 'utf-8');
  } catch {
    return 'unknown';
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return 'unknown';
  }

  const deps = {
    ...(typeof pkg.dependencies === 'object' && pkg.dependencies !== null ? pkg.dependencies as Record<string, string> : {}),
    ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null ? pkg.devDependencies as Record<string, string> : {}),
  };

  const depNames = Object.keys(deps);

  if (depNames.includes('next')) return 'next';
  if (depNames.includes('waku')) return 'waku';
  if (depNames.includes('parcel') || depNames.some(d => d.startsWith('@parcel/'))) return 'parcel';

  return 'unknown';
}

function detectFromFiles(root: string): FrameworkType {
  const nextConfigs = ['next.config.js', 'next.config.ts', 'next.config.mjs'];
  for (const name of nextConfigs) {
    if (fileExists(path.join(root, name))) return 'next';
  }

  if (fileExists(path.join(root, 'waku.config.ts'))) return 'waku';

  return 'unknown';
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect framework from FormData key name patterns.
 */
export function detectFrameworkFromFormData(keys: string[]): FrameworkType {
  for (const key of keys) {
    if (key.startsWith('$ACTION_ID_') || key.startsWith('$ACTION_REF_')) {
      return 'next';
    }
    // Numbered prefix variant: e.g. 1_$ACTION_ID_xxx
    if (/^\d+_\$ACTION_ID_/.test(key) || /^\d+_\$ACTION_REF_/.test(key)) {
      return 'next';
    }
  }

  // Waku-specific patterns can be added here when known
  // For now, no Waku-specific FormData patterns are documented

  return 'unknown';
}
