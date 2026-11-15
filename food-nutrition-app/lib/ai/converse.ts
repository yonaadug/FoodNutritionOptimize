/**
 * Every Bedrock model that isn't Claude (Gemma, Nova and others), through the
 * Converse API. Gemma 3 27B is the default reader and Nova Lite v1 the default
 * fallback (lib/ai/router.ts); Claude ids go to lib/ai/claude.ts instead.
 *
 * Same prompt, same record_recipe tool and the same validator as the Claude
 * providers (lib/ai/claude.ts, lib/ai/schema.ts), so the rest of the app can't
 * tell the reads apart. Differences:
 * - The tool choice is forced, so the call is required rather than asked for.
 *   Gemma 3 27B and the Nova models accept that (docs/research/CHEAPER_MODELS.md).
 * - The schema isn't enforced by Bedrock here, so validateRecipeOutput is what
 *   keeps the reply in shape.
 * - Images go as raw bytes, not base64.
 *
 * Accuracy on our test set: docs/research/CHEAPER_MODELS.md. The UI treats these
 * reads like any AI read: the user checks every ingredient.
 */
import { estimateCostUsd, logAiCall } from './cost';
import { IMAGE_PROMPT, SYSTEM_PROMPT, textPrompt } from './claude';
import { RECORD_RECIPE_TOOL, RECORD_RECIPE_TOOL_DEF, validateRecipeOutput } from './schema';
import { AiError, InvalidReplyError, type AiProvider, type AiResult, type AiUsage, type ImageMediaType, type RecipeInput } from './types';

/** The part of a Converse request this code builds (a subset of ConverseCommandInput). */
export interface ConverseRequest {
    modelId: string;
    system: { text: string }[];
    messages: { role: 'user'; content: ({ text: string } | { image: { format: 'jpeg' | 'png' | 'gif' | 'webp'; source: { bytes: Uint8Array } } })[] }[];
    toolConfig: {
        tools: { toolSpec: { name: string; description: string; inputSchema: { json: unknown } } }[];
        toolChoice: { tool: { name: string } };
    };
    inferenceConfig: { maxTokens: number; temperature: number };
}

/** The part of a Converse reply this code reads. */
export interface ConverseResponse {
    output?: { message?: { content?: { text?: string; toolUse?: { name?: string; input?: unknown } }[] } };
    stopReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number };
}

/** Sends one Converse request. The real one (converseSend) maps SDK errors to AiError. */
export type ConverseSend = (request: ConverseRequest, options: { signal?: AbortSignal }) => Promise<ConverseResponse>;

/** Readers wrote 250 to 500 output tokens for a 10-ingredient card; 60 ingredients fit easily. */
const MAX_TOKENS = 4096;

const FORMATS: Record<ImageMediaType, 'jpeg' | 'png' | 'gif' | 'webp'> = {
    'image/jpeg': 'jpeg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
};

export function converseRequest(model: string, input: RecipeInput): ConverseRequest {
    const content: ConverseRequest['messages'][number]['content'] = input.kind === 'image'
        ? [{ image: { format: FORMATS[input.mediaType], source: { bytes: Buffer.from(input.base64, 'base64') } } }, { text: IMAGE_PROMPT }]
        : [{ text: textPrompt(input.text) }];
    return {
        modelId: model,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content }],
        toolConfig: {
            tools: [{ toolSpec: { name: RECORD_RECIPE_TOOL, description: RECORD_RECIPE_TOOL_DEF.description, inputSchema: { json: RECORD_RECIPE_TOOL_DEF.input_schema } } }],
            toolChoice: { tool: { name: RECORD_RECIPE_TOOL } },
        },
        // Greedy decoding, as AWS recommends for tool use.
        inferenceConfig: { maxTokens: MAX_TOKENS, temperature: 0 },
    };
}

function usageOf(r: ConverseResponse): AiUsage {
    return {
        inputTokens: r.usage?.inputTokens ?? 0,
        outputTokens: r.usage?.outputTokens ?? 0,
        cacheReadTokens: r.usage?.cacheReadInputTokens ?? 0,
        cacheWriteTokens: r.usage?.cacheWriteInputTokens ?? 0,
    };
}

