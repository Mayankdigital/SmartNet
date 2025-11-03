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
