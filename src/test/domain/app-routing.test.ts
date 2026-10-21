import { describe, expect, it, vi } from 'vitest';
import {
  MAX_APP_ROUTING_ENTRIES,
  classifyAppEntry,
  matchKnownAppName,
  normalizeAppEntries,
} from '@/shared/appRouting';
import {
  describeExecutable,
  listRunningApps,
  parseProcessList,
} from '@/main/services/runningApps';

describe('classifyAppEntry', () => {
  it('keeps bare executable names', () => {
    expect(classifyAppEntry('chrome.exe')).toBe('chrome.exe');
    expect(classifyAppEntry('  Discord.exe ')).toBe('Discord.exe');
    expect(classifyAppEntry('firefox')).toBe('firefox');
    expect(classifyAppEntry('Яндекс Музыка.exe')).toBe('Яндекс Музыка.exe');
  });

  it('reduces Windows and POSIX paths to the file name', () => {
    expect(
      classifyAppEntry(
        'C:\\Users\\me\\AppData\\Local\\Discord\\app-1.0.9200\\Discord.exe',
      ),
    ).toBe('Discord.exe');
    expect(
      classifyAppEntry('"C:\\Program Files\\Mozilla Firefox\\firefox.exe"'),
    ).toBe('firefox.exe');
    expect(classifyAppEntry('/usr/lib/firefox/firefox')).toBe('firefox');
  });

  it('lowercases the extension Xray strips before comparing', () => {
    expect(classifyAppEntry('STEAM.EXE')).toBe('STEAM.exe');
  });

  it('rejects input that cannot name an executable', () => {
    for (const junk of [
      '',
      '   ',
      '.exe',
      '..',
      'C:\\Games\\',
      'self/',
      'xray/',
      'a<b.exe',
      'bad|name',
      'tab\tname.exe',
      'x'.repeat(256),
      42,
      null,
    ]) {
      expect(classifyAppEntry(junk)).toBeNull();
    }
  });
});

describe('normalizeAppEntries', () => {
  it('drops junk and duplicates and caps the list', () => {
    expect(
      normalizeAppEntries(['chrome.exe', 'chrome.EXE', '', 'Telegram.exe', 7]),
    ).toEqual(['chrome.exe', 'Telegram.exe']);
    expect(normalizeAppEntries('chrome.exe')).toEqual([]);
    const many = Array.from({ length: 150 }, (_, i) => `app${i}.exe`);
    expect(normalizeAppEntries(many)).toHaveLength(MAX_APP_ROUTING_ENTRIES);
  });
});

describe('matchKnownAppName', () => {
  const running = ['Discord.exe', 'chrome.exe', 'Telegram.exe'];

  it('restores the spelling of a running program', () => {
    expect(matchKnownAppName('discord.exe', running)).toBe('Discord.exe');
    expect(matchKnownAppName('telegram', running)).toBe('Telegram.exe');
    expect(matchKnownAppName('chrome.exe', running)).toBe('chrome.exe');
  });

  it('keeps names it does not know', () => {
    expect(matchKnownAppName('steam.exe', running)).toBe('steam.exe');
    expect(matchKnownAppName('steam.exe', [])).toBe('steam.exe');
  });
});

describe('parseProcessList', () => {
  it('accepts the array and single-object shapes of ConvertTo-Json', () => {
    expect(
      parseProcessList(
        '[{"Path":"C:\\\\A\\\\a.exe","Description":" A app "},{"Path":"C:\\\\B\\\\b.exe","Description":""},{"Path":null}]',
      ),
    ).toEqual([
      { path: 'C:\\A\\a.exe', description: 'A app' },
      { path: 'C:\\B\\b.exe', description: null },
    ]);
    expect(
      parseProcessList('{"Path":"C:\\\\A\\\\a.exe","Description":null}'),
    ).toEqual([{ path: 'C:\\A\\a.exe', description: null }]);
    expect(parseProcessList('  ')).toEqual([]);
  });
});

describe('listRunningApps', () => {
  const rows = [
    {
      Path: 'C:\\Windows\\explorer.exe',
      Description: 'Windows Explorer',
    },
    {
      Path: 'C:\\Users\\me\\AppData\\Local\\Discord\\app-1.0.9200\\Discord.exe',
      Description: 'Discord',
    },
    {
      Path: 'C:\\Users\\me\\AppData\\Local\\Discord\\app-1.0.9200\\Discord.exe',
      Description: 'Discord',
    },
    // The process image name is `claude.exe`, but Xray reads the path.
    {
      Path: 'C:\\Program Files\\WindowsApps\\Claude_3\\app\\Claude.exe',
      Description: 'Claude',
    },
    { Path: 'C:\\Tools\\zzz.exe', Description: null },
  ];

  it('lists programs by the file name in their path, with icons, user apps first', async () => {
    const runScript = vi.fn(async () => JSON.stringify(rows));
    const getIcon = vi.fn(async (path: string) =>
      path.endsWith('zzz.exe') ? null : `data:image/png;base64,${path.length}`,
    );

    const apps = await listRunningApps({
      platform: 'win32',
      runScript,
      getIcon,
      systemRoot: 'C:\\Windows',
    });

    expect(apps.map((app) => app.name)).toEqual([
      'Claude.exe',
      'Discord.exe',
      'zzz.exe',
      'explorer.exe',
    ]);
    expect(apps[1]).toEqual({
      name: 'Discord.exe',
      description: 'Discord',
      icon: expect.stringMatching(/^data:image\/png;base64,/),
      system: false,
    });
    expect(apps[2]).toMatchObject({ description: null, icon: null });
    expect(apps[3]).toMatchObject({ system: true });
    // Duplicate processes share one entry and one icon lookup.
    expect(getIcon).toHaveBeenCalledTimes(4);
    expect(runScript).toHaveBeenCalledWith(
      expect.stringContaining('Get-Process'),
    );
  });

  it('offers nothing outside Windows', async () => {
    const runScript = vi.fn();
    await expect(
      listRunningApps({ platform: 'linux', runScript }),
    ).resolves.toEqual([]);
    expect(runScript).not.toHaveBeenCalled();
  });
});

describe('describeExecutable', () => {
  it('names a picked file and flags Windows components', async () => {
    const getIcon = vi.fn(async () => 'data:image/png;base64,AAAA');
    await expect(
      describeExecutable('C:\\Games\\Steam\\steam.exe', null, {
        getIcon,
        systemRoot: 'C:\\Windows\\',
      }),
    ).resolves.toEqual({
      name: 'steam.exe',
      description: null,
      icon: 'data:image/png;base64,AAAA',
      system: false,
    });
    await expect(
      describeExecutable('\\\\?\\C:\\WINDOWS\\system32\\svchost.exe', null, {
        getIcon,
        systemRoot: 'C:\\Windows',
      }),
    ).resolves.toMatchObject({ name: 'svchost.exe', system: true });
    await expect(
      describeExecutable('C:\\Games\\', null, { getIcon }),
    ).resolves.toBeNull();
  });
});
