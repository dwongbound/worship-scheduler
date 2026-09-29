# Worship Scheduler — quick map

Dense index so you can jump straight to files without searching. Conventions &
rationale live in `.claude/CLAUDE.md`; this file is the "where is it" lookup.
On any conflict, **this file's stack facts win** (the other is older).

## Stack (verified against package.json)

Next **16** (App Router) · React **19** · TypeScript **6** · Tailwind **4**
(`@tailwindcss/postcss`) · NextAuth 4 (credentials + bcryptjs) · Prisma **7**
(`prisma-client` generator → `lib/generated/prisma`, imported via `lib/prisma.ts`)
· PostgreSQL · Vitest (unit) · Playwright (e2e) · Docker.

## Commands

- Dev (docker): `docker compose --profile dev up` → http://localhost:3000
- Dev (host): `npm run dev` (loads `env/dev.env`)
- Unit: `npm run test:unit` (`vitest run`) · watch: `test:unit:watch`
- E2E: `npm run test:e2e` (needs test db; loads `env/test.env`)
- All-in-container: `docker compose --profile test up --abort-on-container-exit`
- `npm run typecheck` · `db:push` · `db:seed` (WIPES + reseeds) · `db:studio`
- Seeding is destructive and NEVER automatic — `--profile dev up` doesn't seed,
  so it can't erase your dev data. Ask for it:
  `docker compose exec worship-scheduler-dev npm run db:seed`.
  `prisma/seed.ts` also refuses any host that isn't local
  (`db-dev`/`db-test`/localhost), any db named `*prod*`, and
  `NODE_ENV=production` — override only with `SEED_FORCE=1`.
- Env: real values in gitignored `env/{dev,test,prod}.env`.

## Data model (`prisma/schema.prisma`)

- **Org** — the top-level tenant (a church/ministry). Declared in the
  `ORG_KEYS` env var (`"Name:key,Name:key"`); rows auto-upsert BY NAME
  (`lib/org.ts ensureOrgsSynced` — renaming in env = a new empty org). Users
  join by entering a key (`/join` page or navbar "Add an org…").
- **OrgMembership** — user↔org join with **per-org `isAdmin`** (the old
  global `User.isAdmin` is gone). Admin routes take an `x-org-id` header
  (collections) or derive the org from the resource; both re-check the db
  via `requireOrgAdmin`/`requireOrgAdminFor` in `lib/org.ts`.
- **Team** — named ministry team within one org (`@@unique([orgId, name])`);
  m-n with User. Sets/SetTemplates carry a nullable `teamId` (`onDelete:
  SetNull` — a null team = "open to the whole org"). The scheduler and all
  assignment dropdowns only offer the set's team members.
- **TeamRole** — the team's ROLE CATALOG (`@@unique([teamId, key])`). Roles are
  per-team data, not a fixed enum: `key` (stable, what Assignment.role stores),
  `label` (renameable), `defaultCount`, `adminOnly`, `order`. Seeded with
  `DEFAULT_TEAM_ROLES` on team create; edited in TeamMembersModal → Roles
  (`PUT /api/teams/[id]/roles`), which REFUSES to delete a role anyone holds on
  an upcoming set. `order` is admin-set: TeamRolesEditor rows are drag-sortable
  (dnd-kit, grip handle) and POSITION IS the order (`validateCatalog` stamps
  `order: i`). It drives every roster's display AND the auto-fill's
  scarce-first pass — everything reads roles via `orderedRoles`/`slottedRoles`. `adminOnly` still marks a role as admin-granted, but WHO
  plays WHAT is admin-only across the board now: only the Team tab
  (`PATCH /api/admin/users/[id]`, `teamRoles`) writes a member's roles.
  WHO IS ON a team is admin-only too, and there is NO self-service either way:
  the whole `api/me/teams` route is gone — nobody joins or leaves a team from
  their own account, admins included. Everyone is added (and removed) from the
  Team tab via `PATCH /api/admin/users/[id]` (`teamIds`), so the roster has one
  owner. /profile lists teams + roles read-only with an (i) pointing at your
  org admin.
