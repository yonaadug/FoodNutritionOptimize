/**
 * Server side of the plan contaminant check: each food's data comes from the food page's own
 * report (getContaminantReportIn at 100 g), so a plan and a food page can never disagree.
 * The math across foods is in lib/plan-contaminants-core.ts.
 *
 * PLUS-GATE: planContaminants. planContaminantsIn / swapCandidatesIn are the server functions
 * the Plus check wraps (see app/api/plan/contaminants/route.ts).
 */
import type Database from 'better-sqlite3';
import { getDb } from './db';
import { FoodNotFoundError, getContaminantReportIn } from './contaminants';
import { referenceAmount, type ContaminantItem } from './contaminants-meter';
import {
    PLAN_CONTAMINANT_IDS, planFdcIds, summarizePlanContaminants,
    type ContaminantUnits, type FoodContaminantUnit, type PlanContaminantId, type PlanContaminantSummary, type PlanPortion,
    type PlanReference, type UnitItem,
} from './plan-contaminants-core';

type DB = Database.Database;

export * from './plan-contaminants-core';

/** Reports per database connection, by fdc id. The database is read-only, so they never go stale. */
const unitCache = new WeakMap<DB, Map<number, FoodContaminantUnit | null>>();
const CACHE_MAX = 3000;

function toUnitItem(item: ContaminantItem | undefined): UnitItem {
    if (!item) return { status: 'no_data', amount: null, percent: null, upperBoundOnly: false, grade: null };
    return {
        status: item.status,
        amount: item.perServing?.amount ?? null,
        percent: item.percentOfReference,
        upperBoundOnly: item.upperBoundOnly === true,
        grade: item.quality?.grade ?? null,
    };
}

/** One food's data per 100 g, or null for a food the database doesn't have. */
export function foodContaminantUnitIn(db: DB, fdcId: number): FoodContaminantUnit | null {
    let cache = unitCache.get(db);
    if (!cache) { cache = new Map(); unitCache.set(db, cache); }
    if (cache.has(fdcId)) return cache.get(fdcId)!;
    let unit: FoodContaminantUnit | null = null;
    try {
        const report = getContaminantReportIn(db, fdcId, 100);
        const all = report.groups.flatMap(g => g.items);
        const byId = new Map(all.map(i => [i.id, i]));
        const category = db.prepare('SELECT food_category FROM foods WHERE fdc_id = ?').get(fdcId) as { food_category: string | null } | undefined;
        unit = {
            fdcId,
            description: report.food.description,
            foodCategory: category?.food_category ?? null,
            items: Object.fromEntries(PLAN_CONTAMINANT_IDS.map(id => [id, toUnitItem(byId.get(id))])) as Record<PlanContaminantId, UnitItem>,
        };
    } catch (e) {
        if (!(e instanceof FoodNotFoundError)) throw e;
    }
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(fdcId, unit);
    return unit;
}

const REFERENCE_FOR: Partial<Record<PlanContaminantId, string>> = {
    lead: 'lead', cadmium: 'cadmium', mercury: 'mercury', arsenic: 'arsenic_inorganic',
};

