-- Per-org digest look-ahead window (Org.digestUpcomingDays), replacing the
-- hardcoded DIGEST_UPCOMING_DAYS constant, plus a cached DM channel id per
-- membership so each digest DM costs one Slack API call instead of two.
-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "digestUpcomingDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "org_memberships" ADD COLUMN     "slackDmChannelId" TEXT;
