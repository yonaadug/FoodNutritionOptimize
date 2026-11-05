/**
 * Deterministic recipe reader: ingredient lines -> ParsedIngredient, and
 * pasted recipe text -> ParsedRecipe. No runtime dependencies (safe for
 * client components). It powers the `mock` AI provider (so the whole feature
 * works offline and in CI), parses lines the user types into the editor, and
 * normalises whatever an LLM returns.
 */
import type { ParsedIngredient, ParsedRecipe } from './types';
import { UNITS, lookupUnit } from './units';

export const MAX_INGREDIENTS = 60;
const MAX_LINE = 300;

const UNICODE_FRACTIONS: Record<string, string> = {
    '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
    '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅐': '1/7', '⅑': '1/9', '⅒': '1/10',
};

const WORD_NUMBERS: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, dozen: 12, half: 0.5, quarter: 0.25,
};

/** Words that describe preparation; moved out of the name into `preparation`. */
const PREP_WORDS = new Set([
    'chopped', 'minced', 'diced', 'sliced', 'grated', 'shredded', 'crushed', 'peeled', 'melted', 'softened',
    'beaten', 'cubed', 'julienned', 'toasted', 'halved', 'quartered', 'trimmed', 'rinsed', 'drained', 'packed',
    'sifted', 'divided', 'zested', 'juiced', 'mashed', 'pitted', 'seeded', 'cored', 'deveined', 'thawed',
    'room-temperature', 'cooked', 'uncooked', 'boiled', 'roasted', 'steamed', 'fried', 'grilled', 'baked',
    'sauteed', 'sautéed', 'chilled', 'warm', 'cold', 'hot', 'heaping', 'level', 'scant', 'firmly', 'lightly',
    'finely', 'thinly', 'roughly', 'coarsely', 'freshly', 'well', 'loosely',
]);

/** Containers whose size may be given in parentheses: "1 (14.5 oz) can tomatoes". */
const CONTAINERS = new Set(['can', 'package', 'jar', 'bottle', 'stick']);

const NOTE_PATTERNS: [RegExp, string][] = [
    [/\bto taste\b/i, 'to taste'],
    [/\bas needed\b/i, 'as needed'],
    [/\b(\(?optional\)?)/i, 'optional'],
    [/\bfor (garnish|serving|dusting|greasing|frying|the pan)\b/i, ''],
    [/\bdivided\b/i, 'divided'],
    [/\bplus more\b.*$/i, ''],
    [/\bor more\b/i, ''],
    [/\bat room temperature\b/i, 'at room temperature'],
];

/** Replace unicode fractions and fraction slashes with ASCII ("1½" -> "1 1/2"). */
export function normalizeFractions(s: string): string {
    return s
        .replace(/(\d)([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⅐⅑⅒])/g, '$1 $2')
        .replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⅐⅑⅒]/g, c => UNICODE_FRACTIONS[c])
        .replace(/⁄/g, '/');
}

function parseNumberToken(tok: string): number | null {
    if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok);
    if (/^\.\d+$/.test(tok)) return Number(tok);
    if (/^\d+,\d+$/.test(tok)) return Number(tok.replace(',', '.')); // European decimal comma "1,5"
    const frac = tok.match(/^(\d+)\/(\d+)$/);
    if (frac && Number(frac[2]) > 0) return Number(frac[1]) / Number(frac[2]);
    return null;
}

interface QuantityMatch { value: number; max: number | null; rest: string }

/**
 * Leading quantity: "2", "1.5", "1/2", "1 1/2", "1-2", "1 to 2", "a", "one", "half a".
 * Returns the mean for ranges (and the max separately).
 */
