// Unit tests for the signed OAuth state used by the Slack connect/install flows
// (lib/slackOauth) — the CSRF guard that binds a callback to {orgId, userId}.
import { beforeEach, describe, expect, it } from "vitest";
import { signState, verifyState } from "@/lib/slackOauth";

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret";
});

const data = { orgId: "org1", userId: "user1", purpose: "install" as const };

describe("signState / verifyState", () => {
  it("round-trips valid state", () => {
    expect(verifyState(signState(data))).toEqual(data);
  });

  it("rejects a tampered signature", () => {
    const [json, sig] = signState(data).split(".");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyState(`${json}.${flipped}`)).toBeNull();
  });

  it("rejects state forged/verified under a different secret", () => {
    const token = signState(data);
    process.env.NEXTAUTH_SECRET = "another-secret";
    expect(verifyState(token)).toBeNull();
  });

  it("rejects expired state", () => {
    expect(verifyState(signState(data, -1))).toBeNull();
  });

  it("rejects malformed tokens and unknown purposes", () => {
    expect(verifyState("garbage")).toBeNull();
    expect(verifyState("")).toBeNull();
  });
});
