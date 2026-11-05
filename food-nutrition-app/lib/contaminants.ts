import type Database from 'better-sqlite3';
import { getDb } from './db';
import { typicalServing } from './servings';
import type { ServingSize } from './food-types';
import {
    MERCURY_WEEKLY_EDGES, MICROPLASTIC_PARTICLE_EDGES, REFERENCE_DAILY_EDGES,
    dataQuality, formatAmount, formatPercent, groupResidues, hazardIndexPercent, levelFor, levelLabel, meterPosition,
    percentOf, perServing, referenceAmount, servingsLine,
    type AlternateReference, type BasedOn, type ContaminantGroup, type ContaminantItem, type ContaminantReport, type Meter,
    type MeterScale, type Quality, type ReferenceInfo, type ResidueInput, type SourceRef,
} from './contaminants-meter';

type DB = Database.Database;

export const METHODOLOGY_URL = 'https://github.com/yonaadug/FoodNutritionOptimize/blob/main/docs/CONTAMINANT_DATA.md';
export const DISCLAIMER = 'This is general information from public food testing, not medical advice. It shows typical levels, not what is in any one package. '
    + 'Reference levels are cautious planning values, not a line between safe and harmful. If you are pregnant, feeding young children or have health concerns, talk to your clinician.';

interface LinkRow {
    profile_id: string;
    family: string;
    match_method: string;
    confidence: number;
    moisture_factor: number | null;
    caveat: string | null;
    profile_name: string;
    source_id: string;
    samples_total: number | null;
    samples_detected: number | null;
    samples_over_tolerance: number | null;
    samples_no_tolerance: number | null;
    analytes_tested: number | null;
    year_start: number | null;
    year_end: number | null;
    shared_with: number;
    source_name: string;
}

interface MeasurementRow {
    profile_id: string;
    contaminant_id: string;
    statistic: string;
    value: number;
    unit: string;
    upper_bound: number | null;
    median: number | null;
    low: number | null;
    high: number | null;
    detection_frequency: number | null;
    n_samples: number | null;
    n_detected: number | null;
    reporting_limit: number | null;
    year_start: number | null;
    year_end: number | null;
    source_id: string;
    notes: string | null;
    name: string;
    reference_id: string | null;
    parent_name: string | null;
    role: string | null;
}

interface ReferenceRow {
    id: string;
    contaminant: string;
    value: number;
    unit: string;
    period: 'day' | 'week';
    per_kg_bw: number;
    body_weight_kg: number;
    population: string;
    basis: string;
    why_chosen: string | null;
    authority: string;
    year: string;
    source_id: string;
    is_default: number;
    notes: string | null;
}

