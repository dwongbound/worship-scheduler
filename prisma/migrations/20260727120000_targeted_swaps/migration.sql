-- Targeted swaps ("trades"): a new PENDING_SWAP assignment state plus a
-- SwapProposal linking the two assignments being traded.

-- AlterEnum: assignments can now be frozen mid-trade.
ALTER TYPE "AssignmentStatus" ADD VALUE 'PENDING_SWAP';

-- CreateEnum
CREATE TYPE "SwapProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED');

-- CreateTable
CREATE TABLE "swap_proposals" (
    "id" TEXT NOT NULL,
    "fromAssignmentId" TEXT NOT NULL,
    "toAssignmentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "status" "SwapProposalStatus" NOT NULL DEFAULT 'PENDING',
    "fromPrevStatus" "AssignmentStatus" NOT NULL,
    "toPrevStatus" "AssignmentStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "swap_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "swap_proposals_toAssignmentId_status_idx" ON "swap_proposals"("toAssignmentId", "status");

-- CreateIndex
CREATE INDEX "swap_proposals_fromAssignmentId_status_idx" ON "swap_proposals"("fromAssignmentId", "status");

-- CreateIndex
CREATE INDEX "swap_proposals_requestedById_idx" ON "swap_proposals"("requestedById");

-- CreateIndex
CREATE INDEX "swap_proposals_recipientId_status_idx" ON "swap_proposals"("recipientId", "status");

-- AddForeignKey
ALTER TABLE "swap_proposals" ADD CONSTRAINT "swap_proposals_fromAssignmentId_fkey" FOREIGN KEY ("fromAssignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_proposals" ADD CONSTRAINT "swap_proposals_toAssignmentId_fkey" FOREIGN KEY ("toAssignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_proposals" ADD CONSTRAINT "swap_proposals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_proposals" ADD CONSTRAINT "swap_proposals_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
