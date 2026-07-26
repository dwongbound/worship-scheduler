-- AddColumn: mark an ad-hoc set "private" so only org admins and its assigned
-- people can see it. Defaults to false (a normal, org-visible set).
ALTER TABLE "sets" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
