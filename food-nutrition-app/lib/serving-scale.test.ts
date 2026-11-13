import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    FALLBACK_GRAMS, GRAMS_PER_OUNCE, GRAMS_PER_POUND, MAX_SERVING_GRAMS, MIN_SERVING_GRAMS, STANDARD_WEIGHTS,
    displayNutrient, formatGrams, formatNumber, fromGrams, labelNutrient, parseServingAmount, percentOfDailyValue,
    sameWeight, scaleAmount, scaleNutrient, standardWeight, toGrams, weightLabel,
} from './serving-scale';
import { servingOptions } from './food-page';
import { makeFood } from './testing/fixtures';
import type { Food } from './food-types';
import { dailyValue } from '@/components/planner/nutrients';

const THREE_OZ = 85.048569375; // 3 × 28.349523125, exact

describe('unit conversions', () => {
    it('uses the exact avoirdupois ounce and pound', () => {
        assert.equal(GRAMS_PER_OUNCE, 28.349523125);
        assert.equal(GRAMS_PER_POUND, 453.59237);
        // 16 oz is exactly 1 lb (both are defined from the same international pound).
        assert.equal(16 * GRAMS_PER_OUNCE, GRAMS_PER_POUND);
    });
    it('converts ounces to grams exactly and back', () => {
        assert.equal(toGrams(1, 'oz'), 28.349523125);
        assert.equal(toGrams(3, 'oz'), THREE_OZ);
        assert.equal(toGrams(16, 'oz'), 453.59237);
        assert.equal(toGrams(250, 'g'), 250);
        for (const oz of [0.5, 1, 3, 4, 7.25, 100]) {
            assert.ok(Math.abs(fromGrams(toGrams(oz, 'oz'), 'oz') - oz) < 1e-12, `${oz} oz round trip`);
        }
        assert.equal(fromGrams(100, 'g'), 100);
    });
});

