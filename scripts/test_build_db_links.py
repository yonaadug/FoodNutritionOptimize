#!/usr/bin/env python3
"""
Tests for how build_db.py links SR Legacy rows to the Foundation foods that replace them.

    python3 -I scripts/test_build_db_links.py
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_db  # noqa: E402
import nutrient_spec as spec  # noqa: E402


def food(fdc_id, data_type, ndb=None, energy=None, description=None):
    return {
        "fdc_id": fdc_id,
        "data_type": data_type,
        "ndb_number": ndb,
        "description": description or f"food {fdc_id}",
        "nutrients": {} if energy is None else {1008: energy},
    }


def sample():
    return [
        food(1, "foundation_food", ndb=1123, description="Eggs, Grade A, Large, egg whole"),
        food(2, "foundation_food", ndb=100328, description="Fish, cod, Atlantic, wild caught, raw"),
        food(3, "foundation_food", ndb=100400, description="Radishes, red, raw"),
        food(11, "sr_legacy_food", ndb=1123, energy=143, description="Egg, whole, raw, fresh"),
        food(12, "sr_legacy_food", ndb=15015, energy=82, description="Fish, cod, Atlantic, raw"),
        food(13, "sr_legacy_food", ndb=15016, energy=105, description="Fish, cod, Atlantic, cooked, dry heat"),
        food(21, "survey_fndds_food", description="Fish, cod, baked"),
    ]


class LinkOlderEntries(unittest.TestCase):
    def test_ndb_number_and_crosswalk_both_link(self):
        foods = sample()
        how, energy = build_db.link_older_entries(foods, [(2, 12)])
        by_id = {f["fdc_id"]: f for f in foods}
        self.assertEqual(by_id[11]["superseded_by_fdc_id"], 1)
        self.assertEqual(by_id[12]["superseded_by_fdc_id"], 2)
        self.assertEqual(how, {11: "ndb_number", 12: "crosswalk"})
        self.assertEqual(energy[1], (143, spec.CALORIE_SR_FALLBACK))
        self.assertEqual(energy[2], (82, spec.CALORIE_SR_CROSSWALK_FALLBACK))

    def test_everything_else_stays_unlinked(self):
        foods = sample()
        build_db.link_older_entries(foods, [(2, 12)])
        by_id = {f["fdc_id"]: f for f in foods}
        for fid in (1, 2, 3, 13, 21):
            self.assertIsNone(by_id[fid]["superseded_by_fdc_id"], fid)

    def test_without_a_crosswalk_only_ndb_numbers_link(self):
        foods = sample()
        how, energy = build_db.link_older_entries(foods, [])
        self.assertEqual(how, {11: "ndb_number"})
        self.assertEqual(set(energy), {1})

    def test_ndb_energy_wins_over_crosswalk_energy(self):
        foods = sample() + [food(14, "sr_legacy_food", ndb=1124, energy=150)]
        _, energy = build_db.link_older_entries(foods, [(1, 14)])
        self.assertEqual(energy[1], (143, spec.CALORIE_SR_FALLBACK))

    def test_first_crosswalk_row_with_energy_wins(self):
        foods = sample() + [food(14, "sr_legacy_food", ndb=15099)]
        _, energy = build_db.link_older_entries(foods, [(2, 14), (2, 12)])
        self.assertEqual(energy[2], (82, spec.CALORIE_SR_CROSSWALK_FALLBACK))

    def test_rejects_unknown_foundation_food(self):
        with self.assertRaisesRegex(SystemExit, "999"):
            build_db.link_older_entries(sample(), [(999, 12)])

    def test_rejects_unknown_sr_row(self):
        with self.assertRaisesRegex(SystemExit, "999"):
            build_db.link_older_entries(sample(), [(2, 999)])

    def test_rejects_foundation_to_foundation(self):
        with self.assertRaisesRegex(SystemExit, "SR Legacy"):
            build_db.link_older_entries(sample(), [(2, 3)])

    def test_rejects_fndds_as_either_side(self):
        with self.assertRaises(SystemExit):
            build_db.link_older_entries(sample(), [(21, 12)])
        with self.assertRaises(SystemExit):
            build_db.link_older_entries(sample(), [(2, 21)])

    def test_rejects_an_sr_row_already_linked_by_ndb_number(self):
        with self.assertRaisesRegex(SystemExit, "already"):
            build_db.link_older_entries(sample(), [(2, 11)])

    def test_rejects_an_sr_row_listed_twice(self):
        with self.assertRaisesRegex(SystemExit, "more than once"):
            build_db.link_older_entries(sample(), [(2, 12), (3, 12)])


class UnlinkedNdbPairs(unittest.TestCase):
    def test_an_unlinked_ndb_pair_stays_apart(self):
        foods = sample()
        how, energy = build_db.link_older_entries(foods, [(2, 12)], {(1, 11)})
        by_id = {f["fdc_id"]: f for f in foods}
        self.assertIsNone(by_id[11]["superseded_by_fdc_id"])
        self.assertEqual(by_id[12]["superseded_by_fdc_id"], 2)
        self.assertEqual(how, {12: "crosswalk"})
        self.assertNotIn(1, energy)

    def test_rejects_an_unlinked_pair_that_is_not_an_ndb_link(self):
        with self.assertRaisesRegex(SystemExit, "not an NDB link"):
            build_db.link_older_entries(sample(), [], {(2, 12)})

    def test_rejects_a_pair_both_unlinked_and_in_the_crosswalk(self):
        with self.assertRaisesRegex(SystemExit, "also in the crosswalk"):
            build_db.link_older_entries(sample(), [(1, 11)], {(1, 11)})


class CheckedInCrosswalk(unittest.TestCase):
    def test_file_parses_into_integer_pairs(self):
        pairs = build_db.load_crosswalk(build_db.CROSSWALK_PATH)
        self.assertGreater(len(pairs), 0)
        for fid, sid in pairs:
            self.assertIsInstance(fid, int)
            self.assertIsInstance(sid, int)
        self.assertEqual(len({sid for _, sid in pairs}), len(pairs), "an SR row maps to at most one Foundation food")

    def test_owner_example_is_listed(self):
        # Foundation "Fish, cod, Atlantic, wild caught, raw" -> SR "Fish, cod, Atlantic, raw"
        self.assertIn((2684444, 171955), build_db.load_crosswalk(build_db.CROSSWALK_PATH))


    def test_honeycrisp_is_not_golden_delicious(self):
        # Owner decision 2026-11-16: USDA reused golden delicious's NDB number for honeycrisp.
        self.assertIn((1750343, 168202), build_db.load_unlinked(build_db.UNLINKED_PATH))


class CaloriesFromLinkedEntry(unittest.TestCase):
    def test_source_name_says_how_the_entry_was_linked(self):
        _, _, src = spec.resolve_nutrients({1003: 1.0}, 37.0, spec.CALORIE_SR_CROSSWALK_FALLBACK)
        self.assertEqual(src, spec.CALORIE_SR_CROSSWALK_FALLBACK)
        out, _, src = spec.resolve_nutrients({1003: 1.0}, 37.0)
        self.assertEqual((out["calories"], src), (37.0, spec.CALORIE_SR_FALLBACK))
        self.assertIn(spec.CALORIE_SR_CROSSWALK_FALLBACK, spec.CALORIE_SOURCE_NAMES)

    def test_own_energy_beats_the_linked_entry(self):
        out, _, src = spec.resolve_nutrients({1008: 70.5}, 82.0, spec.CALORIE_SR_CROSSWALK_FALLBACK)
        self.assertEqual((out["calories"], src), (70.5, "fdc_1008_energy"))


if __name__ == "__main__":
    unittest.main()
