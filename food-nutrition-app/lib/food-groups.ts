/**
 * Food groups: one food that USDA lists many ways ("Cod" is nine entries: Atlantic raw,
 * Pacific cooked, dried and salted, ...). Search shows each group once and lets the
 * visitor pick the type; a food page offers its group's other types.
 *
 * Pure and client-safe (no runtime imports beyond other pure modules), so the server,
 * the search UI and the tests share one definition.
 *
 * The group key is the short name from splitFoodName() ("Fish, cod, Atlantic, raw" ->
 * "Cod"), normalised (case, accents, brackets, plurals). Two refinements keep different
 * foods apart:
 *   - catch-all names ("Soup", "Oil", "Snacks", "Candies", ...) also take the next
 *     segment, so tomato soup and chicken noodle soup are two foods;
 *   - a brand name ("McDONALD'S", "QUAKER") also takes the next segment, so a brand's
 *     products stay separate and only a product's own variants group;
 *   - restaurant and fast-food dishes and baby food never group.
 * Everything else that only shares a word stays apart because the whole short name
 * must match: "Codfish salad" is not "Cod", "Cheddar cheese" is not "Swiss cheese".
 */
import type { Food } from './food-types';
import type { ServingOption } from './food-page';
import { splitFoodName } from '@/components/planner/nutrients';

export type TypeKind = 'raw' | 'cooked' | 'preserved' | 'other';

export interface FoodGroupName {
    /** Normalised key shared by every entry of the group ("cod", "cheddar cheese", "oil olive"). */
    key: string;
    /** Display name of the group ("Cod", "Cheddar cheese", "Oil, olive"). */
    name: string;
    /** What sets this entry apart within the group ("Atlantic, raw"); "" when nothing does. */
    detail: string;
}

/** Names that are a shelf, not a food: the next segment says which food. */
const CATCH_ALL = new Set([
    'soup', 'soups', 'oil', 'snacks', 'candies', 'sauce', 'salad dressing', 'frozen novelties', 'cookies', 'crackers',
    'cake', 'pie', 'puddings', 'gravy', 'dessert', 'desserts', 'fats', 'margarine-like', 'syrups', 'toppings',
]);

/** Mixed dishes named by where they are served: every entry is its own food. */
const NEVER_GROUP = new Set(['restaurant', 'fast foods', 'babyfood', 'infant formula']);

/** A brand written the USDA way: mostly capitals ("McDONALD'S", "KFC", "BURGER KING"). */
export function isBrand(segment: string): boolean {
    const letters = segment.replace(/[^A-Za-z]/g, '');
    const upper = segment.replace(/[^A-Z]/g, '').length;
    return upper >= 3 && upper / letters.length >= 0.6;
}

function singular(w: string): string {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(ches|shes|sses|oes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
}

function words(text: string): string[] {
    return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\([^)]*\)/g, ' ').match(/[a-z0-9]+/g) ?? [];
}

function normalise(name: string): string {
    return words(name).map(singular).join(' ');
}

/** Meat and poultry named by the animal first ("Beef, round, ..."): they group by cut. */
const MEATS = new Set([
    'beef', 'pork', 'lamb', 'veal', 'mutton', 'chicken', 'turkey', 'duck', 'goose', 'bison', 'buffalo', 'deer', 'elk',
    'venison', 'goat', 'rabbit', 'moose', 'caribou', 'antelope', 'boar', 'emu', 'ostrich', 'quail', 'pheasant', 'squab',
]);

/** Segments between the animal and the cut that say which animal, not which cut. */
const MEAT_CLASS = /^(broilers?( or fryers)?|fryers|roasting|stewing|capons|whole|retail parts|all classes|new zealand|australian|imported|domestic|fresh|cured|composite of trimmed retail cuts|variety meats and by-products|grass-fed|wild|farmed|young|mature|light or dark meat|rotisserie|bbq|original seasoning)$/i;
/** "dark meat" / "light meat" name the cut only when no part follows ("dark meat, thigh" is thigh). */
const MEAT_COLOUR = /^(dark|light) meat$/i;

/** A segment that says how the meat is prepared or trimmed, not which cut it is. */
function isMeatState(segment: string): boolean {
    if (/\d/.test(segment)) return true;
    if (/^(meat only|meat and skin\b.*|separable\b.*|lean\b.*|trimmed\b.*|choice|select|prime|all grades|meatless|with added solution)$/i.test(segment)) return true;
    return typeKind(segment) !== 'other';
}

