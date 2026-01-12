import sqlite3
import argparse
import logging
import os
from usda_fdc_api import USDAFoodDataCentralAPI

# Configuration
# Paths relative to project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(PROJECT_ROOT, "food-nutrition-app", "nutrition.db")

# Load API key from environment variable or config file
API_KEY = os.environ.get('USDA_API_KEY', '')
if not API_KEY:
    config_path = os.path.join(PROJECT_ROOT, 'config', 'api_keys.txt')
    if os.path.exists(config_path):
        with open(config_path) as f:
            API_KEY = f.read().strip()

def verify_food(fdc_id):
    """Verify a specific food item against the USDA API"""
    print(f"Verifying food ID: {fdc_id}...")
    
    # 1. Fetch from DB
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM foods WHERE fdc_id = ?", (fdc_id,))
        db_row = cursor.fetchone()
        
        if not db_row:
            print(f"ERROR: Food {fdc_id} not found in database.")
            return False
            
        # Get column names
        col_names = [description[0] for description in cursor.description]
        db_data = dict(zip(col_names, db_row))
        conn.close()
        print("  Found in Database.")
        
    except Exception as e:
        print(f"ERROR reading from database: {e}")
        return False

    # 2. Fetch from API
    try:
        api = USDAFoodDataCentralAPI(api_key=API_KEY)
        api_data = api.get_food(fdc_id)
        print("  Fetched from USDA API.")
        
    except Exception as e:
        print(f"ERROR fetching from API: {e}")
        return False

    # 3. Compare
    print("\n--- Comparison ---")
    match = True
    
    # Compare description
    db_desc = db_data.get('description')
    api_desc = api_data.get('description')
    if db_desc != api_desc:
        print(f"MISMATCH: Description\n  DB:  {db_desc}\n  API: {api_desc}")
        match = False
    else:
        print(f"MATCH: Description ({db_desc})")

    # Compare Calories (Nutrient ID 208)
    db_cals = db_data.get('calories')
    api_nutrients = api_data.get('foodNutrients', [])
    api_cals = next((n['amount'] for n in api_nutrients if n['nutrient']['number'] == '208'), 0)
    
    # Allow small float differences
    if abs(db_cals - api_cals) > 0.1:
        print(f"MISMATCH: Calories\n  DB:  {db_cals}\n  API: {api_cals}")
        match = False
    else:
        print(f"MATCH: Calories ({db_cals})")

    print("\n--- Result ---")
    if match:
        print("✅ VERIFICATION PASSED: Database matches API.")
        return True
    else:
        print("❌ VERIFICATION FAILED: Discrepancies found.")
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Verify food data integrity')
    parser.add_argument('fdc_id', type=int, help='FDC ID of the food to verify')
    args = parser.parse_args()
    
    verify_food(args.fdc_id)
