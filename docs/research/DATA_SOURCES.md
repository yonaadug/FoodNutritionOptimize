# Food data beyond USDA: sources and licences

Research into data we could add to `nutrition.db`: more nutrients for the foods we have, more foods, new nutrients, and more contaminant data. **Checked on 2026-11-15.** Every licence below was read on the publisher's own page unless the entry says otherwise (UNVERIFIED, a search snippet or a mirror).

The site is free with a planned paid Plus tier, so **we count as commercial** for every licence. "Store" below means keeping the values in our own database and showing them on public pages.

Related: [CONTAMINANTS.md](CONTAMINANTS.md) (contaminant sources already in use; not repeated here), [RECIPE_ANALYSIS.md](RECIPE_ANALYSIS.md) and [FOOD_PHOTO_OPTIONS.md](FOOD_PHOTO_OPTIONS.md) (commercial nutrition APIs), [KEY_NUTRIENTS.md](../KEY_NUTRIENTS.md) (how the database is built).

This is research, not legal advice. Items a lawyer or the publisher should confirm are listed in [Open questions](#open-questions-for-a-lawyer-or-the-publisher).

## Recommendation

In this order:

1. **Use the USDA data we already download but throw away, and add USDA's iodine database.** It's public domain and the work is small.
   - [Iodine database Release 4](#usda-fda-and-ods-nih-iodine-database) (478 foods) adds a nutrient we don't track. 381 of its food codes already match foods in our database.
   - [Foundation Foods](#foundation-foods) has biotin for 118 foods, iodine for 47 and molybdenum for 68.
   - SR Legacy has amino acids for about 5,000 foods.
2. **[Denmark's food composition database 6.1](#denmark-fcdb-61-formerly-frida)** (formerly "Frida"; CC BY 4.0) is the best gap-filler we found.
   - It has choline, biotin, iodine, chromium, molybdenum, vitamin K1 and K2, vitamin D forms and amino acids.
   - It's small (1,390 foods), but it comes with English names and FoodEx2 codes.
3. **[Germany's BLS 4.0](#germany-bls-40)** is the largest open table: 7,140 foods and 138 nutrients, including iodine, biotin, chromium, molybdenum, vitamin K and amino acids.
   - It was a paid licence until December 2025. It's now CC BY 4.0.
   - It's good both for filling gaps and for adding European foods.
4. **[USDA Branded Foods](#usda-branded-foods)** (public domain) is the only free branded-food source with a clean licence.
   - It has about 434,000 products.
   - It carries label nutrients only, so it adds foods but fills no vitamin K, choline or B-vitamin gaps.
   - [Open Food Facts](#open-food-facts) (4.9 million products) could follow for non-US products. Its share-alike licence means we'd publish that part of our database.
5. **For contaminants, check FDA's new [Total Diet Study dashboard](#fda-total-diet-study-dashboard-tdsi) export and add the [TDS PFAS](#fda-pfas-testing) results.**
   - FDA now says the dashboard downloads FY2018-2022 results, including pesticides. That would supply the data CONTAMINANTS.md lists as missing.
   - Both are public domain and reuse our existing TDS food mapping.

**Next tier, for international foods:**

- [UK CoFID](#uk-cofid-2021) (UK Open Government Licence)
- [France CIQUAL 2025](#france-ciqual-2025) (French government open licence, Etalab 2.0)
- [Japan's MEXT tables](#japan-mext-standard-tables-2023) (commercial use allowed; Japanese names)
- [Norway's Matvaretabellen](#nordic-tables-norway-sweden-finland) (good for fish)
- [Canadian Nutrient File 2026](#canadian-nutrient-file-2026) (Canadian fortified foods)

**Avoid**, as published:

- Non-commercial or no-changes licences:
  - [Netherlands NEVO](#netherlands-nevo-2025) forbids charging users for its data.
  - [Most FAO/INFOODS tables](#faoinfoods-and-regional-tables) are non-commercial.
  - [New Zealand FOODfiles](#new-zealand-foodfiles-2024) forbids changing the data.
  - [India IFCT](#tables-that-need-permission-or-a-fee), [Brazil TBCA](#faoinfoods-and-regional-tables), [FooDB](#polyphenols-and-other-bioactives) and [Korea's RDA API](#korea) restrict commercial use.
- [Commercial APIs](#commercial-apis): Nutritionix, Edamam, FatSecret, Spoonacular, Passio and Trustwell all forbid keeping their data for public food pages, or limit it to a user's own log. Nutritionix starts at $499/month.

**Two cautions apply to every borrowed value:**

- **Label it.** A value from another country's table is an estimate for our food, not a measurement of it. USDA does the same thing in FNDDS, where "only 40%" of some foods' values are true Foundation values.
- **Don't borrow nutrients that depend on a country's rules.**
  - Vitamin D in fortified foods: US milk is fortified, most European milk isn't.
  - Iodine wherever iodized salt is involved: Denmark requires iodized salt in bread.
  - Folic acid in flour.
  - For iodine in US foods, use the US iodine database.

## Our gaps today

Measured on `nutrition.db` (9,435 foods) on 2026-11-15. "Missing" means NULL, meaning the source reported nothing.

| Nutrient | Missing | Where the gaps are |
|---|---|---|
| Vitamin D | 2,882 (31%) | 312 of 389 Foundation foods. 614 SR Legacy beef, lamb, veal and game items. 162 of 288 fish, including raw wild rainbow trout, Pacific cod and eel. |
| Vitamin K | 3,007 (32%) | Similar spread |
| Choline | 3,492 (37%) | 351 of 389 Foundation foods |
| Pantothenic acid | 3,225 (34%) | Every FNDDS mixed dish (FNDDS doesn't carry it) |
| Manganese | 2,747 (29%) | Every FNDDS mixed dish (FNDDS doesn't carry it) |
| Vitamin E | 2,489 (26%) | |
| Iodine, biotin, chromium, molybdenum, amino acids | Not tracked | |

**FNDDS can't fill these gaps.** The full FNDDS has complete vitamin D, K and choline for all 5,432 foods, so it looked like a free fix. But the SR Legacy foods it's built from (1,605 of ours) are already complete. Only 4 of our SR Legacy foods with a missing vitamin D value are the sole ingredient of an FNDDS food. The gaps sit in foods FNDDS doesn't use.

## Comparison

Verdicts: **Adopt**, **Maybe** (useful, but there's a cost or open question), **No**.

| Source | Foods | Fills which of our gaps | Licence | Commercial use and storing allowed? | Effort | Verdict |
|---|---|---|---|---|---|---|
| [USDA iodine database R4](#usda-fda-and-ods-nih-iodine-database) | 478 | Iodine (new) | Public domain (FDC: CC0) | Yes | Low: USDA codes included | **Adopt** |
| [Foundation Foods extras](#foundation-foods) | 424 | Biotin, iodine, molybdenum, amino acids | CC0 | Yes | Very low: already downloaded | **Adopt** |
| [SR Legacy amino acids](#sr-legacy-amino-acids) | about 5,000 | Amino acids (new) | CC0 | Yes | Very low | **Adopt** |
| [Danish FCDB 6.1 (Frida)](#denmark-fcdb-61-formerly-frida) | 1,390 | D, K1/K2, choline, biotin, iodine, Cr, Mo, amino acids | CC BY 4.0 | Yes, with attribution | Medium: FoodEx2 codes | **Adopt** |
| [BLS 4.0, Germany](#germany-bls-40) | 7,140 | D, K, biotin, iodine, Cr, Mo, amino acids; European foods | CC BY 4.0 | Yes, with attribution | Medium-high: own codes | **Adopt** |
| [USDA Branded Foods](#usda-branded-foods) | about 434,000 | Branded foods; label nutrients only | CC0 | Yes | Medium: size, quality | **Adopt** as a separate section |
| [CIQUAL 2025, France](#france-ciqual-2025) | 3,484 | D, K1/K2, iodine, Mn; French foods | Etalab 2.0 / CC BY 4.0 | Yes, with attribution | Medium | **Adopt** |
| [CoFID 2021, UK](#uk-cofid-2021) | 2,898 | D, K1, iodine, biotin; British foods | UK OGL v3 | Yes, with attribution | Medium | **Adopt** |
| [MEXT 2023, Japan](#japan-mext-standard-tables-2023) | 2,538 | D, K, iodine, Se, Cr, Mo, biotin, amino acids; Japanese foods | Government of Japan terms (CC BY-compatible) | Yes, with attribution | High: Japanese names | **Adopt** for Asian foods |
| [Matvaretabellen 2026, Norway](#nordic-tables-norway-sweden-finland) | 2,121 | D, iodine, Se (strong on fish) | CC BY 4.0 | Yes, with attribution | Medium | **Adopt** |
| [Livsmedelsdatabasen, Sweden](#nordic-tables-norway-sweden-finland) | 2,606 | D (with and without 25-OH), iodine | CC BY 4.0, but "data must not be changed" | Yes, unchanged | Medium: FoodEx2 | **Maybe** |
| [Fineli, Finland](#nordic-tables-norway-sweden-finland) | about 4,200 | D, K, iodine | CC BY 4.0 (page blocked us) | Probably | Medium | **Maybe** |
| [Canadian Nutrient File 2026](#canadian-nutrient-file-2026) | about 5,700 (2015) | Little: mostly USDA data; Canadian fortification | OGL-Canada | Yes, with attribution | Low: USDA codes | **Maybe** |
| [Swiss database](#switzerland) | 1,246 | Little | Open use, cite source | Yes | Medium | **Maybe** (low) |
| [AFCD R3 / AUSNUT 2023, Australia](#australia-afcd-and-ausnut) | 1,588 / 3,741 | Iodine, D; Australian foods | Share-alike agreement, or CC BY 4.0 (conflict) | Yes, but share-alike | Medium | **Maybe**: ask FSANZ |
| [USDA flavonoid databases](#usda-special-interest-databases) | 506 to all FNDDS | Flavonoids (new) | Public domain | Yes | Medium | **Maybe** |
| [USDA Purine R3, Glucosinolates R1](#usda-special-interest-databases) | 501 / about 20 vegetables | New niche compounds | Public domain | Yes | Medium | **Maybe** |
| [FDA TDS nutrient elements](#fda-total-diet-study-nutrient-elements) | about 290 | Iodine, Cr, Mo, Mn, Se | Public domain | Yes | Medium | **Maybe** |
| [NEVO 2025, Netherlands](#netherlands-nevo-2025) | 2,328 | D, K, iodine | RIVM conditions | **No charging users; no changes** | | **No** for now |
| [FOODfiles 2024, New Zealand](#new-zealand-foodfiles-2024) | 2,857 | D, biotin, Cr, Mo | Terms of use | **No changes allowed** | | **No** |
| [Korea RDA API](#korea) | 3,366 | Many | KOGL Type 4 | **No commercial use** | | **No** (some other Korean datasets are open) |
| [FAO/INFOODS tables](#faoinfoods-and-regional-tables) | 178 to 1,028 each | Some iodine (fish) | Mostly CC BY-NC-SA 3.0 IGO or older FAO terms | **No**, without FAO permission | | **No** (ask about uFiSh) |
| [IFCT 2017 (India), China, SAFOODS (South Africa), BEDCA (Spain), IEO BDA (Italy), Thai and ASEAN tables](#tables-that-need-permission-or-a-fee) | various | | Copyright | **No**, without written permission or a fee | | **No** |
| [Brazil TBCA](#faoinfoods-and-regional-tables) | 5,700+ | D, Se; Brazilian foods | Non-commercial; paid licence available | Only with a paid licence | | **Maybe** (buy) |
| [Phenol-Explorer](#polyphenols-and-other-bioactives) | 400+ | Polyphenols (new) | Free; commercial use needs permission | **No**, without permission | | **Maybe**: ask |
| [FooDB](#polyphenols-and-other-bioactives) | | Compounds | CC BY-NC 4.0 | **No** | | **No** |
| [Open Food Facts](#open-food-facts) | 4.9M (1.0M sold in the US) | Branded and international products; label nutrients only | ODbL (share-alike) | Yes, but its part of our database must be published under ODbL | Medium-high | **Maybe**, after USDA Branded |
| [MenuStat (NYC Open Data)](#restaurant-foods) | 65,219 menu items, about 96 chains | Restaurant foods; macros and sodium | NYC Open Data, "no restrictions" | Yes | Low | **Maybe**: 2017-2018 only |
| [Nutritionix, Edamam, FatSecret, Spoonacular, Passio, Trustwell](#commercial-apis) | up to 1M+ | Branded, restaurant | Vendor terms | **No**: no permanent storage for public pages | | **No** |
| [Chomp, CalorieKing](#commercial-apis) | about 1M | Branded, restaurant | Vendor terms | Unclear | | **Maybe**: ask in writing |

Contaminant sources are compared in [their own section](#contaminant-sources-not-in-contaminantsmd).

## USDA and other US government data

All of these are US federal works. FoodData Central says: "USDA FoodData Central data are in the public domain and they are not copyrighted… CC0 1.0 Universal… No permission is needed for their use, but we request that users list FoodData Central as the source of the data" ([FDC API guide](https://fdc.nal.usda.gov/api-guide/)).

- **What's allowed:** commercial use, storing, redistributing and mixing are all fine.
- **Requested citation:** "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov."
- **API limits:** 1,000 requests per hour per IP with a free data.gov key.

### USDA, FDA and ODS-NIH iodine database

- **What it is:** analytical iodine values for common US foods, compiled jointly by USDA, FDA and NIH's Office of Dietary Supplements.
- **Size and release:** Release 4.0 (October 2024), 478 foods. Earlier releases were in 2020, 2022 and 2023.
- **Get it:**
  - [ARS page](https://www.ars.usda.gov/northeast-area/beltsville-md-bhnrc/beltsville-human-nutrition-research-center/methods-and-application-of-food-composition-laboratory/mafcl-site-pages/iodine/): Excel, per 100 g and per serving.
  - FoodData Central, Experimental Foods ID 2731074: a 107 KB TSV zip, `FoodData_Central_Iodine_Database_tsv_2025-04-24.zip`.
- **What we found when we opened the FDC copy:**
  - It holds 5,972 individual lab samples (5,174 from FDA, 798 from USDA), collected 2003-2023, all measured by ICP-MS, in µg/100 g.
  - Every sample points at a USDA food code, with a match type: exact 1,344, close 3,086, narrower 646, related 515, broader 381.
  - **There are 438 distinct codes, and 381 of them match foods already in our database** (371 SR Legacy, 10 Foundation).
  - Example values: iodized salt about 2,800 µg/100 g; laver seaweed about 2,300; hamburger rolls about 530.
- **Fills:** iodine, which is new for us. Foundation Foods adds iodine for 47 more foods.
- **Licence:** a federal work with no licence text on the ARS page. FDC lists it under its CC0 terms.
- **Caveat:**
  - FDC says Experimental Foods "may not be appropriate as a reference for the consumer, diet planning, or dietary guidance".
  - Some foods rest on a single sample. 110 samples are below the limit of quantitation (marked "<1.5" or "<7.4").
  - We'd show iodine with a "limited data" note and the sample count.
- **Integration:** low effort. Average the samples per code, use only exact and close matches directly, and treat broader and related matches as estimates.
- **Verdict: Adopt first.** It's the only credible US iodine source, and US iodine depends on salt and dough conditioners, so foreign tables don't fit US foods.

### Foundation Foods

- **Current release:** v16.0 (2026-10-29), 424 foods. Releases come twice a year, in April and October ([FDC change log](https://fdc.nal.usda.gov/log/)).
- **Latest additions:** v16.0 added vitamin D to 27 foods and choline to 2. There have been no vitamin K additions since April 2024.
- **USDA's plans:** to "include expanded nutrient profiles for existing foods" ([future updates](https://fdc.nal.usda.gov/future-updates/)), with no dates.
- **Coverage in the 2026-10-29 JSON, out of 424 foods:**

| Nutrient | Foods with a value |
|---|---|
| Vitamin D | 78 |
| Vitamin K | 85 |
| Choline | 39 |
| **Biotin** | **118** |
| **Iodine** | **47** |
| **Molybdenum** | **68** |
| Chromium | 0 |
| Amino acids | 118 |

- **What we're missing:** we already download this file, but the builder drops biotin, iodine, molybdenum and amino acids.
- **Download quirk:** the CSV zip for this release is still missing `food.csv` and `food_nutrient.csv` (KEY_NUTRIENTS.md already notes this). Keep using the JSON.
- **Verdict: Adopt** the extra nutrients. It's a builder change, not a new source.

### SR Legacy amino acids

- **What's there:** SR Legacy has amino acids for about 5,000 of its 7,793 foods, and fluoride for 538.
- **What's not:** it has no biotin, iodine, chromium or molybdenum.
- **Status:** it's final, with no more updates.
- **Verdict: Adopt** amino acids from the file we already have, if we want to show protein quality.

### FNDDS (full)

- **Current release:** still FNDDS 2021-2023 (released 2024-10-31). It's meant to come out every two years, so the next one is overdue, with no date announced ([ARS FNDDS page](https://www.ars.usda.gov/northeast-area/beltsville-md-bhnrc/beltsville-human-nutrition-research-center/food-surveys-research-group/docs/fndds-download-databases/)).
- **Size and nutrients:** 5,432 foods, each with "a complete nutrient data set for energy and 64 nutrient/food components".
  - Includes vitamin D, K, choline, B vitamins, Se, EPA and DHA.
  - Missing: manganese, pantothenic acid, iodine and biotin.
- **How it's filled:** by imputation. For foods built on Foundation data, "only 40% of the nutrient values are truly Foundation Food values … 60% … were matched to a similar SR Legacy code or a Foundation Food, calculated, or assumed zero".
- **Verdict: No** as a gap-filler (see [Our gaps today](#our-gaps-today)). Keep the mixed dishes we already use.

### USDA Branded Foods

- **What it is:** the Global Branded Food Products Database, a public-private partnership ([documentation](https://fdc.nal.usda.gov/GBFPD_Documentation/)).
  - Manufacturers submit label data through GS1 and 1WorldSync (Syndigo).
  - Euromonitor became a source in April 2026.
- **Size:** 434,001 products (live API count, 2026-11-15), for the US and New Zealand markets.
- **Get it:** the 2026-10-29 bulk file is 187 MB zipped JSON or 432 MB zipped CSV (about 3 GB unzipped). The API updates monthly; bulk files come twice a year.
- **Nutrients:** whatever is on the label, converted to per 100 g. USDA notes a missing value "does not indicate a zero value".
  - In a 200-product sample, vitamin D appeared on 106 labels and potassium on 115.
  - Vitamin K appeared on 4, the B vitamins on about 3 each, iodine on 3, and choline on none.
- **Licence:** CC0, like the rest of FDC.
  - Euromonitor-sourced records display "Provided by Euromonitor International."
  - We found no extra provider terms. Showing that credit on those records is prudent; whether it's required is UNVERIFIED.
- **Integration:**
  - GTIN/UPC barcodes, so barcode search becomes possible.
  - Kept as a separate "branded" section: these are new foods, not matches.
  - Expect discontinued products and label rounding.
- **Verdict: Adopt** as a separate searchable section with label nutrients only. Don't let branded foods feed the meal planner's micronutrient maths, since most micronutrients are blank.

### USDA special-interest databases

All are public domain federal works. None of their pages states a licence (our inference: 17 U.S.C. §105). The Expanded Flavonoid database is listed as CC0 on data.gov.

| Database | Latest | Foods | Use for us |
|---|---|---|---|
| [Flavonoids R3.3](https://www.ars.usda.gov/northeast-area/beltsville-md-bhnrc/beltsville-human-nutrition-research-center/methods-and-application-of-food-composition-laboratory/mafcl-site-pages/flavonoids/) | March 2018 | 506 | Maybe: flavonoids by SR code |
| Flavonoid values for survey foods (FNDDS 2017-2018) | 2022 | All FNDDS 2017-18 foods | Maybe: the most complete flavonoid set |
| Proanthocyanidins R2.1 | March 2018 | 285 | Maybe |
| Isoflavones R2.1 | November 2015 | 560 | Maybe |
| Purine content, with ODS | **Release 3.0, 2026** | 501 + 15 drinks | Maybe: niche (gout) |
| Glucosinolates | **Release 1.0, 2026** | about 20 vegetables | Maybe: niche |
| Food Patterns Equivalents 2021-2023 | 2026 | All FNDDS foods | Maybe: food-group and added-sugar badges |
| Nutrient retention factors R6 | 2007 | | Only for recipe maths |
| Choline R2 (2008), Fluoride R2 (2005), Added Sugars (2006) | | | No: SR Legacy now carries choline and fluoride, and FPED covers added sugars |

**Verdict:** if we add flavonoids, the USDA sets are the only commercially clean source. [Phenol-Explorer](#polyphenols-and-other-bioactives) is broader, but needs permission.

### FDA Total Diet Study nutrient elements

- **What it is:** the FDA TDS analyses about 290 foods as eaten.
  - Nutrient elements include Ca, Cu, Fe, Mg, Mn, P, K, Na, Se, Zn, **iodine, chromium and molybdenum** ([analytes](https://www.fda.gov/food/fda-total-diet-study-tds/fda-total-diet-study-tds-analytes-and-analytical-methods)).
  - It doesn't cover vitamins.
- **Get it:** FY2018-2020 as TXT; FY2018-2022 through the dashboard ([see below](#fda-total-diet-study-dashboard-tdsi)).
- **Licence:** FDA content is "not copyrighted. They are in the public domain and may be republished, reprinted and otherwise used freely by anyone without the need to obtain permission from FDA" ([FDA website policies](https://www.fda.gov/about-fda/about-website/website-policies)).
- **Integration:** we already map TDS foods to ours for contaminants.
- **Verdict: Maybe.** It's the only government source for chromium and molybdenum in everyday foods. Many results are non-detects.

### NIH Dietary Supplement Label Database

- **What it is:** 214,780 supplement labels, via an API that states CC0.
- **Verdict: No** for a food site. Revisit only if Plus adds supplement tracking.

### USDA Experimental Foods

- **What it is:** 116 research datasets, such as the new lamb retail cuts (September 2026).
- **Caveat:** FDC says they "are for research purposes".
- **Verdict: No** as a general source. Pick out individual datasets case by case.

## National food tables you can use commercially

What all of these share:

- **Format:** values per 100 g edible portion.
- **Matching to our foods:** mostly by name, since only the Danish table and Sweden carry FoodEx2 codes.
- **Licence terms:** where a table is CC BY 4.0, we must credit it and **say that we changed it**, for example by converting units (CC BY 4.0 §3(a)(1)(B)).

### Denmark: FCDB 6.1 (formerly Frida)

- **Publisher:** DTU National Food Institute.
- **Release:** "The Danish Food Composition Database, version 6.1", dated May 2026 and published 2026-06-09 ([DTU Data](https://doi.org/10.11583/DTU.32312844); site [fcdb.fooddata.dk](https://fcdb.fooddata.dk/)).
  - It replaces Frida, whose last version was 5.5 (November 2025).
  - Some links and reports still use the Frida name.
- **Size:** 1,390 foods and 228 parameters, in one 12.6 MB XLSX or ODS file, plus English and Danish documentation.
- **Fills: the richest set we found.** We opened the 6.1 XLSX; approximate counts of foods with a value:

  | Nutrient | Foods with a value (of 1,390) |
  |---|---|
  | Choline | 1,245 |
  | Vitamin D | 1,240 (D3 in 915; 25-OH-D3 in 220) |
  | Iodine | 1,210 |
  | Selenium | 1,210 |
  | Tryptophan | 1,110 (other amino acids about 1,000) |
  | Pantothenic acid | 1,040 |
  | Chromium | 920 |
  | Vitamin K | 890 (K1 900; K2 and menaquinones about 110) |
  | Biotin | 875 |
  | Molybdenum | 650 |

  Some of these values are borrowed from other countries' tables, as the database's own disclaimer says.
- **Licence:**
  - The dataset's Readme says "Datasættet udgives under open source licensen CC-BY 4.0" ("the dataset is published under the open source licence CC BY 4.0").
  - It adds that data "may not be copied or otherwise reproduced without clear source information".
- **Attribution:** "© The Danish Food Composition Database (http://fcdb.fooddata.dk), version 6.1, May 2026."
- **Integration:**
  - Danish and English names, plus FoodEx2, LanguaL and taxonomic names.
  - Under Frida 5.x, total vitamin D counted 25-OH-D at 2.5x (EFSA's approach); USDA doesn't count it at all. Import D2 and D3 separately.
- **Verdict: Adopt.** It's the best source for borrowing choline, vitamin K, biotin, pantothenic acid and amino acids for unfortified foods: meat, fish, vegetables and grains.

### Germany: BLS 4.0

- **Publisher:** Max Rubner-Institut.
- **Release:** version 4.0, DOI dated 2025-12-17.
- **Size:** 7,140 foods and 138 nutrients. A ZIP with one Excel file of 418 columns: a value, an origin code and a reference for each nutrient.
- **Fills:**
  - Vitamin D2/D3, K1/K2, biotin, iodide, fluoride, chromium, molybdenum, and 18 amino acids.
  - No choline was found in the documentation.
- **Licence:** [blsdb.de/download](https://blsdb.de/download): "Die Nutzung ist unter der Lizenz CC BY 4.0 … gestattet" (use is permitted under CC BY 4.0).
  - The [FAQ](https://blsdb.de/faq) says "Die Daten können frei genutzt werden" (the data may be used freely).
  - Earlier BLS versions were paid licences.
- **Attribution:** "Bei Verwendung ist das Max Rubner-Institut als Herausgeber zu nennen" (name the Max Rubner-Institut as publisher). Suggested citation: "Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0".
- **Integration:**
  - Own codes, with an English name column.
  - A blank means unknown, not zero.
  - Fibre follows the Codex definition, which reads higher than USDA's.
  - Each value carries an origin code (one of 13 categories), so we can prefer measured values.
- **Verdict: Adopt.** It's the biggest open table, and it's new.

### France: CIQUAL 2025

- **Publisher:** ANSES.
- **Release:** 19 November 2025, replacing the 2020 table.
- **Size:** 3,484 foods, 74 components.
- **Get it:** XML or Excel with English names ([Zenodo mirror](https://zenodo.org/records/17550133)).
- **Fills:** iodine, selenium, manganese, vitamin D (D2/D3), K1 and K2, B5. It has no choline, biotin, chromium, molybdenum or amino acids.
- **Licence:** the Zenodo record lists CC BY 4.0 and the French government's Etalab Open Licence 2.0.
  - [Etalab 2.0](https://static.data.gouv.fr/resources/licence-ouverte-2-0/20260911-071954/open-licence.pdf) allows reuse "for commercial or non-commercial purposes", including "by combining it with other information, or by including it in his/her own product or application".
- **Attribution:** the source and the date of the last update. Suggested: "Anses. 2025. Ciqual French food composition table 2025."
- **Integration:**
  - Each value has a confidence code (A to D) and a min/max.
  - Values use French decimal commas and strings like "traces" and "<".
- **Verdict: Adopt** for French and other European foods, and as a check on vitamin K.

### UK: CoFID 2021

- **Publisher:** Public Health England, on [GOV.UK](https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid).
- **Release:** last updated 19 March 2021, with no newer release.
- **Size:** 2,898 foods (plus 303 "old foods"), up to 185 nutrients. A 4.4 MB Excel file.
- **Fills:** iodine, vitamin D, vitamin K1, biotin, pantothenate, selenium. Choline, chromium and molybdenum don't appear.
- **Licence:** "All content is available under the Open Government Licence v3.0, except where otherwise stated." [OGL v3](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) lets you "exploit the Information commercially and non-commercially … by combining it with other Information".
- **Book vs dataset:** the printed McCance and Widdowson book is a separate publication. Only the GOV.UK dataset is under OGL.
- **Attribution:** "Contains public sector information licensed under the Open Government Licence v3.0."
- **Integration:**
  - Vitamin D in meat = D3 + **5x** 25-OH-D3, so UK meat will read higher than USDA's.
  - Carbohydrate is "available" carbohydrate.
  - Energy factors differ from USDA's.
  - Use the AOAC fibre column, not Englyst.
- **Verdict: Adopt** for British dishes and iodine in UK foods.

### Japan: MEXT Standard Tables 2023

- **Publisher:** Ministry of Education, Culture, Sports, Science and Technology (MEXT).
- **Release:** 8th revised edition, 2023 enlarged version. Errata were issued 27 March 2026 ([MEXT](https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html)).
- **Size:** 2,538 foods. Separate tables cover amino acids (1,999 foods), fatty acids and carbohydrates.
- **Fills:** iodine, selenium, chromium and molybdenum (included since 2010), biotin, vitamin D and K, and amino acids.
- **Licence:** [MEXT's site terms](https://www.mext.go.jp/b_menu/1351168.htm), last amended 17 August 2026:
  - Content may be freely copied, transmitted and adapted: "商用利用も可能です" ("commercial use is also permitted").
  - The terms are compatible with CC BY 4.0.
  - Third-party content needs the third party's permission.
  - The [food tables page](https://www.mext.go.jp/a_menu/syokuhinseibun/index.htm) adds "食品成分データは、ご自由に利用して頂けます" ("the food composition data may be used freely").
- **Attribution:** cite "日本食品標準成分表（八訂）増補2023年" (Standard Tables of Food Composition in Japan, 8th revised edition, 2023 enlarged version). Separately, state that we edited or processed the data, and don't present the result as MEXT's.
- **Integration: high effort.**
  - The 2023 Excel is Japanese only. English PDFs exist for 2020.
  - Energy is calculated differently from USDA's.
  - Values are marked "Tr", "(0)" and "-".
- **Verdict: Adopt** for Japanese and other Asian foods and for fish vitamin D, once someone budgets for translating the food names.

### Nordic tables: Norway, Sweden, Finland

Nordic tables are strong on fish, vitamin D and iodine.

**Norway, [Matvaretabellen 2026](https://www.mattilsynet.no/en/food-and-beverages/matvaretabellen/download-the-norwegian-food-composition-table)**

- **Size and release:** 2,121 foods, released January 2026, next version 2027. XLSX and an API.
- **Licence:** "made available under the CC BY 4.0 license."
- **Citation:** "The Norwegian Food Composition Table 2026. The Norwegian Food Safety Authority. www.matvaretabellen.no".
- **Verdict: Adopt** for fish.

**Sweden, [Livsmedelsdatabasen](https://www.livsmedelsverket.se/en/about-us/open-data/food-composition-data/)**

- **Size:** 2,606 foods, 56 nutrients, via an API with FoodEx2 and LanguaL codes.
- **Vitamin D:** published both with and without 25-OH-D3.
- **Licence:** "published under the Creative Commons Attribution 4.0 license", and "The Swedish Food Agency must be stated as the source".
- **Conflict:** the Swedish-language page adds "Data får inte förändras" ("data must not be changed"), which conflicts with CC BY.
- **Verdict: Maybe.** Use values unchanged, or ask.

**Finland, Fineli**

- **Size:** about 4,200 foods, 55 components, a CSV and an API. Includes iodide, vitamin D and K.
- **Licence:** a search snippet of its [open data page](https://fineli.fi/fineli/en/avoin-data) says CC BY 4.0, but bot protection blocked our reading. **UNVERIFIED.**
- **Verdict: Maybe** after a manual check.

### Canadian Nutrient File 2026

- **Publisher:** Health Canada.
- **Release:** CNF 2026, published 2026-05-14 as relational CSVs ([open.canada.ca](https://open.canada.ca/data/en/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109)). The 2015 edition is frozen.
- **Size:** CNF 2015 had 5,690 foods and up to 152 components. The 2026 counts are UNVERIFIED.
- **How much is USDA data:** most of it. The 2015 guide says 57% of records are "no change from USDA". Its value to us is Canadian fortification levels and Canada-only foods.
- **Gap-fill:** it has no iodine.
- **Licence:** [OGL-Canada](https://open.canada.ca/en/open-government-licence-canada) grants a "royalty-free, perpetual" licence to "Copy, modify, publish… distribute" for "commercial purposes".
- **Attribution:** "Contains information licensed under the Open Government Licence – Canada."
- **Integration:** easy. It uses USDA nutrient numbers, and in 2015 it had a USDA NDB link field. Whether that field survives in 2026 is UNVERIFIED.
- **Verdict: Maybe.** Add only the non-USDA foods.

### Switzerland

- **What it is:** [Swiss Food Composition Database](https://naehrwertdaten.ch/en/downloads/) V7.1, 1,246 foods.
- **Licence:** "the data may also be used for commercial purposes (e.g. … nutrition diary app) … subject to acknowledgment of the source."
- **Verdict: Maybe (low).** It has few nutrients beyond ours.

### Australia: AFCD and AUSNUT

- **What it is:**
  - [AFCD Release 3](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/about-afcd), December 2025: 1,588 foods with an updated vitamin D dataset.
  - [AUSNUT 2023](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/ausnut/food-nutrients): 3,741 foods and 58 nutrients, including iodine.
- **Licence conflict:**
  - The [Data User Licence Agreement](https://www.foodstandards.gov.au/science-data/monitoringnutrients/afcd/datauserlicenceagreement) is "based on a Creative Commons Attribution-ShareAlike 3.0 Australia licence". It's **share-alike**: "You may only distribute a Derivative Work if You apply this Licence Agreement to it." It also requires a limitations statement and a note that Australian data "may not be appropriate for use in other countries".
  - FSANZ's general [copyright page](https://www.foodstandards.gov.au/copyright) says website material is CC BY 4.0.
- **Verdict: Maybe.** Ask FSANZ which licence applies before using it.

## Tables that need permission or a fee

### Netherlands: NEVO 2025

- **What it is:** NEVO-online 2025/9.0, 2,328 foods, with vitamin D in four forms, vitamin K and iodine.
- **Licence:** we read RIVM's [conditions of use](https://www.rivm.nl/sites/default/files/2025-11/Conditions-of-use-NEVO-online-2025-dataset.pdf). It says:
  - "Using the information from NEVO online is only allowed unchanged"
  - "The user is **not** entitled to make amendment"
  - "**The user is not allowed to charge (end)users for the use of NEVO online version 2025/9.0 data.**"
- **Verdict: No** while Plus exists, unless RIVM agrees in writing (nevo@rivm.nl).

### New Zealand: FOODfiles 2024

- **What it is:** 2,857 foods, with vitamin D, biotin (1,060 foods), chromium (499) and molybdenum (432).
- **Licence:** the [terms](https://www.foodcomposition.co.nz/terms/) are royalty-free, but "You must not modify any part of the FOODfiles™ Data", and it must be shown "in its original and unaltered form".
- **Verdict: No** without written permission. Unit conversion alone could breach that.

### Korea

- **RDA's national standard table (3,366 foods):** licensed through its [API](https://www.data.go.kr/data/15143598/openapi.do) under KOGL Type 4, "상업적 이용금지, 변경금지" (no commercial use, no changes). **No.**
- **The food safety ministry's (MFDS) nutrition datasets:**
  - Some are marked "이용허락범위 제한 없음" (no restriction) ([example](https://www.data.go.kr/data/15127578/openapi.do)).
  - The [integrated dataset](https://www.data.go.kr/data/15100064/standard.do) covers Korean dishes. Its licence is UNVERIFIED.
  - KOGL Type 1 allows commercial use with attribution.
  - **Maybe**, dataset by dataset, for Korean dishes.

### Others

All of these are **No** unless the publisher grants written permission or sells a licence:

- **India, [IFCT 2017](https://www.nin.res.in/ebooks/IFCT2017.pdf)** (528 foods, all analysed): "no part of this publication can be stored or reproduced in any electronic format for creating a product without the prior written permission of the National Institute of Nutrition". Worth asking: it's the authoritative Indian table.
- **China**, standard edition (6th): a copyright book. Papers say the values "cannot be redistributed in full".
- **South Africa, [SAFOODS](https://safoods.mrc.ac.za/faq.html)**: paid, and permission "must be granted by the South African Medical Research Council (SAMRC) in writing".
- **Spain, [BEDCA](https://www.bedca.net/bdpub/UsoBD.pdf)**: use beyond personal, educational or non-commercial "estará sujeto a la autorización expresa" (needs express permission).
- **Italy, [IEO BDA](https://bda.ieo.it/?page_id=53&lang=en)**: "commercial use only upon written authorization".
- **Thailand, [Thai FCD](https://inmu.mahidol.ac.th/thaifcd/content/term-and-condition)**, and the ASEAN database: commercial use "may incur fees".
- **Singapore, SG FoodID**: the data terms allow commercial use with a notice, but another section of the same terms forbids commercial reuse of the website. It's mostly branded products. **Maybe.**
- **Portugal, Ireland, Belgium (NUBEL), Iceland, Malaysia**: we found no open licence or bulk download.
- **EuroFIR FoodEXplorer**: a paid members' search tool, not a data licence. Use it only to find tables, then license each country directly.
- **EFSA's 2013 [composition dataset](https://zenodo.org/records/438313)**: CC BY 4.0, but old and incomplete. Use it only to cross-check values.

## FAO/INFOODS and regional tables

FAO tables are the obvious source for African, Pacific and Latin American foods, but **none can be used commercially as published**.

**FAO's licences depend on when a table was published:**

- **About 2018 and earlier,** e.g. the [Kenya table 2018](https://www.fao.org/3/I8897EN/i8897en.pdf): copying is allowed "for use in non-commercial products or services". "Commercial use rights should be made via www.fao.org/contact-us/licence-request or addressed to copyright@fao.org."
- **2019-2023**, e.g. the West African table 2019 and the Pacific database 2020: CC BY-NC-SA 3.0 IGO, "for non-commercial purposes… If the work is adapted, then it must be licensed under the same or equivalent Creative Commons licence".
- **2024 onward:** FAO's boilerplate says CC BY 4.0, but the next sentence still says "non-commercial purposes" and share-alike. Ask before relying on it.

| Table | Foods | Notable | Verdict |
|---|---|---|---|
| West African FCT 2019 | 1,028 | Vitamin D, folate, phytate. No iodine, Se, K, choline. FoodEx2 codes | No (non-commercial); ask FAO if West African foods become a priority |
| Kenya 2018 | 509 | Selenium, amino acids | No |
| Pacific Nutrient Database 2020 | 822 | 26 components only | No |
| [uFiSh 1.0](https://www.fao.org/infoods/infoods/tables-and-databases/faoinfoods-databases/en/) (fish) | 516 | Iodine 457, Se 505, EPA/DHA, full amino acids | **Maybe: ask FAO.** The best fish iodine set. Licence text UNVERIFIED |
| uPulses 1.0 | 178 | Amino acids | Maybe, low |
| BioFoodComp 4.0, AnFooD 2.0 | thousands of rows | Very sparse | No |
| Malawi 2019 | 316 | Iodine, Se, biotin. Mn in µg, vitamin D undocumented | Maybe: no licence stated, ask the publisher (LUANAR) |
| Mexico, nutrition institute (INCMNSZ) 2019 | 3,928 | Mexican foods | Maybe: licence UNVERIFIED, ask |
| [Brazil TBCA 7.3](https://www.tbca.net.br/indexen.html) | 5,700+ | Vitamin D, Se, Brazilian foods | Maybe: "For commercial purposes, it is necessary to contact the coordinators". A paid licence exists |
| Central America (INCAP), Caribbean, Latin America (LATINFOODS), ASEAN | | Print-only, copyright, or unknown | No |

[INFOODS guidelines](https://www.fao.org/infoods/infoods/standards-guidelines/en/) on units and food matching are useful whichever tables we use.

## Polyphenols and other bioactives

- **[Phenol-Explorer 3.6](http://phenol-explorer.eu/)** covers about 500 polyphenols in 400+ foods, with 35,000 values. It was last updated in 2015.
  - Its terms say "Use and re-distribution of the data, in whole or in part, for commercial purposes requires explicit permission of the authors".
  - We read these terms via a [mirror](https://github.com/lotusnprod/lotus-processor/blob/main/docs/licenses/phenolexplorer.md), because the site's certificate failed.
  - **Maybe: ask the authors.** It's the best polyphenol source.
- **FooDB**: "all data and metadata in FooDB are released under the Creative Commons (CC) Attribution-NonCommercial (NC) 4.0" ([compliance page](https://foodb.ca/compliance), read via search; the site blocked us). The data is also messy. **No.**
- **eBASIS**: EuroFIR members only. **No.**
- **PhytoHub**: the site was down. **No.**
- **Exposome-Explorer**: non-commercial, and covers biomarkers, not foods. **No.**
- **Free alternative:** USDA's [flavonoid databases](#usda-special-interest-databases).

**Chromium and molybdenum are sparse everywhere.** Only Japan (MEXT), the Danish table, BLS, New Zealand, FDA TDS and Foundation Foods (molybdenum only) have meaningful coverage, so a site-wide chromium column would be mostly blank.

## Open and community data

### Open Food Facts

**What it is:** a non-profit, crowd-sourced database of packaged products, keyed by barcode.

**Size:** 4,916,271 products worldwide, 1,002,710 of them tagged as sold in the US (live API, 2026-11-15).

**Nutrients:** label data. Share of products with a value, counted from the 2026-11-15 CSV export (values not checked for accuracy):

| Nutrient | US | World |
|---|---|---|
| Energy | 86% | 72% |
| Sodium | 79% | 63% |
| Fibre | 67% | 39% |
| Vitamin D | 16% | 9% |
| B vitamins and most minerals | 5-8% | 5-8% |
| Vitamin K | 4% | 1.4% |
| Choline | 4% | 1.4% |

**Get it:**
- Nightly dumps: CSV 1.54 GB gzipped (about 9 GB unzipped), JSONL 13.6 GB, Parquet 8 GB on Hugging Face.
- The [API](https://openfoodfacts.github.io/openfoodfacts-server/api/) allows "15 req/min/IP address for all read product queries", and the data page warns "Any attempt to scrape the database using the API will very likely be blocked."

**Licence:**
- The database is ODbL, individual values are DbCL, and images are CC BY-SA.
- [OFF's terms](https://world.openfoodfacts.org/terms-of-use) say the licences "authorize the use and reproduction of the content for all purposes, including commercial use, under certain conditions, especially the attribution and the sharing under the same condition of derivative works".
- The data "can contain errors and must not be used for medical purposes."

**What ODbL means for us.** This is our reading of [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); a lawyer should confirm it.
- **Importing OFF creates a Derivative Database.** Copying a substantial part of OFF into our database makes one: "Extraction or Re-utilisation of the whole or a Substantial part of the Contents into a new database is a Derivative Database" (4.4b).
- **Our pages count as public use.** Showing it on public pages is public use of that Derivative Database (4.4c).
- **So the OFF-derived part must stay open.** It must be under ODbL, with a notice on the pages: "Contains information from Open Food Facts, which is made available here under the Open Database License (ODbL)" (4.3).
- **We'd have to offer it for download.** We must offer that part, or "the method of making the alterations", free for download (4.6).
- **Our USDA data needn't become ODbL**, if it stays an independent database within a "Collective Database" (4.5a). That means never:
  - filling gaps in a USDA food with OFF values;
  - correcting USDA values with OFF;
  - de-duplicating one set against the other.

  OpenStreetMap's [collective-database guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline) treats datasets that "do not reference each other" as independent. It's not binding on OFF.
- **Precedent:** [Stock & Savor](https://github.com/stockandsavorapp/open-food-facts-products) publishes its ODbL derivative (611,313 US, Canadian and Mexican products not in USDA) as CSV and SQLite on GitHub.

**Integration:** GTIN barcodes, padded to 14 digits; values per 100 g and per serving. The CSV gives sodium and vitamins in grams, so they need converting. Quality varies.

**Verdict: Maybe, after USDA Branded.** Use it for products USDA lacks, especially non-US ones. Keep it as a separate layer we publish under ODbL, with the notice on its pages.

### Other open datasets

| Dataset | Licence and status | Verdict |
|---|---|---|
| [OpenNutrition](https://www.opennutrition.app/download) | ODbL plus a "modified" DbCL; it also includes OFF data. Values are described as "AI-enhanced". | No: share-alike plus model-generated values |
| FoodRepo / Open Food Repo (Switzerland) | Now says "This site has moved to openfoodfacts.org" | No: defunct |
| Wikidata | CC0, but it has no established nutrient-per-100 g property | No. Useful only for food names in other languages |

## Commercial APIs

**None of these lets us store values permanently and show them on public pages at our scale.** This updates [RECIPE_ANALYSIS.md](RECIPE_ANALYSIS.md), as of 2026-11-15:

| API | Price | Can we store it? | Attribution | Verdict |
|---|---|---|---|---|
| [Nutritionix](https://www.nutritionix.com/api) (Syndigo) | Starter $499/mo (200 monthly users), MVP $999 (1,000), Unicorn from $1,850, billed annually. **Corrects the "$449" in RECIPE_ANALYSIS.md.** Covers 1M+ grocery and 203K restaurant foods. | Not on Starter. On MVP and up, only "to cache user food log data for historical reference purpose only" | "Powered by Nutritionix", except on Unicorn | No |
| [Edamam Food Database](https://developer.edamam.com/food-database-api) | $14, $69 or $299/mo, or custom | Only ID and label, or plus 4 macros. "Saved data can be used only in the end user's account, behind a password." It "does not allow API subscribers to build a copy of the Edamam data … or to build a food search" | Badge required; "Not providing attribution is considered breach of contract" | No |
| [FatSecret](https://platform.fatsecret.com/terms) | Basic free (5,000 calls/day); Premier Free for startups; Premier on request | Remove or refresh content "within 24 hours" unless it's explicitly storable. **This applies to all content, not only images.** Premier lists "Custom Caching and Data Storage Permissions" | "Powered by fatsecret nutrition API", including somewhere visible without logging in | No, unless Premier storage is agreed in writing |
| [Spoonacular](https://spoonacular.com/food-api/terms) | $29-149/mo | No nutrition storage; a 1-hour cache only with permission | Backlink on the free plan | No |
| [Passio](https://www.passio.ai/pricing) | $99, $599 or $2,999/mo | Storage terms not found; competing products banned | | No |
| [Trustwell (formerly ESHA)](https://www.trustwell.com/products/food-nutrition-database/) | On request | ESHA's end-user licence: "for the sole purpose of conducting internal nutritional analysis" | | No |
| Chomp ([chompthis.com](https://chompthis.com/)) | Standard $25/mo + $0.001 per request; Premium $299/mo | Its FAQ promises Premium "full caching rights with no time limits". Its licence page allows only caching under 24 hours and items "a user has explicitly selected and logged", and forbids "publicly displaying, republishing" except as authorised. Cached data must be deleted on cancelling | Link back to Chomp | Maybe: get written confirmation |
| CalorieKing | On request | Offers a "Data License" with offline access and restaurant coverage. Terms unknown | | Maybe: ask about permanent rights and public display |
| Syndigo / 1WorldSync, NielsenIQ (Label Insight), GS1 | Enterprise quotes | GS1's Verified data has no nutrition. USDA Branded already carries the GS1 network's label data for free | | No |

**Licensed data can be withdrawn.** In 2024 Trustwell sued Cronometer, and Cronometer had to remove Trustwell foods by 15 February 2025. The case (3:24-cv-01586, D. Or.) was dismissed after a settlement on 2025-08-18. Our diary keeps logged nutrients forever, so any vendor data that reaches user logs is a liability if the licence ends.

**On Edamam:** RECIPE_ANALYSIS.md reported "Commercial use: no" for Edamam. That row belongs to the **Nutrition Analysis** API's Basic plan. Our research agent read the **Food Database** page as ticking commercial use on every plan; we couldn't read the tick marks ourselves. Its storage terms rule it out either way.

### Restaurant foods

- **MenuStat.**
  - menustat.org now redirects to an unrelated domain.
  - The surviving copy is [DOHMH MenuStat (Historical)](https://data.cityofnewyork.us/Health/DOHMH-MenuStat-Historical-/qgc5-ecnb) on NYC Open Data: 65,219 menu items from about 96 chains, for 2017 and 2018. It has calories, fats, sodium, potassium, carbohydrates, protein, sugar and fibre, but no vitamins.
  - NYC Open Data's FAQ says "There are no restrictions on the use of Open Data"; we didn't read the full portal terms.
  - **Maybe (low):** menus change yearly.
- **Chains' own nutrition information.**
  - US copyright doesn't cover facts. [Feist v. Rural](https://www.law.cornell.edu/supremecourt/text/499/340): "No author may copyright his ideas or the facts he narrates".
  - Chains with 20 or more locations must provide calories and core nutrients ([21 CFR 101.11](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.11)). These cover no micronutrients.
  - Website terms may still forbid scraping, so typing values in by hand, in our own layout, is the lower-risk route. **This is a lawyer question.**
- **What we already have:** SR Legacy's "Fast Foods" (312) and "Restaurant Foods" (113) categories, which are old.

## Contaminant sources not in CONTAMINANTS.md

Most new US government data is sample-level and public domain under [FDA's website policy](https://www.fda.gov/about-fda/about-website/website-policies).

### FDA Total Diet Study dashboard (TDSi)

- **What changed:** CONTAMINANTS.md rejected the dashboard for having no bulk file. FDA's [27 January 2026 announcement](https://www.fda.gov/food/hfp-constituent-updates/fda-releases-new-interactive-tool-total-diet-study-tds-results-and-new-data) promises "full dataset download capabilities for researchers and stakeholders" for FY2018-2022: nutrients, elements, radionuclides and pesticides.
- **What the dashboard shows:** [tdsi.fda.gov](https://tdsi.fda.gov/) has an "Export Data" link and says "Click on the report item below to download to an excel spreadsheet".
- **What we couldn't check:** the dashboard is an AWS QuickSight app, so we couldn't confirm that a complete export works.
- **Pesticides:** the TDS results page still marks FY2018-2020 pesticides "Coming Soon!".
- **Verdict: Adopt if the export works.** Someone should spend five minutes in a browser on it. It would add FY2021-2022 elements and TDS pesticides.

### FDA PFAS testing

- **What it is:** [TDS PFAS datasets 1-14](https://www.fda.gov/food/environmental-contaminants-food/analytical-results-testing-food-pfas-environmental-contamination), XLSX, from the 2019, 2021 and 2024 collections. Datasets 9-14 were posted December 2025.
- **Results:** 1,290 of 1,352 samples had no detectable PFAS. Units are parts per trillion.
- **Seafood:** surveys are PDF only.
- **Verdict: Adopt the TDS files.** They use the TDS food list we already map. We'd also need a reference value for PFAS, which isn't researched here.

### FDA baby food and infant formula testing

- **What's published:**
  - [Toxic elements testing](https://www.fda.gov/food/environmental-contaminants-food/testing-results-arsenic-lead-cadmium-and-mercury): baby food FY2009-2024, and processed baby food surveys FY2020-2022 and FY2023-2024 (XLSX, sample-level).
  - [Infant formula testing](https://www.fda.gov/food/infant-formula-homepage/fdas-infant-formula-product-testing-results) (April 2026): 312 samples tested for metals, 318 pesticides, 30 PFAS and 21 phthalates.
- **Related rules:** FDA's lead action levels for baby food were finalised in January 2025. Cadmium levels were drafted on 22 October 2026 ([Closer to Zero](https://www.fda.gov/food/environmental-contaminants-food/closer-zero-reducing-childhood-exposure-heavy-metals-foods)).
- **Verdict: Maybe.** Our database excludes baby foods, so this only matters if we add them.

### Other contaminant sources

| Source | What | Licence | Verdict |
|---|---|---|---|
| [FDA pesticide monitoring FY2024](https://www.fda.gov/food/pesticides/pesticide-residue-monitoring-program-reports-and-data) (Sept 2026) | 3,528 samples, 75% imported | Public domain | Maybe: compliance sampling, complements PDP |
| FDA acrylamide (2011-2015), perchlorate (2008-2012) | Process contaminants | Public domain | Maybe: old |
| FDA TDS radionuclides FY2018-2020 | TXT next to the elements file | Public domain | Adopt cheaply, if wanted |
| [Health Canada TDS trace elements](https://open.canada.ca/data/en/dataset/83934503-cfae-4773-b258-e336896c2c53) 1993-2018 | 34 elements incl. As, Cd, Pb; CSV | OGL-Canada, commercial OK | Adopt as a second opinion to FDA |
| CFIA targeted surveys, e.g. [toxic metals 2018-19](https://open.canada.ca/data/en/dataset/2b47b561-44dc-4aeb-8a4d-72262f0dfe68) | Metals, mycotoxins, spices; sample-level CSV | OGL-Canada | Adopt selectively: the only good open mycotoxin data |
| EFSA chemical monitoring data on Zenodo, e.g. [Hungary](https://zenodo.org/records/15333988) | Huge EU occurrence data, FoodEx2-coded | CC BY 4.0 | Maybe: heavy to integrate. The newest versions (Sept 2026) are restricted; pin older open ones |
| [EFSA OpenFoodTox 3.0](https://zenodo.org/records/19388272) | 19,452 reference values | **CC BY-ND 4.0** (no derivatives) | Maybe: cite EFSA opinions directly instead |
| FSANZ Australian TDS | Metals 2013-14, PDF only | [CC BY 4.0](https://www.foodstandards.gov.au/copyright) | Maybe (low) |
| UK FSA TDS 2014 | Food groups only | Page returns 410 Gone | No |
| WHO GEMS/Food | Global contaminants | ["Permission is required for commercial uses"](https://www.who.int/about/policies/publishing/copyright) | No |
| [Mora-Medina et al. 2026](https://zenodo.org/records/23695494) | Microplastics in edible aquatic species, 6,463 records | CC BY 4.0 (author data) | Maybe: better than our current seafood figures |
| [ConsumerLab](https://www.consumerlab.com/agreement/), [As You Sow](https://www.asyousow.org/legal-information), Consumer Reports, Healthy Babies Bright Futures | Product tests | Personal or non-commercial use only; As You Sow licenses through "As You Know" | No (As You Sow chocolate data could be bought) |

**Microplastics update:** EFSA's opinion on micro- and nanoplastics in food is "scheduled to be finalised by the end of 2027" ([EFSA](https://www.efsa.europa.eu/en/topics/microplastics-and-nanoplastics-food)). No regulator has set a limit since CONTAMINANTS.md was written.

## Mixing other tables with USDA

The same nutrient name doesn't always mean the same measurement. Rules for any import:

1. **Vitamin D.** USDA's total is D2 + D3. Other tables also count 25-OH-D, at different weights:
   - UK meat: 25-OH-D3 at 5x.
   - Denmark (Frida 5.x): 25-OH-D at 2.5x (EFSA).
   - Sweden: published both with and without it.
   - NEVO: listed separately.

   Import D2 and D3 only, or store the forms separately, so foreign meat doesn't look richer than US meat.
2. **Fibre.** Newer European values use AOAC 2009.01/2011.25 (the Codex definition), which reads higher than USDA's AOAC 985.29/991.43. UK CoFID also has an Englyst column; don't use it.
3. **Energy and carbohydrate.** Tables use different energy factors. Several report "available" carbohydrate, while USDA reports carbohydrate "by difference" (which includes fibre). Keep USDA's energy for USDA foods. For new foods, store the table's own value and say which method it uses.
4. **Missing isn't zero.** BLS and the branded labels say so explicitly. Keep NULL.
5. **Units.** Malawi gives manganese in µg, not mg. Several tables use "Tr", "<" and "-". Parse them; don't coerce.
6. **Provenance.** The `value_provenance` table already records non-primary values. Each borrowed value should record the source, the version, the matched food and a confidence, and the food page should say "estimated from Danish data (FCDB 6.1)" or similar. That doubles as CC BY's "indicate changes" and attribution.
7. **Matching.** The Danish table and Sweden carry FoodEx2 and LanguaL codes, and the iodine database carries USDA codes. Everything else needs name matching. Reuse the confidence approach from the contaminant mapping (exact, description rule, category).

## Open questions for a lawyer or the publisher

**Licence questions:**

1. **Open Food Facts and ODbL.** See [Open Food Facts](#open-food-facts).
   - If OFF products sit in their own tables, never merged with or checked against USDA foods, is the rest of `nutrition.db` a "Collective Database" that stays outside ODbL?
   - Does a user's diary entry built from an OFF product create any obligation?
   - Is publishing the OFF-derived table as a free download enough to satisfy section 4.6?
   - Does OFF's "must not be used for medical purposes" line limit a meal planner?
2. **NEVO.** Ask RIVM (nevo@rivm.nl) whether showing NEVO values on free pages is allowed while Plus is a paid tier.
3. **Australia.** Ask FSANZ whether AFCD and AUSNUT now fall under its CC BY 4.0 copyright page or still under the share-alike Data User Licence Agreement.
4. **Sweden.** Is "Data får inte förändras" binding alongside CC BY 4.0? Does unit conversion count as a change?
5. **Japan.** Confirm with MEXT (kagseis@mext.go.jp) that the tables contain no third-party content needing separate permission, and that a paid product is fine. Their site terms already say commercial use is permitted.
6. **Fineli.** Read the licence page by hand; it blocked automated reading.
7. **USDA Branded Foods.** Is the "Provided by Euromonitor International." credit required? Do any GS1 or 1WorldSync terms reach downstream users?
8. **Milne 2024** (already open in TODO.md and question 8 of [LEGAL.md](../LEGAL.md)). Unchanged by this research.
9. **CC BY "indicate changes".** Is a sources page plus a per-value "estimated from…" note enough for CC BY 4.0, MEXT's terms and Etalab 2.0?
10. **Restaurant nutrition.** Can we type chains' published nutrition values into our database, given that facts aren't copyrightable (Feist) but site terms may forbid scraping?
11. **Commercial APIs.** If we ever want branded or restaurant data from a vendor, get in writing whether values may be kept permanently and shown on public, search-indexed pages after we stop paying. Chomp's FAQ and licence page contradict each other. Ask CalorieKing about its "Data License".

**Permission or licence requests worth sending:**

1. FAO (copyright@fao.org) for **uFiSh**, the best fish iodine data. Ask about the West African table too, if West African foods become a goal.
2. Phenol-Explorer's authors, for polyphenols.
3. India's National Institute of Nutrition, for **IFCT 2017** (ifct2017@gmail.com).
4. Brazil TBCA (a paid licence quote).
5. Mexico's INCMNSZ and CONABIO, for the 2019 extended table.
6. Malawi (LUANAR), for its 2019 table.

**Hands-on checks (not legal):**

1. Try the TDSi "Export Data" in a browser.
2. Count CNF 2026's foods, and check whether its USDA link field survived.

## Not verified

- CNF 2026 food and nutrient counts.
- CoFID manganese and choline.
- AFCD's nutrient list.
- Whether MEXT's 2023 Excel includes English names.
- Fineli's licence text.
- CIQUAL's confidence-code definitions.
- The Danish table's per-nutrient counts (our own count from the XLSX; they may include header rows).
- The licence text inside uFiSh, uPulses and the Malawi and Mexican tables.
- FooDB's food count.
- FDA cadmium draft numbers.
- EFSA file columns.
- Consumer Reports' terms (their page returned 403).
- WHO GEMS/Food's export function.
- Edamam's "Commercial use" ticks on the Food Database page (our tools couldn't read the icons).
- Passio's storage terms, Nutritics, and pricing for CalorieKing, Trustwell and Syndigo.
- OFF's own wiki guidance for re-users (bot protection).
- NYC Open Data's full terms for MenuStat.

How this was researched: six parallel web-research passes, each reading publisher pages directly. We then re-checked the licences behind the top recommendations ourselves: BLS, the Danish table, NEVO, MEXT, CoFID, FDA TDS and TDSi. The gap figures, the FNDDS overlap, the iodine matches and the Danish nutrient counts come from our own downloads and queries on 2026-11-15.
