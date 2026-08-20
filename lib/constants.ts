// Shared domain constants. Pure data — safe to import from client
// components, API routes, and unit tests alike.

// How many of each role a full team needs. This is THE definition of a
// team's shape; the scheduler, the set-detail modal, and the roster view
// all derive from it.
export const SLOT_CAPACITIES = {
  WORSHIP_LEADER: 1,
  VOCALS: 2, // vox
  ACOUSTIC_GUITAR: 1,
  ELECTRIC_GUITAR: 2,
  KEYS: 1, // pianos
  // Strings aren't part of the standard shape — a set that wants them raises
  // this per-set in the capacity editor. 0 is a valid capacity everywhere
  // (validateSlotCapacities floors at 0), so the role just renders no slots.
  STRINGS: 0,
  DRUMS: 1,
  BASS: 1,
} as const;

// The capacity-bearing "band" roles — the ones that make up a team's shape.
// These are exactly the keys of SLOT_CAPACITIES.
export type BandRole = keyof typeof SLOT_CAPACITIES;

// Choir is a real Instrument (people list it as a skill, and it fills slots on a
// set) but it is NOT a band role: it has no fixed slot count and never appears
// in SLOT_CAPACITIES / ROLE_ORDER / the capacity editor. Instead it's an
// unbounded, admin-managed list on a set — the set-detail modal's "Auto
// schedule" seats everyone available, and admins add the rest by hand.
export const CHOIR = "CHOIR" as const;

// Every schedulable role: the band roles plus choir. `Instrument` mirrors the
// Prisma enum of the same name.
export type Instrument = BandRole | typeof CHOIR;

// A per-set/-template override of the team shape: how many of each band role to
// fill. Partial — any role omitted falls back to the SLOT_CAPACITIES default.
// (Choir has no capacity, so it's intentionally excluded from this map.)
export type SlotCapacityMap = Partial<Record<BandRole, number>>;

// Largest number of one instrument we allow on a single set — a sanity cap
// on the capacity editor + API validation.
export const MAX_SLOTS_PER_ROLE = 20;

/**
 * Resolve a stored (possibly partial or null) capacity map into a full
 * team shape, filling any missing role from the global default. This is THE
 * way to read a set's team shape everywhere — never index SLOT_CAPACITIES
 * directly once a set may carry its own override.
 */
export function resolveCapacities(
  stored?: SlotCapacityMap | null
): Record<BandRole, number> {
  return { ...SLOT_CAPACITIES, ...(stored ?? {}) };
}

/**
 * Validate a capacity map arriving from an API request body. Returns the
 * cleaned map (keys limited to real instruments, values integers in
 * [0, MAX_SLOTS_PER_ROLE]), or null if anything is malformed.
 */
export function validateSlotCapacities(raw: unknown): SlotCapacityMap | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: SlotCapacityMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in SLOT_CAPACITIES)) return null;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > MAX_SLOTS_PER_ROLE
    ) {
      return null;
    }
    out[key as BandRole] = value;
  }
  return out;
}

// The selectable musical keys for a song, in chromatic order. Flat spelling
// (Bb, Db, Ab, Gb) is used deliberately: it matches how the shared Drive names
// its chart files ("A Thousand Hallelujahs (Db).pdf"), so the planned per-set
// Drive lookup can match on the stored key verbatim. A song's key may also be
// null (unspecified) — this list is only the concrete choices.
export const SONG_KEYS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

export type SongKey = (typeof SONG_KEYS)[number];

// Longest a song title may be — a sanity cap on the setlist editor + API.
export const MAX_SONG_TITLE_LENGTH = 200;
// No sane setlist is longer than this; caps the replace-all songs payload.
export const MAX_SONGS_PER_SET = 50;

/**
 * Normalize a client-supplied song key to a valid SONG_KEYS value or null.
 * Anything not in the list (including "", undefined) becomes null (unspecified)
 * rather than an error — the key is optional, so a bad value just clears it.
 */
export function normalizeSongKey(raw: unknown): SongKey | null {
  return SONG_KEYS.includes(raw as SongKey) ? (raw as SongKey) : null;
}

export type AssignmentStatus =
  | "PENDING"
  | "CONFIRMED"
  | "SWAP_REQUESTED"
  | "PENDING_SWAP"
  | "PENDING_APPROVAL";

// Order roles are displayed in AND filled in by the scheduler.
// Scarce/critical roles first so they get first pick of people.
export const ROLE_ORDER: BandRole[] = [
  "WORSHIP_LEADER",
  "DRUMS",
  "BASS",
  "KEYS",
  "ACOUSTIC_GUITAR",
  "ELECTRIC_GUITAR",
  "STRINGS",
  "VOCALS",
];

