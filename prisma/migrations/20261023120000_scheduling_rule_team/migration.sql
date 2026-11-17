-- Per-team scheduling rules: a rule may govern one team's sets instead of the
-- whole org. NULL = org-wide, which is what every existing row is, so this is
-- a pure addition — no behaviour changes for rules already stored.
ALTER TABLE "scheduling_rules" ADD COLUMN "teamId" TEXT;

-- Deleting a team takes its rules with it: a rule left scoped to nothing would
-- silently widen to the whole org, the opposite of what it said.
ALTER TABLE "scheduling_rules"
  ADD CONSTRAINT "scheduling_rules_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "scheduling_rules_teamId_idx" ON "scheduling_rules"("teamId");