function hasTables(db: DB): boolean {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN
        ('contaminant_profiles', 'contaminant_measurements', 'food_contaminant_profiles', 'contaminant_reference_values', 'contaminant_sources')`).get() as { n: number };
    return row.n === 5;
}

function sourceRef(row: SourceRef): SourceRef {
    return { id: row.id, name: row.name, publisher: row.publisher, year: row.year, citation: row.citation, url: row.url, license: row.license };
}

function toReferenceInfo(r: ReferenceRow): ReferenceInfo {
    return {
        id: r.id,
        amountUg: referenceAmount(r),
        period: r.period,
        value: r.value,
        unit: r.unit,
        bodyWeightKg: r.per_kg_bw ? r.body_weight_kg : null,
        population: r.population,
        basis: r.basis,
        whyChosen: r.why_chosen,
        authority: r.authority,
        year: r.year,
        notes: r.notes,
    };
}

function makeMeter(value: number, edges: readonly number[], scale: MeterScale, text: string): Meter {
    const level = levelFor(value, edges);
    return { level, label: levelLabel(level, scale), scale, position: meterPosition(value, edges), text, edges };
}

function basedOn(link: LinkRow): BasedOn {
    return {
        profileId: link.profile_id,
        family: link.family,
        name: link.profile_name,
        sourceName: link.source_name,
        matchMethod: link.match_method,
        matchConfidence: link.confidence,
        sharedWith: link.shared_with,
        moistureFactor: link.moisture_factor,
    };
}

function moistureNote(link: LinkRow): string | null {
    const f = link.moisture_factor;
    if (f === null) return null;
    return f > 1
        ? `Scaled up about ${Number(f.toPrecision(2))}x because this form has less water than the measured form, so more of it is the solid part of the food.`
        : `Scaled down about ${Number((1 / f).toPrecision(2))}x because this form has more water than the measured form, so less of it is the solid part of the food.`;
}

/** Caveats common to any measured row. */
function linkCaveats(link: LinkRow, m: MeasurementRow): string[] {
    const out: string[] = [];
    if (link.caveat) out.push(link.caveat);
    const note = moistureNote(link);
    if (note) out.push(note);
    if (m.n_samples !== null && m.n_samples < 5) out.push(`Based on only ${m.n_samples} sample${m.n_samples === 1 ? '' : 's'}, so treat this as a rough figure.`);
    if (m.notes && m.source_id !== 'fda_tds_2018_2020') out.push(m.notes);
    return out;
}

function qualityOf(link: LinkRow, m: MeasurementRow): Quality {
    return {
        grade: dataQuality({ samples: m.n_samples, confidence: link.confidence, yearEnd: m.year_end, moistureAdjusted: link.moisture_factor !== null }),
        samples: m.n_samples,
        detected: m.n_detected,
        detectionRate: m.detection_frequency,
        yearStart: m.year_start,
        yearEnd: m.year_end,
        matchMethod: link.match_method,
        matchConfidence: link.confidence,
        moistureAdjusted: link.moisture_factor !== null,
    };
}

const NO_DATA: Record<string, string> = {
    lead: 'No lead data for this food. That does not mean it contains none.',
    cadmium: 'No cadmium data for this food. That does not mean it contains none.',
    mercury: 'No mercury data for this food. That does not mean it contains none.',
    arsenic: 'No arsenic data for this food. That does not mean it contains none.',
    pesticide_residues: 'No pesticide testing we could match to this food. That does not mean it has no residues.',
    microplastics: 'No published microplastic estimate for this food. Very few foods have been studied.',
};

function emptyItem(id: string, name: string): ContaminantItem {
    return {
        id, name, status: 'no_data', explanation: NO_DATA[id] ?? 'No data for this food.',
        perServing: null, concentration: null, reference: null, percentOfReference: null, servingsLine: null,
        alternates: [], meter: null, quality: null, basedOn: null, sources: [], caveats: [],
    };
}

interface Context {
    grams: number;
    links: Map<string, LinkRow>;
    measurements: MeasurementRow[];
    references: Map<string, ReferenceRow>;
    alternatesFor: (contaminant: string) => ReferenceRow[];
    sources: Map<string, SourceRef>;
    isSeafood: boolean;
}

function sourcesFor(ctx: Context, ...ids: (string | undefined | null)[]): SourceRef[] {
    const seen = new Set<string>();
    const out: SourceRef[] = [];
    for (const id of ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const s = ctx.sources.get(id);
        if (s) out.push(sourceRef(s));
    }
    return out;
}

/** Measurement for a contaminant from the highest-priority profile family that has one. */
function pick(ctx: Context, contaminantId: string, families: string[]): { m: MeasurementRow; link: LinkRow } | null {
    for (const family of families) {
        for (const m of ctx.measurements) {
            if (m.contaminant_id !== contaminantId) continue;
            const link = ctx.links.get(m.profile_id);
            if (link?.family === family) return { m, link };
        }
    }
    return null;
}

function alternatesFor(ctx: Context, contaminant: string, amount: number): AlternateReference[] {
    return ctx.alternatesFor(contaminant).flatMap(r => {
        const pct = percentOf(amount, referenceAmount(r));
        if (pct === null) return [];
        const allowance = formatAmount(referenceAmount(r));
        return [{ label: `${r.authority}, ${r.population.toLowerCase()}: ${allowance} µg per ${r.period}`, percent: pct }];
    });
}

/** A metal measured against a reference (lead, cadmium, mercury, inorganic arsenic). */
function metalItem(
    ctx: Context,
    opts: { id: string; name: string; contaminantId: string; refKey: string; families: string[]; edges: readonly number[]; extraCaveats?: string[]; upperBoundOnly?: boolean },
): ContaminantItem | null {
    const hit = pick(ctx, opts.contaminantId, opts.families);
    if (!hit) return null;
    const { m, link } = hit;
    const ref = m.reference_id ? ctx.references.get(m.reference_id) : undefined;
    const factor = link.moisture_factor;
    const amount = perServing(m.value, ctx.grams, factor);
    const upper = m.upper_bound === null ? null : perServing(m.upper_bound, ctx.grams, factor);
    const limitUg = m.reporting_limit === null ? null : perServing(m.reporting_limit, ctx.grams, factor);
    const low = m.low === null ? null : perServing(m.low, ctx.grams, factor);
    const high = m.high === null ? null : perServing(m.high, ctx.grams, factor);
    const allowance = ref ? referenceAmount(ref) : null;
    const notDetected = m.n_detected === 0 && m.value === 0;
    const item: ContaminantItem = {
        id: opts.id,
        name: opts.name,
        status: notDetected ? 'not_detected' : 'measured',
        explanation: '',
        perServing: { amount: notDetected ? null : amount, upperBound: upper, unit: 'µg', low, high },
        concentration: {
            value: m.value, unit: m.unit, statistic: m.statistic, upperBound: m.upper_bound, median: m.median,
            low: m.low, high: m.high, reportingLimit: m.reporting_limit,
        },
        reference: ref ? toReferenceInfo(ref) : null,
        percentOfReference: null,
        servingsLine: null,
        alternates: [],
        meter: null,
        quality: qualityOf(link, m),
        basedOn: basedOn(link),
        sources: sourcesFor(ctx, m.source_id, ref?.source_id),
        caveats: [...linkCaveats(link, m), ...(opts.extraCaveats ?? [])],
        upperBoundOnly: opts.upperBoundOnly,
    };
    if (notDetected) {
        const limit = m.reporting_limit === null ? '' : ` (test limit ${formatAmount(m.reporting_limit)} ppb)`;
        const samples = m.n_samples === null ? 'the samples' : `all ${m.n_samples} samples`;
        item.explanation = `Not detected in ${samples}${limit}. Tiny amounts below the limit can't be ruled out.`;
        if (limitUg !== null) item.perServing!.upperBound = limitUg;
        item.meter = makeMeter(0, opts.edges, 'reference', `${opts.name}: not detected in testing.`);
        item.meter.label = 'Not detected';
        return item;
    }
    if (allowance !== null && ref) {
        const pct = percentOf(amount, allowance);
        if (pct !== null) {
            item.percentOfReference = pct;
            item.servingsLine = servingsLine(pct, ref.period);
            item.alternates = alternatesFor(ctx, ref.contaminant, amount);
            const level = levelLabel(levelFor(pct, opts.edges), 'reference').toLowerCase();
            const prefix = opts.upperBoundOnly ? 'At most about' : 'About';
            const share = `${prefix} ${formatAmount(amount)} µg per serving, ${formatPercent(pct)} of ${ref.authority}'s ${ref.period === 'week' ? 'weekly' : 'daily'} reference.`;
            item.explanation = share;
            item.meter = makeMeter(pct, opts.edges, 'reference', `${opts.name}: ${level}. ${share}`);
        }
    }
    return item;
}

