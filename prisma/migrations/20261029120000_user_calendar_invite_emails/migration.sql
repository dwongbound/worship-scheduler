-- Whether Google emails this person about the events they're invited to, as
-- opposed to just putting them on their calendar. True for every existing
-- row, which is what Google does on its own and so what they have today.
ALTER TABLE "users" ADD COLUMN "calendarInviteEmails" BOOLEAN NOT NULL DEFAULT true;
