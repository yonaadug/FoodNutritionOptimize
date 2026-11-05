export const MAX_SERVING_GRAMS = 5000;
const MAX_FDC_ID = 2 ** 31 - 1;

/** Bad query input. Kept free of next/server so `node --test` can load this file. */
export class ContaminantQueryError extends Error {}

/** Validate GET /api/contaminants query parameters. */
export function parseContaminantQuery(params: URLSearchParams): { fdcId: number; grams?: number } {
    const rawId = params.get('fdcId');
    if (rawId === null || rawId.trim() === '') throw new ContaminantQueryError('fdcId parameter required');
    if (!/^\d+$/.test(rawId.trim())) throw new ContaminantQueryError('fdcId must be a positive integer');
    const fdcId = Number(rawId);
    if (fdcId < 1 || fdcId > MAX_FDC_ID) throw new ContaminantQueryError('fdcId is out of range');

    const rawGrams = params.get('grams');
    if (rawGrams === null || rawGrams.trim() === '') return { fdcId };
    if (!/^\d+(\.\d+)?$/.test(rawGrams.trim())) throw new ContaminantQueryError('grams must be a positive number');
    const grams = Number(rawGrams);
    if (!(grams > 0) || grams > MAX_SERVING_GRAMS) {
        throw new ContaminantQueryError(`grams must be above 0 and at most ${MAX_SERVING_GRAMS}`);
    }
    return { fdcId, grams };
}
