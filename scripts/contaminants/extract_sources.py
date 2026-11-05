#!/usr/bin/env python3
"""
Turn pinned contaminant downloads into small, committed TSV extracts.

    python3 -I scripts/contaminants/extract_sources.py --download   # fetch, verify, extract
    python3 -I scripts/contaminants/extract_sources.py              # extract from data/raw/contaminants
    python3 -I scripts/contaminants/extract_sources.py --verify     # fetch nothing; check the pins only

Downloads are untrusted data: they stay in data/raw/contaminants (gitignored), are only
parsed (CSV / zip / xlsx XML / PDF text streams) and are never executed. Zip members are
read as streams, so the 130 MB PDP text files are never written to disk.

Outputs (data/contaminants/, committed and read by build_contaminants.py):
    tds_elements.tsv     FDA TDS FY2018-2020: per food x element summary statistics
    pdp_commodities.tsv  USDA PDP: per commodity sample counts and detection rates
    pdp_residues.tsv     USDA PDP: per commodity x pesticide statistics (detected only)
    epa_pads.tsv         EPA HHBP 2021: chronic / acute population-adjusted doses
    fish_mercury.tsv     FDA mercury in commercial fish and shellfish, 1990-2012

Curated by hand and only checked here: rice_arsenic.tsv (FDA 2016 Table 4.2),
microplastics.tsv, reference_values.tsv, sources.tsv.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
import zlib
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
RAW = PROJECT_ROOT / "data" / "raw" / "contaminants"
OUT = PROJECT_ROOT / "data" / "contaminants"

UA = "Mozilla/5.0 (MicronutrientDiary contaminant pipeline)"
PDP_BASE = "https://www.ams.usda.gov/sites/default/files/media/"

# (relative path, url, sha256). sha256 None = the publisher serves a page that changes.
PINNED = [
    ("tds/tds_fy18_20_elements.txt", "https://www.fda.gov/media/159750/download?attachment", None),
    ("tds/tds_fy18_20_elements_key.pdf", "https://www.fda.gov/media/159746/download?attachment", None),
    ("tds/tds_fy18_20_elements_report.pdf", "https://www.fda.gov/media/159745/download?attachment", None),
    ("fda_mercury/mercury.html",
     "https://www.fda.gov/food/environmental-contaminants-food/mercury-levels-commercial-fish-and-shellfish-1990-2012", None),
    ("fda_rice/risk_assessment_2016.pdf",
     "https://www.fda.gov/files/food/published/Arsenic-in-Rice-and-Rice-Products-Risk-Assessment-Report-PDF.pdf",
     "6f051a13ba6955ce661a417437616badfad1c64fe4298745190de1573cb60bf5"),
    ("epa/hh-benchmarks-table-2021.pdf", "https://www.epa.gov/system/files/documents/2021-07/hh-benchmarks-table-2021.pdf",
     "d3baf67878791314d0d619400bd3e666f7b62d27e949916b3fa4d709aed5b31f"),
    ("epa/dwtable2018.pdf", "https://www.epa.gov/system/files/documents/2022-01/dwtable2018.pdf",
     "e5a6fe30f3d01956f28cac4b8b5ab609e3c1ddd7d90419c2f0a7850ecf613973"),
    ("pdp/2024PDPDatabase.zip", PDP_BASE + "2024PDPDatabase.zip", "de916ba119f8d6dd5a4d5596c69b00c476fceeb31a96b1389dd005031c9c4d79"),
    ("pdp/2023PDPDatabase.zip", PDP_BASE + "2023PDPDatabase.zip", "10bad42c5673517c0268fe80a789bcddbb58c5c08b80e9fb1ea1fba56be8a0a0"),
    ("pdp/2022PDPDatabase.zip", PDP_BASE + "2022PDPDatabase.zip", "9e599c741c6122d1ea7f6ec7ed0509ed5c2dbe34084cd5531b05303cafa433af"),
    ("pdp/2021PDPDatabase.zip", PDP_BASE + "2021PDPDatabase.zip", "5d66c6b7d6fa6184146e313fd5b73652661e66d6c814289648398a68ea473980"),
    ("pdp/2020PDPDatabase.zip", PDP_BASE + "2020PDPDatabase.zip", "368df506a1ecb23ac6e77dc2beb76c14655ab828c9f6ad794fd6b0cc41168085"),
    ("pdp/2019PDPDatabase.zip", PDP_BASE + "2019PDPDatabase.zip", "42c8721b755243a191199d9a9b357c722db945cb50a3ae058d2527499385358c"),
    ("pdp/2018PDPDatabase.zip", PDP_BASE + "2018PDPDatabase.zip", "b28857d6c5ebacbcdb568162e3e6c60f566d890b39aaea96ba6a0b1aeaae9e66"),
    ("pdp/2017PDPDatabase.zip", PDP_BASE + "2017PDPDatabase.ZIP", "5f3f2ca8b11e95f9553c5975ef1ee012af9be6c64d14a49a75c468689aca81c8"),
    ("pdp/2016PDPDatabase.zip", PDP_BASE + "2016PDPDatabase.ZIP", "9bbdfb5cbe52dd3d200dd5fe7a726e896da604c09e14edeecbbba9484c06a01d"),
]

PDP_YEARS = range(2016, 2025)
# Each commodity is summarised over the 3-year window ending at the last year PDP tested it.
PDP_POOL_YEARS = 3
# Baby foods are not in nutrition.db (see meta.sr_excluded_categories), so their profiles would be orphans.
PDP_EXCLUDE_PREFIX = "Baby Food"
TDS_ANALYTES = {
    "Lead": "lead",
    "Cadmium": "cadmium",
    "Mercury": "mercury",
    "Arsenic (total)": "arsenic_total",
    "Total inorganic arsenic": "arsenic_inorganic",
}


def log(msg: str) -> None:
    print(msg, flush=True)


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(allow_mismatch: bool) -> None:
    for rel, url, digest in PINNED:
        path = RAW / rel
        if path.exists() and (digest is None or sha256_of(path) == digest):
            log(f"[cached] {rel}")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        log(f"[download] {url}")
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        tmp = path.with_suffix(path.suffix + ".part")
        with urllib.request.urlopen(req, timeout=600) as resp, open(tmp, "wb") as out:
            while chunk := resp.read(1 << 20):
                out.write(chunk)
        tmp.replace(path)
        if digest and sha256_of(path) != digest:
            msg = f"sha256 mismatch for {rel}: got {sha256_of(path)}, pinned {digest}"
            if not allow_mismatch:
                raise SystemExit(msg + " (re-run with --allow-hash-mismatch after review)")
            log("WARNING: " + msg)


def verify_pins() -> int:
    bad = 0
    for rel, _url, digest in PINNED:
        path = RAW / rel
        state = "missing" if not path.exists() else "unpinned" if digest is None else "ok" if sha256_of(path) == digest else "MISMATCH"
        bad += state == "MISMATCH"
        log(f"{state:9s} {rel}")
    return bad


def write_tsv(name: str, header: list[str], rows: list[list]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    log(f"[write] data/contaminants/{name}: {len(rows)} rows, {(OUT / name).stat().st_size / 1024:.0f} KB")


def fmt(x: float | None, digits: int = 6) -> str:
    return "" if x is None else f"{x:.{digits}g}"


# --------------------------------------------------------------------------- #
# Minimal, parse-only readers (stdlib)
# --------------------------------------------------------------------------- #
def pdf_text(path_or_bytes) -> str:
    """Text of a PDF's content streams. Good enough for simple government tables."""
    raw = path_or_bytes if isinstance(path_or_bytes, bytes) else Path(path_or_bytes).read_bytes()
    streams = []
    for mt in re.finditer(rb"stream\r?\n", raw):
        end = raw.find(b"endstream", mt.end())
        if end < 0:
            continue
        try:
            streams.append(zlib.decompressobj().decompress(raw[mt.end():end]))
        except zlib.error:
            pass
    cmap: dict[int, str] = {}
    for s in streams:
        for blk in re.findall(rb"beginbfchar(.*?)endbfchar", s, re.S):
            for a, b in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
                cmap[int(a, 16)] = bytes.fromhex(b.decode()).decode("utf-16-be", "ignore")
        for blk in re.findall(rb"beginbfrange(.*?)endbfrange", s, re.S):
            for a, b, c in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
                for k in range(int(a, 16), int(b, 16) + 1):
                    cmap[k] = chr(int(c, 16) + k - int(a, 16))
    out = []
    for s in streams:
        for bt in re.findall(rb"BT(.*?)ET", s, re.S):
            line = []
            for tok in re.finditer(rb"\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f]+)>|(T\*|Td|TD|')", bt):
                t = tok.group(0)
                if t.startswith(b"("):
                    line.append(re.sub(rb"\\(.)", rb"\1", t[1:-1]).decode("latin-1"))
                elif tok.group(1):
                    h = tok.group(1).decode()
                    step = 4 if len(h) % 4 == 0 else 2
                    line.append("".join(cmap.get(int(h[i:i + step], 16), "") for i in range(0, len(h), step)))
                else:
                    line.append(" ")
            if "".join(line).strip():
                out.append("".join(line))
    return "\n".join(out)


