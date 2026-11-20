-- Extra group-chat people per RECURRING SET (weekly set time), replacing the
-- org-wide "always in every group chat" flag on org_memberships.
CREATE TABLE "set_template_chat_members" (
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "set_template_chat_members_pkey" PRIMARY KEY ("templateId","userId")
);
ALTER TABLE "set_template_chat_members" ADD CONSTRAINT "set_template_chat_members_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "set_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "set_template_chat_members" ADD CONSTRAINT "set_template_chat_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep everyone who had the old flag in the chats they were getting: put them
-- on every weekly set time in their org. The flag column stays (unread) until
-- a follow-up drops it.
INSERT INTO "set_template_chat_members" ("templateId", "userId")
SELECT t."id", m."userId"
FROM "org_memberships" m
JOIN "set_templates" t ON t."orgId" = m."orgId"
WHERE m."alwaysInGroupChats" = true
ON CONFLICT DO NOTHING;
