-- Scheduling rules can be scoped to one team (null = every team), and two new
-- kinds take over behaviour that used to be built in (lib/schedulingRules.ts):
-- MD_ORDER (which roles a musical director leads from, best first) and
-- SHARE_ROLES (one person playing two roles on a set — the acoustic guitarist
-- doubling as the worship leader or a vocalist).
ALTER TABLE "scheduling_rules" ADD COLUMN "teamId" TEXT;

-- A deleted team takes its own rules with it.
ALTER TABLE "scheduling_rules" ADD CONSTRAINT "scheduling_rules_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Write today's built-in behaviour onto every existing org as rules, after
-- whatever it already has, so nothing changes until an admin edits them. Kept
-- in step with DEFAULT_RULES in lib/schedulingRules.ts.
INSERT INTO "scheduling_rules" ("id", "tier", "enabled", "position", "params", "orgId", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'REQUIRED',
    true,
    COALESCE((SELECT MAX(r."position") FROM "scheduling_rules" r WHERE r."orgId" = o."id"), -1) + v."ord",
    v."params"::jsonb,
    o."id",
    CURRENT_TIMESTAMP
FROM "orgs" o
CROSS JOIN (VALUES
    (1, '{"kind":"MD_ORDER","roles":["ELECTRIC_GUITAR","KEYS","BASS"]}'),
    (2, '{"kind":"SHARE_ROLES","role":"ACOUSTIC_GUITAR","withRoles":["WORSHIP_LEADER","VOCALS"]}')
) AS v("ord", "params");
