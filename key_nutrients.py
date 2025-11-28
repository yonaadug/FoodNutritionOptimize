"""
Key Nutrients Reference
Contains the most important nutrients from the USDA FoodData Central API
for nutrition tracking and analysis.

Usage:
    from key_nutrients import MACRONUTRIENTS, VITAMINS, MINERALS

    # Get specific nutrients for API requests
    protein_id = MACRONUTRIENTS['protein']['number']

    # Get all key nutrient IDs
    all_ids = get_all_key_nutrient_ids()
"""

# ============================================================================
# MACRONUTRIENTS & ENERGY
# ============================================================================

MACRONUTRIENTS = {
    'energy': {
        'number': '208',
        'name': 'Energy',
        'unit': 'KCAL',
        'daily_value': 2000
    },
    'protein': {
        'number': '203',
        'name': 'Protein',
        'unit': 'G',
        'daily_value': 50
    },
    'fat': {
        'number': '204',
        'name': 'Total lipid (fat)',
        'unit': 'G',
        'daily_value': 78
    },
    'carbohydrate': {
        'number': '205',
        'name': 'Carbohydrate, by difference',
        'unit': 'G',
        'daily_value': 275
    },
    'fiber': {
        'number': '291',
        'name': 'Fiber, total dietary',
        'unit': 'G',
        'daily_value': 28
    },
    'sugars': {
        'number': '269',
        'name': 'Sugars, total',
        'unit': 'G',
        'daily_value': 50  # max recommended
    }
}

# ============================================================================
# FATS (DETAILED)
# ============================================================================

FATS = {
    'saturated': {
        'number': '606',
        'name': 'Fatty acids, total saturated',
        'unit': 'G',
        'daily_value': 20  # max recommended
    },
    'monounsaturated': {
        'number': '645',
        'name': 'Fatty acids, total monounsaturated',
        'unit': 'G',
        'daily_value': None
    },
    'polyunsaturated': {
        'number': '646',
        'name': 'Fatty acids, total polyunsaturated',
        'unit': 'G',
        'daily_value': None
    },
    'trans': {
        'number': '605',
        'name': 'Fatty acids, total trans',
        'unit': 'G',
        'daily_value': 0  # avoid
    },
    'cholesterol': {
        'number': '601',
        'name': 'Cholesterol',
        'unit': 'MG',
        'daily_value': 300  # max recommended
    }
}

# ============================================================================
# VITAMINS
# ============================================================================

VITAMINS = {
    'vitamin_a': {
        'number': '320',
        'name': 'Vitamin A, RAE',
        'unit': 'UG',
        'daily_value': 900
    },
    'vitamin_c': {
        'number': '401',
        'name': 'Vitamin C, total ascorbic acid',
        'unit': 'MG',
        'daily_value': 90
    },
    'vitamin_d': {
        'number': '328',
        'name': 'Vitamin D (D2 + D3)',
        'unit': 'UG',
        'daily_value': 20
    },
    'vitamin_e': {
        'number': '323',
        'name': 'Vitamin E (alpha-tocopherol)',
        'unit': 'MG',
        'daily_value': 15
    },
    'vitamin_k': {
        'number': '430',
        'name': 'Vitamin K (phylloquinone)',
        'unit': 'UG',
        'daily_value': 120
    },
    'thiamin': {
        'number': '404',
        'name': 'Thiamin (B1)',
        'unit': 'MG',
        'daily_value': 1.2
    },
    'riboflavin': {
        'number': '405',
        'name': 'Riboflavin (B2)',
        'unit': 'MG',
        'daily_value': 1.3
    },
    'niacin': {
        'number': '406',
        'name': 'Niacin (B3)',
        'unit': 'MG',
        'daily_value': 16
    },
    'vitamin_b6': {
        'number': '415',
        'name': 'Vitamin B-6',
        'unit': 'MG',
        'daily_value': 1.7
    },
    'folate': {
        'number': '417',
        'name': 'Folate, total',
        'unit': 'UG',
        'daily_value': 400
    },
    'vitamin_b12': {
        'number': '418',
        'name': 'Vitamin B-12',
        'unit': 'UG',
        'daily_value': 2.4
    },
    'pantothenic_acid': {
        'number': '410',
        'name': 'Pantothenic acid (B5)',
        'unit': 'MG',
        'daily_value': 5
    }
}

# ============================================================================
# MINERALS
# ============================================================================

MINERALS = {
    'calcium': {
        'number': '301',
        'name': 'Calcium, Ca',
        'unit': 'MG',
        'daily_value': 1300
    },
    'iron': {
        'number': '303',
        'name': 'Iron, Fe',
        'unit': 'MG',
        'daily_value': 18
    },
    'magnesium': {
        'number': '304',
        'name': 'Magnesium, Mg',
        'unit': 'MG',
        'daily_value': 420
    },
    'phosphorus': {
        'number': '305',
        'name': 'Phosphorus, P',
        'unit': 'MG',
        'daily_value': 1250
    },
    'potassium': {
        'number': '306',
        'name': 'Potassium, K',
        'unit': 'MG',
        'daily_value': 4700
    },
    'sodium': {
        'number': '307',
        'name': 'Sodium, Na',
        'unit': 'MG',
        'daily_value': 2300  # max recommended
    },
    'zinc': {
        'number': '309',
        'name': 'Zinc, Zn',
        'unit': 'MG',
        'daily_value': 11
    },
    'copper': {
        'number': '312',
        'name': 'Copper, Cu',
        'unit': 'MG',
        'daily_value': 0.9
    },
    'manganese': {
        'number': '315',
        'name': 'Manganese, Mn',
        'unit': 'MG',
        'daily_value': 2.3
    },
    'selenium': {
        'number': '317',
        'name': 'Selenium, Se',
        'unit': 'UG',
        'daily_value': 55
    }
}

