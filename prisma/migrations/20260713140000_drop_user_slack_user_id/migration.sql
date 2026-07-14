-- The global User.slackUserId is superseded by the per-org
-- OrgMembership.slackUserId (member ids are workspace-scoped). Nothing reads or
-- writes the old column anymore.

-- DropIndex
DROP INDEX "users_slackUserId_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "slackUserId";
