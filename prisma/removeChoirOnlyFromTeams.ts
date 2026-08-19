// One-off staging fix: choir-only members shouldn't sit on any band team.
// A "choir-only" user lists CHOIR as their SOLE instrument — they can be added
// to any set's choir regardless of team (choir isn't team-scoped), so keeping
// them on the Sunday / Prayer Room teams just clutters the band rosters.
//
// This disconnects every such user from ALL of their teams. Dry run by default;
// APPLY=1 to write. Point DATABASE_URL at the target branch (env/staging.env).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { normalizeDatabaseUrl } from "../lib/dbUrl";

const prisma = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_URL!)) });
const APPLY = process.env.APPLY === "1";

async function main() {
  console.log(`=== Remove choir-only users from teams — ${APPLY ? "APPLY (writing)" : "DRY RUN"} ===\n`);

  // Everyone currently on at least one team, with their instruments + teams.
  const withTeams = await prisma.user.findMany({
    where: { teams: { some: {} } },
    select: {
      id: true,
      name: true,
      instruments: true,
      teams: { select: { id: true, name: true } },
    },
  });

  // Choir-only = instruments is exactly ["CHOIR"] (nothing else). Users with no
  // instruments, or with CHOIR plus a band role, are left untouched.
  const choirOnly = withTeams.filter(
    (u) => u.instruments.length === 1 && u.instruments[0] === "CHOIR"
  );

  console.log(`${choirOnly.length} choir-only users on a team:\n`);
  for (const u of choirOnly) {
    console.log(`  ${u.name} — leaving: ${u.teams.map((t) => t.name).join(", ")}`);
  }

  if (APPLY) {
    for (const u of choirOnly) {
      await prisma.user.update({
        where: { id: u.id },
        // set: [] disconnects the user from every team they're currently on.
        data: { teams: { set: [] } },
      });
    }
    console.log(`\nUpdated ${choirOnly.length} users.`);
  }

  console.log(`\n=== ${APPLY ? "Done." : "Dry run — nothing written."} ===`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
