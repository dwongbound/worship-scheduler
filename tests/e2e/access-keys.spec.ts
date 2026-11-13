// Personal access keys: a person makes one on their profile, an assistant
// reads TapWorship through it (GET /api/agent, and /api/mcp as an MCP server),
// a key made to act for them confirms and asks for cover through the app's own
// routes, and revoking a key shuts it off at once. Same design as vff-app's.
//
// Tess (AV on Wednesday Night, PENDING) is the subject: no other spec touches
// her, and every write here is undone before the test ends.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { login } from "./helpers";
import { CAN_WRITE_LABEL } from "@/lib/accessKeyView";

/** One MCP JSON-RPC call through the key. */
async function mcp(request: APIRequestContext, key: string, method: string, params?: object) {
  return request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${key}` },
    data: { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) },
  });
}

/** A tool's result: its parsed JSON, or the error text the model would read. */
async function tool(request: APIRequestContext, key: string, name: string, args: object = {}) {
  const res = await mcp(request, key, "tools/call", { name, arguments: args });
  const body = await res.json();
  if (body.error) return { protocolError: body.error.message as string };
  const text = body.result.content[0].text as string;
  if (body.result.isError) return { toolError: text };
  return { data: JSON.parse(text) };
}

/** Make a key on the profile card and read it off the once-only panel. */
async function makeKey(page: Page, name: string, canWrite = false): Promise<string> {
  const card = page.getByTestId("access-keys");
  if (canWrite) await card.getByLabel(CAN_WRITE_LABEL).check();
  await card.getByLabel("Name for a new key").fill(name);
  await card.getByRole("button", { name: "Create key" }).click();
  const shown = card.getByTestId("new-access-key");
  await expect(shown).toHaveText(/^tw_\S{40,}$/);
  const key = (await shown.textContent())!.trim();
  await card.getByRole("button", { name: "Close", exact: true }).click();
  await expect(shown).toHaveCount(0);
  return key;
}

/** Revoke every key the signed-in person has, so later runs start clean. */
async function revokeAll(page: Page) {
  const keys = (await (await page.request.get("/api/access-keys")).json()) as { id: string }[];
  for (const k of keys) await page.request.delete(`/api/access-keys/${k.id}`);
}

test("a key reads TapWorship read-only, and stops the moment it's revoked", async ({ page, playwright }) => {
  await login(page, "tess");
  await page.goto("/profile");
  const card = page.getByTestId("access-keys");
  await expect(card.getByRole("heading", { name: "Personal access keys" })).toBeVisible();
  const key = await makeKey(page, "Jarvis e2e");

  // Listed by name, with no part of the key on screen.
  await expect(card.getByText("Jarvis e2e")).toBeVisible();
  await expect(card.getByText(/^Read-only · .+ · never used$/)).toBeVisible();
  await expect(card.getByText(key.slice(0, 10))).toHaveCount(0);

  // A fresh context: no session cookie, only the key.
  const outside = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  expect((await outside.get("/api/agent")).status()).toBe(401);

  const snapshot = await outside.get("/api/agent", { headers: { Authorization: `Bearer ${key}` } });
  expect(snapshot.status()).toBe(200);
  const body = await snapshot.json();
  expect(body.person.name).toBe("Tess Tran");
  const wednesday = body.mySets.sets.find((s: { name: string }) => s.name === "Wednesday Night");
  expect(wednesday.yourSeats[0]).toMatchObject({ status: "PENDING" });
  expect(wednesday.needsYourConfirmation).toBe(true);
  expect(body.schedule.sets.length).toBeGreaterThanOrEqual(body.mySets.sets.length);
  expect(Array.isArray(body.covers)).toBe(true);
  // Nobody's email rides along.
  expect(JSON.stringify(body)).not.toMatch(/@example\.com|@test/);

  // The same data as MCP tools.
  const init = await (await mcp(outside, key, "initialize", { protocolVersion: "2025-06-18" })).json();
  expect(init.result.serverInfo.name).toBe("tapworship");
  expect(init.result.instructions).toMatch(/read-only/);
  const list = await (await mcp(outside, key, "tools/list")).json();
  const names = list.result.tools.map((t: { name: string }) => t.name);
  expect(names).toContain("get_my_sets");
  expect(names).not.toContain("confirm_set");
  const mine = await tool(outside, key, "get_my_sets");
  expect(mine).toHaveProperty("data.sets");

  // A read-only key can't write through MCP, nor reach the seat route directly.
  const seatId = wednesday.yourSeats[0].assignmentId as string;
  expect(await tool(outside, key, "confirm_set", { assignmentId: seatId })).toHaveProperty("protocolError");
  const direct = await outside.patch(`/api/assignments/${seatId}`, {
    headers: { Authorization: `Bearer ${key}` },
    data: { action: "confirm" },
  });
  expect(direct.status()).toBe(401);

  // A signed-in browser session is NOT a key: the route takes keys only.
  expect((await page.request.get("/api/agent")).status()).toBe(401);

  // Revoke from the profile, through the confirm window.
  await card.getByRole("button", { name: "Revoke" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText('Revoke "Jarvis e2e"?')).toBeVisible();
  await dialog.getByRole("button", { name: "Revoke" }).click();
  await expect(card.getByText("Jarvis e2e")).toHaveCount(0);

  expect((await outside.get("/api/agent", { headers: { Authorization: `Bearer ${key}` } })).status()).toBe(401);
  expect((await mcp(outside, key, "tools/list")).status()).toBe(401);
  await outside.dispose();
});

test("a key made to act for you asks for cover and withdraws it through MCP", async ({ page, playwright }) => {
  await login(page, "tess");
  await page.goto("/profile");
  const card = page.getByTestId("access-keys");
  const key = await makeKey(page, "Jarvis acts e2e", true);
  await expect(card.getByText(/^Can act for you · /)).toBeVisible();
  // The box goes back to off for the next key.
  await expect(card.getByLabel(CAN_WRITE_LABEL)).not.toBeChecked();

  const outside = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  const init = await (await mcp(outside, key, "initialize", {})).json();
  expect(init.result.instructions).toMatch(/confirm the person's own sets/);
  const names = (await (await mcp(outside, key, "tools/list")).json()).result.tools.map(
    (t: { name: string }) => t.name
  );
  expect(names).toEqual(
    expect.arrayContaining(["confirm_set", "request_cover", "cancel_cover_request", "take_cover"])
  );

  const sets = (await tool(outside, key, "get_my_sets")) as {
    data: { sets: { name: string; yourSeats: { assignmentId: string }[] }[] };
  };
  const seatId = sets.data.sets.find((s) => s.name === "Wednesday Night")!.yourSeats[0].assignmentId;

  expect(await tool(outside, key, "request_cover", { assignmentId: seatId, reason: "e2e trip" })).toEqual({
    data: { done: "requestSwap", assignmentId: seatId, status: "Asked for cover" },
  });
  // The app itself shows it: My Sets lists the seat as asked for cover.
  await page.goto("/set-manager");
  await expect(page.getByRole("button", { name: "Cancel cover request" }).first()).toBeVisible();

  // You can't take your own cover: the app's own eligibility rule, as words.
  expect(await tool(outside, key, "take_cover", { assignmentId: seatId })).toHaveProperty("toolError");
  // Nor touch somebody else's seat: the route's ownership check.
  const schedule = (await tool(outside, key, "get_schedule")) as { data: { sets: { setId: string }[] } };
  expect(schedule.data.sets.length).toBeGreaterThan(0);
  expect(await tool(outside, key, "confirm_set", { assignmentId: "not-a-real-seat" })).toHaveProperty(
    "toolError"
  );

  // Back to how it was: withdrawn = not confirmed yet.
  expect(await tool(outside, key, "cancel_cover_request", { assignmentId: seatId })).toEqual({
    data: { done: "cancelSwap", assignmentId: seatId, status: "Not confirmed yet" },
  });

  await outside.dispose();
  await revokeAll(page);
});
