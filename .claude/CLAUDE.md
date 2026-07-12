# Worship Scheduler — context for Claude

Web app to schedule worship teams, request set swaps, track availability, and
auto-generate rosters.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript 6 · Tailwind v4
(`@tailwindcss/postcss`; class-based dark mode — `darkMode: "class"`, `.dark`
toggled on `<html>`) · NextAuth 4 (credentials + bcryptjs; optional Google
OAuth, env-gated) · Prisma 7 (`prisma-client` generator → `lib/generated/prisma`,
via driver adapter `@prisma/adapter-pg`) · PostgreSQL · Vitest (unit) ·
Playwright (e2e) · Docker.

## Layout

- `app/` — App Router pages: home dashboard (`page.tsx`), `calendar`, `swaps`,
  `schedule`, `create` (admin), `users` (admin team management — grant/revoke admin,
  edit instruments), `profile`, `login`, plus `api/**` route handlers.
  `layout.tsx` holds the pre-hydration theme script; `loading.tsx` renders the
  splash; `providers.tsx` wraps NextAuth + theme.
- `components/` — `Navbar.tsx`, `Logo.tsx` (the "tw" monogram), modals,
  and `components/common/` reusable primitives.
- `lib/` — pure logic: `scheduler.ts` (greedy roster fill, unit-tested),
  `auth.ts`, `dates.ts`, `ics.ts`, `stats.ts`, `theme.ts`, `setStatus.ts`
  (set → empty/confirmed/unconfirmed/cover), `constants.ts` (`SLOT_CAPACITIES`
  = team shape; `resolveCapacities` is THE way to read a set's shape),
  `api.ts` (`fetchJsonArray` client helper), `types.ts` (`Api*` server shapes
  and `Staged*` create-flow shapes). `prisma.ts` wraps the generated client
  (`lib/generated/prisma`, gitignored); always import from `@/lib/prisma`.
- `prisma/` — `schema.prisma` + `seed.ts` + `migrations/` (SQL history,
  applied via `prisma migrate deploy`). A `Set` has `Assignment`s; each
  assignment = one `User` in one role slot, and one user may fill several roles
  on a set (unique key = `setId + userId + role`). `seed.ts` wipes and reseeds
  demo data (`password123`) — dev/test only, never run in prod.
- `tests/unit/` (vitest, lib logic only) · `tests/e2e/` (playwright).

## Commands (need node 20; on this machine node runs inside Docker)

- Dev: `docker compose --profile dev up` → http://localhost:3000
- Unit: `npm run test:unit` · E2E: `npm run test:e2e` (needs test db up)
- All tests in a container: `docker compose --profile test up --abort-on-container-exit`
- `npm run typecheck` · `npm run db:push` · `npm run db:seed`
- Deploy: Vercel (app) + Neon (Postgres), free tier — see `DEPLOY.md`. The
  `build` script runs `prisma generate` first (the client is gitignored).
  `npm run db:migrate:deploy:prod` applies committed migrations to a prod DB
  from ambient env (generate new ones locally with `prisma migrate dev`).

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
  default `America/Los_Angeles`). Keep app + db containers on the same TZ. In
  serverless prod (Vercel) the default is UTC — set the `TZ` env var or times shift.
- Playwright `global-setup.ts` force-resets + reseeds the test db every run.
- We use proxy.ts instead of middleware.ts in this version of nextAuth.
