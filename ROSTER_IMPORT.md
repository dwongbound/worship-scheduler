# Importing an availability form into an org

Turns a Google Form availability export into real rows: an account per person,
their org membership, and their listed conflicts as blocked days.

Most people on the form have never logged in, so the import creates
**placeholder accounts** for them. A placeholder holds someone's membership and
availability until they first sign in; the first time they sign in with Google
— or sign up — using **the same email**, that row becomes their account, id and
all. Nothing has to be re-entered and no duplicate account appears.

## How the link works

`User.isPlaceholder` marks an imported row. Email is the identity.

| Path | What happens |
| --- | --- |
| Google sign-in | `signIn` finds the row by email (case-insensitive), clears `isPlaceholder`. No second account. |
| Sign-up form | `/api/signup` claims the row, sets their password, returns `{ ok, claimed: true }`. |
| Password login *before* claiming | Refused — a placeholder has no usable password. |
| Password login *after* claiming | Works, and now matches email/username case-insensitively. |

The person keeps the same user id throughout, so their imported availability,
org membership and form response are already theirs the moment they log in.

## Running it

The export goes in `prisma/data/` (**gitignored** — real people's email
addresses, same rule as `env/`). CSV download or a Sheets copy/paste both work.

Dry run first — it prints every person, every date it parsed, and every phrase
it could not read, and writes nothing:

```bash
dotenv -e env/staging.env -- npx tsx prisma/importFormResponses.ts \
  prisma/data/tapcollege-fall-2026.tsv
```

Then apply:

```bash
APPLY=1 dotenv -e env/staging.env -- npx tsx prisma/importFormResponses.ts \
  prisma/data/tapcollege-fall-2026.tsv
```

Re-running is safe: accounts are keyed on email, membership on (user, org), and
blocks on (user, request, day), so a second run against the same sheet is a
no-op.

### Options

| Env | Default | Meaning |
| --- | --- | --- |
| `APPLY=1` | *(off)* | Actually write. Without it you get a dry run. |
| `ORG_NAME` | `Tap College` | Org to import into. Matched **by name** — check the spelling against the target db. |
| `REQUEST_NAME` | `Fall 2026` | Availability request to file the blocks under; reused if it already exists. |
| `REQUEST_START` / `REQUEST_END` | `2026-09-01` / `2026-12-31` | The window. Bare dates like `9/25` are resolved to the year that lands inside it. |

## Deploying it

The import needs the `isPlaceholder` column, so the migration goes first.
Per-branch migrations run through the `migrate.yml` GitHub Action; its
`DATABASE_URL` must be the **direct, non-`-pooler`** Neon URL.

1. Merge `dev` → `staging`. CI applies `20260822150000_placeholder_users`.
2. Dry-run the import against staging, read the output, then `APPLY=1`.
3. Check a person in the app: they should appear in the org with their days
   blocked, and the Create tab should show their response as submitted.
4. Sanity-check the claim: sign in with Google as someone on the list and
   confirm you land on *their* row rather than a fresh empty account.
5. Merge `staging` → `main`, then repeat steps 2–3 against production.

## What it deliberately does not do

- **No team placement.** People get org membership only, no `TeamMember` row,
  so nothing can auto-schedule them by accident. An admin assigns teams and
  roles in `/users` afterwards.
- **No free-text notes.** Answers like "no more than 1-2 times a month" have
  nowhere to live in the schema, so the script prints them under *Notes for an
  admin to read* instead of dropping them silently. Same for any date phrase it
  could not parse — those are always reported, never guessed at.
