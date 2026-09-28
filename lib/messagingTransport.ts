// The provider-neutral half of chat integration.
//
// One abstract transport owns every behaviour we've learned the hard way —
// pacing, 429 backoff, dry-run, never-throw, the permanent-DM-channel cache and
// its self-healing, and message chunking — and leaves a provider only the parts
// that are genuinely its own: endpoint shapes, auth header, how it signals
// success and rate limiting, and the handful of operations it supports at all.
//
// Slack is the only subclass today (lib/integrations/slack/). The point of the split is that
// adding Discord means writing one subclass, not auditing the ~15 notification
// helpers in lib/slack.ts — none of which know which provider they're talking to.
//
// The two hard rules from the original Slack module are enforced HERE, once, for
// every provider:
//   1. Everything no-ops when the org hasn't connected chat, so the app runs
//      identically with no provider configured (dev/test/CI).
//   2. Nothing throws — an outage must never break a db mutation. Failures are
//      logged and swallowed; helpers return false/null instead.
//
// Server-only (imports prisma). The client talks to it via the API routes.
import { prisma } from "./prisma";
import type { RateLimiter } from "./rateLimit";
import { splitMessage, type MessageFormat } from "./messageFormat";

export type IntegrationName = "SLACK" | "DISCORD";

/**
 * What a provider can and cannot do. These exist because the differences are
 * real and the callers need to branch on them rather than discover a silent
 * no-op — see the notes on each.
 */
export type MessagingCapabilities = {
  /**
   * Can resolve a member id from an email address, which is what makes linking
   * automatic (see autoPopulateSlackIds / linkSlackIdForUser in lib/slack.ts).
   * FALSE for Discord — its API exposes no member email at any permission
   * level, so every member must link their own account. Callers must check this
   * rather than calling lookupUserIdByEmail and treating null as "not found".
   */
  emailLookup: boolean;
  /** Group chats carry a topic separate from their name (Discord threads don't). */
  groupChatTopics: boolean;
  /** An ordinary message can hyperlink (false on Discord outside embeds). */
  inlineLinks: boolean;
  /**
   * A DM to a member of a connected workspace always goes through. FALSE for
   * Discord, where a user can refuse DMs from server members and the send 403s
   * with no override.
   */
  guaranteedDms: boolean;
};

/**
 * The membership fields a cached DM needs. Column names are still Slack's
 * because those are the columns that exist; a provider reads its own pair via
 * the accessors below, so adding Discord means adding columns here and to
 * DM_FIELDS, not touching the notifiers.
 */
export type DmTarget = {
  id: string;
  slackUserId: string | null;
  slackDmChannelId: string | null;
};

/** The prisma `select` that produces a DmTarget — next to the type so they can't drift. */
export const DM_FIELDS = {
  id: true,
  slackUserId: true,
  slackDmChannelId: true,
} as const;

/** What one HTTP attempt turned out to be. */
export type Attempt =
  | { kind: "ok"; data: Record<string, any> }
  | { kind: "failed"; error: string }
  | { kind: "limited"; retryAfterMs: number };

// How long to respect a 429 that arrives without a usable hint, and the ceiling
// on one asking for an implausibly long wait (we'd rather drop the message and
// retry on the next run than hold a serverless function open).
const RETRY_AFTER_FALLBACK_MS = 1000;
const RETRY_AFTER_MAX_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dry-run mode: run every code path — queries, eligibility filtering, message
 * building — but log the would-be API calls instead of sending them. Nothing is
 * created, nobody is messaged. Works without any credential, so a dev instance
 * can exercise the whole flow at zero risk.
 *
 * `SLACK_DRY_RUN` is kept as an alias because it's set in existing env files.
 */
export function integrationDryRun(): boolean {
  const flag = process.env.INTEGRATION_DRY_RUN ?? process.env.SLACK_DRY_RUN;
  return flag === "1" || flag === "true";
}

export abstract class MessagingTransport {
  abstract readonly integration: IntegrationName;
  abstract readonly capabilities: MessagingCapabilities;
  abstract readonly fmt: MessageFormat;

  /** What this integration calls itself in logs, e.g. "slack". */
  protected get logTag(): string {
    return this.integration.toLowerCase();
  }

  /**
   * The credential every call is sent with. Null is legal ONLY in dry-run, where
   * nothing is actually sent — `request` refuses to fetch without one otherwise.
   */
  protected constructor(protected readonly credential: string | null) {}

  // ── Hooks a provider implements ────────────────────────────────────────────

  /**
   * The queue this provider's calls share. ONE limiter per provider, module-level
   * in the subclass, so every path — digests, DMs, group chats — shares a single
   * queue rather than each fan-out pacing itself in ignorance of the others.
   */
  protected abstract limiter(): RateLimiter;

  /** URL + fetch options for one named operation. */
  protected abstract buildRequest(
    op: string,
    body: Record<string, unknown>
  ): { url: string; init: RequestInit };

  /** Classify a response: success, ordinary failure, or rate-limited. */
  protected abstract interpret(res: Response): Promise<Attempt>;

  /**
   * What `request` returns in dry-run. Only needs to carry the fields callers
   * read back — in practice the channel id from opening a DM or creating a chat.
   */
  protected abstract dryRunResponse(op: string): Record<string, any>;

  /** Read this provider's member id off a membership row. */
  protected abstract memberId(member: DmTarget): string | null;

  /** Read this provider's cached DM channel id off a membership row. */
  protected abstract cachedDmChannel(member: DmTarget): string | null;

  /** The OrgMembership column the DM channel cache lives in, for writes. */
  protected abstract readonly dmChannelColumn: string;

