import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBestSources, sortableNutrients } from '@/lib/db';
import { dailyValueOf, fmt, nutrientKeyFromSlug, nutrientName, nutrientUnitOf } from '@/lib/food-page';
import FoodResultRow from '@/components/explore/FoodResultRow';

const LIMIT = 40;

function resolve(slug: string): string | null {
    return nutrientKeyFromSlug(slug, sortableNutrients().filter(k => k !== 'calories'));
}

const plainName = (key: string) => nutrientName(key).replace(/ \(.*\)$/, '');

export async function generateMetadata({ params, searchParams }: PageProps<'/nutrients/[key]'>): Promise<Metadata> {
    const { key: slug } = await params;
    const key = resolve(slug);
    if (!key) return { title: 'Nutrient not found', robots: { index: false } };
    const all = (await searchParams).all === '1';
    const name = plainName(key);
    const title = `Foods high in ${name}`;
    const description = `The best everyday food sources of ${name}, ranked by a realistic serving, with % Daily Value. USDA FoodData Central data.`;
    return {
        title,
        description,
        alternates: { canonical: `/nutrients/${slug}` },
        openGraph: { title, description, url: `/nutrients/${slug}` },
        ...(all ? { robots: { index: false, follow: true } } : {}),
    };
}

export default async function NutrientPage({ params, searchParams }: PageProps<'/nutrients/[key]'>) {
    const { key: slug } = await params;
    const key = resolve(slug);
    if (!key) notFound();
    const all = (await searchParams).all === '1';
    const foods = await getBestSources(key, { limit: LIMIT, everyday: !all });
    const name = plainName(key);
    const unit = nutrientUnitOf(key);
    const dv = dailyValueOf(key);

    return (
        <main className="container food-page">
            <nav aria-label="Breadcrumb" className="breadcrumb">
                <ol>
                    <li><Link href="/">Foods</Link></li>
                    <li><Link href="/nutrients">Nutrients</Link></li>
                    <li aria-current="page">{name}</li>
                </ol>
            </nav>
            <header className="food-head">
                <h1>Foods high in {name}</h1>
                <p className="small secondary">
                    {dv !== null && <>Daily Value: {fmt(dv)} {unit}. </>}
                    {all
                        ? 'Every food, ranked by a typical serving, including supplements, powders, organ meats and other specialty items.'
                        : 'Ranked by a typical serving, with familiar, well-measured foods first.'}
                    {' '}
                    <Link href={all ? `/nutrients/${slug}` : `/nutrients/${slug}?all=1`}>{all ? 'Everyday foods only' : 'Include specialty foods'}</Link>
                </p>
            </header>
            <section className="panel" aria-label={`Foods high in ${name}`}>
                {foods.length === 0 ? (
                    <p className="muted">No foods have data for {name} yet.</p>
                ) : (
                    <ol className="result-list">
                        {foods.map(f => (
                            <FoodResultRow key={f.id} food={f} highlight={{
                                value: `${fmt(f.best.perServing)} ${unit}`,
                                sub: `${dv !== null ? `${fmt(f.best.perServing / dv * 100, 0)}% DV · ` : ''}per ${f.best.servingLabel}`,
                            }} />
                        ))}
                    </ol>
                )}
            </section>
        </main>
    );
}