describe('scaleAmount', () => {
    it('is value per 100 g × grams / 100', () => {
        assert.equal(scaleAmount(20, 100), 20);
        assert.equal(scaleAmount(20, 50), 10);
        assert.equal(scaleAmount(203, 250), 507.5);
        assert.ok(Math.abs(scaleAmount(20.3, THREE_OZ)! - 17.26485958) < 1e-8);
    });
    it('is linear: scale(a + b) = scale(a) + scale(b), and doubling grams doubles amounts', () => {
        const per100 = [0, 0.259, 2.28, 13.1, 20.3, 62.1, 203, 378, 1234.5];
        const grams = [1, 28.349523125, 33.3, THREE_OZ, 100, 151, 2500];
        for (const v of per100) {
            for (const a of grams) {
                for (const b of grams) {
                    const together = scaleAmount(v, a + b)!;
                    const apart = scaleAmount(v, a)! + scaleAmount(v, b)!;
                    assert.ok(Math.abs(together - apart) <= 1e-9 * Math.max(1, together), `${v} at ${a}+${b}`);
                }
                assert.ok(Math.abs(scaleAmount(v, 2 * a)! - 2 * scaleAmount(v, a)!) <= 1e-9 * Math.max(1, v * a));
            }
        }
    });
    it('keeps a missing value missing at every weight, and a measured 0 at 0', () => {
        for (const g of [0, 1, THREE_OZ, 100, 5000]) {
            assert.equal(scaleAmount(null, g), null);
            assert.equal(scaleAmount(undefined, g), null);
            assert.equal(scaleAmount(Number.NaN, g), null);
            assert.equal(scaleAmount('12', g), null, 'only real numbers are values');
            assert.equal(scaleAmount(0, g), 0);
        }
    });
    it('gives 0 at 0 g and refuses weights that are not a weight', () => {
        assert.equal(scaleAmount(55, 0), 0);
        for (const bad of [-1, -0.001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            assert.throws(() => scaleAmount(10, bad), RangeError, `grams ${bad}`);
        }
    });
    it('stays exact for huge weights (no rounding inside the math)', () => {
        assert.equal(scaleAmount(884, 5000), 44200);
        assert.equal(scaleAmount(0.001, 1e6), 10);
    });
});

describe('percentOfDailyValue', () => {
    it('comes from the unrounded amount', () => {
        // 10.4 mcg vitamin D shows as "10 mcg", but it is 52% of 20 mcg, not 50%.
        assert.equal(percentOfDailyValue(10.4, 20), 52);
        assert.equal(displayNutrient({ amount: 10.4, dvPct: 52, olderEntry: false, atLeast: false }, 'mcg').amount, '10 mcg');
        const s = scaleNutrient(makeFood({ id: 1, description: 'x', vitamin_d_ug: 10.4 }), 'vitamin_d_ug', 100, 20);
        assert.equal(displayNutrient(s, 'mcg').dv, '52%');
    });
    it('is null without an amount or a daily value', () => {
        assert.equal(percentOfDailyValue(null, 20), null);
        assert.equal(percentOfDailyValue(5, null), null);
        assert.equal(percentOfDailyValue(5, 0), null);
    });
});

describe('display rounding happens after scaling', () => {
    it('formats like the label: 0 decimals from 10, 1 from 1, 2 below 1', () => {
        assert.equal(formatNumber(1234.5), '1,235');
        assert.equal(formatNumber(17.26), '17');
        assert.equal(formatNumber(1.939), '1.9');
        assert.equal(formatNumber(0.2203), '0.22');
        assert.equal(formatNumber(0), '0');
        assert.equal(formatNumber(null), '—');
        assert.equal(formatNumber(172.6, 0), '173');
    });
    it('gives a different (correct) answer from rounding first', () => {
        // 2.46 g per 100 g shows as "2.5 g". At 200 g that is 4.92 g ("4.9 g"); rounding first would say 5 g.
        const food = makeFood({ id: 1, description: 'x', protein_g: 2.46 });
        assert.equal(labelNutrient(food, 'protein_g', 200, 'g', null).amount, '4.9 g');
        assert.equal(formatNumber(Number(formatNumber(2.46)) * 2), '5', 'what rounding first would show');
        // %DV: 0.86 mg iron per 100 g ("0.86 mg", 5%) at 300 g is 2.58 mg = 14.33% -> 14%. Rounded first: 2.6 mg -> 14.4%, or 5% × 3 = 15%.
        const iron = makeFood({ id: 2, description: 'y', iron_mg: 0.86 });
        assert.equal(labelNutrient(iron, 'iron_mg', 300, 'mg', 18).dv, '14%');
        assert.equal(labelNutrient(iron, 'iron_mg', 100, 'mg', 18).dv, '5%');
    });
});

describe('scaleNutrient keeps the markers', () => {
    const food: Food = {
        ...makeFood({ id: 1, description: 'Recipe: test', vitamin_d_ug: 11, protein_g: 12, iron_mg: null }),
        filledFrom: { vitamin_d_ug: 175167 },
        recipe: { id: 'r1', servingGrams: 200, uncounted: [], incomplete: ['protein_g', 'iron_mg'], fingerprint: 'f' },
    };
    it('marks values from the older USDA entry (†) at every weight', () => {
        for (const g of [1, THREE_OZ, 100, 5000]) {
            const s = scaleNutrient(food, 'vitamin_d_ug', g, 20);
            assert.equal(s.olderEntry, true);
            assert.equal(s.amount, 11 * g / 100);
            assert.equal(labelNutrient(food, 'vitamin_d_ug', g, 'mcg', 20).olderEntry, true);
        }
        assert.equal(scaleNutrient(food, 'protein_g', 100, null).olderEntry, false);
    });
    it('carries "at least" (≥) through to the amount and the %DV', () => {
        const d = labelNutrient(food, 'protein_g', 50, 'g', 50);
        assert.equal(d.amount, '≥ 6 g');
        assert.equal(d.dv, '≥ 12%');
        assert.equal(labelNutrient(food, 'vitamin_d_ug', 50, 'mcg', 20).amount, '5.5 mcg');
    });
    it('shows "—" for a missing value, never 0 and never "≥ —"', () => {
        const d = labelNutrient(food, 'iron_mg', THREE_OZ, 'mg', 18);
        assert.equal(d.amount, '—');
        assert.equal(d.dv, null);
        assert.equal(scaleNutrient(food, 'not_a_column', 100, null).amount, null);
    });
});

describe('parseServingAmount', () => {
    it('reads grams and ounces exactly', () => {
        assert.deepEqual(parseServingAmount('150', 'g'), { ok: true, grams: 150 });
        assert.deepEqual(parseServingAmount(' 3 ', 'oz'), { ok: true, grams: THREE_OZ });
        assert.deepEqual(parseServingAmount('2.5', 'oz'), { ok: true, grams: 2.5 * GRAMS_PER_OUNCE });
    });
    it('uses the food page rule: 1 to 5,000 g, in either unit', () => {
        assert.equal(MIN_SERVING_GRAMS, 1);
        assert.equal(MAX_SERVING_GRAMS, 5000);
        assert.equal(FALLBACK_GRAMS, 100);
        assert.equal(parseServingAmount('1', 'g').ok, true);
        assert.equal(parseServingAmount('5000', 'g').ok, true);
        assert.equal(parseServingAmount('176.36', 'oz').ok, true);
        for (const [text, unit] of [['0', 'g'], ['-5', 'g'], ['0.99', 'g'], ['5000.01', 'g'], ['176.4', 'oz'], ['0.03', 'oz'],
            ['', 'g'], ['abc', 'oz'], ['12abc', 'g'], ['NaN', 'g'], ['Infinity', 'g'], ['1e400', 'g']] as const) {
            const r = parseServingAmount(text, unit);
            assert.equal(r.ok, false, `${text} ${unit}`);
            if (!r.ok) assert.match(r.message, /1 to 5,000 g/);
        }
    });
});

describe('standard weights', () => {
    it('are 1 oz, 3 oz and 100 g, at exact grams, labelled with grams', () => {
        assert.deepEqual(STANDARD_WEIGHTS.map(w => [w.id, w.grams]), [['w-1oz', 28.349523125], ['w-3oz', THREE_OZ], ['w-100g', 100]]);
        assert.equal(weightLabel(standardWeight('w-3oz')), '3 oz (85.05 g)');
        assert.equal(weightLabel(standardWeight('w-1oz')), '1 oz (28.35 g)');
        assert.equal(weightLabel(standardWeight('w-100g')), '100 g');
        assert.equal(formatGrams(1000), '1,000');
        assert.equal(formatGrams(91), '91');
    });
    it('treat weights within USDA’s half-gram precision as the same', () => {
        assert.equal(sameWeight(85, THREE_OZ), true);
        assert.equal(sameWeight(28, GRAMS_PER_OUNCE), true);
        assert.equal(sameWeight(28.4, GRAMS_PER_OUNCE), true);
        assert.equal(sameWeight(84, THREE_OZ), false);
        assert.equal(sameWeight(91, 100), false);
    });
});

describe('USDA’s "3 oz" (85 g) and the exact 3 oz (85.05 g) show the same label', () => {
    const KEYS: [string, string, number | null][] = [
        ['calories', '', null], ['total_fat_g', 'g', 78], ['saturated_g', 'g', 20], ['cholesterol_mg', 'mg', 300],
        ['sodium_mg', 'mg', 2300], ['carbohydrate_g', 'g', 275], ['protein_g', 'g', null], ['vitamin_d_ug', 'mcg', 20],
        ['calcium_mg', 'mg', 1300], ['iron_mg', 'mg', 18], ['potassium_mg', 'mg', 4700],
    ];
    // Salmon, Atlantic, farm raised, raw (Foundation 2684441) and lingcod, raw (SR 173671), per 100 g.
    const salmon = makeFood({ id: 1, description: 'Fish, salmon, Atlantic, farm raised, raw', calories: 203, total_fat_g: 13.1, saturated_g: 2.28,
        cholesterol_mg: 62.1, sodium_mg: 49.5, carbohydrate_g: 0, protein_g: 20.3, vitamin_d_ug: 11, calcium_mg: 9.42, iron_mg: 0.259, potassium_mg: 378 });
    const lingcod = makeFood({ id: 2, description: 'Fish, lingcod, raw', calories: 85, total_fat_g: 1.06, saturated_g: 0.197,
        cholesterol_mg: 52, sodium_mg: 59, carbohydrate_g: 0, protein_g: 17.66, vitamin_d_ug: null, calcium_mg: 14, iron_mg: 0.32, potassium_mg: 437 });
    // One step of the shown precision: "372" vs "371", "9.4" vs "9.3", "0.27" vs "0.26".
    const step = (s: string) => (s.includes('.') ? 10 ** -s.split('.')[1].length : 1);
    const num = (s: string) => Number(s.replace(/[^\d.]/g, ''));
    it('differ by 0.057%, so the label agrees to within one displayed digit', () => {
        assert.ok(Math.abs(THREE_OZ / 85 - 1 - 0.000571) < 0.000001);
        let same = 0, total = 0;
        for (const food of [salmon, lingcod]) {
            for (const [key, unit, dv] of KEYS) {
                const usda = labelNutrient(food, key, 85, unit, dv, key === 'calories' ? 0 : undefined);
                const exact = labelNutrient(food, key, THREE_OZ, unit, dv, key === 'calories' ? 0 : undefined);
                total++;
                if (exact.amount === usda.amount && exact.dv === usda.dv) { same++; continue; }
                for (const [a, b] of [[exact.amount, usda.amount], [exact.dv ?? '0', usda.dv ?? '0']]) {
                    assert.ok(Math.abs(num(a) - num(b)) <= Math.max(step(a), step(b)) + 1e-9, `${food.description} ${key}: ${a} vs ${b}`);
                }
            }
        }
        // Only values sitting on a rounding boundary move: lingcod potassium 371.45 mg ("371") at 85 g, 371.66 mg ("372") at 85.05 g.
        assert.ok(same >= total - 2, `${same} of ${total} identical`);
        assert.equal(labelNutrient(lingcod, 'potassium_mg', 85, 'mg', 4700).amount, '371 mg');
        assert.equal(labelNutrient(lingcod, 'potassium_mg', THREE_OZ, 'mg', 4700).amount, '372 mg');
    });
    it('are one menu entry, at the exact weight', () => {
        const rows = [{ id: 7, food_id: 2, label: '3 oz', weight_g: 85 }, { id: 8, food_id: 2, label: '100 g', weight_g: 100 }];
        const { options } = servingOptions({ ...lingcod, food_category: 'Finfish and Shellfish Products', serving_sizes: rows });
        const near3oz = options.filter(o => sameWeight(o.grams, THREE_OZ));
        assert.equal(near3oz.length, 1);
        assert.equal(near3oz[0].grams, THREE_OZ);
        assert.equal(near3oz[0].label, '3 oz (85.05 g)');
    });
});

// ---------------------------------------------------------------------------
// The owner's case, with the real database: salmon vs lingcod at 3 oz.
// ---------------------------------------------------------------------------

const DB_PATH = path.join(import.meta.dirname, '..', 'nutrition.db');
const hasDb = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 1_000_000;

describe('worked example from nutrition.db: salmon vs lingcod at 3 oz', { skip: !hasDb && 'nutrition.db not present' }, () => {
    const label = (food: Food, key: string, unit: string) =>
        labelNutrient(food, key, THREE_OZ, unit, key === 'sugars_g' ? null : dailyValue(key), key === 'calories' ? 0 : undefined);

    it('salmon, Atlantic, farm raised, raw (2684441): hand-checked', async () => {
        const { getFoodByFdcId } = await import('./db');
        const salmon = (await getFoodByFdcId(2684441))!;
        // Stored per 100 g (the database's only basis).
        assert.equal(salmon.calories, 203);
        assert.equal(salmon.protein_g, 20.3);
        assert.equal(salmon.vitamin_d_ug, 11, 'filled from the older SR entry 175167');
        // 3 oz = 85.048569375 g, so every value is per-100 g × 0.85048569375.
        assert.equal(label(salmon, 'calories', '').amount, '173');              // 172.65
        assert.deepEqual(label(salmon, 'total_fat_g', 'g'), { amount: '11 g', dv: '14%', olderEntry: false });   // 11.141 g, 14.28%
        assert.deepEqual(label(salmon, 'saturated_g', 'g'), { amount: '1.9 g', dv: '10%', olderEntry: false });  // 1.939 g, 9.70%
        assert.deepEqual(label(salmon, 'cholesterol_mg', 'mg'), { amount: '53 mg', dv: '18%', olderEntry: false }); // 52.815 mg, 17.6%
        assert.deepEqual(label(salmon, 'sodium_mg', 'mg'), { amount: '42 mg', dv: '2%', olderEntry: false });    // 42.099 mg, 1.83%
        assert.deepEqual(label(salmon, 'protein_g', 'g'), { amount: '17 g', dv: '35%', olderEntry: false });     // 17.265 g, 34.5%
        assert.deepEqual(label(salmon, 'vitamin_d_ug', 'mcg'), { amount: '9.4 mcg', dv: '47%', olderEntry: true }); // 9.355 mcg †, 46.8%
        assert.deepEqual(label(salmon, 'calcium_mg', 'mg'), { amount: '8 mg', dv: '1%', olderEntry: false });    // 8.012 mg, 0.62%
        assert.deepEqual(label(salmon, 'iron_mg', 'mg'), { amount: '0.22 mg', dv: '1%', olderEntry: false });    // 0.2203 mg, 1.22%
        assert.deepEqual(label(salmon, 'potassium_mg', 'mg'), { amount: '321 mg', dv: '7%', olderEntry: false }); // 321.48 mg, 6.84%
        assert.equal(label(salmon, 'trans_g', 'g').amount, '—', 'not measured in either USDA entry');
    });

    it('lingcod, meat, raw (169809), which has no 3 oz portion in USDA: hand-checked', async () => {
        const { getFoodByFdcId, getDb } = await import('./db');
        const portions = getDb().prepare('SELECT label, weight_g FROM serving_sizes s JOIN foods f ON f.id = s.food_id WHERE f.fdc_id = ?').all(169809);
        assert.deepEqual(portions, [{ label: '100 g', weight_g: 100 }], 'USDA lists only 100 g');
        const lingcod = (await getFoodByFdcId(169809))!;
        const { options } = servingOptions(lingcod);
        assert.ok(options.some(o => o.id === 'w-3oz' && o.grams === THREE_OZ), 'but the menu now offers 3 oz');

        assert.equal(label(lingcod, 'calories', '').amount, '67');                 // 79 × 0.8505 = 67.19
        assert.deepEqual(label(lingcod, 'total_fat_g', 'g'), { amount: '0.68 g', dv: '1%', olderEntry: false });  // 0.6804 g, 0.87%
        assert.deepEqual(label(lingcod, 'protein_g', 'g'), { amount: '15 g', dv: '30%', olderEntry: false });     // 15.224 g, 30.4%
        assert.deepEqual(label(lingcod, 'sodium_mg', 'mg'), { amount: '50 mg', dv: '2%', olderEntry: false });    // 50.179 mg, 2.18%
        assert.deepEqual(label(lingcod, 'potassium_mg', 'mg'), { amount: '368 mg', dv: '8%', olderEntry: false }); // 368.26 mg, 7.84%
        assert.equal(label(lingcod, 'carbohydrate_g', 'g').amount, '0 g', 'a measured zero stays 0');
        // Not measured by USDA: still "—" at 3 oz.
        assert.deepEqual(label(lingcod, 'saturated_g', 'g'), { amount: '—', dv: null, olderEntry: false });
        assert.deepEqual(label(lingcod, 'cholesterol_mg', 'mg'), { amount: '—', dv: null, olderEntry: false });
        assert.deepEqual(label(lingcod, 'vitamin_d_ug', 'mcg'), { amount: '—', dv: null, olderEntry: false });
    });
});
