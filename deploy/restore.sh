#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 2 || "$2" != "--replace-current-data" ]]; then
    echo "Usage: bash deploy/restore.sh /absolute/backup-directory --replace-current-data" >&2
    exit 2
fi
backup_dir="$(cd "$1" && pwd)"
test -f "$backup_dir/COMPLETE"
test -s "$backup_dir/database.dump"
test -s "$backup_dir/files.tar.gz"
cd "$(dirname "$0")/.."
docker compose stop bankstatementanalytics
# Leave the app stopped on failure. Never serve a partly restored instance.
docker compose exec -T db dropdb -U bankstatements --if-exists bankstatements
docker compose exec -T db createdb -U bankstatements -O bankstatements bankstatements
docker compose exec -T db pg_restore -U bankstatements -d bankstatements --exit-on-error < "$backup_dir/database.dump"
docker compose run --rm --no-deps -T --entrypoint sh bankstatementanalytics \
    -c 'find /app/Data /app/Uploads -mindepth 1 -delete'
docker compose run --rm --no-deps -T --entrypoint tar bankstatementanalytics \
    --no-same-owner -C /app -xzf - < "$backup_dir/files.tar.gz"
docker compose start bankstatementanalytics
echo "Restore finished; verify container health and application features."
