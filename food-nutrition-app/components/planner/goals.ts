import { NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';
import { GOAL_KEYS, type NutrientKey } from './nutrients';

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

export interface PortionCap {
    enabled: boolean;
    grams: number;
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
    const cfg = NUTRIENT_CONFIG[key];
    if (!cfg) return {};
    return cfg.defaultType === 'max' ? { max: cfg.defaultValue } : { min: cfg.defaultValue };
}

function pick(keys: NutrientKey[], overrides: Goals = {}): Goals {
    const out: Goals = {};
    for (const k of keys) if (NUTRIENT_CONFIG[k]) out[k] = fdaGoal(k);
    for (const [k, v] of Object.entries(overrides)) if (NUTRIENT_CONFIG[k]) out[k] = v;
    return out;
}

export const GOAL_PRESETS: GoalPreset[] = [
    {
        id: 'essentials',
        title: 'Everyday essentials',
        blurb: 'The 10 nutrients most people should watch: protein, fiber, key vitamins & minerals, and limits on salt, sugar and saturated fat.',
        calories: { min: 1800, max: 2200 },
        goals: pick(['protein_g', 'fiber_g', 'calcium_mg', 'iron_mg', 'potassium_mg', 'vitamin_a_ug', 'vitamin_c_mg', 'saturated_g', 'sodium_mg', 'sugars_g']),
    },
    {
        id: 'fda',
        title: 'Standard adult (FDA Daily Values)',
        blurb: 'Every tracked vitamin and mineral at 100% of the FDA Daily Value. Thorough, but needs a wide variety of foods.',
        calories: { min: 1800, max: 2200 },
        goals: pick(GOAL_KEYS),
    },
    {
        id: 'high-protein',
        title: 'High protein',
        blurb: 'At least 120 g protein for active days, with plenty of fiber and the usual limits.',
        calories: { min: 2000, max: 2600 },
        goals: pick(['fiber_g', 'saturated_g', 'sodium_mg', 'sugars_g'], { protein_g: { min: 120 } }),
    },
    {
        id: 'lower-carb',
        title: 'Lower carb',
        blurb: 'Carbs capped at 100 g and sugars at 30 g, with protein at least 90 g.',
        calories: { min: 1600, max: 2000 },
        goals: pick(['saturated_g', 'sodium_mg'], {
            carbohydrate_g: { max: 100 }, protein_g: { min: 90 }, fiber_g: { min: 20 }, sugars_g: { max: 30 },
        }),
    },
];

export const DEFAULT_PRESET: GoalPreset = GOAL_PRESETS[0];

export const DEFAULT_PORTION_CAP: PortionCap = { enabled: true, grams: 300 };

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
 * Every nutrient is sent explicitly; '' means "no limit", which the optimizer
 * honours (an absent key would fall back to the FDA default instead).
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
 * shapes) into Goals. Missing keys fall back to the FDA default, matching how
 * the old UI + optimizer behaved.
 */
export function migrateLegacyGoals(raw: unknown): Goals {
    const out: Goals = {};
    const parsed = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    for (const k of GOAL_KEYS) {
        const val = parsed[k];
        const cfg = NUTRIENT_CONFIG[k];
        if (val && typeof val === 'object') {
            const v = val as Record<string, unknown>;
            if (v.min !== undefined || v.max !== undefined) {
                const min = typeof v.min === 'number' ? v.min : undefined;
                const max = typeof v.max === 'number' ? v.max : undefined;
                out[k] = (min === undefined && max === undefined) ? fdaGoal(k) : { min, max };
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
        out[k] = fdaGoal(k);
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
