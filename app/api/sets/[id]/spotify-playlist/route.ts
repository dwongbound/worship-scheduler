// POST /api/sets/:id/spotify-playlist — create (or re-sync) the set's
// collaborative Spotify playlist from its saved songs. Any MEMBER of the set's
// org can trigger it (like the Slack group-chat button) — the same action also
// runs automatically when the set's Slack group chat is auto-created. The org is
// derived from the set.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgMemberFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { createOrSyncSetPlaylist } from "@/lib/spotify";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const set = await prisma.set.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const member = await requireOrgMemberFor(set.orgId);
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await createOrSyncSetPlaylist(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, url: result.url });
}
