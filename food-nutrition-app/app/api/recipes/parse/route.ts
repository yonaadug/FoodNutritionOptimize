import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api';
import { builtinTextFirst, getAiProvider, readTimeouts } from '@/lib/ai';
import { logAiCall } from '@/lib/ai/cost';
import { DEFAULT_MAX_UPLOAD_BYTES, prepareImage } from '@/lib/ai/image';
import { clientIp, getRateLimiter, overDailyBudget } from '@/lib/ai/rate-limit';
import { AiError, type RecipeInput } from '@/lib/ai/types';
import { hasSessionCookie } from '@/lib/auth/handlers';
import { getAccountDeps } from '@/lib/auth/server';
import { openPhotoRead, type PhotoGate } from '@/lib/billing/photo-gate';
import { analyzeRecipeIn } from '@/lib/recipes/analyze';
import { readTextBuiltin } from '@/lib/recipes/builtin';
import { MAX_TEXT_BODY_BYTES, parseTextBody, recipesDb, RequestError } from '@/lib/recipes/request';
import { errorResponse, handleRecipeError } from '@/lib/recipes/respond';

export const runtime = 'nodejs';

/**
 * A backstop for the model read. The router already holds each read to
 * AI_READ_DEADLINE_MS (23 s by default, lib/ai/index.ts readTimeouts), which keeps
 * the request under the web Lambda's 28 s and CloudFront's 30 s origin timeout.
 */
const BACKSTOP_MS = 1_000;

function maxUploadBytes(): number {
    const n = Number(process.env.AI_MAX_IMAGE_BYTES);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD_BYTES;
}

const RAW_IMAGE_TYPE = /^image\/(jpeg|png|webp|gif|heic|heif)\b/i;

async function readImage(request: Request): Promise<RecipeInput> {
    const limit = maxUploadBytes();
    if (RAW_IMAGE_TYPE.test(request.headers.get('content-type') ?? '')) {
        // The browser sends the photo's bytes as the body, so CloudFront can hash them.
        const declaredRaw = Number(request.headers.get('content-length'));
        if (Number.isFinite(declaredRaw) && declaredRaw > limit) {
            throw new RequestError(413, 'payload_too_large', `That photo is too large. The limit is ${Math.floor(limit / (1024 * 1024))} MB.`);
        }
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.length === 0) throw new RequestError(400, 'invalid_request', 'The photo was empty.');
        if (bytes.length > limit) {
            throw new RequestError(413, 'payload_too_large', `That photo is too large. The limit is ${Math.floor(limit / (1024 * 1024))} MB.`);
        }
        const prepared = await prepareImage(bytes, limit);
        return { kind: 'image', base64: prepared.base64, mediaType: prepared.mediaType };
    }
    // Reject on the declared size before buffering the body. 64 KB allows for the multipart envelope.
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit + 64 * 1024) {
        throw new RequestError(413, 'payload_too_large', `That photo is too large. The limit is ${Math.floor(limit / (1024 * 1024))} MB.`);
    }
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        throw new RequestError(400, 'invalid_request', 'Could not read the upload. Send a multipart form with an "image" file.');
    }
    const file = form.get('image');
    if (!(file instanceof File) || file.size === 0) {
        throw new RequestError(400, 'invalid_request', 'Send a multipart form with an "image" file.');
    }
    const prepared = await prepareImage(new Uint8Array(await file.arrayBuffer()), limit);
    return { kind: 'image', base64: prepared.base64, mediaType: prepared.mediaType };
}