/** "Beef, ground, ..." -> "Ground beef"; "Chicken, breast, ..." -> "Chicken breast"; no cut -> "Chicken". */
function meatGroup(animal: string, rest: string[]): { name: string; rest: string[] } {
    let i = 0;
    while (i < rest.length && MEAT_CLASS.test(rest[i])) i++;
    if (rest[i] && MEAT_COLOUR.test(rest[i]) && rest[i + 1] && !isMeatState(rest[i + 1])) i++;
    const cut = rest[i];
    if (!cut || isMeatState(cut)) return { name: animal, rest };
    const plainCut = cut.replace(/\s*\([^)]*\)/g, '').trim();
    const lowerCut = isBrand(plainCut) ? plainCut : plainCut.toLowerCase();
    const animalWord = animal.toLowerCase();
    const name = lowerCut === 'ground' ? `Ground ${animalWord}`
        : words(lowerCut).includes(animalWord) ? lowerCut[0].toUpperCase() + lowerCut.slice(1)
            : `${animal} ${lowerCut}`;
    return { name, rest: [...rest.slice(0, i), ...rest.slice(i + 1)] };
}

/** Kinds of rice that are foods of their own ("Rice, white" -> "White rice"). */
const RICE_KINDS = /^(white|brown|black|red|wild|fried|jasmine|basmati|glutinous|arborio|sweet)$/i;

const BIRD_EGGS = /^(duck|goose|quail|turkey)$/i;
const EGG_PART = /^(egg )?(whole|white|yolk)$/i;

/** "Eggs, Grade A, Large, egg white" -> "Egg white"; duck eggs apart; whole egg is "Egg". */
function eggGroup(rest: string[]): { name: string; rest: string[] } {
    let bird = '';
    if (rest[0] && BIRD_EGGS.test(rest[0])) { bird = rest[0].toLowerCase(); rest = rest.slice(1); }
    const at = rest.findIndex(s => EGG_PART.test(s));
    const part = at >= 0 ? rest[at].toLowerCase().replace(/^egg /, '') : 'whole';
    if (at >= 0) rest = [...rest.slice(0, at), ...rest.slice(at + 1)];
    const base = bird ? `${bird[0].toUpperCase()}${bird.slice(1)} egg` : 'Egg';
    return { name: part === 'whole' ? base : `${base} ${part}`, rest };
}

/** The group a USDA description belongs to, its display name and the entry's own detail. */
export function foodGroupOf(description: string): FoodGroupName {
    const { name, detail } = splitFoodName(description);
    const lower = name.toLowerCase();
    if (NEVER_GROUP.has(lower)) return { key: `=${description.toLowerCase().trim()}`, name, detail };
    let rest = detail ? detail.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (MEATS.has(lower)) {
        const m = meatGroup(name, rest);
        return { key: normalise(m.name), name: m.name, detail: m.rest.join(', ') };
    }
    if (lower === 'egg' || lower === 'eggs') {
        const e = eggGroup(rest);
        return { key: normalise(e.name), name: e.name, detail: e.rest.join(', ') };
    }
    if (lower === 'rice' && rest[0] && RICE_KINDS.test(rest[0])) {
        const riceName = `${rest[0][0].toUpperCase()}${rest[0].slice(1).toLowerCase()} rice`;
        return { key: normalise(riceName), name: riceName, detail: rest.slice(1).join(', ') };
    }
    let groupName = name;
    const take = () => { groupName = `${groupName}, ${rest[0]}`; rest = rest.slice(1); };
    if (CATCH_ALL.has(lower) && rest.length) {
        const brand = isBrand(rest[0]);
        take();
        if (brand && rest.length) take();
    } else if (isBrand(name) && rest.length) {
        take();
    }
    return { key: normalise(groupName) || description.toLowerCase(), name: groupName, detail: rest.join(', ') };
}

// ---------------------------------------------------------------------------
// Kinds of type: raw, cooked, canned / dried / cured, other
// ---------------------------------------------------------------------------

