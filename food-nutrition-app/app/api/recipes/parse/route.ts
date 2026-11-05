import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api';
import { getAiProvider } from '@/lib/ai';
import { DEFAULT_MAX_UPLOAD_BYTES, prepareImage } from '@/lib/ai/image';
import { clientIp, getRateLimiter, overDailyBudget } from '@/lib/ai/rate-limit';
import { AiError, type RecipeInput } from '@/lib/ai/types';
import { analyzeRecipeIn } from '@/lib/recipes/analyze';
import { MAX_TEXT_BODY_BYTES, parseTextBody, recipesDb, RequestError } from '@/lib/recipes/request';
import { errorResponse, handleRecipeError } from '@/lib/recipes/respond';

export const runtime = 'nodejs';

/** Whole-request limit, under CloudFront's 60 s maximum origin timeout. */
const DEADLINE_MS = 55_000;

function maxUploadBytes(): number {
    const n = Number(process.env.AI_MAX_IMAGE_BYTES);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD_BYTES;
}

async function readImage(request: Request): Promise<RecipeInput> {
    const limit = maxUploadBytes();
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
 * Body: JSON { text }, or multipart/form-data with an `image` file.
 * 200: ParseResponse (lib/recipes/types.ts): ingredients with USDA matches and gram conversions.
 * Errors: { error, code }. 400, 413, 415, 422 (not a recipe, or refused), 429 (rate limited,
 * with Retry-After), 502/503/504 (provider).
 */
export async function POST(request: Request) {
    try {
        const type = request.headers.get('content-type') ?? '';
        const isMultipart = /^multipart\/form-data\b/i.test(type);
        if (!isMultipart && !/^application\/(.+\+)?json\b/i.test(type)) {
            return errorResponse(415, 'unsupported_media_type', 'Send JSON { text } or a multipart form with an image');
        }

        const { provider } = getAiProvider();
        const limit = getRateLimiter().check(clientIp(request.headers));
        if (!limit.allowed) {
            return errorResponse(429, 'rate_limited', 'That\'s a lot of recipes in a short time. Please try again soon.', {
                'Retry-After': String(limit.retryAfterSeconds),
            });
        }
        if (provider.name !== 'mock' && overDailyBudget()) {
            return errorResponse(503, 'ai_busy', 'The recipe reader is at capacity for today. You can still add ingredients by hand.');
        }

        const input: RecipeInput = isMultipart
            ? await readImage(request)
            : { kind: 'text', text: parseTextBody(await readJsonBody(request, MAX_TEXT_BODY_BYTES)) };

        const { recipe } = await provider.readRecipe(input, { signal: AbortSignal.timeout(DEADLINE_MS) });
        if (recipe.ingredients.length === 0) {
            throw new AiError('ai_not_food', 'We couldn\'t find any ingredients. Try another photo, or paste the recipe as text.');
        }
        const result = await analyzeRecipeIn(recipesDb(), recipe, input.kind === 'image' ? 'image' : 'text', {
            provider: provider.name,
            model: provider.model,
            rerank: provider.rerank ?? null,
        });
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return handleRecipeError(error, 'recipes/parse');
    }
}
