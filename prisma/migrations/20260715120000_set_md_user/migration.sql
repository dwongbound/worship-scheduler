-- AddColumn: the designated musical director for a set (nullable).
ALTER TABLE "sets" ADD COLUMN "mdUserId" TEXT;

-- AddForeignKey: deleting the user clears the designation, not the set.
ALTER TABLE "sets" ADD CONSTRAINT "sets_mdUserId_fkey" FOREIGN KEY ("mdUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing MD-requiring sets so they keep a visible MD: pick one
-- eligible assignee — an MD (users.isMD) playing an MD-capable role
-- (keys/electric/bass) who is not the set's worship leader.
UPDATE "sets" s
SET "mdUserId" = (
    SELECT a."userId"
    FROM "assignments" a
    JOIN "users" u ON u."id" = a."userId"
    WHERE a."setId" = s."id"
      AND u."isMD" = true
      AND a."role" IN ('KEYS', 'ELECTRIC_GUITAR', 'BASS')
      AND NOT EXISTS (
          SELECT 1 FROM "assignments" wl
          WHERE wl."setId" = s."id"
            AND wl."userId" = a."userId"
            AND wl."role" = 'WORSHIP_LEADER'
      )
    ORDER BY a."userId"
    LIMIT 1
)
WHERE s."requiresMD" = true;
