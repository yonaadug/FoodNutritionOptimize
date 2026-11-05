#!/usr/bin/env python3
"""
Write the contaminant tables into nutrition.db.

    python3 -I scripts/contaminants/build_contaminants.py            # default DB
    python3 -I scripts/contaminants/build_contaminants.py --db PATH
    python3 -I scripts/contaminants/build_contaminants.py --report   # mapping summary, no writes

Reads only committed files in data/contaminants/ plus the `foods` table, so it needs no network
and no raw downloads. scripts/build_db.py calls apply() after a full rebuild. The step is
idempotent: it drops and recreates its own tables and meta keys and touches nothing else.

Data model (one measurement, many foods):
    contaminant_sources            who published the data
    contaminants                   lead, cadmium, mercury, arsenic, each pesticide, microplastics
    contaminant_reference_values   health-based guidance values and their basis
    contaminant_profiles           what the source measured: a TDS food, PDP commodity, fish species
    contaminant_measurements       one row per profile x contaminant
    food_contaminant_profiles      USDA food -> profile, with match method and confidence
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mapping_rules as rules  # noqa: E402

BUILDER_VERSION = "1.0.0"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA = PROJECT_ROOT / "data" / "contaminants"
DEFAULT_DB = PROJECT_ROOT / "food-nutrition-app" / "nutrition.db"
# Children first, so dropping them never trips a foreign key.
TABLES = ["food_contaminant_profiles", "contaminant_measurements", "contaminant_profiles",
          "contaminants", "contaminant_reference_values", "contaminant_sources"]

# Dry-matter correction only applies outside this band: smaller differences are within the noise
# of the measurements. The clamp stops an odd USDA composition from producing an absurd factor.
MOISTURE_DEADBAND = (0.8, 1.25)
MOISTURE_CLAMP = (0.1, 12.0)
# Added sugar is solids that carry no contaminant, so scaling these foods would overstate them.
NO_MOISTURE_SCALING = re.compile(r"\b(sweetened|syrup|sugar|sugared)\b")
# Concentrated forms need a correction. Without a reference to scale from, it is more honest to
# report no data than an understated number.
CONCENTRATED = re.compile(r"\b(dry|dried|dehydrated|powder|powdered|condensed|concentrate|undiluted|mix)\b")
PREPARED = re.compile(r"\b(diluted|prepared|reconstituted|cooked|water added|from concentrate|boiled|heated|baked)\b")
# Sold and measured in this form, so the word "powder" or "dry" says nothing about concentration.
SHELF_DRY_FOODS = re.compile(r"^(nuts|seeds|peanuts|cereals ready-to-eat|snacks|crackers|cookies|cocoa|beverages, .*protein powder|leavening agents|salami|sausage|cheese)\b")

SCHEMA = """
CREATE TABLE contaminant_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    publisher TEXT NOT NULL,
    year TEXT NOT NULL,
    citation TEXT NOT NULL,
    url TEXT NOT NULL,
    retrieved TEXT NOT NULL,
    license TEXT NOT NULL,
    sha256 TEXT,
    notes TEXT
);
CREATE TABLE contaminant_reference_values (
    id TEXT PRIMARY KEY,
    contaminant TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    period TEXT NOT NULL CHECK (period IN ('day', 'week')),
    per_kg_bw INTEGER NOT NULL CHECK (per_kg_bw IN (0, 1)),
    body_weight_kg REAL NOT NULL,
    population TEXT NOT NULL,
    basis TEXT NOT NULL,
    why_chosen TEXT,
    authority TEXT NOT NULL,
    year TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES contaminant_sources(id),
    is_default INTEGER NOT NULL DEFAULT 0,
    notes TEXT
);
CREATE TABLE contaminants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grp TEXT NOT NULL CHECK (grp IN ('heavy_metal', 'pesticide', 'microplastic')),
    reference_id TEXT REFERENCES contaminant_reference_values(id),
    parent_name TEXT,
    role TEXT
);
CREATE TABLE contaminant_profiles (
    id TEXT PRIMARY KEY,
    family TEXT NOT NULL CHECK (family IN ('tds', 'pdp', 'fish', 'rice', 'mp')),
    source_id TEXT NOT NULL REFERENCES contaminant_sources(id),
    source_code TEXT NOT NULL,
    name TEXT NOT NULL,
    moisture_ref_fdc_id INTEGER,
    samples_total INTEGER,
    samples_detected INTEGER,
    samples_over_tolerance INTEGER,
    samples_no_tolerance INTEGER,
    analytes_tested INTEGER,
    year_start INTEGER,
    year_end INTEGER,
    notes TEXT
);
CREATE TABLE contaminant_measurements (
    profile_id TEXT NOT NULL REFERENCES contaminant_profiles(id),
    contaminant_id TEXT NOT NULL REFERENCES contaminants(id),
    statistic TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    upper_bound REAL,
    median REAL,
    low REAL,
    high REAL,
    detection_frequency REAL,
    n_samples INTEGER,
    n_detected INTEGER,
    reporting_limit REAL,
    year_start INTEGER,
    year_end INTEGER,
    source_id TEXT NOT NULL REFERENCES contaminant_sources(id),
    notes TEXT,
    PRIMARY KEY (profile_id, contaminant_id)
) WITHOUT ROWID;
CREATE TABLE food_contaminant_profiles (
    fdc_id INTEGER NOT NULL REFERENCES foods(fdc_id),
    profile_id TEXT NOT NULL REFERENCES contaminant_profiles(id),
    family TEXT NOT NULL,
    match_method TEXT NOT NULL CHECK (match_method IN ('exact', 'description_rule', 'category', 'manual')),
    confidence REAL NOT NULL CHECK (confidence > 0 AND confidence <= 1),
    rule TEXT NOT NULL,
    moisture_factor REAL,
    caveat TEXT,
    PRIMARY KEY (fdc_id, profile_id)
) WITHOUT ROWID;
CREATE INDEX idx_fcp_profile ON food_contaminant_profiles(profile_id);
"""

SHOW_SKIPPED = False

METALS = [
    ("lead", "Lead"),
    ("cadmium", "Cadmium"),
    ("mercury", "Mercury"),
    ("arsenic_inorganic", "Inorganic arsenic"),
    ("arsenic_total", "Total arsenic"),
]


def read_tsv(name: str) -> list[dict[str, str]]:
    with open(DATA / name, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def num(value: str | None) -> float | None:
    """Numbers from source tables. Their 'ND' and 'N/A' cells become NULL, never zero."""
    if value is None or value.strip() in ("", "N/A", "ND"):
        return None
    return float(value)


def lean_solids(water: float | None, fat: float | None) -> float | None:
    """Fat-free dry matter, g/100 g. Metals bind to protein and minerals rather than fat or water."""
    if water is None:
        return None
    return max(100.0 - water - (fat or 0.0), 0.0)


def moisture_factor(description: str, food: tuple, reference: tuple | None) -> float | None:
    """How much more concentrated this food is than the form the source measured. None = no scaling."""
    if reference is None or NO_MOISTURE_SCALING.search(description):
        return None
    food_solids = lean_solids(food[0], food[1])
    ref_solids = lean_solids(reference[0], reference[1])
    if not food_solids or not ref_solids:
        return None
    factor = food_solids / ref_solids
    if MOISTURE_DEADBAND[0] <= factor <= MOISTURE_DEADBAND[1]:
        return None
    return round(min(max(factor, MOISTURE_CLAMP[0]), MOISTURE_CLAMP[1]), 3)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def fish_display_name(species: str) -> str:
    return species[0] + species[1:].lower() if species.isupper() else species.capitalize()


# --------------------------------------------------------------------------- #
# Profiles and measurements
# --------------------------------------------------------------------------- #
def load_references(con: sqlite3.Connection, source_ids: set[str]) -> dict[str, str]:
    default_refs: dict[str, str] = {}
    for r in read_tsv("reference_values.tsv"):
        if r["source_id"] not in source_ids:
            raise SystemExit(f"reference {r['id']}: unknown source {r['source_id']}")
        is_default = int(r["is_default"])
        con.execute(
            "INSERT INTO contaminant_reference_values (id, contaminant, value, unit, period, per_kg_bw, body_weight_kg, population, basis,"
            " why_chosen, authority, year, source_id, is_default, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (r["id"], r["contaminant"], float(r["value"]), r["unit"], r["period"], int(r["per_kg_bw"]), float(r["body_weight_kg"]), r["population"],
             r["basis"], r["why_chosen"] or None, r["authority"], r["year"], r["source_id"], is_default, r["notes"] or None))
        if is_default:
            if r["contaminant"] in default_refs:
                raise SystemExit(f"two default references for {r['contaminant']}")
            default_refs[r["contaminant"]] = r["id"]
    return default_refs


def add_contaminants(con: sqlite3.Connection, default_refs: dict[str, str]) -> None:
    for cid, name in METALS:
        # Total arsenic is compared with the inorganic reference, and only as an upper bound.
        ref = default_refs["arsenic_inorganic"] if cid == "arsenic_total" else default_refs[cid]
        con.execute("INSERT INTO contaminants (id, name, grp, reference_id) VALUES (?,?,?,?)", (cid, name, "heavy_metal", ref))
    con.execute("INSERT INTO contaminants (id, name, grp) VALUES ('microplastics', 'Microplastics', 'microplastic')")


def load_tds(con: sqlite3.Connection, moisture_refs: dict) -> int:
    rows = read_tsv("tds_elements.tsv")
    seen: set[str] = set()
    n = 0
    for r in rows:
        pid = f"tds:{r['tds_food_number']}"
        if pid not in seen:
            seen.add(pid)
            samples = [int(x["n"]) for x in rows if x["tds_food_number"] == r["tds_food_number"] and x["analyte"] == "lead"]
            ref = moisture_refs.get(int(r["tds_food_number"]))
            con.execute(
                "INSERT INTO contaminant_profiles (id, family, source_id, source_code, name, moisture_ref_fdc_id, samples_total,"
                " year_start, year_end) VALUES (?,?,?,?,?,?,?,?,?)",
                (pid, "tds", "fda_tds_2018_2020", r["tds_food_number"], r["tds_food"], ref, samples[0] if samples else None,
                 int(r["year_start"]), int(r["year_end"])))
        n_samples, n_det = int(r["n"]), int(r["n_detected"])
        con.execute(
            "INSERT INTO contaminant_measurements (profile_id, contaminant_id, statistic, value, unit, upper_bound, high,"
            " detection_frequency, n_samples, n_detected, reporting_limit, year_start, year_end, source_id, notes)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (pid, r["analyte"], "mean", float(r["mean_ppb_nd0"]), "ug/kg", float(r["mean_ppb_ub"]), float(r["max_ppb"]),
             n_det / n_samples, n_samples, n_det, float(r["rl_max_ppb"]), int(r["year_start"]), int(r["year_end"]),
             "fda_tds_2018_2020", "Non-detects counted as zero in the mean, as FDA does."))
        n += 1
    return n


def load_fish(con: sqlite3.Connection) -> int:
    n = 0
    for r in read_tsv("fish_mercury.tsv"):
        pid = f"fish:{r['species']}"
        n_samples = int(r["n"])
        source_note = r["source_note"]
        older = "NMFS" in source_note
        con.execute(
            "INSERT INTO contaminant_profiles (id, family, source_id, source_code, name, samples_total, year_start, year_end, notes)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (pid, "fish", "fda_fish_mercury", r["species"], fish_display_name(r["species"]), n_samples,
             int(r["year_start"]), int(r["year_end"]), source_note))
        mean_ppm = float(r["mean_ppm"])
        con.execute(
            "INSERT INTO contaminant_measurements (profile_id, contaminant_id, statistic, value, unit, median, low, high,"
            " n_samples, year_start, year_end, source_id, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (pid, "mercury", "mean", mean_ppm * 1000, "ug/kg",
             None if num(r["median_ppm"]) is None else num(r["median_ppm"]) * 1000,
             None if num(r["min_ppm"]) is None else num(r["min_ppm"]) * 1000,
             None if num(r["max_ppm"]) is None else num(r["max_ppm"]) * 1000,
             n_samples, int(r["year_start"]), int(r["year_end"]), "fda_fish_mercury",
             "Data from a 1978 National Marine Fisheries Service report." if older else None))
        n += 1
    return n


def load_rice(con: sqlite3.Connection, moisture_refs: dict) -> int:
    n = 0
    for r in read_tsv("rice_arsenic.tsv"):
        pid = f"rice:{r['key']}"
        n_samples = int(r["n"])
        con.execute(
            "INSERT INTO contaminant_profiles (id, family, source_id, source_code, name, moisture_ref_fdc_id, samples_total,"
            " year_start, year_end) VALUES (?,?,?,?,?,?,?,?,?)",
            (pid, "rice", "fda_rice_2016", r["key"], r["name"], moisture_refs[r["kind"]], n_samples, 2013, 2016))
        con.execute(
            "INSERT INTO contaminant_measurements (profile_id, contaminant_id, statistic, value, unit, low, high, n_samples,"
            " year_start, year_end, source_id, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (pid, "arsenic_inorganic", "mean", float(r["mean_ppb"]), "ug/kg", num(r["min_ppb"]), num(r["max_ppb"]), n_samples,
             2013, 2016, "fda_rice_2016", "Measured on uncooked rice."))
        n += 1
    return n


def load_microplastics(con: sqlite3.Connection, source_ids: set[str]) -> int:
    n = 0
    for r in read_tsv("microplastics.tsv"):
        if r["source_id"] not in source_ids:
            raise SystemExit(f"microplastics {r['key']}: unknown source {r['source_id']}")
        pid = f"mp:{r['key']}"
        year = int(r["year"])
        con.execute(
            "INSERT INTO contaminant_profiles (id, family, source_id, source_code, name, year_start, year_end, notes)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (pid, "mp", r["source_id"], r["key"], r["name"], year, year, r["size_note"]))
        con.execute(
            "INSERT INTO contaminant_measurements (profile_id, contaminant_id, statistic, value, unit, low, high, year_start,"
            " year_end, source_id, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (pid, "microplastics", r["statistic"], float(r["particles_per_g"]), "particles/g", num(r["low_per_g"]),
             num(r["high_per_g"]), year, year, r["source_id"], "; ".join(x for x in (r["samples_note"], r["notes"]) if x)))
        n += 1
    return n


def normalize_pesticide(name: str) -> str:
    s = re.sub(r"\+.*$", "", name.lower())
    s = re.sub(r"\(.*?\)", " ", s).replace("-", " ")
    return re.sub(r"\s+", " ", s).strip()


def load_pdp(con: sqlite3.Connection) -> dict:
    """PDP commodities, each detected pesticide, and the EPA dose each one is compared against."""
    # Chronic PADs first. The acute PAD is a fallback for pesticides where EPA sets no chronic value.
    refs: dict[str, dict] = {}
    for r in read_tsv("epa_pads.tsv"):
        chronic, acute = num(r["chronic_pad_mg_kg_day"]), num(r["acute_pad_mg_kg_day"])
        if chronic is None and acute is None:
            continue
        refs[normalize_pesticide(r["pesticide"])] = {
            "name": r["pesticide"], "value": chronic if chronic is not None else acute,
            "kind": "chronic" if chronic is not None else "acute", "source_id": "epa_hhbp_2021", "notes": None,
        }
    for r in read_tsv("pesticide_extra_refs.tsv"):
        refs[normalize_pesticide(r["pesticide"])] = {
            "name": r["pesticide"], "value": float(r["rfd_mg_kg_day"]), "kind": "chronic",
            "source_id": r["source_id"], "notes": r["notes"] or None,
        }
    aliases = {r["pdp_name"]: (r["reference_name"], r["role"]) for r in read_tsv("pesticide_aliases.tsv")}
    for pdp_name, (ref_name, _role) in aliases.items():
        if normalize_pesticide(ref_name) not in refs:
            raise SystemExit(f"pesticide alias {pdp_name!r} points at unknown reference {ref_name!r}")

    commodities = read_tsv("pdp_commodities.tsv")
    for r in commodities:
        con.execute(
            "INSERT INTO contaminant_profiles (id, family, source_id, source_code, name, samples_total, samples_detected,"
            " samples_over_tolerance, samples_no_tolerance, analytes_tested, year_start, year_end)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (f"pdp:{r['commodity']}", "pdp", "usda_pdp", r["commodity"], r["name"], int(r["n_samples"]),
             int(r["n_samples_detected"]), int(r["n_samples_over_tolerance"]), int(r["n_samples_no_tolerance"]),
             int(r["n_pesticides_tested"]), int(r["year_start"]), int(r["year_end"])))

    used_refs: set[str] = set()
    pesticides: dict[str, tuple] = {}
    rated = unrated = 0
    measurements = 0
    for r in read_tsv("pdp_residues.tsv"):
        cid = f"pesticide:{r['pest_code']}"
        if cid not in pesticides:
            alias = aliases.get(r["pesticide"])
            ref_key = normalize_pesticide(alias[0] if alias else r["pesticide"])
            ref = refs.get(ref_key)
            ref_id = None
            if ref:
                ref_id = f"pad:{slug(ref_key)}"
                if ref_id not in used_refs:
                    used_refs.add(ref_id)
                    kind_label = "Chronic population-adjusted dose" if ref["kind"] == "chronic" else "Acute population-adjusted dose (EPA lists no chronic value)"
                    if ref["source_id"] == "epa_dwsha_2018":
                        kind_label = "Oral reference dose, EPA Drinking Water Health Advisories table"
                    elif ref["source_id"] == "epa_iris_ddt":
                        kind_label = "Oral reference dose, EPA IRIS"
                    con.execute(
                        "INSERT INTO contaminant_reference_values (id, contaminant, value, unit, period, per_kg_bw, body_weight_kg, population,"
                        " basis, authority, year, source_id, is_default, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?)",
                        (ref_id, f"pesticide:{slug(ref_key)}", ref["value"] * 1000, "ug/kg-bw/day", "day", 1, 80,
                         "General population", kind_label, "US EPA",
                         {"epa_hhbp_2021": "2021", "epa_dwsha_2018": "2018", "epa_iris_ddt": "1987"}[ref["source_id"]],
                         ref["source_id"], ref["notes"]))
            parent = ref["name"] if ref else r["pesticide"]
            role = alias[1] if alias else "parent"
            pesticides[cid] = (ref_id, parent, role)
            con.execute("INSERT INTO contaminants (id, name, grp, reference_id, parent_name, role) VALUES (?,?,?,?,?,?)",
                        (cid, r["pesticide"], "pesticide", ref_id, parent, role))
        n_results, n_det = int(r["n_results"]), int(r["n_detected"])
        rated += pesticides[cid][0] is not None
        unrated += pesticides[cid][0] is None
        con.execute(
            "INSERT INTO contaminant_measurements (profile_id, contaminant_id, statistic, value, unit, high, detection_frequency,"
            " n_samples, n_detected, reporting_limit, year_start, year_end, source_id, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (f"pdp:{r['commodity']}", cid, "mean", float(r["mean_ppm_nd0"]) * 1000, "ug/kg", float(r["max_ppm"]) * 1000,
             n_det / n_results, n_results, n_det, (num(r["lod_min_ppm"]) or 0) * 1000 or None,
             int(r["year_start"]), int(r["year_end"]), "usda_pdp", None))
        measurements += 1
    return {"commodities": len(commodities), "pesticides": len(pesticides), "measurements": measurements,
            "residue_rows_with_reference": rated, "residue_rows_without_reference": unrated, "reference_doses": len(used_refs)}


# --------------------------------------------------------------------------- #
# USDA food -> profile
# --------------------------------------------------------------------------- #
def match_foods(foods: list[tuple], known_profiles: set[str], tds_refs: dict, rice_refs: dict) -> tuple[list[tuple], Counter]:
    """(fdc_id, profile, family, method, confidence, rule text, moisture factor, caveat) for each food x family."""
    comp = rules.compiled()
    never = {family: re.compile(p) for family, p in rules.NEVER_MATCH.items()}
    out: list[tuple] = []
    skipped: Counter = Counter()
    for fdc_id, description, category, water, fat, data_type in foods:
        desc = description.lower()
        cat = (category or "").lower()
        fndds = data_type == "survey_fndds_food"
        for family, family_rules in comp.items():
            if never[family].search(desc):
                continue
            for rule, inc, exc, cat_re in family_rules:
                if fndds and not rule.mixed_ok:
                    continue
                if not inc.search(desc) or (exc and exc.search(desc)) or (cat_re and not cat_re.search(cat)):
                    continue
                if rule.profile not in known_profiles:
                    raise SystemExit(f"rule points at unknown profile {rule.profile}: {rule.pattern}")
                reference = None
                if rule.moisture:
                    if family == "tds":
                        reference = tds_refs.get(int(rule.profile.split(":")[1]))
                    elif family == "rice":
                        reference = rice_refs["brown" if rule.profile.startswith("rice:brown") else "white"]
                if family == "tds" and reference is None and CONCENTRATED.search(desc) \
                        and not PREPARED.search(desc) and not SHELF_DRY_FOODS.search(desc):
                    skipped["concentrated form without a moisture reference"] += 1
                    if SHOW_SKIPPED:
                        print("skip:", description)
                    break
                factor = moisture_factor(desc, (water, fat), reference)
                out.append((fdc_id, rule.profile, family, rule.method, rule.confidence, rule.pattern, factor, rule.caveat))
                break
    return out, skipped


def create(con: sqlite3.Connection) -> dict:
    for t in TABLES:
        con.execute(f"DROP TABLE IF EXISTS {t}")
    con.execute("DELETE FROM meta WHERE key LIKE 'contaminants_%'")
    con.executescript(SCHEMA)

    sources = read_tsv("sources.tsv")
    for r in sources:
        con.execute("INSERT INTO contaminant_sources (id, name, publisher, year, citation, url, retrieved, license, sha256, notes)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (r["id"], r["name"], r["publisher"], r["year"], r["citation"], r["url"], r["retrieved"], r["license"],
                     r["sha256"] or None, r["notes"] or None))
    source_ids = {r["id"] for r in sources}

    default_refs = load_references(con, source_ids)
    add_contaminants(con, default_refs)

    foods = con.execute("SELECT fdc_id, description, food_category, water_g, total_fat_g, data_type FROM foods").fetchall()
    by_desc: dict[str, tuple] = {}
    for fdc_id, description, _cat, water, fat, _t in foods:
        by_desc.setdefault(description, (fdc_id, water, fat))

    def lookup(description: str) -> tuple:
        if description not in by_desc:
            raise SystemExit(f"moisture reference not found in foods: {description!r}")
        return by_desc[description]

    tds_ref_rows = {num_: lookup(desc) for num_, desc in rules.TDS_MOISTURE_REFERENCE.items()}
    rice_ref_rows = {kind: lookup(desc) for kind, desc in rules.RICE_MOISTURE_REFERENCE.items()}

    counts = {"measurements": {}}
    counts["measurements"]["tds"] = load_tds(con, {k: v[0] for k, v in tds_ref_rows.items()})
    counts["measurements"]["fish"] = load_fish(con)
    counts["measurements"]["rice"] = load_rice(con, {k: v[0] for k, v in rice_ref_rows.items()})
    counts["measurements"]["mp"] = load_microplastics(con, source_ids)
    counts["pdp"] = load_pdp(con)
    counts["measurements"]["pdp"] = counts["pdp"]["measurements"]

    known = {r[0] for r in con.execute("SELECT id FROM contaminant_profiles")}
    matches, skipped = match_foods(foods, known,
                                   {k: (v[1], v[2]) for k, v in tds_ref_rows.items()},
                                   {k: (v[1], v[2]) for k, v in rice_ref_rows.items()})
    con.executemany("INSERT INTO food_contaminant_profiles (fdc_id, profile_id, family, match_method, confidence, rule,"
                    " moisture_factor, caveat) VALUES (?,?,?,?,?,?,?,?)", matches)

    counts["profiles"] = dict(con.execute("SELECT family, COUNT(*) FROM contaminant_profiles GROUP BY 1").fetchall())
    counts["mapped_links"] = dict(con.execute("SELECT family, COUNT(*) FROM food_contaminant_profiles GROUP BY 1").fetchall())
    counts["mapped_foods"] = con.execute("SELECT COUNT(DISTINCT fdc_id) FROM food_contaminant_profiles").fetchone()[0]
    counts["foods_total"] = len(foods)
    counts["moisture_scaled_links"] = con.execute("SELECT COUNT(*) FROM food_contaminant_profiles WHERE moisture_factor IS NOT NULL").fetchone()[0]
    counts["match_methods"] = dict(con.execute("SELECT match_method, COUNT(*) FROM food_contaminant_profiles GROUP BY 1").fetchall())
    counts["skipped"] = dict(skipped)
    counts["unused_profiles"] = con.execute(
        "SELECT COUNT(*) FROM contaminant_profiles p WHERE NOT EXISTS (SELECT 1 FROM food_contaminant_profiles f WHERE f.profile_id = p.id)"
    ).fetchone()[0]

    meta = {
        "contaminants_builder": "scripts/contaminants/build_contaminants.py",
        "contaminants_builder_version": BUILDER_VERSION,
        "contaminants_build_date_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "contaminants_counts": json.dumps(counts, sort_keys=True),
        "contaminants_sources": json.dumps([{"id": r["id"], "name": r["name"], "year": r["year"], "url": r["url"],
                                             "license": r["license"], "sha256": r["sha256"] or None} for r in sources]),
    }
    con.executemany("INSERT INTO meta (key, value) VALUES (?, ?)", sorted(meta.items()))
    return counts


def apply(db_path: Path) -> dict:
    """Rebuild the contaminant tables in place, all or nothing."""
    con = sqlite3.connect(db_path)
    try:
        con.execute("PRAGMA foreign_keys = ON")
        con.execute("BEGIN")
        counts = create(con)
        con.commit()
        con.execute("ANALYZE")
        con.commit()
        con.execute("VACUUM")
    except BaseException:
        con.rollback()
        raise
    finally:
        con.close()
    return counts


def report(db_path: Path) -> None:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    biggest = defaultdict(int)
    for family, pid, n in con.execute("SELECT family, profile_id, COUNT(*) FROM food_contaminant_profiles GROUP BY 1, 2"):
        biggest[(family, pid)] = n
    for (family, pid), n in sorted(biggest.items(), key=lambda kv: -kv[1])[:25]:
        print(f"{n:5d}  {pid}")
    con.close()


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=str(DEFAULT_DB))
    p.add_argument("--report", action="store_true", help="print the largest profiles and exit")
    p.add_argument("--show-skipped", action="store_true", help="print foods left unmapped by the concentrated-form guard")
    args = p.parse_args(argv)
    global SHOW_SKIPPED
    SHOW_SKIPPED = args.show_skipped
    db = Path(args.db)
    if args.report:
        report(db)
        return 0
    counts = apply(db)
    print(json.dumps(counts, indent=2, sort_keys=True))
    print(f"[done] {db}: {db.stat().st_size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
