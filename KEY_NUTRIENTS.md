# Key Nutrients Reference Guide

This document provides a comprehensive list of the most important nutrients returned by the USDA FoodData Central API for nutrition tracking and analysis.

## Overview

The API returns 140+ different nutrients, but most nutrition tracking applications focus on a subset of **key nutrients** that are essential for health monitoring and required on nutrition labels.

---

## Macronutrients & Energy

Essential nutrients that provide energy and are required in large amounts.

| Nutrient # | Name | Unit | Daily Value | Notes |
|------------|------|------|-------------|-------|
| **208** | Energy | KCAL | 2000 | Calories |
| **203** | Protein | G | 50g | Essential macronutrient |
| **204** | Total lipid (fat) | G | 78g | Essential macronutrient |
| **205** | Carbohydrate, by difference | G | 275g | Essential macronutrient |
| **291** | Fiber, total dietary | G | 28g | Important for digestion |
| **269** | Sugars, total | G | 50g | Max recommended |

---

## Fats (Detailed Breakdown)

Different types of fats with varying health impacts.

| Nutrient # | Name | Unit | Daily Value | Notes |
|------------|------|------|-------------|-------|
| **606** | Fatty acids, total saturated | G | 20g | Limit intake |
| **645** | Fatty acids, total monounsaturated | G | - | Healthy fats |
| **646** | Fatty acids, total polyunsaturated | G | - | Healthy fats (includes omega-3/6) |
| **605** | Fatty acids, total trans | G | 0g | Avoid completely |
| **601** | Cholesterol | MG | 300mg | Limit intake |

### Important Omega Fatty Acids
| Nutrient # | Name | Unit | Notes |
|------------|------|------|-------|
| **851** | PUFA 18:3 n-3 (ALA) | G | Omega-3 |
| **629** | PUFA 20:5 n-3 (EPA) | G | Omega-3 |
| **621** | PUFA 22:6 n-3 (DHA) | G | Omega-3 |

---

## Vitamins

### Fat-Soluble Vitamins
| Nutrient # | Name | Unit | Daily Value | Function |
|------------|------|------|-------------|----------|
| **320** | Vitamin A, RAE | UG | 900 µg | Vision, immune function |
| **328** | Vitamin D (D2 + D3) | UG | 20 µg | Bone health, calcium absorption |
| **323** | Vitamin E (alpha-tocopherol) | MG | 15mg | Antioxidant |
| **430** | Vitamin K (phylloquinone) | UG | 120 µg | Blood clotting |

### Water-Soluble Vitamins (B Complex)
| Nutrient # | Name | Unit | Daily Value | Function |
|------------|------|------|-------------|----------|
| **404** | Thiamin (B1) | MG | 1.2mg | Energy metabolism |
| **405** | Riboflavin (B2) | MG | 1.3mg | Energy metabolism |
| **406** | Niacin (B3) | MG | 16mg | Energy metabolism |
| **410** | Pantothenic acid (B5) | MG | 5mg | Energy metabolism |
| **415** | Vitamin B-6 | MG | 1.7mg | Protein metabolism |
| **417** | Folate, total | UG | 400 µg | DNA synthesis |
| **418** | Vitamin B-12 | UG | 2.4 µg | Nerve function, red blood cells |

### Other Water-Soluble Vitamins
| Nutrient # | Name | Unit | Daily Value | Function |
|------------|------|------|-------------|----------|
| **401** | Vitamin C | MG | 90mg | Immune function, antioxidant |

---

## Minerals

### Major Minerals
| Nutrient # | Name | Unit | Daily Value | Function |
|------------|------|------|-------------|----------|
| **301** | Calcium, Ca | MG | 1300mg | Bone health |
| **305** | Phosphorus, P | MG | 1250mg | Bone health, energy |
| **304** | Magnesium, Mg | MG | 420mg | Muscle/nerve function |
| **306** | Potassium, K | MG | 4700mg | Blood pressure, fluid balance |
| **307** | Sodium, Na | MG | 2300mg | Fluid balance (limit intake) |

