-- Per-org shared Spotify account: encrypted refresh token + cosmetic identity.
-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "spotifyRefreshToken" TEXT,
ADD COLUMN     "spotifyUserId" TEXT,
ADD COLUMN     "spotifyDisplayName" TEXT;

-- Remember the set's collaborative playlist so a re-sync updates it, not dupes.
-- AlterTable
ALTER TABLE "sets" ADD COLUMN     "spotifyPlaylistId" TEXT,
ADD COLUMN     "spotifyPlaylistUrl" TEXT;

-- The worship leader's setlist: ordered title + optional key per song.
-- CreateTable
CREATE TABLE "songs" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "key" TEXT,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "songs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "songs_setId_idx" ON "songs"("setId");

-- AddForeignKey
ALTER TABLE "songs" ADD CONSTRAINT "songs_setId_fkey" FOREIGN KEY ("setId") REFERENCES "sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
