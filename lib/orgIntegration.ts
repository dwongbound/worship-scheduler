// Which transport an org talks through — the ONE place a provider gets chosen.
//
// The generic half lives alongside this file in lib/ (messagingTransport.ts,
// messageFormat.ts). Everything a provider owns — its transport, its markup, and in
// future its icon — lives in lib/integrations/<name>/, so adding a provider means
// adding a folder and one branch in buildTransport below.
//
// Today every org is Slack, so this reads the Slack bot token and wraps it. When
// Discord lands, `transportForOrg` is the function that branches (on a provider
// column on Org), and nothing in lib/slack.ts has to change to follow it.
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";
import {
  notificationEnabled,
  parseNotificationPrefs,
  type NotificationType,
} from "./notificationPrefs";
import { SlackTransport } from "./integrations/slack";
import { integrationDryRun, MessagingTransport } from "./messagingTransport";

export { integrationDryRun, MessagingTransport, DM_FIELDS } from "./messagingTransport";
export type { MessagingCapabilities, IntegrationName, DmTarget } from "./messagingTransport";
export { splitMessage } from "./messageFormat";
export type { MessageFormat } from "./messageFormat";
export { SLACK_FORMAT } from "./integrations/slack";

// A stored credential is encrypted at rest; a key rotation (or a corrupt value)
// reads as "not connected" rather than throwing mid-notification.
function decryptCredential(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}

/**
 * The transport for one org, or null if that org hasn't connected an integration.
 *
 * Credentials are per-org (Slack's Flow B install), so a message to org A must
 * use A's transport — never a shared/env one, which would post into the wrong
 * workspace. In dry-run a transport is always returned (with no credential), so
 * the whole flow runs without sending anything.
 */
export async function transportForOrg(orgId: string): Promise<MessagingTransport | null> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { slackBotToken: true },
  });
  return transportForCredential(org?.slackBotToken);
}

/**
 * The same thing for a caller that has ALREADY read the org's stored credential
 * as part of a wider query — so a sweep over many memberships doesn't re-read one
 * org row per person. Takes the value exactly as stored (encrypted).
 */
export function transportForCredential(
  stored: string | null | undefined
): MessagingTransport | null {
  return buildTransport(decryptCredential(stored));
}

/**
 * Whether an org can currently send messages: its bot is installed, or we're in
 * dry-run. Per-org, so a global "is messaging on" flag would be misleading.
 */
export async function isOrgMessagingConnected(orgId: string): Promise<boolean> {
  // Dry-run is connected by definition, and answering without the org read keeps
  // this as cheap as it was before transports existed.
  if (integrationDryRun()) return true;
  return (await transportForOrg(orgId)) !== null;
}

/**
 * Whether an org has actually connected a workspace — a stored credential,
 * regardless of dry-run.
 *
 * Distinct from isOrgMessagingConnected on purpose. That one answers "can we send
 * right now?", which dry-run makes true for EVERY org (sending nothing is the
 * point). This one answers "is there a real workspace behind this org?", which is
 * what anything about workspace-scoped identity has to ask — a member id means
 * nothing without a workspace to resolve it in.
 */
export async function isOrgMessagingInstalled(orgId: string): Promise<boolean> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { slackBotToken: true },
  });
  return !!org?.slackBotToken;
}

/**
 * The two things every personal DM has to know, from ONE read of the org row:
 * whether this kind of message is still switched on (Org settings →
 * Notifications, see lib/notificationPrefs.ts) and which transport to send it
 * with. They're always needed together, so asking separately meant two queries
 * for the same row on every notification.
 *
 * null means "don't send" — the type is switched off for this org, or messaging isn't
 * connected and we're not in dry-run.
 *
 * Only DMs are gated this way. A set's group chat and a team's weekly summary are
 * a room's messages rather than a person's, and aren't in the catalog.
 */
export async function orgMessagingContext(
  orgId: string,
  type: NotificationType
): Promise<{ messaging: MessagingTransport } | null> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { slackBotToken: true, notificationPrefs: true },
  });
  const prefs = parseNotificationPrefs(org?.notificationPrefs);
  if (!notificationEnabled(prefs, type)) return null;

  const messaging = transportForCredential(org?.slackBotToken);
  return messaging ? { messaging } : null;
}

/**
 * Wrap a credential in its provider's transport. Null credential + dry-run still
 * yields a transport (it sends nothing); null credential without dry-run means
 * the org simply isn't connected.
 *
 * This is where a second provider gets added: read the org's provider column and
 * return a DiscordTransport instead. Dry-run keeps defaulting to Slack because
 * that's the only shape an unconnected org can be described by today.
 */
function buildTransport(credential: string | null): MessagingTransport | null {
  if (!credential && !integrationDryRun()) return null;
  return new SlackTransport(credential);
}
