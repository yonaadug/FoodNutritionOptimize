# TODO

Backlog from the November 2026 repo review (data, engine/API, UX, platform, AWS, roadmap).
Items are deduplicated and grouped by area. **P0** = do before anything public, **P1** = next, **P2** = later.
Feature work is specified in [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md). This file only links to it.

## Waiting on a decision

- [ ] **USDA data updates with admin approval and change tracking.** Design is pending one choice: approve on a
      page of the website (needs an admin login), or email + GitHub pull request (free, history built in).
      Foods are matched across USDA releases by NDB number, because USDA gives updated foods new FDC IDs.
- [ ] **Stripe subscriptions.** The plan is done ([docs/STRIPE_PLAN.md](docs/STRIPE_PLAN.md)) and sign-in now exists.
      Before building, decide what Plus unlocks first and the trial style. Local dev currently uses LIVE keys
      (`STRIPE_MODE=live`); switch to `test` before trying Checkout.
- [ ] **Real AI for recipes (owner: AWS account steps).** No live Claude call has succeeded. Diagnosed 2026-11-13
      ([docs/BEDROCK_SETUP.md](docs/BEDROCK_SETUP.md)): the account's applied Bedrock quota is **0** for every
      Claude 5.x model (AWS default 6–30M tokens/min) and no Marketplace agreement exists. IAM, region and SCPs are
      fine. The 404 for Haiku 5.5 was a code bug, now fixed (profile IDs go to bedrock-runtime). To do, in order:
      submit the Anthropic use-case form, create the Haiku 5.5 agreement, request quota `L-47520EB7` > 0 (or open a
      support case), then test with `AI_MODEL=us.anthropic.claude-haiku-5-5` (about $0.0008 a photo; Opus, the code
      default, is ~40x). Evaluate Haiku on 20–50 real recipe photos before relying on it. If AWS won't enable
      Claude, Amazon Nova 2 Lite works on the account today but needs a new provider (decide; spec in the doc).
      Also: the local `aws` CLI is an Intel build that can't run on this Mac (`brew install awscli`).
- [ ] **Arsenic reference for the rice meter.** EPA 2025 (current default) reads brown rice at about 220% per cup, and
      ATSDR 2007 at about 44%. It's one edit to `is_default` in `data/contaminants/reference_values.tsv`, plus a rebuild.
- [ ] **Old `feat/*` branches and worktrees** (`feat/food-search`, `feat/recipe-analyzer`, `feat/accounts`,
      `feat/contaminants`, under `.claude/worktrees/feat-*`). Another session's parallel attempt at the same features,
      with uncommitted work. Not merged and not used. Keep anything from them, or delete them.

## P0: owner actions

- [ ] **Check the NanoNutrition name, then choose and register a domain.** nanonutrition.com is taken (since 2001).
      The code uses nanonutrition.app as a working default; it, .io, .co and getnanonutrition.com showed no
      registration on 2026-11-13. A pending US application for "NANONUTRITION LIVE" (serial 99606776, classes 41/42,
      nutrition education and publishing) was found via a third-party database and isn't confirmed. Check it at
      tmsearch.uspto.gov and with a trademark attorney first ([docs/aws/DOMAIN.md](docs/aws/DOMAIN.md)).
- [ ] **Rename leftovers outside the code:** retake the walkthrough screenshots (headers still say Micronutrient
      Diary), and rename any Stripe product, sandbox or branding already created under the old name. The local folder
      `~/Library/Application Support/Micronutrient Diary` (old desktop app caches) can be deleted.
- [ ] **Desktop app forgets saved plans on restart:** it serves the site on a random port each launch, and browser
      storage is per port. Use a fixed port or a custom protocol.

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

## P1: new features (food search, contaminants, recipes, accounts)

- [ ] **Before accounts go public (legal):** recorded consent, an age statement, privacy policy and terms don't exist
      yet and need legal review. Pregnancy, weight and diet data count as health data (FTC rule, Washington MHMDA).
- [ ] **Before `/recipes` goes public on a paid AI provider:** per-user quotas and a global spend cap (§3.7 of the AWS
      design) plus an AWS Budget. Today's rate limits are in-memory, per server instance. Claude on Bedrock bills as
      AWS Marketplace charges, so a budget filtered to "Amazon Bedrock" misses it. The CDK kill switch now also
      denies Bedrock to the web role ([docs/BEDROCK_SETUP.md §6](docs/BEDROCK_SETUP.md#6-spend-controls)).
      Bedrock compiles a strict tool schema on first use (up to ~90 s, cached 24 h): check whether the first call
      after deploy times out at `AI_TIMEOUT_MS=20000`, and add a warm-up if it does.
- [ ] **Contaminants, license:** Milne 2024 microplastics data is CC BY-NC-ND and paid features are planned. Get a
      review or remove those rows.
- [ ] **Contaminants, data gaps:**
  - Microplastics are coarse (canned tuna uses an Alaska pollock figure shared across about 200 seafood items).
  - Dark chocolate reads High from one cocoa powder sample.
  - Many TDS foods have only 3 samples; fresh strawberry and spinach pesticide data is from 2016.
  - FDA FY2021-22 results are dashboard-only, and TDS pesticide data isn't published yet. Re-check periodically.
- [ ] **Plan balance:** the sample day is about 49% fat (nuts and seeds), and the FDA preset leans on greens
      (255 g spinach, 2,270 mcg vitamin K), because the planner picks the fewest calories that meet every goal. Consider
      a macro-range goal for total fat in the presets, or a realistic-mix objective.
- [ ] **Plans don't warn about contaminants:** they link to each food's page, but don't flag a High contaminant food.
- [ ] **8 KB history cap:** a recipe or plan over it (roughly 10+ recipes in a plan) keeps only its summary and can't
      reopen on another device.
- [ ] **Sign-in timing glitch:** if `/api/me` takes over 0.8 s, a new recipe saves to history but can still show the
      "made before you signed in" banner.
- [ ] **Remaining rough edges:** see the checklist in [docs/WEBSITE_WALKTHROUGH.md](docs/WEBSITE_WALKTHROUGH.md).
      M10 (privacy and terms pages) needs legal review, and L5, L10, L11–14 and L16 are still open.
- [ ] **Recipes, not built:** import by URL, cooking-loss adjustment, the Claude Platform on AWS provider, refusal
      fallback on Bedrock. HEIC photos are rejected outside Safari (the error now says to send a JPEG).
- [ ] **Desktop app** shows "Sign in", which leads to "isn't available" in a packaged build. Needs a build flag.
- [ ] **Food pages** have no CDN cache headers, so every view hits Lambda. Add CloudFront caching before launch.
- [ ] **Not tested on real services:** DynamoDB (emulator only), SES email, Google sign-in, CloudFront.
- [ ] Rebuild the contaminant extract once with `--download`. The PDP extract step last ran before a small refactor of
      its `main()`.

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
