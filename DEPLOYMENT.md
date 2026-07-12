# Deployment options evaluation

This is an evaluation of hosting options for Worship Scheduler. It complements
`DEPLOY.md`, which is a step-by-step guide for the Vercel + Neon path already
chosen for this repo. This document exists to show the alternatives and the
reasoning, in case that choice needs to be revisited later (e.g. cost growth,
ToS concerns, or wanting more control).

## 1. What the app actually needs

Read from `docker-compose.yml`, `Dockerfile`, `package.json`,
`prisma/schema.prisma`, `.env.example`, `next.config.js`, `proxy.ts`, and
`lib/slack.ts`.

- **Compute:** a Node.js host (Dockerfile uses `node:24-alpine`) that can run
  `next build` / `next start`. All API routes are plain App Router route
  handlers with no `export const runtime = "edge"` anywhere, so they run on
  the Node.js runtime by default — no special edge-compatibility work needed,
  but also nothing that *requires* edge. `proxy.ts` (this app's stand-in for
  `middleware.ts`, per `next-auth/middleware`) is edge-compatible and runs
  fine on Vercel Edge Middleware or as regular Node middleware elsewhere.
- **Database:** PostgreSQL (18-alpine in dev/test/prod compose services).
  Prisma 7 uses the newer **`prisma-client` generator** with the
  `@prisma/adapter-pg` driver adapter — this is the Rust-engine-free path, so
  there's no native binary to worry about matching to a deploy target; it's
  just a `pg` connection pool under the hood. That makes this app more
  portable across serverless and traditional hosts than older Prisma setups.
  Schema sync uses committed migration files in `prisma/migrations/`, applied
  via `prisma migrate deploy` — run at container boot (`Dockerfile` CMD) or
  manually against prod (`db:migrate:deploy:prod`). Any host needs a way to
  run that command against the target database at least once per schema
  change (after generating the migration locally with `prisma migrate dev`).
- **File/blob storage:** none. Grepped for `fs.`, `writeFile`, `multer`,
  `s3`/`S3`, `blob`, `upload` — no hits outside generated Prisma internals.
  ICS export (`lib/ics.ts`) is generated and streamed in-response, not
  written to disk. This simplifies hosting a lot: no persistent volume or
  object storage needed beyond the database itself.