  // ── Operations a provider implements ──────────────────────────────────────

  /** Post ONE already-sized message. Chunking is handled by postToChannel. */
  protected abstract sendMessage(channelId: string, text: string): Promise<boolean>;

  /** Open (or reuse) the 1:1 DM channel with a user and return its id. */
  abstract openDmChannel(memberId: string): Promise<string | null>;

  /** Create a private group chat (Slack: a private channel; Discord: a thread). */
  abstract createGroupChat(name: string): Promise<string | null>;

  /** Add users to a group chat. Best-effort — never throws, never reports. */
  abstract inviteToGroupChat(channelId: string, memberIds: string[]): Promise<void>;

  /** Archive a group chat once its set has passed. */
  abstract archiveGroupChat(channelId: string): Promise<boolean>;

  /** Set a group chat's topic. No-op where `capabilities.groupChatTopics` is false. */
  abstract setGroupChatTopic(channelId: string, topic: string): Promise<boolean>;

  /**
   * Resolve a member id from an email. Only meaningful where
   * `capabilities.emailLookup` is true; elsewhere it returns null always, and
   * callers should check the capability instead of inferring "not in workspace".
   */
  abstract lookupUserIdByEmail(email: string): Promise<string | null>;

  // ── Shared behaviour ──────────────────────────────────────────────────────

  /**
   * One call to the provider's API. Returns parsed JSON on success or null on
   * any failure. Never throws.
   *
   * The backoff sleeps INSIDE the queue slot on purpose: when the provider says
   * slow down, everything waiting behind us should slow down too, not pile on.
   */
  protected async request(
    op: string,
    body: Record<string, unknown>
  ): Promise<Record<string, any> | null> {
    if (integrationDryRun()) {
      console.log(`[${this.logTag}] DRY RUN ${op}:`, JSON.stringify(body));
      return this.dryRunResponse(op);
    }
    if (!this.credential) return null;

    const attempt = async (): Promise<Attempt> => {
      const { url, init } = this.buildRequest(op, body);
      const res = await fetch(url, init);
      return this.interpret(res);
    };

    try {
      const outcome = await this.limiter()(async () => {
        const first = await attempt();
        if (first.kind !== "limited") return first;
        console.warn(
          `[${this.logTag}] ${op} rate limited — retrying in ${first.retryAfterMs}ms`
        );
        await sleep(first.retryAfterMs);
        return attempt();
      });

      if (outcome.kind === "limited") {
        // Still limited after one retry — give up and let the caller's own retry
        // path (the next cron run, usually) handle it.
        console.error(`[${this.logTag}] ${op} still rate limited after retry`);
        return null;
      }
      if (outcome.kind === "failed") {
        console.error(`[${this.logTag}] ${op} failed:`, outcome.error);
        return null;
      }
      return outcome.data;
    } catch (err) {
      console.error(`[${this.logTag}] ${op} threw:`, err);
      return null;
    }
  }

  /**
   * Clamp a provider's Retry-After hint into something we're willing to wait.
   * Shared because both providers hand back a number of seconds — they just
   * disagree about where (Slack: a header; Discord: also the body, as a float).
   */
  protected retryAfterMs(seconds: number | null): number {
    const ms =
      seconds !== null && Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : RETRY_AFTER_FALLBACK_MS;
    return Math.min(ms, RETRY_AFTER_MAX_MS);
  }

  /**
   * Post to a known channel, splitting anything past the provider's per-message
   * ceiling. Reports true only if every piece landed — a half-sent summary is a
   * failure, not a success.
   */
  async postToChannel(channelId: string, text: string): Promise<boolean> {
    const parts = splitMessage(text, this.fmt.maxChars);
    if (parts.length === 0) return false;
    let ok = true;
    for (const part of parts) {
      // Sequential on purpose: chunks of one message must arrive in order.
      ok = (await this.sendMessage(channelId, part)) && ok;
    }
    return ok;
  }

  /** DM a user by their provider member id. */
  async postDirectMessage(memberId: string, text: string): Promise<boolean> {
    const channelId = await this.openDmChannel(memberId);
    if (!channelId) return false;
    return this.postToChannel(channelId, text);
  }

  /**
   * DM one membership, reusing its cached DM channel id.
   *
   * A (bot, user) DM channel is permanent on both providers, so opening it only
   * needs to happen once per person per org — after that it's one API call per
   * message instead of two. That halves the digest's traffic, which is the run
   * most at risk of hitting both the rate limiter and the function time budget.
   *
   * Self-healing: if posting to a CACHED channel fails (the workspace removed
   * the user, the id went stale), the cache is cleared so the next send re-opens
   * it.
   */
  async postDm(member: DmTarget, text: string): Promise<boolean> {
    const cached = this.cachedDmChannel(member);
    let channelId = cached;

    if (!channelId) {
      const userId = this.memberId(member);
      if (!userId) return false;
      channelId = await this.openDmChannel(userId);
      if (!channelId) return false;
      await this.cacheDmChannel(member.id, channelId);
    }

    const posted = await this.postToChannel(channelId, text);
    if (!posted && cached) await this.cacheDmChannel(member.id, null);
    return posted;
  }

  // Best-effort: a failed cache write costs an extra open next time, nothing
  // more, so it must never take the message down with it.
  private async cacheDmChannel(
    membershipId: string,
    channelId: string | null
  ): Promise<void> {
    await prisma.orgMembership
      .update({
        where: { id: membershipId },
        data: { [this.dmChannelColumn]: channelId },
      })
      .catch(() => {});
  }
}
