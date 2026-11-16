import type { Metadata } from 'next';
import IntentLink from '@/components/ui/IntentLink';
import { connection } from 'next/server';
import { sortableNutrients } from '@/lib/db';
import { nutrientName, nutrientSlug, nutrientUnitOf, dailyValueOf, fmt } from '@/lib/food-page';

export const metadata: Metadata = {
    title: 'Best food sources of every nutrient',
    description: 'Find the best everyday food sources of each vitamin and mineral, ranked by a realistic serving, using USDA data.',
    alternates: { canonical: '/nutrients' },
};

export default async function NutrientsPage() {
    await connection();
    const keys = sortableNutrients().filter(k => k !== 'calories');
    return (
        <main className="container food-page">
            <nav aria-label="Breadcrumb" className="breadcrumb">
                <ol>
                    <li><IntentLink href="/">Foods</IntentLink></li>
                    <li aria-current="page">Nutrients</li>
                </ol>
            </nav>
            <header className="food-head">
                <h1>Best food sources of every nutrient</h1>
                <p className="small secondary">Everyday foods, ranked by what a realistic serving provides.</p>
            </header>
            <ul className="category-list">
                {keys.map(k => {
                    const dv = dailyValueOf(k);
                    return (
                        <li key={k}>
                            <IntentLink href={`/nutrients/${nutrientSlug(k)}`}>
                                <span>{nutrientName(k)}</span>
                                {dv !== null && <span className="muted tabular small">{fmt(dv)} {nutrientUnitOf(k)} a day</span>}
                            </IntentLink>
                        </li>
                    );
                })}
            </ul>
        </main>
    );
}
