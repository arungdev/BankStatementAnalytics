#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/project-config.sh"
encrypt=false
recipient_file="${BACKUP_RECIPIENTS_FILE:-secrets/backup-recipients.txt}"
if [[ "${REQUIRE_BACKUP_ENCRYPTION:-false}" == true || -s "$recipient_file" ]]; then
    command -v age >/dev/null || { echo 'Install age before creating encrypted backups.' >&2; exit 2; }
    [[ -s "$recipient_file" ]] || { echo "Place the off-server backup recipient public key in $recipient_file." >&2; exit 2; }
    encrypt=true
fi
umask 077
mkdir -p backups
backup_dir="$(mktemp -d "$(pwd)/backups/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
docker compose exec -T "$APP_SERVICE" true
docker compose images --format json > "$backup_dir/images.json"
docker compose stop "$APP_SERVICE"
cleanup() {
    if [[ "$encrypt" == true ]]; then rm -f -- "$backup_dir/database.dump" "$backup_dir/files.tar.gz" "$backup_dir/deployment.tar.gz"; fi
    docker compose start "$APP_SERVICE"
}
trap cleanup EXIT
# Application is stopped for BOTH snapshots so DB, uploads and keys agree.
if [[ -n "${DB_SERVICE:-}" ]]; then
    docker compose exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$backup_dir/database.dump"
fi
cp deploy/project.env "$backup_dir/project.env"
docker compose run --rm --no-deps -T --entrypoint tar "$APP_SERVICE" \
    -C "$DATA_ROOT" -czf - "${data_directories[@]}" > "$backup_dir/files.tar.gz"
if [[ "$encrypt" == true ]]; then
    if [[ -n "${DB_SERVICE:-}" ]]; then docker compose exec -T "$DB_SERVICE" pg_restore --list < "$backup_dir/database.dump" > /dev/null; fi
    tar -tzf "$backup_dir/files.tar.gz" > /dev/null
    settings_files=()
    for item in .env docker-compose.yml secrets; do if [[ -e "$item" ]]; then settings_files+=("$item"); fi; done
    if ((${#settings_files[@]})); then tar -czf "$backup_dir/deployment.tar.gz" "${settings_files[@]}"; fi
    items=(files.tar.gz project.env images.json)
    if [[ -f "$backup_dir/deployment.tar.gz" ]]; then items+=(deployment.tar.gz); fi
    if [[ -f "$backup_dir/database.dump" ]]; then items+=(database.dump); fi
    tar -C "$backup_dir" -cf - "${items[@]}" | age -R "$recipient_file" -o "$backup_dir/snapshot.tar.age"
    rm -- "$backup_dir/files.tar.gz"
    if [[ -f "$backup_dir/database.dump" ]]; then rm -- "$backup_dir/database.dump"; fi
    if [[ -f "$backup_dir/deployment.tar.gz" ]]; then rm -- "$backup_dir/deployment.tar.gz"; fi
fi
touch "$backup_dir/COMPLETE"
echo "Backup complete: $backup_dir"
