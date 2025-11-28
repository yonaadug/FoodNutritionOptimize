# USDA FoodData Central API Wrapper

A comprehensive Python wrapper for the [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide).

## Features

- **Complete API Coverage**: All FoodData Central endpoints supported
- **Type Safety**: Enums and dataclasses for better code reliability
- **Rate Limiting**: Built-in rate limiting to respect API limits (1,000 requests/hour)
- **Easy to Use**: Simple, intuitive interface
- **Well Documented**: Comprehensive docstrings and examples

## Installation

No external dependencies required beyond `requests`:

```bash
pip install requests
```

## Quick Start

### Get an API Key

1. Visit [https://fdc.nal.usda.gov/api-key-signup](https://fdc.nal.usda.gov/api-key-signup)
2. Sign up for a free API key
3. For testing, you can use `DEMO_KEY` (limited requests)

### Basic Usage

```python
from usda_fdc_api import USDAFoodDataCentralAPI

# Initialize with your API key
api = USDAFoodDataCentralAPI(api_key="your_api_key_here")

# Or use DEMO_KEY for testing
api = USDAFoodDataCentralAPI(api_key="DEMO_KEY")
```

## API Methods

### 1. Get Single Food Item

Get detailed information about a specific food by its FDC ID.

```python
# Get full details for a food item
food = api.get_food(fdc_id=534358)
print(food['description'])
print(food['foodNutrients'])

# Get abridged format
food = api.get_food(fdc_id=534358, format="abridged")

# Get specific nutrients only
food = api.get_food(fdc_id=534358, nutrients=[203, 204, 205])  # Protein, Fat, Carbs
```

### 2. Get Multiple Food Items

Retrieve multiple foods in a single request.

```python
# Get multiple foods by their FDC IDs
foods = api.get_foods(fdc_ids=[534358, 747447, 534358])

for food in foods:
    print(f"{food['fdcId']}: {food['description']}")
```

### 3. Search Foods

Search for foods by keywords.

```python
# Basic search
results = api.search_foods("cheddar cheese")
print(f"Found {results['totalHits']} foods")

for food in results['foods']:
    print(f"{food['fdcId']}: {food['description']}")

# Advanced search with filters
results = api.search_foods(
    query="apple",
    data_type=["Foundation", "SR Legacy"],  # Filter by data type
    page_size=25,
    page_number=1,
    sort_by="lowercaseDescription.keyword",
    sort_order="asc",
    require_all_words=True
)

# Search branded foods by brand owner
results = api.search_foods(
    query="yogurt",
    data_type=["Branded"],
    brand_owner="Chobani"
)
```

### 4. List Foods

Get a paginated list of foods.

```python
# List Foundation foods
foods = api.list_foods(
    data_type=["Foundation"],
    page_size=100,
    page_number=1
)

for food in foods:
    print(f"{food['fdcId']}: {food['description']}")
```

### 5. Get All Foods (Convenience Method)

Automatically paginate through all results.

```python
# Get all Foundation foods (careful - this can be many requests!)
all_foundation_foods = api.get_all_foods(
    data_type=["Foundation"],
    max_pages=5  # Limit to first 5 pages for safety
)

print(f"Retrieved {len(all_foundation_foods)} foods")
```

### 6. Search All Foods (Convenience Method)

Search and automatically paginate through all results.

```python
# Get all foods matching a search query
all_cheese = api.search_all_foods(
    query="cheese",
    data_type=["Branded"],
    max_pages=10  # Limit pages to respect rate limits
)

print(f"Found {len(all_cheese)} cheese products")
```

## Data Types

The API supports four types of food data:

```python
from usda_fdc_api import DataType

# Available data types:
# - DataType.FOUNDATION: "Foundation"
# - DataType.SR_LEGACY: "SR Legacy"
# - DataType.SURVEY_FNDDS: "Survey (FNDDS)"
# - DataType.BRANDED: "Branded"

# Use in searches:
results = api.search_foods(
    query="milk",
    data_type=[DataType.FOUNDATION.value, DataType.BRANDED.value]
)
```

## Sorting

Available sort fields:

```python
from usda_fdc_api import SortBy, SortOrder

results = api.search_foods(
    query="bread",
    sort_by=SortBy.DESCRIPTION.value,  # Sort by description
    sort_order=SortOrder.ASC.value     # Ascending order
)

# Sort options:
# - SortBy.DATA_TYPE: "dataType.keyword"
# - SortBy.DESCRIPTION: "lowercaseDescription.keyword"
# - SortBy.FDC_ID: "fdcId"
# - SortBy.PUBLISHED_DATE: "publishedDate"
```

## Rate Limiting

The API has a rate limit of 1,000 requests per hour. The wrapper includes built-in rate limiting:

```python
# Adjust the delay between requests (default is 0.5 seconds)
api = USDAFoodDataCentralAPI(
    api_key="your_api_key",
    rate_limit_delay=1.0  # Wait 1 second between requests
)
```

## Error Handling

```python
import requests

try:
    food = api.get_food(fdc_id=999999999)
except requests.exceptions.HTTPError as e:
    if e.response.status_code == 404:
        print("Food not found")
    elif e.response.status_code == 400:
        print("Bad request")
    elif e.response.status_code == 429:
        print("Rate limit exceeded")
    else:
        print(f"HTTP error: {e}")
except requests.exceptions.RequestException as e:
    print(f"Request failed: {e}")
```

## Example: Nutrient Analysis

```python
# Search for foods and analyze nutrients
results = api.search_foods("banana", page_size=10)

for food in results['foods']:
    food_details = api.get_food(food['fdcId'])

    print(f"\n{food_details['description']}")
    print("Nutrients per 100g:")

    for nutrient in food_details.get('foodNutrients', []):
        if nutrient.get('amount'):
            print(f"  {nutrient['nutrient']['name']}: {nutrient['amount']} {nutrient['nutrient']['unitName']}")
```

## Example: Building a Food Database

```python
import json

# Get all Foundation foods and save to JSON
foods = api.get_all_foods(
    data_type=["Foundation"],
    max_pages=None  # Get all pages
)

# Save to file
with open('foundation_foods.json', 'w') as f:
    json.dump(foods, f, indent=2)

print(f"Saved {len(foods)} foods to foundation_foods.json")
```

## Response Format

### Food Object (Full Format)

```json
{
  "fdcId": 534358,
  "description": "Cheddar cheese",
  "dataType": "Foundation",
  "publicationDate": "2019-04-01",
  "foodNutrients": [
    {
      "number": "203",
      "name": "Protein",
      "amount": 24.9,
      "unitName": "G",
      "derivationCode": "A",
      "derivationDescription": "Analytical"
    }
  ]
}
```

### Search Results

```json
{
  "totalHits": 150,
  "currentPage": 1,
  "totalPages": 3,
  "foods": [...]
}
```

## Common Nutrient Numbers

Here are some commonly used nutrient numbers for filtering:

- `203`: Protein
- `204`: Total lipid (fat)
- `205`: Carbohydrate
- `208`: Energy (calories)
- `269`: Sugars, total
- `291`: Fiber, total dietary
- `301`: Calcium
- `303`: Iron
- `306`: Potassium
- `307`: Sodium

## License

USDA FoodData Central data are in the public domain under CC0 1.0 Universal.
Attribution to FoodData Central is requested but not required.

## Links

- [API Guide](https://fdc.nal.usda.gov/api-guide)
- [API Key Signup](https://fdc.nal.usda.gov/api-key-signup)
- [FoodData Central Website](https://fdc.nal.usda.gov/)
- [Full API Documentation](https://app.swaggerhub.com/apis/fdcnal/food-data_central_api/)
