import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { getCategories } from '@/lib/db';

export const metadata: Metadata = {
    title: 'Browse foods by category',
    description: 'Every food category in the USDA FoodData Central data: vegetables, fruits, fish, meats, dairy, grains and more.',
    alternates: { canonical: '/food/category' },
};

export default async function CategoriesPage() {
    await connection();
    const categories = await getCategories();
    return (
        <main className="container food-page">
            <nav aria-label="Breadcrumb" className="breadcrumb">
                <ol>
                    <li><Link href="/">Foods</Link></li>
                    <li aria-current="page">Categories</li>
                </ol>
            </nav>
            <header className="food-head">
                <h1>Browse foods by category</h1>
            </header>
            <ul className="category-list">
                {categories.map(c => (
                    <li key={c.slug}>
                        <Link href={`/food/category/${c.slug}`}>
                            <span>{c.category}</span>
                            <span className="muted tabular small">{c.count.toLocaleString('en-US')}</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </main>
    );
}
