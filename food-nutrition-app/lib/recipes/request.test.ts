import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../db';
import { createMockProvider } from '../ai/mock';
import { analyzeRecipeIn } from './analyze';
import { computeRecipeNutrition } from './nutrition';
import { MAX_TEXT_CHARS, nutritionFor, parseNutritionBody, parseTextBody, RequestError } from './request';

const DB_PATH = path.join(import.meta.dirname, '..', '..', 'nutrition.db');
const hasDb = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 1_000_000;

const status = (status: number) => (e: RequestError) => e.status === status;

describe('parseTextBody', () => {
    it('returns trimmed text', () => assert.equal(parseTextBody({ text: '  1 egg \n' }), '1 egg'));
    it('rejects wrong shapes', () => {
        for (const b of [null, [], 'x', 5, {}, { text: 5 }, { text: null }]) assert.throws(() => parseTextBody(b), status(400));
    });
    it('rejects blank text', () => assert.throws(() => parseTextBody({ text: '   ' }), status(400)));
    it('rejects text over the limit', () => {
        assert.throws(() => parseTextBody({ text: 'a'.repeat(MAX_TEXT_CHARS + 1) }), status(413));
        assert.equal(parseTextBody({ text: 'a'.repeat(MAX_TEXT_CHARS) }).length, MAX_TEXT_CHARS);
    });
});

describe('parseNutritionBody', () => {
    const ok = { ingredients: [{ fdcId: 1, grams: 10 }], servings: 2 };
    it('accepts a valid body and an empty list', () => {
        assert.deepEqual(parseNutritionBody(ok), ok);
        assert.deepEqual(parseNutritionBody({ ingredients: [], servings: 1 }).ingredients, []);
    });
    it('rejects bad servings', () => {
        for (const servings of [0, -1, 1000, '2', null, undefined, NaN, Infinity]) {
            assert.throws(() => parseNutritionBody({ ...ok, servings }), status(400), String(servings));
        }
    });
    it('rejects bad ingredients', () => {
        const bad = [{ fdcId: 1.5, grams: 1 }, { fdcId: 0, grams: 1 }, { fdcId: -3, grams: 1 }, { fdcId: '1', grams: 1 }, { fdcId: 1, grams: -1 }, { fdcId: 1, grams: 1e9 }, { fdcId: 1, grams: '5' }, { fdcId: 1 }, null, 7];
        for (const row of bad) {
            assert.throws(() => parseNutritionBody({ ingredients: [row], servings: 1 }), status(400), JSON.stringify(row));
        }
    });
    it('rejects wrong shapes and too many rows', () => {
        for (const b of [null, [], 'x', {}, { ingredients: {}, servings: 1 }]) assert.throws(() => parseNutritionBody(b), status(400));
        assert.throws(() => parseNutritionBody({ ingredients: Array(201).fill({ fdcId: 1, grams: 1 }), servings: 1 }), status(400));
    });
});

describe('with the real database', { skip: !hasDb && 'nutrition.db not available' }, () => {
    const conn = hasDb ? openDatabase(DB_PATH) : null!;

    it('computes per-serving nutrition from fdc ids', () => {
        const egg = 748967;
        const n = nutritionFor(conn, { ingredients: [{ fdcId: egg, grams: 100 }, { fdcId: egg, grams: 100 }], servings: 2 });
        assert.equal(n.totalGrams, 200);
        assert.equal(n.servingGrams, 100);
        assert.ok(n.perServing.calories.value! > 120 && n.perServing.calories.value! < 160, String(n.perServing.calories.value));
        assert.deepEqual(n.uncounted, []);
    });
    it('is deterministic', () => {
        const req = { ingredients: [{ fdcId: 748967, grams: 73.3 }], servings: 3 };
        assert.deepEqual(nutritionFor(conn, req), nutritionFor(conn, req));
    });
    it('rejects unknown foods and names them', () => {
        assert.throws(
            () => nutritionFor(conn, { ingredients: [{ fdcId: 999_999_999, grams: 1 }], servings: 1 }),
            (e: RequestError) => e.status === 400 && (e.details as { unknownFdcIds: number[] }).unknownFdcIds[0] === 999_999_999,
        );
    });
    it('handles an empty recipe', () => {
        assert.equal(nutritionFor(conn, { ingredients: [], servings: 1 }).perServing.calories.value, null);
    });

    it('text -> mock -> analysis gives editable rows and sane totals', async () => {
        const { recipe } = await createMockProvider().readRecipe({ kind: 'text', text: 'Omelet\nServes 2\n3 eggs\n1 tbsp butter\n1 oz cheddar cheese\nSalt to taste' });
        const r = await analyzeRecipeIn(conn, recipe, 'text', { provider: 'mock', model: null });
        assert.equal(r.title, 'Omelet');
        assert.deepEqual([r.servings, r.servingsStated, r.source, r.platedMeal], [2, true, 'text', false]);
        assert.equal(r.ingredients.length, 4);
        assert.deepEqual(r.ingredients.map(i => i.conversion.method), ['exact', 'exact', 'exact', 'unknown']);
        assert.equal(new Set(r.ingredients.map(i => i.id)).size, 4);
        const n = computeRecipeNutrition(r.ingredients.map(i => ({ name: i.name, food: i.food, grams: i.conversion.grams })), r.servings);
        assert.ok(n.perServing.calories.value! > 200 && n.perServing.calories.value! < 350, String(n.perServing.calories.value));
        assert.deepEqual(n.uncounted, ['Salt']);
        assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'the response must be plain JSON');
    });
    it('defaults servings when the recipe does not state them', async () => {
        const r = await analyzeRecipeIn(conn, { title: '', servings: null, ingredients: [] }, 'text', { provider: 'mock', model: null });
        assert.deepEqual([r.servings, r.servingsStated, r.title], [4, false, 'Untitled recipe']);
        const p = await analyzeRecipeIn(conn, { title: '', servings: null, ingredients: [] }, 'image', { provider: 'mock', model: null });
        assert.equal(p.title, 'Recipe from photo');
    });
    it('image -> mock fixture is flagged as a plated meal, with low confidence', async () => {
        const { recipe } = await createMockProvider().readRecipe({ kind: 'image', base64: 'abc', mediaType: 'image/jpeg' });
        const r = await analyzeRecipeIn(conn, recipe, 'image', { provider: 'mock', model: null });
        assert.equal(r.platedMeal, true);
        assert.ok(r.ingredients.every(i => i.confidence <= 0.6));
        assert.ok(r.ingredients.every(i => i.food !== null && i.conversion.grams !== null));
    });
});
