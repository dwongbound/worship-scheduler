-- CreateTable
CREATE TABLE "weekly_reminders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_reminders_teamId_dayOfWeek_key" ON "weekly_reminders"("teamId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "weekly_reminders" ADD CONSTRAINT "weekly_reminders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_reminders" ADD CONSTRAINT "weekly_reminders_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
