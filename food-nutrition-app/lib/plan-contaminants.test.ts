import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
    PLAN_TOTAL_EDGES, contaminantUnitsIn, planContaminantsIn, reduceFactor, summarizePlanContaminants, swapCandidatesIn,
    type ContaminantUnits, type PlanContaminantRow, type PlanContaminantSummary, type PlanPortion,
} from './plan-contaminants';
import { PlanContaminantRequestError, parsePlanContaminantRequest } from './plan-contaminants-request';

const FULL_DB = path.resolve(process.cwd(), 'nutrition.db');
const skip = !fs.existsSync(FULL_DB) || fs.statSync(FULL_DB).size < 1_000_000;

// Real foods, with the values the database holds for them (checked by hand below).
const TUNA = 334194; // Fish, tuna, light, canned in water, drained solids (FDA mercury 126 ppb, TDS cadmium 25.3333 ppb)
const RICE = 168878; // Rice, white, long-grain, regular, enriched, cooked (FDA inorganic arsenic 103.3 ppb x 0.357, TDS cadmium 6.54444 ppb)
const AMARANTH_FLOUR = 2779262; // no contaminant data at all
const ARUGULA = 2710822; // no contaminant data at all

const near = (actual: number | null | undefined, expected: number, tol = 1e-3) =>
    assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);
const row = (s: PlanContaminantSummary, id: string): PlanContaminantRow => s.rows.find(r => r.id === id)!;
const p = (key: number, fdcId: number | null, grams: number, name = `food ${key}`): PlanPortion => ({ key, fdcId, grams, name });

