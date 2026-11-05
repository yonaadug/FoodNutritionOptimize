import { NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';
import type { Food } from '@/lib/food-types';
import type { PlanResult, PlanWarning } from '@/hooks/usePlan';
import { hasCoreData, nutrientLabel, num, shortFoodName } from '@/components/planner/nutrients';

export type GoalStatus = 'met' | 'low' | 'high' | 'unknown';

export interface GoalProgress {
    key: string;
    /**
     * 'goal'   : something the user asked for (counts toward "goals met").
     * 'safety' : only a safe upper limit applies ("Respect safe upper limits");
     *            shown separately and never counted as a goal.
     */
    kind: 'goal' | 'safety';
    /** The user's own bounds. */
    min?: number;
    max?: number;
    /** Tolerable Upper Intake Level the planner also respected, if any. */
    safeMax?: number;
    value: number | null;
    status: GoalStatus;
    /**
     * Foods in the plan that USDA has no value for (counted as 0). When
     * non-empty, `value` is only a floor: the real total is at least this.
     */
    missing: string[];
    /** A limit that looks met but could be exceeded because of missing data. */
    uncertain: boolean;
}

/** Names of in-plan foods with no data, per nutrient key, from the API warnings. */
export function missingByNutrient(result: PlanResult): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const usedIds = new Set((result.diet ?? []).map(d => d.food.id));
    for (const w of Array.isArray(result.warnings) ? result.warnings : []) {
        if (!w || typeof w !== 'object' || !Array.isArray(w.nutrients)) continue;
        // Only foods the plan actually uses (fixed foods always are).
        const inPlan = w.inDiet === true || w.role === 'guaranteed' || (typeof w.foodId === 'number' && usedIds.has(w.foodId));
        if (!inPlan) continue;
        const name = shortFoodName(String(w.description ?? w.foodName ?? w.food ?? 'A food'));
        for (const n of w.nutrients) (out[String(n)] ??= []).push(name);
    }
    return out;
}

/**
 * Compare plan totals against the limits the optimizer actually used.
 * Upper limits added by "Respect safe upper limits" are reported as
 * `safeMax`, never as the user's `max`, so a nutrient with no goal (e.g.
 * vitamin D in Everyday essentials) does not become an "on target" goal.
 * Totals that include foods without data are flagged as floors.
 */
export function goalProgress(result: PlanResult): GoalProgress[] {
    const limits = result.constraintLimits ?? {};
    const ulKeys = new Set(Array.isArray(result.upperLimitKeys) ? result.upperLimitKeys : []);
    const missingMap = missingByNutrient(result);
    return Object.entries(limits).map(([key, lim]): GoalProgress => {
        const value = key === 'calories' ? num(result.totalCalories) : num(result.totalNutrients?.[key]);
        const min = num(lim?.min) ?? undefined;
        const rawMax = num(lim?.max) ?? undefined;
        const fromUl = ulKeys.has(key);
        const max = fromUl ? undefined : rawMax;
        const safeMax = fromUl ? rawMax : undefined;
        const kind = min === undefined && max === undefined ? 'safety' : 'goal';
        const missing = missingMap[key] ?? [];
        let status: GoalStatus = 'met';
        if (value === null) status = 'unknown';
        else if (min !== undefined && value < min * 0.995) status = 'low';
        else if (max !== undefined && value > max * 1.005) status = 'high';
        else if (safeMax !== undefined && value > safeMax * 1.005) status = 'high';
        // Only worth a warning when the known total is already at least half the ceiling.
        const ceiling = max ?? safeMax;
        const uncertain = status === 'met' && missing.length > 0 && ceiling !== undefined && value !== null && value >= ceiling * 0.5;
        return { key, kind, min, max, safeMax, value, status, missing, uncertain };
    }).sort((a, b) => (a.key === 'calories' ? -1 : b.key === 'calories' ? 1 : 0));
}

export interface GoalSummary {
    /** Nutrient goals the user set (calories excluded). */
    goals: GoalProgress[];
    met: number;
    total: number;
    /** Met goals whose limit could still be exceeded (missing data). */
    uncertain: GoalProgress[];
    /** Ceiling-only safe upper limits (not goals). */
    safety: GoalProgress[];
    safetyOver: GoalProgress[];
}

/** What the "goals met" ring and headline count. */
export function goalSummary(progress: GoalProgress[]): GoalSummary {
    const goals = progress.filter(p => p.key !== 'calories' && p.kind === 'goal');
    const safety = progress.filter(p => p.kind === 'safety');
    return {
        goals,
        met: goals.filter(p => p.status === 'met').length,
        total: goals.length,
        uncertain: goals.filter(p => p.uncertain),
        safety,
        safetyOver: safety.filter(p => p.status === 'high'),
    };
}

export interface UnusedFood { food: Food; reason: string }

/**
 * Foods the user chose that the plan left out, each with a short reason.
 * The planner picks the fewest calories that meet every goal, so a food is
 * left out when other foods cover the same goals more cheaply.
 */
