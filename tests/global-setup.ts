import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgresModule from "embedded-postgres";
import { stopBoss } from "../src/lib/boss";

interface EmbeddedPgServer {
  initialise: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  createDatabase: (name: string) => Promise<void>;
}

type EmbeddedPgCtor = new (config: Record<string, unknown>) => EmbeddedPgServer;

// The package is ESM-with-default-export; bundlers disagree on whether the
// default import is the class or a namespace wrapping it — handle both.
const EmbeddedPostgres: EmbeddedPgCtor =
  (EmbeddedPostgresModule as unknown as { default?: EmbeddedPgCtor }).default ??
  (EmbeddedPostgresModule as unknown as EmbeddedPgCtor);

const TEST_PORT = 5434;
const TEST_URL = `postgresql://postgres:postgres@localhost:${TEST_PORT}/glados_test`;

let pg: EmbeddedPgServer | undefined;

export async function setup() {
  const dataDir = path.join(process.cwd(), ".pgdata", "test");
  fs.mkdirSync(dataDir, { recursive: true });

  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: TEST_PORT,
    persistent: true,
  });
  pg = server;

  try {
    await server.initialise();
  } catch {
    // cluster already initialised from a previous run — fine
  }
  await server.start();
  try {
    await server.createDatabase("glados_test");
  } catch {
    // database already exists — fine
  }

  process.env.DATABASE_URL = TEST_URL;

  execSync("npx prisma db push", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_URL },
  });
}

export async function teardown() {
  try {
    await stopBoss();
  } catch {
    // nothing to stop
  }
  await pg?.stop();
}
