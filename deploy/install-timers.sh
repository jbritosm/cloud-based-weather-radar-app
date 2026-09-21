#!/usr/bin/env bash
# Installs (or refreshes) the systemd timers that run on the instance. Called by deploy.sh on every
# deploy; safe to run again.
#   tfg-backup       every night at 03:30 UTC: PostgreSQL dump to S3 (deploy/backup.sh)
#   tfg-healthcheck  every 5 minutes: publishes whether the API container is healthy (deploy/healthcheck.sh)
set -euo pipefail

write_unit() {  # <name> <description> <script>
  cat > "/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=$2
After=docker.service

[Service]
Type=oneshot
ExecStart=/opt/tfg/deploy/$3
EOF
}

write_timer() {  # <name> <description> <timer settings...>
  local name="$1" description="$2"
  shift 2
  {
    printf '[Unit]\nDescription=%s\n\n[Timer]\n' "$description"
    printf '%s\n' "$@"
    printf '\n[Install]\nWantedBy=timers.target\n'
  } > "/etc/systemd/system/${name}.timer"
}

write_unit tfg-backup "TFG nightly PostgreSQL backup to S3" backup.sh
# Persistent: a run missed while the instance was stopped happens at the next boot
write_timer tfg-backup "TFG nightly backup" \
  "OnCalendar=*-*-* 03:30:00" "RandomizedDelaySec=300" "Persistent=true"

write_unit tfg-healthcheck "TFG API health metric" healthcheck.sh
write_timer tfg-healthcheck "TFG health metric every 5 minutes" \
  "OnBootSec=2min" "OnUnitActiveSec=5min"

systemctl daemon-reload
systemctl enable --now tfg-backup.timer tfg-healthcheck.timer
