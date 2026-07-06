// A set's overall status, derived from its team's assignment statuses.
// One source of truth for the calendar's colored status dot AND the calendar
// filters. Precedence mirrors the dot: a cover request (red) beats anything
// pending (amber) beats fully confirmed (green); a set with no one is "empty".
import type { ApiSet } from "./types";

export type SetStatus = "empty" | "confirmed" | "unconfirmed" | "cover";

export function setStatus(set: Pick<ApiSet, "assignments">): SetStatus {
  if (set.assignments.length === 0) return "empty";
  if (set.assignments.some((a) => a.status === "SWAP_REQUESTED")) return "cover";
  if (set.assignments.some((a) => a.status === "PENDING")) return "unconfirmed";
  return "confirmed";
}
