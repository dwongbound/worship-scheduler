// GET  /api/orgs/[id] — the org's settings (org admins only; others get 403).
// PATCH /api/orgs/[id] — update them. Two independent changes live here:
//   • the join key — rotate it (`rotateKey:true`) or set an explicit one
//     (`joinKey:"…"`);
//   • `digestUpcomingDays` — how far ahead this org's daily digest looks;
//   • `notificationPrefs` — which of the bot's personal DMs this org sends. The
//     body carries only the switches that changed; they're merged over what's
//     stored (see lib/notificationPrefs.ts).
// Each is applied only when present, so the settings page can send one field
// without disturbing the other.
// Org-admin gated via requireOrgAdminFor, so a regular org admin can manage
// their own org without super-admin/platform.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminFor } from "@/lib/org";
import {
  DIGEST_UPCOMING_DAYS_MAX,
  DIGEST_UPCOMING_DAYS_MIN,
} from "@/lib/constants";
import {
  mergeNotificationPrefs,
  parseNotificationPrefs,
  validateNotificationPrefs,
  type NotificationPrefs,
} from "@/lib/notificationPrefs";

// What both handlers return — the org's editable settings.
const ORG_FIELDS = {
  id: true,
  name: true,
  joinKey: true,
  digestUpcomingDays: true,
  notificationPrefs: true,
} as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await requireOrgAdminFor(id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const org = await prisma.org.findUnique({
    where: { id },
    select: ORG_FIELDS,
  });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The Json column goes out as a validated map — the settings page shouldn't
  // have to defend itself against whatever a hand-edited row holds.
  return NextResponse.json({
    ...org,
    notificationPrefs: parseNotificationPrefs(org.notificationPrefs),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await requireOrgAdminFor(id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const data: {
    joinKey?: string;
    digestUpcomingDays?: number;
    notificationPrefs?: NotificationPrefs;
  } = {};

  // rotateKey:true mints a fresh random key; or set an explicit one. Absent
  // both, the key is simply left alone (this may be a digest-only update).
  if (body.rotateKey === true) {
    data.joinKey = crypto.randomBytes(9).toString("base64url");
  } else if (typeof body.joinKey === "string" && body.joinKey.trim()) {
    data.joinKey = body.joinKey.trim();
  }

  // The digest look-ahead window. Must be a whole number of days in range —
  // lib/digest.ts clamps on read too, but a bad value should never get stored.
  if (body.digestUpcomingDays !== undefined) {
    const days = Number(body.digestUpcomingDays);
    if (
      !Number.isInteger(days) ||
      days < DIGEST_UPCOMING_DAYS_MIN ||
      days > DIGEST_UPCOMING_DAYS_MAX
    ) {
      return NextResponse.json(
        {
          error: `The digest window must be a whole number of days between ${DIGEST_UPCOMING_DAYS_MIN} and ${DIGEST_UPCOMING_DAYS_MAX}.`,
        },
        { status: 400 }
      );
    }
    data.digestUpcomingDays = days;
  }

  // Notification switches. Only the ones that changed travel, so they're merged
  // over the stored map rather than replacing it — two admins toggling different
  // rows can't wipe each other's change.
  if (body.notificationPrefs !== undefined) {
    const update = validateNotificationPrefs(body.notificationPrefs);
    if (!update) {
      return NextResponse.json(
        { error: "Unknown notification setting." },
        { status: 400 }
      );
    }
    const current = await prisma.org.findUnique({
      where: { id },
      select: { notificationPrefs: true },
    });
    data.notificationPrefs = mergeNotificationPrefs(
      parseNotificationPrefs(current?.notificationPrefs),
      update
    );
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update." },
      { status: 400 }
    );
  }

  try {
    const org = await prisma.org.update({
      where: { id },
      data,
      select: ORG_FIELDS,
    });
    return NextResponse.json({
      ...org,
      notificationPrefs: parseNotificationPrefs(org.notificationPrefs),
    });
  } catch {
    // The @unique on Org.joinKey means a collision lands here.
    return NextResponse.json(
      { error: "That key is already taken — try another." },
      { status: 400 }
    );
  }
}