def xlsx_rows(data: bytes) -> dict[str, list[list[str]]]:
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    rel = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = ["".join(t.text or "" for t in si.iter(ns + "t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(ns + "si")]
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    sheets = {}
    for s in ET.fromstring(z.read("xl/workbook.xml")).find(ns + "sheets"):
        target = rels[s.get(rel)].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(target)).iter(ns + "row"):
            cells = {}
            for c in row.findall(ns + "c"):
                letters = re.match(r"[A-Z]+", c.get("r")).group(0)
                idx = 0
                for ch in letters:
                    idx = idx * 26 + ord(ch) - 64
                v = c.find(ns + "v")
                if c.get("t") == "s" and v is not None:
                    cells[idx - 1] = shared[int(v.text)]
                elif v is not None:
                    cells[idx - 1] = v.text or ""
            if cells:
                rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
        sheets[s.get("name")] = rows
    return sheets


# --------------------------------------------------------------------------- #
# FDA Total Diet Study elements
# --------------------------------------------------------------------------- #
def extract_tds() -> None:
    path = RAW / "tds" / "tds_fy18_20_elements.txt"
    acc: dict[tuple, dict] = {}
    names: dict[int, str] = {}
    with open(path, encoding="latin-1", newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            analyte = TDS_ANALYTES.get(r["Analyte"].strip())
            desc = r["TDSFoodDescription"].strip()
            if analyte is None or desc.startswith("BF,"):
                continue
            num = int(r["TDSFoodNumber"])
            names[num] = desc
            if r["Units"].strip() != "ppb":
                raise SystemExit(f"unexpected unit for {analyte}: {r['Units']}")
            conc, rl = float(r["Concentration"]), float(r["ReportingLimit"])
            a = acc.setdefault((num, analyte), {"n": 0, "det": 0, "sum": 0.0, "ub": 0.0, "max": 0.0, "rl": [], "years": set()})
            a["n"] += 1
            a["det"] += conc > 0
            a["sum"] += conc
            # Upper bound: a non-detect could be as high as the reporting limit.
            a["ub"] += conc if conc > 0 else rl
            a["max"] = max(a["max"], conc)
            a["rl"].append(rl)
            a["years"].add(int(r["CalendarYear"]))
    rows = []
    for (num, analyte), a in sorted(acc.items()):
        rows.append([
            num, names[num], analyte, a["n"], a["det"], fmt(a["sum"] / a["n"]), fmt(a["ub"] / a["n"]),
            fmt(a["max"]), fmt(min(a["rl"])), fmt(max(a["rl"])), min(a["years"]), max(a["years"]),
        ])
    write_tsv("tds_elements.tsv",
              ["tds_food_number", "tds_food", "analyte", "n", "n_detected", "mean_ppb_nd0", "mean_ppb_ub",
               "max_ppb", "rl_min_ppb", "rl_max_ppb", "year_start", "year_end"], rows)


# --------------------------------------------------------------------------- #
# USDA Pesticide Data Program
# --------------------------------------------------------------------------- #
def member(z: zipfile.ZipFile, suffix: str) -> str:
    hits = [n for n in z.namelist() if n.lower().endswith(suffix.lower())]
    if not hits:
        raise SystemExit(f"{suffix} not found in {z.filename}")
    return hits[0]


def pdp_reference(z: zipfile.ZipFile, year: int) -> tuple[dict[str, str], dict[str, str]]:
    """(commodity code -> name, pesticide code -> name) for one PDP year."""
    txt = pdf_text(z.read(member(z, f"ReferenceTables {year}.pdf")))
    lines = [ln.strip() for ln in txt.splitlines()]
    commods, pests = {}, {}
    for i, ln in enumerate(lines[:-2]):
        name, count = lines[i + 1], lines[i + 2]
        if re.fullmatch(r"[A-Z]{2}", ln) and re.fullmatch(r"[\d,]+", count) and not re.fullmatch(r"[A-Z]{2}|[\d,]+", name):
            commods[ln] = name.rstrip(",")
    # Pesticide rows run: code, name, test class letter, result count.
    for i, ln in enumerate(lines[:-3]):
        if re.fullmatch(r"[0-9A-Z]{3}", ln) and re.fullmatch(r"[A-Z]", lines[i + 2]) and re.fullmatch(r"[\d,]+", lines[i + 3]):
            pests[ln] = lines[i + 1]
    return commods, pests


def extract_pdp() -> None:
    commod_names: dict[str, str] = {}
    pest_names: dict[str, str] = {}
    years_for: dict[str, set[int]] = defaultdict(set)
    # (year, commodity) -> sample ids, (year, commodity, pesticide) -> statistics
    samples: dict[tuple, set] = defaultdict(set)
    detect_samples: dict[tuple, set] = defaultdict(set)
    over_tol: dict[tuple, set] = defaultdict(set)
    no_tol: dict[tuple, set] = defaultdict(set)
    stats: dict[tuple, dict] = {}

    for year in PDP_YEARS:
        path = RAW / "pdp" / f"{year}PDPDatabase.zip"
        z = zipfile.ZipFile(path)
        commods, pests = pdp_reference(z, year)
        commod_names.update(commods)
        pest_names.update(pests)
        if year == 2024:  # the only year with an .xlsx reference workbook, and the most reliable names
            sheets = xlsx_rows(z.read(member(z, f"ReferenceTables {year}.xlsx")))
            for r in sheets["Commodity"]:
                if len(r) >= 2 and re.fullmatch(r"[A-Z]{2}", r[0]):
                    commod_names[r[0]] = r[1].rstrip(",")
            for r in sheets["Pest Code"]:
                if len(r) >= 2 and re.fullmatch(r"[0-9A-Z]{3}", r[0]):
                    pest_names[r[0]] = r[1]
        with z.open(member(z, "Results.txt")) as fh:
            for line in io.TextIOWrapper(fh, encoding="latin-1"):
                f = line.rstrip("\r\n").split("|")
                if len(f) < 14:
                    continue
                pk, commod, pest, conc, lod, unit, annotate = f[0], f[1], f[4], f[6], f[7], f[8], f[11]
                scale = {"M": 1.0, "B": 1e-3, "T": 1e-6}.get(unit)
                if scale is None:
                    raise SystemExit(f"unknown PDP unit {unit!r} in {path.name}")
                years_for[commod].add(year)
                key = (year, commod)
                samples[key].add(pk)
                s = stats.setdefault((year, commod, pest), {"n": 0, "det": 0, "sum": 0.0, "max": 0.0, "lod": []})
                s["n"] += 1
                if lod:
                    s["lod"].append(float(lod) * scale)
                value = float(conc) * scale if conc else 0.0
                if value > 0:
                    s["det"] += 1
                    s["sum"] += value
                    s["max"] = max(s["max"], value)
                    detect_samples[key].add(pk)
                    if annotate == "X":
                        over_tol[key].add(pk)
                    elif annotate in ("V", "QV"):
                        no_tol[key].add(pk)

    commodity_rows, residue_rows = [], []
    for commod, years in sorted(years_for.items()):
        name = commod_names.get(commod)
        if name is None:
            raise SystemExit(f"no name for PDP commodity {commod}")
        if name.startswith(PDP_EXCLUDE_PREFIX):
            continue
        last = max(years)
        pool = sorted(y for y in years if y > last - PDP_POOL_YEARS)
        n_samples = sum(len(samples[(y, commod)]) for y in pool)
        n_det = sum(len(detect_samples[(y, commod)]) for y in pool)
        n_over = sum(len(over_tol[(y, commod)]) for y in pool)
        n_notol = sum(len(no_tol[(y, commod)]) for y in pool)
        merged: dict[str, dict] = {}
        for (y, c, pest), s in stats.items():
            if c != commod or y not in pool:
                continue
            m = merged.setdefault(pest, {"n": 0, "det": 0, "sum": 0.0, "max": 0.0, "lod": []})
            m["n"] += s["n"]
            m["det"] += s["det"]
            m["sum"] += s["sum"]
            m["max"] = max(m["max"], s["max"])
            m["lod"].extend(s["lod"])
        detected = {p: m for p, m in merged.items() if m["det"] > 0}
        commodity_rows.append([commod, name, n_samples, n_det, n_over, n_notol, len(merged), len(detected), pool[0], pool[-1]])
        for pest, m in sorted(detected.items()):
            residue_rows.append([
                commod, pest, pest_names.get(pest, f"PDP pesticide {pest}"), m["n"], m["det"],
                fmt(m["sum"] / m["n"]), fmt(m["max"]), fmt(min(m["lod"]) if m["lod"] else None),
                pool[0], pool[-1],
            ])
    write_tsv("pdp_commodities.tsv",
              ["commodity", "name", "n_samples", "n_samples_detected", "n_samples_over_tolerance",
               "n_samples_no_tolerance", "n_pesticides_tested", "n_pesticides_detected", "year_start", "year_end"],
              commodity_rows)
    write_tsv("pdp_residues.tsv",
              ["commodity", "pest_code", "pesticide", "n_results", "n_detected", "mean_ppm_nd0", "max_ppm",
               "lod_min_ppm", "year_start", "year_end"],
              residue_rows)


# --------------------------------------------------------------------------- #
# EPA Human Health Benchmarks for Pesticides
# --------------------------------------------------------------------------- #
def extract_epa_pads() -> None:
    txt = pdf_text(RAW / "epa" / "hh-benchmarks-table-2021.pdf")
    t = re.sub(r"\s+", " ", txt)
    num = r"(?:\d+(?:\.\d+)?(?:[eE]-?\d+)?|--)"
    pop = r"(?:Children|Infants|Females 13-49 yrs|General Population|--)"
    rx = re.compile(rf"([^|]*?) ({num}) ({num}) ({pop}) ({num}) ({num})")
    rows = []
    seen = set()
    for m in rx.finditer(t):
        # The previous row's tail (population, cancer columns) runs into this name, so cut it off.
        name = m.group(1).split(" - - ")[-1]
        name = re.sub(r"^.*(?:General Population|Females 13-49 yrs|Children|Infants)\s+", "", name)
        name = re.sub(r"^[\d.\-eE ]+(?=[A-Za-z(])", lambda mm: "" if len(mm.group(0)) > 4 else mm.group(0), name)
        if name.lower().startswith("allethrins"):
            name = re.sub(r"(?<=[a-z)])[a-z]?h$", "", name)
        name = name.strip(" -")
        if "Triazole" in m.group(1) and "ppb" in m.group(1):
            name = "1,2,4-Triazole"  # the first row follows the table header
        if not name or name.lower() in seen or "ppb" in name.lower():
            continue
        seen.add(name.lower())
        acute, chronic = m.group(2), m.group(5)
        rows.append([name, "" if chronic == "--" else chronic, "" if acute == "--" else acute,
                     "" if m.group(6) == "--" else m.group(6)])
    rows.sort(key=lambda r: r[0].lower())
    write_tsv("epa_pads.tsv", ["pesticide", "chronic_pad_mg_kg_day", "acute_pad_mg_kg_day", "chronic_hhbp_ppb"], rows)


# --------------------------------------------------------------------------- #
# FDA mercury in commercial fish and shellfish
# --------------------------------------------------------------------------- #
def extract_fish_mercury() -> None:
    page = (RAW / "fda_mercury" / "mercury.html").read_text(encoding="utf-8")
    table = re.search(r"<table.*?</table>", page, re.S).group(0)
    rows = []
    for tr in re.findall(r"<tr.*?</tr>", table, re.S):
        cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", c))).strip()
                 for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
        if len(cells) != 8 or cells[0] == "SPECIES":
            continue
        species, mean, median, stdev, lo, hi, n, source = cells
        years = re.findall(r"\d{4}", source)
        rows.append([re.sub(r"\s*\[\d+\]", "", species).strip(), mean, median, stdev, lo, hi, n, source,
                     years[0], years[-1]])
    if len(rows) < 60:
        raise SystemExit(f"fish mercury table looks wrong: {len(rows)} rows")
    write_tsv("fish_mercury.tsv", ["species", "mean_ppm", "median_ppm", "stdev_ppm", "min_ppm", "max_ppm", "n",
                                   "source_note", "year_start", "year_end"], rows)


# --------------------------------------------------------------------------- #
# Hand-copied tables: confirm every value still appears in the source PDF
# --------------------------------------------------------------------------- #
def check_rice_table() -> None:
    text = re.sub(r"\s+", " ", pdf_text(RAW / "fda_rice" / "risk_assessment_2016.pdf"))
    start = text.find("Rice Type")
    missing = []
    with open(OUT / "rice_arsenic.tsv", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if not re.search(rf"\b{r['n']} +{re.escape(r['mean_ppb'])}\b", text[start:]):
                missing.append(r["key"])
    if missing:
        raise SystemExit(f"rice_arsenic.tsv values not found in the FDA report: {missing}")
    log("[check] rice_arsenic.tsv: every n and mean found in FDA 2016 Table 4.2")


def check_dw_refs() -> None:
    """Every EPA drinking-water RfD we use must appear on the row named for that pesticide."""
    lines = [ln.strip() for ln in pdf_text(RAW / "epa" / "dwtable2018.pdf").splitlines()]
    missing = []
    with open(OUT / "pesticide_extra_refs.tsv", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            if r["source_id"] != "epa_dwsha_2018":
                continue
            hit = next((i for i, ln in enumerate(lines) if ln.lower().startswith(r["pesticide"].lower())), None)
            if hit is None or r["rfd_mg_kg_day"] not in lines[hit:hit + 22]:
                missing.append(r["pesticide"])
    if missing:
        raise SystemExit(f"pesticide_extra_refs.tsv values not found in the EPA table: {missing}")
    log("[check] pesticide_extra_refs.tsv: every reference dose found in the EPA table")


STEPS = {
    "tds": extract_tds,
    "fish": extract_fish_mercury,
    "epa": extract_epa_pads,
    "pdp": extract_pdp,
    "rice-check": check_rice_table,
    "dw-check": check_dw_refs,
}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--download", action="store_true", help="fetch the pinned sources first")
    p.add_argument("--allow-hash-mismatch", action="store_true")
    p.add_argument("--verify", action="store_true", help="check sha256 pins only")
    p.add_argument("--only", default=",".join(STEPS), help=f"comma-separated steps (default all): {', '.join(STEPS)}")
    args = p.parse_args(argv)
    if args.verify:
        return 1 if verify_pins() else 0
    if args.download:
        fetch(args.allow_hash_mismatch)
    for step in args.only.split(","):
        STEPS[step.strip()]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
