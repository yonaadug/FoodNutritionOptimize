import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFractions, parseIngredientLine, parseQuantity, parseRecipeText, parseServings } from './parse';
import { lookupUnit, unitLabel } from './units';

function line(s: string) {
    const r = parseIngredientLine(s);
    assert.ok(r, `expected "${s}" to parse`);
    return r;
}

describe('units', () => {
    it('maps spellings to canonical units', () => {
        assert.equal(lookupUnit('Tablespoons'), 'tbsp');
        assert.equal(lookupUnit('tbsp.'), 'tbsp');
        assert.equal(lookupUnit('T'), 'tbsp');
        assert.equal(lookupUnit('t'), 'tsp');
        assert.equal(lookupUnit('cups'), 'cup');
        assert.equal(lookupUnit('lbs'), 'lb');
        assert.equal(lookupUnit('fl. oz'), 'fl oz');
        assert.equal(lookupUnit('cloves'), 'clove');
        assert.equal(lookupUnit('banana'), null);
    });
    it('pluralises labels for display', () => {
        assert.equal(unitLabel('cup', 2), 'cups');
        assert.equal(unitLabel('cup', 1), 'cup');
        assert.equal(unitLabel('g', 200), 'g');
        assert.equal(unitLabel(null, 2), '');
    });
});

describe('parseQuantity', () => {
    it('reads integers, decimals, fractions and mixed numbers', () => {
        assert.equal(parseQuantity('2 cups')?.value, 2);
        assert.equal(parseQuantity('1.5 cups')?.value, 1.5);
        assert.equal(parseQuantity('1/2 cup')?.value, 0.5);
        assert.equal(parseQuantity('1 1/2 cups')?.value, 1.5);
        assert.equal(parseQuantity('.5 tsp')?.value, 0.5);
        assert.equal(parseQuantity('1,5 kg')?.value, 1.5);
    });
    it('averages ranges and keeps the maximum', () => {
        const r = parseQuantity('2-3 cloves');
        assert.equal(r?.value, 2.5);
        assert.equal(r?.max, 3);
        assert.equal(parseQuantity('1 to 2 tbsp')?.value, 1.5);
        assert.equal(parseQuantity('4–6 thighs')?.value, 5);
    });
    it('reads number words', () => {
        assert.equal(parseQuantity('a pinch')?.value, 1);
        assert.equal(parseQuantity('two eggs')?.value, 2);
        assert.equal(parseQuantity('half an onion')?.value, 0.5);
        assert.equal(parseQuantity('a dozen eggs')?.value, 12);
        assert.equal(parseQuantity('avocado'), null);
        assert.equal(parseQuantity('salt'), null);
    });
    it('normalises unicode fractions', () => {
        assert.equal(normalizeFractions('1½ cups'), '1 1/2 cups');
        assert.equal(parseQuantity(normalizeFractions('¾ cup'))?.value, 0.75);
        assert.equal(parseQuantity(normalizeFractions('2⅓ cups'))?.value, 2 + 1 / 3);
    });
});

