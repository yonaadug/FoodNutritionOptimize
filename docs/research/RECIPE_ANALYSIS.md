# Recipe and photo nutrition analysis: build or buy?

Research for the recipe analyzer at `/recipes`. Links were accessed 2026-11-04.

**How to read the numbers.** "Unverified" means the page blocked fetching, the figure wasn't published, or only a secondary source had it. Per-analysis costs and token counts are our own estimates, not vendor quotes. **No Claude cost in this document has been measured**, because no model could be invoked on the project's AWS account (see [What we tested](#what-we-tested-ourselves)). Vendor terms were read by automated page extraction, so re-check any wording you plan to rely on contractually.

## Recommendation

**Build it: our USDA database, Claude to read the recipe, and the user to correct the result.** This is what's implemented.

- **Licensing decides this more than cost.** Spoonacular [bans storing nutrition data](https://spoonacular.com/food-api/terms) beyond a one-hour cache that itself needs written permission. Edamam [allows no caching on Basic and only four nutrients on Core](https://developer.edamam.com/edamam-nutrition-api). A diary has to keep logged micronutrients indefinitely, and neither fits.
- **Is Bedrock cheap? On Haiku 5.5, very, if AWS's prices match Anthropic's.** That's an estimated **$0.001 per analysis** at list price (about $1 per 1,000), with Sonnet 5.5 at about $0.02 and Opus 5.5 at about $0.04. AWS's rate table didn't render when fetched, so **Bedrock's own prices are unverified**.
- **Text and photos are different products.** A pasted recipe states its quantities, so it can be accurate. Plated-meal photos typically run about 21–37% energy error for Claude and GPT models, with worse results reported. No vendor we found publishes evidence of doing better. The app labels these as rough estimates and shows a range.
- **Matching quality is the real risk, and we measured it**: 96.6% top-1 on a held-out set on the first run ([details and caveats](#what-we-tested-ourselves)). Only 8 recipes and our own labels, so treat it as a smoke test, not a benchmark.
- **Before charging anyone, run a real evaluation** of about 100 recipes and 50 weighed meals, comparing Haiku and Sonnet. Its results should decide the default model.

### Decisions for the owner

| Decision | Options | Notes |
|---|---|---|
| **Default model** | `claude-opus-5-5` (the code default), `claude-haiku-5-5`, `claude-sonnet-5-5` | Set with `AI_MODEL`. Opus is about 40x Haiku's cost. `AWS_HOSTING_DESIGN.md` §3.7 budgets around Haiku ($0.0074 per operation, $0.75 per payer per month), so **that budget doesn't hold on the Opus default**. Haiku's quality on real recipes is untested. |
| **Bedrock or Claude Platform on AWS** | Bedrock is implemented. Platform on AWS would be one small provider (`@anthropic-ai/aws-sdk`). | §3.7 prefers Platform on AWS for same-day features, batch and the Files API. Bedrock suits a requirement that AWS be the sole processor. |
| **Who can use it** | Today, anyone: there's no sign-in on `/recipes` | Fine on `mock`. Add the §3.7 quotas before turning on a paid provider in public. |

## 1. Nutrition and recipe APIs

| API | Function | Published price | Free tier | Data and nutrients | Key terms and lock-in |
|---|---|---|---|---|---|
| [Edamam Nutrition Analysis](https://developer.edamam.com/edamam-nutrition-api) | Recipe text to nutrition | $29/mo (2,500 recipes), $299/mo (50,000) | No free plan (10-day trial) | Own database, [USDA not named](https://developer.edamam.com/edamam-docs-nutrition-api); 28 nutrients | Attribution link or suspension. No caching on Basic; Core caches only protein, net carbs, fat and kcal. The page lists "Commercial use: no" on all plans: **confirm in writing** |
| [Edamam Food DB + Vision](https://developer.edamam.com/food-database-api) | Photo to dish and nutrition (uses an LLM) | $14/mo (500 vision calls), $69/mo + $0.015/call, $299/mo (10,000) | 30-day trial | [Up to 160 nutrients claimed](https://developer.edamam.com/edamam-nutrition-api) | Same attribution and caching limits |
| [Edamam Recipe Search](https://developer.edamam.com/edamam-recipe-api) | Searches recipes; doesn't analyze a user's | $9/mo (10,000 calls) and up | None listed | n/a | Attribution; no copying the data |
| [Spoonacular](https://spoonacular.com/food-api/pricing) | [Analyze Recipe, Parse Ingredients, Image Analysis](https://spoonacular.com/food-api/docs) | $29/mo (1,500 pts/day), $79/mo (4,500), $149/mo (10,000) | 50 pts/day, backlink required | Source not stated; [broad vitamin and mineral list](https://spoonacular.com/food-api/docs) | [No storing nutrition; 1-hour cache needs permission; delete all data on exit; no competing product](https://spoonacular.com/food-api/terms) |
| [FatSecret Platform](https://platform.fatsecret.com/api-editions) | Food search; [image and NLP add-ons](https://platform.fatsecret.com/features/image-recognition-and-nlp) | Basic free (5,000 calls/day); Premier on request. **Add-on price unverified** | Yes, for small companies and students | Own "verified" dataset | Attribution on free editions; storage permissions "custom" and undefined |
| [Nutritionix](https://developer.nutritionix.com/) | Natural-language endpoint | [Pricing page returned HTTP 402](https://www.nutritionix.com/business/api). [$449/mo per a competitor's post](https://dev.to/raviteja_nekkalapu_/most-nutrition-apis-hide-80-of-the-data-behind-paywalls-mine-doesnt-49pl) (**unverified, self-interested**) | Official: ["no longer able to maintain a public free-access tier"](https://developer.nutritionix.com/) | Not read | Sales-led: treat as unavailable for self-serve |
| [Passio](https://www.passio.ai/pricing) | Photo recognition | $99/mo (1M tokens), $599/mo (5M), $2,999/mo (100M). A photo uses 20–30k tokens | None | [2.5M+ foods](https://passio.gitbook.io/nutrition-ai/fundamentals/ai-docs-summary); source not stated | Terms not read |
| [LogMeal](https://logmeal.com/api/pricing) | [Dish recognition, quantity, nutrition](https://logmeal.com/api/) | Prices not shown. [~$49/mo per an aggregator](https://thedailyworkflow.com/service/LogMeal) (**unverified**) | 30 days or 200 queries | Not stated | 20 images/day per user on standard plans |
| [Calorie Mama](https://dev.caloriemama.ai/) | Photo to food and nutrition | $100/mo (1,000 calls), $2,000/mo (20,000) | None shown | Not stated | Agreement not read |
| [Open Food Facts](https://world.openfoodfacts.org/terms-of-use) | Food products database; no recipe analysis found | Free | Yes | Crowd-sourced | ODbL (attribution and share-alike); images CC BY-SA; "must not be used for medical purposes"; [15 product requests/min](https://openfoodfacts.github.io/openfoodfacts-server/api/) |

We found no independent accuracy benchmark of Edamam or Spoonacular against USDA data. [Search results were mostly vendor marketing](https://nutrientapi-site.pages.dev/compare/edamam.html).

## 2. Open-source parsers

| Tool | Version | License | Status | Notes |
|---|---|---|---|---|
| [`ingredient-parser-nlp`](https://pypi.org/pypi/ingredient-parser-nlp/json) (Python) | 2.9.1, 2026-10-13 | MIT | Active | [94.98% sentence-level accuracy on a holdout of 88,000+ sentences; per-field confidence](https://github.com/strangetom/ingredient-parser). [`foundation_foods=True` matches offline to the same three USDA datasets we hold](https://ingredient-parser.readthedocs.io/en/latest/explanation/foundation.html), with no published matching accuracy. The best candidate if we ever run a Python sidecar |
| [NYT ingredient-phrase-tagger](https://github.com/nytimes/ingredient-phrase-tagger) | n/a | Apache 2.0 | Archived 2019 | Don't use |
| [`recipe-scrapers`](https://pypi.org/pypi/recipe-scrapers/json) (Python) | 15.13.0, 2026-10-18 | MIT | Active | About 644 host mappings by our count (may include aliases). [Reads JSON-LD, Microdata, RDFa and OpenGraph](https://github.com/hhursev/recipe-scrapers) |
| [`parse-ingredient`](https://registry.npmjs.org/parse-ingredient) (npm) | 3.2.0, 2026-11-04 | MIT | Active, [8,248 downloads/week](https://api.npmjs.org/downloads/point/last-week/parse-ingredient) | Accuracy not researched |
| [`recipe-ingredient-parser-v3`](https://registry.npmjs.org/recipe-ingredient-parser-v3) (npm) | 1.5.0, 2025-02-18 | MIT | No release since; [286 downloads/week](https://api.npmjs.org/downloads/point/last-week/recipe-ingredient-parser-v3) | Weaker choice |

**What we did:** a small rule-based parser in TypeScript (`lib/recipes/parse.ts`), with no dependency. It powers the offline `mock` provider and the "Add an ingredient" box, and it scored 100% on ingredient names across both of our fixture sets. That set is small and clean, so don't compare it with `ingredient-parser`'s figure on 88,000 sentences.

**URLs (not built yet).** Google [requires `name` and `image` in Recipe structured data and only recommends `recipeIngredient`](https://developers.google.com/search/docs/appearance/structured-data/recipe), so URL import needs JSON-LD first and an LLM fallback. `FEATURE_ROADMAP.md` §5.3 has the spec.

## 3. Claude options

Anthropic list prices, per million tokens ([pricing page](https://platform.claude.com/docs/en/about-claude/pricing)):

| Model | Input / output | Cache read |
|---|---|---|
| Haiku 5.5 (prompts up to 100K tokens) | $0.10 / $0.50 | $0.01 |
| Sonnet 5.5 | $2 / $10 | $0.10 |
| Opus 5.5 | $4 / $20 | $0.20 |

| | Amazon Bedrock | Claude Platform on AWS | Direct Anthropic API |
|---|---|---|---|
| Operated by | AWS | Anthropic, [billed through AWS Marketplace](https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws) | Anthropic |
| Auth | IAM / SigV4 | IAM / SigV4 | API key |
| Price | **Unverified.** [Rate tables didn't render](https://aws.amazon.com/bedrock/pricing/). [Regional endpoints +10%](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock) | [List price, in CCUs at $0.01; `inference_geo: "us"` 1.1x](https://platform.claude.com/docs/en/about-claude/pricing) | List price |
| Images | [Base64 only, up to 5 MB](https://platform.claude.com/docs/en/build-with-claude/vision) | Same as API | Base64 or URL, up to 10 MB |
| Batch, Files API, refusal fallback | [Not available](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock) | Available | Available |
| Privacy | [Not used for training or shared with model providers](https://aws.amazon.com/bedrock/faqs/); [retention varies by mode](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html) | Per Anthropic's terms | ["Anthropic may not train models on Customer Content"](https://www.anthropic.com/legal/commercial-terms) |
| In this codebase | `AI_PROVIDER=bedrock` | Not built (one small provider) | `AI_PROVIDER=anthropic` |

**Image tokens.** The [current vision doc](https://platform.claude.com/docs/en/build-with-claude/vision) gives ⌈width/28⌉ × ⌈height/28⌉, with a 2,576 px long edge and 4,784 tokens at most on current models. Shrinking to 1568×1176 gives 2,352 tokens, which is what the app does in the browser.

## 4. Accuracy evidence

### Plated-meal photos: be candid

| Study | Setup | Result |
|---|---|---|
| [Fridolfsson et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12513282/) | 52 weighed-meal photos; GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro | **Claude: energy 35.8%, weight 37.3%, protein 61.7%, carbs 72.8%, fat 41.7% MAPE.** GPT-4o similar on energy; Gemini 64.2%. Underestimation grew with portion size. Authors: not suited to precise clinical or athletic assessment |
| [Coburn et al. 2025](https://arxiv.org/html/2507.07048) | 806 meal images, dietitian-verified | Claude 3.7 Sonnet: energy 23.88% (21.32% with best metadata), portion 42.81%. Best energy overall: GPT-4.1 at 21.26% |
| [O'Hara et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC11858203/) | 114 photos, ChatGPT-4 | Food ID F1 88.6%; portion error 27.8%. **Micronutrients: potassium −49.5%, folate −38.6%, calcium −27.8%, vitamin C +44.9%, median vitamin D −100%.** Energy bias only 0.1%, so errors partly cancel on average |
| [Virginia Tech thesis 2025](https://vtechworks.lib.vt.edu/items/b67c2a61-f283-41ba-9602-9798306b9529) | Nutrition5k, MetaFood3D | GPT-4o calorie error about 51% from the image alone, as low as 29% with per-ingredient mass |
| [Mu et al. 2025](https://digitalcommons.odu.edu/computerscience_fac_pubs/417) | Nutrition5k and a phone dataset | Carbohydrate error 56.6% for Gemini 2.5 Flash, 20.2% with true weight |

1. **Identifying food is much easier than judging how much.** Confirming portions is the most valuable thing a user can do, so the editor makes it easy.
2. **Don't present photo-derived micronutrients as precise.** O'Hara's errors came from direct model estimates. We look values up in USDA, which should remove the model's guess about composition, but portion and identification errors remain. That's our inference, not a published result.
3. **None of these tested Claude 5.x.** Run our own evaluation.

### Text

- **Meal descriptions:** [NutriBench](https://arxiv.org/html/2407.12843v5) found GPT-4o at 66.82% within ±7.5 g of carbs, with nutritionists scoring 42–60%. It tests direct LLM estimation, which we don't rely on.
- **Parsing:** we found **no rigorous benchmark of current LLMs on ingredient lines**, so "text is more accurate" is sound reasoning, not an end-to-end measurement. A [2024 paper](https://arxiv.org/abs/2402.17447) found few-shot LLM recipe NER "abysmal" against a tuned model at about 96% F1, but doesn't name the LLMs and may not reflect current ones.
- **Handwritten cards:** no recipe-specific study found. A [2026 handwriting benchmark](https://arxiv.org/pdf/2608.18586) says its best model still falls well short of exact transcription, so users should check quantities.

### Calculators against reference values

- [MyFitnessPal vs Belgian Nubel](https://pmc.ncbi.nlm.nih.gov/articles/PMC7641788/): energy r=0.96, but sodium 1,293 vs 2,638 mg/day and cholesterol 55 vs 242 mg/day. Crowd-sourced data has micronutrient gaps, which favors USDA data.
- [Hoover & Perloff, as cited by FAO](https://www.fao.org/4/af281e/AF281E12.htm): one nine-ingredient recipe gave 9.1–12.7 g protein/100 g across programs, driven by database and yield factors.
- **Retention gap:** summing raw ingredients overstates heat-sensitive vitamins. [USDA retention factors (CC0)](https://agdatacommons.nal.usda.gov/articles/dataset/USDA_Table_of_Nutrient_Retention_Factors_Release_6_2007_/24660888/1) could address this later. The app states the limitation for now.

## 5. Cost per 1,000 analyses

Token assumptions (estimates, not measured): text is about 4,000 input and 1,300 output tokens; a photo is about 5,600 input and 1,100 output, including a 2,352-token image. Both include one re-rank call, which is off by default. On Opus 5.5 thinking can't be turned off and is billed as output, so its real cost may be higher.

| Option | Text recipe (15 ingredients) | Photo | Can we keep results? |
|---|---|---|---|
| **Ours, Haiku 5.5** | **$1.05** | **$1.11** | Yes |
| **Ours, Sonnet 5.5** | **$21** | **$22** | Yes |
| **Ours, Opus 5.5** | $42 | $44 | Yes |
| Edamam | $29–30 | $84 at 1k/mo; $22 at 10k/mo | Limited |
| Spoonacular | $2.90–29 (Analyze); $14–29 (Parse) | $7.90–29 | No |
| Passio | Not priced | $320–820 | Terms not read |
| Calorie Mama | n/a | $100–200 | Terms not read |
| FatSecret, LogMeal, Nutritionix | Unverified | Unverified | Unverified |

Claude costs use Anthropic list prices; add 10% for regional or US-only routing. Spoonacular's Analyze Recipe can undercut Sonnet, but its storage ban rules it out for a diary.

## What we tested ourselves

**Matching (no AI involved).** Ingredient lines go through the rule-based parser, then the USDA matcher and gram conversion, and are scored against labels we wrote. Run with `npm test`; fixtures are in `lib/recipes/fixtures*.ts`.

| Set | Size | Names | Food top-1 | Grams in range | Calories in range |
|---|---|---|---|---|---|
| Tuning (matcher tuned against it, so it flatters) | 12 recipes, 95 lines | 100% | 100% | 100% | 12/12 |
| **Held-out, first run, before any fix** | 8 recipes, 59 lines | **100%** | **96.6%** | **91.5%** | **8/8** |
| Held-out now (after later general fixes; nothing added to fix its misses) | 8 recipes, 59 lines | 100% | 96.6% | 94.9% | 8/8 |

Caveats: both sets are small, mostly common Western recipes, with labels and acceptable ranges we chose ourselves, and some of those ranges are generous. Real pasted recipes will be messier. Measuring through the rule-based parser means **this says nothing about how well Claude reads recipes**.

What it found:

- Canned beans first matched dry beans, about 3x the calories. Now handled, and calorie checks guard against it.
- The held-out misses were "green curry paste" (matched almond paste with 0.67 confidence, so flagged for review) and "passata" (no match, so the user must choose). Two unknown weights, "2 heads of romaine" and "2 anchovy fillets", are left uncounted and flagged rather than guessed.
- **Foundation foods are sparse.** 80% have no vitamin D value, 61% no selenium and 42% no fiber, and "Garlic, raw" has no minerals at all. The matcher now fills gaps from the SR Legacy food each one supersedes, which cut matched rows missing a core nutrient from 58 of 154 to 6 of 154. The app discloses this.

**Bedrock (2026-11-04).** The project's AWS credentials are valid, `ListFoundationModels` lists Anthropic models in us-east-1 and us-west-2, and SigV4 requests reach the endpoint. **No model could be invoked, so nothing ran and $0 was spent.** We made five probes and changed nothing in AWS:

| Request | Result |
|---|---|
| Messages endpoint, through the app's provider: `anthropic.claude-haiku-5-5` | 404 `does not exist` |
| Same, raw SDK call | 404 `does not exist` |
| Messages endpoint: `anthropic.claude-opus-5-5` | 403 `not available for this account` |
| Messages endpoint: `anthropic.claude-sonnet-5` | 403 `not available for this account` |
| `InvokeModel`: `us.anthropic.claude-haiku-5-5` | 403 `not available for this account` |

Being listed doesn't mean being invocable. Anthropic's docs describe Sonnet 5 as open to all Bedrock customers, yet this account got a 403, so the block may be account-level. **The Claude request shape (strict schema, nullable types, images) has only been type-checked and tested against a fake client, never against a live model.** `docs/RECIPES.md` has the steps to enable and check it.

## Gaps to close by hand

- Bedrock's rate table for the 5.5 models
- Edamam's "Commercial use: no" row
- FatSecret NLP and image add-on quotes, and whether Premier Free permits storage
- Nutritionix and LogMeal pricing
- Passio and Calorie Mama terms
