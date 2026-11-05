/**
 * Units for recipe quantities. No runtime dependencies (safe for client components).
 *
 * Every unit has a canonical name. Mass and volume units carry an exact
 * factor (grams or millilitres per unit); count units ("clove", "large",
 * "can") need a per-food weight, which lib/recipes/grams.ts looks up.
 */

export type UnitKind = 'mass' | 'volume' | 'count';

export interface UnitDef {
    /** Canonical name, e.g. "tbsp". */
    unit: string;
    kind: UnitKind;
    /** Grams per unit (mass) or millilitres per unit (volume). */
    factor?: number;
    /** Plural used in display. */
    plural?: string;
}

const ML_PER_TSP = 4.92892;

export const UNITS: Record<string, UnitDef> = {
    g: { unit: 'g', kind: 'mass', factor: 1 },
    kg: { unit: 'kg', kind: 'mass', factor: 1000 },
    mg: { unit: 'mg', kind: 'mass', factor: 0.001 },
    oz: { unit: 'oz', kind: 'mass', factor: 28.3495 },
    lb: { unit: 'lb', kind: 'mass', factor: 453.592, plural: 'lb' },

    ml: { unit: 'ml', kind: 'volume', factor: 1 },
    l: { unit: 'l', kind: 'volume', factor: 1000 },
    tsp: { unit: 'tsp', kind: 'volume', factor: ML_PER_TSP },
    tbsp: { unit: 'tbsp', kind: 'volume', factor: ML_PER_TSP * 3 },
    cup: { unit: 'cup', kind: 'volume', factor: ML_PER_TSP * 48, plural: 'cups' },
    'fl oz': { unit: 'fl oz', kind: 'volume', factor: ML_PER_TSP * 6 },
    pint: { unit: 'pint', kind: 'volume', factor: ML_PER_TSP * 96, plural: 'pints' },
    quart: { unit: 'quart', kind: 'volume', factor: ML_PER_TSP * 192, plural: 'quarts' },
    gallon: { unit: 'gallon', kind: 'volume', factor: ML_PER_TSP * 768, plural: 'gallons' },
    pinch: { unit: 'pinch', kind: 'volume', factor: ML_PER_TSP / 16, plural: 'pinches' },
    dash: { unit: 'dash', kind: 'volume', factor: ML_PER_TSP / 8, plural: 'dashes' },

    clove: { unit: 'clove', kind: 'count', plural: 'cloves' },
    slice: { unit: 'slice', kind: 'count', plural: 'slices' },
    piece: { unit: 'piece', kind: 'count', plural: 'pieces' },
    can: { unit: 'can', kind: 'count', plural: 'cans' },
    stick: { unit: 'stick', kind: 'count', plural: 'sticks' },
    sprig: { unit: 'sprig', kind: 'count', plural: 'sprigs' },
    bunch: { unit: 'bunch', kind: 'count', plural: 'bunches' },
    head: { unit: 'head', kind: 'count', plural: 'heads' },
    stalk: { unit: 'stalk', kind: 'count', plural: 'stalks' },
    leaf: { unit: 'leaf', kind: 'count', plural: 'leaves' },
    package: { unit: 'package', kind: 'count', plural: 'packages' },
    jar: { unit: 'jar', kind: 'count', plural: 'jars' },
    bottle: { unit: 'bottle', kind: 'count', plural: 'bottles' },
    handful: { unit: 'handful', kind: 'count', plural: 'handfuls' },
    fillet: { unit: 'fillet', kind: 'count', plural: 'fillets' },
    strip: { unit: 'strip', kind: 'count', plural: 'strips' },
    ear: { unit: 'ear', kind: 'count', plural: 'ears' },
    large: { unit: 'large', kind: 'count' },
    medium: { unit: 'medium', kind: 'count' },
    small: { unit: 'small', kind: 'count' },
    whole: { unit: 'whole', kind: 'count' },
};

/** Lower-case spellings -> canonical unit. "T" / "t" are handled case-sensitively in lookupUnit. */
const ALIASES: Record<string, string> = {
    g: 'g', gr: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
    kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
    mg: 'mg', milligram: 'mg', milligrams: 'mg',
    oz: 'oz', ounce: 'oz', ounces: 'oz',
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
    ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', cc: 'ml',
    l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
    tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', ts: 'tsp',
    tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tbls: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
    cup: 'cup', cups: 'cup', c: 'cup',
    'fl oz': 'fl oz', 'fl. oz': 'fl oz', floz: 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
    pint: 'pint', pints: 'pint', pt: 'pint',
    quart: 'quart', quarts: 'quart', qt: 'quart',
    gallon: 'gallon', gallons: 'gallon', gal: 'gallon',
    pinch: 'pinch', pinches: 'pinch',
    dash: 'dash', dashes: 'dash',
    clove: 'clove', cloves: 'clove',
    slice: 'slice', slices: 'slice',
    piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
    can: 'can', cans: 'can', tin: 'can', tins: 'can',
    stick: 'stick', sticks: 'stick',
    sprig: 'sprig', sprigs: 'sprig',
    bunch: 'bunch', bunches: 'bunch',
    head: 'head', heads: 'head',
    stalk: 'stalk', stalks: 'stalk', rib: 'stalk', ribs: 'stalk',
    leaf: 'leaf', leaves: 'leaf',
    package: 'package', packages: 'package', pkg: 'package', pkgs: 'package', packet: 'package', packets: 'package', box: 'package', boxes: 'package', bag: 'package', bags: 'package',
    jar: 'jar', jars: 'jar',
    bottle: 'bottle', bottles: 'bottle',
    handful: 'handful', handfuls: 'handful',
    fillet: 'fillet', fillets: 'fillet', filet: 'fillet', filets: 'fillet',
    strip: 'strip', strips: 'strip', rasher: 'strip', rashers: 'strip',
    ear: 'ear', ears: 'ear',
    large: 'large', lg: 'large', big: 'large',
    medium: 'medium', med: 'medium',
    small: 'small', sm: 'small',
    whole: 'whole',
};

/** Canonical unit for a spelling, or null. Case matters only for "T" (tbsp) and "t" (tsp). */
export function lookupUnit(token: string | null | undefined): string | null {
    if (!token) return null;
    const raw = token.trim().replace(/\.$/, '');
    if (raw === 'T' || raw === 'Tb' || raw === 'Tbs') return 'tbsp';
    if (raw === 't') return 'tsp';
    const key = raw.toLowerCase().replace(/\s+/g, ' ').replace(/\.\s*/g, '. ').replace(/\.\s*$/, '').trim();
    return ALIASES[key] ?? ALIASES[key.replace(/\./g, '')] ?? null;
}

export function unitDef(unit: string | null | undefined): UnitDef | null {
    const canonical = lookupUnit(unit ?? '') ?? (unit && UNITS[unit] ? unit : null);
    return canonical ? UNITS[canonical] ?? null : null;
}

/** Canonical units in the order a picker should offer them. */
export const UNIT_CHOICES: string[] = [
    'g', 'oz', 'lb', 'kg', 'cup', 'tbsp', 'tsp', 'ml', 'l', 'fl oz',
    'large', 'medium', 'small', 'whole', 'clove', 'slice', 'piece', 'can', 'stick', 'pinch',
];

/** "cups" for 2, "cup" for 1; mass/volume abbreviations never pluralise. */
export function unitLabel(unit: string | null, quantity: number | null): string {
    if (!unit) return '';
    const def = UNITS[unit];
    if (!def) return unit;
    if (quantity !== null && quantity > 1 && def.plural) return def.plural;
    return def.unit;
}
