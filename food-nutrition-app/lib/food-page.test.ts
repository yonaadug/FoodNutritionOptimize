import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    baseName, basePrefixes, categorySlug, dailyValueOf, datasetInfo, fdcUrl, fmt, foodPath, foodSlug,
    formatPublicationDate, keyNutrients, nutrientKeyFromSlug, nutrientProfileSimilarity, nutrientSlug,
    nutrientTable, parseFoodParam, rankRelated, resultNutrients, servingOptions, slugify,
} from './food-page';
import { makeFood } from './testing/fixtures';
import type { ServingSize } from './food-types';

const serving = (id: number, label: string, weight_g: number): ServingSize => ({ id, food_id: 1, label, weight_g });

describe('fmt', () => {
    it('uses a fixed locale and sensible decimals', () => {
        assert.equal(fmt(1234.5), '1,235');
        assert.equal(fmt(12.34), '12');
        assert.equal(fmt(1.26), '1.3');
        assert.equal(fmt(0.456), '0.46');
        assert.equal(fmt(0), '0');
    });
    it('shows an em dash for unknown values, never zero', () => {
        assert.equal(fmt(null), '—');
        assert.equal(fmt(undefined), '—');
        assert.equal(fmt(Number.NaN), '—');
    });
});

describe('slugs and paths', () => {
    it('slugifies punctuation, accents and ampersands', () => {
        assert.equal(slugify('Crème fraîche & 2% milk'), 'creme-fraiche-and-2-milk');
        assert.equal(slugify('  --Hello,  world!-- '), 'hello-world');
        assert.equal(slugify('!!!'), '');
    });
    it('cuts long slugs at a word boundary', () => {
        const s = slugify('Chicken, broiler or fryers, breast, skinless, boneless, meat only, cooked, braised');
        assert.ok(s.length <= 60, s);
        assert.ok(!s.endsWith('-'));
        assert.match(s, /^chicken-broiler-or-fryers-breast-skinless-boneless-meat-only/);
    });
    it('drops generic USDA group prefixes and notes', () => {
        assert.equal(foodSlug('Fish, salmon, sockeye, raw'), 'salmon-sockeye-raw');
        assert.equal(foodSlug('Nuts, almonds, whole, raw'), 'almonds-whole-raw');
        assert.equal(foodSlug("Yogurt, Greek, plain, nonfat (Includes foods for USDA's Food Distribution Program)"), 'yogurt-greek-plain-nonfat');
        assert.equal(foodSlug('Eggs, Grade A, Large, egg whole'), 'eggs-grade-a-large-egg-whole');
    });
    it('falls back when a description has no usable characters', () => {
        assert.equal(foodSlug('???'), 'food');
    });
    it('builds the canonical path', () => {
        assert.equal(foodPath({ fdc_id: 173691, description: 'Fish, salmon, sockeye, raw' }), '/food/173691-salmon-sockeye-raw');
    });
    it('parses the id segment, with or without a slug', () => {
        assert.deepEqual(parseFoodParam('173691'), { fdcId: 173691, slug: '' });
        assert.deepEqual(parseFoodParam('173691-salmon-sockeye-raw'), { fdcId: 173691, slug: 'salmon-sockeye-raw' });
        assert.deepEqual(parseFoodParam('173691-old%20name'), { fdcId: 173691, slug: 'old name' });
    });
    it('rejects anything that is not a positive id', () => {
        for (const bad of ['', 'salmon', '-1', '0', '12a', '99999999999', '1.5']) {
            assert.equal(parseFoodParam(bad), null, bad);
        }
    });
    it('survives malformed percent-encoding', () => {
        assert.deepEqual(parseFoodParam('12-%E0%A4%A'), { fdcId: 12, slug: '%E0%A4%A' });
    });
    it('links to the USDA record', () => {
        assert.equal(fdcUrl(173691), 'https://fdc.nal.usda.gov/food-details/173691/nutrients');
    });
});

