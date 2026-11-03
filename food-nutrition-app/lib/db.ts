// @ts-ignore
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'nutrition.db');

import type { Food, ServingSize } from './food-types';
export type { Food, ServingSize } from './food-types';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
    if (!db) {
        console.log(`Opening database at ${dbPath}`);
        db = new Database(dbPath, { verbose: console.log });
    }
    return db;
}

export interface SearchResult {
    foods: Food[];
    total: number;
    page: number;
    totalPages: number;
}

/**
 * Attaches serving sizes to an array of foods
 * @param foods Array of foods to attach serving sizes to
 * @param database Database instance
 */
function attachServingSizes(foods: Food[], database: Database.Database): void {
    if (foods.length === 0) return;

    const ids = foods.map(f => f.id);
    const placeholders = ids.map(() => '?').join(',');

    const servingStmt = database.prepare(`SELECT * FROM serving_sizes WHERE food_id IN (${placeholders})`);
    const allServings = servingStmt.all(...ids) as ServingSize[];

    const servingsMap = new Map<number, ServingSize[]>();
    allServings.forEach(s => {
        if (!servingsMap.has(s.food_id)) servingsMap.set(s.food_id, []);
        servingsMap.get(s.food_id)?.push(s);
    });

    foods.forEach(f => {
        f.serving_sizes = servingsMap.get(f.id) || [];
    });
}

export async function searchFoods(query: string, page: number = 1, limit: number = 20): Promise<SearchResult> {
    const database = getDb();
    const offset = (page - 1) * limit;

    // Get total count
    const countStmt = database.prepare(`
        SELECT COUNT(*) as count
        FROM foods
        WHERE description LIKE ?
    `);
    const total = (countStmt.get(`%${query}%`) as { count: number }).count;

    // Get paginated results
    // Ordering by length of description helps surface exact matches or simpler items first
    const stmt = database.prepare(`
        SELECT * FROM foods
        WHERE description LIKE ?
        ORDER BY length(description) ASC, description ASC
        LIMIT ? OFFSET ?
    `);

    const foods = stmt.all(`%${query}%`, limit, offset) as Food[];
    attachServingSizes(foods, database);

    return {
        foods,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    };
}

export async function getFoodById(id: number): Promise<Food | undefined> {
    const database = getDb();
    const stmt = database.prepare('SELECT * FROM foods WHERE id = ?');
    const food = stmt.get(id) as Food | undefined;

    if (food) {
        const servings = database.prepare('SELECT * FROM serving_sizes WHERE food_id = ?').all(id) as ServingSize[];
        food.serving_sizes = servings;
    }

    return food;
}

export async function getFoodsByIds(ids: number[]): Promise<Food[]> {
    if (ids.length === 0) return [];

    const database = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const stmt = database.prepare(`SELECT * FROM foods WHERE id IN (${placeholders})`);

    const foods = stmt.all(...ids) as Food[];
    attachServingSizes(foods, database);

    return foods;
}

/**
 * Gets top foods ranked by a specific nutrient
 * @param nutrient Nutrient key (must be a valid column name)
 * @param limit Maximum number of foods to return
 * @returns Array of foods sorted by nutrient content (descending)
 */
export async function getTopFoodsByNutrient(nutrient: string, limit: number = 50): Promise<Food[]> {
    const database = getDb();

    // Query only foods with non-zero nutrient values to keep results relevant
    // Note: nutrient parameter must be validated against NUTRIENT_CONFIG before calling
    const stmt = database.prepare(`
        SELECT * FROM foods
        WHERE ${nutrient} > 0
        ORDER BY ${nutrient} DESC
        LIMIT ?
    `);

    const foods = stmt.all(limit) as Food[];
    attachServingSizes(foods, database);

    return foods;
}
