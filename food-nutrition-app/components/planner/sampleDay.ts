import type { Food } from '@/lib/food-types';
import { fetchSearch } from '@/hooks/useFoodSearch';
import { DEFAULT_GOAL_KEYS, hasCoreData, nv } from './nutrients';

/**
 * "Try a sample day": a varied set of everyday staples.
 * Foods are found by search (not hard-coded IDs) so this keeps working when
 * the database is rebuilt or grows. Each pick prefers the entry with the
 * fullest USDA data, and `need` makes sure the nutrients a staple is known
 * for were actually measured (salmon and fortified milk with vitamin D), so
 * the plan does not count real nutrients as 0.
 */
export interface SampleItem {
    q: string;
    /** The description must start with one of these ("Fish, salmon", not "Rice, brown, with carrots"). */
    head: string[];
    prefer: string[];
    avoid?: string[];
    /** Nutrients this staple must have measured (non-null). */
    need?: string[];
}

export const SAMPLE_DAY: SampleItem[] = [
    { q: 'oats', head: ['oats', 'cereals, oats, regular'], prefer: ['not fortified, dry', 'rolled', 'whole grain', 'regular and quick'], avoid: ['flour', 'bran', 'instant', 'flavored', 'cooked', 'prepared', 'beverage', 'milk', 'puffed'], need: ['iron_mg', 'fiber_g', 'saturated_g'] },
    { q: 'salmon', head: ['fish, salmon', 'salmon'], prefer: ['cooked', 'dry heat', 'atlantic', 'sockeye'], avoid: ['smoked', 'canned', 'nugget', 'salad', 'cake', 'alaska native', 'kippered', 'dried', 'oil', 'liver'], need: ['vitamin_d_ug', 'saturated_g'] },
    { q: 'spinach', head: ['spinach'], prefer: ['raw', 'mature', 'baby'], avoid: ['canned', 'frozen', 'cooked', 'creamed', 'dip', 'souffle', 'mustard', 'new zealand', 'water'], need: ['iron_mg', 'vitamin_a_ug', 'calcium_mg'] },
    { q: 'yogurt', head: ['yogurt'], prefer: ['greek', 'plain', 'nonfat', 'low fat'], avoid: ['frozen', 'fruit', 'vanilla', 'flavored', 'dressing', 'chocolate', 'strawberry', 'soy', 'coconut'], need: ['calcium_mg', 'saturated_g'] },
    { q: 'banana', head: ['bananas'], prefer: ['bananas, raw', 'ripe and slightly ripe'], avoid: ['chips', 'dried', 'overripe', 'bread', 'pudding', 'pepper', 'cooked', 'fried'], need: ['potassium_mg'] },
    { q: 'almonds', head: ['nuts, almonds'], prefer: ['raw', 'nuts, almonds'], avoid: ['butter', 'milk', 'flour', 'paste', 'oil roasted', 'blanched', 'honey', 'chocolate', 'salted', 'beverage'], need: ['calcium_mg', 'iron_mg'] },
    { q: 'broccoli', head: ['broccoli'], prefer: ['broccoli, raw'], avoid: ['frozen', 'raab', 'chinese', 'cooked', 'soup', 'cheese', 'casserole', 'stalks', 'leaves', 'flower clusters'], need: ['vitamin_c_mg', 'vitamin_a_ug'] },
    { q: 'chicken breast', head: ['chicken'], prefer: ['meat only', 'roasted', 'cooked'], avoid: ['skin', 'nugget', 'ground', 'fried', 'breaded', 'tenders', 'uncooked', 'raw', 'patty', 'sandwich', 'deli', 'rotisserie', 'canned', 'lunch'], need: ['saturated_g', 'iron_mg'] },
    { q: 'orange', head: ['oranges'], prefer: ['raw', 'navel', 'all commercial varieties'], avoid: ['juice', 'peel', 'mandarin', 'chicken', 'drink', 'sherbet', 'marmalade', 'roughy'], need: ['vitamin_c_mg'] },
    { q: 'whole wheat bread', head: ['bread'], prefer: ['whole-wheat', 'commercially prepared'], avoid: ['flour', 'crumbs', 'pita', 'toasted', 'roll', 'sandwich', 'french', 'stuffing'], need: ['fiber_g', 'iron_mg'] },
    { q: 'carrots', head: ['carrots'], prefer: ['carrots, raw', 'baby'], avoid: ['juice', 'canned', 'cooked', 'frozen', 'dehydrated', 'cake', 'pickled'], need: ['vitamin_a_ug'] },
    { q: 'sunflower', head: ['seeds, sunflower'], prefer: ['kernels', 'dry roasted', 'without salt'], avoid: ['oil', 'butter', 'flour', 'toasted', 'with salt'], need: ['iron_mg'] },
    { q: 'egg whole', head: ['egg'], prefer: ['egg, whole', 'hard-boiled', 'cooked', 'raw, fresh'], avoid: ['white', 'yolk', 'dried', 'plant', 'eggplant', 'substitute', 'duck', 'goose', 'quail', 'turkey', 'frozen', 'omelet', 'salad', 'fried', 'scrambled', 'sandwich', 'roll', 'noodle'], need: ['saturated_g', 'vitamin_a_ug'] },
    { q: 'kale', head: ['kale'], prefer: ['kale, raw'], avoid: ['frozen', 'chips', 'cooked', 'scotch'], need: ['vitamin_c_mg', 'calcium_mg'] },
    { q: 'milk', head: ['milk'], prefer: ['reduced fat', '2%', 'with added vitamin a and vitamin d', 'fluid'], avoid: ['without added', 'buttermilk', 'dry', 'condensed', 'evaporated', 'chocolate', 'yogurt', 'cheese', 'coconut', 'soy', 'almond', 'goat', 'human', 'shake', 'imitation', 'canned', 'lactose'], need: ['vitamin_d_ug', 'calcium_mg', 'saturated_g'] },
];

