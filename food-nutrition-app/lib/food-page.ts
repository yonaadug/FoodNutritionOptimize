import type { Food, ServingSize } from './food-types';
import { ALL_NUTRIENT_CONFIG } from './nutrient-defaults';
import { friendlyServingLabel, typicalServing } from './servings';

/**
 * Pure helpers behind the food lookup pages (/, /food/[id], /nutrients/[key]).
 * No runtime dependencies beyond other pure lib modules, so they are safe in
 * client components and easy to unit-test.
 */

// ---------------------------------------------------------------------------
// Number formatting (fixed locale: identical on the server and in the browser,
// so server-rendered numbers never cause hydration mismatches)
// ---------------------------------------------------------------------------

/** 0–2 decimals depending on size; "—" for unknown. */
export function fmt(v: number | null | undefined, decimals?: number): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    const d = decimals ?? (abs >= 10 ? 0 : abs >= 1 ? 1 : abs === 0 ? 0 : 2);
    return v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

// ---------------------------------------------------------------------------
// URLs and slugs
// ---------------------------------------------------------------------------

/** USDA group words that come before the food itself ("Fish, salmon, ..."). */
const SLUG_GROUP_PREFIXES = new Set([
    'fish', 'nuts', 'seeds', 'spices', 'beverages', 'mollusks', 'crustaceans', 'game meat', 'alcoholic beverage',
]);

