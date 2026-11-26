#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_root/tools/invite-console"
deploy_host="${INVITE_CONSOLE_SSH_HOST:-yogee@192.168.11.70}"
remote_dir="${INVITE_CONSOLE_REMOTE_DIR:-/home/yogee/matter-invite-console}"
ssh_port="${INVITE_CONSOLE_SSH_PORT:-22}"
restart_service="${INVITE_CONSOLE_RESTART_SERVICE:-auto}"

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

printf 'Checking and reloading the web service...\n'
printf -v quoted_restart_service '%q' "$restart_service"
ssh -t -p "$ssh_port" "$deploy_host" "INVITE_CONSOLE_RESTART_SERVICE=$quoted_restart_service bash -s" <<'REMOTE'
set -Eeuo pipefail

restart_service="$INVITE_CONSOLE_RESTART_SERVICE"
nginx_bin="$(command -v nginx || true)"
for candidate in /usr/sbin/nginx /usr/local/sbin/nginx /usr/local/nginx/sbin/nginx; do
  if [[ -z "$nginx_bin" && -x "$candidate" ]]; then nginx_bin="$candidate"; fi
done

case "$restart_service" in
  auto|nginx)
    if [[ -n "$nginx_bin" ]] && systemctl is-active --quiet nginx; then
      sudo "$nginx_bin" -t
      sudo systemctl reload nginx
      exit
    fi
    if [[ "$restart_service" == nginx ]]; then
      printf 'Nginx was requested, but no executable or active systemd unit was found.\n' >&2
      exit 1
    fi
    ;;
esac

if [[ "$restart_service" == auto || "$restart_service" == caddy ]]; then
  if command -v caddy >/dev/null 2>&1 && systemctl is-active --quiet caddy; then
    sudo systemctl reload caddy
    exit
  fi
  if [[ "$restart_service" == caddy ]]; then
    printf 'Caddy was requested, but no executable or active systemd unit was found.\n' >&2
    exit 1
  fi
fi

if [[ "$restart_service" == auto ]]; then
  if systemctl is-active --quiet matter-invite-console.service; then
    sudo systemctl restart matter-invite-console.service
    exit
  fi
  printf 'No Nginx, Caddy, or active matter-invite-console.service was found. Set INVITE_CONSOLE_RESTART_SERVICE to the serving systemd service name.\n' >&2
  exit 1
fi

if [[ "$restart_service" != nginx && "$restart_service" != caddy ]]; then
  sudo systemctl restart "$restart_service"
fi
REMOTE

printf 'Invitation console deployed.\n'
