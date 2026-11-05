import { NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';
import type { PlanResult, PlanWarning } from '@/hooks/usePlan';
import { nutrientLabel, num } from '@/components/planner/nutrients';

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
}

/**
 * Compare plan totals against the limits the optimizer actually used.
 * Upper limits added by "Respect safe upper limits" are reported as
 * `safeMax`, never as the user's `max`, so a nutrient with no goal (e.g.
 * vitamin D in Everyday essentials) does not become an "on target" goal.
 */
export function goalProgress(result: PlanResult): GoalProgress[] {
    const limits = result.constraintLimits ?? {};
    const ulKeys = new Set(Array.isArray(result.upperLimitKeys) ? result.upperLimitKeys : []);
    return Object.entries(limits).map(([key, lim]): GoalProgress => {
        const value = key === 'calories' ? num(result.totalCalories) : num(result.totalNutrients?.[key]);
        const min = num(lim?.min) ?? undefined;
        const rawMax = num(lim?.max) ?? undefined;
        const fromUl = ulKeys.has(key);
        const max = fromUl ? undefined : rawMax;
        const safeMax = fromUl ? rawMax : undefined;
        const kind = min === undefined && max === undefined ? 'safety' : 'goal';
        let status: GoalStatus = 'met';
        if (value === null) status = 'unknown';
        else if (min !== undefined && value < min * 0.995) status = 'low';
        else if (max !== undefined && value > max * 1.005) status = 'high';
        else if (safeMax !== undefined && value > safeMax * 1.005) status = 'high';
        return { key, kind, min, max, safeMax, value, status };
    }).sort((a, b) => (a.key === 'calories' ? -1 : b.key === 'calories' ? 1 : 0));
}

export interface GoalSummary {
    /** Nutrient goals the user set (calories excluded). */
    goals: GoalProgress[];
    met: number;
    total: number;
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
        safety,
        safetyOver: safety.filter(p => p.status === 'high'),
    };
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
 * Turn the optimizer's diagnostics into structured issues. Prefers a
 * structured `issues` array if the API provides one; otherwise parses the
 * human message ("• Cannot meet Vitamin D target (short by 20mcg).").
 */
export function parseIssues(result: PlanResult): { issues: PlanIssue[]; more: number } {
    if (Array.isArray(result.issues) && result.issues.length) {
        return {
            issues: result.issues.map(i => ({
                kind: i.kind,
                nutrient: i.nutrient,
                amount: num(i.amount) ?? undefined,
                text: `${nutrientLabel(i.nutrient)} ${i.kind === 'short' ? 'falls short' : 'goes over'}`,
            })),
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
        if (typeof w.message === 'string') return w.message;
        const name = w.foodName ?? w.food ?? w.description;
        const nutrients = Array.isArray(w.nutrients) ? w.nutrients.map(n => nutrientLabel(String(n))).join(', ') : '';
        if (name) return `${name} has no data for ${nutrients || 'some nutrients'}, so it counts as 0 toward ${nutrients ? 'those goals' : 'them'}.`;
        try { return JSON.stringify(w); } catch { return 'Data warning'; }
    }
    return String(w);
}