const FDP_NOTE = /\s*\(includes foods for usda's food distribution program\)/i;

/** URL-safe, lowercase, hyphenated text, cut at a word boundary. */
export function slugify(text: string, maxLength = 60): string {
    const s = text
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (s.length <= maxLength) return s;
    const cut = s.slice(0, maxLength + 1);
    const at = cut.lastIndexOf('-');
    return (at > 10 ? cut.slice(0, at) : s.slice(0, maxLength)).replace(/-+$/, '');
}

/** Readable slug for a food: "Fish, salmon, sockeye, raw" -> "salmon-sockeye-raw". */
export function foodSlug(description: string): string {
    const segs = description.replace(FDP_NOTE, '').split(',').map(s => s.trim()).filter(Boolean);
    if (segs.length > 1 && SLUG_GROUP_PREFIXES.has(segs[0].toLowerCase())) segs.shift();
    return slugify(segs.join(' ')) || 'food';
}

/** Canonical path of a food page: /food/173691-salmon-sockeye-raw. */
export function foodPath(food: { fdc_id: number; description: string }): string {
    return `/food/${food.fdc_id}-${foodSlug(food.description)}`;
}

/** Parse the [id] segment of /food/[id]: "173691", "173691-salmon-sockeye-raw". */
export function parseFoodParam(param: string): { fdcId: number; slug: string } | null {
    let raw = param;
    try { raw = decodeURIComponent(param); } catch { /* keep as is */ }
    const m = raw.match(/^(\d{1,10})(?:-(.*))?$/);
    if (!m) return null;
    const fdcId = Number(m[1]);
    if (!Number.isSafeInteger(fdcId) || fdcId <= 0) return null;
    return { fdcId, slug: m[2] ?? '' };
}

/** The food's record on USDA FoodData Central. */
export function fdcUrl(fdcId: number): string {
    return `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "4/1/2019", "2019-04-01" or "2019-04" -> "April 1, 2019" / "April 2019"; null if unreadable. */
export function formatPublicationDate(raw: string | null | undefined): string | null {
    const s = raw?.trim();
    if (!s) return null;
    let y: number, m: number, d: number | undefined;
    let match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
        [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else if ((match = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/))) {
        [y, m] = [Number(match[1]), Number(match[2])];
        d = match[3] ? Number(match[3]) : undefined;
    } else {
        return null;
    }
    if (m < 1 || m > 12 || (d !== undefined && (d < 1 || d > 31))) return null;
    return d ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${y}`;
}

export interface DatasetInfo {
    /** e.g. "Foundation Foods" */
    name: string;
    /** Short badge text. */
    badge: string;
    /** One-sentence explanation for non-experts. */
    blurb: string;
    tone: 'primary' | 'success' | 'neutral';
}

export function datasetInfo(dataType: string | null | undefined): DatasetInfo {
    const t = (dataType ?? '').toLowerCase();
    if (t.includes('foundation')) {
        return {
            name: 'Foundation Foods', badge: 'USDA Foundation', tone: 'success',
            blurb: 'USDA’s newest lab analyses of single foods, with detailed sampling information.',
        };
    }
    if (t.includes('sr_legacy') || t.includes('sr legacy')) {
        return {
            name: 'SR Legacy', badge: 'USDA SR Legacy', tone: 'primary',
            blurb: 'USDA’s long-standing Standard Reference database (final release April 2018).',
        };
    }
    if (t.includes('fndds') || t.includes('survey')) {
        return {
            name: 'Food and Nutrient Database for Dietary Studies (FNDDS)', badge: 'Mixed dish (FNDDS)', tone: 'neutral',
            blurb: 'Foods and mixed dishes as eaten in the US, used for national dietary surveys.',
        };
    }
    return { name: dataType || 'USDA', badge: (dataType || 'USDA').replace(/_/g, ' '), tone: 'neutral', blurb: '' };
}

// ---------------------------------------------------------------------------
// Serving sizes
// ---------------------------------------------------------------------------

export interface ServingOption {
    id: string;
    /** "1 cup, chopped (91 g)" */
    label: string;
    grams: number;
}

const GENERIC_GRAMS = /^\s*\d+(\.\d+)?\s*(g|gram|grams)\s*$/i;

function withGrams(label: string, grams: number): string {
    return `${label} (${fmt(grams, grams >= 10 ? 0 : 1)} g)`;
}

/**
 * Serving choices for a food page: the realistic default serving, every
 * household portion USDA lists, and 100 g. Duplicates (same label and weight)
 * are dropped; the default comes first.
 */
export function servingOptions(food: Pick<Food, 'description' | 'food_category' | 'calories' | 'serving_sizes'>): { options: ServingOption[]; defaultId: string } {
    const typical = typicalServing(food.serving_sizes, food);
    const options: ServingOption[] = [];
    const seen = new Set<string>();
    const add = (id: string, label: string, grams: number) => {
        const key = `${label.toLowerCase()}|${Math.round(grams * 10)}`;
        const gramsOnly = `|${Math.round(grams * 10)}`;
        if (seen.has(key) || (GENERIC_GRAMS.test(label) && seen.has(gramsOnly))) return;
        seen.add(key);
        if (GENERIC_GRAMS.test(label)) seen.add(gramsOnly);
        options.push({ id, label: GENERIC_GRAMS.test(label) ? `${fmt(grams)} g` : withGrams(label, grams), grams });
    };
    add('typical', typical.label, typical.grams);
    const rows = (food.serving_sizes ?? [])
        .filter((s): s is ServingSize => typeof s?.weight_g === 'number' && s.weight_g > 0 && typeof s.label === 'string')
        .filter(s => !GENERIC_GRAMS.test(s.label) && !/\b(surface|cubic) inch\b/i.test(s.label))
        .slice()
        .sort((a, b) => a.weight_g - b.weight_g);
    for (const s of rows) add(`s${s.id}`, friendlyServingLabel(s.label), s.weight_g);
    add('100g', '100 g', 100);
    return { options, defaultId: 'typical' };
}

// ---------------------------------------------------------------------------
// Nutrient table
// ---------------------------------------------------------------------------

export interface NutrientRow {
    key: string;
    label: string;
    unit: string;
    /** Amount in the chosen serving; null = not measured. */
    amount: number | null;
    per100g: number | null;
    /** % of the FDA Daily Value (or adequate intake) in the serving; null if none applies. */
    dvPct: number | null;
    indent?: boolean;
}

export interface NutrientGroupRows {
    id: 'macros' | 'vitamins' | 'minerals' | 'other';
    title: string;
    rows: NutrientRow[];
}

const TABLE_GROUPS: { id: NutrientGroupRows['id']; title: string; keys: string[] }[] = [
    {
        id: 'macros', title: 'Calories & macronutrients', keys: [
            'calories', 'protein_g', 'carbohydrate_g', 'fiber_g', 'sugars_g', 'total_fat_g',
            'saturated_g', 'monounsaturated_g', 'polyunsaturated_g', 'trans_g', 'cholesterol_mg',
        ],
    },
    {
        id: 'vitamins', title: 'Vitamins', keys: [
            'vitamin_a_ug', 'vitamin_c_mg', 'vitamin_d_ug', 'vitamin_e_mg', 'vitamin_k_ug', 'thiamin_mg', 'riboflavin_mg',
            'niacin_mg', 'vitamin_b6_mg', 'folate_ug', 'vitamin_b12_ug', 'pantothenic_acid_mg', 'choline_mg',
        ],
    },
    {
        id: 'minerals', title: 'Minerals', keys: [
            'calcium_mg', 'iron_mg', 'magnesium_mg', 'phosphorus_mg', 'potassium_mg', 'sodium_mg',
            'zinc_mg', 'copper_mg', 'manganese_mg', 'selenium_ug',
        ],
    },
    { id: 'other', title: 'Other', keys: ['ala_g', 'epa_g', 'dha_g', 'water_g', 'alcohol_g', 'caffeine_mg'] },
];

const INDENTED = new Set(['fiber_g', 'sugars_g', 'saturated_g', 'monounsaturated_g', 'polyunsaturated_g', 'trans_g']);

const LABELS: Record<string, string> = {
    calories: 'Calories', protein_g: 'Protein', carbohydrate_g: 'Carbohydrate', fiber_g: 'Fiber', sugars_g: 'Total sugars',
    total_fat_g: 'Total fat', saturated_g: 'Saturated fat', monounsaturated_g: 'Monounsaturated fat',
    polyunsaturated_g: 'Polyunsaturated fat', trans_g: 'Trans fat', cholesterol_mg: 'Cholesterol',
    vitamin_a_ug: 'Vitamin A (RAE)', vitamin_c_mg: 'Vitamin C', vitamin_d_ug: 'Vitamin D', vitamin_e_mg: 'Vitamin E',
    vitamin_k_ug: 'Vitamin K', thiamin_mg: 'Thiamin (B1)', riboflavin_mg: 'Riboflavin (B2)', niacin_mg: 'Niacin (B3)',
    vitamin_b6_mg: 'Vitamin B6', folate_ug: 'Folate (DFE)', vitamin_b12_ug: 'Vitamin B12', pantothenic_acid_mg: 'Pantothenic acid (B5)',
    choline_mg: 'Choline', calcium_mg: 'Calcium', iron_mg: 'Iron', magnesium_mg: 'Magnesium', phosphorus_mg: 'Phosphorus',
    potassium_mg: 'Potassium', sodium_mg: 'Sodium', zinc_mg: 'Zinc', copper_mg: 'Copper', manganese_mg: 'Manganese',
    selenium_ug: 'Selenium', ala_g: 'Omega-3 ALA', epa_g: 'Omega-3 EPA', dha_g: 'Omega-3 DHA', water_g: 'Water',
    alcohol_g: 'Alcohol', caffeine_mg: 'Caffeine',
};

/** Nutrients whose config value is not a daily target for this column (total sugars vs. the added-sugars DV; calories). */
const NO_DV = new Set(['calories', 'sugars_g']);

export function nutrientName(key: string): string {
    return LABELS[key] ?? ALL_NUTRIENT_CONFIG[key]?.label ?? key.replace(/_(g|mg|ug)$/, '').replace(/_/g, ' ');
}

export function nutrientUnitOf(key: string): string {
    if (key === 'calories') return 'kcal';
    if (ALL_NUTRIENT_CONFIG[key]) return ALL_NUTRIENT_CONFIG[key].unit;
    if (key.endsWith('_ug')) return 'mcg';
    if (key.endsWith('_mg')) return 'mg';
    return 'g';
}

/** FDA Daily Value (or adequate intake) used for %DV; null when none applies. */
export function dailyValueOf(key: string): number | null {
    if (NO_DV.has(key)) return null;
    const v = ALL_NUTRIENT_CONFIG[key]?.defaultValue;
    return v && v > 0 ? v : null;
}

function per100(food: Food, key: string): number | null | undefined {
    const v = (food as unknown as Record<string, unknown>)[key];
    if (v === undefined) return undefined;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Every nutrient the database has for this food, grouped, scaled to `grams`.
 * Columns missing from the database are left out; NULL values (not measured)
 * stay null so the UI can show "—" rather than 0.
 */
export function nutrientTable(food: Food, grams: number): NutrientGroupRows[] {
    return TABLE_GROUPS.map(g => ({
        id: g.id,
        title: g.title,
        rows: g.keys.flatMap(key => {
            const v = per100(food, key);
            if (v === undefined) return [];
            const amount = v === null ? null : v * grams / 100;
            const dv = dailyValueOf(key);
            return [{
                key, label: nutrientName(key), unit: nutrientUnitOf(key), amount, per100g: v,
                dvPct: amount === null || dv === null ? null : (amount / dv) * 100,
                indent: INDENTED.has(key) || undefined,
            }];
        }),
    })).filter(g => g.rows.length > 0);
}

/** Nutrients people look a food up for; limits (sodium, saturated fat...) are not "highlights". */
const HIGHLIGHT_KEYS = [
    'protein_g', 'fiber_g', 'vitamin_a_ug', 'vitamin_c_mg', 'vitamin_d_ug', 'vitamin_e_mg', 'vitamin_k_ug',
    'thiamin_mg', 'riboflavin_mg', 'niacin_mg', 'vitamin_b6_mg', 'folate_ug', 'vitamin_b12_ug', 'choline_mg',
    'calcium_mg', 'iron_mg', 'magnesium_mg', 'potassium_mg', 'zinc_mg', 'selenium_ug', 'copper_mg', 'manganese_mg', 'phosphorus_mg',
];

export interface KeyNutrient { key: string; label: string; amount: number; unit: string; dvPct: number }

/**
 * The nutrients a serving is richest in, by % Daily Value (at least `minPct`),
 * highest first. Used for search results and "Rich in" badges.
 */
export function keyNutrients(food: Food, grams: number, count = 3, minPct = 10): KeyNutrient[] {
    const out: KeyNutrient[] = [];
    for (const key of HIGHLIGHT_KEYS) {
        const v = per100(food, key);
        const dv = dailyValueOf(key);
        if (v === null || v === undefined || dv === null) continue;
        const amount = v * grams / 100;
        const dvPct = (amount / dv) * 100;
        if (dvPct >= minPct) out.push({ key, label: nutrientName(key), amount, unit: nutrientUnitOf(key), dvPct });
    }
    return out.sort((a, b) => b.dvPct - a.dvPct || a.key.localeCompare(b.key)).slice(0, count);
}

/**
 * What a search result shows next to calories: protein when measured, then the
 * nutrients the serving is richest in, then total fat, carbohydrate or fiber.
 */
export function resultNutrients(food: Food, grams: number, count = 3): { key: string; label: string; amount: number; unit: string }[] {
    const picked = new Map<string, { key: string; label: string; amount: number; unit: string }>();
    const add = (key: string) => {
        const v = per100(food, key);
        if (v === null || v === undefined || picked.size >= count) return;
        picked.set(key, { key, label: nutrientName(key), amount: v * grams / 100, unit: nutrientUnitOf(key) });
    };
    add('protein_g');
    for (const k of keyNutrients(food, grams, count)) add(k.key);
    for (const key of ['total_fat_g', 'carbohydrate_g', 'fiber_g']) if ((per100(food, key) ?? 0) > 0) add(key);
    return Array.from(picked.values());
}

// ---------------------------------------------------------------------------
// Related foods ("other forms" and "similar foods")
// ---------------------------------------------------------------------------

const RELATED_GROUP_PREFIXES = new Set([...SLUG_GROUP_PREFIXES, 'cheese', 'beans', 'cereals ready-to-eat', 'cereals']);

function words(text: string): string[] {
    return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function singular(w: string): string {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(ches|shes|sses|oes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
}

/**
 * The part of a USDA description that names the food, normalised to singular:
 * "Eggs, Grade A, Large, egg whole" -> "egg"; "Fish, salmon, sockeye, raw" -> "fish salmon".
 */
export function baseName(description: string): string {
    const segs = description.replace(FDP_NOTE, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (segs.length === 0) return '';
    // "Fish, salmon" and "Salmon, sockeye, canned" are both salmon; "Cheese, cheddar" stays cheese.
    const head = SLUG_GROUP_PREFIXES.has(segs[0]) && segs[1] ? [segs[1]]
        : RELATED_GROUP_PREFIXES.has(segs[0]) && segs[1] ? [segs[0], segs[1]] : [segs[0]];
    return words(head.join(' ')).map(singular).join(' ');
}

/**
 * Lowercase description patterns that find foods sharing the base name.
 * Entries ending in "," are prefixes ("egg," matches "egg, whole, raw");
 * the others must equal the whole description.
 */
export function basePrefixes(description: string): string[] {
    const segs = description.replace(FDP_NOTE, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (segs.length === 0) return [];
    const forms = (w: string) => Array.from(new Set([w, singular(w), singular(w) + 's', singular(w) + 'es']));
    if (RELATED_GROUP_PREFIXES.has(segs[0]) && segs[1]) {
        return Array.from(new Set(forms(segs[1]).flatMap(f => [`${segs[0]}, ${f},`, `${segs[0]}, ${f}`, `${f},`])));
    }
    return Array.from(new Set(forms(segs[0]).flatMap(f => [`${f},`, f])));
}

export interface RelatedCandidate {
    id: number;
    fdc_id: number;
    description: string;
    food_category: string | null;
    ndb_number?: number | null;
    data_type_rank?: number | null;
    superseded_by_fdc_id?: number | null;
}

export interface RelatedResult<T extends RelatedCandidate> {
    /** The same food in another USDA dataset (same NDB number). */
    equivalents: T[];
    /** Other forms of the same food: cooked vs raw, sizes, parts, varieties. */
    forms: T[];
    /** Foods in the same category with the most similar nutrient profile. */
    similar: T[];
}

/** Preparation words: shared by many unrelated foods, so they don't make two foods "similar". */
const STATE_WORDS = new Set([
    'raw', 'cooked', 'boiled', 'baked', 'roasted', 'fried', 'grilled', 'broiled', 'steamed', 'braised', 'stewed',
    'drained', 'canned', 'frozen', 'dried', 'fresh', 'unprepared', 'prepared', 'heated',
]);

function jaccard(a: Set<string>, b: Set<string>): number {
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}

function ndbCloseness(a: number | null | undefined, b: number | null | undefined, window = 25): number {
    if (!a || !b) return 0;
    // SR NDB numbers are grouped by food group in blocks of 1,000 (01xxx dairy & eggs, 15xxx fish).
    if (Math.floor(a / 1000) !== Math.floor(b / 1000)) return 0;
    const d = Math.abs(a - b);
    return d > window ? 0 : 1 - d / (window + 1);
}

/** Nutrients compared for "similar foods", each scaled by a reference amount so units don't dominate. */
const PROFILE: [string, number][] = [
    ['calories', 2000], ['protein_g', 50], ['total_fat_g', 78], ['carbohydrate_g', 275], ['fiber_g', 28], ['sugars_g', 50],
    ['saturated_g', 20], ['sodium_mg', 2300], ['vitamin_a_ug', 900], ['vitamin_c_mg', 90], ['vitamin_k_ug', 120],
    ['folate_ug', 400], ['vitamin_b12_ug', 2.4], ['calcium_mg', 1300], ['iron_mg', 18], ['magnesium_mg', 420],
    ['potassium_mg', 4700], ['zinc_mg', 11], ['selenium_ug', 55], ['water_g', 100],
];
const MIN_SHARED_NUTRIENTS = 8;

/**
 * Cosine similarity (0–1) of two foods' nutrient profiles per 100 g, using
 * only nutrients measured in both (log-scaled, as a share of a daily
 * reference). Null when fewer than 8 nutrients are measured in both.
 */
export function nutrientProfileSimilarity(a: object, b: object): number | null {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    let dot = 0, na = 0, nb = 0, shared = 0;
    for (const [key, ref] of PROFILE) {
        const x = ra[key], y = rb[key];
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        const vx = Math.log1p(Math.max(0, x) / ref * 10);
        const vy = Math.log1p(Math.max(0, y) / ref * 10);
        dot += vx * vy; na += vx * vx; nb += vy * vy; shared++;
    }
    if (shared < MIN_SHARED_NUTRIENTS || na === 0 || nb === 0) return null;
    return dot / Math.sqrt(na * nb);
}

/**
 * Rank candidate foods against `food`.
 *  - equivalents: same NDB number (the Foundation and SR Legacy records of one food)
 *  - forms: same base name ("Egg, whole, cooked, fried" for "Egg, whole, raw"), ordered
 *    by how much of the rest of the description they share, then NDB proximity
 *  - similar: other foods in the same category, by nutrient-profile similarity, at
 *    most one per base name
 * Superseded SR rows are dropped when their Foundation replacement is the food
 * itself or another candidate, and repeated descriptions are dropped.
 */
export function rankRelated<T extends RelatedCandidate>(food: RelatedCandidate, candidates: T[], limits: { forms?: number; similar?: number } = {}): RelatedResult<T> {
    const formLimit = limits.forms ?? 8;
    const similarLimit = limits.similar ?? 6;
    const base = baseName(food.description);
    const baseWords = new Set(base.split(' '));
    const detail = (d: string) => new Set(words(d).map(singular).filter(w => !baseWords.has(w)));
    const mine = detail(food.description);
    const states = new Set(words(food.description).filter(w => STATE_WORDS.has(w)));
    const fdcIds = new Set(candidates.map(c => c.fdc_id));

    const equivalents: T[] = [];
    const forms: { c: T; score: number }[] = [];
    const similar: { c: T; score: number }[] = [];
    const seen = new Set<string>([food.description.toLowerCase()]);

    for (const c of candidates) {
        if (c.id === food.id || c.fdc_id === food.fdc_id) continue;
        if (food.ndb_number && c.ndb_number === food.ndb_number) { equivalents.push(c); continue; }
        if (c.superseded_by_fdc_id && (c.superseded_by_fdc_id === food.fdc_id || fdcIds.has(c.superseded_by_fdc_id))) continue;
        const key = c.description.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const rankPenalty = ((c.data_type_rank ?? 3) - 1) * 0.01;
        if (base && baseName(c.description) === base) {
            const near = ndbCloseness(food.ndb_number, c.ndb_number);
            forms.push({ c, score: jaccard(mine, detail(c.description)) + 0.3 * near - rankPenalty });
        } else if (c.food_category && c.food_category === food.food_category) {
            const sim = nutrientProfileSimilarity(food, c);
            if (sim === null || sim < 0.8) continue;
            // Same preparation ("raw" next to "raw") reads as a fair comparison.
            const sameState = words(c.description).some(w => states.has(w)) ? 0.02 : 0;
            similar.push({ c, score: sim + sameState - rankPenalty });
        }
    }
    const order = (a: { c: T; score: number }, b: { c: T; score: number }) =>
        b.score - a.score || (a.c.data_type_rank ?? 3) - (b.c.data_type_rank ?? 3) ||
        a.c.description.length - b.c.description.length || a.c.id - b.c.id;
    // One entry per base name, so six kinds of mushroom don't crowd the list.
    const bases = new Set<string>();
    const similarPicked: T[] = [];
    for (const { c } of similar.sort(order)) {
        const b = baseName(c.description);
        if (bases.has(b)) continue;
        bases.add(b);
        similarPicked.push(c);
        if (similarPicked.length >= similarLimit) break;
    }
    return {
        equivalents: equivalents.sort((a, b) => (a.data_type_rank ?? 3) - (b.data_type_rank ?? 3)),
        forms: forms.sort(order).slice(0, formLimit).map(x => x.c),
        similar: similarPicked,
    };
}

// ---------------------------------------------------------------------------
// Categories and nutrients as URL segments
// ---------------------------------------------------------------------------

export function categorySlug(category: string): string {
    return slugify(category, 80);
}

/** "vitamin_d_ug" -> "vitamin-d", "pantothenic_acid_mg" -> "pantothenic-acid". */
export function nutrientSlug(key: string): string {
    return key.replace(/_(g|mg|ug)$/, '').replace(/_/g, '-');
}

/** Reverse of nutrientSlug over the given keys. */
export function nutrientKeyFromSlug(slug: string, keys: string[]): string | null {
    const s = slug.toLowerCase();
    return keys.find(k => nutrientSlug(k) === s) ?? null;
}
