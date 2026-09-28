// Unit tests for MD eligibility + default pick (lib/md.ts).
import { describe, expect, it } from "vitest";
import { defaultMDId, eligibleMDIds, isValidMD, type MDAssignment } from "@/lib/md";

// Shorthand for a roster row.
const a = (userId: string, role: MDAssignment["role"], isMD = false): MDAssignment => ({
  userId,
  role,
  isMD,
});

describe("eligibleMDIds", () => {
  it("includes MDs playing an MD-capable role (keys/electric/bass)", () => {
    const roster = [a("k", "KEYS", true), a("e", "ELECTRIC_GUITAR", true), a("b", "BASS", true)];
    expect(new Set(eligibleMDIds(roster))).toEqual(new Set(["k", "e", "b"]));
  });

  it("excludes non-MDs and MDs in non-MD-capable roles", () => {
    const roster = [a("k", "KEYS", false), a("d", "DRUMS", true), a("v", "VOCALS", true)];
    expect(eligibleMDIds(roster)).toEqual([]);
  });

  it("excludes the worship leader even when they also play an MD role", () => {
    // Same person on WL and Keys → the WL slot bars them from being MD.
    const roster = [a("p", "WORSHIP_LEADER", true), a("p", "KEYS", true)];
    expect(eligibleMDIds(roster)).toEqual([]);
  });

  it("returns distinct ids in MD-role preference order", () => {
    // MD_ROLES is preference-ordered: electric guitar, then keys, then bass.
    const roster = [
      a("b", "BASS", true),
      a("k", "KEYS", true),
      a("e", "ELECTRIC_GUITAR", true),
    ];
    expect(eligibleMDIds(roster)).toEqual(["e", "k", "b"]);
  });
});

describe("defaultMDId", () => {
  it("picks the electric guitarist over other MD roles", () => {
    const roster = [a("k", "KEYS", true), a("e", "ELECTRIC_GUITAR", true)];
    expect(defaultMDId(roster)).toBe("e"); // electric outranks keys
  });

  it("falls back to another MD role when no electric guitarist can lead", () => {
    // The seated electric guitarist isn't MD-eligible → keys leads instead.
    const roster = [a("e", "ELECTRIC_GUITAR"), a("k", "KEYS", true)];
    expect(defaultMDId(roster)).toBe("k");
  });

  it("is null when nobody qualifies", () => {
    expect(defaultMDId([a("d", "DRUMS", true)])).toBeNull();
  });
});

describe("isValidMD", () => {
  const roster = [a("k", "KEYS", true), a("d", "DRUMS", false)];

  it("is true for an eligible assignee", () => {
    expect(isValidMD("k", roster)).toBe(true);
  });

  it("is false for an ineligible or unknown id, and for null", () => {
    expect(isValidMD("d", roster)).toBe(false);
    expect(isValidMD("nope", roster)).toBe(false);
    expect(isValidMD(null, roster)).toBe(false);
  });
});

describe("seats mid-handoff (pendingFrom)", () => {
  // The set's MD asked for cover on their keys slot and someone took it; the
  // seat shows the taker, but an admin hasn't approved the handoff yet.
  const pendingKeys = (takerId: string, takerIsMD = false): MDAssignment => ({
    ...a(takerId, "KEYS", takerIsMD),
    pendingFrom: { userId: "md", isMD: true },
  });

  it("keeps the MD eligible while their cover is awaiting approval", () => {
    const roster = [pendingKeys("taker"), a("d", "DRUMS")];
    expect(eligibleMDIds(roster)).toEqual(["md"]);
    expect(isValidMD("md", roster)).toBe(true);
  });

  it("doesn't make the taker eligible until the handoff is approved", () => {
    // The taker is an MD themselves, but the seat isn't really theirs yet.
    const roster = [pendingKeys("taker", true)];
    expect(eligibleMDIds(roster)).toEqual(["md"]);
    expect(isValidMD("taker", roster)).toBe(false);
    // Approved: the seat is the taker's, and the MD is off the set.
    const settled = [a("taker", "KEYS", true)];
    expect(eligibleMDIds(settled)).toEqual(["taker"]);
    expect(isValidMD("md", settled)).toBe(false);
  });

  it("judges the pending owner on their own MD flag, not the taker's", () => {
    // A non-MD hands their keys slot to an MD: neither can lead the set.
    const roster: MDAssignment[] = [
      { ...a("taker", "KEYS", true), pendingFrom: { userId: "owner", isMD: false } },
    ];
    expect(eligibleMDIds(roster)).toEqual([]);
  });

  it("counts a pending worship-leader seat against its original owner", () => {
    // The WL handed their slot over; they still can't MD from the keys seat
    // they also hold, and the taker isn't barred by a seat that isn't theirs.
    const roster: MDAssignment[] = [
      { ...a("taker", "WORSHIP_LEADER"), pendingFrom: { userId: "wl", isMD: true } },
      a("wl", "KEYS", true),
      a("k", "ELECTRIC_GUITAR", true),
    ];
    expect(eligibleMDIds(roster)).toEqual(["k"]);
  });
});

describe("avoiding back-to-back MDs (previousMDId)", () => {
  // Three electric guitarists who can all lead — the case from the generate
  // preview, where the same person kept leading two sets running.
  const threeGuitarists = [
    a("alice", "ELECTRIC_GUITAR", true),
    a("bob", "ELECTRIC_GUITAR", true),
    a("carol", "ELECTRIC_GUITAR", true),
  ];

  it("passes over whoever led the previous set", () => {
    // Without the hint, "alice" wins on id order every time.
    expect(defaultMDId(threeGuitarists)).toBe("alice");
    expect(defaultMDId(threeGuitarists, "alice")).toBe("bob");
    expect(defaultMDId(threeGuitarists, "bob")).toBe("alice");
  });

  it("sinks them within their role but still lists them", () => {
    // Demoted, never excluded — they're a valid pick an admin can still make.
    expect(eligibleMDIds(threeGuitarists, "alice")).toEqual(["bob", "carol", "alice"]);
  });

  it("keeps instrument ahead of person: the lone guitarist leads again", () => {
    // The whole point of "instrument -> person". Rather than hand the job to a
    // keys player, the only electric guitarist leads a second time.
    const roster = [a("eg", "ELECTRIC_GUITAR", true), a("keys", "KEYS", true)];
    expect(defaultMDId(roster, "eg")).toBe("eg");
  });

  it("rotates within keys when there's no guitarist at all", () => {
    const roster = [a("k1", "KEYS", true), a("k2", "KEYS", true)];
    expect(defaultMDId(roster, "k1")).toBe("k2");
  });

  it("is a no-op when last set's MD isn't on this roster", () => {
    expect(defaultMDId(threeGuitarists, "someone-else")).toBe("alice");
    expect(defaultMDId(threeGuitarists, null)).toBe("alice");
  });

  it("never repeats across a run when someone else can lead", () => {
    // Chain it the way the generate flow does and no two consecutive sets get
    // the same MD.
    let previous: string | null = null;
    const picks: (string | null)[] = [];
    for (let i = 0; i < 6; i++) {
      previous = defaultMDId(threeGuitarists, previous);
      picks.push(previous);
    }
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i]).not.toBe(picks[i - 1]);
    }
  });
});
