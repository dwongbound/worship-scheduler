-- Placeholder accounts: rows created by an admin import (the availability form
-- roster) for people who don't have an account yet. They hold the person's org
-- membership and availability answers until that person first signs in.
--
-- The link is the EMAIL. Signing in with Google, or signing up, with an address
-- that already has a placeholder row CLAIMS that row instead of creating a
-- second account — so the availability imported for them is already theirs.
-- Claiming clears this flag; from then on it's an ordinary account.
--
-- Defaults to false, so every account that exists today is (correctly) a real
-- one and nothing about the login path changes for them.
ALTER TABLE "users" ADD COLUMN "isPlaceholder" BOOLEAN NOT NULL DEFAULT false;

-- NOTE: claiming looks a person up by email case-insensitively (people type
-- "Mary.Kim@Gmail.com" on one service and "mary.kim@gmail.com" on another),
-- which the existing unique index on email can't serve. No functional index is
-- added for it on purpose: Prisma's schema can't express LOWER(email), so one
-- would read as drift and the next `migrate dev` would generate a DROP for it.
-- The users table is a church roster (hundreds of rows), and the lookup only
-- happens at sign-in, so the sequential scan is not worth that trade.
