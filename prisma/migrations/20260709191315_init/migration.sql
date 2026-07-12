-- CreateEnum
CREATE TYPE "Instrument" AS ENUM ('WORSHIP_LEADER', 'VOCALS', 'ACOUSTIC_GUITAR', 'ELECTRIC_GUITAR', 'KEYS', 'STRINGS', 'DRUMS', 'BASS');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SWAP_REQUESTED');

-- CreateEnum
CREATE TYPE "UnavailabilityType" AS ENUM ('RECURRING', 'SPECIFIC', 'DATE_RANGE');

-- CreateEnum
CREATE TYPE "SetHistoryEventType" AS ENUM ('ADDED', 'REMOVED', 'REASSIGNED', 'CONFIRMED', 'SWAP_REQUESTED', 'SWAP_CANCELED', 'SWAP_TAKEN');

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "slackUserId" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isMD" BOOLEAN NOT NULL DEFAULT false,
    "instruments" "Instrument"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sets" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "notes" TEXT,
    "requiresMD" BOOLEAN NOT NULL DEFAULT false,
    "slotCapacities" JSONB,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Instrument" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_history_events" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "type" "SetHistoryEventType" NOT NULL,
    "role" "Instrument" NOT NULL,
    "actorId" TEXT,
    "targetUserId" TEXT,
    "previousUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "set_history_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unavailability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UnavailabilityType" NOT NULL,
    "dayOfWeek" INTEGER,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "requestId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_templates" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "requiresMD" BOOLEAN NOT NULL DEFAULT false,
    "slotCapacities" JSONB,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "set_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_responses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "edited" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "availability_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TeamMembers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TeamMembers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_slackUserId_key" ON "users"("slackUserId");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_setId_userId_role_key" ON "assignments"("setId", "userId", "role");

-- CreateIndex
CREATE INDEX "set_history_events_setId_createdAt_idx" ON "set_history_events"("setId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "availability_responses_userId_requestId_key" ON "availability_responses"("userId", "requestId");

-- CreateIndex
CREATE INDEX "_TeamMembers_B_index" ON "_TeamMembers"("B");

-- AddForeignKey
ALTER TABLE "sets" ADD CONSTRAINT "sets_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_setId_fkey" FOREIGN KEY ("setId") REFERENCES "sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_history_events" ADD CONSTRAINT "set_history_events_setId_fkey" FOREIGN KEY ("setId") REFERENCES "sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_history_events" ADD CONSTRAINT "set_history_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_history_events" ADD CONSTRAINT "set_history_events_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_history_events" ADD CONSTRAINT "set_history_events_previousUserId_fkey" FOREIGN KEY ("previousUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unavailability" ADD CONSTRAINT "unavailability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unavailability" ADD CONSTRAINT "unavailability_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "availability_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_templates" ADD CONSTRAINT "set_templates_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_responses" ADD CONSTRAINT "availability_responses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_responses" ADD CONSTRAINT "availability_responses_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "availability_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeamMembers" ADD CONSTRAINT "_TeamMembers_A_fkey" FOREIGN KEY ("A") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeamMembers" ADD CONSTRAINT "_TeamMembers_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
