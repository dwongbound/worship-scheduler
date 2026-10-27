// Where a portaled dropdown panel actually goes.
//
// `components/common/Dropdown.tsx` renders its menu into document.body at fixed
// coordinates measured from the trigger, which is what stops a modal's
// `overflow-hidden` clipping it. But pinning the panel to the trigger is only
// half the answer: a RIGHT-aligned menu hangs leftward from the trigger, so on
// a narrow screen a trigger that sits near the left edge puts the panel's left
// edge off-screen — the set detail modal's "⋮" on a phone, where the action bar
// had wrapped and carried the trigger to the left, lost the first letters of
// every row. The same arithmetic decides whether a menu opening near the bottom
// of the window has room below it at all.
//
// So the placement is a clamp, not a pin, and it lives here on its own because
// it is pure geometry — the kind of thing that is wrong by a few pixels in a
// way only a phone reveals, and therefore the kind of thing to unit-test
// (tests/unit/dropdownPosition.test.ts) rather than eyeball.
//
// All values are CSS pixels in the VIEWPORT's coordinate space, which is what
// getBoundingClientRect returns and what `position: fixed` consumes, so nothing
// here has to know about scrolling.

/** How close to the viewport edge a panel may come. */
export const MENU_GUTTER = 8;

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** True when the panel was flipped to sit above the trigger. */
  above: boolean;
  /**
   * Set only when the panel doesn't fit whole on either side of the trigger:
   * the height it must scroll within. Undefined means "let it be its natural
   * height" — a panel that fits is never given a scroll box.
   */
  maxHeight?: number;
}

/**
 * The horizontal edge the panel hangs from when there's room: "right" lines the
 * panel's right edge up with the trigger's, "left" its left with the trigger's.
 */
export type MenuAlign = "left" | "right";

/**
 * Place a panel of `menu` size against a `trigger`, inside `viewport`.
 *
 * Horizontally: start from the aligned edge, then clamp so the panel keeps
 * `gutter` from both sides. A panel too wide to fit at all is pinned to the
 * left gutter rather than centred — its first characters are the ones worth
 * keeping, and overflowing to the right is the direction a reader expects.
 *
 * Vertically: below the trigger by default. Flip above only when the panel
 * doesn't fit below AND there is more room above, so a menu near the bottom of
 * the window opens upward instead of off the edge. When neither side can hold
 * it whole, take the roomier side and report a `maxHeight` for it to scroll in.
 */
export function placeMenu({
  trigger,
  menu,
  viewport,
  align = "right",
  gutter = MENU_GUTTER,
}: {
  trigger: Rect;
  menu: Size;
  viewport: Size;
  align?: MenuAlign;
  gutter?: number;
}): Placement {
  const preferredLeft =
    align === "right" ? trigger.right - menu.width : trigger.left;
  // Math.max last, so when the panel is wider than the viewport the LEFT gutter
  // wins and the overflow goes off the right — Math.min alone would push the
  // panel's start off-screen, which is the very bug this function exists for.
  const left = Math.max(
    gutter,
    Math.min(preferredLeft, viewport.width - menu.width - gutter)
  );

  const roomBelow = viewport.height - trigger.bottom - gutter;
  const roomAbove = trigger.top - gutter;
  const fitsBelow = menu.height <= roomBelow;
  const above = !fitsBelow && roomAbove > roomBelow;

  if (above) {
    const fitsAbove = menu.height <= roomAbove;
    return {
      left,
      // A panel that has to scroll starts at the gutter and runs down to the
      // trigger; one that fits hangs off the trigger's top edge.
      top: fitsAbove ? trigger.top - menu.height : gutter,
      above: true,
      ...(fitsAbove ? {} : { maxHeight: roomAbove }),
    };
  }

  return {
    left,
    top: trigger.bottom,
    above: false,
    ...(fitsBelow ? {} : { maxHeight: Math.max(roomBelow, 0) }),
  };
}