describe('parseIngredientLine', () => {
    it('splits quantity, unit, name and preparation', () => {
        const r = line('2 cups all-purpose flour, sifted');
        assert.equal(r.quantity, 2);
        assert.equal(r.unit, 'cup');
        assert.equal(r.name, 'all-purpose flour');
        assert.equal(r.preparation, 'sifted');
    });
    it('treats size words as count units', () => {
        const r = line('2 large eggs, beaten');
        assert.deepEqual([r.quantity, r.unit, r.name, r.preparation], [2, 'large', 'eggs', 'beaten']);
    });
    it('keeps bare counts unitless', () => {
        const r = line('3 bananas');
        assert.deepEqual([r.quantity, r.unit, r.name], [3, null, 'bananas']);
    });
    it('moves leading preparation words out of the name', () => {
        const r = line('1/4 cup finely chopped fresh parsley');
        assert.equal(r.name, 'fresh parsley');
        assert.equal(r.preparation, 'finely chopped');
        assert.equal(r.quantity, 0.25);
    });
    it('keeps cooked as preparation for matching', () => {
        const r = line('1 cup cooked rice');
        assert.equal(r.name, 'rice');
        assert.equal(r.preparation, 'cooked');
    });
    it('uses the container size from parentheses', () => {
        const r = line('1 (14.5 oz) can diced tomatoes');
        assert.equal(r.quantity, 14.5);
        assert.equal(r.unit, 'oz');
        assert.equal(r.name, 'tomatoes');
        assert.equal(r.preparation, 'diced');
        const p = line('2 (8 ounce) packages cream cheese, softened');
        assert.equal(p.quantity, 16);
        assert.equal(p.unit, 'oz');
        assert.equal(p.name, 'cream cheese');
    });
    it('prefers a weight given in parentheses', () => {
        const r = line('1 cup (125 g) flour');
        assert.deepEqual([r.quantity, r.unit, r.name], [125, 'g', 'flour']);
        assert.match(r.notes ?? '', /1 cup/);
    });
    it('reads glued metric units', () => {
        const r = line('200g spaghetti');
        assert.deepEqual([r.quantity, r.unit, r.name], [200, 'g', 'spaghetti']);
        const k = line('1.5kg potatoes, peeled');
        assert.deepEqual([k.quantity, k.unit, k.name, k.preparation], [1.5, 'kg', 'potatoes', 'peeled']);
    });
    it('handles abbreviations and "of"', () => {
        const r = line('3 Tbsp. of olive oil');
        assert.deepEqual([r.quantity, r.unit, r.name], [3, 'tbsp', 'olive oil']);
        const t = line('1 t vanilla extract');
        assert.equal(t.unit, 'tsp');
        const f = line('8 fl oz chicken broth');
        assert.deepEqual([f.quantity, f.unit, f.name], [8, 'fl oz', 'chicken broth']);
    });
    it('records "to taste" and optional notes without a quantity', () => {
        const r = line('Salt and pepper to taste');
        assert.equal(r.quantity, null);
        assert.equal(r.name, 'Salt and pepper');
        assert.equal(r.notes, 'to taste');
        assert.ok(r.confidence < 0.9);
        const o = line('1/2 cup walnuts, chopped (optional)');
        assert.match(o.notes ?? '', /optional/);
        assert.equal(o.name, 'walnuts');
    });
    it('strips bullets and checkboxes', () => {
        assert.equal(line('- 2 cloves garlic, minced').unit, 'clove');
        assert.equal(line('• 1 onion').name, 'onion');
        assert.equal(line('▢ 1 tsp salt').unit, 'tsp');
    });
    it('records ranges in notes', () => {
        const r = line('2-3 cloves garlic');
        assert.equal(r.quantity, 2.5);
        assert.match(r.notes ?? '', /2–3/);
    });
    it('skips headers and instructions', () => {
        assert.equal(parseIngredientLine('For the sauce:'), null);
        assert.equal(parseIngredientLine(''), null);
        assert.equal(parseIngredientLine('Preheat the oven to 350°F and grease a 9x13 inch baking pan with butter.'), null);
    });
    it('keeps the original line', () => {
        assert.equal(line('1½ cups milk').original, '1½ cups milk');
        assert.equal(line('1½ cups milk').quantity, 1.5);
    });
});

describe('parseServings', () => {
    it('reads common forms', () => {
        assert.equal(parseServings('Serves 4'), 4);
        assert.equal(parseServings('Servings: 6'), 6);
        assert.equal(parseServings('Yield: 6-8 servings'), 7);
        assert.equal(parseServings('Makes 12 cookies'), 12);
        assert.equal(parseServings('4 servings'), 4);
        assert.equal(parseServings('2 cups flour'), null);
    });
});

describe('parseRecipeText', () => {
    it('keeps a title that shares a line with the servings', () => {
        const r = parseRecipeText('Banana oat pancakes (serves 2)\n2 ripe bananas\n1 cup rolled oats');
        assert.equal(r.title, 'Banana oat pancakes');
        assert.equal(r.servings, 2);
        assert.equal(r.ingredients.length, 2);
        assert.equal(parseRecipeText('Chili - serves 6\n1 can beans').title, 'Chili');
    });

    it('does not take a title from a servings line that is only servings', () => {
        for (const line of ['Makes 12 cookies', 'Yield: 6-8 servings', 'Serves 4', '4 servings']) {
            assert.equal(parseRecipeText(`${line}\n1 cup flour`).title, '', line);
        }
    });

    it('reads a recipe with headers, skipping instructions', () => {
        const r = parseRecipeText(`Classic Pancakes
Serves 4

Ingredients
1 1/2 cups all-purpose flour
3 1/2 tsp baking powder
1 tbsp sugar
1/4 tsp salt
1 1/4 cups milk
1 egg
3 tbsp butter, melted

Instructions
1. In a large bowl, sift together the flour, baking powder, salt and sugar.
2. Make a well in the center and pour in the milk, egg and melted butter; mix until smooth.`);
        assert.equal(r.title, 'Classic Pancakes');
        assert.equal(r.servings, 4);
        assert.equal(r.ingredients.length, 7);
        assert.equal(r.ingredients[6].name, 'butter');
        assert.equal(r.ingredients[6].preparation, 'melted');
    });
    it('reads a bare ingredient list without a title', () => {
        const r = parseRecipeText('2 eggs\n1 cup milk\n1 tbsp butter');
        assert.equal(r.title, '');
        assert.equal(r.servings, null);
        assert.equal(r.ingredients.length, 3);
    });
    it('reads a title followed by a list without headers', () => {
        const r = parseRecipeText('Garlic rice\n1 cup cooked rice\n2 cloves garlic, minced\n1 tbsp olive oil\nSalt to taste\nHeat the oil in a pan and fry the garlic until golden, then add the rice.');
        assert.equal(r.title, 'Garlic rice');
        assert.deepEqual(r.ingredients.map(i => i.name), ['rice', 'garlic', 'olive oil', 'Salt']);
    });
    it('caps the number of ingredients', () => {
        const r = parseRecipeText(Array.from({ length: 100 }, (_, i) => `${i + 1} g sugar`).join('\n'));
        assert.equal(r.ingredients.length, 60);
    });
});
