/**
 * Per-request cost estimate for logs and the spend guard.
 *
 * Claude: Anthropic list prices (USD per million tokens, checked 2026-11-04;
 * see docs/research/RECIPE_ANALYSIS.md). On Bedrock, global inference profiles
 * ("global.") bill at these prices, and everything else (a "us." profile or the
 * in-region Mantle endpoint) at 10% more, per the models' AWS Marketplace offers
 * read on 2026-11-13 (docs/BEDROCK_SETUP.md).
 *
 * Amazon Nova: the AWS Price List for Amazon Bedrock in us-east-1, publication
 * 2026-11-11T01:30:37Z, read 2026-11-14:
 *   https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/20261111013037/us-east-1/index.csv
 * Usage types USE1-Nova2.0Lite-{input,output}-tokens ($0.00033 / $0.00275 per 1K),
 * the same with -cross-region-global ($0.0003 / $0.0025), and
 * USE1-NovaLite-{input,output}-tokens ($0.00006 / $0.00024; no global SKU).
 * So Nova 2 Lite carries the same 10% premium off global as Claude, and Nova
 * Lite v1 has none. Cache writes are free for both.
 *
 * AWS billing is the source of truth.
 */
import type { AiUsage } from './types';

interface Price {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    /** These are global prices, and other routing (us., in-region) costs 10% more. */
    globalPremium: boolean;
}

const claude = (input: number, output: number, cacheRead: number, cacheWrite: number): Price => ({ input, output, cacheRead, cacheWrite, globalPremium: true });

const PRICES: Record<string, Price> = {
    'claude-opus-5-5': claude(4, 20, 0.2, 5),
    'claude-opus-5': claude(5, 25, 0.5, 6.25),
    'claude-sonnet-5-5': claude(2, 10, 0.2, 2.5),
    'claude-sonnet-5': claude(2, 10, 0.2, 2.5),
    'claude-haiku-5-5': claude(0.1, 0.5, 0.01, 0.125),
    'claude-haiku-4-5': claude(1, 5, 0.1, 1.25),
    'nova-2-lite-v1:0': { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0, globalPremium: true },
    'nova-lite-v1:0': { input: 0.06, output: 0.24, cacheRead: 0.015, cacheWrite: 0, globalPremium: false },
};

/** Priced as the most expensive listed tier when a model isn't in the table, so an unknown model can't look free. */
const UNKNOWN_MODEL: Price = claude(10, 50, 1, 12.5);

/** Bedrock's premium over global pricing for regional and geographic (e.g. US-only) routing. */
const BEDROCK_REGIONAL_PREMIUM = 1.1;

/** Drop an inference-profile ARN's path: "arn:...:inference-profile/us.anthropic.x" -> "us.anthropic.x". */
function bedrockId(model: string): string {
    return model.startsWith('arn:') ? model.slice(model.lastIndexOf('/') + 1) : model;
}

/** "us.anthropic.claude-opus-5-5" -> "claude-opus-5-5"; "us.amazon.nova-2-lite-v1:0" -> "nova-2-lite-v1:0" */
export function baseModelId(model: string): string {
    return bedrockId(model).replace(/^(?:[a-z]{2,6}(?:-[a-z]+)?\.)?(?:anthropic|amazon)\./, '');
}

export function estimateCostUsd(model: string | null, usage: AiUsage | null): number {
    if (!model || !usage) return 0;
    const p = PRICES[baseModelId(model)] ?? UNKNOWN_MODEL;
    const id = bedrockId(model);
    const onBedrock = id.includes('anthropic.') || id.includes('amazon.');
    const premium = p.globalPremium && onBedrock && !id.startsWith('global.') ? BEDROCK_REGIONAL_PREMIUM : 1;
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
