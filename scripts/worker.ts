import "dotenv/config";
import { stopBoss } from "../src/lib/boss";
import { startWorker } from "../src/services/worker";

async function main() {
  const handle = await startWorker();
  console.log("[worker] pg-boss worker started and schedules registered.");

  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down...`);
    try {
      await handle.stop();
      await stopBoss();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal startup error:", err);
  process.exit(1);
});
