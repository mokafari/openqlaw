#!/bin/bash
# Install Xcode 16+ for Swift 6 support
set -euo pipefail

echo "🔍 Checking for Xcode installation..."

# Check if Xcode is already installed
if xcodebuild -version 2>/dev/null | grep -q "Xcode"; then
    XCODE_VERSION=$(xcodebuild -version | head -1)
    echo "✅ Found: $XCODE_VERSION"
    
    # Check if it's Xcode 16+
    MAJOR_VERSION=$(echo "$XCODE_VERSION" | grep -oE '[0-9]+' | head -1)
    if [ "$MAJOR_VERSION" -ge 16 ]; then
        echo "✅ Xcode 16+ is already installed!"
        swift --version
        exit 0
    else
        echo "⚠️  Xcode version is too old (need 16+ for Swift 6)"
    fi
fi

# Check if mas is installed
if ! command -v mas &> /dev/null; then
    echo "📦 Installing mas (Mac App Store CLI)..."
    brew install mas
fi

echo ""
echo "📱 Installing Xcode from Mac App Store..."
echo "   This will require:"
echo "   1. App Store sign-in (if not already signed in)"
echo "   2. Administrative password"
echo "   3. ~15GB free disk space"
echo "   4. Several minutes to download"
echo ""

# Xcode App Store ID
XCODE_ID=497799835

# Check if already purchased/installed
if mas list | grep -q "Xcode"; then
    echo "✅ Xcode is already in your App Store library"
    echo "📥 Installing Xcode..."
    mas install "$XCODE_ID"
else
    echo "🛒 Getting Xcode from App Store (first time)..."
    mas purchase "$XCODE_ID" || mas get "$XCODE_ID"
    echo "📥 Installing Xcode..."
    mas install "$XCODE_ID"
fi

echo ""
echo "⏳ Waiting for installation to complete..."
echo "   (This may take 10-30 minutes depending on your connection)"

# Wait for Xcode to appear
MAX_WAIT=1800  # 30 minutes
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    if [ -d "/Applications/Xcode.app" ]; then
        echo "✅ Xcode installation detected!"
        break
    fi
    sleep 10
    ELAPSED=$((ELAPSED + 10))
    if [ $((ELAPSED % 60)) -eq 0 ]; then
        echo "   Still waiting... ($((ELAPSED / 60)) minutes)"
    fi
done

if [ ! -d "/Applications/Xcode.app" ]; then
    echo "❌ Xcode installation not detected after waiting"
    echo "   Please check the App Store app for installation status"
    exit 1
fi

echo ""
echo "🔧 Setting up Xcode..."
sudo xcode-select -s /Applications/Xcode.app
sudo xcodebuild -license accept || true

echo ""
echo "✅ Xcode installation complete!"
echo ""
xcodebuild -version
swift --version

echo ""
echo "🧪 Testing Swift 6 build..."
cd "$(dirname "$0")/.."
if swift build --package-path apps/macos 2>&1 | head -20; then
    echo "✅ Swift 6 build successful!"
else
    echo "⚠️  Build had issues, but Xcode is installed"
fi
