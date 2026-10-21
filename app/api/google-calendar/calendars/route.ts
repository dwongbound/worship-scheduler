// /api/google-calendar/calendars?orgId= — the connected account's calendars,
// and choosing which one holds the org's sets.
//
//   GET → { calendars: [{ id, name, primary }], selectedId }
//   PUT { calendarId } → moves every upcoming set's event onto that calendar
//
// Both are for the ONE admin who connected the account (Org.googleCalConnectedById).
// The account may be someone's own Google account, and its calendar list is
// theirs: every other admin — super-admins included — gets a 403 and sees only
// the chosen calendar's name, via /status.
import { after, NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import {
  listCalendarsFor,
  selectCalendar,
  syncUpcomingSets,
} from "@/lib/googleCalendar";

// Moving calendars re-creates one event per upcoming set.
export const maxDuration = 300;

async function gate(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return { error: NextResponse.json({ error: "orgId required" }, { status: 400 }) };
  }
  const admin = await requireOrgAdminFor(orgId);
  const org = admin
    ? await prisma.org.findUnique({
        where: { id: orgId },
        select: { googleCalConnectedById: true, googleCalendarId: true },
      })
    : null;
  if (!admin || !org?.googleCalConnectedById || org.googleCalConnectedById !== admin.user.id) {
    return {
      error: NextResponse.json(
        { error: "Only the admin who connected Google Calendar can choose its calendar." },
        { status: 403 }
      ),
    };
  }
  return { orgId, selectedId: org.googleCalendarId };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if ("error" in g) return g.error;
  const calendars = await listCalendarsFor(g.orgId);
  if (calendars === "scope") {
    return NextResponse.json(
      { error: "Reconnect Google Calendar to choose a calendar.", reconnect: true },
      { status: 409 }
    );
  }
  if (!calendars) {
    return NextResponse.json({ error: "Couldn't reach Google Calendar." }, { status: 502 });
  }
  return NextResponse.json({ calendars, selectedId: g.selectedId });
}

export async function PUT(req: NextRequest) {
  const g = await gate(req);
  if ("error" in g) return g.error;
  const body = await req.json().catch(() => null);
  if (typeof body?.calendarId !== "string" || !body.calendarId) {
    return NextResponse.json({ error: "calendarId required" }, { status: 400 });
  }
  const result = await selectCalendar(g.orgId, body.calendarId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  if (result.changed) after(() => syncUpcomingSets(g.orgId));
  return NextResponse.json({ ok: true });
}
