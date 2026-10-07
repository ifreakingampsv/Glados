import PgBoss from "pg-boss";

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

export async function stopBoss(): Promise<void> {
  const pending = globalForBoss.boss;
  globalForBoss.boss = undefined;
  if (pending) {
    const boss = await pending;
    await boss.stop();
  }
}
