import type { Metadata } from 'next';
import Link from 'next/link';
import { getCategories, getDbInfo, getTopHits, searchFoodGroups, SEARCH_MAX_QUERY_LENGTH } from '@/lib/db';
import { categorySlug, nutrientName, nutrientSlug } from '@/lib/food-page';
import { SITE_TAGLINE } from '@/lib/nav';
import FoodCard from '@/components/explore/FoodCard';
import FoodSearch, { type InitialSearch } from '@/components/explore/FoodSearch';
import PlanNudge, { LegacyPlannerRedirect } from '@/components/explore/PlanNudge';
import { HOME_CATEGORIES, NUTRIENT_SHORTCUTS, POPULAR_QUERIES } from '@/components/explore/home-data';
import Icon from '@/components/ui/Icon';

function queryParam(v: string | string[] | undefined): string {
    const q = Array.isArray(v) ? v[0] : v;
    return (q ?? '').trim().slice(0, SEARCH_MAX_QUERY_LENGTH);
}

export async function generateMetadata({ searchParams }: PageProps<'/'>): Promise<Metadata> {
    const q = queryParam((await searchParams).q);
    if (q) {
        // Search result pages are for people, not for the index.
        return { title: `“${q}” nutrition search`, robots: { index: false, follow: true }, alternates: { canonical: '/' } };
    }
    return { alternates: { canonical: '/' } };
}

export default async function Home({ searchParams }: PageProps<'/'>) {
    const q = queryParam((await searchParams).q);
    let initial: InitialSearch | null = null;
    if (q.length >= 2) {
        const r = await searchFoodGroups(q, 1, 20);
        initial = { query: q, groups: r.groups, total: r.total, entries: r.entries, totalPages: r.totalPages };
    }
    const { foodCount } = getDbInfo();

    return (
        <main className="container explore">
            <LegacyPlannerRedirect />
            <section className="explore-hero" aria-labelledby="home-title">
                <h1 id="home-title">What&apos;s in your food?</h1>
                <p className="explore-tagline">{SITE_TAGLINE}</p>
            </section>

            <FoodSearch initial={initial} foodCount={foodCount}>
                <BrowseSections />
            </FoodSearch>
        </main>
    );
}

/** What the home page offers before anyone types. */
async function BrowseSections() {
    const [popular, categories] = await Promise.all([getTopHits(POPULAR_QUERIES), getCategories()]);
    const counts = new Map(categories.map(c => [c.category, c.count]));

    return (
        <div className="explore-browse">
            <section aria-labelledby="popular-title">
                <h2 className="browse-title" id="popular-title">Popular foods</h2>
                <ul className="food-grid">
                    {popular.map(food => <li key={food.id}><FoodCard food={food} /></li>)}
                </ul>
            </section>

            <section aria-labelledby="categories-title">
                <div className="browse-head">
                    <h2 className="browse-title" id="categories-title">Browse by category</h2>
                    <Link href="/food/category" className="small browse-more">All categories <Icon name="arrowRight" size={14} /></Link>
                </div>
                <ul className="chip-list">
                    {HOME_CATEGORIES.filter(c => counts.has(c.category)).map(c => (
                        <li key={c.category}>
                            <Link href={`/food/category/${categorySlug(c.category)}`} className="chip chip-btn">
                                {c.label} <span className="muted tabular">{counts.get(c.category)}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            </section>

            <section aria-labelledby="nutrients-title">
                <div className="browse-head">
                    <h2 className="browse-title" id="nutrients-title">Best sources of</h2>
                    <Link href="/nutrients" className="small browse-more">All nutrients <Icon name="arrowRight" size={14} /></Link>
                </div>
                <ul className="chip-list">
                    {NUTRIENT_SHORTCUTS.map(key => (
                        <li key={key}>
                            <Link href={`/nutrients/${nutrientSlug(key)}`} className="chip chip-btn">{nutrientName(key).replace(/ \(.*\)$/, '')}</Link>
                        </li>
                    ))}
                </ul>
            </section>

            <section className="plan-cta" aria-labelledby="plan-title">
                <div>
                    <h2 className="browse-title" id="plan-title">Planning a whole day?</h2>
                    <p className="small secondary">Pick foods you like, set your goals, and get amounts in grams and household servings that meet them.</p>
                </div>
                <PlanNudge />
            </section>
        </div>
    );
}
