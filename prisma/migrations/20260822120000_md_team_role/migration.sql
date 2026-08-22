-- MD joins the team role catalog. It was the last piece of "what someone can do
-- on a set" that wasn't a role: a global User.isMD flag plus Set.requiresMD,
-- with no way for a team that has no musical director to opt out.
--
-- As a catalog row it becomes deletable per team, and a team without it has the
-- whole feature switched off (see lib/teamRoles.ts teamSupportsMD). It carries
-- no slot count of its own — the MD is someone already playing keys/electric/
-- bass — so it sorts after the band roles, capped at one per set.
--
-- Choir shifts one place later to keep it last, matching DEFAULT_TEAM_ROLES.

-- Choir moves out of the way first (it currently sits where MD is going).
UPDATE "team_roles" SET "order" = "order" + 1 WHERE "key" = 'CHOIR';

-- Every team that doesn't already have an MD row gets one. Its order is placed
-- just after that team's last band role, so a team that reordered its own
-- catalog still lands MD in a sensible spot.
INSERT INTO "team_roles" ("id", "teamId", "key", "label", "defaultCount", "adminOnly", "order")
SELECT
    gen_random_uuid()::text,
    t."id",
    'MD',
    'MD',
    1,
    true,
    COALESCE(
        (SELECT max(tr."order") + 1
           FROM "team_roles" tr
          WHERE tr."teamId" = t."id" AND tr."key" <> 'CHOIR'),
        0
    )
FROM "teams" t
WHERE NOT EXISTS (
    SELECT 1 FROM "team_roles" tr WHERE tr."teamId" = t."id" AND tr."key" = 'MD'
);
