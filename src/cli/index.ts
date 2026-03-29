#!/usr/bin/env node
import { Command } from 'commander';
import { listCommand } from './list.js';
import { mockCommand } from './mock.js';
import { diffCommand } from './diff.js';
import { deleteCommand } from './delete.js';
import { typesCommand } from './types.js';
import { initCommand } from './init.js';

const program = new Command();

program
  .name('rsctape')
  .description('Intercept React Server Actions and generate MSW mock handlers')
  .version('0.1.0');

// Register subcommands
listCommand(program);
mockCommand(program);
diffCommand(program);
deleteCommand(program);
typesCommand(program);
initCommand(program);

program.parse();
