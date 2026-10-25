import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_BANDS,
  DEFAULT_POINTS,
  DEFAULT_SOURCE_WEIGHTS,
} from "@/services/levels";
import {
  DEFAULT_DISCOVER_ANNOTATE_TOP_N,
  DEFAULT_DISCOVER_ARCHETYPES,
  DEFAULT_DISCOVER_AVOID,
  DEFAULT_DISCOVER_DIFFICULTY,
  DEFAULT_DISCOVER_FILTERS,
  DEFAULT_DISCOVER_GRID,
  DEFAULT_DISCOVER_LISTS,
  DEFAULT_DISCOVER_MATCH_WEIGHTS,
  DEFAULT_DISCOVER_STAR_BANDS,
  DEFAULT_DISCOVER_TELEMETRY_MINIMUMS,
  DEFAULT_DISCOVER_WEIGHTS,
  DEFAULT_FLAGSHIP_PROMPT_TEMPLATE,
} from "@/services/shelf";

export const DEFAULT_ATTRACTOR_CAPS: Record<string, number> = {
  jd_scan: 5,
  resume_scan: 3,
  linkedin_review: 1,
  anonymous_scan: 2,
};

export const DEFAULT_FIT_WEIGHTS = {
  evidenced: 1.0,
  claim: 0.5,
  expectedLevel: 3,
};

export const DEFAULT_PROFILE_STRONG_THRESHOLD = {
  minEvidencedSkills: 3,
  minLevel: 1,
  minProjectsWithSkills: 1,
};

export const DEFAULT_WORK_EXP_SCORER = {
  jobBasePoints: 4,
  internshipBasePoints: 2,
  maxYearsMultiplier: 3,
  minSpecMultiplier: 0.5,
  maxSpecMultiplier: 2.0,
  depthCharsForFull: 200,
  stackMentionsForFull: 2,
};

export const DEFAULT_SHRINK_BOUNDS = {
  minFontPt: 9.5,
  defaultFontPt: 11,
  minLineHeight: 1.2,
  defaultLineHeight: 1.45,
  minMarginIn: 0.4,
  defaultMarginIn: 0.65,
  maxCharsPerPage: 3400,
};

export const DEFAULT_ECONOMICS_ASSUMPTIONS = {
  activeUsers: 50,
  scansPerUserPerDay: 1,
  reviewsPerUserPerDay: 0.2,
  fixedServerCostUsd: 5,
  targetMargin: 0.5,
};

export const DEFAULT_QUIZ_BANDS = [
  { band: "L0-1", minLevel: 0, maxLevel: 1 },
  { band: "L2-3", minLevel: 2, maxLevel: 3 },
  { band: "L4-5", minLevel: 4, maxLevel: 5 },
];

export const DEFAULT_QUIZ_SCORING: Record<string, number> = {
  "L0-1": 1,
  "L2-3": 2,
  "L4-5": 4,
};

export const DEFAULT_TELEMETRY_MINIMUMS = {
  perQuestionAnswers: 20,
  completionSessionsPerBank: 10,
  dropOffSessions: 20,
  timePerQuestionAnswers: 50,
  retakeWindowDays: 30,
  divergenceMinUsers: 3,
};

export const DEFAULT_TELEMETRY_ALERT_THRESHOLD = {
  minAnswers: 20,
  maxSuccessRate: 0.2,
};

export interface CertProviderConfig {
  slug: string;
  name: string;
  verifyPattern: string;
  exampleUrl: string;
}

