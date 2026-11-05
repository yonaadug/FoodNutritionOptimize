import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isFamiliarFood, rankBestSources, sourceTier } from './best-sources';
import { friendlyServingLabel, typicalServing } from './servings';
import { openDatabase, getBestSourcesIn } from './db';
import { makeFood } from './testing/fixtures';
import type { Food, ServingSize } from './food-types';

let nextServing = 1;
const serving = (food_id: number, label: string, weight_g: number): ServingSize => ({ id: nextServing++, food_id, label, weight_g });

/** A food with every FDA DV nutrient measured (good coverage) unless overridden. */
function food(id: number, description: string, extra: Partial<Food> = {}, servings: [string, number][] = []): Food {
    const f = makeFood({ id, description, calories: 100, protein_g: 5, total_fat_g: 1, carbohydrate_g: 10, ...extra });
    f.serving_sizes = servings.map(([l, g]) => serving(id, l, g));
    return f;
}

describe('sourceTier: everyday foods vs specialty items', () => {
    const cases: [string, string | null, 0 | 1 | 2][] = [
        ['Fish oil, cod liver', 'Fats and Oils', 2],
        ['Veal, variety meats and by-products, liver, raw', 'Lamb, Veal, and Game Products', 2],
        ['Desserts, rennin, tablets, unsweetened', 'Sweets', 2],
        ['Whey, acid, dried', 'Dairy and Egg Products', 2],
        ['Rose Hips, wild (Northern Plains Indians)', 'American Indian/Alaska Native Foods', 2],
        ['Babyfood, cereal, rice, dry', 'Baby Foods', 2],
        ['Beverages, Protein powder whey based', 'Beverages', 2],
        ['Spices, paprika', 'Spices and Herbs', 2],
        ['Cereals ready-to-eat, RALSTON Enriched Wheat Bran flakes', 'Breakfast Cereals', 1],
        ['Peanut butter, smooth, vitamin and mineral fortified', 'Legumes and Legume Products', 1],
        ['Lentils, mature seeds, raw', 'Legumes and Legume Products', 1],
        ['Mothbeans, mature seeds, cooked, boiled', 'Legumes and Legume Products', 1],
        ['Lentils, mature seeds, cooked, boiled, without salt', 'Legumes and Legume Products', 0],
        ['Beans, kidney, red, mature seeds, cooked, boiled', 'Legumes and Legume Products', 0],
        ['Fish, salmon, sockeye, cooked, dry heat', 'Finfish and Shellfish Products', 0],
        ['Mushrooms, portabella, exposed to ultraviolet light, raw', 'Vegetables and Vegetable Products', 0],
        ['Apricots, dried, sulfured, uncooked', 'Fruits and Fruit Juices', 0],
    ];
    for (const [description, category, tier] of cases) {
        it(`${description} -> tier ${tier}`, () => {
            const f = food(1, description, { food_category: category });
            assert.equal(sourceTier(f).tier, tier, sourceTier(f).reason ?? 'everyday');
        });
    }

    it('foods with sparse USDA data are not "everyday" suggestions', () => {
        const sparse = food(2, 'Spinach, raw', { vitamin_d_ug: null, vitamin_e_mg: null, vitamin_k_ug: null, folate_ug: null, selenium_ug: null, zinc_mg: null, copper_mg: null, manganese_mg: null, niacin_mg: null, thiamin_mg: null, riboflavin_mg: null, vitamin_b6_mg: null, vitamin_b12_ug: null });
        assert.equal(sourceTier(sparse).tier, 1, 'sparse');
    });

    it('recognises common foods by name, not by a generic word', () => {
        assert.equal(isFamiliarFood('Fish, salmon, Atlantic, raw'), true);
        assert.equal(isFamiliarFood('Hyacinth beans, mature seeds, cooked'), false);
        assert.equal(isFamiliarFood('Acerola juice, raw'), false);
        assert.equal(isFamiliarFood('Seeds, sunflower seed kernels, dry roasted'), true);
    });
});

