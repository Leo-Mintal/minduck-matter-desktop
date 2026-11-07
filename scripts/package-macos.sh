#!/usr/bin/env bash

# Build the current Apple Silicon macOS installer for Minduck Matter.
#
# Run from the project root or from any directory:
#   bash scripts/package-macos.sh
#
# The build writes the final DMG to release/ and its block map and checksum
# to release/metadata/. Electron
# Builder uses a temporary output directory so intermediate app bundles do not
# remain in the repository. It builds a fresh shallow checkout of the Web
# repository's remote dev branch, so a release never consumes the source
# checkout's current branch or uncommitted changes. Signed and notarized
# distribution builds are the default. Set MINDUCK_MACOS_SIGN=0 only when an
# unsigned local test DMG is required.

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
release_dir="$project_dir/release"
metadata_dir="$release_dir/metadata"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/minduck-matter-build.XXXXXX")"
electron_dist="$project_dir/node_modules/electron/dist"
default_web_source="$project_dir/../minduck-matter-web-prod"
web_dev_ref="dev"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer script must run on macOS (Darwin)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install the project toolchain before packaging." >&2
  exit 1
fi

# Prefer an installed pnpm binary. Corepack is supported as a fallback so a
# fresh checkout can use the packageManager version declared by package.json.
if command -v pnpm >/dev/null 2>&1; then
  pnpm_cmd=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  pnpm_cmd=(corepack pnpm)
else
  echo "pnpm or corepack is required. Run corepack enable, then retry." >&2
  exit 1
fi

if [[ ! -f "$project_dir/package.json" ]]; then
  echo "Could not find package.json at $project_dir" >&2
  exit 1
fi

if [[ ! -x "$project_dir/node_modules/.bin/electron-builder" || ! -d "$electron_dist" ]]; then
  echo "Project dependencies are missing. Run pnpm install first, then retry." >&2
  exit 1
fi

version="$(node -p "require('$project_dir/package.json').version")"
artifact="MinduckMatter-${version}-arm64.dmg"
sign_release="${MINDUCK_MACOS_SIGN:-1}"
notary_profile="${MINDUCK_NOTARY_PROFILE:-MinduckNotary}"
identity=""

case "$sign_release" in
  0)
    ;;
  1)
    if [[ -n "${CSC_NAME:-}" ]]; then
      identity="$CSC_NAME"
    else
      identity="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -n 1)"
    fi

    if [[ -z "$identity" ]]; then
      echo "No Developer ID Application signing identity was found in the login keychain." >&2
      echo "Install a Developer ID Application certificate, then retry." >&2
      exit 1
    fi

    if ! security find-identity -v -p codesigning | grep -Fq "\"$identity\""; then
      echo "The requested signing identity is unavailable: $identity" >&2
      exit 1
    fi

    if ! xcrun notarytool history --keychain-profile "$notary_profile" >/dev/null; then
      echo "Could not validate notarization profile '$notary_profile'." >&2
      echo "Create it with: xcrun notarytool store-credentials \"$notary_profile\" ..." >&2
      exit 1
    fi
    ;;
  *)
    echo "MINDUCK_MACOS_SIGN must be 0 (unsigned local build) or 1 (default release build)." >&2
    exit 1
    ;;
esac

cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

mkdir -p "$metadata_dir"

cd "$project_dir"

# Verify the vendored, self-contained pet runtime before packaging.
"${pnpm_cmd[@]}" run check:companion

# A release must always be built from the remote dev branch. Keep the old
# prebuilt-artifact path only as an explicit CI escape hatch; otherwise an
# inherited MINDUCK_WEB_DIST would silently package stale frontend files.
use_prebuilt_web="${MINDUCK_WEB_ALLOW_PREBUILT:-0}"
case "$use_prebuilt_web" in
  0|1)
    ;;
  *)
    echo "MINDUCK_WEB_ALLOW_PREBUILT must be 0 (default) or 1." >&2
    exit 1
    ;;
esac

if [[ "$use_prebuilt_web" == "1" ]]; then
  if [[ -z "${MINDUCK_WEB_DIST:-}" ]]; then
    echo "MINDUCK_WEB_ALLOW_PREBUILT=1 requires MINDUCK_WEB_DIST." >&2
    exit 1
  fi
  echo "Using explicitly allowed prebuilt Matter Web artifact: $MINDUCK_WEB_DIST"
  "${pnpm_cmd[@]}" run build:web
