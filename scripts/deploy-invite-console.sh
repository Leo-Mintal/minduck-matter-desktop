#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_root/tools/invite-console"
deploy_host="${INVITE_CONSOLE_SSH_HOST:-yogee@192.168.11.70}"
remote_dir="${INVITE_CONSOLE_REMOTE_DIR:-/home/yogee/matter-invite-console}"
ssh_port="${INVITE_CONSOLE_SSH_PORT:-22}"

if [[ ! "$ssh_port" =~ ^[0-9]+$ ]] || (( ssh_port < 1 || ssh_port > 65535 )); then
  printf 'INVITE_CONSOLE_SSH_PORT must be a valid TCP port.\n' >&2
  exit 2
fi

if [[ "$remote_dir" != /* ]]; then
  printf 'INVITE_CONSOLE_REMOTE_DIR must be an absolute path.\n' >&2
  exit 2
fi

for command in node rsync ssh; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command" >&2
    exit 2
  fi
done

printf 'Checking invitation console tests...\n'
node --check "$source_dir/app.js"
node --check "$source_dir/core.js"
node --check "$source_dir/serve.cjs"
node --test "$source_dir"/*.test.cjs

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/minduck-invite-console.XXXXXX")"
trap 'rm -rf "$stage_dir"' EXIT

mkdir -p "$stage_dir/assets"
for file in index.html styles.css web-primitives.css theme.js core.js app.js; do
  cp "$source_dir/$file" "$stage_dir/"
done
cp "$source_dir"/assets/* "$stage_dir/assets/"
cat > "$stage_dir/config.js" <<'EOF'
window.InviteConsoleConfig = Object.freeze({
  mode: 'api',
  apiBasePath: '/api/desktop-access/invites',
});
EOF

printf -v quoted_remote_dir '%q' "$remote_dir"
ssh -p "$ssh_port" "$deploy_host" "mkdir -p $quoted_remote_dir"
printf 'Uploading invitation console to %s:%s...\n' "$deploy_host" "$remote_dir"
rsync -a --checksum -e "ssh -p $ssh_port" "$stage_dir/" "$deploy_host:$remote_dir/"

printf 'Checking and reloading Nginx...\n'
ssh -t -p "$ssh_port" "$deploy_host" 'sudo nginx -t && sudo systemctl reload nginx'

printf 'Invitation console deployed.\n'
