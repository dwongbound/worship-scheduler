-- Auto Slack group chats.
--   • A team can auto-create each of its upcoming sets' Slack group chat a
--     configurable number of days before the set (the daily cron does it).
--   • Each set records when that group chat was created, so it's made once.
--   • An org membership can opt into being added to EVERY group chat the org
--     creates, even for sets the person isn't assigned to.

-- Team: lead time in days before a set to create its group chat. Null = off.
ALTER TABLE "teams" ADD COLUMN "groupChatLeadDays" INTEGER;

-- Set: when the auto group-chat cron created this set's chat. Null = not yet.
ALTER TABLE "sets" ADD COLUMN "groupChatCreatedAt" TIMESTAMP(3);

-- OrgMembership: always add this person to the org's set group chats.
ALTER TABLE "org_memberships"
  ADD COLUMN "alwaysInGroupChats" BOOLEAN NOT NULL DEFAULT false;