else
  if ! command -v git >/dev/null 2>&1; then
    echo "Git is required to retrieve the latest Matter Web dev branch." >&2
    exit 1
  fi

  if [[ -n "${MINDUCK_WEB_DIST:-}" ]]; then
    echo "Ignoring MINDUCK_WEB_DIST: release packages use the latest remote '$web_dev_ref' branch by default."
  fi

  web_source_hint="${MINDUCK_WEB_SOURCE:-$default_web_source}"
  if [[ -n "${MINDUCK_WEB_REMOTE:-}" ]]; then
    web_remote="$MINDUCK_WEB_REMOTE"
  else
    if [[ ! -e "$web_source_hint/.git" ]]; then
      echo "Could not find a local Matter Web repository at $web_source_hint." >&2
      echo "Set MINDUCK_WEB_REMOTE to the Web repository URL to package without a sibling checkout." >&2
      exit 1
    fi
    if ! web_remote="$(git -C "$web_source_hint" remote get-url origin)"; then
      echo "Could not read the Matter Web origin remote from $web_source_hint." >&2
      echo "Set MINDUCK_WEB_REMOTE to the Web repository URL and retry." >&2
      exit 1
    fi
  fi

  web_checkout="$stage_dir/matter-web-dev"
  echo "Cloning the latest Matter Web remote '$web_dev_ref' branch into a temporary build directory."
  if ! git clone --depth 1 --single-branch --branch "$web_dev_ref" "$web_remote" "$web_checkout"; then
    echo "Could not clone the latest Matter Web '$web_dev_ref' branch." >&2
    exit 1
  fi
  web_commit="$(git -C "$web_checkout" rev-parse HEAD)"
  echo "Building Matter Web $web_dev_ref at $web_commit"

  (
    cd "$web_checkout"
    "${pnpm_cmd[@]}" install --frozen-lockfile
  )

  MINDUCK_WEB_DIST="" MINDUCK_WEB_SOURCE="$web_checkout" "${pnpm_cmd[@]}" run build:web
fi

# Regenerate the application icon used by the macOS bundle.
"${pnpm_cmd[@]}" run icon

# Package the Electron app as an Apple Silicon DMG. Keep the output in the
# temporary staging directory until both final artifacts are ready to move.
builder_args=(
  --mac
  dmg
  --arm64
  --publish
  never
  "--config.directories.output=$stage_dir"
  "--config.electronDist=$electron_dist"
)

if [[ "$sign_release" == "1" ]]; then
  # electron-builder 26 identifies the certificate type itself and expects
  # only the organization/team qualifier here, not the Developer ID prefix.
  builder_identity="${identity#Developer ID Application: }"
  builder_args+=("--config.mac.identity=$builder_identity" --config.mac.notarize=true)
else
  builder_args+=(--config.mac.identity=null --config.mac.notarize=false)
fi

if [[ "$sign_release" == "1" ]]; then
  # Let electron-builder notarize and staple the app before constructing the DMG.
  # Use the same validated Keychain profile rather than unrelated Apple env credentials.
  env -u APPLE_ID -u APPLE_APP_SPECIFIC_PASSWORD -u APPLE_TEAM_ID \
    -u APPLE_API_KEY -u APPLE_API_KEY_ID -u APPLE_API_ISSUER -u APPLE_KEYCHAIN \
    APPLE_KEYCHAIN_PROFILE="$notary_profile" \
    "${pnpm_cmd[@]}" exec electron-builder "${builder_args[@]}"
else
  "${pnpm_cmd[@]}" exec electron-builder "${builder_args[@]}"
fi

if [[ ! -f "$stage_dir/$artifact" || ! -f "$stage_dir/$artifact.blockmap" ]]; then
  echo "Electron Builder did not produce the expected DMG artifacts." >&2
  exit 1
fi

if [[ "$sign_release" == "1" ]]; then
  app_bundle="$(find "$stage_dir" -type d -name 'Minduck Matter.app' -print -quit)"
  if [[ -z "$app_bundle" ]]; then
    echo "Electron Builder did not produce the expected application bundle." >&2
    exit 1
  fi

  codesign --verify --deep --strict --verbose=2 "$app_bundle"
  xcrun stapler validate "$app_bundle"
  if command -v syspolicy_check >/dev/null 2>&1; then
    syspolicy_check distribution "$app_bundle"
  fi
  codesign --force --timestamp --sign "$identity" "$stage_dir/$artifact"
  codesign --verify --strict --verbose=2 "$stage_dir/$artifact"
  xcrun notarytool submit "$stage_dir/$artifact" --keychain-profile "$notary_profile" --wait
  xcrun stapler staple "$stage_dir/$artifact"
  xcrun stapler validate "$stage_dir/$artifact"

  # Stapling changes the DMG bytes; the delta map must cover the final image.
  node - "$stage_dir/$artifact" <<'NODE'
const path = require('node:path')
const { createRequire } = require('node:module')
const fromBuilder = createRequire(require.resolve('electron-builder'))
const builderRoot = path.dirname(fromBuilder.resolve('app-builder-lib'))
const { buildBlockMap } = require(path.join(builderRoot, 'targets/blockmap/blockmap.js'))
const file = process.argv[2]
buildBlockMap(file, 'gzip', `${file}.blockmap`).then(({ size }) => {
  console.log(`Refreshed final DMG block map (${size} bytes).`)
}).catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
NODE
fi

mv "$stage_dir/$artifact" "$release_dir/$artifact"
mv "$stage_dir/$artifact.blockmap" "$metadata_dir/$artifact.blockmap"

echo
echo "DMG created: $release_dir/$artifact"
du -h "$release_dir/$artifact"
(
  cd "$release_dir"
  shasum -a 256 "$artifact"
) | tee "$metadata_dir/$artifact.sha256"

if [[ "$sign_release" == "1" ]]; then
  echo "Signed and notarized with: $identity"
  echo "Notarization profile: $notary_profile"
fi
