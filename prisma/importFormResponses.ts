// Import an availability Google Form export into an org.
//
// For each response it makes sure there is a User with that email — creating a
// PLACEHOLDER account (lib/accountClaim) when there isn't one yet — puts them in
// the org, records their listed conflicts as whole-day blocks against an
// availability request, and marks that request answered for them.
//
// The placeholder is the point: most people on the form have never logged in.
// Their availability lands on a real row now, and the first time they sign in
// with Google (or sign up) using the same email, that row becomes their
// account — id, membership, availability and all.
//
// Safe to re-run: every write is keyed on something stable (email, the
// (user, org) pair, the (user, request, day) triple), so a second run against
// the same sheet changes nothing.
//
//   DRY RUN (default):
//     dotenv -e env/staging.env -- npx tsx prisma/importFormResponses.ts <file>
//   APPLY:
//     APPLY=1 dotenv -e env/staging.env -- npx tsx prisma/importFormResponses.ts <file>
//
// Env:
//   APPLY=1          write (otherwise print what would happen and exit)
//   ORG_NAME         org to import into           (default "Tap College")
//   REQUEST_NAME     availability request to use  (default "Fall 2026")
//   REQUEST_START    window start, YYYY-MM-DD     (default 2026-09-01)
//   REQUEST_END      window end, YYYY-MM-DD       (default 2026-12-31)
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { normalizeDatabaseUrl } from "../lib/dbUrl";
import {
  findColumn,
  isAlreadyCovered,
  daysBetween,
  parseConflicts,
  parseDelimited,
  parseYmd,
  toRecords,
  ymd,
  type ConflictBlock,
} from "../lib/formImport";
import { FULL_DAY_MIN } from "../lib/availability";

const prisma = new PrismaClient({
  adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_URL!)),
});

const APPLY = process.env.APPLY === "1";
const ORG_NAME = process.env.ORG_NAME ?? "Tap College";
const REQUEST_NAME = process.env.REQUEST_NAME ?? "Fall 2026";
const REQUEST_START = process.env.REQUEST_START ?? "2026-09-01";
const REQUEST_END = process.env.REQUEST_END ?? "2026-12-31";

/** One form response, after column matching. */
interface Response {
  email: string;
  name: string;
  timestamp: Date | null;
  conflicts: string;
  notes: string;
  blocks: ConflictBlock[];
  unparsed: string[];
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: tsx prisma/importFormResponses.ts <export.csv|tsv>");

  console.log(`=== Form import — ${APPLY ? "APPLY (writing)" : "DRY RUN"} ===`);
  console.log(`file: ${file}`);
  console.log(`org:  ${ORG_NAME}`);
  console.log(`request: "${REQUEST_NAME}" ${REQUEST_START} → ${REQUEST_END}\n`);

  const window = { start: parseYmd(REQUEST_START), end: parseYmd(REQUEST_END) };
  const responses = readResponses(file, window);

  const org = await prisma.org.findUnique({
    where: { name: ORG_NAME },
    select: { id: true, name: true },
  });
  if (!org) {
    throw new Error(
      `No org named "${ORG_NAME}". Orgs are matched BY NAME — check the spelling ` +
        `against the target database before re-running.`
    );
  }

  // --- Report what we read, so the dry run is genuinely reviewable ----------
  console.log(`${responses.length} responses:\n`);
  for (const r of responses) {
    const days = r.blocks.length === 0 ? "no conflicts" : r.blocks.map(describe).join(", ");
    console.log(`  ${r.name.padEnd(18)} ${r.email.padEnd(30)} ${days}`);
    for (const u of r.unparsed) {
      console.log(`  ${" ".repeat(18)} ${" ".repeat(30)} ⚠ couldn't read a date in: "${u}"`);
    }
  }

