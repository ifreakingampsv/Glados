import PgBoss from "pg-boss";
import type { Prisma } from "@prisma/client";

const globalForBoss = globalThis as unknown as { boss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  globalForBoss.boss ??= new PgBoss({
    connectionString: process.env.DATABASE_URL,
  })
    .start()
    .catch((error: unknown) => {
      globalForBoss.boss = undefined;
      throw error;
    });
  return globalForBoss.boss;
}

export async function ensureQueue(name: string): Promise<void> {
  const boss = await getBoss();
  const existing = await boss.getQueue(name);
  if (!existing) {
    await boss.createQueue(name);
  }
}

export function prismaTxToBossDb(tx: Prisma.TransactionClient): PgBoss.Db {
  return {
    async executeSql(text: string, values: unknown[] = []) {
      const normalized = values.map((v) =>
        v !== null &&
        typeof v === "object" &&
        !(v instanceof Date) &&
        !Buffer.isBuffer(v)
          ? JSON.stringify(v)
          : v
      );
      const rows = await tx.$queryRawUnsafe<unknown[]>(text, ...normalized);
      return { rows };
    },
  };
}

export async function stopBoss(): Promise<void> {
  const pending = globalForBoss.boss;
  globalForBoss.boss = undefined;
  if (pending) {
    const boss = await pending;
    await boss.stop();
  }
}
