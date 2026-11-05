/**
 * Meter logic and response types for contaminant data. No runtime imports (safe for client
 * components). docs/CONTAMINANT_DATA.md explains these thresholds to users; keep them in step.
 */

export type MeterLevel = 'low' | 'moderate' | 'elevated' | 'high';
export type MeterScale = 'reference' | 'relative';
export type RefPeriod = 'day' | 'week';
export type DataQuality = 'good' | 'fair' | 'limited';
export type ItemStatus = 'measured' | 'not_detected' | 'not_rated' | 'no_data';

export const LEVELS: MeterLevel[] = ['low', 'moderate', 'elevated', 'high'];

/**
 * Upper edge of low / moderate / elevated. At or above the last edge is high.
 *
 * Daily references: percent of one day's reference used by one serving. People eat many foods in
 * a day, so one serving using half the day's budget is high.
 *
 * Mercury: percent of the weekly reference used by one serving. These edges are tied to the
 * FDA/EPA fish advice so the meter cannot contradict it. A 4 oz serving at 0.15 ppm (top of "Best
 * Choices") is 32% of the week, and at 0.46 ppm (top of "Good Choices") is 99%.
 *
 * Microplastics: particles per serving. No health-based limit exists, so these edges only describe
 * where a serving sits among studied foods. They say nothing about risk.
 */
export const REFERENCE_DAILY_EDGES: readonly number[] = [10, 25, 50];
export const MERCURY_WEEKLY_EDGES: readonly number[] = [10, 33, 100];
export const MICROPLASTIC_PARTICLE_EDGES: readonly number[] = [10, 50, 200];

export function levelFor(value: number, edges: readonly number[]): MeterLevel {
    if (value < edges[0]) return 'low';
    if (value < edges[1]) return 'moderate';
    if (value < edges[2]) return 'elevated';
    return 'high';
}

/**
 * Where the marker sits on a bar of four equal segments, 0-100. Each segment is linear between its
 * edges. The top segment runs to twice the last edge and then stays full.
 */
export function meterPosition(value: number, edges: readonly number[]): number {
    const stops = [0, edges[0], edges[1], edges[2], edges[2] * 2];
    if (!(value > 0)) return 0;
    for (let i = 0; i < 4; i++) {
        if (value < stops[i + 1]) {
            return Math.round((i + (value - stops[i]) / (stops[i + 1] - stops[i])) * 25 * 10) / 10;
        }
    }
    return 100;
}

const REFERENCE_LABELS: Record<MeterLevel, string> = {
    low: 'Low',
    moderate: 'Moderate',
    elevated: 'Elevated',
    high: 'High',
};

const RELATIVE_LABELS: Record<MeterLevel, string> = {
    low: 'Low among studied foods',
    moderate: 'Moderate among studied foods',
    elevated: 'Elevated among studied foods',
    high: 'High among studied foods',
};

export function levelLabel(level: MeterLevel, scale: MeterScale): string {
    return (scale === 'relative' ? RELATIVE_LABELS : REFERENCE_LABELS)[level];
}

/** Amount allowed per period, in the reference's own period. */
export function referenceAmount(ref: { value: number; per_kg_bw: number; body_weight_kg: number }): number {
    return ref.per_kg_bw ? ref.value * ref.body_weight_kg : ref.value;
}

export function percentOf(amount: number, allowance: number): number | null {
    if (!(allowance > 0) || !Number.isFinite(amount) || amount < 0) return null;
    return (amount / allowance) * 100;
}

/** Amount in one serving, from a concentration per kg and an optional dry-matter factor. */
export function perServing(valuePerKg: number, grams: number, moistureFactor: number | null | undefined): number {
    return (valuePerKg * (moistureFactor ?? 1) * grams) / 1000;
}

/**
 * Data quality from sample size, how closely the food matches what was measured, and data age.
 * Scaling for moisture adds uncertainty, so it caps the grade at fair.
 */
