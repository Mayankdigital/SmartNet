#!/bin/bash

# WiFi Hotspot Manager - Automated Setup Script
# This script sets up everything needed for the desktop app

set -e  # Exit on error

echo "╔════════════════════════════════════════════╗"
echo "║  WiFi Hotspot Manager - Desktop App Setup ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_info() {
    echo -e "${YELLOW}[ℹ]${NC} $1"
}

# Check if running in WIFIHOTSPOT directory
if [ ! -f "hotspot_manager_core.py" ]; then
    print_error "Please run this script from the WIFIHOTSPOT directory"
    exit 1
fi

print_status "Running in correct directory"

# Step 1: Check Node.js
echo ""
echo "Step 1/7: Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    print_error "Node.js not found!"
    echo "Please install Node.js from: https://nodejs.org/"
    echo "Recommended: LTS version (v18 or higher)"
    exit 1
fi
NODE_VERSION=$(node --version)
print_status "Node.js $NODE_VERSION found"

# Step 2: Check npm
echo ""
echo "Step 2/7: Checking npm..."
if ! command -v npm &> /dev/null; then
    print_error "npm not found!"
    exit 1
fi
NPM_VERSION=$(npm --version)
print_status "npm $NPM_VERSION found"

# Step 3: Install Node dependencies
echo ""
echo "Step 3/7: Installing Node.js dependencies..."
if [ ! -f "package.json" ]; then
    print_error "package.json not found!"
    echo "Please create package.json file first (see instructions)"
    exit 1
fi

npm install
print_status "Node dependencies installed"

# Step 4: Check Python
echo ""
echo "Step 4/7: Checking Python installation..."
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 not found!"
    exit 1
fi
PYTHON_VERSION=$(python3 --version)
print_status "$PYTHON_VERSION found"

# Step 5: Setup Python virtual environment
echo ""
echo "Step 5/7: Setting up Python virtual environment..."
if [ ! -d "venv" ]; then
    print_info "Creating virtual environment..."
    python3 -m venv venv
    print_status "Virtual environment created"
else
    print_info "Virtual environment already exists"
fi

# Activate venv
source venv/bin/activate

# Step 6: Install Python dependencies
echo ""
echo "Step 6/7: Installing Python dependencies..."
print_info "This may take a few minutes..."

# Upgrade pip first
pip install --upgrade pip > /dev/null 2>&1

# Install required packages
pip install django channels channels-redis daphne redis pillow > /dev/null 2>&1
print_status "Python dependencies installed"

# Step 7: Create icons
echo ""
echo "Step 7/7: Creating application icons..."

if [ ! -f "create_icons.py" ]; then
    print_info "create_icons.py not found, skipping icon generation"
    print_info "Please create icons manually in the assets folder"
else
    python create_icons.py
    print_status "Icons created"
fi

# Deactivate venv
deactivate

# Final checks
echo ""
echo "════════════════════════════════════════════"
echo "Final checks..."

ERROR_COUNT=0

# Check if main.js exists
if [ ! -f "main.js" ]; then
    print_error "main.js not found"
    ERROR_COUNT=$((ERROR_COUNT + 1))
else
    print_status "main.js found"
fi

# Check if splash.html exists
if [ ! -f "splash.html" ]; then
    print_error "splash.html not found"
    ERROR_COUNT=$((ERROR_COUNT + 1))
else
    print_status "splash.html found"
fi

# Check if assets folder exists
if [ ! -d "assets" ]; then
    print_error "assets folder not found"
    ERROR_COUNT=$((ERROR_COUNT + 1))
else
    print_status "assets folder found"
    
    # Check for icons
    if [ ! -f "assets/icon.png" ]; then
        print_error "assets/icon.png not found"
        ERROR_COUNT=$((ERROR_COUNT + 1))
    else
        print_status "assets/icon.png found"
    fi
    
    if [ ! -f "assets/tray-icon.png" ]; then
        print_error "assets/tray-icon.png not found"
        ERROR_COUNT=$((ERROR_COUNT + 1))
    else
        print_status "assets/tray-icon.png found"
    fi
fi

# Check Django app
if [ ! -d "bandwidth_dashboard" ]; then
    print_error "bandwidth_dashboard directory not found"
    ERROR_COUNT=$((ERROR_COUNT + 1))
else
    print_status "bandwidth_dashboard found"
fi

echo "════════════════════════════════════════════"
echo ""

if [ $ERROR_COUNT -eq 0 ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           ✓ SETUP COMPLETE!               ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "  1. Test the app:"
    echo "     ${YELLOW}npm start${NC}"
    echo ""
    echo "  2. Build installer (Linux):"
    echo "     ${YELLOW}npm run dist-linux${NC}"
    echo ""
    echo "  3. Build installer (Windows, if on Windows):"
    echo "     ${YELLOW}npm run dist-win${NC}"
    echo ""
    echo "The built app will be in the ${YELLOW}dist/${NC} folder"
else
    echo -e "${RED}╔════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ⚠ SETUP INCOMPLETE - $ERROR_COUNT ERROR(S)          ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Please fix the errors above and run this script again"
    exit 1
fi