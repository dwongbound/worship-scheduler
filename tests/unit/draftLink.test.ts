import { describe, expect, it } from "vitest";
import {
  DRAFT_PARAM,
  draftForSlug,
  draftSearch,
  draftSlug,
  draftSlugs,
  slugifyDraftName,
} from "@/lib/draftLink";

const draft = (id: string, name: string | null, isRecovery = false) => ({
  id,
  name,
  isRecovery,
});

describe("slugifyDraftName", () => {
  it("lower-cases and joins words with hyphens", () => {
    expect(slugifyDraftName("November Rota")).toBe("november-rota");
  });

  it("drops punctuation and collapses the gaps it leaves", () => {
    expect(slugifyDraftName("Advent — week 1 & 2!")).toBe("advent-week-1-2");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(slugifyDraftName("Noël rota")).toBe("noel-rota");
  });

  it("never returns a bare or trailing hyphen", () => {
    expect(slugifyDraftName("  -- hi -- ")).toBe("hi");
  });

  it("falls back to 'draft' when nothing survives", () => {
    // A name with no Latin letters slugs away to nothing; the fallback is what
    // keeps such a draft linkable at all.
    expect(slugifyDraftName("찬양팀")).toBe("draft");
  });

  it("caps the slug without leaving it ending in a hyphen", () => {
    const slug = slugifyDraftName("a".repeat(58) + " bb");
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("draftSlugs", () => {
  it("gives each draft its name's slug", () => {
    const list = [draft("1", "November Rota"), draft("2", "Advent")];
    expect([...draftSlugs(list).values()]).toEqual(["november-rota", "advent"]);
  });

  it("numbers same-named drafts in list order, first keeping the bare slug", () => {
    const list = [draft("1", "Rota"), draft("2", "rota"), draft("3", "ROTA")];
    const slugs = draftSlugs(list);
    expect(slugs.get("1")).toBe("rota");
    expect(slugs.get("2")).toBe("rota-2");
    expect(slugs.get("3")).toBe("rota-3");
  });

  it("slugs the stand-in label for unnamed drafts, keeping the two kinds apart", () => {
    const slugs = draftSlugs([draft("1", null), draft("2", null, true)]);
    expect(slugs.get("1")).toBe("untitled-draft");
    expect(slugs.get("2")).toBe("unnamed-draft-autosaved");
  });

  it("is stable per draft id regardless of how it's asked", () => {
    const list = [draft("1", "Rota"), draft("2", "Rota")];
    expect(draftSlug(list[1], list)).toBe("rota-2");
  });
});

describe("draftForSlug", () => {
  const list = [draft("1", "November Rota"), draft("2", "Rota"), draft("3", "Rota")];

  it("finds the draft a slug names", () => {
    expect(draftForSlug("november-rota", list)?.id).toBe("1");
  });

  it("resolves a numbered duplicate to the right one", () => {
    expect(draftForSlug("rota", list)?.id).toBe("2");
    expect(draftForSlug("rota-2", list)?.id).toBe("3");
  });

  it("forgives case and stray hyphens, since these are typed by hand", () => {
    expect(draftForSlug("  -November-Rota-  ", list)?.id).toBe("1");
  });

  it("is null for a slug nothing answers to, and for nothing at all", () => {
    // A renamed or deleted draft leaves a dead link — the caller says so
    // rather than opening the wrong plan.
    expect(draftForSlug("gone", list)).toBeNull();
    expect(draftForSlug("", list)).toBeNull();
    expect(draftForSlug(null, list)).toBeNull();
  });
});

describe("draftSearch", () => {
  it("sets the param on an empty search", () => {
    expect(draftSearch("", "november-rota")).toBe(`?${DRAFT_PARAM}=november-rota`);
  });

  it("keeps the other params a page is already carrying", () => {
    const next = draftSearch("?set=abc123", "advent");
    expect(new URLSearchParams(next).get("set")).toBe("abc123");
    expect(new URLSearchParams(next).get(DRAFT_PARAM)).toBe("advent");
  });

  it("replaces an existing draft param rather than repeating it", () => {
    const next = draftSearch("?draft=old", "new");
    expect([...new URLSearchParams(next).getAll(DRAFT_PARAM)]).toEqual(["new"]);
  });

  it("clears the param on null and leaves the rest alone", () => {
    expect(draftSearch("?draft=advent&set=abc", null)).toBe("?set=abc");
  });

  it("returns an empty string when clearing the only param", () => {
    // "" rather than "?" — the caller appends it to the pathname, and a bare
    // trailing "?" would show in the address bar.
    expect(draftSearch("?draft=advent", null)).toBe("");
  });
});
