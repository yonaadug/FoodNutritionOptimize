/**
 * Picks the AI provider and its models from the environment.
 *
 *   AI_PROVIDER=mock       deterministic and offline (the default)
 *   AI_PROVIDER=bedrock    Amazon Bedrock (AWS credentials + region): Claude, with Amazon
 *                          Nova as the fallback. An inference profile id (us./global./...)
 *                          or ARN goes through bedrock-runtime; a bare Claude id goes to the
 *                          bedrock-mantle Messages endpoint.
 *   AI_PROVIDER=anthropic  Claude API (ANTHROPIC_API_KEY). No Nova fallback.
 *
 * Models, each turned off with "off" (see lib/ai/router.ts for when each is used):
 *   AI_MODEL             main reader: Claude Haiku 5.5
 *   AI_ESCALATION_MODEL  plated-food photos and failed reads: Claude Sonnet 5.5
 *   AI_FALLBACK_MODEL    when Claude is unavailable: Amazon Nova 2 Lite (Bedrock only)
 * And AI_BUILTIN_TEXT=off sends all pasted text to AI instead of trying the
 * built-in reader first (lib/recipes/confidence.ts).
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
import { createConverseProvider, converseSend } from './converse';
import { recordSpend } from './rate-limit';
import { createRoutedProvider } from './router';
import { AiError, type AiProvider } from './types';

type Env = Record<string, string | undefined>;

/** Claude Haiku 5.5: about $0.0008 a photo on Bedrock, 40x cheaper than Opus (docs/BEDROCK_SETUP.md §3). */
export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const DEFAULT_ESCALATION_MODEL = 'claude-sonnet-5-5';
/** On bedrock-runtime current Claude models are reachable only through inference profiles; "us." keeps requests in US regions. */
export const DEFAULT_BEDROCK_MODEL = `us.anthropic.${DEFAULT_MODEL}`;
export const DEFAULT_BEDROCK_ESCALATION_MODEL = `us.anthropic.${DEFAULT_ESCALATION_MODEL}`;
/** Amazon Nova 2 Lite through its US profile. Works on the account while Claude's quota is 0. */
export const DEFAULT_FALLBACK_MODEL = 'us.amazon.nova-2-lite-v1:0';
export const DEFAULT_TIMEOUT_MS = 45_000;
/** Retried by the SDK on connection errors, 408, 409, 429 and 5xx. */
export const DEFAULT_MAX_RETRIES = 2;

/** Models with a server-side refusal fallback on the Claude API. Haiku has none; Bedrock doesn't support it. */
const SERVER_FALLBACK = /^claude-(opus-5|fable-5|sonnet-5-5)/;