export const DEFAULT_CERT_PROVIDERS: CertProviderConfig[] = [
  {
    slug: "coursera",
    name: "Coursera",
    verifyPattern:
      "^https://(www\\.)?coursera\\.org/account/accomplishments/(verify|certificate|specialization|professional-cert)/[A-Za-z0-9_-]+",
    exampleUrl:
      "https://www.coursera.org/account/accomplishments/verify/ABC123XYZ",
  },
  {
    slug: "edx",
    name: "edX",
    verifyPattern:
      "^https://(courses\\.edx\\.org/certificates/[a-f0-9]{32}|credentials\\.edx\\.org/credentials/[a-f0-9-]+)",
    exampleUrl:
      "https://courses.edx.org/certificates/0123456789abcdef0123456789abcdef",
  },
  {
    slug: "deeplearning-ai",
    name: "DeepLearning.AI",
    verifyPattern:
      "^https://(learn\\.deeplearning\\.ai/accomplishments/[A-Za-z0-9_-]+|(www\\.)?coursera\\.org/account/accomplishments/(verify|certificate|specialization)/[A-Za-z0-9_-]+)",
    exampleUrl: "https://learn.deeplearning.ai/accomplishments/abc123xyz",
  },
  {
    slug: "udacity",
    name: "Udacity",
    verifyPattern:
      "^https://(www\\.|confirm\\.)?udacity\\.com/(certificate/)?e/[A-Za-z0-9-]+",
    exampleUrl:
      "https://www.udacity.com/certificate/e/12345678-abcd-ef01-2345-6789abcdef01",
  },
  {
    slug: "freecodecamp",
    name: "freeCodeCamp",
    verifyPattern:
      "^https://(www\\.)?freecodecamp\\.org/certification/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+",
    exampleUrl:
      "https://www.freecodecamp.org/certification/fcc-user/responsive-web-design",
  },
  {
    slug: "google-career-certificates",
    name: "Google / Meta Career Certificates (Coursera)",
    verifyPattern:
      "^https://(www\\.)?coursera\\.org/account/accomplishments/(professional-cert|verify|specialization)/[A-Za-z0-9_-]+",
    exampleUrl:
      "https://www.coursera.org/account/accomplishments/professional-cert/GOOGLE123",
  },
  {
    slug: "datacamp",
    name: "DataCamp",
    verifyPattern:
      "^https://(www\\.)?datacamp\\.com/(certificate|statement-of-accomplishment)/[A-Za-z0-9_/-]+",
    exampleUrl: "https://www.datacamp.com/certificate/SQA0012345678",
  },
  {
    slug: "codecademy",
    name: "Codecademy",
    verifyPattern:
      "^https://(www\\.)?codecademy\\.com/profiles/[A-Za-z0-9_-]+/certificates/[A-Za-z0-9_-]+",
    exampleUrl:
      "https://www.codecademy.com/profiles/user123/certificates/abc123def456",
  },
  {
    slug: "educative",
    name: "Educative",
    verifyPattern:
      "^https://(www\\.)?educative\\.io/verify-certificate/[A-Za-z0-9_-]+",
    exampleUrl: "https://www.educative.io/verify-certificate/XYZ987ABC",
  },
  {
    slug: "hackerrank",
    name: "HackerRank",
    verifyPattern:
      "^https://(www\\.)?hackerrank\\.com/certificates/[A-Za-z0-9_-]+",
    exampleUrl: "https://www.hackerrank.com/certificates/a1b2c3d4e5f6",
  },
  {
    slug: "mongodb-university",
    name: "MongoDB University",
    verifyPattern: "^https://learn\\.mongodb\\.com/c/[A-Za-z0-9_-]+",
    exampleUrl: "https://learn.mongodb.com/c/1234567890abcdef",
  },
];

