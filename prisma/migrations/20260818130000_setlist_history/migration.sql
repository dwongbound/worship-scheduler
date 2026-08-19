-- Setlist changes join the set history. They describe the set's songs rather
-- than a person in a slot, so `role` becomes nullable and a free-text `detail`
-- carries the summary ('Added "Who Else" (E)').

-- AlterEnum
ALTER TYPE "SetHistoryEventType" ADD VALUE 'SETLIST_CHANGED';

-- AlterTable
ALTER TABLE "set_history_events" ALTER COLUMN "role" DROP NOT NULL;

-- AlterTable
ALTER TABLE "set_history_events" ADD COLUMN     "detail" TEXT;
