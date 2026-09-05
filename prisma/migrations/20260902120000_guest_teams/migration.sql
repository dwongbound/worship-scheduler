-- Guest teams: another team lending people to a set it doesn't own.
--
-- This also retires the hardcoded choir special case. `sets.choirEnabled` was
-- the per-set opt-in for an unbounded, CHOIR-keyed singer list; that behaviour
-- is now a generic "allAvailable" seat on a guest team's role config, so the
-- column has no readers left. Existing CHOIR assignments are ordinary
-- assignment rows and are left exactly as they are — they keep rendering,
-- because the roster draws filled seats from the assignments themselves and
-- only derives EMPTY slots from the capacity map.

-- One team lending its people to one set.
CREATE TABLE "set_guest_teams" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    -- [{ role, count } | { role, allAvailable: true }] — see lib/guestTeams.ts
    "roles" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "set_guest_teams_pkey" PRIMARY KEY ("id")
);

-- One row per team per set; re-adding a guest edits its roles instead.
CREATE UNIQUE INDEX "set_guest_teams_setId_teamId_key" ON "set_guest_teams"("setId", "teamId");

ALTER TABLE "set_guest_teams" ADD CONSTRAINT "set_guest_teams_setId_fkey"
    FOREIGN KEY ("setId") REFERENCES "sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "set_guest_teams" ADD CONSTRAINT "set_guest_teams_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which guest row seated this person. NULL = an ordinary seat on the set's own
-- team, which is every row that already exists — so no backfill is needed.
ALTER TABLE "assignments" ADD COLUMN "guestTeamId" TEXT;

ALTER TABLE "assignments" ADD CONSTRAINT "assignments_guestTeamId_fkey"
    FOREIGN KEY ("guestTeamId") REFERENCES "set_guest_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The choir opt-in is gone; choir is a plain counted role like any other.
ALTER TABLE "sets" DROP COLUMN "choirEnabled";
