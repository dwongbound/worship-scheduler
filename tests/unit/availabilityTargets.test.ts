// Unit tests for lib/availabilityTargets — which teams an availability request
// reaches. `targetsUser` is a Prisma where-fragment (covered by the API), so
// only the pure client-side twin is tested here.
import { describe, expect, it } from "vitest";
import { requestTargetsTeams } from "@/lib/availabilityTargets";

describe("requestTargetsTeams", () => {
  it("reaches everyone when the request names no teams", () => {
    // Legacy rows + orgs with no teams: a request with no teams is org-wide.
    expect(requestTargetsTeams([], ["t1"])).toBe(true);
    expect(requestTargetsTeams([], [])).toBe(true);
  });

  it("reaches members of a targeted team", () => {
    expect(requestTargetsTeams(["t1", "t2"], ["t2"])).toBe(true);
  });

  it("skips people on none of the targeted teams", () => {
    expect(requestTargetsTeams(["t1"], ["t2"])).toBe(false);
    // Just joined the org, not on any team yet.
    expect(requestTargetsTeams(["t1"], [])).toBe(false);
  });
});
