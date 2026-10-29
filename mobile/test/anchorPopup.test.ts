import { describe, expect, it } from 'vitest';
import { anchorPopup } from '@/renderer/components/ui/anchorPopup';

/** A 412 × 915 dp phone: 32 dp status bar, 80 dp navigation + 24 dp gestures. */
const phone = { width: 412, height: 915, insetTop: 96, insetBottom: 104 };
const menu = { width: 224, height: 114 };

describe('popup placement', () => {
  it('opens under the trigger, right edges aligned', () => {
    const position = anchorPopup(
      { top: 200, bottom: 240, right: 396 },
      menu,
      phone,
    );
    expect(position).toEqual({ left: 172, top: 244, openUp: false });
  });

  it('opens above the trigger when the navigation bar leaves no room below', () => {
    // The last subscription row, just above the bottom navigation.
    const position = anchorPopup(
      { top: 700, bottom: 740, right: 396 },
      menu,
      phone,
    );
    expect(position.openUp).toBe(true);
    expect(position.top).toBeUndefined();
    // Its bottom edge sits 4 dp above the trigger.
    expect(915 - position.bottom!).toBe(696);
  });

  it('stays inside the screen edges', () => {
    const position = anchorPopup(
      { top: 200, bottom: 240, right: 120 },
      menu,
      phone,
    );
    expect(position.left).toBe(8);
  });
});
