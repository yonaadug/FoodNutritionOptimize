import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getFoodsByFdcIdsIn, openDatabase } from '../db';
import type { Food } from '../food-types';
import { aisleFor, csvField, groceryCsv, groceryList, groceryText, lineAmount, purchaseUnit, volumeText, weightText } from './grocery';
import type { WeekDay } from './types';

const FULL_DB = path.resolve(process.cwd(), 'nutrition.db');
const skip = !fs.existsSync(FULL_DB) || fs.statSync(FULL_DB).size < 1_000_000;

const CHICKEN = 171477; // Chicken, broilers or fryers, breast, meat only, cooked, roasted ("0.5 breast" = 86 g)
const EGG = 171287; // Egg, whole, raw, fresh ("1 large" = 50 g)
const MILK = 171265; // Milk, whole ("1 cup" = 244 g)
const SPINACH = 168462; // Spinach, raw ("1 bunch" = 340 g, "1 package (10 oz)" = 284 g)
const BANANA = 173944; // Bananas, raw ("1 medium" = 118 g, "1 large" = 136 g)
const SALMON_CAT = { food_category: 'Finfish and Shellfish Products' };

function day(index: number, entries: [number, number][]): WeekDay {
    return { index, locked: false, calories: 0, nutrients: {}, entries: entries.map(([foodId, grams]) => ({ foodId, grams, role: 'planned', locked: false })) };
}

describe('purchase units', () => {
    it('writes weights metric first, then US', () => {
        assert.equal(weightText(1200), '1.2 kg ≈ 2.6 lb');
        assert.equal(weightText(300), '300 g ≈ 10.6 oz');
        assert.equal(weightText(454), '455 g ≈ 1 lb');
        assert.equal(weightText(42), '42 g ≈ 1.5 oz');
        assert.equal(weightText(0), '0 g');
    });

    it('puts USDA categories in shop aisles', () => {
        assert.equal(aisleFor({ food_category: 'Vegetables and Vegetable Products' }), 'Produce');
        assert.equal(aisleFor({ food_category: 'Poultry Products' }), 'Meat & poultry');
        assert.equal(aisleFor(SALMON_CAT), 'Seafood');
        assert.equal(aisleFor({ food_category: 'Dairy and Egg Products' }), 'Dairy & eggs');
        assert.equal(aisleFor({ food_category: 'Cereal Grains and Pasta' }), 'Grains, pasta & cereal');
        assert.equal(aisleFor({ food_category: 'Nut and Seed Products' }), 'Beans, nuts & seeds');
        assert.equal(aisleFor({ food_category: 'Pasta mixed dishes, excludes macaroni and cheese' }), 'Prepared foods');
        assert.equal(aisleFor({ food_category: 'Egg rolls, dumplings, sushi' }), 'Prepared foods');
        assert.equal(aisleFor({ food_category: 'Fats and Oils' }), 'Pantry');
        assert.equal(aisleFor({ food_category: null }), 'Other');
        assert.equal(aisleFor({ food_category: 'Recipes', recipe: { id: 'r', servingGrams: 1, uncounted: [], incomplete: [], fingerprint: '' } }), 'Recipes');
    });

    it('keeps CSV fields safe', () => {
        assert.equal(csvField('a,b'), '"a,b"');
        assert.equal(csvField('say "hi"'), '"say ""hi"""');
        assert.equal(csvField('=SUM(A1)'), "'=SUM(A1)");
        assert.equal(csvField(12), '12');
    });
});

