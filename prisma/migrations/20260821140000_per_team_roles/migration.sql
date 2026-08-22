-- Per-team role catalogs. Roles stop being a fixed `Instrument` enum and become
-- rows a team owns: an admin can rename them, change how many of each a set
-- wants, mark one admin-only, add their own, or drop one entirely.
--
-- Nothing loses its meaning in the process. The enum's names ARE the new keys,
-- so every assignment, team-member role list, and history row keeps pointing at
-- the same role; the columns just widen from enum to text. Each existing team
-- is then seeded with the built-in catalog it has been using implicitly all
-- along (see lib/teamRoles.ts DEFAULT_TEAM_ROLES — these two lists must agree).

-- ── 1. Role columns: enum → text (values preserved verbatim) ───────────────
ALTER TABLE "assignments"         ALTER COLUMN "role"        TYPE TEXT USING "role"::text;
ALTER TABLE "set_history_events"  ALTER COLUMN "role"        TYPE TEXT USING "role"::text;
ALTER TABLE "team_members"        ALTER COLUMN "roles"       TYPE TEXT[] USING "roles"::text[];
ALTER TABLE "users"               ALTER COLUMN "instruments" TYPE TEXT[] USING "instruments"::text[];

-- Nothing references the enum any more.
DROP TYPE "Instrument";

-- ── 2. The catalog ────────────────────────────────────────────────────────
CREATE TABLE "team_roles" (
    "id"           TEXT NOT NULL,
    "teamId"       TEXT NOT NULL,
    "key"          TEXT NOT NULL,
    "label"        TEXT NOT NULL,
    "defaultCount" INTEGER NOT NULL DEFAULT 1,
    "adminOnly"    BOOLEAN NOT NULL DEFAULT false,
    "order"        INTEGER NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_roles_teamId_key_key" ON "team_roles"("teamId", "key");

ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. Seed every existing team with the built-in catalog ─────────────────
-- Order/counts mirror ROLE_ORDER + SLOT_CAPACITIES at the time of this
-- migration. CHOIR keeps its unbounded behaviour in code and so carries a
-- count of 0 here — it has never had a slot count.
INSERT INTO "team_roles" ("id", "teamId", "key", "label", "defaultCount", "adminOnly", "order")
SELECT
    gen_random_uuid()::text,
    t."id",
    v."key",
    v."label",
    v."count",
    false,
    v."ord"
FROM "teams" t
CROSS JOIN (VALUES
    ('WORSHIP_LEADER',  'Worship Leader',  1, 0),
    ('DRUMS',           'Drums',           1, 1),
    ('BASS',            'Bass',            1, 2),
    ('KEYS',            'Keys',            1, 3),
    ('ACOUSTIC_GUITAR', 'Acoustic Guitar', 1, 4),
    ('ELECTRIC_GUITAR', 'Electric Guitar', 2, 5),
    ('STRINGS',         'Strings',         0, 6),
    ('VOCALS',          'Vox',             2, 7),
    ('AV',              'A/V',             1, 8),
    ('CHOIR',           'Choir',           0, 9)
) AS v("key", "label", "count", "ord");
