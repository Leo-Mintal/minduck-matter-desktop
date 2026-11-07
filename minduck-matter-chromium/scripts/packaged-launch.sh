#!/usr/bin/env bash

set -euo pipefail

bundle_dir="$(cd "$(dirname "$0")/.." && pwd)"
resources_dir="$bundle_dir/Resources"
chromium_binary="$resources_dir/Chromium.app/Contents/MacOS/Chromium"
extensions_dir="$resources_dir/extensions"
profile_dir="${MINDUCK_CHROMIUM_PROFILE:-$HOME/Library/Application Support/Minduck Matter Chromium}"
matter_origin="${MINDUCK_MATTER_ORIGIN:-http://localhost:3001}"

mkdir -p "$profile_dir"
exec "$chromium_binary" \
  --no-first-run \
  --no-default-browser-check \
  "--user-data-dir=$profile_dir" \
  "--load-extension=$extensions_dir/matter-browser,$extensions_dir/xiaohongshu" \
  --new-window \
  "$matter_origin"
