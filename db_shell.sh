#!/bin/bash
# Open the SQLite database in interactive mode with column display enabled
sqlite3 food-nutrition-app/nutrition.db -column -header
