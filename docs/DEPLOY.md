# Container Deployment & Operations (D31 / D65)

GLaDOS runs as two container services built from the same repository (`Dockerfile`):

1. **web** (`npm run start`): serves the Next.js app and API routes (`healthcheckPath = "/api/health"`).
2. **worker** (`npm run worker`): persistent `pg-boss` queue worker (`scripts/worker.ts`). Registers queue processors (`decay_sweep`, `github_import`, `resume_render`) and owns the in-DB `pg-boss` cron schedule (`0 3 * * *` UTC) for the nightly decay sweep.
   - The HTTP route `GET /api/cron/decay` (`Authorization: Bearer <CRON_SECRET>`) remains active as a manual backstop (`[D65]`).

## Platform & Student Pack Coverage (`[D31]`, `[D43]`, `[D65]`)

- **Primary target:** Railway (two services sharing one project environment and pointing at the same GitHub repo: `web` uses `npm run start`, `worker` overrides start command to `npm run worker`).
- **Fallback target:** Render (one Web Service + one Background Worker using the same `Dockerfile`).
- **Cost & Student Pack notes (`[D43]`):**
  - Railway's Hobby/Student tier and Render's worker tier fall in the **~$5/mo fixed server cost class** (`economics.fixedServerCostUsd = 5.00` seeded in `Config` for the admin economics dashboard).
  - Neon Free Tier (0.5 GB storage, pooled `-pooler` connection endpoint) and Clerk Free Tier (50k MAU) remain $0/mo at ramp stages 1-2.
  - Cloudflare R2 free tier covers 10 GB storage + zero egress (`[D64]`).

## Environment Variable Parity

Both `web` and `worker` containers require the same environment variables:

| Variable                            | Purpose                                                                             | Required in     |
| ----------------------------------- | ----------------------------------------------------------------------------------- | --------------- |
| `DATABASE_URL`                      | Neon pooled Postgres connection string (`-pooler` host)                             | `web`, `worker` |
| `GATEWAY_KEK`                       | AES-256-GCM key-encryption key for BYO credentials (`[D26]`)                        | `web`, `worker` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk client key (`[D35]`)                                                          | `web`           |
| `CLERK_SECRET_KEY`                  | Clerk server secret (`[D35]`, incl. GitHub OAuth token fetch `[D45]`)               | `web`, `worker` |
| `CLERK_WEBHOOK_SECRET`              | Svix webhook verification secret                                                    | `web`           |
| `CRON_SECRET`                       | Bearer secret for manual `/api/cron/decay` trigger                                  | `web`           |
| `PLATFORM_ATRIA_DAWN_API_KEY`       | Platform AI route key (`atria-dawn`)                                                | `web`, `worker` |
| `PLATFORM_GOOGLE_API_KEY`           | Platform AI route key (`google`)                                                    | `web`, `worker` |
| `PLATFORM_OPENROUTER_API_KEY`       | Platform AI route key (`openrouter`)                                                | `web`, `worker` |
| `R2_ENDPOINT`                       | Cloudflare R2 S3-compatible endpoint (`https://<account>.r2.cloudflarestorage.com`) | `web`, `worker` |
| `R2_BUCKET`                         | Private R2 bucket name                                                              | `web`, `worker` |
| `R2_ACCESS_KEY_ID`                  | R2 API token access key ID                                                          | `web`, `worker` |
| `R2_SECRET_ACCESS_KEY`              | R2 API token secret access key                                                      | `web`, `worker` |
| `IP_HASH_PEPPER`                    | Secret pepper for anonymous scanner IP hashing (`[D60]`)                            | `web`           |

## Preview & Dev Deploy Story (`[D32]`)

- **Local dev:** `npm run dev:db` runs embedded Postgres on `:5433` (`.pgdata/dev`); `npm run dev` starts Next.js; `npm run worker` starts the local `pg-boss` worker against the same DB.
- **Preview environments:** Create a Neon database branch per PR/preview environment (`neon branches create`) and point the preview service's `DATABASE_URL` at the branched `-pooler` endpoint so schema and queue tests never touch production state.

## Public Surface Rename Gate (`OQ7` / `[D51]`)

- `/scanner` is the first public-facing attractor surface (`[D51]`).
- **GLaDOS is an internal codename only (Valve trademark).** In-repo and private friend-cohort testing (`[D7]` stage 1) may use the codename, but the **OQ7 rename checklist in `docs/DECISIONS.md` MUST fire before any public marketing, custom domain purchase, or public link sharing of `/scanner`.**
