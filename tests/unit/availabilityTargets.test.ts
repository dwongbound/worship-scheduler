// Unit tests for lib/availabilityTargets — who an availability request reaches.
// `targetsUser` / `membersTargetedBy` are Prisma where-fragments (covered by
// the API), so only the pure client-side twin is tested here.
import { describe, expect, it } from "vitest";
import { requestAudienceFor } from "@/lib/availabilityTargets";

// Shorthand: a team membership, active unless said otherwise.
const on = (id: string, active = true) => ({ id, active });

describe("requestAudienceFor", () => {
  it("reaches everyone when the request names no teams", () => {
    // Legacy rows + orgs with no teams: a request with no teams is org-wide.
    expect(requestAudienceFor([], [on("t1")])).toBe("asked");
    // On no team at all: nothing to be paused from, so still on the hook.
    expect(requestAudienceFor([], [])).toBe("asked");
  });

  it("reaches active members of a targeted team", () => {
    expect(requestAudienceFor(["t1", "t2"], [on("t2")])).toBe("asked");
  });

  it("skips people on none of the targeted teams", () => {
    expect(requestAudienceFor(["t1"], [on("t2")])).toBe("not-asked");
    // Just joined the org, not on any team yet.
    expect(requestAudienceFor(["t1"], [])).toBe("not-asked");
  });

  it("marks someone paused on every targeted team as inactive", () => {
    // Paused where it was asked = not on the hook, but still accounted for —
    // "inactive" rather than "not-asked" is what keeps them on the admin's
    // list (at the bottom) instead of vanishing from it.
    expect(requestAudienceFor(["t1"], [on("t1", false)])).toBe("inactive");
    expect(
      requestAudienceFor(["t1", "t2"], [on("t1", false), on("t2", false)])
    ).toBe("inactive");
  });

  it("still asks someone active on ANY ONE targeted team", () => {
    // Paused on the choir but playing in the band: the request reaches them.
    expect(
      requestAudienceFor(["t1", "t2"], [on("t1", false), on("t2")])
    ).toBe("asked");
  });

  it("ignores a pause on a team the request didn't ask", () => {
    expect(
      requestAudienceFor(["t1"], [on("t1"), on("t2", false)])
    ).toBe("asked");
    // …and an inactive membership elsewhere can't make a non-target a target.
    expect(requestAudienceFor(["t1"], [on("t2", false)])).toBe("not-asked");
  });

  it("treats paused-everywhere as inactive for a whole-org request too", () => {
    // No teams on the request = every team in the org. Paused on all of them
    // is paused, full stop.
    expect(requestAudienceFor([], [on("t1", false)])).toBe("inactive");
    expect(requestAudienceFor([], [on("t1", false), on("t2")])).toBe("asked");
  });
});
