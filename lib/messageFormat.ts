// How one provider writes text, and how long a message it will accept.
//
// Our messages only ever use formatting in two places — bold, and a link whose
// label differs from its URL — so those are the only two things a format has to
// answer. Keeping them behind this type is what lets the message builders in
// lib/slack.ts stay provider-neutral instead of hard-coding Slack mrkdwn.
//
// The concrete formats live with their providers, in lib/integrations/<name>/
// format.ts. Only the shape and the splitter are shared, so they live here.
//
// Deliberately pure (no prisma, no fetch): the text builders that consume it are
// unit-tested, and this keeps those tests free of server-only imports.

export type MessageFormat = {
  /** Bold `text` in this provider's markup. */
  bold(text: string): string;
  /**
   * A link labelled `text`. Slack has real inline links; Discord has none
   * outside embeds, so its version degrades to "label (url)" — the information
   * survives even where the hyperlink can't.
   */
  link(url: string, text: string): string;
  /**
   * Hard per-message ceiling, used only to split messages that would be REJECTED
   * outright. Set it to the provider's actual limit, not a stylistic preference:
   * Slack accepts 40,000 characters, so nothing we send today is ever split,
   * while Discord rejects anything over 2000 — which the weekly team summary can
   * genuinely exceed for a busy org. See splitMessage.
   */
  maxChars: number;
};

/**
 * Split a message into pieces no longer than `maxChars`.
 *
 * Breaks on line boundaries wherever it can, because every long message we send
 * is a list (a roster, a weekly summary, a digest) and cutting mid-line reads as
 * corruption. A single line longer than the limit is hard-split as a last
 * resort — losing the tail entirely would be worse.
 *
 * An empty input yields an empty array, so callers never post a blank message.
 */
export function splitMessage(text: string, maxChars: number): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const line of text.split("\n")) {
    // A line that can't fit on its own: flush what we have, then hard-split it.
    if (line.length > maxChars) {
      flush();
      for (let i = 0; i < line.length; i += maxChars) {
        chunks.push(line.slice(i, i + maxChars));
      }
      continue;
    }
    // +1 for the newline we'd be re-joining with.
    if (current && current.length + 1 + line.length > maxChars) flush();
    current = current ? `${current}\n${line}` : line;
  }
  flush();
  return chunks;
}
