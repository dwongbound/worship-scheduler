// Unit tests for the Slack call limiter (lib/rateLimit.ts). The clock and sleep
// are injected, so these run instantly and deterministically — no real waiting,
// no timer mocking.
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rateLimit";

// A controllable clock: `sleep` simply jumps it forward, which is exactly what
// a real sleep does from the limiter's point of view.
function fakeClock() {
  let t = 1000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    get time() {
      return t;
    },
  };
}

describe("createRateLimiter", () => {
  it("runs tasks one at a time, in the order they were queued", async () => {
    const clock = fakeClock();
    const limit = createRateLimiter(100, clock);
    const order: number[] = [];
    let running = 0;
    let maxConcurrent = 0;

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        limit(async () => {
          running++;
          maxConcurrent = Math.max(maxConcurrent, running);
          order.push(n);
          running--;
          return n;
        })
      )
    );

    expect(order).toEqual([1, 2, 3, 4]);
    // The whole point: a Promise.all fan-out must not become a stampede.
    expect(maxConcurrent).toBe(1);
  });

  it("leaves at least the minimum gap between consecutive starts", async () => {
    const clock = fakeClock();
    const limit = createRateLimiter(100, clock);
    const startedAt: number[] = [];

    await Promise.all(
      [1, 2, 3].map(() => limit(async () => startedAt.push(clock.now())))
    );

    // First runs immediately; each next one waits out the gap.
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(100);
    expect(startedAt[2] - startedAt[1]).toBeGreaterThanOrEqual(100);
  });

  it("doesn't wait when enough time has already passed on its own", async () => {
    const clock = fakeClock();
    const limit = createRateLimiter(100, clock);

    await limit(async () => "first");
    clock.advance(500); // a slow caller — the gap is long since satisfied
    const before = clock.now();
    await limit(async () => "second");

    expect(clock.now()).toBe(before);
  });

  it("keeps the queue moving when a task rejects", async () => {
    const clock = fakeClock();
    const limit = createRateLimiter(100, clock);

    const failed = limit(async () => {
      throw new Error("slack exploded");
    });
    const after = limit(async () => "still ran");

    // The rejection reaches ITS caller...
    await expect(failed).rejects.toThrow("slack exploded");
    // ...without poisoning anything queued behind it.
    await expect(after).resolves.toBe("still ran");
  });

  it("returns each task's own value to its own caller", async () => {
    const clock = fakeClock();
    const limit = createRateLimiter(10, clock);
    const results = await Promise.all([
      limit(async () => "a"),
      limit(async () => "b"),
      limit(async () => "c"),
    ]);
    expect(results).toEqual(["a", "b", "c"]);
  });
});