describe('plan contaminants on the real database', { skip }, () => {
    let db: Database.Database;
    before(() => { db = new Database(FULL_DB, { readonly: true }); });
    after(() => db?.close());

    it('totals a day of tuna and rice exactly as hand-calculated', () => {
        // 150 g tuna + 200 g rice.
        const s = planContaminantsIn(db, [[p(1, TUNA, 150, 'Tuna'), p(2, RICE, 200, 'Rice')]]);
        assert.equal(s.period, 'day');
        assert.equal(s.foodsInPlan, 2);
        assert.deepEqual(s.noDataFoods, []);

        // Cadmium: 25.3333 ppb x 150 g / 1000 = 3.8 mcg; 6.54444 ppb x 200 g / 1000 = 1.30889 mcg.
        // 5.10889 mcg of FDA's 0.21 mcg/kg x 80 kg = 16.8 mcg a day = 30.41%: moderate on the plan bands.
        const cd = row(s, 'cadmium');
        near(cd.total, 5.108888, 1e-4);
        near(cd.percent, 30.4100, 1e-3);
        assert.equal(cd.level, 'moderate');
        assert.deepEqual(cd.flagged, []);
        near(cd.contributors[0].share, 3.8 / 5.108888, 1e-4);
        assert.equal(cd.contributors[0].name, 'Tuna');

        // Mercury: 126 ppb x 150 g / 1000 = 18.9 mcg, rice adds 0.0518519 ppb x 200 g / 1000 = 0.01037 mcg.
        // 18.91037 mcg of EPA's 0.7 mcg/kg/week x 75 kg = 52.5 mcg a week = 36.02%: elevated on the weekly
        // (fish advice) bands, with tuna the food that pushes it there.
        const hg = row(s, 'mercury');
        near(hg.total, 18.91037, 1e-4);
        near(hg.percent, 36.0198, 1e-3);
        assert.equal(hg.reference?.period, 'week');
        assert.equal(hg.level, 'elevated');
        assert.deepEqual(hg.flagged, [1]);
        near(hg.weekIfEveryDay, 36.0198 * 7, 1e-2);

        // Inorganic arsenic: 103.3 ppb x 0.357 (moisture) x 200 g / 1000 = 7.37562 mcg of EPA's
        // 0.06 x 80 = 4.8 mcg a day = 153.66%: high, rice flagged. Tuna's arsenic is not rated (organic forms).
        const as = row(s, 'arsenic');
        near(as.total, 7.37562, 1e-4);
        near(as.percent, 153.6588, 1e-3);
        assert.equal(as.level, 'high');
        assert.deepEqual(as.flagged, [2]);
        assert.deepEqual(as.notRated.map(f => f.key), [1]);
        assert.ok(as.context?.includes('61%'));
        // Keeping 32% of the rice (64 g) brings it just under the 50% line.
        const keep = reduceFactor(as, 2)!;
        assert.ok(keep > 0.3 && keep < 0.33, String(keep));

        // Lead: not detected in either food. Counted as tested, adds nothing.
        const pb = row(s, 'lead');
        assert.equal(pb.status, 'not_detected');
        assert.equal(pb.total, 0);
        assert.equal(pb.notDetected.length, 2);

        // Pesticides: rice only (tuna has no testing), so the total is a floor.
        const pest = row(s, 'pesticide_residues');
        assert.equal(pest.atLeast, true);
        assert.deepEqual(pest.unknown.map(f => f.key), [1]);
        near(pest.percent, 0.275647 * 2, 1e-4);

        // Microplastics: a comparison only, never a level. 5.5 particles per 100 g of tuna x 1.5.
        const mp = row(s, 'microplastics');
        assert.equal(mp.kind, 'comparison');
        assert.equal(mp.level, null);
        assert.equal(mp.percent, null);
        near(mp.total, 8.25, 1e-6);
        assert.match(mp.text, /not a safety rating/);
    });

    it('matches the food page for one food at its planned grams', () => {
        const s = planContaminantsIn(db, [[p(1, TUNA, 85)]]);
        // The food panel for 85 g: 126 x 85 / 1000 = 10.71 mcg, 20.4% of the week.
        near(row(s, 'mercury').total, 10.71, 1e-6);
        near(row(s, 'mercury').percent, 20.4, 1e-6);
    });

    it('treats foods without data as unknown, never zero', () => {
        const s = planContaminantsIn(db, [[p(1, AMARANTH_FLOUR, 50, 'Amaranth flour'), p(2, ARUGULA, 40, 'Arugula')]]);
        assert.equal(s.noDataFoods.length, 2);
        for (const r of s.rows) {
            assert.equal(r.status, 'no_data', r.id);
            assert.equal(r.level, null, r.id);
            assert.equal(r.percent, null, r.id);
            assert.equal(r.unknown.length, 2, r.id);
            assert.deepEqual(r.flagged, []);
        }
        assert.match(row(s, 'lead').text, /does not mean there is none/);
    });

    it('a recipe (no fdc id) counts as no data', () => {
        const s = planContaminantsIn(db, [[p(-5, null, 300, 'Chili'), p(2, RICE, 100)]]);
        assert.deepEqual(s.noDataFoods.map(f => f.name), ['Chili']);
        assert.equal(row(s, 'cadmium').atLeast, true);
    });

    it('totals mercury over a real week against the weekly reference', () => {
        // Tuna 150 g on Monday, Wednesday and Friday; rice 200 g every day.
        const days = Array.from({ length: 7 }, (_, d) => [
            ...(d % 2 === 0 && d < 6 ? [p(1, TUNA, 150, 'Tuna')] : []),
            p(2, RICE, 200, 'Rice'),
        ]);
        const s = planContaminantsIn(db, days);
        assert.equal(s.period, 'week');
        const hg = row(s, 'mercury');
        // 3 x 18.9 + 7 x 0.0103704 = 56.77259 mcg = 108.14% of 52.5: over the week's reference.
        near(hg.total, 56.77259, 1e-4);
        near(hg.percent, 108.1383, 1e-3);
        assert.equal(hg.level, 'high');
        assert.deepEqual(hg.flagged, [1]);
        assert.equal(hg.edges, PLAN_TOTAL_EDGES);
        assert.equal(hg.contributors[0].grams, 450);
        // Cadmium is daily: the average day is (3 x 3.8 + 7 x 1.30889) / 7 = 2.93746 mcg = 17.48%.
        const cd = row(s, 'cadmium');
        near(cd.percent, (3 * 3.8 + 7 * 1.308888) / 7 / 16.8 * 100, 1e-3);
        assert.equal(cd.highestDay?.day, 0);
        near(cd.highestDay?.percent, 30.41, 1e-2);
    });

    it('offers lower-mercury swaps from the same category', () => {
        const swaps = swapCandidatesIn(db, TUNA, 'mercury', [TUNA]);
        assert.ok(swaps.length > 0);
        for (const c of swaps) assert.ok(c.percentPer100g <= c.originalPercentPer100g / 2);
        assert.deepEqual(swapCandidatesIn(db, AMARANTH_FLOUR, 'mercury'), []);
    });

    it('reads references and units from the database', () => {
        const units = contaminantUnitsIn(db, [TUNA, 999_999_999]);
        assert.equal(units.available, true);
        assert.ok(units.foods[String(TUNA)]);
        assert.equal(units.foods['999999999'], undefined);
        near(units.references.cadmium?.amountUg, 16.8, 1e-9);
        assert.equal(units.references.lead?.amountUg, 8.8);
    });
});

