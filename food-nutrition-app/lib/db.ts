import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Food, ServingSize } from './food-types';
import { ALL_NUTRIENT_CONFIG } from './nutrient-defaults';

export type { Food, ServingSize } from './food-types';

type DB = Database.Database;

export const DB_FILENAME = 'nutrition.db';
export const SEARCH_MAX_LIMIT = 100;
export const SEARCH_MAX_PAGE = 500;
export const SEARCH_MAX_QUERY_LENGTH = 200;
const SEARCH_MAX_TOKENS = 8;
const MAX_IDS = 500;

export class DatabaseUnavailableError extends Error {}

// ---------------------------------------------------------------------------
// Database location
// ---------------------------------------------------------------------------

/**
 * Locate nutrition.db.
 *
 * 1. NUTRITION_DB_PATH (absolute, or relative to cwd). If set, it must exist.
 * 2. <cwd>/nutrition.db                 `next dev` / `next start` in the app dir;
 *                                       standalone server.js (it chdir()s to its
 *                                       own directory) and the Electron app, which
 *                                       spawns server.js with cwd = app/.
 * 3. <cwd>/food-nutrition-app/nutrition.db   run from the repository root.
 * 4. $LAMBDA_TASK_ROOT/nutrition.db     AWS Lambda bundle root.
 * 5. parents of cwd (up to 3 levels)    `.next/standalone` inside the app dir
 *                                       when the DB was not copied next to it.
 */
export function resolveDbPath(
    env: Record<string, string | undefined> = process.env,
    cwd: string = process.cwd(),
    exists: (p: string) => boolean = fileExists,
): { path: string; tried: string[] } {
    const explicit = env.NUTRITION_DB_PATH?.trim();
    if (explicit) {
        const p = path.resolve(cwd, explicit);
        if (exists(p)) return { path: p, tried: [p] };
        throw new DatabaseUnavailableError(`NUTRITION_DB_PATH points to a missing file: ${p}`);
    }
    const candidates = [
        path.join(cwd, DB_FILENAME),
        path.join(cwd, 'food-nutrition-app', DB_FILENAME),
    ];
    if (env.LAMBDA_TASK_ROOT) candidates.push(path.join(env.LAMBDA_TASK_ROOT, DB_FILENAME));
    let dir = cwd;
    for (let i = 0; i < 3; i++) {
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
        candidates.push(path.join(dir, DB_FILENAME));
    }
    const tried = Array.from(new Set(candidates));
    const found = tried.find(exists);
    if (!found) {
        throw new DatabaseUnavailableError(`${DB_FILENAME} not found (set NUTRITION_DB_PATH). Tried: ${tried.join(', ')}`);
    }
    return { path: found, tried };
}

