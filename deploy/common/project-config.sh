#!/usr/bin/env bash
# This file is sourced by the module, never by an untrusted remote config.
PROJECT_ROOT="${DEPLOY_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_ROOT"
[[ -f deploy/project.env ]] || { echo 'Missing deploy/project.env' >&2; exit 2; }
# Parse literal KEY=value settings, not shell code. Do not eval or source them.
while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" =~ ^([A-Z_]+)=([A-Za-z0-9_./,:+-]*)$ ]] || { echo 'Invalid project setting' >&2; exit 2; }
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case "$key" in
        DEPLOY_IMAGE|DEPLOY_VERSION|DEPLOY_DIRECTORY|APP_SERVICE|DB_SERVICE|DB_NAME|DB_USER|DB_OPERATOR_USER|SESSION_DIRECTORY|BACKUP_RECIPIENTS_FILE|REQUIRE_BACKUP_ENCRYPTION|APP_HOST_PORT|DATA_ROOT|DATA_DIRECTORIES|HEALTH_URL|SETUP_STATUS_URL|HTTPS_PROFILE|SUPPORTED_ARCH)
            printf -v "$key" '%s' "$value" ;;
        *) echo "Unknown project setting: $key" >&2; exit 2 ;;
    esac
done < deploy/project.env
for key in DEPLOY_IMAGE DEPLOY_VERSION DEPLOY_DIRECTORY APP_SERVICE APP_HOST_PORT DATA_ROOT DATA_DIRECTORIES HEALTH_URL HTTPS_PROFILE SUPPORTED_ARCH; do
    [[ -n "${!key:-}" ]] || { echo "Missing project setting: $key" >&2; exit 2; }
done
[[ "$DEPLOY_DIRECTORY" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]
[[ "$APP_SERVICE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]
[[ "$APP_HOST_PORT" =~ ^[0-9]+$ && "$APP_HOST_PORT" -ge 1 && "$APP_HOST_PORT" -le 65535 ]]
[[ "$DATA_ROOT" =~ ^(/[a-zA-Z0-9_-]+)+$ ]] || { echo 'Unsafe DATA_ROOT' >&2; exit 2; }
IFS=, read -r -a data_directories <<< "$DATA_DIRECTORIES"
for directory in "${data_directories[@]}"; do
    [[ "$directory" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Unsafe data directory' >&2; exit 2; }
done
if [[ -n "${DB_SERVICE:-}" ]]; then
    [[ "$DB_SERVICE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ && "${DB_NAME:-}" =~ ^[a-zA-Z0-9_]+$ && "${DB_USER:-}" =~ ^[a-zA-Z0-9_]+$ ]]
fi
if [[ -n "${DB_OPERATOR_USER:-}" ]]; then [[ "$DB_OPERATOR_USER" =~ ^[a-zA-Z0-9_]+$ ]]; fi
if [[ -n "${SESSION_DIRECTORY:-}" ]]; then [[ "$SESSION_DIRECTORY" =~ ^(/[a-zA-Z0-9_-]+)+$ ]]; fi
