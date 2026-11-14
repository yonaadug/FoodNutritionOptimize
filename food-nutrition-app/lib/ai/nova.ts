/**
 * Amazon Nova on Bedrock, through the Converse API. The fallback reader when
 * Claude can't be used (lib/ai/router.ts), and usable on its own.
 *
 * Same prompt, same record_recipe tool and the same validator as the Claude
 * providers (lib/ai/claude.ts, lib/ai/schema.ts), so the rest of the app can't
 * tell the reads apart. Differences:
 * - Nova accepts a forced tool choice, so the call is required rather than asked for.
 * - Nova doesn't enforce the schema (AWS lists structured outputs as unsupported
 *   for Nova), so validateRecipeOutput is what keeps the reply in shape.
 * - Images go as raw bytes, not base64.
 *
 * Nova's accuracy on recipes has not been measured. The UI treats its reads like
 * any AI read: the user checks every ingredient.
 */
import { estimateCostUsd, logAiCall } from './cost';
import { IMAGE_PROMPT, SYSTEM_PROMPT, textPrompt } from './claude';
import { RECORD_RECIPE_TOOL, RECORD_RECIPE_TOOL_DEF, validateRecipeOutput } from './schema';
import { AiError, InvalidReplyError, type AiProvider, type AiResult, type AiUsage, type ImageMediaType, type RecipeInput } from './types';

/** The part of a Converse request this code builds (a subset of ConverseCommandInput). */
export interface NovaRequest {
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
export interface NovaResponse {
    output?: { message?: { content?: { text?: string; toolUse?: { name?: string; input?: unknown } }[] } };
    stopReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number };
}

/** Sends one Converse request. The real one (novaSend) maps SDK errors to AiError. */
export type NovaSend = (request: NovaRequest, options: { signal?: AbortSignal }) => Promise<NovaResponse>;

/** Nova 2 Lite wrote 481 output tokens for a 10-ingredient card; 60 ingredients fit easily. */
const MAX_TOKENS = 4096;

const FORMATS: Record<ImageMediaType, 'jpeg' | 'png' | 'gif' | 'webp'> = {
    'image/jpeg': 'jpeg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
};

