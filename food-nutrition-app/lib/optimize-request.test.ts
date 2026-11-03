import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptimizeRequest, RequestValidationError, OPTIMIZE_LIMITS } from './optimize-request';
import { chicken } from './testing/fixtures';

describe('parseOptimizeRequest', () => {
    it('accepts the body the current UI sends', () => {
        const p = parseOptimizeRequest({
            foods: [chicken], guaranteedFoods: [{ food: chicken, grams: 100 }],
            customConstraints: { protein_g: { min: 50 } }, maxCalories: '2000', minCalories: undefined,
            diversityMode: false, maxFoodAmount: undefined, foodConstraints: { 1: { max: 300 } },
        });
        assert.equal(p.foods.length, 1);
        assert.equal(p.maxCalories, '2000');
        assert.equal(p.diversityMode, false);
    });

    it('rejects non-objects, wrong types and oversize arrays', () => {
        const bad: unknown[] = [
            null, [], 'x',
            { foods: 'nope' },
            { foods: [{ id: 'one' }] },
            { foods: [{ id: 1.5 }] },
            { foods: [{ id: 1, fdc_id: 'x' }] },
            { foods: Array.from({ length: OPTIMIZE_LIMITS.maxFoods + 1 }, (_, i) => ({ id: i })) },
            { guaranteedFoods: [{ grams: 5 }] },
            { customConstraints: [] },
            { foodConstraints: { 1: 5 } },
            { maxCalories: { $gt: 1 } },
        ];
        for (const body of bad) {
            assert.throws(() => parseOptimizeRequest(body), RequestValidationError, JSON.stringify(body)?.slice(0, 60));
        }
    });
});
