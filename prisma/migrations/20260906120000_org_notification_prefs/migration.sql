-- Per-org switches for the bot's personal (DM) notifications.
--
-- A key→bool map over lib/notificationPrefs.ts NOTIFICATION_TYPES, holding only
-- what an admin has switched off. NULL — which is what every existing org gets
-- here — means every notification is still sent, so this column changes nothing
-- until someone touches a toggle on the org settings page.
ALTER TABLE "orgs" ADD COLUMN "notificationPrefs" JSONB;
