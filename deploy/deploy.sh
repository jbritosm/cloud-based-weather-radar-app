#!/usr/bin/env bash
# Runs ON the EC2 instance. Invoked by .github/workflows/deploy.yml through SSM Run Command
# (no SSH, no stored keys).
#
# usage: deploy.sh <image-tag> <ghcr-owner> [site-address] [rate-limit-per-minute]
set -euo pipefail

TAG="${1:?image tag required}"
GHCR_OWNER="${2:?ghcr owner required}"
SITE_ADDRESS="${3:-:80}"
RATE_LIMIT_PER_MINUTE="${4:-600}"

# Written once by the instance user_data (infra/__main__.py): BUCKET, REGION, PG_PARAM
source /opt/tfg/config.env
export AWS_DEFAULT_REGION="$REGION"

cd /opt/tfg

# Latest compose files, Caddyfile and helper scripts, uploaded by the workflow
aws s3 sync "s3://${BUCKET}/bundle/" /opt/tfg/
chmod +x /opt/tfg/deploy/*.sh

POSTGRES_PASSWORD="$(aws ssm get-parameter --name "$PG_PARAM" --with-decryption \
  --query Parameter.Value --output text)"

umask 077
cat > .env <<EOF
GHCR_OWNER=${GHCR_OWNER}
TAG=${TAG}
SITE_ADDRESS=${SITE_ADDRESS}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
S3_BUCKET=${BUCKET}
AWS_REGION=${REGION}
RATE_LIMIT_PER_MINUTE=${RATE_LIMIT_PER_MINUTE}
EOF

# Provider API keys: every parameter under /tfg/secrets/ becomes an environment variable
# (/tfg/secrets/aemet_api_key -> AEMET_API_KEY). Adding a key needs no change here.
# `$` is doubled because Docker Compose would otherwise expand it inside the .env file.
if SECRETS="$(aws ssm get-parameters-by-path --path /tfg/secrets --with-decryption \
    --query "Parameters[].[Name,Value]" --output text)"; then
  while IFS=$'\t' read -r name value; do
    [ -n "$name" ] || continue
    printf '%s=%s\n' "$(basename "$name" | tr '[:lower:]' '[:upper:]')" "${value//\$/\$\$}" >> .env
  done <<< "$SECRETS"
else
  # Not fatal (the app still works), but never silent: providers that need a key stay disabled
  echo "WARNING: could not read /tfg/secrets from SSM (is the infrastructure up to date?)" >&2
fi

# Nightly database backup and 5-minute health metric, as systemd timers (idempotent)
/opt/tfg/deploy/install-timers.sh

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$COMPOSE pull
$COMPOSE up -d --remove-orphans
docker image prune -f
$COMPOSE ps
