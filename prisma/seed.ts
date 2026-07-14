// Seed data for dev + e2e tests. Idempotent: wipes and recreates.
//
// Default logins (all passwords are "password123"):
//   admin — Alice Admin (org 1 admin)    paul  — Paul Park (org 1 + 2 admin)
//   bob   — drums        kate  — drums    nina  — vocals + keys
//   carol — keys/vocals  dave  — bass     omar  — electric + bass
//   erin  — electric     frank — ac/elec  quinn — strings + vocals
//   grace — vocals       henry — strings  ruth  — drums + bass
//   ivy   — keys         jack  — leader/acoustic/keys (MD)
//
// Orgs: two, named after the env ORG_KEYS entries. Org 1 holds everything
// the app always seeded (every user is a member — existing e2e fixtures are
// untouched). Org 2 is small (paul admin + the `college` users + one team /
// set / request) purely so cross-org isolation is testable.
//
// The e2e suite depends on the first "Sunday Morning" set (admin=leader,
// bob=drums, carol=keys) and on kate being a free drummer, so keep those.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Instrument } from "../lib/generated/prisma/client";
import bcrypt from "bcryptjs";
import { parseOrgKeys } from "../lib/orgKeys";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed the database.");

const prisma = new PrismaClient({ adapter: new PrismaPg(url) });

// The admin login + the one shared demo password are configurable via env
// (env/dev.env, env/test.env) so they aren't baked into the source; the
// defaults keep the documented "admin / password123" logins working out of the
// box. One shared password keeps demo/e2e simple — NEVER do this in prod.
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME ?? "admin";
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "password123";
const PASSWORD_HASH = bcrypt.hashSync(SEED_PASSWORD, 10);
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

const USERS: {
  username: string;
  name: string;
  instruments: Instrument[];
  isAdmin?: boolean; // admin of ORG 1 (paul is additionally admin of org 2)
  isMD?: boolean; // eligible to be a required-MD set's musical director
  completed?: boolean; // has finished entering availability (org 1's request)
  prayer?: boolean; // ALSO on the Prayer Room Team (everyone is on Sunday Team)
  college?: boolean; // ALSO a member of org 2
}[] = [
  { username: ADMIN_USERNAME, name: "Alice Admin", instruments: ["WORSHIP_LEADER", "VOCALS"], isAdmin: true, completed: true },
  { username: "bob", name: "Bob Baker", instruments: ["DRUMS"], completed: true },
  { username: "carol", name: "Carol Chen", instruments: ["KEYS", "VOCALS"] },
  { username: "dave", name: "Dave Diaz", instruments: ["BASS"], completed: true },
  { username: "erin", name: "Erin Evans", instruments: ["ELECTRIC_GUITAR"] },
  { username: "frank", name: "Frank Ford", instruments: ["ACOUSTIC_GUITAR", "ELECTRIC_GUITAR"] },
  { username: "grace", name: "Grace Gao", instruments: ["VOCALS"], completed: true, prayer: true, college: true },
  { username: "henry", name: "Henry Hill", instruments: ["STRINGS"], prayer: true },
  { username: "ivy", name: "Ivy Ito", instruments: ["KEYS"], prayer: true },
  // MDs — they lead from an MD-eligible role (keys), which is the only kind of
  // role a musical director can cover (see MD_ROLES).
  { username: "jack", name: "Jack Jones", instruments: ["WORSHIP_LEADER", "ACOUSTIC_GUITAR", "KEYS"], isMD: true, prayer: true, college: true },
  { username: "kate", name: "Kate Kim", instruments: ["DRUMS"], completed: true },
  { username: "nina", name: "Nina Nguyen", instruments: ["VOCALS", "KEYS"], completed: true },
  { username: "omar", name: "Omar Osei", instruments: ["ELECTRIC_GUITAR", "BASS"] },
  { username: "paul", name: "Paul Park", instruments: ["WORSHIP_LEADER", "ACOUSTIC_GUITAR", "VOCALS", "KEYS"], isAdmin: true, isMD: true, completed: true, prayer: true, college: true },
  { username: "quinn", name: "Quinn Quezada", instruments: ["STRINGS", "VOCALS"] },
  { username: "ruth", name: "Ruth Rivera", instruments: ["DRUMS", "BASS"], prayer: true, college: true },
  // A brand-new member who has joined an org but not yet finished their
  // profile: no instruments/roles picked. Drives the "finish setup" reminder
  // dot + banner (see Navbar) — leave this account's instruments empty.
  { username: "newbie", name: "Noah New", instruments: [] },
];

