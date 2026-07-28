// One-off staging cleanup: promote dswong2001@gmail.com to admin of EVERY org,
// then delete the demo seed users (admin/bob/carol/… — the 17 from seed.ts).
// Dry run by default; APPLY=1 to write. Deleting a user cascades to their
// memberships, assignments, unavailability, and swap proposals.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
const APPLY = process.env.APPLY === "1";

const ADMIN_EMAIL = "dswong2001@gmail.com";
// The seed.ts roster — the only usernames we delete. Roster users use their
// email local-part as username, so none of them collide with these.
const DEMO = [
  "admin", "bob", "carol", "dave", "erin", "frank", "grace", "henry", "ivy",
  "jack", "kate", "nina", "omar", "paul", "quinn", "ruth", "newbie",
];

async function main() {
  console.log(`=== Staging cleanup — ${APPLY ? "APPLY (writing)" : "DRY RUN"} ===\n`);

  // 1. Make dswong2001 an admin everywhere (so the org keeps an admin once the
  //    demo admins are gone).
  const su = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true, name: true },
  });
  if (!su) throw new Error(`${ADMIN_EMAIL} not found`);
  const orgs = await prisma.org.findMany({ select: { id: true, name: true } });
  console.log(`Promote ${su.name} to admin of: ${orgs.map((o) => o.name).join(", ")}`);
  if (APPLY) {
    for (const o of orgs) {
      await prisma.orgMembership.upsert({
        where: { userId_orgId: { userId: su.id, orgId: o.id } },
        update: { isAdmin: true },
        create: { userId: su.id, orgId: o.id, isAdmin: true },
      });
    }
  }

  // 2. Delete the demo users.
  const demo = await prisma.user.findMany({
    where: { username: { in: DEMO } },
    select: { id: true, username: true },
  });
  console.log(`\nDelete ${demo.length} demo users: ${demo.map((d) => d.username).join(", ")}`);
  if (APPLY) {
    const res = await prisma.user.deleteMany({
      where: { id: { in: demo.map((d) => d.id) } },
    });
    console.log(`Deleted ${res.count} users.`);
  }

  console.log(`\n=== ${APPLY ? "Done." : "Dry run — nothing written."} ===`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
