import { describe, expect, it, vi } from 'vitest';
import {
  MAX_APP_ROUTING_ENTRIES,
  classifyAppEntry,
  matchKnownAppName,
  normalizeAppEntries,
} from '@/shared/appRouting';
import { listRunningApps } from '@/main/services/runningApps';

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

describe('listRunningApps', () => {
  it('returns unique executable names from tasklist, sorted', async () => {
    const run = vi.fn(async () => ({
      code: 0,
      stdout: [
        '"System Idle Process","0","Services","0","8 K"',
        '"System","4","Services","0","2,464 K"',
        '"Registry","120","Services","0","40,000 K"',
        '"svchost.exe","1000","Services","0","10,000 K"',
        '"Discord.exe","2000","Console","1","100,000 K"',
        '"Discord.exe","2001","Console","1","100,000 K"',
        '"chrome.exe","3000","Console","1","90,000 K"',
      ].join('\r\n'),
      stderr: '',
    }));

    await expect(listRunningApps({ platform: 'win32', run })).resolves.toEqual([
      'chrome.exe',
      'Discord.exe',
      'svchost.exe',
    ]);
    expect(run).toHaveBeenCalledWith('tasklist', ['/FO', 'CSV', '/NH']);
  });

  it('offers no suggestions outside Windows', async () => {
    const run = vi.fn();
    await expect(listRunningApps({ platform: 'linux', run })).resolves.toEqual(
      [],
    );
    expect(run).not.toHaveBeenCalled();
  });
});