- **TeamMember** — the user↔team join, carrying that person's per-team `roles`
  and `active` flag. Inactive = not auto-scheduled on that team (both scheduler
  callers build `rolesByTeam` via `lib/roster.ts schedulableRolesByTeam`), but
  still hand-pickable — the pick lists and swap picker label them
  "(inactive)" the way they label "(unavailable)". Per team, so someone can be
  active on one team and paused on another in the same org.
- **User** — username/passwordHash/name, `isMD` (musical director; global
  per person, like `instruments`), `memberships: OrgMembership[]`,
  `teams: Team[]`, `slackUserId`. Completion is tracked per-request via
  `AvailabilityResponse` (no global flag on User).
- **SetHistoryEvent** — the per-set activity log. `role` is null only for
  `SETLIST_CHANGED` (song added/removed/re-keyed/reordered), whose summary
  lives in `detail`. Roster + setlist changes also ping the set's Slack group
  chat via `notifySetChange` — but only when `groupChatLeadDays` is set (None =
  never), the lead window has opened, a channel exists, and the set is still
  upcoming.
- **Set** — `startsAt`+`durationMinutes`, optional `label`/`notes`, required
  `orgId` (tenant anchor even when teamId is null), `teamId`,
  `slotCapacities: Json?` (per-set team-shape override; null = global default).
- **Assignment** — one User in one `role` (a TeamRole.key **string**, not an
  enum) on one Set; a user may fill several roles on a set.
  `status: PENDING|CONFIRMED|SWAP_REQUESTED`. `@@unique([setId, userId, role])`.
  Nullable `guestTeamId` = this seat was borrowed from a **SetGuestTeam**
  (null, i.e. every legacy row, = an ordinary seat on the set's own team).
- **SetGuestTeam** — another team lending people to a set it doesn't own (the
  choir team joining a Sunday set). The set keeps ONE owning team; a guest row
  only widens who may sit where. `roles: Json` = which of **that team's** roles
  this set borrows: `{role, count}` or `{role, allAvailable: true}` (unbounded
  — no target, so it never reads as a hole and auto-fill seats everyone free).
  `@@unique([setId, teamId])`. Vocabulary in `lib/guestTeams.ts`. This is what
  replaced the hardcoded choir: `Set.choirEnabled` is **gone**, and CHOIR is an
  ordinary counted role.
- **Unavailability** — `RECURRING` (dayOfWeek + startMinute/endMinute, plus an
  optional startDate/endDate bounding the span it repeats over — the /schedule
  form's Repeats: Forever · N weeks · Until a date · Time Range),
  `SPECIFIC` (startDate + time window, tied to a request), or `DATE_RANGE`
  (startDate/endDate, legacy). Times = minutes from midnight, day 0=Sun.
  Every reader of a recurring rule honours BOTH bounds: `lib/availability.ts`
  (`dayBlockLevel`/`dayIsRepeating`), `lib/scheduler.ts isUserAvailable`,
  `AvailabilityCalendar`, and `api/availability{,/block-days}`.
- **SetTemplate** — weekly recurrence (dayOfWeek+startMinute+duration) with
  `orgId`; the generate endpoint expands these into Sets.
- **AvailabilityRequest** — has `orgId`; most-recent row PER ORG is that
  org's "active" request. **AvailabilityResponse** (one per user+request;
  `@@unique([userId, requestId])`) records completion: a row with
  `completedAt` set = done. It also carries an optional `note` — free text
  typed in the /schedule submit-confirmation modal, kept across an un-submit,
  and read by admins in the Create tab's availability status panel (a red
  `AttentionDot` after the name; the text sits atop the per-person modal). A user owes a response per org until each active
  request has a completed one. Drives the red dot + banner (dot = any org).

Enums: `AssignmentStatus` · `UnavailabilityType`. (`Instrument` is **gone** —
roles are TeamRole rows now; every role column is a `String` holding a key.)

## Team shape — `lib/teamRoles.ts` (+ `lib/constants.ts`)

