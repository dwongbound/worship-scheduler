import { describe, expect, it } from "vitest";
import {
  DELETE_CONFIRM_PHRASE,
  confirmationMatches,
  strandedMessage,
  strandedOrgs,
} from "@/lib/accountDeletion";

const org = (over: Partial<Parameters<typeof strandedOrgs>[0][number]>) => ({
  orgId: "o1",
  orgName: "Grace Chapel",
  isAdmin: true,
  adminCount: 1,
  memberCount: 5,
  ...over,
});

describe("confirmationMatches", () => {
  it("needs the phrase exactly (surrounding spaces forgiven)", () => {
    expect(confirmationMatches(DELETE_CONFIRM_PHRASE)).toBe(true);
    expect(confirmationMatches("  DELETE ")).toBe(true);
  });
  it("refuses anything else", () => {
    expect(confirmationMatches("delete")).toBe(false);
    expect(confirmationMatches("")).toBe(false);
    expect(confirmationMatches(undefined)).toBe(false);
    expect(confirmationMatches(true)).toBe(false);
  });
});

describe("strandedOrgs", () => {
  it("blocks the only admin of an org with other members", () => {
    expect(strandedOrgs([org({})])).toEqual([{ orgId: "o1", orgName: "Grace Chapel" }]);
  });
  it("is fine with another admin, alone in the org, or not an admin", () => {
    expect(strandedOrgs([org({ adminCount: 2 })])).toEqual([]);
    expect(strandedOrgs([org({ memberCount: 1 })])).toEqual([]);
    expect(strandedOrgs([org({ isAdmin: false, adminCount: 0 })])).toEqual([]);
    expect(strandedOrgs([])).toEqual([]);
  });
  it("names every org in the refusal", () => {
    expect(strandedMessage([{ orgName: "A" }])).toContain("only admin of A.");
    expect(strandedMessage([{ orgName: "A" }, { orgName: "B" }, { orgName: "C" }])).toContain(
      "only admin of A, B and C."
    );
  });
});
