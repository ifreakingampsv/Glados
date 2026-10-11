function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name} — copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

const optional = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

export const env = {
  databaseUrl: requireEnv("DATABASE_URL"),
  gatewayKek: requireEnv("GATEWAY_KEK"),
  // Clerk (D35): identity source of truth. Without keys the app runs
  // un-authenticated in local dev; services are still exercised via tests.
  clerkPublishableKey: optional("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
  clerkSecretKey: optional("CLERK_SECRET_KEY"),
  clerkWebhookSecret: optional("CLERK_WEBHOOK_SECRET"),
  cronSecret: optional("CRON_SECRET"),
  cronConfigured: !!optional("CRON_SECRET"),
  // Cloudflare R2 object storage (D64)
  r2Endpoint: optional("R2_ENDPOINT"),
  r2Bucket: optional("R2_BUCKET"),
  r2AccessKeyId: optional("R2_ACCESS_KEY_ID"),
  r2SecretAccessKey: optional("R2_SECRET_ACCESS_KEY"),
  // Anonymous scanner IP hashing pepper (D60)
  ipHashPepper: optional("IP_HASH_PEPPER") ?? "dev-only-ip-pepper-replace-me",
};

export function isClerkConfigured(): boolean {
  return !!env.clerkPublishableKey && !!env.clerkSecretKey;
}
