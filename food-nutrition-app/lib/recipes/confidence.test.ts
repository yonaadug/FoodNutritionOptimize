import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../db';
import { analyzeRecipeIn } from './analyze';
import { readTextBuiltin } from './builtin';
import { parseRecipeTextDetailed } from './parse';
import { assessBuiltinRead, BUILTIN_RULE, type ReadRow } from './confidence';
import { FIXTURE_RECIPES } from './fixtures';
import { HOLDOUT_RECIPES } from './fixtures-holdout';
import { PASTED_RECIPES } from './fixtures-pasted';
import { asPasted, evaluateRouting, formatStats } from './reader-eval';

/** Rows for a parsed text, with every food matched well unless overridden. */
function rowsFor(text: string, override: Partial<ReadRow>[] = []) {
    const read = parseRecipeTextDetailed(text);
    const rows: ReadRow[] = read.recipe.ingredients.map((ingredient, i) => ({
        ingredient,
        matched: true,
        matchConfidence: 0.9,
        grams: ingredient.quantity === null ? null : 100,
        ...override[i],
    }));
    return { read, rows };
}

const CLEAN = `Garlic rice
Serves 2
Ingredients
1 1/2 cups cooked white rice
2 cloves garlic, minced
1 tbsp olive oil
Salt to taste
Instructions
Fry the garlic in the oil, then add the rice.`;

describe('assessBuiltinRead: when pasted text can skip AI', () => {
    it('trusts a clean list with amounts and good matches', () => {
        const { read, rows } = rowsFor(CLEAN);
        const v = assessBuiltinRead(read, rows);
        assert.equal(v.confident, true, v.reasons.join(', '));
        assert.deepEqual(v.reasons, []);
    });

    it('lets "to taste", "optional" and "for garnish" lines go without an amount', () => {
        const { read, rows } = rowsFor('2 eggs\n1 cup milk\nSalt to taste\nChives, for garnish\nHot sauce (optional)');
        assert.equal(assessBuiltinRead(read, rows).confident, true);
    });

    it('sends prose to AI: no ingredient lines found', () => {
        const { read, rows } = rowsFor('For this you will want two chicken breasts, a cup of rice and some broccoli. Cook the rice and fry the chicken.');
        const v = assessBuiltinRead(read, rows);
        assert.equal(v.confident, false);
        assert.ok(v.reasons.includes('too_few_ingredients'), v.reasons.join(', '));
    });

    it('sends a single line to AI', () => {
        const { read, rows } = rowsFor('2 cups flour');
        assert.equal(assessBuiltinRead(read, rows).confident, false);
    });

    it('sends weak food matches to AI', () => {
        const { read, rows } = rowsFor(CLEAN, [{}, { matchConfidence: BUILTIN_RULE.minMatchConfidence - 0.01 }]);
        const v = assessBuiltinRead(read, rows);
        assert.equal(v.confident, false);
        assert.ok(v.reasons.includes('weak_match'));
    });

    it('sends unmatched foods to AI', () => {
        const { read, rows } = rowsFor(CLEAN, [{ matched: false, matchConfidence: 0 }]);
        assert.ok(assessBuiltinRead(read, rows).reasons.includes('no_match'));
    });

    it('sends lines with amounts but no grams to AI', () => {
        const { read, rows } = rowsFor(CLEAN, [{ grams: null }]);
        assert.ok(assessBuiltinRead(read, rows).reasons.includes('no_grams'));
    });

    it('sends lists where many lines have no amount to AI', () => {
        const { read, rows } = rowsFor('flour\nsugar\nbutter\n2 eggs');
        const v = assessBuiltinRead(read, rows);
        assert.equal(v.confident, false);
        assert.ok(v.reasons.includes('no_amount'), v.reasons.join(', '));
    });

    it('sends names with leftover digits to AI ("Flour 225 g", "fl0ur")', () => {
        const a = rowsFor('Flour 225 g\nSugar 225 g\nButter 225 g');
        assert.ok(assessBuiltinRead(a.read, a.rows).reasons.includes('odd_name'));
        const b = rowsFor('1 cup fl0ur\n1 cup mi1k\n2 eggs');
        assert.ok(assessBuiltinRead(b.read, b.rows).reasons.includes('odd_name'));
    });

    it('sends text with amounts it skipped to AI', () => {
        const { read, rows } = rowsFor('Ingredients\n2 cups flour\n1 tsp salt\nMix 1 cup of water with 2 tbsp oil and knead well for ten minutes until smooth.');
        const v = assessBuiltinRead(read, rows);
        assert.equal(v.confident, false);
        assert.ok(v.reasons.includes('skipped_amounts'), v.reasons.join(', '));
    });

    it('ignores skipped instruction lines without amounts', () => {
        const { read, rows } = rowsFor('Lemon pasta\n8 oz spaghetti\n2 tbsp butter\n1 lemon\nBoil the pasta in salted water until al dente.\nToss everything together with the lemon and serve hot.');
        assert.equal(assessBuiltinRead(read, rows).confident, true, assessBuiltinRead(read, rows).reasons.join(', '));
    });

    it('sends implausibly large amounts to AI (a temperature read as grams)', () => {
        const { read, rows } = rowsFor(CLEAN, [{ grams: BUILTIN_RULE.maxGramsPerRow + 1 }]);
        assert.ok(assessBuiltinRead(read, rows).reasons.includes('huge_amount'));
    });

    it('sends a weight it read but did not use to AI ("4 salmon fillets (6 oz each)")', () => {
        const { read, rows } = rowsFor('4 salmon fillets (6 oz each)\n2 tbsp olive oil');
        const v = assessBuiltinRead(read, rows);
        assert.equal(v.confident, false);
        assert.ok(v.reasons.includes('unused_weight'), v.reasons.join(', '));
        // A can size the parser already used is fine.
        const can = rowsFor('1 (14.5 oz) can diced tomatoes\n1 cup (125 g) flour');
        assert.equal(assessBuiltinRead(can.read, can.rows).confident, true, assessBuiltinRead(can.read, can.rows).reasons.join(', '));
    });

    it('lists every reason, so the log says why', () => {
        const { read, rows } = rowsFor(CLEAN, [{ matched: false, matchConfidence: 0 }, { grams: null }]);
        const v = assessBuiltinRead(read, rows);
        assert.ok(v.reasons.includes('no_match') && v.reasons.includes('no_grams'));
    });
});