function intEnv(env: Env, key: string, fallback: number): number {
    const n = Number(env[key]);
    return env[key] !== undefined && env[key] !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

const OFF = /^(off|none|false|0|no)$/i;

/** A model variable: its value, the default when unset, or null when turned off. */
function modelEnv(env: Env, key: string, fallback: string | null): string | null {
    const v = env[key]?.trim();
    if (!v) return fallback;
    return OFF.test(v) ? null : v;
}

/** Try the built-in reader on pasted text before AI (AI_BUILTIN_TEXT, on by default). */
export function builtinTextFirst(env: Env = process.env): boolean {
    const v = env.AI_BUILTIN_TEXT?.trim();
    return !v || !OFF.test(v);
}

/** An Amazon Nova id: "amazon.nova-…", "us.amazon.nova-…", or an ARN for one. */
export function isNovaModel(model: string): boolean {
    return /(?:^|[./])amazon\.nova-/.test(model);
}

/** "claude-opus-5-5" -> "anthropic.claude-opus-5-5"; a full id, Nova id or inference profile is kept as written. */
export function bedrockModelId(model: string): string {
    return model.includes('anthropic.') || model.startsWith('arn:') || isNovaModel(model) ? model : `anthropic.${model}`;
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
    /** The main model (AI_MODEL); null when turned off. */
    model: string | null;
    region: string | null;
    /** Bedrock only: which endpoint the main model id is sent to (null for Nova, which uses Converse). */
    endpoint: BedrockEndpoint | null;
    /** The model for plated-food photos and failed reads (AI_ESCALATION_MODEL); null when off. */
    escalationModel: string | null;
    escalationEndpoint: BedrockEndpoint | null;
    /** The model used when Claude is unavailable (AI_FALLBACK_MODEL, Bedrock only); null when off. */
    fallbackModel: string | null;
    /** Why a paid provider was not used, when one was asked for. */
    fallbackReason: string | null;
}

const claudeEndpoint = (id: string | null): BedrockEndpoint | null => (id && !isNovaModel(id) ? bedrockEndpoint(id) : null);

/** Pure decision, separated out for tests. */
export function chooseProvider(env: Env = process.env): ProviderChoice {
    const asked = (env.AI_PROVIDER ?? '').trim().toLowerCase();
    const mock = (fallbackReason: string | null): ProviderChoice => ({
        provider: 'mock', model: null, region: null, endpoint: null, escalationModel: null, escalationEndpoint: null, fallbackModel: null, fallbackReason,
    });
    if (asked === '' || asked === 'mock') return mock(null);
    if (asked === 'bedrock') {
        const region = env.AI_BEDROCK_REGION?.trim() || env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || null;
        if (!region) return mock('AI_PROVIDER=bedrock needs AI_BEDROCK_REGION or AWS_REGION');
        const main = modelEnv(env, 'AI_MODEL', DEFAULT_BEDROCK_MODEL);
        const escalation = modelEnv(env, 'AI_ESCALATION_MODEL', DEFAULT_BEDROCK_ESCALATION_MODEL);
        const fallback = modelEnv(env, 'AI_FALLBACK_MODEL', DEFAULT_FALLBACK_MODEL);
        const model = main && bedrockModelId(main);
        const escalationModel = escalation && bedrockModelId(escalation);
        const fallbackModel = fallback && bedrockModelId(fallback);
        if (!model && !escalationModel && !fallbackModel) return mock('AI_MODEL, AI_ESCALATION_MODEL and AI_FALLBACK_MODEL are all off');
        return {
            provider: 'bedrock', model, region, endpoint: claudeEndpoint(model),
            escalationModel, escalationEndpoint: claudeEndpoint(escalationModel), fallbackModel, fallbackReason: null,
        };
    }
    if (asked === 'anthropic') {
        if (!env.ANTHROPIC_API_KEY?.trim()) return mock('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
        const model = modelEnv(env, 'AI_MODEL', DEFAULT_MODEL);
        const escalationModel = modelEnv(env, 'AI_ESCALATION_MODEL', DEFAULT_ESCALATION_MODEL);
        if (!model && !escalationModel) return mock('AI_MODEL and AI_ESCALATION_MODEL are both off');
        return { provider: 'anthropic', model, region: null, endpoint: null, escalationModel, escalationEndpoint: null, fallbackModel: null, fallbackReason: null };
    }
    return mock(`Unknown AI_PROVIDER "${asked}"`);
}

const UNAVAILABLE = 'The recipe reader isn\'t available right now. You can add the ingredients by hand.';

/** The AWS error type a Bedrock reply names ("ServiceQuotaExceededException:http://…"), if any. */
function awsErrorType(e: { headers?: Headers | null }): string {
    const raw = typeof e.headers?.get === 'function' ? e.headers.get('x-amzn-errortype') : null;
    return (raw ?? '').split(':')[0];
}

/** Bedrock's 400 for an unknown id, or a base id where a profile is needed. Read for the decision only; never logged. */
const MODEL_ID_REJECTED = /model identifier|inference profile|on-demand throughput/i;

/**
 * Translate SDK errors into messages safe to show. SDK error text can echo request
 * details, so it stays out. On Bedrock, configuration errors also log what to fix.
 * Errors that mean the model itself can't be used now carry `unavailable`, so the
 * router can hand the read to the fallback model (lib/ai/router.ts).
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
        console.error(`[ai] throttled: ${e.status}${bedrock ? ` on ${bedrock.model}. Check its tokens-per-minute quota in Service Quotas. See ${SETUP_DOC}.` : ''}`);
        return new AiError('ai_rate_limited', 'The recipe reader is busy right now. Please try again in a minute.', 'capacity');
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.NotFoundError) {
        const hint = bedrock ? ` ${bedrockConfigHint(e.status, bedrock.model, bedrock.endpoint)}` : '';
        console.error(`[ai] provider configuration error: ${e.constructor.name} ${e.status}.${hint}`);
        // Bad credentials would fail any Bedrock model, so only 403 and 404 hand over to the fallback.
        return new AiError('ai_unavailable', UNAVAILABLE, e instanceof Anthropic.AuthenticationError ? null : 'access');
    }
    if (e instanceof Anthropic.BadRequestError) {
        const type = awsErrorType(e);
        if (type === 'ServiceQuotaExceededException') {
            console.error(`[ai] over quota: ${type} on ${bedrock?.model ?? 'the model'}. Check its tokens-per-minute quota in Service Quotas. See ${SETUP_DOC}.`);
            return new AiError('ai_rate_limited', 'The recipe reader is busy right now. Please try again in a minute.', 'capacity');
        }
        const message = (e.error as { message?: unknown } | undefined)?.message;
        if (bedrock && type === 'ValidationException' && typeof message === 'string' && MODEL_ID_REJECTED.test(message)) {
            console.error(`[ai] provider configuration error: ${type} 400. ${bedrockConfigHint(404, bedrock.model, bedrock.endpoint)}`);
            return new AiError('ai_unavailable', UNAVAILABLE, 'access');
        }
        console.error(`[ai] request rejected: ${e.status}${type ? ` ${type}` : ''}`);
        return new AiError('ai_bad_output', 'We couldn\'t read that. Try a smaller photo, or paste the recipe as text.');
    }
    if (e instanceof Anthropic.APIError) {
        console.error(`[ai] provider error: ${e.constructor.name} ${e.status ?? ''}`);
        // 5xx and 529 (overloaded) are outages; a connection error has no status.
        return new AiError('ai_unavailable', UNAVAILABLE, typeof e.status === 'number' && e.status >= 500 ? 'capacity' : null);
    }
    console.error(`[ai] unexpected error: ${(e as Error)?.name}`);
    return new AiError('ai_unavailable', UNAVAILABLE);
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
 * Send Claude requests through Amazon Bedrock. Inference profiles go to
 * bedrock-runtime (InvokeModel), bare ids to the bedrock-mantle Messages endpoint.
 * Both take the same Messages request. Credentials come from the standard AWS chain.
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
    if (choice.provider === 'mock') return { provider: createMockProvider(), fallbackReason: choice.fallbackReason };

    const rerank = env.AI_RERANK === '1' || env.AI_RERANK === 'true';
    const { timeout, maxRetries } = clientOptions(env);
    const build = (model: string | null, endpoint: BedrockEndpoint | null, withRerank: boolean): AiProvider | null => {
        if (!model) return null;
        if (choice.provider === 'anthropic') {
            return createClaudeProvider({ name: 'anthropic', model, send: anthropicSend(env, model), rerank: withRerank, onSpend: recordSpend });
        }
        if (isNovaModel(model)) {
            return createConverseProvider({ model, send: converseSend(choice.region!, model, { timeoutMs: timeout, maxRetries }), onSpend: recordSpend });
        }
        return createClaudeProvider({ name: 'bedrock', model, send: bedrockSend(env, choice.region!, model, endpoint!), rerank: withRerank, onSpend: recordSpend });
    };
    const primary = build(choice.model, choice.endpoint, rerank);
    const escalation = build(choice.escalationModel, choice.escalationEndpoint, false);
    const fallback = build(choice.fallbackModel, null, false);
    const tiers = [primary, escalation, fallback].filter(Boolean);
    const provider = tiers.length === 1 ? tiers[0]! : createRoutedProvider({ primary, escalation, fallback });
    return { provider, fallbackReason: null };
}

/** The process-wide provider. */
export function getAiProvider(): { provider: AiProvider; fallbackReason: string | null } {
    const g = globalThis as GlobalWithProvider;
    return (g[cacheKey] ??= createProvider());
}
