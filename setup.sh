#!/bin/bash
# NutriCompare Setup Script

echo "=================================="
echo "NutriCompare Setup"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js
echo "Checking prerequisites..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18 or higher. Current: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi
echo "✅ npm $(npm -v) detected"

echo ""
echo "=================================="
echo "Setting up Web App"
echo "=================================="

# Navigate to web app directory
cd food-nutrition-app

# Install dependencies
echo "Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"

# Check if database exists
if [ ! -f "nutrition.db" ]; then
    echo ""
    echo "${YELLOW}⚠️  Database not found!${NC}"
    echo "The app needs a nutrition database to function."
    echo ""
    echo "Options:"
    echo "  1. Use sample data (quick start)"
    echo "  2. Download from USDA (requires API key)"
    echo ""
    read -p "Choose option (1 or 2): " choice

    if [ "$choice" = "2" ]; then
        echo ""
        echo "To download data from USDA:"
        echo "1. Get API key: https://fdc.nal.usda.gov/api-key-signup.html"
        echo "2. Create config/api_keys.txt and paste your key"
        echo "3. Run: cd ../scripts && python ingest_data.py"
        echo ""
        read -p "Press Enter when done..."
    fi
fi

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Creating .env file..."
    cp .env.example .env
    echo "✅ .env file created (edit if needed)"
fi

echo ""
echo "=================================="
echo "Setup Complete!"
echo "=================================="
echo ""
echo "To start the web app:"
echo "  ${GREEN}cd food-nutrition-app${NC}"
echo "  ${GREEN}npm run dev${NC}"
echo ""
echo "Then open: ${GREEN}http://localhost:3000${NC}"
echo ""
echo "To build desktop app:"
echo "  ${GREEN}cd electron-app${NC}"
echo "  ${GREEN}npm install${NC}"
echo "  ${GREEN}npm start${NC}"
echo ""
echo "For more info, see README.md"
echo ""
