#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
module="$(pwd)/deploy/common"
mkdir -p .build
fixture="$(mktemp -d "$(pwd)/.build/deployment-reuse.XXXXXX")"
export DEPLOY_PROJECT_ROOT="$fixture"
export DEPLOY_TEST_TRACE="$fixture/docker-commands.txt"
mkdir -p "$fixture/deploy"
cat > "$fixture/deploy/project.env" <<'CONFIG'
DEPLOY_IMAGE=example/invoice-service
DEPLOY_VERSION=testing
DEPLOY_DIRECTORY=invoicing
APP_SERVICE=invoicing
DB_SERVICE=invoice_postgres
DB_NAME=invoice_db
DB_USER=invoice_owner
APP_HOST_PORT=9090
DATA_ROOT=/srvdata
DATA_DIRECTORIES=Documents,Keys
HEALTH_URL=http://127.0.0.1:9090/ready
HTTPS_PROFILE=secure
SUPPORTED_ARCH=x86_64
CONFIG

# This contract test never starts Docker or touches a real database/volume.
docker() {
    printf '%s\n' "$*" >> "$DEPLOY_TEST_TRACE"
    case "$*" in
        *pg_dump*) printf 'synthetic database snapshot' ;;
        *'-czf -'*) printf 'synthetic file snapshot' ;;
        *pg_restore*|*'-xzf -'*) cat > /dev/null ;;
    esac
    return 0
}
export -f docker
bash "$module/backup.sh"
snapshot="$(find "$fixture/backups" -name COMPLETE -printf '%h\n' | head -1)"
test -n "$snapshot"
bash "$module/restore.sh" "$snapshot" --replace-current-data
grep -q 'compose stop invoicing' "$DEPLOY_TEST_TRACE"
grep -q 'pg_dump -U invoice_owner -d invoice_db' "$DEPLOY_TEST_TRACE"
grep -q 'createdb -U invoice_owner -O invoice_owner invoice_db' "$DEPLOY_TEST_TRACE"
grep -q '/srvdata/Documents -mindepth 1 -delete' "$DEPLOY_TEST_TRACE"
grep -q '/srvdata/Keys -mindepth 1 -delete' "$DEPLOY_TEST_TRACE"
! grep -qi 'bankstatement' "$DEPLOY_TEST_TRACE"
echo 'PASS: backup/restore use another project service, database, user and storage configuration'

sed 's#DATA_ROOT=/srvdata#DATA_ROOT=/#' "$fixture/deploy/project.env" > "$fixture/invalid.env"
cp "$fixture/deploy/project.env" "$fixture/valid.env"
cp "$fixture/invalid.env" "$fixture/deploy/project.env"
if bash "$module/backup.sh" 2>/dev/null; then echo 'Unsafe root accepted' >&2; exit 1; fi
echo 'PASS: unsafe container data root is rejected before Docker operations'

sed 's/DB_SERVICE=invoice_postgres/DB_SERVICE=/' "$fixture/valid.env" > "$fixture/deploy/project.env"
: > "$DEPLOY_TEST_TRACE"
bash "$module/backup.sh"
! grep -q pg_dump "$DEPLOY_TEST_TRACE"
echo 'PASS: file-only projects do not run PostgreSQL commands'
sed 's/DB_NAME=invoice_db/DB_NAME=other_db/' "$fixture/valid.env" > "$fixture/deploy/project.env"
: > "$DEPLOY_TEST_TRACE"
if bash "$module/restore.sh" "$snapshot" --replace-current-data 2>/dev/null; then
    echo 'Cross-project snapshot accepted' >&2; exit 1
fi
test ! -s "$DEPLOY_TEST_TRACE"
echo 'PASS: a snapshot for another database is rejected before destructive operations'
echo "Synthetic test artifacts: $fixture"
