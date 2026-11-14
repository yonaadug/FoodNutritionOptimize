/**
 * Validation and the database handle for the /api/recipes routes. Free of Next.js
 * imports so it runs under `node --test`; responses live in lib/recipes/respond.ts.
 */
import { DatabaseUnavailableError, hydrateFoodsIn, openDatabase, resolveDbPath, type Food } from '../db';
import { withPortionsIn } from './match';
import { computeRecipeNutrition, MAX_GRAMS_PER_INGREDIENT, MAX_SERVINGS, roundedNutrition } from './nutrition';
import type { RecipeNutrition } from './types';

type Connection = ReturnType<typeof openDatabase>;

export const MAX_TEXT_CHARS = 20_000;
/** JSON bodies: the text limit in multi-byte characters, plus room for the envelope. */
export const MAX_TEXT_BODY_BYTES = MAX_TEXT_CHARS * 4 + 1024;
export const MAX_NUTRITION_BODY_BYTES = 64 * 1024;
export const MAX_NUTRITION_INGREDIENTS = 200;

const globalKey = Symbol.for('nutrition-dictionary.recipes-db');
type GlobalWithDb = typeof globalThis & { [globalKey]?: Connection };

/** This module's read-only connection to nutrition.db (survives dev hot reloads). */
export function recipesDb(): Connection {
    const g = globalThis as GlobalWithDb;
    if (!g[globalKey]) {
        const { path: file } = resolveDbPath();
        try {
            g[globalKey] = openDatabase(file);
        } catch (e) {
            throw new DatabaseUnavailableError(`Could not open ${file}: ${(e as Error).message}`);
        }
    }
    return g[globalKey]!;
}

/** A bad request, turned into the app's usual { error, code, details? } JSON by lib/recipes/respond.ts. */
export class RequestError extends Error {
    status: number;
    code: string;
    details?: unknown;
    constructor(status: number, code: string, message: string, details?: unknown) {
        super(message);
        this.name = 'RequestError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

/** Validate { text } for POST /api/recipes/parse. */
export function parseTextBody(body: unknown): string {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new RequestError(400, 'invalid_request', 'Request body must be a JSON object with a "text" field');
    }
    const text = (body as { text?: unknown }).text;
    if (typeof text !== 'string') throw new RequestError(400, 'invalid_request', 'text must be a string');
    const trimmed = text.trim();
    if (!trimmed) throw new RequestError(400, 'invalid_request', 'Paste a recipe first');
    if (trimmed.length > MAX_TEXT_CHARS) {
        throw new RequestError(413, 'payload_too_large', `That recipe is too long. The limit is ${MAX_TEXT_CHARS.toLocaleString('en-US')} characters`);
    }
    return trimmed;
}

export const MAX_MATCH_BODY_BYTES = 4 * 1024;
const MAX_MATCH_LINE = 300;

/** Validate { line } for POST /api/recipes/match. */
export function parseMatchBody(body: unknown): string {
    const line = typeof body === 'object' && body !== null ? (body as { line?: unknown }).line : undefined;
    if (typeof line !== 'string' || !line.trim()) throw new RequestError(400, 'invalid_request', 'Type an ingredient, like "2 cups milk"');
    if (line.length > MAX_MATCH_LINE) throw new RequestError(413, 'payload_too_large', `An ingredient can be at most ${MAX_MATCH_LINE} characters`);
    return line.trim();
}

export interface NutritionRequest { ingredients: { fdcId: number; grams: number }[]; servings: number }

/** Validate the body of POST /api/recipes/nutrition. */
export function parseNutritionBody(body: unknown): NutritionRequest {
    const bad = (message: string) => new RequestError(400, 'invalid_request', message);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw bad('Request body must be a JSON object');
    const { ingredients, servings } = body as { ingredients?: unknown; servings?: unknown };
    if (!Array.isArray(ingredients)) throw bad('ingredients must be an array');
    if (ingredients.length > MAX_NUTRITION_INGREDIENTS) throw bad(`At most ${MAX_NUTRITION_INGREDIENTS} ingredients are allowed`);
    if (typeof servings !== 'number' || !Number.isFinite(servings) || servings <= 0 || servings > MAX_SERVINGS) {
        throw bad(`servings must be a number above 0 and at most ${MAX_SERVINGS}`);
    }
    const parsed = ingredients.map((item, i) => {
        const { fdcId, grams } = (item ?? {}) as { fdcId?: unknown; grams?: unknown };
        if (typeof fdcId !== 'number' || !Number.isSafeInteger(fdcId) || fdcId <= 0) throw bad(`ingredients[${i}].fdcId must be a positive integer`);
        if (typeof grams !== 'number' || !Number.isFinite(grams) || grams < 0 || grams > MAX_GRAMS_PER_INGREDIENT) {
            throw bad(`ingredients[${i}].grams must be between 0 and ${MAX_GRAMS_PER_INGREDIENT}`);
        }
        return { fdcId, grams };
    });
    return { ingredients: parsed, servings };
}

/** Totals and per-serving nutrition. Pure given the database; no AI. Throws 400 listing unknown foods. */
export function nutritionFor(conn: Connection, request: NutritionRequest): RecipeNutrition {
    const hydrated = hydrateFoodsIn(conn, request.ingredients.map(i => ({ id: i.fdcId, fdc_id: i.fdcId })));
    const unknown = request.ingredients.filter((_, i) => !(hydrated[i] as Partial<Food>).description).map(i => i.fdcId);
    if (unknown.length) {
        throw new RequestError(400, 'invalid_input', `Unknown food ids: ${Array.from(new Set(unknown)).join(', ')}`, { unknownFdcIds: Array.from(new Set(unknown)) });
    }
    // Fill gaps the same way the editor does, so the two totals agree.
    const foods = withPortionsIn(conn, hydrated as Food[]);
    const items = request.ingredients.map((ing, i) => ({ name: foods[i].description, food: foods[i], grams: ing.grams }));
    return roundedNutrition(computeRecipeNutrition(items, request.servings));
}
