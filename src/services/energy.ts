import { Prisma } from "@prisma/client";
import { db, type EnergyAccount } from "@/lib/db";
import { getConfig } from "@/services/levels";

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getOrCreateEnergyAccount(
  userId: string
): Promise<EnergyAccount> {
  return db.energyAccount.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

// Lazy daily grant (D28): 1 bar/day at first touch; the bank is capped at 3
// (D36) so scarcity holds and away-time decays banked value by design.
export async function ensureDailyGrant(userId: string): Promise<EnergyAccount> {
  let account = await getOrCreateEnergyAccount(userId);
  const today = todayUtc();
  if (account.lastGrantDate !== today) {
    const [daily, cap] = await Promise.all([
      getConfig<number>("energy.dailyGrant", 1),
      getConfig<number>("energy.bankCap", 3),
    ]);
    account = await db.energyAccount.update({
      where: { userId },
      data: {
        balance: Math.min(cap, account.balance + daily),
        lastGrantDate: today,
      },
    });
  }
  return maybeEarnWeeklyBar(account);
}

const WEEK_MS = 7 * 86_400_000;

// D84 welcome bar: +1 on signup, granted exactly once (marker column makes
// webhook retries idempotent). Cap still binds.
export async function grantWelcomeBar(userId: string): Promise<void> {
  const bars = await getConfig<number>("interview.welcomeBars", 1);
  if (bars <= 0) return;
  const account = await getOrCreateEnergyAccount(userId);
  if (account.welcomeBarGrantedAt) return;
  const cap = await getConfig<number>("energy.bankCap", 3);
  await db.energyAccount.update({
    where: { userId },
    data: {
      balance: Math.min(cap, account.balance + bars),
      welcomeBarGrantedAt: new Date(),
    },
  });
}

// D36: +1 bar/week earned by ≥1 platform-verified evidence event (points > 0)
// in the trailing 7 days — idle clicks can't farm it; the bank cap still binds.
async function maybeEarnWeeklyBar(
  account: EnergyAccount
): Promise<EnergyAccount> {
  const earn = await getConfig<number>("energy.earnWeekly", 1);
  if (earn <= 0) return account;
  const now = new Date();
  if (
    account.lastEarnedAt &&
    now.getTime() - account.lastEarnedAt.getTime() < WEEK_MS
  ) {
    return account;
  }
  const evidence = await db.eventLog.findFirst({
    where: {
      userId: account.userId,
      points: { gt: 0 },
      occurredAt: { gte: new Date(now.getTime() - WEEK_MS) },
    },
  });
  if (!evidence) return account;
  const cap = await getConfig<number>("energy.bankCap", 3);
  return db.energyAccount.update({
    where: { userId: account.userId },
    data: {
      balance: Math.min(cap, account.balance + earn),
      lastEarnedAt: now,
    },
  });
}

// Deduction runs inside the metering transaction (D38c same-tx discipline).
export async function deductEnergy(
  userId: string,
  bars: number,
  tx: Prisma.TransactionClient
): Promise<number> {
  const account = await tx.energyAccount.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  const next = Math.max(0, account.balance - bars);
  await tx.energyAccount.update({ where: { userId }, data: { balance: next } });
  return next;
}
