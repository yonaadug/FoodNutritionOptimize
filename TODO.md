# TODO

Backlog from the November 2026 repo review (data, engine/API, UX, platform, AWS, roadmap).
Items are deduplicated and grouped by area. **P0** = do before anything public, **P1** = next, **P2** = later.
Feature work is specified in [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md). This file only links to it.

## Waiting on a decision

- [ ] **USDA data updates with admin approval and change tracking.** Design is pending one choice: approve on a
      page of the website (needs an admin login), or email + GitHub pull request (free, history built in).
      Foods are matched across USDA releases by NDB number, because USDA gives updated foods new FDC IDs.
- [ ] **Plus and Stripe (owner: set up the sandbox, then try it).** Built 2026-11-14 and tested with a fake Stripe client
      only; nothing has called Stripe yet ([docs/STRIPE_PLAN.md §7](docs/STRIPE_PLAN.md#7-testing-locally-no-real-money)).
      Create the product, both prices, the portal settings and a webhook in the sandbox, set `STRIPE_MODE=test` with
      the `STRIPE_TEST_*` values, and run one Checkout with `4242 4242 4242 4242` under `stripe listen`. Live keys are
      refused unless `NODE_ENV=production` and `STRIPE_ALLOW_LIVE=1`, so the live keys in `.env.local` can't charge anyone.
      Still open: the week planner and plan contaminant check need wrapping in `<PlusGate>` once they land, the
      privacy policy must mention that Stripe keeps invoices after an account is deleted, and the EU/UK VAT choice
      (AWS design §3.6).
- [ ] **Real AI for recipes (owner: deploy it).** Since 2026-11-15 the code reads with **Google Gemma 3 27B on
      Bedrock, falling back to Amazon Nova Lite v1**, with no Claude
      ([docs/RECIPES.md](docs/RECIPES.md#which-model-reads-what)): pasted text is read by the free built-in reader
      first (63% of the offline evaluation set needs no AI, at 99.5% food top-1), photos (plated food included) and
      unsure text go to Gemma (about $0.00025 a photo, $0.00017 a text read), and Nova Lite takes over when Gemma
      errors, times out or fails validation. Both work on the dev account now, with no agreement or quota request
      (live check 2026-11-15, under $0.0005). To turn it on locally: set `AI_PROVIDER=bedrock` and
      `AI_BEDROCK_REGION=us-east-1` (credentials from `~/.aws`). On AWS: deploy the CDK example, which grants only
      these two models. **The pending Claude quota request (`L-47520EB7`), use-case form and Haiku 5.5 agreement
      aren't needed any more**; Claude stays supported if the owner switches back
      ([docs/BEDROCK_SETUP.md](docs/BEDROCK_SETUP.md)). Then: evaluate Gemma on 20–50 real recipe photos (phone
      photos, handwriting, plated food; the benchmark used rendered cards only) before relying on it; compare the
      first bill with the logs (Bedrock seems to under-count Gemma's input tokens); watch the `provider=builtin`
      share and how often users edit those rows. Also: the local `aws` CLI is an Intel build that can't run on this
      Mac (`brew install awscli`).
- [ ] **Arsenic reference for the rice meter.** EPA 2025 (current default) reads brown rice at about 220% per cup, and
      ATSDR 2007 at about 44%. It's one edit to `is_default` in `data/contaminants/reference_values.tsv`, plus a rebuild.
- [ ] **Old `feat/*` branches and worktrees** (`feat/food-search`, `feat/recipe-analyzer`, `feat/accounts`,
      `feat/contaminants`, under `.claude/worktrees/feat-*`). Another session's parallel attempt at the same features,
      with uncommitted work. Not merged and not used. Keep anything from them, or delete them.

## P0: owner actions

- [ ] **Register nutritiondictionary.com.** Available on 2026-11-14 (Route 53 confirmed): $16/yr at Route 53, $11.81 at
      Porkbun. The name is NutritionDictionary. No exact-match app, site or US trademark was found, but the name is
      descriptive, so it may be hard to register as your own trademark. Details in [docs/aws/DOMAIN.md](docs/aws/DOMAIN.md).
      Then follow [docs/DEPLOY.md](docs/DEPLOY.md), the AWS runbook (accounts, DNS, SES, Google, first deploys).
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

- [ ] **Before accounts go public (legal):** drafts of the privacy policy, consumer health data policy and terms
      (`/privacy`, `/health-data-privacy`, `/terms`), recorded consent and an age statement at sign-in are built and
      **need a lawyer's review**. See [docs/LEGAL.md](docs/LEGAL.md) for the questions, the placeholders the owner must
      fill (`lib/legal.ts`), the `privacy@nutritiondictionary.com` mailbox to set up, and when to turn `LEGAL_DRAFT` off.
- [ ] **Before `/recipes` goes public on a paid AI provider:** a global spend cap (§3.7 of the AWS design) plus an
      AWS Budget. Per-account photo quotas are done (lib/billing/quota.ts, in the user table). The per-IP limits and
      the daily budget are still in-memory, per server instance. Gemma and Nova bill as "Amazon Bedrock"; Claude, if
      switched back on, bills as AWS Marketplace charges, so a budget filtered to "Amazon Bedrock" would miss it. The
      CDK kill switch now also denies Bedrock to the web role
      ([docs/BEDROCK_SETUP.md §6](docs/BEDROCK_SETUP.md#6-spend-controls)). After deploy, watch for Gemma timeouts
      (`timed out (limit 14000 ms)` in the logs; its photo p95 was 11.2 s): frequent ones mean Nova Lite is reading
      more than planned.
- [ ] **Contaminants, license:** Milne 2024 microplastics data is CC BY-NC-ND and paid features are planned. Get a
      review or remove those rows (question 8 in [docs/LEGAL.md](docs/LEGAL.md)).
- [ ] **Contaminants, data gaps:**
  - Microplastics are coarse (canned tuna uses an Alaska pollock figure shared across about 200 seafood items).
  - Dark chocolate reads High from one cocoa powder sample.
  - Many TDS foods have only 3 samples; fresh strawberry and spinach pesticide data is from 2016.
  - FDA FY2021-22 results are dashboard-only, and TDS pesticide data isn't published yet. Re-check periodically.
- [ ] **Plan balance:** the sample day is about 49% fat (nuts and seeds), and the FDA preset leans on greens
      (255 g spinach, 2,270 mcg vitamin K), because the planner picks the fewest calories that meet every goal. Consider
      a macro-range goal for total fat in the presets, or a realistic-mix objective.
  - **The sample day reads High for cadmium in "Contaminants in this plan": about 581% of FDA's daily reference**
    (16.8 mcg for an 80 kg adult), mostly from 255 g of spinach (about 22 mcg per 100 g, FDA TDS mean of 27 samples)
    and 85 g of sunflower seeds. The numbers are real, so trial users who try the sample day see a High warning
    straight away. Fix it with the fat limit above or the "keep contaminants low" option below, or change the sample
    day's foods; then check that the sample day reads Low or Moderate.
- [x] **Plans don't warn about contaminants:** a plan now has "Contaminants in this plan" (day and week), which
      flags the foods that push a total into elevated, with reduce, swap and leave-out
      ([walkthrough 6.5](docs/WEBSITE_WALKTHROUGH.md#65-contaminants-in-a-plan)).
- [ ] **Week planner and plan contaminants, follow-ups:**
  - ~~Plus gating~~: done 2026-11-14. Both routes use `plusRoute` and the UI uses `PlusGate`; `lib/billing/gate-wiring.test.ts` guards it.
  - The account page has no tab for history kind `week-plan` (weeks reopen from `/plan/week`).
  - "Keep contaminants low" in Set goals: add per-food contaminant amounts as optimizer rows (unknowns count as 0
    there, so the UI must say so).
  - Recipes in a plan have no contaminant data (counted as unknown); total them from their ingredients.
  - Instacart "Shop this list" needs a Developer Platform key (TODO in `lib/week-planner/grocery.ts`).
  - A week solve blocks the server's event loop for up to ~4 s (HiGHS's one-shot API is synchronous): move it
    to a worker thread before heavy traffic.
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
- [ ] **Links fetch ahead only on hover or keyboard focus** (2026-11-15, `lib/link-intent.ts`; home page 57 → 1 request).
      Watch on the live site: a phone tap on Plan, Recipes, methodology or a policy shows no skeleton, so a Lambda
      cold start would leave the old page up for a second (add skeletons if so); and each link a mouse passes over
      sends 2 requests (if WebThrottles fires again, wait for the mouse to rest ~100 ms before fetching).
- [ ] **Not tested on real services:** DynamoDB (emulator only), SES email, Google sign-in, CloudFront.
- [ ] Rebuild the contaminant extract once with `--download`. The PDP extract step last ran before a small refactor of
      its `main()`.

## P1: launch (see [docs/aws/AWS_HOSTING_DESIGN.md](docs/aws/AWS_HOSTING_DESIGN.md))

- [ ] Verify the design's unverified assumptions before building:
  - Lambda arm64 price
  - OpenNext support for Next 16
  - CloudFront flat-rate plan eligibility for a CDK-created distribution (the stack now subscribes it with
    `AWS::PricingPlanManager::Subscription`; confirm on the first dev deploy, fallback `-c flatRatePlan=false`)
  - IAM and spend limits for Claude Platform on AWS
  - Competitor prices (mostly third-party sources)
- [ ] Build better-sqlite3 for the deploy target. Prebuilt binaries match the build OS and CPU, so use a Linux
      arm64 container image for Lambda. The example is `docs/aws/infra-example/Dockerfile.lambda` (untested).
- [ ] App changes from the design:
  - ~~Auth middleware (Cognito)~~ Done with Better Auth; Cognito is removed from the CDK example
  - A local-first store with a sync API, replacing localStorage-only state
  - ~~Stripe Checkout, Customer Portal and a webhook worker → entitlements~~ (built in the web app: `app/api/stripe/*`, `lib/billing`)
  - AI import job API and worker with per-user quotas and a global spend breaker
  - Account export and delete
  - ~~**Blocks launch:** origin access control needs `x-amz-content-sha256` on every browser POST.~~ Fixed
    2026-11-14: every browser request body goes through `sameOriginFetch` (`lib/same-origin-fetch.ts`), photos are
    sent as raw bytes, and `lib/same-origin-fetch.test.ts` fails the build on any plain `fetch()` with a body
  - Emit the `NutritionDictionary/AiSpendMicroUsd` metric (Embedded Metric Format) so the `AiSpendDaily` alarm
    works. Today the app only logs `[ai] ... cost_usd=` lines, and the AWS Budget is the only AI spend alarm
- [ ] **Privacy follow-ups found while drafting the policies** (each is disclosed accurately in the drafts today):
  - Better Auth's sign-in rate limiter stores raw IPs as `KV#<ip>|<path>` keys for up to 300 s, while ACCOUNTS.md says
    no raw IPs are kept. Store a keyed hash (e.g. HMAC with `AUTH_SECRET`, as `lib/auth/log.ts` does) instead.
  - Google sign-in tokens are stored without app-level encryption (DynamoDB still encrypts at rest). Turn on Better
    Auth's OAuth token encryption, or don't keep tokens, since sign-in needs only the identity.
  - The recipe reader's in-memory rate limiter keeps raw IPs for up to 24 hours; hash those too.
- [ ] **Plus follow-ups:**
  - No real Stripe round trip has run. Test Checkout, the portal and the webhook in Stripe test mode
    ([docs/STRIPE_PLAN.md](docs/STRIPE_PLAN.md) §7) before taking money.
  - The privacy policy and terms should say that deleting an account cancels the subscription without a refund and that
    Stripe keeps the customer record and invoices (add to the lawyer's list in docs/LEGAL.md).
  - EU/UK VAT approach is undecided (Stripe Tax threshold monitoring, or Managed Payments).
  - "Unlimited" history is capped at 500 items per kind by the existing abuse limit; say so or raise it.
- [ ] **Flaky test:** `lib/auth/account-api.test.ts` "rate-limits per user" failed 1 run in 4 under load (dynalite).
- [ ] **AI after a deploy:** right after a deploy that changes the web role's Bedrock permissions, IAM can take a minute
      to apply. The first AI read then gets AccessDenied, and `lib/ai/router.ts` marks the model unavailable for 600 s
      on that Lambda instance, so photo reading is off for up to 10 minutes (seen on prod, 2026-11-15). Use a short
      cooldown (e.g. 60 s) for access errors, or retry once after a few seconds before cooling down.
- [ ] **Gemma's cold start:** the first Gemma call on dev timed out at 14 s and fell back to Nova Lite; warm calls took
      4 to 8 s. Watch `[ai] ... ms=` in the logs; if timeouts are common, lower `AI_TIMEOUT_MS` so the fallback answers
      sooner, or make Nova Lite primary for text.
- [ ] Legal and compliance ([docs/LEGAL.md](docs/LEGAL.md)):
  - Privacy policy, terms and medical disclaimer: drafted, awaiting legal review
  - Washington MHMDA consent and a consumer health data policy: drafted and recorded at sign-in, awaiting review
  - No ad or analytics pixels on health data (FTC Health Breach Notification Rule)
  - Auto-renewal disclosure and consent on the Plus checkout page (checklist on `/terms`)

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
      but the container itself was tested with `make lambda-local`. The AI-worker handler in
      `docs/aws/infra-example/cdk/workers/` is a placeholder; the Stripe webhook runs the app's own route.

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
- [x] **Solver:** the week planner uses HiGHS 1.15.4 (WASM); javascript-lp-solver didn't finish a 20-food week in
      200 s and ignored its timeout. The day planner stays on javascript-lp-solver.
- [ ] **Repo:** `screenshots/` shows the old UI and is no longer referenced (the README uses `docs/ux/after-*.png`).
      Replace or remove it. Decide whether `graphify-out/` should be gitignored.
