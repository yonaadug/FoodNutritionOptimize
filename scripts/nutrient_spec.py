"""
Single source of truth for how USDA FoodData Central (FDC) nutrients map onto
columns of the `foods` table in food-nutrition-app/nutrition.db.

All values are per 100 g of edible portion. A column is NULL when the source
dataset did not report the nutrient (or any accepted substitute); 0 means the
nutrient was reported as zero.

`sources` lists FDC *nutrient ids* (nutrient.csv `id`, JSON `nutrient.id`) in
priority order. The first one present for a food wins. Values taken from any
id other than the first are recorded in the `value_provenance` table.
Derivations (computed values) are described in DERIVATIONS and also recorded
in `value_provenance`.

Used by scripts/build_db.py (builder) and scripts/verify_data_integrity.py
(validator). Keep this file free of I/O.
"""

SPEC_VERSION = "2.0.0"

# column, unit, sources (FDC nutrient ids, priority order), label
# Units are FDC unit_name values (upper-cased); the builder refuses to load a
# value whose source unit differs.
COLUMNS = [
    # --- energy & macronutrients -------------------------------------------
    # calories is special-cased (see CALORIE_SOURCES) and is never NULL.
    ("calories", "KCAL", [1008, 2048, 2047], "Energy"),
    ("protein_g", "G", [1003], "Protein"),
    ("total_fat_g", "G", [1004, 1085], "Total lipid (fat); fallback Total fat (NLEA)"),
    ("carbohydrate_g", "G", [1005, 1050], "Carbohydrate, by difference; fallback by summation"),
    ("fiber_g", "G", [1079, 2033], "Fiber, total dietary; fallback AOAC 2011.25"),
    ("sugars_g", "G", [2000, 1063], "Total sugars (2000 'Total Sugars' / 1063 'Sugars, Total')"),
    # --- fats -----------------------------------------------------------------
    ("saturated_g", "G", [1258], "Fatty acids, total saturated"),
    ("monounsaturated_g", "G", [1292], "Fatty acids, total monounsaturated"),
    ("polyunsaturated_g", "G", [1293], "Fatty acids, total polyunsaturated"),
    ("trans_g", "G", [1257], "Fatty acids, total trans"),
    ("cholesterol_mg", "MG", [1253], "Cholesterol"),
    # --- vitamins -------------------------------------------------------------
    ("vitamin_a_ug", "UG", [1106], "Vitamin A, RAE (µg retinol activity equivalents)"),
    ("vitamin_c_mg", "MG", [1162], "Vitamin C, total ascorbic acid"),
    ("vitamin_d_ug", "UG", [1114], "Vitamin D (D2 + D3), µg"),
    ("vitamin_e_mg", "MG", [1109], "Vitamin E (alpha-tocopherol)"),
    ("vitamin_k_ug", "UG", [1185], "Vitamin K (phylloquinone)"),
    ("thiamin_mg", "MG", [1165], "Thiamin"),
    ("riboflavin_mg", "MG", [1166], "Riboflavin"),
    ("niacin_mg", "MG", [1167], "Niacin"),
    ("vitamin_b6_mg", "MG", [1175], "Vitamin B-6"),
    ("folate_ug", "UG", [1190], "Folate, DFE (µg dietary folate equivalents)"),
    ("vitamin_b12_ug", "UG", [1178], "Vitamin B-12"),
    ("pantothenic_acid_mg", "MG", [1170], "Pantothenic acid"),
    # --- minerals -------------------------------------------------------------
    ("calcium_mg", "MG", [1087], "Calcium, Ca"),
    ("iron_mg", "MG", [1089], "Iron, Fe"),
    ("magnesium_mg", "MG", [1090], "Magnesium, Mg"),
    ("phosphorus_mg", "MG", [1091], "Phosphorus, P"),
    ("potassium_mg", "MG", [1092], "Potassium, K"),
    ("sodium_mg", "MG", [1093], "Sodium, Na"),
    ("zinc_mg", "MG", [1095], "Zinc, Zn"),
    ("copper_mg", "MG", [1098], "Copper, Cu"),
    ("manganese_mg", "MG", [1101], "Manganese, Mn"),
    ("selenium_ug", "UG", [1103], "Selenium, Se"),
    # --- additive columns (schema v2) -----------------------------------------
    ("water_g", "G", [1051], "Water"),
    ("alcohol_g", "G", [1018], "Alcohol, ethyl"),
    ("caffeine_mg", "MG", [1057], "Caffeine"),
    ("choline_mg", "MG", [1180], "Choline, total"),
    ("ala_g", "G", [1404, 1270], "ALA 18:3 n-3 c,c,c; fallback PUFA 18:3 (undifferentiated)"),
    ("epa_g", "G", [1278], "EPA 20:5 n-3"),
    ("dha_g", "G", [1272], "DHA 22:6 n-3"),
]