describe('plan contaminant math', () => {
    const units: ContaminantUnits = {
        available: true,
        references: { lead: { amountUg: 8.8, period: 'day', authority: 'US FDA', population: 'x' } },
        foods: {
            '10': {
                fdcId: 10, description: 'A', foodCategory: null,
                items: {
                    lead: { status: 'measured', amount: 4.4, percent: 50, upperBoundOnly: false, grade: 'good' },
                    cadmium: { status: 'no_data', amount: null, percent: null, upperBoundOnly: false, grade: null },
                    mercury: { status: 'no_data', amount: null, percent: null, upperBoundOnly: false, grade: null },
                    arsenic: { status: 'measured', amount: 1, percent: 10, upperBoundOnly: true, grade: 'fair' },
                    pesticide_residues: { status: 'no_data', amount: null, percent: null, upperBoundOnly: false, grade: null },
                    microplastics: { status: 'no_data', amount: null, percent: null, upperBoundOnly: false, grade: null },
                },
            },
        },
    };

    it('scales linearly with grams and flags the food that crosses the elevated line', () => {
        const s = summarizePlanContaminants([[p(1, 10, 200)]], units);
        const lead = row(s, 'lead');
        assert.equal(lead.total, 8.8);
        assert.equal(lead.percent, 100);
        assert.equal(lead.level, 'high');
        assert.deepEqual(lead.flagged, [1]);
        assert.equal(row(s, 'arsenic').atMost, true);
        assert.match(row(s, 'arsenic').text, /^At most/);
    });

    it('ignores zero-gram portions', () => {
        const s = summarizePlanContaminants([[p(1, 10, 0)]], units);
        assert.equal(s.foodsInPlan, 0);
        assert.equal(row(s, 'lead').status, 'no_data');
    });

    it('validates requests', () => {
        assert.deepEqual(parsePlanContaminantRequest({ days: [[{ key: 1, fdcId: 5, grams: 10, name: 'x' }]] }).days[0][0], p(1, 5, 10, 'x'));
        assert.equal(parsePlanContaminantRequest({ days: [[{ key: -1, fdcId: -1, grams: 10 }]] }).days[0][0].fdcId, null);
        assert.throws(() => parsePlanContaminantRequest({ days: [] }), PlanContaminantRequestError);
        assert.throws(() => parsePlanContaminantRequest({ days: Array(8).fill([]) }), PlanContaminantRequestError);
        assert.throws(() => parsePlanContaminantRequest({ days: [[{ key: 1, fdcId: 5, grams: -1 }]] }), PlanContaminantRequestError);
        assert.throws(() => parsePlanContaminantRequest({ days: [[{ key: 1.5, fdcId: 5, grams: 1 }]] }), PlanContaminantRequestError);
    });
});
