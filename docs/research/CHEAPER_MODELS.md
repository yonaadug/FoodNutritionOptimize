# Cheaper models for reading recipes, and DeepSeek

Research and a small paid benchmark, 2026-11-14. Links were accessed **2026-11-14**. **UNVERIFIED** marks anything that wasn't confirmed on a primary page, or that is our own estimate.

This builds on [FOOD_PHOTO_OPTIONS.md](FOOD_PHOTO_OPTIONS.md) (photo options and accuracy evidence), [RECIPES.md](../RECIPES.md) (routing) and [BEDROCK_SETUP.md](../BEDROCK_SETUP.md) (account set-up).

## The answer

**Yes, for today's set-up. The cheaper model is Amazon's own Nova Lite v1, not DeepSeek.**

- **Right now Claude can't run in production** (its quota is 0), so Nova 2 Lite reads everything. On our test set, **Nova Lite v1 read recipe-card photos about as well as Nova 2 Lite at one seventh of the price**:
  - Nova Lite v1: $0.00024 a photo.
  - Nova 2 Lite: $0.00166 a photo.
- **Switching the fallback is one setting**, `AI_FALLBACK_MODEL=us.amazon.nova-lite-v1:0`, plus an IAM change. No code changes. It cuts AI spend by about 87% while Claude stays off.
- **The trade-off is on unsure pasted text.** Nova Lite v1 was a little worse there: calories in range for 15 of 20 recipes, against 17 of 20 for Nova 2 Lite.
  - Nova Micro matched Nova 2 Lite on text (17 of 20) at $0.00008 a read.
  - Using Nova Micro for text alone needs a small code change (a text tier, below). It's worth it for accuracy, not for money: it saves only cents.
- **Once Claude works, a cheaper model saves little.** Haiku 5.5 is already cheap, about $0.0004 per unsure text read and $0.0008 per card photo (estimates).
  - Most of the bill is plated-food photos, which escalate to Sonnet 5.5 at about $0.018 each.
  - We can't test plated food without real photos, so **this research recommends no change on the plated path**.
- **DeepSeek: no.** On Bedrock it reads text only, never photos. It costs more than Haiku and 15 times Nova Micro. It was 6 to 8 times slower than the Nova models, and no more accurate on our set. DeepSeek's own API would send users' recipes to servers in China, with no processor contract the site's health-data policy could rely on. [Details below](#deepseek-the-verdict).

### Monthly AI cost by number of users

