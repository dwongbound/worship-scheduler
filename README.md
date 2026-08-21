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

## Local Docker profiles

One `docker-compose.yml`, selected by `--profile`. Services are named per
type (`worship-scheduler-dev` / `-test` / `-prod`) so `docker ps` is legible.
These are the profiles you run **on your own machine** — the hosted
`staging`/`prod` deployments (below) live on Vercel + Neon, not Docker.

| Profile | DB service | DB port | App port | Notes                                 |
| ------- | ---------- | ------- | -------- | ------------------------------------- |
| `dev`   | `db-dev`   | 5432    | 3000     | hot reload, seeded demo data          |
| `test`  | `db-test`  | 5433    | 3100     | tmpfs db, runs unit + e2e             |
| `prod`  | `db-prod`  | —       | 3000     | built image, exercises `env/prod.env` |

```bash
docker compose --profile dev up            # dev db + hot-reload app
docker compose --profile prod up -d --build # built image + db (local prod smoke test)
```

The `prod` profile lets you run the production build locally against
`env/prod.env` — handy for smoke-testing the built image before pushing, but
**real** production is the Vercel deployment described below.

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

## Environments & deployment

Three environments, promoted left-to-right. **dev** is local; **staging** and
**prod** are two separate Vercel deployments (each with its own Neon Postgres),
wired to git branches:

```text
 dev branch ──PR──▶ staging branch ──PR──▶ main branch
 (local only,      (Vercel: staging       (Vercel: production
  no auto-deploy)   deployment + db)        deployment + db)
```

| Env         | Where it runs        | Database                    | Deployed from                  |
| ----------- | -------------------- | --------------------------- | ------------------------------ |
| **dev**     | your machine         | local Postgres, seeded demo | nowhere — run it yourself      |
| **staging** | Vercel               | Neon (staging project)      | pushes to the `staging` branch |
| **prod**    | Vercel               | Neon (production project)   | pushes to the `main` branch    |

- **dev** — hack + `npm run dev` / `docker compose --profile dev up`. Seeded
  demo data, throwaway secrets, Slack in dry-run.
