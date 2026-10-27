/**
 * Runs the Gradle wrapper of the Android project with the given tasks:
 * `gradlew.bat` on Windows, `./gradlew` elsewhere (CI runs on Linux).
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const androidDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'android',
);
const windows = process.platform === 'win32';
// A full path: Windows may be set not to look up commands in the current
// directory (NoDefaultCurrentDirectoryInExePath).
const wrapper = path.join(androidDir, windows ? 'gradlew.bat' : 'gradlew');
const result = spawnSync(
  windows ? `"${wrapper}"` : wrapper,
  process.argv.slice(2),
  { cwd: androidDir, stdio: 'inherit', shell: windows },
);
process.exit(result.status ?? 1);
