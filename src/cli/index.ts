#!/usr/bin/env node
import { Command } from 'commander';
import { listCommand } from './list';
import { mockCommand } from './mock';
import { diffCommand } from './diff';
import { deleteCommand } from './delete';
import { typesCommand } from './types';
import { initCommand } from './init';

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
