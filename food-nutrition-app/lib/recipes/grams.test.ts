import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertToGrams, mergePortions, parsePortionLabel } from './grams';
import { parseIngredientLine } from './parse';
import type { Portion } from './types';

const row = (label: string, grams: number, source: Portion['source'] = 'food'): Portion => ({ label, grams, source });

const FLOUR = { description: 'Flour, wheat, all-purpose', portions: [row('100 g', 100), row('1 RACC', 30), row('1 cup', 125, 'related')] };
const ONION = {
    description: 'Onions, raw',
    portions: [row('1 slice, thin', 9), row('1 tbsp chopped', 10), row('1 small', 70), row('100 g', 100), row('1 medium (2-1/2" dia)', 110), row('1 large', 150), row('1 cup, chopped', 160)],
};
const EGG = { description: 'Eggs, Grade A, Large, egg whole', portions: [row('1 RACC', 50), row('1 egg, whole without shell', 50.3), row('1 large', 50, 'related'), row('1 small', 38, 'related')] };
const NO_PORTIONS = { description: 'Sugars, granulated', portions: [row('100 g', 100)] };
const SALMON = { description: 'Fish, salmon, Atlantic, raw', portions: [row('100 g', 100), row('1 RACC', 115)] };

const g = (r: { grams: number | null }) => Math.round((r.grams ?? NaN) * 10) / 10;

describe('parsePortionLabel', () => {
    it('reads amount, unit and qualifier', () => {
        const p = parsePortionLabel(row('0.25 cup, chopped', 15))!;
        assert.equal(p.qty, 0.25);
        assert.equal(p.unit, 'cup');
        assert.equal(p.rest, 'chopped');
    });
    it('skips generic rows', () => {
        assert.equal(parsePortionLabel(row('100 g', 100)), null);
        assert.equal(parsePortionLabel(row('1 RACC', 30)), null);
    });
    it('does not read item names from parentheses', () => {
        const p = parsePortionLabel(row('1 wedge (1/8 of one lemon)', 7))!;
        assert.ok(!p.words.includes('lemon'));
    });
});

describe('convertToGrams: mass', () => {
    it('is exact for mass units, even with no food', () => {
        assert.deepEqual([g(convertToGrams({ quantity: 200, unit: 'g' }, null)), convertToGrams({ quantity: 200, unit: 'g' }, null).method], [200, 'exact']);
        assert.equal(g(convertToGrams({ quantity: 1, unit: 'lb' }, null)), 453.6);
        assert.equal(g(convertToGrams({ quantity: 4, unit: 'oz' }, SALMON)), 113.4);
        assert.equal(g(convertToGrams({ quantity: 1.5, unit: 'kg' }, null)), 1500);
    });
});

describe('convertToGrams: volume', () => {
    it('uses a USDA row for the same unit', () => {
        const c = convertToGrams({ quantity: 2, unit: 'cup' }, FLOUR);
        assert.equal(g(c), 250);
        assert.equal(c.method, 'exact');
        assert.match(c.basis, /1 cup = 125 g/);
        assert.match(c.basis, /equivalent USDA food/);
    });
    it('scales across volume units', () => {
        assert.equal(g(convertToGrams({ quantity: 16, unit: 'tbsp' }, FLOUR)), 125);
        assert.equal(g(convertToGrams({ quantity: 3, unit: 'tsp' }, { description: 'x', portions: [row('1 tbsp', 15)] })), 15);
    });
    it('prefers the qualifier the recipe asked for', () => {
        const sugar = { description: 'Sugars, brown', portions: [row('1 cup unpacked', 145), row('1 cup packed', 220)] };
        assert.equal(g(convertToGrams({ quantity: 1, unit: 'cup', preparation: 'packed' }, sugar)), 220);
        const onion = convertToGrams({ quantity: 1, unit: 'cup', preparation: 'chopped' }, ONION);
        assert.equal(g(onion), 160);
    });
    it('falls back to a typical density, marked estimated', () => {
        const c = convertToGrams({ quantity: 1, unit: 'cup', name: 'sugar' }, NO_PORTIONS);
        assert.equal(c.method, 'estimated');
        assert.ok(c.grams! > 190 && c.grams! < 210, String(c.grams));
    });
    it('reads milk as a liquid, not as nuts, for almond milk', () => {
        const c = convertToGrams({ quantity: 1, unit: 'cup', name: 'almond milk' }, { description: 'Almond milk, unsweetened', portions: [] });
        assert.ok(c.grams! > 230 && c.grams! < 250, String(c.grams));
    });
    it('assumes water for an unknown food and says so', () => {
        const c = convertToGrams({ quantity: 1, unit: 'cup', name: 'zzz' }, { description: 'Zzz', portions: [] });
        assert.equal(c.method, 'estimated');
        assert.match(c.basis, /water/);
        assert.ok(c.grams! > 235 && c.grams! < 238);
    });
    it('handles pinch and dash as fractions of a teaspoon', () => {
        const salt = { description: 'Salt, table', portions: [row('1 teaspoon', 6.1)] };
        assert.equal(g(convertToGrams({ quantity: 16, unit: 'pinch' }, salt)), 6.1);
        assert.equal(g(convertToGrams({ quantity: 8, unit: 'dash' }, salt)), 6.1);
    });
    it('does not trust a related row for rolled oats (USDA row is for groats)', () => {
        const oats = { description: 'Oats, whole grain, rolled, old fashioned', portions: [row('1 cup', 156, 'related')] };
        const c = convertToGrams({ quantity: 1, unit: 'cup', name: 'rolled oats' }, oats);
        assert.equal(c.method, 'estimated');
        assert.ok(c.grams! > 80 && c.grams! < 100, String(c.grams));
    });
});

