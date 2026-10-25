#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 2 || "$2" != "--replace-current-data" ]]; then
    echo "Usage: bash deploy/restore.sh /absolute/backup-directory --replace-current-data" >&2
    exit 2
fi
backup_dir="$(cd "$1" && pwd)"
test -f "$backup_dir/COMPLETE"
source "$(dirname "${BASH_SOURCE[0]}")/project-config.sh"
restore_temporary=""
cleanup_restore() {
    if [[ -n "$restore_temporary" ]]; then
        rm -f -- "$restore_temporary/snapshot.tar" "$restore_temporary/database.dump" "$restore_temporary/files.tar.gz" "$restore_temporary/project.env" "$restore_temporary/images.json" "$restore_temporary/deployment.tar.gz"
        rmdir -- "$restore_temporary"
    fi
}
trap cleanup_restore EXIT
if [[ -f "$backup_dir/snapshot.tar.age" ]]; then
    command -v age >/dev/null || { echo 'Install age before decrypting a backup.' >&2; exit 2; }
    [[ -s "${BACKUP_IDENTITY_FILE:-}" ]] || { echo 'Set BACKUP_IDENTITY_FILE to a trusted private age identity for restore.' >&2; exit 2; }
    umask 077
    restore_temporary="$(mktemp -d)"
    age -d -i "$BACKUP_IDENTITY_FILE" -o "$restore_temporary/snapshot.tar" "$backup_dir/snapshot.tar.age"
    while IFS= read -r name; do
        case "$name" in database.dump|files.tar.gz|project.env|images.json|deployment.tar.gz) ;; *) echo 'Unexpected backup archive entry.' >&2; exit 2 ;; esac
    done < <(tar -tf "$restore_temporary/snapshot.tar")
    if tar -tvf "$restore_temporary/snapshot.tar" | grep -qv '^-'; then echo 'Backup may contain only regular files.' >&2; exit 2; fi
    tar --keep-old-files --no-same-owner --no-same-permissions -xf "$restore_temporary/snapshot.tar" -C "$restore_temporary"
    backup_dir="$restore_temporary"
elif [[ "${REQUIRE_BACKUP_ENCRYPTION:-false}" == true && "${ALLOW_LEGACY_PLAINTEXT_RESTORE:-false}" != true ]]; then
    echo 'Plaintext backup restore requires explicit ALLOW_LEGACY_PLAINTEXT_RESTORE=true for a trusted legacy snapshot.' >&2; exit 2
fi
test -s "$backup_dir/files.tar.gz"
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
    operator="${DB_OPERATOR_USER:-$DB_USER}"
    docker compose exec -T "$DB_SERVICE" dropdb -U "$operator" --if-exists "$DB_NAME"
    docker compose exec -T "$DB_SERVICE" createdb -U "$operator" -O "$DB_USER" "$DB_NAME"
    docker compose exec -T "$DB_SERVICE" pg_restore -U "$DB_USER" -d "$DB_NAME" --exit-on-error < "$backup_dir/database.dump"
fi
for directory in "${data_directories[@]}"; do
    docker compose run --rm --no-deps -T --entrypoint find "$APP_SERVICE" \
        "$DATA_ROOT/$directory" -mindepth 1 -delete
done
docker compose run --rm --no-deps -T --entrypoint tar "$APP_SERVICE" \
    --no-same-owner -C "$DATA_ROOT" -xzf - < "$backup_dir/files.tar.gz"
if [[ -n "${SESSION_DIRECTORY:-}" ]]; then
    docker compose run --rm --no-deps -T --entrypoint find "$APP_SERVICE" "$SESSION_DIRECTORY" -mindepth 1 -delete
fi
docker compose start "$APP_SERVICE"
echo "Restore finished; verify container health and application features."
