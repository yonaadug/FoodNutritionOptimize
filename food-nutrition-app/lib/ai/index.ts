/**
 * Picks the AI provider and its models from the environment.
 *
 *   AI_PROVIDER=mock       deterministic and offline (the default)
 *   AI_PROVIDER=bedrock    Amazon Bedrock (AWS credentials + region). Claude ids
 *                          (anthropic., us.anthropic., global.anthropic., claude-*) go to
 *                          the Claude client: an inference profile id or ARN through
 *                          bedrock-runtime, a bare id to the bedrock-mantle Messages
 *                          endpoint. Every other id (Gemma, Nova, ...) goes through the
 *                          Converse API (lib/ai/converse.ts).
 *   AI_PROVIDER=anthropic  Claude API (ANTHROPIC_API_KEY). Claude only, no fallback.
 *
 * Models, each turned off with "off" (see lib/ai/router.ts for when each is used):
 *   AI_MODEL             main reader: Google Gemma 3 27B (Claude Haiku 5.5 on the Claude API)
 *   AI_ESCALATION_MODEL  plated-food photos and failed reads: off by default
 *   AI_FALLBACK_MODEL    when the main model errors: Amazon Nova Lite v1 (Bedrock only)
 * Time limits, so a main call plus a fallback fits the web Lambda's 28 s (readTimeouts):
 *   AI_TIMEOUT_MS            the main and escalation calls, retries included
 *   AI_FALLBACK_TIMEOUT_MS   the fallback call, retries included
 *   AI_READ_DEADLINE_MS      the whole read, every tier included
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

/**
 * Google Gemma 3 27B, an in-region Bedrock model called by its own id (no inference
 * profile). Best photo score in the 2026-11-14 benchmark, about $0.00025 a card photo
 * and $0.00017 an unsure text read (docs/research/CHEAPER_MODELS.md).
 */
export const DEFAULT_BEDROCK_MODEL = 'google.gemma-3-27b-it';
/** No escalation by default: Gemma reads plated food too. Set AI_ESCALATION_MODEL (e.g. us.anthropic.claude-sonnet-5-5) to add one. */
export const DEFAULT_BEDROCK_ESCALATION_MODEL: string | null = null;
/** Amazon Nova Lite v1 through its US profile: the cheapest model with 8/8 card photos in the benchmark. */
export const DEFAULT_FALLBACK_MODEL = 'us.amazon.nova-lite-v1:0';
/** The Claude API serves only Claude: Haiku 5.5 reads, and nothing escalates unless AI_ESCALATION_MODEL names a model. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
/** Gemma 3 27B card photos: 5.9 s p50, 11.2 s p95 in the benchmark. */
export const DEFAULT_TIMEOUT_MS = 14_000;
/** Nova Lite v1: 1.9 s p50, 2.8 s p95 on card photos. */
export const DEFAULT_FALLBACK_TIMEOUT_MS = 8_000;
/** The whole read. With image preparation and matching, stays under the web Lambda's 28 s and CloudFront's 30 s. */
export const DEFAULT_READ_DEADLINE_MS = 23_000;
/** Retried by the SDK on connection errors, 408, 409, 429 and 5xx, inside the call's time limit. */
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

/**
 * A Claude id: "claude-…" (the Claude API's form), "anthropic.claude-…", a profile
 * such as "us.anthropic.…" or "global.anthropic.…", or an ARN for one of those.
 */
export function isClaudeModel(model: string): boolean {
    return /^claude-/.test(model) || /(?:^|[./])anthropic\.claude-/.test(model);
}

/** Which client sends a Bedrock model's requests: the Claude client for Claude, Converse for everything else. */
export function bedrockClient(model: string): 'claude' | 'converse' {
    return isClaudeModel(model) ? 'claude' : 'converse';
}

/** "claude-opus-5-5" -> "anthropic.claude-opus-5-5"; any other id, profile or ARN is kept as written. */
export function bedrockModelId(model: string): string {
    return /^claude-/.test(model) ? `anthropic.${model}` : model;
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
    /** Bedrock only: which endpoint a Claude main model is sent to (null for other models, which use Converse). */
    endpoint: BedrockEndpoint | null;
    /** The model for plated-food photos and failed reads (AI_ESCALATION_MODEL); null when off. */
    escalationModel: string | null;
    escalationEndpoint: BedrockEndpoint | null;
    /** The model used when the main model errors (AI_FALLBACK_MODEL, Bedrock only); null when off. */
    fallbackModel: string | null;
    /** Why a paid provider was not used, when one was asked for. */
    fallbackReason: string | null;
}

const claudeEndpoint = (id: string | null): BedrockEndpoint | null => (id && isClaudeModel(id) ? bedrockEndpoint(id) : null);

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
        const model = modelEnv(env, 'AI_MODEL', DEFAULT_ANTHROPIC_MODEL);
        const escalationModel = modelEnv(env, 'AI_ESCALATION_MODEL', null);
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

export interface ReadTimeouts {
    /** The main and escalation calls, retries included (AI_TIMEOUT_MS). Also each SDK attempt's limit. */
    primaryMs: number;
    /** The fallback call, retries included (AI_FALLBACK_TIMEOUT_MS). */
    fallbackMs: number;
    /** The whole read, every tier included (AI_READ_DEADLINE_MS). */
    deadlineMs: number;
}

/**
 * Time limits for a read. The defaults fit a 14 s main call and an 8 s fallback in a
 * 23 s read, leaving the web Lambda's 28 s (and CloudFront's 30 s) room for the image
 * and the matcher. The router enforces them (lib/ai/router.ts).
 */
export function readTimeouts(env: Env = process.env): ReadTimeouts {
    return {
        primaryMs: intEnv(env, 'AI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
        fallbackMs: intEnv(env, 'AI_FALLBACK_TIMEOUT_MS', DEFAULT_FALLBACK_TIMEOUT_MS),
        deadlineMs: intEnv(env, 'AI_READ_DEADLINE_MS', DEFAULT_READ_DEADLINE_MS),
    };
}

function clientOptions(env: Env) {
    return {
        timeout: readTimeouts(env).primaryMs,
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
    const { maxRetries } = clientOptions(env);
    const times = readTimeouts(env);
    const build = (model: string | null, withRerank: boolean, timeoutMs: number): AiProvider | null => {
        if (!model) return null;
        if (choice.provider === 'anthropic') {
            return createClaudeProvider({ name: 'anthropic', model, send: anthropicSend(env, model), rerank: withRerank, onSpend: recordSpend });
        }
        if (bedrockClient(model) === 'converse') {
            return createConverseProvider({ model, send: converseSend(choice.region!, model, { timeoutMs, maxRetries }), onSpend: recordSpend });
        }
        return createClaudeProvider({ name: 'bedrock', model, send: bedrockSend(env, choice.region!, model, bedrockEndpoint(model)), rerank: withRerank, onSpend: recordSpend });
    };
    const primary = build(choice.model, rerank, times.primaryMs);
    const escalation = build(choice.escalationModel, false, times.primaryMs);
    const fallback = build(choice.fallbackModel, false, times.fallbackMs);
    // Always routed, even with one tier, so the time limits apply.
    const provider = createRoutedProvider({
        primary, escalation, fallback,
        timeouts: { primary: times.primaryMs, escalation: times.primaryMs, fallback: times.fallbackMs },
        deadlineMs: times.deadlineMs,
    });
    return { provider, fallbackReason: null };
}

/** The process-wide provider. */
export function getAiProvider(): { provider: AiProvider; fallbackReason: string | null } {
    const g = globalThis as GlobalWithProvider;
    return (g[cacheKey] ??= createProvider());
}