export function parseQuantity(text: string): QuantityMatch | null {
    const s = text.trimStart();
    const num = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|\.\d+)`;
    const m = s.match(new RegExp(String.raw`^(${num})(?:\s*(?:-|–|—|to|or)\s*(${num}))?(?=[^\d/]|$)`, 'i'));
    if (m) {
        const toNum = (t: string) => {
            const parts = t.trim().split(/\s+/);
            if (parts.length === 2) {
                const a = parseNumberToken(parts[0]);
                const b = parseNumberToken(parts[1]);
                return a !== null && b !== null ? a + b : null;
            }
            return parseNumberToken(parts[0]);
        };
        const lo = toNum(m[1]);
        const hi = m[2] ? toNum(m[2]) : null;
        if (lo === null) return null;
        const value = hi !== null && hi > lo ? (lo + hi) / 2 : lo;
        return { value, max: hi !== null && hi > lo ? hi : null, rest: s.slice(m[0].length) };
    }
    const w = s.match(/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|quarter)\b(\s+(a|an|dozen)\b)?/i);
    if (w) {
        let value = WORD_NUMBERS[w[1].toLowerCase()];
        const second = w[3]?.toLowerCase();
        if (second === 'dozen') value *= 12;
        // "a" / "an" only count as a quantity before a unit or a countable noun ("a pinch", "an onion").
        return { value, max: null, rest: s.slice(w[0].length) };
    }
    return null;
}

function cleanSpaces(s: string): string {
    return s.replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').trim();
}

/** Leading unit token(s): "cups", "fl oz", "T", "g" (also glued: "200g"). */
function takeUnit(rest: string): { unit: string; rest: string } | null {
    const s = rest.replace(/^\s*-\s*/, ' ').trimStart();
    const two = s.match(/^(fl\.?\s*oz\.?|fluid\s+ounces?)\b\.?/i);
    if (two) return { unit: 'fl oz', rest: s.slice(two[0].length) };
    const one = s.match(/^([A-Za-z]+)\.?(?=[\s,()]|$)/);
    if (one) {
        const unit = lookupUnit(one[1]);
        // A lone "c" or "t" is only a unit when followed by more text.
        if (unit) return { unit, rest: s.slice(one[0].length) };
    }
    return null;
}

/** Mass given in a parenthetical, e.g. "(125 g)" or "(about 4 oz)". */
function parentheticalMass(text: string): { grams: number; unit: string; quantity: number } | null {
    const m = text.match(/^\(\s*(?:about|approx\.?|approximately|~)?\s*([\d./\s]+?)\s*-?\s*(g|grams?|kg|oz|ounces?|lbs?|pounds?)\s*\)/i);
    if (!m) return null;
    const q = parseQuantity(m[1]);
    const unit = lookupUnit(m[2]);
    if (!q || !unit) return null;
    const def = UNITS[unit];
    if (def.kind !== 'mass' || !def.factor) return null;
    return { grams: q.value * def.factor, unit, quantity: q.value };
}

/**
 * Parse one ingredient line. Returns null for blank lines, section headers
 * ("For the sauce:") and lines that are clearly instructions.
 */
export function parseIngredientLine(line: string): ParsedIngredient | null {
    const original = line.trim().slice(0, MAX_LINE);
    let s = normalizeFractions(original)
        .replace(/^\s*(?:[-*•·▢□◦‣–]|\[\s*\]|\d+[.)](?=\s+\D))\s*/, '') // bullets, checkboxes, "1." list markers
        .trim();
    if (!s || /:\s*$/.test(s)) return null;

    const notes: string[] = [];
    let preparation: string[] = [];
    let confidence = 0.9;

    // Quantity and unit.
    let quantity: number | null = null;
    let unit: string | null = null;
    // "2 x 145g tins of tuna": a multiplier in front of a container size.
    const times = s.match(/^(\d+)\s*[x×]\s*(?=\d)/i);
    const multiplier = times ? Number(times[1]) : 1;
    if (times) s = s.slice(times[0].length);
    const q = parseQuantity(s);
    if (q) {
        quantity = q.value * multiplier;
        if (q.max !== null) notes.push(`${fmt(q.value * 2 - q.max)}–${fmt(q.max)}`);
        s = q.rest;
        // "1 (14.5 oz) can" / "2 (8 ounce) packages"
        const inner = parentheticalMass(s.trimStart());
        const afterParen = inner ? s.trimStart().replace(/^\([^)]*\)\s*/, '') : null;
        const container = afterParen !== null ? takeUnit(afterParen) : null;
        if (inner && container && CONTAINERS.has(container.unit)) {
            notes.push(`${fmt(quantity)} × ${fmt(inner.quantity)} ${inner.unit} ${container.unit}`);
            quantity = quantity * inner.quantity;
            unit = inner.unit;
            s = container.rest;
        } else {
            const u = takeUnit(s);
            // "a" / "an" without a unit: "an onion" -> 1 onion; "a few" -> no quantity.
            if (u) {
                unit = u.unit;
                s = u.rest;
            }
            // A second size word ("1 cup large ...") is part of the name.
        }
        // "1 cup (125 g) flour": the weight in parentheses is more precise.
        const mass = parentheticalMass(s.trimStart());
        if (mass && (unit === null || UNITS[unit]?.kind !== 'mass')) {
            notes.push(`${fmt(quantity)} ${unit ?? ''}`.trim());
            quantity = mass.quantity;
            unit = mass.unit;
            s = s.trimStart().replace(/^\([^)]*\)/, '');
        }
        // "145g tins of tuna" after a weight: the container word adds nothing.
        if (unit && UNITS[unit].kind === 'mass') s = s.replace(/^\s*(tins?|cans?|jars?|packages?|packets?|bags?|boxes|box)\b/i, m => { notes.push(m.trim().toLowerCase()); return ' '; });
        s = s.replace(/^\s*of\s+/i, ' ');
    } else {
        confidence = 0.6;
    }

    // Notes such as "to taste", "optional", "divided".
    for (const [re, note] of NOTE_PATTERNS) {
        if (re.test(s)) {
            if (note) notes.push(note);
            s = s.replace(re, ' ');
        }
    }

    // Other parentheticals become notes ("(about 2 cups)", "(see note)").
    s = s.replace(/\(([^)]*)\)/g, (_, inner: string) => {
        const t = inner.trim();
        if (t) notes.push(t);
        return ' ';
    });

    // "garlic, minced" / "onion, finely chopped"
    let name = s;
    const comma = s.indexOf(',');
    if (comma >= 0) {
        name = s.slice(0, comma);
        const after = cleanSpaces(s.slice(comma + 1)).replace(/^(and|or)\s+/i, '');
        if (after) preparation.push(after);
    }
    // Leading preparation words: "finely chopped fresh parsley".
    const words = cleanSpaces(name).split(' ');
    const lead: string[] = [];
    while (words.length > 1 && PREP_WORDS.has(words[0].toLowerCase())) lead.push(words.shift()!);
    if (lead.length) preparation = [lead.join(' '), ...preparation];
    name = cleanSpaces(words.join(' ')).replace(/^[-,;:.\s]+|[-,;:.\s]+$/g, '');

    // "3 garlic cloves", "2 salmon fillets": the unit came after the food.
    if (quantity !== null && unit === null) {
        const trailing = name.match(/^(.+?)\s+(cloves?|stalks?|fillets?|filets?|strips?|sprigs?|slices?)$/i);
        if (trailing) {
            name = trailing[1];
            unit = lookupUnit(trailing[2]);
        }
    }
    if (!name) return null;
    if (looksLikeInstruction(original)) return null;
    if (quantity === null && unit === null && name.split(' ').length > 8) return null;

    return {
        name: name.slice(0, 120),
        quantity: quantity === null ? null : round(quantity, 4),
        unit,
        preparation: preparation.length ? cleanSpaces(preparation.join(', ')).slice(0, 120) : null,
        notes: notes.length ? Array.from(new Set(notes)).join('; ').slice(0, 160) : null,
        confidence,
        original,
    };
}

const INSTRUCTION_VERBS = /^(preheat|heat|bake|cook|stir|mix|whisk|combine|add|place|pour|bring|let|serve|remove|transfer|cover|reduce|simmer|season|in a|meanwhile|using|once|when|while|set aside)\b/i;

function looksLikeInstruction(line: string): boolean {
    const s = line.replace(/^\s*(step\s*)?\d+[.):]\s*/i, '').trim();
    if (s.length > 90 && /[.!]$/.test(s)) return true;
    if (INSTRUCTION_VERBS.test(s) && s.split(' ').length > 5) return true;
    return false;
}

function round(n: number, places: number): number {
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

function fmt(n: number): string {
    return String(round(n, 2));
}

const INGREDIENT_HEADER = /^\s*(ingredients?|you(?:'|’)ll need|what you need)\s*:?\s*$/i;
const STOP_HEADER = /^\s*(instructions?|directions?|method|steps|preparation|how to make( it)?|to make|notes?|nutrition( facts| information)?)\s*:?\s*$/i;
const SERVINGS_RE = /\b(?:serves|servings?|yield|yields|makes|portions?)\s*:?\s*(?:about\s*)?(\d+(?:\s*(?:-|–|to)\s*\d+)?)/i;
const SERVINGS_AFTER_RE = /\b(\d+)\s*(?:servings|portions|people)\b/i;

/** "Serves 4", "Makes 12 cookies", "Yield: 6-8 servings" -> number (mean of a range). */
export function parseServings(text: string): number | null {
    const m = text.match(SERVINGS_RE) ?? text.match(SERVINGS_AFTER_RE);
    if (!m) return null;
    const nums = m[1].split(/\s*(?:-|–|to)\s*/).map(Number).filter(n => Number.isFinite(n) && n > 0);
    if (!nums.length) return null;
    const v = nums.reduce((a, b) => a + b, 0) / nums.length;
    return v > 0 && v <= 200 ? Math.round(v * 2) / 2 : null;
}

/**
 * Pasted recipe text -> title, servings and ingredient lines. With an
 * "Ingredients" header only that section is read; without one every line that
 * looks like an ingredient is kept and instructions are skipped.
 */
export function parseRecipeText(text: string): ParsedRecipe {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).slice(0, 400);
    const hasHeader = lines.some(l => INGREDIENT_HEADER.test(l));
    let title = '';
    let servings: number | null = null;
    const ingredients: ParsedIngredient[] = [];
    let inIngredients = !hasHeader;
    let seenContent = false;

    for (const line of lines) {
        if (!line) continue;
        if (servings === null) {
            const sv = parseServings(line);
            if (sv !== null && line.length < 60 && !parseQuantity(line)) {
                servings = sv;
                continue;
            }
        }
        if (INGREDIENT_HEADER.test(line)) { inIngredients = true; seenContent = true; continue; }
        if (STOP_HEADER.test(line)) { inIngredients = false; seenContent = true; continue; }
        if (!seenContent && !title && !parseQuantity(normalizeFractions(line)) && line.length <= 80 && !/[.!?]$/.test(line)) {
            // First short line without an amount: the title (unless it's a bare ingredient in a header-less list).
            const next = lines.find(l => l && l !== line && parseServings(l) === null);
            if (hasHeader || (next && parseQuantity(normalizeFractions(next)))) {
                title = line.replace(/^#+\s*/, '');
                seenContent = true;
                continue;
            }
        }
        seenContent = true;
        if (!inIngredients) continue;
        const ing = parseIngredientLine(line);
        if (!ing) continue;
        // Without a header, unquantified lines must be short to count ("Salt and pepper", not a paragraph).
        if (!hasHeader && ing.quantity === null && line.split(/\s+/).length > 6) continue;
        ingredients.push(ing);
        if (ingredients.length >= MAX_INGREDIENTS) break;
    }
    return { title: title.slice(0, 120), servings, ingredients };
}
