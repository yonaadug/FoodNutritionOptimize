/**
 * Turns a history item's free-form `data` into the short facts shown on its row.
 * Pages recording history can pass either form:
 *
 *   { calories: 320, protein: 18, perServing: true }           known numeric keys
 *   { caloriesPerServing: 320, proteinPerServing: 18 }         the same, per serving
 *   { summary: [{ label: 'Iron', value: '2.1 mg' }] }          anything else, ready to show
 *
 * With the numeric forms, `incomplete: ['calories']` marks a value as a lower bound
 * and `estimated: true` adds a note that the numbers are a rough photo estimate.
 */

export interface SummaryFact {
    label: string;
    value: string;
}

const MAX_FACTS = 5;

const NUTRIENTS: { label: string; keys: string[]; unit: string }[] = [
    { label: 'Calories', keys: ['calories', 'kcal', 'energy'], unit: 'kcal' },
    { label: 'Protein', keys: ['protein'], unit: 'g' },
    { label: 'Carbs', keys: ['carbs', 'carbohydrates'], unit: 'g' },
    { label: 'Fat', keys: ['fat'], unit: 'g' },
    { label: 'Fiber', keys: ['fiber', 'fibre'], unit: 'g' },
];

function formatNumber(n: number): string {
    return n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

export function historySummary(data: unknown): SummaryFact[] {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];
    const d = data as Record<string, unknown>;

    if (Array.isArray(d.summary)) {
        return d.summary
            .filter((f): f is SummaryFact => typeof f === 'object' && f !== null && typeof f.label === 'string' && typeof f.value === 'string')
            .slice(0, MAX_FACTS);
    }

    const lowerBounds = Array.isArray(d.incomplete) ? d.incomplete : [];
    const facts: SummaryFact[] = [];
    for (const { label, keys, unit } of NUTRIENTS) {
        for (const key of keys) {
            const perServing = d[`${key}PerServing`];
            const plain = d[key];
            const value = typeof perServing === 'number' ? perServing : plain;
            if (typeof value !== 'number' || !Number.isFinite(value)) continue;
            const prefix = lowerBounds.includes(key) ? '≥ ' : '';
            const suffix = typeof perServing === 'number' || d.perServing === true ? ' per serving' : '';
            facts.push({ label, value: `${prefix}${formatNumber(value)} ${unit}${suffix}` });
            break;
        }
    }
    if (d.estimated === true) return [...facts.slice(0, MAX_FACTS - 1), { label: 'Estimate', value: 'from a photo' }];
    return facts.slice(0, MAX_FACTS);
}

/** Links are validated when stored; this keeps a bad row from ever rendering as one. */
export function isSafeHref(href: unknown): href is string {
    return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && !href.includes('\\');
}
