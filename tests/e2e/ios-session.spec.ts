// E2E: the iOS app's sign-in. No browser page — the app is a native client,
// so this drives the API the way it does: POST credentials, keep the token,
// send it as `Authorization: Bearer` with NO cookies, and every existing route
// answers as it would for a web session.
import { expect, test } from "@playwright/test";

test("a bearer token from /api/mobile/session signs the app in", async ({
  playwright,
  baseURL,
}) => {
  // A fresh context so nothing rides along on a cookie.
  const api = await playwright.request.newContext({ baseURL });

  const signIn = await api.post("/api/mobile/session", {
    data: { username: "BOB", password: "password123" },
  });
  expect(signIn.status()).toBe(200);
  const body = await signIn.json();
  expect(typeof body.token).toBe("string");
  expect(body.user.name).toBe("Bob Baker");
  expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

  const me = await api.get("/api/me", {
    headers: { Authorization: `Bearer ${body.token}` },
  });
  expect(me.status()).toBe(200);
  expect((await me.json()).name).toBe("Bob Baker");

  // Without it, the same request is signed out.
  expect((await api.get("/api/me")).status()).toBe(401);
  // And a forged one is no better.
  const forged = await api.get("/api/me", {
    headers: { Authorization: "Bearer not-a-real-token" },
  });
  expect(forged.status()).toBe(401);
  await api.dispose();
});

test("/api/mobile/session refuses a bad password and missing fields", async ({
  playwright,
  baseURL,
}) => {
  const api = await playwright.request.newContext({ baseURL });
  const bad = await api.post("/api/mobile/session", {
    data: { username: "bob", password: "wrong-password" },
  });
  expect(bad.status()).toBe(401);
  expect((await bad.json()).token).toBeUndefined();
  const empty = await api.post("/api/mobile/session", { data: {} });
  expect(empty.status()).toBe(400);
  await api.dispose();
});

test("/api/mobile/session/social refuses what it can't verify", async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  // Missing fields, or a provider that isn't ours.
  expect((await api.post("/api/mobile/session/social", { data: {} })).status()).toBe(400);
  expect(
    (await api.post("/api/mobile/session/social", { data: { provider: "facebook", idToken: "x" } })).status()
  ).toBe(400);
  // The test env configures neither provider, so even a well-formed request
  // is turned away before any token is read — never signed in.
  const google = await api.post("/api/mobile/session/social", {
    data: { provider: "google", idToken: "eyJ.not.real" },
  });
  expect(google.status()).toBe(503);
  expect((await google.json()).token).toBeUndefined();
  await api.dispose();
});

// The app's admin tabs: the same routes the web's Approvals and Team tabs
// use, reached with a bearer token and the org named in `x-org-id`.
test("an admin's bearer token reaches the admin routes for their org only", async ({
  playwright,
  baseURL,
}) => {
  const api = await playwright.request.newContext({ baseURL });
  const tokenFor = async (username: string) => {
    const res = await api.post("/api/mobile/session", { data: { username, password: "password123" } });
    expect(res.status()).toBe(200);
    return (await res.json()).token as string;
  };
  const admin = { Authorization: `Bearer ${await tokenFor("admin")}` };
  const member = { Authorization: `Bearer ${await tokenFor("bob")}` };

  // /api/me names the orgs the app's picker shows.
  const me = await (await api.get("/api/me", { headers: admin })).json();
  const adminOrg = me.memberships.find((m: { isAdmin: boolean }) => m.isAdmin);
  expect(adminOrg?.orgName).toBeTruthy();
  const org = { "x-org-id": adminOrg.orgId };

  const approvals = await api.get("/api/admin/approvals", { headers: { ...admin, ...org } });
  expect(approvals.status()).toBe(200);
  expect(Array.isArray(await approvals.json())).toBe(true);

  const users = await api.get("/api/admin/users", { headers: { ...admin, ...org } });
  expect(users.status()).toBe(200);
  const people = await users.json();
  const bob = people.find((u: { username: string }) => u.username === "bob");
  expect(bob).toBeTruthy();
  expect(Array.isArray(bob.teams)).toBe(true);

  const teams = await api.get(`/api/teams?orgId=${adminOrg.orgId}`, { headers: admin });
  expect(teams.status()).toBe(200);
  expect((await teams.json()).every((t: { roles: unknown[] }) => Array.isArray(t.roles))).toBe(true);

  // A member's token, or no org named, gets nothing.
  expect((await api.get("/api/admin/users", { headers: { ...member, ...org } })).status()).toBe(403);
  expect((await api.get("/api/admin/users", { headers: admin })).status()).toBe(403);
  await api.dispose();
});

test("the member tabs' routes answer a bearer token: calendar, availability, covers and swaps", async ({
  playwright,
  baseURL,
}) => {
  const api = await playwright.request.newContext({ baseURL });
  const signIn = await api.post("/api/mobile/session", {
    data: { username: "bob", password: "password123" },
  });
  const headers = { Authorization: `Bearer ${(await signIn.json()).token}` };

  // Calendar: a window of sets, each with the roster the app draws.
  const sets = await api.get("/api/sets?from=2020-01-01&to=2035-12-31", { headers });
  expect(sets.status()).toBe(200);
  const setRows = await sets.json();
  expect(Array.isArray(setRows)).toBe(true);
  for (const row of setRows.slice(0, 3)) {
    expect(typeof row.startsAt).toBe("string");
    expect(Array.isArray(row.assignments)).toBe(true);
    expect(Array.isArray(row.practices)).toBe(true);
    expect(Array.isArray(row.guestTeams)).toBe(true);
  }

  // My Sets' two extra lists.
  const covers = await api.get("/api/swaps", { headers });
  expect(covers.status()).toBe(200);
  expect(Array.isArray(await covers.json())).toBe(true);
  const incoming = await api.get("/api/swaps/proposals/incoming", { headers });
  expect(incoming.status()).toBe(200);
  expect(Array.isArray(await incoming.json())).toBe(true);

  // Availability: tap a day (far enough out that no other spec cares), see
  // it blocked all day, tap it again, see it gone.
  const day = "2031-01-15";
  const blocksOn = async () => {
    const res = await api.get("/api/availability", { headers });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.requests)).toBe(true);
    expect(Array.isArray(body.responses)).toBe(true);
    return (body.entries as { type: string; startDate: string | null; startMinute: number | null; endMinute: number | null }[]).filter(
      (e) => e.type === "SPECIFIC" && e.startDate && new Date(e.startDate).getFullYear() === 2031
    );
  };
  expect(await blocksOn()).toHaveLength(0);
  const paint = await api.post("/api/availability/block-days", {
    headers,
    data: { start: day, end: day, blocked: true },
  });
  expect(paint.status()).toBe(200);
  const painted = await blocksOn();
  expect(painted).toHaveLength(1);
  expect(painted[0].startMinute).toBe(0);
  expect(painted[0].endMinute).toBe(24 * 60);
  const free = await api.post("/api/availability/block-days", {
    headers,
    data: { start: day, end: day, blocked: false },
  });
  expect(free.status()).toBe(200);
  expect(await blocksOn()).toHaveLength(0);

  // None of it answers without the token.
  for (const path of ["/api/sets?from=2031-01-01&to=2031-01-31", "/api/availability", "/api/swaps", "/api/swaps/proposals/incoming"]) {
    expect((await api.get(path)).status()).toBe(401);
  }
  await api.dispose();
});
