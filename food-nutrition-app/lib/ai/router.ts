/**
 * Chooses which model reads a recipe. Three tiers, each optional, and none tied
 * to a model family (lib/ai/index.ts picks the models):
 *
 *   primary     Gemma 3 27B by default. Reads photos, and pasted text the built-in
 *               reader is unsure of (lib/recipes/confidence.ts decides that before AI is called).
 *   escalation  Off by default (Claude Sonnet 5.5 when set). Only for photos of plated
 *               food (the primary read says plated_meal), or when the primary's reply
 *               fails validation.
 *   fallback    Nova Lite v1 by default. When the primary (or escalation) model is
 *               unavailable: access denied, model not found, quota, throttling, an
 *               outage (AiError.unavailable) or a timeout. Also gets one try when the
 *               primary's reply fails validation and no escalation model is on.
 *
 * After a model is unavailable it is skipped for a while (per server instance),
 * then tried again, so it takes over by itself once AWS fixes it. A timeout falls
 * back for that read only: one slow read doesn't send the next ones elsewhere.
 *
 * Time: each tier's call has its own limit (retries included), and the whole read
 * has a deadline, so a primary call plus a fallback fits inside the web Lambda's
 * 28 s (lib/ai/index.ts readTimeouts). A tier that would start with too little
 * time left is skipped.
 *
 * Every read, whichever model made it, goes through the same validator, and the
 * user checks every ingredient.
 */
import type { Reranker } from '../recipes/analyze';
import { AiError, InvalidReplyError, type AiProvider, type AiResult, type RecipeInput, type Unavailability } from './types';

/** How long to skip a model the account can't use. Long enough to save the round trip, short enough to notice a fix. */
export const ACCESS_COOLDOWN_MS = 10 * 60_000;
/** How long to skip a throttled or failing model. */
export const CAPACITY_COOLDOWN_MS = 60_000;
/** A tier isn't started with less time than this left before the deadline. */
export const MIN_ATTEMPT_MS = 2_000;

type Tier = 'primary' | 'escalation' | 'fallback';

export interface RouterOptions {
    primary: AiProvider | null;
    escalation: AiProvider | null;
    fallback: AiProvider | null;
    now?: () => number;
    /** The most each tier's call may take, in ms, retries included. Unset: no limit of its own. */
    timeouts?: Partial<Record<Tier, number>>;
    /** The most a whole read may take, every tier included, in ms. Unset: no limit. */
    deadlineMs?: number;
    /** Don't start a tier with less than this left (default MIN_ATTEMPT_MS). */
    minAttemptMs?: number;
}

type Attempt = { ok: true; result: AiResult } | { ok: false; error: unknown };

function unavailability(e: unknown): Unavailability | null {
    return e instanceof AiError ? e.unavailable : null;
}

const timedOut = (e: unknown) => e instanceof AiError && e.code === 'ai_timeout';
const tooLong = () => new AiError('ai_timeout', 'Reading took too long. Please try again, or paste only the ingredients.');

