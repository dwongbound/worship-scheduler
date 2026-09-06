// Linking to one set.
//
// A set's detail modal is a URL, not just a click: the calendar mirrors the
// open set into ?set=<id>, and anything that talks about a set — a Slack DM, a
// digest bullet, a copied address — points at that same path so it opens
// straight to that set's roster.
//
// The id in the link is the set's own id. It's long-ish, but it needs no extra
// column, can't collide, and is already what the calendar puts in the URL.
//
// Pure — server notifications and the client both build links through here, so
// the param name is defined once.

/** The query param both set tabs read their open set from. */
export const SET_PARAM = "set";

/**
 * The two tabs that can open a set's detail modal. "calendar" is the general
 * answer to "show me this set"; "set-manager" is the one to send someone to
 * when the thing they need to DO about it — take a cover, accept a swap,
 * confirm a spot — is a button on that set's row there. Landing on that tab
 * also rings and scrolls to the row.
 */
export type SetTab = "calendar" | "set-manager";

/** App-relative path that opens `tab` with this set's modal already up. */
export function setLinkPath(setId: string, tab: SetTab = "calendar"): string {
  return `/${tab}?${SET_PARAM}=${encodeURIComponent(setId)}`;
}
