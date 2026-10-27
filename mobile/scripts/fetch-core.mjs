/**
 * Downloads the Android Xray core and its geodata into the Gradle project:
 *
 *   android/app/libs/libv2ray.aar           2dust/AndroidLibXrayLite
 *   android/app/src/main/assets/geo/*.dat   from the XTLS/Xray-core release
 *
 * Both follow the desktop's BUNDLED_XRAY_VERSION, so the phone runs the same
 * Xray as the desktop build. Every download is checked against the SHA-256
 * its publisher lists. Already present files of the right version are kept.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const mobileDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repoDir = path.resolve(mobileDir, '..');
const libsDir = path.join(mobileDir, 'android', 'app', 'libs');
const geoDir = path.join(
  mobileDir,
  'android',
  'app',
  'src',
  'main',
  'assets',
  'geo',
);
const markerPath = path.join(libsDir, 'core-version.txt');

function bundledXrayVersion() {
  const constants = fs.readFileSync(
    path.join(repoDir, 'src', 'shared', 'constants.ts'),
    'utf8',
  );
  const match = /BUNDLED_XRAY_VERSION\s*=\s*'(v[\d.]+)'/.exec(constants);
  if (!match)
    throw new Error(
      'BUNDLED_XRAY_VERSION not found in src/shared/constants.ts',
    );
  return match[1];
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return {
    'User-Agent': 'ultimavless-fetch-core',
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function download(url) {
  const response = await fetch(url, {
    headers: githubHeaders(),
    redirect: 'follow',
  });
  if (!response.ok)
    throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verify(name, buffer, expected) {
  const actual = sha256(buffer);
  if (actual !== expected.toLowerCase()) {
    throw new Error(
      `${name}: SHA-256 mismatch (expected ${expected}, got ${actual})`,
    );
  }
  console.log(`  ${name}: SHA-256 ok`);
}

async function fetchLibv2ray(version) {
  const api = `https://api.github.com/repos/2dust/AndroidLibXrayLite/releases/tags/${version}`;
  const release = JSON.parse((await download(api)).toString('utf8'));
  const asset = release.assets?.find((item) => item.name === 'libv2ray.aar');
  if (!asset?.digest?.startsWith('sha256:')) {
    throw new Error(`libv2ray.aar with a digest not found in ${version}`);
  }
  console.log(`Downloading libv2ray.aar ${version}…`);
  const aar = await download(asset.browser_download_url);
  verify('libv2ray.aar', aar, asset.digest.slice('sha256:'.length));
  fs.mkdirSync(libsDir, { recursive: true });
  fs.writeFileSync(path.join(libsDir, 'libv2ray.aar'), aar);
}

function extractZip(zipPath, destination) {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path "${zipPath}" -DestinationPath "${destination}" -Force`,
          ],
          { stdio: 'inherit' },
        )
      : spawnSync('unzip', ['-o', zipPath, '-d', destination], {
          stdio: 'inherit',
        });
  if (result.status !== 0) throw new Error(`Failed to extract ${zipPath}`);
}

async function fetchGeodata(version) {
  const base = `https://github.com/XTLS/Xray-core/releases/download/${version}`;
  const zipName = 'Xray-android-arm64-v8a.zip';
  console.log(`Downloading geodata from ${zipName} ${version}…`);
  const digest = (await download(`${base}/${zipName}.dgst`)).toString('utf8');
  const expected = /SHA2-256=\s*([0-9a-f]{64})/i.exec(digest)?.[1];
  if (!expected) throw new Error(`No SHA2-256 in ${zipName}.dgst`);
  const zip = await download(`${base}/${zipName}`);
  verify(zipName, zip, expected);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-geo-'));
  try {
    const zipPath = path.join(tmpDir, zipName);
    fs.writeFileSync(zipPath, zip);
    const extracted = path.join(tmpDir, 'extracted');
    extractZip(zipPath, extracted);
    fs.mkdirSync(geoDir, { recursive: true });
    for (const file of ['geoip.dat', 'geosite.dat']) {
      fs.copyFileSync(path.join(extracted, file), path.join(geoDir, file));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const version = bundledXrayVersion();
  const force = process.argv.includes('--force');
  const present =
    fs.existsSync(path.join(libsDir, 'libv2ray.aar')) &&
    fs.existsSync(path.join(geoDir, 'geoip.dat')) &&
    fs.existsSync(path.join(geoDir, 'geosite.dat')) &&
    fs.existsSync(markerPath) &&
    fs.readFileSync(markerPath, 'utf8').trim() === version;
  if (present && !force) {
    console.log(`Android core ${version} is already in place.`);
    return;
  }
  await fetchLibv2ray(version);
  await fetchGeodata(version);
  fs.writeFileSync(markerPath, `${version}\n`);
  console.log(`Android core ${version} ready.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
