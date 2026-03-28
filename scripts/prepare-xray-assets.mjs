import fs from 'fs';
import os from 'os';
import path from 'path';

const RELEASE_API_URL = 'https://api.github.com/repos/XTLS/Xray-core/releases/latest';
const ROOT_DIR = process.cwd();
const RESOURCES_DIR = path.join(ROOT_DIR, 'resources', 'bin');

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
}

function normalizePlatform(value) {
  const platform = String(value || '').toLowerCase();
  if (platform === 'win' || platform === 'windows' || platform === 'win32') return 'win32';
  if (platform === 'mac' || platform === 'macos' || platform === 'darwin') return 'darwin';
  if (platform === 'linux') return 'linux';
  throw new Error(`Unsupported platform: ${value}`);
}

function normalizeArch(value) {
  const arch = String(value || '').toLowerCase();
  if (arch === 'x64' || arch === 'amd64') return 'x64';
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64';
  throw new Error(`Unsupported arch: ${value}`);
}

function getCandidateNames(platform, arch) {
  if (platform === 'win32') {
    return ['Xray-windows-64.zip'];
  }
  if (platform === 'linux') {
    if (arch === 'arm64') {
      return ['Xray-linux-arm64-v8a.zip', 'Xray-linux-arm64.zip', 'Xray-linux-64.zip'];
    }
    return ['Xray-linux-64.zip', 'Xray-linux-amd64.zip'];
  }
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return ['Xray-macos-arm64-v8a.zip', 'Xray-macos-arm64.zip', 'Xray-macos-64.zip'];
    }
    return ['Xray-macos-64.zip', 'Xray-macos-amd64.zip'];
  }
  return [];
}

async function fetchLatestRelease() {
  const response = await fetch(RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ultima-vless-asset-preparer',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}`);
  }
  return response.json();
}

function selectAsset(assets, candidates) {
  for (const candidate of candidates) {
    const exact = assets.find((asset) => asset?.name === candidate);
    if (exact) return exact;
  }
  return null;
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'ultima-vless-asset-preparer',
    },
  });
  if (!response.ok) {
    throw new Error(`Asset download failed with status ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const platform = normalizePlatform(args.platform || process.platform);
  const arch = normalizeArch(args.arch || process.arch);

  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  const release = await fetchLatestRelease();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const candidateNames = getCandidateNames(platform, arch);
  if (candidateNames.length === 0) {
    throw new Error(`No candidate asset names for platform=${platform} arch=${arch}`);
  }
  const selected = selectAsset(assets, candidateNames);
  if (!selected) {
    throw new Error(
      `Could not find Xray archive for platform=${platform} arch=${arch}. Tried: ${candidateNames.join(', ')}`
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-assets-'));
  const zipPath = path.join(tmpDir, selected.name);
  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    console.log(`Downloading ${selected.name}...`);
    await downloadFile(selected.browser_download_url, zipPath);

    // Node does not provide a cross-platform ZIP extraction API directly.
    const { spawnSync } = await import('child_process');
    const unzipResult =
      process.platform === 'win32'
        ? spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`], { stdio: 'inherit' })
        : spawnSync('unzip', ['-o', zipPath, '-d', extractDir], { stdio: 'inherit' });
    if (unzipResult.status !== 0) {
      throw new Error(`Failed to extract archive ${selected.name}`);
    }

    const required = platform === 'win32' ? ['xray.exe', 'geoip.dat', 'geosite.dat'] : ['xray', 'geoip.dat', 'geosite.dat'];
    for (const file of required) {
      const source = path.join(extractDir, file);
      if (!fs.existsSync(source)) {
        throw new Error(`Missing required file in Xray archive: ${file}`);
      }
      fs.copyFileSync(source, path.join(RESOURCES_DIR, file));
    }

    if (platform === 'win32') {
      const wintunSource = path.join(extractDir, 'wintun.dll');
      if (fs.existsSync(wintunSource)) {
        fs.copyFileSync(wintunSource, path.join(RESOURCES_DIR, 'wintun.dll'));
      }
    } else {
      const xrayPath = path.join(RESOURCES_DIR, 'xray');
      try {
        fs.chmodSync(xrayPath, 0o755);
      } catch {
        // Ignore chmod failures on filesystems that don't support Unix modes.
      }
    }

    console.log(`Prepared Xray assets for ${platform}/${arch}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