describe('formatPublicationDate', () => {
    it('reads the formats in the database', () => {
        assert.equal(formatPublicationDate('4/1/2019'), 'April 1, 2019');
        assert.equal(formatPublicationDate('2019-04-01'), 'April 1, 2019');
        assert.equal(formatPublicationDate('12/16/2019'), 'December 16, 2019');
        assert.equal(formatPublicationDate('2018-04'), 'April 2018');
    });
    it('returns null for missing or unreadable dates', () => {
        for (const bad of [null, undefined, '', 'soon', '13/1/2019', '2019-13-01']) {
            assert.equal(formatPublicationDate(bad), null, String(bad));
        }
    });
});

describe('datasetInfo', () => {
    it('names each USDA dataset', () => {
        assert.equal(datasetInfo('foundation_food').badge, 'USDA Foundation');
        assert.equal(datasetInfo('sr_legacy_food').badge, 'USDA SR Legacy');
        assert.equal(datasetInfo('survey_fndds_food').badge, 'Mixed dish (FNDDS)');
    });
    it('copes with an unknown or missing type', () => {
        assert.equal(datasetInfo('branded_food').badge, 'branded food');
        assert.equal(datasetInfo(null).badge, 'USDA');
    });
});

describe('servingOptions', () => {
    const food = (rows: ServingSize[], over = {}) => makeFood({ id: 1, description: 'Broccoli, raw', food_category: 'Vegetables and Vegetable Products', calories: 34, serving_sizes: rows, ...over });
    const THREE_OZ = 85.048569375;
    const labels = (rows: ServingSize[], over = {}) => servingOptions(food(rows, over)).options.map(o => o.label);

    it('starts with the realistic serving, then household measures, then 1 oz, 3 oz and 100 g', () => {
        const { options, defaultId } = servingOptions(food([serving(1, '100 g', 100), serving(2, '1 cup, chopped', 91), serving(4, '1 stalk', 151)]));
        assert.equal(defaultId, 'typical');
        assert.equal(options[0].id, 'typical');
        assert.deepEqual(options.map(o => o.label), ['1 cup, chopped (91 g)', '1 stalk (151 g)', '1 oz (28.35 g)', '3 oz (85.05 g)', '100 g']);
        assert.deepEqual(options.map(o => o.group), ['household', 'household', 'weight', 'weight', 'weight']);
        assert.equal(options.filter(o => o.grams === 100).length, 1);
    });
    it('does not repeat the typical serving', () => {
        const { options } = servingOptions(food([serving(2, '1 cup, chopped', 91)]));
        assert.equal(options.filter(o => o.label === '1 cup, chopped (91 g)').length, 1);
    });
    it('merges USDA’s "3 oz" (85 g) and "1 oz" (28.35 g) into the standard weights, at the exact grams', () => {
        const { options, defaultId } = servingOptions(food([serving(2, '3 oz', 85), serving(3, '1 oz', 28.35), serving(4, '0.5 fillet', 151)],
            { description: 'Fish, lingcod, raw', food_category: 'Finfish and Shellfish Products' }));
        assert.deepEqual(options.map(o => [o.id, o.label]), [
            ['s4', '0.5 fillet (151 g)'], ['w-1oz', '1 oz (28.35 g)'], ['w-3oz', '3 oz (85.05 g)'], ['w-100g', '100 g'],
        ]);
        assert.equal(defaultId, 'w-3oz', 'the typical 3 oz is the standard 3 oz');
        assert.equal(options.find(o => o.id === 'w-3oz')!.grams, THREE_OZ);
    });
    it('keeps what a USDA row at a standard weight says, once', () => {
        assert.deepEqual(labels([serving(3, '1 RACC', 85), serving(5, '1 oz (22 whole kernels)', 28.35), serving(6, '3 oz (3 oz)', 85)]).slice(-3),
            ['1 oz (22 whole kernels) (28.35 g)', '3 oz · 1 standard serving (85.05 g)', '100 g']);
    });
    it('treats a label that says 3 oz at 84 g (28 g per ounce) as 3 oz, but keeps "1 oz, dry, yields" rows apart', () => {
        const l = labels([serving(2, '3 oz', 84), serving(3, '1 oz, dry, yields', 177)]);
        assert.equal(l.filter(x => x.startsWith('3 oz')).length, 1);
        assert.ok(l.includes('1 oz, dry, yields (177 g)'));
        assert.ok(l.includes('1 oz (28.35 g)'));
    });
    it('still offers 1 oz, 3 oz and 100 g for a meat with no rows, starting at 3 oz', () => {
        const { options, defaultId } = servingOptions(food([], { description: 'Beef, ground', food_category: 'Beef Products' }));
        assert.deepEqual(options.map(o => o.label), ['1 oz (28.35 g)', '3 oz (85.05 g)', '100 g']);
        assert.equal(defaultId, 'w-3oz');
    });
    it('drops measurement artifacts and bad weights', () => {
        assert.deepEqual(labels([serving(2, '1 surface inch', 6), serving(3, '1 cube', 0), serving(4, '1 piece', 119)]),
            ['1 piece (119 g)', '1 oz (28.35 g)', '3 oz (85.05 g)', '100 g']);
    });
    it('offers only 100 g once when that is also the typical serving', () => {
        const { options, defaultId } = servingOptions(food([]));
        assert.deepEqual(options.map(o => o.label), ['1 oz (28.35 g)', '3 oz (85.05 g)', '100 g']);
        assert.equal(defaultId, 'w-100g');
    });
    it('never lists two entries within half a gram of each other with the standard weights', () => {
        const { options } = servingOptions(food([serving(2, '1 slice', 28), serving(3, '1 RACC', 85.4), serving(4, '1 piece', 99.6), serving(5, '2 tbsp', 32)]));
        const weights = options.filter(o => o.group === 'weight');
        for (const o of options) for (const w of weights) if (o !== w) assert.ok(Math.abs(o.grams - w.grams) > 0.5, `${o.label} vs ${w.label}`);
        assert.deepEqual(weights.map(w => w.label), ['1 oz · 1 slice (28.35 g)', '3 oz · 1 standard serving (85.05 g)', '100 g · 1 piece']);
    });
});

