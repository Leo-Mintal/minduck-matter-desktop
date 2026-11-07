#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
source_icon="$project_dir/build/sidebar-logo.svg"
iconset_dir="$project_dir/build/icon.iconset"
output_icon="$project_dir/build/icon.icns"
modern_icon_dir="$project_dir/build/AppIcon.icon"
modern_icon_asset="$modern_icon_dir/Assets/Duck.png"
compiled_icon="$project_dir/build/AppIcon.icns"
compiled_assets="$project_dir/build/Assets.car"
compiled_info="$project_dir/build/AppIcon-info.plist"

mkdir -p "$iconset_dir"
mkdir -p "$modern_icon_dir/Assets"

render() {
  local size="$1"
  local name="$2"
  # Keep the artwork full-bleed on its square canvas, without rounded corners
  # or padding. Icon Composer/macOS applies the final system icon mask.
  sips -s format png -z "$size" "$size" "$source_icon" --out "$iconset_dir/$name" >/dev/null
}

render 16 icon_16x16.png
render 32 icon_16x16@2x.png
render 32 icon_32x32.png
render 64 icon_32x32@2x.png
render 128 icon_128x128.png
render 256 icon_128x128@2x.png
render 256 icon_256x256.png
render 512 icon_256x256@2x.png
render 512 icon_512x512.png
render 1024 icon_512x512@2x.png

iconutil -c icns "$iconset_dir" -o "$output_icon"

# Icon Composer documents must be compiled before macOS can use them as an app
# icon. Copying the raw .icon document to Resources leaves LaunchServices with
# only Electron's legacy icon. The legacy ICNS above remains the fallback.
cp "$iconset_dir/icon_512x512@2x.png" "$modern_icon_asset"
xcrun actool \
  --compile "$project_dir/build" \
  --platform macosx \
  --minimum-deployment-target 26.0 \
  --app-icon AppIcon \
  --output-partial-info-plist "$compiled_info" \
  "$modern_icon_dir"

if [[ ! -s "$compiled_icon" || ! -s "$compiled_assets" ]]; then
  echo "Icon Composer compilation did not produce AppIcon.icns and Assets.car." >&2
  exit 1
fi
