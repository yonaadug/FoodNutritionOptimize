/**
 * Picks the AI provider from the environment.
 *
 *   AI_PROVIDER=mock       deterministic and offline (the default)
 *   AI_PROVIDER=bedrock    Claude on Amazon Bedrock (AWS credentials + region)
 *   AI_PROVIDER=anthropic  Claude API (ANTHROPIC_API_KEY)
 *
 * Using a paid provider is always an explicit choice: leaving AI_PROVIDER unset
 * never spends money, even if credentials happen to be in the environment. If a
 * paid provider is selected without its settings, the app falls back to mock and
 * says so in the log and in the API response.
 *
 * The SDKs are imported dynamically so mock mode never loads them.
 */
import { createClaudeProvider, type ClaudeMessage, type ClaudeRequest, type ClaudeSend } from './claude';
import { createMockProvider } from './mock';
import { recordSpend } from './rate-limit';
import { AiError, type AiProvider } from './types';

type Env = Record<string, string | undefined>;

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_TIMEOUT_MS = 45_000;
/** Retried by the SDK on connection errors, 408, 409, 429 and 5xx. */
export const DEFAULT_MAX_RETRIES = 2;

/** Models with a server-side refusal fallback on the Claude API. Haiku has none; Bedrock doesn't support it. */
const SERVER_FALLBACK = /^claude-(opus-5|fable-5|sonnet-5-5)/;

