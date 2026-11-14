/**
 * Model-provider abstraction for the recipe analyzer. Selected by AI_PROVIDER
 * (see lib/ai/index.ts). Providers only read text or images into a ParsedRecipe;
 * nutrition always comes from the USDA database, never from a model.
 */
import type { ParsedRecipe } from '../recipes/types';
import type { Reranker } from '../recipes/analyze';

export type ProviderName = 'bedrock' | 'anthropic' | 'mock';

export type RecipeInput =
    | { kind: 'text'; text: string }
    | { kind: 'image'; base64: string; mediaType: ImageMediaType };

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface AiUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}

export interface AiResult {
    recipe: ParsedRecipe;
    /** Null for the mock provider. */
    usage: AiUsage | null;
    /** The model that produced this read, when a router chose among several (lib/ai/router.ts). */
    model?: string | null;
}

export interface AiProvider {
    name: ProviderName;
    /** Model id as sent to the provider; null for the mock provider. */
    model: string | null;
    readRecipe(input: RecipeInput, options?: { signal?: AbortSignal }): Promise<AiResult>;
    /** Optional LLM re-rank of low-confidence matches. Absent when the provider can't (mock) or AI_RERANK is off. */
    rerank?: Reranker;
}

export type AiErrorCode =
    | 'ai_timeout'
    | 'ai_rate_limited'
    | 'ai_refused'
    | 'ai_bad_output'
    | 'ai_unavailable'
    | 'ai_not_food';

const HTTP_STATUS: Record<AiErrorCode, number> = {
    ai_timeout: 504,
    ai_rate_limited: 503,
    ai_refused: 422,
    ai_bad_output: 502,
    ai_unavailable: 503,
    ai_not_food: 422,
};

/**
 * Why a model can't be used right now, which decides whether another model may
 * take over (lib/ai/router.ts):
 *   access    the account or role can't use it: access denied, model or profile not found
 *   capacity  quota or throttling, or the service is down
 */
export type Unavailability = 'access' | 'capacity';

/** A provider failure with a message that is safe to show to the user. */
export class AiError extends Error {
    code: AiErrorCode;
    status: number;
    /** Set when the model itself is unavailable, so a fallback model may be tried. */
    unavailable: Unavailability | null;
    constructor(code: AiErrorCode, message: string, unavailable: Unavailability | null = null) {
        super(message);
        this.name = 'AiError';
        this.code = code;
        this.status = HTTP_STATUS[code];
        this.unavailable = unavailable;
    }
}

/**
 * The model replied, but not with a usable recipe (no tool call, or a reply that
 * fails validation). A stronger model may do better (lib/ai/router.ts).
 */
export class InvalidReplyError extends AiError {
    constructor(message: string) {
        super('ai_bad_output', message);
        this.name = 'InvalidReplyError';
    }
}
