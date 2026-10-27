// GET /api/me — current user's editable profile fields.
// PUT /api/me — update them (password only if provided).
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TEAM_ROLE_FIELDS } from "@/lib/teamRoleStore";
import { calendarResyncNeeded, resolveProfileEmail } from "@/lib/profile";
import { isGoogleCalendarAppConfigured, syncSetsAfterResponse } from "@/lib/googleCalendar";

/**
 * Loose enough for a Google calendar address (`…@group.calendar.google.com`)
 * and anything else a person might legitimately own, strict enough to catch a
 * calendar NAME pasted in by mistake — which would otherwise fail silently,
 * since Google just drops an attendee it can't deliver to.
 */
function isEmailish(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      username: true,
      name: true,
      email: true,
      dailyDigest: true,
      calendarInvites: true,
      calendarInviteEmail: true,
      // OAuth-only accounts (Google) are created with an empty passwordHash;
      // the profile page hides "Change password" when there's no usable one.
      passwordHash: true,
      // AuthGate reads this to route membership-less accounts to /join; the
      // profile page reads the per-org Slack fields for its connect UI.
      memberships: {
        select: {
          orgId: true,
          isAdmin: true,
          slackUserId: true,
          org: {
            select: {
              name: true,
              slackTeamName: true,
              slackBotToken: true,
              spotifyRefreshToken: true,
              spotifyDisplayName: true,
              spotifyUserId: true,
              googleCalRefreshToken: true,
            },
          },
        },
      },
      // Roles are per-team: the profile page shows a team dropdown + the roles
      // the user has picked on each team they're on.
      teamMembers: {
        select: {
          roles: true,
          active: true,
          team: {
            select: {
              id: true,
              name: true,
              orgId: true,
              // The team's catalog — which roles it offers at all, and in what
              // order the profile lists the ones I hold.
              roles: { select: TEAM_ROLE_FIELDS, orderBy: { order: "asc" } },
            },
          },
        },
      },
    },
  });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Never leak the hash itself — just whether one exists.
  const { memberships, teamMembers, passwordHash, ...fields } = me;
  return NextResponse.json({
    ...fields,
    hasPassword: !!passwordHash,
    memberships: memberships.map((m) => ({
      orgId: m.orgId,
      orgName: m.org.name,
      isAdmin: m.isAdmin,
      slackUserId: m.slackUserId,
      // Whether the ORG has connected Slack (bot installed) — Connect only
      // helps once an admin has installed the bot for that workspace.
      orgSlackConnected: !!m.org.slackBotToken,
      slackTeamName: m.org.slackTeamName,
      // Whether the ORG has connected its shared Spotify account, + who as.
      orgSpotifyConnected: !!m.org.spotifyRefreshToken,
      spotifyDisplayName: m.org.spotifyDisplayName,
      // Falls back into the label when Spotify gave us no display_name.
      spotifyUserId: m.org.spotifyUserId,
      // Whether the ORG has connected Google Calendar (the /profile hint).
      // Which account is admin-only: /api/google-calendar/status.
      orgGoogleCalendarConnected: !!m.org.googleCalRefreshToken,
    })),
    teams: teamMembers.map((tm) => ({
      id: tm.team.id,
      name: tm.team.name,
      orgId: tm.team.orgId,
      // `roles` = what I play here; `catalog` = what this team offers.
      roles: tm.roles,
      catalog: tm.team.roles,
      active: tm.active,
    })),
  });
}

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Roles aren't editable by their owner at all: they're per-team, and an admin
  // grants them from the Team tab (PATCH /api/admin/users/:id).

  // Google (OAuth-only) accounts sign in with their Google email, so it's not
  // editable — ignore any email in the body and keep the existing value. The
  // rule is a pure, unit-tested helper (see lib/profile.ts).
  const current = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      passwordHash: true,
      email: true,
      calendarInviteEmail: true,
      calendarInvites: true,
    },
  });
  const email = resolveProfileEmail(
    !!current?.passwordHash,
    current?.email ?? null,
    body.email
  );

  // Slack member ids are per-org now (OrgMembership.slackUserId, set via the
  // profile connect UI / PUT /api/memberships/[orgId]/slack) — not written here.
  const data: Record<string, unknown> = {
    name: body.name.trim(),
    email,
  };
  // Daily digest on/off. Only written when the client actually sends it, so a
  // plain name/email save can't silently reset the preference.
  if (typeof body.dailyDigest === "boolean") {
    data.dailyDigest = body.dailyDigest;
  }
  // Calendar invites on/off, same rule: only written when sent, so saving a
  // name can't quietly opt someone back in.
  if (typeof body.calendarInvites === "boolean") {
    data.calendarInvites = body.calendarInvites;
  }
  // Where those invites are sent, when the account email isn't where they want
  // them — typically a secondary calendar's own address. Empty clears it, and
  // a clear falls back to the account email, so there is no "nowhere" state.
  if (typeof body.calendarInviteEmail === "string") {
    const addr = body.calendarInviteEmail.trim();
    if (addr && !isEmailish(addr)) {
      return NextResponse.json(
        { error: "That doesn't look like an email or calendar address" },
        { status: 400 }
      );
    }
    data.calendarInviteEmail = addr || null;
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }
    data.passwordHash = bcrypt.hashSync(body.password, 10);
  }

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: {
        name: true,
        email: true,
        dailyDigest: true,
        calendarInvites: true,
        calendarInviteEmail: true,
      },
    });
    // A new (or changed) email is where set invites go, and switching invites
    // back on is how they arrive, so either re-syncs every upcoming set's guest
    // list — that is what actually sends them. Switching invites OFF only
    // touches the events already out when the person asked to be withdrawn:
    // /profile puts that question in a modal and sends the answer here.
    if (
      isGoogleCalendarAppConfigured() &&
      calendarResyncNeeded(
        {
          email: current?.email ?? null,
          calendarInviteEmail: current?.calendarInviteEmail ?? null,
          calendarInvites: current?.calendarInvites ?? true,
        },
        updated,
        body.withdrawInvites === true
      )
    ) {
      const seats = await prisma.assignment.findMany({
        where: { userId: user.id, set: { startsAt: { gte: new Date() } } },
        select: { setId: true },
      });
      syncSetsAfterResponse(...seats.map((a) => a.setId));
    }
    return NextResponse.json(updated);
  } catch {
    // Most likely a unique-constraint hit on email.
    return NextResponse.json(
      { error: "Email or Slack ID already in use" },
      { status: 400 }
    );
  }
}
