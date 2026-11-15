import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Food, ServingSize } from './food-types';
import { ALL_NUTRIENT_CONFIG } from './nutrient-defaults';
import { fillFromOlderEntries } from './nutrient-fill';
import { pickSources, scoreSources, type RankedSource, type RankOptions } from './best-sources';
import { basePrefixes, categorySlug, rankRelated, type RelatedResult } from './food-page';
import {
    INLINE_TYPES, INLINE_TYPES_PAGE, INLINE_TYPES_SMALL, foodGroupOf, groupRanked, pickRepresentative, typeOptions,
    type FoodGroupResult, type FoodTypeOption, type GroupedSearchResult, type TypeEntry,
} from './food-groups';

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

const globalKey = Symbol.for('nutrition-dictionary.db');
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

/** Older USDA entries by the fdc_id that superseded them, loaded once per connection (the DB is read-only). */
const olderEntriesCache = new WeakMap<Connection, Map<number, Food[]>>();

function olderEntriesByFood(conn: Connection): Map<number, Food[]> {
    let byFood = olderEntriesCache.get(conn);
    if (!byFood) {
        byFood = new Map();
        if (conn.schema.foodColumns.has('superseded_by_fdc_id')) {
            const rows = conn.db.prepare('SELECT * FROM foods WHERE superseded_by_fdc_id IS NOT NULL ORDER BY id').all() as Food[];
            attachServingSizes(rows, conn);
            for (const r of rows) {
                const list = byFood.get(r.superseded_by_fdc_id!);
                if (list) list.push(r);
                else byFood.set(r.superseded_by_fdc_id!, [r]);
            }
        }
        olderEntriesCache.set(conn, byFood);
    }
    return byFood;
}

/** The older USDA entries a food supersedes, oldest row first. */
export function olderEntriesIn(conn: Connection, fdcId: number): Food[] {
    return olderEntriesByFood(conn).get(fdcId) ?? [];
}

/**
 * Apply the one rule for nutrition gaps (lib/nutrient-fill.ts). Every function here that
 * returns foods goes through this, so food pages, search, rankings, the planner and
 * recipes all see the same values.
 */
export function withFilledNutrientsIn(conn: Connection, foods: Food[]): Food[] {
    const byFood = olderEntriesByFood(conn);
    return byFood.size === 0 ? foods : foods.map(f => fillFromOlderEntries(f, byFood.get(f.fdc_id) ?? []));
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
    const { ranked } = rankedMatchesIn(conn, query, options);

    const pageIds = ranked.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(c => c.id);
    const byId = new Map(getFoodsByIdsIn(conn, pageIds).map(f => [f.id, f]));
    const foods = pageIds.map(id => byId.get(id)).filter((f): f is Food => f !== undefined);

    const total = ranked.length;
    return { foods, total, page: safePage, totalPages: Math.ceil(total / safeLimit), limit: safeLimit };
}

