/**
 * Errors from the main process are written in English, the language of the
 * logs. This translates the ones users see in the window, the tray and
 * notifications. Each entry replaces a phrase wherever it occurs, so wrapped
 * messages ("<subscription>: …", "Config generation failed: …") are translated
 * piece by piece, and text that comes from Xray itself is left as it is.
 *
 * The phrases are in `errorPhrases/patterns.ts`, their wording per language
 * next to it.
 */
import { isSupportedLanguage, type UiLanguage } from './constants';
import {
  ERROR_PATTERNS,
  type ErrorPhraseId,
  type ErrorPhrases,
} from './errorPhrases/patterns';
import { es } from './errorPhrases/es';
import { fa } from './errorPhrases/fa';
import { ru } from './errorPhrases/ru';
import { tr } from './errorPhrases/tr';
import { zh } from './errorPhrases/zh';

type PhraseTable = ReadonlyArray<readonly [RegExp, string]>;

const toTable = (phrases: ErrorPhrases): PhraseTable =>
  (Object.keys(ERROR_PATTERNS) as ErrorPhraseId[]).map(
    (id) => [ERROR_PATTERNS[id], phrases[id]] as const,
  );

/** English is the source text: nothing to replace. */
const TABLES: Record<UiLanguage, PhraseTable> = {
  en: [],
  ru: toTable(ru),
  zh: toTable(zh),
  fa: toTable(fa),
  es: toTable(es),
  tr: toTable(tr),
};

/** Electron prefixes errors thrown by an `ipcMain.handle` handler. */
const IPC_INVOKE_PREFIX =
  /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

export function localizeError(message: string, language: string): string {
  const text = message.replace(IPC_INVOKE_PREFIX, '');
  const base = language.split(/[-_]/)[0].toLowerCase();
  if (!isSupportedLanguage(base)) return text;
  return TABLES[base].reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}