const ARSENIC_CONTEXT_FROM_PERCENT = 25;
const ARSENIC_CONTEXT = "EPA's reference is very cautious: it estimates typical US intake is already about 61% of it.";

/** Arsenic readings rest on a very cautious reference, so elevated rows say so without an expand. */
function withArsenicContext(item: ContaminantItem, extra?: string): ContaminantItem {
    if ((item.percentOfReference ?? 0) >= ARSENIC_CONTEXT_FROM_PERCENT) {
        item.context = extra ? `${ARSENIC_CONTEXT} ${extra}` : ARSENIC_CONTEXT;
    }
    return item;
}

function arsenicItem(ctx: Context): ContaminantItem {
    const name = 'Arsenic';
    const inorganicCaveats = [
        'Our reference covers non-cancer effects only. EPA also classes inorganic arsenic as a carcinogen.',
    ];
    const riceHit = pick(ctx, 'arsenic_inorganic', ['rice']);
    if (riceHit) {
        const item = metalItem(ctx, {
            id: 'arsenic', name: 'Inorganic arsenic', contaminantId: 'arsenic_inorganic', refKey: 'arsenic_inorganic',
            families: ['rice'], edges: REFERENCE_DAILY_EDGES,
            extraCaveats: [
                ...inorganicCaveats,
                'FDA found cooking rice in plenty of extra water and draining it removes 40-60% of inorganic arsenic, though also some added nutrients. Eating a variety of grains lowers exposure too.',
            ],
        });
        if (item) {
            item.sources.push(...sourcesFor(ctx, 'fda_arsenic_advice'));
            return withArsenicContext(item, 'Cooking rice in plenty of water and draining it can remove 40-60%.');
        }
    }
    const tdsInorganic = metalItem(ctx, {
        id: 'arsenic', name: 'Inorganic arsenic', contaminantId: 'arsenic_inorganic', refKey: 'arsenic_inorganic',
        families: ['tds'], edges: REFERENCE_DAILY_EDGES, extraCaveats: inorganicCaveats,
    });
    if (tdsInorganic) return withArsenicContext(tdsInorganic);

    const total = pick(ctx, 'arsenic_total', ['tds']);
    if (!total) return emptyItem('arsenic', name);

    if (ctx.isSeafood) {
        const amount = perServing(total.m.value, ctx.grams, total.link.moisture_factor);
        return {
            ...emptyItem('arsenic', 'Total arsenic'),
            status: 'not_rated',
            explanation: 'Not rated. Arsenic in seafood is mostly organic forms considered far less harmful, and this test can\'t separate them.',
            perServing: { amount, upperBound: null, unit: 'µg', low: null, high: null },
            concentration: {
                value: total.m.value, unit: total.m.unit, statistic: total.m.statistic, upperBound: total.m.upper_bound,
                median: null, low: null, high: total.m.high, reportingLimit: total.m.reporting_limit,
            },
            quality: qualityOf(total.link, total.m),
            basedOn: basedOn(total.link),
            sources: sourcesFor(ctx, total.m.source_id),
            caveats: linkCaveats(total.link, total.m),
        };
    }
    const item = metalItem(ctx, {
        id: 'arsenic', name: 'Arsenic (total)', contaminantId: 'arsenic_total', refKey: 'arsenic_inorganic',
        families: ['tds'], edges: REFERENCE_DAILY_EDGES, upperBoundOnly: true,
        extraCaveats: [
            'Only total arsenic was measured. We count all of it as the more harmful inorganic form, so the real figure is probably lower.',
            ...inorganicCaveats,
        ],
    });
    return item ? withArsenicContext(item) : emptyItem('arsenic', name);
}

