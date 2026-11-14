/**
 * The built-in reader for pasted text, run before any AI: parse, match each
 * ingredient to a USDA food, and decide whether that read can be trusted
 * (lib/recipes/confidence.ts). Server side (reads the database). Free.
 */
import type { openDatabase } from '../db';
import { convertToGrams } from './grams';
import { matchIngredientIn, type MatchResult } from './match';
import { parseRecipeTextDetailed, type DetailedRead } from './parse';
import { assessBuiltinRead, BUILTIN_RULE, type ReadRow, type Verdict } from './confidence';

type Connection = ReturnType<typeof openDatabase>;

export interface BuiltinRead {
    read: DetailedRead;
    /** One per ingredient, in order: pass these to analyzeRecipeIn to avoid matching twice. */
    matches: MatchResult[];
    rows: ReadRow[];
    verdict: Verdict;
}

export function readTextBuiltin(conn: Connection, text: string, rule = BUILTIN_RULE): BuiltinRead {
    const read = parseRecipeTextDetailed(text);
    const matches = read.recipe.ingredients.map(ing => matchIngredientIn(conn, ing));
    const rows: ReadRow[] = read.recipe.ingredients.map((ingredient, i) => ({
        ingredient,
        matched: matches[i].food !== null,
        matchConfidence: matches[i].confidence,
        grams: convertToGrams(ingredient, matches[i].food).grams,
    }));
    return { read, matches, rows, verdict: assessBuiltinRead(read, rows, rule) };
}
