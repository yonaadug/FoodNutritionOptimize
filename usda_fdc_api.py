"""
USDA FoodData Central API Wrapper

A comprehensive Python wrapper for the USDA FoodData Central API.
API Documentation: https://fdc.nal.usda.gov/api-guide

License: Public Domain (CC0 1.0 Universal)
"""

import requests
import time
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from enum import Enum


class DataType(Enum):
    """Available food data types in FoodData Central"""
    FOUNDATION = "Foundation"
    SR_LEGACY = "SR Legacy"
    SURVEY_FNDDS = "Survey (FNDDS)"
    BRANDED = "Branded"


class SortBy(Enum):
    """Sort options for search results"""
    DATA_TYPE = "dataType.keyword"
    DESCRIPTION = "lowercaseDescription.keyword"
    FDC_ID = "fdcId"
    PUBLISHED_DATE = "publishedDate"


class SortOrder(Enum):
    """Sort order options"""
    ASC = "asc"
    DESC = "desc"


@dataclass
class FoodSearchCriteria:
    """Search criteria for food searches"""
    query: str
    data_type: Optional[List[str]] = None
    page_size: int = 50
    page_number: int = 1
    sort_by: Optional[str] = None
    sort_order: Optional[str] = None
    brand_owner: Optional[str] = None


