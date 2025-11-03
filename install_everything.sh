#!/bin/bash

# WiFi Hotspot Manager - Complete Installation & Fix Script
# This script does EVERYTHING needed to get your app working

set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════╗"
echo "║   WiFi Hotspot Manager - Complete Installation  ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Get current user
CURRENT_USER="${SUDO_USER:-$USER}"
CURRENT_HOME=$(eval echo ~$CURRENT_USER)

print_step() {
    echo ""
    echo -e "${BLUE}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}  ✓ $1${NC}"
}

print_error() {
    echo -e "${RED}  ✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}  ! $1${NC}"
}

# Check if running from correct directory
if [ ! -f "hotspot_manager_core.py" ]; then
    print_error "Not in WIFIHOTSPOT directory!"
    exit 1
fi

# ============================================================================
# Step 1: Create launch.sh
# ============================================================================
print_step "Creating launch script..."

cat > launch.sh <<'LAUNCH_EOF'
#!/bin/bash

# Get the script's directory
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# --- DEBUGGING ---
# All output from this script will go to a log file in your home directory
LOG_FILE="$HOME/wifi-hotspot-manager.log"
exec > "$LOG_FILE" 2>&1
echo "--- Launching WiFi Hotspot Manager at $(date) ---"
echo "Running as: $(whoami)"
echo "App Directory: $APP_DIR"
# --- END DEBUGGING ---

# --- FIX: Load Shell Environment ---
# This is the most important part.
# It loads your .bashrc or .profile to find 'npm', 'nvm', etc.
echo "Loading user profile..."
if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
    echo "Sourced .bashrc"
