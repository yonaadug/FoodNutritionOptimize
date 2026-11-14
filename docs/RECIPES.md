# Recipe analyzer

`/recipes` works out the nutrition per serving of a pasted recipe or a photo, and lets the user correct it. The research behind these choices is in [research/RECIPE_ANALYSIS.md](research/RECIPE_ANALYSIS.md).

Photos of plated food (open models, photo APIs, Bedrock options and portion aids) are compared in [research/FOOD_PHOTO_OPTIONS.md](research/FOOD_PHOTO_OPTIONS.md).

> **Status.** It works end to end on the offline `mock` provider, and **on Bedrock through the Amazon Nova 2 Lite fallback** (three live calls on 2026-11-14, below). **Claude has never run against a live model**: the project's AWS account can't invoke it yet (quota 0; an increase is requested), and no API key was available. With the default settings Claude takes over by itself once AWS enables it. **[BEDROCK_SETUP.md](BEDROCK_SETUP.md) has the diagnosis, the owner steps, the model choice and the IAM policy.** Follow [the check below](#3-check-it-works) the first time you enable one.

## How it works

```
pasted text ──► built-in reader (parse.ts + match.ts), free ──sure──► ingredients, no AI
                     │ unsure (lib/recipes/confidence.ts)
                     ▼
photo ─────────────► lib/ai/router.ts: Claude Haiku 5.5
                       ├─ plated food, or a failed read ──► Claude Sonnet 5.5
                       └─ Claude unavailable ─────────────► Amazon Nova 2 Lite
                     ▼
ingredients: name, quantity, unit, preparation, notes, confidence
   │  lib/recipes/match.ts: USDA full-text search, re-scored for recipes
   │  lib/recipes/grams.ts: quantity + unit to grams
   ▼
editable rows in the browser ──► live totals (lib/recipes/nutrition.ts)
```

**The model only reads.** It never supplies nutrient values or food ids. All nutrition comes from the USDA database, and the optional re-rank can only choose among candidates we offer.

**Grams** are marked on each row:

| Mark | Meaning | Example |
|---|---|---|
| `exact` | Mass units, or a USDA portion for this food | `1 cup = 125 g` |
| `estimated` | A table of typical densities and item weights. Badged in the UI | `typical density of rolled oats` |
| `unknown` | No amount, or no way to convert. Not counted, and listed in the totals | "2 heads" of lettuce, "salt to taste" |

**Missing data.** A nutrient total built from any ingredient with no value shows `≥`, because it's a lower bound. If nothing has a value it shows `—`, never 0.

**Foundation gaps.** Foundation foods are well measured but sparse, so nulls are filled from the SR Legacy food they supersede. This is now one rule for the whole site (`lib/nutrient-fill.ts`, applied in `lib/db.ts`), so a recipe, a food page, search and a plan all see the same values. Existing values are never overwritten, each food lists what was filled in `filledFrom` (nutrient column to older entry's `fdc_id`), and the page marks those values †. Household measures also come from the older entry, in recipes only.

**Limits to tell users about**, which the page already does:

- Plated-meal photos are rough. Confidence is capped at 0.6 and the page shows ±35% on calories.
- Totals add up ingredients as listed, with no adjustment for cooking losses or water.
- Photos, and pasted text the built-in reader is unsure of, go to the AI provider. Photos aren't stored, and logs hold token counts and cost only.

## Which model reads what

The owner approved this routing on 2026-11-14. The code is `lib/recipes/confidence.ts` (the text rule), `app/api/recipes/parse/route.ts` and `lib/ai/router.ts` (the models).

| Input | Read by | When |
|---|---|---|
| Pasted text | **Built-in reader**, no AI, $0 | The read passes the rule below |
| Pasted text the built-in reader is unsure of, and every photo | **Claude Haiku 5.5** (`AI_MODEL`) | Default |
| Photo of plated food | **Claude Sonnet 5.5** (`AI_ESCALATION_MODEL`) | Haiku's read says `plated_meal`. If Sonnet fails, Haiku's read is kept |
| A read that fails validation | Sonnet | Haiku replied with no tool call, a malformed recipe, or no ingredients |
| Anything, while Claude is unavailable | **Amazon Nova 2 Lite** (`AI_FALLBACK_MODEL`, Bedrock only) | Claude returned access denied, not found, a quota or throttling error, or an outage. Claude is then skipped for 10 minutes (60 s after throttling) on that server instance and tried again, so it takes over by itself once AWS enables it |

Timeouts, refusals, "not food" and rejected requests are not retried on another model. Every read, whichever model made it, goes through the same validator (`lib/ai/schema.ts`), and the page treats it the same way: the user checks every ingredient. **Nova's accuracy on recipes hasn't been measured.** Turn any tier off with `off`, for example `AI_FALLBACK_MODEL=off`.

### When the built-in reader skips AI

A pasted recipe skips AI only if all of these hold (`BUILTIN_RULE` in `lib/recipes/confidence.ts`):

- at least 2 ingredients were read;
- every ingredient matched a USDA food with match confidence **≥ 0.7**, and every amount converted to grams;
- at most 20% of ingredients have no amount, not counting "to taste", "optional" and "for garnish";
- nothing looks misread: no skipped line with an amount in it, no digits or dot leaders in a food name, no weight left unused in the notes ("4 fillets (6 oz each)"), no single ingredient over 5 kg.

Otherwise the log says why (`[recipes] built-in reader unsure (weak_match,no_grams)`, rule names only) and the text goes to AI.

**Offline evaluation, no AI calls** (prints during `npm test`). 41 pasted recipes: the 12 tuning and 8 held-out recipes, each pasted in one of three layouts, plus 21 new whole pastes in `lib/recipes/fixtures-pasted.ts` (blog pages, sections, metric, and 8 messy ones: prose, one line, name-first metric, OCR slips, kitchen units, dot leaders, Spanish, steps only).

| | Recipes | Food top-1 | Grams in range | Calories in range |
|---|---|---|---|---|
| **Skip AI (built-in reader)** | **26 (63%)** | **99.5%** | **99.5%** | **26/26** |
| Sent to AI, scored on the built-in read | 15 (37%) | 64.0% | 50.6% | 6/15 |
| All 41 on the built-in reader alone | 41 | 88.0% | 83.7% | 32/41 |

All 8 messy recipes go to AI. The threshold sweep: 0.5–0.65 keeps 28 recipes at 99.0% food; **0.7 keeps 26 at 99.5%** (every wrong match seen between 0.6 and 0.7, such as green curry paste → almond paste, is sent to AI); 0.8 keeps only 22. Of the 15 sent to AI, 7 were read correctly by the built-in reader anyway (for example chocolate chips at 0.68): that's the price of caution, about $0.0004 each on Haiku.

What this doesn't show: the threshold was chosen on the same recipes it's scored on, and the tuning set also tuned the matcher, so real pastes will do somewhat worse. AI accuracy on the 37% isn't measured (no Claude access). Check the `provider=builtin` share and how much users edit those rows once it's live.

## API

All errors have the shape `{ error, code, details? }`.

| Route | Body | Returns | AI? |
|---|---|---|---|
| `POST /api/recipes/parse` | JSON `{ text }`, or multipart with an `image` file | Ingredients with matches and conversions (`ParseResponse`). `provider` is `builtin` when no AI was used, and `model` names the model that read it | Photos, and text the built-in reader is unsure of |
| `POST /api/recipes/nutrition` | `{ ingredients: [{ fdcId, grams }], servings }` | `totals` and `perServing`, each nutrient `{ value, incomplete }` | No: pure and deterministic |
| `POST /api/recipes/match` | `{ line }`, e.g. `"2 cups milk"` | One analyzed ingredient | No |
| `GET /api/recipes/food?fdcId=` | | One food with its portions and filled nutrients | No |

The picker searches with the existing `/api/search`.

`GET /api/recipes/food` and the matched foods include `filledFrom`. `/api/recipes/parse` can return 400, 413, 415, 422 (`ai_not_food`, `ai_refused`), 429 (`rate_limited`, with `Retry-After`), 502, 503 (`ai_unavailable`, `ai_busy`, `ai_rate_limited`) and 504 (`ai_timeout`).

## Saving analyses

`onRecipeAnalyzed` in `components/recipes/RecipesPage.tsx` saves each analysis to a signed-in person's history ([ACCOUNTS.md](ACCOUNTS.md)). It receives an `AnalyzedRecipe`: plain JSON with a title and a stable `id`. It runs after the first read and again after edits settle, so treat it as an upsert. The history row holds the ingredients (`lib/recipes/history.ts`), so `/recipes?id=<id>` reopens the recipe on any device. A recipe too long for the 8 KB cap drops its notes, then its ingredient list, and never keeps part of it.

Recent analyses are also kept in `localStorage` (`recipes.recent.v1`). One made before signing in has no `ownerId` and stays out of history unless its owner presses **Save to my account**. See [Data in this browser](ACCOUNTS.md#data-in-this-browser).

The open recipe is in the address (`/recipes?id=<id>`), so Back, a reload and signing in all return to it.

## Recipes in a plan

"Add a serving to my plan" adds the recipe to the planner as a fixed-amount food with a negative id, and `Food.recipe` says which recipe it is. `/api/optimize` passes unknown foods through unchanged.

- **Servings add up.** Each press adds a serving. The plan stores grams, and the serving count is worked out from them (`lib/planner-recipes.ts`).
- **Edits reach the plan.** While a recipe that's in the plan is open, its nutrition, title and serving size are copied across and the number of servings is kept. `recipe.fingerprint` is part of the plan's key, so the plan then reads as out of date.
- **Warnings carry over.** "Not counted" ingredients get their own note on the plan, and a nutrient that's only a lower bound counts as missing data, so its goal shows "≥".

## Test locally

No credentials, no cost:

```bash
cd food-nutrition-app
npm ci --ignore-scripts
AI_PROVIDER=mock npm run dev      # or leave AI_PROVIDER unset; open /recipes
npm run check                     # lint, typecheck, unit tests, build
```

On `mock`, pasted text really is read by the rule-based parser (`lib/recipes/parse.ts`), and the page says it's in demo mode. **Photos return a built-in sample, chosen by a hash of the image**, so the same image always gives the same result.

Matching accuracy prints during `npm test`. First-run held-out scores: names 100%, food top-1 96.6%, grams in range 91.5%, calories in range 8/8 recipes. See [the research doc](research/RECIPE_ANALYSIS.md#what-we-tested-ourselves) for what those do and don't show.

## Enable Bedrock

**Follow [BEDROCK_SETUP.md](BEDROCK_SETUP.md).** It covers why the account refuses Claude today and the exact console and CLI steps, the models (`us.anthropic.claude-haiku-5-5` at about $0.0008 a photo, Sonnet for plates, Nova 2 Lite as the fallback), the least-privilege IAM policy, the CDK settings and spend controls. **Nova works on the account today, so photos work as soon as `AI_PROVIDER=bedrock` is set.** In short:

### 1. Get model access

For Claude: create the Marketplace agreement for the model and get its tokens-per-minute quota raised above 0 (Service Quotas, or a support case). Submit the Anthropic use-case form too. See [BEDROCK_SETUP.md §2](BEDROCK_SETUP.md#2-fix-the-account-owner-actions). Nova needs none of this. Until Claude works, Nova reads everything AI reads.

### 2. Permissions and settings

The app role needs `bedrock:InvokeModel` on each model's inference profile and, through it, on the foundation model in each destination region ([policy](BEDROCK_SETUP.md#least-privilege-iam-policy-for-the-app-role)). No Marketplace permissions.

| Variable | Default on Bedrock |
|---|---|
| `AI_PROVIDER` | Unset (mock). Set `bedrock` |
| `AI_BEDROCK_REGION` | Your region, e.g. `us-east-1`. Falls back to `AWS_REGION`, then `AWS_DEFAULT_REGION`. `~/.aws/config` isn't read for the region |
| `AI_MODEL` | `us.anthropic.claude-haiku-5-5`. An inference profile ID (`us.`, `global.`, ...) or ARN goes to bedrock-runtime `InvokeModel`. A bare Claude ID such as `claude-opus-5-5` gets `anthropic.` added and goes to the bedrock-mantle endpoint, which doesn't serve Haiku 5.5 or Sonnet 5.5 in us-east-1. A Nova ID makes Nova the main reader. `off` turns Claude off |
| `AI_ESCALATION_MODEL` | `us.anthropic.claude-sonnet-5-5`, or `off` |
| `AI_FALLBACK_MODEL` | `us.amazon.nova-2-lite-v1:0`, or `off`. `us.amazon.nova-lite-v1:0` also works |
| `AI_BUILTIN_TEXT` | `on`. `off` sends all pasted text to AI |

Until the Claude quota is raised, the first photo on each server instance costs one refused Claude call ($0, a few hundred ms) before Nova reads it; then Claude is skipped for 10 minutes. To skip even that, set `AI_MODEL=off AI_ESCALATION_MODEL=off` and unset them once Claude works.

Credentials come from the standard AWS chain: role, environment, or `~/.aws/credentials`.

### 3. Check it works

Restart the server, then make two small requests. A clean list should need no AI:

```bash
curl -s http://127.0.0.1:3000/api/recipes/parse \
  -H 'Content-Type: application/json' \
  -d '{"text":"Garlic rice\nServes 2\n1 1/2 cups cooked white rice\n2 cloves garlic, minced\n1 tbsp olive oil\nSalt to taste"}'
```

You want `"provider":"builtin"`, four ingredients, and `[ai] provider=builtin ... cost_usd=0.00000` in the log. Prose needs AI:

```bash
curl -s http://127.0.0.1:3000/api/recipes/parse \
  -H 'Content-Type: application/json' \
  -d '{"text":"For this you will want two chicken breasts, about a cup of white rice, a head of broccoli and a splash of soy sauce."}'
```

You want `"provider":"bedrock"`. The log says why the built-in reader passed, then has one line per model call. This one is real, from Nova on 2026-11-14:

```
[recipes] built-in reader unsure (too_few_ingredients); reading with us.amazon.nova-2-lite-v1:0
[ai] provider=bedrock model=us.amazon.nova-2-lite-v1:0 kind=text ms=1235 ok=true in=1670 out=263 cost_usd=0.00127
```

While Claude's quota is 0 you'll also see `[ai] us.anthropic.claude-haiku-5-5 is unavailable (access); skipping it for 600 s, using us.amazon.nova-2-lite-v1:0` with the 403 hint above it.

| You see | It means |
|---|---|
| `"provider":"mock"` | `AI_PROVIDER` or the region isn't set. The log says which |
| `"provider":"builtin"` for text you expected AI to read | Working as intended: the built-in reader was sure. `AI_BUILTIN_TEXT=off` sends all text to AI |
| `"model":"us.amazon.nova-2-lite-v1:0"` | Claude was unavailable and Nova read it. The log line before says why |
| `503 ai_unavailable`, log says `PermissionDeniedError 403` or `NotFoundError 404` | The log line says what to check: account access (step 1) for 403, the model ID or endpoint for 404. See [BEDROCK_SETUP.md §4](BEDROCK_SETUP.md#4-photo-to-nutrition-working-locally) |
| `502 ai_bad_output` | The model replied but the request or reply was rejected. As this path is untested on a live model, a schema problem would show up here first. Look at `lib/ai/schema.ts` |

Then try a photo of a recipe card and of a plate, and compare the log's token counts with the cost table.

### Using the Claude API instead

Set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. `AI_MODEL` and `AI_ESCALATION_MODEL` work the same, without a prefix (defaults `claude-haiku-5-5` and `claude-sonnet-5-5`). There is no Nova fallback on this path. Models that support it also get the server-side refusal fallback (`fallbacks: "default"`). Bedrock doesn't offer that, so a refusal there shows a friendly error and the user can add ingredients by hand.

## Cost per read, by path

On Bedrock `us.` profiles, which cost 10% more than `global.` for Claude and Nova 2 Lite (AWS Price List and Marketplace offers; `lib/ai/cost.ts` cites them). **Claude figures are estimates** (no live Claude call has succeeded): a photo is about 3,550 input and 800 output tokens, text about 1,500 and 300. **Nova figures are measured** on this account on 2026-11-14.

| Path | Model calls | Cost per read |
|---|---|---|
| Pasted text, built-in reader sure (63% of the evaluation set) | none | **$0** |
| Pasted text, unsure | Haiku | about $0.0004 |
| Photo of a recipe card | Haiku | about $0.0008 |
| Photo of plated food | Haiku, then Sonnet | about $0.018 |
| Read that fails validation | + Sonnet | + about $0.007 (text) or $0.017 (photo) |
| Anything while Claude is unavailable | Nova 2 Lite (after a refused Claude call, $0) | **$0.0013 text, $0.0017 photo (measured)** |
| `AI_FALLBACK_MODEL=us.amazon.nova-lite-v1:0` instead | Nova Lite v1 | about $0.0002 (measured 2026-11-13) |
| Before this change: Opus 5.5 for everything | Opus | about $0.04 |

So at 1,000 reads a month, half pasted text and half recipe-card photos, the bill is about $0.47 on Haiku, against about $40 on the old Opus default. Plated-food photos are the expensive path; they're also the least accurate (±35%), so they're worth watching. The optional re-rank (`AI_RERANK=1`) adds one Haiku call.

## Limits and settings

| Variable | Default | Purpose |
|---|---|---|
| `AI_RATE_LIMIT_PER_MINUTE` | 10 | Per client IP; 0 turns it off |
| `AI_RATE_LIMIT_PER_DAY` | 50 | Per client IP; 0 turns it off |
| `AI_DAILY_BUDGET_USD` | 1 | Stops calling the model at this estimated daily spend; 0 turns it off |
| `AI_MAX_IMAGE_BYTES` | 8 MB | Largest upload |
| `AI_TIMEOUT_MS`, `AI_MAX_RETRIES` | 45000, 2 | Per attempt and SDK retries. The whole request stops at 55 s |
| `AI_RERANK` | off | `1` lets the model re-rank low-confidence matches, adding one cached call. Uses `AI_MODEL` only, and is skipped while Claude is unavailable |
| `AI_BUILTIN_TEXT` | on | `off` sends all pasted text to AI. The daily budget never blocks built-in reads |
| `AI_MODEL`, `AI_ESCALATION_MODEL`, `AI_FALLBACK_MODEL` | Haiku 5.5, Sonnet 5.5, Nova 2 Lite | See [Which model reads what](#which-model-reads-what). `off` turns a tier off |

Images are shrunk to 1568 px in the browser, and again on the server for JPEGs (with `jpeg-js`; `sharp` stays out of the Lambda bundle). The server reads the type from the bytes, checks dimensions before decoding, strips EXIF (including GPS), keeps each image under 5 MB of base64 (the Bedrock limit), and tells HEIC uploads to send a JPEG.

## Before going public on a paid provider

- **These limits are per server instance, in memory.** On Lambda each instance counts separately and resets on a cold start. They're a speed bump. Add the DynamoDB quotas in `AWS_HOSTING_DESIGN.md` §3.7 and an AWS Budget.
- **`/recipes` has no sign-in.** The roadmap puts photo imports behind accounts.
- **Requests are synchronous**, not the queued flow §3.7 sketches. That's fine for a single short model call, but check it against your CloudFront and Lambda timeouts.
- **Run an evaluation** on real recipes and weighed meals before promising accuracy, including Nova's reads (unmeasured beyond the 2026-11-14 smoke test) and Haiku's on plates.
