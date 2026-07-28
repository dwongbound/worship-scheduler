// One-off staging seeder: create the Tapestry worship roster (profiles +
// instruments + team membership) and the 7 people's scheduling unavailabilities.
//
// SAFE BY DEFAULT: a plain run is a DRY RUN — it connects read-only, resolves
// the org/teams, and prints exactly what it *would* create/update, writing
// nothing. Pass APPLY=1 to actually write.
//
//   Dry:   dotenv -e env/staging.env -- tsx prisma/seedStaging.ts
//   Apply: APPLY=1 dotenv -e env/staging.env -- tsx prisma/seedStaging.ts
//
// Idempotent: users upsert by email (username = email local-part); team links
// and the org membership are connect/upsert; the 7 conflict users have their
// unavailability reset before re-adding so re-runs never duplicate.
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Instrument } from "../lib/generated/prisma/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (dotenv -e env/staging.env)");
const prisma = new PrismaClient({ adapter: new PrismaPg(url) });

const APPLY = process.env.APPLY === "1";
const PASSWORD_HASH = bcrypt.hashSync("password123", 10);

// Instrument shorthands (map from the roster's role words per the agreed rules;
// Male/Female Vox → VOCALS, Violin/Cello → STRINGS, Choir + PWE WL + titles
// ignored).
const WL: Instrument = "WORSHIP_LEADER";
const VOX: Instrument = "VOCALS";
const AG: Instrument = "ACOUSTIC_GUITAR";
const EG: Instrument = "ELECTRIC_GUITAR";
const KEYS: Instrument = "KEYS";
const STR: Instrument = "STRINGS";
const DR: Instrument = "DRUMS";
const BASS: Instrument = "BASS";
const CHOIR: Instrument = "CHOIR"; // NOTE: staging must have the CHOIR enum
// value (merge the choir schema change) before APPLY, or these writes error.

