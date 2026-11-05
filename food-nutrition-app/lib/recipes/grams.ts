/**
 * Quantity + unit -> grams for a matched USDA food. Pure, no runtime
 * dependencies beyond this folder (runs in the browser while the user edits).
 *
 * Order of trust:
 *   1. Mass units are exact arithmetic.
 *   2. USDA portion rows of the food ("1 cup = 125 g", "1 large = 50 g"), or of
 *      the SR Legacy food it supersedes. Volume rows scale across volume units.
 *   3. Tables below (typical densities and item weights): marked "estimated".
 *   4. Otherwise "unknown": the row is shown but not counted in the totals.
 */
import type { Conversion, Portion } from './types';
import { UNITS, lookupUnit } from './units';
import { parseQuantity } from './parse';
import { wordStem } from './text';

export interface ConvertInput {
    quantity: number | null;
    unit: string | null;
    /** Ingredient name as written ("eggs"); helps with "1 egg" style rows and fallbacks. */
    name?: string | null;
    preparation?: string | null;
    notes?: string | null;
}

export interface ConvertFood {
    description: string;
    portions: Portion[];
}

interface ParsedPortion {
    portion: Portion;
    qty: number;
    unit: string | null;
    /** Remaining label text after quantity and unit, lower-case. */
    rest: string;
    words: string[];
}

const IGNORED_LABEL = /^(\d+(\.\d+)?\s*(g|gram|grams)\b|1\s*RACC\b)/i;

