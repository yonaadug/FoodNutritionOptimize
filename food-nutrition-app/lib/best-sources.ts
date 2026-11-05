import type { Food } from './food-types';
import { nutrientValue } from './food-types';
import { NUTRIENT_CONFIG } from './nutrient-defaults';
import { typicalServing } from './servings';

/**
 * "Good sources of X" for people, not for a lab: rank foods by how much of a
 * nutrient a realistic serving provides, prefer everyday single foods with
 * well-measured data, and keep supplements, powders, organ meats and other
 * specialty items out unless nothing else qualifies.
 */

export type SourceTier = 0 | 1 | 2;

export interface RankedSource {
    food: Food;
    /** 0 everyday food, 1 reasonable but less typical, 2 specialty (supplements, powders, organ meats...). */
    tier: SourceTier;
    /** Why a food is not tier 0 (for debugging and tests). */
    reason?: string;
    servingLabel: string;
    servingGrams: number;
    perServing: number;
    per100g: number;
}

/** Hard exclusions: concentrated, medicinal or specialty items. */
const SPECIALTY_PATTERNS: [RegExp, string][] = [
    [/\b(tablets?|capsules?|supplements?|rennin|meal replacement|shake mix|protein powder|nutritional (shake|drink))\b/i, 'supplement'],
    [/\b(infant|baby ?food|babyfood|toddler|formula)\b/i, 'baby food'],
    [/\b(powder(ed)?|dry mix|drink mix|freeze-dried|dehydrated|concentrate|instant)\b/i, 'powder or concentrate'],
    [/\b(liver|livers|giblets?|variety meats|by-products|spleen|chitterlings|gizzards?|testes|sweetbreads?|mountain oysters)\b/i, 'organ meat'],
    [/\b(leavening|yeast|gelatin|baking (powder|soda)|cream of tartar)\b/i, 'baking ingredient'],
    [/\b(fish oil|cod liver)\b/i, 'oil'],
];

/** Organ words that are only organs in a meat context ("kidney beans", "artichoke hearts" are fine). */
const ORGAN_IN_MEAT = /\b(kidneys?|lungs?|brains?|pancreas|thymus|tripe|hearts?|tongue)\b/i;
const MEAT_CATEGORY = /(beef|pork|poultry|lamb|veal|game|sausages|finfish)/i;

const HARD_CATEGORIES: [RegExp, string][] = [
    [/spices and herbs/i, 'spice'],
    [/baby foods/i, 'baby food'],
    [/american indian|alaska native/i, 'regional specialty'],
];

/** Softer signals: fine to suggest, just not first. */
const SOFT_PATTERNS: [RegExp, string][] = [
    [/\b(fortified|with added|enhanced)\b/i, 'fortified'],
    [/\b(meatless|vegetarian (meat|burger)|meat substitute)\b/i, 'meat substitute'],
    [/\b(alaska native|northern plains|apache|navajo|hopi|shoshone|bannock)\b/i, 'regional specialty'],
    [/\b(fast food|restaurant)\b/i, 'restaurant food'],
    [/\b(mix|pickled|candied|syrup|breaded|battered|fried)\b/i, 'processed'],
];

const SOFT_CATEGORIES: [RegExp, string][] = [
    [/fats and oils/i, 'oil'],
    [/breakfast cereals/i, 'breakfast cereal'],
    [/beverages/i, 'beverage'],
    [/sweets|snacks/i, 'snack'],
    [/fast foods|restaurant foods/i, 'restaurant food'],
    [/sausages and luncheon/i, 'processed meat'],
    [/soups, sauces/i, 'sauce or soup'],
    [/meals, entrees|mixed dishes|sandwiches|pizza|burgers|burritos/i, 'mixed dish'],
];

/**
 * Everyday foods most people would recognise and buy. A food is "familiar"
 * when one of these names its first segment (or second after a group prefix
 * such as "Fish," or "Nuts,"). Deliberately broad; obscure entries (moth
 * beans, pokeberry shoots, Canada goose) fall to tier 1 rather than out.
 */
const COMMON_FOODS = new Set(`
apple apricot avocado banana blackberry blueberry cantaloupe cherry clementine cranberry date fig grape grapefruit guava
kiwifruit kiwi lemon lime mango melon nectarine orange papaya peach pear pineapple plum pomegranate prune raisin raspberry
strawberry tangerine watermelon
artichoke arugula asparagus bean beet bok broccoli brussels cabbage carrot cauliflower celery chard collard corn cucumber potato
edamame eggplant endive fennel garlic kale leek lettuce mushroom okra onion parsnip pea pepper potato pumpkin radish
romaine shallot spinach sprout squash tomato turnip watercress yam zucchini greens
lentil chickpea hummus tofu tempeh soymilk peanut edamame
pinto navy kidney lima cannellini garbanzo mung fava mustard
almond cashew hazelnut macadamia pecan pistachio walnut sunflower pumpkin sesame flaxseed flax chia hemp
milk yogurt cheese kefir egg butter cottage ricotta mozzarella cheddar parmesan swiss feta
salmon tuna sardine trout cod halibut mackerel herring tilapia catfish pollock haddock anchovy shrimp crab lobster scallop
clam mussel oyster squid
chicken turkey beef pork lamb ham bison venison
oat oatmeal rice quinoa barley buckwheat millet bulgur couscous pasta spaghetti noodle bread bagel tortilla cereal granola
wheat cracker
`.split(/\s+/).filter(Boolean));