# ============================================================================
# OTHER IMPORTANT NUTRIENTS
# ============================================================================

OTHER = {
    'water': {
        'number': '255',
        'name': 'Water',
        'unit': 'G',
        'daily_value': None
    },
    'choline': {
        'number': '421',
        'name': 'Choline, total',
        'unit': 'MG',
        'daily_value': 550
    }
}

# ============================================================================
# QUICK REFERENCE LISTS
# ============================================================================

# Most commonly tracked nutrients
MOST_TRACKED = ['208', '203', '204', '205', '606', '269', '307', '601']

# Nutrients required on nutrition labels (FDA)
NUTRITION_LABEL_REQUIRED = [
    '208',  # Energy
    '204',  # Total fat
    '606',  # Saturated fat
    '605',  # Trans fat
    '601',  # Cholesterol
    '307',  # Sodium
    '205',  # Carbohydrate
    '291',  # Fiber
    '269',  # Sugars
    '203',  # Protein
    '328',  # Vitamin D
    '301',  # Calcium
    '303',  # Iron
    '306'   # Potassium
]

# Essential nutrients for nutrition tracking
ESSENTIAL_NUTRIENTS = {
    'macronutrients': ['203', '204', '205'],  # Protein, Fat, Carbs
    'energy': ['208'],  # Calories
    'fiber_and_sugar': ['291', '269'],  # Fiber, Sugars
    'fats': ['606', '605', '601'],  # Saturated, Trans, Cholesterol
    'electrolytes': ['307', '306', '301'],  # Sodium, Potassium, Calcium
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_all_key_nutrient_ids():
    """Get list of all key nutrient IDs (numbers)"""
    all_ids = []

    for category in [MACRONUTRIENTS, FATS, VITAMINS, MINERALS, OTHER]:
        for nutrient in category.values():
            all_ids.append(nutrient['number'])

    return all_ids


def get_nutrient_by_number(number: str):
    """
    Get nutrient info by nutrient number

    Args:
        number: Nutrient number as string (e.g., '203')

    Returns:
        Dictionary with nutrient info or None if not found
    """
    all_nutrients = {**MACRONUTRIENTS, **FATS, **VITAMINS, **MINERALS, **OTHER}

    for key, nutrient in all_nutrients.items():
        if nutrient['number'] == number:
            return {**nutrient, 'key': key}

    return None


def get_nutrients_by_category(category: str):
    """
    Get all nutrients in a category

    Args:
        category: One of 'macronutrients', 'fats', 'vitamins', 'minerals', 'other'

    Returns:
        Dictionary of nutrients in that category
    """
    categories = {
        'macronutrients': MACRONUTRIENTS,
        'fats': FATS,
        'vitamins': VITAMINS,
        'minerals': MINERALS,
        'other': OTHER
    }

    return categories.get(category.lower(), {})


def get_daily_value_percentage(nutrient_number: str, amount: float):
    """
    Calculate percentage of daily value

    Args:
        nutrient_number: Nutrient number (e.g., '203')
        amount: Amount of nutrient

    Returns:
        Percentage of daily value or None if DV not defined
    """
    nutrient = get_nutrient_by_number(nutrient_number)

    if not nutrient or nutrient['daily_value'] is None:
        return None

    return (amount / nutrient['daily_value']) * 100


# ============================================================================
# EXAMPLE USAGE
# ============================================================================

if __name__ == "__main__":
    print("Key Nutrients Reference")
    print("=" * 70)

    # Example 1: Get all key nutrient IDs
    print("\nAll Key Nutrient IDs:")
    print(get_all_key_nutrient_ids())

    # Example 2: Look up a specific nutrient
    print("\n\nProtein Info:")
    protein = get_nutrient_by_number('203')
    print(f"  Name: {protein['name']}")
    print(f"  Unit: {protein['unit']}")
    print(f"  Daily Value: {protein['daily_value']}g")

    # Example 3: Get nutrients by category
    print("\n\nAll Vitamins:")
    for key, vitamin in VITAMINS.items():
        print(f"  {vitamin['number']}: {vitamin['name']} ({vitamin['unit']})")

    # Example 4: Calculate daily value percentage
    print("\n\nDaily Value Calculation:")
    protein_amount = 25  # 25g of protein
    dv_percent = get_daily_value_percentage('203', protein_amount)
    print(f"  {protein_amount}g protein = {dv_percent:.1f}% of daily value")

    # Example 5: Get most tracked nutrients
    print("\n\nMost Tracked Nutrients:")
    for nutrient_id in MOST_TRACKED:
        nutrient = get_nutrient_by_number(nutrient_id)
        if nutrient:
            print(f"  {nutrient_id}: {nutrient['name']}")