describe('nutrientTable', () => {
    const f = makeFood({ id: 1, description: 'Test', calories: 200, protein_g: 10, vitamin_d_ug: null, sodium_mg: 230, sugars_g: 20 });

    it('groups nutrients and scales them to the serving', () => {
        const groups = nutrientTable(f, 50);
        assert.deepEqual(groups.map(g => g.id), ['macros', 'vitamins', 'minerals']);
        const protein = groups[0].rows.find(r => r.key === 'protein_g')!;
        assert.equal(protein.amount, 5);
        assert.equal(protein.per100g, 10);
        assert.equal(protein.dvPct, 10);
    });
    it('keeps not-measured as null, not 0', () => {
        const d = nutrientTable(f, 100).flatMap(g => g.rows).find(r => r.key === 'vitamin_d_ug')!;
        assert.equal(d.amount, null);
        assert.equal(d.dvPct, null);
    });
    it('leaves out columns missing from the database', () => {
        const keys = nutrientTable(f, 100).flatMap(g => g.rows).map(r => r.key);
        assert.ok(!keys.includes('choline_mg'));
        assert.ok(!keys.includes('water_g'));
    });
    it('adds the "other" group when its columns exist', () => {
        const groups = nutrientTable({ ...f, water_g: 70, epa_g: null }, 100);
        assert.equal(groups[groups.length - 1].id, 'other');
        assert.equal(groups[groups.length - 1].rows.find(r => r.key === 'epa_g')?.amount, null);
    });
    it('gives no %DV for calories, total sugars, or nutrients with no reference', () => {
        const rows = nutrientTable({ ...f, epa_g: 1 }, 100).flatMap(g => g.rows);
        for (const key of ['calories', 'sugars_g', 'epa_g']) {
            assert.equal(rows.find(r => r.key === key)?.dvPct, null, key);
        }
        assert.equal(dailyValueOf('sodium_mg'), 2300);
        assert.equal(rows.find(r => r.key === 'sodium_mg')?.dvPct, 10);
    });
    it('marks sub-nutrients for indenting', () => {
        const rows = nutrientTable(f, 100)[0].rows;
        assert.equal(rows.find(r => r.key === 'fiber_g')?.indent, true);
        assert.equal(rows.find(r => r.key === 'protein_g')?.indent, undefined);
    });
});

