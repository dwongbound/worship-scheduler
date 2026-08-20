# Slack notifications

Every Slack message the app sends flows through [`lib/slack.ts`](lib/slack.ts).
Two invariants keep it safe to sprinkle through the mutation routes:

1. **Everything no-ops when the org hasn't connected Slack.** `orgBotToken()`
   returns `null` when the org has no bot token (or the stored token can't be
   decrypted with the current `NEXTAUTH_SECRET`), and every send is skipped.
2. **Nothing throws.** A Slack outage can never break a db mutation — failures
   are logged and swallowed.

Slack is **per-org**: each workspace's bot token lives on the `Org` row, so a
DM to org A always uses A's token. Set `SLACK_DRY_RUN=1` to run every code path
(queries, eligibility, message building) but log the would-be API calls instead
of sending them.

**Bot scopes** ([`lib/slackOauth.ts`](lib/slackOauth.ts)):
`chat:write, im:write, groups:write, users:read, users:read.email`. Per-set
group chats are **private channels** (`groups:write` covers create / invite /
setTopic / archive); DMs use `im:write`. Changing this list means every org must
re-run the install OAuth to re-consent — the bot keeps working with its old
scopes until then, but new-scope calls fail until re-installed.

---

## Automatic — side effects of a mutation

These fire-and-forget after a successful db change. No button says "send to
Slack"; the message is a side effect of the action.

| Trigger | Slack effect | Route → helper |
|---|---|---|
| A user requests a swap **out** of their slot (status → `SWAP_REQUESTED`) | DMs everyone eligible for that role who's available at the set's time | [`assignments/[id]/route.ts`](app/api/assignments/[id]/route.ts) → `notifySwapRequested` |
| Someone **takes** an open swap | DMs the person who gave the slot up | [`swaps/[id]/take/route.ts`](app/api/swaps/[id]/take/route.ts) → `notifySwapTaken` |
| A **targeted** swap is proposed | DMs the recipient to accept/decline | [`swaps/propose/route.ts`](app/api/swaps/propose/route.ts) → `notifySwapProposed` |
| Recipient **accepts/declines** a targeted swap | DMs the requester with the outcome | [`swaps/proposals/[id]/respond/route.ts`](app/api/swaps/proposals/[id]/respond/route.ts) → `notifySwapResolved` |
| Admin **creates** an availability request | DMs every org member with linked Slack | [`admin/availability-request/route.ts`](app/api/admin/availability-request/route.ts) → `notifyAvailabilityRequest` |
| Someone **takes** a cover (→ `PENDING_APPROVAL`) | DMs every org **admin** that a cover needs approval | [`swaps/[id]/take/route.ts`](app/api/swaps/[id]/take/route.ts) → `notifyAdminsPendingApproval` |
| A targeted swap is **accepted** (→ `PENDING_APPROVAL`) | DMs every org **admin** that a swap needs approval | [`swaps/proposals/[id]/respond/route.ts`](app/api/swaps/proposals/[id]/respond/route.ts) → `notifyAdminsPendingApproval` |

## Manual — admin buttons

Deliberate user actions; unlike the automatic ones these **report failures**
back to the UI instead of swallowing them.

| Button / UI | Slack effect | Route → helper |
|---|---|---|
| "Slack Team" on a set — [`SetDetailModal.tsx`](components/SetDetailModal.tsx) | Creates (or reuses) the set's **private channel**, invites the set's team (plus anyone flagged "always in group chats"), and posts the roster. The channel id is stored on the set. | [`sets/[id]/slack-group/route.ts`](app/api/sets/[id]/slack-group/route.ts) → `messageSetTeamOnSlack` |
| "Auto-create group chat" on a set / template — [`SetDetailModal.tsx`](components/SetDetailModal.tsx), [`SetFormFields.tsx`](components/SetFormFields.tsx) | Not a message itself — sets the per-set lead time (`Set.groupChatLeadDays`) the cron uses to create the channel. Templates carry a default their generated sets inherit. | [`sets/[id]/route.ts`](app/api/sets/[id]/route.ts), [`sets/route.ts`](app/api/sets/route.ts), [`admin/templates/route.ts`](app/api/admin/templates/route.ts) |
| "Send weekly summary" — [`users/page.tsx`](app/users/page.tsx), [`TeamMembersModal.tsx`](components/TeamMembersModal.tsx) | Posts the next 7 days of a team's sets to its configured Slack channel | [`teams/[id]/slack-summary/route.ts`](app/api/teams/[id]/slack-summary/route.ts) → `sendTeamWeeklySummary` |
| "Remind" on an availability request | Re-DMs org members about the open request | [`admin/availability-request/[id]/remind/route.ts`](app/api/admin/availability-request/[id]/remind/route.ts) → `notifyAvailabilityRequest` |
| "Connect Slack" — [`orgs/page.tsx`](app/orgs/page.tsx) | OAuth install (Flow B). Stores the bot token — not a message, but the thing every send above depends on | [`slack/install/route.ts`](app/api/slack/install/route.ts) |