function addUsage(a: AiUsage, b: AiUsage): AiUsage {
    return {
        inputTokens: a.inputTokens + b.inputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
        cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
        cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
    };
}

function checkStop(r: ConverseResponse): void {
    if (r.stopReason === 'content_filtered' || r.stopReason === 'guardrail_intervened') {
        throw new AiError('ai_refused', 'We couldn\'t read this one automatically. You can add the ingredients by hand instead.');
    }
    if (r.stopReason === 'max_tokens') {
        throw new AiError('ai_bad_output', 'This recipe was too long to read in one go. Try pasting only the ingredients.');
    }
}

function toolInput(r: ConverseResponse): unknown | undefined {
    return r.output?.message?.content?.find(c => c.toolUse?.name === RECORD_RECIPE_TOOL)?.toolUse?.input;
}

export interface ConverseProviderOptions {
    model: string;
    send: ConverseSend;
    /** Called with the cost of each completed call (spend guard). */
    onSpend?: (usd: number) => void;
}

export function createConverseProvider({ model, send, onSpend }: ConverseProviderOptions): AiProvider {
    async function readRecipe(input: RecipeInput, options: { signal?: AbortSignal } = {}): Promise<AiResult> {
        const started = Date.now();
        const request = converseRequest(model, input);
        let usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
        try {
            // The tool is forced, but ask once more if a reply still comes back without it.
            for (let attempt = 0; attempt < 2; attempt++) {
                const reply = await send(request, { signal: options.signal });
                usage = addUsage(usage, usageOf(reply));
                checkStop(reply);
                const raw = toolInput(reply);
                if (raw !== undefined) {
                    const recipe = validateRecipeOutput(raw);
                    logAiCall({ provider: 'bedrock', model, kind: input.kind, ms: Date.now() - started, ok: true, usage });
                    onSpend?.(estimateCostUsd(model, usage));
                    return { recipe, usage, model };
                }
            }
            throw new InvalidReplyError('The reader didn\'t return any ingredients. Please try again.');
        } catch (e) {
            logAiCall({
                provider: 'bedrock', model, kind: input.kind, ms: Date.now() - started, ok: false, usage,
                error: e instanceof AiError ? e.code : (e as Error).name,
            });
            onSpend?.(estimateCostUsd(model, usage));
            throw e;
        }
    }
    return { name: 'bedrock', model, readRecipe };
}

const SETUP_DOC = 'docs/BEDROCK_SETUP.md';
const UNAVAILABLE = 'The recipe reader isn\'t available right now. You can add the ingredients by hand.';

