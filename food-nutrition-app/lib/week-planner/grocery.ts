/**
 * The week's grocery list: each food's total for the week, in units a shop sells it in,
 * grouped by aisle. Pure (safe for client components).
 *
 * TODO(instacart): "Shop this list" needs an Instacart Developer Platform key (products_link
 * with line_items). Not wired up: there's no key, and partner access is approval-based.
 */
import type { Food, ServingSize } from '../food-types';
import { GRAMS_PER_OUNCE, GRAMS_PER_POUND } from '../serving-scale';
import type { WeekDay } from './types';

export const AISLES = [
    'Produce', 'Meat & poultry', 'Seafood', 'Dairy & eggs', 'Bakery', 'Grains, pasta & cereal', 'Beans, nuts & seeds',
    'Pantry', 'Drinks', 'Snacks', 'Prepared foods', 'Recipes', 'Other',
] as const;
export type Aisle = typeof AISLES[number];

/** USDA food categories (SR Legacy, Foundation and FNDDS) to a shop's aisles. First match wins. */
const AISLE_RULES: [RegExp, Aisle][] = [
    [/mixed dish|dishes|sandwich|pizza|burger|burrito|taco|nachos|egg rolls|fried rice|ramen|meals, entrees|fast foods|restaurant|turnovers|stir-fry|macaroni and cheese|soups, (broth|cream)/i, 'Prepared foods'],
    [/vegetable|fruit/i, 'Produce'],
    [/finfish|shellfish|seafood/i, 'Seafood'],
    [/beef|pork|poultry|lamb|veal|game|sausage|luncheon/i, 'Meat & poultry'],
    [/dairy|egg/i, 'Dairy & eggs'],
    [/baked/i, 'Bakery'],
    [/cereal|pasta|grain|rice/i, 'Grains, pasta & cereal'],
    [/legume|nut|seed/i, 'Beans, nuts & seeds'],
    [/fats|oils|spices|herbs|soups|sauces|gravies|sweets/i, 'Pantry'],
    [/beverage/i, 'Drinks'],
    [/snack/i, 'Snacks'],
];

export function aisleFor(food: Pick<Food, 'food_category' | 'recipe'>): Aisle {
    if (food.recipe) return 'Recipes';
    const c = food.food_category ?? '';
    return AISLE_RULES.find(([re]) => re.test(c))?.[1] ?? 'Other';
}

export interface GroceryLine {
    foodId: number;
    fdcId: number;
    name: string;
    aisle: Aisle;
    /** The week's total, in grams (recipes: grams of the dish). */
    grams: number;
    /** "1.2 kg ≈ 2.6 lb", "300 g ≈ 10.6 oz", "1.4 L ≈ 1.5 qt". */
    amount: string;
    /** A count or a shop unit from USDA's portions: "≈ 8 large", "≈ 2 bunches". */
    household: string | null;
    /** Recipes: servings cooked over the week, and on how many days. */
    recipe?: { servings: number; cookDays: number; recipeId: string };
}

export interface GroceryGroup { aisle: Aisle; lines: GroceryLine[] }

function round1(n: number): string {
    return String(Math.round(n * 10) / 10);
}

/** A weight for a shopping list: metric first, then US units. */
export function weightText(grams: number): string {
    if (!(grams > 0)) return '0 g';
    if (grams >= 1000) return `${round1(grams / 1000)} kg ≈ ${round1(grams / GRAMS_PER_POUND)} lb`;
    const g = grams >= 100 ? Math.round(grams / 5) * 5 : Math.round(grams);
    if (grams >= GRAMS_PER_POUND * 0.95) return `${g} g ≈ ${round1(grams / GRAMS_PER_POUND)} lb`;
    return `${g} g ≈ ${round1(grams / GRAMS_PER_OUNCE)} oz`;
}

const LITRES_PER_US_QUART = 0.946352946;
const ML_PER_CUP = 236.588;
const LIQUID = /^(milk|beverages?|juice|soymilk|almond milk|kefir|buttermilk)\b|\bmilk, |\bjuice\b|\bbeverage\b|\bdrink\b/i;

