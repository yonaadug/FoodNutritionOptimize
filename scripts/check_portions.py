
from usda_fdc_api import USDAFoodDataCentralAPI
import json

API_KEY = "whVe7UDbKycE3pV1TWxMpyXoU8iIgurZ5IdTXgYP"
api = USDAFoodDataCentralAPI(api_key=API_KEY)

# Search for Salmon in SR Legacy to get an FDC ID
results = api.search_foods("Salmon, Atlantic, farm raised, raw", data_type=["SR Legacy"], page_size=1)
if results['foods']:
    fdc_id = results['foods'][0]['fdcId']
    print(f"Found SR Legacy Salmon: {fdc_id}")
    
    # Get full details
    details = api.get_food(fdc_id)
    print(json.dumps(details.get('foodPortions', []), indent=2))
else:
    print("No SR Legacy Salmon found")
