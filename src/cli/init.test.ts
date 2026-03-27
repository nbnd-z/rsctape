import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { initCommand } from './init';
import * as frameworkDetect from '../framework-detect';

vi.mock('fs');
vi.mock('../framework-detect');

describe('initCommand', () => {
  let program: Command;
  let logs: string[];
  const originalCwd = process.cwd;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    initCommand(program);
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    process.cwd = () => '/fake/project';
  });

  afterEach(() => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
  });

  it('creates config and instrumentation.ts for Next.js', async () => {
    vi.mocked(frameworkDetect.detectFramework).mockResolvedValue('next');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    await program.parseAsync(['node', 'rsctape', 'init']);

    expect(logs).toContain('Detected framework: next');
    expect(logs).toContain('Created rsctape.config.json');
    expect(logs).toContain('Created instrumentation.ts');

    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    expect(writeCalls).toHaveLength(2);

    // Config file
    expect(writeCalls[0][0]).toBe(path.join('/fake/project', 'rsctape.config.json'));
    const configContent = JSON.parse(writeCalls[0][1] as string);
    expect(configContent).toEqual({ fixtureDir: './fixtures/actions', ignore: [] });

    // Entry file
    expect(writeCalls[1][0]).toBe(path.join('/fake/project', 'instrumentation.ts'));
    expect(writeCalls[1][1]).toContain('instrumentation.ts');
    expect(writeCalls[1][1]).toContain("import('rsc-tape')");
  });

  it('creates config and waku-entry.ts for Waku', async () => {
    vi.mocked(frameworkDetect.detectFramework).mockResolvedValue('waku');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    await program.parseAsync(['node', 'rsctape', 'init']);

    expect(logs).toContain('Detected framework: waku');
    expect(logs).toContain('Created waku-entry.ts');

    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    expect(writeCalls[1][0]).toBe(path.join('/fake/project', 'waku-entry.ts'));
    expect(writeCalls[1][1]).toContain('Entry point for Waku');
  });

  it('creates config and server.js for unknown framework', async () => {
    vi.mocked(frameworkDetect.detectFramework).mockResolvedValue('unknown');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    await program.parseAsync(['node', 'rsctape', 'init']);

    expect(logs).toContain('Detected framework: unknown');
    expect(logs).toContain('Created server.js');

    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    expect(writeCalls[1][0]).toBe(path.join('/fake/project', 'server.js'));
    expect(writeCalls[1][1]).toContain("require('rsc-tape')");
  });

  it('skips config when rsctape.config.json already exists', async () => {
    vi.mocked(frameworkDetect.detectFramework).mockResolvedValue('next');
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).endsWith('rsctape.config.json');
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    await program.parseAsync(['node', 'rsctape', 'init']);

    expect(logs).toContain('rsctape.config.json already exists, skipping.');
    // Only entry file written
    expect(vi.mocked(fs.writeFileSync).mock.calls).toHaveLength(1);
    expect(vi.mocked(fs.writeFileSync).mock.calls[0][0]).toBe(
      path.join('/fake/project', 'instrumentation.ts')
    );
  });

  it('prompts manual integration when entry file already exists', async () => {
    vi.mocked(frameworkDetect.detectFramework).mockResolvedValue('next');
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).endsWith('instrumentation.ts');
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    await program.parseAsync(['node', 'rsctape', 'init']);

    const manualMsg = logs.find(l => l.includes('already exists. Please manually add'));
    expect(manualMsg).toBeDefined();
    expect(manualMsg).toContain('instrumentation.ts');

    // Should still print the content for manual integration
    const contentLog = logs.find(l => l.includes("import('rsc-tape')"));
    expect(contentLog).toBeDefined();

    // Config written, entry file NOT written
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0][0]).toBe(path.join('/fake/project', 'rsctape.config.json'));
  });

  it('skips both when config and entry file already exist', async () => {
    vi.mocked(frameworkDetect.detectFramework).mockResolvedValue('next');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    await program.parseAsync(['node', 'rsctape', 'init']);

    expect(logs).toContain('rsctape.config.json already exists, skipping.');
    expect(logs.find(l => l.includes('already exists. Please manually add'))).toBeDefined();
    expect(vi.mocked(fs.writeFileSync).mock.calls).toHaveLength(0);
  });
});
