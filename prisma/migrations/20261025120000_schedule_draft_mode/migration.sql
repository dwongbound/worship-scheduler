-- Preview Mode can park a plan too, so a draft records which workspace saved
-- it. Existing rows are all generate-flow plans, which the default covers.
ALTER TABLE "schedule_drafts" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'generate';

-- The list and the recovery-slot lookup are both per mode now.
DROP INDEX IF EXISTS "schedule_drafts_orgId_updatedAt_idx";
DROP INDEX IF EXISTS "schedule_drafts_orgId_createdById_isRecovery_idx";
CREATE INDEX "schedule_drafts_orgId_mode_updatedAt_idx" ON "schedule_drafts"("orgId", "mode", "updatedAt");
CREATE INDEX "schedule_drafts_orgId_createdById_mode_isRecovery_idx" ON "schedule_drafts"("orgId", "createdById", "mode", "isRecovery");
