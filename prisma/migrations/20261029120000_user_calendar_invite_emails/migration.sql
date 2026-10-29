-- Per-person choice of whether Google emails them with each calendar invite.
-- Defaults to true, so every existing account keeps getting the emails.
ALTER TABLE "users" ADD COLUMN "calendarInviteEmails" BOOLEAN NOT NULL DEFAULT true;