export function novaRequest(model: string, input: RecipeInput): NovaRequest {
    const content: NovaRequest['messages'][number]['content'] = input.kind === 'image'
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

function usageOf(r: NovaResponse): AiUsage {
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

function checkStop(r: NovaResponse): void {
    if (r.stopReason === 'content_filtered' || r.stopReason === 'guardrail_intervened') {
        throw new AiError('ai_refused', 'We couldn\'t read this one automatically. You can add the ingredients by hand instead.');
    }
    if (r.stopReason === 'max_tokens') {
        throw new AiError('ai_bad_output', 'This recipe was too long to read in one go. Try pasting only the ingredients.');
    }
}

function toolInput(r: NovaResponse): unknown | undefined {
    return r.output?.message?.content?.find(c => c.toolUse?.name === RECORD_RECIPE_TOOL)?.toolUse?.input;
}

export interface NovaProviderOptions {
    model: string;
    send: NovaSend;
    /** Called with the cost of each completed call (spend guard). */
    onSpend?: (usd: number) => void;
}

export function createNovaProvider({ model, send, onSpend }: NovaProviderOptions): AiProvider {
    async function readRecipe(input: RecipeInput, options: { signal?: AbortSignal } = {}): Promise<AiResult> {
        const started = Date.now();
        const request = novaRequest(model, input);
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

/** "us.amazon.nova-2-lite-v1:0" -> "amazon.nova-2-lite-v1:0", for the availability check. */
function foundationId(model: string): string {
    return model.replace(/^arn:.*\//, '').replace(/^[a-z]{2,6}(?:-[a-z]+)?\.(?=amazon\.)/, '');
}

/** An AWS SDK v3 error, as far as this code looks at it. */
interface AwsError { name?: string; message?: string; $metadata?: { httpStatusCode?: number } }

/**
 * Translate a Converse error into a message safe to show. The SDK's message can
 * echo request details, so only the error name and status reach the log, plus a
 * hint for the owner on configuration errors.
 */
export function mapNovaError(e: unknown, model: string): AiError {
    if (e instanceof AiError) return e;
    const err = (e ?? {}) as AwsError;
    const name = err.name ?? 'Error';
    const status = err.$metadata?.httpStatusCode;
    const message = typeof err.message === 'string' ? err.message : '';
    const log = (hint: string) => console.error(`[ai] Nova error: ${name}${status ? ` ${status}` : ''}. ${hint}`);

    if (name === 'AbortError' || name === 'TimeoutError' || name === 'ModelTimeoutException' || name === 'RequestTimeout') {
        return new AiError('ai_timeout', 'Reading took too long. Please try again, or paste only the ingredients.');
    }
    if (name === 'AccessDeniedException') {
        log(`Bedrock says this role or account can't use ${model}. IAM must allow bedrock:InvokeModel on the inference profile and on the foundation model in each of its regions `
            + `(${SETUP_DOC} §5). Check access with: aws bedrock get-foundation-model-availability --model-id ${foundationId(model)}. See ${SETUP_DOC}.`);
        return new AiError('ai_unavailable', UNAVAILABLE, 'access');
    }
    if (name === 'ResourceNotFoundException' || (name === 'ValidationException' && /model identifier|inference profile|on-demand throughput/i.test(message))) {
        log(`Bedrock has no model or inference profile ${model} here, or it needs a profile id. Use AI_FALLBACK_MODEL=us.amazon.nova-2-lite-v1:0, `
            + `and list profiles with: aws bedrock list-inference-profiles --region <region>. See ${SETUP_DOC}.`);
        return new AiError('ai_unavailable', UNAVAILABLE, 'access');
    }
    if (name === 'ThrottlingException' || name === 'ServiceQuotaExceededException' || name === 'ModelNotReadyException' || status === 429) {
        log(`Throttled or over quota for ${model}. Check the tokens-per-minute quota in Service Quotas. See ${SETUP_DOC}.`);
        return new AiError('ai_rate_limited', 'The recipe reader is busy right now. Please try again in a minute.', 'capacity');
    }
    if (name === 'ValidationException' || name === 'ModelErrorException') {
        console.error(`[ai] Nova request rejected: ${name}${status ? ` ${status}` : ''}`);
        return new AiError('ai_bad_output', 'We couldn\'t read that. Try a smaller photo, or paste the recipe as text.');
    }
    if (name === 'CredentialsProviderError' || name === 'UnrecognizedClientException' || name === 'ExpiredTokenException' || name === 'InvalidSignatureException') {
        log(`Bedrock rejected or couldn't find AWS credentials. Check the role or ~/.aws/credentials (aws sts get-caller-identity). See ${SETUP_DOC}.`);
        return new AiError('ai_unavailable', UNAVAILABLE);
    }
    if (name === 'ServiceUnavailableException' || name === 'InternalServerException' || (status !== undefined && status >= 500)) {
        console.error(`[ai] Nova service error: ${name}${status ? ` ${status}` : ''}`);
        return new AiError('ai_unavailable', UNAVAILABLE, 'capacity');
    }
    console.error(`[ai] unexpected Nova error: ${name}`);
    return new AiError('ai_unavailable', UNAVAILABLE);
}

/**
 * The real Converse sender: @aws-sdk/client-bedrock-runtime, loaded on first use
 * so mock mode never imports it. Credentials come from the standard AWS chain.
 */
export function novaSend(region: string, model: string, opts: { timeoutMs: number; maxRetries: number }): NovaSend {
    let client: Promise<{ send: (request: NovaRequest, signal?: AbortSignal) => Promise<NovaResponse> }> | null = null;
    const getClient = () => (client ??= import('@aws-sdk/client-bedrock-runtime').then(({ BedrockRuntimeClient, ConverseCommand }) => {
        const c = new BedrockRuntimeClient({
            region,
            maxAttempts: opts.maxRetries + 1,
            requestHandler: { requestTimeout: opts.timeoutMs, connectionTimeout: 5_000 },
        });
        return {
            send: (request: NovaRequest, signal?: AbortSignal) =>
                c.send(new ConverseCommand(request as unknown as ConstructorParameters<typeof ConverseCommand>[0]), { abortSignal: signal }) as Promise<NovaResponse>,
        };
    }));
    return async (request, { signal }) => {
        const c = await getClient();
        try {
            return await c.send(request, signal);
        } catch (e) {
            throw mapNovaError(e, model);
        }
    };
}
