import type { Food } from './food-types';
import type { OptimizationParams } from './optimizer';

/** Structural limits for POST /api/optimize (nutrient values are validated by the optimizer). */
export const OPTIMIZE_LIMITS = {
    maxBodyBytes: 1_000_000,
    maxFoods: 100,
    maxGuaranteedFoods: 50,
    maxConstraintKeys: 100,
    maxFoodConstraintKeys: 200,
} as const;

export class RequestValidationError extends Error {}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

function scalar(v: unknown, name: string): string | number | null | undefined {
    if (v === undefined || v === null || typeof v === 'number' || typeof v === 'string') return v;
    throw new RequestValidationError(`${name} must be a number or string`);
}

function checkFood(food: unknown, where: string): Food {
    if (!isPlainObject(food)) throw new RequestValidationError(`${where} must be an object`);
    if (typeof food.id !== 'number' || !Number.isSafeInteger(food.id)) {
        throw new RequestValidationError(`${where}.id must be an integer`);
    }
    if (food.fdc_id !== undefined && food.fdc_id !== null && (typeof food.fdc_id !== 'number' || !Number.isSafeInteger(food.fdc_id))) {
        throw new RequestValidationError(`${where}.fdc_id must be an integer`);
    }
    return food as unknown as Food;
}

/**
 * Validate the shape of an optimize request body (sizes, types). Unknown
 * top-level fields are dropped.
 */
export function parseOptimizeRequest(body: unknown): OptimizationParams {
    if (!isPlainObject(body)) throw new RequestValidationError('Request body must be a JSON object');

    const foods = body.foods ?? [];
    if (!Array.isArray(foods)) throw new RequestValidationError('foods must be an array');
    if (foods.length > OPTIMIZE_LIMITS.maxFoods) {
        throw new RequestValidationError(`At most ${OPTIMIZE_LIMITS.maxFoods} foods can be optimized at once`);
    }

    const guaranteed = body.guaranteedFoods ?? [];
    if (!Array.isArray(guaranteed)) throw new RequestValidationError('guaranteedFoods must be an array');
    if (guaranteed.length > OPTIMIZE_LIMITS.maxGuaranteedFoods) {
        throw new RequestValidationError(`At most ${OPTIMIZE_LIMITS.maxGuaranteedFoods} guaranteed foods are allowed`);
    }

    const customConstraints = body.customConstraints ?? undefined;
    if (customConstraints !== undefined) {
        if (!isPlainObject(customConstraints)) throw new RequestValidationError('customConstraints must be an object');
        if (Object.keys(customConstraints).length > OPTIMIZE_LIMITS.maxConstraintKeys) {
            throw new RequestValidationError('Too many customConstraints');
        }
    }

    const foodConstraints = body.foodConstraints ?? undefined;
    if (foodConstraints !== undefined) {
        if (!isPlainObject(foodConstraints)) throw new RequestValidationError('foodConstraints must be an object');
        if (Object.keys(foodConstraints).length > OPTIMIZE_LIMITS.maxFoodConstraintKeys) {
            throw new RequestValidationError('Too many foodConstraints');
        }
        for (const [k, v] of Object.entries(foodConstraints)) {
            if (v !== null && v !== undefined && !isPlainObject(v)) {
                throw new RequestValidationError(`foodConstraints.${k} must be an object`);
            }
        }
    }

    const portionCap = body.portionCap ?? undefined;
    if (portionCap !== undefined) {
        if (!isPlainObject(portionCap)) throw new RequestValidationError('portionCap must be an object');
        scalar(portionCap.servings, 'portionCap.servings');
        scalar(portionCap.grams, 'portionCap.grams');
    }

    return {
        foods: foods.map((f, i) => checkFood(f, `foods[${i}]`)),
        guaranteedFoods: guaranteed.map((g, i) => {
            if (!isPlainObject(g)) throw new RequestValidationError(`guaranteedFoods[${i}] must be an object`);
            return { food: checkFood(g.food, `guaranteedFoods[${i}].food`), grams: g.grams as number };
        }),
        customConstraints: customConstraints as Record<string, unknown> | undefined,
        foodConstraints: foodConstraints as OptimizationParams['foodConstraints'],
        maxCalories: scalar(body.maxCalories, 'maxCalories'),
        minCalories: scalar(body.minCalories, 'minCalories'),
        maxFoodAmount: scalar(body.maxFoodAmount, 'maxFoodAmount'),
        diversityMode: body.diversityMode === true,
        applyUpperLimits: body.applyUpperLimits === true,
        ...(portionCap !== undefined ? {
            portionCap: {
                servings: portionCap.servings as string | number | null | undefined,
                grams: portionCap.grams as string | number | null | undefined,
            },
        } : {}),
    };
}
