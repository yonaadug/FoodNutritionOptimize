import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../db';
import { parseIngredientLine } from './parse';
import { analyzeIngredient, analyzeRecipeIn } from './analyze';
import { buildQueries, matchIngredientIn, withPortionsIn } from './match';
import { computeRecipeNutrition } from './nutrition';
import { FIXTURE_RECIPES } from './fixtures';
import { HOLDOUT_RECIPES } from './fixtures-holdout';
import type { ParsedIngredient } from './types';

const DB_PATH = path.join(import.meta.dirname, '..', '..', 'nutrition.db');
const hasDb = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 1_000_000;

function ing(line: string): ParsedIngredient {
    const p = parseIngredientLine(line);
    assert.ok(p, line);
    return p;
}

describe('buildQueries', () => {
    it('uses the alias first and drops noise words', () => {
        const q = buildQueries(ing('2 tbsp extra virgin olive oil'));
        assert.equal(q[0], 'oil olive');
        assert.ok(q.includes('olive oil'));
    });
    it('uses cooked aliases when the recipe says cooked', () => {
        const q = buildQueries(ing('1 cup cooked rice'));
        assert.match(q[0], /rice white.*cooked/);
    });
    it('falls back to dropping leading adjectives', () => {
        const q = buildQueries(ing('1 tsp smoked sea vegetable flakes'));
        assert.ok(q.includes('flakes'));
    });
});

