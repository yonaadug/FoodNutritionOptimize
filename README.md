# NutriCompare - Intelligent Nutrition Optimizer

> **Find the healthiest, most cost-effective food combinations that meet all your daily nutritional needs.**

NutriCompare is a smart nutrition planning application that uses mathematical optimization to help you create the perfect diet. Simply tell it what nutrients you need, and it finds the optimal combination of foods to meet your goals while minimizing calories or cost.

![NutriCompare Screenshot](docs/assets/screenshot.png)

---

## What Does This App Do?

Imagine you want to meet all your daily nutritional requirements (protein, vitamins, minerals, etc.) but you're not sure which foods to eat or how much. **NutriCompare solves this problem for you automatically.**

### How It Works (Simple Explanation)

1. **Search for Foods**: Type "chicken", "broccoli", or any food name
2. **Select Foods**: Pick the foods you want to include in your diet
3. **Set Your Goals**: Tell the app your nutritional targets (e.g., "I need 50g of protein")
4. **Optimize**: Click "Optimize Diet" and let the app calculate the perfect amounts
5. **Get Results**: See exactly how many grams of each food to eat

The app uses **Linear Programming** (a mathematical technique) to find the best combination that:
- ✅ Meets all your nutritional requirements
- ✅ Minimizes total calories (or cost, if you add prices)
- ✅ Respects food quantity limits (e.g., max 3 servings per food)

### Real-World Example

**Your Goal:** Get 50g protein, 90mg Vitamin C, ≤2000 calories

**You Select:** Chicken breast, Broccoli, Rice, Oranges

**NutriCompare Calculates:**
- 120g Chicken breast = 30g protein, 132 cal
- 200g Broccoli = 5.6g protein, 68mg Vitamin C, 68 cal
- 150g Rice = 4.5g protein, 195 cal
- 100g Orange = 1g protein, 47mg Vitamin C, 47 cal

**Total:** 41.1g protein, 115mg Vitamin C, 442 calories ✅

The app shows you if you're over/under your targets with progress bars and suggests adjustments.

---

## Features

### Core Features
- 🔍 **Search 411 Foods** from USDA FoodData Central (vegetables, fruits, meats, dairy, grains, etc.)
- 📊 **30+ Nutrients Tracked** (protein, vitamins A-K, minerals, fats, fiber, etc.)
- ⚙️ **Automatic Optimization** using linear programming solver
- 🎯 **Custom Constraints** for each nutrient (min/max limits)
- 🍽️ **Guaranteed Foods** - lock in specific foods with fixed amounts
- 🌙 **Dark/Light Mode** for comfortable viewing
- 💾 **LocalStorage** persistence - your selections are saved

### Advanced Features
- 📈 **Top Foods Explorer** - find foods highest in specific nutrients
- 🔬 **Nutrition Facts Labels** - FDA-style nutrition display
- 🧮 **Constraint Analysis** - see exactly how each requirement is met
- 🐛 **Debug Mode** - view the underlying mathematical equations
- 🎨 **Serving Size Support** - convert between grams and servings

---

## Installation & Setup

### Quick Start (Web App)