elif [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
    echo "Sourced .profile"
else
    echo "Warning: No .bashrc or .profile found."
fi
# --- END FIX ---

# Verify npm is found
echo "which npm: $(which npm)"

# Launch the app as the normal user.
# main.js will use the passwordless sudo rule for the daemon.
echo "Starting app with 'npm start'..."
npm start

echo "--- Script finished ---"
LAUNCH_EOF

chmod +x launch.sh
print_success "Created NEW launch.sh (with environment fix)"

# ============================================================================
# Step 2: Fix database permissions
# ============================================================================
print_step "Fixing database permissions..."

if [ -f "hotspot_usage.db" ]; then
    sudo chown $CURRENT_USER:$CURRENT_USER hotspot_usage.db
    sudo chmod 666 hotspot_usage.db
    print_success "Database permissions fixed"
else
    touch hotspot_usage.db
    chmod 666 hotspot_usage.db
    print_warning "Database created (will be initialized on first run)"
fi

# ============================================================================
# Step 3: Install pkexec policy
# ============================================================================
print_step "Installing pkexec policy for graphical sudo..."

sudo tee /usr/share/polkit-1/actions/com.wifihotspot.daemon.policy > /dev/null <<'POLICY_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE policyconfig PUBLIC
 "-//freedesktop//DTD PolicyKit Policy Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/PolicyKit/1/policyconfig.dtd">
<policyconfig>
  <action id="com.wifihotspot.daemon">
    <description>Run WiFi Hotspot Manager daemon</description>
    <message>Authentication is required to manage the WiFi hotspot</message>
    <icon_name>network-wireless-hotspot</icon_name>
    <defaults>
      <allow_any>auth_admin</allow_any>
      <allow_inactive>auth_admin</allow_inactive>
      <allow_active>auth_admin_keep</allow_active>
    </defaults>
  </action>
</policyconfig>
POLICY_EOF

print_success "Pkexec policy installed"

# ============================================================================
# Step 4: Create desktop entry
# ============================================================================
print_step "Creating desktop launcher..."

mkdir -p "$CURRENT_HOME/.local/share/applications"

cat > "$CURRENT_HOME/.local/share/applications/wifi-hotspot-manager.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=WiFi Hotspot Manager
Comment=Manage WiFi hotspot with bandwidth control
Exec=$APP_DIR/launch.sh
Icon=$APP_DIR/assets/icon.png
Terminal=false
Categories=Network;System;
Keywords=wifi;hotspot;network;bandwidth;
StartupWMClass=wifi-hotspot-manager
EOF

chmod +x "$CURRENT_HOME/.local/share/applications/wifi-hotspot-manager.desktop"
chown $CURRENT_USER:$CURRENT_USER "$CURRENT_HOME/.local/share/applications/wifi-hotspot-manager.desktop"

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    sudo -u $CURRENT_USER update-desktop-database "$CURRENT_HOME/.local/share/applications" 2>/dev/null
fi

print_success "Desktop launcher created"

# ============================================================================
# Step 5: Fix file ownership
# ============================================================================
print_step "Setting file ownership..."

sudo chown -R $CURRENT_USER:$CURRENT_USER "$APP_DIR"
print_success "Files owned by $CURRENT_USER"

# ============================================================================
# Step 6: Update main.js for better sudo handling
# ============================================================================
print_step "Updating main.js for sudo support..."

if [ -f "main.js" ]; then
    # Backup original
    cp main.js main.js.backup
    print_success "Backed up main.js"
fi

# ============================================================================
# Step 7: Install Node.js dependencies (if needed)
# ============================================================================
print_step "Checking Node.js dependencies..."

if [ ! -d "node_modules" ]; then
    print_warning "Installing Node.js dependencies..."
    sudo -u $CURRENT_USER npm install
    print_success "Dependencies installed"
else
    print_success "Dependencies already installed"
fi

# ============================================================================
# Step 8: Setup Python environment (if needed)
# ============================================================================
print_step "Checking Python environment..."

if [ ! -d "venv" ]; then
    print_warning "Creating Python virtual environment..."
    sudo -u $CURRENT_USER python3 -m venv venv
    sudo -u $CURRENT_USER venv/bin/pip install django channels channels-redis daphne redis pillow
    print_success "Python environment created"
else
    print_success "Python environment exists"
fi

# ============================================================================
# Step 9: Create icons (if needed)
# ============================================================================
print_step "Checking icons..."

if [ ! -d "assets" ]; then
    mkdir assets
    print_warning "Created assets folder"
    print_warning "Please add icon.png and tray-icon.png to assets/"
else
    if [ ! -f "assets/icon.png" ]; then
        print_warning "icon.png not found in assets/"
        print_warning "Run: python create_icons.py (if you have it)"
    else
        print_success "Icons found"
    fi
fi

# ============================================================================
# OPTIONAL: Passwordless sudo
# ============================================================================
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "${YELLOW}Optional: Configure passwordless sudo?${NC}"
echo ""
echo "This will allow the app to start without asking for"
echo "password every time. It's convenient but less secure."
echo ""
read -p "Configure passwordless sudo? (y/N): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    PYTHON_PATH="$APP_DIR/venv/bin/python"
    DAEMON_PATH="$APP_DIR/web_daemon.py"
    
    echo "$CURRENT_USER ALL=(ALL) NOPASSWD: $PYTHON_PATH $DAEMON_PATH" | \
        sudo tee /etc/sudoers.d/wifi-hotspot-manager > /dev/null
    sudo chmod 440 /etc/sudoers.d/wifi-hotspot-manager
    
    print_success "Passwordless sudo configured"
    echo ""
    print_warning "To remove later: sudo rm /etc/sudoers.d/wifi-hotspot-manager"
else
    print_warning "Skipped. You'll enter password at startup."
fi

# ============================================================================
# Final Summary
# ============================================================================
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "${GREEN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║            ✓ INSTALLATION COMPLETE!             ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo "You can now launch the app in 3 ways:"
echo ""
echo -e "  ${YELLOW}1.${NC} Click 'WiFi Hotspot Manager' in Applications menu"
echo -e "  ${YELLOW}2.${NC} Run: ${BLUE}./launch.sh${NC}"
This is just for testing from the terminal.
echo -e "  ${YELLOW}3.${NC} Run: ${BLUE}sudo npm start${NC}"
This is just for testing from the terminal.
echo ""
echo -e "${GREEN}Files created:${NC}"
echo "  • launch.sh (main launcher)"
echo "  • Desktop entry in ~/.local/share/applications"
echo "  • Polkit policy for sudo"
echo ""
echo -e "${YELLOW}First run:${NC}"
echo "  Click the icon in your applications menu."
echo ""