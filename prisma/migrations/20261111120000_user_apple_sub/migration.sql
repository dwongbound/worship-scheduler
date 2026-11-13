-- Sign in with Apple (iOS app): Apple's stable id for the person, so they're
-- recognised even behind a "Hide My Email" relay address. Null for everyone
-- today.
ALTER TABLE "users" ADD COLUMN "appleSub" TEXT;
CREATE UNIQUE INDEX "users_appleSub_key" ON "users"("appleSub");
