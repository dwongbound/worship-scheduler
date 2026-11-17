-- Scheduling rules: an org's own instructions to the auto-fill, on top of
-- rotation (lib/schedulingRules.ts). One list per org; `position` orders it,
-- and for preferences that order is the ranking.
CREATE TABLE "scheduling_rules" (
    "id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduling_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scheduling_rules_orgId_position_idx" ON "scheduling_rules"("orgId", "position");

-- A deleted org takes its rules with it.
ALTER TABLE "scheduling_rules" ADD CONSTRAINT "scheduling_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