/** Every match for a query, best first (see searchFoodsIn), with the query's tokens. */
function rankedMatchesIn(conn: Connection, query: string, options: SearchOptions): { ranked: SearchCandidate[]; tokens: string[]; fit: Map<number, number[]> } {
    const q = query.trim().toLowerCase().slice(0, SEARCH_MAX_QUERY_LENGTH);
    const tokens = tokenizeQuery(q);
    if (tokens.length === 0) return { ranked: [], tokens, fit: new Map() };

    const params: Record<string, string | number> = { q };
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
    `).all(params) as SearchCandidate[];
    const keyed = rankKeyed(candidates, tokens);
    return { ranked: keyed.map(k => k.c), tokens, fit: new Map(keyed.map(k => [k.c.id, k.key.slice(0, FIT_KEYS)])) };
}

/** What grouping needs about every food, loaded once per connection (the DB is read-only). */
interface TypeIndex {
    byId: Map<number, TypeEntry & { key: string; superseded: boolean }>;
    /** Current (not superseded) entries by group key. */
    byKey: Map<string, (TypeEntry & { key: string })[]>;
}

const typeIndexCache = new WeakMap<Connection, TypeIndex>();

const TYPE_COLUMNS = ['data_type_rank', 'superseded_by_fdc_id', 'calories', 'protein_g', 'total_fat_g', 'carbohydrate_g', 'water_g'];

function typeIndexIn(conn: Connection): TypeIndex {
    let index = typeIndexCache.get(conn);
    if (!index) {
        const cols = ['id', 'fdc_id', 'description', 'data_type', ...TYPE_COLUMNS.filter(c => conn.schema.foodColumns.has(c))];
        const rows = conn.db.prepare(`SELECT ${cols.join(', ')} FROM foods`).all() as (TypeEntry & { superseded_by_fdc_id?: number | null })[];
        // Calories filled from an older entry count, as everywhere else on the site.
        const filled = withFilledNutrientsIn(conn, rows as unknown as Food[]) as unknown as typeof rows;
        index = { byId: new Map(), byKey: new Map() };
        for (const r of filled) {
            const entry = { ...r, key: foodGroupOf(r.description).key, superseded: !!r.superseded_by_fdc_id };
            index.byId.set(r.id, entry);
            if (entry.superseded) continue;
            const list = index.byKey.get(entry.key);
            if (list) list.push(entry);
            else index.byKey.set(entry.key, [entry]);
        }
        typeIndexCache.set(conn, index);
    }
    return index;
}

/**
 * Search with one row per food (lib/food-groups.ts): matches are ranked as in
 * searchFoodsIn, then grouped by food in the order of each group's best match, so a
 * group ranks by its best entry. Paging counts groups. Each group carries its most
 * typical matched entry in full (the row's calories, nutrients and main action) and
 * every matched type, light, for the type picker.
 */
export interface GroupSearchOptions extends SearchOptions {
    /** Types sent with each group (default INLINE_TYPES); a larger group's full list loads by key. */
    inlineTypes?: number;
}

function matchedGroupsIn(conn: Connection, query: string, options: SearchOptions) {
    const { ranked, tokens, fit } = rankedMatchesIn(conn, query, options);
    const index = typeIndexIn(conn);
    const grouped = groupRanked(ranked, c => index.byId.get(c.id)?.key ?? foodGroupOf(c.description).key);
    // A group ranks by its best entry. Among groups whose best entries fit the query
    // equally well (same tier, naming, specialty words and dataset), the food USDA lists
    // most ways comes first: "beef" opens with round, chuck, loin and ground beef rather
    // than whichever cut has the shortest name.
    const order = new Map(grouped.map((g, i) => [g, i]));
    const groups = [...grouped].sort((a, b) => {
        const fa = fit.get(a.members[0].id) ?? [], fb = fit.get(b.members[0].id) ?? [];
        for (let i = 0; i < FIT_KEYS; i++) if ((fa[i] ?? 0) !== (fb[i] ?? 0)) return (fa[i] ?? 0) - (fb[i] ?? 0);
        return b.members.length - a.members.length || order.get(a)! - order.get(b)!;
    });
    const entriesOf = (g: { members: SearchCandidate[] }) =>
        g.members.map(m => index.byId.get(m.id)).filter((e): e is NonNullable<typeof e> => e !== undefined);
    return { ranked, tokens, groups, entriesOf };
}

/**
 * Search with one row per food (lib/food-groups.ts): matches are ranked as in
 * searchFoodsIn, then grouped by food in the order of each group's best match, so a
 * group ranks by its best entry. Paging counts groups. Each group carries its most
 * typical matched entry in full (the row's calories, nutrients and main action) and its
 * matched types, light, in picker order: all of them up to `inlineTypes`, else the first
 * `inlineTypes` (searchGroupTypesIn has the rest). The page shares a budget of
 * INLINE_TYPES_PAGE types; once it is spent, groups carry INLINE_TYPES_SMALL. So "beef"
 * (20 cuts of up to 161 types) stays a small response.
 */
export function searchFoodGroupsIn(conn: Connection, query: string, page = 1, limit = 20, options: GroupSearchOptions = {}): GroupedSearchResult {
    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 20), SEARCH_MAX_LIMIT);
    const safePage = Math.min(Math.max(1, Math.floor(page) || 1), SEARCH_MAX_PAGE);
    const inline = Math.max(1, Math.floor(options.inlineTypes ?? INLINE_TYPES));
    const { ranked, tokens, groups: all, entriesOf } = matchedGroupsIn(conn, query, options);
    if (ranked.length === 0) return { groups: [], total: 0, entries: 0, page: safePage, totalPages: 0, limit: safeLimit };

    const onPage = all.slice((safePage - 1) * safeLimit, safePage * safeLimit).map(g => {
        const entries = entriesOf(g);
        return { key: g.key, entries, rep: pickRepresentative(entries, tokens) };
    });
    const full = new Map(getFoodsByIdsIn(conn, onPage.map(g => g.rep.id)).map(f => [f.id, f]));
    let budget = Math.max(inline, INLINE_TYPES_PAGE);
    const groups = onPage.flatMap((g): FoodGroupResult[] => {
        const food = full.get(g.rep.id);
        if (!food) return [];
        // A page of large groups ("beef": round, chuck, loin...) shares a budget, so the response stays small.
        const room = Math.min(inline, Math.max(INLINE_TYPES_SMALL, budget));
        const types = typeOptions(g.entries, food.id).slice(0, room);
        budget -= types.length;
        return [{ key: g.key, name: foodGroupOf(food.description).name, count: g.entries.length, food, types }];
    });
    return { groups, total: all.length, entries: ranked.length, page: safePage, totalPages: Math.ceil(all.length / safeLimit), limit: safeLimit };
}

export async function searchFoodGroups(query: string, page = 1, limit = 20, options: GroupSearchOptions = {}): Promise<GroupedSearchResult> {
    return searchFoodGroupsIn(connection(), query, page, limit, options);
}

/** Every matched type of one group, in picker order (the full list behind a large group's row). */
export function searchGroupTypesIn(conn: Connection, query: string, key: string, options: SearchOptions = {}): FoodTypeOption[] {
    const { tokens, groups, entriesOf } = matchedGroupsIn(conn, query, options);
    const group = groups.find(g => g.key === key);
    if (!group) return [];
    const entries = entriesOf(group);
    return typeOptions(entries, pickRepresentative(entries, tokens).id);
}

export async function searchGroupTypes(query: string, key: string, options: SearchOptions = {}): Promise<FoodTypeOption[]> {
    return searchGroupTypesIn(connection(), query, key, options);
}

/**
 * Every current type of `food`'s group (the food page's Type switcher), Most common
 * first. Just the food itself when it has no other types; empty for a superseded record.
 */
export function getFoodTypesIn(conn: Connection, food: Pick<Food, 'id'>): FoodTypeOption[] {
    const index = typeIndexIn(conn);
    const me = index.byId.get(food.id);
    if (!me || me.superseded) return [];
    const entries = index.byKey.get(me.key) ?? [me];
    return typeOptions(entries, pickRepresentative(entries).id);
}

export async function getFoodTypes(food: Pick<Food, 'id'>): Promise<FoodTypeOption[]> {
    return getFoodTypesIn(connection(), food);
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
    // less typical forms and cuts ("banana" should not open with "overripe", "chicken" with "wing")
    'overripe', 'underripe', 'puffed', 'wing', 'wings', 'neck', 'skin', 'additives', 'fermented', 'giblets', 'liver', 'gizzards',
    // "sweet potato" should not open with the leaves
    'leaf', 'leaves',
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
    return rankKeyed(candidates, tokens).map(k => k.c);
}

/** Leading sort keys that say how well a match fits the query (tier, head, named words, specialty, data type). */
const FIT_KEYS = 5;

function rankKeyed<T extends SearchCandidate>(candidates: T[], tokens: string[]): { c: T; key: number[] }[] {
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
        // "without skin" is the plain form, not a specialty one.
        const specialty = tokenizeQuery(desc.replace(/\bwithout \w+/g, ' '))
            .filter(w => SPECIALTY_WORDS.has(w) && !queryForms.has(w)).length;
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
    return keyed;
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
    return withFilledNutrientsIn(conn, foods);
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
    // In code rather than SQL because filled values aren't in the table. A superseded row is
    // left out, as in search: it would only repeat the food that replaced it.
    const value = (f: Food) => (f as unknown as Record<string, number>)[nutrient];
    return allFoodsIn(conn)
        .filter(f => value(f) > 0 && !f.superseded_by_fdc_id)
        .sort((a, b) => value(b) - value(a) || a.description.length - b.description.length || a.id - b.id)
        .slice(0, safeLimit);
}

/** Every food with serving sizes, loaded once per connection (the DB is read-only). */
const allFoodsCache = new WeakMap<Connection, Food[]>();
const scoredCache = new WeakMap<Connection, Map<string, RankedSource[]>>();

function allFoodsIn(conn: Connection): Food[] {
    let foods = allFoodsCache.get(conn);
    if (!foods) {
        foods = conn.db.prepare('SELECT * FROM foods').all() as Food[];
        attachServingSizes(foods, conn);
        foods = withFilledNutrientsIn(conn, foods);
        allFoodsCache.set(conn, foods);
    }
    return foods;
}

export interface BestSource extends Food {
    best: { servingLabel: string; servingGrams: number; perServing: number; per100g: number; everyday: boolean };
}

/**
 * Good sources of a nutrient for people: ranked by a realistic serving,
 * everyday foods with decent data first; supplements, powders, organ meats
 * and other specialty items only when nothing else qualifies (unless
 * `everyday: false`). See lib/best-sources.ts.
 */
export function getBestSourcesIn(conn: Connection, nutrient: string, opts: RankOptions = {}): BestSource[] {
    if (!sortableNutrients(conn).includes(nutrient) || !/^[a-z0-9_]+$/.test(nutrient)) {
        throw new RangeError(`Unknown nutrient: ${nutrient}`);
    }
    let byNutrient = scoredCache.get(conn);
    if (!byNutrient) scoredCache.set(conn, byNutrient = new Map());
    let scored = byNutrient.get(nutrient);
    if (!scored) byNutrient.set(nutrient, scored = scoreSources(allFoodsIn(conn), nutrient));
    const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 20) || 20), SEARCH_MAX_LIMIT);
    return pickSources(scored, { ...opts, limit }).map(r => ({
        ...r.food,
        best: {
            servingLabel: r.servingLabel, servingGrams: r.servingGrams,
            perServing: r.perServing, per100g: r.per100g, everyday: r.tier === 0,
        },
    }));
}

export async function getBestSources(nutrient: string, opts: RankOptions = {}): Promise<BestSource[]> {
    return getBestSourcesIn(connection(), nutrient, opts);
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
    const filled = withFilledNutrientsIn(conn, rows);
    const byFdc = new Map(filled.map(r => [r.fdc_id, r]));
    const byId = new Map(filled.map(r => [r.id, r]));
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

// ---------------------------------------------------------------------------
// Food lookup pages (/food/[id], category and sitemap listings)
// ---------------------------------------------------------------------------

/** One food by its FoodData Central id, with serving sizes. */
export function getFoodByFdcIdIn(conn: Connection, fdcId: number): Food | undefined {
    if (!Number.isSafeInteger(fdcId)) return undefined;
    const food = conn.db.prepare('SELECT * FROM foods WHERE fdc_id = ?').get(fdcId) as Food | undefined;
    if (!food) return undefined;
    attachServingSizes([food], conn);
    return withFilledNutrientsIn(conn, [food])[0];
}

/** Several foods by FoodData Central id, with serving sizes. Unknown ids are left out. */
export function getFoodsByFdcIdsIn(conn: Connection, fdcIds: number[]): Food[] {
    const unique = Array.from(new Set(fdcIds.filter(id => Number.isSafeInteger(id)))).slice(0, MAX_IDS);
    if (unique.length === 0) return [];
    const foods = conn.db.prepare(`SELECT * FROM foods WHERE fdc_id IN (${unique.map(() => '?').join(',')})`).all(...unique) as Food[];
    attachServingSizes(foods, conn);
    return withFilledNutrientsIn(conn, foods);
}

export async function getFoodsByFdcIds(fdcIds: number[]): Promise<Food[]> {
    return getFoodsByFdcIdsIn(connection(), fdcIds);
}

export async function getFoodByFdcId(fdcId: number): Promise<Food | undefined> {
    return getFoodByFdcIdIn(connection(), fdcId);
}

/**
 * Foods related to `food` (see rankRelated in lib/food-page.ts): the same
 * food in another USDA dataset, other forms of it (raw/cooked, sizes, parts,
 * varieties) and nutritionally similar foods in its category. Candidates are
 * the base name matches, the NDB neighbourhood and the category; at most 1,500
 * rows are scored (the largest category has fewer than 1,000).
 */
export function getRelatedFoodsIn(conn: Connection, food: Food, limits: { forms?: number; similar?: number } = {}): RelatedResult<Food> {
    const params: Record<string, string | number> = { id: food.id };
    const ors: string[] = [];
    basePrefixes(food.description).forEach((p, i) => {
        if (p.endsWith(',')) {
            params[`p${i}`] = escapeLike(p) + '%';
            ors.push(`lower(description) LIKE @p${i} ESCAPE '\\'`);
        } else {
            params[`p${i}`] = p;
            ors.push(`lower(description) = @p${i}`);
        }
    });
    const ndb = conn.schema.foodColumns.has('ndb_number') ? food.ndb_number : null;
    if (ndb) {
        params.ndb = ndb;
        params.lo = ndb - 25;
        params.hi = ndb + 25;
        ors.push('ndb_number = @ndb', '(ndb_number BETWEEN @lo AND @hi)');
    }
    if (food.food_category) {
        params.category = food.food_category;
        ors.push('food_category = @category');
    }
    if (ors.length === 0) return { equivalents: [], forms: [], similar: [] };
    const candidates = conn.db
        .prepare(`SELECT * FROM foods WHERE id != @id AND (${ors.join(' OR ')}) LIMIT 1500`)
        .all(params) as Food[];
    const result = rankRelated(food, withFilledNutrientsIn(conn, candidates), limits);
    attachServingSizes([...result.equivalents, ...result.forms, ...result.similar], conn);
    return result;
}

export async function getRelatedFoods(food: Food, limits: { forms?: number; similar?: number } = {}): Promise<RelatedResult<Food>> {
    return getRelatedFoodsIn(connection(), food, limits);
}

export interface CategoryInfo { category: string; slug: string; count: number }

const categoriesCache = new WeakMap<Connection, CategoryInfo[]>();

function notSupersededSql(conn: Connection, alias = ''): string {
    return conn.schema.foodColumns.has('superseded_by_fdc_id') ? `${alias}superseded_by_fdc_id IS NULL` : '1';
}

/** Food categories with their (non-superseded) food counts, largest first. */
export function getCategoriesIn(conn: Connection): CategoryInfo[] {
    let cats = categoriesCache.get(conn);
    if (!cats) {
        const rows = conn.db.prepare(`SELECT food_category AS category, COUNT(*) AS count FROM foods
            WHERE food_category IS NOT NULL AND food_category != '' AND ${notSupersededSql(conn)}
            GROUP BY food_category ORDER BY count DESC, food_category`).all() as { category: string; count: number }[];
        cats = rows.map(r => ({ ...r, slug: categorySlug(r.category) }));
        categoriesCache.set(conn, cats);
    }
    return cats;
}

export async function getCategories(): Promise<CategoryInfo[]> {
    return getCategoriesIn(connection());
}

/** One page of a category: Foundation first, then shorter (plainer) names. */
export function getFoodsInCategoryIn(conn: Connection, category: string, page = 1, limit = 48): SearchResult {
    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 48), SEARCH_MAX_LIMIT);
    const safePage = Math.min(Math.max(1, Math.floor(page) || 1), SEARCH_MAX_PAGE);
    const where = `f.food_category = ? AND ${notSupersededSql(conn, 'f.')}`;
    const { total } = conn.db.prepare(`SELECT COUNT(*) AS total FROM foods f WHERE ${where}`).get(category) as { total: number };
    const foods = conn.db.prepare(`SELECT f.* FROM foods f WHERE ${where}
        ORDER BY ${dataTypeRank(conn.schema)}, length(f.description), f.description, f.id LIMIT ? OFFSET ?`)
        .all(category, safeLimit, (safePage - 1) * safeLimit) as Food[];
    attachServingSizes(foods, conn);
    return { foods: withFilledNutrientsIn(conn, foods), total, page: safePage, totalPages: Math.ceil(total / safeLimit), limit: safeLimit };
}

export async function getFoodsInCategory(category: string, page = 1, limit = 48): Promise<SearchResult> {
    return getFoodsInCategoryIn(connection(), category, page, limit);
}

const topHitsCache = new WeakMap<Connection, Map<string, Food | null>>();

/** The best search match for each query, in order (cached: the DB is read-only). Queries with no match are skipped. */
export function getTopHitsIn(conn: Connection, queries: readonly string[]): Food[] {
    let cache = topHitsCache.get(conn);
    if (!cache) topHitsCache.set(conn, cache = new Map());
    const out: Food[] = [];
    for (const q of queries) {
        let hit = cache.get(q);
        if (hit === undefined) {
            hit = searchFoodsIn(conn, q, 1, 1).foods[0] ?? null;
            cache.set(q, hit);
        }
        if (hit) out.push(hit);
    }
    return out;
}

export async function getTopHits(queries: readonly string[]): Promise<Food[]> {
    return getTopHitsIn(connection(), queries);
}

/** Every food page worth indexing (superseded SR rows point to their Foundation page instead). */
export function getFoodRefsIn(conn: Connection): { fdc_id: number; description: string }[] {
    return conn.db.prepare(`SELECT fdc_id, description FROM foods WHERE ${notSupersededSql(conn)} ORDER BY fdc_id`)
        .all() as { fdc_id: number; description: string }[];
}

export async function getFoodRefs(): Promise<{ fdc_id: number; description: string }[]> {
    return getFoodRefsIn(connection());
}