## Scheduled — daily cron

One Vercel Cron, `0 16 * * *` (UTC — 8 AM PST / 9 AM PDT), at
[`cron/daily/route.ts`](app/api/cron/daily/route.ts). It
does four Slack jobs each run:

| Job | Slack effect | Helper |
|---|---|---|
| **Weekly reminders** | For each `WeeklyReminder` scheduled for today's weekday and not yet sent, posts that team's week-ahead digest to its Slack channel. Reminders are managed on the Org settings page ([`admin/reminders/route.ts`](app/api/admin/reminders/route.ts)). | `sendTeamWeeklySummary` |
| **Auto group chats** | For every upcoming set now inside its **per-set** `groupChatLeadDays` window with no channel yet, creates the private channel (via `messageSetTeamOnSlack`, which stamps `groupChatCreatedAt` so it's made only once). | `runDueGroupChats` |
| **Auto-archive** | Archives the channel of any set whose event date has fully passed, stamping `groupChatArchivedAt`. Once-daily, so it lands the day after the event rather than at 11:59pm sharp. | `archiveDueGroupChats` |
| **Daily digest** | DMs each person a morning "here's your day" summary — **one message per org** they belong to, sent with that org's bot token to that org's `slackUserId`. Nothing is sent for an org that has nothing to report, and `OrgMembership.digestSentAt` keeps it to once per org per day. How far ahead it looks is per org (`Org.digestUpcomingDays`, on the Org settings page) and is quoted in the message itself. Opt out per person on the Profile page (`User.dailyDigest`). | `sendDailyDigests` → [`lib/digest.ts`](lib/digest.ts) |

The 16:00 UTC slot matters: Vercel schedules crons in UTC while the app runs in
`APP_TZ`, so the local hour shifts across DST. The digest only sends inside a
morning window (`DIGEST_WINDOW_*` in [`lib/constants.ts`](lib/constants.ts));
16:00 UTC sits inside it in both PST and PDT. Change one and re-check the other.

Every Slack call in the app is queued through one rate limiter
([`lib/rateLimit.ts`](lib/rateLimit.ts)) so a fan-out of DMs arrives paced
rather than as a burst, and `slackApi` honors a 429's `Retry-After` with one
retry instead of dropping the message. DM channel ids are cached per membership
(`OrgMembership.slackDmChannelId`), so each DM costs one API call, not two.

Auth: if `CRON_SECRET` is set, the route requires
`Authorization: Bearer <CRON_SECRET>` (Vercel sends this automatically);
otherwise it's open for local/dev.

---

## Related routes (linking, not messaging)

These manage Slack wiring but don't themselves send messages:

- [`slack/connect/route.ts`](app/api/slack/connect/route.ts) + callback — Flow A:
  a user captures their own Slack member id in an org's workspace.
- [`slack/install/callback/route.ts`](app/api/slack/install/callback/route.ts) —
  stores the bot token after install and best-effort auto-links members by email.
- [`slack/status/route.ts`](app/api/slack/status/route.ts) — whether an org's bot
  is connected (drives showing/hiding Slack actions).
- [`memberships/[orgId]/slack/route.ts`](app/api/memberships/[orgId]/slack/route.ts)
  and [`admin/users/[id]/route.ts`](app/api/admin/users/[id]/route.ts) — set/clear
  a member's Slack id (gated on the org having Slack connected first).
