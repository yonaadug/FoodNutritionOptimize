# How we show contaminants in food

> Customers read this at `/methodology` on the site (`food-nutrition-app/app/methodology/page.tsx`). Change both together: `lib/methodology.test.ts` fails if a section or source here is missing from the page.

Most foods contain traces of metals, and many have pesticide residues. On each food page, NutritionDictionary shows how much one serving typically contains, using public testing data, so you can compare foods without reading raw numbers.

**This is general information, not medical advice.** It shows typical levels, not what's in any one package. If you're pregnant, feeding young children or have health concerns, talk to your clinician.

## How to read a meter

Each meter compares one serving with a health-based reference from a public agency. It updates when you change the serving size.

| Level | Lead, cadmium, arsenic, pesticides (share of a **day's** reference) | Mercury (share of a **week's** reference) | Microplastics (particles per serving, **not a safety rating**) |
|---|---|---|---|
| Low | under 10% | under 10% | under 10 |
| Moderate | 10% to under 25% | 10% to under 33% | 10 to under 50 |
| Elevated | 25% to under 50% | 33% to under 100% | 50 to under 200 |
| High | 50% or more | 100% or more | 200 or more |

**Why these lines?** You eat many foods in a day, so a single serving that uses half a day's reference counts as high. These lines are our own judgment and don't come from an agency.

**Why is mercury weekly?** Mercury leaves the body slowly, and most people don't eat fish daily. Our mercury lines match the FDA/EPA fish advice: a 4 oz serving at the top of their "Best Choices" group is 32% of the week, and at the top of "Good Choices" is 99%.

**A low reading doesn't mean none, and a high reading doesn't mean harm.** Reference levels are cautious planning values, not a line between safe and harmful. FDA says no safe level of lead exposure is known. Exposure adds up across everything you eat, over time. Eating a variety of foods is the most practical way to limit it.

## What each row can say

- **A level** (low to high): we have measurements for this food or a close match.
- **Not detected:** testing found none, down to the test's limit. Tiny amounts can't be ruled out.
- **Not rated:** we show the amount without a judgment. This applies to total arsenic in seafood, which is mostly organic forms considered far less harmful.
- **No data:** nobody has published testing we could match to this food. That tells you nothing either way, and we never show it as zero.
- **Rough estimate:** the number rests on few samples, a loose match or old data.

## Reference levels