const DB_PATH = path.join(import.meta.dirname, '..', '..', 'nutrition.db');
const hasDb = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 1_000_000;

describe('built-in reader first: offline evaluation, no AI calls', { skip: !hasDb && 'nutrition.db not available' }, () => {
    const conn = hasDb ? openDatabase(DB_PATH) : null!;
    const recipes = [
        ...FIXTURE_RECIPES.map((r, i) => asPasted(r, i)),
        ...HOLDOUT_RECIPES.map((r, i) => asPasted(r, i)),
        ...PASTED_RECIPES,
    ];

    it('readTextBuiltin returns matches analyzeRecipeIn can reuse', async () => {
        const b = readTextBuiltin(conn, CLEAN);
        assert.equal(b.verdict.confident, true, b.verdict.reasons.join(', '));
        const r = await analyzeRecipeIn(conn, b.read.recipe, 'text', { provider: 'builtin', model: null }, b.matches);
        assert.equal(r.ingredients.length, 4);
        assert.equal(r.ingredients[0].food?.fdc_id, b.matches[0].food?.fdc_id);
    });

    it('keeps most recipes off AI, at the accuracy of a full read, and sends every messy one to AI', () => {
        const ev = evaluateRouting(conn, recipes);
        console.log(`[built-in first] ${recipes.length} pasted recipes; ${ev.builtin.recipes} (${((ev.builtin.recipes / recipes.length) * 100).toFixed(0)}%) skip AI`);
        console.log(`[built-in first] ${formatStats('kept on the built-in reader', ev.builtin)}`);
        console.log(`[built-in first] ${formatStats('sent to AI (built-in read, for comparison)', ev.toAi)}`);
        console.log(`[built-in first] ${formatStats('all, if nothing went to AI', ev.all)}`);
        const sent = ev.scores.filter(s => !s.verdict.confident).map(s => `${s.title} [${s.verdict.reasons.join(',')}]`);
        console.log(`[built-in first] to AI: ${sent.join('; ')}`);

        assert.ok(ev.builtin.recipes / recipes.length >= 0.5, 'at least half skip AI');
        assert.ok(ev.builtin.foodPct! >= 97, `food ${ev.builtin.foodPct}`);
        assert.ok(ev.builtin.gramPct! >= 95, `grams ${ev.builtin.gramPct}`);
        assert.equal(ev.builtin.kcalOk, ev.builtin.recipes, 'every kept recipe has calories in range');
        for (const r of PASTED_RECIPES.filter(p => p.messy)) {
            assert.equal(ev.scores.find(s => s.title === r.title)!.verdict.confident, false, `${r.title} should go to AI`);
        }
    });
});
