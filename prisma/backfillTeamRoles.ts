// One-off migration: copy each person's OLD global roles (User.instruments)
// onto every team they're on, into the new per-team TeamMember.roles. Run once
// per branch after the add_team_member_roles migration, before dropping
// User.instruments / the old team relation.
//
//   - Every existing (user, team) edge → a team_members row whose roles = that
//     user's global instruments.
//   - Teamless choir: a user on NO team whose instruments include CHOIR is put
//     onto the org's fallback team (default "Sunday Worship") with those roles,
//     since choir is now team-scoped and they'd otherwise be unschedulable.
//
// Dry run by default; APPLY=1 to write. CHOIR_FALLBACK_TEAM overrides the team
// name. Point DATABASE_URL at the target branch (env/{dev,staging,prod}.env).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { normalizeDatabaseUrl } from "../lib/dbUrl";

const prisma = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_URL!)) });
const APPLY = process.env.APPLY === "1";
const FALLBACK_TEAM = (process.env.CHOIR_FALLBACK_TEAM ?? "Sunday Worship").toLowerCase();

async function main() {
  console.log(`=== Backfill team roles — ${APPLY ? "APPLY (writing)" : "DRY RUN"} ===\n`);

  // Everyone, with their org memberships, current teams, and global roles.
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      instruments: true,
      teams: { select: { id: true, name: true, orgId: true } },
      memberships: { select: { orgId: true } },
    },
  });

  // Fallback teams (one per org, matched by name) for the teamless-choir case.
  const fallbackTeams = await prisma.team.findMany({
    select: { id: true, name: true, orgId: true },
  });
  const fallbackByOrg = new Map<string, { id: string; name: string }>();
  for (const t of fallbackTeams) {
    if (t.name.toLowerCase() === FALLBACK_TEAM) fallbackByOrg.set(t.orgId, t);
  }

  // Each row we intend to write: (teamId, userId, roles). Deduped by pair.
  const rows = new Map<string, { teamId: string; userId: string; roles: string[] }>();
  const add = (teamId: string, userId: string, roles: string[]) =>
    rows.set(`${teamId}:${userId}`, { teamId, userId, roles });

  let edges = 0;
  let choirPlaced = 0;
  const choirSkipped: string[] = [];

  for (const u of users) {
    if (u.teams.length > 0) {
      // Copy the person's global roles onto every team they already serve on.
      for (const t of u.teams) {
        add(t.id, u.id, u.instruments);
        edges++;
      }
    } else if (u.instruments.includes("CHOIR")) {
      // Teamless choir member → the fallback team of an org they belong to.
      const orgId = u.memberships.find((m) => fallbackByOrg.has(m.orgId))?.orgId;
      const team = orgId ? fallbackByOrg.get(orgId) : undefined;
      if (team) {
        add(team.id, u.id, u.instruments);
        choirPlaced++;
        console.log(`  choir → ${u.name} joins "${team.name}" with [${u.instruments.join(", ")}]`);
      } else {
        choirSkipped.push(u.name);
      }
    }
  }

  console.log(`\n${edges} existing team edges → team_members rows.`);
  console.log(`${choirPlaced} teamless choir members placed on "${FALLBACK_TEAM}".`);
  if (choirSkipped.length > 0) {
    console.log(
      `\n⚠ ${choirSkipped.length} teamless choir members had no "${FALLBACK_TEAM}" team ` +
        `in any of their orgs (left alone): ${choirSkipped.join(", ")}`
    );
  }

  if (APPLY) {
    // Upsert so re-runs are safe: roles are overwritten with the migrated set.
    for (const r of rows.values()) {
      await prisma.teamMember.upsert({
        where: { teamId_userId: { teamId: r.teamId, userId: r.userId } },
        create: { teamId: r.teamId, userId: r.userId, roles: r.roles as never },
        update: { roles: r.roles as never },
      });
    }
    console.log(`\nWrote ${rows.size} team_members rows.`);
  }

  console.log(`\n=== ${APPLY ? "Done." : "Dry run — nothing written."} ===`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