Roles are **per team**. `lib/teamRoles.ts` is the vocabulary: `TeamRoleDef`,
`DEFAULT_TEAM_ROLES` (the built-ins a new team starts with), `orderedRoles`,
`slottedRoles` (drops only MD; **was `bandRoles`, which also dropped CHOIR**),
**`resolveTeamCapacities(catalog, stored)`** — THE
way to read a set's shape — `roleLabel(key, catalog?)` (team label → built-in →
humanized key, so a custom/deleted role never renders blank), `roleKeyFromLabel`,
`validateCatalog`. `lib/teamRoleStore.ts` is its prisma side
(`getTeamCatalog`/`getTeamCatalogs`/`seedTeamRoles`/`TEAM_ROLE_FIELDS`).
`lib/constants.ts` keeps the BUILT-IN defaults only (`SLOT_CAPACITIES`,
`ROLE_ORDER`, `INSTRUMENT_LABELS`, `ALL_INSTRUMENTS`) plus `MD_ROLES` /
`ACOUSTIC_HOST_ROLES` — special behaviours pinned to built-in keys that custom
roles never inherit — and `validateSlotCapacities(raw, allowedKeys)`. `CHOIR` is
just a built-in key now; its old "unbounded list" behaviour is `allAvailable` in
`lib/guestTeams.ts`, available to any team's any role.

## Pages (`app/*/page.tsx`)

`login` · `page.tsx` (home) · `calendar` · `schedule` · `set-manager` · `profile` ·
`create` (admin) · `users` (admin team mgmt — grant/revoke admin, instruments).
`layout.tsx` = pre-hydration theme script; `loading.tsx` = splash; `providers.tsx`.

## API (`app/api/**/route.ts`)

- Auth: `auth/[...nextauth]`, `auth/allow-duplicate-name` (consent cookie for
  the duplicate-name warning on the Google path), `signup`, `me`.
- Sets/assignments: `sets`, `sets/[id]` (GET = ONE set in the same shape a
  list row has — what a `?set=` deep link resolves through), `assignments`,
  `assignments/[id]`, `assignments/confirm-all`.
- Swaps: `swaps`, `swaps/[id]/take`.
- Teams: `teams` (GET any user, POST admin), `teams/[id]` (DELETE admin).
- Availability: `availability`, `availability/[id]`, `availability/complete`,
  `availability-request`.
