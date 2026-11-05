# TODO

Backlog from the November 2026 repo review (data, engine/API, UX, platform, AWS, roadmap).
Items are deduplicated and grouped by area. **P0** = do before anything public, **P1** = next, **P2** = later.
Feature work is specified in [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md). This file only links to it.

## Waiting on a decision

- [ ] **USDA data updates with admin approval and change tracking.** Design is pending one choice: approve on a
      page of the website (needs an admin login), or email + GitHub pull request (free, history built in).
      Foods are matched across USDA releases by NDB number, because USDA gives updated foods new FDC IDs.
- [ ] **Stripe subscriptions.** The plan is done ([docs/STRIPE_PLAN.md](docs/STRIPE_PLAN.md)). Before building, decide:
      what Plus unlocks first, the trial style, and the sign-in method. Local dev currently uses LIVE keys
      (`STRIPE_MODE=live`); switch to `test` before trying Checkout.

## P0: owner actions

- [ ] **Register micronutrientdiary.com.** It was unregistered as of 2026-11-04. Route 53 is $16/yr, Porkbun $11.81/yr
      ([docs/aws/DOMAIN.md](docs/aws/DOMAIN.md)). Run a USPTO search for "Micronutrient Diary" first. The name is
      descriptive, so conflict risk is low, but it may be hard to register as a trademark.

- [ ] **Rotate the USDA FoodData Central API key** that was committed in `ece4cbb8`
      (`scripts/check_portions.py`, since deleted). That commit is on GitHub, so treat the key as public.
      Get a new key at https://fdc.nal.usda.gov/api-key-signup.html and keep it in `config/api_keys.txt`
      or `USDA_API_KEY`, both gitignored. Optional: purge it from history with `git filter-repo` plus a
      force-push. That rewrites history for every clone, so it's your call.
- [ ] **Push and confirm CI is green on GitHub.** Nothing has been pushed. `git push` also uploads the
      new ~7 MB LFS database. Watch the first `ci.yml` run, which needs the LFS checkout.
- [ ] **Delete stale local files** outside git: `data/nutrition_download.db` (unreferenced old DB copy),
      plus the agent worktrees under `.claude/worktrees/` once you no longer need them
      (`git worktree list`; their branches are merged into `main`).

## P1: product and UX

- [ ] **Personalized targets.** Defaults are FDA *label* Daily Values (e.g. potassium 4,700 mg, iron 18 mg),
      the highest adult values, which over-constrain most people. Build a profile (age, sex, weight,
      activity, pregnancy) → DRI targets. Roadmap #1. Check DRI table licensing (National Academies copyright)
      before redistributing a compiled table.
- [ ] **Cost objective.** It isn't implemented: the optimizer always minimizes calories, and there is no price
      data. Add seed prices (USDA ERS) plus user overrides. Roadmap #2. Ship realistic-portion guards first:
      cost-minimized diets collapse onto a few foods.
