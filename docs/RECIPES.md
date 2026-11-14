# Recipe analyzer

`/recipes` works out the nutrition per serving of a pasted recipe or a photo, and lets the user correct it. The research behind these choices is in [research/RECIPE_ANALYSIS.md](research/RECIPE_ANALYSIS.md).

Photos of plated food (open models, photo APIs, Bedrock options and portion aids) are compared in [research/FOOD_PHOTO_OPTIONS.md](research/FOOD_PHOTO_OPTIONS.md).

> **Status.** It works end to end on the offline `mock` provider. **The Bedrock and Claude API providers have never run against a live model**: the project's AWS account can't invoke Claude yet, and no API key was available. **[BEDROCK_SETUP.md](BEDROCK_SETUP.md) has the diagnosis (2026-11-13: the account's Claude quotas are 0 and no Marketplace agreement exists), the owner steps, the model choice and the IAM policy.** Follow [the check below](#3-check-it-works) the first time you enable one.

## How it works

```
text or photo
   │  lib/ai: Claude (Bedrock or API), or the rule-based mock
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
- Text and photos go to the AI provider. Photos aren't stored, and logs hold token counts and cost only.

## API

All errors have the shape `{ error, code, details? }`.

| Route | Body | Returns | AI? |
|---|---|---|---|
| `POST /api/recipes/parse` | JSON `{ text }`, or multipart with an `image` file | Ingredients with matches and conversions (`ParseResponse`) | Yes |
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

**Follow [BEDROCK_SETUP.md](BEDROCK_SETUP.md).** It covers why the account refuses Claude today and the exact console and CLI steps, the recommended model (`us.anthropic.claude-haiku-5-5`, about $0.0008 a photo), the least-privilege IAM policy, the CDK settings and spend controls. In short:

### 1. Get model access

Create the Marketplace agreement for the model and get its tokens-per-minute quota raised above 0 (Service Quotas, or a support case). Submit the Anthropic use-case form too. See [BEDROCK_SETUP.md §2](BEDROCK_SETUP.md#2-fix-the-account-owner-actions).

### 2. Permissions and settings

The app role needs `bedrock:InvokeModel` on the inference profile and, through it, on the foundation model in each destination region ([policy](BEDROCK_SETUP.md#least-privilege-iam-policy-for-the-app-role)). No Marketplace permissions.

| Variable | Value |
|---|---|
| `AI_PROVIDER` | `bedrock` |
| `AI_BEDROCK_REGION` | Your region, e.g. `us-east-1`. Falls back to `AWS_REGION`, then `AWS_DEFAULT_REGION`. `~/.aws/config` isn't read for the region |
| `AI_MODEL` | **Set it**, e.g. `us.anthropic.claude-haiku-5-5`. An inference profile ID (`us.`, `global.`, ...) or ARN goes to bedrock-runtime `InvokeModel`. A bare ID such as `claude-opus-5-5` (the default) gets `anthropic.` added and goes to the bedrock-mantle endpoint, which doesn't serve Haiku 5.5 or Sonnet 5.5 in us-east-1 |

Credentials come from the standard AWS chain: role, environment, or `~/.aws/credentials`.

### 3. Check it works

Restart the server, then make one small request:

```bash
curl -s http://127.0.0.1:3000/api/recipes/parse \
  -H 'Content-Type: application/json' \
  -d '{"text":"Garlic rice\nServes 2\n1 1/2 cups cooked white rice\n2 cloves garlic, minced\n1 tbsp olive oil\nSalt to taste"}'
```

You want `"provider":"bedrock"` and four ingredients. The server log has one line per call, like this made-up example:

```
[ai] provider=bedrock model=us.anthropic.claude-haiku-5-5 kind=text ms=1840 ok=true in=950 out=210 cost_usd=0.00022
```

| You see | It means |
|---|---|
| `"provider":"mock"` | `AI_PROVIDER` or the region isn't set. The log says which |
| `503 ai_unavailable`, log says `PermissionDeniedError 403` or `NotFoundError 404` | The log line says what to check: account access (step 1) for 403, the model ID or endpoint for 404. See [BEDROCK_SETUP.md §4](BEDROCK_SETUP.md#4-photo-to-nutrition-working-locally) |
| `502 ai_bad_output` | The model replied but the request or reply was rejected. As this path is untested on a live model, a schema problem would show up here first. Look at `lib/ai/schema.ts` |

Then try a photo of a recipe card and of a plate, and compare the log's token counts with the cost table.

### Using the Claude API instead

Set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. `AI_MODEL` works the same, without a prefix. On this path, models that support it also get the server-side refusal fallback (`fallbacks: "default"`). Bedrock doesn't offer that, so a refusal there shows a friendly error and the user can add ingredients by hand.

## Cost per analysis

Estimates, **not measured** (no live Claude call has succeeded). Anthropic list prices; on Bedrock these are the `global.` prices, and `us.` profiles and the in-region Mantle endpoint cost 10% more (AWS Price List and Marketplace offers, 2026-11-13). Per-photo figures by model, including Amazon Nova measured on this account, are in [BEDROCK_SETUP.md §3](BEDROCK_SETUP.md#3-which-model-to-use).

| `AI_MODEL` | Text recipe | Photo |
|---|---|---|
| `claude-haiku-5-5` | about $0.001 | about $0.001 |
| `claude-sonnet-5-5` | about $0.02 | about $0.02 |
| `claude-opus-5-5` (default) | about $0.04 | about $0.04 |

The default follows Anthropic's guidance for new code, but **it costs about 40x Haiku**, and `AWS_HOSTING_DESIGN.md` §3.7 budgets around Haiku. On Opus, thinking can't be disabled and bills as output, so real cost may run higher. Choose with an evaluation; the owner's call is listed in the [research doc](research/RECIPE_ANALYSIS.md#decisions-for-the-owner).

## Limits and settings

| Variable | Default | Purpose |
|---|---|---|
| `AI_RATE_LIMIT_PER_MINUTE` | 10 | Per client IP; 0 turns it off |
| `AI_RATE_LIMIT_PER_DAY` | 50 | Per client IP; 0 turns it off |
| `AI_DAILY_BUDGET_USD` | 1 | Stops calling the model at this estimated daily spend; 0 turns it off |
| `AI_MAX_IMAGE_BYTES` | 8 MB | Largest upload |
| `AI_TIMEOUT_MS`, `AI_MAX_RETRIES` | 45000, 2 | Per attempt and SDK retries. The whole request stops at 55 s |
| `AI_RERANK` | off | `1` lets the model re-rank low-confidence matches, adding one cached call |

Images are shrunk to 1568 px in the browser, and again on the server for JPEGs (with `jpeg-js`; `sharp` stays out of the Lambda bundle). The server reads the type from the bytes, checks dimensions before decoding, strips EXIF (including GPS), keeps each image under 5 MB of base64 (the Bedrock limit), and tells HEIC uploads to send a JPEG.

## Before going public on a paid provider

- **These limits are per server instance, in memory.** On Lambda each instance counts separately and resets on a cold start. They're a speed bump. Add the DynamoDB quotas in `AWS_HOSTING_DESIGN.md` §3.7 and an AWS Budget.
- **`/recipes` has no sign-in.** The roadmap puts photo imports behind accounts.
- **Requests are synchronous**, not the queued flow §3.7 sketches. That's fine for a single short model call, but check it against your CloudFront and Lambda timeouts.
- **Run an evaluation** on real recipes and weighed meals before choosing a default model or promising accuracy.