function mercuryCaveats(ctx: Context, family: string): string[] {
    if (family !== 'fish') return [];
    return [
        'FDA and EPA publish a list of Best Choices, Good Choices and Choices to Avoid. Follow that list if you are pregnant, breastfeeding or feeding children. It is stricter for some species.',
        'Levels vary with the size and origin of the fish.',
    ];
}

function pesticideItem(ctx: Context): ContaminantItem {
    const link = [...ctx.links.values()].find(l => l.family === 'pdp');
    if (!link) return emptyItem('pesticide_residues', 'Pesticide residues');
    const rows = ctx.measurements.filter(m => m.profile_id === link.profile_id);
    const inputs: ResidueInput[] = rows.map(m => {
        const ref = m.reference_id ? ctx.references.get(m.reference_id) : undefined;
        return {
            contaminantId: m.contaminant_id,
            name: m.name,
            parentName: m.parent_name ?? m.name,
            role: m.role ?? 'parent',
            meanUgPerKg: m.value,
            maxUgPerKg: m.high,
            detectionFrequency: m.detection_frequency,
            allowanceUgPerDay: ref ? referenceAmount(ref) : null,
        };
    });
    const groups = groupResidues(inputs, ctx.grams);
    const refByParent = new Map(rows.map(m => [m.parent_name ?? m.name, m.reference_id ? ctx.references.get(m.reference_id) : undefined]));
    const samples = link.samples_total;
    const withResidue = link.samples_detected;
    const pctSamples = samples && withResidue !== null ? (withResidue / samples) * 100 : null;
    const yearsRow = { n_samples: samples, year_end: link.year_end };
    const quality: Quality = {
        grade: dataQuality({ samples: yearsRow.n_samples, confidence: link.confidence, yearEnd: yearsRow.year_end }),
        samples,
        detected: withResidue,
        detectionRate: pctSamples === null ? null : pctSamples / 100,
        yearStart: link.year_start,
        yearEnd: link.year_end,
        matchMethod: link.match_method,
        matchConfidence: link.confidence,
        moistureAdjusted: false,
    };
    const caveats = [
        'USDA washes or peels produce as a consumer would before testing. Cooking and processing can change residues, and they were not measured here.',
        'Adding up different pesticides is a cautious simplification. EPA combines only pesticides that act the same way.',
    ];
    if (link.caveat) caveats.unshift(link.caveat);
    if (link.year_end !== null && link.year_end <= 2018) {
        caveats.push(`USDA last tested this food in ${link.year_end}. Pesticide use may have changed since then.`);
    }
    const base = emptyItem('pesticide_residues', 'Pesticide residues');
    const samplesDetail = {
        samplesTested: samples,
        samplesWithResidue: withResidue,
        percentSamplesWithResidue: pctSamples,
        samplesOverTolerance: link.samples_over_tolerance,
        samplesNoTolerance: link.samples_no_tolerance,
        pesticidesTested: link.analytes_tested,
    };
    if (groups.length === 0) {
        return {
            ...base,
            status: 'not_detected',
            explanation: `No residues detected in ${samples ?? 'the'} samples tested. Tiny amounts below test limits can't be ruled out.`,
            meter: { ...makeMeter(0, REFERENCE_DAILY_EDGES, 'reference', 'Pesticide residues: not detected in testing.'), label: 'Not detected' },
            quality,
            basedOn: basedOn(link),
            sources: sourcesFor(ctx, 'usda_pdp', 'usda_pdp_summary'),
            caveats,
            pesticides: { ...samplesDetail, pesticidesDetected: 0, unratedCount: 0, residues: [] },
        };
    }
    const hi = hazardIndexPercent(groups);
    const unrated = groups.filter(g => g.percent === null).length;
    const foundOn = pctSamples === null ? '' : `Found on ${formatPercent(pctSamples)} of samples. `;
    const share = `At average levels, one serving adds up to ${formatPercent(hi)} of EPA's daily reference doses.`;
    const level = levelLabel(levelFor(hi, REFERENCE_DAILY_EDGES), 'reference').toLowerCase();
    if (unrated > 0) caveats.push(`${unrated} detected pesticide${unrated === 1 ? ' has' : 's have'} no EPA reference dose in our tables, so ${unrated === 1 ? 'it is' : 'they are'} listed but not counted in the meter.`);
    const refSources = new Set<string>();
    for (const g of groups) {
        const r = refByParent.get(g.name);
        if (r) refSources.add(r.source_id);
    }
    for (const g of groups.slice(0, 10)) {
        const note = refByParent.get(g.name)?.notes;
        if (note && (g.percent ?? 0) >= 0.1) caveats.push(`${g.name}: ${note}`);
    }
    return {
        ...base,
        status: 'measured',
        explanation: `${foundOn}${share}`,
        perServing: { amount: groups.reduce((s, g) => s + g.amountUg, 0), upperBound: null, unit: 'µg', low: null, high: null },
        percentOfReference: hi,
        servingsLine: servingsLine(hi, 'day'),
        meter: makeMeter(hi, REFERENCE_DAILY_EDGES, 'reference', `Pesticide residues: ${level}. ${foundOn}${share}`),
        quality,
        basedOn: basedOn(link),
        sources: sourcesFor(ctx, 'usda_pdp', 'usda_pdp_summary', ...refSources),
        caveats,
        pesticides: {
            ...samplesDetail,
            pesticidesDetected: groups.length,
            unratedCount: unrated,
            residues: groups.map(g => {
                const r = refByParent.get(g.name);
                return {
                    name: g.name,
                    amountUg: g.amountUg,
                    percent: g.percent,
                    detectionRate: g.detectionFrequency,
                    maxPpm: g.maxUgPerKg === null ? null : g.maxUgPerKg / 1000,
                    allowanceUgPerDay: r ? referenceAmount(r) : null,
                    referenceBasis: r?.basis ?? null,
                    forms: g.forms,
                };
            }),
        },
    };
}

