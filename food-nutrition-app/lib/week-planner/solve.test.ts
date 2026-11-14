import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Food } from '../food-types';
import { goalsToPayload } from '@/components/planner/goals';
import { planWeek } from './solve';
import { toLpText, solveWithHighs } from './highs';
import { goalMode, WEEKLY_AVERAGE_KEYS } from './goals';
import { parseWeekRequest, RequestValidationError } from './request';
import { daysPerFood, weekGoalProgress } from './totals';
import type { WeekParams, WeekResult } from './types';

function food(id: number, values: Record<string, number>, extra: Partial<Food> = {}): Food {
    return {
        id, fdc_id: 900000 + id, description: `Food ${id}`, data_type: 'foundation_food', food_category: 'Vegetables and Vegetable Products',
        brand_owner: null, serving_size: null, serving_size_unit: null, calories: values.calories ?? 100,
        protein_g: values.protein_g ?? 0, total_fat_g: 0, carbohydrate_g: 0, fiber_g: 0, sugars_g: 0, saturated_g: 0,
        monounsaturated_g: 0, polyunsaturated_g: 0, trans_g: 0, cholesterol_mg: 0, vitamin_a_ug: 0, vitamin_c_mg: 0,
        vitamin_d_ug: values.vitamin_d_ug ?? 0, vitamin_e_mg: 0, vitamin_k_ug: 0, thiamin_mg: 0, riboflavin_mg: 0, niacin_mg: 0,
        vitamin_b6_mg: 0, folate_ug: 0, vitamin_b12_ug: 0, pantothenic_acid_mg: 0, calcium_mg: 0, iron_mg: 0, magnesium_mg: 0,
        phosphorus_mg: 0, potassium_mg: 0, sodium_mg: 0, zinc_mg: 0, copper_mg: 0, manganese_mg: 0, selenium_ug: 0,
        serving_sizes: [], ...extra,
    };
}

/** Only the goals given are on; calories off unless set. */
function goals(g: Record<string, { min?: number; max?: number }>) {
    const payload: Record<string, unknown> = goalsToPayload(g);
    payload.calories = { min: '', max: '' };
    return payload;
}

const protein = (n = 4, kcal = 100) => Array.from({ length: n }, (_, i) => food(i + 1, { protein_g: 20, calories: kcal + i }));

async function plan(p: Partial<WeekParams>): Promise<WeekResult> {
    return planWeek({ foods: [], customConstraints: goals({ protein_g: { min: 40 } }), portionCap: { grams: 300 }, ...p });
}

function used(r: WeekResult, foodId: number): number[] {
    return r.days!.flatMap(d => (d.entries.some(e => e.foodId === foodId) ? [d.index] : []));
}

