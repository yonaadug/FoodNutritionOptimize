/**
 * Offline evaluation of the "built-in reader first" rule (lib/recipes/confidence.ts).
 * No AI calls: every fixture recipe is read by the built-in reader and matcher,
 * the rule decides whether it would skip AI, and the reader's accuracy is scored
 * separately for the recipes it keeps and the ones it would send to AI.
 *
 * The tuning and held-out sets are lists of lines, so they are pasted here in a
 * few common layouts. lib/recipes/fixtures-pasted.ts adds whole pasted recipes.
 */
import type { openDatabase } from '../db';
import { readTextBuiltin } from './builtin';
import { BUILTIN_RULE, type Verdict } from './confidence';
import { convertToGrams } from './grams';
import { computeRecipeNutrition } from './nutrition';
import type { FixtureRecipe } from './fixtures';
import type { PastedRecipe } from './fixtures-pasted';

type Connection = ReturnType<typeof openDatabase>;

/** Paste a line-list fixture in one of three layouts: headed with steps, bare with a title, or bulleted. */
export function asPasted(recipe: FixtureRecipe, layout: number): PastedRecipe {
    const lines = recipe.lines.map(l => l.line);
    let text: string;
    if (layout % 3 === 0) {
        text = `${recipe.title}\nServes ${recipe.servings}\n\nIngredients\n${lines.join('\n')}\n\nInstructions\n1. Prepare the ingredients.\n2. Combine and cook as usual.`;
    } else if (layout % 3 === 1) {
        text = `${recipe.title}\n${lines.join('\n')}`;
    } else {
        text = `${recipe.title} (serves ${recipe.servings})\n\nYou'll need:\n${lines.map(l => `• ${l}`).join('\n')}`;
    }
    return {
        title: recipe.title,
        servings: recipe.servings,
        kcalPerServing: recipe.kcalPerServing,
        messy: false,
        text,
        expect: recipe.lines.map(l => ({ name: l.name, food: l.food, grams: l.grams })),
    };
}

export interface RecipeScore {
    title: string;
    verdict: Verdict;
    lines: number;
    foodHits: number;
    gramHits: number;
    kcal: number;
    kcalOk: boolean;
    misses: string[];
}

/** Read one pasted recipe with the built-in reader and score it against its labels. */
export function scorePasted(conn: Connection, recipe: PastedRecipe, rule = BUILTIN_RULE): RecipeScore {
    // The same code path /api/recipes/parse runs before deciding whether to call AI.
    const { read, matches, verdict } = readTextBuiltin(conn, recipe.text, rule);
    const analyzed = read.recipe.ingredients.map((ing, i) => ({ ing, food: matches[i].food, conversion: convertToGrams(ing, matches[i].food) }));

    // Line each expectation up with the first unused ingredient whose name fits it.
    const used = new Set<number>();
    let foodHits = 0;
    let gramHits = 0;
    const misses: string[] = [];
    for (const e of recipe.expect) {
        const i = analyzed.findIndex((a, j) => !used.has(j) && e.name.test(a.ing.name));
        if (i < 0) {
            misses.push(`MISSING ${e.name}`);
            continue;
        }
        used.add(i);
        const a = analyzed[i];
        const desc = a.food?.description ?? '(none)';
        if (e.food.test(desc)) foodHits++;
        else misses.push(`FOOD "${a.ing.original}" -> ${desc}`);
        const g = a.conversion.grams;
        if (e.grams === null ? g === null : g !== null && g >= e.grams[0] && g <= e.grams[1]) gramHits++;
        else misses.push(`GRAMS "${a.ing.original}" -> ${g} want ${JSON.stringify(e.grams)}`);
    }
    const items = analyzed.map(a => ({ name: a.ing.name, food: a.food, grams: a.conversion.grams }));
    const kcal = computeRecipeNutrition(items, recipe.servings).perServing.calories.value ?? 0;
    const kcalOk = kcal >= recipe.kcalPerServing[0] && kcal <= recipe.kcalPerServing[1];
    if (!kcalOk) misses.push(`KCAL ${Math.round(kcal)} want ${recipe.kcalPerServing.join('-')}`);
    return { title: recipe.title, verdict, lines: recipe.expect.length, foodHits, gramHits, kcal, kcalOk, misses };
}

export interface GroupStats {
    recipes: number;
    lines: number;
    /** Percentages, 0..100. Null for an empty group. */
    foodPct: number | null;
    gramPct: number | null;
    kcalOk: number;
}

function stats(scores: RecipeScore[]): GroupStats {
    const lines = scores.reduce((s, r) => s + r.lines, 0);
    const pct = (n: number) => (lines ? (n / lines) * 100 : null);
    return {
        recipes: scores.length,
        lines,
        foodPct: pct(scores.reduce((s, r) => s + r.foodHits, 0)),
        gramPct: pct(scores.reduce((s, r) => s + r.gramHits, 0)),
        kcalOk: scores.filter(r => r.kcalOk).length,
    };
}

export interface RoutingEvaluation {
    scores: RecipeScore[];
    all: GroupStats;
    /** Recipes the rule keeps on the built-in reader (no AI). */
    builtin: GroupStats;
    /** Recipes the rule sends to AI, scored as if the built-in read had been kept. */
    toAi: GroupStats;
}

export function evaluateRouting(conn: Connection, recipes: PastedRecipe[], rule = BUILTIN_RULE): RoutingEvaluation {
    const scores = recipes.map(r => scorePasted(conn, r, rule));
    return {
        scores,
        all: stats(scores),
        builtin: stats(scores.filter(s => s.verdict.confident)),
        toAi: stats(scores.filter(s => !s.verdict.confident)),
    };
}

export function formatStats(label: string, s: GroupStats): string {
    const p = (v: number | null) => (v === null ? '-' : `${v.toFixed(1)}%`);
    return `${label}: ${s.recipes} recipes, ${s.lines} lines: food top-1 ${p(s.foodPct)}, grams in range ${p(s.gramPct)}, calories in range ${s.kcalOk}/${s.recipes}`;
}
