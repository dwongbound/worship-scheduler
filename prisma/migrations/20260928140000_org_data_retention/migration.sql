-- Per-workspace data retention.
--
-- `retentionMonths` is how far back an org keeps its own history; the weekly
-- sweep in lib/retentionStore deletes sets that started before the cutoff and
-- availability requests that ended before it, and the cascades already on those
-- tables take the rosters, songs, guest teams, activity log, swap proposals and
-- responses with them.
--
-- Every existing org lands on 12 (one year) — the default the settings page
-- shows — so the first sweep after this deploys WILL delete history older than
-- a year in every workspace. That is the intended behaviour, not a side effect.
--
-- `lastPrunedAt` NULL means "never swept", which makes an org due on the next
-- cron run. It is stamped even when a sweep deletes nothing, so a quiet org
-- isn't re-counted every night.
ALTER TABLE "orgs" ADD COLUMN "retentionMonths" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "orgs" ADD COLUMN "lastPrunedAt" TIMESTAMP(3);