export function createRoutedProvider({
    primary, escalation, fallback, now = Date.now, timeouts = {}, deadlineMs = Infinity, minAttemptMs = MIN_ATTEMPT_MS,
}: RouterOptions): AiProvider {
    const lead = primary ?? fallback ?? escalation;
    if (!lead) throw new Error('createRoutedProvider needs at least one model');
    const coolingUntil = new Map<AiProvider, number>();

    const cooling = (p: AiProvider) => (coolingUntil.get(p) ?? 0) > now();

    async function readRecipe(input: RecipeInput, options: { signal?: AbortSignal } = {}): Promise<AiResult> {
        const { signal } = options;
        const deadline = now() + deadlineMs;

        /** Whether another model may take over after this failure. Never once the caller has given up. */
        const mayFallBack = (e: unknown) => !signal?.aborted && (unavailability(e) !== null || timedOut(e));

        /** One call, inside its tier's limit and the read's deadline. Null means "not tried": too little time left. */
        async function attempt(p: AiProvider, tier: Tier): Promise<Attempt | null> {
            const left = deadline - now();
            if (left < minAttemptMs) {
                console.warn(`[ai] skipping ${p.model}: ${Math.max(0, Math.round(left))} ms left of the read's deadline`);
                return null;
            }
            const limit = Math.min(timeouts[tier] ?? Infinity, left);
            const signals = [signal, Number.isFinite(limit) ? AbortSignal.timeout(limit) : null].filter((s): s is AbortSignal => !!s);
            try {
                const result = await p.readRecipe(input, signals.length ? { signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] } : {});
                coolingUntil.delete(p);
                return { ok: true, result: { ...result, model: result.model ?? p.model } };
            } catch (error) {
                const why = unavailability(error);
                const next = fallback && p !== fallback ? `, using ${fallback.model}` : '';
                if (why) {
                    const ms = why === 'access' ? ACCESS_COOLDOWN_MS : CAPACITY_COOLDOWN_MS;
                    coolingUntil.set(p, now() + ms);
                    console.warn(`[ai] ${p.model} is unavailable (${why}); skipping it for ${Math.round(ms / 1000)} s${next}`);
                } else if (timedOut(error) && !signal?.aborted) {
                    console.warn(`[ai] ${p.model} timed out${Number.isFinite(limit) ? ` (limit ${Math.round(limit)} ms)` : ''}${next}`);
                }
                return { ok: false, error };
            }
        }

        /** The escalation model, if it's on and not cooling down. Null means "not tried". */
        async function escalate(): Promise<Attempt | null> {
            if (!escalation || cooling(escalation)) return null;
            return attempt(escalation, 'escalation');
        }

        let failure: unknown = null;

        // A model that's cooling down is skipped only when there's something else to use.
        if (primary && !(fallback && cooling(primary))) {
            const first = (await attempt(primary, 'primary')) ?? { ok: false as const, error: tooLong() };
            if (first.ok) {
                const { recipe } = first.result;
                if (input.kind === 'image' && recipe.platedMeal) {
                    // Plated food is the hard case: re-read with the stronger model, keeping the first read if that fails.
                    const better = await escalate();
                    if (better?.ok && better.result.recipe.ingredients.length > 0) return better.result;
                    return first.result;
                }
                if (recipe.ingredients.length > 0) return first.result;
                // No ingredients: the stronger model gets a try; otherwise the caller says "not a recipe".
                const better = await escalate();
                return better?.ok ? better.result : first.result;
            }
            failure = first.error;

            if (failure instanceof InvalidReplyError) {
                // A reply that fails validation: the escalation model if it's on, else one try with the fallback.
                const better = await escalate();
                if (better?.ok) return better.result;
                // The escalation model unavailable too: the fallback may still help. Any other failure stands.
                if (better && !mayFallBack(better.error)) throw better.error;
                if (!fallback) throw failure;
            } else if (!mayFallBack(failure) || !fallback) {
                throw failure;
            }
        }

        if (fallback) {
            const last = await attempt(fallback, 'fallback');
            if (last?.ok) return last.result;
            throw last ? last.error : failure ?? tooLong();
        }
        // Only the escalation model is on.
        if (escalation) {
            const only = await attempt(escalation, 'escalation');
            if (only?.ok) return only.result;
            throw only ? only.error : failure ?? tooLong();
        }
        throw failure ?? new AiError('ai_unavailable', 'The recipe reader isn\'t available right now. You can add the ingredients by hand.');
    }

    const rerankWith = primary?.rerank;
    const rerank: Reranker | undefined = rerankWith && primary
        ? async items => (cooling(primary) ? new Map() : rerankWith(items))
        : undefined;

    return { name: lead.name, model: lead.model, readRecipe, ...(rerank ? { rerank } : {}) };
}