export function unusedFoods(chosen: Food[], result: PlanResult, goalKeys: string[]): UnusedFood[] {
    const used = new Set((result.diet ?? []).map(d => d.food.id));
    const limits = result.constraintLimits ?? {};
    // Goals the plan only just meets: these are what the planner was "paying" calories for.
    const binding = new Set(goalKeys.filter(k => {
        const min = num(limits[k]?.min);
        const v = num(result.totalNutrients?.[k]);
        return min !== null && v !== null && v <= min * 1.02;
    }));
    const name = (k: string) => (nutrientLabel(k).toLowerCase().startsWith('vitamin') ? nutrientLabel(k) : nutrientLabel(k).toLowerCase());
    const list = (keys: string[]) => keys.slice(0, 2).map(name).join(' and ');
    return chosen.filter(f => !used.has(f.id)).map(food => {
        if (!hasCoreData(food)) return { food, reason: 'USDA has very little data for it.' };
        const helps = goalKeys.filter(k => {
            const v = num((food as unknown as Record<string, unknown>)[k]);
            const target = NUTRIENT_CONFIG[k]?.defaultValue;
            // Meaningful: a 100 g portion gives at least 10% of the reference amount.
            return v !== null && !!target && limits[k]?.min !== undefined && v >= target * 0.1;
        });
        const tight = helps.filter(k => binding.has(k));
        if (tight.length) return { food, reason: `Other foods gave the same ${list(tight)} for fewer calories.` };
        if (helps.length) return { food, reason: `Your ${list(helps)} ${helps.length === 1 ? 'goal was' : 'goals were'} already met by other foods.` };
        return { food, reason: 'It adds calories without much of what your goals ask for.' };
    });
}

export type IssueKind = 'short' | 'excess' | 'food' | 'other';

export interface PlanIssue {
    kind: IssueKind;
    nutrient?: string;
    amount?: number;
    unit?: string;
    text: string;
    /** Fixed foods alone already break this limit. */
    fixedFoodsCause?: boolean;
    foodId?: number;
}

const LABEL_INDEX: [string, string][] = (() => {
    const pairs: [string, string][] = [['calories', 'calories']];
    for (const [k, cfg] of Object.entries(NUTRIENT_CONFIG)) {
        pairs.push([cfg.label.toLowerCase(), k]);
        pairs.push([nutrientLabel(k).toLowerCase(), k]);
        pairs.push([k.toLowerCase(), k]);
    }
    return pairs.sort((a, b) => b[0].length - a[0].length);
})();

function findNutrient(line: string): string | undefined {
    const l = line.toLowerCase();
    return LABEL_INDEX.find(([label]) => l.includes(label))?.[1];
}

/**
 * Turn the optimizer's diagnostics into structured issues. Prefers the
 * structured `issues` array (every issue, with amounts); otherwise parses the
 * human message ("• Cannot meet Vitamin D target (short by 20mcg).").
 */
export function parseIssues(result: PlanResult): { issues: PlanIssue[]; more: number } {
    if (Array.isArray(result.issues) && result.issues.length) {
        const foods = new Map((result.diet ?? []).map(d => [d.food.id, d.food.description]));
        return {
            issues: result.issues.map((i): PlanIssue => {
                if (i.kind === 'food_min' || i.kind === 'food_max') {
                    const name = (i.foodId !== undefined && foods.get(i.foodId)) || 'one of your foods';
                    return {
                        kind: 'food', foodId: i.foodId, amount: num(i.amount) ?? undefined, unit: 'g',
                        text: i.kind === 'food_min'
                            ? `The minimum you set for ${name} can't be reached alongside your other goals.`
                            : `The limit you set for ${name} is too low for your other goals.`,
                    };
                }
                return {
                    kind: i.kind,
                    nutrient: i.nutrient,
                    amount: num(i.amount) ?? undefined,
                    fixedFoodsCause: i.cause === 'fixed_foods',
                    text: `${nutrientLabel(i.nutrient ?? '')} ${i.kind === 'short' ? 'falls short' : 'goes over'}`,
                };
            }),
            more: 0,
        };
    }
    const msg = result.message ?? '';
    const issues: PlanIssue[] = [];
    let more = 0;
    for (const raw of msg.split('\n')) {
        const line = raw.replace(/^[\s•\-*]+/, '').trim();
        if (!line || /^optimi[sz]ation failed:?$/i.test(line)) continue;
        const moreMatch = line.match(/and (\d+) more/i);
        if (moreMatch) { more = parseInt(moreMatch[1], 10); continue; }
        if (/requirement for|limit for/i.test(line)) {
            issues.push({ kind: 'food', text: line });
            continue;
        }
        const nutrient = findNutrient(line);
        const amt = line.match(/by\s+([\d.,]+)\s*([a-zA-Zµ]+)?/);
        const kind: IssueKind = !nutrient ? 'other' : /exceed|stay under|over/i.test(line) ? 'excess' : 'short';
        issues.push({
            kind,
            nutrient,
            amount: amt ? parseFloat(amt[1].replace(/,/g, '')) : undefined,
            unit: amt?.[2],
            text: line,
            fixedFoodsCause: /guaranteed|fixed/i.test(line),
        });
    }
    // De-duplicate by nutrient+kind (fixed-food cause wins).
    const seen = new Map<string, PlanIssue>();
    for (const i of issues) {
        const k = i.nutrient ? `${i.nutrient}:${i.kind}` : i.text;
        const prev = seen.get(k);
        if (!prev || i.fixedFoodsCause) seen.set(k, { ...prev, ...i, fixedFoodsCause: i.fixedFoodsCause || prev?.fixedFoodsCause });
    }
    return { issues: Array.from(seen.values()), more };
}

/** Render an API warning (string or object) as plain text. */
export function warningText(w: PlanWarning): string {
    if (typeof w === 'string') return w;
    if (w && typeof w === 'object') {
        const name = w.foodName ?? w.food ?? w.description;
        const nutrients = Array.isArray(w.nutrients) ? w.nutrients.map(n => nutrientLabel(String(n))).join(', ') : '';
        if (name) return `${shortFoodName(String(name))}: no USDA data for ${nutrients || 'some nutrients'}.`;
        if (typeof w.message === 'string') return w.message;
        try { return JSON.stringify(w); } catch { return 'Data warning'; }
    }
    return String(w);
}