describe('convertToGrams: count', () => {
    it('uses a row naming the unit', () => {
        const c = convertToGrams({ quantity: 2, unit: 'large', name: 'onions' }, ONION);
        assert.equal(g(c), 300);
        assert.equal(c.method, 'exact');
        assert.equal(g(convertToGrams({ quantity: 3, unit: 'slice' }, ONION)), 27);
    });
    it('reads a row with an item name for a bare count', () => {
        const c = convertToGrams({ quantity: 2, unit: null, name: 'eggs' }, EGG);
        assert.equal(g(c), 100.6);
        assert.equal(c.method, 'exact');
    });
    it('assumes medium for a bare count with size rows, marked estimated', () => {
        const c = convertToGrams({ quantity: 1, unit: null, name: 'onion' }, ONION);
        assert.equal(g(c), 110);
        assert.equal(c.method, 'estimated');
        assert.match(c.basis, /assuming medium/);
    });
    it('uses the middle of equally good rows', () => {
        const lemon = { description: 'Lemons, raw', portions: [row('1 fruit (2-1/8" dia)', 58), row('1 fruit (2-3/8" dia)', 84)] };
        assert.equal(g(convertToGrams({ quantity: 1, unit: null, name: 'lemon' }, lemon)), 58);
    });
    it('falls back to a table of item weights', () => {
        const c = convertToGrams({ quantity: 2, unit: 'clove', name: 'garlic' }, { description: 'Garlic, raw', portions: [] });
        assert.deepEqual([g(c), c.method], [6, 'estimated']);
        const b = convertToGrams({ quantity: 1, unit: null, name: 'banana' }, { description: 'Bananas, ripe', portions: [] });
        assert.deepEqual([g(b), b.method], [118, 'estimated']);
    });
    it('estimates a standard can', () => {
        const c = convertToGrams({ quantity: 1, unit: 'can', name: 'tomatoes' }, { description: 'Tomatoes, canned', portions: [] });
        assert.deepEqual([g(c), c.method], [411, 'estimated']);
    });
    it('only assumes a stick of butter for butter', () => {
        const b = convertToGrams({ quantity: 1, unit: 'stick', name: 'butter' }, { description: 'Butter', portions: [] });
        assert.deepEqual([g(b), b.method], [113, 'estimated']);
        const c = convertToGrams({ quantity: 1, unit: 'stick', name: 'celery' }, { description: 'Celery', portions: [] });
        assert.equal(c.method, 'unknown');
    });
    it('is unknown when nothing fits, and never guesses', () => {
        const c = convertToGrams({ quantity: 2, unit: 'head', name: 'lettuce' }, { description: 'Lettuce', portions: [] });
        assert.equal(c.grams, null);
        assert.equal(c.method, 'unknown');
    });
});

describe('convertToGrams: missing input', () => {
    it('does not count ingredients with no amount', () => {
        const c = convertToGrams({ quantity: null, unit: null, name: 'salt', notes: 'to taste' }, { description: 'Salt', portions: [] });
        assert.deepEqual([c.grams, c.method], [null, 'unknown']);
    });
    it('needs a food for anything but mass', () => {
        assert.equal(convertToGrams({ quantity: 1, unit: 'cup' }, null).method, 'unknown');
    });
    it('rejects bad quantities', () => {
        assert.equal(convertToGrams({ quantity: -1, unit: 'g' }, null).method, 'unknown');
        assert.equal(convertToGrams({ quantity: NaN, unit: 'g' }, null).method, 'unknown');
    });
    it('accepts unit spellings', () => {
        assert.equal(g(convertToGrams({ quantity: 2, unit: 'Tablespoons' }, { description: 'x', portions: [row('1 tbsp', 15)] })), 30);
    });
});

describe('mergePortions', () => {
    it('keeps own rows first and drops duplicates by label', () => {
        const m = mergePortions(
            [{ label: '1 cup', weight_g: 100 }, { label: '100 g', weight_g: 100 }],
            [{ label: '1 CUP', weight_g: 125 }, { label: '1 clove', weight_g: 3 }, { label: 'bad', weight_g: 0 }],
        );
        assert.deepEqual(m.map(p => [p.label, p.source]), [['1 cup', 'food'], ['100 g', 'food'], ['1 clove', 'related']]);
    });
});

describe('parser edge cases found on the held-out set', () => {
    it('reads hyphenated container sizes', () => {
        const r = parseIngredientLine('1 (28-ounce) can whole tomatoes')!;
        assert.deepEqual([r.quantity, r.unit], [28, 'oz']);
        assert.match(r.notes ?? '', /can/);
    });
    it('reads a multiplier in front of a container size', () => {
        const r = parseIngredientLine('2 x 145g tins of tuna in water, drained')!;
        assert.deepEqual([r.quantity, r.unit, r.name], [290, 'g', 'tuna in water']);
    });
    it('reads the unit after the food', () => {
        const r = parseIngredientLine('3 garlic cloves, minced')!;
        assert.deepEqual([r.quantity, r.unit, r.name], [3, 'clove', 'garlic']);
    });
});
