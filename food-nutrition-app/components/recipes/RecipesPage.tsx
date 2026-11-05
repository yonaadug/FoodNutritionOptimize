'use client';

import { useCallback } from 'react';
import RecipeAnalyzer from './RecipeAnalyzer';
import { recordHistory } from '@/lib/auth/client';
import { recipeHistoryItem } from '@/lib/recipes/history';
import type { AnalyzedRecipe } from '@/lib/recipes/types';

/**
 * The one place that decides what happens to a finished analysis.
 *
 * `recipe` is plain JSON with a title and a stable `id`. This runs after the first
 * read and again, debounced, after edits, with the same id: an upsert in the
 * signed-in person's history, which does nothing for anonymous visitors. Their recent
 * analyses are kept in localStorage by the analyzer itself.
 */
export default function RecipesPage() {
    const onRecipeAnalyzed = useCallback((recipe: AnalyzedRecipe) => {
        void recordHistory(recipeHistoryItem(recipe));
    }, []);

    return <RecipeAnalyzer onRecipeAnalyzed={onRecipeAnalyzed} />;
}