// email → [name, instruments]. Deduped across the roster + choir list (union).
const ROSTER: { email: string; name: string; instruments: Instrument[] }[] = [
  { email: "joelee@tapestry.la", name: "Joe Lee", instruments: [VOX, KEYS, WL] },
  { email: "eugeneyi@tapestry.la", name: "Eugene Yi", instruments: [VOX, KEYS, WL] },
  { email: "austinbahng@tapestry.la", name: "Austin Bahng", instruments: [] },
  { email: "jinwoolim@tapestry.la", name: "Jin Woo Lim", instruments: [EG, AG, VOX] },
  { email: "queenakim@tapestry.la", name: "Queena Kim", instruments: [VOX] },
  { email: "alexoh@tapestry.la", name: "Alex Oh", instruments: [VOX, WL] },
  { email: "yoojinkim00@gmail.com", name: "Yoojin Kim", instruments: [VOX, KEYS, WL] },
  { email: "alexandraboyd@tapestry.la", name: "Alexandra Boyd", instruments: [VOX] },
  { email: "calla.chung03@gmail.com", name: "Calla Chung", instruments: [VOX] },
  { email: "cnyk95@gmail.com", name: "Caroline Kim", instruments: [VOX] },
  { email: "estharkim@gmail.com", name: "Esther Kim", instruments: [VOX] },
  { email: "eunicebak318@gmail.com", name: "Eunice Bak", instruments: [VOX] },
  { email: "gracechoe@tapestry.la", name: "Grace Choe", instruments: [VOX] },
  { email: "jamiekwonn@gmail.com", name: "Jamie Kwon", instruments: [VOX] },
  { email: "jayyunwon12@gmail.com", name: "Jay Won", instruments: [AG, VOX] },
  { email: "joonahn@tapestry.la", name: "Joon Ahn", instruments: [AG, VOX] },
  { email: "jozhyoon@gmail.com", name: "Josh Yoon", instruments: [VOX] },
  { email: "joshuachung4673@gmail.com", name: "Joshua Chung", instruments: [AG, VOX] },
  { email: "joyce.hwang02@gmail.com", name: "Joyce Hwang", instruments: [VOX] },
  { email: "rohjudy@gmail.com", name: "Judy Roh", instruments: [VOX] },
  { email: "sarahkim@tapestry.la", name: "Sarah Kim", instruments: [VOX] },
  { email: "eawong2004@gmail.com", name: "Ethan Wong", instruments: [VOX] },
  { email: "ezekielhong@tapestry.la", name: "Ezekiel Hong", instruments: [VOX] },
  { email: "sihupark915@gmail.com", name: "Sihu Park", instruments: [VOX] },
  { email: "scottyoon@tapestry.la", name: "Scott Yoon", instruments: [VOX, AG] },
  { email: "alisagialac@gmail.com", name: "Alisa Nguyen", instruments: [VOX] },
  { email: "emily.chu316@gmail.com", name: "Emily Chu", instruments: [VOX] },
  { email: "sharonkim4000@gmail.com", name: "Sharon Kim", instruments: [VOX] },
  { email: "misstinakim@gmail.com", name: "Tina Bae", instruments: [VOX] },
  { email: "yenah.shin@gmail.com", name: "Yenah Shin", instruments: [VOX] },
  { email: "claireccollegeapp@gmail.com", name: "Claire Chow", instruments: [KEYS] },
  { email: "estheryeo7@gmail.com", name: "Esther Choi", instruments: [KEYS] },
  { email: "graycelim@gmail.com", name: "Grace Lim", instruments: [KEYS] },
  { email: "jahn1129@gmail.com", name: "Jackie Ahn", instruments: [KEYS] },
  { email: "kimberly.wei1124@gmail.com", name: "Kimberly Wei", instruments: [KEYS] },
  { email: "mjchun13@gmail.com", name: "Mikey Chun", instruments: [KEYS] },
  { email: "sarahyoominyoon@gmail.com", name: "Sarah Yoon", instruments: [KEYS] },
  { email: "nsomphone@gmail.com", name: "Noah Somphone", instruments: [KEYS, BASS] },
  { email: "dannyeltonkim@gmail.com", name: "Danny Kim", instruments: [BASS] },
  { email: "darren.kwong@gmail.com", name: "Darren Kwong", instruments: [BASS] },
  { email: "jacobjunlee@gmail.com", name: "Jacob Lee", instruments: [BASS] },
  { email: "sunghp@gmail.com", name: "Sung Park", instruments: [BASS] },
  { email: "ezekieljkim@gmail.com", name: "Zeke Kim", instruments: [BASS] },
  { email: "chloeeychoe@gmail.com", name: "Chloe Choe", instruments: [STR] },
  { email: "jonathanlin111@gmail.com", name: "Jonathan Lin", instruments: [STR] },
  { email: "chrisminjonglee@gmail.com", name: "Chris Lee", instruments: [DR] },
  { email: "mxchng73@gmail.com", name: "Max Chung", instruments: [DR] },
  { email: "rihwang@usc.edu", name: "Ryan Hwang", instruments: [DR] },
  { email: "letter2kenneth@hotmail.com", name: "Kenneth Chew", instruments: [DR] },
  { email: "dswong2001@gmail.com", name: "Dylan Wong", instruments: [EG] },
  { email: "joshuajasonchang@gmail.com", name: "Joshua Chang", instruments: [EG] },
  { email: "jacobyyoo@gmail.com", name: "Jacob Yoo", instruments: [EG] },
  // Support / tech / choir-only → members with no instruments (per instruction).
  { email: "kimometre@gmail.com", name: "John Kim", instruments: [] },
  { email: "steventan2850@gmail.com", name: "Steven Tan", instruments: [] },
  { email: "timothysawyer@tapestry.la", name: "TJ Sawyer", instruments: [] },
  { email: "annasan81000@gmail.com", name: "Anna Sanchez", instruments: [] },
  { email: "uniuno87@gmail.com", name: "Carrie Kim", instruments: [] },
  { email: "danielx328@gmail.com", name: "Daniel Song", instruments: [] },
  { email: "ericorpia@gmail.com", name: "Eric Orpia", instruments: [] },
  { email: "itsgisellekwak@gmail.com", name: "Giselle Kwak", instruments: [] },
  { email: "jennajo@tapestry.la", name: "Jenna Jo", instruments: [] },
  { email: "jennykim@tapestry.la", name: "Jenny Kim", instruments: [] },
  { email: "justinopk@gmail.com", name: "Justin Choi", instruments: [] },
  { email: "rachel.myungil.kim@gmail.com", name: "Rachel Kim", instruments: [] },
  { email: "stacyaguilar@tapestry.la", name: "Stacy Na", instruments: [] },
  { email: "stephanie.you246@gmail.com", name: "Stephanie You", instruments: [] },
];

