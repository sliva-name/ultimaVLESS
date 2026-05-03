import { describe, expect, it } from 'vitest';
import { isBlockingErrorText } from './blockingErrors';

describe('blockingErrors', () => {
  it('treats tunnel health-check failure as blocking for auto-switch', () => {
    expect(
      isBlockingErrorText(
        'Remote endpoint check via proxy failed after retries (tunnel may be slow or blocked)',
      ),
    ).toBe(true);
  });

  it('does not treat unrelated noise as blocking', () => {
    expect(isBlockingErrorText('connection reset by peer')).toBe(false);
    expect(isBlockingErrorText('HTTP 403 Forbidden')).toBe(false);
  });
});
