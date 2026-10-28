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
  active on one team and paused on another in the same org. Inactive ALSO
  excuses them from availability requests: paused on every team a request
  targets = no Slack DM, no red dot, no row to fill in (`lib/availabilityTargets.ts`
  `targetsUser`/`membersTargetedBy`). The Create tab's status panel still lists
  them, last and marked "inactive", so a short chase list reads as deliberate.
- **User** — username/passwordHash/name, `isMD` (musical director; global
  per person, like `instruments`), `memberships: OrgMembership[]`,
  `teams: Team[]`, `slackUserId`. Completion is tracked per-request via
  `AvailabilityResponse` (no global flag on User).
  `calendarInvites` (default true) is the person's own opt-out from being a
  GUEST on their sets' Google Calendar events. It and the picker below are
  /profile's own **Google Calendar** section, below Slack and shaped like it
  (they used to hang off the Email field in the Account card, where a switch
  and a picker read as footnotes to a text box). They show as soon as the
  person has an EMAIL, whether or not any org has
  connected Google Calendar — the answer is theirs, and the calendars the
  picker lists are read with their own permission, nothing to do with the
  org's connection; gating it meant an invite could arrive before they'd had
  the chance to say no. A line says so while no org is sending any — global to them like
  `dailyDigest`, since the calendar it lands on is theirs. Opting out drops
  them from the guest list ONLY: they keep their seats and still appear in the
  event's roster, so the team still sees who is playing. Switched on /profile,
  honoured by `lib/calendarEvent.ts` (`eventAttendees` skips them;
  `seatsToConfirm` ignores an RSVP that crossed with the opt-out).
  `calendarInviteEmail` is WHERE those invites go, null = `email`. Google puts
  an invite on the default calendar of whatever address it was sent to and an
  attendee can't move an invited event afterwards, so the address IS the only
  choice of calendar — point this at a secondary calendar's own address
  (`…@group.calendar.google.com`) and the sets land there, colourable and
  hideable. `lib/calendarEvent.ts inviteAddress()` is the ONE reading of the
  pair, used for the guest list AND for `seatsToConfirm`, since the RSVP comes
  back from whatever address was invited. /profile asks for it as a PICKER of
  the person's own Google calendars, not a pasted address: a secondary
  calendar's id IS its address, so picking one and typing one are the same act
  — and nobody can find "Integrate calendar" in Google's settings. The list
  comes from `GET /api/google-calendar/my-calendars`, which reuses the
  availability import's remembered consent (`lib/googleAvailability.ts`
  `listImportCalendars`), so whichever of the two the person does first spares
  the other. The address box is kept as the way out of the list, since a
  calendar someone else owns or one on another account is never in it; it is
  also what shows when there is no permission to list. `lib/invitePicker.ts`
  is the pure half (`inviteOptions` — the primary calendar is NOT listed
  again, its address being the account email, and a saved address the list
  can't offer keeps its own option so the picker never reads as the default
  while something else is in force). ✅tested A calendar is named whatever
  its owner likes and a secondary one's address runs to fifty-odd characters,
  so the `Select` is `truncate` (`w-full`, so the box can only ever be as wide
  as the card) and the line under it names the resolved address with
  `break-words` — a browser breaks at no "@" or "." of its own, so unwrapped
  that line is what would run off a phone.
- **SetHistoryEvent** — the per-set activity log. `role` is null only for
  `SETLIST_CHANGED` (song added/removed/re-keyed/reordered), whose summary
  lives in `detail`. Roster + setlist changes also ping the set's Slack group
  chat via `notifySetChange` — but only when `groupChatLeadDays` is set (None =
  never), the lead window has opened, a channel exists, and the set is still
  upcoming.
- **Set** — `startsAt`+`durationMinutes`, optional `label`/`notes`, required
  `orgId` (tenant anchor even when teamId is null), `teamId`, `googleEventId`
  (its event on the org's Google Calendar; `Org.googleCal*` holds the
  connection),
  `slotCapacities: Json?` (per-set team-shape override; null = global default).
- **SetPractice** — one practice (rehearsal) on a set: `startsAt` + `endsAt`
  (a start and an END, never a duration — that's how an admin says it and what
  the calendar event needs) and its own `googleEventId`. Three deliberate
  absences: it is NOT drawn on the app calendar (the set detail modal is its
  one home), it is NEVER handed to `buildSchedule` as a booking (so load,
  spacing and availability are decided by sets alone), and it has NO roster —
  who's invited is derived from the set's assignments at sync time, so a roster
  change carries the practice invite with it. `@@unique([setId, startsAt])`.
  Added/deleted ad hoc on any set, recurring or not, on any date
  (`POST /api/sets/[id]/practices`, `DELETE …/[practiceId]`, both org admin).
- **SetTemplatePractice** — a practice on a weekly `SetTemplate`, as a
  `dayOfWeek` + `startMinute` + `endMinute`. A weekly time has no date, so its
  practices can't either: the weekday means "the one in the SET's own week",
  weeks running **Mon–Sun** like `weekKey`, which is what puts a Wednesday
  practice BEFORE each Sunday service instead of after it. Stamped onto
  `SetPractice` rows at generate time (`admin/generate/apply` matches each new
  set back to its template with `templateIdOf`, since sets don't store theirs)
  and editable per set afterwards — editing a template does NOT rewrite sets
  already generated, the same bargain `slotCapacities` makes. Vocabulary in
  `lib/practices.ts`.
- **Assignment** — one User in one `role` (a TeamRole.key **string**, not an
  enum) on one Set; a user may fill several roles on a set.
  `status: PENDING|CONFIRMED|SWAP_REQUESTED`. `@@unique([setId, userId, role])`.
  Nullable `guestTeamId` = this seat was borrowed from a **SetGuestTeam**
  (null, i.e. every legacy row, = an ordinary seat on the set's own team).
- **CoverDecline** — one person's "not me" on an OPEN cover request
  (`@@unique([assignmentId, userId])`, optional `note`). A cover is broadcast,
  so declining resolves nothing for anyone else: the slot stays
  `SWAP_REQUESTED`, `GET /api/swaps` just skips it for the decliner and the
  owner gets a DM with the note. Scoped to the current ask — `PATCH
  /api/assignments/[id]` deletes the rows on every status change, so asking
  again reaches the people who passed.
- **SetGuestTeam** — another team lending people to a set it doesn't own (the
  choir team joining a Sunday set). The set keeps ONE owning team; a guest row
  only widens who may sit where. `roles: Json` = which of **that team's** roles
  this set borrows: `{role, count}` or `{role, allAvailable: true}` (unbounded
  — no target, so it never reads as a hole and auto-fill seats everyone free).
  `@@unique([setId, teamId])`. Vocabulary in `lib/guestTeams.ts`. This is what
  replaced the hardcoded choir: `Set.choirEnabled` is **gone**, and CHOIR is an
  ordinary counted role.
- **SchedulingRule** — one of an org's rules for Auto schedule (ORG-wide,
  never per team): `tier` REQUIRED|PREFERENCE, `enabled`, `position` (list
  order = the preference ranking), `params: Json` (the kind + its ids; see
  `lib/schedulingRules.ts`). Rules naming something since deleted are dropped
  on load. Edited in Org settings → Scheduling rules (`components/OrgRules.tsx`).
