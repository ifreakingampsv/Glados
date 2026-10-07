import { db } from "@/lib/db";
import {
  DEFAULT_BANDS,
  DEFAULT_POINTS,
  DEFAULT_SOURCE_WEIGHTS,
} from "@/services/levels";

// Seed only: never overwrites an already-tuned config row.
export async function seedConfig() {
  const rows = [
    { key: "levels.bands", value: DEFAULT_BANDS },
    { key: "points.types", value: DEFAULT_POINTS },
    { key: "points.sourceWeights", value: DEFAULT_SOURCE_WEIGHTS },
    // D28/D36: quota economy — rescaled at each D7 ramp stage.
    { key: "energy.dailyGrant", value: 1 },
    { key: "energy.earnWeekly", value: 1 },
    { key: "energy.bankCap", value: 3 },
    { key: "energy.barUsd", value: 0.1 },
    { key: "attractor.caps", value: { jd_scan: 5, resume_scan: 3 } },
    { key: "budget.monthlyUsd", value: 5 },
    { key: "budget.alertUsd", value: 4 },
  ];
  for (const row of rows) {
    const existing = await db.config.findUnique({ where: { key: row.key } });
    if (!existing) {
      await db.config.create({ data: row });
    }
  }
}

// D26: routing table rows are DATA. Atria Dawn ships inactive until its
// OpenAI-compatibility is verified at build time; Google/OpenRouter rows are
// live as soon as the matching PLATFORM_<PROVIDER>_API_KEY exists.
const ROUTES: Array<{
  feature: string;
  provider: string;
  model: string;
  endpoint: string;
  costPer1kUsd: number;
  isActive: boolean;
}> = [
  {
    feature: "smoke",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0,
    isActive: true,
  },
  {
    feature: "smoke",
    provider: "openrouter",
    model: "openrouter/auto",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    costPer1kUsd: 0,
    isActive: true,
  },
  {
    feature: "smoke",
    provider: "atria-dawn",
    model: "atria-fast",
    endpoint: "https://api.atriadawn.example/v1/chat/completions",
    costPer1kUsd: 0,
    isActive: false, // endpoint unverified (D26 open detail)
  },
];

export async function seedRoutes() {
  for (const route of ROUTES) {
    const existing = await db.providerRoute.findFirst({
      where: { feature: route.feature, provider: route.provider },
    });
    if (!existing) {
      await db.providerRoute.create({ data: route });
    }
  }
}
