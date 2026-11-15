#!/bin/bash
# Typefall.app 빌드(유니버설: arm64 + x86_64):  ./build.sh [버전]   →  build/Typefall.app
set -e
cd "$(dirname "$0")"
VER="${1:-0.1.4}"
APP=build/Typefall.app
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
for ARCH in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$ARCH-apple-macos13.0" typefall.swift -o "build/Typefall-$ARCH"
done
lipo -create -output "$APP/Contents/MacOS/Typefall" build/Typefall-arm64 build/Typefall-x86_64
rm -f build/Typefall-arm64 build/Typefall-x86_64
[ -f AppIcon.icns ] && cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Typefall</string>
<key>CFBundleDisplayName</key><string>Typefall</string>
<key>CFBundleIdentifier</key><string>dev.typefall.app</string>
<key>CFBundleExecutable</key><string>Typefall</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VER</string>
<key>CFBundleVersion</key><string>$VER</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
</dict></plist>
PL
# ad-hoc 서명. designated requirement 를 identifier 로 고정해서 다시 빌드해도 입력 모니터링 권한이 유지된다.
codesign --force --sign - -r="designated => identifier \"dev.typefall.app\"" "$APP"
echo "built $APP ($VER, universal)"
lipo -archs "$APP/Contents/MacOS/Typefall"