export function dataQuality(input: {
    samples: number | null;
    confidence: number;
    yearEnd: number | null;
    moistureAdjusted?: boolean;
}): DataQuality {
    const { samples, confidence, yearEnd, moistureAdjusted } = input;
    if (samples === null || samples < 5 || confidence < 0.6 || (yearEnd !== null && yearEnd < 2000)) return 'limited';
    if (samples >= 20 && confidence >= 0.8 && !moistureAdjusted && (yearEnd === null || yearEnd >= 2010)) return 'good';
    return 'fair';
}

/** 2 significant figures, for display. Plain decimals, so 0.0012 stays readable. */
export function formatAmount(n: number): string {
    if (n === 0) return '0';
    if (Math.abs(n) >= 100) return String(Math.round(n));
    return String(Number(n.toPrecision(2)));
}

export function formatPercent(p: number): string {
    if (p > 0 && p < 1) return 'under 1%';
    if (p >= 10) return `${Math.round(p)}%`;
    return `${Number(p.toFixed(0))}%`;
}

/** Plain-language "how many fit" line. Null when so many fit that the number means nothing. */
export function servingsLine(percent: number, period: RefPeriod): string | null {
    if (!(percent > 0)) return null;
    const fit = 100 / percent;
    if (fit > 20) return null;
    if (fit < 1) return `One serving is more than the ${period === 'week' ? "whole week's" : "whole day's"} reference.`;
    const n = fit >= 2 ? `About ${Math.floor(fit)}` : 'About 1';
    const noun = Math.floor(fit) === 1 || fit < 2 ? 'serving' : 'servings';
    return `${n} ${noun} a ${period} would stay within the reference, if nothing else you eat contains it.`;
}

// --------------------------------------------------------------------------- //
// Pesticides
// --------------------------------------------------------------------------- //
export interface ResidueInput {
    contaminantId: string;
    name: string;
    parentName: string;
    role: string;
    /** Mean residue across all samples tested (non-detects as zero), µg/kg. */
    meanUgPerKg: number;
    maxUgPerKg: number | null;
    detectionFrequency: number | null;
    /** Allowance in µg/day, or null when no reference dose was found. */
    allowanceUgPerDay: number | null;
}

export interface ResidueGroup {
    name: string;
    amountUg: number;
    percent: number | null;
    detectionFrequency: number | null;
    maxUgPerKg: number | null;
    forms: string[];
}

/**
 * One row per parent pesticide. PDP reports some pesticides as parts and as a total ("Permethrin
 * cis", "Permethrin trans", "Permethrin Total"), so a total replaces its parts rather than adding
 * to them. Breakdown products without a total are added to their parent.
 */
export function groupResidues(rows: ResidueInput[], grams: number): ResidueGroup[] {
    const byParent = new Map<string, ResidueInput[]>();
    for (const r of rows) {
        const list = byParent.get(r.parentName);
        if (list) list.push(r);
        else byParent.set(r.parentName, [r]);
    }
    const out: ResidueGroup[] = [];
    for (const [parent, list] of byParent) {
        const totals = list.filter(r => r.role === 'total');
        // Metabolites are reported apart from a total, so they still add to it.
        const counted = totals.length
            ? [totals.reduce((a, b) => (a.meanUgPerKg >= b.meanUgPerKg ? a : b)), ...list.filter(r => r.role === 'metabolite')]
            : list;
        const amountUg = counted.reduce((sum, r) => sum + perServing(r.meanUgPerKg, grams, null), 0);
        const allowance = list.find(r => r.allowanceUgPerDay !== null)?.allowanceUgPerDay ?? null;
        out.push({
            name: parent,
            amountUg,
            percent: allowance === null ? null : percentOf(amountUg, allowance),
            detectionFrequency: Math.max(...list.map(r => r.detectionFrequency ?? 0)),
            maxUgPerKg: Math.max(...list.map(r => r.maxUgPerKg ?? 0)),
            forms: list.map(r => r.name),
        });
    }
    out.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || b.amountUg - a.amountUg);
    return out;
}

