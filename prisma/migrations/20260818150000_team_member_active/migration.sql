-- Per-team "active" flag: inactive members keep their roles + history but are
-- skipped by the auto-scheduler and flagged "(inactive)" in the pick lists.
ALTER TABLE "team_members" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