function fileExists(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Connection (read-only singleton, survives Next dev hot reloads)
// ---------------------------------------------------------------------------

interface SchemaInfo {
    hasFts: boolean;
    hasMeta: boolean;
    hasServingSizes: boolean;
    foodColumns: Set<string>;
}

interface Connection {
    db: DB;
    path: string;
    schema: SchemaInfo;
}

const globalKey = Symbol.for('nutricompare.db');
type GlobalWithDb = typeof globalThis & { [globalKey]?: Connection };

export function openDatabase(file: string): Connection {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    return { db, path: file, schema: inspectSchema(db) };
}

function inspectSchema(db: DB): SchemaInfo {
    const tables = new Set(
        (db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`).all() as { name: string }[])
            .map(r => r.name),
    );
    const foodColumns = new Set(
        (db.prepare(`SELECT name FROM pragma_table_info('foods')`).all() as { name: string }[]).map(r => r.name),
    );
    return {
        hasFts: tables.has('foods_fts'),
        hasMeta: tables.has('meta'),
        hasServingSizes: tables.has('serving_sizes'),
        foodColumns,
    };
}

function connection(): Connection {
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

/** The shared read-only connection. */
export function getDb(): DB {
    return connection().db;
}

// ---------------------------------------------------------------------------
// Queries (each takes an optional connection so tests can use a temp DB)
// ---------------------------------------------------------------------------

function attachServingSizes(foods: Food[], conn: Connection): void {
    if (foods.length === 0) return;
    if (!conn.schema.hasServingSizes) {
        for (const f of foods) f.serving_sizes = [];
        return;
    }
    const ids = Array.from(new Set(foods.map(f => f.id)));
    const placeholders = ids.map(() => '?').join(',');
    const rows = conn.db
        .prepare(`SELECT id, food_id, label, weight_g FROM serving_sizes WHERE food_id IN (${placeholders}) ORDER BY food_id, weight_g, id`)
        .all(...ids) as ServingSize[];
    const byFood = new Map<number, ServingSize[]>();
    for (const s of rows) {
        const list = byFood.get(s.food_id);
        if (list) list.push(s);
        else byFood.set(s.food_id, [s]);
    }
    for (const f of foods) f.serving_sizes = byFood.get(f.id) ?? [];
}

export interface SearchResult {
    foods: Food[];
    total: number;
    page: number;
    totalPages: number;
    limit: number;
}

/** Split a user query into lowercase word tokens (same idea as FTS5 unicode61). */
export function tokenizeQuery(query: string): string[] {
    const tokens = query.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
    return Array.from(new Set(tokens.map(t => t.slice(0, 40)))).slice(0, SEARCH_MAX_TOKENS);
}

function escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, c => '\\' + c);
}

/** A token plus simple English singular/plural variants (egg/eggs, tomato/tomatoes). */
export function wordForms(token: string): string[] {
    const forms = new Set([token, token + 's', token + 'es']);
    if (token.length > 3 && token.endsWith('es')) forms.add(token.slice(0, -2));
    if (token.length > 2 && token.endsWith('s')) forms.add(token.slice(0, -1));
    return Array.from(forms);
}

/** Prefix used for matching so plural queries find singular names (milks -> milk*, tomatoes -> tomato*). */
export function matchStem(token: string): string {
    if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
    if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
    return token;
}

/** Description normalised so whole words are delimited by single spaces at both ends. */
const NORM_DESC = `(' ' || replace(replace(replace(replace(replace(replace(replace(lower(f.description), ', ', ' '), ',', ' '), '(', ' '), ')', ' '), '-', ' '), '/', ' '), '.', ' ') || ' ')`;

/**
 * Foundation, then SR Legacy, then everything else. Uses the DB's
 * data_type_rank column (schema v2) when present.
 */
function dataTypeRank(schema: SchemaInfo): string {
    if (schema.foodColumns.has('data_type_rank')) return 'coalesce(f.data_type_rank, 99)';
    return `CASE WHEN lower(coalesce(f.data_type, '')) LIKE 'foundation%' THEN 1
        WHEN lower(coalesce(f.data_type, '')) LIKE 'sr%legacy%' THEN 2 ELSE 3 END`;
}

export interface SearchOptions {
    /** Include SR Legacy rows superseded by a Foundation food (hidden by default). */
    includeSuperseded?: boolean;
}

/**
 * Ranked search.
 *   tier 0: description equals the query (case-insensitive)
 *   tier 1: description starts with the query's first word (singular/plural)
 *           and every query word appears as a whole word
 *   tier 2: every query word appears as a whole word in the description
 *   tier 3: every query word prefixes a word in (FTS) / occurs in (LIKE) the description
 *   tier 4: matched only through food_category
 * Matches are then ordered by rankCandidates (everyday forms first).
 * Uses the foods_fts FTS5 index when present, LIKE otherwise.
 */
export function searchFoodsIn(conn: Connection, query: string, page = 1, limit = 20, options: SearchOptions = {}): SearchResult {
    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 20), SEARCH_MAX_LIMIT);
    const safePage = Math.min(Math.max(1, Math.floor(page) || 1), SEARCH_MAX_PAGE);
    const q = query.trim().toLowerCase().slice(0, SEARCH_MAX_QUERY_LENGTH);
    const tokens = tokenizeQuery(q);
    if (tokens.length === 0) return { foods: [], total: 0, page: safePage, totalPages: 0, limit: safeLimit };

    const params: Record<string, string | number> = {
        q,

        limit: safeLimit,
        offset: (safePage - 1) * safeLimit,
    };
    tokens.forEach((t, i) => {
        wordForms(t).forEach((form, j) => {
            params[`w${i}_${j}`] = `% ${escapeLike(form)} %`;
            if (i === 0) params[`f${j}`] = ` ${escapeLike(form)} %`;
        });
        params[`s${i}`] = `%${escapeLike(matchStem(t))}%`;
    });
    const wholeWord = (i: number) =>
        '(' + wordForms(tokens[i]).map((_, j) => `${NORM_DESC} LIKE @w${i}_${j} ESCAPE '\\'`).join(' OR ') + ')';
    const allWords = tokens.map((_, i) => wholeWord(i)).join(' AND ');
    const startsWithFirst = '(' + wordForms(tokens[0]).map((_, j) => `${NORM_DESC} LIKE @f${j} ESCAPE '\\'`).join(' OR ') + ')';

    let from: string;
    let where: string;
    let tier3: string;
    if (conn.schema.hasFts) {
        // Tokens are [\p{L}\p{N}]+ only, so quoting them cannot inject FTS syntax.
        params.match = tokens.map(t => `"${matchStem(t)}"*`).join(' ');
        params.descMatch = tokens.map(t => `description : "${matchStem(t)}"*`).join(' AND ');
        from = `foods f JOIN (SELECT rowid AS id, bm25(foods_fts, 10.0, 1.0) AS score FROM foods_fts WHERE foods_fts MATCH @match) m ON m.id = f.id`;
        where = '1';
        tier3 = `f.id IN (SELECT rowid FROM foods_fts WHERE foods_fts MATCH @descMatch)`;
    } else {
        from = 'foods f';
        where = tokens
            .map((_, i) => `(lower(f.description) LIKE @s${i} ESCAPE '\\' OR lower(coalesce(f.food_category, '')) LIKE @s${i} ESCAPE '\\')`)
            .join(' AND ');
        tier3 = tokens.map((_, i) => `lower(f.description) LIKE @s${i} ESCAPE '\\'`).join(' AND ');
    }

    if (!options.includeSuperseded && conn.schema.foodColumns.has('superseded_by_fdc_id')) {
        where += ' AND f.superseded_by_fdc_id IS NULL';
    }

    const tier = `CASE
        WHEN lower(f.description) = @q THEN 0
        WHEN ${startsWithFirst} AND ${allWords} THEN 1
        WHEN ${allWords} THEN 2
        WHEN ${tier3} THEN 3
        ELSE 4 END`;

    // Every match is ranked (the DB holds ~10k foods, so this stays cheap); only the
    // requested page is then loaded in full.
    const candidates = conn.db.prepare(`
        SELECT f.id, f.description, ${tier} AS tier, ${dataTypeRank(conn.schema)} AS dtr, ${conn.schema.hasFts ? 'm.score' : '0'} AS score
        FROM ${from}
        WHERE ${where}
    `).all(omit(params, ['limit', 'offset'])) as SearchCandidate[];
    const ranked = rankCandidates(candidates, tokens);

    const pageIds = ranked.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(c => c.id);
    const byId = new Map(getFoodsByIdsIn(conn, pageIds).map(f => [f.id, f]));
    const foods = pageIds.map(id => byId.get(id)).filter((f): f is Food => f !== undefined);

    const total = ranked.length;
    return { foods, total, page: safePage, totalPages: Math.ceil(total / safeLimit), limit: safeLimit };
}

interface SearchCandidate {
    id: number;
    description: string;
    tier: number;
    dtr: number;
    score: number;
}

/** Words that mark a processed or specialty form; ranked after the plain food unless the query asks for them. */
const SPECIALTY_WORDS = new Set([
    'dried', 'dehydrated', 'powder', 'powdered', 'freeze', 'babyfood', 'infant', 'formula', 'imitation',
    'substitute', 'nuggets', 'breaded', 'canned', 'frozen', 'smoked', 'patty', 'patties',
    'sticks', 'mix', 'concentrate', 'restaurant', 'pickled',
]);

/**
 * Generic USDA group prefixes whose second segment names the food ("Fish, salmon, ...",
 * "Nuts, almonds", "Cheese, cheddar"). Elsewhere the first segment is the food
 * ("Pepper, banana" is a pepper, "Flour, oat" is flour).
 */
const GROUP_PREFIXES = new Set([
    'fish', 'nuts', 'seeds', 'spices', 'cheese', 'beverages', 'alcoholic beverage',
    'mollusks', 'crustaceans', 'game meat',
]);

/** Words that mark the plain, everyday form of a food. */
const PLAIN_WORDS = new Set(['raw', 'whole', 'plain', 'fresh']);

/**
 * Orders search matches so the everyday form of the food the user typed comes first:
 *   1. match tier (exact description; every query word as a whole word; prefix; category only)
 *   2. head: a query word names the food — it is the first comma segment ("Egg, ...") or the
 *      second after a group prefix ("Fish, salmon, ...") > the first segment starts with it
 *      ("Salmon nuggets") > elsewhere
 *   3. more query words naming one of the first two segments ("olive oil" -> "Oil, olive, ...")
 *   4. fewer specialty words (dried, canned, breaded, ...) the query didn't ask for
 *   5. data type (Foundation, SR Legacy, others)
 *   6. plain-form words (raw, whole, plain, fresh)
 *   7. shorter description, then bm25 relevance (FTS only), then description and id
 */
export function rankCandidates<T extends SearchCandidate>(candidates: T[], tokens: string[]): T[] {
    const tokenForms = tokens.map(t => new Set(wordForms(t)));
    const queryForms = new Set(tokens.flatMap(wordForms));
    const keyed = candidates.map(c => {
        const desc = c.description.toLowerCase();
        const segments = desc.split(',').map(s => s.trim());
        const words = tokenizeQuery(desc);
        const firstWord = tokenizeQuery(segments[0] ?? '')[0] ?? '';
        const named = queryForms.has(segments[0]) || (GROUP_PREFIXES.has(segments[0]) && queryForms.has(segments[1] ?? ''));
        const head = named ? 0 : queryForms.has(firstWord) ? 1 : 2;
        const leading = segments.slice(0, 2);
        const namedWords = tokenForms.filter(forms => leading.some(seg => forms.has(seg))).length;
        const specialty = words.filter(w => SPECIALTY_WORDS.has(w) && !queryForms.has(w)).length;
        const plain = words.some(w => PLAIN_WORDS.has(w)) ? 0 : 1;
        // Tiers 1 and 2 differ only by "starts with the first query word", which `head` refines.
        const tierGroup = c.tier === 0 ? 0 : c.tier <= 2 ? 1 : c.tier - 1;
        return { c, key: [tierGroup, head, -namedWords, specialty, c.dtr, plain, c.description.length, c.score] };
    });
    keyed.sort((a, b) => {
        for (let i = 0; i < a.key.length; i++) {
            if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
        }
        return a.c.description.localeCompare(b.c.description) || a.c.id - b.c.id;
    });
    return keyed.map(k => k.c);
}

function omit(obj: Record<string, string | number>, keys: string[]): Record<string, string | number> {
    const out = { ...obj };
    for (const k of keys) delete out[k];
    return out;
}


export async function searchFoods(query: string, page = 1, limit = 20, options: SearchOptions = {}): Promise<SearchResult> {
    return searchFoodsIn(connection(), query, page, limit, options);
}

export function getFoodsByIdsIn(conn: Connection, ids: number[]): Food[] {
    const unique = Array.from(new Set(ids.filter(id => Number.isSafeInteger(id)))).slice(0, MAX_IDS);
    if (unique.length === 0) return [];
    const placeholders = unique.map(() => '?').join(',');
    const foods = conn.db.prepare(`SELECT * FROM foods WHERE id IN (${placeholders})`).all(...unique) as Food[];
    attachServingSizes(foods, conn);
    return foods;
}

export async function getFoodById(id: number): Promise<Food | undefined> {
    return getFoodsByIdsIn(connection(), [id])[0];
}

export async function getFoodsByIds(ids: number[]): Promise<Food[]> {
    return getFoodsByIdsIn(connection(), ids);
}

/** Nutrient keys that may be used as a sort column: configured AND present in this DB. */
export function sortableNutrients(conn: Connection = connection()): string[] {
    return ['calories', ...Object.keys(ALL_NUTRIENT_CONFIG).filter(k => k !== 'calories')]
        .filter(k => conn.schema.foodColumns.has(k));
}

export function getTopFoodsByNutrientIn(conn: Connection, nutrient: string, limit = 50): Food[] {
    // Identifiers cannot be bound as parameters, so the column is allow-listed
    // against both the nutrient config and the actual table schema.
    if (!sortableNutrients(conn).includes(nutrient) || !/^[a-z0-9_]+$/.test(nutrient)) {
        throw new RangeError(`Unknown nutrient: ${nutrient}`);
    }
    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 50), SEARCH_MAX_LIMIT);
    const foods = conn.db
        .prepare(`SELECT * FROM foods WHERE "${nutrient}" > 0 ORDER BY "${nutrient}" DESC, length(description), id LIMIT ?`)
        .all(safeLimit) as Food[];
    attachServingSizes(foods, conn);
    return foods;
}

/**
 * Gets top foods ranked by a specific nutrient (per 100 g).
 * Throws RangeError for nutrients that are not allow-listed.
 */
export async function getTopFoodsByNutrient(nutrient: string, limit = 50): Promise<Food[]> {
    return getTopFoodsByNutrientIn(connection(), nutrient, limit);
}

/**
 * Replace client-supplied nutrient data with the database's (the server is the
 * source of truth for nutrients). Matches by fdc_id when the client sent one
 * (ids can change when the DB is rebuilt), else by id. The client's id is kept
 * so per-food constraints keyed by id still line up. Unknown foods are
 * returned unchanged.
 */
export function hydrateFoodsIn<T extends { id: number; fdc_id?: number | null }>(conn: Connection, foods: T[]): (T | Food)[] {
    if (foods.length === 0) return [];
    const fdcIds = foods.map(f => f.fdc_id).filter((x): x is number => Number.isSafeInteger(x));
    const ids = foods.filter(f => !Number.isSafeInteger(f.fdc_id)).map(f => f.id).filter(id => Number.isSafeInteger(id));
    const rows: Food[] = [];
    if (fdcIds.length > 0) {
        const unique = Array.from(new Set(fdcIds)).slice(0, MAX_IDS);
        rows.push(...(conn.db.prepare(`SELECT * FROM foods WHERE fdc_id IN (${unique.map(() => '?').join(',')})`).all(...unique) as Food[]));
    }
    if (ids.length > 0) rows.push(...getFoodsByIdsIn(conn, ids));
    attachServingSizes(rows, conn);
    const byFdc = new Map(rows.map(r => [r.fdc_id, r]));
    const byId = new Map(rows.map(r => [r.id, r]));
    return foods.map(f => {
        const row = Number.isSafeInteger(f.fdc_id) ? byFdc.get(f.fdc_id as number) : byId.get(f.id);
        if (!row) return f;
        return { ...row, id: f.id };
    });
}

export function hydrateFoods<T extends { id: number; fdc_id?: number | null }>(foods: T[]): (T | Food)[] {
    return hydrateFoodsIn(connection(), foods);
}

/** Provenance key/values from the `meta` table, or null if the DB has none. */
export function getMetaIn(conn: Connection): Record<string, string> | null {
    if (!conn.schema.hasMeta) return null;
    const rows = conn.db.prepare(`SELECT key, value FROM meta ORDER BY key`).all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export function getMeta(): Record<string, string> | null {
    return getMetaIn(connection());
}

/** Lightweight description of the open database (for /api/meta). */
export function getDbInfo(): { searchMode: 'fts' | 'like'; foodCount: number } {
    const conn = connection();
    const { count } = conn.db.prepare('SELECT COUNT(*) AS count FROM foods').get() as { count: number };
    return { searchMode: conn.schema.hasFts ? 'fts' : 'like', foodCount: count };
}
