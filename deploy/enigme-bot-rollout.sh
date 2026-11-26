#!/usr/bin/env bash
set -euo pipefail

NAME="${CONTAINER_NAME:-enigme-bot}"
IMAGE="${BOT_IMAGE:-ghcr.io/hextazdev/enigme-bot:prod}"
ENV_FILE="${ENV_FILE:-.env}"
DATA_DIR="${DATA_DIR:-data}"
CHECK_DELAY="${CHECK_DELAY_SECONDS:-15}"

OLD_ID=""
if docker inspect "$NAME" >/dev/null 2>&1; then
  OLD_ID="$(docker inspect -f '{{.Image}}' "$NAME")"
fi

if ! docker pull "$IMAGE"; then
  echo "[ROLLOUT] failed to resolve reference for $IMAGE (tag not published yet?)"
  exit 1
fi
NEW_ID="$(docker image inspect "$IMAGE" -f '{{.Id}}')"

if [[ -n "$OLD_ID" && "$OLD_ID" == "$NEW_ID" ]]; then
  echo "[ROLLOUT] already up to date ($NEW_ID); nothing to do."
  exit 0
fi

echo "[ROLLOUT] deploying $NEW_ID (was ${OLD_ID:-none})"
if docker inspect "$NAME" >/dev/null 2>&1; then
  docker stop -t 15 "$NAME" >/dev/null 2>&1 || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
fi

start_container() {
  local target_image="$1"
  docker run -d --name "$NAME" --restart unless-stopped --env-file "$ENV_FILE" -v "$PWD/$DATA_DIR:/app/data" "$target_image"
}

rollback() {
  echo "[ROLLOUT] rolling back to ${OLD_ID:-previous}"
  docker stop -t 15 "$NAME" >/dev/null 2>&1 || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if [[ -n "$OLD_ID" ]] && start_container "$OLD_ID" && sleep "$CHECK_DELAY" && [[ "$(docker inspect -f '{{.State.Running}}' "$NAME")" == "true" ]]; then
    echo "[ROLLOUT] Rolled back and verified ready"
    exit 1
  fi
  echo "[ROLLOUT] CRITICAL: Rollback failed"
  exit 1
}

if ! start_container "$IMAGE"; then
  echo "[ROLLOUT] new container failed to start"
  rollback
fi

sleep "$CHECK_DELAY"
if [[ "$(docker inspect -f '{{.State.Running}}' "$NAME")" == "true" ]]; then
  echo "[ROLLOUT] Success: $NEW_ID"
  exit 0
fi

echo "[ROLLOUT] new container not running after ${CHECK_DELAY}s"
rollback
