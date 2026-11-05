import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { historySummary } from '@/lib/auth/history-summary';
import { HISTORY_LIMITS, validateHistoryInput } from '@/lib/user-store/history';
import { recipeFromHistory, recipeHistoryItem, recipeHref } from './history';
import type { AnalyzedRecipe } from './types';

const recipe = (over: Partial<AnalyzedRecipe> = {}): AnalyzedRecipe => ({
    version: 1,
    id: '6f1c2a54-9f0b-4d7e-8a11-0d9a7c1b2e3f',
    title: 'Lentil soup',
    servings: 4,
    source: 'text',
    platedMeal: false,
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
    ingredients: [],
    perServing: { calories: 320.4, protein_g: 18.25, carbohydrate_g: 40, total_fat_g: 6, iron_mg: 3.1 },
    incomplete: [],
    servingGrams: 350,
    provider: null,
    ...over,
} as AnalyzedRecipe);

const ingredient = (over: Partial<AnalyzedRecipe['ingredients'][number]> = {}): AnalyzedRecipe['ingredients'][number] => ({
    name: 'lentils', quantity: 2, unit: 'cup', preparation: 'cooked', notes: null, confidence: 0.9,
    fdcId: 172421, foodDescription: 'Lentils, mature seeds, cooked', grams: 396, conversion: 'exact', ...over,
});

describe('recipeHistoryItem', () => {
    it('keeps the same id across edits and links to the analyzer', () => {
        const item = recipeHistoryItem(recipe());
        assert.equal(item.kind, 'recipe');
        assert.equal(item.itemId, recipe().id);
        assert.equal(item.title, 'Lentil soup');
        assert.equal(item.href, `/recipes?id=${recipe().id}`);
        assert.equal(recipeHref('abc'), '/recipes?id=abc');
    });

    it('shows per-serving calories and protein on the history row', () => {
        assert.deepEqual(historySummary(recipeHistoryItem(recipe()).data), [
            { label: 'Calories', value: '320 kcal per serving' },
            { label: 'Protein', value: '18.3 g per serving' },
            { label: 'Carbs', value: '40 g per serving' },
            { label: 'Fat', value: '6 g per serving' },
        ]);
    });

    it('leaves out nutrients with no data instead of showing 0', () => {
        const facts = historySummary(recipeHistoryItem(recipe({ perServing: { calories: 200, protein_g: null } })).data);
        assert.deepEqual(facts, [{ label: 'Calories', value: '200 kcal per serving' }]);
    });

    it('keeps a real zero', () => {
        const facts = historySummary(recipeHistoryItem(recipe({ perServing: { total_fat_g: 0 } })).data);
        assert.deepEqual(facts, [{ label: 'Fat', value: '0 g per serving' }]);
    });

    it('marks lower bounds, as the analyzer does', () => {
        const facts = historySummary(recipeHistoryItem(recipe({ incomplete: ['calories', 'iron_mg'] })).data);
        assert.equal(facts[0].value, '≥ 320 kcal per serving');
        assert.equal(facts[1].value, '18.3 g per serving');
    });

    it('says when the numbers are a rough estimate from a photo', () => {
        const facts = historySummary(recipeHistoryItem(recipe({ platedMeal: true })).data);
        assert.deepEqual(facts.at(-1), { label: 'Estimate', value: 'from a photo' });
        assert.equal(facts.length, 5, 'with every nutrient present, the estimate note still fits');
    });

    it('always passes the API validation, even with a very long title and many ingredients', () => {
        const ingredients = Array.from({ length: 500 }, () => ingredient({ name: 'x'.repeat(200) }));
        const item = recipeHistoryItem(recipe({ title: 'T'.repeat(5000), ingredients }));
        const valid = validateHistoryInput(item);
        assert.equal(valid.title.length, HISTORY_LIMITS.titleLength);
        assert.ok(Buffer.byteLength(JSON.stringify(valid.data)) <= HISTORY_LIMITS.dataBytes);
    });

    it('keeps enough to reopen the recipe on another device', () => {
        const original = recipe({ ingredients: [ingredient(), ingredient({ name: 'salt', quantity: null, unit: null, fdcId: null, foodDescription: null, grams: null, conversion: 'unknown', notes: 'to taste' })], platedMeal: true, source: 'image', provider: 'mock' });
        const item = validateHistoryInput(recipeHistoryItem(original));
        const reopened = recipeFromHistory({ ...item, data: item.data ?? null, createdAt: 'c', updatedAt: 'u' })!;
        assert.equal(reopened.id, original.id);
        assert.equal(reopened.title, 'Lentil soup');
        assert.equal(reopened.servings, 4);
        assert.equal(reopened.source, 'image');
        assert.equal(reopened.platedMeal, true);
        assert.equal(reopened.provider, 'mock');
        assert.deepEqual(reopened.ingredients.map(i => [i.name, i.quantity, i.unit, i.preparation, i.notes, i.confidence, i.fdcId]), [
            ['lentils', 2, 'cup', 'cooked', null, 0.9, 172421],
            ['salt', null, null, 'cooked', 'to taste', 0.9, null],
        ]);
    });

    it('with too many ingredients, drops the notes first and then the ingredient list, and says so', () => {
        const longNotes = Array.from({ length: 40 }, (_, i) => ingredient({ name: `item ${i}`, notes: 'n'.repeat(250) }));
        const trimmed = validateHistoryInput(recipeHistoryItem(recipe({ ingredients: longNotes })));
        const reopened = recipeFromHistory({ ...trimmed, data: trimmed.data ?? null, createdAt: 'c', updatedAt: 'u' })!;
        assert.equal(reopened.ingredients.length, 40, 'every ingredient still fits');
        assert.equal(reopened.ingredients[0].notes, null);

        const huge = Array.from({ length: 500 }, (_, i) => ingredient({ name: `ingredient number ${i}` }));
        const summary = validateHistoryInput(recipeHistoryItem(recipe({ ingredients: huge })));
        assert.equal(recipeFromHistory({ ...summary, data: summary.data ?? null, createdAt: 'c', updatedAt: 'u' }), null, 'never a partial recipe');
        assert.equal((summary.data as { tooLong?: boolean }).tooLong, true);
        assert.equal(historySummary(summary.data)[0].value, '320 kcal per serving', 'the summary row still works');
    });

    it('recipeFromHistory rejects anything malformed', () => {
        const base = { kind: 'recipe', itemId: 'r1', title: 'T', href: '/recipes', createdAt: 'c', updatedAt: 'u' };
        for (const data of [null, 'x', [], {}, { recipe: null }, { recipe: {} }, { recipe: { ingredients: 'x' } }, { recipe: { ingredients: [1] } }, { recipe: { ingredients: [{ n: 5 }] } }]) {
            assert.equal(recipeFromHistory({ ...base, data }), null, JSON.stringify(data));
        }
    });

    it('fits the fallback id the analyzer uses outside a secure context', () => {
        assert.equal(validateHistoryInput(recipeHistoryItem(recipe({ id: 'r-mhl2k3-a9f' }))).itemId, 'r-mhl2k3-a9f');
    });
});
