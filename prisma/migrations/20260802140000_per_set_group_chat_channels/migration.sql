-- Per-set auto group chat: lead time + the channel we create/archive.
-- AlterTable
ALTER TABLE "sets" ADD COLUMN     "groupChatLeadDays" INTEGER,
ADD COLUMN     "groupChatChannelId" TEXT,
ADD COLUMN     "groupChatArchivedAt" TIMESTAMP(3);

-- SetTemplates carry the default lead time their generated sets inherit.
-- AlterTable
ALTER TABLE "set_templates" ADD COLUMN     "groupChatLeadDays" INTEGER;

-- The lead time moved off the team onto the set/template (they are distinct
-- from the team's standing summary channel).
-- AlterTable
ALTER TABLE "teams" DROP COLUMN "groupChatLeadDays";
