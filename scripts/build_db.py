#!/usr/bin/env python3
"""
Build food-nutrition-app/nutrition.db from USDA FoodData Central bulk downloads.

Reproducible, stdlib-only pipeline:

    python3 -I scripts/build_db.py --download      # fetch + verify + extract, then build
    python3 -I scripts/build_db.py                 # build from data/raw (already downloaded)
    python3 -I scripts/verify_data_integrity.py    # validate the result (exit 1 on failure)

Sources (pinned below in SOURCES, sha256-verified):
  * Foundation Foods  2026-10-29 (JSON; the CSV zip of this release is incomplete -
    it ships without food.csv / food_nutrient.csv / food_portion.csv)
  * SR Legacy         2018-04    (CSV; final release, frozen by USDA)
  * FNDDS / Survey    2024-10-31 (CSV; FNDDS 2021-2023) - only WWEIA "Mixed Dishes"
    categories (30xx-38xx) are included by default, see docs/KEY_NUTRIENTS.md.

Downloaded files are treated as untrusted data: they are only parsed as CSV/JSON,
never executed; zip members are extracted with path-traversal protection.

Schema contract (see docs/KEY_NUTRIENTS.md):
  * `foods` keeps every v1 column; all nutrient columns are per 100 g edible portion.
  * Missing nutrient = NULL, measured zero = 0. `calories` is never NULL and
    `calories_source` says where it came from.
  * `foods_fts` (FTS5, external content on foods), `meta` (provenance),
    `value_provenance` (non-primary / derived values), `serving_sizes`
    (always includes "100 g").
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nutrient_spec as spec  # noqa: E402

BUILDER_VERSION = "2.0.0"
SCHEMA_VERSION = "2"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "data" / "raw"
DEFAULT_OUT = PROJECT_ROOT / "food-nutrition-app" / "nutrition.db"
FDC_BASE = "https://fdc.nal.usda.gov/fdc-datasets/"

SOURCES = {
    "foundation": {
        "data_type": "foundation_food",
        "name": "FoodData Central Foundation Foods",
        "release": "2026-10-29",
        "format": "json",
        "zip": "FoodData_Central_foundation_food_json_2026-10-29.zip",
        "sha256": "dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579",
    },
    "sr_legacy": {
        "data_type": "sr_legacy_food",
        "name": "FoodData Central SR Legacy",
        "release": "2018-04",
        "format": "csv",
        "zip": "FoodData_Central_sr_legacy_food_csv_2018-04.zip",
        "sha256": "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0",
    },
    "fndds": {
        "data_type": "survey_fndds_food",
        "name": "FoodData Central Survey Foods (FNDDS 2021-2023)",
        "release": "2024-10-31",
        "format": "csv",
        "zip": "FoodData_Central_survey_food_csv_2024-10-31.zip",
        "sha256": "5ccc25ec2777a8982fbb61378a42f415316173eb11e48c9a8ba4cb19f5a4f29c",
    },
}

# SR Legacy food categories excluded by default (ids from food_category.csv).
SR_EXCLUDED_CATEGORIES = {"Baby Foods", "Quality Control Materials", "Branded Food Products Database"}
# FNDDS: WWEIA categories included by default = "Mixed Dishes" + sandwiches + soups.
FNDDS_DEFAULT_CATEGORY_RANGE = (3000, 3899)
FNDDS_BABY_RANGE = (9000, 9699)   # baby foods, infant formula, human milk - always excluded

MAX_PORTION_G = 5000.0


def log(msg: str) -> None:
    print(msg, flush=True)


# --------------------------------------------------------------------------- #
# Download / extraction
# --------------------------------------------------------------------------- #
def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_extract(zpath: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    with zipfile.ZipFile(zpath) as zf:
        for info in zf.infolist():
            name = PurePosixPath(info.filename)
            if name.is_absolute() or ".." in name.parts:
                raise RuntimeError(f"unsafe path in {zpath.name}: {info.filename}")
            target = (dest / Path(*name.parts)).resolve()
            if root not in target.parents and target != root:
                raise RuntimeError(f"unsafe path in {zpath.name}: {info.filename}")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as out:
                while True:
                    chunk = src.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)


def source_dir(key: str) -> Path:
    return RAW_DIR / Path(SOURCES[key]["zip"]).stem


def fetch_sources(allow_hash_mismatch: bool) -> None:
    zips = RAW_DIR / "zips"
    zips.mkdir(parents=True, exist_ok=True)
    for key, src in SOURCES.items():
        zpath = zips / src["zip"]
        if zpath.exists() and sha256_of(zpath) == src["sha256"]:
            log(f"[download] {src['zip']}: cached, sha256 ok")
        else:
            url = FDC_BASE + src["zip"]
            log(f"[download] {url}")
            tmp = zpath.with_suffix(".part")
            req = urllib.request.Request(url, headers={"User-Agent": "MicronutrientDiary-build_db/" + BUILDER_VERSION})
            with urllib.request.urlopen(req, timeout=600) as resp, open(tmp, "wb") as out:
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
            tmp.replace(zpath)
            digest = sha256_of(zpath)
            if digest != src["sha256"]:
                msg = f"sha256 mismatch for {src['zip']}: got {digest}, pinned {src['sha256']}"
                if not allow_hash_mismatch:
                    raise SystemExit(msg + " (USDA may have re-issued the file; re-run with --allow-hash-mismatch after review)")
                log("WARNING: " + msg)
        dest = source_dir(key)
        if not dest.exists():
            log(f"[extract] {zpath.name} -> {dest.relative_to(PROJECT_ROOT)}")
            safe_extract(zpath, dest)


def find_file(root: Path, name: str) -> Path:
    hits = sorted(p for p in root.rglob(name) if p.is_file())
    if not hits:
        raise SystemExit(f"required file {name} not found under {root} (run with --download)")
    return hits[0]


# --------------------------------------------------------------------------- #
# Portion labels
# --------------------------------------------------------------------------- #
def fmt_amount(a) -> str:
    if a in (None, ""):
        return ""
    try:
        x = float(a)
    except ValueError:
        return str(a).strip()
    if x <= 0:
        return ""
    return str(int(x)) if x.is_integer() else f"{x:g}"


def portion_label(amount, unit: str | None, modifier: str | None, description: str | None) -> str:
    unit = (unit or "").strip()
    modifier = (modifier or "").strip()
    description = (description or "").strip()
    if modifier.isdigit():          # FNDDS stores numeric portion codes in `modifier`
        modifier = ""
    if description and not modifier and unit in ("", "undetermined"):
        label = description         # FNDDS: "1 cup", "1 medium (2-1/2\" dia)"
        if description.lower() == "quantity not specified":
            label = "Quantity not specified (typical portion)"
        return re.sub(r"\s+", " ", label)
    amt = fmt_amount(amount)
    parts = [amt] if amt else []
    if unit and unit != "undetermined":
        parts.append(unit)
        if modifier:
            parts[-1] += ","
            parts.append(modifier)
    elif modifier:
        parts.append(modifier)
    if description and description.lower() not in (modifier.lower(), unit.lower()):
        parts.append(f"({description})")
    label = " ".join(parts).strip(" ,") or "1 serving"
    return re.sub(r"\s+", " ", label)


def finalize_portions(raw: list[tuple[str, float]]) -> list[tuple[str, float]]:
    out = [("100 g", 100.0)]
    seen = {("100 g", 100.0)}
    for label, w in raw:
        if w is None or not (0 < w <= MAX_PORTION_G):
            continue
        w = round(float(w), 2)
        key = (label.lower(), w)
        if key in seen:
            continue
        seen.add(key)
        out.append((label, w))
    return out


# --------------------------------------------------------------------------- #
# Loaders -> list of normalized food dicts
# --------------------------------------------------------------------------- #
class UnitError(Exception):
    pass


def check_unit(nid: int, unit: str, where: str) -> None:
    exp = spec.EXPECTED_UNITS.get(nid)
    if exp is None:
        return
    u = unit.strip().upper().replace("µ", "U").replace("Μ", "U")
    if u != exp:
        raise UnitError(f"{where}: nutrient {nid} unit {unit!r} != expected {exp}")


def read_csv(path: Path):
    with open(path, encoding="utf-8", newline="") as fh:
        yield from csv.DictReader(fh)


def load_foundation_json(root: Path, src: dict) -> list[dict]:
    jpath = find_file(root, "*.json")
    with open(jpath, encoding="utf-8") as fh:
        data = json.load(fh)
    foods = []
    for f in data["FoundationFoods"]:
        n = {}
        for fn in f.get("foodNutrients", []):
            nut = fn.get("nutrient") or {}
            nid = nut.get("id")
            amt = fn.get("amount")
            if nid is None or amt is None:
                continue
            check_unit(nid, nut.get("unitName", ""), f"foundation fdc {f['fdcId']}")
            n[int(nid)] = float(amt)
        portions = []
        for p in f.get("foodPortions", []):
            mu = (p.get("measureUnit") or {}).get("name")
            portions.append((portion_label(p.get("amount", p.get("value")), mu, p.get("modifier"),
                                           p.get("portionDescription")), p.get("gramWeight")))
        foods.append({
            "fdc_id": int(f["fdcId"]),
            "description": f["description"].strip(),
            "data_type": src["data_type"],
            "food_category": (f.get("foodCategory") or {}).get("description"),
            "ndb_number": int(f["ndbNumber"]) if f.get("ndbNumber") not in (None, "") else None,
            "fndds_food_code": None,
            "publication_date": f.get("publicationDate"),
            "nutrients": n,
            "portions": portions,
        })
    return foods


def load_csv_dataset(root: Path, src: dict, key: str, args) -> list[dict]:
    food_csv = find_file(root, "food.csv")
    d = food_csv.parent
    nutrient_rows = list(read_csv(d / "nutrient.csv"))
    nid_units = {int(r["id"]): r["unit_name"] for r in nutrient_rows}
    nbr_to_id = {}
    for r in nutrient_rows:
        if r["nutrient_nbr"]:
            nbr = r["nutrient_nbr"].strip()
            nbr = nbr[:-2] if nbr.endswith(".0") else nbr
            nbr_to_id.setdefault(nbr, int(r["id"]))
    units = {r["id"]: r["name"] for r in read_csv(d / "measure_unit.csv")}

    foods: dict[int, dict] = {}
    if key == "fndds":
        cats = {r["wweia_food_category"]: r["wweia_food_category_description"]
                for r in read_csv(d / "wweia_food_category.csv")}
        codes = {int(r["fdc_id"]): int(r["food_code"]) for r in read_csv(d / "survey_fndds_food.csv")}
        lo, hi = (0, 99999) if args.fndds_all else FNDDS_DEFAULT_CATEGORY_RANGE
    else:
        cats = {r["id"]: r["description"] for r in read_csv(d / "food_category.csv")}
        ndb_file = d / ("sr_legacy_food.csv" if key == "sr_legacy" else "foundation_food.csv")
        ndbs = {int(r["fdc_id"]): int(r["NDB_number"]) for r in read_csv(ndb_file) if r["NDB_number"]}

    skipped = Counter()
    for r in read_csv(food_csv):
        if r["data_type"] != src["data_type"]:
            continue
        fid = int(r["fdc_id"])
        cat_id = r["food_category_id"]
        cat = cats.get(cat_id)
        if key == "fndds":
            c = int(cat_id) if cat_id.isdigit() else -1
            if FNDDS_BABY_RANGE[0] <= c <= FNDDS_BABY_RANGE[1] and not args.include_baby_foods:
                skipped["baby/infant category"] += 1
                continue
            if not (lo <= c <= hi):
                skipped["outside included WWEIA categories"] += 1
                continue
        elif cat in SR_EXCLUDED_CATEGORIES and not (args.include_baby_foods and cat == "Baby Foods"):
            skipped[f"category {cat}"] += 1
            continue
        foods[fid] = {
            "fdc_id": fid,
            "description": r["description"].strip(),
            "data_type": src["data_type"],
            "food_category": cat,
            "ndb_number": ndbs.get(fid) if key != "fndds" else None,
            "fndds_food_code": codes.get(fid) if key == "fndds" else None,
            "publication_date": r.get("publication_date"),
            "nutrients": {},
            "portions": [],
        }
    for k, v in skipped.items():
        log(f"  [{key}] skipped {v} foods: {k}")

    # Some releases (FNDDS) store nutrient_nbr in food_nutrient.nutrient_id.
    fn_path = d / "food_nutrient.csv"
    sample_ids = set()
    for i, r in enumerate(read_csv(fn_path)):
        sample_ids.add(int(float(r["nutrient_id"])))
        if i > 5000:
            break
    # nutrient ids are >= 1001; legacy nutrient numbers are < 1000
    uses_nbr = max(sample_ids) < 1000
    if uses_nbr:
        log(f"  [{key}] food_nutrient.nutrient_id holds nutrient numbers; mapping via nutrient.csv nutrient_nbr")
    for r in read_csv(fn_path):
        fid = int(r["fdc_id"])
        f = foods.get(fid)
        if f is None or r["amount"] == "":
            continue
        raw = r["nutrient_id"].strip()
        if uses_nbr:
            nid = nbr_to_id.get(raw[:-2] if raw.endswith(".0") else raw)
            if nid is None:
                continue
        else:
            nid = int(raw)
        check_unit(nid, nid_units.get(nid, ""), f"{key} fdc {fid}")
        f["nutrients"][nid] = float(r["amount"])

    for r in read_csv(d / "food_portion.csv"):
        f = foods.get(int(r["fdc_id"])) if r["fdc_id"].isdigit() else None
        if f is None:
            continue
        try:
            w = float(r["gram_weight"])
        except ValueError:
            continue
        seq = int(r["seq_num"]) if r.get("seq_num", "").isdigit() else 9999
        label = portion_label(r["amount"], units.get(r["measure_unit_id"]), r["modifier"], r["portion_description"])
        f["portions"].append((seq, int(r["id"]), label, w))
    for f in foods.values():
        f["portions"] = [(lbl, w) for _, _, lbl, w in sorted(f["portions"])]
    return list(foods.values())


# --------------------------------------------------------------------------- #
# Database
# --------------------------------------------------------------------------- #
def create_schema(con: sqlite3.Connection) -> None:
    ncols = ",\n    ".join(f"{c} REAL" for c in spec.NUTRIENT_COLUMNS)
    con.executescript(f"""
