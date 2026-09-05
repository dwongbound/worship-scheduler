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
- `npm run typecheck` · `db:push` · `db:seed` · `db:studio`
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
  `PUT /api/me/teams/[teamId]` joins a team and nothing more; /profile lists
  your roles read-only with an (i) pointing at your org admin.
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
- **Unavailability** — `RECURRING` (dayOfWeek + startMinute/endMinute),
  `SPECIFIC` (startDate + time window, tied to a request), or `DATE_RANGE`
  (startDate/endDate, legacy). Times = minutes from midnight, day 0=Sun.
- **SetTemplate** — weekly recurrence (dayOfWeek+startMinute+duration) with
  `orgId`; the generate endpoint expands these into Sets.
- **AvailabilityRequest** — has `orgId`; most-recent row PER ORG is that
  org's "active" request. **AvailabilityResponse** (one per user+request;
  `@@unique([userId, requestId])`) records completion: a row with
  `completedAt` set = done. A user owes a response per org until each active
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

`login` · `page.tsx` (home) · `calendar` · `schedule` · `swaps` · `profile` ·
`create` (admin) · `users` (admin team mgmt — grant/revoke admin, instruments).
`layout.tsx` = pre-hydration theme script; `loading.tsx` = splash; `providers.tsx`.

## API (`app/api/**/route.ts`)

- Auth: `auth/[...nextauth]`, `signup`, `me`.
- Sets/assignments: `sets`, `sets/[id]`, `assignments`, `assignments/[id]`,
  `assignments/confirm-all`.
- Swaps: `swaps`, `swaps/[id]/take`.
- Teams: `teams` (GET any user, POST admin), `teams/[id]` (DELETE admin).
- Availability: `availability`, `availability/[id]`, `availability/complete`,
  `availability-request`.
- Export: `export`, `export/[id]` (ICS).
- Admin (re-checks `isAdmin` vs db): `admin/users(+/[id]|/stats)`,
  `admin/team-load` (per-window serve counts for the generate-review panel),
  `admin/assignments(+/[id])`, `admin/templates(+/[id])`,
  `admin/generate(+/apply)`, `admin/availability-request`.
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
- `guestTeams.ts` — guest-team vocabulary: `GuestRoleSpec`, `isUnbounded`,
  `openSeats` (an `allAvailable` seat reports 0, so it never reads as a hole),
  `validateGuestRoles(raw, allowedKeys)`. ✅tested
- `stagedPlan.ts` — pure helpers for the generate-review modal, incl. the Team
  load panel's metrics: `LOAD_METRICS` / `loadMetricRange()` / `parseLoadMetric()`
  let the admin measure people by this plan, upcoming bookings, or the past
  month/3/6/12 months. Only "this plan" is counted client-side; every window is
  ONE on-demand query to `GET /api/admin/team-load?metric=…`, cached per window
  in the modal — the plan itself never carries a year of assignments. ✅tested
- `setDraft.ts` — the set detail modal's STAGED edits: `describeSetChanges()`
  (what changed, in words, for the discard warning) + `diffAssignments()`
  (roster changes as DELETE/PATCH/POST) + `newAssignmentId()`. ✅tested
- `setStatus.ts` — `setStatus()` → empty|confirmed|unconfirmed|cover. Counts the
  owning team's slots plus guest teams' COUNTED seats (guest seats don't fill
  the host's same-named slots).
- `setlist.ts` — `describeSetlistChange(before, after)` → one human fragment
  ("added \"Who Else\" (E)") or null when nothing changed. Feeds the
  SETLIST_CHANGED history event + the Slack notice. ✅tested
- `setHistory.ts` — `describeSetHistoryEvent()` → chips/tokens for the log.
- `types.ts` — `Api*` (server shapes) & `Staged*` (create-flow) interfaces.
- `auth.ts` — `authOptions`, `getSessionUser()`, `getAdminUser()`.
- `api.ts` — `fetchJsonArray<T>` client helper.
- `theme.ts` — light/dark/**system** source of truth (mirror in layout script).
- `prisma.ts` — singleton client from generated output.
- `dbUrl.ts` — `normalizeDatabaseUrl()`: rewrites `sslmode=require|prefer|
  verify-ca` to `verify-full`, pinning today's TLS behavior before pg v9
  redefines those aliases (and silencing pg's startup warning). ✅tested

## Components

Feature: `CalendarMonth`, `CreateSetModal`, `SetDetailModal` (edits are STAGED:
everything writes to a local copy, a sticky footer has Delete · Cancel · Save,
and any exit with changes hits a confirm that lists them — only Delete-set and
Slack messaging act immediately; there's no per-set history here, that's the
Team tab's `TeamActivityModal`), `SetFormFields`,
`SlotCapacityEditor`, `GuestTeamsModal`, `TemplateModal`, `MySetsPanel`,
`Navbar`, `Logo`,
`StatusBadge`, `ExportIcsButton`, `LoadingProvider`.
Primitives in `components/common/`: `Badge Banner Button Card Checkbox Dropdown
Input Modal Select Stepper LoadingDots LoadingScreen`. Prefer extending these.
(`Stepper` = number field with big − / + either side, replacing a native
spinner.) `SetFormFields` asks for a start + **end** time; the set still stores
`durationMinutes` (`lib/dates.ts durationBetween` / `minutesToTimeInput`).

## Gotchas

- Recurring times interpreted in server `TZ` (default `America/Los_Angeles`);
  keep app + db containers on the same TZ.
- Playwright `tests/e2e/global-setup.ts` force-resets + reseeds the test db each run.
- Prisma client is **generated into the repo** (`lib/generated/prisma`) — after
  schema changes regenerate; import from `@/lib/prisma`, never `@prisma/client`.