class USDAFoodDataCentralAPI:
    """
    Python wrapper for USDA FoodData Central API

    Provides methods to interact with all FoodData Central API endpoints:
    - Get single food item details
    - Get multiple food items
    - Search foods by keywords
    - Get paginated food lists

    Rate Limits:
    - Default: 1,000 requests per hour per IP address
    - Exceeding limit blocks API key for 1 hour

    Example:
        >>> api = USDAFoodDataCentralAPI(api_key="your_api_key")
        >>> food = api.get_food(123456)
        >>> results = api.search_foods("cheddar cheese")
    """

    BASE_URL = "https://api.nal.usda.gov/fdc/v1/"

    def __init__(self, api_key: str, rate_limit_delay: float = 0.5):
        """
        Initialize the API wrapper

        Args:
            api_key: Your data.gov API key. Get one at https://fdc.nal.usda.gov/api-key-signup
                    Use "DEMO_KEY" for initial exploration (limited requests)
            rate_limit_delay: Delay between requests in seconds (default: 0.5)

        Example:
            >>> # With your API key
            >>> api = USDAFoodDataCentralAPI(api_key="your_api_key_here")
            >>>
            >>> # Using DEMO_KEY for testing (limited requests)
            >>> api = USDAFoodDataCentralAPI(api_key="DEMO_KEY")
            >>>
            >>> # Adjust rate limiting (wait 1 second between requests)
            >>> api = USDAFoodDataCentralAPI(api_key="your_api_key", rate_limit_delay=1.0)
        """
        self.api_key = api_key
        self.rate_limit_delay = rate_limit_delay
        self.session = requests.Session()
        self.last_request_time = 0

    def _wait_for_rate_limit(self):
        """Implement rate limiting between requests"""
        current_time = time.time()
        time_since_last_request = current_time - self.last_request_time
        if time_since_last_request < self.rate_limit_delay:
            time.sleep(self.rate_limit_delay - time_since_last_request)
        self.last_request_time = time.time()

    def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Make HTTP request to API endpoint

        Args:
            method: HTTP method (GET or POST)
            endpoint: API endpoint path
            params: Query parameters
            json_data: JSON body for POST requests

        Returns:
            JSON response as dictionary

        Raises:
            requests.exceptions.RequestException: For HTTP errors
        """
        self._wait_for_rate_limit()

        url = f"{self.BASE_URL}{endpoint}"

        # Add API key to params
        if params is None:
            params = {}
        params['api_key'] = self.api_key

        if method.upper() == "GET":
            response = self.session.get(url, params=params)
        elif method.upper() == "POST":
            response = self.session.post(url, params=params, json=json_data)
        else:
            raise ValueError(f"Unsupported HTTP method: {method}")

        response.raise_for_status()
        return response.json()

    def get_food(
        self,
        fdc_id: int,
        format: str = "full",
        nutrients: Optional[List[int]] = None
    ) -> Dict[str, Any]:
        """
        Get details for a single food item by FDC ID

        Args:
            fdc_id: FoodData Central ID of the food
            format: Response format - "full" or "abridged" (default: "full")
            nutrients: List of nutrient numbers to include (optional)

        Returns:
            Dictionary containing food details including nutrients

        Example:
            >>> # Get full details for a food
            >>> food = api.get_food(534358)
            >>> print(food['description'])
            'Cheddar cheese'
            >>> print(food['dataType'])
            'Foundation'
            >>>
            >>> # Get abridged format (less detail, faster)
            >>> food = api.get_food(534358, format="abridged")
            >>>
            >>> # Get only specific nutrients (203=Protein, 204=Fat, 205=Carbs)
            >>> food = api.get_food(534358, nutrients=[203, 204, 205])
            >>> for nutrient in food['foodNutrients']:
            ...     print(f"{nutrient['name']}: {nutrient['amount']} {nutrient['unitName']}")
            'Protein: 24.9 G'
            'Total lipid (fat): 33.1 G'
            'Carbohydrate: 1.28 G'
        """
        params = {"format": format}
        if nutrients:
            params['nutrients'] = ','.join(map(str, nutrients))

        return self._make_request("GET", f"food/{fdc_id}", params=params)

    def get_foods(
        self,
        fdc_ids: List[int],
        format: str = "full",
        nutrients: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """
        Get details for multiple food items by FDC IDs

        Can use either GET or POST. POST is recommended for large lists.

        Args:
            fdc_ids: List of FoodData Central IDs
            format: Response format - "full" or "abridged" (default: "full")
            nutrients: List of nutrient numbers to include (optional)

        Returns:
            List of dictionaries containing food details

        Example:
            >>> # Get multiple foods at once
            >>> foods = api.get_foods([534358, 747447, 789158])
            >>> for food in foods:
            ...     print(f"{food['fdcId']}: {food['description']}")
            '534358: Cheddar cheese'
            '747447: Butter, salted'
            '789158: Milk, whole'
            >>>
            >>> # Get abridged format for faster response
            >>> foods = api.get_foods([534358, 747447], format="abridged")
            >>>
            >>> # Get specific nutrients only
            >>> foods = api.get_foods([534358, 747447], nutrients=[203, 204])
        """
        # Use POST for better handling of large lists
        json_data = {
            "fdcIds": fdc_ids,
            "format": format
        }
        if nutrients:
            json_data['nutrients'] = nutrients

        return self._make_request("POST", "foods", json_data=json_data)

    def search_foods(
        self,
        query: str,
        data_type: Optional[List[str]] = None,
        page_size: int = 50,
        page_number: int = 1,
        sort_by: Optional[str] = None,
        sort_order: str = "asc",
        brand_owner: Optional[str] = None,
        require_all_words: bool = False
    ) -> Dict[str, Any]:
        """
        Search for foods using keywords

        Args:
            query: Search query string (e.g., "cheddar cheese")
            data_type: Filter by data types (Foundation, SR Legacy, Survey (FNDDS), Branded)
            page_size: Number of results per page (max 200, default 50)
            page_number: Page number for pagination (default 1)
            sort_by: Field to sort by (dataType.keyword, lowercaseDescription.keyword, fdcId, publishedDate)
            sort_order: Sort order - "asc" or "desc" (default: "asc")
            brand_owner: Filter by brand owner (for Branded foods)
            require_all_words: Require all words in query to match (default: False)

        Returns:
            Dictionary with search results including 'foods' list and pagination info

        Example:
            >>> # Basic search
            >>> results = api.search_foods("apple")
            >>> print(f"Found {results['totalHits']} foods")
            >>> print(f"Page {results['currentPage']} of {results['totalPages']}")
            >>>
            >>> # Filter by data type
            >>> results = api.search_foods("cheese", data_type=["Foundation", "Branded"])
            >>>
            >>> # Search with pagination
            >>> results = api.search_foods("milk", page_size=25, page_number=2)
            >>>
            >>> # Search with sorting
            >>> results = api.search_foods(
            ...     "yogurt",
            ...     sort_by="lowercaseDescription.keyword",
            ...     sort_order="desc"
            ... )
            >>>
            >>> # Search branded foods by brand owner
            >>> results = api.search_foods(
            ...     "yogurt",
            ...     data_type=["Branded"],
            ...     brand_owner="Chobani"
            ... )
            >>>
            >>> # Require all words in search query
            >>> results = api.search_foods(
            ...     "cheddar cheese sharp",
            ...     require_all_words=True
            ... )
        """
        json_data = {
            "query": query,
            "pageSize": page_size,
            "pageNumber": page_number,
            "sortOrder": sort_order,
            "requireAllWords": require_all_words
        }

        if data_type:
            json_data['dataType'] = data_type
        if sort_by:
            json_data['sortBy'] = sort_by
        if brand_owner:
            json_data['brandOwner'] = brand_owner

        return self._make_request("POST", "foods/search", json_data=json_data)

    def list_foods(
        self,
        data_type: Optional[List[str]] = None,
        page_size: int = 50,
        page_number: int = 1,
        sort_by: Optional[str] = None,
        sort_order: str = "asc"
    ) -> List[Dict[str, Any]]:
        """
        Get a paged list of foods in abridged format

        Args:
            data_type: Filter by data types (Foundation, SR Legacy, Survey (FNDDS), Branded)
            page_size: Number of results per page (max 200, default 50)
            page_number: Page number for pagination (default 1)
            sort_by: Field to sort by
            sort_order: Sort order - "asc" or "desc" (default: "asc")

        Returns:
            List of dictionaries with abridged food information

        Example:
            >>> # Get first page of Foundation foods
            >>> foods = api.list_foods(data_type=["Foundation"], page_size=50)
            >>> for food in foods:
            ...     print(f"{food['fdcId']}: {food['description']}")
            >>>
            >>> # Get all data types with larger page size
            >>> foods = api.list_foods(page_size=200)
            >>>
            >>> # Get second page of branded foods
            >>> foods = api.list_foods(
            ...     data_type=["Branded"],
            ...     page_size=100,
            ...     page_number=2
            ... )
            >>>
            >>> # Get Survey foods sorted by FDC ID
            >>> foods = api.list_foods(
            ...     data_type=["Survey (FNDDS)"],
            ...     sort_by="fdcId",
            ...     sort_order="desc"
            ... )
        """
        json_data = {
            "pageSize": page_size,
            "pageNumber": page_number,
            "sortOrder": sort_order
        }

        if data_type:
            json_data['dataType'] = data_type
        if sort_by:
            json_data['sortBy'] = sort_by

        return self._make_request("POST", "foods/list", json_data=json_data)

    def get_all_foods(
        self,
        data_type: Optional[List[str]] = None,
        max_pages: Optional[int] = None,
        page_size: int = 200
    ) -> List[Dict[str, Any]]:
        """
        Get all foods by iterating through pages (convenience method)

        WARNING: This can make many API requests. Use with caution and respect rate limits.

        Args:
            data_type: Filter by data types
            max_pages: Maximum number of pages to fetch (None = all pages)
            page_size: Number of results per page (default 200, max)

        Returns:
            List of all food dictionaries

        Example:
            >>> # Get first 5 pages of Foundation foods (safer for rate limits)
            >>> all_foundation_foods = api.get_all_foods(
            ...     data_type=["Foundation"],
            ...     max_pages=5
            ... )
            >>> print(f"Retrieved {len(all_foundation_foods)} foods")
            >>>
            >>> # Get all Foundation foods (can be many requests!)
            >>> all_foundation = api.get_all_foods(data_type=["Foundation"])
            >>>
            >>> # Get first 10 pages of all food types
            >>> sample_foods = api.get_all_foods(max_pages=10, page_size=200)
            >>>
            >>> # Use case: Build local database
            >>> import json
            >>> foods = api.get_all_foods(data_type=["Foundation"], max_pages=20)
            >>> with open('foundation_foods.json', 'w') as f:
            ...     json.dump(foods, f)
        """
        all_foods = []
        page_number = 1

        while True:
            if max_pages and page_number > max_pages:
                break

            try:
                foods = self.list_foods(
                    data_type=data_type,
                    page_size=page_size,
                    page_number=page_number
                )

                if not foods:
                    break

                all_foods.extend(foods)
                page_number += 1

            except requests.exceptions.HTTPError as e:
                # Break on server errors (might indicate end of data)
                if e.response.status_code >= 500:
                    break
                raise

        return all_foods

    def search_all_foods(
        self,
        query: str,
        data_type: Optional[List[str]] = None,
        max_pages: Optional[int] = None,
        page_size: int = 200,
        **kwargs
    ) -> List[Dict[str, Any]]:
        """
        Search and get all matching foods by iterating through pages

        Args:
            query: Search query string
            data_type: Filter by data types
            max_pages: Maximum number of pages to fetch (None = all pages)
            page_size: Number of results per page (default 200, max)
            **kwargs: Additional arguments to pass to search_foods

        Returns:
            List of all matching food dictionaries

        Example:
            >>> # Get first 10 pages of cheese products
            >>> all_cheese = api.search_all_foods(
            ...     "cheese",
            ...     data_type=["Branded"],
            ...     max_pages=10
            ... )
            >>> print(f"Found {len(all_cheese)} branded cheese products")
            >>>
            >>> # Get all results for a specific search (automatic pagination)
            >>> all_apples = api.search_all_foods(
            ...     "apple",
            ...     data_type=["Foundation"],
            ...     max_pages=None  # Get all results
            ... )
            >>>
            >>> # Search with additional filters
            >>> organic_milk = api.search_all_foods(
            ...     "organic milk",
            ...     data_type=["Branded"],
            ...     max_pages=5,
            ...     brand_owner="Organic Valley"
            ... )
            >>>
            >>> # Use case: Analyze all products from a brand
            >>> chobani = api.search_all_foods(
            ...     "yogurt",
            ...     data_type=["Branded"],
            ...     brand_owner="Chobani",
            ...     max_pages=20
            ... )
            >>> for food in chobani:
            ...     print(food['description'])
        """
        all_foods = []
        page_number = 1
        total_hits = None

        while True:
            if max_pages and page_number > max_pages:
                break

            results = self.search_foods(
                query=query,
                data_type=data_type,
                page_size=page_size,
                page_number=page_number,
                **kwargs
            )

            if total_hits is None:
                total_hits = results.get('totalHits', 0)

            foods = results.get('foods', [])
            if not foods:
                break

            all_foods.extend(foods)

            # Check if we've retrieved all results
            if len(all_foods) >= total_hits:
                break

            page_number += 1

        return all_foods


# Convenience function for quick API access
def create_api(api_key: str = "DEMO_KEY") -> USDAFoodDataCentralAPI:
    """
    Create an API instance with the given API key

    Args:
        api_key: Your API key (default: DEMO_KEY for testing)

    Returns:
        USDAFoodDataCentralAPI instance

    Example:
        >>> # Quick setup with DEMO_KEY
        >>> from usda_fdc_api import create_api
        >>> api = create_api()
        >>> results = api.search_foods("banana")
        >>>
        >>> # With your own API key
        >>> api = create_api(api_key="your_api_key_here")
        >>> food = api.get_food(534358)
    """
    return USDAFoodDataCentralAPI(api_key)