const PRESERVED = new Set([
    'canned', 'dried', 'dehydrated', 'smoked', 'pickled', 'cured', 'kippered', 'powder', 'powdered', 'jerky',
    'brined', 'fermented', 'freeze', 'candied', 'concentrate', 'mix',
]);
const COOKED = new Set([
    'cooked', 'baked', 'boiled', 'broiled', 'grilled', 'roasted', 'fried', 'steamed', 'braised', 'stewed', 'poached',
    'microwaved', 'sauteed', 'simmered', 'toasted', 'heated', 'prepared', 'scrambled', 'heat', 'roast', 'barbecued', 'stir',
]);
// "dry" is not raw: dry milk, dry pasta and dry mixes are their own forms.
const RAW = new Set(['raw', 'fresh', 'uncooked', 'unprepared', 'frozen']);
/** Words that mark the plain, everyday form. */
const PLAIN = new Set(['raw', 'fresh', 'plain', 'whole']);
/** Unusual forms that should not stand for the whole food unless the search asked for them. */
const ATYPICAL = new Set([
    'alaska', 'babyfood', 'infant', 'imitation', 'industrial', 'restaurant', 'liver', 'giblets', 'additives', 'puffed',
    'substitute', 'breaded', 'nuggets', 'pasteurized', 'sugared', 'stabilized', 'evaporated', 'condensed',
    // "meat and skin" (but not "skinless"): the skinless cut is the everyday one
    'skin',
]);
/** Grains and pasta, eaten cooked: their most common type is a cooked one. */
const COOKED_STAPLES = new Set([
    'rice', 'pasta', 'noodle', 'spaghetti', 'macaroni', 'quinoa', 'barley', 'couscous', 'bulgur', 'millet',
]);

/** Raw (raw, fresh, frozen, uncooked), cooked, preserved (canned, dried, smoked, cured...) or other. */
export function typeKind(description: string): TypeKind {
    const w = words(description);
    if (w.some(x => PRESERVED.has(x))) return 'preserved';
    if (w.some(x => COOKED.has(x))) return 'cooked';
    if (w.some(x => RAW.has(x))) return 'raw';
    return 'other';
}

export const KIND_ORDER: readonly TypeKind[] = ['raw', 'cooked', 'preserved', 'other'];
export const KIND_LABELS: Record<TypeKind, string> = {
    raw: 'Raw', cooked: 'Cooked', preserved: 'Canned, dried & cured', other: 'Other forms',
};

/** "Atlantic, dried and salted" -> "Atlantic · dried and salted"; "" -> "Plain". */
export function typeLabel(detail: string): string {
    const parts = detail.split(',').map(s => s.trim()).filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Plain';
}

// ---------------------------------------------------------------------------
// The representative: the most typical entry
// ---------------------------------------------------------------------------

/** What grouping needs to know about an entry (a Food has all of it). */
export interface TypeEntry {
    id: number;
    fdc_id: number;
    description: string;
    data_type?: string | null;
    data_type_rank?: number | null;
    calories?: number | null;
    protein_g?: number | null;
    total_fat_g?: number | null;
    carbohydrate_g?: number | null;
    water_g?: number | null;
}

function isNum(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

/** Same rule as hasCoreData(): calories, or measured macros, or a real measured zero. */
function hasCore(e: TypeEntry): boolean {
    if (!isNum(e.calories)) return false;
    if (e.calories > 0) return true;
    return [e.protein_g, e.total_fat_g, e.carbohydrate_g, e.water_g].some(isNum);
}

function dataRank(e: TypeEntry): number {
    if (isNum(e.data_type_rank)) return e.data_type_rank;
    const t = (e.data_type ?? '').toLowerCase();
    return t.includes('foundation') ? 1 : t.includes('sr') ? 2 : 3;
}

function queryForms(tokens: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const t of tokens) {
        const s = singular(t.toLowerCase());
        out.add(t.toLowerCase()); out.add(s); out.add(s + 's'); out.add(s + 'ed');
    }
    return out;
}

/** What ranking and the picker read from a description, worked out once per description. */
interface Facts {
    words: string[];
    kind: TypeKind;
    label: string;
    /** The first qualifier ("Atlantic" in "Atlantic, raw"), normalised: the variety. */
    variety: string;
    plain: boolean;
    /** A grain or pasta, eaten cooked (COOKED_STAPLES). */
    staple: boolean;
    /** A brand in the qualifiers ("Rice, brown, parboiled, cooked, UNCLE BENS"). */
    branded: boolean;
    /** "with salt" / "with added salt": the unsalted entry is the everyday one. */
    salted: boolean;
}

/** The variety of an entry with no qualifier before its preparation: the plain food, ranked first. */
const BASE_VARIETY = '\u0000base';

/** A qualifier that only says how the food is prepared ("cooked", "dry", "canned", "raw"), not which one. */
function isPreparation(segment: string): boolean {
    const w = words(segment);
    return w.length > 0 && w.every(x => COOKED.has(x) || RAW.has(x) || PRESERVED.has(x) || x === 'dry' || x === 'and');
}

const factsMemo = new Map<string, Facts>();

