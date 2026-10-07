import { describe, expect, it } from "vitest";
import { getHealth } from "@/services/health";

describe("health service (seam: service layer over real Postgres)", () => {
  it("reports a fresh DB time", async () => {
    const before = Date.now();
    const health = await getHealth();
    const dbMs = health.dbTime.getTime();
    expect(dbMs).toBeGreaterThanOrEqual(before - 5_000);
    expect(dbMs).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("reports pg-boss schema ready", async () => {
    const health = await getHealth();
    expect(health.bossReady).toBe(true);
  });
});
