import type { Command } from 'commander';
import { listFixtures } from '../fixture-store';
import { loadConfig } from '../config';

export function listCommand(program: Command): void {
  program
    .command('list')
    .description('List all captured Server Action fixtures')
    .option('-d, --dir <path>', 'Fixture directory')
    .action(async (options) => {
      const config = await loadConfig();
      const fixtureDir = options.dir ?? config.fixtureDir;
      const fixtures = await listFixtures(fixtureDir);

      if (fixtures.length === 0) {
        console.log('No fixtures found.');
        return;
      }

      console.log(`Found ${fixtures.length} fixture(s):\n`);
      for (const { actionId, meta } of fixtures) {
        console.log(`  ${actionId}`);
        console.log(`    Status: ${meta.statusCode} | Captured: ${meta.timestamp}`);
      }
    });
}
