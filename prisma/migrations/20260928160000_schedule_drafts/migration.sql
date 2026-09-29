-- Saved generate previews ("drafts").
--
-- The whole staged plan is parked as JSON rather than normalised into sets and
-- assignments: a draft is a proposal that may never be applied, and real rows
-- would put unapplied schedules into every query that reads the calendar.
--
-- Two kinds of row, told apart by "isRecovery":
--   * a DELIBERATE draft — the admin pressed Save Draft. Capped at 5 per org
--     (enforced in the API, not here); may carry a name.
--   * a RECOVERY draft — the once-a-minute autosave behind a preview, one per
--     person per org, overwritten in place and never counted against the cap so
--     the safety net still works when the 5 deliberate slots are full.
--
-- "name" being NULL does NOT mean recovery: naming a deliberate draft is
-- optional, which is why the two are separate columns.
--
-- Both foreign keys cascade: a deleted org takes its drafts with it, and so
-- does a deleted user (a draft is only ever a private work-in-progress, never
-- shared state another admin depends on).
CREATE TABLE "schedule_drafts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT,
    "isRecovery" BOOLEAN NOT NULL DEFAULT false,
    "plan" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_drafts_pkey" PRIMARY KEY ("id")
);

-- The list is always "this org's drafts, newest activity first".
CREATE INDEX "schedule_drafts_orgId_updatedAt_idx" ON "schedule_drafts"("orgId", "updatedAt");

-- Finding (or replacing) one person's recovery slot in an org.
CREATE INDEX "schedule_drafts_orgId_createdById_isRecovery_idx" ON "schedule_drafts"("orgId", "createdById", "isRecovery");

ALTER TABLE "schedule_drafts" ADD CONSTRAINT "schedule_drafts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_drafts" ADD CONSTRAINT "schedule_drafts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
