# Recipe analyzer

`/recipes` works out the nutrition per serving of a pasted recipe or a photo, and lets the user correct it. The research behind these choices is in [research/RECIPE_ANALYSIS.md](research/RECIPE_ANALYSIS.md).

Photos of plated food (open models, photo APIs, Bedrock options and portion aids) are compared in [research/FOOD_PHOTO_OPTIONS.md](research/FOOD_PHOTO_OPTIONS.md).

> **Status.** It works end to end on the offline `mock` provider, and **on Bedrock with Google Gemma 3 27B as the reader and Amazon Nova Lite v1 as the fallback** (the owner's choice on 2026-11-15, after the [cheaper-models benchmark](research/CHEAPER_MODELS.md); live check below). **Claude is no longer a default anywhere.** The code still supports it, so the owner can switch back with the `AI_*` variables and an IAM change ([BEDROCK_SETUP.md](BEDROCK_SETUP.md)); Claude has never run against a live model on this project. Follow [the check below](#3-check-it-works) the first time you enable Bedrock.

## How it works

```
pasted text ──► built-in reader (parse.ts + match.ts), free ──sure──► ingredients, no AI
                     │ unsure (lib/recipes/confidence.ts)
                     ▼
photo ─────────────► lib/ai/router.ts: Google Gemma 3 27B (Converse)
                       ├─ plated food: Gemma's read (no escalation by default)
                       └─ Gemma errors, times out, or
                          its reply fails validation ──────► Amazon Nova Lite v1
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

The owner approved this routing on 2026-11-15, replacing the Claude routing of 2026-11-14. The code is `lib/recipes/confidence.ts` (the text rule), `app/api/recipes/parse/route.ts`, `lib/ai/router.ts` (the tiers) and `lib/ai/index.ts` (the models).

| Input | Read by | When |
|---|---|---|
| Pasted text | **Built-in reader**, no AI, $0 | The read passes the rule below |
| Pasted text the built-in reader is unsure of, and every photo, plated food included | **Google Gemma 3 27B** (`AI_MODEL=google.gemma-3-27b-it`) | Default |
| A read that fails validation | **Amazon Nova Lite v1** (`AI_FALLBACK_MODEL`), once | Gemma replied with no tool call (after one retry) or a malformed recipe. With `AI_ESCALATION_MODEL` set, that model gets the retry instead |
| Anything, while Gemma errors | **Amazon Nova Lite v1** (`AI_FALLBACK_MODEL=us.amazon.nova-lite-v1:0`, Bedrock only) | Gemma returned access denied, not found, a quota or throttling error, or an outage: it's then skipped for 10 minutes (60 s after throttling) on that server instance and tried again. Or Gemma timed out: that read only, no cooldown |
| Photo of plated food, with an escalation model | `AI_ESCALATION_MODEL` (off by default; e.g. `us.anthropic.claude-sonnet-5-5`) | The main read says `plated_meal`. If the escalation fails, the main read is kept |

Refusals, "not food" and rejected requests are not retried on another model. A read with no ingredients goes to the escalation model if one is on, and otherwise reaches the page as "not a recipe". Every read, whichever model made it, goes through the same validator (`lib/ai/schema.ts`), and the page treats it the same way: the user checks every ingredient. Accuracy on our test set is in [research/CHEAPER_MODELS.md](research/CHEAPER_MODELS.md#benchmark-results); plated food wasn't tested. Turn any tier off with `off`, for example `AI_FALLBACK_MODEL=off`.

**Which client.** On Bedrock, Claude ids (`anthropic.`, `us.anthropic.`, `global.anthropic.`, `claude-*`, or an ARN for one) go to the Claude client (`lib/ai/claude.ts`). Every other id, Gemma and Nova included, goes through the Converse API (`lib/ai/converse.ts`), with the tool choice forced. Nothing in the routing is tied to a model family.

**Time limits.** A Gemma call gets 14 s (`AI_TIMEOUT_MS`, retries included; its photo p95 was 11.2 s), the fallback 8 s (`AI_FALLBACK_TIMEOUT_MS`), and the whole read 23 s (`AI_READ_DEADLINE_MS`). A tier that would start with under 2 s left is skipped. That keeps a Gemma call plus a fallback, the image preparation and the matcher under the web Lambda's 28 s and CloudFront's 30 s.

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

All 8 messy recipes go to AI. The threshold sweep: 0.5–0.65 keeps 28 recipes at 99.0% food; **0.7 keeps 26 at 99.5%** (every wrong match seen between 0.6 and 0.7, such as green curry paste → almond paste, is sent to AI); 0.8 keeps only 22. Of the 15 sent to AI, 7 were read correctly by the built-in reader anyway (for example chocolate chips at 0.68): that's the price of caution, about $0.0002 each on Gemma.

What this doesn't show: the threshold was chosen on the same recipes it's scored on, and the tuning set also tuned the matcher, so real pastes will do somewhat worse. AI accuracy on these unsure recipes was measured in the [benchmark](research/CHEAPER_MODELS.md#unsure-pasted-text-20-recipes): Gemma 3 27B got food 88.9%, grams 81.0%, calories in range 13 of 20. Check the `provider=builtin` share and how much users edit those rows once it's live.

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

**Follow [BEDROCK_SETUP.md](BEDROCK_SETUP.md).** It covers the models (Gemma 3 27B at about $0.00025 a photo, Nova Lite v1 as the fallback), the least-privilege IAM policy, the CDK settings, spend controls, and how to switch back to Claude. **Gemma and Nova Lite work on the account today, with no agreement or quota request, so photos work as soon as `AI_PROVIDER=bedrock` is set.** In short:

### 1. Get model access

Nothing to do for Gemma 3 27B or Nova Lite v1: they're models AWS sells itself, `agreementAvailability` is `AVAILABLE` and they run on demand ([CHEAPER_MODELS.md](research/CHEAPER_MODELS.md#whats-on-bedrock-in-us-east-1)). Only if you switch back to Claude: create its Marketplace agreement, get its tokens-per-minute quota raised above 0, and submit the Anthropic use-case form ([BEDROCK_SETUP.md §2](BEDROCK_SETUP.md#2-fix-the-account-owner-actions)).

### 2. Permissions and settings

The app role needs `bedrock:InvokeModel` (what Converse checks) on Gemma 3 27B's foundation model in your region (it's in-region, with no inference profile), and on the `us.amazon.nova-lite-v1:0` profile plus, through it, the Nova Lite foundation model in us-east-1, us-east-2 and us-west-2 ([policy](BEDROCK_SETUP.md#least-privilege-iam-policy-for-the-app-role)). No Marketplace permissions.

| Variable | Default on Bedrock |
|---|---|
| `AI_PROVIDER` | Unset (mock). Set `bedrock` |
| `AI_BEDROCK_REGION` | Your region, e.g. `us-east-1`. Falls back to `AWS_REGION`, then `AWS_DEFAULT_REGION`. `~/.aws/config` isn't read for the region. Gemma 3 27B is offered in us-east-1 |
| `AI_MODEL` | `google.gemma-3-27b-it`. Any non-Claude Bedrock id goes through Converse. For Claude, `us.anthropic.claude-haiku-5-5` (an inference profile or ARN goes to bedrock-runtime `InvokeModel`; a bare `claude-…` id gets `anthropic.` added and goes to the bedrock-mantle endpoint, which doesn't serve Haiku 5.5 or Sonnet 5.5 in us-east-1). `off` turns it off |
| `AI_ESCALATION_MODEL` | `off`. For example `us.anthropic.claude-sonnet-5-5` |
| `AI_FALLBACK_MODEL` | `us.amazon.nova-lite-v1:0`, or `off`. `us.amazon.nova-2-lite-v1:0` also works |
| `AI_TIMEOUT_MS`, `AI_FALLBACK_TIMEOUT_MS`, `AI_READ_DEADLINE_MS` | 14000, 8000, 23000 ([time limits](#which-model-reads-what)) |
| `AI_BUILTIN_TEXT` | `on`. `off` sends all pasted text to AI |

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

You want `"provider":"bedrock"`. The log says why the built-in reader passed, then has one line per model call. These are real, from the app's provider path on the dev account on 2026-11-15 (a rendered recipe card, then an unsure pasted recipe):

```
[ai] provider=bedrock model=google.gemma-3-27b-it kind=image ms=6810 ok=true in=474 out=316 cost_usd=0.00023 tokens=maybe_undercounted
[ai] provider=bedrock model=google.gemma-3-27b-it kind=text ms=3709 ok=true in=261 out=188 cost_usd=0.00013 tokens=maybe_undercounted
```

`tokens=maybe_undercounted` marks Gemma's lines: Bedrock seems to leave the tool schema out of Gemma's reported input tokens, so the logged cost may read low (see [cost](#cost-per-read-by-path)). When Gemma fails you'll see, for example, `[ai] google.gemma-3-27b-it timed out (limit 14000 ms), using us.amazon.nova-lite-v1:0`, and the next line is Nova Lite's.

| You see | It means |
|---|---|
| `"provider":"mock"` | `AI_PROVIDER` or the region isn't set. The log says which |
| `"provider":"builtin"` for text you expected AI to read | Working as intended: the built-in reader was sure. `AI_BUILTIN_TEXT=off` sends all text to AI |
| `"model":"us.amazon.nova-lite-v1:0"` | Gemma failed and Nova Lite read it. The log line before says why |
| `503 ai_unavailable`, log says `AccessDeniedException` or `ResourceNotFoundException` | The log line says what to check: IAM for the denied model (step 2), or the model ID. See [BEDROCK_SETUP.md §4](BEDROCK_SETUP.md#4-photo-to-nutrition-working-locally) |
| `502 ai_bad_output` | Both models replied, but neither reply passed `lib/ai/schema.ts`, or Bedrock rejected the request |
| `504 ai_timeout` | Gemma and then Nova Lite ran out of time, or the read hit its 23 s deadline |

Then try a photo of a recipe card and of a plate, and compare the log's token counts with the cost table.

### Using the Claude API instead

Set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. `AI_MODEL` and `AI_ESCALATION_MODEL` work the same, without a prefix (defaults `claude-haiku-5-5` and off; set `AI_ESCALATION_MODEL=claude-sonnet-5-5` for the plated-food re-read). Gemma and Nova aren't offered there, so there is no fallback on this path. Models that support it also get the server-side refusal fallback (`fallbacks: "default"`). Bedrock doesn't offer that, so a refusal there shows a friendly error and the user can add ingredients by hand.

## Cost per read, by path

Prices are the AWS Price List for Amazon Bedrock in us-east-1 (publication 2026-11-11; `lib/ai/cost.ts` cites the usage types). Gemma 3 27B is $0.23 / $0.38 per million input / output tokens, in-region with no cross-region premium; Nova Lite v1 is $0.06 / $0.24 with none either. **Gemma and Nova Lite figures are measured**: the mean per read in the 2026-11-14 [benchmark](research/CHEAPER_MODELS.md#benchmark-results), and the live check on 2026-11-15. **Claude figures are estimates** (no live Claude call has succeeded).

| Path | Model calls | Cost per read |
|---|---|---|
| Pasted text, built-in reader sure (63% of the evaluation set) | none | **$0** |
| Pasted text, unsure | Gemma 3 27B | **about $0.00017** |
| Photo of a recipe card | Gemma 3 27B | **about $0.00025** |
| Photo of plated food | Gemma 3 27B (no escalation by default) | about $0.00025 (not measured on plates) |
| Read that fails validation, or Gemma errors or times out | + Nova Lite v1 | + about $0.00013 (text) or $0.00024 (photo) |
| Claude instead (`AI_MODEL=us.anthropic.claude-haiku-5-5`, Sonnet for plates) | Haiku, Sonnet for plates | about $0.0004 text, $0.0008 card, $0.018 plate (estimates) |
| Before 2026-11-14: Opus 5.5 for everything | Opus | about $0.04 |

**Gemma's token counts may be low.** Bedrock reports 224 input tokens for Gemma's prompt-only call, where other models count the same prompt and tool schema at 800 to 1,600, so the schema seems not to be counted ([CHEAPER_MODELS.md](research/CHEAPER_MODELS.md#how-the-app-reads-recipes-what-a-model-has-to-do)). The logs and the daily spend guard use the reported counts and mark Gemma's lines `tokens=maybe_undercounted`. If Bedrock bills the schema anyway, add up to about $0.00014 a read (600 tokens). AWS billing is the source of truth: compare it with the logs after the first week.

So at 1,000 reads a month, half unsure pasted text and half photos, the bill is about $0.21 on Gemma (at most about $0.35 if the schema is billed), against about $0.47 on Haiku (plus $0.018 for each plate Sonnet re-reads) and about $40 on the old Opus default. The optional re-rank (`AI_RERANK=1`) works only with a Claude main model; Gemma and Nova don't re-rank.

## Limits and settings

| Variable | Default | Purpose |
|---|---|---|
| `AI_RATE_LIMIT_PER_MINUTE` | 10 | Per client IP; 0 turns it off |
| `AI_RATE_LIMIT_PER_DAY` | 50 | Per client IP; 0 turns it off |
| `AI_DAILY_BUDGET_USD` | 1 | Stops calling the model at this estimated daily spend; 0 turns it off |
| `AI_MAX_IMAGE_BYTES` | 8 MB | Largest upload |
| `AI_TIMEOUT_MS`, `AI_FALLBACK_TIMEOUT_MS`, `AI_READ_DEADLINE_MS` | 14000, 8000, 23000 | The main and escalation call, the fallback call (retries included in each), and the whole read. A main call that times out hands the read to the fallback |
| `AI_MAX_RETRIES` | 2 | SDK retries on connection errors, 429 and 5xx, inside those limits. The CDK example sets 1 |
| `AI_RERANK` | off | `1` lets a Claude main model re-rank low-confidence matches, adding one cached call. Skipped while it's unavailable. Gemma and Nova don't re-rank |
| `AI_BUILTIN_TEXT` | on | `off` sends all pasted text to AI. The daily budget never blocks built-in reads |
| `AI_MODEL`, `AI_ESCALATION_MODEL`, `AI_FALLBACK_MODEL` | Gemma 3 27B, off, Nova Lite v1 | See [Which model reads what](#which-model-reads-what). `off` turns a tier off |

Images are shrunk to 1568 px in the browser, and again on the server for JPEGs (with `jpeg-js`; `sharp` stays out of the Lambda bundle). The server reads the type from the bytes, checks dimensions before decoding, strips EXIF (including GPS), keeps each image under 5 MB of base64 (the Bedrock limit), and tells HEIC uploads to send a JPEG.

## Before going public on a paid provider

- **These limits are per server instance, in memory.** On Lambda each instance counts separately and resets on a cold start. They're a speed bump. Add the DynamoDB quotas in `AWS_HOSTING_DESIGN.md` §3.7 and an AWS Budget.
- **`/recipes` has no sign-in.** The roadmap puts photo imports behind accounts.
- **Requests are synchronous**, not the queued flow §3.7 sketches. That's fine for a single short model call, but check it against your CloudFront and Lambda timeouts.
- **Run an evaluation** on real recipes and weighed meals before promising accuracy, including real phone photos, handwriting and plated food, none of which the 2026-11-14 benchmark covered (Gemma's and Nova Lite's reads were measured on rendered cards and pasted text only).
