#!/bin/bash
# 릴리스용 zip + sha256 생성:  ./package.sh [버전]   →  dist/Typefall-<버전>.zip
set -e
cd "$(dirname "$0")"
VER="${1:-0.2.1}"
./build.sh "$VER"
mkdir -p dist
ZIP="dist/Typefall-$VER.zip"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent build/Typefall.app "$ZIP"
echo "---"
shasum -a 256 "$ZIP"
ls -la "$ZIP"
