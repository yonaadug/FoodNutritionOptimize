// @ts-ignore
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'nutrition.db');

export interface Food {
    id: number;
    fdc_id: number;
    description: string;
    data_type: string;
    food_category: string;
    brand_owner: string | null;
    serving_size: number | null;
    serving_size_unit: string | null;
    calories: number;
    protein_g: number;
    total_fat_g: number;
    carbohydrate_g: number;
    fiber_g: number;
    sugars_g: number;
    saturated_g: number;
    monounsaturated_g: number;
    polyunsaturated_g: number;
    trans_g: number;
    cholesterol_mg: number;
    // Vitamins
    vitamin_a_ug: number;
    vitamin_c_mg: number;
    vitamin_d_ug: number;
    vitamin_e_mg: number;
    vitamin_k_ug: number;
    thiamin_mg: number;
    riboflavin_mg: number;
    niacin_mg: number;
    vitamin_b6_mg: number;
    folate_ug: number;
    vitamin_b12_ug: number;
    pantothenic_acid_mg: number;
    // Minerals
    calcium_mg: number;
    iron_mg: number;
    magnesium_mg: number;
    phosphorus_mg: number;
    potassium_mg: number;
    sodium_mg: number;
    zinc_mg: number;
    copper_mg: number;
    manganese_mg: number;
    selenium_ug: number;
    serving_sizes?: ServingSize[];
}

export interface ServingSize {
    id: number;
    food_id: number;
    label: string;
    weight_g: number;
}

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