function facts(description: string): Facts {
    let f = factsMemo.get(description);
    if (!f) {
        const { detail, key } = foodGroupOf(description);
        const w = words(description);
        const first = (detail.split(',')[0] ?? '').trim();
        f = {
            words: w,
            kind: typeKind(description),
            label: typeLabel(detail),
            // "Pasta, cooked, enriched": the first qualifier is a preparation, so this is the plain food itself.
            variety: first && !isPreparation(first) ? normalise(first) : BASE_VARIETY,
            plain: w.some(x => PLAIN.has(x)),
            staple: key.split(' ').some(x => COOKED_STAPLES.has(x)),
            branded: detail.split(',').some(s => isBrand(s.trim())),
            salted: /\bwith (added )?salt\b/i.test(description),
        };
        // The database has ~10k descriptions; the bound only guards against unexpected input.
        if (factsMemo.size > 50_000) factsMemo.clear();
        factsMemo.set(description, f);
    }
    return f;
}

/**
 * Entries best first, by the representative rule:
 *   1. has calories or macros (a "Limited data" entry never stands for the food);
 *   2. no canned, dried, smoked, cured, pasteurized, with-skin or other unusual form the
 *      search didn't ask for, and no brand in the qualifiers;
 *   3. grains and pasta (rice, pasta, noodles, quinoa, barley, couscous, bulgur, millet)
 *      only: cooked first, since that's how they're eaten;
 *   4. USDA Foundation, then SR Legacy, then survey (FNDDS) data;
 *   5. raw or plain ("raw", "fresh", "plain", "whole"), then other uncooked forms, then
 *      cooked, then preserved;
 *   6. the plain food ("Pasta, cooked, ...": no variety before the preparation), else the
 *      variety most entries share (Atlantic cod, long-grain white rice, sockeye salmon);
 *      "with (added) salt" counts as unusual in step 2 unless the search says salt;
 *   7. the shortest description, then the lowest id.
 */
export function rankTypes<T extends TypeEntry>(entries: readonly T[], queryTokens: readonly string[] = []): T[] {
    const asked = queryForms(queryTokens);
    const counts = new Map<string, number>();
    const all = entries.map(e => facts(e.description));
    for (const f of all) counts.set(f.variety, (counts.get(f.variety) ?? 0) + 1);
    const keyed = entries.map((e, i) => {
        const { words: w, kind, plain, variety, staple, branded, salted } = all[i];
        const unasked = branded || (salted && !asked.has('salt'))
            || w.some(x => (PRESERVED.has(x) || ATYPICAL.has(x)) && !asked.has(x)) ? 1 : 0;
        const form = kind === 'preserved' ? 3 : kind === 'cooked' ? 2 : plain ? 0 : 1;
        const eatenAs = staple ? (kind === 'cooked' ? 0 : kind === 'preserved' ? 3 : kind === 'other' ? 1 : 2) : 0;
        const common = variety === BASE_VARIETY ? -1e9 : -(counts.get(variety) ?? 0);
        return { e, key: [hasCore(e) ? 0 : 1, unasked, eatenAs, dataRank(e), form, common, e.description.length, e.id] };
    });
    keyed.sort((a, b) => {
        for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
        return 0;
    });
    return keyed.map(k => k.e);
}

/** The most typical entry of a group (see rankTypes). */
export function pickRepresentative<T extends TypeEntry>(entries: readonly T[], queryTokens: readonly string[] = []): T {
    if (entries.length === 0) throw new RangeError('A group needs at least one entry');
    return rankTypes(entries, queryTokens)[0];
}

// ---------------------------------------------------------------------------
// The type picker
// ---------------------------------------------------------------------------

/** One choice in a type picker (light: no full nutrient profile). */
export interface FoodTypeOption {
    id: number;
    fdc_id: number;
    description: string;
    /** "Atlantic · raw" */
    label: string;
    kind: TypeKind;
    data_type: string | null;
    /** kcal per 100 g, or null when USDA has no value. */
    calories: number | null;
    /** The representative: listed first and marked "Most common". */
    mostCommon: boolean;
}

/** Picker order: Most common first, then raw, cooked, preserved and other, A–Z within each. */
export function typeOptions(entries: readonly TypeEntry[], representativeId: number): FoodTypeOption[] {
    const opts = entries.map((e): FoodTypeOption => ({
        id: e.id,
        fdc_id: e.fdc_id,
        description: e.description,
        label: facts(e.description).label,
        kind: facts(e.description).kind,
        data_type: e.data_type ?? null,
        calories: isNum(e.calories) ? e.calories : null,
        mostCommon: e.id === representativeId,
    }));
    return opts.sort((a, b) =>
        Number(b.mostCommon) - Number(a.mostCommon)
        || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
        || a.label.localeCompare(b.label)
        || a.id - b.id);
}

