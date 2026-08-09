// Shared domain constants. Pure data — safe to import from client
// components, API routes, and unit tests alike.

// How many of each role a full team needs. This is THE definition of a
// team's shape; the scheduler, the set-detail modal, and the roster view
// all derive from it.
export const SLOT_CAPACITIES = {
  WORSHIP_LEADER: 1,
  VOCALS: 3, // vox
  ACOUSTIC_GUITAR: 1,
  ELECTRIC_GUITAR: 2,
  KEYS: 1, // pianos
  STRINGS: 1,
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
  KEYS: "Piano / Keys",
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
  | "REJECTED";

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

// Normalize a client-supplied group-chat lead time to a valid day count or null
// (off). Empty/non-integer/< 1 → null (off); anything larger is clamped to MAX
// (so a big number caps rather than silently turning the feature off).
export function parseGroupChatLeadDays(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, MAX_GROUP_CHAT_LEAD_DAYS);
}