describe('week planner model', () => {
    it('meets a daily goal on every day and keeps each food to its variety limit', async () => {
        const r = await plan({ foods: protein(4), settings: { maxDaysPerFood: 2 } });
        assert.equal(r.success, true, r.message ?? '');
        assert.equal(r.days!.length, 7);
        for (const d of r.days!) assert.ok(d.nutrients.protein_g >= 40 * 0.995, `day ${d.index}: ${d.nutrients.protein_g}`);
        for (const f of protein(4)) assert.ok(used(r, f.id).length <= 2, `food ${f.id} on ${used(r, f.id)}`);
        assert.equal(r.varietyUsed, undefined);
        assert.ok(r.solver.integers > 0);
    });

    it('avoids the same food on two days in a row when it can', async () => {
        const r = await plan({ foods: protein(7, 100).map(f => ({ ...f, calories: 100 })), settings: { maxDaysPerFood: 3 } });
        assert.equal(r.success, true);
        for (let d = 0; d + 1 < 7; d++) {
            const today = new Set(r.days![d].entries.map(e => e.foodId));
            assert.ok(!r.days![d + 1].entries.some(e => today.has(e.foodId)), `repeat on days ${d}-${d + 1}`);
        }
    });

    it('raises the variety limit only as far as needed, and says so', async () => {
        // 4 foods on at most 1 day each can't cover 7 days; 2 days each can.
        const r = await plan({ foods: protein(4), settings: { maxDaysPerFood: 1 } });
        assert.equal(r.success, true);
        assert.equal(r.varietyUsed, 2);
        assert.equal(r.settings.maxDaysPerFood, 1);
    });

    it('uses portions of at least half a serving, or none', async () => {
        const f = protein(3).map(x => ({ ...x, serving_sizes: [{ id: 1, food_id: x.id, label: '1 cup', weight_g: 160 }] }));
        const r = await plan({ foods: f, settings: { maxDaysPerFood: 7 } });
        assert.equal(r.success, true);
        for (const d of r.days!) for (const e of d.entries) assert.ok(e.grams >= 80 - 0.5, `${e.grams} g`);
    });

    it('meets stored nutrients on average over the week, not every day', async () => {
        // Only "salmon" has vitamin D (10 mcg/100 g, at most 200 g a day).
        const salmon = food(50, { vitamin_d_ug: 10, protein_g: 20, calories: 200 });
        const foods = [...protein(4), salmon];
        const g = goals({ protein_g: { min: 40 }, vitamin_d_ug: { min: 6 } });
        // 6 mcg a day = 42 mcg a week = 420 g of salmon: 3 days of 140-200 g fits the limit of 3 days.
        const weekly = await planWeek({ foods, customConstraints: g, portionCap: { grams: 200 }, settings: { maxDaysPerFood: 3 } });
        assert.equal(weekly.success, true, weekly.message ?? '');
        assert.equal(weekly.varietyUsed, undefined);
        assert.ok(used(weekly, 50).length <= 3);
        const totalD = weekly.days!.reduce((s, d) => s + d.nutrients.vitamin_d_ug, 0);
        assert.ok(totalD >= 42 * 0.995, String(totalD));
        assert.ok(weekly.days!.some(d => d.nutrients.vitamin_d_ug < 6), 'some days below the daily amount');
        const progress = weekGoalProgress(weekly.days!, weekly.goals);
        assert.equal(progress.find(p => p.key === 'vitamin_d_ug')?.status, 'met');
        assert.equal(progress.find(p => p.key === 'vitamin_d_ug')?.mode, 'weekly');

        // Every day instead: salmon has to be on all 7 days, past the variety limit.
        const daily = await planWeek({ foods, customConstraints: g, portionCap: { grams: 200 }, settings: { maxDaysPerFood: 3, weeklyAverages: false } });
        assert.equal(daily.success, true);
        assert.equal(daily.varietyUsed, 7);
        assert.equal(used(daily, 50).length, 7);
    });

    it('cooks a recipe once and eats the leftovers the next day', async () => {
        // A recipe that is the cheapest protein: the plan wants it often, but may cook on only 2 days.
        const chili = food(-7, { protein_g: 12, calories: 60 }, {
            description: 'Chili', food_category: 'Recipes',
            recipe: { id: 'r1', servingGrams: 250, uncounted: [], incomplete: [], fingerprint: 'f' },
        });
        const r = await plan({ foods: protein(4), fixedFoods: [{ food: chili, grams: 250 }], settings: { maxDaysPerFood: 2, leftovers: true } });
        assert.equal(r.success, true, r.message ?? '');
        const cooked = r.days!.flatMap(d => d.entries.filter(e => e.foodId === -7 && e.role === 'cooked').map(e => ({ d: d.index, e })));
        const left = r.days!.flatMap(d => d.entries.filter(e => e.foodId === -7 && e.role === 'leftover').map(e => ({ d: d.index, e })));
        assert.ok(cooked.length >= 1 && cooked.length <= 2, `cooked on ${cooked.map(c => c.d)}`);
        assert.ok(left.length >= 1, 'has leftovers');
        for (const l of left) {
            const batch = cooked.find(c => c.d === l.d - 1);
            assert.ok(batch, `leftover on day ${l.d} follows a cooking day`);
            assert.equal((batch!.e.cooked ?? 0) - (batch!.e.servings ?? 0), l.e.servings);
        }
        for (const c of [...cooked, ...left]) assert.equal(c.e.grams, (c.e.servings ?? 0) * 250);

        const none = await plan({ foods: protein(4), fixedFoods: [{ food: chili, grams: 250 }], settings: { maxDaysPerFood: 2, leftovers: false } });
        assert.equal(none.success, true);
        assert.ok(none.days!.every(d => !d.entries.some(e => e.role === 'leftover')));
        assert.ok(used(none, -7).length <= 2);
    });

    it('keeps locked days and foods exactly, and re-plans the rest differently', async () => {
        const foods = protein(6);
        const first = await plan({ foods, settings: { maxDaysPerFood: 3 } });
        assert.equal(first.success, true);
        const day2 = first.days![2];
        const lockedFood = first.days![5].entries[0];
        const locks = {
            days: [2],
            items: [
                ...day2.entries.map(e => ({ day: 2, foodId: e.foodId, grams: e.grams })),
                { day: 5, foodId: lockedFood.foodId, grams: lockedFood.grams },
            ],
        };
        const avoid = first.days!.filter(d => d.index !== 2).flatMap(d => d.entries.map(e => ({ day: d.index, foodId: e.foodId })));
        const again = await plan({ foods, settings: { maxDaysPerFood: 3 }, locks, avoid });
        assert.equal(again.success, true, again.message ?? '');
        assert.deepEqual(again.days![2].entries.map(e => [e.foodId, e.grams]), day2.entries.map(e => [e.foodId, e.grams]));
        assert.ok(again.days![2].locked);
        const kept = again.days![5].entries.find(e => e.foodId === lockedFood.foodId);
        assert.equal(kept?.grams, lockedFood.grams);
        assert.equal(kept?.locked, true);
        // Locked uses count toward variety.
        for (const f of foods) assert.ok(used(again, f.id).length <= 3);
        const changed = again.days!.filter(d => d.index !== 2 && d.index !== 5)
            .some(d => JSON.stringify(d.entries.map(e => e.foodId)) !== JSON.stringify(first.days![d.index].entries.map(e => e.foodId)));
        assert.ok(changed, 'the rest of the week changed');
    });

    it('explains an impossible goal the way the day planner does', async () => {
        const r = await plan({ foods: protein(3), customConstraints: goals({ protein_g: { min: 500 } }) });
        assert.equal(r.success, false);
        assert.equal(r.diagnosis, 'nutrients');
        assert.match(r.message ?? '', /Cannot meet Protein target on any day/);
        assert.equal(r.issues?.[0].nutrient, 'protein_g');
        assert.equal(r.issues?.[0].kind, 'short');
        assert.ok(r.portionCapBinding);
    });

    it('reports contradictory goals and bad input', async () => {
        const r = await plan({ foods: protein(2), customConstraints: goals({ protein_g: { min: 50, max: 10 } }) });
        assert.equal(r.success, false);
        assert.match(r.message ?? '', /minimum .* greater than maximum/);
        assert.match((await planWeek({ foods: [] })).error ?? '', /No foods/);
        assert.match((await planWeek({ foods: [{ id: 'x' } as unknown as Food] })).error ?? '', /food id must be an integer/);
    });

    it('builds goal rows per day and one weekly row for stored nutrients', async () => {
        const r = await plan({ foods: protein(2), settings: { days: 3 } });
        assert.equal(r.days!.length, 3);
        assert.equal(goalMode('vitamin_d_ug', true), 'weekly');
        assert.equal(goalMode('vitamin_d_ug', false), 'daily');
        assert.equal(goalMode('protein_g', true), 'daily');
        assert.ok(WEEKLY_AVERAGE_KEYS.includes('iron_mg'));
        assert.equal(daysPerFood(r.days!).size > 0, true);
    });
});

