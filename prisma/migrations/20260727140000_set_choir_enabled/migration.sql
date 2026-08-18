-- AddColumn: choir is opt-in per set. An admin enables it on a set before
-- anyone can be added to the set's choir or auto-scheduled into it. Defaults
-- false (no choir on the set).
ALTER TABLE "sets" ADD COLUMN "choirEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any set that already has choir members stays enabled so its
-- existing roster isn't hidden by the new gate.
UPDATE "sets" SET "choirEnabled" = true
WHERE "id" IN (SELECT "setId" FROM "assignments" WHERE "role" = 'CHOIR');