- **staging** — a production-like Vercel deployment for testing a change on
  real infra before it goes live. Its own Neon db (never point it at prod's)
  and its own env vars, set in the Vercel dashboard.
- **prod** — the live app (`main` → Vercel + the production Neon db).

The `dev` branch has Vercel auto-deploys **disabled** (`vercel.json`); it's a
local integration branch. Only `staging` and `main` deploy.

### Environment variables

`dev` reads `env/dev.env` (gitignored). `staging` and `prod` have **no local
env file** — set their variables in the Vercel dashboard per deployment
(`env/prod.env` mirrors the prod values for local `--profile prod` runs).

| Variable | dev (`env/dev.env`) | staging (Vercel) | prod (Vercel) |
| --- | --- | --- | --- |
| `DATABASE_URL` | `postgresql://…@localhost:5432/worship_dev`¹ | Neon **pooled** URL (staging db) | Neon **pooled** URL (prod db) |
| `NEXTAUTH_URL` | `http://localhost:3000` | `https://<staging>.vercel.app` | your prod URL, e.g. `https://tapworship.com` |
| `NEXTAUTH_SECRET` | any throwaway string | `openssl rand -base64 32` (unique) | `openssl rand -base64 32` (unique, ≠ staging) |
| `ORG_KEYS` | demo keys (`Name:key,…`) | staging keys | **real** join keys — treat like passwords |
| `TZ` | `America/Los_Angeles` | same | same (Vercel defaults to UTC — set it!) |
| `SEED_ADMIN_USERNAME` / `_PASSWORD` | used by `npm run db:seed` | — (don't seed) | — (**never** seed prod) |
| `SLACK_DRY_RUN` | `1` (log, never send) | `1` (optional) | unset (send for real) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | optional² | optional² | optional² |
| `SLACK_CLIENT_ID` / `_SECRET` | optional³ | optional³ | set to enable Slack³ |
| `SPOTIFY_CLIENT_ID` / `_SECRET` | optional⁵ | optional⁵ | set to enable playlists⁵ |
| `SPOTIFY_DRY_RUN` | `1` (fake playlists) | `1` (optional) | unset (create for real) |
| `CRON_SECRET` | optional⁶ | `openssl rand -base64 24` (unique) | `openssl rand -base64 24` (unique, ≠ staging)⁶ |
| `SUPERADMIN_EMAILS` | your email | your email | your email (create orgs, rotate keys)⁴ |
| `POSTGRES_USER` / `_PASSWORD` / `_DB` | local Docker db creds | n/a (managed by Neon) | n/a (managed by Neon) |

¹ Inside `docker compose` the compose file overrides the host `localhost` → the
in-network service name (`db`), so the same file works host-side and in-container.
² Set **both** to enable "Continue with Google". Google/Slack OAuth need a stable
public HTTPS URL, so they only work on staging/prod, not `localhost`.
³ Slack is now a **per-org integration**, not a login method. `CLIENT_ID/SECRET`
identify one distributed Slack app; each org installs the bot to its own
workspace (org settings → "Connect to Slack"), which stores that workspace's bot
token (encrypted) + members' per-org Slack ids on the `Org`/`OrgMembership` rows.
There's no global `SLACK_BOT_TOKEN` for sending anymore. `SLACK_DRY_RUN=1` still
logs instead of sending. Redirect URLs: `…/api/slack/{install,connect}/callback`.
⁴ Comma-separated allowlist of platform super-admins (see the "Platform admin"
menu → `/platform`). Env-only (bootstrap); everything else is managed in-app.
⁵ Spotify is a **per-org integration** too — see [Spotify playlists](#spotify-playlists).
`CLIENT_ID/SECRET` identify one Spotify app; each org connects one shared church
account, whose refresh token is stored encrypted on the `Org` row. Redirect URI:
`…/api/spotify/callback` (override with `SPOTIFY_REDIRECT_URI`). `SPOTIFY_DRY_RUN=1`
stamps placeholder playlists instead of calling the API.

### Deploying (Vercel + Neon, free tier)

First-time setup for a Vercel deployment (do this once per env — staging and
prod are two separate Vercel projects/deployments):

1. **Neon** — create a project and copy the **pooled** connection string (host
   contains `-pooler`) for `DATABASE_URL`. Keep the **direct** (non-pooled) URL
   for migrations.
2. **Vercel** — import the repo (Next.js auto-detected; the `build` script
   already runs `prisma generate`). Add the env vars from the table above.
   Point the deployment at the right branch (`staging` or `main`).
   > `NEXTAUTH_URL` is chicken-and-egg: deploy once to learn the URL, set it,
   > redeploy — or set a custom domain first.
3. **Create the tables (one-time)** — run the committed migrations against the
   new db using its **direct** URL:

   ```bash
   DATABASE_URL="<neon-direct-url>" npm run db:migrate:deploy:prod
   ```

   > ⚠️ Never run `npm run db:seed` against staging/prod — it wipes all data and
   > creates demo users with the password `password123`.
4. **Bootstrap the first admin** — admin is per-org (`org_memberships.isAdmin`),
   and the in-app grant needs an existing admin, so seed the first one by hand:
   sign up in the deployed app, join your org with its `ORG_KEYS` key, then in
   Neon's SQL editor:

   ```sql
   UPDATE org_memberships SET "isAdmin" = true
   WHERE "userId" = (SELECT id FROM users WHERE username = '<your-username>');
   ```

   Log out/in — you can now grant others from the app's Team tab.

**Ongoing deploys:** every push to `staging` / `main` triggers an automatic
Vercel build + deploy. When you change `prisma/schema.prisma`, generate the
migration locally (`npx prisma migrate dev --name <desc>`), commit
`prisma/migrations/`, then re-run the step-3 command against the target db —
**Vercel's build does not touch the schema.**

**Gotchas:** use the **pooled** URL for the app at runtime but the **direct**
URL for `migrate deploy`; always set `TZ` on Vercel (its runtime defaults to
UTC and recurring set times would silently shift); Vercel Hobby is
non-commercial/single-developer (Pro at $20/mo removes the ambiguity).

⁶ Guards the daily cron (`/api/cron/daily`), which has no session to
check — Vercel authenticates itself by sending `Authorization: Bearer
<CRON_SECRET>` on every job it fires from `vercel.json`. **The check is skipped
entirely when the variable is unset**, so a missing value in the Vercel
dashboard leaves the endpoint publicly callable (anyone could trigger Slack
group-chat creation). Locally it's fine to leave unset so you can curl the route
directly. Changing it takes effect on the next deploy.

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

## Spotify playlists

Each set can have a **setlist** (songs saved on the set), which becomes a
**collaborative Spotify playlist** — built automatically when the set's Slack
group chat is created (see step 6). Like Slack it's a per-org integration: one
Spotify app serves every org, and each org connects **one shared church
account** that owns all of its playlists, so making them collaborative lets the
whole team edit from a link. Code: `lib/spotify.ts`, routes under
`app/api/spotify/**` and `app/api/sets/[id]/spotify-playlist`.

**1. Create the Spotify app** — <https://developer.spotify.com/dashboard> →
*Create app*. Tick the **Web API** box. Copy the **Client ID** and **Client
secret**.

**2. Register the redirect URI** (must match byte-for-byte what the app sends):

| Where | Redirect URI |
| --- | --- |
| staging / prod | `https://<your-host>/api/spotify/callback` |
| local `npm run dev` | `http://127.0.0.1:3000/api/spotify/callback` |

Spotify no longer accepts `http://localhost` redirect URIs — only HTTPS or the
explicit loopback IP. So for local work set `SPOTIFY_REDIRECT_URI` to the
`127.0.0.1` form above (otherwise the app derives the URI from `NEXTAUTH_URL`,
which is `localhost`, and Spotify rejects it) and visit the app on
`http://127.0.0.1:3000` too.

**3. Allow the accounts that will connect** — a new app starts in
*Development mode*, which only lets **25 manually allowlisted users** authorize
it. Add each church account's Spotify email under the dashboard's *User
Management*, or request extended quota once you have more orgs than that.

**4. Set the env vars** (`env/*.env` locally, the Vercel dashboard for
staging/prod — see [Environment variables](#environment-variables)):

```
SPOTIFY_CLIENT_ID=…
SPOTIFY_CLIENT_SECRET=…
SPOTIFY_REDIRECT_URI=…   # only if it isn't <NEXTAUTH_URL>/api/spotify/callback
SPOTIFY_DRY_RUN=1        # dev/test only: fake the API, never in prod
```

Leave the id/secret unset to keep Spotify off entirely — nothing throws, the
connect route just reports "not configured" and the playlist actions stay
hidden.

**5. Connect an org** — as an admin of that org, go to **Org settings**
(`/orgs`) → *Connect to Spotify*, sign in as the shared church account, approve
the `playlist-modify-private` / `playlist-modify-public` scopes. The callback
stores that account's **refresh token, encrypted** on the `Org` row (plus its
display name, shown on the page) and short-lived access tokens are minted from
it per request. *Disconnect* clears all three.

**6. Use it** — open a set, add songs to its setlist, then hit **Slack Team**.
There's no separate playlist button: building the playlist rides along with
creating the set's Slack group chat (`lib/slack.ts`), which then posts the link
into that chat. Once it exists, the set modal shows *Open Spotify playlist ↗*.
`POST /api/sets/:id/spotify-playlist` re-syncs it on demand (any member of the
set's org) if you want to wire up your own trigger.

Each song is matched to the first Spotify search result for its title, and the
playlist is created **private + collaborative** (Spotify requires private for
collaborative) under the org's account. Re-syncing overwrites that same
playlist in place rather than making a new one, and its url is saved on the set.

Because the playlist follows the group chat, an org needs **both** Slack and
Spotify connected for the automatic path — Spotify alone still works through
the API route, and a Spotify failure never breaks the group chat.

Gotchas: the refresh token is encrypted with a key derived from
`NEXTAUTH_SECRET` (`lib/crypto.ts`), so **rotating that secret means every org
must reconnect**. First-search-result matching is approximate for worship songs
with many versions — the playlist is collaborative precisely so the worship
leader can fix it by hand.

## Timezones

Recurring times ("Monday 7pm") are interpreted in the server's `TZ`
(set in the env files, default `America/Los_Angeles`). Keep app and db
containers on the same TZ.
