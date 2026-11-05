# Contaminant data: research notes

Research behind the contaminant panel, as of November 2026. It covers what public data exists, what we shipped, what we left out and why. The user-facing methodology is in [CONTAMINANT_DATA.md](../CONTAMINANT_DATA.md).

## Recommendation

**Ship now:** FDA Total Diet Study elements, FDA fish mercury, FDA rice arsenic, USDA Pesticide Data Program, and EPA reference doses. All are US government data and can be reused freely. Microplastics ship as a clearly labelled, limited-data comparison, because no health-based limit exists.

**Ship later:** FDA's FY2021-2022 Total Diet Study results and FY2018-2020 pesticide results, when they become downloadable. See [What to do next](#what-to-do-next).

**Don't use:** Consumer Reports or EWG rankings. See [Rejected sources](#rejected-sources).

## Datasets

### Shipped

| Dataset | Coverage | Units | Years | Reuse | Main limits |
|---|---|---|---|---|---|
| [FDA Total Diet Study, elements](https://www.fda.gov/food/fda-total-diet-study-tds/fda-total-diet-study-tds-results) | 307 foods, 3,276 samples. We keep 244 foods after dropping baby foods, which aren't in our database. Measures lead, cadmium, mercury and total arsenic. Inorganic arsenic in only 54 samples. | ppb | FY2018-2020 | Public domain | Regional foods have about 27 samples, national foods often only 3. Foods are mostly prepared as eaten. |
| [FDA mercury in fish](https://www.fda.gov/food/environmental-contaminants-food/mercury-levels-commercial-fish-and-shellfish-1990-2012) | 68 species, with mean, median, range and sample count | ppm | 1990-2012 | Public domain | Old. Some species rely on a 1978 fisheries report. |
| [FDA rice risk assessment](https://www.fda.gov/files/food/published/Arsenic-in-Rice-and-Rice-Products-Risk-Assessment-Report-PDF.pdf), Table 4.2 | 12 rice types, 481 samples, inorganic arsenic | ppb, uncooked | 2013-2016 | Public domain | Doesn't cover rice products in ppb. Some types have 1 or 2 samples. |
| [USDA Pesticide Data Program](https://www.ams.usda.gov/datasets/pdp/pdpdata) | 94 commodities after dropping baby foods, 302 pesticides detected, about 10,000 samples a year | ppm, ppb, ppt | 2016-2024 | Public domain | Commodities rotate, so some data is old (fresh strawberries and spinach were last tested in 2016). Tests raw commodities, not cooked food. |
| [EPA Human Health Benchmarks](https://www.epa.gov/system/files/documents/2021-07/hh-benchmarks-table-2021.pdf) | Chronic and acute doses for about 400 pesticides | mg/kg/day | 2021 | Public domain | Leaves out pesticides covered by drinking water standards. |
| [EPA Drinking Water Tables](https://www.epa.gov/system/files/documents/2022-01/dwtable2018.pdf) | Reference doses for the pesticides the benchmarks leave out | mg/kg/day | 2018 | Public domain | Some values are decades old. |

### Microplastics

Science here is young, and the numbers are not comparable across studies. For bottled water alone, published means run 3.57, 94.37 and about 240,000 particles per liter, depending on method. We never average across studies. Each food uses one named study, with other results in its notes.

| Source | What we used | Limits |
|---|---|---|
| [Cox et al. 2019](https://doi.org/10.1021/acs.est.9b01517), Environ Sci Technol 53(12):7068 | Salt 0.11/g, sugar 0.44/g, honey 0.10/g, bottled water 94.37/L, seafood 1.48/g (small whole fish only) | The authors call their sugar and honey values likely overestimates. We couldn't open Table S1, so study counts for some foods are unknown. |
| [Kosuth et al. 2018](https://doi.org/10.1371/journal.pone.0194970), PLoS ONE 13(4):e0194970 | Tap water 5.45/L (159 samples), beer 4.05/L (12 brands) | Staining and visual inspection, not chemical confirmation. |
| [Milne et al. 2024](https://doi.org/10.1016/j.envpol.2023.123233), Environ Pollut 343:123233 | 16 protein products, 111 samples, particles of 45 µm and larger | Standard deviations often exceed means. 72% of particles were fibers of unknown or cellulose base. Four authors work at Ocean Conservancy, an advocacy group. |
| [Danopoulos et al. 2020](https://doi.org/10.1289/EHP7171), Environ Health Perspect 128(12):126002 | Clams 1.25/g, mussels 0.71/g, oysters 0.42/g, scallops 0.48/g, all mollusks 0.78/g | Many fish studies measured the gut, which most people don't eat. |

Not used: [Qian et al. 2024](https://doi.org/10.1073/pnas.2300582121), about 240,000 particles/L in bottled water, about 90% of them nanoplastics. A published letter in the same journal calls the quantification unreliable because the procedural blank had similar plastic levels, and the authors dispute this. The figure appears only in the bottled water notes, labelled as disputed.

**No regulator sets a limit.** FDA: "Current scientific evidence does not demonstrate that levels of microplastics or nanoplastics detected in foods pose a risk to human health." EFSA 2016: "Toxicity and toxicokinetic data are lacking for both microplastics and nanoplastics for a human risk assessment." WHO 2022: "The available data do not allow firm conclusions on the risks to human health of inhalation or ingestion of NMP." We didn't search for regulator assessments after July 2024, so check before relying on this.

Particle counts aren't mass or risk. Cox et al. themselves write that "any recommendations to reduce or avoid certain food groups to minimize MP exposure would currently be unfounded."

**Reuse:** we publish numeric values with attribution, not the papers' text or tables. Milne is CC BY-NC-ND and the site plans paid features, so the owner may want legal advice on that one source. It can be removed by deleting its rows from `microplastics.tsv`.

### Rejected sources

- **Consumer Reports** and **EWG's Shopper's Guide**: rankings derived from other data, with EWG drawing on USDA and FDA testing. We tried to read both sets of reuse terms and couldn't (the pages returned 403 and 404), so we didn't assume reuse was allowed. We don't need them, since the underlying public data is available directly.
- **FDA TDSi dashboard** (FY2021-2022): a QuickSight dashboard with no stable bulk file, so it can't be pinned or rebuilt.
- **FDA TDS pesticides, FY2018-2020**: still marked "coming soon" on FDA's site.
- **TDS 1991-2017**: superseded by the newer TDS data and PDP.

## Reference values

Each value below was read from the issuing agency's page or document. Where agencies disagree, we show the alternatives in the panel's details.

| Contaminant | Used | Why | Alternatives shown |
|---|---|---|---|
| Lead | [FDA IRL](https://www.fda.gov/food/environmental-contaminants-food/lead-food-and-foodwares): 8.8 µg/day, women of childbearing age | FDA's own yardstick for food. FDA publishes none for other adults. FDA also says no safe level is known, so the panel never implies 100% is safe. | Children: 2.2 µg/day |
| Cadmium | [FDA TRV](https://www.fda.gov/food/environmental-contaminants-food/cadmium-food-and-foodwares): 0.21 µg/kg/day, the lower end of FDA's 0.21-0.36 range (16.8 µg/day at 80 kg) | FDA's current value. Its October 2026 draft baby-food action levels use the same lower bound. | EFSA TWI: 2.5 µg/kg/week |
| Mercury | [EPA RfD](https://iris.epa.gov/ChemicalLanding/&substance_nmbr=73): 0.1 µg/kg/day as 0.7 µg/kg/week (52.5 µg/week at 75 kg) | The basis of FDA/EPA fish advice, which uses 75 kg. A daily meter would contradict that advice: a Best Choices serving is 226% of a daily figure but 32% of a weekly one. | EFSA TWI: 1.3 µg/kg/week |
| Inorganic arsenic | [EPA IRIS 2025](https://iris.epa.gov/ChemicalLanding/&substance_nmbr=278): 0.06 µg/kg/day (4.8 µg/day at 80 kg) | The only current US non-cancer value. | ATSDR 2007: 0.3 µg/kg/day |
| Pesticides | EPA chronic population-adjusted dose, or reference dose, per pesticide | The dose EPA uses for dietary risk. We don't use tolerances: EPA describes a tolerance as "the residue level that triggers enforcement actions". | None |

**The arsenic choice matters most.** There is a fivefold spread between EPA's 2025 value and ATSDR's 2007 value, and it decides how rice reads: a cup of cooked brown rice is about 220% of EPA's value but about 44% of ATSDR's. We chose EPA as the most current and most protective. It is a cautious value, as EPA estimates typical US background intake is already about 61% of it. Search snippets suggest EPA's Science Advisory Board questioned whether a reference dose is supportable, but we couldn't open that report, so treat this as unconfirmed. If the owner prefers a less cautious yardstick, it's a one-line change to `is_default` in `reference_values.tsv`.

**Body weight:** 80 kg for US adults ([EPA Exposure Factors Handbook](https://www.epa.gov/sites/default/files/2015-09/documents/efh-chapter08.pdf)), 75 kg for mercury to match the fish advice. EFSA's default of 70 kg would raise percentages about 14%.

**Action levels aren't used for the meter.** [FDA's lead action levels for baby food](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-action-levels-lead-processed-food-intended-babies-and-young-children) (10 and 20 ppb) and arsenic levels for infant rice cereal and apple juice (100 and 10 ppb) are enforcement tools for specific products, not intake limits. FDA has no chocolate-specific lead level.

## Data model

Measurements live at the level the source measured them, and foods only hold a pointer.

```
contaminant_sources            citation, URL, retrieval date, license
contaminants                   lead, cadmium, each pesticide, microplastics
contaminant_reference_values   value, period, population, basis, authority
contaminant_profiles           a TDS food, PDP commodity, fish species, rice type
contaminant_measurements       one row per profile x contaminant: mean, upper bound, range, samples, years
food_contaminant_profiles      USDA food -> profile, with method, confidence, moisture factor, caveat
```

Current counts: 441 profiles, 4,869 measurements, and 6,658 links covering 4,402 of 9,435 foods. The largest share of those links are many cuts of beef, pork and lamb pointing at a few measured meats. Whole egg in every size and cooking method points at one profile, `tds:37`, which 38 foods share.

The tables add about 1.4 MB to `nutrition.db`.

## Mapping rules

Rules live in `scripts/contaminants/mapping_rules.py`. A food gets at most one profile per source family, and the first matching rule wins.

| Method | Promise | Example | Confidence |
|---|---|---|---|
| `exact` | The food is the item measured | "Egg, whole, cooked, hard-boiled" -> "Eggs, hard-boiled" | 0.95+ |
| `description_rule` | Same food in another variety, brand or preparation | "Eggs, Grade A, Large, egg whole" -> "Eggs, hard-boiled" | 0.6-0.92 |
| `category` | A wider group represented by one measured member | "Cheese, blue" -> cheddar | 0.4-0.72 |
| `manual` | Hand-assigned one-off. No current rule uses it. | | as stated |

Deliberately left without data, because a nearby measurement would mislead:

- **Organ meats.** Liver and kidney concentrate cadmium, so muscle meat is a poor stand-in.
- **Mixed dishes** from FNDDS, unless TDS measured that dish. "Rice, white, with chicken" isn't plain rice.
- **Concentrated forms without a moisture reference**, such as cake mixes and gravy powders (39 foods). An unscaled number would understate them.

### Cooked versus raw

TDS mostly tests foods as eaten, while USDA lists raw, dried and cooked forms. Contaminants stay with the food's solids and water dilutes them, so a gram of dry rice holds far more than a gram of cooked rice.

We scale by fat-free dry matter: `(100 - water - fat)` for this food, divided by the same figure for the measured form. Metals bind to protein and minerals rather than fat, so counting fat would inflate fatty cuts. Scaling is skipped when:

- the factor is between 0.8 and 1.25, within measurement noise
- the description mentions added sugar, since those solids carry no contaminant
- the source is fish mercury or PDP. PDP tests the raw commodity, and residues don't concentrate predictably.

853 links are scaled, each capped at 0.1 to 12 times. As a check, long-grain white rice at 45 g dry gives 4.6 µg of inorganic arsenic, matching FDA's published 4.6 µg per serving exactly. Cooked rice scales to about 5.8 µg in 158 g. This ignores losses during cooking, such as the 40-60% FDA found from cooking rice in plenty of water, which the panel notes.

### Spot check

We read through every profile's matches and fixed what looked wrong: ham spreads under whole ham, pork backfat under pork chops, turkey bacon under bacon, "cola without caffeine" under diet cola. A pseudo-random sample of the results afterward, all reasonable:

| Food | Profile | Method | Confidence |
|---|---|---|---|
| Peppers, bell, orange, raw | `tds:125` green bell pepper | rule | 0.88 |
| Fish, salmon, coho, wild, raw | `tds:318` baked salmon | rule | 0.88 |
| Pork, Leg sirloin tip roast, boneless | `tds:18` pork chop | category | 0.72 |
| Broccoli, frozen, chopped, unprepared | `tds:113` boiled broccoli | rule | 0.90 |
| Cheese, blue | `tds:12` cheddar | category | 0.50 |
| M&M's MINIs Milk Chocolate Candies | `tds:187` milk chocolate bar | rule | 0.82 |
| SILK Light Vanilla, soymilk | `tds:506` soy beverage | rule | 0.85 |
| Beef, plate steak, inside skirt | `tds:334` loin steak | category | 0.72 |
| Corn, sweet, yellow, canned, drained | `tds:55` canned corn | rule | 0.92 |

## Known weak spots

- **Dark chocolate** uses one cocoa powder sample as an upper estimate, at confidence 0.4, and reads high with a "Rough estimate" tag. FDA has no dark chocolate data in the elements file.
- **Many TDS foods have 3 samples.** The panel labels these "Rough estimate".
- **Old pesticide data.** Fresh strawberries and spinach are from 2016. The panel says so.
- **Old reference doses.** Some EPA values date from the 1980s. DCPA's is known to be out of date: EPA [cancelled it in 2024](https://www.epa.gov/newsreleases/epa-finalizes-cancellation-pesticide-dacthal) over fetal thyroid risk, and the panel notes this.
- **DDT's dose stands in for DDE and DDD.** Those are breakdown products without their own IRIS value here.
- **About 2% of pesticide detections have no reference dose** in our tables, and aren't counted in the meter. The panel says how many.
- **Adding pesticide shares is a simplification.** EPA combines only pesticides that act the same way, so our sum is cautious.
- **FDA/EPA's fish list is the authority for fish advice.** We derive the meter from mercury levels and don't reproduce the list. FDA moved some species between categories (carp, for example, is a Good Choice despite a mean of 0.11 ppm).

## What to do next

1. Add FY2021-2022 TDS results if FDA publishes a bulk file.
2. Add a page on the site for the methodology. The panel links to the document on GitHub for now.
3. Add a children's view, since the lead level for children is a quarter of the adult one. The panel currently shows that figure only in the details.
4. Estimate mixed dishes from their ingredients. This needs recipe data, which the recipe analyzer may provide.
