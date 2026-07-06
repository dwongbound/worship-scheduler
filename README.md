# Worship Scheduler

Schedule worship teams, request set swaps, track availability, and
auto-generate rosters.

**Stack:** Next.js (App Router) · React · TypeScript · Tailwind ·
NextAuth (username/password) · Prisma · PostgreSQL · Docker ·
Vitest (unit) · Playwright (e2e)

## Quick start (dev)

```bash
# 1. Env files live in the gitignored env/ folder: env/dev.env,
#    env/test.env, env/prod.env (already present on this machine).

# 2. Everything in docker (db + app with hot reload):
docker compose --profile dev up
# → http://localhost:3000

# — OR — db in docker, app on your host (needs node 20):
docker compose --profile dev up -d db-dev
npm install
npm run db:push && npm run db:seed
npm run dev
```

If `db-dev` exits with a PostgreSQL 18 message about existing data in
`/var/lib/postgresql/data`, reset only the local dev database volume and
start again:

```bash
docker compose --profile dev down
docker volume rm worship-scheduler_dev-db-data
docker compose --profile dev up
```

**Seeded logins** (all passwords `password123`): `admin` (site admin),
`bob` (drums), `kate` (drums), `carol` (keys/vocals), `dave` (bass),
`erin`, `frank`, `grace`, `henry`, `ivy`, `jack`. See `prisma/seed.ts`.

## The three environments

One `docker-compose.yml`, selected by `--profile`. Services are named per
type (`worship-scheduler-dev` / `-test` / `-prod`) so `docker ps` is legible.

| Env  | Profile | DB service | DB port | App port | Notes                           |
| ---- | ------- | ---------- | ------- | -------- | ------------------------------- |
| dev  | `dev`   | `db-dev`   | 5432    | 3000     | hot reload, seeded demo data    |
| test | `test`  | `db-test`  | 5433    | 3100     | tmpfs db, runs unit + e2e       |
| prod | `prod`  | `db-prod`  | —       | 3000     | built image, fill env/prod.env! |

```bash
docker compose --profile dev up            # dev db + hot-reload app
docker compose --profile prod up -d --build # built image + db
```

## Testing

```bash
# Everything (unit + e2e) in one container; exit code is the test result:
docker compose --profile test up --abort-on-container-exit

# — OR — on your host:
npm run test:unit                          # pure logic in lib/ (no db)
docker compose --profile test up -d db-test
npx playwright install chromium            # first time only
npm run test:e2e                           # boots the app, needs the test db
```

Playwright's global setup (`tests/e2e/global-setup.ts`) force-resets and
reseeds the test database before every run, so e2e runs are deterministic
and never touch dev data.

## How it fits together

- **Data model** — `prisma/schema.prisma`. A `Set` (time + duration) has
  `Assignment`s; each assignment is one `User` in one role slot. Team
  shape (4 vocals, 1 worship leader, 2 keys, …) lives in
  `lib/constants.ts` → `SLOT_CAPACITIES`.
- **Assignment lifecycle** — `PENDING` (auto-scheduled, needs confirm) →
  `CONFIRMED`, or `SWAP_REQUESTED` → taken by a same-instrument user →
  back to `PENDING` under the new user.
- **Scheduling algorithm** — `lib/scheduler.ts`. Pure function: greedy
  fill, scarce roles first, load-balanced by assignment count,
  deterministic tie-breaks. Unit-tested in `tests/unit/scheduler.test.ts`.
- **API routes** — `app/api/**`. Every route checks the session; admin
  routes re-check `isAdmin` against the db.
- **UI building blocks** — `components/common/` (Button, Modal, Input,
  Select, Checkbox, Badge, Card, Dropdown, and three loaders: `Spinner`,
  `LoadingDots` for in-place refreshes that must not blank out content,
  `LoadingScreen` for the full-screen boot splash — also wired into
  `app/loading.tsx` for route Suspense). Prefer extending these over
  one-off styling.
- **Theme** — three modes (light / dark / system) cycled by the Navbar
  button; logic in `lib/theme.ts`, applied flash-free by the inline script
  in `app/layout.tsx`. `system` follows the OS preference live.
- **Branding** — `components/Logo.tsx` (the "tw" monogram in the Navbar)
  and `app/icon.svg` (favicon) are hand-drawn SVGs, no image assets.
- **Auth** — `lib/auth.ts` (NextAuth credentials + bcrypt). Pages are
  gated by `proxy.ts`; API routes return JSON 401s.

## Slack (future)

`User` already has `email` and `slackUserId` columns, editable on the
profile page. When you wire up Slack: match accounts by email or store
the Slack member ID directly, then DM users on PENDING assignments and
open swap requests. No schema changes should be needed.

## Timezones

Recurring times ("Monday 7pm") are interpreted in the server's `TZ`
(set in the env files, default `America/Los_Angeles`). Keep app and db
containers on the same TZ.
