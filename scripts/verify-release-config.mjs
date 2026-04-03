import fs from 'fs';
import path from 'path';

const platform = process.argv[2];
if (!platform) {
  console.error('Usage: node scripts/verify-release-config.mjs <win|linux|mac>');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const extraResources = packageJson.build?.extraResources?.[0]?.filter || [];

function requireResource(name) {
  if (!extraResources.includes(name)) {
    throw new Error(`Missing required extraResources asset: ${name}`);
  }
}

requireResource('xray.exe');
requireResource('xray');
requireResource('geoip.dat');
requireResource('geosite.dat');
requireResource('logo.ico');
requireResource('logo.icns');
requireResource('logo-256x256.png');

if (platform === 'win') {
  if (!packageJson.build?.win?.requestedExecutionLevel) {
    throw new Error('Windows build is missing requestedExecutionLevel.');
  }
  requireResource('wintun.dll');
}

if (platform === 'linux') {
  const linuxTargets = packageJson.build?.linux?.target || [];
  if (!linuxTargets.includes('AppImage') || !linuxTargets.includes('deb')) {
    throw new Error('Linux build must target both AppImage and deb.');
  }
}

if (platform === 'mac') {
  if (!packageJson.build?.mac?.icon) {
    throw new Error('macOS build must define an icon.');
  }
}

console.log(`Release configuration validated for ${platform}.`);
