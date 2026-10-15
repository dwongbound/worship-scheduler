-- "Not me" on an OPEN cover request.
--
-- A cover request is broadcast to every eligible player, so there is no single
-- recipient whose reject resolves it the way a targeted swap's does. A decline
-- is personal instead: it hides that card from the person who left it and DMs
-- the owner their (optional) note, while the request stays open to everyone
-- else.
--
-- Rows are scoped to the CURRENT ask: requesting or cancelling cover on the
-- assignment deletes them, so a second ask reaches the people who passed on
-- the first one.
CREATE TABLE "cover_declines" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cover_declines_pkey" PRIMARY KEY ("id")
);

-- One answer per person per request — declining twice just updates the note.
CREATE UNIQUE INDEX "cover_declines_assignmentId_userId_key" ON "cover_declines"("assignmentId", "userId");

-- Both sides cascade: a deleted assignment or user leaves nothing to hide.
ALTER TABLE "cover_declines" ADD CONSTRAINT "cover_declines_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cover_declines" ADD CONSTRAINT "cover_declines_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