- **Unavailability** — `RECURRING` (dayOfWeek + startMinute/endMinute, plus an
  optional startDate/endDate bounding the span it repeats over — the /schedule
  form's Repeats: Forever · N weeks · Until a date · Time Range),
  `SPECIFIC` (startDate + time window, tied to a request), or `DATE_RANGE`
  (startDate/endDate, legacy). Times = minutes from midnight, day 0=Sun.
  Every reader of a recurring rule honours BOTH bounds: `lib/availability.ts`
  (`dayBlockLevel`/`dayIsRepeating`), `lib/scheduler.ts isUserAvailable`,
  `AvailabilityCalendar`, `lib/weekView.ts`, and `api/availability{,/block-days}`.
  `fromGoogle` marks a SPECIFIC block written by Import from Google Calendar;
  re-importing replaces exactly those rows for that request.
  `exceptDates` (`String[]`, "YYYY-MM-DD") are the days a RECURRING rule SKIPS
  — one per day freed on the calendar. A weekly rule is a pattern, so a freed
  date is a hole in it, NOT a split of its span: the row stays whole and
  recognisable (and so still a duplicate of a re-added identical rule), and
  three overlapping Tuesday rules over one freed day become three exceptions,
  not six half-rules. EVERY reader honours it alongside the bounds —
  `lib/availability.ts` (`recurringSkips`, used by `dayBlockLevel`/
  `dayIsRepeating`), `lib/scheduler.ts isUserAvailable`, `AvailabilityCalendar`,
  `lib/weekView.ts` — and any narrowed prisma `select` must ask for it
  (admin/users, swaps/candidates, lib/slack all do).
  The calendar/week-strip gestures: a click/tap BLOCKS a day all day whatever
  was on it (the red all-day block renders OVER a weekly repeat — a dated block
  always wins the cell, so no hatch); clicking a day already blocked all day
  CLEARS it completely; a right-click (desktop) or long press (touch) frees a
  day outright. Any clear wipes every dated block on the day AND adds the
  exception to every weekly rule covering it (`recurringExceptionsFor` /
  `mergeExceptions`, which prunes dates the rule can't fire on again; shared by
  `applyDayEdit` and the block-days route).
  `allDayBlockedDays`/`dayHasDatedBlock` are the shared readings behind the
  toggle and the hatch. Adding a weekly block also settles overlaps —
  `POST /api/availability` skips one a wider rule already says, absorbs
  (deletes) any row the new one covers (`recurringCovers`), and RE-ADDING a
  block you'd freed days out of re-books them (the covered rows give up their
  exceptions), which is why a repeat is no longer a flat "already exists". It
  answers `{created, skipped, absorbed, rebooked[]}`; /schedule's form message
  is read off that, never guessed client-side.
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
roles never inherit — and `validateSlotCapacities(raw, allowedKeys)`. Day names
come in three widths: `DAY_LABELS` (full), `DAY_ABBRS` ("Tues"/"Thurs", for a
tight row like "Tues 7PM") and `DAY_INITIALS` ("Su"…"Sa", the only spelling
narrow enough to fit all seven across a phone — single letters repeat S/T/T/S,
so they can't tell the days apart). `CHOIR` is
just a built-in key now; its old "unbounded list" behaviour is `allAvailable` in
`lib/guestTeams.ts`, available to any team's any role.

## Pages (`app/*/page.tsx`)

`page.tsx` (the PUBLIC home page) · `login` · `calendar` · `schedule` ·
`set-manager` · `profile` · `create` (admin) · `users` (admin team mgmt —
grant/revoke admin, instruments).
`layout.tsx` = pre-hydration theme script; `loading.tsx` = splash; `providers.tsx`.

`/` has TWO answers. Signed out it's the marketing page — the mark, the name
**TapWorship** and what the app does, which is what Google's OAuth verification
fetches and judges the app's name and logo by; it failed review as a login wall.
Its hero is an EXAMPLE set roster (invented people — the page is public), its
four steps are numbered because they're a real sequence, and it carries TWO
buttons for two different people: the header's **Sign in** → `/login` for
someone who already has an account, and the hero's **Get started** → `#contact`
for someone who doesn't. They are NOT interchangeable — there is no self-serve
sign-up, so a "Get started" landing on /login strands the very person it's for.
The closing block asks people with no account to
write in: the address is `CONTACT_EMAIL` (`lib/legal.ts`, overridable with
`NEXT_PUBLIC_CONTACT_EMAIL`), shown as selectable text AND behind
`components/CopyEmailButton.tsx` — never only a `mailto:`, since a clipboard
write can be refused and the page can't tell. Archivo + IBM Plex Mono are
loaded by this page alone (next/font), so the app never pays for them.
It also FADES IN and reveals each block as you scroll (`lib/reveal.ts` +
`components/Reveal.tsx`), and the one rule that governs that: **the page must
read with the motion off.** The markup is visible as it stands; a pre-paint
inline script sets `data-reveal="on"` on `<html>` and only that arms the
hidden-then-revealed CSS. No script (a crawler, the OAuth review, a blocked
bundle) or "reduce motion" set = no attribute = nothing is ever hidden. An
animation that started at opacity 0 and waited for JS would hand the review a
blank page, which is the same failure the login wall was. `REVEAL_STAGGER_CLASS`
on a container staggers its CHILDREN off the nearest revealed ancestor — one
observer for the roster card, the stagger being pure CSS — and it may sit on
the revealed element itself or inside it, which is why there are two selectors.
`tests/unit/reveal.test.ts` parses the sheet and fails if any hiding rule
escapes that scoping. **`components/RevealRoot.tsx` is the two halves
together** — the rules, which HIDE, and the script, which is the only thing
that ever reveals — because a page carrying one without the other hides its
content for good; the same test asserts every animated page renders it and
inlines neither half. **/login arms the same motion**: its card rises in as one
piece with `REVEAL_STAGGER_CLASS` on the Card so its own rows follow, behind the
home page's soft wash. `RevealRoot` sits OUTSIDE the `Suspense` boundary there,
since `useSearchParams` makes the form client-rendered and the attribute has to
be in the document before the first paint. The no-motion rule is the same, and
`tests/e2e/auth.spec.ts` covers both paths.
Signed in it's still the app: `proxy.ts` redirects a session holder to
`/calendar` at the edge, because Google's sign-in callback lands on `/` and
marketing copy after signing in reads as broken. That redirect can't live in
`next.config.js` (a config redirect can't see the session) or as an RSC
`redirect()` in the page (React #310 in production for an AUTHENTICATED
visitor — vercel/next.js#63121), which is why it's in the middleware.

## API (`app/api/**/route.ts`)

- Auth: `auth/[...nextauth]`, `auth/allow-duplicate-name` (consent cookie for
  the duplicate-name warning on the Google path), `signup`, `me`.
- Sets/assignments: `sets`, `sets/[id]` (GET = ONE set in the same shape a
  list row has — what a `?set=` deep link resolves through), `assignments`,
  `assignments/[id]`, `assignments/confirm-all`.
- Swaps: `swaps`, `swaps/[id]/take`, `swaps/[id]/decline` (the "not me" on an
  open cover — see CoverDecline), `swaps/propose`, `swaps/proposals/*`.
- Practices: `sets/[id]/practices` (POST, org admin — one ad-hoc practice on
  any set, any date), `sets/[id]/practices/[practiceId]` (DELETE, org admin;
  the practice must belong to THAT set, so an id from elsewhere can't delete
  across orgs), and `.../availability` (GET — who of the set's roster is free
  for THIS practice, its own endpoint because the detail modal shows practices
  with no availability at all and this is fetched only when one is clicked).
  A set's practices ride along in `SET_INCLUDE`, since the detail modal is the
  only place they're shown.
- Teams: `teams` (GET any user, POST admin), `teams/[id]` (DELETE admin).
- Google Calendar: `google-calendar/import` — a MEMBER's import, now three
  routes because it's a SCREEN (`components/GoogleImportModal`), not one click:
  `/import/calendars` (GET ?requestId= → their own calendars, for the picker),
  `/import/preview` (GET + `calendarIds=` → the merged busy windows, written
  nowhere — it runs the import's own code, so the preview can't disagree with
  what lands) and `/import` itself (GET = the consent trip ONLY, which imports
  nothing and lands on `/schedule?gcalImport=connected` to REOPEN the modal;
  POST `{requestId, calendarIds}` = the import, answering `{blocks}`). A denied
  or failed consent still lands on `?gcalImport=denied|error`. Shared guard in
  `import/guard.ts`. `google-calendar/my-calendars` is the same consent read
  for a different reason — /profile's invite picker — so the signed import
  state's `requestId` is OPTIONAL and the shared callback lands on
  `/profile?gcalPicker=...` when there is none. `?connect=1` is the consent trip;
  the plain GET answers `{calendars}` or `{needsConsent:true}`. The consent
  check is per-trip (`rememberAccessFromCode`'s `needs`): an import must come
  back with `calendar.events.readonly`, the picker with
  `calendar.calendarlist.readonly`, since Google lets the two be granted apart.
  `google-calendar/connect` (GET → consent, DELETE →
  disconnect; org admin), `/callback`, `/status` (admin: connected account,
  chosen calendar's NAME, who connected; members with no email get an
  add-your-email Banner on /profile instead), `/calendars`
  (GET list / PUT choose — ONLY the admin who connected,
  `Org.googleCalConnectedById`; everyone else 403s, since the list is their
  account's), `/webhook` (Google's push channel — public, checked
  by a per-org HMAC token, reads changes AFTER responding).
- Rules: `orgs/[id]/rules` (org admin) — GET the list + dropdown options (or,
  with `?forSet=`, what one set's Auto schedule needs); PUT replaces the whole
  ordered list, refusing a contradiction with `{ error, index }`. Both answers
  carry a `version` — the fingerprint of the list as stored
  (`rulesVersion`) — and the PUT takes it back. Rules are ORG-wide and a save
  replaces the WHOLE list, so a save built on a copy loaded before another
  admin's edit would silently revert it; a mismatch is a 409 with
  `{ stale: true, rules, version }`, nothing is written, and `OrgRules` shows
  the list the server sent rather than rolling back to its own. The check runs
  INSIDE the transaction (`saveOrgRules`'s `expectedVersion`), so two
  simultaneous saves can't both pass.
- Availability: `availability`, `availability/[id]`, `availability/complete`,
  `availability-request`.
- Export: `export`, `export/[id]` (ICS).
- Admin (re-checks `isAdmin` vs db): `admin/users(+/[id]|/stats)`,
  `admin/team-load` (per-window serve counts for the generate-review panel),
  `admin/schedule-baseline` (GET ?from=&to= → the `StagedPlan.baseline` for a
  window: load tallies, nearby bookings, MD seed, and `ruleContext`. The
  generate route builds this inline; the calendar's Preview Mode has no
  generate step, so it fetches this BEFORE opening — the workspace resets its
  staged edits whenever the `plan` prop changes identity, so a late arrival
  would discard the admin's work),
  `admin/sets/[id]/roster` (the WHOLE roster diff — removals, swaps and
  additions — in one PATCH, applied as one transaction with one grouped Slack
  notice; it replaced the per-seat `admin/assignments` routes, which fired a
  round trip and a Slack message per person), `admin/sets/roster` (PUT: MANY
  sets' diffs + optional `mdUserId` each, one org, every set validated before
  ONE transaction — the calendar Preview Mode's Save; an MD the new roster
  can't hold comes back in `mdRejected`. Both share `lib/rosterDiff.ts`
  `prepareRosterDiff`/`rosterAftermath`; a prepared roster carries its writes as
  GROUPS (deletes/updates/inserts/history) and **`rosterWrites`** folds the whole
  batch into one deleteMany + the reassignments + two createManys, because a
  quarter of Sunday rosters written a seat at a time was 428 statements and ran
  past Prisma's 5s transaction limit — the save died of the timeout and the
  route called it a duplicate seat. `ROSTER_TX_TIMEOUT_MS` is the headroom and
  **`rosterSaveError`** is what keeps the message honest: only `P2002` says
  "already in this role", anything else says nothing was saved. DMs go out ONCE per person across the
  whole batch via `lib/slack.ts notifyRosterChanges`/`rosterDmText`, so a month
  of one role is one message, not one per set; a multi-set DM lists sets as
  plain text and closes with ONE link to My Sets — no per-set links), `admin/templates(+/[id])` (both carry
  `practices` — a weekday + window list that REPLACES the whole set, like the
  rules PUT; omitting the field on a PATCH leaves the existing ones alone, so
  renaming a time can't wipe them),
  `admin/generate(+/apply)`, `admin/availability-request`,
  `admin/drafts(+/[id])` (saved previews — GET lists them WITHOUT
  their plan payloads, `[id]` GET is what carries one back. `?mode=` /
  `mode` in the body picks the WORKSPACE: `generate` (default, and what every
  legacy row is) or `preview`. Lists, the five keep-slots and the recovery slot
  are all per mode, so the two piles never mix — a generate plan only ADDS
  people on apply, a preview plan is one roster per existing set saved as a
  diff, and either opened in the other's workspace would quietly do the wrong
  thing).
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
  SPREAD is the last word in `byRotation`, below load and per-team load: of two
  equally loaded, equally fresh people, the one whose nearest other booking is
  FURTHEST away wins (`nearestGap`). Deliberately below load — ranking spread
  first hands sets to whoever has an empty diary and undoes the balancing —
  but it is what pushes a capped person's few sets apart instead of letting
  them cluster at one end of the month.
  A required-MD set is filled on PURE ROTATION first and only refilled with a
  reserved MD seat if that roster has nobody who could lead (the old
  reserve-first pass pinned the seat to one person); the reserved seat goes to
  the freshest MD, in the best role they play — `MD_ROLES` is preference-ordered
  (electric guitar, keys, bass), and `lib/md.ts` designates the MD the same way.
  ✅tested
- `constants.ts` ✅ · `dates.ts` ✅ (`upcomingOccurrences`, `format*`, minute⇄time)
  · `ics.ts` ✅ (`buildIcs`) · `stats.ts` ✅ (serve-count windows/ranges).
  `shortDateTimeCompact` ("8/20/26 10PM") is THE date every chat message names
  a set by — short enough that a swap can name two sets in one sentence.
- `schedulingRules.ts` — the Rules vocabulary: five person-shaped kinds
  (ONLY_IF_NEEDED, PREFER, SAME_PLAYER weekly-by-set-type or two specific sets,
  TOGETHER always/never, LIMIT per Mon–Sun week or month — `userId` null caps
  EVERYONE, each person separately) plus three ROLE-shaped ones that are the
  old hardcoded behaviour made visible: LEADS_FROM (which roles an MD leads
  from, was `MD_ROLES`), ROLE_HOST (a role only held alongside another, was
  `ACOUSTIC_HOST_ROLES`) and MAY_DOUBLE (was `OVERLAP_ALLOWED_PAIRS`). All
  three are REQUIRED-only, seeded by the rules GET route the first time the
  editor is opened, and resolved by **`resolveRoleBehavior`** — whose contract
  is the safety net: no rule governing a thing → the lib/constants.ts default,
  so an unseeded org schedules exactly as it did before rules existed; a rule
  present but switched OFF → the behaviour is off, never a fallback. They have
  real builder forms (an ordered role-chip picker, since MD order IS the
  preference). A required SAME_PLAYER picks only from people free for BOTH
  sets — it never seats someone on one and strands the other.
  **Every rule carries a `teamId` scope**: null = the whole org, otherwise only
  that team's sets (`scopeCovers`). `buildSchedule` derives its rule context
  PER TEAM (`rulesFor`, memoized — a plan is a couple of teams over many sets),
  so two teams can hold opposite rules and both are honoured;
  `findContradiction` likewise runs once per scope (each team's rules plus the
  org-wide ones), so "always together" on one team and "never" on another is
  not a clash. A LIMIT's scope decides BOTH when it applies and what it counts:
  "2 a month on Youth" counts Youth sets only, while an unscoped one (the
  default) counts every team's. Bookings therefore carry a `teamId` all the way
  from `ruleContext` / the generate + baseline routes through
  `StagedPlan.baseline` — a booking with no team is counted by org-wide limits
  only. ✅tested `parseRuleParams` /
  `validateRules` (ids checked against the org), `findContradiction` (between
  REQUIRED rules only; run by the PUT route AND the editor), `describeRule` /
  `explainRule` (the editor's sentences), `weekKey`/`monthKey`, and
  `templateIdOf` (sets don't store their template, so it's recognised by
  label + team + weekday + time), and `rulesVersion` (the stored list's
  fingerprint — row ids in order, which change on every save since one
  deletes and re-inserts the lot). ✅tested `buildSchedule`'s 7th arg `ScheduleOptions`
  feeds them in: REQUIRED never bends (a slot is left open instead — a held
  SAME_PLAYER seat is the `HOLD` case), PREFERENCES rank lexicographically
  above rotation. All three callers pass them; the prisma side is
  `schedulingRuleStore.ts` (`ruleContext` = nearby sets + a month of bookings
  either side). ✅tested
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
- `sets.ts` — five pure set rules, numbered in its header. §5
  `seatIndex`/`rolesHeldOn` is the newest: who already holds which roles on
  which set, which is how `GET /api/swaps/candidates` can warn that a trade
  would leave someone playing TWO roles on one set (`theyAlsoOnYourSet` /
  `youAlsoOnTheirSet`). Never a blocker — several roles on one set is
  legitimate; only the SAME role on both sides is impossible, and that set is
  dropped from the candidate list outright. It IS the picker's one RED
  warning though: an availability block is an intention (amber, and one flag
  however the block was entered), a seat someone already holds is a fact.
  ✅tested
- `guestTeams.ts` — guest-team vocabulary: `GuestRoleSpec`, `isUnbounded`,
  `openSeats` (an `allAvailable` seat reports 0, so it never reads as a hole),
  `validateGuestRoles(raw, allowedKeys)`. ✅tested
- `practices.ts` — practices on a set, pure: `practiceWeekStart` (the **Monday**
  of a set's week — the whole meaning of "the Wednesday" on a template),
  `practiceDates` / `practicesForSet` (a template's weekdays resolved against
  one set), `practiceMinutes`, `validateTemplatePractices` (a duplicate is
  DROPPED, since two practices at one instant would be two identical calendar
  events; anything else is an error, because guessing would send the wrong
  invite), `validateSetPractice` (any date at all — that's the point of an
  ad-hoc one — and it names the same-instant clash and the cap ITSELF rather
  than leaving a `@@unique` violation for the route to interpret),
  `practiceCountBadge` ("+2" after a recurring set's time, null for none) and
  `describeTemplatePractice`, and **`practiceFreeBusy`** — the free/busy modal's
  answer, with `isUserAvailable` INJECTED so it can't drift from the
  scheduler's own verdict; each rule is tried alone to name the ones that would
  block on their own (the same leave-one-out trick `ruleHeldRoles` uses).
  `PRACTICES_ARE_NOT_BOOKINGS` is a note, not a
  switch: nothing here is wired into `lib/scheduler.ts` and nothing should be —
  auto schedule ignores practices by construction, there being no
  practice-aware branch to forget to turn on. ✅tested
- `stagedPlan.ts` — pure helpers for the generate-review modal, incl. the Team
  load panel's metrics: `LOAD_METRICS` / `loadMetricRange()` / `parseLoadMetric()`
  let the admin measure people by this plan, upcoming bookings, or the past
  month/3/6/12 months. Only "this plan" is counted client-side; every window is
  ONE on-demand query to `GET /api/admin/team-load?metric=…`, cached per window
  in the modal — the plan itself never carries a year of assignments. ✅tested
  `HOVER_HIGHLIGHT_DELAY_MS` (2000) is how long the pointer must REST on a
  name before every other seat that person holds lights up. `StagedScheduleModal`'s
  `hoverUser` is the debounce: arriving clears the current highlight and starts
  the clock, leaving (null) clears and cancels at once — undelayed, the grid
  flickered through every name the cursor crossed. The tour says "about two
  seconds" in words, so the number and the copy are pinned to each other. ✅tested
  `ruleHeldRoles`/`totalRuleHeld` are the "!" marks: which open slots a
  REQUIRED scheduling rule is what's holding empty (a SAME_PLAYER seat reserved
  for someone who can't take it, a role every candidate is refused for). Found
  by DIFFERENCE — fill the set once with the required rules and once without,
  and any role the rules-off run could fill but the rules-on run couldn't is
  held — so the flag can never drift from `buildSchedule`'s own answer.
  Disjoint from `unfillableRoles` by construction. It returns role → the RULES
  holding it, found by leave-one-out (drop one required rule, see if the seat
  frees) so the "!" mark's (i) can name the rule to go and change; rules that
  only hold it jointly are all named. ✅tested
  `planFixedSets` merges the baseline's snapshot of the sets around a plan with
  the plan's OWN sets as staged, dropping the stale copy where both name the
  same set — `ruleContext` returns every set in the window, which in Preview
  Mode IS the previewed sets, so un-merged a SAME_PLAYER rule sees each twice
  and owes its seat to both rosters' players. ✅tested
  Also the preview's COPY/PASTE clipboard: `copySet` lifts a set's EFFECTIVE
  shape (already resolved against its team catalog) + roster, `pasteSet` stamps
  both onto another set — which keeps its own identity (time, label, team) and
  takes the source's form, every pasted seat LOCKED so a later auto-fill treats
  it as a constraint. ✅tested
- `drafts.ts` — saved previews: `MAX_DRAFTS` (5 per org PER MODE),
  `AUTOSAVE_INTERVAL_MS`, `DraftMode`/`parseDraftMode` (`generate` | `preview`,
  the `ScheduleDraft.mode` column — anything unrecognised reads as `generate`,
  which is what rows predating the column are), `canSaveDraft` (its `replacingId` is what makes
  re-saving an existing draft free, and promoting the recovery row NOT free),
  `draftLabel`, `normalizeDraftName`. Two kinds of `ScheduleDraft` row, told
  apart by `isRecovery`: DELIBERATE ones (the Save Draft button, capped, may be
  named) and the ONE rolling RECOVERY slot per person per org (the once-a-minute
  autosave), which never counts against the cap — a full set of keep-slots is
  exactly when you most need the safety net. Both the POST and the promoting
  PATCH re-check the cap against the db. ✅tested
- `draftLink.ts` — the ONE spelling of a link to a saved draft:
  `DRAFT_PARAM` (`?draft=`), `slugifyDraftName`, `draftSlugs`, `draftSlug`,
  `draftForSlug`, `draftSearch`. The link carries a slug of the draft's NAME,
  never its cuid, because its whole point is being pasted into a message — so
  renaming a draft changes its link, which is the trade. Slugs are resolved
  against a LIST, not looked up: two drafts in one org and mode may share a
  name, so `draftSlugs` numbers the duplicates in list order (`-2`, `-3`) and
  the first keeps the bare slug. BOTH workspaces mirror the open draft into the
  URL and clear it on the way out (`app/calendar/page.tsx` Preview Mode,
  `app/create/page.tsx` generate), and following a link opens that draft
  directly — on the calendar that means waiting for the preview refs, the draft
  list and the sets themselves, since a draft is laid over the calendar as it
  stands. A slug nothing answers to says so instead of opening the wrong plan.
  ✅tested
- `scheduleTour.ts` — the words of the review workspace's guided tour, as data:
  `tourSteps({preview})` → one step per quirk (views · team load · the person
  filter · hover · **the plan-wide action row** · locking · the card's ↻/✕ ·
  copy-paste-undo · the warnings · committing), with
  the last step forked per mode (Preview Mode commits with Save Changes, and
  its drafts can go stale, so its step says reopening lays one back over the
  calendar as it stands; it also names the Drafts button on the step-1 modal,
  the `?draft=` link in the address bar, and that the screen won't open on a
  phone). `actions` covers the four buttons that act on the WHOLE plan — Auto
  schedule, Clear all people, Lock all/Unlock all, Scheduling rules — and
  `warnings` covers all FOUR colours, the yellow rule-BREAK box included. Every
  step's art lives in `ScheduleHelpModal.StepArt`, so a new `TourArt` needs a
  branch there or the step draws an empty box.
  It is the ONLY explanation of that screen — the paragraph
  of instructions that used to head the modal and the shortcut hint under it
  were deleted in its favour, so a missing step = an undiscoverable feature.
  ✅tested
- `tourSeen.ts` — "has this browser been shown that walkthrough?", in
  localStorage: `APP_TOUR_KEY` (the navbar's "?" tour) + `scheduleTourKey(mode)`
  (the review workspace's, keyed per mode so seeing one doesn't silence the
  other) + `hasSeenTour`/`markTourSeen`. Every access is wrapped — private mode
  THROWS rather than returning null — and an unreadable store reports "seen", so
  a browser that can never record the flag isn't nagged every visit. ✅tested
- `calendarPreview.ts` — the calendar's Preview Mode: set types, `toStagedSet`
  (every real seat opens LOCKED, so Auto schedule only fills gaps until the
  admin unlocks), `previewSaves` (the save diff; re-proposed seats are matched
  back to their rows — same person+role = no change, same role = reassignment —
  so a Clear all + Auto schedule doesn't delete and re-add people),
  `describePreviewSaves` (the batch confirm's sentence), and `applyDraftSets`
  (reopening a saved preview draft: the CURRENT sets are the ground truth and
  the draft supplies only roster, MD and shape — its seats come back WITHOUT
  row ids, so `previewSaves` folds them into reassignments of the live rows,
  and sets the draft names that no longer exist come back as `missing` for the
  caller to say out loud. The draft is deleted once its rosters really save,
  so a spent plan can't be re-imposed later).
  **The overlaid sets are the EDITS, never the base**: `app/calendar/page.tsx`
  keeps the un-overlaid calendar in `previewBase` and that is what
  `previewSaves` diffs against, because the draft's seats carry no row ids —
  diffed against themselves every seat reads as an addition and whoever the
  draft replaced stays seated beside their replacement. ✅tested
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
- `publicPaths.ts` — `HOME_PATH`, `isPublicPath`, `isChromelessPath`: WHICH
  PAGES A STRANGER MAY READ (`/`, `/login`, `/privacy`, `/terms`) and which
  render bare (those plus `/join`). Four places used to carry their own copy of
  that list — `proxy.ts` at the edge, `AuthGate` (render or bounce to /login?),
  `Navbar` and `SwipePager` (any chrome here?) — and they drifted the moment the
  public home page arrived: the edge let `/` through and the client still
  bounced it to /login, which is the very login wall the page exists to remove,
  and a bounce like that only shows in a browser. Three of them now share this;
  `proxy.ts` is the one copy left, because its imports can't follow it to the
  edge. ✅tested
- `slackStatus.ts` — the client-side cache in front of `GET /api/slack/status`.
  Four surfaces ask "has this org connected Slack?" (Team, Create, the team
  members modal, and the set detail modal on every open); caching the PROMISE
  per org makes that one request and collapses simultaneous askers. Connecting
  is a full navigation (the cache dies with the page); the one in-app change,
  Disconnect on Org settings, calls `invalidateSlackStatus(orgId)`. ✅tested
- `dropdownPosition.ts` — `placeMenu()`: where a portaled dropdown panel
  actually goes. The portal (see `components/common/Dropdown.tsx`) stops a
  modal CLIPPING the menu; it doesn't stop the menu landing off the screen. A
  right-aligned panel hangs leftward from its trigger, so a trigger near the
  left of a phone put the panel's left edge ~86px past the edge and the set
  modal's "⋮" lost the first letters of every row. So placement is a CLAMP, not
  a pin: the panel keeps `MENU_GUTTER` from both sides (a panel wider than the
  screen pins to the LEFT gutter — its first characters are the ones worth
  keeping), flips above the trigger when there's no room below AND more room
  above, and reports a `maxHeight` to scroll in when neither side can hold it
  whole. Pure viewport-space geometry, which is why it's a module and not
  inline arithmetic. ✅tested
- `loadMetrics.ts` — the "how often is this person already serving?" windows,
  shared by the review modal's Team load panel and the ×N badges. Only the
  review workspace PICKS one (`PLAN_LOAD_METRICS`): a plan spans months. The
  set detail modal has no picker — `SET_LOAD_METRIC` is the whole answer, the
  set's own calendar month, because one set is one month's problem and the
  176px control that offered "past 3 months" there took a phone's action bar by
  itself. `serveMonthLabel()` names that month for the (i) and the badge's
  title, so neither describes a window the reader can't choose. ✅tested
- `layout.ts` — `BOTTOM_NAV_MAX_WIDTH` + `isBottomNavWidth()`: the one number
  behind "is this the app-style layout?", shared by the bottom bar's `lg:`
  classes, SwipePager and PullToRefresh. Plus `PREVIEW_MIN_WIDTH` (768 = `md`)
  + `isPreviewWidth()`: the narrowest screen the review workspace is usable at.
  The Preview Mode button is already absent below it (it lives in the month
  grid's `md:` toolbar), so the one way in a phone still has is a `?draft=`
  link — which is made to be pasted into a message. `app/calendar/page.tsx`
  checks this BEFORE the link's three fetches and says "too wide for a phone
  screen … computer or tablet" in the same `linkError` banner a dead `?set=`
  link uses. Deliberately `md` and not `BOTTOM_NAV_MAX_WIDTH`: a tablet gets
  the bottom bar AND the workspace. ✅tested
- `swipeNav.ts` — the tab-swipe gesture's math: `gestureAxis` (a move is a
  swipe only if it's `AXIS_RATIO`× more horizontal than vertical — a scroll
  that drifts sideways stays a scroll, and once vertical wins the touch is the
  page's for good), `armDistance`/`swipeProgress` (0→1 over a capped fraction
  of the width — it IS the cue's opacity), `shouldCommit` (a full pull, or a
  flick past half), `swipeTarget`. ✅tested
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
- `messageFormat.ts` — the `MessageFormat` shape
  (`bold`/`italic`/`code`/`link`/`maxChars`) + `splitMessage`. Pure; concrete
  formats live with their integrations. EVERY bit of markup in a message goes
  through this — the spellings differ per provider (bold is `*x*` on Slack,
  `**x**` on Discord), so a hand-typed one is a bug that only shows on the
  provider you weren't looking at. ✅tested
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
- `googleBusy.ts` — Import from Google Calendar's rules, pure: a person's
  events → merged per-day busy windows in the app's zone (`busyWindows`).
  EVERY event blocks (not just set times — the blocks are the admin's record),
  timed ones unless Free, ALL-DAY ones always as the whole day; cancelled and
  declined skipped; worship sets deliberately NOT skipped (a request never
  covers already-scheduled sets). `importNotice` = /schedule's banner on
  return. ✅tested. Its Google + db side is `googleAvailability.ts`: one-shot
  `calendar.events.readonly` consent asked ONCE, at the first import (never at
  sign-in — a sensitive scope there would put Google's unverified-app warning
  on the login); its refresh token is kept encrypted in
  `User.googleImportRefreshToken`, so later imports run with no screen, and a
  revoked one is forgotten and re-asked, sharing `/api/google-calendar/callback` via its own signed state
  (`signImportState`/`verifyImportState` in `googleCalendar.ts`). ✅tested
- `weekView.ts` — the availability WEEK view's layout: `weekStart` (Sunday),
  `dayBlocks` (each block's kind google|specific|recurring + side-by-side
  lanes for overlaps). Overlapping IMPORTED blocks are merged into one first —
  one import already merges its own day, so this is what stops a second
  request's import drawing two half-width sky columns over one busy afternoon.
  Hand-made blocks and weekly repeats are left alone: different things, and
  their colour says so. ✅tested
- `googleCalendar.ts` — the per-org Google Calendar integration (README
  "Google Calendar"): one connected account per org, an app-made calendar by
  default or one the connecting admin picks (`listCalendarsFor`/`selectCalendar`
  — a move cancels the old events and re-creates them), an event per upcoming
  set with the roster invited. On whenever `GOOGLE_CLIENT_ID`/`_SECRET` are
  set — there's deliberately NO enable flag; the UI is an admin-only row in Org
  settings (`components/OrgGoogleCalendar.tsx`). `syncSetCalendar(setId)` is idempotent (create or patch from the
  db) and writes the set's event AND one per upcoming PRACTICE from the same
  load — same guests, same setlist, its own window — so every caller keeps
  rehearsal invites in step for free; `syncOneEvent` is that shared write.
  Only the set's own event carries `SET_ID_PROPERTY`; a practice carries
  `PRACTICE_ID_PROPERTY` instead, because `applyRsvps` keys off the former and
  accepting a REHEARSAL invite must not confirm a seat on the service.
  A practice's title is `practiceTitle` — **"(Practice) <set name>"**, since
  its set is the only thing that tells two rehearsals apart in a month of
  entries; bracketed rather than "Practice: …" so the set's own name starts as
  early as possible in a cell that truncates hard.
  Routes call `syncSetsAfterResponse(...ids)` (Next `after`) on every set,
  roster, swap-approval and setlist change, and DELETE reads
  `calendarEventsOfSet` before the row goes — plural, since a set's practices
  have events of their own and cascade away with it (`calendarEventOfPractice`
  is the same read for one practice). Write-back: a watch channel pings
  `/api/google-calendar/webhook`, the stored sync token reads what changed, and
  an ACCEPTED invite confirms that person's PENDING seats (a No changes
  nothing). The daily cron renews channels (`maintainCalendarWatches`). A seat
  mid-handoff stays on the old owner's invite until approved. Never throws.
  The pure half is `calendarEvent.ts` (`eventDescription`/`eventAttendees`/
  `seatsToConfirm`, ✅tested); `googleCalendar.ts` is ✅tested with mocked fetch.
- `invitePicker.ts` — /profile's "Send invites to" picker, pure:
  `inviteOptions` / `selectedInviteValue` / `inviteSelectionValue` +
  `INVITE_OTHER_VALUE` (the option that opens the address box and saves
  NOTHING, since it isn't an answer yet). See the `calendarInviteEmail` note in
  the data model. ✅tested
- `profile.ts` — the /profile save rules, pure: `resolveProfileEmail` (an
  OAuth-only account's email is not its own to change) and
  **`calendarResyncNeeded`** — whether saving a profile has to re-sync that
  person's upcoming sets, which is the write that actually sends or withdraws
  their invites. It compares the RESOLVED `inviteAddress`, not the two fields,
  so pointing the override at the address already in use is not a re-sync (and
  a re-sync emails the whole team). A changed address re-syncs, and so does
  switching invites back
  ON (that is how they arrive). Switching them OFF is the one case that asks:
  it could mean "no more of these" or "and take me off the ones I have", so
  /profile puts that question in a modal and only a yes (`withdrawInvites` in
  the PUT body) touches events already sent. The opt-out itself saves either
  way, BEFORE the modal opens, so a dismissed question can't leave the ticked
  box disagreeing with the db. ✅tested
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

Feature: `CalendarMonth`, `GoogleImportModal` (Import from Google Calendar as a
screen: pick which of your own calendars to read — NOTHING is ticked to begin
with, since an import writes onto someone's availability and which diary it
reads is a deliberate choice; the header's one button offers whichever way the
list isn't ("Select all" with nothing ticked, "Deselect all" with any), so the
way out of a half-made selection is always the same button — preview what
they'd block in the page's own week grid — only the import's blocks, no weekly repeats and
nothing already on your availability — then import. Every Google call draws a
BLOCKING overlay over the body with what it's doing, and the footer's buttons
are disabled to match; the consent screen is the one step that leaves the page
and it comes back into this modal), `AvailabilityWeekView` (/schedule's Month · Week
toggle: hours down, days across, a box per block coloured by where it came
from — sky Google, rose by hand, amber weekly; read-only; 6 AM–10 PM only
(`lib/weekView.ts clipToView`) at a FIXED height with no scroll box; the legend
leaves out Google unless the import is configured or Google blocks exist), `CreateSetModal`, `SetDetailModal` (edits are STAGED:
everything writes to a local copy, a sticky footer has Delete · Close · Save,
Save COMMITS AND CLOSES (a failed save keeps the modal + edits up), and any
exit with changes hits a confirm that lists them — Delete-set, Slack messaging
and sending a note act immediately; the Notes box is a composer with a send
arrow, empty on every open, its log below holding what's been written; there's
no per-set history here, that's the Team tab's `TeamActivityModal`), `SetFormFields`,
`SetPractices` (a set's practices, under Songs in the detail modal — a
practice's ONE home, since it's deliberately off the calendar. Everyone on the
set reads them and can click one to see who's free; adding and deleting is
admin-only, and unlike the rest of that modal it acts IMMEDIATELY rather than
staging, because each one sends or cancels a real calendar invite — the same
reason Delete set and sending a note do. The free/busy modal fetches on the
CLICK, never on the set opening. Deleting asks first: it emails the whole
roster a cancellation. Each row LEADS with its ✕ and adding is a full-width
dashed "+ Add Practice" bar — the same control the Create tab's weekly set
times use, so "add another one of these" looks the same wherever it is),
`TemplatePracticesEditor` (the same thing for a weekly set time: a weekday +
from/to per row, since a weekly time has no date. Deliberately NOT in
`SetFormFields`, which `CreateSetModal` shares — a practice on a concrete set
is a date, not a weekday. It runs `validateTemplatePractices` as you type, so
the form can't offer a save the API would 400. Same two controls as
`SetPractices`: the ✕ leads its row (trailing it, it landed under whichever
field wrapped last) and the dashed bar adds),
`SlotCapacityEditor`, `GuestTeamsModal`, `TemplateModal` (the weekly set time
form. Its day picker is seven toggle buttons ACROSS — `DAY_INITIALS`
("Su"…"Sa") visible, the full day name as the accessible one, so it is still
`getByRole("checkbox", { name: "Sunday" })` and still `.check()`-able. As
full-word checkboxes they wrapped into three ragged rows of 16px targets on a
phone and outweighed every other field; a week reads as a week when its days
sit side by side. Adding is multi-select, editing moves the one row),
`MySetsPanel`,
`GenerateModal` (the "Generate New Schedule" options — window, which recurring sets, and an
optional per-set-type color) → `StagedScheduleModal` (the preview — and, as
`mode="preview"`, the calendar's Preview Mode too, which has the same plan-wide
Auto schedule · Clear all people · Lock all/Unlock all row and confirms the
batch before Save; a set type's
color tints its cards at 10%, matched via `StagedSet.templateId`; each card's top right carries a padlock that locks or unlocks
THAT set's whole roster (the plan-wide Lock all's per-card twin — settle one
set and let Auto schedule keep working on the rest); every slot row
leads with a ✕ that drops THAT slot from THAT set — capacity − 1 plus its
occupant, written into `StagedSet.slotCapacities`, which both apply and the
preview save persist, the same edit `SetDetailModal.deleteSlot` makes — and a
role emptied of slots comes back via the card's "+ role" chips; the unfillable
(red) and conflict (amber) banners ride ON the footer's action bar, bled to the
modal's edges — the body scrolls for a long plan, so at the top they were gone
by the time you were looking at the roles they named. The two RULE banners
(indigo "left open by a required rule", yellow "break a scheduling rule") lead
with `RuleAlertIcon`, a drawn circled "!", not a bare "!" character — beside
the "⚠" the other two lead with, a lone exclamation mark read as stray
punctuation. The per-seat marks stay a plain "!": those sit in a `Badge`,
which gives them the frame this icon has to draw. Clicking a
card's own space SELECTS it — ⌘/Ctrl+C then copies its shape + people and
⌘/Ctrl+V stamps them onto another selected card, ⌘/Ctrl+Z takes the last paste
back (an undo entry snapshots the WHOLE set list, since `designateMDs` re-settles
directors across the plan, and a snapshot whose `after` no longer matches `sets`
means something else edited since — the history is dropped rather than rewinding
over that work); all three are bound on the document so cards needn't enter the
tab order, and each flashes a pill on the card it happened to
(`animate-flash-fade`); in BOTH modes Save Draft parks the
plan via `lib/drafts.ts` and a once-a-minute autosave writes the same plan into the
org's recovery slot — in Preview Mode it's dead until something has changed,
since an unedited preview is just a copy of the calendar),
`DraftsModal` (the saved-preview list — open or delete, the delete confirm
stacked over it so you stay in the list, which is where making room happens;
shared by the Create tab and `PreviewModeModal`'s own Drafts button, each
reading its own mode's rows),
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
gestures can't drift from the bar), `SwipePager` (the tab swipe: NOTHING
MOVES — not the page, not the cue. A clearly sideways drag (`lib/swipeNav.ts`)
fades up a round arrow disc on the side you're heading for, parked clear of the
edge; it's two stacked discs, the armed indigo one fading in over the pale one
by the same `progress`, so COLOUR AND OPACITY ARE THE WHOLE ANIMATION and
"fully dark = release and you land there" is the one thing to read. Nothing to
put back if the gesture was a misread, and no transform on the content means it
can't become the containing block for a `fixed` modal. Touches starting in a
dialog or a sideways-scrolling box aren't ours),
`Logo`, `PullToRefresh` (phone pull-down-to-refresh, mounted in
`app/layout.tsx` around `SwipePager`; a page registers its own refetch with
`usePullToRefresh(reload)` — calendar/set-manager/schedule/approvals do, the
pages showing live db data. A page that doesn't register gets NO gesture at all
(profile, org settings…): there's deliberately no `location.reload()` fallback,
which flashed the full-app splash. A surface with its own drag gesture
opts out with `data-no-pull`),
`StatusBadge`, `ExportIcsButton`, `LoadingProvider`.
Primitives in `components/common/`: `Badge Banner Button Card Checkbox
ColorPicker Dropdown Input Modal Select Stepper LoadingDots LoadingScreen`.
(`Dropdown` portals its menu to `<body>` so a modal can't clip it, then places
it with `lib/dropdownPosition.ts placeMenu` — it renders the panel hidden for
one pass to MEASURE it, since the panel's own size is half of where it can go.)
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
resize mid-click (it implies `disabled`); on phones a modal footer keeps a destructive `Button`
(`danger`/`dangerOutline`, tagged `data-destructive`) at full height but only
its label's width while the other buttons fill the row, so it's never the
widest target; dismiss buttons say **Close**, never "Cancel" (that word is
kept for undoing a request, e.g. "Cancel swap"); `Checkbox` takes `rowTarget` to make
the whole row a real `<label>` (off by default: most rows carry chips and text
you may want to click without flipping a tick); `Input`/`Select` set their own
`text-base sm:text-sm` — 16px on phones is what stops iOS zooming into a
focused field — and step aside when the caller passes its own size; `Modal`
renders into `<body>` (a transformed ancestor — the swipe pager, pull-to-refresh
— would otherwise be what its `fixed` overlay centres in), takes `headerActions`
for controls pinned in the header left of the ✕, and accepts `footer` as a
FUNCTION `({ atEnd }) => …` for an action that must wait until a long body has
been scrolled to the end — the availability submit's Confirm. Both set forms —
`CreateSetModal` and `TemplateModal` — pass their Close/Save buttons as
`footer` rather than ending the form with them, which is what pins them and
gives them the phone row's 44px; the submit button is outside the `<form>` as a
result, so it carries `form={formId}` with a `useId()` the form shares.)
`SetFormFields` asks for a start + **end** time; the set still stores
`durationMinutes` (`lib/dates.ts durationBetween` / `minutesToTimeInput`).
**Auto Create Slack Channel** (the `groupChatLeadDays` number, blank = off) and
**Team** share ONE row, half each — a two-digit number and a handful of team
names neither needed a row of its own. The team picker is CHIPS, not a
`Select`: the same rounded pill the set modal's title wears, so the whole
choice is readable at a glance and picking one is a single tap
(`getByRole("radio", { name: "Sunday Team" })`, `aria-checked` the state).
Switching team still clears any custom shape — its keys are the old team's
roles.

## Slack / chat message house style (`lib/slack.ts`)

Every DM reads the same way, so a column of them is scannable:
**emoji + bold label**, the set's name as `code`, one date format, and labelled
links instead of bare URLs. The pieces are all in `lib/slack.ts`: `EMOJI` (one
table — these get re-picked by hand more than the copy does), `lead()`,
`setName()`, `setWhen()`, `linkOr()`. Bold and code always sit OUTSIDE a link —
no provider renders markup inside a link label, which is also why the digest's
labels and the batched-roster DM's set names can't be part of their links.
Every message that LISTS a set's people marks the set's MD with **"(MD)"**
after their name — `teamRosterText` (the group chat's roster) and
`weeklySummaryText` (the week-ahead digest), so who is leading reads the same
in both. Matching is by user id, so a caller whose roster carries no ids marks
nobody rather than guessing by name.
A full inventory of who gets what, when, with the literal copy, is the
TapWorship Slack Notices artifact.
The ONE daily cron (`vercel.json` → `/api/cron/daily`) fires at **13:30 UTC**
= 6:30 AM PDT / 5:30 AM PST. `DIGEST_SEND_MINUTE` is the 6:30 target and
`DIGEST_WINDOW_{START,END}_MINUTE` (5 AM–12 PM) is the slack a fixed UTC slot
needs across DST — move one and `tests/unit/digest.test.ts` pins the other.

## Gotchas

- **Never ship a focusable field under 16px on touch.** iOS zooms the page in
  on focus and never zooms back out. `common/Input`/`Select` carry
  `text-base sm:text-sm`, but that misses tablets and every hand-rolled
  `<input>`/`<textarea>`; the backstop is the `@media (pointer: coarse)` rule
  at the bottom of `app/globals.css`, deliberately UNLAYERED so it beats
  Tailwind's utilities layer.
- **Touch feel lives in `app/globals.css`, not per component.** Buttons, tabs
  and nav links can't be long-press-selected (`user-select`/`touch-callout`),
  and on a coarse pointer anything tappable dims while pressed; `Button` has
  its own `active:` press-in, which wins. Tailwind's preflight already kills the
  tap-highlight flash. The status-bar colour is `lib/theme.ts THEME_COLORS`
  (= the nav's colours), retargeted by `applyTheme` when the in-app theme is
  forced. Inner popup lists and the Modal body use `overscroll-contain`.
- Recurring times interpreted in server `TZ` (default `America/Los_Angeles`);
  keep app + db containers on the same TZ.
- Playwright `tests/e2e/global-setup.ts` force-resets + reseeds the test db each run.
- Prisma client is **generated into the repo** (`lib/generated/prisma`) — after
  schema changes regenerate; import from `@/lib/prisma`, never `@prisma/client`.
