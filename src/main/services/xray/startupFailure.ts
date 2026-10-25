const FAILED_TO_START = /Failed to start:/i;
/** `infra/conf: `, `app/proxyman/inbound: `, `main: ` … */
const MODULE_PREFIX = /^[a-z][\w-]*(?:\/[\w-]+)*:\s+/i;

/**
 * Xray reports a rejected config or listener as one stdout line,
 * `Failed to start: <module>: <error> > <module>: <cause> > …`. The last two
 * links name the cause; module paths and the config file path are dropped.
 */
export function summarizeStartupFailure(
  lines: readonly string[],
): string | null {
  const line = [...lines]
    .reverse()
    .find((entry) => FAILED_TO_START.test(entry));
  if (!line) return null;
  const chain = line
    .slice(line.search(FAILED_TO_START) + 'Failed to start:'.length)
    .split(' > ')
    .map((part) => part.trim().replace(MODULE_PREFIX, ''))
    .filter((part) => part && !/^failed to load config files/i.test(part));
  return chain.length > 0 ? chain.slice(-2).join(' > ') : null;
}