#### 1. Prerequisites
- **Node.js 18+** - [Download here](https://nodejs.org/)
- **Python 3.8+** - For data ingestion scripts

#### 2. Clone the Repository

```bash
git clone https://github.com/yourusername/FoodNutritionOptimize.git
cd FoodNutritionOptimize
```

#### 3. Setup the Web App

```bash
cd food-nutrition-app
npm install
npm run dev
```

Open your browser to **http://localhost:3000** 🎉

---

### Desktop App (Electron)

Run NutriCompare as a **native desktop application** with complete network isolation!

**Features:**
- ✅ No visible localhost URLs (uses custom `app://` protocol)
- ✅ No exposed network ports (internal server only)
- ✅ Works completely offline
- ✅ Native window controls
- ✅ One-click installation

#### Development Mode

```bash
# Build the web app first
cd food-nutrition-app
npm run build

# Then start Electron
cd ../electron-app
npm install
npm start
```

**What you'll see:**
- Terminal: `Internal server running on port XXXXX (not exposed to network)`
- App window opens with `app://nutricompare/` (no localhost!)

#### Build Installers

```bash
cd electron-app

# macOS
npm run build:mac   # Creates .dmg file

# Windows
npm run build:win   # Creates .exe installer

# Linux
npm run build:linux # Creates .AppImage

# All platforms
npm run build
```

Installers will be in `electron-app/dist/`

---

## Data Setup (Optional)

The app comes with a pre-built database of 411 foods. If you want to refresh or customize the data:

### Get USDA API Key (Free)

1. Go to https://fdc.nal.usda.gov/api-key-signup.html
2. Sign up for a free API key
3. Create `config/api_keys.txt` and paste your key:
   ```
   YOUR_API_KEY_HERE
   ```

   Or set as environment variable:
   ```bash
   export USDA_API_KEY=your_key_here
   ```

### Download USDA Data (CSVs)

If you want to ingest data from CSV files instead of the API:

1. Go to https://fdc.nal.usda.gov/download-datasets.html
2. Download **Foundation Foods CSV** (latest version)
3. Extract to project root (creates `FoodData_Central_foundation_food_csv_YYYY-MM-DD/`)

### Run Data Ingestion

```bash
cd scripts

# Option 1: From USDA API (requires API key)
python ingest_data.py

# Option 2: From CSV files (requires CSV download)
python ingest_csv.py
```

This creates/updates `food-nutrition-app/nutrition.db`

---

## Project Structure

```
FoodNutritionOptimize/
├── food-nutrition-app/          # Next.js web application
│   ├── app/                     # Next.js App Router
│   │   ├── api/                 # API endpoints (search, optimize, etc.)
│   │   ├── page.tsx             # Main UI page
│   │   └── layout.tsx           # Root layout
│   ├── components/              # React components
│   │   ├── SearchBar.tsx
│   │   ├── FoodCard.tsx
│   │   ├── TopFoods.tsx
│   │   └── ...
│   ├── lib/                     # Business logic
│   │   ├── db.ts                # SQLite database access
│   │   ├── optimizer.ts         # Linear programming solver
│   │   └── nutrient-defaults.ts # Nutrient configurations
│   ├── nutrition.db             # SQLite database (411 foods)
│   └── package.json
│
├── electron-app/                # Electron desktop wrapper
│   ├── main-protocol.js         # Custom protocol handler (default)
│   ├── main-standalone.js       # Standalone localhost version
│   ├── main-zero-network.js     # IPC-only version (advanced)
│   ├── preload.js               # Security preload script
│   ├── preload-ipc.js           # IPC preload for zero-network
│   ├── NETWORK-ISOLATION.md     # Network isolation documentation
│   ├── IMPLEMENTATION-STATUS.md # Implementation status & verification
│   └── package.json
│
├── scripts/                     # Data ingestion scripts (Python)
│   ├── ingest_data.py           # USDA API → SQLite
│   ├── ingest_csv.py            # CSV → SQLite
│   ├── usda_fdc_api.py          # API wrapper
│   ├── key_nutrients.py         # Nutrient definitions
│   └── verify_data_integrity.py # Data validation
│
├── docs/                        # Documentation
│   ├── README_API.md            # API documentation
│   ├── KEY_NUTRIENTS.md         # Nutrient reference
│   └── VERIFICATION_INSTRUCTIONS.md
│
├── data/                        # Data files (gitignored)
│   └── nutrition_download.db    # Staging database
│
├── config/                      # Configuration (gitignored)
│   └── api_keys.txt.example     # API key template
│
└── README.md                    # This file
```

---

## Technology Stack

### Frontend
- **Next.js 16** - React framework with App Router
- **TypeScript** - Type-safe development
- **CSS Variables** - Themeable styling (dark/light mode)
- **LocalStorage** - Client-side persistence

### Backend
- **Next.js API Routes** - Serverless API endpoints
- **SQLite** (better-sqlite3) - Embedded database
- **javascript-lp-solver** - Linear programming optimization
- **Node.js** - Runtime environment

### Data Pipeline
- **Python 3** - Data ingestion scripts
- **USDA FoodData Central API** - Official nutrition data source
- **CSV parsing** - Bulk data import

### Desktop
- **Electron 28** - Cross-platform desktop framework
- **electron-builder** - Build native installers

---

## How the Optimization Works (Technical)

NutriCompare uses **Linear Programming**, specifically the **Simplex Algorithm**, to solve this problem:

### Mathematical Formulation

**Decision Variables:**
- `x₁, x₂, x₃, ...` = amount of each food (in 100g units)

**Objective Function:**
```
Minimize: Total Calories = Σ(calories_i × x_i)
```

**Subject to Constraints:**
```
Protein:    Σ(protein_i × x_i) ≥ 50g       (minimum requirement)
Vitamin C:  Σ(vitC_i × x_i) ≥ 90mg         (minimum requirement)
Sodium:     Σ(sodium_i × x_i) ≤ 2300mg     (maximum limit)
Calories:   Σ(calories_i × x_i) ≤ 2000     (calorie cap)
Food 1:     0 ≤ x₁ ≤ 3                      (max 3 servings)
Food 2:     0 ≤ x₂ ≤ 3
...
```

The solver finds the optimal values of `x₁, x₂, ...` that:
1. Minimize the objective (calories)
2. Satisfy all constraints (nutrient requirements)

### Why This Matters

Instead of manually trying thousands of food combinations, the algorithm mathematically proves the optimal solution in seconds. This is the same technique used in:
- Supply chain optimization
- Production planning
- Resource allocation
- Financial portfolio optimization

---

## Usage Guide

### Basic Workflow

1. **Search for Foods**
   - Type food name in search bar
   - Browse paginated results
   - Click cards to select foods

2. **Set Nutrient Constraints**
   - Expand "Customize Constraints" section
   - Enter min/max for each nutrient
   - Set calorie limits (min/max)

3. **Optional: Guaranteed Foods**
   - Click "Add to Guaranteed" for must-have foods
   - Enter exact amounts (in grams)
   - These amounts are fixed, not optimized

4. **Optimize**
   - Click "Optimize Diet" button
   - View results:
     - Diet plan (foods + amounts)
     - Total calories and nutrients
     - Constraint analysis (progress bars)
     - Nutrient breakdown per food

5. **Iterate**
   - Adjust constraints if infeasible
   - Add/remove foods
   - Re-optimize

### Advanced Features

#### Food Constraints
Set per-food min/max amounts:
- Click on food card in comparison view
- Enter min/max grams
- Optimizer respects these limits

#### Diversity Mode
Limit max amount per food globally:
- Enable "Diversity Mode"
- Set "Max Food Amount" (grams)
- Encourages variety

#### Top Foods Explorer
Find nutrient-dense foods:
- Select nutrient from dropdown
- View top 50 foods ranked by that nutrient
- Click to add to selection

#### Debug Mode
View optimization equations:
- Click "Debug" button (top-right)
- Expand "Optimization Equations"
- See mathematical formulation
- Inspect LP solver model (JSON)

---

## Troubleshooting

### Database Errors

**Problem:** "Cannot open database" or "Database locked"

**Solution:**
```bash
# Ensure database exists
ls food-nutrition-app/nutrition.db

# If missing, run data ingestion
cd scripts
python ingest_data.py  # or ingest_csv.py
```

### Optimization Fails (Infeasible)

**Problem:** "No feasible solution found"

**Causes:**
1. Constraints are too strict (impossible to satisfy)
2. Not enough foods selected
3. Guaranteed foods already violate max constraints

**Solutions:**
- Relax some constraints (lower mins or raise maxes)
- Add more food options
- Remove guaranteed foods temporarily
- Check debug output for which constraint is problematic

### Search Returns No Results

**Problem:** Typing food names returns empty results

**Solutions:**
- Check database has foods: `sqlite3 food-nutrition-app/nutrition.db "SELECT COUNT(*) FROM foods;"`
- Try simpler search terms ("carrot" not "organic baby carrots")
- Re-run data ingestion if database is corrupt

### Web App Won't Start

**Problem:** `npm run dev` fails

**Solutions:**
```bash
# Clear Next.js cache
rm -rf .next

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check Node version
node --version  # Should be 18+
```

### Electron App Won't Launch

**Problem:** Electron window doesn't open

**Solutions:**
```bash
# Build web app first
cd food-nutrition-app
npm run build

# Ensure port 3000 is free
lsof -ti:3000 | xargs kill -9

# Restart Electron
cd ../electron-app
npm start
```

---

## Contributing

Contributions welcome! Here are some ideas:

### High-Priority Features
- **Cost Optimization** - Add food prices, minimize cost instead of calories
- **Multi-Day Planning** - Plan entire weeks of meals
- **Save/Load Diet Plans** - Bookmark successful optimizations
- **Dietary Restrictions** - Filters for vegan, gluten-free, allergens
- **Shopping List Export** - Generate grocery lists from diet plans
- **PDF Reports** - Export nutrition labels and meal plans

### Code Quality
- Add unit tests (Jest, Vitest)
- E2E tests (Playwright)
- CI/CD pipeline (GitHub Actions)
- Docker containerization

### Data Enhancements
- Add branded foods (cereals, yogurt, etc.)
- Restaurant menu items
- Recipe builder (combine foods into meals)
- Meal timing optimization (pre/post-workout)

See `docs/` for API documentation and technical details.

---

## License

MIT License - see LICENSE file

---

## Credits

- **USDA FoodData Central** - Official nutrition database
- **javascript-lp-solver** - Linear programming library
- **better-sqlite3** - Fast SQLite driver
- **Next.js** - React framework
- **Electron** - Desktop framework

---

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/FoodNutritionOptimize/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/FoodNutritionOptimize/discussions)
- **Email**: your.email@example.com

---

## Screenshots

### Main Interface
![Main interface with search and selection](docs/assets/main-interface.png)

### Optimization Results
![Results showing diet plan and constraint analysis](docs/assets/results.png)

### Top Foods Explorer
![Explorer showing foods highest in protein](docs/assets/top-foods.png)

---

**Built with ❤️ for nutrition optimization**

*Making healthy eating effortless through mathematics*
