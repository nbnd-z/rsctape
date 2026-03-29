import * as fs from 'fs';
import type { Command } from 'commander';
import { generateHandlers } from '../msw-generator.js';
import { loadConfig } from '../config.js';

async function generate(fixtureDir: string, outputPath: string, actionIds?: string[]): Promise<void> {
  const code = await generateHandlers({
    fixtureDir,
    outputPath,
    actionIds,
  });

  if (outputPath) {
    console.log(`MSW handlers written to ${outputPath}`);
  } else {
    console.log(code);
  }
}

export function mockCommand(program: Command): void {
  program
    .command('mock')
    .description('Generate MSW handler files from captured fixtures')
    .option('-d, --dir <path>', 'Fixture directory')
    .option('-o, --output <path>', 'Output file path (omit to print to stdout)')
    .option('--actions <ids...>', 'Specific action IDs to generate')
    .option('-w, --watch', 'Watch fixture directory and regenerate on changes')
    .action(async (options) => {
      const config = await loadConfig();
      const fixtureDir = options.dir ?? config.fixtureDir;
      const outputPath = options.output ?? '';

      // Initial generation
      await generate(fixtureDir, outputPath, options.actions);

      if (options.watch) {
        if (!outputPath) {
          console.error('--watch requires --output to be specified');
          process.exit(1);
        }

        console.log(`Watching ${fixtureDir} for changes... (Ctrl+C to stop)`);

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        try {
          const watcher = fs.watch(fixtureDir, { recursive: false }, (_event, filename) => {
            if (!filename?.endsWith('.json')) return;

            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
              try {
                await generate(fixtureDir, outputPath, options.actions);
              } catch (err) {
                console.error('[rsc-tape] Error regenerating handlers:', err);
              }
            }, 300);
          });

          // Cleanup on process exit
          const cleanup = () => {
            watcher.close();
            if (debounceTimer) clearTimeout(debounceTimer);
          };
          process.on('SIGINT', () => { cleanup(); process.exit(0); });
          process.on('SIGTERM', () => { cleanup(); process.exit(0); });
        } catch (err) {
          console.error(`Cannot watch ${fixtureDir}:`, err);
          process.exit(1);
        }
      }
    });
}
