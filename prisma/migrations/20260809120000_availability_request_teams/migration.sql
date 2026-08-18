-- Team targeting for availability requests: an admin picks which teams a
-- request is aimed at. Existing rows get no teams, which means "the whole org"
-- (see AvailabilityRequest.teams) — so nobody's current request changes.

-- CreateTable
CREATE TABLE "_AvailabilityRequestTeams" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AvailabilityRequestTeams_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_AvailabilityRequestTeams_B_index" ON "_AvailabilityRequestTeams"("B");

-- AddForeignKey
ALTER TABLE "_AvailabilityRequestTeams" ADD CONSTRAINT "_AvailabilityRequestTeams_A_fkey" FOREIGN KEY ("A") REFERENCES "availability_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AvailabilityRequestTeams" ADD CONSTRAINT "_AvailabilityRequestTeams_B_fkey" FOREIGN KEY ("B") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
