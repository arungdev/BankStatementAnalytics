#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 2 || "$2" != "--replace-current-data" ]]; then
    echo "Usage: bash deploy/restore.sh /absolute/backup-directory --replace-current-data" >&2
    exit 2
fi
backup_dir="$(cd "$1" && pwd)"
test -f "$backup_dir/COMPLETE"
test -s "$backup_dir/files.tar.gz"
source "$(dirname "${BASH_SOURCE[0]}")/project-config.sh"
if [[ -n "${DB_SERVICE:-}" ]]; then test -s "$backup_dir/database.dump"; fi
if [[ -f "$backup_dir/project.env" ]]; then
    for key in APP_SERVICE DB_NAME DB_USER DATA_ROOT DATA_DIRECTORIES; do
        saved="$(grep "^${key}=" "$backup_dir/project.env" | tr -d '\r' || true)"
        if [[ -z "$saved" && -z "${!key:-}" ]]; then continue; fi
        [[ "$saved" == "$key=${!key:-}" ]] || { echo "Snapshot belongs to different project settings: $key" >&2; exit 2; }
    done
fi
docker compose stop "$APP_SERVICE"
# Leave the app stopped on failure. Never serve a partly restored instance.
if [[ -n "${DB_SERVICE:-}" ]]; then
    docker compose exec -T "$DB_SERVICE" dropdb -U "$DB_USER" --if-exists "$DB_NAME"
    docker compose exec -T "$DB_SERVICE" createdb -U "$DB_USER" -O "$DB_USER" "$DB_NAME"
    docker compose exec -T "$DB_SERVICE" pg_restore -U "$DB_USER" -d "$DB_NAME" --exit-on-error < "$backup_dir/database.dump"
fi
for directory in "${data_directories[@]}"; do
    docker compose run --rm --no-deps -T --entrypoint find "$APP_SERVICE" \
        "$DATA_ROOT/$directory" -mindepth 1 -delete
done
docker compose run --rm --no-deps -T --entrypoint tar "$APP_SERVICE" \
    --no-same-owner -C "$DATA_ROOT" -xzf - < "$backup_dir/files.tar.gz"
docker compose start "$APP_SERVICE"
echo "Restore finished; verify container health and application features."
