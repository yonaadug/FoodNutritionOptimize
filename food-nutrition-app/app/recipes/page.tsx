import type { Metadata } from 'next';
import RecipesPage from '@/components/recipes/RecipesPage';

export const metadata: Metadata = {
    title: 'Recipe nutrition calculator',
    description: 'Paste a recipe or take a photo to see its calories, vitamins and minerals per serving, from USDA data. Correct any ingredient and the totals update.',
    alternates: { canonical: '/recipes' },
};

export default function Page() {
    return <RecipesPage />;
}
