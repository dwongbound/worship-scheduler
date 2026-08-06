-- AlterEnum
ALTER TYPE "AssignmentStatus" ADD VALUE 'PENDING_APPROVAL';

-- AlterEnum
ALTER TYPE "SetHistoryEventType" ADD VALUE 'SWAP_PROPOSED';
ALTER TYPE "SetHistoryEventType" ADD VALUE 'SWAP_ACCEPTED';
ALTER TYPE "SetHistoryEventType" ADD VALUE 'APPROVED';
ALTER TYPE "SetHistoryEventType" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "SwapProposalStatus" ADD VALUE 'PENDING_APPROVAL';

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "pendingCoverFromUserId" TEXT,
ADD COLUMN     "swapReason" TEXT;

-- AlterTable
ALTER TABLE "swap_proposals" ADD COLUMN     "reason" TEXT;
