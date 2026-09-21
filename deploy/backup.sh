#!/usr/bin/env bash
# Backs up the PostgreSQL database to S3. Runs ON the instance, nightly (tfg-backup.timer).
#
#   - dumps with pg_dump into a temporary file first, and checks it, so a failed or truncated dump
#     is never uploaded as if it were a good backup;
#   - uploads it as s3://<bucket>/backups/postgres/tfg-<UTC timestamp>.sql.gz (an S3 lifecycle rule
#     deletes old ones);
#   - publishes a CloudWatch metric (BackupSucceeded, or BackupFailed if anything went wrong); an
#     alarm on BackupFailed emails you.
#
# Restore: deploy/restore.sh
# Tunable through environment variables (used by the local test):
#   APP_DIR (/opt/tfg)  CONFIG_ENV ($APP_DIR/config.env)  COMPOSE_CMD (docker compose -f ...)
#   SKIP_METRIC=1 (no CloudWatch)  AWS_ENDPOINT_URL (S3 stand-in such as MinIO)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tfg}"
source "${CONFIG_ENV:-$APP_DIR/config.env}"   # BUCKET, REGION
export AWS_DEFAULT_REGION="$REGION"
cd "$APP_DIR"

COMPOSE="${COMPOSE_CMD:-docker compose -f docker-compose.yml -f docker-compose.prod.yml}"
KEY="backups/postgres/tfg-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
TMP="$(mktemp)"

metric() {  # <name> ; never allowed to hide the real error
  [ "${SKIP_METRIC:-0}" = "1" ] || aws cloudwatch put-metric-data --namespace TFG \
    --metric-name "$1" --value 1 --unit Count || true
}
trap 'rm -f "$TMP"' EXIT
# Any failure below tells CloudWatch, and an alarm emails you (infra/__main__.py: backup-failed)
trap 'metric BackupFailed' ERR

# --clean --if-exists: the dump can be replayed over an existing database
$COMPOSE exec -T db pg_dump -U tfg --no-owner --clean --if-exists tfg | gzip -9 > "$TMP"

gzip -t "$TMP"                                  # a valid gzip stream...
SIZE="$(wc -c < "$TMP")"
[ "$SIZE" -gt 500 ] || { echo "backup is suspiciously small (${SIZE} bytes): not uploading" >&2; exit 1; }
gzip -dc "$TMP" | grep -q "PostgreSQL database dump complete"   # ...that reached the end of the dump

aws s3 cp "$TMP" "s3://${BUCKET}/${KEY}" --only-show-errors
echo "backup ok: s3://${BUCKET}/${KEY} (${SIZE} bytes)"

metric BackupSucceeded