function completeness(food: Food): number {
    return DEFAULT_GOAL_KEYS.filter(k => nv(food, k) !== null).length / Math.max(1, DEFAULT_GOAL_KEYS.length);
}

/** How well a search result fits a sample item (higher is better; -Infinity = unusable). */
export function sampleScore(food: Food, item: SampleItem): number {
    const d = food.description.toLowerCase();
    if (!hasCoreData(food)) return -Infinity;
    if (!item.head.some(h => d.startsWith(h))) return -Infinity;
    let s = completeness(food) * 12; // prefer foods with fuller nutrient data
    item.prefer.forEach((p, i) => { if (d.includes(p)) s += 10 - i; });
    item.avoid?.forEach(a => { if (d.includes(a)) s -= 25; });
    item.need?.forEach(k => { if (nv(food, k) === null) s -= 30; });
    return s - d.length / 40;
}

/** The best search result for a sample item, or null. */
export function pickSampleFood(foods: Food[], item: SampleItem): Food | null {
    let best: Food | null = null;
    let bestScore = -Infinity;
    for (const f of foods) {
        const s = sampleScore(f, item);
        if (s > bestScore) { bestScore = s; best = f; }
    }
    return bestScore > -Infinity ? best : null;
}

/** Resolve the sample day into real foods from the current database. */
export async function loadSampleDay(): Promise<Food[]> {
    const picks = await Promise.all(SAMPLE_DAY.map(async item => {
        try {
            // Include SR Legacy rows that a newer Foundation entry replaced: they
            // often have the fuller nutrient profile (e.g. saturated fat, vitamin D).
            const { foods } = await fetchSearch(item.q, 1, 60, undefined, { includeSuperseded: true });
            return pickSampleFood(foods, item);
        } catch {
            return null;
        }
    }));
    const seen = new Set<number>();
    return picks.filter((f): f is Food => !!f && !seen.has(f.id) && !!seen.add(f.id));
}
