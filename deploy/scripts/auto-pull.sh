#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/print-tracker}"
BRANCH="${BRANCH:-master}"
SERVICE_NAME="${SERVICE_NAME:-print-tracker.service}"

cd "$APP_DIR"
GIT=(git -c "safe.directory=$APP_DIR")
GIT+=(--work-tree="$APP_DIR" --git-dir="$APP_DIR/.git")

"${GIT[@]}" fetch --prune origin "$BRANCH"

LOCAL_COMMIT="$("${GIT[@]}" rev-parse HEAD)"
REMOTE_COMMIT="$("${GIT[@]}" rev-parse "origin/$BRANCH")"

if [[ "$LOCAL_COMMIT" == "$REMOTE_COMMIT" ]]; then
  exit 0
fi

"${GIT[@]}" merge --ff-only "origin/$BRANCH"
npm ci --omit=optional
npm run lint
npm run build
systemctl restart "$SERVICE_NAME"
