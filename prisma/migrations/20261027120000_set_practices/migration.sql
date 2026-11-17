-- Practices (rehearsals) on a set: an extra calendar event for the people
-- already on that set. Deliberately not on the app calendar, and never handed
-- to the scheduler as a booking — see lib/practices.ts.
--
-- Two tables because a weekly SetTemplate has no date: its practices are a
-- WEEKDAY and a window within the set's own Mon–Sun week, stamped onto
-- concrete rows at generate time and editable per set afterwards (the same
-- inheritance slotCapacities already has). A practice has a start and an END,
-- never a length — that is how an admin says it, and what the calendar needs.

-- CreateTable
CREATE TABLE "set_practices" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "googleEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "set_practices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_template_practices" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "set_template_practices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "set_practices_setId_startsAt_key" ON "set_practices"("setId", "startsAt");

-- AddForeignKey
ALTER TABLE "set_practices" ADD CONSTRAINT "set_practices_setId_fkey" FOREIGN KEY ("setId") REFERENCES "sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_template_practices" ADD CONSTRAINT "set_template_practices_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "set_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

