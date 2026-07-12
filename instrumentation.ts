// Runs once at server startup, before any request (Next.js instrumentation
// hook). Vercel reserves the TZ env var — it can't be set in the dashboard —
// but this app interprets recurring set times in the server timezone (see
// the CLAUDE.md gotchas), so we pin the process timezone here from the
// non-reserved APP_TZ variable instead. Node re-reads TZ on change, so this
// affects all subsequent Date math. Local docker keeps setting TZ directly;
// APP_TZ simply wins when present.
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.env.TZ = process.env.APP_TZ ?? process.env.TZ ?? "America/Los_Angeles";
  }
}