describe('keyNutrients and resultNutrients', () => {
    const salmon = makeFood({
        id: 1, description: 'Fish, salmon', calories: 130, protein_g: 20, vitamin_b12_ug: 4.2, selenium_ug: 30,
        vitamin_d_ug: 10, sodium_mg: 2300, cholesterol_mg: 300, total_fat_g: 7,
    });

    it('ranks by % Daily Value and ignores nutrients to limit', () => {
        const keys = keyNutrients(salmon, 100).map(k => k.key);
        assert.deepEqual(keys, ['vitamin_b12_ug', 'selenium_ug', 'vitamin_d_ug']);
        assert.ok(!keys.includes('sodium_mg'));
    });
    it('applies the minimum share', () => {
        // 10 g: B12 is 17.5% of its Daily Value; selenium and vitamin D are under 10%.
        assert.deepEqual(keyNutrients(salmon, 10, 3, 10).map(k => k.key), ['vitamin_b12_ug']);
    });
    it('never treats a not-measured nutrient as a highlight', () => {
        const f = { ...salmon, vitamin_b12_ug: null };
        assert.ok(!keyNutrients(f, 100).some(k => k.key === 'vitamin_b12_ug'));
    });
    it('shows protein first in search results, then the richest nutrients', () => {
        assert.deepEqual(resultNutrients(salmon, 100).map(n => n.key), ['protein_g', 'vitamin_b12_ug', 'selenium_ug']);
    });
    it('falls back to macros for foods with few micronutrients', () => {
        const oil = makeFood({ id: 2, description: 'Oil, olive', calories: 884, protein_g: null, total_fat_g: 100 });
        assert.deepEqual(resultNutrients(oil, 14).map(n => n.key), ['total_fat_g']);
    });
    it('scales amounts to the serving', () => {
        assert.equal(resultNutrients(salmon, 50)[0].amount, 10);
    });
});

describe('baseName', () => {
    it('names the food, without group prefixes and plurals', () => {
        assert.equal(baseName('Eggs, Grade A, Large, egg whole'), 'egg');
        assert.equal(baseName('Egg, whole, raw, fresh'), 'egg');
        assert.equal(baseName('Fish, salmon, sockeye, raw'), 'salmon');
        assert.equal(baseName('Salmon, sockeye, canned, total can contents'), 'salmon');
        assert.equal(baseName('Nuts, almonds, whole, raw'), 'almond');
        assert.equal(baseName('Tomatoes, red, ripe'), 'tomato');
        assert.equal(baseName('Berries, mixed'), 'berry');
    });
    it('keeps cheese and beans with their variety', () => {
        assert.equal(baseName('Cheese, cheddar'), 'cheese cheddar');
        assert.notEqual(baseName('Cheese, brie'), baseName('Cheese, cheddar'));
    });
    it('handles a one-word description', () => {
        assert.equal(baseName('Milk'), 'milk');
    });
});

