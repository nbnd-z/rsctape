import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, ConfigError } from './config';

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsctape-config-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when config file does not exist', async () => {
    const config = await loadConfig(tmpDir);
    expect(config).toEqual({
      fixtureDir: './fixtures/actions',
      ignore: [],
    });
  });

  it('loads fixtureDir from config file', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'rsctape.config.json'),
      JSON.stringify({ fixtureDir: './my-fixtures' })
    );
    const config = await loadConfig(tmpDir);
    expect(config.fixtureDir).toBe('./my-fixtures');
    expect(config.ignore).toEqual([]);
  });

  it('loads ignore from config file', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'rsctape.config.json'),
      JSON.stringify({ ignore: ['**/internal-*'] })
    );
    const config = await loadConfig(tmpDir);
    expect(config.fixtureDir).toBe('./fixtures/actions');
    expect(config.ignore).toEqual(['**/internal-*']);
  });

  it('loads full config', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'rsctape.config.json'),
      JSON.stringify({ fixtureDir: './out', ignore: ['a', 'b'] })
    );
    const config = await loadConfig(tmpDir);
    expect(config).toEqual({ fixtureDir: './out', ignore: ['a', 'b'] });
  });

  it('throws ConfigError for invalid JSON', async () => {
    fs.writeFileSync(path.join(tmpDir, 'rsctape.config.json'), '{bad json');
    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when config is not an object', async () => {
    fs.writeFileSync(path.join(tmpDir, 'rsctape.config.json'), '"string"');
    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when config is an array', async () => {
    fs.writeFileSync(path.join(tmpDir, 'rsctape.config.json'), '[]');
    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when fixtureDir is not a string', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'rsctape.config.json'),
      JSON.stringify({ fixtureDir: 123 })
    );
    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(tmpDir)).rejects.toThrow(/fixtureDir/);
  });

  it('throws ConfigError when ignore is not an array', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'rsctape.config.json'),
      JSON.stringify({ ignore: 'not-array' })
    );
    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(tmpDir)).rejects.toThrow(/ignore/);
  });

  it('throws ConfigError when ignore contains non-string', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'rsctape.config.json'),
      JSON.stringify({ ignore: ['ok', 42] })
    );
    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(tmpDir)).rejects.toThrow(/ignore\[1\]/);
  });

  it('ignores unknown keys and returns valid config', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'rsctape.config.json'),
      JSON.stringify({ fixtureDir: './x', unknown: true })
    );
    const config = await loadConfig(tmpDir);
    expect(config).toEqual({ fixtureDir: './x', ignore: [] });
  });

  it('returns a fresh copy of defaults (no shared references)', async () => {
    const a = await loadConfig(tmpDir);
    const b = await loadConfig(tmpDir);
    expect(a).toEqual(b);
    a.ignore.push('modified');
    expect(b.ignore).toEqual([]);
  });
});
