/**
 * Is the built-in reader's read of pasted text good enough to skip AI?
 *
 * Pasted text is read by lib/recipes/parse.ts and matched to USDA foods first.
 * AI is called only when this says the read is unsure. The thresholds were set
 * offline, with no AI calls, on the tuning, held-out and pasted fixture sets
 * (lib/recipes/reader-eval.ts; the numbers print during `npm test` and are in
 * docs/RECIPES.md). Pure: no database, safe anywhere.
 */
import { LIST_MARKER, normalizeFractions, type DetailedRead } from './parse';
import type { ParsedIngredient } from './types';
import { UNITS } from './units';

/** One read ingredient with what the matcher and gram conversion made of it. */
export interface ReadRow {
    ingredient: ParsedIngredient;
    /** A USDA food was found. */
    matched: boolean;
    /** The matcher's 0..1 confidence (lib/recipes/match.ts). */
    matchConfidence: number;
    /** Grams the amount converts to; null when it can't be converted. */
    grams: number | null;
}

export type UnsureReason =
    | 'too_few_ingredients'
    | 'skipped_amounts'
    | 'odd_name'
    | 'no_amount'
    | 'no_match'
    | 'weak_match'
    | 'no_grams'
    | 'unused_weight'
    | 'huge_amount';

export interface Verdict {
    confident: boolean;
    /** Empty when confident; otherwise every reason that applied, for the log. */
    reasons: UnsureReason[];
}

export const BUILTIN_RULE = {
    /** One line could be a stray sentence; AI is cheap for something that short anyway. */
    minIngredients: 2,
    /** Every matched food must score at least this (lib/recipes/match.ts confidenceOf). */
    minMatchConfidence: 0.7,
    /** Share of ingredients that may lack an amount, not counting "to taste" and similar. */
    maxNoAmountShare: 0.2,
    /** No single ingredient this heavy in a home recipe: a sign a number was misread. */
    maxGramsPerRow: 5000,
};

/** Notes and phrases that explain a missing amount. */
const NO_AMOUNT_OK = /\b(to taste|as needed|optional|for (garnish|serving|dusting|greasing|frying|the pan|brushing|topping))\b/i;

/** "2 cups", "1/2 tsp", "200g" anywhere in a line. */
const AMOUNT_IN_TEXT = /(?:^|[\s(])\d+(?:[.,/]\d+)?(?:\s+\d+\/\d+)?\s*(?:cups?|c\.|tbsps?|tablespoons?|tsps?|teaspoons?|g|grams?|kg|oz|ounces?|lbs?|pounds?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|cans?|cloves?|sticks?|pinch(?:es)?)\b/i;

/** A weight in the notes: "6 oz each", "about 200 g". */
const WEIGHT_IN_NOTES = /\d\s*(?:g|grams?|kg|oz|ounces?|lbs?|pounds?)\b/i;

/** A skipped line that still carries an amount: an ingredient the reader probably dropped. */
function hasAmount(line: string): boolean {
    const s = normalizeFractions(line).replace(LIST_MARKER, '').trim();
    return /^\.?\d/.test(s) || AMOUNT_IN_TEXT.test(s);
}

/** Digits or leftover punctuation in a food name mean the line wasn't understood. */
function oddName(name: string): boolean {
    return /\d/.test(name) || /\.{2,}|…|[|=_]/.test(name);
}

export function assessBuiltinRead(read: DetailedRead, rows: ReadRow[], rule = BUILTIN_RULE): Verdict {
    const reasons = new Set<UnsureReason>();
    if (rows.length < rule.minIngredients) reasons.add('too_few_ingredients');
    if (read.skipped.some(hasAmount)) reasons.add('skipped_amounts');

    let noAmount = 0;
    for (const { ingredient: ing, matched, matchConfidence, grams } of rows) {
        if (oddName(ing.name)) reasons.add('odd_name');
        const explained = NO_AMOUNT_OK.test(ing.notes ?? '') || NO_AMOUNT_OK.test(ing.original ?? '');
        if (ing.quantity === null && !explained) noAmount++;
        if (!matched) reasons.add('no_match');
        else if (matchConfidence < rule.minMatchConfidence) reasons.add('weak_match');
        if (ing.quantity !== null && grams === null) reasons.add('no_grams');
        // "4 salmon fillets (6 oz each)": the weight is right there, but the amount used is a count.
        if (WEIGHT_IN_NOTES.test(ing.notes ?? '') && UNITS[ing.unit ?? '']?.kind !== 'mass') reasons.add('unused_weight');
        if (grams !== null && grams > rule.maxGramsPerRow) reasons.add('huge_amount');
    }
    if (rows.length && noAmount / rows.length > rule.maxNoAmountShare) reasons.add('no_amount');

    const list = Array.from(reasons);
    return { confident: list.length === 0, reasons: list };
}