/** "us.amazon.nova-lite-v1:0" -> "amazon.nova-lite-v1:0", for the availability check. "google.gemma-3-27b-it" is kept. */
function foundationId(model: string): string {
    return model.replace(/^arn:.*\//, '').replace(/^[a-z]{2,6}(?:-[a-z]+)?\.(?=[a-z]+\.)/, '');
}

/** An AWS SDK v3 error, as far as this code looks at it. */
interface AwsError { name?: string; message?: string; $metadata?: { httpStatusCode?: number } }

/**
 * Translate a Converse error into a message safe to show. The SDK's message can
 * echo request details, so only the error name and status reach the log, plus a
 * hint for the owner on configuration errors.
 */
export function mapConverseError(e: unknown, model: string): AiError {
    if (e instanceof AiError) return e;
    const err = (e ?? {}) as AwsError;
    const name = err.name ?? 'Error';
    const status = err.$metadata?.httpStatusCode;
    const message = typeof err.message === 'string' ? err.message : '';
    const log = (hint: string) => console.error(`[ai] Bedrock Converse error: ${name}${status ? ` ${status}` : ''}. ${hint}`);

    if (name === 'AbortError' || name === 'TimeoutError' || name === 'ModelTimeoutException' || name === 'RequestTimeout') {
        return new AiError('ai_timeout', 'Reading took too long. Please try again, or paste only the ingredients.');
    }
    if (name === 'AccessDeniedException') {
        log(`Bedrock says this role or account can't use ${model}. IAM must allow bedrock:InvokeModel on the foundation model (an in-region id such as Gemma's), `
            + `or on the inference profile and the foundation model in each of its regions (a us. profile such as Nova Lite's) (${SETUP_DOC} §5). Check access with: aws bedrock get-foundation-model-availability --model-id ${foundationId(model)}. See ${SETUP_DOC}.`);
        return new AiError('ai_unavailable', UNAVAILABLE, 'access');
    }
    if (name === 'ResourceNotFoundException' || (name === 'ValidationException' && /model identifier|inference profile|on-demand throughput/i.test(message))) {
        log(`Bedrock has no model or inference profile ${model} here, or it needs a profile id. Gemma 3 27B is google.gemma-3-27b-it and Nova Lite v1 is us.amazon.nova-lite-v1:0. `
            + `List them with: aws bedrock list-foundation-models and aws bedrock list-inference-profiles --region <region>. See ${SETUP_DOC}.`);
        return new AiError('ai_unavailable', UNAVAILABLE, 'access');
    }
    if (name === 'ThrottlingException' || name === 'ServiceQuotaExceededException' || name === 'ModelNotReadyException' || status === 429) {
        log(`Throttled or over quota for ${model}. Check the tokens-per-minute quota in Service Quotas. See ${SETUP_DOC}.`);
        return new AiError('ai_rate_limited', 'The recipe reader is busy right now. Please try again in a minute.', 'capacity');
    }
    if (name === 'ValidationException' || name === 'ModelErrorException') {
        console.error(`[ai] Bedrock Converse request rejected: ${name}${status ? ` ${status}` : ''}`);
        return new AiError('ai_bad_output', 'We couldn\'t read that. Try a smaller photo, or paste the recipe as text.');
    }
    if (name === 'CredentialsProviderError' || name === 'UnrecognizedClientException' || name === 'ExpiredTokenException' || name === 'InvalidSignatureException') {
        log(`Bedrock rejected or couldn't find AWS credentials. Check the role or ~/.aws/credentials (aws sts get-caller-identity). See ${SETUP_DOC}.`);
        return new AiError('ai_unavailable', UNAVAILABLE);
    }
    if (name === 'ServiceUnavailableException' || name === 'InternalServerException' || (status !== undefined && status >= 500)) {
        console.error(`[ai] Bedrock Converse service error: ${name}${status ? ` ${status}` : ''}`);
        return new AiError('ai_unavailable', UNAVAILABLE, 'capacity');
    }
    console.error(`[ai] unexpected Bedrock Converse error: ${name}`);
    return new AiError('ai_unavailable', UNAVAILABLE);
}

/**
 * The real Converse sender: @aws-sdk/client-bedrock-runtime, loaded on first use
 * so mock mode never imports it. Credentials come from the standard AWS chain.
 */
export function converseSend(region: string, model: string, opts: { timeoutMs: number; maxRetries: number }): ConverseSend {
    let client: Promise<{ send: (request: ConverseRequest, signal?: AbortSignal) => Promise<ConverseResponse> }> | null = null;
    const getClient = () => (client ??= import('@aws-sdk/client-bedrock-runtime').then(({ BedrockRuntimeClient, ConverseCommand }) => {
        const c = new BedrockRuntimeClient({
            region,
            maxAttempts: opts.maxRetries + 1,
            requestHandler: { requestTimeout: opts.timeoutMs, connectionTimeout: 5_000 },
        });
        return {
            send: (request: ConverseRequest, signal?: AbortSignal) =>
                c.send(new ConverseCommand(request as unknown as ConstructorParameters<typeof ConverseCommand>[0]), { abortSignal: signal }) as Promise<ConverseResponse>,
        };
    }));
    return async (request, { signal }) => {
        const c = await getClient();
        try {
            return await c.send(request, signal);
        } catch (e) {
            throw mapConverseError(e, model);
        }
    };
}