function microplasticItem(ctx: Context): ContaminantItem {
    const hit = pick(ctx, 'microplastics', ['mp']);
    if (!hit) return emptyItem('microplastics', 'Microplastics');
    const { m, link } = hit;
    const amount = (m.value * ctx.grams);
    const low = m.low === null ? null : m.low * ctx.grams;
    const high = m.high === null ? null : m.high * ctx.grams;
    const count = amount >= 1 ? `about ${formatAmount(amount)}` : amount >= 0.1 ? 'fewer than 1' : 'far fewer than 1';
    const text = `Published estimates suggest ${count} particle${amount >= 1.5 ? 's' : ''} per serving. No health limit exists, so this is not a safety rating.`;
    return {
        ...emptyItem('microplastics', 'Microplastics'),
        status: 'measured',
        explanation: text,
        perServing: { amount, upperBound: null, unit: 'particles', low, high },
        concentration: {
            value: m.value, unit: m.unit, statistic: m.statistic, upperBound: null, median: null,
            low: m.low, high: m.high, reportingLimit: null,
        },
        meter: makeMeter(amount, MICROPLASTIC_PARTICLE_EDGES, 'relative', `Microplastics, limited data: ${levelLabel(levelFor(amount, MICROPLASTIC_PARTICLE_EDGES), 'relative').toLowerCase()}. ${text}`),
        quality: {
            grade: 'limited', samples: null, detected: null, detectionRate: null, yearStart: m.year_start, yearEnd: m.year_end,
            matchMethod: link.match_method, matchConfidence: link.confidence, moistureAdjusted: false,
        },
        basedOn: basedOn(link),
        sources: sourcesFor(ctx, m.source_id, 'fda_microplastics'),
        caveats: [
            ...(link.caveat ? [link.caveat] : []),
            ...(m.notes ? m.notes.split('; ') : []),
            'Methods differ widely between studies, and many counted particles were never chemically confirmed as plastic. Compare foods loosely, if at all.',
            'FDA says current evidence does not show that levels detected in foods pose a risk to human health.',
        ],
    };
}