/** Liquids by volume, from USDA's cup weight: "1.4 L ≈ 1.5 qt". Null for anything else. */
export function volumeText(food: Pick<Food, 'description' | 'food_category' | 'serving_sizes'>, grams: number): string | null {
    if (!LIQUID.test(food.description) && !/beverages/i.test(food.food_category ?? '')) return null;
    const cup = (food.serving_sizes ?? []).find(s => /^1 cup\b/i.test(s.label) && s.weight_g > 150 && s.weight_g < 300);
    if (!cup) return null;
    const litres = (grams / cup.weight_g) * ML_PER_CUP / 1000;
    if (litres < 1) {
        const cups = round1(litres * 1000 / ML_PER_CUP);
        return `${Math.round(litres * 1000 / 10) * 10} mL ≈ ${cups} ${cups === '1' ? 'cup' : 'cups'}`;
    }
    const quarts = litres / LITRES_PER_US_QUART;
    return quarts >= 4 ? `${round1(litres)} L ≈ ${round1(quarts / 4)} gal` : `${round1(litres)} L ≈ ${round1(quarts)} qt`;
}

/** Units a shop sells by, then units you'd count at home. USDA labels them like "1 bunch" or "1 large". */
const SHOP_UNIT = /^(\d+(?:\.\d+)?)\s+(bunch|head|package|can|loaf|container|bag|jar|stalk|bulb)\b(.*)$/i;
const COUNT_UNIT = /^(\d+(?:\.\d+)?)\s+(extra large|large|medium|small|jumbo|whole|egg|banana|fruit|fillet|breast|thigh|drumstick|clove|pepper|potato|tomato|apple|orange|pear|avocado|lemon|lime|onion|carrot|patty|steak|chop|link|slice)\b(.*)$/i;

const PLURAL: Record<string, string> = {
    bunch: 'bunches', head: 'heads', package: 'packages', can: 'cans', loaf: 'loaves', container: 'containers', bag: 'bags', jar: 'jars',
    stalk: 'stalks', bulb: 'bulbs', egg: 'eggs', banana: 'bananas', fruit: 'fruits', fillet: 'fillets', breast: 'breasts', thigh: 'thighs',
    drumstick: 'drumsticks', clove: 'cloves', pepper: 'peppers', potato: 'potatoes', tomato: 'tomatoes', apple: 'apples', orange: 'oranges',
    pear: 'pears', avocado: 'avocados', lemon: 'lemons', lime: 'limes', onion: 'onions', carrot: 'carrots', patty: 'patties', steak: 'steaks',
    chop: 'chops', link: 'links', slice: 'slices', whole: 'whole',
};

function unitCount(grams: number, s: ServingSize, re: RegExp): string | null {
    const m = s.label.match(re);
    if (!m || !(s.weight_g > 0)) return null;
    const per = s.weight_g / Number(m[1]);
    // Buy whole units, but don't round 3.04 up to 4.
    const n = Math.max(1, Math.ceil(grams / per - 0.08));
    const word = m[2].toLowerCase();
    const noun = n === 1 ? word : PLURAL[word] ?? word;
    // Keep a short qualifier ("large", "(7 in long)" is dropped).
    const rest = m[3].replace(/\s*\([^)]*\)/g, '').replace(/^,\s*/, '').trim();
    const tail = rest && rest.length <= 24 && !/[0-9"]/.test(rest) ? `, ${rest.toLowerCase()}` : '';
    return `≈ ${n} ${noun}${tail}`;
}

