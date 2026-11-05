import { ALL_NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';
import { DEFAULT_GOAL_KEYS, GOAL_KEYS, type NutrientKey } from './nutrients';

/** A goal for one nutrient. Both bounds empty = goal is off. */
export interface GoalRange {
    min?: number;
    max?: number;
}

export type Goals = Record<NutrientKey, GoalRange>;

export interface CalorieRange {
    min?: number;
    max?: number;
}

/**
 * "Keep portions realistic": when enabled, each food is capped at `servings`
 * typical servings and at `grams`, whichever is lower. `servings` is absent in
 * state saved by older versions (it then defaults to 3).
 */
export interface PortionCap {
    enabled: boolean;
    grams: number;
    servings?: number;
}

export type PresetId = 'essentials' | 'fda' | 'high-protein' | 'lower-carb' | 'custom';

export interface GoalPreset {
    id: Exclude<PresetId, 'custom'>;
    title: string;
    blurb: string;
    calories: CalorieRange;
    goals: Goals;
}

export function isGoalOn(g: GoalRange | undefined): boolean {
    return !!g && (g.min !== undefined || g.max !== undefined);
}

/** The FDA Daily Value for a nutrient, as a floor ("at least") or ceiling ("at most"). */
export function fdaGoal(key: NutrientKey): GoalRange {
    const cfg = ALL_NUTRIENT_CONFIG[key];
    if (!cfg) return {};
    return cfg.defaultType === 'max' ? { max: cfg.defaultValue } : { min: cfg.defaultValue };
}

function pick(keys: NutrientKey[], overrides: Goals = {}): Goals {
    const out: Goals = {};
    for (const k of keys) if (ALL_NUTRIENT_CONFIG[k]) out[k] = fdaGoal(k);
    for (const [k, v] of Object.entries(overrides)) if (ALL_NUTRIENT_CONFIG[k]) out[k] = v;
    return out;
}

export const GOAL_PRESETS: GoalPreset[] = [
    {
        id: 'essentials',
        title: 'Everyday essentials',
        blurb: 'The nutrients most people should watch: protein, fiber, key vitamins & minerals, with limits on salt and saturated fat.',
        calories: { min: 1800, max: 2200 },
        goals: pick(['protein_g', 'fiber_g', 'calcium_mg', 'iron_mg', 'potassium_mg', 'vitamin_a_ug', 'vitamin_c_mg', 'saturated_g', 'sodium_mg']),
    },
    {
        id: 'fda',
        title: 'Standard adult (FDA Daily Values)',
        blurb: 'Every vitamin and mineral with an FDA Daily Value, at 100%. Thorough, but needs a wide variety of foods.',
        calories: { min: 1800, max: 2200 },
        goals: pick(DEFAULT_GOAL_KEYS),
    },
    {
        id: 'high-protein',
        title: 'High protein',
        blurb: 'At least 120 g protein for active days, with plenty of fiber and the usual limits.',
        calories: { min: 2000, max: 2600 },
        goals: pick(['fiber_g', 'saturated_g', 'sodium_mg', 'calcium_mg', 'potassium_mg'], { protein_g: { min: 120 } }),
    },
    {
        id: 'lower-carb',
        title: 'Lower carb',
        blurb: 'Carbs capped at 100 g, with at least 90 g protein and 20 g fiber.',
        calories: { min: 1600, max: 2000 },
        goals: pick(['saturated_g', 'sodium_mg'], {
            carbohydrate_g: { max: 100 }, protein_g: { min: 90 }, fiber_g: { min: 20 },
        }),
    },
];

export const DEFAULT_PRESET: GoalPreset = GOAL_PRESETS[0];

export const DEFAULT_PORTION_SERVINGS = 3;
export const DEFAULT_PORTION_CAP: PortionCap = { enabled: true, grams: 300, servings: DEFAULT_PORTION_SERVINGS };

/** The next, more generous portion setting (used by the "Allow bigger portions" quick fix). */
export function biggerPortions(cap: PortionCap): PortionCap {
    if (!cap.enabled) return cap;
    const servings = cap.servings ?? DEFAULT_PORTION_SERVINGS;
    if (servings >= 6 && cap.grams >= 600) return { ...cap, enabled: false };
    return { enabled: true, servings: Math.max(6, servings), grams: Math.max(600, cap.grams) };
}

/** Plain-words description of a portion setting. */
export function describePortionCap(cap: PortionCap): string {
    if (!cap.enabled) return 'No general limit on how much of one food the plan uses';
    const servings = cap.servings ?? DEFAULT_PORTION_SERVINGS;
    return `At most ${servings} ${servings === 1 ? 'serving' : 'servings'} or ${cap.grams.toLocaleString()} g of any one food`;
}

export function presetById(id: PresetId): GoalPreset | undefined {
    return GOAL_PRESETS.find(p => p.id === id);
}

export function presetTitle(id: PresetId): string {
    return presetById(id)?.title ?? 'Custom goals';
}

export function countGoals(goals: Goals): number {
    return GOAL_KEYS.filter(k => isGoalOn(goals[k])).length;
}

/**
 * Build the `customConstraints` object for /api/optimize.
 * Every nutrient is sent explicitly as { min, max }; '' means "no bound" and
 * {min:'', max:''} means "no goal" (an absent key would fall back to the
 * optimizer's default instead).
 */
export function goalsToPayload(goals: Goals): Record<string, { min: number | ''; max: number | '' }> {
    const out: Record<string, { min: number | ''; max: number | '' }> = {};
    for (const k of GOAL_KEYS) {
        const g = goals[k] ?? {};
        out[k] = { min: g.min ?? '', max: g.max ?? '' };
    }
    return out;
}

/**
 * Migrate the legacy `customConstraints` localStorage value (3 historical
 * shapes) into Goals. Missing keys fall back to the optimizer default (if that
 * nutrient is a default goal), matching how the old UI behaved.
 */
export function migrateLegacyGoals(raw: unknown): Goals {
    const out: Goals = {};
    const parsed = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    for (const k of GOAL_KEYS) {
        const val = parsed[k];
        const cfg = ALL_NUTRIENT_CONFIG[k];
        const fallback = DEFAULT_GOAL_KEYS.includes(k) ? fdaGoal(k) : {};
        if (val && typeof val === 'object') {
            const v = val as Record<string, unknown>;
            if (v.min !== undefined || v.max !== undefined) {
                const min = typeof v.min === 'number' ? v.min : undefined;
                const max = typeof v.max === 'number' ? v.max : undefined;
                out[k] = (min === undefined && max === undefined) ? fallback : { min, max };
                continue;
            }
            if (v.value !== undefined) {
                const n = parseFloat(String(v.value));
                if (Number.isFinite(n)) { out[k] = v.type === 'max' ? { max: n } : { min: n }; continue; }
            }
        } else if (typeof val === 'number' || typeof val === 'string') {
            const n = parseFloat(String(val));
            if (Number.isFinite(n) && cfg) { out[k] = cfg.defaultType === 'max' ? { max: n } : { min: n }; continue; }
        }
        out[k] = fallback;
    }
    return out;
}

/** Which preset (if any) exactly matches these goals + calories? */
export function matchPreset(goals: Goals, calories: CalorieRange): PresetId {
    const same = (a: GoalRange = {}, b: GoalRange = {}) => a.min === b.min && a.max === b.max;
    for (const p of GOAL_PRESETS) {
        if (!same(calories, p.calories)) continue;
        if (GOAL_KEYS.every(k => same(goals[k], p.goals[k]))) return p.id;
    }
    return 'custom';
}
