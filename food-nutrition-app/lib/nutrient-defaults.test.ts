import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_NUTRIENT_CONFIG, NUTRIENT_CONFIG, OPTIONAL_NUTRIENT_CONFIG, isFoodSafeUpperLimit } from './nutrient-defaults';

// 21 CFR 101.9(c)(8)(iv) and (c)(9), adults and children >= 4 years (2016 rule).
const FDA_DV: Record<string, [number, string]> = {
    total_fat_g: [78, 'g'], saturated_g: [20, 'g'], cholesterol_mg: [300, 'mg'], sodium_mg: [2300, 'mg'],
    carbohydrate_g: [275, 'g'], fiber_g: [28, 'g'], protein_g: [50, 'g'], sugars_g: [50, 'g'],
    vitamin_a_ug: [900, 'mcg'], vitamin_c_mg: [90, 'mg'], vitamin_d_ug: [20, 'mcg'], vitamin_e_mg: [15, 'mg'],
    vitamin_k_ug: [120, 'mcg'], thiamin_mg: [1.2, 'mg'], riboflavin_mg: [1.3, 'mg'], niacin_mg: [16, 'mg'],
    vitamin_b6_mg: [1.7, 'mg'], folate_ug: [400, 'mcg'], vitamin_b12_ug: [2.4, 'mcg'],
    pantothenic_acid_mg: [5, 'mg'], calcium_mg: [1300, 'mg'], iron_mg: [18, 'mg'], phosphorus_mg: [1250, 'mg'],
    magnesium_mg: [420, 'mg'], zinc_mg: [11, 'mg'], selenium_ug: [55, 'mcg'], copper_mg: [0.9, 'mg'],
    manganese_mg: [2.3, 'mg'], potassium_mg: [4700, 'mg'], choline_mg: [550, 'mg'],
};

describe('nutrient reference values', () => {
    it('match the FDA Daily Values and units', () => {
        for (const [key, [value, unit]] of Object.entries(FDA_DV)) {
            const c = ALL_NUTRIENT_CONFIG[key];
            assert.ok(c, `missing ${key}`);
            assert.equal(c.defaultValue, value, key);
            assert.equal(c.unit, unit, key);
        }
    });

    it('column suffixes agree with display units', () => {
        for (const [key, c] of Object.entries(ALL_NUTRIENT_CONFIG)) {
            if (key === 'calories') continue;
            const suffix = key.slice(key.lastIndexOf('_') + 1);
            const expected = { g: 'g', mg: 'mg', ug: 'mcg' }[suffix];
            assert.equal(c.unit, expected, key);
        }
    });

    it('flags ULs that apply only to supplemental/synthetic or preformed forms', () => {
        for (const key of ['magnesium_mg', 'niacin_mg', 'folate_ug', 'vitamin_e_mg']) {
            assert.equal(ALL_NUTRIENT_CONFIG[key].ul?.appliesTo, 'supplemental', key);
            assert.equal(isFoodSafeUpperLimit(ALL_NUTRIENT_CONFIG[key]), false, key);
        }
        assert.equal(ALL_NUTRIENT_CONFIG.vitamin_a_ug.ul?.appliesTo, 'preformed');
        assert.equal(isFoodSafeUpperLimit(ALL_NUTRIENT_CONFIG.vitamin_a_ug), false);
        const totals: Record<string, number> = {
            vitamin_c_mg: 2000, vitamin_d_ug: 100, vitamin_b6_mg: 100, calcium_mg: 2500, iron_mg: 45,
            zinc_mg: 40, copper_mg: 10, manganese_mg: 11, selenium_ug: 400, phosphorus_mg: 4000, choline_mg: 3500,
        };
        for (const [key, ul] of Object.entries(totals)) {
            assert.equal(ALL_NUTRIENT_CONFIG[key].ul?.value, ul, key);
            assert.equal(isFoodSafeUpperLimit(ALL_NUTRIENT_CONFIG[key]), true, key);
        }
    });

    it('does not apply the added-sugars DV to total sugars by default', () => {
        assert.equal(NUTRIENT_CONFIG.sugars_g.defaultEnabled, false);
    });

    it('keeps optional nutrients out of the default goal list', () => {
        for (const key of Object.keys(OPTIONAL_NUTRIENT_CONFIG)) {
            assert.equal(NUTRIENT_CONFIG[key], undefined, key);
            assert.equal(OPTIONAL_NUTRIENT_CONFIG[key].defaultEnabled, false, key);
        }
    });
});
