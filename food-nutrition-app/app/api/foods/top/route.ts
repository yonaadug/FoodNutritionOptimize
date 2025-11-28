import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const nutrient = searchParams.get('nutrient');

    if (!nutrient || !NUTRIENT_CONFIG[nutrient]) {
        return NextResponse.json({ error: 'Invalid nutrient' }, { status: 400 });
    }

    const db = getDb();

    // Safe to interpolate because we validated against NUTRIENT_CONFIG keys
    // We also filter out items with 0 value to keep results relevant
    const stmt = db.prepare(`
        SELECT * FROM foods 
        WHERE ${nutrient} > 0 
        ORDER BY ${nutrient} DESC 
        LIMIT 50
    `);

    try {
        const foods = stmt.all() as any[];

        if (foods.length > 0) {
            const ids = foods.map(f => f.id);
            const placeholders = ids.map(() => '?').join(',');

            const servingStmt = db.prepare(`SELECT * FROM serving_sizes WHERE food_id IN (${placeholders})`);
            const allServings = servingStmt.all(...ids) as any[];

            const servingsMap = new Map<number, any[]>();
            allServings.forEach(s => {
                if (!servingsMap.has(s.food_id)) servingsMap.set(s.food_id, []);
                servingsMap.get(s.food_id)?.push(s);
            });

            foods.forEach(f => {
                f.serving_sizes = servingsMap.get(f.id) || [];
            });
        }

        return NextResponse.json({ foods });
    } catch (error) {
        console.error('Database error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
