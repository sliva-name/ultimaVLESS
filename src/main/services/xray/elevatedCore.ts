import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

/** The Xray binary and the geo files it loads from `XRAY_LOCATION_ASSET`. */
const CORE_FILES = ['xray', 'geoip.dat', 'geosite.dat'] as const;

export interface ElevatedCore {
  /** Binary handed to the root wrapper. */
  binPath: string;
  /** `XRAY_LOCATION_ASSET` of the root process. */
  assetDir: string;
  /**
   * SHA-256 of the shipped binary when `binPath` is a copy the user can
   * rewrite: the wrapper then runs it only from a root-owned copy that matches.
   * `null` when root runs the shipped binary in place.
   */
  sha256: string | null;
}

const sourceHashes = new Map<string, Promise<string>>();

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** The shipped files never change while the app runs, so hash them once. */
function shippedSha256(filePath: string): Promise<string> {
  let hash = sourceHashes.get(filePath);
  if (!hash) {
    hash = sha256File(filePath);
    sourceHashes.set(filePath, hash);
    hash.catch(() => sourceHashes.delete(filePath));
  }
  return hash;
}

/**
 * Where the pkexec'd (root) Xray reads its binary and geo files from.
 *
 * An AppImage runs from a FUSE mount that only the user who started it may
 * open: root gets EACCES on every file in it, so Linux TUN could neither start
 * Xray nor load its geo files (issue #80). The files are copied to
 * `stagingDir` in the user's data directory instead, where root can read
 * them. Installed builds (deb, a source checkout) are used in place.
 */
export async function prepareElevatedCore(
  resourcesPath: string,
  stagingDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ElevatedCore> {
  const shippedBin = path.join(resourcesPath, 'xray');
  if (!env.APPIMAGE) {
    return { binPath: shippedBin, assetDir: resourcesPath, sha256: null };
  }
  await fsPromises.mkdir(stagingDir, { recursive: true, mode: 0o700 });
  for (const name of CORE_FILES) {
    const target = path.join(stagingDir, name);
    const partial = `${target}.partial`;
    await fsPromises.copyFile(path.join(resourcesPath, name), partial);
    await fsPromises.rename(partial, target);
  }
  return {
    binPath: path.join(stagingDir, 'xray'),
    assetDir: stagingDir,
    sha256: await shippedSha256(shippedBin),
  };
}