// Every selectable role, in display order: the band roles (scarce-first) then
// choir. Used for the user instrument picker, instrument/role validation, and
// anywhere a roster is listed for display (Slack summaries, .ics titles) — i.e.
// the places that must include choir, unlike the capacity-only ROLE_ORDER.
export const ALL_INSTRUMENTS: Instrument[] = [...ROLE_ORDER, CHOIR];

// The only roles a musical director can lead from. A required-MD set is only
// "covered" when an MD is assigned to one of these; the auto-scheduler seats a
// reserved MD into one of them (never drums/vocals/etc.).
export const MD_ROLES: BandRole[] = ["KEYS", "ELECTRIC_GUITAR", "BASS"];

// A person normally fills at most one role on a set. The only sanctioned
// double-ups are these unordered pairs: worship leader + acoustic guitar, and
// acoustic guitar + vox. No other pairing is allowed (e.g. keys + electric
// guitar), and a person may only double up when EVERY pair among their roles is
// listed here — so worship leader + vox (not adjacent to acoustic) is out, as
// is the three-way worship leader + acoustic + vox. See `rolesMayOverlap`.
export const OVERLAP_ALLOWED_PAIRS: [Instrument, Instrument][] = [
  ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"],
  ["ACOUSTIC_GUITAR", "VOCALS"],
];

// The acoustic guitarist must double as one of these — the auto-scheduler only
// fills a set's acoustic slot with someone already seated as the worship leader
// or a vocalist who also plays acoustic. If none of them play it, the slot is
// left empty rather than seating a dedicated acoustic-only player. (These are
// exactly the roles acoustic guitar may overlap with — see OVERLAP_ALLOWED_PAIRS.)
export const ACOUSTIC_HOST_ROLES: BandRole[] = ["WORSHIP_LEADER", "VOCALS"];

// True if two distinct roles may be held by the same person on one set.
export function rolesMayOverlap(a: Instrument, b: Instrument): boolean {
  return OVERLAP_ALLOWED_PAIRS.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a)
  );
}

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  WORSHIP_LEADER: "Worship Leader",
  VOCALS: "Vox",
  ACOUSTIC_GUITAR: "Acoustic Guitar",
  ELECTRIC_GUITAR: "Electric Guitar",
  KEYS: "Keys",
  STRINGS: "Strings",
  DRUMS: "Drums",
  BASS: "Bass",
  CHOIR: "Choir",
};

export const STATUS_LABELS: Record<AssignmentStatus, string> = {
  PENDING: "Pending confirmation",
  CONFIRMED: "Confirmed",
  SWAP_REQUESTED: "Requesting cover",
  PENDING_SWAP: "Pending swap",
  PENDING_APPROVAL: "Pending approval",
};

export type SetHistoryEventType =
  | "ADDED"
  | "REMOVED"
  | "REASSIGNED"
  | "CONFIRMED"
  | "SWAP_REQUESTED"
  | "SWAP_CANCELED"
  | "SWAP_TAKEN"
  | "SWAP_PROPOSED"
  | "SWAP_ACCEPTED"
  | "APPROVED"
  | "REJECTED"
  | "SETLIST_CHANGED";

// All event types + friendly labels — drives the Team Activity filter dropdown.
export const ALL_HISTORY_TYPES: SetHistoryEventType[] = [
  "ADDED",
  "REMOVED",
  "REASSIGNED",
  "CONFIRMED",
  "SWAP_REQUESTED",
  "SWAP_CANCELED",
  "SWAP_TAKEN",
  "SWAP_PROPOSED",
  "SWAP_ACCEPTED",
  "APPROVED",
  "REJECTED",
  "SETLIST_CHANGED",
];

export const HISTORY_TYPE_LABELS: Record<SetHistoryEventType, string> = {
  ADDED: "Added",
  REMOVED: "Removed",
  REASSIGNED: "Reassigned (by admin)",
  CONFIRMED: "Confirmed",
  SWAP_REQUESTED: "Cover requested",
  SWAP_CANCELED: "Cover canceled",
  SWAP_TAKEN: "Cover taken",
  SWAP_PROPOSED: "Swap proposed",
  SWAP_ACCEPTED: "Swap accepted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SETLIST_CHANGED: "Setlist changed",
};

export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// How many days before a set the auto group-chat channel is created. The set +
// template forms take an arbitrary day count (blank = off); this is just a sane
// upper bound so a typo can't schedule a channel absurdly far out.
export const MAX_GROUP_CHAT_LEAD_DAYS = 365;