export class FoodNotFoundError extends Error {}

export function getContaminantReportIn(db: DB, fdcId: number, grams?: number): ContaminantReport {
    const food = db.prepare('SELECT id, fdc_id, description, food_category, calories FROM foods WHERE fdc_id = ?').get(fdcId) as
        { id: number; fdc_id: number; description: string; food_category: string | null; calories: number } | undefined;
    if (!food) throw new FoodNotFoundError(`No food with fdcId ${fdcId}`);

    let servingLabel: string | null = null;
    let servingGrams = grams;
    if (servingGrams === undefined) {
        const rows = db.prepare('SELECT id, food_id, label, weight_g FROM serving_sizes WHERE food_id = ?').all(food.id) as ServingSize[];
        const typical = typicalServing(rows, food);
        servingGrams = typical.grams;
        servingLabel = typical.label;
    }
    const serving = { grams: servingGrams, label: servingLabel, source: grams === undefined ? 'typical' as const : 'requested' as const };
    const report = (available: boolean, hasData: boolean, groups: ContaminantGroup[]): ContaminantReport => ({
        food: { fdcId: food.fdc_id, description: food.description },
        serving,
        available,
        hasData,
        groups,
        disclaimer: DISCLAIMER,
        methodologyUrl: METHODOLOGY_URL,
    });
    if (!hasTables(db)) return report(false, false, []);

    const links = db.prepare(`
        SELECT l.profile_id, l.family, l.match_method, l.confidence, l.moisture_factor, l.caveat,
               p.name AS profile_name, p.source_id, p.samples_total, p.samples_detected, p.samples_over_tolerance,
               p.samples_no_tolerance, p.analytes_tested, p.year_start, p.year_end,
               (SELECT COUNT(*) FROM food_contaminant_profiles x WHERE x.profile_id = l.profile_id) AS shared_with,
               s.name AS source_name
        FROM food_contaminant_profiles l
        JOIN contaminant_profiles p ON p.id = l.profile_id
        JOIN contaminant_sources s ON s.id = p.source_id
        WHERE l.fdc_id = ?`).all(fdcId) as LinkRow[];
    const measurements = db.prepare(`
        SELECT m.*, c.name, c.reference_id, c.parent_name, c.role
        FROM contaminant_measurements m
        JOIN contaminants c ON c.id = m.contaminant_id
        WHERE m.profile_id IN (SELECT profile_id FROM food_contaminant_profiles WHERE fdc_id = ?)`).all(fdcId) as MeasurementRow[];
    const references = new Map<string, ReferenceRow>(
        (db.prepare(`
            SELECT r.* FROM contaminant_reference_values r
            WHERE r.id IN (SELECT c.reference_id FROM contaminants c
                           JOIN contaminant_measurements m ON m.contaminant_id = c.id
                           JOIN food_contaminant_profiles l ON l.profile_id = m.profile_id
                           WHERE l.fdc_id = ?)
               OR r.is_default = 0 AND r.contaminant NOT LIKE 'pesticide:%'`).all(fdcId) as ReferenceRow[]).map(r => [r.id, r]));
    const sources = new Map<string, SourceRef>(
        (db.prepare('SELECT id, name, publisher, year, citation, url, license FROM contaminant_sources').all() as SourceRef[]).map(s => [s.id, s]));

    const ctx: Context = {
        grams: servingGrams,
        links: new Map(links.map(l => [l.profile_id, l])),
        measurements,
        references,
        alternatesFor: contaminant => [...references.values()].filter(r => r.contaminant === contaminant && !r.is_default),
        sources,
        isSeafood: links.some(l => l.family === 'fish') || /finfish|shellfish|seafood/i.test(food.food_category ?? ''),
    };

    const metal = (id: string, name: string, families: string[], edges: readonly number[], extraCaveats?: string[]) =>
        metalItem(ctx, { id, name, contaminantId: id, refKey: id, families, edges, extraCaveats }) ?? emptyItem(id, name);
    const mercuryFamily = pick(ctx, 'mercury', ['fish', 'tds'])?.link.family ?? '';
    const groups: ContaminantGroup[] = [
        {
            id: 'heavy_metals',
            label: 'Heavy metals',
            items: [
                metal('lead', 'Lead', ['tds'], REFERENCE_DAILY_EDGES, ['FDA says no safe level of lead exposure is known, so a low reading is not a guarantee of no effect.']),
                metal('cadmium', 'Cadmium', ['tds'], REFERENCE_DAILY_EDGES),
                metal('mercury', 'Mercury', ['fish', 'tds'], MERCURY_WEEKLY_EDGES, mercuryCaveats(ctx, mercuryFamily)),
                arsenicItem(ctx),
            ],
        },
        { id: 'pesticides', label: 'Pesticides', items: [pesticideItem(ctx)] },
        { id: 'microplastics', label: 'Microplastics', items: [microplasticItem(ctx)] },
    ];
    for (const item of groups[0].items) {
        if (item.id === 'mercury' && item.sources.length && mercuryFamily === 'fish') item.sources.push(...sourcesFor(ctx, 'fda_fish_advice'));
    }
    const hasData = groups.some(g => g.items.some(i => i.status !== 'no_data'));
    return report(true, hasData, groups);
}

export function getContaminantReport(fdcId: number, grams?: number): ContaminantReport {
    return getContaminantReportIn(getDb(), fdcId, grams);
}