# Columns that existed in schema v1 (must never be removed or renamed).
LEGACY_COLUMNS = [c[0] for c in COLUMNS[:33]]
NUTRIENT_COLUMNS = [c[0] for c in COLUMNS]
COLUMN_UNITS = {c[0]: c[1] for c in COLUMNS}
COLUMN_SOURCES = {c[0]: c[2] for c in COLUMNS}

# Extra nutrient ids the builder must load because derivations use them.
AUX_NUTRIENTS = {
    1062: "KJ",   # Energy, kJ
    1105: "UG",   # Retinol
    1107: "UG",   # Carotene, beta
    1108: "UG",   # Carotene, alpha
    1120: "UG",   # Cryptoxanthin, beta
    1110: "IU",   # Vitamin D (D2 + D3), IU
    1111: "UG",   # Vitamin D2
    1112: "UG",   # Vitamin D3
    1177: "UG",   # Folate, total
    1186: "UG",   # Folic acid
    1187: "UG",   # Folate, food
}

EXPECTED_UNITS = {}
for _col, _unit, _ids, _ in COLUMNS:
    for _i in _ids:
        EXPECTED_UNITS[_i] = _unit
EXPECTED_UNITS.update(AUX_NUTRIENTS)

# Calorie fallback order. `calories_source` records which one was used.
#   1. 1008 Energy (kcal)                     - SR Legacy, FNDDS, some Foundation
#   2. 2048 Energy, Atwater Specific Factors  - Foundation
#   3. 2047 Energy, Atwater General Factors   - Foundation
#   4. 1062 Energy (kJ) / 4.184
#   5. 4*protein + 4*carbohydrate + 9*fat (+ 7*alcohol), ONLY when protein, fat
#      and carbohydrate are all reported (a missing macro would silently
#      under-count energy, e.g. raisins with only water measured -> 0 kcal)
#   6. Foundation food only: Energy (1008) of the SR Legacy food with the same
#      NDB number (same commodity, older analysis)
# Foods for which none of these apply are EXCLUDED from the database and
# listed in meta.excluded_foods_no_energy (calories must never be NULL or bogus).
CALORIE_SOURCES = [
    ("fdc_1008_energy", 1008),
    ("fdc_2048_atwater_specific", 2048),
    ("fdc_2047_atwater_general", 2047),
    ("fdc_1062_energy_kj", 1062),          # kJ / 4.184
    ("computed_atwater_4_4_9", None),      # needs protein, fat and carbohydrate
]
CALORIE_SR_FALLBACK = "sr_legacy_ndb_match_1008"
CALORIE_SOURCE_NAMES = [s for s, _ in CALORIE_SOURCES] + [CALORIE_SR_FALLBACK]

# Derivations applied only when the primary/fallback ids above are all absent.
DERIVATIONS = {
    "vitamin_a_ug": "rae_from_components: retinol(1105) + beta-carotene(1107)/12 + "
                    "(alpha-carotene(1108) + beta-cryptoxanthin(1120))/24; needs 1105 or 1107; "
                    "absent components count as 0",
    "vitamin_d_ug": "d2_plus_d3: D2(1111) + D3(1112) when either is present; else iu_div_40: IU(1110)/40",
    "folate_ug": "dfe_from_food_folate_and_folic_acid: food folate(1187) + 1.7*folic acid(1186); "
                 "else total_folate_unfortified: total folate(1177) when folic acid(1186) is absent or 0 "
                 "(for unfortified foods DFE == total folate; may understate DFE for enriched foods "
                 "that do not report folic acid)",
}