CREATE TABLE foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fdc_id INTEGER UNIQUE,
    description TEXT,
    data_type TEXT,
    food_category TEXT,
    brand_owner TEXT,
    serving_size REAL,
    serving_size_unit TEXT,
    {ncols},
    calories_source TEXT NOT NULL,
    data_type_rank INTEGER NOT NULL,
    ndb_number INTEGER,
    fndds_food_code INTEGER,
    superseded_by_fdc_id INTEGER,
    publication_date TEXT,
    source_release TEXT NOT NULL
);
CREATE TABLE serving_sizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id INTEGER,
    label TEXT,
    weight_g REAL,
    FOREIGN KEY(food_id) REFERENCES foods(id)
);
CREATE TABLE value_provenance (
    food_id INTEGER NOT NULL REFERENCES foods(id),
    nutrient_column TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (food_id, nutrient_column)
) WITHOUT ROWID;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX idx_serving_sizes_food_id ON serving_sizes(food_id);
CREATE INDEX idx_foods_data_type_rank ON foods(data_type_rank);
CREATE INDEX idx_foods_food_category ON foods(food_category);
CREATE VIRTUAL TABLE foods_fts USING fts5(
    description, food_category,
    content='foods', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2',
    prefix='2 3'
);
CREATE TRIGGER foods_fts_ai AFTER INSERT ON foods BEGIN
  INSERT INTO foods_fts(rowid, description, food_category) VALUES (new.id, new.description, new.food_category);
