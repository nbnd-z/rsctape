import type { Command } from 'commander';
import { diffObjects, formatDiffResult, hashValue } from 'api-tape';
import { loadFixture } from '../fixture-store';
import { loadConfig } from '../config';

export function diffCommand(program: Command): void {
  program
    .command('diff <actionId1> <actionId2>')
    .description('Compare two fixtures by action ID (useful after HMR changes action IDs)')
    .option('-d, --dir <path>', 'Fixture directory')
    .option('--full', 'Include line-by-line output diff (RSC Payload)')
    .action(async (actionId1: string, actionId2: string, options) => {
      const config = await loadConfig();
      const fixtureDir = options.dir ?? config.fixtureDir;

      const fixture1 = await loadFixture(fixtureDir, actionId1);
      const fixture2 = await loadFixture(fixtureDir, actionId2);

      if (!fixture1 || !fixture2) {
        console.error('One or both fixtures not found.');
        process.exit(1);
      }

      // Input diff — structured comparison
      console.log('=== Input Diff ===');
      const inputA = fixture1.fixture.input as Record<string, unknown>;
      const inputB = fixture2.fixture.input as Record<string, unknown>;
      const diff = diffObjects(inputA, inputB);
      console.log(formatDiffResult(diff));

      // Output comparison
      console.log('\n=== Output ===');
      const hash1 = hashValue(fixture1.fixture.output);
      const hash2 = hashValue(fixture2.fixture.output);
      if (hash1 === hash2) {
        console.log('Output: unchanged');
      } else if (options.full) {
        console.log('Output: changed');
        const lines1 = fixture1.fixture.output.split('\n');
        const lines2 = fixture2.fixture.output.split('\n');
        const maxLen = Math.max(lines1.length, lines2.length);
        for (let i = 0; i < maxLen; i++) {
          const l1 = lines1[i];
          const l2 = lines2[i];
          if (l1 === undefined) {
            console.log(`+ ${l2}`);
          } else if (l2 === undefined) {
            console.log(`- ${l1}`);
          } else if (l1 !== l2) {
            console.log(`- ${l1}`);
            console.log(`+ ${l2}`);
          }
        }
      } else {
        console.log('Output: changed (use --full for line-by-line diff)');
      }
    });
}

// Re-export for testing
export { hashValue, diffObjects, formatDiffResult };
