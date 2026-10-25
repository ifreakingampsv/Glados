import { seedCanonicalSkills } from "../src/services/seed-skills";
import {
  seedConfig,
  seedFeatureFlags,
  seedRoutes,
} from "../src/services/seed-config";
import { backfillProjectSkills } from "../src/services/projects";
import { stopBoss } from "../src/lib/boss";
import { db } from "../src/lib/db";

async function main() {
  await seedCanonicalSkills();
  await seedConfig();
  await seedRoutes();
  await seedFeatureFlags();
  const backfill = await backfillProjectSkills();
  const [skills, config, routes] = await Promise.all([
    db.skill.count({ where: { status: "ACTIVE" } }),
    db.config.count(),
    db.providerRoute.count(),
  ]);
  console.log(
    `seeded: ${skills} active skills, ${config} config rows, ${routes} routes, flags on (${backfill.updatedProjects} projects backfilled)`
  );
  await stopBoss();
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