// Choir members → the CHOIR instrument (a real skill now). Choir-only people
// end up with just [CHOIR]; those who also sing get [VOCALS, CHOIR]. The
// audio/tech folks are NOT here, so they stay instrument-less.
const CHOIR_EMAILS = new Set<string>([
  // choir-only
  "annasan81000@gmail.com", "uniuno87@gmail.com", "danielx328@gmail.com",
  "ericorpia@gmail.com", "itsgisellekwak@gmail.com", "jennajo@tapestry.la",
  "jennykim@tapestry.la", "justinopk@gmail.com", "rachel.myungil.kim@gmail.com",
  "stacyaguilar@tapestry.la", "stephanie.you246@gmail.com",
  // choir + vox
  "alisagialac@gmail.com", "calla.chung03@gmail.com", "cnyk95@gmail.com",
  "eunicebak318@gmail.com", "joyce.hwang02@gmail.com", "rohjudy@gmail.com",
]);
for (const p of ROSTER) {
  if (CHOIR_EMAILS.has(p.email) && !p.instruments.includes(CHOIR)) {
    p.instruments.push(CHOIR);
  }
}

// Also on Sunday Team (everyone is on Prayer Room Team). From the Sunday list,
// dropping names not in the roster; fuzzy matches noted inline.
const SUNDAY_TEAM_EMAILS = new Set<string>([
  "alexoh@tapestry.la",
  "austinbahng@tapestry.la",
  "calla.chung03@gmail.com",
  "cnyk95@gmail.com", // "Caro Kim"
  "chloeeychoe@gmail.com",
  "chrisminjonglee@gmail.com",
  "claireccollegeapp@gmail.com",
  "dannyeltonkim@gmail.com", // "Danny"
  "darren.kwong@gmail.com",
  "dswong2001@gmail.com",
  "estheryeo7@gmail.com",
  "eugeneyi@tapestry.la",
  "gracechoe@tapestry.la",
  "graycelim@gmail.com",
  "jacobjunlee@gmail.com",
  "jacobyyoo@gmail.com",
  "jamiekwonn@gmail.com",
  "jayyunwon12@gmail.com",
  "jinwoolim@tapestry.la",
  "joelee@tapestry.la",
  "kimometre@gmail.com", // "John B. Kim" → John Kim
  "jonathanlin111@gmail.com",
  "joonahn@tapestry.la",
  "jozhyoon@gmail.com",
  "joshuajasonchang@gmail.com",
  "joshuachung4673@gmail.com",
  "rohjudy@gmail.com",
  "kimberly.wei1124@gmail.com",
  "mxchng73@gmail.com", // "Maximus Chung" → Max Chung
  "mjchun13@gmail.com",
  "nsomphone@gmail.com",
  "queenakim@tapestry.la", // "Queena"
  "rihwang@usc.edu",
  "steventan2850@gmail.com",
  "sunghp@gmail.com", // "Sung"
  "misstinakim@gmail.com",
  "timothysawyer@tapestry.la",
  "yoojinkim00@gmail.com",
  "ezekieljkim@gmail.com",
]);

// Minutes from midnight for the block windows (morning 6–12, afternoon 12–18,
// night 18–24, per the given definitions; literal times used where stated).
const T = (h: number, m = 0) => h * 60 + m;
// Local midnight of a 2026 date (matches how the app reads DATE_RANGE days).
const D = (month: number, day: number) => new Date(2026, month - 1, day);

type Recurring = { day: number; start: number; end: number };
type Range = { start: Date; end: Date };

const WEEKDAY = [1, 2, 3, 4, 5];
const WEEKEND = [6, 0];
// Window shorthands.
const MORN = T(6);
const NOON = T(12);
const EVE = T(18);
const MID = T(24);
// Recurring rule(s) for a set of days over one window.
const rec = (days: number[], start: number, end: number): Recurring[] =>
  days.map((day) => ({ day, start, end }));
