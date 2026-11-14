import type { PlanPortion } from './plan-contaminants-core';

/** Limits for POST /api/plan/contaminants. Free of next/server so `node --test` can load it. */
export const PLAN_CONTAMINANT_LIMITS = {
    maxBodyBytes: 200_000,
    maxDays: 7,
    maxPortionsPerDay: 120,
    maxGrams: 20_000,
    maxNameLength: 200,
} as const;

export class PlanContaminantRequestError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function portion(v: unknown, where: string): PlanPortion {
    if (!isObject(v)) throw new PlanContaminantRequestError(`${where} must be an object`);
    if (typeof v.key !== 'number' || !Number.isSafeInteger(v.key)) throw new PlanContaminantRequestError(`${where}.key must be an integer`);
    const fdcId = v.fdcId === null || v.fdcId === undefined ? null : v.fdcId;
    if (fdcId !== null && (typeof fdcId !== 'number' || !Number.isSafeInteger(fdcId))) {
        throw new PlanContaminantRequestError(`${where}.fdcId must be an integer or null`);
    }
    if (typeof v.grams !== 'number' || !Number.isFinite(v.grams) || v.grams < 0 || v.grams > PLAN_CONTAMINANT_LIMITS.maxGrams) {
        throw new PlanContaminantRequestError(`${where}.grams must be between 0 and ${PLAN_CONTAMINANT_LIMITS.maxGrams}`);
    }
    const name = typeof v.name === 'string' ? v.name.slice(0, PLAN_CONTAMINANT_LIMITS.maxNameLength) : `Food ${fdcId ?? v.key}`;
    // Recipes and anything that isn't a USDA row carry no contaminant data.
    return { key: v.key, fdcId: fdcId !== null && fdcId > 0 ? fdcId : null, name, grams: v.grams };
}

/** Validate { days: [[{ key, fdcId, name, grams }]] }. A day plan sends one day. */
export function parsePlanContaminantRequest(body: unknown): { days: PlanPortion[][] } {
    if (!isObject(body)) throw new PlanContaminantRequestError('Request body must be a JSON object');
    const days = body.days;
    if (!Array.isArray(days) || days.length === 0) throw new PlanContaminantRequestError('days must be a non-empty array');
    if (days.length > PLAN_CONTAMINANT_LIMITS.maxDays) throw new PlanContaminantRequestError(`At most ${PLAN_CONTAMINANT_LIMITS.maxDays} days`);
    return {
        days: days.map((day, d) => {
            if (!Array.isArray(day)) throw new PlanContaminantRequestError(`days[${d}] must be an array`);
            if (day.length > PLAN_CONTAMINANT_LIMITS.maxPortionsPerDay) {
                throw new PlanContaminantRequestError(`At most ${PLAN_CONTAMINANT_LIMITS.maxPortionsPerDay} foods a day`);
            }
            return day.map((p, i) => portion(p, `days[${d}][${i}]`));
        }),
    };
}
