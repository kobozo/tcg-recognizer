-- Capture the corrected card's collection (set), number, and source id so a
-- correction identifies an exact card, not just a name.
ALTER TABLE "Feedback" ADD COLUMN "correctedSet" TEXT;
ALTER TABLE "Feedback" ADD COLUMN "correctedNumber" TEXT;
ALTER TABLE "Feedback" ADD COLUMN "correctedCardId" TEXT;
