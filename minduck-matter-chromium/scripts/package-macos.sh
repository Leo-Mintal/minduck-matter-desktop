#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
chromium_dir="$(cd "$script_dir/.." && pwd)"
project_dir="$(cd "$chromium_dir/.." && pwd)"
release_dir="$chromium_dir/release"
chromium_app="${MINDUCK_CHROMIUM_APP:-$chromium_dir/vendor/chromium/Chromium.app}"
version="$(node -p "require('$chromium_dir/package.json').version")"
app_name="Minduck Matter Chromium.app"
artifact="MinduckMatterChromium-${version}-arm64.dmg"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/minduck-matter-chromium-package.XXXXXX")"
app_bundle="$stage_dir/$app_name"

cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

if [[ ! -x "$chromium_app/Contents/MacOS/Chromium" ]]; then
  echo "Chromium runtime not found at $chromium_app. Run pnpm chromium:download first." >&2
  exit 1
fi

mkdir -p "$app_bundle/Contents/MacOS" "$app_bundle/Contents/Resources/extensions" "$release_dir"
cp "$script_dir/Info.plist" "$app_bundle/Contents/Info.plist"
cp "$script_dir/packaged-launch.sh" "$app_bundle/Contents/MacOS/minduck-matter-chromium"
cp "$project_dir/build/icon.icns" "$app_bundle/Contents/Resources/icon.icns"
chmod +x "$app_bundle/Contents/MacOS/minduck-matter-chromium"
ditto "$chromium_app" "$app_bundle/Contents/Resources/Chromium.app"
ditto "$project_dir/extensions/matter-browser" "$app_bundle/Contents/Resources/extensions/matter-browser"
ditto "$project_dir/extensions/xiaohongshu" "$app_bundle/Contents/Resources/extensions/xiaohongshu"

rm -f "$release_dir/$artifact"
hdiutil create -volname "Minduck Matter Chromium" -srcfolder "$app_bundle" -ov -format UDZO "$release_dir/$artifact" >/dev/null
echo "Created $release_dir/$artifact"
