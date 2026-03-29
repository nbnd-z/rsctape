import type { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { detectFramework } from '../framework-detect.js';

const CONFIG_TEMPLATE = JSON.stringify({ fixtureDir: './fixtures/actions', ignore: [] }, null, 2);

const NEXT_INSTRUMENTATION = `// instrumentation.ts
export async function register() {
  if (process.env.NODE_ENV === 'development') {
    const { register } = await import('rsc-tape');
    register();
  }
}
`;

const WAKU_ENTRY = `// Entry point for Waku
import { register } from 'rsc-tape';

if (process.env.NODE_ENV === 'development') {
  register();
}
`;

const GENERIC_SERVER = `// server.js - Add this to your server entry point
import { register } from 'rsc-tape';
register();
`;

export function initCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize rsc-tape configuration for your project')
    .action(async () => {
      const framework = await detectFramework();
      console.log(`Detected framework: ${framework}`);

      // Write config file
      const configPath = path.join(process.cwd(), 'rsctape.config.json');
      if (fs.existsSync(configPath)) {
        console.log('rsctape.config.json already exists, skipping.');
      } else {
        fs.writeFileSync(configPath, CONFIG_TEMPLATE);
        console.log('Created rsctape.config.json');
      }

      // Generate entry point based on framework
      let entryFile: string;
      let entryContent: string;

      switch (framework) {
        case 'next':
          entryFile = 'instrumentation.ts';
          entryContent = NEXT_INSTRUMENTATION;
          break;
        case 'waku':
          entryFile = 'waku-entry.ts';
          entryContent = WAKU_ENTRY;
          break;
        default:
          entryFile = 'server.js';
          entryContent = GENERIC_SERVER;
          break;
      }

      const entryPath = path.join(process.cwd(), entryFile);
      if (fs.existsSync(entryPath)) {
        console.log(`${entryFile} already exists. Please manually add the following:`);
        console.log(entryContent);
      } else {
        fs.writeFileSync(entryPath, entryContent);
        console.log(`Created ${entryFile}`);
      }
    });
}
