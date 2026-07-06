// Seed data for dev + e2e tests. Idempotent: wipes and recreates.
//
// Default logins (all passwords are "password123"):
//   admin — Alice Admin (site admin)     paul  — Paul Park (admin)
//   bob   — drums        kate  — drums    nina  — vocals + keys
//   carol — keys/vocals  dave  — bass     omar  — electric + bass
//   erin  — electric     frank — ac/elec  quinn — strings + vocals
//   grace — vocals       henry — strings  ruth  — drums + bass
//   ivy   — keys         jack  — leader/acoustic
//
// The e2e suite depends on the first "Sunday Morning" set (admin=leader,
// bob=drums, carol=keys) and on kate being a free drummer, so keep those.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Instrument } from "../lib/generated/prisma/client";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed the database.");

const prisma = new PrismaClient({ adapter: new PrismaPg(url) });

// One shared password keeps demo/e2e simple. NEVER do this in prod.
const PASSWORD_HASH = bcrypt.hashSync("password123", 10);
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

const USERS: {
  username: string;
  name: string;
  instruments: Instrument[];
  isAdmin?: boolean;
  completed?: boolean; // has finished entering availability
}[] = [
  { username: "admin", name: "Alice Admin", instruments: ["WORSHIP_LEADER", "VOCALS"], isAdmin: true, completed: true },
  { username: "bob", name: "Bob Baker", instruments: ["DRUMS"], completed: true },
  { username: "carol", name: "Carol Chen", instruments: ["KEYS", "VOCALS"] },
  { username: "dave", name: "Dave Diaz", instruments: ["BASS"], completed: true },
  { username: "erin", name: "Erin Evans", instruments: ["ELECTRIC_GUITAR"] },
  { username: "frank", name: "Frank Ford", instruments: ["ACOUSTIC_GUITAR", "ELECTRIC_GUITAR"] },
  { username: "grace", name: "Grace Gao", instruments: ["VOCALS"], completed: true },
  { username: "henry", name: "Henry Hill", instruments: ["STRINGS"] },
  { username: "ivy", name: "Ivy Ito", instruments: ["KEYS"] },
  { username: "jack", name: "Jack Jones", instruments: ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"] },
  { username: "kate", name: "Kate Kim", instruments: ["DRUMS"], completed: true },
  { username: "nina", name: "Nina Nguyen", instruments: ["VOCALS", "KEYS"], completed: true },
  { username: "omar", name: "Omar Osei", instruments: ["ELECTRIC_GUITAR", "BASS"] },
  { username: "paul", name: "Paul Park", instruments: ["WORSHIP_LEADER", "ACOUSTIC_GUITAR", "VOCALS"], isAdmin: true, completed: true },
  { username: "quinn", name: "Quinn Quezada", instruments: ["STRINGS", "VOCALS"] },
  { username: "ruth", name: "Ruth Rivera", instruments: ["DRUMS", "BASS"] },
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
  await prisma.availabilityRequest.deleteMany();
  await prisma.set.deleteMany();
  await prisma.setTemplate.deleteMany();
  await prisma.user.deleteMany();

  const id: Record<string, string> = {};
  for (const u of USERS) {
    const created = await prisma.user.create({
      data: {
        username: u.username,
        name: u.name,
        passwordHash: PASSWORD_HASH,
        instruments: u.instruments,
        isAdmin: u.isAdmin ?? false,
        scheduleCompletedAt: u.completed ? TWO_DAYS_AGO : null,
      },
    });
    id[u.username] = created.id;
  }

  // ── Sets (a few weeks of upcoming services with partial teams) ────────
  const sunday = await prisma.set.create({
    data: {
      label: "Sunday Morning",
      startsAt: nextDayOfWeek(0, 9, 0),
      durationMinutes: 90,
      notes: "Communion Sunday — extra song after the message.",
    },
  });
  const wednesday = await prisma.set.create({
    data: {
      label: "Wednesday Night",
      startsAt: nextDayOfWeek(3, 19, 0),
      durationMinutes: 60,
      notes: "Youth-led worship night.",
    },
  });
  const saturday = await prisma.set.create({
    data: {
      label: "Saturday Prayer",
      startsAt: nextDayOfWeek(6, 8, 0),
      durationMinutes: 60,
    },
  });
  const sunday2 = await prisma.set.create({
    data: {
      label: "Sunday Morning",
      startsAt: addDays(nextDayOfWeek(0, 9, 0), 14),
      durationMinutes: 90,
      notes: "Baptism service.",
    },
  });
  const wednesday2 = await prisma.set.create({
    data: {
      label: "Wednesday Night",
      startsAt: addDays(nextDayOfWeek(3, 19, 0), 14),
      durationMinutes: 60,
    },
  });

  await prisma.assignment.createMany({
    data: [
      // Sunday Morning (the e2e fixture — leave admin/bob/carol as-is).
      { setId: sunday.id, userId: id.admin, role: "WORSHIP_LEADER", status: "CONFIRMED" },
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

      // Saturday Prayer (small team).
      { setId: saturday.id, userId: id.paul, role: "WORSHIP_LEADER", status: "CONFIRMED" },
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
    ],
  });

  // ── Weekly templates (so the Create tab has content to generate from) ─
  // Distinct labels + non-Sunday days so the demo generator makes clearly new
  // services (and doesn't collide with the create-tab e2e, which adds its own
  // Sunday template).
  await prisma.setTemplate.createMany({
    data: [
      { label: "Thursday Rehearsal", dayOfWeek: 4, startMinute: 19 * 60, durationMinutes: 60 },
      { label: "Friday Bible Study", dayOfWeek: 5, startMinute: 19 * 60, durationMinutes: 60 },
    ],
  });

  // ── Some unavailability, to show the Availabilities data (not carol —
  //    the e2e suite drives her availability directly). ──────────────────
  await prisma.unavailability.createMany({
    data: [
      { userId: id.dave, type: "RECURRING", dayOfWeek: 1, startMinute: 18 * 60, endMinute: 22 * 60 },
      { userId: id.grace, type: "RECURRING", dayOfWeek: 4, startMinute: 0, endMinute: 24 * 60 },
      { userId: id.ivy, type: "RECURRING", dayOfWeek: 6, startMinute: 6 * 60, endMinute: 12 * 60 },
      { userId: id.henry, type: "DATE_RANGE", startDate: daysFromNow(14), endDate: daysFromNow(21), note: "On vacation" },
      { userId: id.erin, type: "DATE_RANGE", startDate: daysFromNow(5), endDate: daysFromNow(8), note: "Traveling for work" },
    ],
  });

  console.log(`Seeded ${USERS.length} users, 5 sets, 2 templates.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
