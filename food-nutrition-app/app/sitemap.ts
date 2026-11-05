import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { getCategories, getFoodRefs, sortableNutrients } from '@/lib/db';
import { foodPath, nutrientSlug } from '@/lib/food-page';
import { absoluteUrl } from '@/lib/nav';

/** Every indexable page: home, planner, nutrient and category lists, and each food (under 10,000 URLs). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    await connection();
    const [categories, foods] = await Promise.all([getCategories(), getFoodRefs()]);
    return [
        { url: absoluteUrl('/'), changeFrequency: 'monthly', priority: 1 },
        { url: absoluteUrl('/plan'), changeFrequency: 'monthly', priority: 0.6 },
        { url: absoluteUrl('/methodology'), changeFrequency: 'monthly', priority: 0.4 },
        { url: absoluteUrl('/nutrients'), changeFrequency: 'monthly', priority: 0.7 },
        ...sortableNutrients().filter(k => k !== 'calories').map(k => ({ url: absoluteUrl(`/nutrients/${nutrientSlug(k)}`), priority: 0.7 })),
        { url: absoluteUrl('/food/category'), changeFrequency: 'monthly', priority: 0.6 },
        ...categories.map(c => ({ url: absoluteUrl(`/food/category/${c.slug}`), priority: 0.6 })),
        ...foods.map(f => ({ url: absoluteUrl(foodPath(f)), priority: 0.5 })),
    ];
}
