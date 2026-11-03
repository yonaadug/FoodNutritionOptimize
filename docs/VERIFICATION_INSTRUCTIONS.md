# Building and Verifying the Nutrition Database

You need Python 3.10+ and nothing else: the builder and the validator use only
the standard library. Run every command from the repository root. The `-I`
flag (isolated mode) is recommended because both scripts read downloaded,
untrusted files.

## 1. Build

```bash
python3 -I scripts/build_db.py --download
```

This one command does the following:

1. Downloads the pinned USDA FoodData Central releases into `data/raw/zips/`.
   That directory is gitignored. The releases are Foundation Foods 2026-10-29
   (JSON), SR Legacy 2018-04 (CSV) and FNDDS 2024-10-31 (CSV).
2. Checks each file's sha256 against the pin in `SOURCES` in
   `scripts/build_db.py`.
3. Extracts each zip into its own `data/raw/<zip name>/` directory, with
   protection against path traversal.
4. Builds the database in a temporary file. When the build finishes, it
   atomically replaces `food-nutrition-app/nutrition.db`.

If the files are already downloaded, run `python3 -I scripts/build_db.py`
without `--download`. Other options:

- `--out PATH`: write the database somewhere else
- `--no-fndds`: leave out FNDDS foods
- `--fndds-all`: include every FNDDS category
- `--include-baby-foods`: keep baby foods
- `--allow-hash-mismatch`: use this only after reviewing a file that USDA
  re-issued

To update to a newer USDA release:

1. Find the new file names at <https://fdc.nal.usda.gov/download-datasets/>.
2. Edit `SOURCES` in `build_db.py`: change `release`, `zip` and `sha256`
   (compute the hash with `shasum -a 256`).
3. Check that the CSV zip contains `food.csv`, `food_nutrient.csv` and
   `food_portion.csv`. The 2026-10-29 Foundation CSV zip doesn't, which is
   why the builder uses that release's JSON.
4. Rebuild, then validate.

How nutrients are mapped is described in [KEY_NUTRIENTS.md](KEY_NUTRIENTS.md)
and defined in `scripts/nutrient_spec.py`.

## 2. Validate (required after every build)

```bash
python3 -I scripts/verify_data_integrity.py              # exit code 0 = all checks passed
python3 -I scripts/verify_data_integrity.py --sample 200 --seed 42
python3 -I scripts/verify_data_integrity.py --skip-raw   # when data/raw is not available (e.g. CI)
```

The validator checks these things, and exits with code 1 if any check fails:

- **Schema contract:**
  - Every v1 `foods` column is present, in the original order.
  - The v2 columns exist.
  - The `serving_sizes` schema is unchanged.
  - The `foods_fts`, `meta` and `value_provenance` tables exist.
- **Counts:** the counts in `meta` match the table rows. There are at least
  300 Foundation foods and 7,000 SR Legacy foods. `fdc_id` is unique.
- **Calories:** no row has NULL calories, and every row's `calories_source`
  is a known source.
- **Ranges and units:**
  - No nutrient value is negative.
  - Each column has an upper bound per 100 g. For example, calories are at
    most 905, vitamin D at most 300 µg and sodium at most 40,000 mg. These
    bounds catch IU/µg, mg/µg and kJ/kcal mix-ups.
  - Protein, fat, carbohydrate, water and alcohol add up to at most 106 g.
  - Fiber and sugars are at most carbohydrate + 1 g.
  - SFA + MUFA + PUFA is at most total fat + 5%.
  - Known USDA anomalies are tolerated up to a small fixed count, which a
    pipeline regression would exceed.
- **Energy vs Atwater:** calories must fall within
  `0.8 × atwater(fiber = 0 kcal) − 15 … 1.1 × atwater + 15`. Documented
  exceptions are sugar-free/polyol products, vinegars, leavening agents and
  4 listed SR foods.
- **Serving sizes:** every food has `100 g`, every weight is in (0, 5000] g,
  and there are no orphan rows.
- **FTS5:** the `foods_fts` row count equals the `foods` row count, the FTS5
  `integrity-check` passes, and `MATCH 'chicken'` agrees with `LIKE`.
- **SQLite:** `PRAGMA integrity_check` and `foreign_key_check` pass, and the
  file is under 50 MB.
- **Raw re-check:** a random sample (default 60 foods, split evenly across
  data types, with the seed printed) is re-read from `data/raw` by a separate
  parser. For each food, every nutrient column, the calories and each serving
  weight are compared against the source value named by `value_provenance`
  (or the column's primary nutrient id). For NULL values, the check confirms
  the source really has no value.

Result of the 2026-11-03 build: **39 passed, 0 failed**. The raw re-check
covered 90 foods and 3,600 values, with seed 20261103.

## 3. Spot-check against the live FDC API (optional)

```bash
USDA_API_KEY=your_key python3 -I scripts/verify_data_integrity.py --api 746778
```

This compares one food's database row with
`https://api.nal.usda.gov/fdc/v1/food/{fdcId}`. Without `USDA_API_KEY` it
uses `DEMO_KEY`, which is heavily rate-limited (about 30 requests per hour).
The API rounds FNDDS values to 3 significant digits, so the comparison allows
a 1% difference.

## 4. Inspect

```bash
scripts/db_shell.sh
sqlite> SELECT key, value FROM meta;
sqlite> SELECT data_type, calories_source, COUNT(*) FROM foods GROUP BY 1, 2;
sqlite> SELECT f.description, f.data_type FROM foods_fts JOIN foods f ON f.id = foods_fts.rowid
   ...>  WHERE foods_fts MATCH 'chicken breast' ORDER BY f.data_type_rank, bm25(foods_fts) LIMIT 10;
```
