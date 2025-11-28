"""
Ingest data from USDA API into SQLite database
"""

import sqlite3
import json
import os
import argparse
import logging
from usda_fdc_api import USDAFoodDataCentralAPI
from key_nutrients import (
    MACRONUTRIENTS, FATS, VITAMINS, MINERALS, OTHER,
    get_all_key_nutrient_ids
)

DB_PATH = "food-nutrition-app/nutrition.db"
API_KEY = "whVe7UDbKycE3pV1TWxMpyXoU8iIgurZ5IdTXgYP"

def create_database():
    """Create the SQLite database and tables"""
    # Ensure directory exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create foods table
    # We'll store basic info and JSON blobs for complex data if needed, 
    # but for this app, flattened columns are better for querying.
    
    # Dynamically generate columns for vitamins and minerals
    nutrient_columns = []
    
    # Macros
    nutrient_columns.append("calories REAL")
    nutrient_columns.append("protein_g REAL")
    nutrient_columns.append("total_fat_g REAL")
    nutrient_columns.append("carbohydrate_g REAL")
    nutrient_columns.append("fiber_g REAL")
    nutrient_columns.append("sugars_g REAL")
    
    # Fats
    for key, nut in FATS.items():
        col_name = f"{key}_{nut['unit'].lower()}"
        nutrient_columns.append(f"{col_name} REAL")
        
    # Vitamins
    for key, nut in VITAMINS.items():
        col_name = f"{key}_{nut['unit'].lower()}"
        nutrient_columns.append(f"{col_name} REAL")
        
    # Minerals
    for key, nut in MINERALS.items():
        col_name = f"{key}_{nut['unit'].lower()}"
        nutrient_columns.append(f"{col_name} REAL")
        
    nutrient_cols_str = ",\n        ".join(nutrient_columns)
    
    create_table_sql = f"""
    CREATE TABLE IF NOT EXISTS foods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fdc_id INTEGER UNIQUE,
        description TEXT,
        data_type TEXT,
        food_category TEXT,
        brand_owner TEXT,
        serving_size REAL,
        serving_size_unit TEXT,
        {nutrient_cols_str}
    );
    """
    
    cursor.execute(create_table_sql)
    conn.commit()
    return conn

def get_nutrient_value(food_nutrients, nutrient_number):
    """Extract nutrient value"""
    for nutrient in food_nutrients:
        nutrient_info = nutrient.get('nutrient', {})
        number = nutrient_info.get('number') or nutrient.get('nutrientNumber')
        
        if number == nutrient_number:
            val = nutrient.get('amount', 0.0)
            return max(0.0, val)
    return 0.0

