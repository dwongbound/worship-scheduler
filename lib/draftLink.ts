// Linking to a saved draft: the ONE spelling of "?draft=<something readable>".
//
// The id is a cuid, which is useless in a message to a colleague, so the link
// carries a slug of the draft's own name instead — `?draft=november-rota`.
// That means the slug is only as stable as the name: renaming a draft changes
// its link, which is the trade we want (a readable link that can go stale
// beats an opaque one that can't).
//
// Slugs are resolved against a LIST rather than looked up, because two drafts
// in the same org and mode may be named the same thing. `draftSlugs` numbers
// the duplicates in list order — the first keeps the bare slug and the rest
// get `-2`, `-3` — so every draft in one list has its own link, and the one
// most people mean keeps the short one.
import { draftLabel, type DraftSummary } from "./drafts";

/** The query parameter, in both workspaces. */
export const DRAFT_PARAM = "draft";

type Named = Pick<DraftSummary, "id" | "name" | "isRecovery">;

/**
 * A draft's name as URL-safe text: lower case, words joined by hyphens,
 * everything else dropped. Non-Latin names can slug away to nothing, so an
 * empty result falls back to "draft" and the numbering below keeps it unique.
 */
export function slugifyDraftName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "draft";
}

/**
 * Every draft in the list mapped to its slug, duplicates numbered in order.
 * One pass over the whole list, because a slug can only be made unique by
 * knowing what else is in it.
 */
export function draftSlugs(drafts: Named[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const draft of drafts) {
    const base = slugifyDraftName(draftLabel(draft));
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(draft.id, n === 1 ? base : `${base}-${n}`);
  }
  return out;
}

/** One draft's slug within its list. */
export function draftSlug(draft: Named, drafts: Named[]): string {
  return draftSlugs(drafts).get(draft.id) ?? slugifyDraftName(draftLabel(draft));
}

/**
 * The draft a `?draft=` value names, or null. Case and surrounding hyphens are
 * forgiven, since these get typed and pasted by hand.
 */
export function draftForSlug(slug: string | null, drafts: Named[]): Named | null {
  if (!slug) return null;
  const wanted = slug.trim().toLowerCase().replace(/^-+|-+$/g, "");
  if (!wanted) return null;
  const slugs = draftSlugs(drafts);
  return drafts.find((d) => slugs.get(d.id) === wanted) ?? null;
}

/**
 * The current URL's search string with the draft param set, or cleared when
 * `slug` is null. Returns the "?…" to push, or "" when nothing is left — the
 * caller pairs it with the pathname so other params (a `?set=` deep link, a
 * filter) survive.
 */
export function draftSearch(search: string, slug: string | null): string {
  const params = new URLSearchParams(search);
  if (slug) params.set(DRAFT_PARAM, slug);
  else params.delete(DRAFT_PARAM);
  const next = params.toString();
  return next ? `?${next}` : "";
}
