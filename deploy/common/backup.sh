#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/project-config.sh"
umask 077
mkdir -p backups
backup_dir="$(mktemp -d "$(pwd)/backups/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
docker compose exec -T "$APP_SERVICE" true
docker compose images --format json > "$backup_dir/images.json"
docker compose stop "$APP_SERVICE"
trap 'docker compose start "$APP_SERVICE"' EXIT
# Application is stopped for BOTH snapshots so DB, uploads and keys agree.
if [[ -n "${DB_SERVICE:-}" ]]; then
    docker compose exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$backup_dir/database.dump"
fi
cp deploy/project.env "$backup_dir/project.env"
docker compose run --rm --no-deps -T --entrypoint tar "$APP_SERVICE" \
    -C "$DATA_ROOT" -czf - "${data_directories[@]}" > "$backup_dir/files.tar.gz"
touch "$backup_dir/COMPLETE"
echo "Backup complete: $backup_dir"
