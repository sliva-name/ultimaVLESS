import { describe, expect, it } from 'vitest';
import { buildRecoveryVbsContent } from './windowsProxyRecovery';

/**
 * Minimal VBScript string-literal tokenizer: starting at the opening quote,
 * consumes the literal honouring the `""` escape and returns the decoded
 * value plus the remainder of the line. Throws on an unterminated literal —
 * exactly the failure mode that would break `sh.Run "..."` at runtime.
 */
function parseVbsStringLiteral(source: string): {
  value: string;
  rest: string;
} {
  if (!source.startsWith('"')) {
    throw new Error(`Expected string literal, got: ${source}`);
  }
  let value = '';
  let i = 1;
  while (i < source.length) {
    const char = source[i];
    if (char === '"') {
      if (source[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      return { value, rest: source.slice(i + 1) };
    }
    value += char;
    i += 1;
  }
  throw new Error(`Unterminated VBScript string literal in: ${source}`);
}

describe('buildRecoveryVbsContent', () => {
  const scriptPath = 'C:\\ProgramData\\UltimaVLESS\\recover_system_proxy.ps1';

  it('produces a syntactically valid sh.Run line', () => {
    const vbs = buildRecoveryVbsContent(scriptPath);
    const lines = vbs.split('\r\n');
    expect(lines[0]).toBe('Set sh = CreateObject("WScript.Shell")');

    const runLine = lines[1];
    expect(runLine.startsWith('sh.Run ')).toBe(true);
    const { value, rest } = parseVbsStringLiteral(
      runLine.slice('sh.Run '.length),
    );
    // The literal must end exactly before the window-style/wait arguments.
    expect(rest).toBe(', 0, False');
    // The decoded command keeps the script path as one double-quoted argument.
    expect(value).toBe(
      'powershell.exe -NoProfile -ExecutionPolicy Bypass ' +
        `-WindowStyle Hidden -File "${scriptPath}"`,
    );
  });

  it('escapes embedded quotes for paths with spaces', () => {
    const spacedPath = 'C:\\Program Files\\Ultima VLESS\\recover.ps1';
    const vbs = buildRecoveryVbsContent(spacedPath);
    const runLine = vbs.split('\r\n')[1];
    const { value, rest } = parseVbsStringLiteral(
      runLine.slice('sh.Run '.length),
    );
    expect(rest).toBe(', 0, False');
    expect(value).toContain(`-File "${spacedPath}"`);
  });
});
