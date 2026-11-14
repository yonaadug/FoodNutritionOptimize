import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    basisChoices, basisFromChoice, choiceOfBasis, compareServings, initialBasis, normalizeBasis, preparationHint, preparationState,
} from './compare-weights';
import { GRAMS_PER_OUNCE } from './serving-scale';
import { makeFood } from './testing/fixtures';
import type { Food, ServingSize } from './food-types';

const THREE_OZ = 3 * GRAMS_PER_OUNCE;
const row = (id: number, food_id: number, label: string, weight_g: number): ServingSize => ({ id, food_id, label, weight_g });

const salmon: Food = makeFood({ id: 1, description: 'Fish, salmon, Atlantic, farm raised, raw', food_category: 'Finfish and Shellfish Products',
    calories: 203, serving_sizes: [row(1, 1, '1 RACC', 115)] });
const lingcod: Food = makeFood({ id: 2, description: 'Fish, lingcod, meat, raw (Alaska Native)', food_category: 'American Indian/Alaska Native Foods',
    calories: 79, serving_sizes: [row(2, 2, '100 g', 100)] });
const broccoli: Food = makeFood({ id: 3, description: 'Broccoli, raw', food_category: 'Vegetables and Vegetable Products',
    calories: 34, serving_sizes: [row(3, 3, '1 cup, chopped', 91), row(4, 3, '1 stalk', 151)] });
const foods = [salmon, lingcod, broccoli];

describe('compareServings: one weight for every food', () => {
    it('gives identical grams for every food at each standard weight', () => {
        for (const [id, grams] of [['w-1oz', GRAMS_PER_OUNCE], ['w-3oz', THREE_OZ], ['w-100g', 100]] as const) {
            const r = compareServings(foods, { kind: 'standard', id }, {});
            assert.deepEqual(r.servings.map(s => s.grams), [grams, grams, grams], id);
            assert.equal(r.sameWeight, true);
            assert.ok(r.servings.every(s => s.followsBasis));
        }
    });
    it('labels each food’s serving with its grams', () => {
        const r = compareServings(foods, { kind: 'standard', id: 'w-3oz' }, {});
        assert.deepEqual(r.servings.map(s => s.label), ['3 oz (85.05 g)', '3 oz (85.05 g)', '3 oz (85.05 g)']);
        assert.equal(r.basisLabel, '3 oz (85.05 g)');
    });
    it('puts every food at a custom amount in grams or ounces', () => {
        const oz = compareServings(foods, { kind: 'custom', text: '5', unit: 'oz' }, {});
        assert.deepEqual(oz.servings.map(s => s.grams), [5 * GRAMS_PER_OUNCE, 5 * GRAMS_PER_OUNCE, 5 * GRAMS_PER_OUNCE]);
        assert.equal(oz.basisLabel, '5 oz (141.75 g)');
        assert.equal(oz.error, null);
        const g = compareServings(foods, { kind: 'custom', text: '250', unit: 'g' }, {});
        assert.deepEqual(g.servings.map(s => s.grams), [250, 250, 250]);
        assert.equal(g.basisLabel, '250 g');
    });
    it('falls back to 100 g for all, with a message, when the custom amount is out of range', () => {
        for (const text of ['0', '-3', '', 'x', '6000']) {
            const r = compareServings(foods, { kind: 'custom', text, unit: 'g' }, {});
            assert.deepEqual(r.servings.map(s => s.grams), [100, 100, 100], text);
            assert.equal(r.sameWeight, true);
            assert.match(r.error ?? '', /1 to 5,000 g/);
        }
    });
    it('matches one food’s serving: the page’s serving for the page’s food', () => {
        const anchor = { foodId: broccoli.id, grams: 151, label: '1 stalk (151 g)' };
        const r = compareServings(foods, { kind: 'food', foodId: broccoli.id }, {}, anchor);
        assert.deepEqual(r.servings.map(s => s.grams), [151, 151, 151]);
        assert.deepEqual(r.servings.map(s => s.label), ['151 g', '151 g', '1 stalk (151 g)']);
        // Without an anchor it is that food's usual serving.
        const usual = compareServings(foods, { kind: 'food', foodId: broccoli.id }, {});
        assert.deepEqual(usual.servings.map(s => s.grams), [91, 91, 91]);
    });
});