const GROUP_PREFIX = /^(fish|nuts|seeds|beans|cheese|mollusks|crustaceans|game meat|beverages|cereals ready-to-eat|cereals|spices|vegetable|fruit)$/i;

/** Words that qualify a food without naming it ("sweet", "frozen", "low fat"). */
const MODIFIERS = new Set(`
sweet green red white black brown yellow purple golden whole baby mixed plain fresh frozen canned raw cooked low fat nonfat
reduced lean ground wild dried roasted toasted boiled baked of and or with without in style common regular large small medium
hard soft firm silken greek light skim young great northern kernel kernels seed seeds butter nut nuts hulled
`.split(/\s+/).filter(Boolean));

function words(s: string): string[] {
    return s.toLowerCase().match(/[a-z]+/g) ?? [];
}

function singular(w: string): string[] {
    return [w, w.replace(/ies$/, 'y'), w.replace(/oes$/, 'o'), w.replace(/es$/, ''), w.replace(/s$/, '')];
}

const known = (w: string) => singular(w).some(f => COMMON_FOODS.has(f));

/**
 * Does the food's name (its first segment, or second after a group prefix
 * such as "Fish," or "Beans,") name a common food? Every word must be a known
 * food or a plain modifier, so "Hyacinth beans" and "Mothbeans" do not pass.
 */
export function isFamiliarFood(description: string): boolean {
    const segs = description.split(',').map(x => x.trim());
    const grouped = GROUP_PREFIX.test(segs[0] ?? '');
    const head = grouped ? segs[1] ?? '' : segs[0] ?? '';
    let named = grouped && words(segs[0]).some(known);
    const ws = words(head);
    if (ws.length === 0) return named;
    for (const w of ws) {
        if (known(w)) named = true;
        else if (!MODIFIERS.has(w)) return false;
    }
    return named;
}

/** Uncooked dry legumes and grains, brans, flours and similar ingredients (concentrated per serving). */
function isDryIngredient(food: Food): boolean {
    const d = food.description.toLowerCase();
    const cat = food.food_category ?? '';
    if (/\b(bran|germ|gluten|flour|meal|starch|semolina|crude)\b/.test(d) && !/oatmeal/.test(d)) return true;
    const cooked = /\b(?<!un)cooked\b|\bboiled\b|\bcanned\b|\bsprouted\b|\bprepared\b/.test(d);
    if (/legume/i.test(cat) && (/mature seeds?/.test(d) || /\b(raw|uncooked|dry)\b/.test(d)) && !cooked && !/\b(tofu|soymilk|hummus|edamame|peanut)/.test(d)) return true;
    if (/cereal grains/i.test(cat) && !cooked && !/^(bread|pasta|noodles|tortilla)/.test(d)) return true;
    return false;
}

