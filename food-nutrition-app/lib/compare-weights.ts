/**
 * Which weight each label in a comparison shows. Pure (safe for client components):
 * the arithmetic is lib/serving-scale.ts, the choices per food are servingOptions().
 *
 * One shared "Compare at" weight puts every food on the same grams; a label can still
 * pick its own serving, and the result says when the weights no longer agree.
 */
import type { Food } from './food-types';
import { servingOptions, type ServingOption } from './food-page';
import {
    FALLBACK_GRAMS, STANDARD_WEIGHTS, amountLabel, formatGrams, parseServingAmount, standardWeight, standardWeightAt,
    type MassUnit, type StandardWeightId,
} from './serving-scale';
import { shortFoodName } from '@/components/planner/nutrients';

/** The shared "Compare at" setting. */
export type CompareBasis =
    | { kind: 'standard'; id: StandardWeightId }
    | { kind: 'custom'; text: string; unit: MassUnit }
    /** Every food at this food's serving: the page's serving for the page's food, else its usual one. */
    | { kind: 'food'; foodId: number }
    /** Each food at its own usual serving (weights differ). */
    | { kind: 'usual' };

/** One label's own choice, overriding the shared weight. */
export type CardChoice = { kind: 'option'; id: string } | { kind: 'custom'; text: string; unit: MassUnit };

/** The serving the food page is showing, when Compare opens from a food page. */
export interface Anchor { foodId: number; grams: number; label: string }

export interface ComparedServing {
    foodId: number;
    grams: number;
    /** Shown as the label's serving size: "3 oz (85.05 g)". */
    label: string;
    /** False when this label has its own serving instead of the shared one. */
    followsBasis: boolean;
    /** Set when this label's custom amount is out of range (it shows 100 g meanwhile). */
    error: string | null;
}

export interface Comparison {
    servings: ComparedServing[];
    /** Every label is on the same number of grams. */
    sameWeight: boolean;
    /** The shared weight, as a label; null when each food is at its usual serving. */
    basisLabel: string | null;
    /** The shared custom amount is out of range: everything shows 100 g meanwhile. */
    error: string | null;
}

const EPSILON_G = 1e-9;
const equalGrams = (a: number, b: number) => Math.abs(a - b) <= EPSILON_G;

/** A food's usual serving: the page's serving for the page's food, otherwise its default option. */
function usualServing(food: Food, anchor?: Anchor): { grams: number; label: string } {
    if (anchor && anchor.foodId === food.id) return { grams: anchor.grams, label: anchor.label };
    const { options, defaultId } = servingOptions(food);
    const o = options.find(x => x.id === defaultId) ?? options[0];
    return { grams: o.grams, label: o.label };
}

/** The shared weight in grams (null for 'usual'), its label, and any error. */
function resolveBasis(basis: CompareBasis, foods: Food[], anchor?: Anchor):
    { grams: number; label: string; sourceId?: number; sourceLabel?: string; error: string | null } | null {
    switch (basis.kind) {
        case 'usual':
            return null;
        case 'standard': {
            const w = standardWeight(basis.id);
            return { grams: w.grams, label: labelForGrams(w.grams), error: null };
        }
        case 'custom': {
            const parsed = parseServingAmount(basis.text, basis.unit);
            if (!parsed.ok) return { grams: FALLBACK_GRAMS, label: labelForGrams(FALLBACK_GRAMS), error: parsed.message };
            return { grams: parsed.grams, label: amountLabel(parsed.grams, basis.unit), error: null };
        }
        case 'food': {
            const food = foods.find(f => f.id === basis.foodId);
            if (!food) return { grams: FALLBACK_GRAMS, label: labelForGrams(FALLBACK_GRAMS), error: null };
            const s = usualServing(food, anchor);
            return { grams: s.grams, label: labelForGrams(s.grams), sourceId: food.id, sourceLabel: s.label, error: null };
        }
    }
}

/** "3 oz (85.05 g)" at a standard weight, else "151 g". */
function labelForGrams(grams: number): string {
    const w = standardWeightAt(grams);
    if (w) return w.unit === 'oz' ? `${w.label} (${formatGrams(w.grams)} g)` : w.label;
    return `${formatGrams(grams)} g`;
}

function resolveCard(food: Food, choice: CardChoice): { grams: number; label: string; error: string | null } | null {
    if (choice.kind === 'custom') {
        const parsed = parseServingAmount(choice.text, choice.unit);
        if (!parsed.ok) return { grams: FALLBACK_GRAMS, label: labelForGrams(FALLBACK_GRAMS), error: parsed.message };
        return { grams: parsed.grams, label: amountLabel(parsed.grams, choice.unit), error: null };
    }
    const o = servingOptions(food).options.find(x => x.id === choice.id);
    return o ? { grams: o.grams, label: o.label, error: null } : null;
}

