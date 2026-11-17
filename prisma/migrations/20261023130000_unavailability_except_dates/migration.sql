-- Dates a RECURRING rule skips ("YYYY-MM-DD"), so freeing one date keeps the
-- weekly rule as ONE row instead of splitting its span around that date.
-- AlterTable
ALTER TABLE "unavailability" ADD COLUMN "exceptDates" TEXT[] DEFAULT ARRAY[]::TEXT[];