# Atwater general factors (kcal/g)
ATWATER = {"protein_g": 4.0, "carbohydrate_g": 4.0, "total_fat_g": 9.0, "alcohol_g": 7.0}

DATA_TYPE_RANK = {"foundation_food": 1, "sr_legacy_food": 2, "survey_fndds_food": 3}


def atwater_kcal(protein, carb, fat, alcohol=None):
    """kcal from macros with general Atwater factors (missing values count as 0)."""
    return 4.0 * (protein or 0) + 4.0 * (carb or 0) + 9.0 * (fat or 0) + 7.0 * (alcohol or 0)


def derive_vitamin_a(n):
    if 1105 not in n and 1107 not in n:
        return None
    return (n.get(1105, 0.0) + n.get(1107, 0.0) / 12.0
            + (n.get(1108, 0.0) + n.get(1120, 0.0)) / 24.0)


def derive_vitamin_d(n):
    if 1111 in n or 1112 in n:
        return n.get(1111, 0.0) + n.get(1112, 0.0), "d2_plus_d3"
    if 1110 in n:
        return n[1110] / 40.0, "iu_div_40"
    return None, None


def derive_folate(n):
    if 1187 in n and 1186 in n:
        return n[1187] + 1.7 * n[1186], "dfe_from_food_folate_and_folic_acid"
    if 1177 in n and n.get(1186, 0.0) == 0.0:
        return n[1177], "total_folate_unfortified"
    return None, None


def resolve_nutrients(n, sr_energy=None):
    """Map {fdc_nutrient_id: amount} to ({column: value}, {column: provenance}, calories_source).

    `sr_energy` is the 1008 value of the SR Legacy food sharing this Foundation
    food's NDB number (or None). Returns calories None / source None when no
    energy rule applies (caller excludes the food).

    Provenance is only recorded for values that did not come from the first
    listed source id. Pure function: used identically by builder and validator.
    """
    out, prov = {}, {}
    for col, _unit, ids, _label in COLUMNS:
        if col == "calories":
            continue
        val = None
        for i, nid in enumerate(ids):
            if nid in n:
                val = n[nid]
                if i > 0:
                    prov[col] = f"fdc_{nid}"
                break
        if val is None:
            if col == "vitamin_a_ug":
                val = derive_vitamin_a(n)
                if val is not None:
                    prov[col] = "rae_from_components"
            elif col == "vitamin_d_ug":
                val, how = derive_vitamin_d(n)
                if val is not None:
                    prov[col] = how
            elif col == "folate_ug":
                val, how = derive_folate(n)
                if val is not None:
                    prov[col] = how
        if val is not None and val < 0:
            # Only "by difference" values (carbohydrate) can be negative in FDC
            # (Foundation meats/fish: protein+fat+water+ash > 100 by a fraction
            # of a gram). Store 0; keep the original in provenance.
            prov[col] = f"clamped_negative:{val:g}"
            val = 0.0
        out[col] = None if val is None else round(float(val), 6)

    cal, src = None, None
    for name, nid in CALORIE_SOURCES:
        if nid is None:
            if None not in (out["protein_g"], out["carbohydrate_g"], out["total_fat_g"]):
                cal = atwater_kcal(out["protein_g"], out["carbohydrate_g"], out["total_fat_g"], out["alcohol_g"])
                src = name
            break
        if nid in n:
            cal = n[nid] / 4.184 if nid == 1062 else n[nid]
            src = name
            break
    if cal is None and sr_energy is not None:
        cal, src = sr_energy, CALORIE_SR_FALLBACK
    out["calories"] = None if cal is None else round(float(cal), 3)
    return out, prov, src
