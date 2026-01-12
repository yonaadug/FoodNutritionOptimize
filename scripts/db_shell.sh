#!/bin/bash
# Open the SQLite database in interactive mode with column display enabled
# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

sqlite3 "$PROJECT_ROOT/food-nutrition-app/nutrition.db" -column -header