// Whole-day date block(s). day(8, 2) = Aug 2; day(8, 8, 9) = Aug 8–9.
const day = (m: number, d1: number, d2 = d1): Range => ({
  start: D(m, d1),
  end: D(m, d2),
});

// Scheduling unavailabilities. day-of-week: 0=Sun … 6=Sat. Only HARD "can't
// serve" is encoded — preferences/requests are dropped. Source text + any
// interpretation call is noted per person.
const CONFLICTS: { email: string; recurring: Recurring[]; ranges: Range[] }[] = [
  // "Weekday mornings and afternoons until 6:45P." / Aug 6–15
  { email: "dannyeltonkim@gmail.com", recurring: rec(WEEKDAY, MORN, T(18, 45)), ranges: [day(8, 6, 15)] },
  // "Tuesday Thursday morning afternoon not available" / 8/2, 8/23
  { email: "misstinakim@gmail.com", recurring: rec([2, 4], MORN, EVE), ranges: [day(8, 2), day(8, 23)] },
  // "Tuesday: morning and noons. Thursday: morning." / 8/22
  { email: "yenah.shin@gmail.com", recurring: [...rec([2], MORN, EVE), ...rec([4], MORN, NOON)], ranges: [day(8, 22)] },
  // "All Tuesday and Thursday Evenings" / 8/15
  { email: "sihupark915@gmail.com", recurring: rec([2, 4], EVE, MID), ranges: [day(8, 15)] },
  // "Tuesday & Thursday 7am & 12pm, Saturday 7am" / 8/15
  { email: "jozhyoon@gmail.com", recurring: [...rec([2, 4], T(7), T(8)), ...rec([2, 4], T(12), T(13)), ...rec([6], T(7), T(8))], ranges: [day(8, 15)] },
  // "Work on weekday morn/noons" / Aug 8, Aug 22
  { email: "eawong2004@gmail.com", recurring: rec(WEEKDAY, MORN, EVE), ranges: [day(8, 8), day(8, 22)] },
  // "Weekdays 7am-8pm" / 8/8-9, 8/16, 8/23
  { email: "joshuajasonchang@gmail.com", recurring: rec(WEEKDAY, T(7), T(20)), ranges: [day(8, 8, 9), day(8, 16), day(8, 23)] },
  // "Work on weekday mornings and noons" / dates ("8/6 7pm prayer & rehearsal,
  // 8/15 prayer") read as commitments not blackouts → dates SKIPPED (flag).
  { email: "rohjudy@gmail.com", recurring: rec(WEEKDAY, MORN, EVE), ranges: [] },
  // "cannot do Tues/Thurs mornings or afternoons due to work" / 8/1, 8/8, 8/25
  { email: "sarahyoominyoon@gmail.com", recurring: rec([2, 4], MORN, EVE), ranges: [day(8, 1), day(8, 8), day(8, 25)] },
  // "Tue/Thu Morning, Noon" / 7/30, 8/1, 8/6, 8/8, 8/9 (whole days)
  { email: "mxchng73@gmail.com", recurring: rec([2, 4], MORN, EVE), ranges: [day(7, 30), day(8, 1), day(8, 6), day(8, 8), day(8, 9)] },
  // recurring n/a / 8/6, 8/13, 8/15, 8/22 (whole days)
  { email: "alisagialac@gmail.com", recurring: [], ranges: [day(8, 6), day(8, 13), day(8, 15), day(8, 22)] },
  // "None" recurring / working Sundays 8/2,8/16 + every Saturday in August;
  // "please schedule me…" requests dropped (flag).
  { email: "jacobjunlee@gmail.com", recurring: [], ranges: [day(8, 2), day(8, 16), day(8, 1), day(8, 8), day(8, 15), day(8, 22), day(8, 29)] },
  // "Evenings (Tuesdays and Thursdays)" / None
  { email: "ezekielhong@tapestry.la", recurring: rec([2, 4], EVE, MID), ranges: [] },
  // "weekday mornings, noons, tue evenings, wed evenings, saturday mornings" / Aug 20–22
  { email: "estharkim@gmail.com", recurring: [...rec(WEEKDAY, MORN, EVE), ...rec([2, 3], EVE, MID), ...rec([6], MORN, NOON)], ranges: [day(8, 20, 22)] },
  // "mornings and Saturday Mornings(7 am)" → all-day-of-week mornings (flag) / 8/20–23
  { email: "jonathanlin111@gmail.com", recurring: rec([1, 2, 3, 4, 5, 6], MORN, NOON), ranges: [day(8, 20, 23)] },
  // "Working during the weekdays" → weekday day (flag) / 8/9,8/15,8/16,8/22,8/23
  { email: "alexoh@tapestry.la", recurring: rec(WEEKDAY, MORN, EVE), ranges: [day(8, 9), day(8, 15), day(8, 16), day(8, 22), day(8, 23)] },
  // "Weekday noons, Tuesday evenings" / 8/2, 8/18, 8/23 (whole days)
  { email: "jahn1129@gmail.com", recurring: [...rec(WEEKDAY, NOON, EVE), ...rec([2], EVE, MID)], ranges: [day(8, 2), day(8, 18), day(8, 23)] },
  // "no 7am or 12pm sessions" → those windows every day (flag); "prefer not 8/2" dropped
  { email: "queenakim@tapestry.la", recurring: [...rec([0, 1, 2, 3, 4, 5, 6], T(7), T(8)), ...rec([0, 1, 2, 3, 4, 5, 6], T(12), T(13))], ranges: [] },
  // None recurring / 8/1, 8/2 (whole days)
  { email: "emily.chu316@gmail.com", recurring: [], ranges: [day(8, 1), day(8, 2)] },
  // "Weekday mornings, weekday noon" / 8/1, 8/6, 8/8, 8/9, 8/27
  { email: "jayyunwon12@gmail.com", recurring: rec(WEEKDAY, MORN, EVE), ranges: [day(8, 1), day(8, 6), day(8, 8), day(8, 9), day(8, 27)] },
  // none recurring / 7/27–31 out of town, 8/1, 8/7–9, 8/15, 8/16
  { email: "claireccollegeapp@gmail.com", recurring: [], ranges: [day(7, 27, 31), day(8, 1), day(8, 7, 9), day(8, 15), day(8, 16)] },
  // "Thursday mornings" / 8/1, 8/4, 8/6, 8/8 (2026)
  { email: "jinwoolim@tapestry.la", recurring: rec([4], MORN, NOON), ranges: [day(8, 1), day(8, 4), day(8, 6), day(8, 8)] },
  // "I'll be out all of august."
  { email: "joyce.hwang02@gmail.com", recurring: [], ranges: [day(8, 1, 31)] },
  // "Only available on 8/4 at 12pm" → out all August EXCEPT 8/4 (flag)
  { email: "estheryeo7@gmail.com", recurring: [], ranges: [day(8, 1, 3), day(8, 5, 31)] },
  // recurring "tbd" dropped / 8/1–2, 8/14–15, 8/25, 8/27
  { email: "joonahn@tapestry.la", recurring: [], ranges: [day(8, 1, 2), day(8, 14, 15), day(8, 25), day(8, 27)] },
  // "Tue/Thu 7am and noon" / out 8/8–13, 8/1–2, 8/15–16
  { email: "calla.chung03@gmail.com", recurring: [...rec([2, 4], T(7), T(8)), ...rec([2, 4], T(12), T(13))], ranges: [day(8, 8, 13), day(8, 1, 2), day(8, 15, 16)] },
  // recurring "yss" (typo) dropped / Aug 16
  { email: "sunghp@gmail.com", recurring: [], ranges: [day(8, 16)] },
  // none recurring / 8/6, 8/9, 8/27–29
  { email: "mjchun13@gmail.com", recurring: [], ranges: [day(8, 6), day(8, 9), day(8, 27, 29)] },
  // "tuesday nights (have a class)"
  { email: "alexandraboyd@tapestry.la", recurring: rec([2], EVE, MID), ranges: [] },
  // "Work weekdays" / Out of town 8/1–9, meeting Sun 8/16
  { email: "darren.kwong@gmail.com", recurring: rec(WEEKDAY, MORN, EVE), ranges: [day(8, 1, 9), day(8, 16)] },
  // "All weekdays M–F minus Thursday rehearsal … can't make 6:45" → Mon/Tue/Wed/Fri until 6:45 / 8/1, 8/13
  { email: "nsomphone@gmail.com", recurring: rec([1, 2, 3, 5], MORN, T(18, 45)), ranges: [day(8, 1), day(8, 13)] },
  // "Work hours on weekdays" / weekends of 8/8, 8/15, 8/22, 8/29, 9/5 (Sat+Sun, flag)
  { email: "letter2kenneth@hotmail.com", recurring: rec(WEEKDAY, MORN, EVE), ranges: [day(8, 8, 9), day(8, 15, 16), day(8, 22, 23), day(8, 29, 30), day(9, 5, 6)] },
  // "cannot serve in august due to work and going home"
  { email: "kimberly.wei1124@gmail.com", recurring: [], ranges: [day(8, 1, 31)] },
  // "all noon, evening and weekend sessions" → weekday noon+eve, weekends all day / 8/13, 8/25, 8/27
  { email: "jamiekwonn@gmail.com", recurring: [...rec(WEEKDAY, NOON, MID), ...rec(WEEKEND, 0, MID)], ranges: [day(8, 13), day(8, 25), day(8, 27)] },
  // "Tue/Thu prayer rooms due to school" → Tue/Thu evenings (flag) / 8/22
  { email: "rihwang@usc.edu", recurring: rec([2, 4], EVE, MID), ranges: [day(8, 22)] },
  // "unsure of Hebrew class schedule" recurring dropped / 8/8 Sat morning (whole day)
  { email: "gracechoe@tapestry.la", recurring: [], ranges: [day(8, 8)] },
  // "weekday morning and noons" / 8/8, 8/9, 8/12, 8/15 ("8/16 preferred not" dropped)
  { email: "dswong2001@gmail.com", recurring: rec(WEEKDAY, MORN, EVE), ranges: [day(8, 8), day(8, 9), day(8, 12), day(8, 15)] },
  // "all evenings"; "some saturday AM" too vague → dropped
  { email: "scottyoon@tapestry.la", recurring: rec([0, 1, 2, 3, 4, 5, 6], EVE, MID), ranges: [] },
  // "Weekday mornings and noon" / None
  { email: "ezekieljkim@gmail.com", recurring: rec(WEEKDAY, MORN, EVE), ranges: [] },
  // "Tuesday evenings" / 8/8, 8/22 (Saturday sets)
  { email: "joshuachung4673@gmail.com", recurring: rec([2], EVE, MID), ranges: [day(8, 8), day(8, 22)] },
  // "tuesday and thursday evenings" / 8/2, 8/8, 8/9, 8/15, 8/22
  { email: "jacobyyoo@gmail.com", recurring: rec([2, 4], EVE, MID), ranges: [day(8, 2), day(8, 8), day(8, 9), day(8, 15), day(8, 22)] },
  // "Thursday evenings" / 8/1, 8/2, 8/9, 8/15
  { email: "cnyk95@gmail.com", recurring: rec([4], EVE, MID), ranges: [day(8, 1), day(8, 2), day(8, 9), day(8, 15)] },
  // "back in town Aug 21" → out of town 8/1–20 (flag)
  { email: "chrisminjonglee@gmail.com", recurring: [], ranges: [day(8, 1, 20)] },
];

