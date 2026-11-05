import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hydrateFoodsIn, openDatabase, searchFoodsIn } from './db';
import type { Food } from './food-types';
import { optimizeDiet, type OptimizationParams } from './optimizer';
import { goalProgress, goalSummary } from '@/components/plan/analysis';
import { GOAL_PRESETS, DEFAULT_PORTION_CAP } from '@/components/planner/goals';
import { buildPayload } from '@/components/planner/payload';
import { pickSampleFood, SAMPLE_DAY } from '@/components/planner/sampleDay';
import { nv } from '@/components/planner/nutrients';
import type { PlanResult } from '@/hooks/usePlan';
import type { PlannerState } from '@/hooks/usePlannerState';

const DB_PATH = path.join(import.meta.dirname, '..', 'nutrition.db');
const hasDb = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 1_000_000;

describe('the sample day on the real database', { skip: !hasDb && 'nutrition.db not available' }, () => {
    const conn = hasDb ? openDatabase(DB_PATH) : null!;
    const foods = hasDb ? SAMPLE_DAY.map(item => pickSampleFood(searchFoodsIn(conn, item.q, 1, 60).foods, item)) : [];

    it('finds all 15 staples, each with the nutrients it is known for', () => {
        SAMPLE_DAY.forEach((item, i) => {
            const food = foods[i];
            assert.ok(food, `${item.q} found a food`);
            for (const key of item.need ?? []) assert.notEqual(nv(food, key), null, `${food.description}: ${key}`);
        });
    });

    it('uses current entries, never a row USDA has replaced', () => {
        for (const food of foods) assert.equal(food!.superseded_by_fdc_id ?? null, null, food!.description);
    });

    for (const preset of GOAL_PRESETS) {
        it(`meets every goal of "${preset.title}"`, () => {
            const state = {
                foods: foods as Food[], fixedFoods: [], foodLimits: {}, presetId: preset.id, goals: preset.goals,
                calories: preset.calories, portionCap: DEFAULT_PORTION_CAP, upperLimits: false, hydrated: true,
            } satisfies PlannerState;
            const payload = buildPayload(state);
            const result = optimizeDiet({ ...payload, foods: hydrateFoodsIn(conn, payload.foods) as Food[] } as OptimizationParams);
            assert.equal(result.success, true, result.message ?? 'solved');
            const { met, total } = goalSummary(goalProgress(result as unknown as PlanResult));
            assert.equal(met, total, `${met} of ${total}`);
            assert.ok(result.diet!.length >= 5, 'uses a mix of foods');
        });
    }
});
