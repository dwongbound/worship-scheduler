# Deploying to Vercel + Neon (free tier)

This app needs a Node host and a PostgreSQL database. We use **Vercel** (Hobby,
free) for the app and **Neon** (free) for Postgres. Total cost at low traffic: **$0**.

## 1. Create the database (Neon)

1. Sign up at https://neon.tech and create a project (pick the region closest
   to your users).
2. Copy the **pooled** connection string (the host contains `-pooler`). You'll
   paste it as `DATABASE_URL` in Vercel.

## 2. Push the code to GitHub

The repo already points at `origin`. Once committed:

```bash
git push -u origin main
```

## 3. Create the Vercel project

1. Sign up at https://vercel.com with your GitHub account.
2. **Add New → Project** → import `worship-scheduler`.
3. Framework preset auto-detects **Next.js**. Leave build/output defaults —
   the `build` script already runs `prisma generate` for you.
4. Before the first deploy, add these **Environment Variables** (see
   `.env.example` for details):

   | Name | Value |
   |------|-------|
   | `DATABASE_URL` | Neon **pooled** connection string |
   | `NEXTAUTH_SECRET` | output of `openssl rand -base64 32` |
   | `NEXTAUTH_URL` | your Vercel URL, e.g. `https://<project>.vercel.app` |
   | `TZ` | `America/Los_Angeles` (or your local zone) |

   > `NEXTAUTH_URL` is a chicken-and-egg: deploy once to learn the URL, then set
   > it and redeploy. Or set a custom domain first and use that.

5. Deploy.

## 4. Create the database tables (one-time)

The app uses `prisma db push` (no migration files). Point it at Neon **once**:

```bash
# Uses your real env, NOT env/dev.env:
DATABASE_URL="<neon-pooled-url>" npm run db:push:prod
```

> ⚠️ Do **not** run `npm run db:seed` against production — the seed wipes all
> data and creates demo users with the password `password123`.

## 5. Create your first admin

The in-app "grant admin" page requires you to already be an admin, so bootstrap
the first one directly:

1. Open the deployed app and **sign up** a normal account for yourself.
2. In the Neon **SQL Editor**, run:

   ```sql
   UPDATE users SET "isAdmin" = true WHERE username = '<your-username>';
   ```

3. Log out/in. You now have admin access and can grant others from the app.

## Ongoing deploys

Every `git push` to `main` triggers an automatic Vercel build + deploy. When you
change `prisma/schema.prisma`, re-run the `db:push:prod` command from step 4
against Neon (Vercel does not touch the schema).

## Notes / gotchas

- **Timezone:** recurring set times use the server `TZ`. If it's wrong, times
  shift. Keep `TZ` set on Vercel.
- **Pooled vs direct URL:** use the `-pooler` URL for the app. If you ever add
  real Prisma migrations, use the **direct** (non-pooled) URL for
  `prisma migrate` / `db push`.
- **Vercel Hobby is non-commercial / single-developer.** Fine for a church
  team; upgrade to Pro ($20/mo) if you need collaborators on the dashboard.
