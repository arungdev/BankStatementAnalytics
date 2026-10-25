#!/usr/bin/env bash
# Destructive verification: use ONLY on a disposable Compose project/database.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "${BSA_DISPOSABLE_TEST:-}" == "yes" ]] || { echo 'Requires BSA_DISPOSABLE_TEST=yes' >&2; exit 2; }
docker compose up -d --wait --wait-timeout 180
curl -fsS http://127.0.0.1:8080/ | grep -q '<html'
[[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/accounts)" == "401" ]]
mkdir -p .build
cookie_file="$(mktemp ./.build/smoke-cookie.XXXXXX)"
trap 'rm -f "$cookie_file" "$cookie_file.pdf"' EXIT
auth_action=login
if curl -fsS http://127.0.0.1:8080/api/auth/status | grep -q '"needsSetup":true'; then
    auth_action=setup
fi
curl -fsS -c "$cookie_file" -H 'Content-Type: application/json' \
    -d '{"username":"deployment-smoke","password":"Synthetic-test-only-42!"}' \
    "http://127.0.0.1:8080/api/auth/$auth_action" > /dev/null
curl -fsS -b "$cookie_file" http://127.0.0.1:8080/api/accounts > /dev/null
account_json="$(curl -fsS -b "$cookie_file" -H 'Content-Type: application/json' \
    -H 'Origin: http://127.0.0.1:8080' \
    -d '{"accountHolderName":"Synthetic test account","accountNumber":"0000000000","bankName":"HDFC"}' \
    http://127.0.0.1:8080/api/accounts)"
account_id="$(printf '%s' "$account_json" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')"
test -n "$account_id"
curl -fsS -b "$cookie_file" \
    "http://127.0.0.1:8080/api/reports/pdf?type=month&year=2026&month=1&accountIds=$account_id" \
    -o "$cookie_file.pdf"
[[ "$(head -c 5 "$cookie_file.pdf")" == '%PDF-' ]]
docker compose exec -T bankstatementanalytics sh -c 'test "$(id -u)" != 0; echo persistence-check > /app/Uploads/smoke-marker'
docker compose exec -T db psql -U bankstatements -d bankstatements -v ON_ERROR_STOP=1 \
    -c 'DROP TABLE IF EXISTS deployment_smoke; CREATE TABLE deployment_smoke (value integer); INSERT INTO deployment_smoke VALUES (42);'
docker compose up -d --force-recreate --no-deps --wait --wait-timeout 180 bankstatementanalytics
docker compose exec -T bankstatementanalytics grep -q persistence-check /app/Uploads/smoke-marker
bash deploy/backup.sh
snapshot="$(find "$(pwd)/backups" -name COMPLETE -printf '%h\n' | sort | tail -1)"
docker compose exec -T db psql -U bankstatements -d bankstatements -v ON_ERROR_STOP=1 -c 'UPDATE deployment_smoke SET value = 99;'
docker compose exec -T bankstatementanalytics sh -c 'echo changed > /app/Uploads/smoke-marker'
bash deploy/restore.sh "$snapshot" --replace-current-data
docker compose up -d --wait --wait-timeout 180
docker compose exec -T bankstatementanalytics grep -q persistence-check /app/Uploads/smoke-marker
[[ "$(docker compose exec -T db psql -U bankstatements -d bankstatements -Atc 'SELECT value FROM deployment_smoke')" == "42" ]]
docker compose exec -T bankstatementanalytics curl -fsS http://127.0.0.1:8080/health
test "$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie_file" http://127.0.0.1:8080/api/accounts)" = 401
curl -fsS -c "$cookie_file" -H 'Content-Type: application/json' \
    -d '{"username":"deployment-smoke","password":"Synthetic-test-only-42!"}' \
    http://127.0.0.1:8080/api/auth/login > /dev/null
curl -fsS -b "$cookie_file" http://127.0.0.1:8080/api/accounts > /dev/null
echo 'PASS: startup, SPA, auth, non-root user, persistence, encrypted snapshot restore and session revocation'
