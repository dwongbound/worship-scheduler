// Saved generate previews ("drafts") — the rules, kept pure so they're testable
// away from prisma and React. The prisma side lives in the API routes.

/**
 * How many DELIBERATE drafts one org may keep. Recovery drafts (the once-a-minute
 * autosave) are excluded on purpose: the safety net has to keep working when
 * the five keep-slots are full, or the one moment you most want a recovery —
 * a busy admin with five saved plans — is the one where you don't have it.
 */
export const MAX_DRAFTS = 5;

/** How often a preview autosaves itself into its recovery slot. */
export const AUTOSAVE_INTERVAL_MS = 60_000;

/** A draft as the list endpoint returns it — no plan payload, so the list stays light. */
export type DraftSummary = {
  id: string;
  name: string | null;
  isRecovery: boolean;
  createdAt: string;
  updatedAt: string;
  // Who FIRST saved it. A later editor shows only as updatedAt moving.
  createdByName: string;
};

/**
 * Whether another deliberate draft can be saved, and what to say when it can't.
 * `drafts` is the org's whole list; recovery rows don't count.
 *
 * Returns the reason rather than a bare boolean because the UI has to explain
 * itself — "delete one first" is the entire interaction at the limit.
 */
export function canSaveDraft(
  drafts: Pick<DraftSummary, "isRecovery" | "id">[],
  // Re-saving an EXISTING draft replaces it, so it never needs a free slot.
  replacingId?: string | null
): { ok: true } | { ok: false; reason: string } {
  const kept = drafts.filter((d) => !d.isRecovery);
  if (replacingId && kept.some((d) => d.id === replacingId)) return { ok: true };
  if (kept.length < MAX_DRAFTS) return { ok: true };
  return {
    ok: false,
    reason: `You already have ${MAX_DRAFTS} saved drafts. Delete one before saving another.`,
  };
}

/**
 * The name a draft row shows. Naming is optional on both kinds, so both need a
 * stand-in; they read differently only so the list doesn't show two rows with
 * the same label when an unnamed kept draft sits beside the autosave.
 */
export function draftLabel(draft: Pick<DraftSummary, "name" | "isRecovery">): string {
  if (draft.name?.trim()) return draft.name.trim();
  return draft.isRecovery ? "Unnamed draft (Autosaved)" : "Untitled draft";
}

/** Trim a submitted name to null when it's blank — naming is optional. */
export function normalizeDraftName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}
