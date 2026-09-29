// Embeds AppImage update information (for AppImageUpdate and the AppImageHub
// catalog) into every AppImage under the given directory, writes a .zsync file
// next to it and updates the sha512 in electron-builder's latest-linux.yml so
// electron-updater still verifies the patched file.
//
// Usage: node scripts/embed-appimage-update-info.mjs [release-dir]
// Needs zsyncmake (Ubuntu package "zsync").

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const UPDATE_INFORMATION =
  'gh-releases-zsync|sliva-name|ultimaVLESS|latest|UltimaVLESS-*.AppImage.zsync';

function findFiles(dir, predicate) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...findFiles(full, predicate));
    } else if (predicate(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

function sha512Base64(file) {
  return crypto
    .createHash('sha512')
    .update(fs.readFileSync(file))
    .digest('base64');
}

// Finds the .upd_info section of the AppImage runtime (a 64-bit
// little-endian ELF file), https://github.com/AppImage/AppImageSpec
function findUpdateInfoSection(fd) {
  const header = Buffer.alloc(64);
  fs.readSync(fd, header, 0, 64, 0);
  if (
    header.readUInt32BE(0) !== 0x7f454c46 ||
    header[4] !== 2 ||
    header[5] !== 1
  ) {
    throw new Error('Not a 64-bit little-endian ELF file');
  }
  const shoff = Number(header.readBigUInt64LE(0x28));
  const shentsize = header.readUInt16LE(0x3a);
  const shnum = header.readUInt16LE(0x3c);
  const shstrndx = header.readUInt16LE(0x3e);

  const sections = Buffer.alloc(shentsize * shnum);
  fs.readSync(fd, sections, 0, sections.length, shoff);
  const section = (index) => {
    const base = index * shentsize;
    return {
      name: sections.readUInt32LE(base),
      offset: Number(sections.readBigUInt64LE(base + 0x18)),
      size: Number(sections.readBigUInt64LE(base + 0x20)),
    };
  };

  const strtab = section(shstrndx);
  const names = Buffer.alloc(strtab.size);
  fs.readSync(fd, names, 0, strtab.size, strtab.offset);
  for (let i = 0; i < shnum; i++) {
    const current = section(i);
    const end = names.indexOf(0, current.name);
    if (names.toString('latin1', current.name, end) === '.upd_info') {
      return current;
    }
  }
  throw new Error('The AppImage runtime has no .upd_info section');
}

function embedUpdateInformation(file) {
  const fd = fs.openSync(file, 'r+');
  try {
    const { offset, size } = findUpdateInfoSection(fd);
    const value = Buffer.from(UPDATE_INFORMATION, 'utf8');
    if (value.length >= size) {
      throw new Error(
        `Update information is longer than .upd_info (${size} bytes)`,
      );
    }
    const data = Buffer.alloc(size);
    value.copy(data);
    fs.writeSync(fd, data, 0, size, offset);
  } finally {
    fs.closeSync(fd);
  }
}

const releaseDir = path.resolve(process.argv[2] || 'release');
const appImages = findFiles(releaseDir, (name) => name.endsWith('.AppImage'));
if (appImages.length === 0) {
  console.error(`No .AppImage found under ${releaseDir}`);
  process.exit(1);
}

for (const appImage of appImages) {
  const oldSha512 = sha512Base64(appImage);
  embedUpdateInformation(appImage);
  const newSha512 = sha512Base64(appImage);

  const latestYml = path.join(path.dirname(appImage), 'latest-linux.yml');
  if (fs.existsSync(latestYml)) {
    const yml = fs.readFileSync(latestYml, 'utf8');
    if (!yml.includes(oldSha512)) {
      throw new Error(
        `${latestYml} has no sha512 for ${path.basename(appImage)}`,
      );
    }
    fs.writeFileSync(latestYml, yml.split(oldSha512).join(newSha512));
  }

  const zsync = spawnSync(
    'zsyncmake',
    ['-u', path.basename(appImage), '-o', `${appImage}.zsync`, appImage],
    { stdio: 'inherit' },
  );
  if (zsync.error || zsync.status !== 0) {
    throw new Error(`zsyncmake failed for ${appImage}`);
  }
  console.log(`Embedded update information and wrote ${appImage}.zsync`);
}
