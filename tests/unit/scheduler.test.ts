// Unit tests for the auto-scheduling algorithm (lib/scheduler.ts).
import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  isUserAvailable,
  type SchedulerSet,
  type SchedulerUser,
  type UnavailabilityRule,
} from "@/lib/scheduler";
import { SLOT_CAPACITIES } from "@/lib/constants";

// A Tuesday evening set: 19:00–20:00.
const tuesdaySet: SchedulerSet = {
  id: "set-1",
  startsAt: new Date(2026, 0, 6, 19, 0), // Tue Jan 6 2026, 7pm local
  durationMinutes: 60,
};

function user(id: string, instruments: SchedulerUser["instruments"]): SchedulerUser {
  return { id, instruments };
}

describe("isUserAvailable", () => {
  it("blocks a recurring rule that overlaps the set time", () => {
    const rules: UnavailabilityRule[] = [
      // Tuesday 18:00–20:00 — overlaps 19:00–20:00.
      { userId: "u1", type: "RECURRING", dayOfWeek: 2, startMinute: 1080, endMinute: 1200 },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(false);
  });

  it("allows a recurring rule on a different day", () => {
    const rules: UnavailabilityRule[] = [
      { userId: "u1", type: "RECURRING", dayOfWeek: 3, startMinute: 0, endMinute: 1440 },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(true);
  });

  it("allows a recurring rule on the same day but non-overlapping time", () => {
    const rules: UnavailabilityRule[] = [
      // Tuesday morning only — the evening set is fine.
      { userId: "u1", type: "RECURRING", dayOfWeek: 2, startMinute: 360, endMinute: 720 },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(true);
  });

  it("blocks a date range containing the set (inclusive end date)", () => {
    const rules: UnavailabilityRule[] = [
      {
        userId: "u1",
        type: "DATE_RANGE",
        startDate: new Date(2026, 0, 5), // Jan 5
        endDate: new Date(2026, 0, 6), // Jan 6 at midnight — still blocks the 7pm set
      },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(false);
  });

  it("ignores other users' rules", () => {
    const rules: UnavailabilityRule[] = [
      { userId: "someone-else", type: "RECURRING", dayOfWeek: 2, startMinute: 0, endMinute: 1440 },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(true);
  });
});

describe("buildSchedule", () => {
  it("respects slot capacities (max 4 vocals)", () => {
    const vocalists = ["v1", "v2", "v3", "v4", "v5", "v6"].map((id) =>
      user(id, ["VOCALS"])
    );
    const result = buildSchedule([tuesdaySet], vocalists, []);
    const vocals = result.filter((a) => a.role === "VOCALS");
    expect(vocals).toHaveLength(SLOT_CAPACITIES.VOCALS); // exactly 4
  });

  it("honors a per-set capacity override (2 electric guitars)", () => {
    const guitarists = ["g1", "g2", "g3"].map((id) => user(id, ["ELECTRIC_GUITAR"]));
    // Default is 2 electric guitars; make this set want 3.
    const set: SchedulerSet = { ...tuesdaySet, capacities: { ELECTRIC_GUITAR: 3 } };
    const result = buildSchedule([set], guitarists, []);
    expect(result.filter((a) => a.role === "ELECTRIC_GUITAR")).toHaveLength(3);
  });

  it("skips a role a set sets to 0 capacity", () => {
    const players = [user("a1", ["ACOUSTIC_GUITAR"]), user("d1", ["DRUMS"])];
    // Tuesday: no acoustic guitars wanted, but drums as usual.
    const set: SchedulerSet = { ...tuesdaySet, capacities: { ACOUSTIC_GUITAR: 0 } };
    const result = buildSchedule([set], players, []);
    expect(result.some((a) => a.role === "ACOUSTIC_GUITAR")).toBe(false);
    expect(result.some((a) => a.role === "DRUMS")).toBe(true);
  });

  it("never assigns the same user twice to one set", () => {
    // One multi-instrumentalist who could fill several slots.
    const multi = user("m1", ["WORSHIP_LEADER", "KEYS", "DRUMS"]);
    const result = buildSchedule([tuesdaySet], [multi], []);
    expect(result).toHaveLength(1); // only one slot, despite three skills
  });

  it("skips unavailable users and leaves the slot to someone else", () => {
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const rules: UnavailabilityRule[] = [
      // d1 is out every Tuesday.
      { userId: "d1", type: "RECURRING", dayOfWeek: 2, startMinute: 0, endMinute: 1440 },
    ];
    const result = buildSchedule([tuesdaySet], drummers, rules);
    expect(result).toEqual([{ setId: "set-1", userId: "d2", role: "DRUMS" }]);
  });

  it("leaves slots empty when nobody can fill them", () => {
    const result = buildSchedule([tuesdaySet], [user("d1", ["DRUMS"])], []);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("DRUMS");
    // No bass/keys/etc. proposals fabricated out of thin air.
  });

  it("load-balances across sets (2 drummers, 2 sets → 1 each)", () => {
    const sets: SchedulerSet[] = [
      tuesdaySet,
      { id: "set-2", startsAt: new Date(2026, 0, 13, 19, 0), durationMinutes: 60 },
    ];
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const result = buildSchedule(sets, drummers, []);
    const byUser = new Set(result.map((a) => a.userId));
    expect(byUser.size).toBe(2); // both drummers used, not d1 twice
  });

  it("accounts for pre-existing assignment counts when balancing", () => {
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    // d1 already has 5 upcoming sets — d2 should get this one.
    const existing = new Map([["d1", 5]]);
    const result = buildSchedule([tuesdaySet], drummers, [], existing);
    expect(result[0].userId).toBe("d2");
  });

  it("is deterministic for identical inputs", () => {
    const users = ["a", "b", "c", "d"].map((id) => user(id, ["VOCALS"]));
    const first = buildSchedule([tuesdaySet], users, []);
    const second = buildSchedule([tuesdaySet], users, []);
    expect(first).toEqual(second);
  });
});