def ingest_data(conn, limit=None, specific_items=None):
    """Fetch and insert data"""
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler("ingest.log"),
            logging.StreamHandler()
        ]
    )
    
    api = USDAFoodDataCentralAPI(api_key=API_KEY)
    cursor = conn.cursor()
    
    search_queries = [
        # Fruits
        "apple", "apricot", "avocado", "banana", "blackberry", "blueberry", "cantaloupe", "cherry", "coconut", "cranberry",
        "date", "dragon fruit", "durian", "fig", "grape", "grapefruit", "guava", "jackfruit", "kiwi", "lemon", "lime",
        "lychee", "mango", "melon", "nectarine", "orange", "papaya", "passion fruit", "peach", "pear", "persimmon",
        "pineapple", "plum", "pomegranate", "raspberry", "star fruit", "strawberry", "tangerine", "watermelon",
        
        # Vegetables
        "artichoke", "arugula", "asparagus", "beet", "bell pepper", "bok choy", "broccoli", "brussels sprouts", "cabbage",
        "carrot", "cauliflower", "celery", "chard", "collard greens", "corn", "cucumber", "daikon", "eggplant", "endive",
        "fennel", "garlic", "ginger", "green bean", "kale", "leek", "lettuce", "mushroom", "mustard greens", "okra",
        "onion", "parsnip", "pea", "potato", "pumpkin", "radish", "rutabaga", "scallion", "shallot", "spinach",
        "squash", "sweet potato", "tomatillo", "tomato", "turnip", "watercress", "yam", "zucchini",
        
        # Meat & Poultry
        "chicken breast", "chicken thigh", "turkey breast", "ground beef", "steak", "pork chop", "bacon", "lamb", "duck",
        
        # Fish & Seafood
        "salmon", "tuna", "cod", "shrimp", "crab", "lobster", "scallop", "sardines", "tilapia", "trout",
        
        # Dairy & Eggs
        "milk whole", "milk skim", "cheddar cheese", "mozzarella cheese", "yogurt", "greek yogurt", "butter", "egg", "cream cheese",
        "cottage cheese", "swiss cheese", "parmesan cheese",
        
        # Grains & Legumes
        "rice white", "rice brown", "oats", "quinoa", "bread whole wheat", "bread white", "pasta", "beans black", "beans kidney",
        "lentils", "chickpeas", "almonds", "walnuts", "peanuts", "cashews", "pistachios",
        
        # Beverages (Healthy/Common)
        "coffee black", "tea green", "tea black", "orange juice", "apple juice", "water", "milk soy", "milk almond", "milk oat"
    ]

    # Exclusion list
    excluded_keywords = [
        "baby food", "gerber", "infant", "toddler", "junior",
        "pastry", "doughnut", "donut", "cake", "cookie", "pie", "brownie", "muffin", "cupcake",
        "candy", "chocolate", "syrup", "topping", "frosting",
        "soup", "stew", "casserole", "lasagna", "pizza", "burger", "sandwich" # Exclude complex meals for now
    ]

    if specific_items:
        search_queries = specific_items
    elif limit:
        search_queries = search_queries[:limit]
    
    # Filter for Foundation only to avoid branded junk and legacy data
    data_types = ["Foundation"]
    
    logging.info(f"Starting ingestion of {len(search_queries)} food items...")
    
    for query in search_queries:
        logging.info(f"Searching for: {query}")
        try:
            # Increase page size to get more Foundation foods
            results = api.search_foods(query, data_type=data_types, page_size=25)
            
            if not results.get('foods'):
                logging.warning(f"  No results for {query}")
                continue
                
            for food in results['foods']:
                fdc_id = food['fdcId']
                
                # Filter out unwanted items
                description_lower = food['description'].lower()
                if any(keyword in description_lower for keyword in excluded_keywords):
                    logging.info(f"  Skipping {fdc_id} (excluded keyword in '{food['description']}')")
                    continue

                # Check if exists
                cursor.execute("SELECT 1 FROM foods WHERE fdc_id = ?", (fdc_id,))
                if cursor.fetchone():
                    logging.info(f"  Skipping {fdc_id} (already exists)")
                    continue
                
                # Get full details
                try:
                    details = api.get_food(fdc_id)
                    nutrients = details.get('foodNutrients', [])
                    
                    # Prepare row data
                    
                    # Macros
                    protein = get_nutrient_value(nutrients, '203')
                    fat = get_nutrient_value(nutrients, '204')
                    carbs = get_nutrient_value(nutrients, '205')
                    fiber = get_nutrient_value(nutrients, '291')
                    sugars = get_nutrient_value(nutrients, '269')
                    
                    # Calorie logic: Try kcal -> Atwater Specific -> kJ -> Atwater General
                    calories = get_nutrient_value(nutrients, '208')
                    
                    # If calories are 0, try to calculate them
                    if calories == 0:
                        calculated_calories = 0
                        
                        # 1. Try Atwater Specific Factors
                        conversion_factors = details.get('nutrientConversionFactors', [])
                        atwater_specific = next((f for f in conversion_factors if f.get('type') == '.CalorieConversionFactor'), None)
                        
                        if atwater_specific:
                            p_factor = atwater_specific.get('proteinValue', 4.0)
                            f_factor = atwater_specific.get('fatValue', 9.0)
                            c_factor = atwater_specific.get('carbohydrateValue', 4.0)
                            
                            calculated_calories = (protein * p_factor) + (fat * f_factor) + (carbs * c_factor)
                            if calculated_calories > 0:
                                calories = calculated_calories
                                logging.info(f"  Calculated calories (Atwater Specific) for {fdc_id}: {calories:.1f}")

                        # 2. If still 0, try kJ
                        if calories == 0:
                            kj = get_nutrient_value(nutrients, '268')
                            if kj > 0:
                                calories = kj / 4.184
                        
                        # 3. If still 0, use Atwater General Factors (4-9-4)
                        if calories == 0:
                            calories = (protein * 4) + (carbs * 4) + (fat * 9)
                            if calories > 0:
                                logging.info(f"  Calculated calories (Atwater General) for {fdc_id}: {calories:.1f}")

                    row_data = {
                        'fdc_id': fdc_id,
                        'description': details.get('description'),
                        'data_type': details.get('dataType'),
                        'food_category': details.get('foodCategory', {}).get('description', 'N/A') if isinstance(details.get('foodCategory'), dict) else details.get('foodCategory', 'N/A'),
                        'brand_owner': details.get('brandOwner'),
                        'serving_size': details.get('servingSize'),
                        'serving_size_unit': details.get('servingSizeUnit'),
                        
                        # Macros
                        'calories': calories,
                        'protein_g': protein,
                        'total_fat_g': fat,
                        'carbohydrate_g': carbs,
                        'fiber_g': fiber,
                        'sugars_g': sugars,
                    }
                    
                    # Fats
                    for key, nut in FATS.items():
                        row_data[f"{key}_{nut['unit'].lower()}"] = get_nutrient_value(nutrients, nut['number'])
                        
                    # Vitamins
                    for key, nut in VITAMINS.items():
                        row_data[f"{key}_{nut['unit'].lower()}"] = get_nutrient_value(nutrients, nut['number'])
                        
                    # Minerals
                    for key, nut in MINERALS.items():
                        row_data[f"{key}_{nut['unit'].lower()}"] = get_nutrient_value(nutrients, nut['number'])

                    # --- SR Legacy Fallback ---
                    ndb_number = details.get('ndbNumber')
                    if ndb_number:
                        try:
                            logging.info(f"  Checking SR Legacy for NDB {ndb_number}...")
                            legacy_results = api.search_foods(str(ndb_number), data_type=["SR Legacy"], page_size=1)
                            
                            if legacy_results.get('foods'):
                                legacy_food_summary = legacy_results['foods'][0]
                                legacy_fdc_id = legacy_food_summary['fdcId']
                                logging.info(f"    Found Legacy match: {legacy_fdc_id} ({legacy_food_summary['description'][:30]}...)")
                                
                                legacy_details = api.get_food(legacy_fdc_id)
                                legacy_nutrients = legacy_details.get('foodNutrients', [])
                                
                                # Check for missing values in row_data and fill from legacy
                                enriched_count = 0
                                
                                # Helper to check and fill
                                def fill_if_missing(key, nutrient_number):
                                    nonlocal enriched_count
                                    if row_data.get(key, 0) == 0:
                                        legacy_val = get_nutrient_value(legacy_nutrients, nutrient_number)
                                        if legacy_val > 0:
                                            row_data[key] = legacy_val
                                            enriched_count += 1
                                            # logging.info(f"      Enriched {key} with {legacy_val}")

                                # Macros
                                fill_if_missing('protein_g', '203')
                                fill_if_missing('total_fat_g', '204')
                                fill_if_missing('carbohydrate_g', '205')
                                fill_if_missing('fiber_g', '291')
                                fill_if_missing('sugars_g', '269')
                                
                                # Fats
                                for key, nut in FATS.items():
                                    fill_if_missing(f"{key}_{nut['unit'].lower()}", nut['number'])
                                    
                                # Vitamins
                                for key, nut in VITAMINS.items():
                                    fill_if_missing(f"{key}_{nut['unit'].lower()}", nut['number'])
                                    
                                # Minerals
                                for key, nut in MINERALS.items():
                                    fill_if_missing(f"{key}_{nut['unit'].lower()}", nut['number'])
                                    
                                if enriched_count > 0:
                                    logging.info(f"    Enriched {enriched_count} nutrients from SR Legacy")
                                    
                        except Exception as e:
                            logging.warning(f"    Failed to fetch/process SR Legacy data: {e}")
                    # --------------------------
                    
                    # Construct INSERT statement dynamically
                    columns = ', '.join(row_data.keys())
                    placeholders = ', '.join(['?'] * len(row_data))
                    sql = f"INSERT INTO foods ({columns}) VALUES ({placeholders})"
                    
                    cursor.execute(sql, list(row_data.values()))
                    logging.info(f"  Inserted: {row_data['description'][:50]}")
                    
                except Exception as e:
                    logging.error(f"  Error processing {fdc_id}: {e}")
                    
            conn.commit()
            
        except Exception as e:
            logging.error(f"  Error searching {query}: {e}")

    logging.info("Ingestion complete.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Ingest food data from USDA API')
    parser.add_argument('--limit', type=int, help='Limit the number of items to process')
    parser.add_argument('--items', nargs='+', help='Specific items to ingest')
    
    args = parser.parse_args()
    
    conn = create_database()
    ingest_data(conn, limit=args.limit, specific_items=args.items)
    conn.close()