Assumption (UNVERIFIED, there's no usage data yet): each monthly user makes **4 photo reads (3 recipe cards, 1 plated meal) and pastes 4 recipes**. The built-in reader keeps 63% of pasted text off AI, so that's about 1.5 AI text reads. Per-read costs come from the table below. To use your own volumes, scale linearly from the per-read prices.

| Set-up | Per user | 1,000 users | 10,000 users | 100,000 users |
|---|---|---|---|---|
| **Today: Claude blocked, Nova 2 Lite reads everything** | $0.0088 | $8.79 | $87.86 | $878.60 |
| **Recommended now: `AI_FALLBACK_MODEL=us.amazon.nova-lite-v1:0`** | $0.0012 | **$1.15** (saves $7.64) | **$11.52** (saves $76.34) | **$115.20** (saves $763.40) |
| Plus a text tier on Nova Micro (code change) | $0.0011 | $1.08 | $10.78 | $107.80 |
| Once Claude works: defaults (Haiku, Sonnet for plated) | $0.0210 | $20.99 | $209.90 | $2,099 |
| Once Claude works: Nova Micro for text, Nova Lite v1 for cards, Sonnet for plated | $0.0188 | $18.84 | $188.40 | $1,884 |

How the Claude rows add up:
- Haiku is about $0.0004 per text read and $0.0008 per card ([RECIPES.md](../RECIPES.md#cost-per-read-by-path)).
- A plated photo is a Haiku read plus a Sonnet read, about $0.018 in total.
- Once Claude works, the cheaper models save about 10%. Plated photos are 86% of that bill.

## How the app reads recipes (what a model has to do)

- Pasted text goes to the free built-in reader first. It keeps 26 of 41 test recipes, at 99.5% food and gram accuracy. The other 15 are "unsure" and go to AI.
- Photos always go to AI.
- The model fills in one tool, `record_recipe`. It lists the ingredients, with amounts, units, preparation and a confidence for each line.
  - `lib/ai/schema.ts` validates the reply.
  - The app's USDA matcher finds the foods and computes the nutrition.
- **So the model only has to transcribe well and follow a JSON schema.** That's why small models can compete.

**What the app actually sends.** These were measured in each model's own tokenizer: one call per model with the prompt and a one-line recipe.
- The system prompt is 925 characters and the tool schema is 1,901 characters.
- That comes to about **800 to 1,600 input tokens before any recipe**: Nova 2 Lite 1,614, Nova Lite v1 and Nova Micro 1,118, DeepSeek V3.2 1,033, Qwen3 865, Ministral 800, gpt-oss 679.
- Gemma 3 reports only 224 tokens. Bedrock seems not to count (or not to show) the tool schema for Gemma, so its token counts may not be comparable (UNVERIFIED).
- A typical unsure recipe adds 50 to 150 tokens. Output is 250 to 400 tokens.

**Image tokens per 1568×1176 card, as measured** (the photo call's input minus the prompt-only call's):

| Model | Image tokens |
|---|---|
| Nova 2 Lite | 225 (AWS documents a flat 230) |
| Gemma 3 | 250 |
| Nova Lite v1 | about 1,660 |
| Qwen3 VL | about 1,810 |
| Ministral 3 | about 2,345 |
| Pixtral Large | about 3,110 |
| Claude | 2,352 by Anthropic's formula (not measured: Claude isn't enabled on the dev account) |

## What's on Bedrock in us-east-1

These come from read-only `ListFoundationModels`, `ListInferenceProfiles` and `GetFoundationModelAvailability` calls on the dev account (`nd-dev`), 2026-11-14.
- Prices are the AWS Price List: [AmazonBedrock](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/us-east-1/index.csv), published 2026-11-11T01:30:37Z, and [AmazonBedrockFoundationModels](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/us-east-1/index.csv) for Claude, published 2026-11-09T22:43:12Z.
- Context sizes and the structured-output column come from the AWS model cards (`docs.aws.amazon.com/bedrock/latest/userguide/model-card-<model>.html`).
- "Tool use" is what we observed through the Converse API. AWS removed its per-model Converse feature table; its [ToolChoice reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolChoice.html) says a forced `tool` choice is "only supported by Anthropic Claude 3 and Amazon Nova models", which is out of date.

| Model (Bedrock id) | Input | $/1M in / out | Context | Tool use (seen) | Structured outputs (card) | Dev account |
|---|---|---|---|---|---|---|
| Claude Haiku 5.5 (`us.anthropic.claude-haiku-5-5`) | text, image | 0.11 / 0.55 (global 0.10 / 0.50) | 1M | yes (strict) | yes | **Needs owner**: no Marketplace agreement (`NOT_AVAILABLE`); prod quota 0 |
| **DeepSeek V3.2** (`deepseek.v3.2`) | **text only** | 0.62 / 1.85 | 164K | yes, forced | yes | Works |
| DeepSeek-R1 (`us.deepseek.r1-v1:0`) | text only | 1.35 / 5.40 | 128K | not listed | not listed | Legacy, end of life 2027-03-30. Not tested |
| DeepSeek V3.1 | text only | 0.58 / 1.68 | – | – | – | Priced, but missing from this account's model list |
| Amazon Nova Micro (`amazon.nova-micro-v1:0`, `us.` profile) | text only | 0.035 / 0.14 | 128K | yes, forced | no | Works |
| Amazon Nova Lite v1 (`amazon.nova-lite-v1:0`, `us.` profile) | text, image, video | 0.06 / 0.24 | 300K | yes, forced | no | Works |
| Amazon Nova 2 Lite (`us.amazon.nova-2-lite-v1:0`) | text, image, video | 0.33 / 2.75 (global 0.30 / 2.50) | 1M | yes, forced | no | Works |
| Llama 4 Scout / Maverick (`us.meta.llama4-*`) | text, image | 0.17 / 0.66, 0.24 / 0.97 | 10M / 1M | no forced choice | no | **Not usable**: Legacy, "you have not been actively using the model in the last 30 days" |
| Qwen3 VL 235B (`qwen.qwen3-vl-235b-a22b`) | text, image | 0.53 / 2.66 | 256K | yes, forced | no | Works |
| Qwen3 32B (`qwen.qwen3-32b-v1:0`) | text | 0.15 / 0.60 | 32K | yes, forced | yes | Works |
| Qwen3 Next 80B (`qwen.qwen3-next-80b-a3b`) | text | 0.14 / 1.20 | 256K | yes, forced | yes | Works |
| Gemma 3 4B / 12B / 27B (`google.gemma-3-*-it`) | text, image | 0.04 / 0.08, 0.09 / 0.29, 0.23 / 0.38 | 128K | yes, forced | 12B and 27B yes | Works |
| Ministral 3 3B / 8B / 14B (`mistral.ministral-3-*-instruct`) | text, image | 0.10 / 0.10, 0.15 / 0.15, 0.20 / 0.20 | 128K | yes, forced | yes | Works |
| Pixtral Large (`us.mistral.pixtral-large-2502-v1:0`) | text, image | 2.00 / 6.00 | 128K | `any` only, not forced | no | Works but throttled at once (dev quota) |
| gpt-oss-20b / 120b (`openai.gpt-oss-*`) | text | 0.07 / 0.30, 0.15 / 0.60 | 128K | yes, forced | 20b yes | Works |

Other models were listed but not tested:
- Gemma 4 has prices for the Mantle endpoint only.
- Mistral Large 3, Kimi K2.5 and K3 (vision), GLM, MiniMax and Qwen3 Coder are larger or code-focused models, and none is cheaper than Haiku per read.

Two notes on the dev account:
- **It finished AWS's new-account verification during this work.** The first benchmark run, at 03:02 UTC, was refused with "Your account is currently being verified". Calls worked minutes later.
- **For Bedrock's own models, `agreementAvailability` is `AVAILABLE`.** These are the models AWS sells itself: DeepSeek, Qwen, Gemma, Mistral, gpt-oss and Nova. Calling them accepted no new terms.

## Benchmark results

How the benchmark was run:
- **What ran.** `food-nutrition-app/lib/ai/eval/bench.ts` (`npm run bench:models`; see [Rerunning](#rerunning)). Every model got the app's exact request through the Converse API: the same prompt, the `record_recipe` tool and `temperature 0`. Each reply went through `validateRecipeOutput`, the app's USDA matcher and the offline evaluation's scorer, `scoreIngredients` in `lib/recipes/reader-eval.ts`.
- **Text set: 20 recipes, 126 lines.** These are the 15 pasted fixtures that `confidence.ts` sends to AI, plus 5 held-out recipes. On this set the built-in reader alone gets food 74.6%, grams 65.1%, and calories in range for 11 of 20.
- **Photo set: 8 recipe cards, 65 lines.** Rendered from fixture lines at 1568×1176 in four styles: plain, tilted with a coffee ring, blurred, and two-column. These are clean printed cards, easier than a phone photo of a cookbook page or a handwritten card.
- **Scoring.**
  - "Food" is the share of lines whose USDA match is right.
  - "Grams" is the share of lines whose gram amount is in range.
  - "Calories" is how many recipes land in their per-serving range.
  - A failed read counts as every line wrong.
- **Price per read** is the mean actual cost from each read's reported token usage, retries included.
- **Latency** is per read, measured from this Mac to us-east-1.
- **Mind the sample size.** One line is 0.8 points on text and 1.5 points on photos. Differences under about 5 points are noise.
- **Some misses are shared by every model**, because they come from the matcher or gram conversion rather than the model:
  - "green curry paste" matches almond paste.
  - "passata" finds no food.
  - A 28-oz can of tomatoes converts to a 411 g can.
  - "4 salmon fillets" comes out at 1,584 g.
  - Spanish ingredient names don't match.

  Those are worth fixing in the matcher, and no model choice fixes them.

### Unsure pasted text (20 recipes)

| Model | Price per read | Food | Grams | Calories in range | Schema-valid | Latency p50 / p95 |
|---|---|---|---|---|---|---|
| **Nova Micro** | **$0.00008** | 92.1% | 81.0% | 17/20 | 20/20 | **1.1 s / 1.6 s** |
| Ministral 3 3B | $0.00012 | 88.1% | 60.3% | 12/20 | 20/20 | 0.9 s / 1.5 s |
| **Nova Lite v1** | **$0.00013** | 87.3% | 79.4% | 15/20 | 20/20 | 1.7 s / 2.5 s |
| Gemma 3 27B | $0.00017 | 88.9% | 81.0% | 13/20 | 20/20 | 3.1 s / 4.9 s |
| Ministral 3 8B | $0.00018 | 88.1% | 73.8% | 16/20 | 20/20 | 2.6 s / 5.1 s |
| Ministral 3 14B | $0.00024 | 91.3% | 80.2% | 16/20 | 20/20 | 1.7 s / 2.7 s |
| gpt-oss-20b | $0.00028 | 88.9% | 78.6% | 17/20 | 20/20 | 2.3 s / 12.2 s |
| Qwen3 32B | $0.00035 | 91.3% | 83.3% | 16/20 | 20/20 | 1.6 s / 2.0 s |
| *Claude Haiku 5.5 (baseline, not run)* | *~$0.0004 (estimate)* | – | – | – | – | – |
| gpt-oss-120b | $0.00047 | 88.9% | 80.2% | 17/20 | 20/20 | 2.0 s / 4.1 s |
| Qwen3 Next 80B | $0.00055 | 92.9% | 78.6% | 17/20 | 20/20 | 5.6 s / 9.1 s |
| **DeepSeek V3.2** | **$0.00120** | 93.7% | 81.7% | 17/20 | 20/20 | **8.5 s / 15.2 s** |
| Qwen3 VL 235B | $0.00126 | 89.7% | 78.6% | 17/20 | 20/20 | 4.7 s / 7.5 s |
| **Nova 2 Lite (today's reader)** | **$0.00145** | 90.5% | 80.2% | 17/20 | 20/20 | 1.4 s / 1.9 s |
| Gemma 3 4B | $0.00004 (failures excluded) | 59.5% | 48.4% | 9/20 | **15/20** | 1.1 s / 1.9 s |
| Gemma 3 12B | $0.00012 (failures excluded) | 39.7% | 34.1% | 6/20 | **9/20** | 2.6 s / 6.0 s |
| Pixtral Large | $0.00376 | – | – | – | 2/20 (throttled) | – |

### Recipe-card photos (8 cards)

| Model | Price per read | Food | Grams | Calories in range | Schema-valid | Latency p50 / p95 |
|---|---|---|---|---|---|---|
| **Nova Lite v1** | **$0.00024** | 93.8% | 87.7% | 8/8 | 8/8 | **1.9 s / 2.8 s** |
| Gemma 3 27B | $0.00025 | 95.4% | 98.5% | 8/8 | 8/8 | 5.9 s / 11.2 s |
| Ministral 3 3B | $0.00035 | 95.4% | 90.8% | 8/8 | 8/8 | 1.7 s / 1.9 s |
| Ministral 3 8B | $0.00053 | 93.8% | 89.2% | 8/8 | 8/8 | 2.5 s / 3.5 s |
| Ministral 3 14B | $0.00072 | 90.8% | 87.7% | 8/8 | 8/8 | 3.1 s / 4.4 s |
| *Claude Haiku 5.5 (baseline, not run)* | *~$0.0008 (estimate)* | – | – | – | – | – |
| **Nova 2 Lite (today's reader)** | **$0.00166** | 92.3% | 92.3% | 8/8 | 8/8 | 2.0 s / 2.4 s |
| Qwen3 VL 235B | $0.00243 | 92.3% | 92.3% | 8/8 | 8/8 | 7.4 s / 12.2 s |
| Gemma 3 4B | $0.00006 (failures excluded) | 69.2% | 56.9% | 5/8 | 6/8 | 2.5 s / 2.8 s |
| Gemma 3 12B | $0.00016 (failures excluded) | 43.1% | 46.2% | 4/8 | 4/8 | 3.4 s / 13.0 s |
| Pixtral Large | $0.00951 | – | – | – | 1/8 (throttled) | – |
| DeepSeek V3.2, Nova Micro, Qwen3 32B / Next, gpt-oss | text only | – | – | – | – | – |
| Llama 4 Scout / Maverick | not usable on the account (Legacy) | – | – | – | – | – |

### What the numbers say

- **Every model in the top group read the unsure text about equally well**: food 87 to 94%, grams 79 to 83%.
  - That's far better than the built-in reader on the same recipes (75% and 65%).
  - Among them, Nova Micro is the cheapest by a factor of 1.5 or more, and among the fastest.
- **The photo cards look easy for all the mid-size vision models.**
  - Nova Lite v1 and Nova 2 Lite differ by 3 lines out of 65. That's inside the noise.
  - Gemma 3 27B scored highest, missing only the three matcher-driven lines. It is three times slower, though, and needs code to use (below).
- **Small Gemmas fail in a specific way.** Gemma 3 4B and 12B sometimes loop until they hit the 4,096-token limit. That costs money and 15 to 20 seconds, and returns no recipe. The 12B was worse than the 4B. Don't use either.
- **Not measured here, so check before relying on it:**
  - Real phone photos, handwriting and cookbook pages.
  - Plated food.
  - Prompt-injection resistance, beyond the planted line in the earlier Nova test.
  - Nova Lite v1's habit, seen on 2026-11-13, of leaving preparation inside the name and skipping the per-line confidence. The validator then defaults confidence to 0.5. The scores above suggest it rarely changed the matched food.

## DeepSeek: the verdict

**Against, on both routes.**

### DeepSeek on Bedrock

**Can it read images? No.** Bedrock offers DeepSeek V3.2 and the Legacy DeepSeek-R1, and both are text-in, text-out ([V3.2 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-deepseek-v3-2.html); `ListFoundationModels` shows `inputModalities: TEXT`). **It can only help with pasted text, never with photos.**

On pasted text it works: forced tool use, 20 of 20 schema-valid, and accuracy as good as the best (food 93.7%, grams 81.7%, calories 17 of 20). But:
- **It isn't cheaper.**
  - $0.62 / $1.85 per million tokens is about 5.6 times Haiku 5.5's input price and 3.4 times its output price.
  - Measured, it's **$0.0012 per read: 15 times Nova Micro and about 3 times Haiku (estimated)**, for no measurable accuracy gain.
- **It's slow**: 8.5 s median and 15.2 s at p95, against 1.1 s for Nova Micro. The web function times out at 28 s.
- **Its lifecycle is short.** The model card says end of life "no sooner than Dec 01, 2026". AWS also already moved R1 to Legacy, and Llama 4 shows what Legacy means: accounts that haven't used a Legacy model lose access to it.

**Privacy isn't the problem on this route.**
- AWS runs it in its own accounts in us-east-1, us-east-2 and us-west-2 (in-region only, per the model card).
- Model providers "don't have access to Amazon Bedrock logs or to customer prompts and completions" ([Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html)), and inputs "are not shared with any model providers" ([Bedrock FAQ](https://aws.amazon.com/bedrock/faqs/)).
- So it would fit the current policy, which names AWS as the AI processor.
- **The open question is perception and procurement.** A DHS order of October 2026 bars federal agencies from DeepSeek products, including "third-party products and services developed using DeepSeek implementations". Its text names no cloud-hosted copies. That matters only for federal customers or contractors. This is from a [law-firm summary](https://www.haynesboone.com/news/alerts/dhs-issues-deepseek-exclusion-and-removal-order); the [primary notice](https://public-inspection.federalregister.gov/2026-21447.pdf) wasn't readable, so its exact scope is UNVERIFIED.

### DeepSeek's own API

These are DeepSeek's public pages only. No data was sent to DeepSeek.

**Prices and models** ([pricing](https://api-docs.deepseek.com/quick_start/pricing)):

| Model | Images | Input, cache miss ($/1M) | Output ($/1M) |
|---|---|---|---|
| `deepseek-flash` (V4.1-Flash) | yes, file input since 2026-11-13 | $0.30 | $1.20 |
| `deepseek-v4-pro` | no | $1.32 | $3.96 |

- Off-peak rates are half the peak rates. Peak hours are 01:00 to 04:00 and 06:00 to 10:00 UTC, Monday to Friday.
- The old `deepseek-chat` and `deepseek-reasoner` names were retired on 2026-07-24 ([changelog](https://api-docs.deepseek.com/updates)).

**Per read** (our arithmetic from the measured token counts): about $0.0007 per text read at peak, $0.0003 off-peak. **That's still 4 to 8 times Nova Micro.** There's no saving to trade the risks below against.

**Privacy and compliance.** This rules it out for user recipes and photos:
- **Where data goes.** The [privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html), updated Feb 10, 2026, says: "we directly collect, process and store your Personal Data in People's Republic of China".
  - Inputs may be used to "train and improve our technology". The only opt-out given is an email address.
  - It also says data from end users of apps built on the platform is the developer's responsibility.
  - Whether API data in particular is stored in the PRC or used for training isn't stated. UNVERIFIED either way.
- **The terms.** The [Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html), effective Apr 29, 2026, are governed by PRC law, with courts in Hangzhou (§10.1).
  - They put the duty to get end users' consent on the developer (§3.3).
  - They say nothing on storage location, retention or training for API data.
  - **We found no DPA, no HIPAA BAA, and no SOC 2 or ISO certification.**
- **PRC law.**
  - The [National Intelligence Law, Art. 7](https://www.chinalawtranslate.com/en/national-intelligence-law-of-the-p-r-c-2017/) obliges organisations to "support, assist and cooperate with the state intelligence work".
  - The Data Security Law, Art. 36, requires state approval before data stored in China is given to foreign authorities ([commentary](https://www.china-briefing.com/news/a-close-reading-of-chinas-data-security-law-in-effect-sept-1-2021/)).
- **Washington's My Health My Data Act.** A processor may handle consumer health data "only pursuant to a binding contract" that sets its instructions ([RCW 19.373.060](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.060)).
  - Disclosure to a processor under such a contract isn't "sharing" ([RCW 19.373.010(27)(b)(i)](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.010)).
  - Without one, sharing needs separate, prior consent ([RCW 19.373.030](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.030)).
  - DeepSeek's terms aren't a processor contract, and they allow training on inputs. The site's draft policies name AWS as the only AI processor ([LEGAL.md](../LEGAL.md)).
  - **Using DeepSeek's API would mean a new processor, a policy change and, realistically, a separate consent screen.**
- **Track record.**
  - In January 2025 an unauthenticated DeepSeek database exposed chat history and API keys ([Wiz](https://www.wiz.io/blog/wiz-research-uncovers-exposed-deepseek-database-leak)).
  - Italy's Garante limited its processing on 30 Jan 2025 ([order](https://www.garanteprivacy.it/home/docweb/-/docweb-display/print/10097450)).
  - South Korea's PIPC ordered corrections over cross-border transfers on 24 Apr 2025 ([notice](https://pipc.go.kr/eng/user/ltn/new/noticeDetail.do?nttId=2819)).
  - Several US states ban it on government devices; Virginia's is [EO 46](https://governor.am.virginia.gov/media/governorvirginiagov/governor-of-virginia/pdf/eo/EO-46.pdf).
- The project also has a rule to send no data to non-AWS AI APIs.

## Recommended change

This changes no defaults in code. The owner decides.

**1. Now, while Claude is blocked in production: make Nova Lite v1 the fallback.**

```
AI_FALLBACK_MODEL=us.amazon.nova-lite-v1:0
```

- This needs no code. Nova ids already go through the Converse provider, and `lib/ai/cost.ts` already prices Nova Lite v1, with no `us.` premium.
- **IAM is needed.** The app role's policy ([BEDROCK_SETUP.md §5](../BEDROCK_SETUP.md)) allows only the Haiku, Sonnet and Nova 2 Lite profiles. Add `bedrock:InvokeModel` on the `us.amazon.nova-lite-v1:0` profile and on `amazon.nova-lite-v1:0` in that profile's regions.
- **It saves about 87% of today's AI spend**: about $7.60 per 1,000 users a month.
- The cost is slightly weaker reads of messy pasted text (15 of 20 recipes with calories in range, against 17).
- Users check every ingredient either way. Revert by unsetting the variable.

**2. Optional, for text accuracy: a text tier on Nova Micro.** This is a small code change; the money is negligible.
- Proposed: `AI_TEXT_MODEL=us.amazon.nova-micro-v1:0`, used for `kind: 'text'` reads before the main model, off by default.
- To build it:
  - Add the variable in `lib/ai/index.ts` (`chooseProvider` / `createProvider`), and pick it in `lib/ai/router.ts` when `input.kind === 'text'`.
  - Add Nova Micro's price (0.035 / 0.14) to `lib/ai/cost.ts`. Otherwise the spend guard prices it as an unknown model at $10 / $50 per million.
  - Allow its profile in IAM.
- With this, text reads cost $0.00008 and match Nova 2 Lite's accuracy.

**3. Once Claude works: keep the defaults until Haiku is measured.**
- Keep `AI_MODEL=us.anthropic.claude-haiku-5-5` and `AI_ESCALATION_MODEL=us.anthropic.claude-sonnet-5-5`.
- Set `AI_FALLBACK_MODEL` to whichever of the above is in place.
- Swapping Haiku for Nova Lite v1 on card photos would save only about $1.70 per 1,000 users a month.
- The real lever is the plated-photo escalation to Sonnet (86% of the bill). That needs an evaluation on real plated photos, as [FOOD_PHOTO_OPTIONS.md §7](FOOD_PHOTO_OPTIONS.md) proposes, not a model swap.
- To compare Haiku with these numbers, rerun this benchmark: `npm run bench:models -- --yes --models us.anthropic.claude-haiku-5-5,amazon.nova-lite-v1:0,amazon.nova-micro-v1:0` on an account where Haiku works.

**Not recommended:**
- DeepSeek (above).
- Gemma 3 4B and 12B: they fail to finish.
- Pixtral Large: about 12 times Haiku's price per photo.
- Llama 4: Legacy, and no access.
- Qwen3 VL: no cheaper than Nova 2 Lite.

**Not recommended yet: Gemma 3 27B for photos.** It had the best photo score at Nova Lite's price. But it is three times slower, its reported token counts look incomplete, and the app would need code to use it:
- `isNovaModel` in `lib/ai/index.ts` sends every non-Nova id to the Claude client.
- Non-Claude, non-Nova Bedrock ids would have to go to the Converse provider.

Revisit it if Nova Lite v1 disappoints on real photos.

## Every live call, and the total spend

**Total: $0.2329 of the $1.00 cap.** All calls were made on the dev account (`AWS_PROFILE=nd-dev`, account <dev-account-id>, us-east-1), with on-demand Converse only. No resources were created, no agreements or model-access requests were made, and nothing touched prod.

| When (UTC, 2026-11-15) | What | Calls | Billed | Spend |
|---|---|---|---|---|
| 03:02 | First pilot run: refused, account still in AWS verification | 58 | 0 | $0 |
| ~03:03 | Access check: one Nova Micro call, `maxTokens: 1` | 1 | 1 | $0.0000002 |
| 03:03–03:05 | Pilot run: Nova Lite v1 and Gemma 3 4B, text and photos ([calls-pilot.jsonl](data/cheaper-models/calls-pilot.jsonl)) | 58 | 57 | $0.0079 |
| 03:06–03:17 | Full run: 18 models ([calls.jsonl](data/cheaper-models/calls.jsonl), [results-all.json](data/cheaper-models/results-all.json)) | 423 | 391 | $0.2250 |

The full run, by model. Refused calls cost nothing: Llama 4 Legacy access, Pixtral throttling, and the forced-tool-choice probes Llama and Pixtral reject.

| Model | Calls | Billed | Input / output tokens | Spend |
|---|---|---|---|---|
| deepseek.v3.2 | 21 | 21 | 22,911 / 5,677 | $0.0247 |
| amazon.nova-micro-v1:0 | 21 | 21 | 24,716 / 5,606 | $0.0016 |
| amazon.nova-lite-v1:0 | 29 | 29 | 46,932 / 7,662 | $0.0047 |
| us.amazon.nova-2-lite-v1:0 | 29 | 29 | 49,763 / 9,675 | $0.0430 |
| qwen.qwen3-vl-235b-a22b | 29 | 29 | 40,801 / 8,855 | $0.0452 |
| qwen.qwen3-32b-v1:0 | 21 | 21 | 19,501 / 7,103 | $0.0072 |
| qwen.qwen3-next-80b-a3b | 21 | 21 | 19,417 / 6,997 | $0.0111 |
| google.gemma-3-4b-it | 29 | 29 | 9,720 / 36,748 | $0.0033 |
| google.gemma-3-12b-it | 29 | 29 | 9,720 / 66,236 | $0.0201 |
| google.gemma-3-27b-it | 29 | 29 | 9,720 / 8,784 | $0.0056 |
| mistral.ministral-3-3b-instruct | 29 | 29 | 43,304 / 8,905 | $0.0052 |
| mistral.ministral-3-8b-instruct | 29 | 29 | 43,304 / 10,683 | $0.0081 |
| mistral.ministral-3-14b-instruct | 29 | 29 | 43,304 / 9,815 | $0.0106 |
| us.mistral.pixtral-large-2502-v1:0 | 30 | 4 | 6,640 / 993 | $0.0192 |
| openai.gpt-oss-20b-1:0 | 21 | 21 | 15,439 / 15,137 | $0.0056 |
| openai.gpt-oss-120b-1:0 | 21 | 21 | 15,439 / 12,274 | $0.0097 |
| us.meta.llama4-scout-17b-instruct-v1:0 | 3 | 0 | 0 / 0 | $0 |
| us.meta.llama4-maverick-17b-instruct-v1:0 | 3 | 0 | 0 / 0 | $0 |

Spend is computed from each call's reported token usage at the list prices above. AWS billing is the source of truth.

**Needs the owner to enable:**
- **Claude Haiku 5.5** on dev: Marketplace agreement, and on prod also the quota.
- **Llama 4 Scout and Maverick**: Legacy, and AWS refuses accounts that haven't used them in 30 days. Not worth chasing.
- **Pixtral Large** throttled in dev; it would need a quota increase. Not worth it at its price.

Everything else on the list could be called without accepting anything.

## Rerunning

```
cd food-nutrition-app
AWS_PROFILE=nd-dev npm run bench:models                      # dry run: the plan and an estimate
AWS_PROFILE=nd-dev npm run bench:models -- --yes             # all candidates, about $0.25
AWS_PROFILE=nd-dev npm run bench:models -- --yes --models amazon.nova-lite-v1:0 --set image --out /tmp/bench
```

How the script behaves:
- **Account.** It refuses to run unless `AWS_PROFILE` is `nd-dev`, or the non-prod profile named with `--profile`.
- **Spend.** It stops before any call that could push total spend past `--cap` (default $1.00, counted across runs from `calls.jsonl` in the output folder). It logs every call there.
- **Not in `npm test`.** It isn't part of `npm test` or `npm run check`.
- **Modes.** If a model rejects a forced tool choice, it tries `any`, then `auto`, then JSON in the reply text. The results report the mode used. Every model in this run except Pixtral worked with the forced tool, the same mode the app uses for Nova.
- **Cards.** The rendered cards land in `<out>/cards/`. They aren't committed, because they're rebuilt from the fixtures on each run.
