/**
 * Contaminants across a whole plan: the totals, each food's share, and which foods push a
 * total up. Pure and free of runtime imports beyond the meter helpers, so the browser and the
 * server compute the same numbers. lib/plan-contaminants.ts builds the per-food input from the
 * food page's own report (lib/contaminants.ts), so nothing here re-derives a concentration.
 *
 * How a total is made
 * -------------------
 *   Every food's report is taken at 100 g. Amounts scale linearly with weight (that's how the
 *   food page computes a serving too: concentration x moisture factor x grams), so a food eaten
 *   at g grams contributes  amount_100g x g / 100  micrograms and  percent_100g x g / 100  percent
 *   of the reference. A plan's total is the sum over its foods.
 *
 *   - Lead, cadmium, inorganic arsenic: micrograms per day against the daily reference.
 *   - Pesticides: each food's hazard index (the sum of each pesticide's share of its EPA
 *     reference dose) adds up, because a hazard index is itself a sum of shares.
 *   - Mercury: the day's amount against the weekly reference; a week plan also totals all 7 days.
 *   - Microplastics: particle counts add up, but there's no health limit, so this row is a
 *     comparison and never gets a level.
 *
 *   No data is never zero: a food without data for a contaminant is listed as unknown and the
 *   total is "at least" what the known foods add up to. "Not detected" adds 0 and counts as tested.
 */
import {
    MERCURY_WEEKLY_EDGES, formatAmount, formatPercent, levelFor, levelLabel, meterPosition,
    type DataQuality, type ItemStatus, type MeterLevel, type RefPeriod,
} from './contaminants-meter';

export const PLAN_CONTAMINANT_IDS = ['lead', 'cadmium', 'mercury', 'arsenic', 'pesticide_residues', 'microplastics'] as const;
export type PlanContaminantId = typeof PLAN_CONTAMINANT_IDS[number];

export const PLAN_CONTAMINANT_NAMES: Record<PlanContaminantId, string> = {
    lead: 'Lead',
    cadmium: 'Cadmium',
    mercury: 'Mercury',
    arsenic: 'Inorganic arsenic',
    pesticide_residues: 'Pesticide residues',
    microplastics: 'Microplastics',
};

/**
 * Bands for a whole period's total against that period's reference: a day's total against the
 * daily reference, or a week's total against the weekly one. The food page's bands are for one
 * serving, which leaves room for the rest of the day; a plan total already is the rest of the
 * day, so "high" here means over the whole reference and "elevated" more than half of it.
 */
export const PLAN_TOTAL_EDGES: readonly number[] = [25, 50, 100];

/** The part of one food's report the plan needs, at 100 g. */
export interface UnitItem {
    status: ItemStatus;
    /** Micrograms (or particles for microplastics) in 100 g; null without a measured amount. */
    amount: number | null;
    /** Percent of the reference in 100 g; null when not rated against one. */
    percent: number | null;
    /** Total arsenic counted as inorganic: the figure is a ceiling. */
    upperBoundOnly: boolean;
    grade: DataQuality | null;
}

export interface PlanReference {
    amountUg: number;
    period: RefPeriod;
    authority: string;
    population: string;
}

/** One food's contaminant data, per 100 g. */
export interface FoodContaminantUnit {
    fdcId: number;
    description: string;
    foodCategory: string | null;
    items: Record<PlanContaminantId, UnitItem>;
}

export interface ContaminantUnits {
    /** By fdc id. */
    foods: Record<string, FoodContaminantUnit>;
    /** The default reference for each rated contaminant (absent for pesticides and microplastics). */
    references: Partial<Record<PlanContaminantId, PlanReference>>;
    /** False when the database has no contaminant tables at all. */
    available: boolean;
}

/** One food in a plan, as eaten on one day. `key` is the planner's id, so actions can find it. */
export interface PlanPortion {
    key: number;
    /** Null for recipes and anything that isn't a USDA food: no contaminant data. */
    fdcId: number | null;
    name: string;
    grams: number;
}

