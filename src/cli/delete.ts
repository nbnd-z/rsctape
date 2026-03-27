import type { Command } from 'commander';
import { deleteFixture } from '../fixture-store';
import { loadConfig } from '../config';

export function deleteCommand(program: Command): void {
  program
    .command('delete <actionId>')
    .description('Delete a fixture by action ID')
    .option('-d, --dir <path>', 'Fixture directory')
    .action(async (actionId: string, options) => {
      const config = await loadConfig();
      const fixtureDir = options.dir ?? config.fixtureDir;
      await deleteFixture(fixtureDir, actionId);
      console.log(`Deleted fixture: ${actionId}`);
    });
}