const usernameOf = (email: string) => email.split("@")[0];

async function main() {
  console.log(`\n=== Staging seed — ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"} ===\n`);

  // Target org: the one holding Prayer Room Team + Sunday Team. Override with
  // STAGING_ORG if needed.
  const TARGET_ORG = process.env.STAGING_ORG ?? "Sunday Church";
  const org = await prisma.org.findUnique({
    where: { name: TARGET_ORG },
    select: { id: true, name: true },
  });
  if (!org) {
    const all = await prisma.org.findMany({ select: { name: true } });
    throw new Error(
      `Org "${TARGET_ORG}" not found. Orgs present: ${all.map((o) => o.name).join(", ")}`
    );
  }
  console.log(`Org: "${org.name}" (${org.id})`);

  // Find-or-create the two teams.
  const teamByName = new Map<string, string>();
  for (const name of ["Prayer Room Team", "Sunday Team"]) {
    const existing = await prisma.team.findUnique({
      where: { orgId_name: { orgId: org.id, name } },
      select: { id: true },
    });
    if (existing) {
      teamByName.set(name, existing.id);
      console.log(`Team "${name}": exists`);
    } else if (APPLY) {
      const created = await prisma.team.create({
        data: { name, orgId: org.id },
        select: { id: true },
      });
      teamByName.set(name, created.id);
      console.log(`Team "${name}": CREATED`);
    } else {
      console.log(`Team "${name}": would create`);
    }
  }

  // Upsert every person + their instruments, org membership, and team links.
  let created = 0;
  let updated = 0;
  for (const p of ROSTER) {
    const teamNames = ["Prayer Room Team"];
    if (SUNDAY_TEAM_EMAILS.has(p.email)) teamNames.push("Sunday Team");
    const teamIds = teamNames
      .map((n) => teamByName.get(n))
      .filter((id): id is string => !!id)
      .map((id) => ({ id }));

    const existing = await prisma.user.findUnique({
      where: { email: p.email },
      select: { id: true },
    });

    if (!APPLY) {
      console.log(
        `${existing ? "update" : "CREATE"}  ${p.name.padEnd(18)} ${usernameOf(
          p.email
        ).padEnd(24)} [${p.instruments.join(", ") || "—"}]  teams: ${teamNames.join(
          " + "
        )}`
      );
      existing ? updated++ : created++;
      continue;
    }

    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: {
        name: p.name,
        instruments: p.instruments,
        teams: { connect: teamIds },
      },
      create: {
        username: usernameOf(p.email),
        email: p.email,
        name: p.name,
        passwordHash: PASSWORD_HASH,
        instruments: p.instruments,
        teams: { connect: teamIds },
      },
      select: { id: true },
    });
    // Ensure org membership (idempotent).
    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId: user.id, orgId: org.id } },
      update: {},
      create: { userId: user.id, orgId: org.id },
    });
    existing ? updated++ : created++;
  }
  console.log(`\nUsers: ${created} to create, ${updated} to update.`);

  // Reset then re-add unavailability for everyone who gave conflicts.
  const nameByEmail = new Map(ROSTER.map((p) => [p.email, p.name]));
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  console.log(`\nConflicts (unavailability) for ${CONFLICTS.length} people:`);
  for (const c of CONFLICTS) {
    const recurringDesc =
      c.recurring.map((r) => `${DOW[r.day]} ${hhmm(r.start)}-${hhmm(r.end)}`).join("; ") || "—";
    const rangeDesc =
      c.ranges
        .map((r) => (r.start.getTime() === r.end.getTime() ? md(r.start) : `${md(r.start)}-${md(r.end)}`))
        .join(", ") || "—";
    console.log(`  ${(nameByEmail.get(c.email) ?? c.email).padEnd(16)} recurring: ${recurringDesc}  |  dates: ${rangeDesc}`);
    if (!APPLY) continue;

    const user = await prisma.user.findUnique({
      where: { email: c.email },
      select: { id: true },
    });
    if (!user) {
      console.log(`    ! ${c.email} not found — skipping`);
      continue;
    }
    await prisma.unavailability.deleteMany({ where: { userId: user.id } });
    await prisma.unavailability.createMany({
      data: [
        ...c.recurring.map((r) => ({
          userId: user.id,
          type: "RECURRING" as const,
          dayOfWeek: r.day,
          startMinute: r.start,
          endMinute: r.end,
        })),
        ...c.ranges.map((r) => ({
          userId: user.id,
          type: "DATE_RANGE" as const,
          startDate: r.start,
          endDate: r.end,
        })),
      ],
    });
  }

  console.log(
    `\n=== ${APPLY ? "Done — changes written." : "Dry run complete — nothing written. Re-run with APPLY=1 to write."} ===\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
