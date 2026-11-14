/**
 * Per-request cost estimate for logs and the spend guard.
 *
 * Prices are Anthropic list prices (USD per million tokens, checked 2026-11-04;
 * see docs/research/RECIPE_ANALYSIS.md). On Bedrock, global inference profiles
 * ("global.") bill at these prices, and everything else (a "us." profile or the
 * in-region Mantle endpoint) at 10% more, per the models' AWS Marketplace offers
 * read on 2026-11-13 (docs/BEDROCK_SETUP.md). AWS billing is the source of truth.
 */
import type { AiUsage } from './types';

interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }

const PRICES: Record<string, Price> = {
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Priced as the most expensive listed tier when a model isn't in the table, so an unknown model can't look free. */
const UNKNOWN_MODEL: Price = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 };

/** Bedrock's premium over global pricing for regional and geographic (e.g. US-only) routing. */
const BEDROCK_REGIONAL_PREMIUM = 1.1;

/** Drop an inference-profile ARN's path: "arn:...:inference-profile/us.anthropic.x" -> "us.anthropic.x". */
function bedrockId(model: string): string {
    return model.startsWith('arn:') ? model.slice(model.lastIndexOf('/') + 1) : model;
}

/** "us.anthropic.claude-opus-5-5" -> "claude-opus-5-5" */
export function baseModelId(model: string): string {
    return bedrockId(model).replace(/^(?:[a-z]{2,6}(?:-[a-z]+)?\.)?anthropic\./, '');
}

export function estimateCostUsd(model: string | null, usage: AiUsage | null): number {
    if (!model || !usage) return 0;
    const p = PRICES[baseModelId(model)] ?? UNKNOWN_MODEL;
    const id = bedrockId(model);
    const premium = id.includes('anthropic.') && !id.startsWith('global.') ? BEDROCK_REGIONAL_PREMIUM : 1;
    return premium * (
        usage.inputTokens * p.input +
        usage.outputTokens * p.output +
        (usage.cacheReadTokens ?? 0) * p.cacheRead +
        (usage.cacheWriteTokens ?? 0) * p.cacheWrite
    ) / 1_000_000;
}

/** One log line per model call. Counts and identifiers only: never recipe text, images or IP addresses. */
export function logAiCall(fields: {
    provider: string;
    model: string | null;
    kind: string;
    ms: number;
    ok: boolean;
    usage?: AiUsage | null;
    error?: string;
}): void {
    const { provider, model, kind, ms, ok, usage, error } = fields;
    const parts = [
        `provider=${provider}`, `model=${model ?? '-'}`, `kind=${kind}`, `ms=${Math.round(ms)}`, `ok=${ok}`,
        `in=${usage?.inputTokens ?? 0}`, `out=${usage?.outputTokens ?? 0}`,
        `cost_usd=${estimateCostUsd(model, usage ?? null).toFixed(5)}`,
    ];
    if (error) parts.push(`error=${error}`);
    console.info(`[ai] ${parts.join(' ')}`);
}
