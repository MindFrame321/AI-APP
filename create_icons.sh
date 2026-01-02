#!/bin/bash
# Create placeholder icon files using ImageMagick or sips (macOS)

if command -v sips &> /dev/null; then
  # macOS - create simple colored icons
  sips -s format png -z 16 16 --setProperty format png /System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericDocumentIcon.icns --out icons/icon16.png 2>/dev/null || echo "Creating placeholder..."
  sips -s format png -z 48 48 /System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericDocumentIcon.icns --out icons/icon48.png 2>/dev/null || echo "Creating placeholder..."
  sips -s format png -z 128 128 /System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericDocumentIcon.icns --out icons/icon128.png 2>/dev/null || echo "Creating placeholder..."
else
  echo "Creating simple placeholder icons..."
fi
