# Micronutrient Diary

> **What's in your food?** · [micronutrientdiary.com](https://micronutrientdiary.com) *(planned domain)*

*Formerly "NutriCompare".*

Micronutrient Diary lets you look up the nutrients in any food, see what contaminant testing found in it, work out the nutrition of a recipe, and plan a day of eating that meets your goals. It uses public USDA and FDA data, it's free, and it needs no account.

![The Micronutrient Diary home page](docs/walkthrough/01-home.png)

**New here?** The [guided tour](docs/WEBSITE_WALKTHROUGH.md) shows every screen and lists known rough edges.

---

## What Does This App Do?

- **Foods** (`/`): search 9,435 USDA foods, or browse by category or nutrient. Each food page has a serving selector, a Nutrition Facts label and a full nutrient table.
- **Contaminants** (on each food page): meters for heavy metals, pesticide residues and microplastics in the serving you chose, with sources. Foods with no testing say so instead of showing zero. See [how they're worked out](docs/CONTAMINANT_DATA.md).
- **Plan** (`/plan`): pick foods you'd happily eat and choose your goals. It works out how much of each to eat, in grams and everyday servings.
- **Recipes** (`/recipes`): paste a recipe, add a photo or start blank, check the ingredients, and get nutrition per serving. Add a serving to your plan. AI reading needs a provider switched on; otherwise it runs in a clearly labelled demo mode. See [RECIPES.md](docs/RECIPES.md).
- **Accounts** (optional): passwordless sign-in, a history of the foods and recipes you've looked at, export and delete. See [ACCOUNTS.md](docs/ACCOUNTS.md).

Values are estimates for general information, not medical advice.

### How the Planner Works

1. **Pick foods**: search, add from any food page, or tap **Try a sample day** to start from 15 everyday staples
2. **Set goals**: pick a preset (*Everyday essentials*, *FDA Daily Values*, *High protein*, *Lower carb*) or turn individual goals on or off
3. **Your plan**: tap **Make my plan** to see how much of each food to eat, with progress bars for every goal

It uses **linear programming** (a mathematical technique) to find the combination that meets every goal you turned on, with as few calories as possible and realistic portions. If the goals can't all be met, it tells you which ones fall short and suggests foods to add.

---

## Features

### Foods
- **Search 9,400+ foods** from USDA FoodData Central (Foundation Foods, SR Legacy and FNDDS mixed dishes), or browse by category or by best sources of a nutrient
- **Food pages** with household servings or a custom amount, an FDA-style label, 30+ nutrients with % Daily Value, similar foods, comparison with up to three others, and links to the USDA record
- **Honest about missing data**: nutrients USDA didn't measure show as "—", not 0

### Contaminants
- **Per-serving meters** for lead, cadmium, mercury, arsenic, pesticide residues and microplastics, which follow the serving selector
- **References and sources** from FDA, EPA and USDA testing programs, with data quality and matching shown under each row
- **Clear states** for Not detected, Not rated and No data

### Planner
- **Guided 3-step flow** with a one-click sample day
- **Goal presets** plus per-goal on/off and custom min/max
- **Plans that read like a meal plan**: grams plus household servings ("≈ ½ fillet"), and goal progress bars
- **A helpful "can't meet" screen**: which goal falls short, by how much, with one-click foods to add
- **Fixed amounts, per-food limits**, a "keep portions realistic" cap and optional safe upper limits
- **Where each nutrient comes from**, and **Show the math** for the underlying model

### Recipes
- **Paste, photo or blank**, with editable amounts and USDA matches, and live per-serving totals
- **Marks what's uncertain**: estimated weights, ingredients not counted, and "≥" where data is missing
- **Add a serving to a plan**, and recent recipes kept in your browser

### Accounts and everything else
- **Optional passwordless sign-in** by email link, with history, data export and account deletion
- **No account needed** for anything else: the planner and recent recipes are saved in your browser
- **Dark/light mode** (follows your OS), responsive down to phone width, usable by keyboard

---

## Installation & Setup

### Prerequisites
- **Node.js 26** (current LTS; `.nvmrc` pins it, so `nvm install` picks it up). Node 24 also works. CI, Docker and the Lambda image use 26. [Download](https://nodejs.org/)
- **Git LFS**: the food database (`food-nutrition-app/nutrition.db`) is stored with [Git LFS](https://git-lfs.com/). Install it with `brew install git-lfs` or `sudo apt install git-lfs`, then run `git lfs install` once.
- **Docker Desktop**: only for testing the container and Lambda images locally
- **Python 3.8+**: only needed to rebuild the database with the scripts in `scripts/`

### Quick Start (Web App)

```bash
git clone https://github.com/yonaadug/FoodNutritionOptimize.git
cd FoodNutritionOptimize
./setup.sh            # checks Node, pulls the LFS database, installs the web app
                      # add --with-electron and/or --with-python for the extras

cd food-nutrition-app
npm run dev
```

Then open **http://localhost:3000** 🎉

**Before deploying, test every deployment shape on your laptop:** dev server, production
build, Docker image, Lambda image, AWS CDK synth and the desktop app. The step-by-step
checklist with expected output is in **[docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md)**.
The root `Makefile` wraps each step (`make help` lists them):

```bash
make check          # lint + typecheck + tests + build (same as CI)
make preview        # production build, run the standalone server on :3000
make docker-test    # build the Docker image, wait for its health check, smoke test it
make lambda-local   # build + smoke test the Lambda (arm64) image on :9000
make cdk-synth      # type-check and synthesize the AWS CDK example (no AWS account needed)
make desktop        # Electron app in dev mode
```

<details>
<summary>Manual setup (what <code>setup.sh</code> does)</summary>

```bash
git lfs pull                       # replaces the LFS pointer with the real nutrition.db
cd food-nutrition-app
npm ci --ignore-scripts            # better-sqlite3 ships prebuilt binaries, so no compiler is needed
npm run dev
```
</details>

### Everyday Commands (`food-nutrition-app/`)

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload (http://localhost:3000) |
| `npm run check` | Everything CI checks: lint, typecheck, tests, build |
| `npm run lint` | ESLint (flat config in `eslint.config.mjs`) |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm test` | Unit tests |
| `npm run build` | Production build, including a self-contained server in `.next/standalone/` |
| `npm run preview` | Build, then run the standalone server the way Docker, Lambda and Electron do (http://127.0.0.1:3000) |
| `npm run start:standalone` | Run an existing build's standalone server (`PORT=4000` to change the port) |
| `npm run smoke -- <url>` | HTTP smoke test of any running server (page, `/api/meta`, `/api/search`, `POST /api/optimize`) |
| `npm start` | `next start` (works, but warns that `output: standalone` expects `preview`) |

Configuration lives in `food-nutrition-app/.env.example`. `NUTRITION_DB_PATH` points the server at a different database file.

### Production / Self-Hosting

`npm run build` writes a standalone server, about 28 MB, with `nutrition.db` bundled. It can run from any directory:

```bash
cd food-nutrition-app && npm run build
cp -r .next/static .next/standalone/.next/static     # Next.js does not copy static assets for you
PORT=3000 node .next/standalone/server.js           # or simply: npm run preview
```

Or build the container image from the repo root. It is multi-stage, uses Node 26, runs as a
non-root user, and the database is read-only. Its `HEALTHCHECK` polls `/api/meta`:

```bash
git lfs pull
docker build -t micronutrient-diary .
docker run --rm -p 3000:3000 micronutrient-diary      # or: make docker-test
```

For AWS, the planned shape is the Lambda container in
[`docs/aws/infra-example/Dockerfile.lambda`](docs/aws/infra-example/Dockerfile.lambda) (same server plus
Lambda Web Adapter), deployed by the CDK example in `docs/aws/infra-example/cdk/`. The CDK
example passes `cdk synth` but has never been deployed. See
[docs/aws/AWS_HOSTING_DESIGN.md](docs/aws/AWS_HOSTING_DESIGN.md), and
[docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md) for testing it locally first.

---

### Desktop App (Electron)

Run Micronutrient Diary as a **native desktop application** that works completely offline. The
app runs its own server on `127.0.0.1` with a random port, and its window is locked down:
it is sandboxed, has a CSP, and cannot load remote content. End users don't need Node.js.
See [electron-app/README.md](electron-app/README.md) for details.

#### Development Mode

```bash
./setup.sh --with-electron     # or: (cd food-nutrition-app && npm ci --ignore-scripts) && (cd electron-app && npm ci)
cd electron-app
npm start                      # starts `next dev` and opens the app window (or: make desktop)
```

#### Build Installers

```bash
cd electron-app
npm run pack        # quick check: unpacked app in dist/<platform>/ (or: make desktop-pack)
npm run build:mac   # .dmg + .zip
npm run build:win   # NSIS installer + portable .exe
npm run build:linux # .AppImage + .deb
```

Each build runs the web app's production build first. Installers end up in `electron-app/dist/`. Build each platform on a matching OS and CPU, because the bundled SQLite driver is a native binary.

### Continuous Integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request, on Node 26
(from `.nvmrc`). It has three jobs:

- **web**: `npm ci`, lint, typecheck, tests and the production build, then a smoke test
  (`scripts/smoke.mjs`) of the standalone server against the real (LFS) database
- **docker**: builds the image, waits for its `HEALTHCHECK`, and smoke-tests it
- **cdk-synth**: type-checks and synthesizes the AWS CDK example (no AWS credentials)

`make check` runs the **web** job's checks locally.

---

## Data Setup (Optional)

The app ships with a pre-built database (`food-nutrition-app/nutrition.db`, Git LFS, ~7 MB) of
9,435 foods from USDA FoodData Central:
- 389 Foundation Foods (2026-10 release)
- 7,448 SR Legacy foods
- 1,598 FNDDS mixed dishes

Missing nutrient values are stored as `NULL` (no data), not `0`. You only need the steps below
to rebuild or customize the data.

### Rebuild the Database

The builder uses only the Python standard library. It downloads the pinned USDA bulk releases
(sha256-verified) into `data/raw/` and writes `food-nutrition-app/nutrition.db`. No API key is needed.

```bash
python3 -I scripts/build_db.py --download   # fetch + verify + build
python3 -I scripts/build_db.py              # rebuild from data/raw (already downloaded)
python3 -I scripts/verify_data_integrity.py # validate; exits non-zero on any failure
```

To move to a newer USDA release, update `SOURCES` in `scripts/build_db.py`. See
[docs/VERIFICATION_INSTRUCTIONS.md](docs/VERIFICATION_INSTRUCTIONS.md) for details and
[docs/KEY_NUTRIENTS.md](docs/KEY_NUTRIENTS.md) for nutrient definitions and units.

### USDA API Key (optional)

You only need a key for live API spot checks (`verify_data_integrity.py --api <fdcId>`) and the
`usda_fdc_api.py` wrapper. Get a free key at https://fdc.nal.usda.gov/api-key-signup.html, then
`export USDA_API_KEY=...` or put it in `config/api_keys.txt` (gitignored). Never commit it.

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
│   │   ├── foods/               # Step 1: search, results, your foods
│   │   ├── goals/               # Step 2: presets and goal editor
│   │   ├── plan/                # Step 3: plan, progress, "can't meet" help
│   │   ├── planner/             # Presets, nutrient metadata, sample day
│   │   └── shell/, ui/          # Layout, footer, shared controls
│   ├── hooks/                   # Persisted planner store, search, plan, top foods
│   ├── lib/                     # Business logic (+ *.test.ts, run with npm test)
│   │   ├── db.ts                # Read-only SQLite access, ranked FTS5 search
│   │   ├── optimizer.ts         # Linear programming model, diagnostics, warnings
│   │   ├── nutrient-defaults.ts # FDA Daily Values and upper limits (cited)
│   │   └── api.ts               # Request validation and JSON errors
│   ├── nutrition.db             # SQLite database (9,435 USDA foods, Git LFS)
│   └── package.json
│
├── electron-app/                # Electron desktop wrapper
│   ├── main.js                  # Main process: local server + hardened window
│   ├── scripts/stage-web.js     # Copies the Next.js standalone build for packaging
│   ├── README.md                # Desktop architecture, security, build docs
│   └── package.json             # electron-builder config
│
├── .github/workflows/ci.yml     # CI: lint, typecheck, test, build, smoke test
├── Dockerfile                   # Container image (standalone server + read-only DB)
├── setup.sh                     # One-shot developer setup
│
├── scripts/                     # Data ingestion scripts (Python)
│   ├── build_db.py              # USDA bulk downloads → nutrition.db (reproducible)
│   ├── nutrient_spec.py         # Nutrient ID/unit mapping used by the builder
│   ├── verify_data_integrity.py # Automated validation (exit 1 on failure)
│   ├── usda_fdc_api.py          # Optional FDC API wrapper
│   └── key_nutrients.py         # Nutrient reference helpers
│
├── docs/                        # Documentation
│   ├── README_API.md            # API documentation
│   ├── KEY_NUTRIENTS.md         # Nutrient definitions, units, data provenance
│   ├── VERIFICATION_INSTRUCTIONS.md # Rebuilding and validating the DB
│   ├── UX_AUDIT.md              # Usability audit with before/after screenshots
│   ├── WEBSITE_WALKTHROUGH.md   # Guided tour of every screen (+ walkthrough/ screenshots)
│   ├── STRIPE_PLAN.md           # Stripe subscription plan (Checkout, Customer Portal, webhooks)
│   ├── FEATURE_ROADMAP.md       # Prioritized roadmap (recipes, personalization, ...)
│   └── aws/                     # AWS hosting + monetization design
├── TODO.md                      # Backlog from the Nov 2026 review
│
├── data/                        # Data files
│   └── raw/                     # Downloaded USDA releases (gitignored)
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
- **Python 3 (standard library only)** - `scripts/build_db.py` builds the DB from pinned, sha256-verified USDA bulk downloads
- **USDA FoodData Central** - Foundation Foods, SR Legacy, FNDDS
- **SQLite FTS5** - Full-text search index

### Desktop
- **Electron 45** - Cross-platform desktop framework
- **electron-builder** - Build native installers

---

## How the Optimization Works (Technical)

Micronutrient Diary uses **Linear Programming**, specifically the **Simplex Algorithm**, to solve this problem:

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
Food 1:     0 ≤ x₁ ≤ cap₁                   (default cap: 3 typical household servings)
Food 2:     0 ≤ x₂ ≤ cap₂
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

1. **Pick foods**: search and tap **Add**, use a "Popular starting point", or tap **Try a sample day**. Switch to **Best sources of…** to find foods rich in a nutrient.
2. **Set goals**: choose a preset, then switch individual goals on or off or edit their min/max. Total sugars is off by default because the FDA's 50 g Daily Value is for *added* sugars.
3. **Your plan**: tap **Make my plan** (the sticky bar at the bottom). You'll see what to eat, the calorie and macro split, and progress for every goal.
4. **Iterate**: if a goal can't be met, each "Not enough …" card offers **Drop this minimum** or one-click foods to add. Change anything and an "Update plan" banner appears.

### Advanced Options

- **Fixed amounts**: open a food in *Your foods* to fix how much you'll eat (e.g. what you've already had today). The planner fills in the rest.
- **Per-food limits**: set a min/max in grams for any food. *Keep portions realistic* caps each food at 300 g by default.
- **Respect safe upper limits**: also caps nutrients at their Tolerable Upper Intake Level. Only limits that apply to total intake from food are used; supplement-only limits (magnesium, niacin, folic acid, vitamin E) are not.
- **Where each nutrient comes from**: a per-food breakdown under the plan.
- **Show the math**: the LP model behind the plan.

---

## Troubleshooting

### Database Errors

**Problem:** "Cannot open database" or "Database locked"

**Solution:**
```bash
# Ensure database exists
ls food-nutrition-app/nutrition.db

# If it's a tiny text file, it's an LFS pointer: fetch the real DB
git lfs pull

# Or rebuild it from USDA data
python3 -I scripts/build_db.py --download
```

### Optimization Fails (Infeasible)

**Problem:** "We can't hit every goal with these foods"

**Causes:**
1. Goals are too strict for the foods you picked (the *FDA Daily Values* preset is demanding)
2. Not enough variety: a handful of foods rarely covers ~25 nutrients
3. Fixed amounts or per-food limits already break a maximum

**Solutions:**
- Use the quick fixes on each "Not enough …" card (add a suggested food, or drop that minimum)
- Switch to the *Everyday essentials* preset
- Add more foods, or loosen per-food limits / *Keep portions realistic*

### Search Returns No Results

**Problem:** Typing food names returns empty results

**Solutions:**
- Check database has foods: `sqlite3 food-nutrition-app/nutrition.db "SELECT COUNT(*) FROM foods;"`
- Try simpler search terms ("carrot" not "organic baby carrots")
- If the database is corrupt, run `git lfs pull` or rebuild it (`python3 -I scripts/build_db.py --download`)

### "file is not a database" / the database is a few hundred bytes

`nutrition.db` is still a Git LFS pointer. Install git-lfs, then run:
```bash
git lfs install
git lfs pull
```

### Web App Won't Start

**Problem:** `npm run dev` or `npm install` fails

**Solutions:**
```bash
node --version             # must be 22 or newer
cd food-nutrition-app
rm -rf .next node_modules  # clear the Next.js cache and dependencies (keep package-lock.json)
npm ci --ignore-scripts
```

### better-sqlite3 / native module errors

**Problem:** `npm install` prints `gyp ERR!` or `No module named 'distutils'`, or startup fails with `Could not locate the bindings file` or `NODE_MODULE_VERSION`.

better-sqlite3 13 ships prebuilt Node-API binaries for macOS, Linux (glibc and musl), and Windows on x64 and arm64. You don't need a compiler. The errors above usually mean one of two things:
- An old lockfile or `node_modules` from before the upgrade. Delete `node_modules` and run `npm ci --ignore-scripts`. `--ignore-scripts` stops npm from falling back to a `node-gyp` source build, which needs Python and a C++ toolchain.
- Copying `node_modules` or `.next/standalone` between machines. The bundled binary only matches the OS and CPU it was installed on, so build on the target platform. For Docker, build inside the image (the provided `Dockerfile` does this).

Check that it loads:
```bash
cd food-nutrition-app
node -e "console.log(new (require('better-sqlite3'))('nutrition.db',{readonly:true}).prepare('select count(*) n from foods').get())"
```

### Electron App Won't Launch

**Problem:** The Electron window doesn't open, or an error dialog appears

**Solutions:**
- Read the log at `~/Library/Logs/Micronutrient Diary/main.log` (macOS), `%APPDATA%\Micronutrient Diary\logs\main.log` (Windows), or `~/.config/Micronutrient Diary/logs/main.log` (Linux).
- In dev mode, make sure `food-nutrition-app` is installed (`npm ci --ignore-scripts`) and the LFS database is pulled.
- If `electron .` acts like plain Node, unset `ELECTRON_RUN_AS_NODE` (some IDE terminals set it). The npm scripts already unset it.
- The app picks a random free port, so you never need to free port 3000.

---

## Contributing

Contributions welcome! Here are some ideas:

- **What to build next:** [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md). Top items: personalized targets, cost optimization with food prices, dietary patterns and allergens, recipes (manual, by link, by photo), saved plans, and a week planner with a grocery list.
- **Open issues and cleanup:** [TODO.md](TODO.md)
- **Hosting and paid tier:** [docs/aws/AWS_HOSTING_DESIGN.md](docs/aws/AWS_HOSTING_DESIGN.md)

Before opening a PR, run `npm run lint && npm run typecheck && npm test && npm run build` in `food-nutrition-app/`. CI runs the same checks.

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

- **Issues**: [GitHub Issues](https://github.com/yonaadug/FoodNutritionOptimize/issues)
- **Email**: primeyonathan@gmail.com

---

## Screenshots

### Start
A welcome screen with a one-click sample day and the three steps.

![Landing page](docs/ux/after-desktop-landing.png)

### Your plan
What to eat in grams and household servings, the calorie and macro split, and progress for every goal.

![Daily plan](docs/ux/after-desktop-plan-full.png)

### When goals can't all be met
Each problem goal gets its own card with the shortfall and one-click fixes.

![Can't meet every goal](docs/ux/after-desktop-infeasible.png)

### Goals (dark mode)
Presets plus per-goal switches, with the reference value and upper limit shown for each.

![Goals in dark mode](docs/ux/after-desktop-dark-goals.png)

---

**Built with ❤️ for nutrition optimization**

*Making healthy eating effortless through mathematics*
