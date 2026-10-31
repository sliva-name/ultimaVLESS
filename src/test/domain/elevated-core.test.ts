import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prepareElevatedCore } from '@/main/services/xray/elevatedCore';

describe('prepareElevatedCore', () => {
  let tmpDir: string;
  let resourcesPath: string;
  let stagingDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elevated-core-'));
    resourcesPath = path.join(tmpDir, 'resources', 'bin');
    stagingDir = path.join(tmpDir, 'userData', 'elevated-core');
    fs.mkdirSync(resourcesPath, { recursive: true });
    fs.writeFileSync(path.join(resourcesPath, 'xray'), 'xray-binary');
    fs.writeFileSync(path.join(resourcesPath, 'geoip.dat'), 'geoip');
    fs.writeFileSync(path.join(resourcesPath, 'geosite.dat'), 'geosite');
    fs.writeFileSync(path.join(resourcesPath, 'logo.ico'), 'icon');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs an installed build in place', async () => {
    await expect(
      prepareElevatedCore(resourcesPath, stagingDir, {}),
    ).resolves.toEqual({
      binPath: path.join(resourcesPath, 'xray'),
      assetDir: resourcesPath,
      sha256: null,
    });
    expect(fs.existsSync(stagingDir)).toBe(false);
  });

  it('copies an AppImage core out of the FUSE mount, with the shipped hash', async () => {
    const core = await prepareElevatedCore(resourcesPath, stagingDir, {
      APPIMAGE: '/home/u/UltimaVLESS.AppImage',
    });

    expect(core).toEqual({
      binPath: path.join(stagingDir, 'xray'),
      assetDir: stagingDir,
      sha256: crypto.createHash('sha256').update('xray-binary').digest('hex'),
    });
    expect(fs.readdirSync(stagingDir).sort()).toEqual([
      'geoip.dat',
      'geosite.dat',
      'xray',
    ]);
    expect(fs.readFileSync(path.join(stagingDir, 'geosite.dat'), 'utf8')).toBe(
      'geosite',
    );
  });

  it('replaces a staged copy that was changed since', async () => {
    const env = { APPIMAGE: '/home/u/UltimaVLESS.AppImage' };
    await prepareElevatedCore(resourcesPath, stagingDir, env);
    fs.writeFileSync(path.join(stagingDir, 'xray'), 'tampered');

    await prepareElevatedCore(resourcesPath, stagingDir, env);

    expect(fs.readFileSync(path.join(stagingDir, 'xray'), 'utf8')).toBe(
      'xray-binary',
    );
  });
});
