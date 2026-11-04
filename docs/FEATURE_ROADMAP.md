# Micronutrient Diary Feature Roadmap

*Section F (Features) of the November 2026 repo review. Opinionated by design: it ranks features, cuts the weak ones, and specifies the top five in enough detail to start building. Effort sizes assume one developer: **S** = 3 days or less, **M** = 1-2 weeks, **L** = 3-6 weeks.*

---

## 0. Where the code is today (what this roadmap builds on)

Facts from reading `food-nutrition-app/` that shape the recommendations below:

| Area | Current state | Implication |
|---|---|---|
| Optimizer objective | `lib/optimizer.ts` hard-codes `optimize: 'calories', opType: 'min'`. There is no price field anywhere in `Food`, the DB, or the UI. | The README promises "minimizes calories **or cost**", but cost minimization isn't implemented. It is the cheapest high-value feature on this list. |
| Units | Every LP variable is "100 g of food X" (`value * 100 = grams`). | Recipes need a unit of "1 serving", so variables must carry a `unitGrams` and per-unit nutrient vector. |
| Targets | `lib/nutrient-defaults.ts` holds one set of FDA **label** Daily Values (2,000 kcal, calcium 1,300 mg, potassium 4,700 mg, iron 18 mg, ...). No upper limits except sodium/sat-fat/cholesterol/sugars. | Label DVs are generally the highest values across adult life stages. Used as LP minimums, they over-constrain most users, which makes plans pricier, stranger, and more often infeasible. Personalized targets will improve plan quality directly. |
| Portion realism | The only per-food guards are a default max of 3 servings (RACC or largest portion), an optional global "diversity" cap, and user min/max. | The LP can still return 7 g of one food and 450 g of another. That is the classic diet-problem palatability failure (see Stigler, below). |
| Mixed dishes / recipes | None. Data is 411 Foundation Foods (single ingredients). SR Legacy and maybe FNDDS are being added in parallel. | Recipe import fills the biggest content gap: people eat dishes, not "Onions, raw". |
| State | All in `localStorage` (`selectedFoods`, `guaranteedFoods`, `customConstraints`, `foodConstraints`, calorie fields). The client posts full `Food` objects to `/api/optimize`. | Every feature below has a no-account version (localStorage) and an account version (DynamoDB). The optimize API should accept IDs plus user-owned items (recipes, price overrides) and look up nutrients server-side. |
| Search | `LIKE %q%` ordered by description length (FTS5 is landing in parallel). | Ingredient matching for recipe import depends on the FTS5 work. |
| Existing "guaranteed foods" | Fixed grams subtracted from targets before solving. | This is already the core of two strong features: **pantry-aware** planning and **"plan the rest of my day"** (what you've already eaten becomes guaranteed). |

---

## 1. Product thesis

Calorie trackers ask you to log what you ate. Meal planners hand you recipes that roughly hit a macro split. Neither answers the question Micronutrient Diary is built around: **"Given foods I like and can afford, exactly how much of each should I eat to cover all ~30 nutrients my body needs, at the lowest cost?"** That is the Stigler diet problem. In 1945 Stigler found a $39.93/year diet with hand heuristics. Dantzig's simplex method later made it solvable, and Google uses it as a textbook LP example. ([Google OR-Tools](https://developers.google.com/optimization/lp/stigler_diet), [Garille & Gass 2001](https://Www.Gwern.net/doc/statistics/decision/2001-garille.pdf)) No consumer app ships it well. Micronutrient Diary should be the **planning-first, micronutrient-complete, cost-aware** nutrition app. It should pair Cronometer's data rigor with Eat This Much's "just tell me what to eat", plus something neither has: a real solver that also minimizes your grocery bill. Every feature on this roadmap should feed the solver better inputs (personal targets, real prices, your recipes, your pantry, your restrictions) or turn its output into something you can act on (realistic portions, a week plan, a grocery list). Features that don't do either are cut.

---

## 2. Competitive landscape

| App | What it is | Price (US) | What users love | What users hate | Gap Micronutrient Diary can own |
|---|---|---|---|---|---|
| **Cronometer** | Micronutrient-rich tracker, curated DB (USDA/NCCDB) | Free; Gold $10.99/mo or $59.99/yr ([Cronometer Gold](https://cronometer.com/gold), [Fortune review](https://fortune.com/article/cronometer-review/)) | Accuracy, ~80+ nutrients, verified entries ([forum](https://forums.cronometer.com/discussion/comment/11662/), [lifestack](https://lifestack.ai/blog/cronometer-vs-myfitnesspal)) | Smaller DB; Recipe Importer and "Nutrient Oracle" food suggestions are Gold-only ([Oracle help](https://support.cronometer.com/hc/en-us/articles/360018510531)) | The Oracle *suggests* foods for a nutrient. Micronutrient Diary *solves for amounts* across all nutrients at once, plus cost. |
| **MyFitnessPal** | Mass-market calorie logger | Premium ~$19.99/mo or $79.99/yr (secondary sources) ([nutriscan](https://nutriscan.app/en/blog/posts/myfitnesspal-pricing-2026-guide-2ff09c399a)) | Huge DB, barcode speed | Moved the barcode scanner behind the paywall in Oct 2022 ([Droid Life](https://www.droid-life.com/2022/08/24/myfitnesspal-puts-barcode-scanner-behind-premium-paywall/)), which still dominates negative reviews ([unstar analysis](https://unstar.app/fr/blog/is-myfitnesspal-premium-worth-it-paywall-app-reviews-2026)); inconsistent user-entered data | Don't paywall basics like barcode. Keep data USDA-grade. |
| **MacroFactor** | Adaptive macro coach (TDEE from weight trend) | $11.99/mo, $47.99/6 mo, $71.99/yr; no free tier ([help center](https://help.macrofactorapp.com/en/articles/393-how-macrofactor-subscriptions-and-bundles-work)) | Smart adaptive targets, no-judgment UX | Price, no free tier | Personalized targets are table stakes. Copy the "targets adapt" idea later, not now. |
| **Eat This Much** | Auto meal-plan generator to calorie/macro targets | ~$5/mo annual or $14.99 month-to-month ([promealplan 2026](https://www.promealplan.com/en/blog/eat-this-much-review-2026)) | Closest to "tell me what to eat"; CNN Underscored's top pick ([CNN](https://amp.cnn.com/cnn/cnn-underscored/reviews/best-meal-planning-apps)) | Weekly generation and grocery list are premium; plans get repetitive after 3-4 weeks ([stork.ai](https://www.stork.ai/en/eat-this-much)); rigid meal times ([r/EatThisMuch](https://lr.us.psf.lt/r/EatThisMuch)) | Micronutrient Diary optimizes ~30 nutrients, not just macros. It can make cost and variety explicit constraints and explain trade-offs. |
| **Lose It! / Yazio** | Weight-loss loggers | ~$39.99/yr each (aggregators; verify) ([apppricinglab](https://apppricinglab.com/app/apple/297368629), [Yazio listing](https://appfollow.io/ios/yazio-calorie-counter-diet/946099227?country=ca)) | Simple, cheap | Shallow micronutrients | Not a direct competitor. They anchor the ~$40/yr consumer price point. |
| **Samsung Food (Whisk)** | Recipe saver + planner | Free; Food+ $6.99/mo or $59.99/yr; AI meal plans and photo import are Food+ ([App Store](https://apps.apple.com/us/app/-/id1133637674), [netzgemeinde](https://hub.netzgemeinde.eu/@gadgeteer?cat=meals)) | Save recipes from any site | Nutrition is secondary | Recipe import plus optimization: "which of *my* saved recipes, in what servings, cover my week?" |
| **Paprika** | Recipe manager | One-time ~$4.99 iOS / $29.99 Mac ([apppricinglab](https://apppricinglab.com/app/apple/1303222868)) | Reliable web import, own your data | No nutrition optimization | It shows that a "save recipe from link" feature people trust is what drives retention. |
| **Mealime** | Free recipe-based meal planner with auto shopping list | Free core; Pro tier (price not verified) ([fitia](https://fitia.app/en/learn/article/best-personalized-nutrition-apps-2025/)) | Fast grocery lists | Limited nutrition control | Grocery-list export is expected. Ship it with the week planner. |

**The angle no one owns: "Tell me what to eat, and how much, to hit my goals, as cheaply as possible."** Cronometer has the data but no solver. Eat This Much has a generator but optimizes macros, not micronutrients or cost. Recipe apps have no nutrition engine. Micronutrient Diary already has a working LP with infeasibility diagnostics (`optimizer.ts` slack-variable re-solve). That moat is real but invisible. The roadmap's job is to make it visible ("this plan costs $4.12/day and covers 27/27 nutrients") and trustworthy (realistic portions, personal targets).

**Pricing recommendation:** freemium with Premium at **$4.99/mo or $39.99/yr**. That sits at the Lose It/Yazio anchor and below Cronometer ($59.99) and MacroFactor ($71.99). **Never paywall the core solver, personal targets, or barcode scanning** (see the MFP backlash). Charge for convenience at scale: week plans, grocery lists, local prices, unlimited imports, history.

---

## 3. Prioritized feature table

Legend: **Acct** = needs accounts/backend storage (beyond the stateless API). "Local-first" means it works in localStorage for anonymous users and syncs when signed in. **Free/Prem** = recommended tier.

| # | Feature | User value | Effort | Free / Prem | Acct? | Dependencies |
|---|---|---|---|---|---|---|
| 1 | **Personalized targets** (profile → NASEM DRIs: RDA/AI as mins, UL as maxes where they apply to food; EER energy) | Targets that fit *you*. Fewer infeasible and weird plans, because label DVs over-constrain. | M | Free | Local-first | `lib/nutrient-defaults.ts` refactor; DRI reference table |
| 2 | **Cost objective + food prices** (minimize $ subject to nutrients; national-average seed prices; user overrides) | The headline differentiator: "$/day for a complete diet". Also fixes the README promise. | M | Free (national + own prices); Prem (local store prices) | Local-first | `optimizer.ts` objective switch; ERS PP-NAP ingest; price table |
| 3 | **Dietary patterns & exclusions** (vegetarian, vegan, pescatarian, halal, kosher-style, allergens, dislikes) | Filters search and keeps excluded foods out of the LP. Required for real use. | S-M | Free | Local-first | Food tag table; FTS5 search |
| 4 | **Realistic portions & plan explanation** (min sensible portion or zero, round to household units, per-category caps, "why this food?") | Plans people would actually eat. Builds trust in the solver. | M | Free | No | MILP semi-continuous vars (`ints`/binaries); serving_sizes |
| 5 | **Recipes as optimizable foods + manual recipe builder** (servings as the unit) | Lets the solver plan with dishes the user cooks. Foundation for imports. | M | Free (10 recipes) / Prem (unlimited) | Yes (recipes in DynamoDB); local draft OK | Optimizer `unitGrams` generalization; accounts |
| 6 | **Recipe import by URL** (schema.org JSON-LD → ingredient parse → USDA match → review UI) | Saves 10+ minutes per recipe. Proven retention driver (Paprika, Whisk, Cronometer Gold). | L | Free 5/mo, Prem unlimited | Yes | #5, FTS5, Claude Haiku 5.5 for fallback/re-rank |
| 7 | **Saved plans & history** | Come back to a plan, compare plans, track cost over time | M | Free 3 saved / Prem unlimited + history | Yes | Accounts, DynamoDB |
| 8 | **Week planner with variety + grocery list** (7-day MILP, leftovers, weekly-averaged micros; list grouped by aisle, CSV/print/Instacart link) | Turns a daily solution into a shopping trip. The main reason to subscribe. | L | Prem | Yes | #2, #4, #5; HiGHS WASM solver |
| 9 | **Nutrient-gap insights & smart swaps** ("Vitamin D adds $1.10/day; a D3 supplement covers it for $0.04", "swap X for Y saves $0.60") | Explains trade-offs and teaches. Uniquely possible with an LP. | M | Free (top 3 insights) / Prem (full) | No | #2; re-solve sensitivity; optional supplement items |
| 10 | **Recipe import by photo** (recipe card / cookbook page via Claude vision) | Imports grandma's card and cookbooks, which URL import can't reach | M (on top of #6) | Free 3/mo, Prem 50/mo | Yes (quota) | #6 pipeline; S3 upload; Claude Sonnet 5.5 / Haiku 5.5 |
| 11 | **"Plan the rest of my day"** (log what you ate → guaranteed foods → optimize remainder) | Daily-use hook without becoming a full tracker | S | Free | Local-first | Existing `guaranteedFoods` |
| 12 | **Onboarding presets** ("Cheapest complete day", "High-protein on a budget", "Vegetarian complete") | First plan in under 60 s. Fixes the empty-state problem. | S | Free | No | #1, #2; guided flow (UI agent) |
| 13 | **Share & export a plan** (read-only link, print, CSV, copy as text) | Word of mouth; coach/partner use | S | Free | Share links need a backend | Snapshot store (DynamoDB TTL) |
| 14 | **Barcode scanning** (Open Food Facts + USDA Branded GTIN) | Adds packaged foods (protein bars, cereal) to the optimizer | M | **Free** (deliberate) | Per-user food store | Branded ingest or OFF API; camera UI |
| 15 | **Pantry-aware optimization** (what I have = $0 up to quantity on hand; use-it-up bonus) | Less waste, cheaper plans | S (after #2) | Prem | Yes (sync) | #2, guaranteed-foods mechanics |
| 16 | **Local store prices** (Kroger Products API by store) | Real prices and sales at your store | M | Prem | Yes | #2; Kroger OAuth app; product↔food mapping |
| 17 | **Instacart "Shop this list"** link-out | One tap from plan to cart; affiliate revenue | S | Free (monetizes itself) | No | #8; Instacart IDP Public API key |
| 18 | **Plated-meal photo estimate** (beta) | Quick "I ate this" entry for #11 | M | Prem, labeled beta | Yes | #10, #11; heavy confirmation UI |
| 19 | **Adherence check-ins & weight trend → adaptive energy target** | Retention; MacroFactor-style learning | M | Prem | Yes | #1, #7 |
| 20 | **Apple Health / Google Health Connect** | Auto activity level, weight | L | Prem | Yes + native wrapper | Native shell (Capacitor / existing Electron is macOS-only) |
| 21 | **Weekly email / push "your plan + price changes"** | Re-engagement | S | Free | Yes | #7, #8, #16 |

### Cut or deferred (and why)

- **Full food diary / calorie logging.** Cut. It's a crowded market (MFP, Lose It, Cronometer) and off-thesis. #11 "plan the rest of my day" captures the useful 20% without forcing daily logging.
- **Social feed, friends, leaderboards.** Cut. Low fit for a planning tool, high moderation cost. Share links (#13) cover the real need.
- **Streaks and badges.** Cut. Gamifying intake carries eating-disorder risk and plans don't need daily engagement. Keep one gentle metric, the **"nutrient completeness" score** (n/27 targets met), shown on plans.
- **AI chat nutritionist.** Deferred. A deterministic "why this plan" (#4, #9) is cheaper, verifiable, and doesn't hallucinate. Revisit an LLM explanation layer later, grounded on solver output.
- **Walmart pricing.** Deferred. Access goes through its affiliate program and current price-field availability is unverified ([WIOpy](https://pypi.org/project/WIOpy/)). Kroger is the more open, documented path.
- **Restaurant database.** Cut. Licensing cost, and off-thesis.
- **Wearables in the web phase.** Deferred. HealthKit has no web API and requires a native iOS app ([rapidevelopers](https://rapidevelopers.com/v0-integrations/healthkit)).

---

## 4. Phases

### Now (next ~6 weeks, ships with or right after the guided Pick foods → Set goals → See plan UI)
Goal: make the existing solver visibly better and sharply differentiated, with no AI spend yet.
1. **Cost objective + seed prices** (#2). This is the headline. The flow's "See plan" step shows **$/day**.
2. **Personalized targets** (#1) as the "Set goals" step: a 6-field profile, with targets computed client-side.
3. **Dietary patterns & exclusions** (#3).
4. **Realistic portions** (#4), at minimum: zero-or-at-least-a-sensible-portion, rounding to household units, and "why this food".
5. **Onboarding presets** (#12) and **plan the rest of my day** (#11). Both are cheap and reuse existing mechanics.
6. **Export/print + copy** (#13, the no-backend part).
7. Analytics instrumentation for activation metrics (section 6).

### Next (~6-12 weeks, needs accounts / DynamoDB / Stripe from the infra track)
1. **Accounts → saved plans & history** (#7), syncing localStorage state up on first sign-in.
2. **Recipes as foods + manual builder** (#5), then **URL import** (#6), then **photo import** (#10).
3. **Nutrient-gap insights & smart swaps** (#9).
4. **Week planner + grocery list** (#8) with **Instacart link-out** (#17). This is the first true Premium anchor.
5. **Pantry** (#15). **Share links** (#13 backend part).

### Later (3-6+ months)
**Local store prices via Kroger** (#16), **barcode scanning** (#14), **plated-meal photo beta** (#18), **adherence + adaptive energy** (#19), **native wrapper + Health integrations** (#20), **weekly digest** (#21).

Why barcode is "Later" despite being free and popular: branded products have thinner micronutrient panels (labels list only ~4-10 micros), so they help the optimizer less than whole foods and recipes do. It matters more once users plan full weeks.

---

## 5. Deep-dive specs (top 5)

### 5.1 Personalized targets + dietary patterns (#1, #3)

**User flow (the "Set goals" step)**
1. "Tell us about you". Six fields: sex (for DRI tables), age, height, weight, activity level (4 NASEM PAL categories, each with plain-language examples), goal (maintain / lose ~0.5 kg/wk / gain). Optional: pregnant (weeks of gestation) or lactating (exclusive 0-6 mo / partial 7-12 mo).
2. "How do you eat?" Pattern chips (omnivore, vegetarian, vegan, pescatarian, halal, kosher-style), allergen chips (FDA major allergens: milk, egg, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame), free-text dislikes → matched foods to exclude.
3. Results card: "Your targets: 2,240 kcal · protein ≥ 62 g · iron ≥ 8 mg · calcium 1,000-2,500 mg ..." Each value has a source badge (RDA / AI / UL / AMDR / label DV) and an **Edit** link. Edits are stored as overrides. Users can switch to "FDA label values" (today's behavior).

**Calculation (new `lib/targets.ts`, pure function, runs client and server)**
- **Energy (EER).** Default to the NASEM 2023 DRI equations (adults 19+, by PAL category). Men inactive: `753.07 - 10.83*age + 6.50*height_cm + 14.10*weight_kg`. Women inactive: `584.90 - 7.01*age + 5.72*height_cm + 11.71*weight_kg`. The report also gives low-active, active, and very-active variants. Pregnancy (2nd/3rd trimester) has its own equations with `+9.16*gestation_weeks` plus BMI-based energy deposition (+300/+200/+150/-50). Lactation adds +400 kcal/d net (exclusive, 0-6 mo) or +380 (7-12 mo). ([NASEM 2023, Summary tables](https://www.nationalacademies.org/read/26818/chapter/2)) Offer **Mifflin-St Jeor × activity factor** as an alternative. It is the familiar formula and was the most accurate RMR equation in the Frankenfield systematic review, though individual errors remain notable ([Frankenfield 2005](https://pure.psu.edu/en/publications/comparison-of-predictive-equations-for-resting-metabolic-rate-in-/)). Show energy as a **range** (±10%), not a point. The LP gets `min = EER*0.95, max = EER*1.05`, adjusted for the goal.
- **Goal adjustment.** Lose: -500 kcal/d, never below a floor (1,200 F / 1,500 M) and never for pregnancy, lactation, or under-19. Gain: +300.
- **Macros.** Protein min = max(RDA 0.8 g/kg, AMDR 10% of kcal); pregnancy 1.1 g/kg. Fat and carbs as AMDR min/max (20-35%, 45-65% of kcal → grams). Fiber min = 14 g/1,000 kcal (AI basis). Sat fat max = 10% kcal (DGA). Sodium max = 2,300 mg (CDRR).
- **Micros.** RDA (or AI) for the life-stage group is the **min**. The UL becomes a **max only when it applies to total intake from food**. Store `ul_scope` per nutrient: `total` (e.g. calcium, iron, zinc, selenium, copper, phosphorus, B6, vitamin C, vitamin D), `supplemental_only` (magnesium, niacin, folate as folic acid, vitamin E), or `preformed_only` (vitamin A; our column is RAE, so warn instead of constraining). This avoids false infeasibility, like capping food magnesium at 350 mg. Values come from the NIH ODS DRI tables ([ODS](https://ods.od.nih.gov/HealthInformation/nutrientrecommendations)). *Verify each value against ODS before shipping; this doc deliberately doesn't reproduce the tables.*
- **Why it matters for the solver.** For a 30-year-old man, the RDA/AI for calcium (1,000 vs 1,300 label DV), potassium (3,400 AI vs 4,700), and iron (8 vs 18) are all lower than today's defaults. Plans get cheaper and more natural. For a pregnant woman, iron rises to 27 mg and folate to 600 µg DFE. The app currently gets this wrong.

**Dietary patterns: data model**
- SQLite (static, shipped): `food_tags(food_id, tag)`. Tags: `animal_meat`, `poultry`, `pork`, `fish`, `shellfish`, `dairy`, `egg`, `honey`, `gelatin`, `alcohol`, `gluten`, `peanut`, `tree_nut`, `soy`, `sesame`, `wheat`. Generate them offline: rules from `food_category` and description keywords, then a one-time Claude Haiku 5.5 labeling pass via the **Message Batches API** (50% off) for ambiguous rows. ~13k foods × ~400 tokens is about 5M input tokens, roughly **$0.25** at Haiku 5.5's $0.10/MTok input before the batch discount. Then human spot-check. Patterns are tag rules: vegan = none of {meat, poultry, pork, fish, shellfish, dairy, egg, honey, gelatin}; halal/kosher-style = exclude pork, shellfish (kosher), alcohol (halal). Label them "-style". Certification can't be inferred from USDA data, and the UI must say so.
- Dislikes: free text → FTS5 match → user confirms → `excludedFoodIds`.

**DynamoDB entities** (single table `micronutrient-diary`, PK/SK)
- `USER#<sub>` / `PROFILE`: `{sex, birthYear, heightCm, weightKg, pal, goal, lifeStage:{pregnant?:{weeks}, lactating?:'exclusive'|'partial'}, units, diet:{pattern, allergens[], excludedFoodIds[]}, updatedAt}`
- `USER#<sub>` / `TARGETS#current`: `{computed:{...}, overrides:{nutrient:{min,max}}, method:'nasem2023'|'mifflin', version}`
- Anonymous users keep the same JSON in localStorage key `profile_v1`, uploaded on first sign-in.

**API.** `POST /api/targets` (stateless compute, for server-side reuse). `GET/PUT /api/me/profile` (authed). `/api/search` and `/api/optimize` accept `exclude: {tags[], foodIds[]}`.

**Files that change.** `lib/nutrient-defaults.ts` keeps labels/units but becomes the "FDA label" preset. New files: `lib/targets.ts`, `lib/energy.ts`, `lib/dri-data.ts` (or SQLite `dri_values(nutrient, sex, age_min, age_max, life_stage, rda, ai, ul, ul_scope)`). `components/DailyValuesSidebar.tsx` gets source badges and overrides. `app/page.tsx` adds the goals step (coordinate with the UI agent). `lib/db.ts` adds tag filters to search.

**Risks.**
- **DRI licensing.** USDA NAL notes its DRI calculator data is copyrighted by the National Academies and needs permission for non-personal use ([NAL](https://www.nal.usda.gov/fnic/interactiveDRI/)). Numeric values are facts, but get legal review or ask NASEM before redistributing a compiled table. Cite the source in-app either way.
- **Health-data compliance.** Pregnancy status and weight are consumer health data. The FTC Health Breach Notification Rule now explicitly covers non-HIPAA health apps ([Federal Register 2024](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule)). State laws (e.g., Washington's My Health My Data Act) add consent and deletion duties. Collect the minimum, encrypt at rest, offer delete, keep it out of analytics events.
- **Safety.** No targets for under-18s in v1 (block or show a referral). Deficit floors. A "not medical advice" note, plus "talk to your clinician" for pregnancy, kidney disease, etc.

---

### 5.2 Cost-aware optimization + food prices (#2, with #9 insights and #15/#16 later)

**User flow**
- In "Set goals": "Optimize for: **Lowest cost** (default once prices exist) / Fewest calories / Balanced."
- In "See plan": a header like "**$3.84/day · $26.88/week** · 27/27 targets met". Each food row shows grams, household units, and $. Foods without a price get a "?" chip ("Add your price").
- Price editor per food: "I pay **$2.49** for **1 lb**". The app computes $/100 g edible, adjusted for refuse (bones, peels). Optional store and date.
- "Allow supplements" toggle (off by default). It adds vitamin D3, B12, and multivitamin items with prices. The insight card shows when a supplement is far cheaper than food for a nutrient.

**Optimizer changes (`lib/optimizer.ts`)**
- Replace the hard-coded objective with `objective: 'calories' | 'cost' | 'blend'`. Cost: `model.optimize = 'cost'`, each variable gets `cost: pricePer100g`. Blend: `cost + λ·calories/1000`.
- In cost mode, an energy **min and max** is mandatory (from #1). Without it, the cheapest "complete" diet can be short on energy.
- Unpriced foods: either exclude them in cost mode, or impute the category median price and flag it in the result (`priceSource: 'imputed'`).
- Return `totalCost`, `costByFood`, `priceSources`.
- **Sensitivity insights (#9).** After the main solve, re-solve with each binding nutrient min relaxed 10% and record the $ delta. Report the top 3 "expensive targets". Also re-solve without each chosen food ("removing salmon costs +$0.40/day"). With fewer than 30 foods and fewer than 30 constraints this is ~60 tiny LPs, well under a second. (`javascript-lp-solver` doesn't expose dual values, and re-solving is simpler to explain anyway.)

**Price data tiers**
1. **Seed: USDA ERS Purchase to Plate National Average Prices (PP-NAP).** Public CSV/XLSX unit-price estimates for foods reported in WWEIA/NHANES. Series cover 2011-12 through 2017-18; 2021-23 is expected no earlier than spring 2027 ([ERS PP](https://www.ers.usda.gov/data-products/purchase-to-plate)). Built from Circana scanner data ([ERS documentation](https://www.ers.usda.gov/data-products/purchase-to-plate/documentation)). PP-NAP keys on FNDDS food codes, which map directly if the parallel ingest adds FNDDS. SR Legacy/Foundation items map via FNDDS ingredient (SR) codes. Inflate to today with the BLS CPI "food at home" series and label the result "national average estimate". *Check the price unit in the downloaded file before ingesting.*
2. **User overrides** (local-first, synced). Package price ÷ package grams ÷ (1 − refuse%), using refuse percentages where available (the SR28 `FOOD_DES.Refuse` field; check whether the FDC SR Legacy CSVs carry it). Otherwise use a per-category default.
3. **Premium: Kroger Products API** (Later, #16). The public Products API returns regular and promo price when called with a store `locationId`. Third-party mirrors of the docs cite a 10,000 calls/day limit ([val.town mirror](https://www.val.town/x/bgschiller/personalShopper/code/docs/kroger-products.md), [kroger-api wrapper](https://github.com/CupOfOwls/kroger-api)). Verify on developer.kroger.com. Map a USDA food to the cheapest matching Kroger product per store with FTS plus a Haiku re-rank, cached per (store, food) for 24 h.
4. **Instacart IDP Public API.** No catalog or pricing data. It only returns a shoppable-list URL (with affiliate params). Use it for checkout (#17), not prices ([Instacart docs](https://docs.instacart.com/developer_platform_api/), [Digital Commerce 360](https://www.digitalcommerce360.com/2024/03/27/instacart-api-idp-developer-platform/)).

**Data model**
- SQLite: `food_prices(food_id, price_per_100g_usd, source TEXT, source_year INT, cpi_adjusted_to TEXT, confidence REAL)`. Optional `food_refuse(food_id, refuse_pct)` from SR28 refuse data, if obtainable.
- SQLite seed items: `foods.data_type = 'supplement'` rows (vitamin D3 25 µg tablet, B12, generic multivitamin), each with a single-unit serving size.
- DynamoDB: `USER#<sub>` / `PRICE#<foodId>`: `{pricePerPackage, packageGrams, refusePct, store?, observedAt}`. Kroger cache: `STORE#<locationId>` / `FOOD#<foodId>`: `{productId, upc, regular, promo, size, fetchedAt, ttl}`.

**API.** `GET /api/prices?ids=` (seed plus the user's overrides merged). `PUT /api/me/prices/:foodId`. `/api/optimize` body gains `objective` and `priceOverrides` (or reads them server-side when authed).

**Files that change.** `lib/optimizer.ts` (objective, cost output, sensitivity). `lib/db.ts` (join prices). `components/FoodCard.tsx` (price chip/editor). `components/ComparisonView.tsx` / `NutrientBreakdown.tsx` (cost columns). New `scripts/ingest_prices.py`.

**Risks.**
- PP-NAP is 2017-18 data. CPI adjustment is coarse, so label it honestly.
- Regional variance is large. Push users to override their top 5 foods.
- Cost-min LPs love extremes (the Stigler diet was mostly flour and cabbage). #4's portion guards and per-category caps are prerequisites for shipping cost mode as the default.

---

### 5.3 Recipe import by URL + recipes as optimizable foods (#5, #6)

**User flow**
1. "Add recipe" → paste a link (or use the "Paste ingredients" text box, which also covers cookbooks and blocked sites).
2. A spinner runs for 2-6 s. The **review screen** shows title, source domain, and servings (editable). Below that is a table, one row per ingredient line: *original text* | *matched food* (dropdown of top candidates + search) | *amount* (editable, shown in grams and original units) | *confidence* chip (green ≥ 0.8, amber 0.5-0.8, red < 0.5 or unmatched) | *ignore* toggle (auto-on for "salt to taste", "for garnish", "optional"). A live per-serving nutrition label sits beside it (reuses `components/NutritionLabel.tsx`). Red rows must be resolved or ignored before saving.
3. Save. The recipe appears in search results with a "Recipe" badge and can be added to the plan like any food. The plan shows "1.5 servings (≈ 340 g)".

**Pipeline (`app/api/recipes/import-url/route.ts` → `lib/recipes/*`)**
1. **Fetch** server-side, user-initiated, single page. SSRF guard: https only, resolve DNS and block private/link-local ranges, ≤ 3 redirects, 5 s timeout, 3 MB cap, honest User-Agent. Don't cache the HTML.
2. **Extract schema.org/Recipe JSON-LD.** Parse every `<script type="application/ld+json">`. Handle `@graph`, arrays, and `@type` arrays (e.g., `["Recipe","NewsArticle"]`). Fall back to microdata. Use `name`, `recipeYield` (normalize "4", "4 servings", "Makes 12 cookies", or arrays), `recipeIngredient[]`, `nutrition` (cross-check only), `url`, `author`. Google requires `name` and `image` and recommends `recipeIngredient`; `recipeYield` is required when per-serving nutrition is given ([Google Recipe structured data](https://developers.google.com/search/docs/appearance/structured-data/recipe)). Most large recipe sites publish it for rich results.
3. **Fallback (no JSON-LD).** Strip to main text (Readability-style) and truncate to ~12k tokens. Ask **Claude Haiku 5.5** for `{title, yield, ingredientLines[]}` with structured outputs (`output_config.format` JSON schema). Cost: ~12k input tokens × $0.10/MTok + ~800 output × $0.50/MTok ≈ **$0.0016** per page.
4. **Parse ingredient lines.** A deterministic parser comes first: unicode fractions (½), mixed numbers, ranges ("2-3" → mean, keep range), unit dictionary (g, kg, oz, lb, cup, tbsp, tsp, ml, l, fl oz, pinch, clove, can, stick), parentheticals ("1 (14.5 oz) can"), prep and notes ("diced", "divided", "at room temp"). Output: `{qty, qtyMax?, unit, item, prep, optional}`. The open-source CRF parsers are good references and test corpora: NYT ingredient-phrase-tagger ([GitHub](https://github.com/NYTimes/ingredient-phrase-tagger)) and the Python `ingredient-parser` with per-token confidence ([docs](https://ingredient-parser.readthedocs.io/en/latest/explanation/usage.html)). Hand lines the parser can't handle to the LLM in step 5.
5. **Match to USDA foods.** For each `item`, FTS5 top-8 candidates with `data_type` boost (Foundation > SR Legacy > FNDDS), plus their `serving_sizes`. Then **one Haiku 5.5 call per recipe** returns, per line, `{candidateId | null, gramsEstimate, confidence, note}`. This disambiguates "chicken breast" (raw, skinless) vs "chicken, broilers, breast, roasted" and "1 can tomatoes". Input is ~15 lines × 8 candidates × ~40 tokens ≈ 6k tokens, so ≈ **$0.001** per recipe. Cache `(normalized item → foodId)` in `ingredient_aliases` so repeated ingredients skip the LLM. If FTS recall proves weak, precompute embeddings for the ~13k descriptions offline (Anthropic doesn't serve embeddings; use a provider such as Voyage AI or a local open model) and union the results with FTS.
6. **Convert to grams deterministically where possible.** Mass units are exact. Volume units use the matched food's `serving_sizes` volume labels ("1 cup" 227 g → tbsp = /16, tsp = /48). Count units ("1 large onion", "2 cloves") use serving labels ("1 large", "1 clove"). Only then fall back to the LLM's `gramsEstimate`, which is marked amber. Never trust LLM grams when a deterministic path exists.
7. **Compute nutrition.** `perServing[n] = Σ(grams_i × food_i[n] / 100) / servings`. Store `totalRawGrams` and `servingGrams = totalRawGrams / servings` (optional user-entered cooked weight overrides it). If JSON-LD `nutrition.calories` exists and differs by > 25%, show a non-blocking warning. Known gaps to explain in the UI: raw-vs-cooked yields, frying-oil absorption, and nutrient losses from cooking (USDA retention factors could be a later refinement).
8. **Recipes in the optimizer.** Generalize each LP variable to `{key, unitGrams, perUnitNutrients, perUnitCost}`. Foods use unitGrams = 100. Recipes use unitGrams = servingGrams, per-unit nutrients = perServing, and cost = Σ ingredient costs / servings, which makes recipes priced automatically once #2 lands. Default bounds: 0-2 servings per day. Offer **half-serving integrality** by modeling `halfServings` as `ints` (javascript-lp-solver supports integer variables) and dividing by 2. The client sends `{type:'recipe', id}` and the server loads the recipe for the authed user. For anonymous drafts, the client sends the computed vector, which the server validates (bounded values) and marks untrusted.

**Data model**
- DynamoDB `USER#<sub>` / `RECIPE#<ulid>`: `{title, sourceUrl, sourceDomain, importMethod:'url'|'paste'|'photo'|'manual', servings, servingGrams, totalRawGrams, ingredients:[{raw, qty, qtyMax, unit, item, prep, foodId, grams, confidence, userEdited, ignored}], perServing:{...33 nutrients}, costPerServing?, tags[], createdAt, updatedAt}`. Store **no instructions, headnotes, or photos**.
- `USER#<sub>` / `USAGE#2026-11`: `{urlImports, pasteImports, photoImports, llmInputTokens, llmOutputTokens}` for quotas and cost tracking (atomic `ADD`).
- SQLite (static, global): `ingredient_aliases(alias_norm TEXT PRIMARY KEY, food_id, hits)`. Improve it offline from anonymized, user-confirmed matches.

**API.** `POST /api/recipes/import-url {url}` → `{draft}` (not saved). `POST /api/recipes/parse-text {text}` → `{draft}`. `POST /api/ingredients/match {lines[]}` (powers re-match in the review UI). `POST /api/recipes` (save confirmed draft). `GET /api/recipes`. `GET/PUT/DELETE /api/recipes/:id`. `/api/optimize` accepts recipe items.

**Files that change.** `lib/optimizer.ts` (variable generalization; this is the biggest refactor, so coordinate with the optimizer-hardening agent). `lib/db.ts` (an `OptimizableItem` adapter). `components/SearchBar.tsx` / `FoodCard.tsx` (recipe badge, servings unit). New `components/RecipeImportDialog.tsx`, `components/IngredientReviewTable.tsx`, and `lib/recipes/{fetch,jsonld,parse-line,match,grams}.ts`. Unit tests should sit alongside `lib/optimizer.test.ts`, with a golden set of ~50 real recipe pages saved as fixtures in tests only.

**Legal note.** The US Copyright Office says "a mere listing of ingredients or contents, or a simple set of directions" is not copyrightable. Substantial literary expression (headnotes, narrative instructions, photos) and cookbook compilations can be ([Circular 33](https://www.copyright.gov/circs/circ33.pdf), [NYC Bar overview](https://www.nycbar.org/wp-content/uploads/2023/05/20221024-SecretIngredientsHowtoProtectRecipes_FINAL_22.6.6.pdf)). Policy: store the title, ingredient lines, derived nutrition, and a **prominent link back** ("View full recipe at seriouseats.com"). Do not store or display instructions or images. Fetch only when the user asks (no crawling or pre-caching). Honor removal requests. Don't build public recipe pages from imports, because sharing a recipe shares only facts and the link. Site terms of service can still forbid automated access. The user-initiated, single-fetch model with a "Paste ingredients" fallback keeps exposure low. Have counsel review before launch.

**Risks.** Anti-bot blocking (Cloudflare) on some large sites, mitigated by paste fallback and later a bookmarklet or share-sheet that sends JSON-LD from the user's browser. Match quality on long-tail ingredients (spice blends, branded sauces) is mitigated by amber/red UI and "ignore". Raw-vs-cooked errors are bounded and disclosed.

---

### 5.4 Recipe import by photo (#10), and the candid truth about plated meals (#18)

**User flow (recipe card / cookbook page)**
1. "Add recipe" → "Photo". Camera or upload, multiple pages allowed (≤ 4).
2. The client downscales to ≤ 1,568 px long edge and converts to JPEG (quality ~85), then uploads to S3 through a presigned URL. Raw photos never pass through the Next.js server.
3. The server calls Claude with the image(s) and returns the same **draft → review screen** as URL import. Each line also carries `ocrConfidence`, and the original photo shows side by side with tap-to-highlight lines.
4. The user corrects and saves. The image is deleted after 24 h unless the user opts to keep it.

**Model choice and request shape**
- **Default: `claude-haiku-5-5`** for printed pages. **Escalate to `claude-sonnet-5-5`** when Haiku reports `handwritten: true`, when mean line confidence is < 0.7, or when the user taps "Try harder". Handwritten cards are where the larger model earns its cost.
- Use **structured outputs** (`output_config.format` with a JSON schema: `{title, servings, servingsConfidence, handwritten, lines:[{text, qty, unit, item, prep, confidence}], unreadableRegions:[]}`). Alternatively use a `strict: true` tool with `tool_choice: auto`. **Forced `tool_choice` (`any`/`tool`) returns a 400 on Claude Sonnet 5.5**, so don't design around it. Always check `stop_reason` (`refusal`, `max_tokens`) before parsing. Enable the server-side `fallbacks: "default"` option for Sonnet 5.5 on the Claude API. Then run the result through steps 4-8 of the URL pipeline (parse, match, grams, nutrition).
- Images cost `⌈w/28⌉ × ⌈h/28⌉` visual tokens. Claude 4.7-and-later models accept up to 2,576 px / 4,784 tokens ([Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)). Downscaling to 1,568×1,176 gives **~2,350 tokens** per page and keeps printed text legible.

**Estimated cost per import** (list prices: Haiku 5.5 $0.10 in / $0.50 out per MTok; Sonnet 5.5 $2 / $10)

| Path | Input tokens | Output tokens (incl. thinking) | Cost |
|---|---|---|---|
| Haiku 5.5 OCR + Haiku match | ~3.6k + ~6k | ~2k + ~1.5k | **≈ $0.003** |
| Sonnet 5.5 OCR + Haiku match | ~3.6k + ~6k | ~2.5k + ~1.5k | **≈ $0.035** |
| URL import with LLM fallback + match | ~12k + ~6k | ~0.8k + ~1.5k | ≈ $0.003 |
| URL import with JSON-LD + match only | ~6k | ~1.5k | ≈ $0.001 |

**Quotas.** Free: 5 URL/paste imports and 3 photo imports per month. Premium: unlimited URL/paste (fair use 200) and 50 photo imports per month. Worst case is ~$1.75/user/month if all 50 escalate to Sonnet; the expected case is under $0.25. Enforce quotas in `USAGE#yyyy-mm` with a conditional update *before* calling the model. Log real `usage` from each response to recalibrate. Add a global daily spend circuit-breaker.

**Plated meal photos: be candid.** A 2025 evaluation on 52 standardized food photos found ChatGPT and Claude at roughly **36-37% mean absolute percentage error for both weight and energy**, with Gemini much worse ([Fridolfsson et al. 2025, PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12513282/)). Other work shows that supplying the true weight cuts error to ~20-27%, so **portion size is the bottleneck** ([arXiv 2507.07048](https://arxiv.org/abs/2507.07048v2)). Hidden fats (oil, butter, dressings) can't be seen at all. Product decisions:
- Position it only as quick entry for **"plan the rest of my day"** (#11). Never use it as a precise log, and never feed it to the optimizer as a guaranteed food without confirmation.
- The UI shows detected components, each with a **portion slider anchored to household units** ("about 1 cup rice"), plus a ±35% range on the totals. Ask "Was anything cooked in oil or butter?" explicitly.
- Ship it as Premium "beta". Measure the user edit rate. If the median user changes more than half the components, keep it as a beta or remove it.

**Data model.** Same `RECIPE#` entity with `importMethod: 'photo'` and `imageKey` (S3, 24 h lifecycle rule). Plated-meal estimates are `USER#<sub>` / `MEAL#<date>#<ulid>`: `{components:[{foodId, grams, confidence, userEdited}], estimatedRange}`.

**API.** `POST /api/uploads/presign` → `{key, url}`. `POST /api/recipes/import-image {keys[]}` → `{draft}`. `POST /api/meals/estimate-photo {key}` → `{components}`.

**Risks.** Cost abuse (mitigated by quotas, circuit breaker, auth required for photo). Privacy of uploaded photos (short retention, no training use, people in the frame). Cookbook page copyright (same facts-only storage policy as URL import; never store page images long-term). Model refusals or empty reads on low-light photos (client-side blur/brightness check before upload).

---

### 5.5 Week planner with variety + grocery list (#8, with #4 realism and #17 checkout)

**User flow**
1. From a good daily plan: "Plan my week". Options: days (default 7), meals per day (2-4), max times any one food or recipe repeats (default 3/week), "cook once, eat twice" leftovers (on), "Use my pantry" (#15).
2. Result: a calendar grid. Each day shows breakfast/lunch/dinner/snack slots with items and servings, a day total of $ and kcal, and a "week coverage" bar per nutrient. Users can lock any item and **re-roll** the rest.
3. **Grocery list**: week totals per food, converted to purchase units ("1.2 kg chicken breast ≈ 2.6 lb", "1 bunch broccoli"). Grouped by `food_category` (produce, meat, dairy, grains, ...). Pantry stock is subtracted. Each line has a check-off box. Export as copy-text, CSV, print view, or **"Shop with Instacart"** (Public API `products_link` with `line_items` returns a shoppable URL that carries affiliate params) ([Instacart shopping list](https://docs.instacart.com/developer_platform_api/guide/concepts/shopping_list)).

**Model (MILP)**
- Variables: `x[i,d]` = units of item *i* on day *d*. Binary `y[i,d]` = item used on day *d*.
- Linking: `x[i,d] ≤ maxUnits_i · y[i,d]` and `x[i,d] ≥ minPortion_i · y[i,d]` (semi-continuous). This is the realism fix from #4: "zero or at least a sensible portion".
- Variety: `Σ_d y[i,d] ≤ maxRepeats`. Per-day distinct items ≥ k. Per-category daily caps (e.g., ≤ 1 organ-meat item, ≤ 300 g starchy staples).
- Nutrients: **daily** constraints for energy, protein, sodium, and fiber. **Weekly-average** constraints for nutrients the body stores (vitamins A, D, E, K, B12, folate) and for iron and zinc where intake varies day to day. This is nutritionally defensible, and it greatly enlarges the feasible set, which lowers cost.
- Leftovers: recipe servings cooked on day *d* can be consumed on *d* or *d+1* (a cooked-batch variable plus a flow constraint).
- Objective: cost (or blend), plus a small penalty on repeated items for variety.
- Solver: ~30 items × 7 days gives ~210 integers plus ~210 binaries. That's beyond what `javascript-lp-solver` reliably handles quickly. Use **HiGHS compiled to WebAssembly** (`highs` on npm, MIT, CPLEX-LP text input, Node ≥ 18 and browsers) ([npm](https://npmjs.com/package/highs), [GitHub](https://github.com/coder0xff/highs-js)). Run it in a Web Worker for anonymous preview and in the Lambda for saved plans, with a 10 s time limit and a 1% MIP gap. Keep `javascript-lp-solver` for the instant daily solve.

**Data model**
- DynamoDB `USER#<sub>` / `WEEKPLAN#<isoWeek>#<ulid>`: `{settings, days:[{date, meals:[{slot, items:[{type, id, units, grams, cost}]}]}], totals, coverage, solver:{status, gap, ms}, locked:[...]}`
- `USER#<sub>` / `GROCERY#<weekplanId>`: `{lines:[{foodId, grams, purchaseUnits, category, checked}], exportedAt}`
- `USER#<sub>` / `PANTRY#<foodId>`: `{grams, updatedAt, expiresOn?}`

**API.** `POST /api/plans/week` (Premium-gated; returns the plan). `POST /api/plans/week/:id/reroll {locked[]}`. `GET /api/plans/week/:id/grocery-list?format=json|csv`. `POST /api/plans/week/:id/instacart` → `{url}`.

**Files that change.** New `lib/week-optimizer.ts` (an LP-text builder for HiGHS that shares the constraint builder with `lib/optimizer.ts`, so factor out `buildConstraints()`). New `lib/grocery.ts` (unit conversion using `serving_sizes`). New components `WeekGrid`, `GroceryList`. Stripe entitlement check in the route (from the infra track).

**Risks.** Solve-time variance (time limit, return best feasible, show "good plan, not proven optimal"). Purchase-unit conversion for produce (rely on serving labels, round up, and show grams). Instacart key access is per-endpoint and approval-based for Partner features. Repetitiveness complaints (Eat This Much's main criticism) are addressed directly by variety constraints and re-roll, and they're worth measuring (section 6).

---

### Brief specs for the remaining "Now" items

- **Realistic portions (#4), daily solver.** Add per-food `minPortionGrams` (default = 0.5 × reference serving) as a semi-continuous constraint via a binary (`javascript-lp-solver` supports `binaries`). Round results to the nearest household unit from `serving_sizes` ("1 cup + 2 tbsp"). Re-check targets after rounding and show any that slipped. "Why this food?" shows the top 2 nutrients each food contributes most to, relative to target, computed from `optimizedDiet[].nutrients`.
- **Plan the rest of my day (#11).** A button: "I already ate..." Search or quick-add items, which become `guaranteedFoods`. Re-optimize with the remaining targets. The existing optimizer already subtracts guaranteed nutrients, so this is mostly UI.
- **Onboarding presets (#12).** 3-4 curated food lists (stored as JSON of `fdc_id`s) plus objective settings. Each yields a feasible plan out of the box for the default profile. Test every preset in `optimizer.test.ts` so data refreshes don't break them.
- **Export (#13).** Print stylesheet, CSV of the plan, copy-as-text. Share links (Next phase): `SHARE#<slug>` snapshot with a 90-day TTL, read-only page, no personal data.
- **Barcode (#14, Later).** Prefer ingesting the USDA **Branded Foods** bulk download (`gtin_upc` column) into a separate SQLite table. Fall back to Open Food Facts live lookups, which allow 15 product reads/min/IP and 10 searches/min ([OFF API docs](https://openfoodfacts.github.io/openfoodfacts-server/api/)), so call OFF from the user's browser to spread load. OFF data is ODbL (share-alike on derived databases), so keep OFF-sourced items per-user and attributed. FDC's API is limited to 1,000 requests/hour/IP ([FDC API guide](https://fdc.nal.usda.gov/api-guide)), so bulk download beats the API. Camera scanning: the native `BarcodeDetector` exists in Chromium-based browsers, with a WASM/JS decoder (e.g., ZXing) as fallback for Safari.

---

## 6. Metrics to track

Instrument with a privacy-respecting product analytics tool. **Never put profile or health fields (weight, pregnancy, allergies) in analytics events.** Send only derived buckets where needed.

**Activation (first session)**
- Time to first successful plan (target: median < 90 s; presets should get under 60 s).
- % of new visitors who reach "See plan" with a **feasible** result. Track the infeasible rate separately, by preset vs custom. Today's diagnostics text is the main "save" for infeasible cases.
- % who complete the profile (#1), and whether personalized targets reduce the infeasible rate vs label DVs. This is the key validation of #1.
- % of plans run in cost mode, and median $/day shown.

**Engagement & retention**
- W1 / W4 return rate (anonymous via localStorage ID; accounts via user ID).
- Plans saved per user; plans re-opened; "plan the rest of my day" uses per week.
- Recipes imported per user (URL / paste / photo) and **import quality**: % of lines auto-matched at ≥ 0.8 confidence, edits per recipe, abandon rate on the review screen. Target: ≥ 80% lines green, < 3 edits per recipe.
- Week plans generated per weekly active user; re-roll count per plan (high = poor variety or palatability); grocery list exports and Instacart clicks.
- Plan quality: thumbs up/down "Would you eat this?" on each plan; portion edits after solving.

**Conversion & monetization**
- Paywall views → trial starts → paid (by trigger: week planner, import quota, saved-plan limit).
- Free → Premium conversion at 30 days; monthly vs annual mix; churn at month 1/3.
- Instacart affiliate revenue per WAU.

**Cost & reliability**
- LLM $ per active user per month and per import (from logged `usage`). Escalation rate Haiku → Sonnet.
- Optimizer p95 latency (daily LP, weekly MILP), MILP time-limit hits.
- Import failure reasons (blocked fetch, no JSON-LD, parse failure, refusal).

---

## 7. Sources

Competitors and pricing: [Cronometer Gold](https://cronometer.com/gold) · [Fortune Cronometer review](https://fortune.com/article/cronometer-review/) · [Cronometer Nutrient Oracle help](https://support.cronometer.com/hc/en-us/articles/360018510531) · [Cronometer forum on verified DB](https://forums.cronometer.com/discussion/comment/11662/) · [lifestack Cronometer vs MFP](https://lifestack.ai/blog/cronometer-vs-myfitnesspal) · [Droid Life: MFP barcode paywall](https://www.droid-life.com/2022/08/24/myfitnesspal-puts-barcode-scanner-behind-premium-paywall/) · [unstar MFP review analysis](https://unstar.app/fr/blog/is-myfitnesspal-premium-worth-it-paywall-app-reviews-2026) · [nutriscan MFP pricing](https://nutriscan.app/en/blog/posts/myfitnesspal-pricing-2026-guide-2ff09c399a) · [MacroFactor subscriptions](https://help.macrofactorapp.com/en/articles/393-how-macrofactor-subscriptions-and-bundles-work) · [Eat This Much review 2026](https://www.promealplan.com/en/blog/eat-this-much-review-2026) · [stork.ai Eat This Much](https://www.stork.ai/en/eat-this-much) · [CNN Underscored meal planners](https://amp.cnn.com/cnn/cnn-underscored/reviews/best-meal-planning-apps) · [r/EatThisMuch](https://lr.us.psf.lt/r/EatThisMuch) · [Lose It pricing tracker](https://apppricinglab.com/app/apple/297368629) · [Yazio listing](https://appfollow.io/ios/yazio-calorie-counter-diet/946099227?country=ca) · [Samsung Food App Store](https://apps.apple.com/us/app/-/id1133637674) · [Samsung Food+ price](https://hub.netzgemeinde.eu/@gadgeteer?cat=meals) · [Paprika pricing](https://apppricinglab.com/app/apple/1303222868) · [fitia nutrition apps](https://fitia.app/en/learn/article/best-personalized-nutrition-apps-2025/)

Science and standards: [NASEM DRI for Energy 2023](https://www.nationalacademies.org/read/26818/chapter/2) · [Frankenfield 2005 RMR equations](https://pure.psu.edu/en/publications/comparison-of-predictive-equations-for-resting-metabolic-rate-in-/) · [NIH ODS nutrient recommendations / DRI tables](https://ods.od.nih.gov/HealthInformation/nutrientrecommendations) · [USDA NAL DRI calculator](https://www.nal.usda.gov/fnic/interactiveDRI/) · [Google OR-Tools Stigler diet](https://developers.google.com/optimization/lp/stigler_diet) · [Garille & Gass 2001](https://Www.Gwern.net/doc/statistics/decision/2001-garille.pdf) · [Fridolfsson et al. 2025 LLM food-image estimation](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12513282/) · [arXiv 2507.07048](https://arxiv.org/abs/2507.07048v2)

Data and APIs: [ERS Purchase to Plate](https://www.ers.usda.gov/data-products/purchase-to-plate) · [ERS PP documentation](https://www.ers.usda.gov/data-products/purchase-to-plate/documentation) · [FoodData Central API guide](https://fdc.nal.usda.gov/api-guide) · [FDC downloads](https://fdc.nal.usda.gov/download-datasets) · [Open Food Facts API](https://openfoodfacts.github.io/openfoodfacts-server/api/) · [Kroger Products API mirror](https://www.val.town/x/bgschiller/personalShopper/code/docs/kroger-products.md) · [kroger-api wrapper](https://github.com/CupOfOwls/kroger-api) · [Instacart Developer Platform docs](https://docs.instacart.com/developer_platform_api/) · [Instacart shopping list concept](https://docs.instacart.com/developer_platform_api/guide/concepts/shopping_list) · [Digital Commerce 360 on IDP](https://www.digitalcommerce360.com/2024/03/27/instacart-api-idp-developer-platform/) · [WIOpy Walmart wrapper](https://pypi.org/project/WIOpy/) · [Claude vision docs (image token math)](https://platform.claude.com/docs/en/build-with-claude/vision) · [highs npm](https://npmjs.com/package/highs) · [highs-js](https://github.com/coder0xff/highs-js) · [NYT ingredient-phrase-tagger](https://github.com/NYTimes/ingredient-phrase-tagger) · [ingredient-parser docs](https://ingredient-parser.readthedocs.io/en/latest/explanation/usage.html) · [Google Recipe structured data](https://developers.google.com/search/docs/appearance/structured-data/recipe) · [HealthKit web access](https://rapidevelopers.com/v0-integrations/healthkit)

Legal and privacy: [US Copyright Office Circular 33](https://www.copyright.gov/circs/circ33.pdf) · [NYC Bar: protecting recipes](https://www.nycbar.org/wp-content/uploads/2023/05/20221024-SecretIngredientsHowtoProtectRecipes_FINAL_22.6.6.pdf) · [FTC Health Breach Notification Rule (Federal Register 2024)](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule)

Claude model prices used above: Haiku 5.5 $0.10/$0.50 and Sonnet 5.5 $2/$10 per million input/output tokens (Anthropic first-party list prices as of Oct 2026; re-check at build time).