- [x] ~~**Better "Best sources of…" and infeasibility suggestions.**~~ Fixed in the polish pass: ranked per realistic serving, specialty items last, never empty.
- [x] Walkthrough rough edges fixed in the Nov 2026 polish pass: the upper-limits count, real portion controls,
      everyday "Good sources", honest missing-data totals (≥ / "could be over"), unused-food explanations, feedback
      toasts, plans remembered across reloads, and 14 polish items. See
      [docs/WEBSITE_WALKTHROUGH.md §16](docs/WEBSITE_WALKTHROUGH.md#16-rough-edges-noticed-while-touring).
- [ ] Polish leftovers:
  - The sample plan is about 43% fat (nuts and seeds).
  - Raw almonds have no household amount.
  - "lentils" ranks dry before cooked.
  - At 1440×900 the last goals setting sits under the bottom bar.
  - Some iron suggestions are plain (baked beans with pork).
- [ ] **Structured diagnostics.** Return `issues: [{nutrient, kind: 'short'|'excess', amount}]` from
      `/api/optimize` for every unmet goal. The UI currently parses `message`, which lists at most 5.
      The UI already uses `issues` if it's present.
- [ ] **Minimum meaningful portion.** Avoid plans with 4 g of a food: allow either 0 or at least X g,
      using a binary variable or a two-pass solve.
- [ ] **Missing-data warnings show on most plans.** Foundation foods are sparse (vitamin D is reported for ~20%).
      Options: factor data completeness into search ranking, offer the equivalent SR Legacy row, or fill gaps
      from the superseded SR row with provenance.
- [ ] **Household serving labels** are heuristic and some read oddly ("≈ 12½ cups, pieces of ~1\"").
- [ ] **Save multiple plans/days; print, share and export (CSV).** Roadmap "Now" phase.
- [ ] **Carbohydrate default minimum** is the 275 g DV. Consider the 130 g RDA in the Everyday essentials preset.
- [ ] **Dedupe near-identical Foundation rows** (e.g. "Peanut butter, creamy" vs "Peanut butter, Creamy").

## P1: launch (see [docs/aws/AWS_HOSTING_DESIGN.md](docs/aws/AWS_HOSTING_DESIGN.md))

- [ ] Verify the design's unverified assumptions before building:
  - Lambda arm64 price
  - OpenNext support for Next 16
  - CloudFront flat-rate plan eligibility for a CDK-created distribution
  - IAM and spend limits for Claude Platform on AWS
  - Competitor prices (mostly third-party sources)
- [ ] Build better-sqlite3 for the deploy target. Prebuilt binaries match the build OS and CPU, so use a Linux
      arm64 container image for Lambda. The example is `docs/aws/infra-example/Dockerfile.lambda` (untested).
- [ ] App changes from the design:
  - Auth middleware (Cognito)
  - A local-first store with a sync API, replacing localStorage-only state
  - Stripe Checkout, Customer Portal and a webhook worker → entitlements
  - AI import job API and worker with per-user quotas and a global spend breaker
  - Account export and delete
  - Origin access control: `x-amz-content-sha256` on POST bodies, auth token in `X-Auth-Token`
- [ ] Legal and compliance:
  - Privacy policy, terms and medical disclaimer
  - Washington MHMDA consent and a consumer health data policy
  - No ad or analytics pixels on health data (FTC Health Breach Notification Rule)

## P1: platform and code quality

- [ ] Enable `eslint-config-next/typescript` rules. There are about 44 `any` / ts-comment errors in `lib/` and `types/`.
- [ ] Add API route tests for `lib/api.ts` (today only the CI smoke test covers it).
- [ ] Wire `python3 -I scripts/verify_data_integrity.py --skip-raw` into CI.
- [ ] Electron: macOS signing and notarization, a release workflow with per-arch runners, and CSP nonces to
      drop `'unsafe-inline'`.

- [ ] Re-check **ESLint 10** and **TypeScript 7** for the web app. Both are held back because eslint-config-next's plugins
      and typescript-eslint don't support them yet. The CDK example already uses TypeScript 7.
- [ ] Compare **AWS Lambda Web Functions** (launched Oct 2026; the Lambda Web Adapter README now recommends them for
      new Node apps) against the current Lambda + Web Adapter design before deploying.
- [ ] Test the real Lambda invoke path in a dev AWS account. The local Runtime Interface Emulator run was blocked,
      but the container itself was tested with `make lambda-local`. The AI-worker and Stripe-webhook handlers in
      `docs/aws/infra-example/cdk/workers/` are placeholders.

## P2

- [ ] **Data:**
  - Review USDA anomalies (e.g. SR 173174 SlimFast lists manganese at 269 mg).
  - Add added sugars (FPED).
  - Switch Foundation ingestion back to CSV once USDA ships a complete CSV release.
  - Re-check FDC releases each April and October (update `SOURCES` in `scripts/build_db.py`).
- [ ] **UX:**
  - Highlight differences in the comparison view.
  - Group plans into meals.
  - Run automated accessibility checks (axe) in CI.
- [ ] **Platform:**
  - Self-host the Inter font (`next/font/google` needs network at build time).
  - Add a Windows `.ico`, auto-update and Dependabot.
  - Fix the 16 moderate dev-only `npm audit` findings (minimatch via typescript-eslint).
- [ ] **Solver:** evaluate javascript-lp-solver 1.x or HiGHS (WASM) before the week planner, which needs integer
      and variety constraints.
- [ ] **Repo:** `screenshots/` shows the old UI and is no longer referenced (the README uses `docs/ux/after-*.png`).
      Replace or remove it. Decide whether `graphify-out/` should be gitignored.
