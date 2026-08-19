// Setlist diffing: turn "what the songs were" + "what they are now" into one
// human sentence fragment, used for both the set history entry and the Slack
// notice. Pure (no db, no network) so it's unit-testable.
//
// Songs are matched BY TITLE, case-insensitively — the setlist API replaces the
// whole list on every save, so row ids are new each time and titles are the only
// stable identity we have. Two rows sharing a title collapse into one for
// diffing purposes; that's rare (a setlist doesn't usually repeat a song) and
// the worst case is an under-reported change, never a wrong one.

export interface SetlistSong {
  title: string;
  key: string | null;
}

/** `"Who Else" (E)`, or just `"Who Else"` when the key is unspecified. */
function label(song: SetlistSong): string {
  return song.key ? `"${song.title}" (${song.key})` : `"${song.title}"`;
}

function byTitle(songs: SetlistSong[]): Map<string, SetlistSong> {
  const map = new Map<string, SetlistSong>();
  for (const song of songs) {
    const id = song.title.trim().toLowerCase();
    if (!map.has(id)) map.set(id, song);
  }
  return map;
}

/**
 * What changed between two setlists, as a fragment that reads after a person's
 * name: `added "Who Else" (E); changed the key of "God of Revival" to D`.
 * Null when nothing meaningful changed, so callers can skip logging entirely.
 */
export function describeSetlistChange(
  before: SetlistSong[],
  after: SetlistSong[]
): string | null {
  const oldByTitle = byTitle(before);
  const newByTitle = byTitle(after);

  const added: string[] = [];
  const removed: string[] = [];
  const rekeyed: string[] = [];

  for (const [id, song] of newByTitle) {
    const was = oldByTitle.get(id);
    if (!was) {
      added.push(label(song));
    } else if ((was.key ?? null) !== (song.key ?? null)) {
      // A key going from unspecified to set reads better as "set", and the
      // reverse as "cleared", than as a from→to arrow with a blank on one side.
      if (!was.key) rekeyed.push(`set the key of "${song.title}" to ${song.key}`);
      else if (!song.key) rekeyed.push(`cleared the key of "${song.title}"`);
      else rekeyed.push(`changed "${song.title}" from ${was.key} to ${song.key}`);
    }
  }
  for (const [id, song] of oldByTitle) {
    if (!newByTitle.has(id)) removed.push(label(song));
  }

  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.join(", ")}`);
  if (removed.length) parts.push(`removed ${removed.join(", ")}`);
  parts.push(...rekeyed);

  // Same songs, same keys — the only possible change left is the running order.
  // Worth a history line (the band plays in this order) but nothing more.
  if (parts.length === 0) {
    const sameOrder =
      before.length === after.length &&
      before.every((s, i) => s.title.trim().toLowerCase() === after[i].title.trim().toLowerCase());
    return sameOrder ? null : "reordered the setlist";
  }

  return parts.join("; ");
}
