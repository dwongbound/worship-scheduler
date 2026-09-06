-- Notes edits join the set history.
--
-- The set detail modal's History section is back, showing ONLY these events:
-- who wrote or cleared a set's notes, and what they wrote. Like
-- SETLIST_CHANGED this is a set-level event, so it carries no `role` and its
-- summary lives in `detail`.
ALTER TYPE "SetHistoryEventType" ADD VALUE 'NOTES_CHANGED';
