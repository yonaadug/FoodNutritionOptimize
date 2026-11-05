import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET as foodRoute } from '@/app/api/food/route';
import { GET as searchRoute } from '@/app/api/search/route';
import { GET as topRoute } from '@/app/api/foods/top/route';
import { POST as optimizeRoute } from '@/app/api/optimize/route';
import { GET as recipeFoodRoute } from '@/app/api/recipes/food/route';
import { POST as recipeNutritionRoute } from '@/app/api/recipes/nutrition/route';
import { getBestSources, getDb, getFoodByFdcId, getFoodsInCategory, getTopHits } from './db';
import type { Food } from './food-types';
import { hasCoreData } from '@/components/planner/nutrients';
import { dataCoverage } from './best-sources';
import { NUTRIENT_COLUMNS } from './testing/fixtures';

const DB_PATH = path.join(import.meta.dirname, '..', 'nutrition.db');
const hasDb = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 1_000_000;

const SPINACH = 1999633;
const OLDER_SPINACH = 168462;
const NUTRIENTS = [...NUTRIENT_COLUMNS, 'choline_mg', 'ala_g', 'epa_g', 'dha_g'];

const site = (p: string) => `http://localhost${p}`;
const get = (p: string) => new NextRequest(site(p));
const post = (p: string, body: unknown) => new Request(site(p), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

function values(food: Food): Record<string, unknown> {
    const rec = food as unknown as Record<string, unknown>;
    return Object.fromEntries(NUTRIENTS.map(k => [k, rec[k] ?? null]));
}

const NO_GOALS = Object.fromEntries(NUTRIENTS.map(k => [k, { min: '', max: '' }]));

/** The same food through every server path. Each entry is what that feature would show per 100 g. */
async function everyPath(fdcId: number, description: string): Promise<Record<string, Food>> {
    const page = (await getFoodByFdcId(fdcId))!;
    const byIds = (await (await foodRoute(get(`/api/food?ids=${page.id}`))).json()) as { foods: Food[] };
    const search = (await (await searchRoute(get(`/api/search?q=${encodeURIComponent(description)}&limit=100`))).json()) as { foods: Food[] };
    const recipe = (await (await recipeFoodRoute(get(`/api/recipes/food?fdcId=${fdcId}`))).json()) as { food: Food };
    const optimize = (await (await optimizeRoute(post('/api/optimize', {
        foods: [{ id: page.id, fdc_id: fdcId }],
        customConstraints: { ...NO_GOALS, protein_g: { min: 1, max: '' } },
        portionCap: {},
    }))).json()) as { diet?: { food: Food }[] };
    return {
        'food page': page,
        '/api/food': byIds.foods[0],
        '/api/search': search.foods.find(f => f.fdc_id === fdcId)!,
        '/api/recipes/food': recipe.food,
        '/api/optimize': optimize.diet![0].food,
    };
}

describe('one food has one set of values everywhere', { skip: !hasDb && 'nutrition.db not available' }, () => {
    it('spinach: identical through the food page, /api/food, /api/search, /api/optimize and recipes', async () => {
        const paths = await everyPath(SPINACH, 'Spinach, mature');
        const expected = values(paths['food page']);
        for (const [name, food] of Object.entries(paths)) {
            assert.ok(food, `${name} found the food`);
            assert.deepEqual(values(food), expected, name);
            assert.deepEqual(food.filledFrom, paths['food page'].filledFrom, `${name} keeps the provenance`);
        }
        assert.equal(expected.vitamin_k_ug, 482.9, 'the gap is filled from the older USDA entry');
    });

    it('a recipe of 100 g, one serving, totals to exactly the food page values', async () => {
        const page = (await getFoodByFdcId(SPINACH))!;
        const res = await recipeNutritionRoute(post('/api/recipes/nutrition', { ingredients: [{ fdcId: SPINACH, grams: 100 }], servings: 1 }));
        const { perServing } = (await res.json()) as { perServing: Record<string, { value: number | null; incomplete: boolean }> };
        const rounded = (v: unknown) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : null);
        for (const key of NUTRIENTS) {
            assert.equal(perServing[key].value, rounded((page as unknown as Record<string, unknown>)[key]), key);
        }
        assert.equal(perServing.vitamin_k_ug.incomplete, false);
    });

    it('keeps every measured Foundation value and only fills NULLs, recording where each came from', async () => {
        const raw = getDb().prepare('SELECT * FROM foods WHERE fdc_id = ?').get(SPINACH) as Record<string, number | null>;
        const older = getDb().prepare('SELECT * FROM foods WHERE fdc_id = ?').get(OLDER_SPINACH) as Record<string, number | null>;
        const food = (await getFoodByFdcId(SPINACH))!;
        const page = food as unknown as Record<string, number | null>;
        const filled = food.filledFrom!;
        assert.equal(raw.vitamin_k_ug, null, 'precondition: nutrition.db has no value');
        for (const key of NUTRIENTS) {
            if (raw[key] !== null) {
                assert.equal(page[key], raw[key], `${key} is measured, so it stays`);
                assert.equal(filled[key], undefined, key);
            } else if (older[key] !== null) {
                assert.equal(page[key], older[key], `${key} is filled`);
                assert.equal(filled[key], OLDER_SPINACH, key);
            } else {
                assert.equal(page[key], null, `${key} has no value anywhere`);
            }
        }
    });

    it('the older entry itself is left as USDA published it', async () => {
        const older = (await getFoodByFdcId(OLDER_SPINACH))!;
        assert.equal(older.filledFrom, undefined);
        assert.equal(older.superseded_by_fdc_id, SPINACH);
    });

    it('the planner stops reporting a filled value as missing', async () => {
        const page = (await getFoodByFdcId(SPINACH))!;
        const res = await optimizeRoute(post('/api/optimize', {
            foods: [{ id: page.id, fdc_id: SPINACH }],
            customConstraints: { ...NO_GOALS, vitamin_k_ug: { min: 120, max: '' } },
            portionCap: {},
        }));
        const plan = (await res.json()) as { success: boolean; warnings: unknown[]; totalNutrients: Record<string, number> };
        assert.equal(plan.success, true, 'spinach can now meet a vitamin K goal');
        assert.ok(plan.totalNutrients.vitamin_k_ug >= 119.9);
        assert.deepEqual(plan.warnings, []);
    });

    it('ranking, top foods and listings see the filled values', async () => {
        const inTop = (await (await topRoute(get('/api/foods/top?nutrient=vitamin_k_ug&limit=100'))).json()) as { foods: Food[] };
        const spinachTop = inTop.foods.find(f => f.fdc_id === SPINACH);
        assert.ok(spinachTop, '/api/foods/top ranks it per 100 g');
        assert.equal(spinachTop.vitamin_k_ug, 482.9);
        assert.ok(!inTop.foods.some(f => f.fdc_id === OLDER_SPINACH), 'and not the older copy next to it');

        const best = await getBestSources('vitamin_k_ug', { limit: 100, everyday: false, perGroup: 50 });
        const ranked = best.find(f => f.fdc_id === SPINACH);
        assert.ok(ranked, 'best sources rank it');
        assert.equal(ranked.best.per100g, 482.9);

        const page = (await getFoodByFdcId(SPINACH))!;
        const listing = await getFoodsInCategory(page.food_category!, 1, 100);
        assert.equal(listing.foods.find(f => f.fdc_id === SPINACH)?.vitamin_k_ug, 482.9);

        const garlic = (await getTopHits(['garlic raw']))[0];
        assert.ok(garlic.iron_mg !== null && garlic.filledFrom?.iron_mg, 'home cards use filled foods too');
    });

    it('"Limited data" and data-coverage checks reflect the filled values', async () => {
        const raw = getDb().prepare('SELECT * FROM foods WHERE fdc_id = ?').get(SPINACH) as Food;
        const page = (await getFoodByFdcId(SPINACH))!;
        assert.ok(dataCoverage(page) > dataCoverage(raw), 'coverage counts filled nutrients');
        // Every food with an older entry: if that entry has usable data, the food isn't "Limited data".
        const targets = getDb().prepare('SELECT DISTINCT superseded_by_fdc_id AS id FROM foods WHERE superseded_by_fdc_id IS NOT NULL').all() as { id: number }[];
        assert.ok(targets.length > 100);
        for (const { id } of targets) {
            const food = (await getFoodByFdcId(id))!;
            const donor = getDb().prepare('SELECT * FROM foods WHERE superseded_by_fdc_id = ?').get(id) as Food;
            if (hasCoreData(donor)) assert.ok(hasCoreData(food), `${food.description} has core data once filled`);
        }
    });
});