/** Next future occurrence of a weekday at a given time (local tz). */
function nextDayOfWeek(dayOfWeek: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // `|| 7` pushes "today" to next week so seeded sets are always upcoming.
  const delta = (dayOfWeek - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  d.setHours(hour, minute);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/** Midnight, `n` days from today. */
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  // Wipe in dependency order (assignments cascade from sets/users anyway).
  await prisma.assignment.deleteMany();
  await prisma.unavailability.deleteMany();
  await prisma.availabilityResponse.deleteMany();
  await prisma.availabilityRequest.deleteMany();
  await prisma.set.deleteMany();
  await prisma.setTemplate.deleteMany();
  await prisma.orgMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.team.deleteMany();
  await prisma.org.deleteMany();

  // ── Orgs: named after ORG_KEYS so redeemed keys land on THESE rows (the
  //    fallbacks keep `db:seed` working without the env var). ─────────────
  const orgEntries = parseOrgKeys();
  const org1 = await prisma.org.create({
    data: { name: orgEntries[0]?.name ?? "Sunday Church" },
  });
  const org2 = await prisma.org.create({
    data: { name: orgEntries[1]?.name ?? "Youth Ministry" },
  });

  // ── Teams: everyone serves on Sunday Team; `prayer` users also serve on
  //    the Prayer Room Team (sets are scheduled per-team). The College Team
  //    lives in org 2. ─────────────────────────────────────────────────────
  const sundayTeam = await prisma.team.create({
    data: { name: "Sunday Team", orgId: org1.id },
  });
  const prayerTeam = await prisma.team.create({
    data: { name: "Prayer Room Team", orgId: org1.id },
  });
  const collegeTeam = await prisma.team.create({
    data: { name: "College Team", orgId: org2.id },
  });

  const id: Record<string, string> = {};
  for (const u of USERS) {
    const created = await prisma.user.create({
      data: {
        username: u.username,
        name: u.name,
        passwordHash: PASSWORD_HASH,
        instruments: u.instruments,
        isMD: u.isMD ?? false,
        // Everyone joins org 1 (admin flag is PER ORG now); `college` users
        // also join org 2, where paul is the admin.
        memberships: {
          create: [
            { orgId: org1.id, isAdmin: u.isAdmin ?? false },
            ...(u.college
              ? [{ orgId: org2.id, isAdmin: u.username === "paul" }]
              : []),
          ],
        },
        teams: {
          connect: [
            { id: sundayTeam.id },
            ...(u.prayer ? [{ id: prayerTeam.id }] : []),
            ...(u.college ? [{ id: collegeTeam.id }] : []),
          ],
        },
      },
    });
    id[u.username] = created.id;
  }

  // ── Active availability request + who has responded to it ─────────────
  const request = await prisma.availabilityRequest.create({
    data: {
      name: "Fall 2026",
      startDate: daysFromNow(0),
      endDate: daysFromNow(30),
      orgId: org1.id,
    },
  });
  // Users flagged `completed` have marked this request done (per-request now).
  await prisma.availabilityResponse.createMany({
    data: USERS.filter((u) => u.completed).map((u) => ({
      userId: id[u.username],
      requestId: request.id,
      completedAt: TWO_DAYS_AGO,
    })),
  });

  // ── Sets (a few weeks of upcoming services with partial teams) ────────
  const sunday = await prisma.set.create({
    data: {
      label: "Sunday Morning",
      startsAt: nextDayOfWeek(0, 9, 0),
      durationMinutes: 90,
      notes: "Communion Sunday — extra song after the message.",
      teamId: sundayTeam.id,
      orgId: org1.id,
    },
  });
  const wednesday = await prisma.set.create({
    data: {
      label: "Wednesday Night",
      startsAt: nextDayOfWeek(3, 19, 0),
      durationMinutes: 60,
      notes: "Youth-led worship night.",
      teamId: sundayTeam.id,
      orgId: org1.id,
    },
  });
  const saturday = await prisma.set.create({
    data: {
      label: "Saturday Prayer",
      startsAt: nextDayOfWeek(6, 8, 0),
      durationMinutes: 60,
      // Needs a musical director; paul (an MD) covers it on keys below.
      requiresMD: true,
      // Prayer Room set — its roster below only uses Prayer Room members.
      teamId: prayerTeam.id,
      orgId: org1.id,
    },
  });
  const sunday2 = await prisma.set.create({
    data: {
      label: "Sunday Morning",
      startsAt: addDays(nextDayOfWeek(0, 9, 0), 14),
      durationMinutes: 90,
      notes: "Baptism service.",
      teamId: sundayTeam.id,
      orgId: org1.id,
    },
  });
  const wednesday2 = await prisma.set.create({
    data: {
      label: "Wednesday Night",
      startsAt: addDays(nextDayOfWeek(3, 19, 0), 14),
      durationMinutes: 60,
      teamId: sundayTeam.id,
      orgId: org1.id,
    },
  });

  // ── Org 2 fixtures: one set + its own availability request, so cross-org
  //    isolation is visible/testable (only paul/grace/jack/ruth see these). ─
  const collegeNight = await prisma.set.create({
    data: {
      label: "College Night",
      startsAt: nextDayOfWeek(2, 19, 30),
      durationMinutes: 75,
      teamId: collegeTeam.id,
      orgId: org2.id,
    },
  });
  await prisma.availabilityRequest.create({
    data: {
      name: "College Fall Kickoff",
      startDate: daysFromNow(0),
      endDate: daysFromNow(21),
      orgId: org2.id,
    },
  });

  await prisma.assignment.createMany({
    data: [
      // Sunday Morning (the e2e fixture — leave admin/bob/carol as-is).
      { setId: sunday.id, userId: id[ADMIN_USERNAME], role: "WORSHIP_LEADER", status: "CONFIRMED" },
      { setId: sunday.id, userId: id.bob, role: "DRUMS", status: "PENDING" },
      { setId: sunday.id, userId: id.carol, role: "KEYS", status: "CONFIRMED" },
      { setId: sunday.id, userId: id.dave, role: "BASS", status: "PENDING" },
      { setId: sunday.id, userId: id.grace, role: "VOCALS", status: "PENDING" },
      { setId: sunday.id, userId: id.nina, role: "VOCALS", status: "CONFIRMED" },
      { setId: sunday.id, userId: id.frank, role: "ACOUSTIC_GUITAR", status: "CONFIRMED" },
      { setId: sunday.id, userId: id.erin, role: "ELECTRIC_GUITAR", status: "PENDING" },
      { setId: sunday.id, userId: id.henry, role: "STRINGS", status: "PENDING" },

      // Wednesday Night.
      { setId: wednesday.id, userId: id.kate, role: "DRUMS", status: "CONFIRMED" },
      { setId: wednesday.id, userId: id.ivy, role: "KEYS", status: "PENDING" },
      { setId: wednesday.id, userId: id.jack, role: "WORSHIP_LEADER", status: "PENDING" },
      { setId: wednesday.id, userId: id.omar, role: "BASS", status: "PENDING" },
      { setId: wednesday.id, userId: id.quinn, role: "STRINGS", status: "CONFIRMED" },
      { setId: wednesday.id, userId: id.grace, role: "VOCALS", status: "CONFIRMED" },

      // Saturday Prayer (small team). paul (an MD) leads AND covers keys, so the
      // MD requirement is met from an MD-eligible role.
      { setId: saturday.id, userId: id.paul, role: "WORSHIP_LEADER", status: "CONFIRMED" },
      { setId: saturday.id, userId: id.paul, role: "KEYS", status: "CONFIRMED" },
      { setId: saturday.id, userId: id.ruth, role: "DRUMS", status: "PENDING" },
      { setId: saturday.id, userId: id.henry, role: "STRINGS", status: "PENDING" },

      // Sunday Morning, two weeks out (different crew).
      { setId: sunday2.id, userId: id.paul, role: "WORSHIP_LEADER", status: "CONFIRMED" },
      { setId: sunday2.id, userId: id.ruth, role: "DRUMS", status: "CONFIRMED" },
      { setId: sunday2.id, userId: id.ivy, role: "KEYS", status: "PENDING" },
      { setId: sunday2.id, userId: id.dave, role: "BASS", status: "PENDING" },
      { setId: sunday2.id, userId: id.quinn, role: "VOCALS", status: "PENDING" },
      { setId: sunday2.id, userId: id.nina, role: "VOCALS", status: "CONFIRMED" },
      { setId: sunday2.id, userId: id.omar, role: "ELECTRIC_GUITAR", status: "PENDING" },
      { setId: sunday2.id, userId: id.jack, role: "ACOUSTIC_GUITAR", status: "CONFIRMED" },

      // Wednesday Night, two weeks out (sparse — needs filling).
      { setId: wednesday2.id, userId: id.jack, role: "WORSHIP_LEADER", status: "PENDING" },
      { setId: wednesday2.id, userId: id.ruth, role: "DRUMS", status: "PENDING" },
      { setId: wednesday2.id, userId: id.nina, role: "KEYS", status: "PENDING" },

      // College Night (org 2 — its roster only uses org 2 members).
      { setId: collegeNight.id, userId: id.jack, role: "WORSHIP_LEADER", status: "CONFIRMED" },
      { setId: collegeNight.id, userId: id.ruth, role: "DRUMS", status: "PENDING" },
      { setId: collegeNight.id, userId: id.grace, role: "VOCALS", status: "PENDING" },
    ],
  });

  // ── Weekly templates (so the Create tab has content to generate from) ─
  // Distinct labels + non-Sunday days so the demo generator makes clearly new
  // services (and doesn't collide with the create-tab e2e, which adds its own
  // Sunday template).
  await prisma.setTemplate.createMany({
    data: [
      { label: "Thursday Rehearsal", dayOfWeek: 4, startMinute: 19 * 60, durationMinutes: 60, teamId: sundayTeam.id, orgId: org1.id },
      { label: "Friday Bible Study", dayOfWeek: 5, startMinute: 19 * 60, durationMinutes: 60, teamId: prayerTeam.id, orgId: org1.id },
    ],
  });

  // ── Some unavailability, to show the Availabilities data (not carol —
  //    the e2e suite drives her availability directly). ──────────────────
  await prisma.unavailability.createMany({
    data: [
      // General blocks (recurring — apply every week).
      { userId: id.dave, type: "RECURRING", dayOfWeek: 1, startMinute: 18 * 60, endMinute: 22 * 60 },
      { userId: id.grace, type: "RECURRING", dayOfWeek: 4, startMinute: 0, endMinute: 24 * 60 },
      { userId: id.ivy, type: "RECURRING", dayOfWeek: 6, startMinute: 6 * 60, endMinute: 12 * 60 },
      // Specific blocks (one date + time window, tied to the Fall 2026 request).
      { userId: id.henry, type: "SPECIFIC", requestId: request.id, startDate: daysFromNow(14), startMinute: 0, endMinute: 24 * 60 },
      { userId: id.erin, type: "SPECIFIC", requestId: request.id, startDate: daysFromNow(5), startMinute: 18 * 60, endMinute: 22 * 60 },
    ],
  });

  console.log(
    `Seeded 2 orgs, ${USERS.length} users, 3 teams, 6 sets, 2 templates.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