export interface Contributor {
    key: number;
    fdcId: number | null;
    name: string;
    /** Grams over the period (summed over days in a week). */
    grams: number;
    amount: number;
    /** Percent of the reference this food adds, over the period. */
    percent: number | null;
    /** Share of the total, 0-1. */
    share: number;
    upperBoundOnly: boolean;
}

export interface FoodRef { key: number; fdcId: number | null; name: string }

export type RowStatus = 'measured' | 'not_detected' | 'no_data';

export interface PlanContaminantRow {
    id: PlanContaminantId;
    name: string;
    /** 'comparison' rows (microplastics) have no health reference and never get a level. */
    kind: 'reference' | 'comparison';
    status: RowStatus;
    /** Total over the period from the foods with data, in `unit`. */
    total: number;
    unit: 'mcg' | 'particles';
    /** Some of the total is total arsenic counted as inorganic, so it is a ceiling. */
    atMost: boolean;
    /** Some foods have no data, so the real total can be higher. */
    atLeast: boolean;
    reference: PlanReference | null;
    /** Share of the reference used. Daily rows in a week view: the average day. */
    percent: number | null;
    level: MeterLevel | null;
    levelLabel: string | null;
    /** 0-100, for a four-segment bar. */
    position: number;
    edges: readonly number[];
    /** The edge at which the level turns elevated (in percent of the reference). */
    elevatedAt: number | null;
    contributors: Contributor[];
    /** Foods that push the total into elevated or above: without them it would be below. */
    flagged: number[];
    unknown: FoodRef[];
    notRated: FoodRef[];
    notDetected: FoodRef[];
    /** One plain sentence. */
    text: string;
    /** Mercury in a day view: what a week of days like this one would add up to. */
    weekIfEveryDay?: number;
    /** Daily rows in a week view: the highest single day. */
    highestDay?: { day: number; percent: number };
    /** Shown beside the row, for readings that would alarm without it. */
    context?: string;
}

export interface PlanContaminantSummary {
    period: 'day' | 'week';
    days: number;
    available: boolean;
    rows: PlanContaminantRow[];
    /** Foods in the plan with no data for any contaminant. */
    noDataFoods: FoodRef[];
    foodsInPlan: number;
}

const ARSENIC_CONTEXT = "EPA's arsenic reference is very cautious: it estimates typical US intake is already about 61% of it. Cooking rice in plenty of water and draining it removes 40-60%.";

const DAILY_IDS: PlanContaminantId[] = ['lead', 'cadmium', 'arsenic', 'pesticide_residues'];

interface Acc {
    contributors: Map<number, Contributor>;
    perDay: number[];
    perDayPercent: number[];
    unknown: Map<number, FoodRef>;
    notRated: Map<number, FoodRef>;
    notDetected: Map<number, FoodRef>;
    tested: number;
}

function ref(p: PlanPortion): FoodRef {
    return { key: p.key, fdcId: p.fdcId, name: p.name };
}

/**
 * Totals for a plan. `days` holds each day's foods; a day plan is one day. Grams are the
 * planned grams exactly as shown.
 */
