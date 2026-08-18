// PUT /api/sets/:id/songs — replace a set's setlist (the worship leader's list
// of songs + keys). Editable by an org admin OR anyone assigned to the set (any
// band member may manage the setlist). Send { songs: [{ title, key }] } — the
// whole ordered list; it fully replaces what's there. `key` is one of SONG_KEYS
// or null/omitted (unspecified). Returns the saved songs in order.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import {
  MAX_SONGS_PER_SET,
  MAX_SONG_TITLE_LENGTH,
  normalizeSongKey,
} from "@/lib/constants";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const set = await prisma.set.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  // Permission: org admins, or anyone with an assignment on this set.
  const admin = await requireOrgAdminFor(set.orgId);
  let allowed = !!admin;
  if (!allowed) {
    const slot = await prisma.assignment.findFirst({
      where: { setId: id, userId: user.id },
      select: { id: true },
    });
    allowed = !!slot;
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  if (!Array.isArray(body.songs)) {
    return NextResponse.json({ error: "songs must be an array" }, { status: 400 });
  }
  if (body.songs.length > MAX_SONGS_PER_SET) {
    return NextResponse.json(
      { error: `A setlist can have at most ${MAX_SONGS_PER_SET} songs.` },
      { status: 400 }
    );
  }

  // Clean each row: a non-empty title (trimmed, capped) and a normalized key.
  // Blank-title rows are dropped rather than rejected, so a half-typed row left
  // in the editor doesn't fail the whole save. `order` = final list position.
  const cleaned: { title: string; key: string | null; order: number }[] = [];
  for (const raw of body.songs) {
    if (!raw || typeof raw.title !== "string") continue;
    const title = raw.title.trim().slice(0, MAX_SONG_TITLE_LENGTH);
    if (!title) continue;
    cleaned.push({ title, key: normalizeSongKey(raw.key), order: cleaned.length });
  }

  // Replace-all in one transaction: wipe the old list, insert the new one.
  await prisma.$transaction([
    prisma.song.deleteMany({ where: { setId: id } }),
    prisma.song.createMany({
      data: cleaned.map((s) => ({ ...s, setId: id })),
    }),
  ]);

  const songs = await prisma.song.findMany({
    where: { setId: id },
    orderBy: { order: "asc" },
    select: { id: true, title: true, key: true, order: true },
  });
  return NextResponse.json(songs);
}