describe('compareServings: overrides and mixed weights', () => {
    it('lets one label override the shared weight, and says the weights differ', () => {
        const r = compareServings(foods, { kind: 'standard', id: 'w-3oz' }, { [lingcod.id]: { kind: 'option', id: 'w-100g' } });
        assert.deepEqual(r.servings.map(s => s.grams), [THREE_OZ, 100, THREE_OZ]);
        assert.equal(r.sameWeight, false);
        assert.deepEqual(r.servings.map(s => s.followsBasis), [true, false, true]);
    });
    it('still counts as the same weight when an override picks the same grams', () => {
        const r = compareServings(foods, { kind: 'standard', id: 'w-3oz' }, { [lingcod.id]: { kind: 'option', id: 'w-3oz' } });
        assert.equal(r.sameWeight, true);
    });
    it('reads a custom override in ounces exactly, and ignores an unknown option', () => {
        const r = compareServings(foods, { kind: 'standard', id: 'w-100g' }, {
            [salmon.id]: { kind: 'custom', text: '3', unit: 'oz' },
            [broccoli.id]: { kind: 'option', id: 'nope' },
        });
        assert.equal(r.servings[0].grams, THREE_OZ);
        assert.equal(r.servings[2].grams, 100, 'unknown option falls back to the shared weight');
    });
    it('shows each food at its usual serving on request, which is not the same weight', () => {
        const r = compareServings(foods, { kind: 'usual' }, {});
        assert.deepEqual(r.servings.map(s => s.grams), [THREE_OZ, 100, 91]);
        assert.equal(r.sameWeight, false);
        assert.equal(r.basisLabel, null);
    });
    it('is the same weight with one food', () => {
        assert.equal(compareServings([broccoli], { kind: 'usual' }, {}).sameWeight, true);
        assert.equal(compareServings([], { kind: 'usual' }, {}).sameWeight, true);
    });
});

describe('the "Compare at" menu', () => {
    it('offers 1 oz, 3 oz, 100 g, each food’s serving when it is a different weight, usual servings and custom', () => {
        const choices = basisChoices(foods, { foodId: broccoli.id, grams: 91, label: '1 cup, chopped (91 g)' });
        assert.deepEqual(choices.map(c => c.label), [
            '1 oz (28.35 g)', '3 oz (85.05 g)', '100 g',
            'Broccoli (this page): 1 cup, chopped (91 g)',
            'Each food’s usual serving',
            'Custom amount…',
        ]);
        // Salmon's usual 3 oz and lingcod's 100 g are already in the list as weights: no duplicates.
        assert.equal(new Set(choices.map(c => c.value)).size, choices.length);
    });
    it('round-trips between menu values and bases', () => {
        for (const basis of [{ kind: 'standard', id: 'w-3oz' }, { kind: 'food', foodId: 3 }, { kind: 'usual' }] as const) {
            assert.deepEqual(basisFromChoice(choiceOfBasis(basis), { text: '1', unit: 'g' }), basis);
        }
        assert.deepEqual(basisFromChoice('custom', { text: '4', unit: 'oz' }), { kind: 'custom', text: '4', unit: 'oz' });
    });
});

describe('normalizeBasis', () => {
    it('keeps a basis the menu offers', () => {
        assert.deepEqual(normalizeBasis({ kind: 'food', foodId: 3 }, foods), { kind: 'food', foodId: 3 });
        assert.deepEqual(normalizeBasis({ kind: 'custom', text: '2', unit: 'oz' }, foods), { kind: 'custom', text: '2', unit: 'oz' });
    });
    it('turns a food’s serving that is now a standard weight into that weight, and a removed food into 100 g', () => {
        assert.deepEqual(normalizeBasis({ kind: 'food', foodId: 3 }, foods, { foodId: 3, grams: THREE_OZ, label: '3 oz (85.05 g)' }),
            { kind: 'standard', id: 'w-3oz' });
        assert.deepEqual(normalizeBasis({ kind: 'food', foodId: 99 }, foods), { kind: 'standard', id: 'w-100g' });
        assert.deepEqual(normalizeBasis({ kind: 'usual' }, [broccoli]), { kind: 'standard', id: 'w-100g' });
    });
});

describe('initialBasis', () => {
    it('starts the food page at the weight it already shows, for every food', () => {
        assert.deepEqual(initialBasis({ foodId: 1, grams: THREE_OZ, label: '3 oz (85.05 g)' }), { kind: 'standard', id: 'w-3oz' });
        assert.deepEqual(initialBasis({ foodId: 3, grams: 91, label: '1 cup, chopped (91 g)' }), { kind: 'food', foodId: 3 });
    });
    it('starts the planner at 100 g', () => {
        assert.deepEqual(initialBasis(), { kind: 'standard', id: 'w-100g' });
    });
});

describe('raw vs cooked hint', () => {
    it('reads the preparation from the description', () => {
        assert.equal(preparationState('Fish, salmon, Atlantic, farm raised, raw'), 'raw');
        assert.equal(preparationState('Fish, lingcod, cooked, dry heat'), 'cooked');
        assert.equal(preparationState('Chicken, broilers or fryers, breast, meat only, roasted'), 'cooked');
        assert.equal(preparationState('Rice, white, long-grain, regular, enriched, cooked'), 'cooked');
        assert.equal(preparationState('Milk, whole'), null);
        assert.equal(preparationState('Strawberries, raw'), 'raw');
    });
    it('speaks up only when raw and cooked foods are side by side', () => {
        assert.match(preparationHint(['Fish, salmon, Atlantic, farm raised, raw', 'Fish, lingcod, cooked, dry heat']) ?? '', /water/);
        assert.equal(preparationHint(['Fish, salmon, raw', 'Fish, lingcod, raw']), null);
        assert.equal(preparationHint(['Fish, salmon, raw', 'Milk, whole']), null);
    });
});
