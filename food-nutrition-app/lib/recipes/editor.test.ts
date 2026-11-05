import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    blankEditor, clampServings, editorFromParse, editorFromRecord, loadRecents, MAX_RECENTS, platedRange, RECENTS_KEY,
    removeRecent, rowFlags, rowsNutrition, saveRecent, setRowAmount, setRowFood, toRecord,
} from './editor';
import { convertToGrams } from './grams';
import { makeFood } from '../testing/fixtures';
import type { AnalyzedIngredient, AnalyzedRecipe, ParseResponse, RecipeFood } from './types';

const rice: RecipeFood = {
    ...makeFood({ id: 1, description: 'Rice, white, cooked', calories: 130, protein_g: 2.7 }),
    portions: [{ label: '1 cup', grams: 158, source: 'food' }],
};
const oil: RecipeFood = {
    ...makeFood({ id: 2, description: 'Oil, olive', calories: 884, total_fat_g: 100 }),
    portions: [{ label: '1 tbsp', grams: 13.5, source: 'food' }],
};

function row(o: Partial<AnalyzedIngredient> = {}): AnalyzedIngredient {
    const base = { id: 'r1', name: 'rice', quantity: 1, unit: 'cup', preparation: 'cooked', notes: null, confidence: 0.5, original: null, food: rice, matchConfidence: 0.5, candidates: [], ...o };
    return { conversion: convertToGrams(base, base.food), ...base };
}

const storage = () => {
    const map = new Map<string, string>();
    return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
};

describe('row edits', () => {
    it('editing the amount re-converts and clears the check flag', () => {
        const r = setRowAmount(row(), 2, 'cup');
        assert.equal(r.conversion.grams, 316);
        assert.equal(rowFlags(r).checkAmount, false);
    });
    it('changing the unit converts with the new unit', () => {
        assert.equal(setRowAmount(row(), 100, 'g').conversion.grams, 100);
        assert.equal(setRowAmount(row(), 100, 'g').conversion.method, 'exact');
    });
    it('clearing the amount stops the row being counted', () => {
        const r = setRowAmount(row(), null, 'cup');
        assert.equal(r.conversion.grams, null);
        assert.equal(rowFlags(r).uncounted, true);
    });
    it('changing the food keeps the amount and converts with the new food', () => {
        const r = setRowFood(row({ quantity: 1, unit: 'tbsp' }), oil);
        assert.equal(r.food?.description, 'Oil, olive');
        assert.equal(r.conversion.grams, 13.5);
        assert.deepEqual([r.quantity, r.unit], [1, 'tbsp']);
        assert.equal(rowFlags(r).checkMatch, false);
    });
    it('does not change the original row', () => {
        const r = row();
        setRowAmount(r, 5, 'g');
        assert.equal(r.quantity, 1);
    });
});

describe('rowFlags', () => {
    it('flags low confidence, estimates and uncounted rows', () => {
        assert.deepEqual(rowFlags(row({ confidence: 0.5, matchConfidence: 0.5 })), { checkAmount: true, checkMatch: true, estimated: false, uncounted: false });
        assert.equal(rowFlags(row({ confidence: 0.9, matchConfidence: 0.9 })).checkAmount, false);
        assert.equal(rowFlags(row({ food: null })).uncounted, true);
        assert.equal(rowFlags(row({ food: null })).checkMatch, false);
        assert.equal(rowFlags(row({ quantity: 1, unit: 'cup', food: { ...rice, portions: [] } })).estimated, true);
    });
});

describe('totals follow the rows', () => {
    it('updates when a row is removed or servings change', () => {
        const rows = [row(), row({ id: 'r2', name: 'oil', quantity: 1, unit: 'tbsp', food: oil })];
        const both = rowsNutrition(rows, 2).perServing.calories.value!;
        const one = rowsNutrition(rows.slice(0, 1), 2).perServing.calories.value!;
        assert.ok(both > one);
        assert.equal(one, (130 * 1.58) / 2);
        assert.equal(rowsNutrition(rows.slice(0, 1), 1).perServing.calories.value, 130 * 1.58);
    });
});

describe('clampServings', () => {
    it('accepts sensible values only', () => {
        assert.equal(clampServings(4), 4);
        assert.equal(clampServings(0.5), 0.5);
        assert.equal(clampServings(1000), 200);
        for (const v of [0, -1, NaN, undefined]) assert.equal(clampServings(v), null);
    });
});

