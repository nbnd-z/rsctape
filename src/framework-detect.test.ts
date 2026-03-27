import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectFramework, detectFrameworkFromFormData } from './framework-detect';

describe('detectFramework', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsctape-fw-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns "next" when next is in dependencies', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0' },
    }));
    expect(await detectFramework(tmpDir)).toBe('next');
  });

  it('returns "waku" when waku is in dependencies', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { waku: '^0.20.0' },
    }));
    expect(await detectFramework(tmpDir)).toBe('waku');
  });

  it('returns "parcel" when parcel is in dependencies', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { parcel: '^2.0.0' },
    }));
    expect(await detectFramework(tmpDir)).toBe('parcel');
  });

  it('returns "parcel" when @parcel/ scoped package is in dependencies', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { '@parcel/core': '^2.0.0' },
    }));
    expect(await detectFramework(tmpDir)).toBe('parcel');
  });

  it('detects next from next.config.js file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, 'next.config.js'), '');
    expect(await detectFramework(tmpDir)).toBe('next');
  });

  it('detects next from next.config.ts file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, 'next.config.ts'), '');
    expect(await detectFramework(tmpDir)).toBe('next');
  });

  it('detects next from next.config.mjs file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, 'next.config.mjs'), '');
    expect(await detectFramework(tmpDir)).toBe('next');
  });

  it('detects waku from waku.config.ts file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({}));
    fs.writeFileSync(path.join(tmpDir, 'waku.config.ts'), '');
    expect(await detectFramework(tmpDir)).toBe('waku');
  });

  it('returns "unknown" when no framework detected', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.0.0' },
    }));
    expect(await detectFramework(tmpDir)).toBe('unknown');
  });

  it('returns "unknown" when no package.json exists and no config files', async () => {
    expect(await detectFramework(tmpDir)).toBe('unknown');
  });

  it('returns "unknown" when package.json is invalid JSON', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not json');
    expect(await detectFramework(tmpDir)).toBe('unknown');
  });

  it('prioritises package.json over config files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { waku: '^0.20.0' },
    }));
    fs.writeFileSync(path.join(tmpDir, 'next.config.js'), '');
    expect(await detectFramework(tmpDir)).toBe('waku');
  });
});

describe('detectFrameworkFromFormData', () => {
  it('returns "next" for $ACTION_ID_ prefix', () => {
    expect(detectFrameworkFromFormData(['$ACTION_ID_abc123'])).toBe('next');
  });

  it('returns "next" for $ACTION_REF_ prefix', () => {
    expect(detectFrameworkFromFormData(['$ACTION_REF_abc123'])).toBe('next');
  });

  it('returns "next" for numbered $ACTION_ID_ prefix', () => {
    expect(detectFrameworkFromFormData(['1_$ACTION_ID_abc123'])).toBe('next');
  });

  it('returns "next" for numbered $ACTION_REF_ prefix', () => {
    expect(detectFrameworkFromFormData(['2_$ACTION_REF_abc123'])).toBe('next');
  });

  it('returns "next" when mixed with regular keys', () => {
    expect(detectFrameworkFromFormData(['username', '$ACTION_ID_abc', 'email'])).toBe('next');
  });

  it('returns "unknown" for regular form keys', () => {
    expect(detectFrameworkFromFormData(['username', 'email', 'password'])).toBe('unknown');
  });

  it('returns "unknown" for empty keys array', () => {
    expect(detectFrameworkFromFormData([])).toBe('unknown');
  });
});
