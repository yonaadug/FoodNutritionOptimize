#!/usr/bin/env bash
# NutritionDictionary setup: checks prerequisites, fetches the LFS database and
# installs the web app. Safe to re-run.
#
# Usage: ./setup.sh [--with-electron] [--with-python]
#   --with-electron  also install the desktop app (electron-app/)
#   --with-python    also create .venv and install the data-ingestion deps
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$ROOT/food-nutrition-app"
# Node policy: 26 is the current LTS (.nvmrc, CI, Docker, Lambda image);
# 24 (maintenance LTS) still works, and it is what Electron 45 embeds.
MIN_NODE=24
RECOMMENDED_NODE=26

WITH_ELECTRON=0
WITH_PYTHON=0
for arg in "$@"; do
  case "$arg" in
    --with-electron) WITH_ELECTRON=1 ;;
    --with-python) WITH_PYTHON=1 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; NC=$'\033[0m'; else GREEN=; YELLOW=; RED=; NC=; fi
ok()   { echo "${GREEN}✔${NC} $*"; }
warn() { echo "${YELLOW}!${NC} $*"; }
die()  { echo "${RED}✘${NC} $*" >&2; exit 1; }

echo "== NutritionDictionary setup =="

# --- Prerequisites ---------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install Node.js ${MIN_NODE}+ (LTS) from https://nodejs.org/"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge "$MIN_NODE" ] || die "Node.js ${MIN_NODE}+ required, found $(node -v). Upgrade (e.g. 'nvm install --lts')."
ok "Node.js $(node -v)"
[ "$NODE_MAJOR" -ge "$RECOMMENDED_NODE" ] || warn "Node.js ${RECOMMENDED_NODE} (current LTS) is recommended; CI and the Docker images use it ('nvm install' reads .nvmrc)."
command -v npm >/dev/null 2>&1 || die "npm is not installed"
ok "npm $(npm -v)"

# --- Database (Git LFS) ----------------------------------------------------
is_sqlite() { [ -f "$1" ] && [ "$(head -c 15 "$1")" = "SQLite format 3" ]; }

if ! is_sqlite "$WEB/nutrition.db"; then
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    command -v git-lfs >/dev/null 2>&1 \
      || die "nutrition.db is a Git LFS pointer and git-lfs is not installed. Install it (macOS: 'brew install git-lfs'; Debian/Ubuntu: 'sudo apt install git-lfs'), then re-run."
    echo "Fetching the database with Git LFS..."
    git -C "$ROOT" lfs install --local >/dev/null
    git -C "$ROOT" lfs pull --include="food-nutrition-app/nutrition.db"
  fi
fi
is_sqlite "$WEB/nutrition.db" || die "food-nutrition-app/nutrition.db is missing or not a SQLite file. Run 'git lfs pull', or rebuild it with the scripts in scripts/ (see README)."
ok "Database: food-nutrition-app/nutrition.db ($(du -h "$WEB/nutrition.db" | cut -f1 | tr -d ' '))"

# --- Web app ---------------------------------------------------------------
echo "Installing web app dependencies..."
# --ignore-scripts: better-sqlite3 13 ships prebuilt N-API binaries; this stops
# some npm versions from trying a node-gyp source build (needs Python + a C++ toolchain).
( cd "$WEB" && npm ci --no-audit --no-fund --ignore-scripts )
( cd "$WEB" && node -e "const D=require('better-sqlite3'); const db=new D('nutrition.db',{readonly:true}); const n=db.prepare('select count(*) n from foods').get().n; console.log('foods in DB:', n)" ) \
  || die "better-sqlite3 failed to load. See 'Troubleshooting' in README.md (native module)."
ok "Web app ready"

# --- Optional: desktop app -------------------------------------------------
if [ "$WITH_ELECTRON" = 1 ]; then
  echo "Installing desktop app dependencies..."
  ( cd "$ROOT/electron-app" && npm ci --no-audit --no-fund )
  ok "Desktop app ready (cd electron-app && npm start)"
fi

# --- Optional: Python data scripts -----------------------------------------
if [ "$WITH_PYTHON" = 1 ]; then
  command -v python3 >/dev/null 2>&1 || die "python3 is not installed"
  python3 -m venv "$ROOT/.venv"
  "$ROOT/.venv/bin/pip" install --quiet -r "$ROOT/requirements.txt"
  ok "Python venv ready (source .venv/bin/activate)"
fi

cat <<EOF

${GREEN}Setup complete.${NC}

  Web app (dev):     cd food-nutrition-app && npm run dev     -> http://localhost:3000
  Everything CI does: cd food-nutrition-app && npm run check
  Production build:  cd food-nutrition-app && npm run preview -> http://127.0.0.1:3000
  Desktop app:       ./setup.sh --with-electron, then: cd electron-app && npm start

  Full local test checklist (Docker, Lambda image, CDK synth): docs/LOCAL_TESTING.md
EOF