/** Types whose label or description contains every word typed (any order). */
export function filterTypes<T extends Pick<FoodTypeOption, 'label' | 'description'>>(options: readonly T[], text: string): T[] {
    const needles = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    if (needles.length === 0) return [...options];
    return options.filter(o => {
        const hay = `${o.label} ${o.description}`.toLowerCase();
        return needles.every(n => hay.includes(n));
    });
}

/** Ranked entries grouped by food, in the order of each group's best entry. */
export function groupRanked<T extends { id: number; description: string }>(
    ranked: readonly T[], keyOf: (entry: T) => string = e => foodGroupOf(e.description).key,
): { key: string; members: T[] }[] {
    const byKey = new Map<string, { key: string; members: T[] }>();
    for (const e of ranked) {
        const k = keyOf(e);
        const g = byKey.get(k);
        if (g) g.members.push(e);
        else byKey.set(k, { key: k, members: [e] });
    }
    return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Switching type on a food page keeps the serving where it makes sense
// ---------------------------------------------------------------------------

const GRAMS_SUFFIX = /\s*\(\d[\d.,]*\s*g\)\s*$/;
const WEIGHT_ID = /^w-(1oz|3oz|100g)$/;

/** A household measure's words without its weight: "1 fillet (180 g)" -> "1 fillet". */
function measureWords(label: string): string {
    return label.replace(GRAMS_SUFFIX, '').trim().toLowerCase();
}

/**
 * The `?serving=` value that carries the chosen serving to another type of the food, or
 * null when there is nothing to carry (the food's own default serving). Standard weights
 * stay as they are ("w-3oz"), a household measure travels by its words ("m:1 fillet"),
 * and a custom amount by its number and unit ("custom:6oz").
 */
export function servingParam(choice: {
    servingId: string; options: readonly ServingOption[]; defaultId: string; custom?: { text: string; unit: 'g' | 'oz' };
}): string | null {
    const { servingId, options, defaultId, custom } = choice;
    if (servingId === defaultId) return null;
    if (servingId === 'custom') {
        const text = custom?.text.trim() ?? '';
        return custom && /^\d{1,5}(\.\d{1,2})?$/.test(text) && Number(text) > 0 ? `custom:${text}${custom.unit}` : null;
    }
    const opt = options.find(o => o.id === servingId);
    if (!opt) return null;
    if (opt.group === 'weight' && WEIGHT_ID.test(opt.id)) return opt.id;
    const words = measureWords(opt.label);
    return words && words.length <= 80 ? `m:${words}` : null;
}

/** The serving on another type's page for a `?serving=` value, or null to use its default. */
export function servingForType(
    param: string | null | undefined, options: readonly ServingOption[],
): { servingId: string; custom?: { text: string; unit: 'g' | 'oz' } } | null {
    if (!param || param.length > 90) return null;
    if (WEIGHT_ID.test(param)) return options.some(o => o.id === param) ? { servingId: param } : null;
    const custom = param.match(/^custom:(\d{1,5}(?:\.\d{1,2})?)(g|oz)$/);
    if (custom) return Number(custom[1]) > 0 ? { servingId: 'custom', custom: { text: custom[1], unit: custom[2] as 'g' | 'oz' } } : null;
    if (param.startsWith('m:')) {
        const want = param.slice(2).trim().toLowerCase();
        const hit = options.find(o => o.group === 'household' && measureWords(o.label) === want);
        return hit ? { servingId: hit.id } : null;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Grouped search results (GET /api/search?group=1)
// ---------------------------------------------------------------------------

/** Types sent with a search row; a larger group's full list loads when its picker opens. */
export const INLINE_TYPES = 60;
/** Types sent for a whole page of rows; past it, each row sends INLINE_TYPES_SMALL. */
export const INLINE_TYPES_PAGE = 150;
export const INLINE_TYPES_SMALL = 6;

/** One food in grouped search: its most typical entry in full, and its matched types. */
export interface FoodGroupResult {
    key: string;
    /** "Cod" */
    name: string;
    /** Matched types (USDA entries) in the group. */
    count: number;
    /** The representative ("Most common"), with serving sizes: what the row shows and its main action uses. */
    food: Food;
    /**
     * Matched types in picker order (Most common first): all of them, or the first
     * INLINE_TYPES when `count` is larger (GET /api/search?group=1&key=... has the rest).
     */
    types: FoodTypeOption[];
}

export interface GroupedSearchResult {
    groups: FoodGroupResult[];
    /** Groups matching the query (paging counts groups). */
    total: number;
    /** USDA entries matching the query. */
    entries: number;
    page: number;
    totalPages: number;
    limit: number;
}