### Trace Minerals
| Nutrient # | Name | Unit | Daily Value | Function |
|------------|------|------|-------------|----------|
| **303** | Iron, Fe | MG | 18mg | Oxygen transport |
| **309** | Zinc, Zn | MG | 11mg | Immune function |
| **312** | Copper, Cu | MG | 0.9mg | Iron metabolism |
| **315** | Manganese, Mn | MG | 2.3mg | Bone formation |
| **317** | Selenium, Se | UG | 55 µg | Antioxidant |

---

## Other Important Nutrients

| Nutrient # | Name | Unit | Daily Value | Notes |
|------------|------|------|-------------|-------|
| **255** | Water | G | - | Hydration |
| **421** | Choline, total | MG | 550mg | Brain health |

---

## Quick Reference Lists

### Most Tracked Nutrients
These are the nutrients most commonly tracked in nutrition apps:
- **208** - Energy (Calories)
- **203** - Protein
- **204** - Total Fat
- **205** - Carbohydrate
- **606** - Saturated Fat
- **269** - Sugars
- **307** - Sodium
- **601** - Cholesterol

### FDA Nutrition Label Required Nutrients
These nutrients must appear on food labels in the USA:
- **208** - Energy (Calories)
- **204** - Total Fat
- **606** - Saturated Fat
- **605** - Trans Fat
- **601** - Cholesterol
- **307** - Sodium
- **205** - Total Carbohydrate
- **291** - Dietary Fiber
- **269** - Total Sugars
- **203** - Protein
- **328** - Vitamin D
- **301** - Calcium
- **303** - Iron
- **306** - Potassium

---

## Using the Key Nutrients

### In Python (using key_nutrients.py)

```python
from key_nutrients import MACRONUTRIENTS, VITAMINS, get_all_key_nutrient_ids

# Get protein nutrient number for API request
protein_id = MACRONUTRIENTS['protein']['number']  # '203'

# Get all key nutrient IDs
all_ids = get_all_key_nutrient_ids()

# Use in API request
from usda_fdc_api import USDAFoodDataCentralAPI

api = USDAFoodDataCentralAPI(api_key="YOUR_API_KEY")
food = api.get_food(534358, nutrients=all_ids)
```

### In JSON (using key_nutrients.json)

```python
import json

with open('key_nutrients.json', 'r') as f:
    nutrients = json.load(f)

# Get all macronutrients
macros = nutrients['macronutrients']

# Get nutrition label required nutrients
required = nutrients['quick_reference']['nutrition_label_required']
```

---

## Nutrient Number Ranges

For reference, nutrient numbers are organized by type:
- **200-299**: Proximates (macronutrients, water, energy)
- **300-399**: Minerals
- **400-499**: Vitamins
- **500-599**: Amino acids
- **600-699**: Fatty acids
- **800-899**: Other compounds

---

## Daily Values Reference

Daily Values (DVs) are based on a 2,000 calorie diet for adults. Individual needs may vary based on:
- Age
- Sex
- Activity level
- Health conditions
- Pregnancy/lactation status

**Note**: Values marked as "max recommended" indicate upper limits, not targets.

---

## Files in This Repository

1. **[key_nutrients.json](key_nutrients.json)** - JSON format with all key nutrients and daily values
2. **[key_nutrients.py](key_nutrients.py)** - Python module with constants and helper functions
3. **[nutrients_list.json](nutrients_list.json)** - Complete list of all 140+ nutrients from the API
4. **[KEY_NUTRIENTS.md](KEY_NUTRIENTS.md)** - This documentation file

---

## Resources

- [USDA FoodData Central](https://fdc.nal.usda.gov/)
- [FDA Nutrition Facts Label](https://www.fda.gov/food/nutrition-facts-label)
- [NIH Dietary Reference Intakes](https://ods.od.nih.gov/HealthInformation/nutrientrecommendations.aspx)
