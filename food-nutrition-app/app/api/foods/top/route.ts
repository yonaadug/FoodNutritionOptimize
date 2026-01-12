import { NextResponse } from 'next/server';
import { getTopFoodsByNutrient } from '@/lib/db';
import { NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';

/**
 * GET /api/foods/top
 * Returns top foods ranked by a specific nutrient
 *
 * Query params:
 * - nutrient: Nutrient key (e.g., "protein_g", "vitamin_c_mg")
 * - limit: Optional, max foods to return (default: 50)
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const nutrient = searchParams.get('nutrient');
        const limit = parseInt(searchParams.get('limit') || '50', 10);

        // Validate nutrient parameter against allowed keys
        if (!nutrient || !NUTRIENT_CONFIG[nutrient]) {
            return NextResponse.json(
                { error: 'Invalid nutrient parameter' },
                { status: 400 }
            );
        }

        // Validate limit
        if (isNaN(limit) || limit < 1 || limit > 100) {
            return NextResponse.json(
                { error: 'Limit must be between 1 and 100' },
                { status: 400 }
            );
        }

        const foods = await getTopFoodsByNutrient(nutrient, limit);

        return NextResponse.json({ foods });
    } catch (error) {
        console.error('Error fetching top foods:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
