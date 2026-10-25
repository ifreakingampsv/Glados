# S3a hands-on walkthrough — the OSS shelf + Discover

Do this on the dev machine, in order. Expected output is written for each
step. Time: ~20–30 min (the live-GitHub steps need a read-only token).

## 0. prerequisites

```bash
npm run dev:db        # local Postgres on :5433 (skip if already up)
npm run db:push       # adds the 6 S3a models (Repo, memberships, annotation, picks, impressions, Note)
npm run db:seed       # adds the discover.* config rows + repo_annotate routes + the discover flag
```

**Expected:** seed prints `54 active skills, 54 config rows, 19 routes, flags on`.

**Optional but recommended for the real experience:** create a read-only
GitHub token (github.com → Settings → Developer settings → Personal access
tokens → fine-grained, NO scopes needed — public data only) and put it in
`.env` as `GH_DISCOVERY_TOKEN=github_pat_...`. Without it the night job
skips gracefully (`no-token`) and step 1 below uses the empty state instead.

## 1. the night job (fills the shelf)

```bash
npm run worker
```

**Expected:** `[worker] pg-boss worker started and schedules registered.`
The schedules are nightly 02:00 UTC (`shelf_nightly`) and Monday 04:30 UTC
(`shelf_lists`), so nothing runs on its own during the walk. To run the
pipeline NOW, in a second terminal:

```bash
cat > scripts/__walk.ts << 'EOF'
import { runNightlyPipeline } from "@/services/shelf-pipeline";
async function main() {
  const res = await runNightlyPipeline();
  console.log(JSON.stringify(res, null, 2).slice(0, 2000));
  process.exit(0);
}
main();
EOF
npx tsx scripts/__walk.ts; rm scripts/__walk.ts
```

**With token:** expect `{ grid: { queries: ~200, upserted: N }, enrich: …,
scoring: …, annotations: { annotated: ≤40 } }` — takes a few minutes (paced
API calls). **Without token:** expect `{ skipped: "no-token" }`.

## 2. the Discover page

Sign in (test account or your dev user) → **Discover** in the top nav.

- **Expected (with spine data):** "Matched for you" shows up to 5 cards. Each
  card: repo name linking to GitHub, ★ stars · band · language · lane
  (curated list / vouched by N lists / hidden gem), fit lines like
  `matches your evidenced TypeScript` and `fits your AI / LLM engineer
target`, a **stretch** line when the repo is one level above you.
- **Expected (new/empty account):** a yellow fallback banner — "Showing the
  global top shelf — add skills or a target role" — and the page is never a
  dead blank.
- Click **"Why it's worth rebuilding"** on an annotated card → why-memorable,
  3–5 modification ideas, what you'd learn. (Only repos the annotator
  reached have this; the long tail is statistically scored, D92.)

## 3. gaps toggle + archetype chips

- Click **"Aim at my gaps"** → the toggle flips, cards re-rank toward repos
  teaching skills you lack (`teaches you new skills: …`). Reload the page —
  the choice persisted (D73 pattern). Flip back.
- Click an archetype chip (e.g. **Data engineer**) → it highlights and the
  match skews to that archetype; explicit pick beats title inference. Click
  again to deselect.

## 4. flagship handoff + note

- On a card, click **"Deep-dive this in your AI"** → button changes to
  "Copied — paste it into your AI". Paste anywhere: the prompt is pre-filled
  with the repo name and YOUR skill names (deterministic template, D95).
- (Optional) run that prompt in your own AI, copy the result.
- Scroll to **"Save a flagship brief"**, pick the repo in the dropdown, paste
  the brief, **Save note**. Expand **"Your notes"** → the brief is there.

## 5. picks (the study list)

- On a card: **"Consider rebuilding"** → button row becomes
  Considering | Started building | Drop.
- Click **"Started building"** → status advances. **Drop** → the card's pick
  controls disappear (the pick row is kept, status dropped).
- **Expected:** nowhere in this flow do skill levels or the events page
  change — picks are product data, never evidence (D94). Check
  Skills → your levels are untouched after all of section 4–5.

## 6. browse the shelf

Below the fold: **Browse the shelf** with filters — All · Curated lists ·
Hidden gems · underrated/solid/established bands. **Expected:** lists of
repos with ★ + score, paginated 20/page.

## 7. admin readouts

**Admin** page (admin account) → scroll to **"Discover shelf (S3a)"**.

- Card CTR table — hidden until a repo has ≥50 impressions (D77 minimums),
  so "Not enough impressions yet" is the expected first state.
- **Top unmatched topics** — appears once enrichment has run against a real
  token; each `topic × count` line is a candidate alias to add deliberately.

## 8. MCP door (optional)

With an API token (Settings → API tokens), point any MCP client (or curl)
at `/api/mcp` and call `tools/list`.

**Expected:** SIX tools, ending with `get_rebuild_shortlist`. Call it with
`{}` → JSON cards (repo, url, lane, why, stretch, annotation) — read-only,
no writes to your spine. The SKILL.md (skills/glados-interview) documents it.

## 9. the kill switch

Flip the `discover` feature flag off (Prisma Studio → FeatureFlag) →
/discover match still renders (page-level), but the MCP tool returns
`{ disabled: true }` and both scheduled jobs no-op. Flip it back on.

## What is deliberately NOT here

- No anonymous /discover (the scanner owns the attractor lane, D95).
- No guided rebuild / pick→project promotion — that's S3b's door (D94).
- No contribution lane — parked for the S3b design chat (§5).
- Annotations never reorder the shelf; ranking is 100% deterministic (D92).