describe('model internals', () => {
    it('writes an LP HiGHS can read, and spots an empty row that cannot hold', async () => {
        const lp = toLpText({
            optimize: 'cost', opType: 'min',
            constraints: { a: { min: 2 }, b: { max: 3, min: 1 }, c: { equal: 1 } },
            variables: { p: { cost: 1, a: 1, b: 1 }, q: { cost: 2, a: 1, c: 1 } },
            ints: { q: 1 },
        });
        assert.ok(lp);
        assert.match(lp!.text, /Generals\n x1/);
        const s = await solveWithHighs({
            optimize: 'cost', opType: 'min',
            constraints: { a: { min: 2 }, b: { max: 3, min: 1 }, c: { equal: 1 } },
            variables: { p: { cost: 1, a: 1, b: 1 }, q: { cost: 2, a: 1, c: 1 } },
            ints: { q: 1 },
        });
        assert.equal(s.feasible, true);
        assert.equal(s.q, 1);
        assert.equal(s.p, 1);
        assert.equal(toLpText({ optimize: 'cost', opType: 'min', constraints: { e: { min: 1 } }, variables: { p: { cost: 1 } } }), null);
    });
});

describe('week request', () => {
    it('accepts the day planner fields plus week settings, locks and avoid', () => {
        const p = parseWeekRequest({
            foods: [{ id: 1 }], fixedFoods: [{ food: { id: 2 }, grams: 10 }],
            settings: { maxDaysPerFood: 2, leftovers: false },
            locks: { days: [1], items: [{ day: 1, foodId: 1, grams: 50 }] },
            avoid: [{ day: 0, foodId: 1 }],
        });
        assert.equal(p.foods.length, 1);
        assert.equal(p.fixedFoods?.[0].grams, 10);
        assert.deepEqual(p.settings, { maxDaysPerFood: 2, leftovers: false });
        assert.deepEqual(p.locks?.items[0], { day: 1, foodId: 1, grams: 50 });
        assert.deepEqual(p.avoid, [{ day: 0, foodId: 1 }]);
    });

    it('rejects malformed fields', () => {
        assert.throws(() => parseWeekRequest({ foods: [], settings: { days: 'x' } }), RequestValidationError);
        assert.throws(() => parseWeekRequest({ foods: [], settings: { leftovers: 1 } }), RequestValidationError);
        assert.throws(() => parseWeekRequest({ foods: [], locks: { days: ['a'] } }), RequestValidationError);
        assert.throws(() => parseWeekRequest({ foods: [], locks: { items: [{ day: 1 }] } }), RequestValidationError);
        assert.throws(() => parseWeekRequest({ foods: [], avoid: [{}] }), RequestValidationError);
        assert.throws(() => parseWeekRequest([]), RequestValidationError);
    });
});
