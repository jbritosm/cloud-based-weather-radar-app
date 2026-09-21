#!/usr/bin/env bash
# Publishes a CloudWatch metric saying whether the API container is healthy (1) or not (0).
# Runs every 5 minutes (tfg-healthcheck.timer). An alarm watches the metric and emails you if the
# application is down, including when the whole instance is (no data counts as a failure).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tfg}"
source "${CONFIG_ENV:-$APP_DIR/config.env}"   # REGION
export AWS_DEFAULT_REGION="$REGION"

# Docker's own healthcheck of the API container (it asks /api/health, which queries the database)
STATUS="$(docker inspect --format '{{.State.Health.Status}}' tfg-api-1 2>/dev/null || echo missing)"
if [ "$STATUS" = "healthy" ]; then VALUE=1; else VALUE=0; fi

echo "api container: ${STATUS} -> metric ${VALUE}"
aws cloudwatch put-metric-data --namespace TFG --metric-name ApiHealthy --value "$VALUE" --unit Count