END;
CREATE TRIGGER foods_fts_ad AFTER DELETE ON foods BEGIN
  INSERT INTO foods_fts(foods_fts, rowid, description, food_category) VALUES ('delete', old.id, old.description, old.food_category);
END;
CREATE TRIGGER foods_fts_au AFTER UPDATE ON foods BEGIN
  INSERT INTO foods_fts(foods_fts, rowid, description, food_category) VALUES ('delete', old.id, old.description, old.food_category);
  INSERT INTO foods_fts(rowid, description, food_category) VALUES (new.id, new.description, new.food_category);
END;
""")


def build(args) -> Path:
    loaded: list[dict] = []
    source_meta = []
    for key, src in SOURCES.items():
        if key == "fndds" and args.no_fndds:
            continue
        root = source_dir(key)
        if not root.exists():
            raise SystemExit(f"{root} missing - run with --download")
        log(f"[load] {src['name']} {src['release']} ({src['format']})")
        foods = load_foundation_json(root, src) if src["format"] == "json" else load_csv_dataset(root, src, key, args)
        for f in foods:
            f["source_release"] = f"{src['name']} {src['release']}"
        log(f"  {len(foods)} foods")
        loaded.extend(foods)
        zpath = RAW_DIR / "zips" / src["zip"]
        source_meta.append({
            "key": key, "name": src["name"], "release": src["release"], "format": src["format"],
            "url": FDC_BASE + src["zip"], "sha256": src["sha256"],
            "sha256_verified": zpath.exists() and sha256_of(zpath) == src["sha256"],
            "foods_loaded": len(foods),
        })

    # Cross-dataset duplicates: SR Legacy rows whose NDB number also appears in
    # Foundation Foods describe the same commodity; Foundation is newer analytic
    # data, so the SR row gets superseded_by_fdc_id (kept, not deleted).
    found_by_ndb = {f["ndb_number"]: f["fdc_id"] for f in loaded
                    if f["data_type"] == "foundation_food" and f["ndb_number"]}
    sr_energy_by_ndb = {}
    for f in loaded:
        if f["data_type"] == "sr_legacy_food" and f["ndb_number"] in found_by_ndb:
            f["superseded_by_fdc_id"] = found_by_ndb[f["ndb_number"]]
            if 1008 in f["nutrients"]:
                sr_energy_by_ndb[f["ndb_number"]] = f["nutrients"][1008]
        else:
            f["superseded_by_fdc_id"] = None

    # Resolve nutrients; drop foods whose energy cannot be determined.
    excluded = []
    kept = []
    for f in loaded:
        sr_e = sr_energy_by_ndb.get(f["ndb_number"]) if f["data_type"] == "foundation_food" else None
        f["resolved"] = spec.resolve_nutrients(f["nutrients"], sr_e)
        if f["resolved"][2] is None:
            excluded.append({"fdc_id": f["fdc_id"], "data_type": f["data_type"], "description": f["description"]})
        else:
            kept.append(f)
    if excluded:
        log(f"  excluded {len(excluded)} foods with no determinable energy: "
            + "; ".join(e["description"] for e in excluded[:8]) + (" ..." if len(excluded) > 8 else ""))
    loaded = kept

    ids = Counter(f["fdc_id"] for f in loaded)
    dup = [i for i, c in ids.items() if c > 1]
    if dup:
        raise SystemExit(f"duplicate fdc_ids across sources: {dup[:10]}")

    loaded.sort(key=lambda f: (spec.DATA_TYPE_RANK[f["data_type"]], f["description"].lower(), f["fdc_id"]))

    out = Path(args.out).resolve()
    tmp = out.with_suffix(".db.tmp")
    if tmp.exists():
        tmp.unlink()
    con = sqlite3.connect(tmp)
    con.execute("PRAGMA journal_mode=OFF")
    con.execute("PRAGMA synchronous=OFF")
    create_schema(con)

    cols = (["fdc_id", "description", "data_type", "food_category", "brand_owner", "serving_size",
             "serving_size_unit"] + spec.NUTRIENT_COLUMNS +
            ["calories_source", "data_type_rank", "ndb_number", "fndds_food_code", "superseded_by_fdc_id",
             "publication_date", "source_release"])
    sql = f"INSERT INTO foods ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
    cal_src = Counter()
    cal_src_by_type = defaultdict(Counter)
    prov_counts = Counter()
    n_serv = 0
    for f in loaded:
        vals, prov, csrc = f["resolved"]
        cal_src[csrc] += 1
        cal_src_by_type[f["data_type"]][csrc] += 1
        row = ([f["fdc_id"], f["description"], f["data_type"], f["food_category"], None, 100.0, "g"]
               + [vals[c] for c in spec.NUTRIENT_COLUMNS]
               + [csrc, spec.DATA_TYPE_RANK[f["data_type"]], f["ndb_number"], f["fndds_food_code"],
                  f["superseded_by_fdc_id"], f["publication_date"], f["source_release"]])
        cur = con.execute(sql, row)
        food_id = cur.lastrowid
        for col, how in prov.items():
            con.execute("INSERT INTO value_provenance VALUES (?, ?, ?)", (food_id, col, how))
            prov_counts[f"{col}:{how.split(':')[0]}"] += 1
        for label, w in finalize_portions(f["portions"]):
            con.execute("INSERT INTO serving_sizes (food_id, label, weight_g) VALUES (?, ?, ?)", (food_id, label, w))
            n_serv += 1

    con.execute("INSERT INTO foods_fts(foods_fts) VALUES ('optimize')")

    # Coverage / meta
    total = con.execute("SELECT COUNT(*) FROM foods").fetchone()[0]
    coverage = {}
    for c in spec.NUTRIENT_COLUMNS:
        nn = con.execute(f"SELECT COUNT({c}) FROM foods").fetchone()[0]
        coverage[c] = round(100.0 * nn / total, 1)
    by_type = dict(con.execute("SELECT data_type, COUNT(*) FROM foods GROUP BY 1 ORDER BY MIN(data_type_rank)").fetchall())
    meta = {
        "schema_version": SCHEMA_VERSION,
        "builder": "scripts/build_db.py",
        "builder_version": BUILDER_VERSION,
        "nutrient_spec_version": spec.SPEC_VERSION,
        "build_date_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sources": json.dumps(source_meta),
        "download_page": "https://fdc.nal.usda.gov/download-datasets/",
        "basis": "All nutrient columns are per 100 g edible portion. NULL = not reported by the source; 0 = reported as zero.",
        "calories_fallback_order": " -> ".join(spec.CALORIE_SOURCE_NAMES),
        "calories_source_counts": json.dumps(dict(cal_src)),
        "calories_source_counts_by_data_type": json.dumps({k: dict(v) for k, v in cal_src_by_type.items()}),
        "value_provenance_counts": json.dumps(dict(prov_counts)),
        "derivations": json.dumps(spec.DERIVATIONS),
        "foods_count": str(total),
        "excluded_foods_no_energy": json.dumps(excluded),
        "serving_sizes_count": str(n_serv),
        "nutrient_coverage_pct": json.dumps(coverage),
        "fndds_category_filter": "all non-baby WWEIA categories" if args.fndds_all else
                                 f"WWEIA {FNDDS_DEFAULT_CATEGORY_RANGE[0]}-{FNDDS_DEFAULT_CATEGORY_RANGE[1]} (mixed dishes, sandwiches, soups)",
        "sr_excluded_categories": json.dumps(sorted(SR_EXCLUDED_CATEGORIES - ({"Baby Foods"} if args.include_baby_foods else set()))),
        "duplicate_policy": "All rows kept. SR Legacy rows whose NDB number matches a Foundation food carry superseded_by_fdc_id. "
                            "Rank results by data_type_rank (1 Foundation, 2 SR Legacy, 3 FNDDS).",
        "license": "USDA FoodData Central data is in the public domain (CC0 1.0).",
    }
    for dtp, cnt in by_type.items():
        meta[f"count_{dtp}"] = str(cnt)
    con.executemany("INSERT INTO meta (key, value) VALUES (?, ?)", sorted(meta.items()))
    con.commit()
    con.execute("ANALYZE")
    con.commit()
    con.execute("VACUUM")
    con.close()
    tmp.replace(out)

    # Contaminant tables hang off `foods`, so a rebuild has to restore them (data/contaminants/*.tsv).
    sys.path.insert(0, str(Path(__file__).resolve().parent / "contaminants"))
    import build_contaminants  # noqa: E402
    build_contaminants.apply(out)

    log(f"[done] {out.relative_to(PROJECT_ROOT) if PROJECT_ROOT in out.parents else out}: {total} foods "
        f"{by_type}, {n_serv} serving sizes, {out.stat().st_size / 1e6:.1f} MB")
    log(f"  calories_source: {dict(cal_src)}")
    log(f"  value_provenance: {dict(prov_counts)}")
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--download", action="store_true", help="download/verify/extract pinned USDA releases into data/raw first")
    p.add_argument("--download-only", action="store_true", help="download and extract, do not build")
    p.add_argument("--allow-hash-mismatch", action="store_true", help="accept re-issued zips whose sha256 differs from the pin")
    p.add_argument("--out", default=str(DEFAULT_OUT), help="output database path (default: food-nutrition-app/nutrition.db)")
    p.add_argument("--no-fndds", action="store_true", help="exclude FNDDS survey foods entirely")
    p.add_argument("--fndds-all", action="store_true", help="include all non-baby FNDDS categories, not only mixed dishes")
    p.add_argument("--include-baby-foods", action="store_true", help="keep SR 'Baby Foods' and FNDDS baby/infant categories")
    args = p.parse_args(argv)
    if args.download or args.download_only:
        fetch_sources(args.allow_hash_mismatch)
        if args.download_only:
            return 0
    try:
        build(args)
    except UnitError as e:
        log(f"UNIT ERROR: {e}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
