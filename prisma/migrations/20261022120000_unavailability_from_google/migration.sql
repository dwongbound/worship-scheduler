-- AlterTable
ALTER TABLE "unavailability" ADD COLUMN "fromGoogle" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "googleImportRefreshToken" TEXT;
