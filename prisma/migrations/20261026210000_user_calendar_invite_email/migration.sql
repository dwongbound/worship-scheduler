-- Where a person's set invites are sent, when the account email isn't where
-- they want them. Null means keep using "email", which is every existing row.
ALTER TABLE "users" ADD COLUMN "calendarInviteEmail" TEXT;