// The lead times offered in the set menu's "Auto GC" picker. Free-form day
// counts are still accepted by the API (the template/create forms use a plain
// number field); this is just the short list of common choices. `days: null`
// = never auto-create.
export const GROUP_CHAT_LEAD_OPTIONS: { days: number | null; label: string }[] =
  [
    { days: null, label: "No Auto GC" },
    { days: 1, label: "1 day before" },
    { days: 2, label: "2 days before" },
    { days: 3, label: "3 days before" },
    { days: 4, label: "4 days before" },
    { days: 5, label: "5 days before" },
    { days: 7, label: "1 week before" },
  ];

// Normalize a client-supplied group-chat lead time to a valid day count or null
// (off). Empty/non-integer/< 1 → null (off); anything larger is clamped to MAX
// (so a big number caps rather than silently turning the feature off).
export function parseGroupChatLeadDays(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, MAX_GROUP_CHAT_LEAD_DAYS);
}

// ── Daily digest ───────────────────────────────────────────────────────────

// When the daily "here's what needs you" Slack DM goes out, as minutes from
// midnight in the server's TZ. The target is 8:00 AM, deliberately NOT
// user-configurable — the only per-person setting is User.dailyDigest (on/off).
export const DIGEST_SEND_MINUTE = 8 * 60;

// The cron can't hit DIGEST_SEND_MINUTE exactly: Vercel schedules crons in UTC,
// so a fixed slot drifts an hour against the server's local time twice a year
// (and free-tier crons aren't minute-accurate). So the sender accepts any run
// inside this morning window rather than requiring >= 8:00 exactly — a hard
// cutoff silently skipped every winter, when the UTC slot landed at 7 AM local.
// Once-a-day is enforced by OrgMembership.digestSentAt, not by these bounds;
// the window's only job is to keep a stray run (say, a manual curl at midnight)
// from DMing everyone "here's your day" at the wrong hour.
export const DIGEST_WINDOW_START_MINUTE = 6 * 60;
export const DIGEST_WINDOW_END_MINUTE = 12 * 60;

// How far ahead the digest looks — the default for a new org. The live value is
// per org (Org.digestUpcomingDays, edited on the Org settings page) and drives
// BOTH "confirm your spot on N sets…" and the admin "N sets … have people who
// haven't confirmed", as well as the phrase the digest quotes for the window.
export const DIGEST_UPCOMING_DAYS = 7;

// Bounds for that setting. Below a day the window means nothing; a very long
// one turns the digest into a standing to-do list nobody acts on. Enforced by
// the API route on write and clamped again in lib/digest.ts on read.
export const DIGEST_UPCOMING_DAYS_MIN = 1;
export const DIGEST_UPCOMING_DAYS_MAX = 60;

// The horizons offered in the Org settings dropdown. Any integer in range is
// accepted by the API — these are just the ones worth one click.
export const DIGEST_UPCOMING_DAYS_PRESETS = [7, 14, 30] as const;

/**
 * How the digest SAYS its look-ahead window, so the reader knows what the count
 * covers. The common horizons get their natural phrasing; anything else is
 * spelled out in days.
 *
 * Lives here rather than in lib/digest.ts because the Org settings page shows
 * the same phrase back to the admin choosing the window — and digest.ts imports
 * prisma, which must never reach a client bundle.
 */
export function windowPhrase(days: number): string {
  if (days === 1) return "today";
  if (days === 7) return "in the next week";
  if (days === 14) return "in the next two weeks";
  if (days === 30) return "in the next month";
  return `in the next ${days} days`;
}

// ── Sets window (GET /api/sets) ────────────────────────────────────────────

// How far either side of today GET /api/sets reaches when the caller doesn't
// ask for a window. Every existing caller relies on this default, so changing
// it changes what an unparameterized fetch returns.
export const SETS_WINDOW_DEFAULT_DAYS = 92;

// The widest span a caller may request, so a hand-rolled `?from=1900-01-01`
// can't ask for the whole table. Comfortably covers the year-long option in
// the Set Manager plus a month of calendar spillover.
export const SETS_WINDOW_MAX_DAYS = 400;

// How far ahead the Set Manager lists your sets. The first entry is the
// default; each drives both the visible list and the /api/sets window it
// fetches, so anything shown can always open its detail modal.
export const SET_MANAGER_HORIZONS: { months: number; label: string }[] = [
  { months: 3, label: "Next 3 months" },
  { months: 6, label: "Next 6 months" },
  { months: 12, label: "Next year" },
];