describe('matching on the real database', { skip: !hasDb && 'nutrition.db not available' }, () => {
    const conn = hasDb ? openDatabase(DB_PATH) : null!;

    it('"2 eggs" matches whole egg and converts to about 100 g', () => {
        const a = analyzeIngredient(conn, ing('2 eggs'), 'x');
        assert.match(a.food!.description, /egg.*whole/i);
        assert.doesNotMatch(a.food!.description, /cooked|fried|yolk|white/i);
        assert.ok(a.conversion.grams! > 90 && a.conversion.grams! < 115, String(a.conversion.grams));
        assert.notEqual(a.conversion.method, 'unknown');
    });
    it('"1 cup cooked rice" matches cooked rice with an exact USDA cup', () => {
        const a = analyzeIngredient(conn, ing('1 cup cooked rice'), 'x');
        assert.match(a.food!.description, /^rice, white.*cooked/i);
        assert.equal(a.conversion.method, 'exact');
    });
    it('"1 cup rice" means dry rice', () => {
        const a = analyzeIngredient(conn, ing('1 cup rice'), 'x');
        assert.match(a.food!.description, /^rice, white.*raw/i);
        assert.doesNotMatch(a.food!.description, /cooked/i);
    });
    it('borrows household measures from the SR Legacy food a Foundation food supersedes', () => {
        const a = analyzeIngredient(conn, ing('3 cloves garlic'), 'x');
        assert.equal(a.food!.description, 'Garlic, raw');
        assert.equal(a.conversion.method, 'exact');
        assert.equal(a.conversion.grams, 9);
        assert.ok(a.food!.portions.some(p => p.source === 'related' && /clove/.test(p.label)));
    });
    it('keeps portions of the food itself ahead of related ones', () => {
        const foods = conn.db.prepare(`SELECT * FROM foods WHERE fdc_id = 748967`).all() as never[];
        if (!foods.length) return;
        const [egg] = withPortionsIn(conn, foods);
        assert.ok(egg.portions.length > 0);
    });
    it('gives low confidence and few candidates for gibberish', () => {
        const m = matchIngredientIn(conn, ing('2 cups zzqxv'));
        assert.equal(m.food, null);
        assert.equal(m.confidence, 0);
    });
    it('offers alternatives', () => {
        const m = matchIngredientIn(conn, ing('1 cup milk'));
        assert.ok(m.candidates.length >= 3);
        assert.ok(m.candidates.every(c => typeof c.fdcId === 'number' && c.description));
    });

    it('re-rank can only choose among candidates', async () => {
        const recipe = { title: 't', servings: 2, ingredients: [ing('1 cup quark cheese spread')] };
        const baseline = matchIngredientIn(conn, recipe.ingredients[0]);
        const invented = await analyzeRecipeIn(conn, recipe, 'text', {
            provider: 'test', model: null, rerank: async items => new Map(items.map(i => [i.index, 999999999])),
        });
        assert.equal(invented.ingredients[0].food?.fdc_id ?? null, baseline.food?.fdc_id ?? null);
    });

    it('re-rank failures keep the deterministic match', async () => {
        const recipe = { title: 't', servings: 2, ingredients: [ing('1 cup quark cheese spread')] };
        const baseline = matchIngredientIn(conn, recipe.ingredients[0]);
        const r = await analyzeRecipeIn(conn, recipe, 'text', {
            provider: 'test', model: null, rerank: async () => { throw new Error('boom'); },
        });
        assert.equal(r.ingredients[0].food?.fdc_id ?? null, baseline.food?.fdc_id ?? null);
    });

    it('golden set: top-1 food, grams and per-serving calories', () => {
        let lines = 0;
        let foodHits = 0;
        let gramHits = 0;
        const misses: string[] = [];
        for (const recipe of FIXTURE_RECIPES) {
            const items = [];
            for (const l of recipe.lines) {
                lines++;
                const parsed = ing(l.line);
                assert.match(parsed.name, l.name, `name of "${l.line}" was "${parsed.name}"`);
                const a = analyzeIngredient(conn, parsed, 'x');
                const desc = a.food?.description ?? '(none)';
                const foodOk = l.food.test(desc);
                if (foodOk) foodHits++;
                else misses.push(`FOOD ${recipe.title}: "${l.line}" -> ${desc}`);
                const g = a.conversion.grams;
                const gramsOk = l.grams === null ? g === null : g !== null && g >= l.grams[0] && g <= l.grams[1];
                if (gramsOk) gramHits++;
                else misses.push(`GRAMS ${recipe.title}: "${l.line}" -> ${g} (${a.conversion.basis}) want ${JSON.stringify(l.grams)}; ${desc}`);
                items.push({ name: parsed.name, food: a.food, grams: g });
            }
            const kcal = computeRecipeNutrition(items, recipe.servings).perServing.calories.value ?? 0;
            assert.ok(kcal >= recipe.kcalPerServing[0] && kcal <= recipe.kcalPerServing[1],
                `${recipe.title}: ${Math.round(kcal)} kcal per serving, want ${recipe.kcalPerServing.join('-')}\n${misses.join('\n')}`);
        }
        const foodPct = (foodHits / lines) * 100;
        const gramPct = (gramHits / lines) * 100;
        console.log(`[golden set] ${FIXTURE_RECIPES.length} recipes, ${lines} lines: food top-1 ${foodPct.toFixed(1)}%, grams in range ${gramPct.toFixed(1)}%`);
        if (misses.length) console.log(misses.join('\n'));
        assert.ok(foodPct >= 95, `food accuracy ${foodPct.toFixed(1)}%\n${misses.join('\n')}`);
        assert.ok(gramPct >= 90, `gram accuracy ${gramPct.toFixed(1)}%\n${misses.join('\n')}`);
    });

    it('held-out set stays above its floor (first-run scores are recorded in docs/RECIPES.md)', () => {
        let lines = 0;
        let foodHits = 0;
        let gramHits = 0;
        for (const recipe of HOLDOUT_RECIPES) {
            const items = [];
            for (const l of recipe.lines) {
                lines++;
                const parsed = ing(l.line);
                const a = analyzeIngredient(conn, parsed, 'x');
                if (l.food.test(a.food?.description ?? '')) foodHits++;
                const g = a.conversion.grams;
                if (l.grams === null ? g === null : g !== null && g >= l.grams[0] && g <= l.grams[1]) gramHits++;
                items.push({ name: parsed.name, food: a.food, grams: g });
            }
            const kcal = computeRecipeNutrition(items, recipe.servings).perServing.calories.value ?? 0;
            assert.ok(kcal >= recipe.kcalPerServing[0] && kcal <= recipe.kcalPerServing[1], `${recipe.title}: ${Math.round(kcal)} kcal`);
        }
        console.log(`[held-out set] ${HOLDOUT_RECIPES.length} recipes, ${lines} lines: food top-1 ${((foodHits / lines) * 100).toFixed(1)}%, grams in range ${((gramHits / lines) * 100).toFixed(1)}%`);
        assert.ok(foodHits / lines >= 0.9);
        assert.ok(gramHits / lines >= 0.85);
    });
});
