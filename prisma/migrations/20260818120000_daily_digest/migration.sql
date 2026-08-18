-- Daily 8 AM Slack digest (lib/digest.ts): a per-person opt-out plus a
-- per-membership "already sent today" guard for the cron.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dailyDigest" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "org_memberships" ADD COLUMN     "digestSentAt" TIMESTAMP(3);