// Seed only: never overwrites an already-tuned config row, but merges newly
// introduced S1/S1.5 dictionary keys into points.types and attractor.caps.
export async function seedConfig() {
  const rows: Array<{ key: string; value: unknown }> = [
    { key: "levels.bands", value: DEFAULT_BANDS },
    { key: "points.types", value: DEFAULT_POINTS },
    { key: "points.sourceWeights", value: DEFAULT_SOURCE_WEIGHTS },
    // D28/D36: quota economy — rescaled at each D7 ramp stage.
    { key: "energy.dailyGrant", value: 1 },
    { key: "energy.earnWeekly", value: 1 },
    { key: "energy.bankCap", value: 3 },
    { key: "energy.barUsd", value: 0.1 },
    { key: "attractor.caps", value: DEFAULT_ATTRACTOR_CAPS },
    { key: "budget.monthlyUsd", value: 5 },
    { key: "budget.alertUsd", value: 4 },
    // S1 tunables (D58, D60, D61, D69, D71, D73, D43)
    { key: "scanner.anonymousDailyCap", value: 2 },
    { key: "scanner.anonymousTtlDays", value: 30 },
    { key: "linkedin.dailyCap", value: 1 },
    { key: "imports.githubCap", value: 25 },
    { key: "jd.softCap", value: 20 },
    { key: "gap.fitWeights", value: DEFAULT_FIT_WEIGHTS },
    {
      key: "gap.profileStrongThreshold",
      value: DEFAULT_PROFILE_STRONG_THRESHOLD,
    },
    { key: "workExperience.scorer", value: DEFAULT_WORK_EXP_SCORER },
    { key: "resume.shrinkBounds", value: DEFAULT_SHRINK_BOUNDS },
    { key: "economics.assumptions", value: DEFAULT_ECONOMICS_ASSUMPTIONS },
    // S1.5 calibration tunables (D59, D74, D75, D76, D77, D78)
    { key: "quiz.bands", value: DEFAULT_QUIZ_BANDS },
    { key: "quiz.roundSize", value: 6 },
    { key: "quiz.cap", value: 18 },
    { key: "quiz.stepUp", value: 5 },
    { key: "quiz.stepDown", value: 2 },
    { key: "quiz.cooldownDays", value: 7 },
    { key: "quiz.abandonThreshold", value: 3 },
    { key: "quiz.scoring", value: DEFAULT_QUIZ_SCORING },
    { key: "telemetry.minimums", value: DEFAULT_TELEMETRY_MINIMUMS },
    {
      key: "telemetry.alertThreshold",
      value: DEFAULT_TELEMETRY_ALERT_THRESHOLD,
    },
    { key: "certs.providers", value: DEFAULT_CERT_PROVIDERS },
    { key: "posts.minCommitsPerMilestone", value: 10 },
    { key: "posts.maxPerWeek", value: 2 },
    // S2 interview tunables (D80, D81, D84, D88)
    { key: "interview.quickQuestions", value: 5 },
    { key: "interview.deepQuestions", value: 12 },
    { key: "interview.pushCap", value: 2 },
    { key: "interview.abandonDays", value: 7 },
    { key: "interview.barsPerSession", value: 1 },
    { key: "interview.welcomeBars", value: 1 },
    { key: "interview.mcpGradeDailyCap", value: 3 },
    { key: "interview.portfolioCap", value: 3 },
    {
      key: "interview.verdictFractions",
      value: { green: 1, amber: 0.5, red: 0 },
    },
    // S3a shelf tunables (D90–D96) — archetypes, bands, gates, weights are
    // all data; archetype growth is config editing, never code.
    { key: "discover.lists", value: DEFAULT_DISCOVER_LISTS },
    { key: "discover.archetypes", value: DEFAULT_DISCOVER_ARCHETYPES },
    { key: "discover.starBands", value: DEFAULT_DISCOVER_STAR_BANDS },
    { key: "discover.grid", value: DEFAULT_DISCOVER_GRID },
    { key: "discover.avoid", value: DEFAULT_DISCOVER_AVOID },
    { key: "discover.weights", value: DEFAULT_DISCOVER_WEIGHTS },
    { key: "discover.filters", value: DEFAULT_DISCOVER_FILTERS },
    { key: "discover.matchWeights", value: DEFAULT_DISCOVER_MATCH_WEIGHTS },
    { key: "discover.difficulty", value: DEFAULT_DISCOVER_DIFFICULTY },
    { key: "discover.annotateTopN", value: DEFAULT_DISCOVER_ANNOTATE_TOP_N },
    {
      key: "discover.telemetryMinimums",
      value: DEFAULT_DISCOVER_TELEMETRY_MINIMUMS,
    },
    {
      key: "discover.flagshipPromptTemplate",
      value: DEFAULT_FLAGSHIP_PROMPT_TEMPLATE,
    },
  ];

  for (const row of rows) {
    const existing = await db.config.findUnique({ where: { key: row.key } });
    if (!existing) {
      await db.config.create({
        data: {
          key: row.key,
          value: row.value as unknown as Prisma.InputJsonValue,
        },
      });
    } else if (
      (row.key === "points.types" || row.key === "attractor.caps") &&
      existing.value &&
      typeof existing.value === "object" &&
      !Array.isArray(existing.value)
    ) {
      const currentObj = existing.value as Record<string, number>;
      const defaultsObj = row.value as Record<string, number>;
      const merged = { ...defaultsObj, ...currentObj };
      // D88a zero-row rename: drop the dead S0-reserved key so the seeded
      // dictionary matches the renamed vocabulary (interview_completed).
      if (row.key === "points.types") delete merged.interview_passed;
      if (Object.keys(merged).length !== Object.keys(currentObj).length) {
        await db.config.update({
          where: { key: row.key },
          data: { value: merged as unknown as Prisma.InputJsonValue },
        });
      }
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
    provider: "atriadawn",
    model: "Atria-Dawn",
    endpoint: "https://api.atria-asi.ai/v1/chat/completions",
    costPer1kUsd: 0, // free preview tier (100M-token promo, Oct 2026)
    isActive: true, // OpenAI-compat verified live 2026-10-25 (D26 closed)
  },
  {
    feature: "skill_definition",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.0005,
    isActive: true,
  },
  {
    feature: "resume_parse",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.001,
    isActive: true,
  },
  {
    feature: "jd_extract",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.001,
    isActive: true,
  },
  {
    feature: "linkedin_review",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.0015,
    isActive: true,
  },
  // S1.5 calibration gateway features (D78f: bank_gen and cert_course_map are
  // platform-only shared cache; post_draft is personal output with BYO auto-win).
  {
    feature: "bank_gen",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.001,
    isActive: true,
  },
  {
    feature: "cert_course_map",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.0005,
    isActive: true,
  },
  {
    feature: "post_draft",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.0015,
    isActive: true,
  },
  // D88f: interview routing rows — cheap tier carries the live turns, the
  // grader gets its own row so the drift cron can watch it (D83/D84).
  {
    feature: "interview_turn",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.0004,
    isActive: false, // flip on when PLATFORM_GOOGLE_API_KEY exists (D26)
  },
  {
    feature: "interview_turn",
    provider: "atriadawn",
    model: "Atria-Dawn",
    endpoint: "https://api.atria-asi.ai/v1/chat/completions",
    costPer1kUsd: 0,
    isActive: true,
  },
  {
    feature: "interview_grader",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.001,
    isActive: false, // flip on when PLATFORM_GOOGLE_API_KEY exists (D26)
  },
  {
    feature: "interview_grader",
    provider: "atriadawn",
    model: "Atria-Dawn",
    endpoint: "https://api.atria-asi.ai/v1/chat/completions",
    costPer1kUsd: 0,
    isActive: true,
  },
  {
    feature: "briefing_note",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.0004,
    isActive: false, // flip on when PLATFORM_GOOGLE_API_KEY exists (D26)
  },
  {
    feature: "briefing_note",
    provider: "atriadawn",
    model: "Atria-Dawn",
    endpoint: "https://api.atria-asi.ai/v1/chat/completions",
    costPer1kUsd: 0,
    isActive: true,
  },
  // S3a (D92/D96g): annotations are a SHARED asset — platform-only (D78f,
  // bank_gen precedent), 120s timeout at the call site (bank/grade class).
  {
    feature: "repo_annotate",
    provider: "google",
    model: "gemini-2.0-flash",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    costPer1kUsd: 0.0005,
    isActive: false, // flip on when PLATFORM_GOOGLE_API_KEY exists (D26)
  },
  {
    feature: "repo_annotate",
    provider: "atriadawn",
    model: "Atria-Dawn",
    endpoint: "https://api.atria-asi.ai/v1/chat/completions",
    costPer1kUsd: 0,
    isActive: true,
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

// S3a (D96i): the single kill-switch row gates page + both schedules + the
// MCP tool. Absent row = enabled (gateway checkFlag precedent); seeding it
// keeps the switch visible in the admin console from day one.
export async function seedFeatureFlags() {
  await db.featureFlag.upsert({
    where: { key: "discover" },
    update: {},
    create: { key: "discover", enabled: true },
  });
}
