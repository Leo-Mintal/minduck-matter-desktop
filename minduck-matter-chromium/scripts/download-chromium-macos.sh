#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
chromium_dir="$(cd "$script_dir/.." && pwd)"
target_dir="$chromium_dir/vendor/chromium"
target_app="$target_dir/Chromium.app"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This prototype currently downloads the official macOS Apple Silicon Chromium snapshot." >&2
  exit 1
fi

snapshot_platform="Mac_Arm"
snapshot_base="https://storage.googleapis.com/chromium-browser-snapshots/$snapshot_platform"
revision="${MINDUCK_CHROMIUM_REVISION:-}"
if [[ -z "$revision" ]]; then
  revision="$(curl --fail --location --silent --show-error --retry 3 "$snapshot_base/LAST_CHANGE")"
fi

if [[ ! "$revision" =~ ^[0-9]+$ ]]; then
  echo "Chromium revision must be numeric, received: $revision" >&2
  exit 1
fi

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/minduck-matter-chromium.XXXXXX")"
cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

archive="$stage_dir/chrome-mac.zip"
archive_url="$snapshot_base/$revision/chrome-mac.zip"
echo "Downloading Chromium snapshot $revision"
curl --fail --location --show-error --retry 3 "$archive_url" --output "$archive"
ditto -x -k "$archive" "$stage_dir/unpacked"

source_app="$(find "$stage_dir/unpacked" -type d -name Chromium.app -prune -print -quit)"
if [[ -z "$source_app" || ! -x "$source_app/Contents/MacOS/Chromium" ]]; then
  echo "The downloaded snapshot does not contain a runnable Chromium.app bundle." >&2
  exit 1
fi

mkdir -p "$target_dir"
rm -rf "$target_app"
ditto "$source_app" "$target_app"
printf '%s\n' "$revision" > "$target_dir/revision"

echo "Chromium $revision is ready at $target_app"
