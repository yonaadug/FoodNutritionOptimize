/**
 * What the home page offers before anyone types. Popular foods are search
 * queries, not ids, so they survive a database rebuild.
 */

export const POPULAR_QUERIES = [
    'egg', 'salmon', 'banana', 'spinach', 'oats', 'greek yogurt',
    'almonds', 'chicken breast', 'lentils', 'broccoli', 'sweet potato', 'avocado',
] as const;

/** Friendly names for the everyday USDA categories (the rest are listed at /food/category). */
export const HOME_CATEGORIES: { label: string; category: string }[] = [
    { label: 'Vegetables', category: 'Vegetables and Vegetable Products' },
    { label: 'Fruits', category: 'Fruits and Fruit Juices' },
    { label: 'Fish & shellfish', category: 'Finfish and Shellfish Products' },
    { label: 'Poultry', category: 'Poultry Products' },
    { label: 'Beef', category: 'Beef Products' },
    { label: 'Pork', category: 'Pork Products' },
    { label: 'Dairy & eggs', category: 'Dairy and Egg Products' },
    { label: 'Beans & legumes', category: 'Legumes and Legume Products' },
    { label: 'Nuts & seeds', category: 'Nut and Seed Products' },
    { label: 'Grains & pasta', category: 'Cereal Grains and Pasta' },
    { label: 'Breakfast cereals', category: 'Breakfast Cereals' },
    { label: 'Baked goods', category: 'Baked Products' },
    { label: 'Oils & fats', category: 'Fats and Oils' },
    { label: 'Snacks', category: 'Snacks' },
    { label: 'Beverages', category: 'Beverages' },
    { label: 'Spices & herbs', category: 'Spices and Herbs' },
];

/** "Best sources of..." shortcuts, by nutrient column. */
export const NUTRIENT_SHORTCUTS = [
    'protein_g', 'fiber_g', 'vitamin_d_ug', 'iron_mg', 'calcium_mg', 'potassium_mg',
    'magnesium_mg', 'vitamin_c_mg', 'vitamin_b12_ug', 'folate_ug', 'zinc_mg', 'choline_mg',
] as const;