describe('basePrefixes', () => {
    it('finds singular and plural spellings, but not longer words', () => {
        const p = basePrefixes('Eggs, Grade A, Large, egg whole');
        assert.ok(p.includes('egg,') && p.includes('eggs,'));
        assert.ok(p.includes('egg'), 'exact match for a bare "Egg"');
        assert.ok(!p.includes('egg%'));
        // Entries without a comma are exact matches, so "Eggplant, raw" cannot match.
        assert.ok(!p.some(x => x.endsWith(',') && 'eggplant, raw'.startsWith(x)));
    });
    it('looks under the group prefix and without it', () => {
        const p = basePrefixes('Fish, salmon, sockeye, raw');
        assert.ok(p.includes('fish, salmon,'));
        assert.ok(p.includes('salmon,'));
    });
});

describe('rankRelated', () => {
    const egg = makeFood({ id: 1, fdc_id: 748967, description: 'Eggs, Grade A, Large, egg whole', food_category: 'Dairy and Egg Products', ndb_number: 1123, data_type_rank: 1 });
    const make = (id: number, description: string, over = {}) => makeFood({ id, fdc_id: 1000 + id, description, food_category: 'Dairy and Egg Products', data_type_rank: 2, ...over });

    it('separates the same food in another dataset', () => {
        const sr = make(2, 'Egg, whole, raw, fresh', { ndb_number: 1123, superseded_by_fdc_id: 748967 });
        const { equivalents, forms } = rankRelated(egg, [sr]);
        assert.deepEqual(equivalents.map(f => f.id), [2]);
        assert.deepEqual(forms, []);
    });
    // USDA gave some Foundation foods a new NDB number; build_db links their SR twin through
    // scripts/data/foundation_sr_crosswalk.csv instead, so the numbers differ.
    const cod = makeFood({ id: 40, fdc_id: 2684444, description: 'Fish, cod, Atlantic, wild caught, raw', food_category: 'Finfish and Shellfish Products', ndb_number: 100328, data_type_rank: 1 });
    const srCod = makeFood({ id: 41, fdc_id: 171955, description: 'Fish, cod, Atlantic, raw', food_category: 'Finfish and Shellfish Products', ndb_number: 15015, data_type_rank: 2, superseded_by_fdc_id: 2684444 });
    it('counts an older entry linked without a shared NDB number as the same food', () => {
        const { equivalents, forms, similar } = rankRelated(cod, [srCod]);
        assert.deepEqual(equivalents.map(f => f.fdc_id), [171955]);
        assert.deepEqual([...forms, ...similar], []);
    });
    it('shows the replacement as the same food on the older entry’s page', () => {
        const { equivalents, forms } = rankRelated(srCod, [cod]);
        assert.deepEqual(equivalents.map(f => f.fdc_id), [2684444]);
        assert.deepEqual(forms, []);
    });
    it('puts the closest forms first', () => {
        const { forms } = rankRelated(egg, [
            make(3, 'Egg, duck, whole, fresh, raw', { ndb_number: 1138 }),
            make(4, 'Eggs, Grade A, Large, egg white', { ndb_number: 1124, data_type_rank: 1 }),
            make(5, 'Egg, whole, cooked, fried', { ndb_number: 1128 }),
        ]);
        assert.equal(forms[0].id, 4);
        assert.equal(forms.length, 3);
    });
    it('drops a superseded row when its replacement is also listed', () => {
        const kept = make(6, 'Egg, white, raw, frozen', { fdc_id: 555 });
        const old = make(7, 'Egg, white, raw, frozen, old', { superseded_by_fdc_id: 555 });
        assert.deepEqual(rankRelated(egg, [kept, old]).forms.map(f => f.id), [6]);
    });
    it('never returns the food itself or a repeated description', () => {
        const { forms } = rankRelated(egg, [{ ...egg }, make(8, 'Egg, whole, raw'), make(9, 'EGG, WHOLE, RAW')]);
        assert.deepEqual(forms.map(f => f.id), [8]);
    });
    it('respects the limits', () => {
        const many = Array.from({ length: 12 }, (_, i) => make(20 + i, `Egg, form ${i}`));
        assert.equal(rankRelated(egg, many, { forms: 5 }).forms.length, 5);
        assert.equal(rankRelated(egg, many).forms.length, 8);
    });

    const profile = { calories: 30, protein_g: 3, total_fat_g: 0.4, carbohydrate_g: 4, fiber_g: 2, vitamin_c_mg: 30, vitamin_k_ug: 400, folate_ug: 150, calcium_mg: 100, iron_mg: 2, magnesium_mg: 60, potassium_mg: 500 };
    const veg = (id: number, description: string, over = {}) => makeFood({ id, fdc_id: 2000 + id, description, food_category: 'Vegetables', data_type_rank: 2, ...profile, ...over });

    it('finds similar foods by nutrient profile, in the same category only', () => {
        const spinach = veg(1, 'Spinach, raw');
        const { similar, forms } = rankRelated(spinach, [
            veg(2, 'Kale, raw'),
            veg(3, 'Onion, raw', { calories: 300, protein_g: 40, carbohydrate_g: 70, fiber_g: 0, vitamin_k_ug: 0, vitamin_c_mg: 0, folate_ug: 0, calcium_mg: 900, iron_mg: 40, magnesium_mg: 0, potassium_mg: 0 }),
            veg(4, 'Arugula, raw', { food_category: 'Fruits' }),
        ]);
        assert.deepEqual(forms, []);
        assert.deepEqual(similar.map(f => f.id), [2]);
    });
    it('lists one food per name among similar foods', () => {
        const spinach = veg(1, 'Spinach, raw');
        const { similar } = rankRelated(spinach, [veg(2, 'Kale, raw'), veg(3, 'Kale, curly, raw'), veg(4, 'Chard, raw')]);
        assert.equal(similar.filter(f => f.description.startsWith('Kale')).length, 1);
        assert.equal(similar.length, 2);
    });
});