describe('records', () => {
    const state = { ...blankEditor('id-1', '2026-11-04T00:00:00Z'), title: ' Rice ', rows: [row(), row({ id: 'r2', name: 'mystery', food: null })] };
    const rec = toRecord(state, rowsNutrition(state.rows, state.servings), '2026-11-04T01:00:00Z');

    it('is plain JSON with a title', () => {
        assert.deepEqual(JSON.parse(JSON.stringify(rec)), rec);
        assert.equal(rec.title, 'Rice');
        assert.equal(rec.version, 1);
        assert.equal(rec.updatedAt, '2026-11-04T01:00:00Z');
        assert.equal(rec.ingredients[0].fdcId, rice.fdc_id);
        assert.equal(rec.ingredients[1].fdcId, null);
        assert.equal(rec.perServing.calories, Math.round(((130 * 1.58) / 4) * 1000) / 1000);
    });
    it('does not carry the full food data', () => {
        assert.ok(JSON.stringify(rec).length < 3000);
        assert.ok(!('food' in rec.ingredients[0]));
    });
    it('falls back to a default title', () => {
        assert.equal(toRecord({ ...state, title: '  ' }, rowsNutrition([], 1), 'x').title, 'Untitled recipe');
    });
    it('round-trips into an editor with the same totals', () => {
        const back = editorFromRecord(rec, new Map([[rice.fdc_id, rice]]));
        assert.equal(back.rows.length, 2);
        assert.equal(back.rows[0].food?.fdc_id, rice.fdc_id);
        assert.equal(back.rows[1].food, null);
        assert.equal(rowsNutrition(back.rows, back.servings).perServing.calories.value, rowsNutrition(state.rows, state.servings).perServing.calories.value);
    });
    it('survives a food that no longer exists', () => {
        const back = editorFromRecord(rec, new Map());
        assert.equal(back.rows[0].food, null);
        assert.equal(rowFlags(back.rows[0]).uncounted, true);
    });
    it('builds from a parse response', () => {
        const parse: ParseResponse = { title: 'T', servings: 3, servingsStated: true, source: 'image', platedMeal: true, ingredients: [row()], warnings: ['w'], provider: 'mock', model: null };
        const e = editorFromParse(parse, 'id', 'now');
        assert.deepEqual([e.title, e.servings, e.source, e.platedMeal, e.provider, e.rows.length], ['T', 3, 'image', true, 'mock', 1]);
    });
});

describe('recents', () => {
    const rec = (id: string): AnalyzedRecipe => ({ version: 1, id, title: id, servings: 1, source: 'text', createdAt: 'x', updatedAt: 'x', ingredients: [], perServing: {}, incomplete: [], servingGrams: 0, provider: null });

    it('inserts newest first and updates by id', () => {
        const s = storage();
        saveRecent(s, rec('a'));
        saveRecent(s, rec('b'));
        saveRecent(s, { ...rec('a'), title: 'renamed' });
        assert.deepEqual(loadRecents(s).map(r => r.title), ['renamed', 'b']);
    });
    it('caps the list', () => {
        const s = storage();
        for (let i = 0; i < MAX_RECENTS + 5; i++) saveRecent(s, rec(`r${i}`));
        assert.equal(loadRecents(s).length, MAX_RECENTS);
        assert.equal(loadRecents(s)[0].id, `r${MAX_RECENTS + 4}`);
    });
    it('removes by id', () => {
        const s = storage();
        saveRecent(s, rec('a'));
        assert.deepEqual(removeRecent(s, 'a'), []);
    });
    it('ignores corrupt data, blocked storage and foreign shapes', () => {
        const s = storage();
        s.map.set(RECENTS_KEY, '{not json');
        assert.deepEqual(loadRecents(s), []);
        s.map.set(RECENTS_KEY, JSON.stringify([{ id: 'x' }, rec('good'), null]));
        assert.deepEqual(loadRecents(s).map(r => r.id), ['good']);
        assert.deepEqual(loadRecents(null), []);
        const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
        assert.deepEqual(loadRecents(throwing), []);
        assert.equal(saveRecent(throwing, rec('a')).length, 1);
        assert.deepEqual(removeRecent(throwing, 'a'), []);
    });
});

describe('platedRange', () => {
    it('gives the published error band', () => {
        const r = platedRange(100);
        assert.ok(Math.abs(r.low - 65) < 1e-9);
        assert.ok(Math.abs(r.high - 135) < 1e-9);
    });
});