- **Env vars** (`.env.example`): `DATABASE_URL` (Neon docs specifically call
  out using the **pooled** connection string for serverless), `NEXTAUTH_SECRET`,
  `NEXTAUTH_URL` (must match the deployed URL — used for OAuth callbacks),
  `TZ` (defaults to UTC on most serverless platforms; this app interprets all
  recurring set times in server TZ, so getting this wrong silently shifts
  everyone's schedule). Optional: `GOOGLE_CLIENT_ID/SECRET`,
  `SLACK_CLIENT_ID/SECRET` (Slack OIDC "sign in with Slack"), `SLACK_BOT_TOKEN`
  (outbound-only Slack Web API calls for notifications — no inbound webhook
  or public Events API endpoint required, which simplifies hosting
  considerably; `lib/slack.ts` no-ops entirely when unset).
- **Auth:** NextAuth 4 with a credentials provider (bcryptjs — pure JS, no
  native bindings, so no host-specific build issues) plus optional Google/Slack
  OAuth. OAuth needs a stable public HTTPS URL for callback redirects, which
  rules out preview-only/ephemeral deploy URLs for anything but the primary
  domain.
- **Scale profile:** this is a low-traffic, low-write app by design — one
  weekly schedule per team, occasional swap requests, availability forms.
  Even the "medium" 500-user/multi-org case is closer to "several small
  churches" than a real-time or high-concurrency workload. This matters a lot
  for which platform tier is actually needed.

## 2. Options

### A. Vercel (Hobby/Pro) + Neon Postgres — *what `DEPLOY.md` already documents*

**Fit:** Very good. `build` already runs `prisma generate`; Next.js is
auto-detected; no code changes needed. Prisma 7's driver-adapter client works
well with Vercel's serverless functions since there's no Rust binary to bundle.

- **Small scale (20–50 users, single org):** **$0/mo.** Vercel Hobby (free) +
  Neon free tier (0.5GB storage, ~191 compute hrs/mo, autosuspend when idle).
- **Medium scale (~500 users, multi-org):** **~$40–70/mo.** Vercel Pro is
  $20/mo/seat; Neon's Launch tier (no/rare autosuspend, 10GB+) runs roughly
  $19–29/mo depending on usage. Multi-org likely also means multiple admins
  needing dashboard access, which pushes towards Pro seats.
- **Pros:** Zero server management, automatic deploys on `git push`, generous
  free tier for this app's actual traffic level, matches the repo's existing
  docs exactly (no new setup burden).
- **Cons:** Neon free tier **autosuspends** — first request after idle has a
  noticeable cold-start (compute + connection). Vercel Hobby's ToS restricts
  it to **personal, non-commercial** use; a church accepting donations or
  running this as an official org tool is a gray area worth reading Vercel's
  terms for, and Pro ($20/mo) removes the ambiguity.
- **Gotchas specific to this app:**
  - Must use Neon's **pooled** connection string (`-pooler` host) — serverless
    functions open many short-lived connections, and Prisma's `pg` adapter
    will exhaust a direct connection quickly otherwise.
  - `TZ` must be set explicitly in Vercel env vars — Vercel's Node runtime
    defaults to UTC, and this app has no other way to know the congregation's
    local time.
  - Schema changes need a manual `db:migrate:deploy:prod` run — Vercel's
    build step does not touch the database.
  - `NEXTAUTH_URL` chicken-and-egg on first deploy (documented in `DEPLOY.md`).

### B. Railway

**Fit:** Good. Railway builds directly from the existing `Dockerfile`
(no nixpacks guesswork needed), and Postgres is a first-class add-on in the
same project — closest experience to `docker compose --profile prod` but
managed.

- **Small scale:** **~$5–10/mo.** Railway's Hobby plan is a $5/mo base that
  includes usage credit; a single small always-on Next.js container plus a
  small Postgres instance for this traffic level should land at or just above
  that base.
- **Medium scale:** **~$20–40/mo**, scaling roughly with container uptime,
  RAM, and Postgres storage/compute — still usage-billed rather than flat
  tiers.
- **Pros:** Runs the repo's own `Dockerfile` unmodified. Persistent container
  (no cold starts, no serverless connection-pool tuning). One dashboard for
  app + db + env vars. Straightforward GitHub-push deploys.
- **Cons:** Usage-based pricing is less predictable month-to-month than a flat
  plan. No perpetual free tier (trial credit only). Backup/retention features
  are more limited on lower tiers than Render's managed Postgres.
- **Gotchas specific to this app:** the `Dockerfile` CMD runs
  `prisma migrate deploy && npm start` **on every container boot**. Unlike
  `db push`, `migrate deploy` applies committed migrations and takes an
  advisory lock while doing so, so concurrent boots (e.g. a second replica
  starting mid-deploy) are safe — it's still simplest to keep this app at a
  single always-on instance, which is all it needs anyway.

### C. Render

**Fit:** Good, similar shape to Railway — deploys the `Dockerfile` as a Web
Service, managed Postgres as a separate resource.

- **Small scale:** **~$14/mo.** Render's free web service tier spins down
  after inactivity (bad for a login-gated app people check sporadically —
  every cold hit becomes a 30–60s wait), and Render no longer offers a
  permanent free Postgres (time-limited trial only). A realistic "actually
  reliable" setup is Starter web service ($7/mo) + Starter Postgres ($7/mo).
- **Medium scale:** **~$45/mo+** (Standard web service ~$25/mo + Standard
  Postgres ~$20/mo), moving up with concurrent connections and storage.
- **Pros:** Predictable flat-rate pricing, managed Postgres with automatic
  backups included even at Starter, clean GitHub-integrated deploys, good
  docs — arguably the easiest platform for a non-infra person to reason about
  billing-wise.
- **Cons:** No meaningfully free reliable tier for this app (the free options
  both have real downsides for a small always-available team tool). Slightly
  pricier at small scale than Railway or a VPS.
- **Gotchas specific to this app:** same `prisma migrate deploy`-on-boot
  consideration as Railway (keep it to one instance). Remember to set `TZ`
  explicitly — Render's default is also UTC.

### D. Fly.io

**Fit:** Good if you want to keep using the Dockerfile as the actual deploy
artifact and want machines to live closer to your users. `fly launch` reads
the existing `Dockerfile` directly.

- **Small scale:** **~$5–10/mo.** No perpetual free tier anymore. A
  shared-cpu-1x/256MB machine is a couple dollars a month, plus a small
  single-node Fly Postgres instance (~$2–5/mo). Machines can also be
  configured to scale-to-zero, but see the gotcha below before doing that here.
- **Medium scale:** **~$30–60/mo** once you add a second machine for
  availability and/or move Fly Postgres to a multi-node HA configuration.
- **Pros:** Deploys the existing Dockerfile with no rewrite. Persistent
  processes (no serverless quirks). Can co-locate app + db in the same
  region for low latency. Cheapest "real always-on container" option before
  a bare VPS.
- **Cons:** More hands-on than Railway/Render — you're writing and
  maintaining a `fly.toml`, choosing regions, and Fly Postgres is
  self-managed-ish (you configure its HA/backup behavior yourself rather than
  getting it for free like Render's managed Postgres). Dashboard/DX is more
  CLI-first than the other PaaS options.
- **Gotchas specific to this app:** because the Dockerfile runs
  `prisma migrate deploy` on every boot, **don't** enable aggressive
  scale-to-zero / auto-stop on the app machine unless you're fine with that
  command firing on every wake — harmless here (it no-ops once migrations are
  already applied) but adds cold-start latency on top of Fly's own wake time.
  Keep `min_machines_running = 1` for a team-facing tool people expect to
  load instantly.

### E. Self-hosted VPS (e.g. Hetzner, DigitalOcean droplet)

**Fit:** Very good technically — this is the *least* new configuration,
since `docker compose --profile prod up -d --build` is already written,
tested, and is exactly what you'd run on a VPS. No platform-specific
adaptation at all.

- **Small scale:** **~$6–12/mo.** A single Hetzner CX22 or DigitalOcean
  Basic droplet easily runs both the app and db-prod containers for 20–50
  users given how light this app's actual query/write load is.
- **Medium scale:** **~$20–40/mo** on a beefier single box — this app's
  write pattern (weekly schedules, occasional swaps) scales vertically much
  further than it sounds before you'd need to split app and db onto separate
  machines or move to a managed Postgres.
- **Pros:** Cheapest option by far at both scales. Zero vendor lock-in. Exact
  parity with the local/tested docker-compose setup — what you run in prod is
  what you've already been running in dev/test. Full control over everything.
- **Cons:** You own **all** of the ops: OS patching, Docker upgrades, restart-
  on-crash (compose alone doesn't survive a host reboot without `restart:
  unless-stopped`, which is already set — good — but you still need to enable
  Docker-on-boot), and there's no CI/CD included — a deploy is `git pull &&
  docker compose --profile prod up -d --build` run by hand or scripted
  yourself (e.g. a small GitHub Actions SSH step).
- **Gotchas specific to this app:**
  - The repo's `docker-compose.yml` has **no reverse proxy or TLS**
    termination — you'd need to add Caddy or nginx in front for HTTPS
    (required for NextAuth cookies and OAuth callbacks to behave correctly).
  - `prod-db-data` is a local Docker volume with **no offsite backup** —
    losing the VPS loses the database unless you add a `pg_dump` cron (or
    switch `db-prod` out for an external managed Postgres like Neon/Supabase
    while keeping the app container on the VPS).
  - Single point of failure for both app and db on one machine.

### (Briefly) AWS/GCP/Azure

Worth naming as the ceiling, not a recommendation at this scale. ECS
Fargate/Cloud Run + RDS/Cloud SQL would handle this app fine, but the
minimum realistic cost (a small RDS instance alone is commonly $15–30/mo
before compute) and the operational overhead (VPC setup, IAM, task
definitions) are hard to justify for a single-church or even a
several-church scheduling tool. This becomes worth revisiting only if the
app grows into dozens of orgs with real uptime/SLA requirements.

## 3. Recommendation

**Stick with Vercel + Neon for now** (option A) — it's already documented in
`DEPLOY.md`, costs $0/mo at this app's actual traffic level, and requires no
new configuration. Two caveats worth acting on:

1. **Read Vercel's Hobby ToS carefully** if this is an official church tool
   (vs. a personal side project) — if there's any doubt, the $20/mo Pro plan
   removes the ambiguity and isn't a big cost at this scale.
2. If the Neon free-tier autosuspend cold start becomes annoying for
   users checking the app sporadically, upgrading just the database
   (Neon Launch, ~$19/mo) while staying on Vercel Hobby is a cheap partial fix
   before jumping to Pro on both.

**If you outgrow that or want to escape serverless quirks** (connection
pooling tuning, cold starts, Hobby ToS ambiguity) **without taking on VPS
ops burden, Railway is the best next step.** It deploys the existing
`Dockerfile` with essentially no changes, runs as a normal persistent
process (sidestepping the pooled-connection-string requirement entirely),
and its single dashboard for app + db keeps the operational surface small —
appropriate for a project maintained by one person. Render is a close,
slightly pricier alternative if predictable flat billing matters more than
minimizing cost.

**Fly.io and a self-hosted VPS are both reasonable if you want to pay less
and are comfortable owning more ops** — Fly.io if you want managed-ish
infra with your existing Dockerfile, or a VPS if you want the cheapest
possible option and are fine adding a reverse proxy and your own backup
cron. Given this app's low scale requirements, cost differences between all
five options stay under ~$70/mo even at the "500 users, multi-org" mark, so
the deciding factor should be **how much ops work you want to own**, not
raw price.