/** The serving of every label, and whether they all weigh the same. */
export function compareServings(foods: Food[], basis: CompareBasis, overrides: Readonly<Record<number, CardChoice>>, anchor?: Anchor): Comparison {
    const shared = resolveBasis(basis, foods, anchor);
    const servings = foods.map((food): ComparedServing => {
        const own = overrides[food.id] ? resolveCard(food, overrides[food.id]) : null;
        if (own) return { foodId: food.id, ...own, followsBasis: false };
        if (!shared) return { foodId: food.id, ...usualServing(food, anchor), followsBasis: true, error: null };
        const label = shared.sourceId === food.id && shared.sourceLabel ? shared.sourceLabel : shared.label;
        return { foodId: food.id, grams: shared.grams, label, followsBasis: true, error: null };
    });
    return {
        servings,
        sameWeight: servings.every(s => equalGrams(s.grams, servings[0].grams)),
        basisLabel: shared ? shared.label : null,
        error: shared?.error ?? null,
    };
}

// ---------------------------------------------------------------------------
// The "Compare at" menu
// ---------------------------------------------------------------------------

export interface BasisChoice { value: string; label: string; group: 'weight' | 'food' | 'other' }

/**
 * 1 oz, 3 oz and 100 g; each food's serving when it is a weight not already listed
 * ("Broccoli (this page): 1 cup, chopped (91 g)"); each food's usual serving; custom.
 */
export function basisChoices(foods: Food[], anchor?: Anchor): BasisChoice[] {
    const out: BasisChoice[] = STANDARD_WEIGHTS.map(w => ({ value: `standard:${w.id}`, label: labelForGrams(w.grams), group: 'weight' as const }));
    const listed: number[] = STANDARD_WEIGHTS.map(w => w.grams);
    for (const food of foods) {
        const s = usualServing(food, anchor);
        if (listed.some(g => equalGrams(g, s.grams))) continue;
        listed.push(s.grams);
        const name = shortFoodName(food.description);
        out.push({ value: `food:${food.id}`, label: `${name}${anchor?.foodId === food.id ? ' (this page)' : ''}: ${s.label}`, group: 'food' });
    }
    if (foods.length > 1) out.push({ value: 'usual', label: 'Each food’s usual serving', group: 'other' });
    out.push({ value: 'custom', label: 'Custom amount…', group: 'other' });
    return out;
}

/** The menu value for a basis. */
export function choiceOfBasis(basis: CompareBasis): string {
    switch (basis.kind) {
        case 'standard': return `standard:${basis.id}`;
        case 'food': return `food:${basis.foodId}`;
        case 'usual': return 'usual';
        case 'custom': return 'custom';
    }
}

/** The basis for a menu value; `custom` carries the amount being typed. */
export function basisFromChoice(value: string, custom: { text: string; unit: MassUnit }): CompareBasis {
    if (value.startsWith('standard:')) {
        const id = value.slice('standard:'.length) as StandardWeightId;
        if (STANDARD_WEIGHTS.some(w => w.id === id)) return { kind: 'standard', id };
    }
    if (value.startsWith('food:')) {
        const foodId = Number(value.slice('food:'.length));
        if (Number.isFinite(foodId)) return { kind: 'food', foodId };
    }
    if (value === 'usual') return { kind: 'usual' };
    if (value === 'custom') return { kind: 'custom', text: custom.text, unit: custom.unit };
    return { kind: 'standard', id: 'w-100g' };
}

/**
 * Where a comparison starts. From a food page: every food at the weight the page is
 * showing, so the page's own label doesn't jump. In the planner: 100 g, the weight
 * USDA measures every food at.
 */
export function initialBasis(anchor?: Anchor): CompareBasis {
    if (!anchor) return { kind: 'standard', id: 'w-100g' };
    const w = standardWeightAt(anchor.grams);
    return w ? { kind: 'standard', id: w.id } : { kind: 'food', foodId: anchor.foodId };
}

/**
 * The option a label's menu shows while it follows the shared weight: the food's own
 * option at exactly those grams, or null when it has none (the menu then shows the
 * shared weight as its own entry).
 */
export function optionAtGrams(options: readonly ServingOption[], grams: number): ServingOption | null {
    return options.find(o => equalGrams(o.grams, grams)) ?? null;
}

// ---------------------------------------------------------------------------
// Raw vs cooked
// ---------------------------------------------------------------------------

const COOKED = /\b(cooked|baked|roasted|fried|grilled|broiled|steamed|boiled|braised|stewed|poached|sauteed|sautéed|microwaved|dry heat|moist heat|toasted|canned)\b/i;
const RAW = /\b(raw|uncooked)\b/i;

/** 'raw', 'cooked' or null (unstated), from a USDA description. */
export function preparationState(description: string): 'raw' | 'cooked' | null {
    if (RAW.test(description)) return 'raw';
    if (COOKED.test(description)) return 'cooked';
    return null;
}

/** A short note when raw and cooked foods are compared by weight; null otherwise. */
export function preparationHint(descriptions: readonly string[]): string | null {
    const states = new Set(descriptions.map(preparationState));
    if (!states.has('raw') || !states.has('cooked')) return null;
    return 'You’re comparing raw and cooked foods. Cooking removes water, so a gram of cooked food holds more of most nutrients than a gram of raw. Compare raw with raw, or cooked with cooked, for like-for-like.';
}