  // Free-text notes have nowhere to live in the schema, so surface them for a
  // human instead of dropping them on the floor. Several are real scheduling
  // constraints ("no more than 1-2 times a month") that an admin should act on.
  const withNotes = responses.filter((r) => r.notes && !isNothing(r.notes));
  if (withNotes.length > 0) {
    console.log(`\n--- Notes for an admin to read (not imported) ---`);
    for (const r of withNotes) console.log(`  ${r.name}: ${r.notes}`);
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing written. Re-run with APPLY=1 to import.`);
    return;
  }

  // --- Write ---------------------------------------------------------------
  const request = await upsertRequest(org.id);
  console.log(`\nAvailability request: ${request.id}`);

  let created = 0; // placeholders stood up by this run
  let waiting = 0; // placeholders from an earlier run, still unclaimed
  let real = 0; // people who already have a real account
  let blocksAdded = 0;
  let blocksSkipped = 0;
  // People who already had an account, and what we did about it — printed at
  // the end, because that's the case an admin most wants to eyeball.
  const existingNotes: string[] = [];

  for (const r of responses) {
    const { user, isNew } = await upsertUser(r);
    if (isNew) {
      created++;
    } else if (user.isPlaceholder) {
      waiting++;
    } else {
      real++;
    }

    // Org membership — never touches isAdmin, and never demotes anyone who
    // already belongs (they may already be an admin of this org).
    const hadMembership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: user.id, orgId: org.id } },
      select: { id: true },
    });
    if (!hadMembership) {
      await prisma.orgMembership.create({
        data: { userId: user.id, orgId: org.id },
      });
    }

    const { added, skipped } = await addBlocks(user.id, request.id, r.blocks);
    blocksAdded += added;
    blocksSkipped += skipped;

    // They answered the form, so the request is answered for them — dated to
    // when they actually submitted it rather than to this import. An existing
    // row is LEFT ALONE: if they already answered (or deliberately un-submitted)
    // in the app, that's more current than this sheet.
    const response = await prisma.availabilityResponse.findUnique({
      where: { userId_requestId: { userId: user.id, requestId: request.id } },
      select: { id: true },
    });
    if (!response) {
      await prisma.availabilityResponse.create({
        data: {
          userId: user.id,
          requestId: request.id,
          completedAt: r.timestamp ?? new Date(),
        },
      });
    }

    if (!isNew && !user.isPlaceholder) {
      const bits = [
        `already had a real account`,
        hadMembership ? `already in ${org.name}` : `added to ${org.name}`,
        `${added} block(s) added${skipped > 0 ? `, ${skipped} already blocked` : ""}`,
        response ? `response left as-is` : `response recorded`,
      ];
      existingNotes.push(`  ${r.name} <${r.email}> — ${bits.join("; ")}`);
    }
  }

  if (existingNotes.length > 0) {
    console.log(`\n--- People who already had an account ---`);
    for (const line of existingNotes) console.log(line);
  }

  console.log(
    `\n✓ ${responses.length} responses imported.\n` +
      `  ${created} placeholder accounts created\n` +
      `  ${waiting} placeholders already existed (still waiting to be claimed)\n` +
      `  ${real} matched people who already have a real account\n` +
      `  ${blocksAdded} availability blocks added` +
      (blocksSkipped > 0 ? `, ${blocksSkipped} skipped (already blocked)` : "")
  );
}

// ---------------------------------------------------------------------------

function readResponses(file: string, window: { start: Date; end: Date }): Response[] {
  const rows = parseDelimited(readFileSync(file, "utf8"));
  const records = toRecords(rows);
  if (records.length === 0) throw new Error("No rows in that file.");

  const headers = Object.keys(records[0]);
  const col = {
    email: findColumn(headers, "email"),
    first: findColumn(headers, "first name"),
    last: findColumn(headers, "last name"),
    timestamp: findColumn(headers, "timestamp"),
    // Matched loosely — the full question text is a paragraph that gets
    // reworded every semester.
    conflicts: findColumn(headers, "conflicts"),
    notes: findColumn(headers, "other notes"),
  };
  if (!col.email) throw new Error(`No email column found in: ${headers.join(" | ")}`);
  if (!col.conflicts) throw new Error(`No conflicts column found in: ${headers.join(" | ")}`);

  // Later responses win: someone who submitted twice meant the second one.
  const byEmail = new Map<string, Response>();
  for (const rec of records) {
    const email = (rec[col.email] ?? "").trim().toLowerCase();
    if (!email.includes("@")) continue;

    const first = col.first ? rec[col.first].trim() : "";
    const last = col.last ? rec[col.last].trim() : "";
    const conflicts = rec[col.conflicts] ?? "";
    const { blocks, unparsed } = parseConflicts(conflicts, window);

    const response: Response = {
      email,
      name: `${first} ${last}`.trim() || email,
      timestamp: col.timestamp ? parseTimestamp(rec[col.timestamp]) : null,
      conflicts,
      notes: col.notes ? (rec[col.notes] ?? "").trim() : "",
      blocks,
      unparsed,
    };

    const prev = byEmail.get(email);
    if (!prev || (response.timestamp && prev.timestamp && response.timestamp > prev.timestamp)) {
      byEmail.set(email, response);
    }
  }
  return [...byEmail.values()];
}

/** Sheets' "8/20/2026 20:52:47", read in the server's timezone. */
function parseTimestamp(value: string): Date | null {
  const m = (value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, mo, d, y, h, min, sec] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +min, sec ? +sec : 0);
  return isNaN(date.getTime()) ? null : date;
}

/** Find the person by email, or stand up a placeholder for them. */
async function upsertUser(r: Response) {
  const existing = await prisma.user.findFirst({
    where: { email: { equals: r.email, mode: "insensitive" } },
  });
  if (existing) return { user: existing, isNew: false };

  const user = await prisma.user.create({
    data: {
      email: r.email,
      // Email doubles as the username, matching /api/signup — so claiming this
      // row later doesn't have to rename anything.
      username: r.email,
      name: r.name,
      // No usable password: a placeholder is claimed (Google sign-in or
      // signup), never signed into. lib/auth.ts refuses it either way.
      passwordHash: "",
      isPlaceholder: true,
      instruments: [],
    },
  });
  return { user, isNew: true };
}

/**
 * Add this person's conflict days.
 *
 * Skips any conflict whose days are ALREADY blocked — checked against every
 * whole-day block they have, not just this request's. That covers the two ways
 * this runs into existing data: a re-run of the import, and a person who
 * already had an account and had entered some of these days in the app
 * themselves. A partly-covered range is still imported, since the days it adds
 * are real.
 *
 * Their own blocks are never edited or removed; the import only ever adds.
 */
async function addBlocks(
  userId: string,
  requestId: string,
  blocks: ConflictBlock[]
): Promise<{ added: number; skipped: number }> {
  if (blocks.length === 0) return { added: 0, skipped: 0 };

  // Every day this person is already marked unavailable for the WHOLE day, from
  // any dated block of theirs. (Timed blocks don't count — being busy 9–12 on
  // the 25th isn't the same as being away that day.)
  const existing = await prisma.unavailability.findMany({
    where: { userId, type: { in: ["SPECIFIC", "DATE_RANGE"] } },
    select: { startDate: true, endDate: true, startMinute: true, endMinute: true },
  });
  const covered = new Set<string>();
  for (const e of existing) {
    if (!e.startDate) continue;
    const allDay = (e.startMinute ?? 0) <= 0 && (e.endMinute ?? FULL_DAY_MIN) >= FULL_DAY_MIN;
    if (!allDay) continue;
    const from = ymd(e.startDate);
    const to = e.endDate ? ymd(e.endDate) : from;
    for (const d of daysBetween(from, to)) covered.add(d);
  }

  let added = 0;
  let skipped = 0;
  for (const b of blocks) {
    if (isAlreadyCovered(b, covered)) {
      skipped++;
      continue;
    }
    await prisma.unavailability.create({
      data: {
        userId,
        type: "SPECIFIC",
        requestId,
        startDate: parseYmd(b.startYmd),
        // A single-day block stores no endDate, matching /api/availability.
        endDate: b.startYmd === b.endYmd ? null : parseYmd(b.endYmd),
        // Whole-day, the shape the calendar's click-to-block creates.
        startMinute: 0,
        endMinute: FULL_DAY_MIN,
        // Keep their own words, so an admin can see WHY the day is blocked.
        note: b.note,
      },
    });
    for (const d of daysBetween(b.startYmd, b.endYmd)) covered.add(d);
    added++;
  }
  return { added, skipped };
}

/** Reuse this semester's request if it exists; otherwise open it. */
async function upsertRequest(orgId: string) {
  const existing = await prisma.availabilityRequest.findFirst({
    where: { orgId, name: REQUEST_NAME },
  });
  if (existing) return existing;

  return prisma.availabilityRequest.create({
    data: {
      orgId,
      name: REQUEST_NAME,
      startDate: parseYmd(REQUEST_START),
      endDate: parseYmd(REQUEST_END),
      // No teams listed = aimed at the whole org, which is right for a roster
      // that isn't split into teams yet.
    },
  });
}

function describe(b: ConflictBlock): string {
  return b.startYmd === b.endYmd ? b.startYmd : `${b.startYmd}→${b.endYmd}`;
}

function isNothing(text: string): boolean {
  return /^(n\/?a|none|no|nope|nah|-+)$/i.test(text.trim());
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
