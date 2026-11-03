import type { Food } from '@/lib/food-types';
import { fetchSearch } from '@/hooks/useFoodSearch';
import { DEFAULT_GOAL_KEYS, hasCoreData, nv } from './nutrients';

/**
 * "Try a sample day": a varied set of everyday staples.
 * Foods are found by search (not hard-coded IDs) so this keeps working when
 * the database is rebuilt or grows.
 */
interface SampleItem { q: string; prefer: string[]; avoid?: string[] }

export const SAMPLE_DAY: SampleItem[] = [
    { q: 'oats', prefer: ['rolled', 'whole grain'], avoid: ['flour', 'bran'] },
    { q: 'salmon', prefer: ['atlantic', 'raw', 'cooked'], avoid: ['smoked', 'canned'] },
    { q: 'spinach', prefer: ['raw', 'mature', 'baby'], avoid: ['canned'] },
    { q: 'yogurt', prefer: ['greek', 'plain'], avoid: ['frozen'] },
    { q: 'banana', prefer: ['raw', 'ripe'], avoid: ['chips', 'dried'] },
    { q: 'almonds', prefer: ['raw', 'whole'], avoid: ['butter', 'milk', 'flour'] },
    { q: 'broccoli', prefer: ['raw'], avoid: ['frozen'] },
    { q: 'chicken breast', prefer: ['broiler', 'meat only', 'roasted', 'cooked'], avoid: ['skin', 'nugget', 'ground', 'fried', 'breaded', 'tenders', 'uncooked', 'patty', 'sandwich', 'deli'] },
    { q: 'orange', prefer: ['raw', 'navel'], avoid: ['juice', 'peel'] },
    { q: 'bread', prefer: ['whole-wheat', 'whole wheat'], avoid: ['flour', 'crumbs'] },
    { q: 'carrots', prefer: ['raw', 'baby'], avoid: ['juice', 'canned'] },
    { q: 'sunflower', prefer: ['kernel', 'raw'], avoid: ['oil', 'butter'] },
    { q: 'egg whole', prefer: ['egg, whole', 'hard-boiled', 'cooked', 'raw, fresh'], avoid: ['white', 'yolk', 'dried', 'plant', 'eggplant', 'substitute', 'duck', 'goose', 'quail', 'turkey', 'frozen', 'omelet', 'salad'] },
    { q: 'kale', prefer: ['raw'], avoid: ['frozen', 'chips'] },
    { q: 'milk', prefer: ['whole', 'reduced fat', '2%'], avoid: ['buttermilk', 'dry', 'condensed', 'evaporated', 'chocolate', 'yogurt', 'cheese', 'coconut', 'soy', 'almond'] },
];

function completeness(food: Food): number {
    return DEFAULT_GOAL_KEYS.filter(k => nv(food, k) !== null).length / Math.max(1, DEFAULT_GOAL_KEYS.length);
}

function score(food: Food, item: SampleItem): number {
    const d = food.description.toLowerCase();
    if (!hasCoreData(food)) return -Infinity;
    let s = completeness(food) * 8; // prefer foods with fuller nutrient data
    if (d.startsWith(item.q)) s += 3;
    item.prefer.forEach((p, i) => { if (d.includes(p)) s += 10 - i; });
    item.avoid?.forEach(a => { if (d.includes(a)) s -= 25; });
    return s - d.length / 40;
}

/** Resolve the sample day into real foods from the current database. */
export async function loadSampleDay(): Promise<Food[]> {
    const picks = await Promise.all(SAMPLE_DAY.map(async item => {
        try {
            const { foods } = await fetchSearch(item.q, 1, 50);
            let best: Food | null = null;
            let bestScore = -Infinity;
            for (const f of foods) {
                const s = score(f, item);
                if (s > bestScore) { bestScore = s; best = f; }
            }
            return bestScore > -Infinity ? best : null;
        } catch {
            return null;
        }
    }));
    const seen = new Set<number>();
    return picks.filter((f): f is Food => !!f && !seen.has(f.id) && !!seen.add(f.id));
}
