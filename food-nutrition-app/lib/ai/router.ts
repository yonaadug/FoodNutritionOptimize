/**
 * Chooses which model reads a recipe. Three tiers, each optional:
 *
 *   primary     Claude Haiku 5.5. Reads photos, and pasted text the built-in reader
 *               is unsure of (lib/recipes/confidence.ts decides that before AI is called).
 *   escalation  Claude Sonnet 5.5. Only for photos of plated food (the primary read
 *               says plated_meal), or when the primary's reply fails validation.
 *   fallback    Amazon Nova Lite. Only when Claude is unavailable: access denied,
 *               model not found, quota, throttling or an outage (AiError.unavailable).
 *
 * After Claude is unavailable it is skipped for a while (per server instance),
 * then tried again, so Claude takes over by itself once AWS enables it.
 * Every read, whichever model made it, goes through the same validator, and the
 * user checks every ingredient.
 */
import type { Reranker } from '../recipes/analyze';
import { AiError, InvalidReplyError, type AiProvider, type AiResult, type RecipeInput, type Unavailability } from './types';

/** How long to skip a model the account can't use. Long enough to save the round trip, short enough to notice a fix. */
export const ACCESS_COOLDOWN_MS = 10 * 60_000;
/** How long to skip a throttled or failing model. */
export const CAPACITY_COOLDOWN_MS = 60_000;

export interface RouterOptions {
    primary: AiProvider | null;
    escalation: AiProvider | null;
    fallback: AiProvider | null;
    now?: () => number;
}

type Attempt = { ok: true; result: AiResult } | { ok: false; error: unknown };

function unavailability(e: unknown): Unavailability | null {
    return e instanceof AiError ? e.unavailable : null;
}

export function createRoutedProvider({ primary, escalation, fallback, now = Date.now }: RouterOptions): AiProvider {
    const lead = primary ?? fallback ?? escalation;
    if (!lead) throw new Error('createRoutedProvider needs at least one model');
    const coolingUntil = new Map<AiProvider, number>();

    const cooling = (p: AiProvider) => (coolingUntil.get(p) ?? 0) > now();

    async function attempt(p: AiProvider, input: RecipeInput, signal?: AbortSignal): Promise<Attempt> {
        try {
            const result = await p.readRecipe(input, { signal });
            coolingUntil.delete(p);
            return { ok: true, result: { ...result, model: result.model ?? p.model } };
        } catch (error) {
            const why = unavailability(error);
            if (why) {
                const ms = why === 'access' ? ACCESS_COOLDOWN_MS : CAPACITY_COOLDOWN_MS;
                coolingUntil.set(p, now() + ms);
                console.warn(`[ai] ${p.model} is unavailable (${why}); skipping it for ${Math.round(ms / 1000)} s${fallback && p !== fallback ? `, using ${fallback.model}` : ''}`);
            }
            return { ok: false, error };
        }
    }

    /** Sonnet, if it's on and not cooling down. Null means "not tried". */
    async function escalate(input: RecipeInput, signal?: AbortSignal): Promise<Attempt | null> {
        if (!escalation || cooling(escalation)) return null;
        return attempt(escalation, input, signal);
    }

    async function readRecipe(input: RecipeInput, options: { signal?: AbortSignal } = {}): Promise<AiResult> {
        const { signal } = options;
        let failure: unknown = null;

        // A model that's cooling down is skipped only when there's something else to use.
        if (primary && !(fallback && cooling(primary))) {
            const first = await attempt(primary, input, signal);
            if (first.ok) {
                const { recipe } = first.result;
                if (input.kind === 'image' && recipe.platedMeal) {
                    // Plated food is the hard case: re-read with the stronger model, keeping Haiku's read if that fails.
                    const better = await escalate(input, signal);
                    if (better?.ok && better.result.recipe.ingredients.length > 0) return better.result;
                    return first.result;
                }
                if (recipe.ingredients.length > 0) return first.result;
                failure = new InvalidReplyError('The reader didn\'t find any ingredients. Please try again.');
            } else {
                failure = first.error;
            }

            if (failure instanceof InvalidReplyError) {
                const better = await escalate(input, signal);
                if (better?.ok) return better.result;
                // Sonnet unavailable too: Nova may still help. Any other Sonnet failure stands.
                if (better && !unavailability(better.error)) throw better.error;
                if (!better || !fallback) throw failure;
            } else if (!unavailability(failure) || !fallback) {
                throw failure;
            }
        }

        if (fallback) {
            const last = await attempt(fallback, input, signal);
            if (last.ok) return last.result;
            throw last.error;
        }
        // Only the escalation model is on.
        if (escalation) {
            const only = await attempt(escalation, input, signal);
            if (only.ok) return only.result;
            throw only.error;
        }
        throw failure ?? new AiError('ai_unavailable', 'The recipe reader isn\'t available right now. You can add the ingredients by hand.');
    }

    const rerankWith = primary?.rerank;
    const rerank: Reranker | undefined = rerankWith && primary
        ? async items => (cooling(primary) ? new Map() : rerankWith(items))
        : undefined;

    return { name: lead.name, model: lead.model, readRecipe, ...(rerank ? { rerank } : {}) };
}
