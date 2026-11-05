import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCategories, getFoodsInCategory } from '@/lib/db';
import FoodResultRow from '@/components/explore/FoodResultRow';
import Icon from '@/components/ui/Icon';

const PAGE_SIZE = 40;

async function findCategory(slug: string) {
    return (await getCategories()).find(c => c.slug === slug) ?? null;
}

function pageParam(v: string | string[] | undefined): number {
    const n = Number.parseInt((Array.isArray(v) ? v[0] : v) ?? '1', 10);
    return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

export async function generateMetadata({ params, searchParams }: PageProps<'/food/category/[slug]'>): Promise<Metadata> {
    const { slug } = await params;
    const cat = await findCategory(slug);
    if (!cat) return { title: 'Category not found', robots: { index: false } };
    const page = pageParam((await searchParams).page);
    const path = `/food/category/${slug}${page > 1 ? `?page=${page}` : ''}`;
    const title = `${cat.category}: nutrition facts${page > 1 ? ` (page ${page})` : ''}`;
    const description = `Calories, protein, vitamins and minerals for ${cat.count.toLocaleString('en-US')} foods in ${cat.category}, per realistic serving, from USDA FoodData Central.`;
    return { title, description, alternates: { canonical: path }, openGraph: { title, description, url: path } };
}

export default async function CategoryPage({ params, searchParams }: PageProps<'/food/category/[slug]'>) {
    const { slug } = await params;
    const cat = await findCategory(slug);
    if (!cat) notFound();
    const page = pageParam((await searchParams).page);
    const result = await getFoodsInCategory(cat.category, page, PAGE_SIZE);
    if (page > 1 && result.foods.length === 0) notFound();
    const href = (p: number) => `/food/category/${slug}${p > 1 ? `?page=${p}` : ''}`;

    return (
        <main className="container food-page">
            <nav aria-label="Breadcrumb" className="breadcrumb">
                <ol>
                    <li><Link href="/">Foods</Link></li>
                    <li><Link href="/food/category">Categories</Link></li>
                    <li aria-current="page">{cat.category}</li>
                </ol>
            </nav>
            <header className="food-head">
                <h1>{cat.category}</h1>
                <p className="small secondary">{result.total.toLocaleString('en-US')} foods, USDA&apos;s newest measurements first.{result.totalPages > 1 && ` Page ${result.page} of ${result.totalPages}.`}</p>
            </header>
            <section className="panel" aria-label={`Foods in ${cat.category}`}>
                <ul className="result-list">
                    {result.foods.map(f => <FoodResultRow key={f.id} food={f} />)}
                </ul>
                {result.totalPages > 1 && (
                    <nav className="pager" aria-label="Pages">
                        {result.page > 1
                            ? <Link href={href(result.page - 1)} className="btn btn-secondary" rel="prev"><Icon name="arrowLeft" size={15} /> Previous</Link>
                            : <span />}
                        <span className="small muted tabular">Page {result.page} of {result.totalPages}</span>
                        {result.page < result.totalPages
                            ? <Link href={href(result.page + 1)} className="btn btn-secondary" rel="next">Next <Icon name="arrowRight" size={15} /></Link>
                            : <span />}
                    </nav>
                )}
            </section>
        </main>
    );
}
