#!/usr/bin/env python3
"""
Automated integrity checks for food-nutrition-app/nutrition.db.

    python3 -I scripts/verify_data_integrity.py                 # all checks, exit 1 on any failure
    python3 -I scripts/verify_data_integrity.py --sample 100    # bigger raw re-check sample
    python3 -I scripts/verify_data_integrity.py --skip-raw      # no data/raw available (CI)
    python3 -I scripts/verify_data_integrity.py --api 2727569   # also compare one food with the live FDC API
                                                                # (USDA_API_KEY env var, default DEMO_KEY)

Checks: schema contract, row counts vs meta, calories non-null with a known
source, no negative nutrients, macro/unit plausibility ranges, energy vs
Atwater-from-macros (documented exceptions below), serving sizes, FTS5 table
in sync, PRAGMA integrity_check, file size, and a random-sample re-check of
foods against the raw USDA files in data/raw (independent parser).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sqlite3
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nutrient_spec as spec  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = PROJECT_ROOT / "food-nutrition-app" / "nutrition.db"
RAW_DIR = PROJECT_ROOT / "data" / "raw"

MAX_DB_MB = 50
MIN_FOODS = {"foundation_food": 300, "sr_legacy_food": 7000}

# Plausibility upper bounds per 100 g (catch unit mix-ups such as IU vs µg,
# mg vs µg, kJ vs kcal). Values are generous ceilings above the real maxima
# found in FDC (e.g. cod liver oil, salt, baking soda, dried herbs).
UPPER = {
    "calories": 905, "protein_g": 100, "total_fat_g": 100, "carbohydrate_g": 100, "fiber_g": 100,
    "sugars_g": 100, "saturated_g": 100, "monounsaturated_g": 100, "polyunsaturated_g": 100,
    "trans_g": 100, "cholesterol_mg": 3500, "vitamin_a_ug": 35000, "vitamin_c_mg": 3000,
    "vitamin_d_ug": 300, "vitamin_e_mg": 200, "vitamin_k_ug": 2000, "thiamin_mg": 30,
    "riboflavin_mg": 30, "niacin_mg": 150, "vitamin_b6_mg": 30, "folate_ug": 7000,
    "vitamin_b12_ug": 120, "pantothenic_acid_mg": 50, "calcium_mg": 40000, "iron_mg": 150,
    "magnesium_mg": 2000, "phosphorus_mg": 15000, "potassium_mg": 20000, "sodium_mg": 40000,
    # manganese: instant tea powder is genuinely ~133 mg; SR 173174 (SlimFast
    # shake mix, 269 mg) is a suspected USDA error kept as published.
    "zinc_mg": 100, "copper_mg": 20, "manganese_mg": 300, "selenium_ug": 2000,
    "water_g": 100, "alcohol_g": 100, "caffeine_mg": 6000, "choline_mg": 3000,
    "ala_g": 60, "epa_g": 20, "dha_g": 30,
}

# Energy vs 4/4/9(+7) Atwater-from-macros: allowed band is
#   0.80 * atwater(fiber counted as 0 kcal) - 15  <=  calories  <=  1.10 * atwater + 15
# Documented exceptions (USDA energy is correct; macros do not capture it):
#  - sugar-free / low-calorie products: polyols & non-nutritive sweeteners are
#    counted as carbohydrate by difference but provide ~0-2.4 kcal/g
#  - vinegars: acetic acid (~3.6 kcal/g) is not a macronutrient
#  - leavening agents: carbohydrate by difference is mostly mineral salts/starch filler
#  - SR foods computed with specific Atwater factors far from 4/4/9 (oat bran, alkalized cocoa)
ATWATER_EXCEPTIONS = {
    "sweetener/polyol": ["sugar free", "sugar-free", "sugarless", "low calorie", "reduced calorie",
                         "no sugar", "saccharin", "aspartame", "stevia"],
    "acetic acid": ["vinegar"],
    "leavening agent": ["leavening agents"],
}
ATWATER_EXCEPTION_FDC_IDS = {
    168872: "Oat bran, raw - SR specific factors (fiber-rich)",
    169594: "Cocoa, dry powder, unsweetened, processed with alkali - SR specific factors",
    173858: "Chicken spread - SR value as published",
    172243: "Seasoning mix, dry, taco, original - SR value as published",
}

REQUIRED_META = ["schema_version", "builder_version", "build_date_utc", "sources", "foods_count",
                 "serving_sizes_count", "calories_fallback_order", "calories_source_counts"]


class Checker:
    def __init__(self):
        self.failures: list[str] = []
        self.passed = 0

    def tolerate(self, offenders: list, max_allowed: int, name: str) -> bool:
        """Known USDA source anomalies: pass while their number stays small (a
        mapping/unit regression in the pipeline would blow far past it)."""
        detail = f"{len(offenders)} source anomalies (max {max_allowed})"
        if offenders:
            detail += f", e.g. {offenders[:3]}"
        return self.check(len(offenders) <= max_allowed, name, detail)

    def check(self, ok: bool, name: str, detail: str = "") -> bool:
        if ok:
            self.passed += 1
            print(f"PASS  {name}" + (f"  ({detail})" if detail else ""))
        else:
            self.failures.append(name)
            print(f"FAIL  {name}" + (f"  -- {detail}" if detail else ""))
        return ok


def close(a, b, tol_abs=0.0015, tol_rel=1e-6) -> bool:
    return abs(a - b) <= max(tol_abs, tol_rel * abs(b))


# --------------------------------------------------------------------------- #
# Independent raw readers (do not import build_db)
# --------------------------------------------------------------------------- #
def raw_foundation(fdc_ids: set[int]) -> dict:
    files = sorted(RAW_DIR.glob("FoodData_Central_foundation_food_json_*/*.json"))
    if not files:
        return {}
    with open(files[-1], encoding="utf-8") as fh:
        data = json.load(fh)
    out = {}
    for f in data["FoundationFoods"]:
        if f["fdcId"] in fdc_ids:
            n = {fn["nutrient"]["id"]: float(fn["amount"]) for fn in f["foodNutrients"]
                 if fn.get("amount") is not None}
            out[f["fdcId"]] = {"description": f["description"].strip(),
                               "category": (f.get("foodCategory") or {}).get("description"),
                               "nutrients": n,
                               "portions": [p.get("gramWeight") for p in f.get("foodPortions", [])]}
    return out


def raw_csv(pattern: str, fdc_ids: set[int]) -> dict:
    dirs = sorted(RAW_DIR.glob(pattern))
    if not dirs:
        return {}
    food_csv = sorted(dirs[-1].rglob("food.csv"))[0]
    d = food_csv.parent
    nutr = list(csv.DictReader(open(d / "nutrient.csv", encoding="utf-8")))
    ids = {r["id"] for r in nutr}
    nbr = {}
    for r in nutr:
        nbr.setdefault(r["nutrient_nbr"].removesuffix(".0"), r["id"])
    out = {}
    for r in csv.DictReader(open(food_csv, encoding="utf-8")):
        fid = int(r["fdc_id"])
        if fid in fdc_ids:
            out[fid] = {"description": r["description"].strip(), "nutrients": {}, "portions": []}
    for r in csv.DictReader(open(d / "food_nutrient.csv", encoding="utf-8")):
        fid = int(r["fdc_id"])
        if fid in out and r["amount"] != "":
            k = r["nutrient_id"]
            k = k if k in ids else nbr.get(k)
            if k is not None:
                out[fid]["nutrients"][int(k)] = float(r["amount"])
    for r in csv.DictReader(open(d / "food_portion.csv", encoding="utf-8")):
        fid = int(r["fdc_id"])
        if fid in out:
            out[fid]["portions"].append(float(r["gram_weight"]))
    return out


def expected_value(col: str, n: dict, prov: str | None):
    """What the DB should hold for `col` given raw nutrients and recorded provenance."""
    ids = spec.COLUMN_SOURCES[col]
    if prov is None:
        return n.get(ids[0]), [ids[0]]
    if prov.startswith("clamped_negative:"):
        orig = float(prov.split(":", 1)[1])
        raw = next((n[i] for i in ids if i in n), None)
        return (0.0 if raw is not None and raw < 0 and abs(raw - orig) < 1e-6 else None), ids
    if prov.startswith("fdc_"):
        nid = int(prov[4:])
        return n.get(nid), [nid]
    if prov == "rae_from_components":
        return n.get(1105, 0) + n.get(1107, 0) / 12 + (n.get(1108, 0) + n.get(1120, 0)) / 24, [1105, 1107]
    if prov == "d2_plus_d3":
        return n.get(1111, 0) + n.get(1112, 0), [1111, 1112]
    if prov == "iu_div_40":
        return n[1110] / 40, [1110]
    if prov == "dfe_from_food_folate_and_folic_acid":
        return n[1187] + 1.7 * n[1186], [1187, 1186]
    if prov == "total_folate_unfortified":
        return n[1177], [1177]
    raise ValueError(prov)


def recheck_sample(con, ck: Checker, sample_n: int, seed: int) -> None:
    rng = random.Random(seed)
    by_type = defaultdict(list)
    for fid, dtp in con.execute("SELECT fdc_id, data_type FROM foods ORDER BY id"):
        by_type[dtp].append(fid)
    per = max(1, sample_n // max(1, len(by_type)))
    sample = {dtp: rng.sample(ids, min(per, len(ids))) for dtp, ids in by_type.items()}
    raw = {}
    raw.update(raw_foundation(set(sample.get("foundation_food", []))))
    raw.update(raw_csv("FoodData_Central_sr_legacy_food_csv_*", set(sample.get("sr_legacy_food", []))))
    raw.update(raw_csv("FoodData_Central_survey_food_csv_*", set(sample.get("survey_fndds_food", []))))
    total = sum(len(v) for v in sample.values())
    if not ck.check(len(raw) == total, "raw re-check: sampled foods found in data/raw",
                    f"{len(raw)}/{total} found; run build_db.py --download if 0"):
        return

    con.row_factory = sqlite3.Row
    mismatches = []
    checked_values = 0
    for dtp, ids in sample.items():
        for fid in ids:
            row = con.execute("SELECT * FROM foods WHERE fdc_id = ?", (fid,)).fetchone()
            prov = dict(con.execute("SELECT nutrient_column, source FROM value_provenance WHERE food_id = ?",
                                    (row["id"],)).fetchall())
            r = raw[fid]
            n = r["nutrients"]
            if row["description"] != r["description"]:
                mismatches.append((fid, "description", row["description"], r["description"]))
            for col in spec.NUTRIENT_COLUMNS:
                if col == "calories":
                    continue
                got = row[col]
                exp, _ = expected_value(col, n, prov.get(col))
                checked_values += 1
                if got is None:
                    present = [i for i in spec.COLUMN_SOURCES[col] if i in n]
                    if present:
                        mismatches.append((fid, col, None, f"raw has {present}"))
                elif exp is None or not close(got, exp):
                    mismatches.append((fid, col, got, exp))
            # calories
            src = row["calories_source"]
            checked_values += 1
            if src == "computed_atwater_4_4_9":
                exp = spec.atwater_kcal(row["protein_g"], row["carbohydrate_g"], row["total_fat_g"], row["alcohol_g"])
            elif src == spec.CALORIE_SR_FALLBACK:
                sr = con.execute("SELECT calories FROM foods WHERE superseded_by_fdc_id = ? AND data_type='sr_legacy_food'",
                                 (fid,)).fetchone()
                exp = sr[0] if sr else None
            else:
                nid = dict(spec.CALORIE_SOURCES)[src]
                exp = n.get(nid)
                if exp is not None and nid == 1062:
                    exp /= 4.184
                # higher-priority energy ids must be absent
                order = [i for _, i in spec.CALORIE_SOURCES if i]
                if any(i in n for i in order[:order.index(nid)]):
                    mismatches.append((fid, "calories_source", src, "higher-priority energy id present"))
            if exp is None or not close(row["calories"], exp, tol_abs=0.01):
                mismatches.append((fid, "calories", row["calories"], exp))
            # serving weights must come from raw portions
            raw_w = {round(w, 2) for w in r["portions"] if w}
            for label, w in con.execute("SELECT label, weight_g FROM serving_sizes WHERE food_id = ?", (row["id"],)):
                if label != "100 g" and round(w, 2) not in raw_w:
                    mismatches.append((fid, f"serving {label!r}", w, sorted(raw_w)))
    con.row_factory = None
    ck.check(not mismatches, f"raw re-check of {total} random foods ({checked_values} values, seed {seed})",
             f"{len(mismatches)} mismatches: {mismatches[:5]}" if mismatches else
             ", ".join(f"{k}={len(v)}" for k, v in sample.items()))


# --------------------------------------------------------------------------- #
def run(db_path: Path, sample_n: int, seed: int, skip_raw: bool) -> Checker:
    ck = Checker()
    if not ck.check(db_path.exists(), "database exists", str(db_path)):
        return ck
    size_mb = db_path.stat().st_size / 1e6
    ck.check(size_mb < MAX_DB_MB, f"database size < {MAX_DB_MB} MB", f"{size_mb:.1f} MB")
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)

    ck.check(con.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "PRAGMA integrity_check")
    ck.check(not con.execute("PRAGMA foreign_key_check").fetchall(), "PRAGMA foreign_key_check")

    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
    ck.check({"foods", "serving_sizes", "foods_fts", "meta", "value_provenance"} <= tables, "required tables",
             ", ".join(sorted({"foods", "serving_sizes", "foods_fts", "meta", "value_provenance"} - tables)))
    cols = [r[1] for r in con.execute("PRAGMA table_info(foods)")]
    v1 = ["id", "fdc_id", "description", "data_type", "food_category", "brand_owner", "serving_size",
          "serving_size_unit"] + spec.LEGACY_COLUMNS
    ck.check(cols[:len(v1)] == v1, "foods keeps all v1 columns in order")
    ck.check(set(spec.NUTRIENT_COLUMNS + ["calories_source", "data_type_rank"]) <= set(cols), "foods has v2 columns")
    serv_cols = [r[1] for r in con.execute("PRAGMA table_info(serving_sizes)")]
    ck.check(serv_cols == ["id", "food_id", "label", "weight_g"], "serving_sizes schema unchanged")

    meta = dict(con.execute("SELECT key, value FROM meta"))
    ck.check(all(k in meta for k in REQUIRED_META), "meta provenance keys",
             ", ".join(k for k in REQUIRED_META if k not in meta))
    srcs = json.loads(meta.get("sources", "[]"))
    ck.check(srcs and all(s.get("sha256_verified") for s in srcs), "meta: all source zips sha256-verified at build",
             "; ".join(f"{s['name']} {s['release']}" for s in srcs))

    total = con.execute("SELECT COUNT(*) FROM foods").fetchone()[0]
    ck.check(str(total) == meta.get("foods_count"), "foods count matches meta", str(total))
    counts = dict(con.execute("SELECT data_type, COUNT(*) FROM foods GROUP BY 1"))
    ck.check(all(meta.get(f"count_{k}") == str(v) for k, v in counts.items()), "per-data_type counts match meta",
             json.dumps(counts))
    ck.check(all(counts.get(k, 0) >= v for k, v in MIN_FOODS.items()), "minimum rows per data_type",
             json.dumps(MIN_FOODS))
    n_serv = con.execute("SELECT COUNT(*) FROM serving_sizes").fetchone()[0]
    ck.check(str(n_serv) == meta.get("serving_sizes_count"), "serving_sizes count matches meta", str(n_serv))
    ck.check(con.execute("SELECT COUNT(*) - COUNT(DISTINCT fdc_id) FROM foods").fetchone()[0] == 0, "fdc_id unique")
    ck.check(con.execute("SELECT COUNT(*) FROM foods WHERE description IS NULL OR trim(description) = ''").fetchone()[0] == 0,
             "descriptions non-empty")
    ck.check(con.execute("SELECT COUNT(*) FROM foods WHERE food_category IS NULL").fetchone()[0] == 0, "food_category non-null")
    bad_rank = con.execute("SELECT COUNT(*) FROM foods WHERE data_type_rank != CASE data_type "
                           "WHEN 'foundation_food' THEN 1 WHEN 'sr_legacy_food' THEN 2 WHEN 'survey_fndds_food' THEN 3 END"
                           ).fetchone()[0]
    ck.check(bad_rank == 0, "data_type_rank consistent with data_type")
    ck.check(con.execute("SELECT COUNT(*) FROM foods WHERE serving_size != 100 OR serving_size_unit != 'g'").fetchone()[0] == 0,
             "per-100 g basis (serving_size=100, unit g)")

    # calories
    ck.check(con.execute("SELECT COUNT(*) FROM foods WHERE calories IS NULL").fetchone()[0] == 0, "no NULL calories")
    names = ",".join(f"'{s}'" for s in spec.CALORIE_SOURCE_NAMES)
    ck.check(con.execute(f"SELECT COUNT(*) FROM foods WHERE calories_source IS NULL OR calories_source NOT IN ({names})"
                         ).fetchone()[0] == 0, "calories_source known for every food",
             meta.get("calories_source_counts", ""))

    # ranges
    neg = {c: con.execute(f"SELECT COUNT(*) FROM foods WHERE {c} < 0").fetchone()[0] for c in spec.NUTRIENT_COLUMNS}
    ck.check(not any(neg.values()), "no negative nutrient values", json.dumps({k: v for k, v in neg.items() if v}))
    over = {}
    for c, hi in UPPER.items():
        rows = con.execute(f"SELECT description, {c} FROM foods WHERE {c} > ?", (hi,)).fetchall()
        if rows:
            over[c] = rows[:3]
    ck.check(not over, "plausible upper bounds / unit sanity (IU vs µg, mg vs µg, kJ vs kcal)", json.dumps(over)[:400])
    msum = ("coalesce(protein_g,0)+coalesce(total_fat_g,0)+coalesce(carbohydrate_g,0)"
            "+coalesce(water_g,0)+coalesce(alcohol_g,0)")
    hard = con.execute(f"SELECT description, round({msum},1) FROM foods WHERE {msum} > 106").fetchall()
    ck.check(not hard, "protein+fat+carb+water+alcohol <= 106 g per 100 g", str(hard[:3]))
    soft = con.execute(f"SELECT fdc_id, round({msum},1) FROM foods WHERE {msum} > 103").fetchall()
    ck.tolerate(soft, 5, "proximates sum <= 103 g (analytical rounding tolerated)")
    gt = con.execute("SELECT fdc_id FROM foods WHERE fiber_g > carbohydrate_g + 1 OR sugars_g > carbohydrate_g + 1").fetchall()
    ck.tolerate([r[0] for r in gt], 5, "fiber and sugars <= carbohydrate (+1 g)")
    # SR Legacy MUFA/PUFA totals of hydrogenated fats include trans isomers, so
    # trans is not added here; remaining excess is a USDA source inconsistency.
    fa = con.execute("SELECT fdc_id FROM foods WHERE coalesce(saturated_g,0)+coalesce(monounsaturated_g,0)"
                     "+coalesce(polyunsaturated_g,0) > total_fat_g * 1.05 + 0.5").fetchall()
    ck.tolerate([r[0] for r in fa], 15, "SFA+MUFA+PUFA <= total fat (+5%)")

    # energy vs Atwater
    outliers = []
    for fid, desc, cal, p, f, c, fib, alc, src in con.execute(
            "SELECT fdc_id, description, calories, protein_g, total_fat_g, carbohydrate_g, fiber_g, alcohol_g, calories_source "
            "FROM foods WHERE calories IS NOT NULL AND protein_g IS NOT NULL AND total_fat_g IS NOT NULL AND carbohydrate_g IS NOT NULL"):
        at = spec.atwater_kcal(p, c, f, alc)
        at_lo = spec.atwater_kcal(p, max(c - (fib or 0), 0), f, alc)
        if 0.80 * at_lo - 15 <= cal <= 1.10 * at + 15:
            continue
        low = desc.lower()
        if fid in ATWATER_EXCEPTION_FDC_IDS or any(k in low for ks in ATWATER_EXCEPTIONS.values() for k in ks):
            continue
        outliers.append((fid, desc[:50], cal, round(at)))
    ck.check(not outliers, "energy within Atwater band (documented exceptions excluded)",
             f"{len(outliers)} outliers: {outliers[:6]}")

    # serving sizes
    no100 = con.execute("SELECT COUNT(*) FROM foods f WHERE NOT EXISTS (SELECT 1 FROM serving_sizes s "
                        "WHERE s.food_id = f.id AND s.label = '100 g' AND s.weight_g = 100)").fetchone()[0]
    ck.check(no100 == 0, "every food has a '100 g' serving", f"{no100} missing")
    ck.check(con.execute("SELECT COUNT(*) FROM serving_sizes WHERE weight_g IS NULL OR weight_g <= 0 OR weight_g > 5000"
                         ).fetchone()[0] == 0, "serving weights in (0, 5000] g")
    ck.check(con.execute("SELECT COUNT(*) FROM serving_sizes s LEFT JOIN foods f ON f.id = s.food_id WHERE f.id IS NULL"
                         ).fetchone()[0] == 0, "no orphan serving_sizes")
    ck.check(con.execute("SELECT COUNT(*) FROM serving_sizes WHERE label IS NULL OR trim(label) = ''").fetchone()[0] == 0,
             "serving labels non-empty")
    ck.check(con.execute("SELECT COUNT(*) FROM value_provenance v LEFT JOIN foods f ON f.id = v.food_id WHERE f.id IS NULL"
                         ).fetchone()[0] == 0, "no orphan value_provenance")
    sup = con.execute("SELECT COUNT(*) FROM foods s LEFT JOIN foods f ON f.fdc_id = s.superseded_by_fdc_id "
                      "WHERE s.superseded_by_fdc_id IS NOT NULL AND (f.id IS NULL OR f.data_type != 'foundation_food')").fetchone()[0]
    ck.check(sup == 0, "superseded_by_fdc_id points at Foundation foods")

    # FTS
    fts = con.execute("SELECT COUNT(*) FROM foods_fts").fetchone()[0]
    ck.check(fts == total, "foods_fts row count == foods row count", f"{fts} vs {total}")
    # FTS5 'integrity-check' is issued as an INSERT (it writes nothing); with
    # rank=1 it also verifies the index against the external content table.
    rw = sqlite3.connect(db_path)
    try:
        rw.execute("INSERT INTO foods_fts(foods_fts, rank) VALUES ('integrity-check', 1)")
        ok, err = True, ""
    except sqlite3.Error as e:
        ok, err = False, str(e)
    rw.rollback()
    rw.close()
    ck.check(ok, "foods_fts integrity-check (index matches content table)", err)
    hits = con.execute("SELECT COUNT(*) FROM foods_fts WHERE foods_fts MATCH 'chicken'").fetchone()[0]
    like = con.execute("SELECT COUNT(*) FROM foods WHERE description LIKE '%chicken%' OR food_category LIKE '%chicken%'").fetchone()[0]
    ck.check(hits > 0 and abs(hits - like) <= like * 0.1, "FTS query 'chicken' consistent with LIKE", f"{hits} vs {like}")

    check_contaminants(con, ck)

    if skip_raw:
        print("SKIP  raw re-check (--skip-raw)")
    else:
        recheck_sample(con, ck, sample_n, seed)
    con.close()
    return ck


def check_contaminants(con, ck: Checker) -> None:
    """Contaminant tables (scripts/contaminants/build_contaminants.py). See docs/CONTAMINANT_DATA.md."""
    tables = ["contaminant_sources", "contaminants", "contaminant_reference_values", "contaminant_profiles",
              "contaminant_measurements", "food_contaminant_profiles"]
    have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if not ck.check(set(tables) <= have, "contaminants: tables present", str(sorted(set(tables) - have))):
        return
    one = lambda sql, *a: con.execute(sql, a).fetchone()[0]  # noqa: E731
    meta = dict(con.execute("SELECT key, value FROM meta WHERE key LIKE 'contaminants_%'").fetchall())
    counts = json.loads(meta.get("contaminants_counts", "{}"))
    ck.check(counts.get("mapped_foods") == one("SELECT COUNT(DISTINCT fdc_id) FROM food_contaminant_profiles"),
             "contaminants: meta mapped_foods matches", str(counts.get("mapped_foods")))
    ck.check(one("SELECT COUNT(*) FROM contaminant_measurements") == sum(counts.get("measurements", {}).values()),
             "contaminants: meta measurement count matches")
    ck.check(one("SELECT COUNT(*) FROM contaminant_sources WHERE trim(url) = '' OR trim(citation) = '' OR trim(license) = '' OR url NOT LIKE 'https://%'") == 0,
             "contaminants: every source has an https URL, a citation and a license")
    for child, col, parent in [("contaminant_measurements", "profile_id", "contaminant_profiles"),
                               ("contaminant_measurements", "contaminant_id", "contaminants"),
                               ("contaminant_measurements", "source_id", "contaminant_sources"),
                               ("contaminant_profiles", "source_id", "contaminant_sources"),
                               ("contaminant_reference_values", "source_id", "contaminant_sources"),
                               ("food_contaminant_profiles", "profile_id", "contaminant_profiles")]:
        ck.check(one(f"SELECT COUNT(*) FROM {child} c LEFT JOIN {parent} p ON p.id = c.{col} WHERE p.id IS NULL") == 0,
                 f"contaminants: {child}.{col} resolves")
    ck.check(one("SELECT COUNT(*) FROM food_contaminant_profiles l LEFT JOIN foods f ON f.fdc_id = l.fdc_id WHERE f.fdc_id IS NULL") == 0,
             "contaminants: mapped foods exist")
    ck.check(one("SELECT COUNT(*) FROM contaminants c LEFT JOIN contaminant_reference_values r ON r.id = c.reference_id WHERE c.reference_id IS NOT NULL AND r.id IS NULL") == 0,
             "contaminants: contaminant references resolve")
    # At most one profile per family, so a food can't get two conflicting answers from one source.
    ck.check(one("SELECT COUNT(*) FROM (SELECT 1 FROM food_contaminant_profiles GROUP BY fdc_id, family HAVING COUNT(*) > 1)") == 0,
             "contaminants: one profile per food per family")
    ck.check(one("SELECT COUNT(*) FROM contaminant_measurements WHERE value < 0 OR (upper_bound IS NOT NULL AND upper_bound < value)") == 0,
             "contaminants: values non-negative and upper bound at least the mean")
    ck.check(one("SELECT COUNT(*) FROM contaminant_measurements WHERE detection_frequency < 0 OR detection_frequency > 1 OR n_detected > n_samples") == 0,
             "contaminants: detection rates within range")
    # Unit sanity. 1 ppm of lead in a food average, or 2 ppm of mercury, would suggest a ppb/ppm mix-up.
    ck.check(one("SELECT COUNT(*) FROM contaminant_measurements WHERE contaminant_id = 'lead' AND value > 1000") == 0,
             "contaminants: lead means plausible (under 1000 ppb)")
    ck.check(one("SELECT COUNT(*) FROM contaminant_measurements WHERE contaminant_id = 'mercury' AND value > 2000") == 0,
             "contaminants: mercury means plausible (under 2000 ppb)")
    ck.check(one("SELECT COUNT(*) FROM contaminant_measurements WHERE contaminant_id = 'microplastics' AND value > 10") == 0,
             "contaminants: microplastic estimates plausible (under 10 per gram)")
    ck.check(one("SELECT COUNT(*) FROM food_contaminant_profiles WHERE moisture_factor IS NOT NULL AND (moisture_factor < 0.1 OR moisture_factor > 12)") == 0,
             "contaminants: moisture factors within the clamp")
    # Known published values must survive the pipeline.
    expect = [("fish:SWORDFISH", "mercury", 995), ("fish:SALMON (FRESH/FROZEN)", "mercury", 22), ("rice:white_long", "arsenic_inorganic", 103.3)]
    for pid, cid, value in expect:
        row = con.execute("SELECT value FROM contaminant_measurements WHERE profile_id = ? AND contaminant_id = ?", (pid, cid)).fetchone()
        ck.check(row is not None and abs(row[0] - value) < 1e-6, f"contaminants: {pid} {cid} = {value} ug/kg", str(row))
    # Spot checks: variants share a profile, and foods that must not match stay unmatched.
    fam = lambda d, f: con.execute(  # noqa: E731
        "SELECT l.profile_id FROM food_contaminant_profiles l JOIN foods x ON x.fdc_id = l.fdc_id WHERE x.description = ? AND l.family = ?", (d, f)).fetchone()
    for d in ["Eggs, Grade A, Large, egg whole", "Egg, whole, raw, fresh", "Egg, whole, cooked, hard-boiled", "Egg, whole, cooked, scrambled"]:
        ck.check((fam(d, "tds") or [None])[0] == "tds:37", f"contaminants: {d!r} shares egg profile tds:37")
    organ = one("""SELECT COUNT(*) FROM food_contaminant_profiles l JOIN foods f ON f.fdc_id = l.fdc_id
                   WHERE l.family = 'tds' AND f.food_category IN ('Beef Products', 'Pork Products', 'Lamb, Veal, and Game Products')
                   AND (lower(f.description) LIKE '%liver%' OR lower(f.description) LIKE '%kidney%')""")
    ck.check(organ == 0, "contaminants: organ meats are not mapped to muscle-meat data", str(organ))
    mixed = one("""SELECT COUNT(*) FROM food_contaminant_profiles l JOIN foods f ON f.fdc_id = l.fdc_id
                   WHERE f.data_type = 'survey_fndds_food' AND l.family IN ('rice', 'fish', 'pdp')""")
    ck.check(mixed == 0, "contaminants: mixed dishes are not mapped to single-ingredient data", str(mixed))


def api_compare(db_path: Path, fdc_id: int) -> int:
    # Never hard-code keys: env var, then gitignored config/api_keys.txt, then DEMO_KEY.
    key = os.environ.get("USDA_API_KEY", "").strip()
    cfg = PROJECT_ROOT / "config" / "api_keys.txt"
    if not key and cfg.exists():
        key = cfg.read_text(encoding="utf-8").strip()
    key = key or "DEMO_KEY"
    url = f"https://api.nal.usda.gov/fdc/v1/food/{fdc_id}?api_key={key}"
    with urllib.request.urlopen(url, timeout=60) as resp:
        data = json.load(resp)
    n = {fn["nutrient"]["id"]: fn["amount"] for fn in data.get("foodNutrients", [])
         if fn.get("amount") is not None and "nutrient" in fn}
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    row = con.execute("SELECT * FROM foods WHERE fdc_id = ?", (fdc_id,)).fetchone()
    if row is None:
        print(f"{fdc_id} not in database")
        return 1
    prov = dict(con.execute("SELECT nutrient_column, source FROM value_provenance WHERE food_id = ?", (row["id"],)).fetchall())
    bad = 0
    print(f"{fdc_id}  DB: {row['description']!r}  API: {data.get('description')!r}  ({data.get('dataType')})")
    for col in spec.NUTRIENT_COLUMNS:
        if col == "calories":
            continue
        try:
            exp, _ = expected_value(col, n, prov.get(col))
        except KeyError:
            exp = None
        got = row[col]
        ok = (got is None and exp is None) or (got is not None and exp is not None and close(got, exp, 0.0015, 0.01))  # API rounds FNDDS to 3 sig. digits
        bad += not ok
        if not ok:
            print(f"  MISMATCH {col}: db={got} api={exp}")
    print(f"  calories db={row['calories']} ({row['calories_source']}); "
          f"api 1008={n.get(1008)} 2048={n.get(2048)} 2047={n.get(2047)}")
    print("RESULT:", "match" if not bad else f"{bad} mismatches")
    return 1 if bad else 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=str(DEFAULT_DB))
    p.add_argument("--sample", type=int, default=60, help="foods to re-check against raw files (default 60)")
    p.add_argument("--seed", type=int, default=None, help="random seed (default: random, printed)")
    p.add_argument("--skip-raw", action="store_true")
    p.add_argument("--api", type=int, metavar="FDC_ID", help="compare one food with the live FDC API and exit")
    args = p.parse_args(argv)
    db = Path(args.db)
    if args.api:
        return api_compare(db, args.api)
    seed = args.seed if args.seed is not None else random.SystemRandom().randrange(1 << 30)
    ck = run(db, args.sample, seed, args.skip_raw)
    print(f"\nSUMMARY: {ck.passed} passed, {len(ck.failures)} failed")
    if ck.failures:
        print("FAILED: " + "; ".join(ck.failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
