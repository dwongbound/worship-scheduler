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