/** A word in capitals (USDA's convention for brand names: "RALSTON", "KELLOGG'S"). */
const BRAND = /\b[A-Z][A-Z'&.-]{2,}\b/;

/** "dried"/"dry" mark concentrates, except dried fruit and cooking methods ("dry heat", "dry roasted"). */
function isDriedConcentrate(food: Food): boolean {
    const d = food.description;
    if (!/\b(dried|dry)\b/i.test(d)) return false;
    if (/fruits?/i.test(food.food_category ?? '') || /\b(beans?|peas|lentils|legumes?)\b/i.test(d)) return false;
    const cleaned = d.replace(/\bdry[- ](heat|roasted|cooked)\b/gi, '');
    return /\b(dried|dry)\b/i.test(cleaned);
}

/** Share of the FDA Daily Value nutrients that USDA measured for this food. */
export function dataCoverage(food: Food): number {
    const keys = Object.keys(NUTRIENT_CONFIG).filter(k => k !== 'calories' && NUTRIENT_CONFIG[k].defaultEnabled !== false);
    return keys.filter(k => nutrientValue(food, k) !== null).length / keys.length;
}

/** Energy and macros recorded (not "Limited data"). */
function hasCore(food: Food): boolean {
    const cal = nutrientValue(food, 'calories');
    if (cal === null) return false;
    return cal > 0 || ['protein_g', 'total_fat_g', 'carbohydrate_g'].some(k => (nutrientValue(food, k) ?? 0) > 0);
}

/** Classify a food for suggestions. */
export function sourceTier(food: Food): { tier: SourceTier; reason?: string } {
    const d = food.description ?? '';
    const cat = food.food_category ?? '';
    for (const [re, why] of SPECIALTY_PATTERNS) if (re.test(d)) return { tier: 2, reason: why };
    if (MEAT_CATEGORY.test(cat) && ORGAN_IN_MEAT.test(d)) return { tier: 2, reason: 'organ meat' };
    for (const [re, why] of HARD_CATEGORIES) if (re.test(cat)) return { tier: 2, reason: why };
    if (isDriedConcentrate(food)) return { tier: 2, reason: 'powder or concentrate' };
    if (!hasCore(food)) return { tier: 2, reason: 'limited data' };
    for (const [re, why] of SOFT_PATTERNS) if (re.test(d)) return { tier: 1, reason: why };
    if (isDryIngredient(food)) return { tier: 1, reason: 'uncooked or ingredient form' };
    if (/\b(skin only|imitation|substitute)\b/i.test(d)) return { tier: 1, reason: 'unusual form' };
    for (const [re, why] of SOFT_CATEGORIES) if (re.test(cat)) return { tier: 1, reason: why };
    if (BRAND.test(d)) return { tier: 1, reason: 'brand-name product' };
    if ((food.data_type_rank ?? 2) >= 3) return { tier: 1, reason: 'mixed dish' };
    if (dataCoverage(food) < 0.6) return { tier: 1, reason: 'sparse data' };
    if (!isFamiliarFood(d)) return { tier: 1, reason: 'less common food' };
    return { tier: 0 };
}

/** Near-duplicates share a group ("Fish, salmon, sockeye, raw" and "Fish, salmon, pink, canned"). */
function groupKey(food: Food): string {
    const segs = food.description.toLowerCase().split(',').map(s => s.trim());
    const head = GROUP_PREFIX.test(segs[0] ?? '') ? segs[1] ?? segs[0] : segs[0] ?? '';
    // "Fish, salmon, ..." and "Salmon, sockeye, canned" are the same food.
    return head.replace(/(es|s)$/, '');
}

export interface RankOptions {
    limit?: number;
    /** Food ids to leave out (already on the user's list). */
    exclude?: Iterable<number>;
    /** At most this many foods per near-duplicate group (default 1). */
    perGroup?: number;
    /**
     * true (default): everyday foods first, specialty items only to fill up.
     * false: every food with the nutrient, by amount per serving.
     */
    everyday?: boolean;
}

/** Score every food that has the nutrient (cacheable: depends only on the data). */
export function scoreSources(foods: Food[], nutrient: string): RankedSource[] {
    const out: RankedSource[] = [];
    for (const food of foods) {
        if (food.superseded_by_fdc_id) continue;
        const per100g = nutrientValue(food, nutrient);
        if (per100g === null || !(per100g > 0)) continue;
        const { tier, reason } = sourceTier(food);
        const { label, grams } = typicalServing(food.serving_sizes, food);
        out.push({ food, tier, reason, servingLabel: label, servingGrams: grams, per100g, perServing: per100g * grams / 100 });
    }
    return out;
}

/** Order scored foods and take the top `limit` (see rankBestSources). */
export function pickSources(scored: RankedSource[], opts: RankOptions = {}): RankedSource[] {
    const limit = Math.max(1, opts.limit ?? 20);
    const everyday = opts.everyday !== false;
    const perGroup = Math.max(1, opts.perGroup ?? (everyday ? 1 : 3));
    const exclude = new Set(opts.exclude ?? []);
    const ranked = scored.filter(r => !exclude.has(r.food.id));
    ranked.sort((a, b) => (everyday ? a.tier - b.tier : 0) || b.perServing - a.perServing ||
        (a.food.data_type_rank ?? 9) - (b.food.data_type_rank ?? 9) || a.food.description.length - b.food.description.length || a.food.id - b.food.id);

    const out: RankedSource[] = [];
    const groups = new Map<string, number>();
    for (const r of ranked) {
        const g = groupKey(r.food);
        const n = groups.get(g) ?? 0;
        if (n >= perGroup) continue;
        groups.set(g, n + 1);
        out.push(r);
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * Rank foods by `nutrient` per realistic serving, everyday foods first.
 * Always returns up to `limit` foods when any food has the nutrient: tier 1
 * and then tier 2 fill in only when better tiers run out.
 */
export function rankBestSources(foods: Food[], nutrient: string, opts: RankOptions = {}): RankedSource[] {
    return pickSources(scoreSources(foods, nutrient), opts);
}
