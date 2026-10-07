import { db } from "@/lib/db";
import { getBoss } from "@/lib/boss";

export interface HealthReport {
  dbTime: Date;
  bossReady: boolean;
}

export async function getHealth(): Promise<HealthReport> {
  const [timeRows, bossRows, boss] = await Promise.all([
    db.$queryRaw<{ now: Date }[]>`SELECT now() AS now`,
    db.$queryRaw<{ ready: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss'
      ) AS ready`,
    getBoss(),
  ]);
  return { dbTime: timeRows[0].now, bossReady: bossRows[0].ready && !!boss };
}
