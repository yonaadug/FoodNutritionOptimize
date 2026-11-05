'use client';

import { useCallback } from 'react';
import RecipeAnalyzer from './RecipeAnalyzer';
import type { AnalyzedRecipe } from '@/lib/recipes/types';

/**
 * The one place that decides what happens to a finished analysis.
 *
 * `recipe` is plain JSON with a title and a stable `id`. This runs after the first
 * read and again, debounced, after edits, with the same id: treat it as an upsert.
 * Recent analyses are already kept in localStorage for anonymous visitors.
 *
 * TODO(coordinator, after the accounts merge): save to the signed-in user's history here.
 */
export default function RecipesPage() {
    const onRecipeAnalyzed = useCallback((recipe: AnalyzedRecipe) => {
        void recipe;
    }, []);

    return <RecipeAnalyzer onRecipeAnalyzed={onRecipeAnalyzed} />;
}