export function summarizePlanContaminants(days: readonly (readonly PlanPortion[])[], units: ContaminantUnits): PlanContaminantSummary {
    const period: 'day' | 'week' = days.length > 1 ? 'week' : 'day';
    const nDays = Math.max(1, days.length);
    const accs = new Map<PlanContaminantId, Acc>(PLAN_CONTAMINANT_IDS.map(id => [id, {
        contributors: new Map(), perDay: Array(nDays).fill(0), perDayPercent: Array(nDays).fill(0),
        unknown: new Map(), notRated: new Map(), notDetected: new Map(), tested: 0,
    }]));
    const inPlan = new Map<number, FoodRef>();
    const noData = new Map<number, FoodRef>();

    days.forEach((portions, d) => {
        for (const p of portions) {
            if (!(p.grams > 0) || !Number.isFinite(p.grams)) continue;
            inPlan.set(p.key, ref(p));
            const unit = p.fdcId !== null ? units.foods[String(p.fdcId)] : undefined;
            if (!unit || PLAN_CONTAMINANT_IDS.every(id => unit.items[id].status === 'no_data')) noData.set(p.key, ref(p));
            for (const id of PLAN_CONTAMINANT_IDS) {
                const acc = accs.get(id)!;
                const item = unit?.items[id];
                if (!item || item.status === 'no_data') { acc.unknown.set(p.key, ref(p)); continue; }
                if (item.status === 'not_rated') { acc.notRated.set(p.key, ref(p)); continue; }
                acc.tested++;
                const amount = item.status === 'not_detected' ? 0 : (item.amount ?? 0) * p.grams / 100;
                const percent = item.status === 'not_detected' ? 0 : item.percent === null ? null : item.percent * p.grams / 100;
                if (item.status === 'not_detected') acc.notDetected.set(p.key, ref(p));
                acc.perDay[d] += amount;
                acc.perDayPercent[d] += percent ?? 0;
                const c = acc.contributors.get(p.key);
                if (c) {
                    c.grams += p.grams;
                    c.amount += amount;
                    c.percent = c.percent === null && percent === null ? null : (c.percent ?? 0) + (percent ?? 0);
                } else {
                    acc.contributors.set(p.key, {
                        key: p.key, fdcId: p.fdcId, name: p.name, grams: p.grams, amount, percent, share: 0,
                        upperBoundOnly: item.upperBoundOnly,
                    });
                }
            }
        }
    });

    const rows = PLAN_CONTAMINANT_IDS.map(id => buildRow(id, accs.get(id)!, units, period, nDays));
    return {
        period,
        days: nDays,
        available: units.available,
        rows,
        noDataFoods: [...noData.values()],
        foodsInPlan: inPlan.size,
    };
}

function buildRow(id: PlanContaminantId, acc: Acc, units: ContaminantUnits, period: 'day' | 'week', nDays: number): PlanContaminantRow {
    const name = PLAN_CONTAMINANT_NAMES[id];
    const comparison = id === 'microplastics';
    const total = acc.perDay.reduce((s, v) => s + v, 0);
    const contributors = [...acc.contributors.values()]
        .map(c => ({ ...c, share: total > 0 ? c.amount / total : 0 }))
        .sort((a, b) => (b.percent ?? b.amount) - (a.percent ?? a.amount) || b.amount - a.amount);
    const status: RowStatus = acc.tested === 0 ? 'no_data' : total > 0 ? 'measured' : 'not_detected';
    const unknown = [...acc.unknown.values()];
    const atMost = contributors.some(c => c.upperBoundOnly && c.amount > 0);
    const reference = units.references[id] ?? null;
    const isMercury = id === 'mercury';
    const isDaily = DAILY_IDS.includes(id);

    // What the percent means: a day's total vs the daily reference (a week view uses the
    // average day), mercury against the weekly reference (the day's amount, or the week's total).
    const periodPercent = acc.perDayPercent.reduce((s, v) => s + v, 0);
    let percent: number | null = null;
    let edges: readonly number[] = PLAN_TOTAL_EDGES;
    if (!comparison && status !== 'no_data') {
        if (isMercury) {
            percent = periodPercent;
            if (period === 'day') edges = MERCURY_WEEKLY_EDGES;
        } else if (isDaily) {
            percent = periodPercent / nDays;
        }
    }
    const level = percent === null ? null : levelFor(percent, edges);
    const elevatedAt = comparison ? null : edges[1];

    // Contributors that push the total into elevated: drop the biggest until it falls below.
    const flagged: number[] = [];
    if (percent !== null && elevatedAt !== null && percent >= elevatedAt) {
        let remaining = percent;
        for (const c of contributors) {
            if (remaining < elevatedAt || flagged.length >= 3) break;
            const share = (c.percent ?? 0) / (isDaily ? nDays : 1);
            if (!(share > 0)) continue;
            flagged.push(c.key);
            remaining -= share;
        }
    }

    const row: PlanContaminantRow = {
        id, name, kind: comparison ? 'comparison' : 'reference', status,
        total, unit: comparison ? 'particles' : 'mcg',
        atMost, atLeast: unknown.length > 0 && status !== 'no_data',
        reference, percent, level,
        levelLabel: level === null ? null : levelLabel(level, 'reference'),
        position: percent === null ? 0 : meterPosition(percent, edges),
        edges, elevatedAt,
        contributors, flagged, unknown,
        notRated: [...acc.notRated.values()],
        notDetected: [...acc.notDetected.values()],
        text: '',
    };
    if (isMercury && period === 'day' && percent !== null) row.weekIfEveryDay = percent * 7;
    if (isDaily && period === 'week' && percent !== null) {
        let best = 0;
        acc.perDayPercent.forEach((v, d) => { if (v > acc.perDayPercent[best]) best = d; });
        row.highestDay = { day: best, percent: acc.perDayPercent[best] };
    }
    if (id === 'arsenic' && (percent ?? 0) >= 25) row.context = ARSENIC_CONTEXT;
    row.text = rowText(row, period);
    return row;
}

