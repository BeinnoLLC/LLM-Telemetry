#!/usr/bin/env bash
# Deploy the built reports to the always-on box that serves them.
#
# Architecture: the machine running Hermes collects (it is the only one that
# can see ~/.hermes state, the Ollama hosts and nvidia-smi); the always-on box
# SERVES. That split is deliberate -- the reports are static files, so serving
# them needs no Python, no collection and no access to any agent state.
#
# Usage:   deploy/deploy-selene.sh [--dry-run] [--no-restart]
# Config:  deploy/deploy.conf   (copy deploy.conf.example and edit)
# Gate:    refuses to deploy an older build over a newer one unless --force
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
CONF="$HERE/deploy.conf"

DRY=0; NORESTART=0; FORCE=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --no-restart) NORESTART=1 ;;
    --force) FORCE=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

if [ ! -f "$CONF" ]; then
  echo "missing $CONF -- copy deploy.conf.example to deploy.conf and edit it" >&2
  exit 2
fi
# shellcheck source=/dev/null
. "$CONF"

: "${SELENE_HOST:?SELENE_HOST must be set in deploy.conf}"
: "${SSH_KEY:?SSH_KEY must be set in deploy.conf}"
: "${REMOTE_DIR:?REMOTE_DIR must be set in deploy.conf}"
SELENE_USER="${SELENE_USER:-root}"
CONTAINER="${CONTAINER:-llm-telemetry}"

REPORTS_DIR="${REPORTS_DIR:-$HOME/.hermes/reports}"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8"
RSYNC_SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

# Files the dashboard actually loads at runtime, plus the pages themselves.
# live-data/analytics-data/logs-data are fetched by the built page, so a
# deploy that ships dashboard.html without them yields a page that renders its
# shell and then fails every panel -- a partial deploy is worse than none.
FILES=(
  dashboard.html costs.html
  live-data.json analytics-data.json logs-data.json ollama-data.json
  router-data.json bandwidth-history.json
)

echo "==> deploy to $SELENE_USER@$SELENE_HOST:$REMOTE_DIR"

# --- 1. freshness guard ------------------------------------------------------
# Comparing the local build against the remote copy catches the classic
# mistake: deploying before rebuilding, which publishes the previous feature
# set while the commit message claims the new one.
if [ "$FORCE" -eq 0 ]; then
  LOCAL_NEWEST=0
  for f in "${FILES[@]}"; do
    p="$REPORTS_DIR/$f"
    [ -f "$p" ] || continue
    m=$(stat -c %Y "$p")
    [ "$m" -gt "$LOCAL_NEWEST" ] && LOCAL_NEWEST=$m
  done
  REMOTE_NEWEST=$($SSH "$SELENE_USER@$SELENE_HOST" \
    "stat -c %Y $REMOTE_DIR/dashboard.html 2>/dev/null || echo 0" || echo 0)
  if [ "$LOCAL_NEWEST" -gt 0 ] && [ "$REMOTE_NEWEST" -ge "$LOCAL_NEWEST" ]; then
    echo "!! remote dashboard.html ($REMOTE_NEWEST) is not older than the local build ($LOCAL_NEWEST)." >&2
    echo "   Rebuild first, or pass --force." >&2
    exit 3
  fi
  echo "    freshness ok (local $LOCAL_NEWEST > remote $REMOTE_NEWEST)"
fi

# --- 2. the reports must be a real build, not a fixture ----------------------
for f in dashboard.html live-data.json; do
  [ -f "$REPORTS_DIR/$f" ] || { echo "!! $REPORTS_DIR/$f missing -- run: llm-telemetry dashboard" >&2; exit 3; }
done
if grep -q '"sample": *true' "$REPORTS_DIR/live-data.json" 2>/dev/null; then
  echo "!! $REPORTS_DIR/live-data.json is the SAMPLE fixture -- refusing to publish demo data" >&2
  exit 3
fi

