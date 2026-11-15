#!/bin/bash
# Builds build/CinderFront.app — the macOS app for 燼原戰線 Cinder Front.
#
#   mac/build.sh              web build + Swift (arm64) + icon + bundle + ad-hoc codesign
#   mac/build.sh --debug      also enables Web Inspector (right-click ▸ Inspect Element, ⌘R reload)
#   mac/build.sh --universal  arm64 + x86_64 fat binary
#   mac/build.sh --skip-web   reuse the existing dist/ (only rebuild the native shell)
#   mac/build.sh --run        launch the app when done
#
# Idempotent: every run recreates the bundle from scratch. Prints the app path on the last line.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEBUG=0; UNIVERSAL=0; SKIP_WEB=0; RUN=0
for arg in "$@"; do
  case "$arg" in
    --debug) DEBUG=1 ;;
    --universal) UNIVERSAL=1 ;;
    --skip-web) SKIP_WEB=1 ;;
    --run) RUN=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

APP_NAME="CinderFront"
BUNDLE_ID="local.cinderfront.game"
MIN_OS="13.0"
VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo 0.1.0)"
BUILD_DIR="$ROOT/build"
OBJ_DIR="$BUILD_DIR/obj"
APP="$BUILD_DIR/$APP_NAME.app"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

# Find a full Xcode toolchain even if xcode-select points elsewhere.
if ! xcrun --sdk macosx --find swiftc >/dev/null 2>&1; then
  for cand in /Applications/Xcode.app /Volumes/main/Applications/Xcode.app; do
    if [ -d "$cand/Contents/Developer" ]; then export DEVELOPER_DIR="$cand/Contents/Developer"; break; fi
  done
fi
SDK="$(xcrun --sdk macosx --show-sdk-path)"
mkdir -p "$OBJ_DIR"

# ── 1. web build ──────────────────────────────────────────────────────────────
WEB_MODE="reused existing dist/"
if [ "$SKIP_WEB" = 0 ]; then
  step "Web build"
  if npm run build; then
    WEB_MODE="npm run build (typecheck + vite build)"
  else
    echo "⚠︎ 'npm run build' failed (usually another module mid-edit failing the typecheck) — falling back to 'npx vite build'." >&2
    npx vite build
    WEB_MODE="npx vite build (TYPECHECK FAILED — bundled without it)"
  fi
fi
[ -f dist/index.html ] || { echo "dist/index.html is missing — run without --skip-web" >&2; exit 1; }

# ── 2. Swift ─────────────────────────────────────────────────────────────────
step "Swift compile"
SWIFT_FLAGS=(-swift-version 5 -sdk "$SDK" -framework AppKit -framework WebKit -framework Network -module-name "$APP_NAME")
if [ "$DEBUG" = 1 ]; then SWIFT_FLAGS+=(-Onone -g -D DEBUG); else SWIFT_FLAGS+=(-O); fi
compile() { # arch
  xcrun swiftc "${SWIFT_FLAGS[@]}" -target "$1-apple-macos$MIN_OS" mac/Sources/*.swift -o "$OBJ_DIR/$APP_NAME-$1"
}
compile arm64
ARCHS="arm64"
if [ "$UNIVERSAL" = 1 ]; then
  compile x86_64
  lipo -create "$OBJ_DIR/$APP_NAME-arm64" "$OBJ_DIR/$APP_NAME-x86_64" -output "$OBJ_DIR/$APP_NAME"
  ARCHS="arm64 x86_64"
else
  cp -f "$OBJ_DIR/$APP_NAME-arm64" "$OBJ_DIR/$APP_NAME"
fi

# ── 3. icon (regenerated only when the generator changes) ────────────────────
ICNS="$OBJ_DIR/AppIcon.icns"
if [ ! -f "$ICNS" ] || [ mac/icon/make_icon.swift -nt "$ICNS" ]; then
  step "App icon"
  xcrun swiftc -O -swift-version 5 -sdk "$SDK" mac/icon/make_icon.swift -o "$OBJ_DIR/make_icon"
  rm -rf "$OBJ_DIR/AppIcon.iconset"
  "$OBJ_DIR/make_icon" "$OBJ_DIR/AppIcon.iconset"
  iconutil -c icns "$OBJ_DIR/AppIcon.iconset" -o "$ICNS"
fi

# ── 4. bundle ────────────────────────────────────────────────────────────────
step "Assemble $APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" "$APP/Contents/Resources/zh-Hant.lproj" "$APP/Contents/Resources/en.lproj"
cp "$OBJ_DIR/$APP_NAME" "$APP/Contents/MacOS/$APP_NAME"
cp "$ICNS" "$APP/Contents/Resources/AppIcon.icns"
cp -R dist/. "$APP/Contents/Resources/web/"
printf 'APPL????' > "$APP/Contents/PkgInfo"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>燼原戰線</string>
  <key>CFBundleDisplayName</key><string>燼原戰線</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d%H%M)</string>
  <key>CFBundleDevelopmentRegion</key><string>zh-Hant</string>
  <key>CFBundleLocalizations</key><array><string>zh-Hant</string><string>en</string></array>
  <key>LSHasLocalizedDisplayName</key><true/>
  <key>LSMinimumSystemVersion</key><string>$MIN_OS</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.strategy-games</string>
  <key>LSSupportsGameMode</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSLocalNetworkUsageDescription</key><string>燼原戰線需要使用區域網路,才能搜尋並加入同一網路上其他玩家建立的對戰房間,以及讓他們加入你建立的房間。</string>
  <key>NSBonjourServices</key><array><string>_cinderfront._tcp</string></array>
  <key>NSHumanReadableCopyright</key><string>燼原戰線 Cinder Front — an original game.</string>
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null

# Finder / Dock name per language ("CinderFront.app" on disk).
printf '"CFBundleDisplayName" = "燼原戰線";\n"CFBundleName" = "燼原戰線";\n"NSLocalNetworkUsageDescription" = "燼原戰線需要使用區域網路,才能搜尋並加入同一網路上其他玩家建立的對戰房間,以及讓他們加入你建立的房間。";\n' > "$APP/Contents/Resources/zh-Hant.lproj/InfoPlist.strings"
printf '"CFBundleDisplayName" = "Cinder Front";\n"CFBundleName" = "Cinder Front";\n"NSLocalNetworkUsageDescription" = "Cinder Front uses the local network to find and join matches hosted by other players on the same network, and to let them join yours.";\n' > "$APP/Contents/Resources/en.lproj/InfoPlist.strings"

# ── 5. sign ──────────────────────────────────────────────────────────────────
step "Codesign (ad-hoc)"
xattr -cr "$APP"
codesign --force --deep -s - "$APP"
codesign --verify --deep --strict "$APP"

echo
echo "web:      $WEB_MODE"
echo "binary:   $ARCHS, min macOS $MIN_OS, $([ "$DEBUG" = 1 ] && echo debug || echo release)"
echo "version:  $VERSION"
if [ "$RUN" = 1 ]; then open "$APP"; fi
echo "$APP"
