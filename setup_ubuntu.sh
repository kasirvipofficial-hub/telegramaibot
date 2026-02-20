#!/bin/bash

# --- CONFIGURATION ---
NODE_VERSION="20"
# ---------------------

echo "🚀 Starting Automatic Setup for Ubuntu..."

# 1. Update System
echo "🔄 Updating system packages..."
sudo apt-get update && sudo apt-get upgrade -y

# 2. Install Essential Tools
echo "🛠️ Installing essential tools (curl, git, ffmpeg, imagemagick)..."
# Agree to Microsoft EULA automatically for fonts
echo ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true | sudo debconf-set-selections
sudo apt-get install -y curl git ffmpeg imagemagick fonts-noto-cjk fonts-noto-color-emoji ttf-mscorefonts-installer

# 3. Install Node.js (via NodeSource)
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js v${NODE_VERSION}..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "✅ Node.js is already installed ($(node -v))"
fi

# 4. Install PM2 Globally
if ! command -v pm2 &> /dev/null; then
    echo "⚙️ Installing PM2 globally..."
    sudo npm install -g pm2
else
    echo "✅ PM2 is already installed"
fi

# 5. Clone/Prepare Project Directories
echo "📁 Preparing project directories..."
# Assuming we are running this from inside the repo folder
REPO_DIR=$(pwd)

# 6. Install Dependencies - Bot Engine
echo "🤖 Installing dependencies for Bot Engine..."
cd "$REPO_DIR/bot-engine"
npm install

# 7. Install Dependencies - Video Engine
echo "🎬 Installing dependencies for Video Engine..."
cd "$REPO_DIR/video-engine"
npm install

# 8. Setup Environment Files (Placeholders)
echo "🔑 Checking for .env files..."
if [ ! -f "$REPO_DIR/bot-engine/.env" ]; then
    echo "⚠️ bot-engine/.env not found! Creating template..."
    cp "$REPO_DIR/bot-engine/.env.example" "$REPO_DIR/bot-engine/.env" 2>/dev/null || echo "BOT_TOKEN=your_token_here" > "$REPO_DIR/bot-engine/.env"
fi

if [ ! -f "$REPO_DIR/video-engine/.env" ]; then
    echo "⚠️ video-engine/.env not found! Creating template..."
    cp "$REPO_DIR/video-engine/.env.example" "$REPO_DIR/video-engine/.env" 2>/dev/null || echo "PORT=3000" > "$REPO_DIR/video-engine/.env"
fi

echo ""
echo "✅ SETUP COMPLETE!"
echo "-------------------------------------------------------"
echo "👉 1. Edit your .env files in both engines."
echo "👉 2. Start the project using: pm2 start ecosystem.config.cjs"
echo "👉 3. Monitor with: pm2 logs"
echo "-------------------------------------------------------"