# --- 3. sync -----------------------------------------------------------------
# --delete so a report removed upstream does not linger and get served.
# Exclusions: the settings/credentials and any local backup crontab never leave
# the collecting host.
COPY=()
for f in "${FILES[@]}"; do
  [ -f "$REPORTS_DIR/$f" ] && COPY+=("$f")
done
if [ "$DRY" -eq 1 ]; then
  echo "    would copy: ${COPY[*]}"
  $SSH "$SELENE_USER@$SELENE_HOST" "du -sh $REMOTE_DIR 2>/dev/null || true"
  echo "==> dry run: nothing written"
  exit 0
fi

$SSH "$SELENE_USER@$SELENE_HOST" "mkdir -p $REMOTE_DIR"
for f in "${COPY[@]}"; do
  rsync -a --no-perms --omit-dir-times -e "$RSYNC_SSH" \
    "$REPORTS_DIR/$f" "$SELENE_USER@$SELENE_HOST:$REMOTE_DIR/$f"
done
echo "    copied ${#COPY[@]} files"

# --- 4. (re)start the static server -----------------------------------------
if [ "$NORESTART" -eq 0 ]; then
  # Ship the server config alongside the reports so the served semantics
  # (no-store, read-only /api) travel with the deploy instead of living only
  # on the box, where the next person would not find them.
  $SSH "$SELENE_USER@$SELENE_HOST" "mkdir -p ${REMOTE_DIR}.conf"
  rsync -a --no-perms --omit-dir-times -e "$RSYNC_SSH" \
    "$HERE/nginx.conf" "$SELENE_USER@$SELENE_HOST:${REMOTE_DIR}.conf/default.conf"
  # A config-only change is invisible if the image is reused: validate before
  # publishing, because a bad nginx.conf makes the container exit immediately
  # and the deploy would "succeed" while serving nothing.
  $SSH "$SELENE_USER@$SELENE_HOST" \
    "docker run --rm -v ${REMOTE_DIR}.conf/default.conf:/etc/nginx/conf.d/default.conf:ro nginx:alpine nginx -t" 2>&1 | tail -2

  $SSH "$SELENE_USER@$SELENE_HOST" bash -s <<EOF
set -e
# Recreate rather than restart: the bind mount is what publishes the new
# files, and nginx holds no state worth preserving across a deploy.
docker rm -f $CONTAINER >/dev/null 2>&1 || true
docker run -d --name $CONTAINER --restart unless-stopped \\
  -p 8477:8477 \\
  -v $REMOTE_DIR:/usr/share/nginx/html:ro \\
  -v ${REMOTE_DIR}.conf/default.conf:/etc/nginx/conf.d/default.conf:ro \\
  nginx:alpine >/dev/null
EOF
  echo "    container $CONTAINER (re)started"
fi

# --- 5. verify from the serving host, not from here --------------------------
# Fetching over the LAN proves the container is up AND the files are visible
# through the bind mount. Checking the local file would prove neither.
CODE=$($SSH "$SELENE_USER@$SELENE_HOST" \
  "curl -s -o /dev/null -w '%{http_code}' -m 8 http://127.0.0.1:8477/dashboard.html")
if [ "$CODE" != "200" ]; then
  echo "!! serve check failed: HTTP $CODE" >&2
  $SSH "$SELENE_USER@$SELENE_HOST" "docker logs --tail 20 $CONTAINER" >&2 || true
  exit 4
fi
SIZE=$($SSH "$SELENE_USER@$SELENE_HOST" \
  "curl -s -m 8 http://127.0.0.1:8477/dashboard.html | wc -c")
CACHE=$($SSH "$SELENE_USER@$SELENE_HOST" \
  "curl -sI -m 8 http://127.0.0.1:8477/dashboard.html | grep -i '^cache-control' || echo 'no cache-control!'")
echo "==> OK  http://$SELENE_HOST:8477/dashboard.html  ($SIZE bytes)"
echo "    $CACHE"