describe('rankBestSources', () => {
    const oil = food(10, 'Fish oil, cod liver', { food_category: 'Fats and Oils', calories: 900, vitamin_d_ug: 250 }, [['1 tbsp', 13.6]]);
    const salmon = food(11, 'Fish, salmon, sockeye, cooked, dry heat', { food_category: 'Finfish and Shellfish Products', vitamin_d_ug: 16.7 }, [['3 oz', 85], ['1 fillet', 155]]);
    const salmon2 = food(12, 'Fish, salmon, pink, canned', { food_category: 'Finfish and Shellfish Products', vitamin_d_ug: 14 }, [['3 oz', 85]]);
    const milk = food(13, 'Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D', { food_category: 'Dairy and Egg Products', vitamin_d_ug: 1.1 }, [['1 cup', 244]]);
    const mushrooms = food(14, 'Mushrooms, white, exposed to ultraviolet light, raw', { food_category: 'Vegetables and Vegetable Products', vitamin_d_ug: 7 }, [['1 cup', 70]]);

    it('ranks by a realistic serving and keeps specialty items last', () => {
        const ranked = rankBestSources([oil, salmon, milk, mushrooms], 'vitamin_d_ug', { limit: 4 });
        assert.deepEqual(ranked.map(r => r.food.id), [salmon.id, mushrooms.id, milk.id, oil.id]);
        assert.equal(ranked[0].servingLabel, '3 oz');
        assert.ok(Math.abs(ranked[0].perServing - 16.7 * 0.85) < 1e-9);
    });

    it('shows one entry per food (no list of five salmon variants)', () => {
        const ranked = rankBestSources([salmon, salmon2, milk], 'vitamin_d_ug', { limit: 3 });
        assert.deepEqual(ranked.map(r => r.food.id), [salmon.id, milk.id]);
    });

    it('leaves out foods already chosen and still returns something when only specialty items remain', () => {
        const ranked = rankBestSources([oil, salmon], 'vitamin_d_ug', { limit: 3, exclude: [salmon.id] });
        assert.deepEqual(ranked.map(r => r.food.id), [oil.id], 'a specialty item beats an empty card');
    });

    it('everyday: false ranks every food purely by serving', () => {
        const ranked = rankBestSources([oil, salmon, mushrooms], 'vitamin_d_ug', { limit: 3, everyday: false });
        assert.equal(ranked[0].food.id, oil.id);
    });
});

describe('servings', () => {
    it('uses 3 oz for meat and fish, 1 oz for nuts, and never a whole bird', () => {
        assert.deepEqual(typicalServing([serving(1, '1 piece', 174), serving(1, '3 oz', 85)], { food_category: 'Poultry Products' }), { label: '3 oz', grams: 85 });
        assert.deepEqual(typicalServing([serving(1, '1 cup, whole', 135), serving(1, '1 oz (22 whole kernels)', 28.35)], { description: 'Nuts, almonds' }).grams, 28.35);
        assert.deepEqual(typicalServing([serving(1, '0.5 goose', 1200)], { food_category: 'Vegetables' }), { label: '100 g', grams: 100 });
    });

    it('turns USDA jargon into plain words', () => {
        assert.equal(friendlyServingLabel('1 RACC'), '1 standard serving');
        assert.equal(friendlyServingLabel('1 cup, pieces of ~1"'), '1 cup, bite-size pieces');
        assert.equal(friendlyServingLabel('Quantity not specified (typical portion)'), '1 typical portion');
    });
});

// The real USDA database (Git LFS). Skipped when it is not checked out.
const DB_PATH = path.join(import.meta.dirname, '..', 'nutrition.db');
const hasDb = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 1_000_000;

describe('good sources on the real database', { skip: !hasDb && 'nutrition.db not available' }, () => {
    const conn = hasDb ? openDatabase(DB_PATH) : null;
    const OBSCURE = /(cod liver|liver|variety meats|rennin|whey|rose hips|northern plains|ralston|fortified|tablet|powder|babyfood|alaska native)/i;

    for (const nutrient of ['vitamin_d_ug', 'vitamin_a_ug', 'vitamin_c_mg', 'vitamin_e_mg', 'calcium_mg', 'iron_mg', 'potassium_mg', 'fiber_g', 'vitamin_b12_ug', 'zinc_mg']) {
        it(`suggests everyday foods for ${nutrient} (regression: cod liver oil, veal liver, rennin tablets, dried whey...)`, () => {
            const top = getBestSourcesIn(conn!, nutrient, { limit: 3 });
            assert.equal(top.length, 3);
            for (const f of top) {
                assert.doesNotMatch(f.description, OBSCURE, `${nutrient}: ${f.description}`);
                assert.equal(f.best.everyday, true, `${nutrient}: ${f.description}`);
            }
        });
    }

    it('always returns suggestions, even when the best sources are already chosen', () => {
        const first = getBestSourcesIn(conn!, 'vitamin_d_ug', { limit: 50 }).map(f => f.id);
        const next = getBestSourcesIn(conn!, 'vitamin_d_ug', { limit: 3, exclude: first });
        assert.equal(next.length, 3);
    });
});