/**
 * POST /api/recipes/parse
 * Body: JSON { text }; or a photo, as its bytes with an image/* Content-Type (what the site
 * sends, so CloudFront can hash it) or as multipart/form-data with an `image` file.
 * 200: ParseResponse (lib/recipes/types.ts): ingredients with USDA matches and gram conversions.
 * Pasted text is read by the free built-in reader first, and goes to AI only when that
 * read is unsure (lib/recipes/confidence.ts); `provider` is then "builtin". Pasted text is
 * free for everyone and never counted. Photos go to AI, which picks its model in
 * lib/ai/router.ts, and need an account: each one uses a photo read from the plan's quota
 * (lib/billing/photo-gate.ts), given back if the read fails.
 * Errors: { error, code }. 400, 401 sign_in_required, 403 photo_quota (with details.usage),
 * 413, 415, 422 (not a recipe, or refused), 429 (rate limited, with Retry-After), 502/503/504 (provider).
 */
export async function POST(request: Request) {
    let photo: PhotoGate | null = null;
    let done = false;
    try {
        const type = request.headers.get('content-type') ?? '';
        const isImage = /^multipart\/form-data\b/i.test(type) || RAW_IMAGE_TYPE.test(type);
        if (!isImage && !/^application\/(.+\+)?json\b/i.test(type)) {
            return errorResponse(415, 'unsupported_media_type', 'Send JSON { text }, or a photo as the body or in a multipart form');
        }

        const { provider } = getAiProvider();
        const limit = getRateLimiter().check(clientIp(request.headers));
        if (!limit.allowed) {
            return errorResponse(429, 'rate_limited', 'That\'s a lot of recipes in a short time. Please try again soon.', {
                'Retry-After': String(limit.retryAfterSeconds),
            });
        }
        if (isImage) {
            // Photos (raw bytes or multipart) need an account and use the plan's quota.
            // No session cookie answers without loading the account stack.
            photo = await openPhotoRead(request, hasSessionCookie(request) ? await getAccountDeps().catch(() => null) : null);
            if (!photo.ok) return errorResponse(photo.status, photo.code, photo.message, {}, photo.usage ? { usage: photo.usage } : undefined);
        }
        const input: RecipeInput = isImage
            ? await readImage(request)
            : { kind: 'text', text: parseTextBody(await readJsonBody(request, MAX_TEXT_BODY_BYTES)) };

        // Pasted text: the free built-in reader first. The mock provider is that reader already.
        if (input.kind === 'text' && provider.name !== 'mock' && builtinTextFirst()) {
            const started = Date.now();
            const builtin = readTextBuiltin(recipesDb(), input.text);
            if (builtin.verdict.confident) {
                logAiCall({ provider: 'builtin', model: null, kind: 'text', ms: Date.now() - started, ok: true, usage: null });
                const result = await analyzeRecipeIn(recipesDb(), builtin.read.recipe, 'text', { provider: 'builtin', model: null }, builtin.matches);
                return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
            }
            // Reasons are rule names only, never recipe text.
            console.info(`[recipes] built-in reader unsure (${builtin.verdict.reasons.join(',')}); reading with ${provider.model ?? provider.name}`);
        }

        if (provider.name !== 'mock' && overDailyBudget()) {
            return errorResponse(503, 'ai_busy', 'The recipe reader is at capacity for today. You can still add ingredients by hand.');
        }

        const read = await provider.readRecipe(input, { signal: AbortSignal.timeout(readTimeouts().deadlineMs + BACKSTOP_MS) });
        if (read.recipe.ingredients.length === 0) {
            throw new AiError('ai_not_food', 'We couldn\'t find any ingredients. Try another photo, or paste the recipe as text.');
        }
        const result = await analyzeRecipeIn(recipesDb(), read.recipe, input.kind === 'image' ? 'image' : 'text', {
            provider: provider.name,
            // The model that actually read it: the main model, the escalation model or the fallback.
            model: read.model ?? provider.model,
            rerank: provider.rerank ?? null,
        });
        done = true;
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return handleRecipeError(error, 'recipes/parse');
    } finally {
        // A photo read that didn't produce a recipe doesn't count.
        if (photo?.ok && !done) await photo.release().catch(() => { /* best effort */ });
    }
}
