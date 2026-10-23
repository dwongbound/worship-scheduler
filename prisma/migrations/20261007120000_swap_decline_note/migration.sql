-- A free-text note the RECIPIENT can leave when declining a targeted swap
-- ("I'm away that week"), typed into the decline modal on the set-manager tab.
--
-- NULL — what every existing proposal gets — means no note, which is how the
-- "swap declined" DM already reads a blank one: it just omits the sentence.
ALTER TABLE "swap_proposals" ADD COLUMN "declineNote" TEXT;