| Contaminant | Reference | Set by | Notes |
|---|---|---|---|
| Lead | 8.8 µg per day | [FDA](https://www.fda.gov/food/environmental-contaminants-food/lead-food-and-foodwares), 2022 | Set for women of childbearing age. FDA's level for children is lower, at 2.2 µg per day. Details show both. |
| Cadmium | 0.21 µg per kg of body weight per day | [FDA](https://www.fda.gov/food/environmental-contaminants-food/cadmium-food-and-foodwares), 2023 | Lower end of FDA's range. |
| Mercury | 0.1 µg per kg per day, shown per week | [EPA](https://iris.epa.gov/ChemicalLanding/&substance_nmbr=73), 2001 | Basis of the [FDA/EPA fish advice](https://www.fda.gov/food/metals/technical-information-development-fish-consumption-advice-fdaepa-advice-what-pregnant-women-and). Treats all mercury as methylmercury, as they do. |
| Inorganic arsenic | 0.06 µg per kg per day | [EPA](https://iris.epa.gov/ChemicalLanding/&substance_nmbr=278), 2025 | Covers non-cancer effects only, and EPA also classes inorganic arsenic as a carcinogen. This value is cautious: EPA estimates typical US intake is already about 61% of it. Details also show the older [ATSDR](https://wwwn.cdc.gov/TSP/MRLS/mrlsListing.aspx) value, five times higher. |
| Pesticides | EPA's dose for each pesticide | [EPA 2021](https://www.epa.gov/system/files/documents/2021-07/hh-benchmarks-table-2021.pdf), [EPA 2018](https://www.epa.gov/system/files/documents/2022-01/dwtable2018.pdf), [EPA IRIS](https://iris.epa.gov/ChemicalLanding/&substance_nmbr=147) | See below. |

We assume an 80 kg adult, or 75 kg for mercury to match the fish advice. A lighter person's share is higher.

### Pesticides

USDA tests samples for hundreds of pesticides. For each food, we take the average level of each pesticide across all samples, counting samples without it as zero, and work out its share of EPA's reference dose. The meter adds those shares together. That's cautious, since EPA combines only pesticides that act the same way.

We don't compare with legal tolerances. EPA describes a tolerance as the level that triggers enforcement, so it isn't a health limit. Details still show how many samples went over one. Across all foods in 2024, [USDA reports](https://www.ams.usda.gov/sites/default/files/media/PDPAnnualSummary.pdf) that over 99% of samples were below tolerances and 42.3% had no detectable residue.

USDA washes or peels produce as you would at home before testing. Cooking and processing can change residues, and we don't adjust for that. Some foods were last tested years ago, and the details say when.

### Arsenic

Most testing measures total arsenic, which mixes the more harmful inorganic form with far less harmful organic forms.

- **Rice:** we use FDA's measurements of inorganic arsenic by rice type.
- **Seafood:** the arsenic is mostly organic, so we show the amount without a rating.
- **Other foods:** we count all of the arsenic as inorganic. The real figure is probably lower, so these rows say "at most".

**Rice often reads high.** That's mainly because EPA's reference is so cautious, and FDA doesn't advise avoiding rice. FDA found that [cooking rice in plenty of water](https://www.fda.gov/food/environmental-contaminants-food/what-you-can-do-limit-exposure-arsenic) and draining it removes 40-60% of inorganic arsenic, though also some added nutrients. Rinsing alone has little effect. Eating a variety of grains helps too.

### Microplastics: limited data

**No health limit exists, so this meter compares studied foods. It doesn't rate safety.** FDA says current evidence [does not demonstrate](https://www.fda.gov/food/environmental-contaminants-food/microplastics-and-nanoplastics-foods) that levels detected in foods pose a risk to human health.

The science is young. Studies count particles of different sizes in different ways, and many counted particles were never chemically confirmed as plastic. Results for one food can differ a thousandfold: bottled water ranges from under 4 to about 240,000 particles per liter, depending on the method. Treat these as rough guides.

## Totals for a whole plan

A day or week plan adds up each food at its planned amount, using the same per-serving figure as that food's page. Lead, cadmium, inorganic arsenic and pesticides are compared with a **day's** reference (a week plan uses its average day and also names the highest day). Mercury is compared with the **week's** reference: a day plan shows that day's share of it, and a week plan shows the real total of all 7 days.

A food's meter on its own page leaves room for everything else you eat that day. A plan total already is the day (or week), so its lines are wider: low is under 25% of the reference, moderate 25% to under 50%, elevated 50% to under 100%, and high is over the whole reference. A day's mercury keeps the fish-advice lines above, because one day of fish is one serving's worth of the week.

When a total reaches elevated, the plan names the foods that push it there and offers to reduce, swap or leave them out. Foods without data are listed as unknown and never counted as zero, so a total with unknowns is "at least" that much. Microplastics are added up for comparison only: there is no health limit, so they are never rated.

## How similar foods share data

Testing programs measure a food once, while USDA lists many versions of it. "Eggs, Grade A, Large" and "Egg, whole, raw, fresh" don't need separate measurements, so they point to the same FDA record, "Eggs, hard-boiled". The panel says when this happens, for example: *Based on: FDA Total Diet Study, "Eggs, hard-boiled", applies to 38 similar foods.*

Each link has a confidence score, shown in the details. Some foods are too different to share data, so we leave them without any:

- **Organ meats**, because liver and kidney concentrate cadmium, so muscle meat is a poor stand-in.
- **Mixed dishes**, unless FDA tested that dish.
- **Brands:** a brand name maps to the general food. Levels in a specific product can differ.

**Raw versus cooked.** Water dilutes contaminants, so a gram of dry rice holds more than a gram of cooked rice. Where the forms differ noticeably, we scale using USDA's water and fat figures. The details say when a value was scaled. We don't scale for fish mercury or pesticides, and we don't count losses during cooking.

**Averages hide variation.** Levels change with soil, region, fish size and season. Non-detects count as zero in averages, as FDA does, and details also show the higher figure if undetected samples sat just below the test limit.

## Sources

**Heavy metals**

- US FDA. [Total Diet Study, FY2018-FY2020 elements](https://www.fda.gov/food/fda-total-diet-study-tds/fda-total-diet-study-tds-results). Public domain.
- US FDA. [Mercury Levels in Commercial Fish and Shellfish, 1990-2012](https://www.fda.gov/food/environmental-contaminants-food/mercury-levels-commercial-fish-and-shellfish-1990-2012). Public domain.
- US FDA. [Arsenic in Rice and Rice Products Risk Assessment](https://www.fda.gov/files/food/published/Arsenic-in-Rice-and-Rice-Products-Risk-Assessment-Report-PDF.pdf), revised March 2016, Table 4.2. Public domain.

**Pesticides**

- USDA Agricultural Marketing Service. [Pesticide Data Program, 2016-2024](https://www.ams.usda.gov/datasets/pdp/pdpdata), and [2024 Annual Summary](https://www.ams.usda.gov/sites/default/files/media/PDPAnnualSummary.pdf). Public domain.
- US EPA. [Human Health Benchmarks for Pesticides, 2021](https://www.epa.gov/system/files/documents/2021-07/hh-benchmarks-table-2021.pdf). Public domain.
- US EPA. [2018 Drinking Water Standards and Health Advisories Tables](https://www.epa.gov/system/files/documents/2022-01/dwtable2018.pdf). Public domain.
- US EPA. [IRIS: p,p'-DDT](https://iris.epa.gov/ChemicalLanding/&substance_nmbr=147). Public domain.

**Reference levels and advice**

- US FDA. [Lead in Food and Foodwares](https://www.fda.gov/food/environmental-contaminants-food/lead-food-and-foodwares), [Cadmium in Food and Foodwares](https://www.fda.gov/food/environmental-contaminants-food/cadmium-food-and-foodwares), [What You Can Do to Limit Exposure to Arsenic](https://www.fda.gov/food/environmental-contaminants-food/what-you-can-do-limit-exposure-arsenic).
- US FDA and EPA. [Technical information on the fish advice](https://www.fda.gov/food/metals/technical-information-development-fish-consumption-advice-fdaepa-advice-what-pregnant-women-and).
- US EPA. [IRIS: Methylmercury](https://iris.epa.gov/ChemicalLanding/&substance_nmbr=73), [IRIS: Inorganic Arsenic](https://iris.epa.gov/ChemicalLanding/&substance_nmbr=278).
- EFSA. [Metals as contaminants in food](https://www.efsa.europa.eu/en/topics/topic/metals-contaminants-food).
- ATSDR. [Minimal Risk Levels](https://wwwn.cdc.gov/TSP/MRLS/mrlsListing.aspx).

**Microplastics**

- Cox KD, et al. [Human Consumption of Microplastics](https://doi.org/10.1021/acs.est.9b01517). Environ Sci Technol. 2019;53(12):7068-7074.
- Kosuth M, Mason SA, Wattenberg EV. [Anthropogenic contamination of tap water, beer, and sea salt](https://doi.org/10.1371/journal.pone.0194970). PLoS ONE. 2018;13(4):e0194970.
- Milne MH, et al. [Exposure of U.S. adults to microplastics from commonly-consumed proteins](https://doi.org/10.1016/j.envpol.2023.123233). Environ Pollut. 2024;343:123233.
- Danopoulos E, et al. [Microplastic contamination of seafood intended for human consumption](https://doi.org/10.1289/EHP7171). Environ Health Perspect. 2020;128(12):126002.
- US FDA. [Microplastics and Nanoplastics in Foods](https://www.fda.gov/food/environmental-contaminants-food/microplastics-and-nanoplastics-foods).

## For developers

```bash
python3 -I scripts/contaminants/extract_sources.py --download   # downloads -> data/contaminants/*.tsv
python3 -I scripts/contaminants/build_contaminants.py           # data/contaminants/*.tsv -> nutrition.db
python3 -I scripts/verify_data_integrity.py --skip-raw          # includes the contaminant checks
```

`scripts/build_db.py` runs the second step automatically, so a full rebuild keeps these tables. API: `GET /api/contaminants?fdcId=...&grams=...`. Research notes and decisions are in [research/CONTAMINANTS.md](research/CONTAMINANTS.md).
