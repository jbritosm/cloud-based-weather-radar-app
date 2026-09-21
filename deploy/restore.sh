#!/usr/bin/env bash
# Restores the PostgreSQL database from a backup in S3. Runs ON the instance.
#
#   sudo /opt/tfg/deploy/restore.sh list                      show the available backups
#   sudo /opt/tfg/deploy/restore.sh latest --yes              restore the newest one
#   sudo /opt/tfg/deploy/restore.sh tfg-20260922T033000Z.sql.gz --yes
#
# This REPLACES the current data (the dump drops and recreates the tables). The API and the worker
# are stopped while it runs and started again afterwards. Without --yes nothing is changed.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tfg}"
source "${CONFIG_ENV:-$APP_DIR/config.env}"   # BUCKET, REGION
export AWS_DEFAULT_REGION="$REGION"
cd "$APP_DIR"
COMPOSE="${COMPOSE_CMD:-docker compose -f docker-compose.yml -f docker-compose.prod.yml}"
PREFIX="s3://${BUCKET}/backups/postgres/"

WHICH="${1:?usage: restore.sh list | latest | <backup file name> [--yes]}"

if [ "$WHICH" = "list" ]; then
  aws s3 ls "$PREFIX" | awk '{print $1, $2, $3, $4}'
  exit 0
fi

if [ "$WHICH" = "latest" ]; then
  WHICH="$(aws s3 ls "$PREFIX" | awk '{print $4}' | grep '\.sql\.gz$' | sort | tail -n 1)"
  [ -n "$WHICH" ] || { echo "no backups found in $PREFIX" >&2; exit 1; }
fi

echo "backup to restore: ${PREFIX}${WHICH}"
if [ "${2:-}" != "--yes" ]; then
  echo "This would REPLACE the current database. Run again with --yes to do it."
  exit 2
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
aws s3 cp "${PREFIX}${WHICH}" "$TMP" --only-show-errors
gzip -t "$TMP"

$COMPOSE stop api worker
gzip -dc "$TMP" | $COMPOSE exec -T db psql -U tfg -d tfg -v ON_ERROR_STOP=1 --quiet
$COMPOSE start api worker
echo "restored from ${WHICH}"
