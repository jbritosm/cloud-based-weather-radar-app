#!/usr/bin/env bash
# Runs ON the EC2 instance. Invoked by .github/workflows/deploy.yml through SSM Run Command
# (no SSH, no stored keys).
#
# usage: deploy.sh <image-tag> <ghcr-owner> [site-address]
set -euo pipefail

TAG="${1:?image tag required}"
GHCR_OWNER="${2:?ghcr owner required}"
SITE_ADDRESS="${3:-:80}"

# Written once by the instance user_data (infra/__main__.py): BUCKET, REGION, PG_PARAM
source /opt/tfg/config.env
export AWS_DEFAULT_REGION="$REGION"

cd /opt/tfg

# Latest compose files + Caddyfile, uploaded by the workflow
aws s3 sync "s3://${BUCKET}/bundle/" /opt/tfg/

POSTGRES_PASSWORD="$(aws ssm get-parameter --name "$PG_PARAM" --with-decryption \
  --query Parameter.Value --output text)"

# Optional: only present once the AEMET_API_KEY GitHub secret has been stored by the workflow.
AEMET_API_KEY="$(aws ssm get-parameter --name "/tfg/aemet_api_key" --with-decryption \
  --query Parameter.Value --output text 2>/dev/null || true)"

umask 077
cat > .env <<EOF
GHCR_OWNER=${GHCR_OWNER}
TAG=${TAG}
SITE_ADDRESS=${SITE_ADDRESS}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
S3_BUCKET=${BUCKET}
AWS_REGION=${REGION}
AEMET_API_KEY=${AEMET_API_KEY}
EOF

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$COMPOSE pull
$COMPOSE up -d --remove-orphans
docker image prune -f
$COMPOSE ps
