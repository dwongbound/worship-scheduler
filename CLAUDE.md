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

- **User** — username/passwordHash/name, `isAdmin`, `instruments: Instrument[]`,
  `scheduleCompletedAt` (null = availability not submitted), `slackUserId` (future).
- **Set** — `startsAt`+`durationMinutes`, optional `label`/`notes`,
  `slotCapacities: Json?` (per-set team-shape override; null = global default).
- **Assignment** — one User in one `role: Instrument` on one Set.
  `status: PENDING|CONFIRMED|SWAP_REQUESTED`. `@@unique([setId, userId])`.
- **Unavailability** — `RECURRING` (dayOfWeek + startMinute/endMinute) or
  `DATE_RANGE` (startDate/endDate). Times = minutes from midnight, day 0=Sun.
- **SetTemplate** — weekly recurrence (dayOfWeek+startMinute+duration); the
  generate endpoint expands these into Sets.
- **AvailabilityRequest** — most-recent row is "active"; user must respond until
  `scheduleCompletedAt` > request `createdAt`. Drives the red dot + banner.

Enums: `Instrument` (WORSHIP_LEADER, VOCALS, ACOUSTIC/ELECTRIC_GUITAR, KEYS,
STRINGS, DRUMS, BASS) · `AssignmentStatus` · `UnavailabilityType`.

## Team shape — `lib/constants.ts`

`SLOT_CAPACITIES` = default counts (WL 1, VOCALS 4, ELECTRIC 2, KEYS 2, rest 1).
Never index it directly once a Set may override — use `resolveCapacities(stored)`.
Also here: `validateSlotCapacities` (API guard, MAX_SLOTS_PER_ROLE=20), `ROLE_ORDER`
(scarce-first fill order), `INSTRUMENT_LABELS`, `STATUS_LABELS`, `DAY_LABELS`.

## Pages (`app/*/page.tsx`)

`login` · `page.tsx` (home) · `calendar` · `schedule` · `swaps` · `profile` ·
`create` (admin) · `users` (admin team mgmt — grant/revoke admin, instruments).
`layout.tsx` = pre-hydration theme script; `loading.tsx` = splash; `providers.tsx`.

## API (`app/api/**/route.ts`)

- Auth: `auth/[...nextauth]`, `signup`, `me`.
- Sets/assignments: `sets`, `sets/[id]`, `assignments`, `assignments/[id]`,
  `assignments/confirm-all`.
- Swaps: `swaps`, `swaps/[id]/take`.
- Availability: `availability`, `availability/[id]`, `availability/complete`,
  `availability-request`.
- Export: `export`, `export/[id]` (ICS).
- Admin (re-checks `isAdmin` vs db): `admin/users(+/[id]|/stats)`,
  `admin/assignments(+/[id])`, `admin/templates(+/[id])`,
  `admin/generate(+/apply)`, `admin/availability-request`.

## lib (pure logic, unit-tested where noted)

- `scheduler.ts` — `buildSchedule()` greedy roster fill + `isUserAvailable()`. ✅tested
- `constants.ts` ✅ · `dates.ts` ✅ (`upcomingOccurrences`, `format*`, minute⇄time)
  · `ics.ts` ✅ (`buildIcs`) · `stats.ts` ✅ (serve-count windows/ranges).
- `setStatus.ts` — `setStatus()` → empty|confirmed|unconfirmed|cover.
- `types.ts` — `Api*` (server shapes) & `Staged*` (create-flow) interfaces.
- `auth.ts` — `authOptions`, `getSessionUser()`, `getAdminUser()`.
- `api.ts` — `fetchJsonArray<T>` client helper.
- `theme.ts` — light/dark/**system** source of truth (mirror in layout script).
- `prisma.ts` — singleton client from generated output.

## Components

Feature: `CalendarMonth`, `CreateSetModal`, `SetDetailModal`, `SetFormFields`,
`SlotCapacityEditor`, `TemplateModal`, `MySetsPanel`, `Navbar`, `Logo`,
`StatusBadge`, `ExportIcsButton`, `LoadingProvider`.
Primitives in `components/common/`: `Badge Banner Button Card Checkbox Dropdown
Input Modal Select LoadingDots LoadingScreen`. Prefer extending these.

## Gotchas

- Recurring times interpreted in server `TZ` (default `America/Los_Angeles`);
  keep app + db containers on the same TZ.
- Playwright `tests/e2e/global-setup.ts` force-resets + reseeds the test db each run.
- Prisma client is **generated into the repo** (`lib/generated/prisma`) — after
  schema changes regenerate; import from `@/lib/prisma`, never `@prisma/client`.
