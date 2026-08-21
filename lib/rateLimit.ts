// A tiny serializing rate limiter.
//
// Every Slack call in lib/slack.ts goes through one of these. It does two
// things: runs queued tasks ONE AT A TIME (so a `Promise.all` fan-out of 40 DMs
// stops arriving as 40 simultaneous requests), and keeps a minimum gap between
// the start of one task and the next.
//
// The gap is a burst preventer, not the actual guarantee — Slack's real limits
// vary per method and per channel, so the thing that keeps us honest is
// obeying `Retry-After` when Slack pushes back (see slackApi). Setting the gap
// too high would be worse than useless: the daily digest sends one DM per
// person per org from a single cron invocation, so a full second between calls
// would blow the function's time budget long before it finished.
//
// Pure and dependency-free — the clock and sleep are injectable so the unit
// tests can run it without real time passing.

export interface RateLimiterOptions {
  /** Milliseconds to read as "now". Defaults to Date.now. */
  now?: () => number;
  /** How to wait. Defaults to a real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export type RateLimiter = <T>(task: () => Promise<T>) => Promise<T>;

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Build a limiter that runs tasks in call order, one at a time, with at least
 * `minIntervalMs` between consecutive starts.
 *
 * A task that throws does NOT break the queue — the next one still runs, and
 * the rejection is handed back to whoever queued it.
 */
export function createRateLimiter(
  minIntervalMs: number,
  options: RateLimiterOptions = {}
): RateLimiter {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;

  // The end of the queue: each new task chains onto it, which is what makes
  // execution serial. `lastStartedAt` is -Infinity so the first task never waits.
  let tail: Promise<unknown> = Promise.resolve();
  let lastStartedAt = -Infinity;

  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(async () => {
      const waitFor = lastStartedAt + minIntervalMs - now();
      if (waitFor > 0) await sleep(waitFor);
      lastStartedAt = now();
      return task();
    });
    // The queue follows the SETTLED task, swallowing errors so one failure
    // can't reject every call queued behind it. The caller still sees its own.
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}
