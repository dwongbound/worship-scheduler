-- A free-text note someone can leave when submitting an availability response
-- ("away the first weekend, back after that").
--
-- NULL — which is what every existing response gets — means no note, which is
-- exactly how the app reads a blank one, so this column changes nothing until
-- someone types into the submit-confirmation modal.
ALTER TABLE "availability_responses" ADD COLUMN "note" TEXT;
