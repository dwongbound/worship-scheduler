// Notes diffing: turn "what the notes were" + "what they are now" into one
// human sentence fragment for the set history. Pure (no db, no network) so it's
// unit-testable — the same shape as lib/setlist.ts.
//
// The fragment carries an EXCERPT of what was written, not just the fact that
// something was. A log line reading "Alice updated the notes" tells you nothing
// you couldn't get from the set itself, and the set only ever shows the LATEST
// text — the excerpt is what makes the history worth keeping.

/**
 * How much of the note goes into the log. Long enough for a real instruction
 * ("Bring extra cables, doors at 8" fits comfortably), short enough that one
 * entry can't swallow the whole list. The full text always lives on the set.
 */
export const NOTE_EXCERPT_LIMIT = 180;

/** Collapse whitespace so a reflowed paragraph doesn't read as a change. */
function normalize(notes: string | null | undefined): string {
  return (notes ?? "").trim().replace(/\s+/g, " ");
}

/** The note as it appears inside a log line, truncated with an ellipsis. */
function excerpt(notes: string): string {
  if (notes.length <= NOTE_EXCERPT_LIMIT) return `"${notes}"`;
  return `"${notes.slice(0, NOTE_EXCERPT_LIMIT).trimEnd()}…"`;
}

/**
 * What changed between two versions of a set's notes, as a fragment that reads
 * after a person's name: `added a note: "Bring extra cables"`. Null when
 * nothing meaningful changed, so callers can skip logging entirely.
 *
 * Whitespace-only differences count as no change: the notes box saves whatever
 * is in it alongside every other staged edit, so a save that only retyped a
 * line break must stay silent.
 */
export function describeNotesChange(
  before: string | null | undefined,
  after: string | null | undefined
): string | null {
  const was = normalize(before);
  const now = normalize(after);
  if (was === now) return null;

  if (!now) return "cleared the notes";
  if (!was) return `added a note: ${excerpt(now)}`;
  return `updated the notes: ${excerpt(now)}`;
}

/**
 * The reverse of describeNotesChange for display: pull the note itself back out
 * of a logged fragment, so a history row can show the message plainly.
 *
 *   `added a note: "Bring extra cables"` → `Bring extra cables`
 *   `cleared the notes`                  → `cleared the notes`
 *
 * A fragment with no quoted excerpt (a clear) has no message to show, so it
 * comes back untouched — it already reads as a sentence.
 */
export function noteTextFromDetail(detail: string | null | undefined): string {
  const text = (detail ?? "").trim();
  // The excerpt is everything inside the LAST pair of quotes: the prefix never
  // contains one, and the note itself may.
  const open = text.indexOf('"');
  if (open === -1 || !text.endsWith('"')) return text;
  return text.slice(open + 1, -1);
}