/** Parse "1 cup, chopped" -> qty 1, unit cup, rest "chopped". Rows with no leading amount count as 1. */
export function parsePortionLabel(portion: Portion): ParsedPortion | null {
    const label = portion.label.trim();
    if (!label || IGNORED_LABEL.test(label) || !(portion.grams > 0)) return null;
    const q = parseQuantity(label);
    const qty = q && q.value > 0 ? q.value : 1;
    let rest = (q ? q.rest : label).trim();
    let unit: string | null = null;
    const fl = rest.match(/^fl\.?\s*oz\.?\b/i);
    if (fl) {
        unit = 'fl oz';
        rest = rest.slice(fl[0].length);
    } else {
        const first = rest.match(/^([A-Za-z]+)\.?(?=[\s,()]|$)/);
        const u = first ? lookupUnit(first[1]) : null;
        if (u) {
            unit = u;
            rest = rest.slice(first![0].length);
        }
    }
    rest = rest.replace(/^[\s,]+/, '').toLowerCase();
    // Only the text before any parenthesis names the item: "1 wedge (1/8 of one lemon)" is not a lemon.
    return { portion, qty, unit, rest, words: rest.replace(/\(.*$/, '').match(/[a-z]+/g) ?? [] };
}

/** Prefer the row whose qualifier matches the preparation; then plain rows; then larger amounts. */
function pickRow(rows: ParsedPortion[], preparation: string | null | undefined): ParsedPortion | undefined {
    const prep = new Set((preparation ?? '').toLowerCase().match(/[a-z]+/g) ?? []);
    const score = (r: ParsedPortion) => {
        const overlap = r.words.filter(w => prep.has(w) || prep.has(wordStem(w))).length;
        return [overlap > 0 ? 0 : 1, r.words.length === 0 ? 0 : 1, r.portion.source === 'food' ? 0 : 1];
    };
    const sorted = rows.slice().sort((a, b) => {
        const sa = score(a);
        const sb = score(b);
        for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
        return a.portion.grams / a.qty - b.portion.grams / b.qty;
    });
    if (!sorted.length) return undefined;
    // Equally good rows differ by size ("1 fruit (2-1/8" dia)", "1 fruit (2-3/8" dia)"): take the lower middle.
    const top = score(sorted[0]).join();
    const ties = sorted.filter(r => score(r).join() === top);
    return ties[Math.floor((ties.length - 1) / 2)];
}

function fmtG(g: number): string {
    return g >= 10 ? String(Math.round(g)) : String(Math.round(g * 10) / 10);
}

function rowBasis(r: ParsedPortion): string {
    const related = r.portion.source === 'related' ? ' (equivalent USDA food)' : '';
    return `USDA${related}: ${r.portion.label} = ${fmtG(r.portion.grams)} g`;
}

/** Grams per millilitre for foods with no usable USDA volume row. First match wins. */
const DENSITIES: [RegExp, number, string][] = [
    [/\b(soy sauce|vinegar|water|broth|stock|milk|cream|juice|wine|beer|yogurt|sauce|puree|coffee|tea)\b/, 1.03, 'watery liquid'],
    [/\b(flour|cornstarch|corn starch)\b/, 0.53, 'flour'],
    [/\b(brown sugar)\b/, 0.93, 'brown sugar'],
    [/\b(powdered|confectioners?'?) sugar\b/, 0.51, 'powdered sugar'],
    [/\bsugars?\b/, 0.85, 'sugar'],
    [/\b(honey|molasses)\b/, 1.42, 'honey'],
    [/\bsyrup\b/, 1.33, 'syrup'],
    [/\boil\b/, 0.92, 'oil'],
    [/\b(butter|margarine|shortening|lard|ghee)\b/, 0.96, 'fat'],
    [/\bsalt\b/, 1.22, 'salt'],
    [/\bbaking (powder|soda)\b/, 0.9, 'baking powder'],
    [/\bcocoa\b/, 0.36, 'cocoa powder'],
    [/\b(oats|oatmeal)\b/, 0.38, 'rolled oats'],
    [/\brice\b/, 0.78, 'rice'],
    [/\b(shredded|grated)\b.*\bcheese\b|\bcheese\b.*\b(shredded|grated)\b/, 0.45, 'shredded cheese'],
    [/\b(almonds?|walnuts?|pecans?|cashews?|peanuts?|nuts?)\b/, 0.6, 'nuts'],
    [/\b(pepper|cinnamon|cumin|paprika|oregano|basil|thyme|nutmeg|ginger|turmeric|spices?|seasoning|chili powder|garlic powder|onion powder)\b/, 0.5, 'ground spice'],
    [/\bolives?\b/, 0.65, 'olives'],
    [/\b(chia|flax|sesame|poppy|sunflower|pumpkin)\b.*\bseeds?\b|\bseeds\b/, 0.65, 'seeds'],
];

/** Typical weights (g) of one item, when USDA has no row for it. */
const ITEM_WEIGHTS: [RegExp, number, string][] = [
    [/\beggs?\b/, 50, 'large egg'],
    [/\bgarlic\b/, 3, 'clove of garlic'],
    [/\bonions?\b/, 110, 'medium onion'],
    [/\btomato(es)?\b/, 123, 'medium tomato'],
    [/\bpotato(es)?\b/, 170, 'medium potato'],
    [/\bcarrots?\b/, 61, 'medium carrot'],
    [/\bbananas?\b/, 118, 'medium banana'],
    [/\bapples?\b/, 182, 'medium apple'],
    [/\blemons?\b/, 58, 'lemon'],
    [/\blimes?\b/, 44, 'lime'],
    [/\boranges?\b/, 131, 'orange'],
    [/\bavocados?\b/, 150, 'avocado'],
    [/\bbell peppers?\b/, 119, 'bell pepper'],
    [/\bcelery\b/, 40, 'celery stalk'],
    [/\bzucchinis?\b/, 196, 'zucchini'],
    [/\bcucumbers?\b/, 300, 'cucumber'],
    [/\bchicken breasts?\b/, 170, 'boneless chicken breast'],
    [/\bchicken thighs?\b/, 115, 'boneless chicken thigh'],
    [/\bbacon\b/, 12, 'strip of bacon'],
    [/\b(bread|toast)\b/, 28, 'slice of bread'],
    [/\btortillas?\b/, 45, 'tortilla'],
];

/** Typical weights (g) per container or vague unit. */
const UNIT_WEIGHTS: Record<string, { grams: number; label: string }> = {
    can: { grams: 411, label: 'a standard 14.5 oz can' },
    jar: { grams: 680, label: 'a standard 24 oz jar' },
    bottle: { grams: 355, label: 'a 12 fl oz bottle' },
    handful: { grams: 30, label: 'a handful' },
    bunch: { grams: 60, label: 'a bunch of herbs or greens' },
    sprig: { grams: 1, label: 'a sprig' },
    leaf: { grams: 1, label: 'a leaf' },
    stick: { grams: 113, label: 'a US stick of butter' },
};

function itemWeight(text: string): { grams: number; label: string } | null {
    for (const [re, grams, label] of ITEM_WEIGHTS) if (re.test(text)) return { grams, label };
    return null;
}

const UNKNOWN_NO_AMOUNT = 'No amount given, so this is not counted. Enter an amount to include it.';

/**
 * Convert a quantity to grams for a food. `food` may be null (no match yet):
 * mass units still convert exactly; everything else is unknown.
 */
export function convertToGrams(input: ConvertInput, food: ConvertFood | null): Conversion {
    const { quantity, name, preparation } = input;
    const unit = input.unit ? (lookupUnit(input.unit) ?? (UNITS[input.unit] ? input.unit : null)) : null;

    if (quantity === null || !Number.isFinite(quantity) || quantity < 0) {
        return { grams: null, method: 'unknown', basis: UNKNOWN_NO_AMOUNT };
    }
    const def = unit ? UNITS[unit] : null;
    if (def?.kind === 'mass') {
        return { grams: quantity * def.factor!, method: 'exact', basis: `${quantity} ${def.unit} is ${fmtG(quantity * def.factor!)} g` };
    }
    if (!food) return { grams: null, method: 'unknown', basis: 'Pick a matching food to convert this to grams.' };

    const rows = food.portions.map(parsePortionLabel).filter((r): r is ParsedPortion => r !== null);
    const text = `${name ?? ''} ${food.description}`.toLowerCase();

    if (def?.kind === 'volume') return convertVolume(quantity, def.unit, def.factor!, rows, text, preparation);
    return convertCount(quantity, unit, rows, input, text);
}

function convertVolume(
    quantity: number, unit: string, factor: number, rows: ParsedPortion[], text: string, preparation: string | null | undefined,
): Conversion {
    const ml = quantity * factor;
    // A superseded food is not always the same form: USDA's "Oats" row (1 cup = 156 g) is for groats, not rolled oats.
    const trusted = /\brolled\b/.test(text) ? rows.filter(r => r.portion.source === 'food') : rows;
    const volumeRows = trusted.filter(r => r.unit !== null && UNITS[r.unit]?.kind === 'volume');
    const same = volumeRows.filter(r => r.unit === unit);
    const row = pickRow(same.length ? same : volumeRows, preparation);
    if (row) {
        const rowMl = row.qty * UNITS[row.unit!].factor!;
        return { grams: (ml * row.portion.grams) / rowMl, method: 'exact', basis: rowBasis(row) };
    }
    for (const [re, density, label] of DENSITIES) {
        if (re.test(text)) {
            return { grams: ml * density, method: 'estimated', basis: `Estimated: typical density of ${label} (${density} g/ml)` };
        }
    }
    return { grams: ml, method: 'estimated', basis: 'Estimated: no USDA volume for this food, assumed the density of water' };
}

function convertCount(quantity: number, unit: string | null, rows: ParsedPortion[], input: ConvertInput, text: string): Conversion {
    const nameWords = new Set(((input.name ?? '').toLowerCase().match(/[a-z]+/g) ?? []).map(wordStem));
    const perItem = (r: ParsedPortion) => r.portion.grams / r.qty;
    const fromRow = (r: ParsedPortion, method: 'exact' | 'estimated', suffix = ''): Conversion => ({
        grams: quantity * perItem(r),
        method,
        basis: rowBasis(r) + suffix,
    });

    if (unit && unit !== 'whole') {
        // The row must name this unit: "1 clove", "1 slice, thin", "1 medium (2-1/2" dia)".
        const direct = rows.filter(r => r.unit === unit);
        const row = pickRow(direct, input.preparation);
        if (row) return fromRow(row, 'exact');
        const table = UNIT_WEIGHTS[unit];
        // "2 cloves" of a food with no clove row: only the garlic table can answer.
        const item = unit === 'clove' ? itemWeight(text) : null;
        if (item) return { grams: quantity * item.grams, method: 'estimated', basis: `Estimated: ${item.label} is about ${item.grams} g` };
        if (unit === 'stick' && !/\b(butter|margarine)\b/.test(text)) {
            return { grams: null, method: 'unknown', basis: 'USDA has no weight for a stick of this food. Enter grams instead.' };
        }
        if (table) return { grams: quantity * table.grams, method: 'estimated', basis: `Estimated: ${table.label} is about ${table.grams} g` };
    }

    // Bare count or a size word USDA doesn't list: "2 eggs", "1 onion", "1 large banana".
    const size = unit === 'large' || unit === 'medium' || unit === 'small' ? unit : null;
    const named = rows.filter(r => r.unit === null && r.words.some(w => nameWords.has(wordStem(w))));
    const whole = rows.filter(r => r.unit === 'whole' || (r.unit === null && /\b(whole|each|item|fruit|unit|piece)\b/.test(r.rest)));
    const namedRow = pickRow(named.length ? named : whole, input.preparation);
    if (namedRow) return fromRow(namedRow, size ? 'estimated' : 'exact');

    for (const s of ['medium', 'large', 'small'] as const) {
        const row = pickRow(rows.filter(r => r.unit === s), input.preparation);
        if (row) return fromRow(row, 'estimated', size ? '' : `, assuming ${s}`);
    }
    const piece = pickRow(rows.filter(r => r.unit === 'piece' || r.unit === 'slice' || r.unit === 'fillet'), input.preparation);
    if (piece) return fromRow(piece, 'estimated');

    const item = itemWeight(text);
    if (item) return { grams: quantity * item.grams, method: 'estimated', basis: `Estimated: ${item.label} is about ${item.grams} g` };

    const typical = rows.find(r => /quantity not specified|typical portion/i.test(r.portion.label));
    if (typical) {
        return { grams: quantity * typical.portion.grams, method: 'estimated', basis: `Estimated: USDA typical portion is ${fmtG(typical.portion.grams)} g` };
    }
    return {
        grams: null,
        method: 'unknown',
        basis: unit ? `USDA has no weight for "${unit}" of this food. Enter grams instead.` : 'USDA has no weight per item for this food. Enter grams instead.',
    };
}

/** Portions of a food: its own rows plus rows of the SR Legacy food it supersedes. */
export function mergePortions(
    own: { label: string; weight_g: number }[] | undefined,
    related: { label: string; weight_g: number }[] = [],
): Portion[] {
    const seen = new Set<string>();
    const out: Portion[] = [];
    const add = (rows: { label: string; weight_g: number }[], source: Portion['source']) => {
        for (const r of rows) {
            if (!r.label || !(r.weight_g > 0)) continue;
            const key = r.label.trim().toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ label: r.label, grams: r.weight_g, source });
        }
    };
    add(own ?? [], 'food');
    add(related, 'related');
    return out;
}
