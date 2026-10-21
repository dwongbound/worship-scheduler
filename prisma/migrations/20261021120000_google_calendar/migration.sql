-- Google Calendar sync: the org's connected church account + its push channel,
-- and each set's event id (lib/googleCalendar.ts). All nullable: nothing
-- changes for an org until an admin connects it.
ALTER TABLE "orgs" ADD COLUMN "googleCalRefreshToken" TEXT,
ADD COLUMN "googleCalEmail" TEXT,
ADD COLUMN "googleCalendarId" TEXT,
ADD COLUMN "googleCalSyncToken" TEXT,
ADD COLUMN "googleCalChannelId" TEXT,
ADD COLUMN "googleCalResourceId" TEXT,
ADD COLUMN "googleCalChannelExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "orgs_googleCalChannelId_key" ON "orgs"("googleCalChannelId");

ALTER TABLE "sets" ADD COLUMN "googleEventId" TEXT;
