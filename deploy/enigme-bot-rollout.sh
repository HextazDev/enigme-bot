#!/usr/bin/env bash
set -euo pipefail

NAME="${CONTAINER_NAME:-enigme-bot}"
IMAGE="${BOT_IMAGE:-ghcr.io/hextazdev/enigme-bot:prod}"
ENV_FILE="${ENV_FILE:-.env}"
DATA_DIR="${DATA_DIR:-data}"
CHECK_DELAY="${CHECK_DELAY_SECONDS:-15}"
FORCE_ROLLOUT="${FORCE_ROLLOUT:-0}"
REJECTED_STATE_FILE="${REJECTED_STATE_FILE:-/var/tmp/${NAME}-rejected-target.state}"

is_healthy() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" == "true" \
     && "$(docker inspect -f '{{.RestartCount}}' "$NAME" 2>/dev/null)" == "0" ]]
}

OLD_ID=""
if docker inspect "$NAME" >/dev/null 2>&1; then
  OLD_ID="$(docker inspect -f '{{.Image}}' "$NAME")"
fi

if ! docker pull "$IMAGE"; then
  echo "[ROLLOUT] failed to resolve reference for $IMAGE (tag not published yet?)"
  exit 1
fi
NEW_ID="$(docker image inspect "$IMAGE" -f '{{.Id}}')"

if [[ "$FORCE_ROLLOUT" != "1" && -f "$REJECTED_STATE_FILE" && "$(cat "$REJECTED_STATE_FILE")" == "$NEW_ID" ]]; then
  echo "[ROLLOUT] target $NEW_ID was previously rejected; skipping until a new image is published or FORCE_ROLLOUT=1."
  exit 0
fi

if [[ -n "$OLD_ID" && "$OLD_ID" == "$NEW_ID" ]]; then
  echo "[ROLLOUT] already up to date ($NEW_ID); nothing to do."
  exit 0
fi

echo "[ROLLOUT] deploying $NEW_ID (was ${OLD_ID:-none})"
docker rm -f "$NAME"
if ! docker run -d --name "$NAME" --restart unless-stopped --env-file "$ENV_FILE" -v "$PWD/$DATA_DIR:/app/data" "$IMAGE"; then
  echo "[ROLLOUT] CRITICAL: Rollback failed to start"
  exit 1
fi

sleep "$CHECK_DELAY"
if is_healthy; then
  rm -f "$REJECTED_STATE_FILE"
  echo "[ROLLOUT] Success: $NEW_ID"
  exit 0
fi

mkdir -p "$(dirname "$REJECTED_STATE_FILE")"
printf '%s' "$NEW_ID" > "$REJECTED_STATE_FILE"
echo "[ROLLOUT] new container not healthy; recorded rejected target and rolling back to ${OLD_ID:-previous}"
docker rm -f "$NAME"
if [[ -n "$OLD_ID" ]] && docker run -d --name "$NAME" --restart unless-stopped --env-file "$ENV_FILE" -v "$PWD/$DATA_DIR:/app/data" "$OLD_ID" && sleep "$CHECK_DELAY" && is_healthy; then
  echo "[ROLLOUT] Rolled back and verified ready"
  exit 1
fi
echo "[ROLLOUT] CRITICAL: Rollback failed"
exit 1
