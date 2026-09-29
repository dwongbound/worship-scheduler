// The Slack implementation of MessagingTransport.
//
// Everything here is Slack-specific by construction: Web API endpoint shapes,
// the bearer header, Slack's `ok: true` success convention, its 429 + Retry-After
// behaviour, and the operations it happens to support. The shared machinery
// (pacing, backoff, dry-run, never-throw, DM caching, chunking) lives in the base
// class — see lib/messagingTransport.ts.
import { createRateLimiter } from "../../rateLimit";
import type { MessageFormat } from "../../messageFormat";
import {
  MessagingTransport,
  type Attempt,
  type EmailLookup,
  type MessagingCapabilities,
  type IntegrationName,
  type DmTarget,
} from "../../messagingTransport";
import { SLACK_FORMAT } from "./format";

const SLACK_API = "https://slack.com/api";

/**
 * Slack methods that must be sent as `application/x-www-form-urlencoded`.
 *
 * Most of the Web API happily reads a JSON body, so everything else here goes
 * out as JSON. These do not: they parse form parameters only, and a JSON body
 * leaves them seeing no arguments at all — answered as `invalid_arguments`,
 * which looks like a rejected email rather than a rejected request. That cost
 * us a silently broken auto-link, so add to this set rather than "fixing" a
 * caller the next time a lookup mysteriously refuses perfectly good input.
 *
 * https://docs.slack.dev/reference/methods/users.lookupByEmail
 */
const FORM_ENCODED_OPS = new Set(["users.lookupByEmail"]);

// Minimum gap between two Slack calls. Deliberately modest: it exists to stop a
// `Promise.all` fan-out from arriving as one burst, which is what actually
// provokes a 429. The real guarantee is the base class's Retry-After handling. A
// full second here would be "safer" per Slack's slowest documented tier and would
// also make a 100-person digest outlive the cron's time budget.
// Zero under vitest: the tests exercise this against a mocked fetch, and real
// pacing there just makes the suite slow without testing anything — the limiter
// has its own tests in tests/unit/rateLimit.test.ts.
const SLACK_MIN_INTERVAL_MS = process.env.NODE_ENV === "test" ? 0 : 100;

// ONE limiter for the whole provider, shared by every SlackTransport instance,
// so a batch of orgs in the same cron run still queues as one stream of calls.
const slackLimit = createRateLimiter(SLACK_MIN_INTERVAL_MS);

export class SlackTransport extends MessagingTransport {
  readonly integration: IntegrationName = "SLACK";

  readonly capabilities: MessagingCapabilities = {
    // users.lookupByEmail — what makes linking automatic for most people.
    emailLookup: true,
    groupChatTopics: true,
    inlineLinks: true,
    // A bot can DM any member of a workspace it's installed in, unconditionally.
    guaranteedDms: true,
  };

  readonly fmt: MessageFormat = SLACK_FORMAT;

  constructor(botToken: string | null) {
    super(botToken);
  }

  protected limiter() {
    return slackLimit;
  }

  protected buildRequest(op: string, body: Record<string, unknown>) {
    const url = `${SLACK_API}/${op}`;
    const auth = `Bearer ${this.credential}`;

    // A handful of Slack methods never learned to read a JSON body. Handed one
    // they don't reject it loudly — they just see NO arguments at all and
    // answer `invalid_arguments`, which reads like a bad email rather than a
    // bad request. Sent form-encoded, the very same call works.
    if (FORM_ENCODED_OPS.has(op)) {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null) form.set(key, String(value));
      }
      return {
        url,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            Authorization: auth,
          },
          body: form.toString(),
        } satisfies RequestInit,
      };
    }

    return {
      url,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: auth,
        },
        body: JSON.stringify(body),
      } satisfies RequestInit,
    };
  }

  protected async interpret(res: Response): Promise<Attempt> {
    // Slack signals rate limiting with a 429 + Retry-After (in seconds). It also
    // sets error:"ratelimited" in the body, which this code used to swallow as an
    // ordinary failure — silently dropping the message.
    if (res.status === 429) {
      const header = Number(res.headers.get("retry-after"));
      return {
        kind: "limited",
        retryAfterMs: this.retryAfterMs(Number.isFinite(header) ? header : null),
      };
    }
    const data = await res.json();
    if (!data.ok) return { kind: "failed", error: String(data.error) };
    return { kind: "ok", data };
  }

  protected dryRunResponse(op: string): Record<string, any> {
    // Fake the only response field callers read back: the channel id from opening
    // a DM or creating a channel.
    return op === "conversations.open" || op === "conversations.create"
      ? { channel: { id: "C_DRY_RUN" } }
      : {};
  }

  protected memberId(member: DmTarget) {
    return member.slackUserId;
  }

  protected cachedDmChannel(member: DmTarget) {
    return member.slackDmChannelId;
  }

  protected readonly dmChannelColumn = "slackDmChannelId";

  // ── Operations ────────────────────────────────────────────────────────────

  protected async sendMessage(channelId: string, text: string): Promise<boolean> {
    return !!(await this.request("chat.postMessage", { channel: channelId, text }));
  }

  async openDmChannel(memberId: string): Promise<string | null> {
    if (!memberId) return null;
    const data = await this.request("conversations.open", { users: memberId });
    return (data?.channel?.id as string | undefined) ?? null;
  }

  /**
   * Create a PRIVATE channel and return its id. Channel names must be lowercase
   * and unique in the workspace (archived channels keep theirs), so on a name
   * clash we retry with a counted "-2"/"-3" suffix — people read these names, so
   * a readable tiebreaker beats a random hash. Needs groups:write.
   */
  async createGroupChat(name: string): Promise<string | null> {
    for (const candidate of [name, `${name}-2`, `${name}-3`]) {
      const data = await this.request("conversations.create", {
        name: candidate,
        is_private: true,
      });
      const id = data?.channel?.id as string | undefined;
      if (id) return id;
    }
    return null;
  }

  /**
   * Best-effort: Slack rejects the whole call if any user is already in the
   * channel (re-invite) or can't be added, so a failure here shouldn't stop the
   * roster message from going out.
   */
  async inviteToGroupChat(channelId: string, memberIds: string[]): Promise<void> {
    if (memberIds.length === 0) return;
    await this.request("conversations.invite", {
      channel: channelId,
      users: memberIds.join(","),
    });
  }

  async archiveGroupChat(channelId: string): Promise<boolean> {
    return !!(await this.request("conversations.archive", { channel: channelId }));
  }

  async setGroupChatTopic(channelId: string, topic: string): Promise<boolean> {
    return !!(await this.request("conversations.setTopic", { channel: channelId, topic }));
  }

  /**
   * Resolve a user's member id by their email (users.lookupByEmail). Lets us
   * auto-populate OrgMembership.slackUserId at install time so most people never
   * click "Connect". Returns null on any miss.
   */
  async lookupUserIdByEmail(email: string): Promise<EmailLookup> {
    const outcome = await this.requestResult("users.lookupByEmail", { email });
    if (outcome.kind === "ok") {
      const id = outcome.data?.user?.id as string | undefined;
      return id ? { kind: "found", userId: id } : { kind: "not-found" };
    }
    // The one failure that ISN'T a problem: Slack answering that it has nobody
    // with this address. Everything else — a rejected request, a bad token, a
    // rate limit we couldn't ride out — is a failure the caller must hear about
    // rather than record as "looked, found nobody".
    if (outcome.kind === "failed" && outcome.error === "users_not_found") {
      return { kind: "not-found" };
    }
    return {
      kind: "failed",
      error: outcome.kind === "failed" ? outcome.error : "rate limited",
    };
  }
}
