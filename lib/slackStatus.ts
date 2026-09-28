// Client-side reader for GET /api/slack/status?orgId=… — "has this org
// connected its Slack bot?".
//
// It's cached per org because four different surfaces ask the same question
// (the Team and Create tabs, the team-members modal, and the set detail modal,
// which asks again every time a set is opened), and the answer only changes
// when someone connects or disconnects a workspace. Caching the PROMISE rather
// than the value also collapses simultaneous askers — a modal opening over a
// page that's still loading makes one request, not two.
//
// Staleness is bounded by design: connecting leaves the page entirely
// (`/api/slack/install` is a full navigation, which drops this module), and the
// one in-app change — Disconnect on the Org settings page — calls
// `invalidateSlackStatus` itself.

export interface SlackStatus {
  /** Can this org send right now? True in dry-run, which dev instances use. */
  enabled: boolean;
  /** Is a real workspace connected? The one to ask about member ids. */
  installed: boolean;
}

const OFFLINE: SlackStatus = { enabled: false, installed: false };

const cache = new Map<string, Promise<SlackStatus>>();

/** This org's Slack status, from cache when we've already asked. */
export function fetchSlackStatus(orgId: string): Promise<SlackStatus> {
  if (!orgId) return Promise.resolve(OFFLINE);
  const hit = cache.get(orgId);
  if (hit) return hit;

  const pending = fetch(`/api/slack/status?orgId=${orgId}`)
    .then((r) => (r.ok ? r.json() : OFFLINE))
    .then((d) => ({ enabled: !!d.enabled, installed: !!d.installed }))
    .catch(() => {
      // A failed answer must not become the cached one — a hiccup would
      // otherwise hide Slack for the rest of the session.
      cache.delete(orgId);
      return OFFLINE;
    });

  cache.set(orgId, pending);
  return pending;
}

/** Forget what we know, for one org or (with no argument) all of them. */
export function invalidateSlackStatus(orgId?: string) {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}