/** A count or shop unit for this much food, when USDA lists one; null otherwise. */
export function purchaseUnit(food: Pick<Food, 'serving_sizes'>, grams: number): string | null {
    const rows = (food.serving_sizes ?? []).filter(s => s.weight_g > 0 && typeof s.label === 'string');
    for (const re of [SHOP_UNIT, COUNT_UNIT]) {
        // The unit nearest a typical buy (a few of them for the week) reads best.
        const options = rows.map(s => ({ s, text: unitCount(grams, s, re) })).filter(o => o.text !== null);
        if (!options.length) continue;
        // Large and medium are the sizes shops sell most; other sizes need a closer fit to win.
        const score = (s: ServingSize) => Math.abs(Math.log(grams / s.weight_g / 3)) + (/^\S+\s+(large|medium)\b/i.test(s.label) || re === SHOP_UNIT ? 0 : 0.5);
        options.sort((a, b) => score(a.s) - score(b.s));
        return options[0].text;
    }
    return null;
}

/** The grocery list for a week plan. `foods` has every food the plan uses, by planner id. */
export function groceryList(days: readonly WeekDay[], foods: Readonly<Record<string, Food>>): GroceryGroup[] {
    const totals = new Map<number, { grams: number; servings: number; cookDays: number }>();
    for (const day of days) {
        for (const e of day.entries) {
            const food = foods[String(e.foodId)];
            if (!food) continue;
            const t = totals.get(e.foodId) ?? { grams: 0, servings: 0, cookDays: 0 };
            if (food.recipe) {
                // Shop once per batch: leftovers were bought with the day they were cooked.
                if (e.role === 'leftover') { totals.set(e.foodId, t); continue; }
                const servings = e.cooked ?? e.servings ?? 0;
                t.servings += servings;
                t.cookDays += 1;
                t.grams += servings * food.recipe.servingGrams;
            } else {
                t.grams += e.grams;
            }
            totals.set(e.foodId, t);
        }
    }
    const lines: GroceryLine[] = [];
    for (const [foodId, t] of totals) {
        const food = foods[String(foodId)];
        if (!(t.grams > 0)) continue;
        const aisle = aisleFor(food);
        lines.push({
            foodId,
            fdcId: food.fdc_id,
            name: food.description,
            aisle,
            grams: Math.round(t.grams),
            amount: food.recipe ? `${t.servings} ${t.servings === 1 ? 'serving' : 'servings'}` : volumeText(food, t.grams) ?? weightText(t.grams),
            household: food.recipe ? null : purchaseUnit(food, t.grams),
            ...(food.recipe ? { recipe: { servings: t.servings, cookDays: t.cookDays, recipeId: food.recipe.id } } : {}),
        });
    }
    return AISLES.map(aisle => ({
        aisle,
        lines: lines.filter(l => l.aisle === aisle).sort((a, b) => a.name.localeCompare(b.name)),
    })).filter(g => g.lines.length > 0);
}

/** A line as one row of text: "1.2 kg ≈ 2.6 lb (≈ 8 large)". */
export function lineAmount(line: GroceryLine): string {
    if (line.recipe) return `${line.amount}, cooked on ${line.recipe.cookDays} ${line.recipe.cookDays === 1 ? 'day' : 'days'} (shop from the recipe)`;
    return line.household ? `${line.amount} (${line.household})` : line.amount;
}

/** Copy-as-text: one aisle heading per group, a box per line. */
export function groceryText(groups: readonly GroceryGroup[], checked: ReadonlySet<number> = new Set(), title = 'Grocery list'): string {
    const out = [title, ''];
    for (const g of groups) {
        out.push(g.aisle.toUpperCase());
        for (const l of g.lines) out.push(`${checked.has(l.foodId) ? '[x]' : '[ ]'} ${l.name}: ${lineAmount(l)}`);
        out.push('');
    }
    return out.join('\n').trimEnd() + '\n';
}

/** One CSV field: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvField(v: string | number): string {
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function groceryCsv(groups: readonly GroceryGroup[], checked: ReadonlySet<number> = new Set()): string {
    const rows = [['Aisle', 'Food', 'Grams', 'Amount', 'Household', 'USDA FDC id', 'Got it']];
    for (const g of groups) {
        for (const l of g.lines) {
            rows.push([g.aisle, l.name, String(l.grams), l.amount, l.recipe ? 'shop from the recipe' : l.household ?? '', l.recipe ? '' : String(l.fdcId), checked.has(l.foodId) ? 'yes' : '']);
        }
    }
    return rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
