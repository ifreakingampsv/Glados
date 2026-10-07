// Creates/repairs the shared test account: a Clerk user with an auto-verified
// +clerk_test email (dev instances only), a local spine row with ADMIN role,
// and a big energy balance so nothing gates testing. Idempotent — safe to rerun.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const CLERK_API = "https://api.clerk.com/v1";
// +clerk_test = auto-verified in DEVELOPMENT Clerk instances only — no real
// email exists; example.com is a reserved safe domain. This account never
// reaches a production instance (prod uses a separate Clerk app + keys).
const EMAIL = "gladostest+clerk_test@example.com";
const PASSWORD = "glados-test-7kQm-vRx2-pW9tN4bZ";

async function clerkUser(
  secretKey: string
): Promise<{ id: string; verified: boolean }> {
  const headers = {
    authorization: `Bearer ${secretKey}`,
    "content-type": "application/json",
  };

  const existing = await fetch(
    `${CLERK_API}/users?email_address=${encodeURIComponent(EMAIL)}`,
    {
      headers,
    }
  );
  const found = (await existing.json()) as Array<{ id: string }>;
  if (Array.isArray(found) && found.length > 0) {
    return { id: found[0].id, verified: true };
  }

  const created = await fetch(`${CLERK_API}/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email_address: [EMAIL],
      password: PASSWORD,
      first_name: "Test",
      last_name: "User",
    }),
  });
  if (!created.ok) {
    throw new Error(`Clerk API ${created.status}: ${await created.text()}`);
  }
  const user = (await created.json()) as {
    id: string;
    email_addresses: Array<{ verification: { status: string } }>;
  };
  return {
    id: user.id,
    verified: user.email_addresses[0]?.verification?.status === "verified",
  };
}

async function main() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY missing from .env");

  const { id: clerkId, verified } = await clerkUser(secretKey);

  const user = await db.user.upsert({
    where: { clerkId },
    update: { role: "ADMIN", email: EMAIL },
    create: { clerkId, email: EMAIL, role: "ADMIN" },
  });
  await db.energyAccount.upsert({
    where: { userId: user.id },
    update: { balance: 9999 },
    create: { userId: user.id, balance: 9999 },
  });

  console.log(`clerk user: ${clerkId} (email verified: ${verified})`);
  console.log(
    `local spine row: ${user.id} — role ${user.role}, energy 9999 bars`
  );
  console.log(
    `sign in as: ${EMAIL} (verification code is always 424242; password: ${PASSWORD})`
  );
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
