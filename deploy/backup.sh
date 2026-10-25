#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
backup_dir="$(pwd)/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
docker compose exec -T bankstatementanalytics true
docker compose images --format json > "$backup_dir/images.json"
docker compose stop bankstatementanalytics
trap 'docker compose start bankstatementanalytics' EXIT
# Application is stopped for BOTH snapshots so DB, uploads and keys agree.
docker compose exec -T db pg_dump -U bankstatements -d bankstatements -Fc > "$backup_dir/database.dump"
docker compose run --rm --no-deps -T --entrypoint tar bankstatementanalytics \
    -C /app -czf - Data Uploads > "$backup_dir/files.tar.gz"
touch "$backup_dir/COMPLETE"
echo "Backup complete: $backup_dir"
