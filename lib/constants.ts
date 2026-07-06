// Shared domain constants. Pure data — safe to import from client
// components, API routes, and unit tests alike.

// How many of each role a full team needs. This is THE definition of a
// team's shape; the scheduler, the set-detail modal, and the roster view
// all derive from it.
export const SLOT_CAPACITIES = {
  WORSHIP_LEADER: 1,
  VOCALS: 4, // support vocalists
  ACOUSTIC_GUITAR: 1,
  ELECTRIC_GUITAR: 2,
  KEYS: 2, // pianos
  STRINGS: 1,
  DRUMS: 1,
  BASS: 1,
} as const;

export type Instrument = keyof typeof SLOT_CAPACITIES;

// A per-set/-template override of the team shape: how many of each role to
// fill. Partial — any role omitted falls back to the SLOT_CAPACITIES default.
export type SlotCapacityMap = Partial<Record<Instrument, number>>;

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
): Record<Instrument, number> {
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
    out[key as Instrument] = value;
  }
  return out;
}

export type AssignmentStatus = "PENDING" | "CONFIRMED" | "SWAP_REQUESTED";

// Order roles are displayed in AND filled in by the scheduler.
// Scarce/critical roles first so they get first pick of people.
export const ROLE_ORDER: Instrument[] = [
  "WORSHIP_LEADER",
  "DRUMS",
  "BASS",
  "KEYS",
  "ACOUSTIC_GUITAR",
  "ELECTRIC_GUITAR",
  "STRINGS",
  "VOCALS",
];

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  WORSHIP_LEADER: "Worship Leader",
  VOCALS: "Support Vocals",
  ACOUSTIC_GUITAR: "Acoustic Guitar",
  ELECTRIC_GUITAR: "Electric Guitar",
  KEYS: "Piano / Keys",
  STRINGS: "Strings",
  DRUMS: "Drums",
  BASS: "Bass",
};

export const STATUS_LABELS: Record<AssignmentStatus, string> = {
  PENDING: "Pending confirmation",
  CONFIRMED: "Confirmed",
  SWAP_REQUESTED: "Requesting cover",
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
