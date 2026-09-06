// Which of the bot's PERSONAL notifications an org sends.
//
// Everything here is about DMs — the messages one person receives about their
// own schedule. Channel posts (a set's group chat, a team's weekly summary)
// aren't in this list: they're a room's messages, not a person's, and they're
// already controlled by whether the org has a channel at all.
//
// Storage is a plain key→bool map on Org.notificationPrefs. A key that ISN'T in
// the map is ON: every org predates this setting, and a new notification type
// added later shouldn't switch itself off for orgs that never saw the toggle.
// So the map only ever needs to record the offs, and `null` = everything on.
//
// Pure (no prisma, no React) — the settings UI, the API validation and the
// senders in lib/slack.ts all read the same catalog.

// One switchable notification. `key` is what's stored, so it must never change;
// label/description are what the admin reads on the org settings page.
export interface NotificationTypeDef {
  key: NotificationType;
  label: string;
  description: string;
}

export type NotificationType =
  | "COVER_REQUESTED"
  | "COVER_TAKEN"
  | "SWAP_PROPOSED"
  | "SWAP_RESOLVED"
  | "ROSTER_CHANGE"
  | "AVAILABILITY_REQUEST"
  | "APPROVAL_PENDING"
  | "DAILY_DIGEST";

// The catalog, in the order the settings page lists it: the things everyone
// gets first, the admin-only one and the daily digest last.
export const NOTIFICATION_TYPES: NotificationTypeDef[] = [
  {
    key: "COVER_REQUESTED",
    label: "Cover needed",
    description:
      "When someone asks for cover, everyone who plays that role on the set's team and is free at that time gets a DM.",
  },
  {
    key: "COVER_TAKEN",
    label: "Your cover was picked up",
    description:
      "Tells the person who asked for cover that someone has taken their slot.",
  },
  {
    key: "SWAP_PROPOSED",
    label: "Swap offered to you",
    description:
      "DMs the person a trade is aimed at so they can accept or decline it.",
  },
  {
    key: "SWAP_RESOLVED",
    label: "Swap accepted or declined",
    description: "Tells whoever offered a trade what the other person decided.",
  },
  {
    key: "ROSTER_CHANGE",
    label: "Added to or taken off a set",
    description:
      "DMs the person whose place on a set changed — including the one summary DM each person gets when a generated plan is applied.",
  },
  {
    key: "AVAILABILITY_REQUEST",
    label: "New availability request",
    description:
      "Asks everyone a request targets to fill in the dates they can't serve.",
  },
  {
    key: "APPROVAL_PENDING",
    label: "Approval waiting (admins)",
    description:
      "Tells this org's admins when a cover or swap is sitting on the Approvals tab.",
  },
  {
    key: "DAILY_DIGEST",
    label: "Daily morning summary",
    description:
      "Each person's morning DM listing what needs them that day. People can also switch it off just for themselves, in their profile.",
  },
];

// The stored shape: only the keys the admin has actually decided on.
export type NotificationPrefs = Partial<Record<NotificationType, boolean>>;

const KEYS = new Set<string>(NOTIFICATION_TYPES.map((t) => t.key));

/**
 * Is this notification type on for an org? Anything unrecorded — a null column,
 * a key the map has never held, an unknown type — is ON, so a notification is
 * only silenced by an admin deliberately switching it off.
 */
export function notificationEnabled(
  prefs: NotificationPrefs | null | undefined,
  type: NotificationType
): boolean {
  return prefs?.[type] !== false;
}

/**
 * A stored `Org.notificationPrefs` (prisma Json — could be anything) as the
 * typed map. Unknown keys and non-boolean values are dropped rather than
 * trusted, so a hand-edited row can't turn into a weird toggle in the UI.
 */
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: NotificationPrefs = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (KEYS.has(key) && typeof value === "boolean") {
      out[key as NotificationType] = value;
    }
  }
  return out;
}

/**
 * Validate a PATCH body's partial map. Returns null (a 400 for the caller) when
 * it isn't an object or names something that isn't a notification type — a typo
 * in a key would otherwise store a toggle nothing reads.
 */
export function validateNotificationPrefs(raw: unknown): NotificationPrefs | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: NotificationPrefs = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEYS.has(key) || typeof value !== "boolean") return null;
    out[key as NotificationType] = value;
  }
  return out;
}

/**
 * The stored map after an admin flips some switches: the old map with the new
 * decisions written over it. Merging (rather than replacing) is what lets the
 * settings page send just the row that changed.
 */
export function mergeNotificationPrefs(
  current: NotificationPrefs,
  update: NotificationPrefs
): NotificationPrefs {
  return { ...current, ...update };
}
