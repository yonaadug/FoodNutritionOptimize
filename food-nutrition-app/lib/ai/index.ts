/**
 * Picks the AI provider from the environment.
 *
 *   AI_PROVIDER=mock       deterministic and offline (the default)
 *   AI_PROVIDER=bedrock    Claude on Amazon Bedrock (AWS credentials + region). An inference
 *                          profile id (us./global./...) or ARN goes through bedrock-runtime
 *                          InvokeModel; a bare id goes to the bedrock-mantle Messages endpoint.
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

export type BedrockEndpoint = 'mantle' | 'runtime';

/** A cross-region inference profile id: "us.", "eu.", "apac.", "global." and so on before "anthropic.". */
const PROFILE_PREFIX = /^[a-z]{2,6}(?:-[a-z]+)?\.anthropic\./;

/**
 * Which Bedrock endpoint serves this id. The bedrock-mantle endpoint takes plain
 * "anthropic.<model>" ids, and only for the models it lists (in us-east-1 on
 * 2026-11-13 that excluded Haiku 5.5 and Sonnet 5.5). Inference profiles and ARNs
 * are bedrock-runtime ids, called with InvokeModel.
 */
export function bedrockEndpoint(modelId: string): BedrockEndpoint {
    return modelId.startsWith('arn:') || PROFILE_PREFIX.test(modelId) ? 'runtime' : 'mantle';
}

const SETUP_DOC = 'docs/BEDROCK_SETUP.md';

/** What the owner should check for a Bedrock configuration error. Goes to the server log only. */
export function bedrockConfigHint(status: number | undefined, modelId: string, endpoint: BedrockEndpoint): string {
    const base = modelId.replace(/^arn:.*\//, '').replace(PROFILE_PREFIX, 'anthropic.');
    if (status === 401) {
        return `Bedrock rejected the AWS credentials. Check the role or ~/.aws/credentials (aws sts get-caller-identity). See ${SETUP_DOC}.`;
    }
    if (status === 403) {
        return `Bedrock says this account can't use ${modelId}. Usually: the Anthropic use-case form isn't submitted, the model's Marketplace agreement doesn't exist yet, `
            + `the account's tokens-per-minute quota for the model is 0, or IAM doesn't allow ${endpoint === 'runtime' ? 'bedrock:InvokeModel on the profile and model ARNs' : 'bedrock-mantle:CreateInference'}. `
            + `Check with: aws bedrock get-foundation-model-availability --model-id ${base}. See ${SETUP_DOC}.`;
    }
    if (status === 404) {
        if (endpoint === 'mantle') {
            const profile = base.replace(/^anthropic\./, 'us.anthropic.');
            return `The bedrock-mantle endpoint doesn't serve ${modelId} in this region. Use the inference profile instead: AI_MODEL=${profile} (or global.${base}). See ${SETUP_DOC}.`;
        }
        return `Bedrock has no model or inference profile ${modelId} in this region. List them with: aws bedrock list-inference-profiles --region <region>. See ${SETUP_DOC}.`;
    }
    return `See ${SETUP_DOC}.`;
}

export interface ProviderChoice {
    provider: 'mock' | 'bedrock' | 'anthropic';
    model: string | null;
    region: string | null;
    /** Bedrock only: which endpoint the model id is sent to. */
    endpoint: BedrockEndpoint | null;
    /** Why a paid provider was not used, when one was asked for. */
    fallbackReason: string | null;
}

/** Pure decision, separated out for tests. */
export function chooseProvider(env: Env = process.env): ProviderChoice {
    const asked = (env.AI_PROVIDER ?? '').trim().toLowerCase();
    const mock = (fallbackReason: string | null): ProviderChoice => ({ provider: 'mock', model: null, region: null, endpoint: null, fallbackReason });
    const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
    if (asked === '' || asked === 'mock') return mock(null);
    if (asked === 'bedrock') {
        const region = env.AI_BEDROCK_REGION?.trim() || env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || null;
        if (!region) return mock('AI_PROVIDER=bedrock needs AI_BEDROCK_REGION or AWS_REGION');
        const id = bedrockModelId(model);
        return { provider: 'bedrock', model: id, region, endpoint: bedrockEndpoint(id), fallbackReason: null };
    }
    if (asked === 'anthropic') {
        if (!env.ANTHROPIC_API_KEY?.trim()) return mock('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
        return { provider: 'anthropic', model, region: null, endpoint: null, fallbackReason: null };
    }
    return mock(`Unknown AI_PROVIDER "${asked}"`);
}

/**
 * Translate SDK errors into messages safe to show. SDK error text can echo request
 * details, so it stays out. On Bedrock, configuration errors also log what to fix.
 */
export async function mapSdkError(e: unknown, bedrock: { model: string; endpoint: BedrockEndpoint } | null = null): Promise<AiError> {
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
        const hint = bedrock ? ` ${bedrockConfigHint(e.status, bedrock.model, bedrock.endpoint)}` : '';
        console.error(`[ai] provider configuration error: ${e.constructor.name} ${e.status}.${hint}`);
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

type BedrockClient = import('@anthropic-ai/bedrock-sdk').AnthropicBedrockMantle | import('@anthropic-ai/bedrock-sdk').AnthropicBedrock;

/**
 * Send through Amazon Bedrock. Inference profiles go to bedrock-runtime (InvokeModel),
 * bare ids to the bedrock-mantle Messages endpoint. Both take the same Messages
 * request. Credentials come from the standard AWS chain.
 */
function bedrockSend(env: Env, region: string, model: string, endpoint: BedrockEndpoint): ClaudeSend {
    let client: Promise<BedrockClient> | null = null;
    const getClient = () => (client ??= import('@anthropic-ai/bedrock-sdk').then(({ AnthropicBedrock, AnthropicBedrockMantle }) =>
        endpoint === 'runtime'
            ? new AnthropicBedrock({ awsRegion: region, ...clientOptions(env) })
            : new AnthropicBedrockMantle({ awsRegion: region, ...clientOptions(env) })));
    return async (request: ClaudeRequest, { signal }) => {
        const bedrock = await getClient();
        try {
            return await bedrock.messages.create(
                request as unknown as Parameters<typeof bedrock.messages.create>[0],
                { signal },
            ) as unknown as ClaudeMessage;
        } catch (e) {
            throw await mapSdkError(e, { model, endpoint });
        }
    };
}

const cacheKey = Symbol.for('nutrition-dictionary.ai-provider');
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
            provider: createClaudeProvider({ name: 'bedrock', model: choice.model!, send: bedrockSend(env, choice.region!, choice.model!, choice.endpoint!), rerank, onSpend: recordSpend }),
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
