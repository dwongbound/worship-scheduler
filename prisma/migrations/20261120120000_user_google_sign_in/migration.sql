-- When each person last signed in with Google, so the admin Team page can say
-- "Signed in with Google" even for an account that also has a password.
ALTER TABLE "users" ADD COLUMN "googleSignInAt" TIMESTAMP(3);

-- Accounts with no password and no Apple link were made by Google sign-in:
-- mark them now (placeholders excluded, since nobody has signed in to them).
UPDATE "users" SET "googleSignInAt" = CURRENT_TIMESTAMP
WHERE "passwordHash" = '' AND "appleSub" IS NULL AND "isPlaceholder" = false;
