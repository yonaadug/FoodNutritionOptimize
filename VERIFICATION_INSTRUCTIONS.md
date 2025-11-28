# Data Verification Instructions

This guide explains how to verify that the food data in our local database matches the source of truth (USDA FoodData Central API).

## Prerequisites

- Python 3 installed
- Dependencies installed (`requests`)
- `nutrition.db` exists and is populated

## How to Verify a Food Item

1.  **Find an FDC ID**: You can find the FDC ID of a food item by searching in the application or querying the database directly.
    ```bash
    # Example: Find ID for "apple"
    sqlite3 food-nutrition-app/nutrition.db "SELECT fdc_id, description FROM foods WHERE description LIKE '%apple%' LIMIT 5;"
    ```

2.  **Run the Verification Script**:
    Use the `verify_data_integrity.py` script with the FDC ID you want to check.

    ```bash
    python3 verify_data_integrity.py <FDC_ID>
    ```

    **Example:**
    ```bash
    python3 verify_data_integrity.py 1102644
    ```

## Interpreting Results

The script will output:
- **Found in Database**: Confirms the record exists locally.
- **Fetched from USDA API**: Confirms the record was retrieved from the API.
- **Comparison**:
    - `MATCH`: The data points are identical (or within acceptable floating-point tolerance).
    - `MISMATCH`: There is a discrepancy between the local DB and the API.

✅ **VERIFICATION PASSED**: All checked fields match.
❌ **VERIFICATION FAILED**: One or more fields do not match.

## Troubleshooting

- **Food not found in database**: The item might not have been ingested yet. Run the ingest script.
- **Error fetching from API**: Check your internet connection or API key validity.
