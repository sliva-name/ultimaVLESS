import fs from 'fs';
import os from 'os';
import path from 'path';

/** Match Project X docs (TUN gateway/auto-route, tunnel inbound, dokodemo rewriteAddress). */
const DEFAULT_XRAY_VERSION = 'v26.5.9';

const RELEASE_API_URL =
  'https://api.github.com/repos/XTLS/Xray-core/releases/latest';
const ROOT_DIR = process.cwd();
const RESOURCES_DIR = path.join(ROOT_DIR, 'resources', 'bin');

function releaseDownloadBaseUrl(version) {
  const tag = String(version || DEFAULT_XRAY_VERSION).replace(/^v/i, 'v');
  return `https://github.com/XTLS/Xray-core/releases/download/${tag}`;
}

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
  if (platform === 'win' || platform === 'windows' || platform === 'win32')
    return 'win32';
  if (platform === 'mac' || platform === 'macos' || platform === 'darwin')
    return 'darwin';
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
      return [
        'Xray-linux-arm64-v8a.zip',
        'Xray-linux-arm64.zip',
        'Xray-linux-64.zip',
      ];
    }
    return ['Xray-linux-64.zip', 'Xray-linux-amd64.zip'];
  }
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return [
        'Xray-macos-arm64-v8a.zip',
        'Xray-macos-arm64.zip',
        'Xray-macos-64.zip',
      ];
    }
    return ['Xray-macos-64.zip', 'Xray-macos-amd64.zip'];
  }
  return [];
}

async function fetchLatestRelease() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ultima-vless-asset-preparer',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(RELEASE_API_URL, {
    headers,
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
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const headers = {
    Accept: 'application/octet-stream',
    'User-Agent': 'ultima-vless-asset-preparer',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`Asset download failed with status ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
}

async function downloadFromVersionRelease(
  version,
  candidates,
  destinationPath,
) {
  const baseUrl = releaseDownloadBaseUrl(version);
  const errors = [];
  for (const candidate of candidates) {
    const directUrl = `${baseUrl}/${candidate}`;
    try {
      await downloadFile(directUrl, destinationPath);
      return candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate}: ${message}`);
    }
  }
  throw new Error(
    `Could not download Xray archive for ${version}. Attempts: ${errors.join(' | ')}`,
  );
}

async function downloadFromApiAssets(candidates, destinationPath) {
  const release = await fetchLatestRelease();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const selected = selectAsset(assets, candidates);
  if (!selected) {
    throw new Error(
      `Could not find Xray archive in API response. Tried: ${candidates.join(', ')}`,
    );
  }
  await downloadFile(selected.browser_download_url, destinationPath);
  return selected.name;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const platform = normalizePlatform(args.platform || process.platform);
  const arch = normalizeArch(args.arch || process.arch);
  const version = String(args.version || process.env.XRAY_VERSION || DEFAULT_XRAY_VERSION);

  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  const candidateNames = getCandidateNames(platform, arch);
  if (candidateNames.length === 0) {
    throw new Error(
      `No candidate asset names for platform=${platform} arch=${arch}`,
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-assets-'));
  const zipPath = path.join(tmpDir, 'xray.zip');
  const extractDir = path.join(tmpDir, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    let archiveName = '';
    try {
      archiveName = await downloadFromVersionRelease(
        version,
        candidateNames,
        zipPath,
      );
      console.log(`Downloaded ${archiveName} (${version})`);
    } catch (directError) {
      const directMessage =
        directError instanceof Error
          ? directError.message
          : String(directError);
      console.warn(`Direct release download failed: ${directMessage}`);
      archiveName = await downloadFromApiAssets(candidateNames, zipPath);
      console.log(`Downloaded ${archiveName} via GitHub API asset URL`);
    }

    const { spawnSync } = await import('child_process');
    const unzipResult =
      process.platform === 'win32'
        ? spawnSync(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`,
            ],
            { stdio: 'inherit' },
          )
        : spawnSync('unzip', ['-o', zipPath, '-d', extractDir], {
            stdio: 'inherit',
          });
    if (unzipResult.status !== 0) {
      throw new Error('Failed to extract downloaded Xray archive');
    }

    const required =
      platform === 'win32'
        ? ['xray.exe', 'geoip.dat', 'geosite.dat']
        : ['xray', 'geoip.dat', 'geosite.dat'];
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

    const xrayBin = platform === 'win32' ? 'xray.exe' : 'xray';
    const versionRun = spawnSync(
      path.join(RESOURCES_DIR, xrayBin),
      ['version'],
      { encoding: 'utf8' },
    );
    const versionLine = String(versionRun.stdout || '').trim().split('\n')[0];
    fs.writeFileSync(
      path.join(RESOURCES_DIR, 'xray-version.txt'),
      `${version}\n${versionLine}\n`,
      'utf8',
    );

    console.log(`Prepared Xray assets for ${platform}/${arch} (${version})`);
    if (versionLine) console.log(versionLine);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
