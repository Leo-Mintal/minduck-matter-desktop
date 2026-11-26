#!/usr/bin/env bash
set -Eeuo pipefail

restart_service="${INVITE_CONSOLE_RESTART_SERVICE:-auto}"
remote_dir="${INVITE_CONSOLE_REMOTE_DIR:?INVITE_CONSOLE_REMOTE_DIR is required}"
nginx_bin="$(command -v nginx || true)"
for candidate in /usr/sbin/nginx /usr/local/sbin/nginx /usr/local/nginx/sbin/nginx; do
  if [[ -z "$nginx_bin" && -x "$candidate" ]]; then nginx_bin="$candidate"; fi
done

case "$restart_service" in
  docker:*)
    container_name="${restart_service#docker:}"
    if [[ -z "$container_name" ]] || ! command -v docker >/dev/null 2>&1; then
      printf 'Set INVITE_CONSOLE_RESTART_SERVICE to docker:<container-name>.\n' >&2
      exit 1
    fi
    sudo docker restart "$container_name"
    exit
    ;;
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
  if command -v docker >/dev/null 2>&1; then
    container_ids="$(sudo docker ps -q)"
    matched_container=''
    multiple_matches=false
    while IFS= read -r container_id; do
      [[ -n "$container_id" ]] || continue
      inspection="$(sudo docker inspect --format '{{.Name}}{{range .Mounts}}{{printf "\n%s\t%s" .Source .Destination}}{{end}}' "$container_id")"
      container_name="${inspection%%$'\n'*}"
      container_name="${container_name#/}"
      mount_list="${inspection#*$'\n'}"
      while IFS=$'\t' read -r mount_source _; do
        if [[ "$mount_source" == "$remote_dir" ]]; then
          if [[ -n "$matched_container" && "$matched_container" != "$container_name" ]]; then
            multiple_matches=true
          fi
          matched_container="$container_name"
        fi
      done <<< "$mount_list"
    done <<< "$container_ids"

    if [[ "$multiple_matches" == true ]]; then
      printf 'More than one running container mounts %s. Set INVITE_CONSOLE_RESTART_SERVICE=docker:<container-name>.\n' "$remote_dir" >&2
      exit 1
    fi
    if [[ -n "$matched_container" ]]; then
      sudo docker restart "$matched_container"
      exit
    fi
  fi
  printf 'No web service or running container mounting %s was found. Set INVITE_CONSOLE_RESTART_SERVICE to its systemd name or docker:<container-name>.\n' "$remote_dir" >&2
  exit 1
fi

if [[ "$restart_service" != nginx && "$restart_service" != caddy ]]; then
  sudo systemctl restart "$restart_service"
fi
