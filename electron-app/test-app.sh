#!/bin/bash

echo "========================================="
echo "Testing NutriCompare Desktop App"
echo "========================================="
echo ""

# Unset ELECTRON_RUN_AS_NODE (set by Claude Code IDE)
unset ELECTRON_RUN_AS_NODE

# Kill any existing instances
echo "1. Cleaning up any existing NutriCompare instances..."
killall NutriCompare 2>/dev/null || true
sleep 1

# Run the app and capture output
echo "2. Starting the packaged app..."
echo "   Location: dist/mac-arm64/NutriCompare.app"
echo ""

APP_PATH="./dist/mac-arm64/NutriCompare.app/Contents/MacOS/NutriCompare"

echo "3. Console output:"
echo "-------------------"
$APP_PATH 2>&1 &
APP_PID=$!

# Wait for app to start
sleep 5

# Check if process is still running
if ps -p $APP_PID > /dev/null 2>&1; then
    echo ""
    echo "-------------------"
    echo "✅ App is running (PID: $APP_PID)"
    echo ""
    echo "4. Checking for open window..."
    echo "   Please check your screen - do you see the NutriCompare window?"
    echo ""
    echo "5. To stop the app, run:"
    echo "   kill $APP_PID"
else
    echo ""
    echo "-------------------"
    echo "❌ App crashed or exited immediately"
    echo "   Check the output above for error messages"
fi
