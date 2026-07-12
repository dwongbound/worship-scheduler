-- Multi-org migration (hand-edited from `prisma migrate diff` output).
-- Adds Org + OrgMembership and a required orgId to teams/sets/set_templates/
-- availability_requests, preserving existing data: everything is backfilled
-- into a placeholder org ('__default__'), which lib/org.ts ensureOrgsSynced()
-- renames to the first ORG_KEYS env entry at first boot. Existing per-user
-- isAdmin flags become per-org membership flags before the column is dropped.

-- CreateTable
CREATE TABLE "orgs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orgs_name_key" ON "orgs"("name");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_userId_orgId_key" ON "org_memberships"("userId", "orgId");

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a placeholder org that adopts all pre-org data. Renamed to the
-- first ORG_KEYS entry by ensureOrgsSynced() on first boot after deploy.
INSERT INTO "orgs" ("id", "name") VALUES ('org_migration_default', '__default__');

-- Every existing user becomes a member; their global isAdmin carries over.
INSERT INTO "org_memberships" ("id", "userId", "orgId", "isAdmin")
SELECT 'om_' || "id", "id", 'org_migration_default', "isAdmin" FROM "users";

-- AlterTable (add nullable, backfill, then enforce NOT NULL)
ALTER TABLE "teams" ADD COLUMN "orgId" TEXT;
ALTER TABLE "sets" ADD COLUMN "orgId" TEXT;
ALTER TABLE "set_templates" ADD COLUMN "orgId" TEXT;
ALTER TABLE "availability_requests" ADD COLUMN "orgId" TEXT;

UPDATE "teams" SET "orgId" = 'org_migration_default';
UPDATE "sets" SET "orgId" = 'org_migration_default';
UPDATE "set_templates" SET "orgId" = 'org_migration_default';
UPDATE "availability_requests" SET "orgId" = 'org_migration_default';

ALTER TABLE "teams" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "sets" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "set_templates" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "availability_requests" ALTER COLUMN "orgId" SET NOT NULL;

-- AlterTable: admin is per-org now (copied into org_memberships above).
ALTER TABLE "users" DROP COLUMN "isAdmin";

-- DropIndex: team names are unique per org, not globally.
DROP INDEX "teams_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "teams_orgId_name_key" ON "teams"("orgId", "name");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sets" ADD CONSTRAINT "sets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_templates" ADD CONSTRAINT "set_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_requests" ADD CONSTRAINT "availability_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