/** Sum of each pesticide's share of its reference dose (EPA's hazard index approach). */
export function hazardIndexPercent(groups: ResidueGroup[]): number {
    return groups.reduce((sum, g) => sum + (g.percent ?? 0), 0);
}

// --------------------------------------------------------------------------- //
// API response
// --------------------------------------------------------------------------- //
export interface SourceRef {
    id: string;
    name: string;
    publisher: string;
    year: string;
    citation: string;
    url: string;
    license: string;
}

export interface ReferenceInfo {
    id: string;
    /** Amount per period for the assumed body weight. */
    amountUg: number;
    period: RefPeriod;
    value: number;
    unit: string;
    bodyWeightKg: number | null;
    population: string;
    basis: string;
    whyChosen: string | null;
    authority: string;
    year: string;
    notes: string | null;
}

export interface AlternateReference {
    label: string;
    percent: number;
}

export interface Meter {
    level: MeterLevel;
    label: string;
    scale: MeterScale;
    /** Marker position on a 4-segment bar, 0-100. */
    position: number;
    /** Text equivalent for screen readers and anyone who can't see the bar. */
    text: string;
    edges: readonly number[];
}

export interface BasedOn {
    profileId: string;
    family: string;
    name: string;
    sourceName: string;
    matchMethod: string;
    matchConfidence: number;
    /** USDA foods that share this profile, including this one. */
    sharedWith: number;
    moistureFactor: number | null;
}

export interface Quality {
    grade: DataQuality;
    samples: number | null;
    detected: number | null;
    detectionRate: number | null;
    yearStart: number | null;
    yearEnd: number | null;
    matchMethod: string | null;
    matchConfidence: number | null;
    moistureAdjusted: boolean;
}

export interface ResidueDetail {
    name: string;
    amountUg: number;
    percent: number | null;
    detectionRate: number | null;
    maxPpm: number | null;
    allowanceUgPerDay: number | null;
    referenceBasis: string | null;
    forms: string[];
}

export interface ContaminantItem {
    id: string;
    name: string;
    status: ItemStatus;
    /** Why this row reads as it does, in one plain sentence. */
    explanation: string;
    perServing: { amount: number | null; upperBound: number | null; unit: string; low: number | null; high: number | null } | null;
    concentration: {
        value: number;
        unit: string;
        statistic: string;
        upperBound: number | null;
        median: number | null;
        low: number | null;
        high: number | null;
        reportingLimit: number | null;
    } | null;
    reference: ReferenceInfo | null;
    percentOfReference: number | null;
    servingsLine: string | null;
    alternates: AlternateReference[];
    meter: Meter | null;
    quality: Quality | null;
    basedOn: BasedOn | null;
    sources: SourceRef[];
    caveats: string[];
    /** Whether the value is a ceiling rather than an estimate (total arsenic standing in for inorganic). */
    upperBoundOnly?: boolean;
    pesticides?: {
        samplesTested: number | null;
        samplesWithResidue: number | null;
        percentSamplesWithResidue: number | null;
        samplesOverTolerance: number | null;
        samplesNoTolerance: number | null;
        pesticidesTested: number | null;
        pesticidesDetected: number;
        unratedCount: number;
        residues: ResidueDetail[];
    };
}

export interface ContaminantGroup {
    id: 'heavy_metals' | 'pesticides' | 'microplastics';
    label: string;
    items: ContaminantItem[];
}

export interface ContaminantReport {
    food: { fdcId: number; description: string };
    serving: { grams: number; label: string | null; source: 'requested' | 'typical' };
    /** False when this database has no contaminant tables at all. */
    available: boolean;
    /** True if at least one contaminant has data for this food. */
    hasData: boolean;
    groups: ContaminantGroup[];
    disclaimer: string;
    methodologyUrl: string;
}