function amountText(row: PlanContaminantRow): string {
    const prefix = row.atMost ? 'at most ' : row.atLeast ? 'at least ' : '';
    return `${prefix}${formatAmount(row.total)} ${row.unit === 'particles' ? 'particles' : 'mcg'}`;
}

/** One sentence for a row, which also serves as its text alternative. */
export function rowText(row: PlanContaminantRow, period: 'day' | 'week'): string {
    if (row.status === 'no_data') {
        return row.id === 'microplastics'
            ? 'No published microplastic estimate for any food in this plan.'
            : `No ${row.name.toLowerCase()} data for any food in this plan. That does not mean there is none.`;
    }
    if (row.status === 'not_detected') return `Not detected in testing of the ${row.notDetected.length === 1 ? 'food' : `${row.notDetected.length} foods`} with data.`;
    const where = period === 'week' ? 'this week' : 'this day';
    if (row.kind === 'comparison') {
        return `${row.atLeast ? 'At least about' : 'About'} ${formatAmount(row.total)} particles ${where}, from published estimates. No health limit exists, so this is a comparison, not a safety rating.`;
    }
    if (row.id === 'pesticide_residues' && row.percent !== null) {
        const p = formatPercent(row.percent);
        const share = row.atLeast && !p.startsWith('under') ? `at least ${p}` : p;
        return period === 'day'
            ? `At average levels, the day's foods add up to ${share} of EPA's daily reference doses.`
            : `At average levels, an average day this week adds up to ${share} of EPA's daily reference doses.`;
    }
    if (row.percent === null || !row.reference) return `${capital(amountText(row))} ${where}.`;
    const pct = formatPercent(row.percent);
    if (row.id === 'mercury') {
        return period === 'day'
            ? `${capital(amountText(row))} this day, ${pct} of ${row.reference.authority}'s weekly reference.`
            : `${capital(amountText(row))} this week, ${pct} of ${row.reference.authority}'s weekly reference.`;
    }
    return period === 'day'
        ? `${capital(amountText(row))} this day, ${pct} of ${row.reference.authority}'s daily reference.`
        : `${capital(amountText(row))} this week, an average of ${pct} of ${row.reference.authority}'s daily reference per day.`;
}

function capital(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * How much of a flagged food to keep, as a fraction of what the plan has now, so the row falls
 * back below elevated. Null when even dropping all of it isn't enough, or when what's left
 * would be under a sixth of it (exclude it instead).
 */
export function reduceFactor(row: PlanContaminantRow, key: number, days = 1): number | null {
    const c = row.contributors.find(x => x.key === key);
    if (!c || row.percent === null || row.elevatedAt === null || !(c.percent && c.percent > 0)) return null;
    const share = row.id === 'mercury' ? c.percent : c.percent / Math.max(1, days);
    const excess = row.percent - row.elevatedAt * 0.98;
    if (excess <= 0 || excess >= share) return null;
    const keep = 1 - excess / share;
    return keep >= 1 / 6 ? Math.floor(keep * 100) / 100 : null;
}

/** The fdc ids a plan needs contaminant data for. */
export function planFdcIds(days: readonly (readonly PlanPortion[])[]): number[] {
    const out = new Set<number>();
    for (const day of days) for (const p of day) if (p.fdcId !== null && p.fdcId > 0 && p.grams > 0) out.add(p.fdcId);
    return [...out];
}
