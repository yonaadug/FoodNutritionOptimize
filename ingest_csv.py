import csv
import sqlite3
import os
import logging
from key_nutrients import (
    FATS, VITAMINS, MINERALS
)
from usda_fdc_api import USDAFoodDataCentralAPI
import time

# Configuration
CSV_DIR = "FoodData_Central_foundation_food_csv_2025-04-24"
DB_PATH = "nutrition_download.db"
API_KEY = "whVe7UDbKycE3pV1TWxMpyXoU8iIgurZ5IdTXgYP"

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

def create_database():
    """Create the SQLite database and tables"""
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
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

    # Create serving_sizes table
    create_serving_table_sql = """
    CREATE TABLE IF NOT EXISTS serving_sizes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        food_id INTEGER,
        label TEXT,
        weight_g REAL,
        FOREIGN KEY(food_id) REFERENCES foods(id)
    );
    """
    cursor.execute(create_serving_table_sql)
    
    conn.commit()
    return conn

def load_reference_data():
    """Load nutrient definitions and categories"""
    logging.info("Loading reference data...")
    
    # Load Categories
    categories = {}
    with open(os.path.join(CSV_DIR, 'food_category.csv'), 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            categories[row['id']] = row['description']
            
    # Load Nutrients (map ID to nutrient number)
    nutrients = {}
    with open(os.path.join(CSV_DIR, 'nutrient.csv'), 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            nutrients[row['id']] = row['nutrient_nbr']
            
    return categories, nutrients

def load_measure_units():
    """Load measure units"""
    units = {}
    path = os.path.join(CSV_DIR, 'measure_unit.csv')
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                units[row['id']] = row['name']
    return units

def load_serving_sizes(measure_units):
    """Load serving sizes from food_portion.csv"""
    logging.info("Loading serving sizes...")
    servings = {} # fdc_id -> list of {label, weight_g}
    
    path = os.path.join(CSV_DIR, 'food_portion.csv')
    if not os.path.exists(path):
        return servings
        
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            fdc_id = int(row['fdc_id'])
            amount = row['amount']
            unit_id = row['measure_unit_id']
            unit_name = measure_units.get(unit_id, '')
            desc = row['portion_description']
            modifier = row['modifier']
            weight = float(row['gram_weight'])
            
            # Construct label
            label_parts = []
            if amount:
                # Clean up .0 for integers
                if amount.endswith('.0'):
                    label_parts.append(amount[:-2])
                else:
                    label_parts.append(amount)
            
            if unit_name:
                label_parts.append(unit_name)
                
            if modifier:
                label_parts.append(modifier)
                
            if desc and desc != modifier: # Avoid duplication
                label_parts.append(f"({desc})")
                
            label = " ".join(label_parts)
            if not label:
                label = "Serving"
                
            if fdc_id not in servings:
                servings[fdc_id] = []
                
            servings[fdc_id].append({
                'label': label,
                'weight_g': weight
            })
            
    return servings

def load_foundation_metadata():
    """Load metadata from foundation_food.csv to get NDB numbers"""
    logging.info("Loading foundation metadata...")
    metadata = {} # fdc_id -> ndb_number
    
    path = os.path.join(CSV_DIR, 'foundation_food.csv')
    if not os.path.exists(path):
        logging.warning(f"Metadata file not found: {path}")
        return metadata
        
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['NDB_number']:
                metadata[int(row['fdc_id'])] = row['NDB_number']
                
    return metadata

def get_nutrient_column_map():
    """Map nutrient numbers to database columns"""
    mapping = {
        '203': 'protein_g',
        '204': 'total_fat_g',
        '205': 'carbohydrate_g',
        '291': 'fiber_g',
        '269': 'sugars_g',
        '208': 'calories', # Atwater Specific
        '957': 'calories', # Atwater General
        '958': 'calories', # Atwater Specific (alternative)
        '268': 'calories_kj' # Intermediate for calculation
    }
    
    for key, nut in FATS.items():
        mapping[nut['number']] = f"{key}_{nut['unit'].lower()}"
    for key, nut in VITAMINS.items():
        mapping[nut['number']] = f"{key}_{nut['unit'].lower()}"
    for key, nut in MINERALS.items():
        mapping[nut['number']] = f"{key}_{nut['unit'].lower()}"
        
    return mapping

def ingest_csv_data():
    conn = create_database()
    cursor = conn.cursor()
    
    categories, nutrient_map_id_to_nbr = load_reference_data()
    foundation_metadata = load_foundation_metadata()
    column_map = get_nutrient_column_map()
    measure_units = load_measure_units()
    serving_sizes_map = load_serving_sizes(measure_units)
    
    # Initialize API
    api = USDAFoodDataCentralAPI(api_key=API_KEY)
    
    # 1. Identify Foundation Foods
    logging.info("Identifying Foundation foods...")
    foundation_foods = {} # fdc_id -> {basic info}
    
    with open(os.path.join(CSV_DIR, 'food.csv'), 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Check data type (csv value might be 'foundation_food' or 'Foundation')
            # Based on header check earlier: "319874","sample_food"...
            # We need to check what the foundation type string is. 
            # Assuming 'foundation_food' based on filename, but let's be broad.
            if 'foundation' in row['data_type'].lower():
                fdc_id = int(row['fdc_id'])
                foundation_foods[fdc_id] = {
                    'fdc_id': fdc_id,
                    'description': row['description'],
                    'data_type': row['data_type'],
                    'food_category': categories.get(row['food_category_id'], 'N/A'),
                    'brand_owner': None, # Not in basic food.csv for foundation usually
                    'serving_size': 100.0, # Default for foundation
                    'serving_size_unit': 'g',
                    'nutrients': {}, # Will populate next
                    'ndb_number': foundation_metadata.get(fdc_id)
                }
                
    logging.info(f"Found {len(foundation_foods)} Foundation foods.")
    
    # 2. Load Nutrients
    logging.info("Loading nutrient data...")
    with open(os.path.join(CSV_DIR, 'food_nutrient.csv'), 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            fdc_id = row['fdc_id']
            if fdc_id in foundation_foods:
                nut_id = row['nutrient_id']
                amount = float(row['amount']) if row['amount'] else 0.0
                
                if nut_id in nutrient_map_id_to_nbr:
                    nut_nbr = nutrient_map_id_to_nbr[nut_id]
                    
                    # Store by nutrient number for easier processing
                    foundation_foods[fdc_id]['nutrients'][nut_nbr] = amount

    # 3. Process and Insert
    logging.info("Processing and inserting data...")
    count = 0
    
    for fdc_id, food in foundation_foods.items():
        # Prepare row
        row_data = {
            'fdc_id': food['fdc_id'],
            'description': food['description'],
            'data_type': food['data_type'],
            'food_category': food['food_category'],
            'brand_owner': food['brand_owner'],
            'serving_size': food['serving_size'],
            'serving_size_unit': food['serving_size_unit']
        }
        
        # Fill nutrients
        nutrients = food['nutrients']
        
        # Initialize all columns to 0
        for col in column_map.values():
            if col != 'calories_kj':
                row_data[col] = 0.0
                
        # Map values
        calories_val = 0.0
        
        for nut_nbr, amount in nutrients.items():
            if nut_nbr in column_map:
                col = column_map[nut_nbr]
                
                # Special handling for calories
                if col == 'calories':
                    # Priority logic: 208 > 957/958
                    # If we already have a value from 208, don't overwrite with 957
                    if nut_nbr == '208':
                        row_data['calories'] = amount
                    elif nut_nbr in ['957', '958'] and row_data.get('calories', 0) == 0:
                        row_data['calories'] = amount
                elif col == 'calories_kj':
                    # Store for fallback calculation
                    if row_data.get('calories', 0) == 0:
                         row_data['calories'] = amount / 4.184
                else:
                    row_data[col] = amount

        # --- SR Legacy Fallback ---
        # Check if we are missing ANY key nutrients and have an NDB number
        # Key nutrients: Calories, Protein, Fat, Carbs, Vitamins, Minerals
        # We define "missing" as 0 (which is the default if not found in CSV)
        
        missing_key_nutrient = False
        missing_nutrient_name = ""
        
        # List of critical columns to check
        critical_cols = [
            'calories', 'protein_g', 'total_fat_g', 'carbohydrate_g',
            'calcium_mg', 'iron_mg', 'magnesium_mg', 'potassium_mg', 'sodium_mg', 'zinc_mg',
            'vitamin_a_rae_mcg', 'vitamin_c_mg', 'vitamin_d_ug', 'vitamin_e_mg', 'vitamin_b12_mcg', 'folate_mcg'
        ]
        
        for col in critical_cols:
            if row_data.get(col, 0) == 0:
                missing_key_nutrient = True
                missing_nutrient_name = col
                break
        
        if missing_key_nutrient and food.get('ndb_number'):
            ndb_number = food['ndb_number']
            logging.info(f"  Missing {missing_nutrient_name} for {food['description']}. Checking SR Legacy (NDB {ndb_number})...")
            
            try:
                # Search for the NDB number in SR Legacy
                results = api.search_foods(str(ndb_number), data_type=["SR Legacy"], page_size=1)
                if results and results.get('foods'):
                    legacy_food = results['foods'][0]
                    logging.info(f"    Found SR Legacy match: {legacy_food['description']}")
                    
                    # Get full details for the legacy food to get nutrients
                    legacy_details = api.get_food(legacy_food['fdcId'])
                    
                    if legacy_details and legacy_details.get('foodNutrients'):
                        # Merge nutrients
                        for n in legacy_details['foodNutrients']:
                            # API returns 'nutrient' object with 'number'
                            # or sometimes just 'nutrientNumber' depending on endpoint
                            # get_food_details returns 'nutrient' object inside
                            nut_obj = n.get('nutrient', {})
                            nut_nbr = nut_obj.get('number')
                            amount = n.get('amount', 0)
                            
                            if nut_nbr and nut_nbr in column_map:
                                col = column_map[nut_nbr]
                                if col == 'calories_kj':
                                    continue
                                    
                                # Only fill if currently 0
                                if row_data.get(col, 0) == 0:
                                    row_data[col] = amount
                                    # logging.info(f"      Filled {col}: {amount}")
                                    
                        logging.info("    Merged SR Legacy nutrients.")

                        # Merge SR Legacy portions if we don't have any
                        if fdc_id not in serving_sizes_map and legacy_details.get('foodPortions'):
                            legacy_portions = []
                            for p in legacy_details['foodPortions']:
                                amount = p.get('amount')
                                modifier = p.get('modifier')
                                unit_name = p.get('measureUnit', {}).get('name')
                                gram_weight = p.get('gramWeight')
                                
                                if not gram_weight:
                                    continue

                                # Construct label
                                label_parts = []
                                if amount:
                                    # Clean up .0
                                    amt_str = str(amount)
                                    if amt_str.endswith('.0'):
                                        amt_str = amt_str[:-2]
                                    label_parts.append(amt_str)
                                
                                if modifier:
                                    label_parts.append(modifier)
                                elif unit_name and unit_name != 'undetermined':
                                    label_parts.append(unit_name)
                                
                                label = " ".join(label_parts)
                                if not label:
                                    label = "Serving"
                                    
                                legacy_portions.append({
                                    'label': label,
                                    'weight_g': gram_weight
                                })
                            
                            if legacy_portions:
                                serving_sizes_map[fdc_id] = legacy_portions
                                logging.info(f"    Merged {len(legacy_portions)} SR Legacy portions.")
                    
            except Exception as e:
                logging.error(f"    Error fetching SR Legacy data: {e}")

        # Final calorie fallback (Atwater General)
        if row_data.get('calories', 0) == 0:
            p = row_data.get('protein_g', 0)
            c = row_data.get('carbohydrate_g', 0)
            f = row_data.get('total_fat_g', 0)
            row_data['calories'] = (p * 4) + (c * 4) + (f * 9)

        # Construct INSERT
        columns = ', '.join(row_data.keys())
        placeholders = ', '.join(['?'] * len(row_data))
        sql = f"INSERT INTO foods ({columns}) VALUES ({placeholders})"
        
        cursor.execute(sql, list(row_data.values()))
        count += 1
        
        if count % 1000 == 0:
            logging.info(f"Processed {count} items...")
            
    # 4. Insert Serving Sizes
    logging.info("Inserting serving sizes...")
    
    # Get mapping of fdc_id -> food_id
    cursor.execute("SELECT fdc_id, id FROM foods")
    fdc_to_id = {row[0]: row[1] for row in cursor.fetchall()}
    
    serving_count = 0
    
    # Ensure every food has at least one serving size
    for fdc_id in foundation_foods.keys():
        if fdc_id not in serving_sizes_map:
            serving_sizes_map[fdc_id] = [{
                'label': '100g serving',
                'weight_g': 100.0
            }]
            
    for fdc_id, servings in serving_sizes_map.items():
        if fdc_id in fdc_to_id:
            food_id = fdc_to_id[fdc_id]
            for s in servings:
                cursor.execute(
                    "INSERT INTO serving_sizes (food_id, label, weight_g) VALUES (?, ?, ?)",
                    (food_id, s['label'], s['weight_g'])
                )
                serving_count += 1
                
    logging.info(f"Inserted {serving_count} serving sizes.")
            
    conn.commit()
    conn.close()
    logging.info(f"Ingestion complete. Inserted {count} items into {DB_PATH}.")

if __name__ == "__main__":
    ingest_csv_data()
