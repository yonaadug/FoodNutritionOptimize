import { parseOptimizeRequest, RequestValidationError } from '../optimize-request';
import { WEEK_LIMITS, type WeekLockItem, type WeekParams, type WeekSettings } from './types';

export { RequestValidationError };

export const WEEK_REQUEST_LIMITS = { maxBodyBytes: 2_000_000, maxAvoid: 500 } as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/**
 * Validate a POST /api/plan/week body. The goal, food and portion fields are the day planner's
 * (same names, same checks); `fixedFoods` is its `guaranteedFoods`.
 */
export function parseWeekRequest(body: unknown): WeekParams {
    if (!isObject(body)) throw new RequestValidationError('Request body must be a JSON object');
    const base = parseOptimizeRequest({ ...body, guaranteedFoods: body.fixedFoods ?? [] });
    const out: WeekParams = {
        foods: base.foods,
        fixedFoods: base.guaranteedFoods,
        customConstraints: base.customConstraints,
        minCalories: base.minCalories,
        maxCalories: base.maxCalories,
        applyUpperLimits: base.applyUpperLimits,
        foodConstraints: base.foodConstraints,
        ...(base.portionCap ? { portionCap: base.portionCap } : {}),
    };
    if (body.settings !== undefined) {
        if (!isObject(body.settings)) throw new RequestValidationError('settings must be an object');
        const s = body.settings;
        const settings: Partial<WeekSettings> = {};
        for (const k of ['days', 'maxDaysPerFood'] as const) {
            if (s[k] === undefined) continue;
            if (!isInt(s[k])) throw new RequestValidationError(`settings.${k} must be an integer`);
            settings[k] = s[k] as number;
        }
        for (const k of ['leftovers', 'weeklyAverages', 'avoidBackToBack'] as const) {
            if (s[k] === undefined) continue;
            if (typeof s[k] !== 'boolean') throw new RequestValidationError(`settings.${k} must be true or false`);
            settings[k] = s[k] as boolean;
        }
        out.settings = settings;
    }
    if (body.locks !== undefined) {
        if (!isObject(body.locks)) throw new RequestValidationError('locks must be an object');
        const days = body.locks.days ?? [];
        const items = body.locks.items ?? [];
        if (!Array.isArray(days) || !days.every(isInt)) throw new RequestValidationError('locks.days must be a list of day numbers');
        if (!Array.isArray(items) || items.length > WEEK_LIMITS.maxLockedItems) throw new RequestValidationError('locks.items must be a list');
        out.locks = {
            days: days as number[],
            items: items.map((it, i): WeekLockItem => {
                if (!isObject(it) || !isInt(it.day) || !isInt(it.foodId) || typeof it.grams !== 'number' || !Number.isFinite(it.grams)) {
                    throw new RequestValidationError(`locks.items[${i}] must have day, foodId and grams`);
                }
                return {
                    day: it.day, foodId: it.foodId, grams: it.grams,
                    ...(typeof it.servings === 'number' && Number.isFinite(it.servings) ? { servings: it.servings } : {}),
                    ...(it.leftover === true ? { leftover: true } : {}),
                };
            }),
        };
    }
    if (body.avoid !== undefined) {
        if (!Array.isArray(body.avoid) || body.avoid.length > WEEK_REQUEST_LIMITS.maxAvoid) throw new RequestValidationError('avoid must be a list');
        out.avoid = body.avoid.map((a, i) => {
            if (!isObject(a) || !isInt(a.day) || !isInt(a.foodId)) throw new RequestValidationError(`avoid[${i}] must have day and foodId`);
            return { day: a.day, foodId: a.foodId };
        });
    }
    return out;
}