describe('nutrientProfileSimilarity', () => {
    const base = { calories: 100, protein_g: 10, total_fat_g: 5, carbohydrate_g: 20, fiber_g: 3, sugars_g: 2, saturated_g: 1, sodium_mg: 50 };

    it('is 1 for identical profiles and lower for different ones', () => {
        assert.ok(Math.abs(nutrientProfileSimilarity(base, base)! - 1) < 1e-9);
        const other = { ...base, calories: 900, protein_g: 0, total_fat_g: 100, carbohydrate_g: 0, fiber_g: 0, sugars_g: 0 };
        assert.ok(nutrientProfileSimilarity(base, other)! < 0.8);
    });
    it('returns null when too few nutrients are measured in both', () => {
        assert.equal(nutrientProfileSimilarity({ calories: 100, protein_g: 1 }, base), null);
        assert.equal(nutrientProfileSimilarity({ ...base, protein_g: null }, base), null);
    });
});

describe('URL segments', () => {
    it('slugs categories', () => {
        assert.equal(categorySlug('Lamb, Veal, and Game Products'), 'lamb-veal-and-game-products');
        assert.equal(categorySlug('Pasta mixed dishes, excludes macaroni and cheese'), 'pasta-mixed-dishes-excludes-macaroni-and-cheese');
    });
    it('round-trips nutrient keys', () => {
        const keys = ['vitamin_d_ug', 'pantothenic_acid_mg', 'protein_g', 'dha_g'];
        assert.equal(nutrientSlug('vitamin_d_ug'), 'vitamin-d');
        assert.equal(nutrientSlug('pantothenic_acid_mg'), 'pantothenic-acid');
        for (const k of keys) assert.equal(nutrientKeyFromSlug(nutrientSlug(k), keys), k);
        assert.equal(nutrientKeyFromSlug('VITAMIN-D', keys), 'vitamin_d_ug');
        assert.equal(nutrientKeyFromSlug('nope', keys), null);
    });
});
