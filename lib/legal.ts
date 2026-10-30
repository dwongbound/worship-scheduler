// The public legal pages' shared facts (app/privacy, app/terms).
//
// These two pages are the only part of the app a signed-out stranger can read
// (proxy.ts lets them through), because Google's OAuth verification asks for a
// privacy policy and terms URL that it can fetch without an account.
//
// `LEGAL_CONTACT_EMAIL` is the address both pages tell people to write to, so
// it has to be one that actually receives mail: set
// NEXT_PUBLIC_LEGAL_CONTACT_EMAIL per deployment (it's inlined at build).

/** Where privacy and data-deletion requests go. */
export const LEGAL_CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || "privacy@tapworship.com";

/**
 * Where someone with no account writes to get their organization set up — the
 * home page's one call to action. A different address from LEGAL_CONTACT_EMAIL
 * on purpose: that one receives deletion requests and is quoted in the policy,
 * this one is whoever is actually onboarding churches this month.
 *
 * Shown as selectable text beside the copy button, never only behind a
 * `mailto:` — a tap on one of those does nothing on plenty of devices, and
 * there is no way for the page to tell.
 */
export const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "dswong2001@gmail.com";

/**
 * The date both pages show as "Last updated". Bump it whenever the wording
 * changes in a way that matters — Google re-reads the page on review.
 */
export const LEGAL_LAST_UPDATED = "October 30, 2026";

/** The two pages, as the sign-in footer lists them. */
export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
] as const;
