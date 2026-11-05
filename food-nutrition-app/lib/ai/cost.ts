/**
 * Per-request cost estimate for logs and the spend guard.
 *
 * Prices are Anthropic list prices (USD per million tokens, checked 2026-11-04;
 * see docs/research/RECIPE_ANALYSIS.md). Amazon Bedrock prices are set by AWS and
 * were not verified, so on Bedrock treat these as an estimate; its regional
 * endpoints carry a 10% premium. AWS billing is the source of truth.
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

/** "us.anthropic.claude-opus-5-5" -> "claude-opus-5-5" */
export function baseModelId(model: string): string {
    return model.replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '');
}

export function estimateCostUsd(model: string | null, usage: AiUsage | null): number {
    if (!model || !usage) return 0;
    const p = PRICES[baseModelId(model)] ?? UNKNOWN_MODEL;
    return (
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
