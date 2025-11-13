#!/usr/bin/env bash

set -euo pipefail

DOCKER_PORT="${DOCKER_PROXY_PORT:-23750}"
HTTP_PORT="${HTTP_PROXY_PORT:-23751}"
DOCKER_SOCKET="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"
HTTP_TARGET="${HTTP_FORWARD_TARGET:-127.0.0.1:8081}"

if ! command -v socat >/dev/null 2>&1; then
  echo "error: socat is not installed. Install with 'brew install socat' and rerun." >&2
  exit 1
fi

start_proxy() {
  local desc="$1"
  local cmd="$2"
  echo "Starting ${desc} proxy with command:"
  echo "  ${cmd}"
  eval "${cmd} &"
  echo $!  # returns pid
}

cleanup() {
  if [[ -n "${DOCKER_PROXY_PID:-}" ]] && kill -0 "$DOCKER_PROXY_PID" >/dev/null 2>&1; then
    kill "$DOCKER_PROXY_PID"
  fi
  if [[ -n "${HTTP_PROXY_PID:-}" ]] && kill -0 "$HTTP_PROXY_PID" >/dev/null 2>&1; then
    kill "$HTTP_PROXY_PID"
  fi
}

trap cleanup EXIT

DOCKER_CMD="socat TCP-LISTEN:${DOCKER_PORT},reuseaddr,fork UNIX-CONNECT:${DOCKER_SOCKET}"
HTTP_CMD="socat TCP-LISTEN:${HTTP_PORT},reuseaddr,fork TCP:${HTTP_TARGET}"

DOCKER_PROXY_PID="$(start_proxy "Docker" "${DOCKER_CMD}")"
HTTP_PROXY_PID="$(start_proxy "HTTP" "${HTTP_CMD}")"

cat <<EOF

Docker proxy listening on tcp://127.0.0.1:${DOCKER_PORT}
HTTP proxy listening on http://127.0.0.1:${HTTP_PORT} (forwarding to ${HTTP_TARGET})

Leave this script running (Ctrl+C to stop both proxies). Update DOCKER_PROXY_PORT/HTTP_PROXY_PORT
environment variables before running if you need different ports.
EOF

wait
