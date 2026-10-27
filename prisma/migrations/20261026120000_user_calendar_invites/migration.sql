-- Per-person opt-out from Google Calendar invites for their sets.
-- Defaults to true, so every existing account keeps being invited.
ALTER TABLE "users" ADD COLUMN "calendarInvites" BOOLEAN NOT NULL DEFAULT true;