function intEnv(env: Env, key: string, fallback: number): number {
    const n = Number(env[key]);
    return env[key] !== undefined && env[key] !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** "claude-opus-5-5" -> "anthropic.claude-opus-5-5"; a full id or inference profile is kept as written. */
export function bedrockModelId(model: string): string {
    return model.includes('anthropic.') || model.startsWith('arn:') ? model : `anthropic.${model}`;
}

export interface ProviderChoice {
    provider: 'mock' | 'bedrock' | 'anthropic';
    model: string | null;
    region: string | null;
    /** Why a paid provider was not used, when one was asked for. */
    fallbackReason: string | null;
}

/** Pure decision, separated out for tests. */
export function chooseProvider(env: Env = process.env): ProviderChoice {
    const asked = (env.AI_PROVIDER ?? '').trim().toLowerCase();
    const mock = (fallbackReason: string | null): ProviderChoice => ({ provider: 'mock', model: null, region: null, fallbackReason });
    const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
    if (asked === '' || asked === 'mock') return mock(null);
    if (asked === 'bedrock') {
        const region = env.AI_BEDROCK_REGION?.trim() || env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || null;
        if (!region) return mock('AI_PROVIDER=bedrock needs AI_BEDROCK_REGION or AWS_REGION');
        return { provider: 'bedrock', model: bedrockModelId(model), region, fallbackReason: null };
    }
    if (asked === 'anthropic') {
        if (!env.ANTHROPIC_API_KEY?.trim()) return mock('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
        return { provider: 'anthropic', model, region: null, fallbackReason: null };
    }
    return mock(`Unknown AI_PROVIDER "${asked}"`);
}

/** Translate SDK errors into messages safe to show. SDK error text can echo request details, so it stays out. */
async function mapSdkError(e: unknown): Promise<AiError> {
    if (e instanceof AiError) return e;
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    if (e instanceof Anthropic.APIConnectionTimeoutError) {
        return new AiError('ai_timeout', 'Reading took too long. Please try again, or paste only the ingredients.');
    }
    if (e instanceof Anthropic.APIUserAbortError) {
        return new AiError('ai_timeout', 'Reading took too long. Please try again, or paste only the ingredients.');
    }
    if (e instanceof Anthropic.RateLimitError) {
        return new AiError('ai_rate_limited', 'The recipe reader is busy right now. Please try again in a minute.');
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.NotFoundError) {
        console.error(`[ai] provider configuration error: ${e.constructor.name} ${e.status}`);
        return new AiError('ai_unavailable', 'The recipe reader isn\'t available right now. You can add the ingredients by hand.');
    }
    if (e instanceof Anthropic.BadRequestError) {
        console.error(`[ai] request rejected: ${e.status}`);
        return new AiError('ai_bad_output', 'We couldn\'t read that. Try a smaller photo, or paste the recipe as text.');
    }
    if (e instanceof Anthropic.APIError) {
        console.error(`[ai] provider error: ${e.constructor.name} ${e.status ?? ''}`);
        return new AiError('ai_unavailable', 'The recipe reader isn\'t available right now. You can add the ingredients by hand.');
    }
    console.error(`[ai] unexpected error: ${(e as Error)?.name}`);
    return new AiError('ai_unavailable', 'The recipe reader isn\'t available right now. You can add the ingredients by hand.');
}

function clientOptions(env: Env) {
    return {
        timeout: intEnv(env, 'AI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
        maxRetries: intEnv(env, 'AI_MAX_RETRIES', DEFAULT_MAX_RETRIES),
    };
}

/** Send through the Claude API, with the server-side refusal fallback where the model has one. */
function anthropicSend(env: Env, model: string): ClaudeSend {
    let client: Promise<import('@anthropic-ai/sdk').default> | null = null;
    const getClient = () => (client ??= import('@anthropic-ai/sdk').then(({ default: Anthropic }) =>
        new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...clientOptions(env) })));
    return async (request: ClaudeRequest, { signal }) => {
        const anthropic = await getClient();
        try {
            if (SERVER_FALLBACK.test(model)) {
                const body = { ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
                return await anthropic.beta.messages.create(
                    body as unknown as Parameters<typeof anthropic.beta.messages.create>[0],
                    { signal },
                ) as unknown as ClaudeMessage;
            }
            return await anthropic.messages.create(
                request as unknown as Parameters<typeof anthropic.messages.create>[0],
                { signal },
            ) as unknown as ClaudeMessage;
        } catch (e) {
            throw await mapSdkError(e);
        }
    };
}

/** Send through Amazon Bedrock's Messages API endpoint. Credentials come from the standard AWS chain. */
function bedrockSend(env: Env, region: string): ClaudeSend {
    let client: Promise<import('@anthropic-ai/bedrock-sdk').AnthropicBedrockMantle> | null = null;
    const getClient = () => (client ??= import('@anthropic-ai/bedrock-sdk').then(({ AnthropicBedrockMantle }) =>
        new AnthropicBedrockMantle({ awsRegion: region, ...clientOptions(env) })));
    return async (request: ClaudeRequest, { signal }) => {
        const bedrock = await getClient();
        try {
            return await bedrock.messages.create(
                request as unknown as Parameters<typeof bedrock.messages.create>[0],
                { signal },
            ) as unknown as ClaudeMessage;
        } catch (e) {
            throw await mapSdkError(e);
        }
    };
}

const cacheKey = Symbol.for('micronutrient-diary.ai-provider');
type GlobalWithProvider = typeof globalThis & { [cacheKey]?: { provider: AiProvider; fallbackReason: string | null } };

/** Build a provider from an explicit environment (no caching). */
export function createProvider(env: Env = process.env): { provider: AiProvider; fallbackReason: string | null } {
    const choice = chooseProvider(env);
    if (choice.fallbackReason) console.warn(`[ai] using the mock provider: ${choice.fallbackReason}`);
    const rerank = env.AI_RERANK === '1' || env.AI_RERANK === 'true';
    if (choice.provider === 'anthropic') {
        return {
            provider: createClaudeProvider({ name: 'anthropic', model: choice.model!, send: anthropicSend(env, choice.model!), rerank, onSpend: recordSpend }),
            fallbackReason: null,
        };
    }
    if (choice.provider === 'bedrock') {
        return {
            provider: createClaudeProvider({ name: 'bedrock', model: choice.model!, send: bedrockSend(env, choice.region!), rerank, onSpend: recordSpend }),
            fallbackReason: null,
        };
    }
    return { provider: createMockProvider(), fallbackReason: choice.fallbackReason };
}

/** The process-wide provider. */
export function getAiProvider(): { provider: AiProvider; fallbackReason: string | null } {
    const g = globalThis as GlobalWithProvider;
    return (g[cacheKey] ??= createProvider());
}
