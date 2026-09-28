// The per-org cache in front of GET /api/slack/status. What matters is that
// four surfaces asking the same question cost one request, and that a wrong
// answer can never get stuck in the cache.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSlackStatus, invalidateSlackStatus } from "@/lib/slackStatus";

const ok = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

beforeEach(() => {
  invalidateSlackStatus();
  vi.restoreAllMocks();
});

afterEach(() => {
  invalidateSlackStatus();
});

describe("fetchSlackStatus", () => {
  it("asks the server once per org, however many callers there are", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(ok({ enabled: true, installed: true }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchSlackStatus("org-1");
    const second = await fetchSlackStatus("org-1");

    expect(first).toEqual({ enabled: true, installed: true });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("collapses callers that ask at the same time into one request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(ok({ enabled: true, installed: false }));
    vi.stubGlobal("fetch", fetchMock);

    // A modal opening over a page that is still loading: both ask before
    // either answer is back.
    const [a, b] = await Promise.all([
      fetchSlackStatus("org-1"),
      fetchSlackStatus("org-1"),
    ]);

    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps orgs apart", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      ok({ enabled: url.includes("org-1"), installed: false })
    );
    vi.stubGlobal("fetch", fetchMock);

    expect((await fetchSlackStatus("org-1")).enabled).toBe(true);
    expect((await fetchSlackStatus("org-2")).enabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never caches a failure — a hiccup would hide Slack all session", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(ok({ enabled: true, installed: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchSlackStatus("org-1")).toEqual({
      enabled: false,
      installed: false,
    });
    // The next caller tries again rather than inheriting the failure.
    expect(await fetchSlackStatus("org-1")).toEqual({
      enabled: true,
      installed: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-asks after an invalidation (disconnecting a workspace)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ enabled: true, installed: true }))
      .mockResolvedValue(ok({ enabled: false, installed: false }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await fetchSlackStatus("org-1")).installed).toBe(true);
    invalidateSlackStatus("org-1");
    expect((await fetchSlackStatus("org-1")).installed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("answers offline for a missing org without calling the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchSlackStatus("")).toEqual({
      enabled: false,
      installed: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