describe('grocery list from real USDA portions', { skip }, () => {
    let foods: Map<number, Food>;
    before(() => {
        const conn = openDatabase(FULL_DB);
        foods = new Map(getFoodsByFdcIdsIn(conn, [CHICKEN, EGG, MILK, SPINACH, BANANA]).map(f => [f.fdc_id, f]));
        conn.db.close();
    });

    it('converts a week of chicken breast to weight and breasts', () => {
        const chicken = foods.get(CHICKEN)!;
        // 1200 g / (86 g per half breast x 2) = 6.98 -> 7 breasts.
        assert.equal(purchaseUnit(chicken, 1200), '≈ 7 breasts, bone and skin removed');
        assert.equal(weightText(1200), '1.2 kg ≈ 2.6 lb');
    });

    it('counts eggs and bananas in the sizes shops sell', () => {
        assert.equal(purchaseUnit(foods.get(EGG)!, 400), '≈ 8 large');
        assert.match(purchaseUnit(foods.get(BANANA)!, 700) ?? '', /^≈ [56] (large|medium)$/);
    });

    it('uses shop units for greens and volume for milk', () => {
        assert.match(purchaseUnit(foods.get(SPINACH)!, 600) ?? '', /^≈ (2 bunches|3 packages)$/);
        // 1708 g / 244 g a cup x 236.588 mL = 1.66 L = 1.75 US quarts.
        assert.equal(volumeText(foods.get(MILK)!, 1708), '1.7 L ≈ 1.7 qt');
        assert.equal(volumeText(foods.get(CHICKEN)!, 1708), null);
    });

    it('totals the week per food, grouped by aisle, and exports it', () => {
        const byId: Record<string, Food> = {};
        for (const f of foods.values()) byId[String(f.id)] = f;
        const c = foods.get(CHICKEN)!.id, e = foods.get(EGG)!.id, m = foods.get(MILK)!.id, s = foods.get(SPINACH)!.id;
        const days = [day(0, [[c, 400], [e, 100], [m, 244]]), day(1, [[c, 400], [s, 300]]), day(2, [[c, 400], [e, 300], [s, 300]])];
        const groups = groceryList(days, byId);
        assert.deepEqual(groups.map(g => g.aisle), ['Produce', 'Meat & poultry', 'Dairy & eggs']);
        const chicken = groups[1].lines[0];
        assert.equal(chicken.grams, 1200);
        assert.equal(lineAmount(chicken), '1.2 kg ≈ 2.6 lb (≈ 7 breasts, bone and skin removed)');
        const eggs = groups[2].lines.find(l => l.foodId === e)!;
        assert.equal(eggs.household, '≈ 8 large');
        const milk = groups[2].lines.find(l => l.foodId === m)!;
        assert.equal(milk.amount, '240 mL ≈ 1 cup');

        const text = groceryText(groups, new Set([c]));
        assert.match(text, /^Grocery list\n\nPRODUCE\n\[ \] Spinach, raw: /);
        assert.match(text, /\[x\] Chicken, broilers or fryers, breast/);
        const csv = groceryCsv(groups, new Set([c])).split('\r\n');
        assert.equal(csv[0], 'Aisle,Food,Grams,Amount,Household,USDA FDC id,Got it');
        assert.equal(csv.length, 1 + 4 + 1);
        assert.ok(csv.some(r => r.startsWith('Meat & poultry,"Chicken, broilers or fryers, breast, meat only, cooked, roasted",1200,1.2 kg ≈ 2.6 lb,') && r.endsWith(`,${CHICKEN},yes`)));
    });

    it('lists a recipe once per batch, not again for its leftovers', () => {
        const chili = {
            ...foods.get(CHICKEN)!, id: -3, fdc_id: -3, description: 'Chili',
            recipe: { id: 'r-chili', servingGrams: 250, uncounted: [], incomplete: [], fingerprint: 'f' },
        } as Food;
        const days: WeekDay[] = [
            { index: 0, locked: false, calories: 0, nutrients: {}, entries: [{ foodId: -3, grams: 250, servings: 1, cooked: 2, role: 'cooked', locked: false }] },
            { index: 1, locked: false, calories: 0, nutrients: {}, entries: [{ foodId: -3, grams: 250, servings: 1, role: 'leftover', locked: false }] },
            { index: 3, locked: false, calories: 0, nutrients: {}, entries: [{ foodId: -3, grams: 500, servings: 2, role: 'cooked', locked: false }] },
        ];
        const [g] = groceryList(days, { '-3': chili });
        assert.equal(g.aisle, 'Recipes');
        assert.deepEqual(g.lines[0].recipe, { servings: 4, cookDays: 2, recipeId: 'r-chili' });
        assert.equal(lineAmount(g.lines[0]), '4 servings, cooked on 2 days (shop from the recipe)');
    });
});
