// Direction of the last tab navigation, shared between the navbar (which sets
// it) and SwipePager (which consumes it once to pick the slide-in direction).
// +1 = moved to a right-hand tab, -1 = a left-hand tab, 0 = a plain navigation
// that shouldn't animate (e.g. a tab tap or a link click).
let direction = 0;

export function setNavDirection(d: number): void {
  direction = d;
}

// Reads the pending direction and resets it, so each navigation animates at
// most once and unrelated route changes stay un-animated.
export function consumeNavDirection(): number {
  const d = direction;
  direction = 0;
  return d;
}
