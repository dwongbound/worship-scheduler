-- AlterTable
ALTER TABLE "org_memberships" ADD COLUMN     "slackUserId" TEXT;

-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "joinKey" TEXT,
ADD COLUMN     "slackBotToken" TEXT,
ADD COLUMN     "slackBotUserId" TEXT,
ADD COLUMN     "slackTeamId" TEXT,
ADD COLUMN     "slackTeamName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_orgId_slackUserId_key" ON "org_memberships"("orgId", "slackUserId");

-- CreateIndex
CREATE UNIQUE INDEX "orgs_joinKey_key" ON "orgs"("joinKey");
