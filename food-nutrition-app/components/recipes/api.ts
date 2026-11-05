/** Browser calls to the recipe API. Every failure becomes an Error with a message fit to show. */
import type { Food } from '@/lib/food-types';
import type { AnalyzedIngredient, ParseResponse, RecipeFood } from '@/lib/recipes/types';

const OFFLINE = 'We couldn\'t reach the server. Check your connection and try again.';

async function readJson<T>(res: Response): Promise<T> {
    const body = await res.json().catch(() => null) as ({ error?: string } & T) | null;
    if (!res.ok) throw new Error(body?.error || 'Something went wrong. Please try again.');
    if (!body) throw new Error('Something went wrong. Please try again.');
    return body;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
        res = await fetch(url, init);
    } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        throw new Error(OFFLINE);
    }
    return readJson<T>(res);
}

const jsonPost = (body: unknown, signal?: AbortSignal): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
});

export function parseText(text: string, signal?: AbortSignal): Promise<ParseResponse> {
    return request('/api/recipes/parse', jsonPost({ text }, signal));
}

export function parseImage(image: Blob, signal?: AbortSignal): Promise<ParseResponse> {
    const form = new FormData();
    form.append('image', image, 'recipe.jpg');
    return request('/api/recipes/parse', { method: 'POST', body: form, signal });
}

export async function matchLine(line: string): Promise<AnalyzedIngredient> {
    return (await request<{ ingredient: AnalyzedIngredient }>('/api/recipes/match', jsonPost({ line }))).ingredient;
}

export async function fetchFood(fdcId: number): Promise<RecipeFood> {
    return (await request<{ food: RecipeFood }>(`/api/recipes/food?fdcId=${fdcId}`)).food;
}

export async function searchFoods(query: string, signal?: AbortSignal): Promise<Food[]> {
    return (await request<{ foods: Food[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=8`, { signal })).foods;
}
