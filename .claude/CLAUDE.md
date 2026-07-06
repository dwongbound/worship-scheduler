# Worship Scheduler — context for Claude

Web app to schedule worship teams, request set swaps, track availability, and
auto-generate rosters.

**Stack:** Next.js 14 (App Router) · React 18 · TypeScript · Tailwind
(class-based dark mode) · NextAuth (credentials + bcrypt) · Prisma · PostgreSQL
· Vitest (unit) · Playwright (e2e) · Docker.

## Layout

- `app/` — App Router pages: `calendar`, `swaps`, `schedule`, `create`
  (admin), `profile`, `login`, plus `api/**` route handlers. `layout.tsx`
  holds the pre-hydration theme script; `loading.tsx` renders the splash.
- `components/` — `Navbar.tsx`, `Logo.tsx` (the "tw" monogram), modals,
  and `components/common/` reusable primitives.
- `lib/` — pure logic: `scheduler.ts` (greedy roster fill, unit-tested),
  `auth.ts`, `dates.ts`, `ics.ts`, `stats.ts`, `theme.ts`, `prisma.ts`,
  `constants.ts` (`SLOT_CAPACITIES` = team shape).
- `prisma/` — `schema.prisma` + `seed.ts`. A `Set` has `Assignment`s; each
  assignment = one `User` in one role slot.
- `tests/unit/` (vitest, lib logic only) · `tests/e2e/` (playwright).

## Commands (need node 20; on this machine node runs inside Docker)

- Dev: `docker compose --profile dev up` → http://localhost:3000
- Unit: `npm run test:unit` · E2E: `npm run test:e2e` (needs test db up)
- All tests in a container: `docker compose --profile test up --abort-on-container-exit`
- `npm run typecheck` · `npm run db:push` · `npm run db:seed`

## Conventions

- **One `docker-compose.yml`**, selected by `--profile dev|test|prod`.
  Services are named `worship-scheduler-{dev,test,prod}` + `db-{dev,test,prod}`.
  The `test` profile's app service runs unit **and** e2e then exits with the
  test code. Compose sets `DATABASE_URL` to the in-network db; `dotenv`/`dotenv-cli`
  don't override existing env, so that wins over the `env/*.env` file value.
- **Env files:** real values in gitignored `env/` (`dev.env`/`test.env`/`prod.env`).
- **Theme:** `lib/theme.ts` is the single source of truth for the
  light/dark/**system** modes; the inline script in `app/layout.tsx` mirrors
  its resolve logic to avoid a flash. Keep them in sync.
- **Loaders:** `Spinner` (generic), `LoadingDots` (3 jumping dots for
  in-place refreshes — keep content mounted so data doesn't flash),
  `LoadingScreen` (full-screen pulsing-name + equalizer splash). Custom
  keyframes (`jump`, `equalize`, `pulse-name`, `radiate`) live in
  `tailwind.config.ts`.
- **Branding:** `Logo.tsx` and `app/icon.svg` are hand-drawn SVGs (no raster
  assets); the favicon is auto-served by Next.js from `app/icon.svg`.
- Prefer extending `components/common/` over one-off styling. API routes
  check the session; admin routes re-check `isAdmin` against the db.

## Gotchas

- Timezones: recurring times are interpreted in the server `TZ` (env files,
  default `America/Los_Angeles`). Keep app + db containers on the same TZ.
- Playwright `global-setup.ts` force-resets + reseeds the test db every run.