- Export: `export`, `export/[id]` (ICS).
- Admin (re-checks `isAdmin` vs db): `admin/users(+/[id]|/stats)`,
  `admin/team-load` (per-window serve counts for the generate-review panel),
  `admin/sets/[id]/roster` (the WHOLE roster diff — removals, swaps and
  additions — in one PATCH, applied as one transaction with one grouped Slack
  notice; it replaced the per-seat `admin/assignments` routes, which fired a
  round trip and a Slack message per person), `admin/templates(+/[id])`,
  `admin/generate(+/apply)`, `admin/availability-request`,
  `admin/drafts(+/[id])` (saved generate previews — GET lists them WITHOUT
  their plan payloads, `[id]` GET is what carries one back).
  (`admin/users/[id]` PATCH also renames a member — `name` is global to the
  person, and the Team tab's cog → "Edit details" is its only caller.)
  (No `sets/[id]/autofill` — "Auto schedule" in the set detail modal runs
  `buildSchedule` in the browser now, because its roster is staged.)

## lib (pure logic, unit-tested where noted)

- `scheduler.ts` — `buildSchedule()` greedy roster fill + `isUserAvailable()` +
  `availableGuestMembers()` (one guest role's pool, minus anyone already on the
  set — replaced `availableChoirMembers`).
  Soft spacing rule: people booked within 8 days of a set (incl. caller-fed
  existing DB bookings) are picked last → weekly sets rotate round-robin.
  A required-MD set is filled on PURE ROTATION first and only refilled with a
  reserved MD seat if that roster has nobody who could lead (the old
  reserve-first pass pinned the seat to one person); the reserved seat goes to
  the freshest MD, in the best role they play — `MD_ROLES` is preference-ordered
  (electric guitar, keys, bass), and `lib/md.ts` designates the MD the same way.
  ✅tested
- `constants.ts` ✅ · `dates.ts` ✅ (`upcomingOccurrences`, `format*`, minute⇄time)
  · `ics.ts` ✅ (`buildIcs`) · `stats.ts` ✅ (serve-count windows/ranges).
- `roster.ts` — the per-team `active` rule: `schedulableRolesByTeam()` (drops
  inactive memberships, so the auto-fill can't propose them) +
  `inactiveMemberIds()` (who the swap picker flags). ✅tested
- `playerOptions.ts` — `buildPlayerOptions()`: the assignment dropdown's
  candidate list, shared by SetDetailModal + StagedScheduleModal. Nobody is
  filtered out — unavailable/inactive people are flagged and sink. ✅tested
  (`components/PlayerSelect.tsx` draws it: the flags are small `Badge size="sm"`
  pills — amber unavailable · gray inactive · indigo MD — not parenthetical
  text, the control's default width is its exported `PLAYER_SELECT_WIDTH`
  (SetDetailModal's read-only boxes mirror it), and the portaled list is at
  least `MENU_MIN_WIDTH` wide however narrow the control is.)
- `guestTeams.ts` — guest-team vocabulary: `GuestRoleSpec`, `isUnbounded`,
  `openSeats` (an `allAvailable` seat reports 0, so it never reads as a hole),
  `validateGuestRoles(raw, allowedKeys)`. ✅tested
- `stagedPlan.ts` — pure helpers for the generate-review modal, incl. the Team
  load panel's metrics: `LOAD_METRICS` / `loadMetricRange()` / `parseLoadMetric()`
  let the admin measure people by this plan, upcoming bookings, or the past
  month/3/6/12 months. Only "this plan" is counted client-side; every window is
  ONE on-demand query to `GET /api/admin/team-load?metric=…`, cached per window
  in the modal — the plan itself never carries a year of assignments. ✅tested
  Also the preview's COPY/PASTE clipboard: `copySet` lifts a set's EFFECTIVE
  shape (already resolved against its team catalog) + roster, `pasteSet` stamps
  both onto another set — which keeps its own identity (time, label, team) and
  takes the source's form, every pasted seat LOCKED so a later auto-fill treats
  it as a constraint. ✅tested
- `drafts.ts` — saved generate previews: `MAX_DRAFTS` (5 per org),
  `AUTOSAVE_INTERVAL_MS`, `canSaveDraft` (its `replacingId` is what makes
  re-saving an existing draft free, and promoting the recovery row NOT free),
  `draftLabel`, `normalizeDraftName`. Two kinds of `ScheduleDraft` row, told
  apart by `isRecovery`: DELIBERATE ones (the Save Draft button, capped, may be
  named) and the ONE rolling RECOVERY slot per person per org (the once-a-minute
  autosave), which never counts against the cap — a full set of keep-slots is
  exactly when you most need the safety net. Both the POST and the promoting
  PATCH re-check the cap against the db. ✅tested
- `scheduleTour.ts` — the words of the review workspace's guided tour, as data:
  `tourSteps({preview})` → one step per quirk (views · team load · hover ·
  locking · the card's ↻/✕ · copy-paste-undo · the warnings · committing), with
  the last step forked per mode (Preview Mode has no draft to park and commits
  with Save Changes). It is the ONLY explanation of that screen — the paragraph
  of instructions that used to head the modal and the shortcut hint under it
  were deleted in its favour, so a missing step = an undiscoverable feature.
  ✅tested
- `tourSeen.ts` — "has this browser been shown that walkthrough?", in
  localStorage: `APP_TOUR_KEY` (the navbar's "?" tour) + `scheduleTourKey(mode)`
  (the review workspace's, keyed per mode so seeing one doesn't silence the
  other) + `hasSeenTour`/`markTourSeen`. Every access is wrapped — private mode
  THROWS rather than returning null — and an unreadable store reports "seen", so
  a browser that can never record the flag isn't nagged every visit. ✅tested
- `setDraft.ts` — the set detail modal's STAGED edits: `describeSetChanges()`
  (what changed, in words, for the discard warning) + `diffAssignments()`
  (the roster diff, as the body `admin/sets/[id]/roster` takes) + `newLocalId()`.
  ✅tested
- `rosterChanges.ts` — `describeRosterChanges()`: one roster save as ONE Slack
  notice (a lone change stays a plain sentence; several get a counted header).
  ✅tested
- `setStatus.ts` — `setStatus()` → empty|confirmed|unconfirmed|cover. Counts the
  owning team's slots plus guest teams' COUNTED seats (guest seats don't fill
  the host's same-named slots).
- `setlist.ts` — `describeSetlistChange(before, after)` → one human fragment
  ("added \"Who Else\" (E)") or null when nothing changed. Feeds the
  SETLIST_CHANGED history event + the Slack notice. ✅tested
- `setHistory.ts` — `describeSetHistoryEvent()` → chips/tokens for the log.
- `types.ts` — `Api*` (server shapes) & `Staged*` (create-flow) interfaces.
- `nameConflict.ts` — the duplicate-name warning shown at account creation:
  `findNameConflicts` lives in `nameConflictStore.ts` (prisma side); the pure
  half holds `NameConflict`, `normalizeName`, `DUPLICATE_NAME_COOKIE` and the
  `nameConflictRedirect`/`parseNameConflicts` pair that carries conflicts through
  the Google redirect. Advisory, never a block — `POST /api/signup` 409s once
  with `nameConflicts` (override: `allowDuplicateName`), and the Google signIn
  callback bounces to `/login?nameConflict=…` (override: the cookie dropped by
  `POST /api/auth/allow-duplicate-name`). ✅tested
- `setLink.ts` — `SET_PARAM` / `setLinkPath(setId)`: the ONE spelling of a link
  to a set (`/calendar?set=<id>`, or `setLinkPath(id, "set-manager")`). The two
  tabs read the SAME param but answer differently: the calendar opens that set's
  detail modal (its open set IS the URL), while the set-manager scrolls to the
  set's ROW and rings it for a few seconds, leaving that row's own button in
  reach — which is why the cover/swap DMs link there. A set outside what either
  has loaded is resolved through `GET /api/sets/[id]`: the calendar widens its
  window and switches org, the set-manager widens its horizon (or says why it
  can't). Roster DMs, digest bullets and the Approvals tab use the calendar
  form. ✅tested
- `slackStatus.ts` — the client-side cache in front of `GET /api/slack/status`.
  Four surfaces ask "has this org connected Slack?" (Team, Create, the team
  members modal, and the set detail modal on every open); caching the PROMISE
  per org makes that one request and collapses simultaneous askers. Connecting
  is a full navigation (the cache dies with the page); the one in-app change,
  Disconnect on Org settings, calls `invalidateSlackStatus(orgId)`. ✅tested
- `layout.ts` — `BOTTOM_NAV_MAX_WIDTH` + `isBottomNavWidth()`: the one number
  behind "is this the app-style layout?", shared by the bottom bar's `lg:`
  classes, SwipePager and PullToRefresh.
- `notificationPrefs.ts` — the per-org switches for the bot's PERSONAL DMs:
  `NOTIFICATION_TYPES` (the catalog the Org settings → Notifications list draws),
  `notificationEnabled` (unrecorded = ON, so nothing goes quiet by accident),
  `parse`/`validate`/`mergeNotificationPrefs`. Stored on `Org.notificationPrefs`;
  enforced by `orgChatContext()` in `lib/chatProvider.ts` — ONE org read that answers
  both "is this type still on?" and "which transport?", which every DM sender
  starts with. Channel posts aren't covered. ✅tested
- `messagingTransport.ts` — the abstract `MessagingTransport`. An INTEGRATION
  (Slack, Discord) is the whole product; this class is just its messaging
  surface. OWNS everything providers share — pacing, 429 backoff, dry-run,
  never-throw, the cached DM channel + its self-healing, per-provider message
  chunking — leaving a subclass only endpoints, auth, success/limit detection
  and the ops it supports. `capabilities` records what a provider genuinely
  CAN'T do: `emailLookup` is false on Discord, which is why auto-linking is
  Slack-only. ✅tested
- `messageFormat.ts` — the `MessageFormat` shape (`bold`/`link`/`maxChars`) +
  `splitMessage`. Pure; concrete formats live with their integrations. ✅tested
- `orgIntegration.ts` — which integration an org talks through, and the ONE
  place a provider is chosen: `transportForOrg`/`transportForCredential`/
  `orgMessagingContext`, plus `isOrgMessagingConnected` (can we send — dry-run
  counts) vs `isOrgMessagingInstalled` (is a real workspace behind this org —
  dry-run does NOT count; anything about workspace-scoped identity, like a
  member id, must ask this one).
- `integrations/<name>/` — everything ONE integration owns, and the only place
  its specifics may live: `slack/` (`transport.ts` = `SlackTransport`, the sole
  implementation today, + `format.ts` = `SLACK_FORMAT`) and `discord/`
  (`format.ts` only, so far). Integration-specific UI — icons and the like —
  belongs here too. A new integration = a new folder + one branch in
  `orgIntegration.ts`.
- `pendingHandoff.ts` — who a seat mid-handoff STILL belongs to (cover-take →
  `Assignment.pendingCoverFromUserId`; accepted swap → the SwapProposal). Feeds
  `pendingFromUser` on the wire and the MD rules, so a pending cover can't
  unseat a set's MD before an admin approves it.
- `setPayload.ts` — `SET_INCLUDE` + `withPendingOwners()`: the one prisma shape
  both `GET /api/sets` and `GET /api/sets/[id]` return.
- `postLogin.ts` — surviving the login door: `safeInternalPath()` (only in-app
  paths are ever redirected to — a `?callbackUrl` is attacker-controllable ✅tested)
  plus a short-lived per-tab stash (`remember`/`peek`/`clearPostLogin`) for the
  two places that param can't reach: Google's duplicate-name bounce back through
  /login, and the /join gate a brand-new account passes through. So a set link
  followed while signed out still opens that set afterwards.
- `auth.ts` — `authOptions`, `getSessionUser()`, `getAdminUser()`.
- `api.ts` — `fetchJsonArray<T>` client helper.
- `theme.ts` — light/dark/**system** source of truth (mirror in layout script).
- `prisma.ts` — singleton client from generated output.
- `colors.ts` — hex helpers for the preview tints: `normalizeHex` (accepts
  `#abc`/`aabbcc`, returns `#rrggbb` or null) + `withAlpha(hex, a)`. ✅tested
- `dbUrl.ts` — `normalizeDatabaseUrl()`: rewrites `sslmode=require|prefer|
  verify-ca` to `verify-full`, pinning today's TLS behavior before pg v9
  redefines those aliases (and silencing pg's startup warning). ✅tested

## Components

Feature: `CalendarMonth`, `CreateSetModal`, `SetDetailModal` (edits are STAGED:
everything writes to a local copy, a sticky footer has Delete · Cancel · Save,
Save COMMITS AND CLOSES (a failed save keeps the modal + edits up), and any
exit with changes hits a confirm that lists them — Delete-set, Slack messaging
and sending a note act immediately; the Notes box is a composer with a send
arrow, empty on every open, its log below holding what's been written; there's
no per-set history here, that's the Team tab's `TeamActivityModal`), `SetFormFields`,
`SlotCapacityEditor`, `GuestTeamsModal`, `TemplateModal`, `MySetsPanel`,
`GenerateModal` (the "Generate New Schedule" options — window, which recurring sets, and an
optional per-set-type color) → `StagedScheduleModal` (the preview; a set type's
color tints its cards at 10%, matched via `StagedSet.templateId`; every slot row
leads with a ✕ that drops THAT slot from THAT set — capacity − 1 plus its
occupant, written into `StagedSet.slotCapacities`, which both apply and the
preview save persist, the same edit `SetDetailModal.deleteSlot` makes — and a
role emptied of slots comes back via the card's "+ role" chips; the unfillable
(red) and conflict (amber) banners ride ON the footer's action bar, bled to the
modal's edges — the body scrolls for a long plan, so at the top they were gone
by the time you were looking at the roles they named; clicking a
card's own space SELECTS it — ⌘/Ctrl+C then copies its shape + people and
⌘/Ctrl+V stamps them onto another selected card, ⌘/Ctrl+Z takes the last paste
back (an undo entry snapshots the WHOLE set list, since `designateMDs` re-settles
directors across the plan, and a snapshot whose `after` no longer matches `sets`
means something else edited since — the history is dropped rather than rewinding
over that work); all three are bound on the document so cards needn't enter the
tab order, and each flashes a pill on the card it happened to
(`animate-flash-fade`); in the generate flow only, Save Draft parks the
plan via `lib/drafts.ts` and a once-a-minute autosave writes the same plan into the
org's recovery slot),
`DraftsModal` (the saved-preview list — open or delete, the delete confirm
stacked over it so you stay in the list, which is where making room happens),
`ScheduleHelpModal` (the review workspace's guided tour: a STEPPED modal, not
spotlights — that screen scrolls two ways and regroups itself, so anything
anchored to a live element would point at empty space half the time; each step
draws its own little picture instead. Opened by the footer's blue Help button
(`Button variant="info"`, between Save Draft and Apply), and once on its own the
first time a browser reaches each mode. It swallows Escape in the CAPTURE phase
— every `Modal` closes on a document keydown, so otherwise dismissing the help
would also back out of the plan it explains),
`Navbar` (top tab strip at `lg` and up; below that an app-style floating
bottom bar — phones AND tablets, gated on `lib/layout.ts`
`BOTTOM_NAV_MAX_WIDTH`, which `SwipePager` and `PullToRefresh` share so the
gestures can't drift from the bar), `Logo`, `PullToRefresh` (phone pull-down-to-refresh, mounted in
`app/layout.tsx` around `SwipePager`; a page registers its own refetch with
`usePullToRefresh(reload)` — calendar/set-manager/schedule do — and anything that
doesn't falls back to `location.reload()`. A surface with its own drag gesture
opts out with `data-no-pull`),
`StatusBadge`, `ExportIcsButton`, `LoadingProvider`.
Primitives in `components/common/`: `Badge Banner Button Card Checkbox
ColorPicker Dropdown Input Modal Select Stepper LoadingDots LoadingScreen`.
Prefer extending these. (`Stepper` = number field with big − / + either side,
replacing a native spinner — a plain text box under the hood, digits only, so
it can be cleared and retyped; `ColorPicker` = a swatch opening a portaled
presets + hex panel, whose "no color" is null; `DateSelect` = a portaled
STEPPING week grid — five rows of an unbroken run of day numbers through every
month boundary. NOT a scroll container: the window is an index, moved one week
per wheel tick / swipe (rate-limited by `canStep`), so no scrollbar can appear
and a step is always a whole week. ‹ › in the heading jump a month; the heading
names whichever month owns most of the five rows, and days outside it are
dimmed but still clickable (only `[min, max]` actually disables). Geometry,
the majority rule and the rate limit live in `lib/calendarScroll.ts` ✅tested;
`range` mode highlights start→hovered-day live; `Badge` takes `size="sm"` for a
pill that rides inside another control; `Button` takes `loading` — dots ON the
button, label hidden but still holding its width, so a pressed button can't
resize mid-click (it implies `disabled`); `Checkbox` takes `rowTarget` to make
the whole row a real `<label>` (off by default: most rows carry chips and text
you may want to click without flipping a tick); `Input`/`Select` set their own
`text-base sm:text-sm` — 16px on phones is what stops iOS zooming into a
focused field — and step aside when the caller passes its own size; `Modal`
renders into `<body>` (a transformed ancestor — the swipe pager, pull-to-refresh
— would otherwise be what its `fixed` overlay centres in), takes `headerActions`
for controls pinned in the header left of the ✕, and accepts `footer` as a
FUNCTION `({ atEnd }) => …` for an action that must wait until a long body has
been scrolled to the end — the availability submit's Confirm.) `SetFormFields` asks for a start + **end** time; the set still stores
`durationMinutes` (`lib/dates.ts durationBetween` / `minutesToTimeInput`).

## Gotchas

- Recurring times interpreted in server `TZ` (default `America/Los_Angeles`);
  keep app + db containers on the same TZ.
- Playwright `tests/e2e/global-setup.ts` force-resets + reseeds the test db each run.
- Prisma client is **generated into the repo** (`lib/generated/prisma`) — after
  schema changes regenerate; import from `@/lib/prisma`, never `@prisma/client`.