function hasTable(db: DB, name: string): boolean {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/** The default reference for each metal, as the food page uses it. */
export function planReferencesIn(db: DB): Partial<Record<PlanContaminantId, PlanReference>> {
    if (!hasTable(db, 'contaminant_reference_values')) return {};
    const rows = db.prepare('SELECT contaminant, value, per_kg_bw, body_weight_kg, period, authority, population FROM contaminant_reference_values WHERE is_default = 1')
        .all() as { contaminant: string; value: number; per_kg_bw: number; body_weight_kg: number; period: 'day' | 'week'; authority: string; population: string }[];
    const out: Partial<Record<PlanContaminantId, PlanReference>> = {};
    for (const [id, contaminant] of Object.entries(REFERENCE_FOR) as [PlanContaminantId, string][]) {
        const r = rows.find(x => x.contaminant === contaminant);
        if (r) out[id] = { amountUg: referenceAmount(r), period: r.period, authority: r.authority, population: r.population };
    }
    return out;
}

export function contaminantUnitsIn(db: DB, fdcIds: readonly number[]): ContaminantUnits {
    const available = hasTable(db, 'food_contaminant_profiles');
    const foods: Record<string, FoodContaminantUnit> = {};
    if (available) {
        for (const id of fdcIds) {
            const unit = foodContaminantUnitIn(db, id);
            if (unit) foods[String(id)] = unit;
        }
    }
    return { foods, references: planReferencesIn(db), available };
}

/** PLUS-GATE: planContaminants. The whole-plan check (one day, or each day of a week). */
export function planContaminantsIn(db: DB, days: readonly (readonly PlanPortion[])[]): PlanContaminantSummary {
    return summarizePlanContaminants(days, contaminantUnitsIn(db, planFdcIds(days)));
}

export function planContaminants(days: readonly (readonly PlanPortion[])[]): PlanContaminantSummary {
    return planContaminantsIn(getDb(), days);
}

export interface SwapCandidate {
    fdcId: number;
    description: string;
    /** Percent of the reference in 100 g, next to the original's. */
    percentPer100g: number;
    originalPercentPer100g: number;
}

const CANDIDATE_POOL = 120;

/**
 * Foods from the same USDA category with at most half the contaminant per 100 g, closest in
 * calories first. Only foods with a measurement (or a not-detected result) qualify: a food with
 * no data is never offered as "lower".
 */
export function swapCandidatesIn(db: DB, fdcId: number, contaminant: PlanContaminantId, exclude: readonly number[] = [], limit = 3): SwapCandidate[] {
    if (contaminant === 'microplastics') return [];
    const original = foodContaminantUnitIn(db, fdcId);
    const base = original?.items[contaminant];
    if (!original || !base || base.percent === null || !(base.percent > 0)) return [];
    const food = db.prepare('SELECT food_category, calories, protein_g FROM foods WHERE fdc_id = ?').get(fdcId) as
        { food_category: string | null; calories: number; protein_g: number | null } | undefined;
    if (!food?.food_category) return [];
    const pool = db.prepare(`
        SELECT f.fdc_id, f.calories, f.protein_g FROM foods f
        WHERE f.food_category = ? AND f.fdc_id <> ? AND f.superseded_by_fdc_id IS NULL
          AND EXISTS (SELECT 1 FROM food_contaminant_profiles l WHERE l.fdc_id = f.fdc_id)
        ORDER BY ABS(f.calories - ?) LIMIT ?`).all(food.food_category, fdcId, food.calories, CANDIDATE_POOL) as
        { fdc_id: number; calories: number; protein_g: number | null }[];
    const skip = new Set(exclude);
    const out: (SwapCandidate & { distance: number })[] = [];
    for (const row of pool) {
        if (skip.has(row.fdc_id)) continue;
        const unit = foodContaminantUnitIn(db, row.fdc_id);
        const item = unit?.items[contaminant];
        if (!unit || !item || (item.status !== 'measured' && item.status !== 'not_detected')) continue;
        const pct = item.status === 'not_detected' ? 0 : item.percent;
        if (pct === null || pct > base.percent / 2) continue;
        const kcal = Math.abs(row.calories - food.calories) / Math.max(50, food.calories);
        const protein = Math.abs((row.protein_g ?? 0) - (food.protein_g ?? 0)) / Math.max(5, food.protein_g ?? 0);
        out.push({ fdcId: row.fdc_id, description: unit.description, percentPer100g: pct, originalPercentPer100g: base.percent, distance: kcal + protein });
    }
    out.sort((a, b) => a.distance - b.distance);
    return out.slice(0, limit).map(({ distance: _d, ...c }) => { void _d; return c; });
}
