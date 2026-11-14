/** Browser calls to the recipe API. Every failure becomes an Error with a message fit to show. */
import type { Food } from '@/lib/food-types';
import type { AnalyzedIngredient, ParseResponse, RecipeFood } from '@/lib/recipes/types';
import { sameOriginFetch } from '@/lib/same-origin-fetch';

const OFFLINE = 'We couldn\'t reach the server. Check your connection and try again.';

async function readJson<T>(res: Response): Promise<T> {
    const body = await res.json().catch(() => null) as ({ error?: string } & T) | null;
    if (!res.ok) throw new Error(body?.error || 'Something went wrong. Please try again.');
    if (!body) throw new Error('Something went wrong. Please try again.');
    return body;
}

async function request<T>(send: () => Promise<Response>): Promise<T> {
    let res: Response;
    try {
        res = await send();
    } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        throw new Error(OFFLINE);
    }
    return readJson<T>(res);
}

const get = <T>(url: string, signal?: AbortSignal) => request<T>(() => fetch(url, { signal }));
const post = <T>(url: string, json: unknown, signal?: AbortSignal) =>
    request<T>(() => sameOriginFetch(url, { method: 'POST', json, signal }));

export function parseText(text: string, signal?: AbortSignal): Promise<ParseResponse> {
    return post('/api/recipes/parse', { text }, signal);
}

/** Sends the photo's bytes as the body (not a form), so CloudFront can check their hash. */
export function parseImage(image: Blob, signal?: AbortSignal): Promise<ParseResponse> {
    return request(() => sameOriginFetch('/api/recipes/parse', {
        method: 'POST', body: image, contentType: image.type || 'image/jpeg', signal,
    }));
}

export async function matchLine(line: string): Promise<AnalyzedIngredient> {
    return (await post<{ ingredient: AnalyzedIngredient }>('/api/recipes/match', { line })).ingredient;
}

export async function fetchFood(fdcId: number): Promise<RecipeFood> {
    return (await get<{ food: RecipeFood }>(`/api/recipes/food?fdcId=${fdcId}`)).food;
}

export async function searchFoods(query: string, signal?: AbortSignal): Promise<Food[]> {
    return (await get<{ foods: Food[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=8`, signal)).foods;
}
