#!/usr/bin/env bash
# Run in an isolated docker:cli runner with bash, age, openssh-keygen installed.
set -euo pipefail
cd /work
fixture="$(mktemp -d /work/.build/unified-upgrade.XXXXXX)"
export DEPLOY_PROJECT_ROOT="$fixture"
export COMPOSE_PROJECT_NAME="bsa-unified-$(basename "$fixture" | tr 'A-Z.' 'a-z-')"
cd "$fixture"
mkdir -p deploy secrets
printf '%s' 'Synthetic-upgrade-only-42' > secrets/db_password.txt
cp /work/deploy/common/project-config.sh /work/deploy/common/prepare-upgrade.sh /work/deploy/common/backup.sh deploy/
cat > deploy/project.env <<'CONFIG'
DEPLOY_IMAGE=arungs125/bankstatementanalytics
DEPLOY_VERSION=4.0.0
DEPLOY_DIRECTORY=synthetic
APP_SERVICE=app
DB_SERVICE=db
DB_NAME=bankstatements
DB_USER=bankstatements
DB_OPERATOR_USER=bsa_operator
APP_HOST_PORT=8080
DATA_ROOT=/app
DATA_DIRECTORIES=Data,Uploads
HEALTH_URL=http://127.0.0.1:8080/health
HTTPS_PROFILE=https
SUPPORTED_ARCH=x86_64
REQUIRE_BACKUP_ENCRYPTION=true
BACKUP_RECIPIENTS_FILE=secrets/backup-recipients.txt
CONFIG
cat > docker-compose.yml <<'COMPOSE'
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bankstatements
      POSTGRES_PASSWORD: Synthetic-upgrade-only-42
      POSTGRES_DB: bankstatements
    healthcheck:
      test: [CMD-SHELL, 'pg_isready -h 127.0.0.1 -U bankstatements -d bankstatements']
      interval: 2s
      timeout: 2s
      retries: 30
  app:
    image: arungs125/bankstatementanalytics:${APP_VERSION}
    environment:
      Database__PostgresConnectionString: Host=db;Database=bankstatements;Username=bankstatements;Password=Synthetic-upgrade-only-42
      Deployment__PublicHosting: 'true'
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - data:/app/Data
      - uploads:/app/Uploads
volumes:
  data:
  uploads:
COMPOSE
printf 'APP_VERSION=3.1.0-linux-1da6c7b\nGOOGLE_CLIENT_ID=preserve-synthetic-id\n' > .env
cleanup() { docker compose down --volumes >/dev/null; }
trap cleanup EXIT
docker compose up -d --wait --wait-timeout 120
docker compose exec -T db psql -U bankstatements -d bankstatements -v ON_ERROR_STOP=1 -c "CREATE TABLE upgrade_marker(value int); INSERT INTO upgrade_marker VALUES(42);"
docker compose exec -T app sh -c 'echo synthetic-data > /app/Uploads/upgrade-marker'
ssh-keygen -q -t ed25519 -N '' -f "$fixture/synthetic-recovery"
ssh-keygen -y -f "$fixture/synthetic-recovery" | awk '{print $1 " " $2}' > backup-recipient.pending.pub
bash deploy/prepare-upgrade.sh recipients
bash deploy/backup.sh
snapshot="$(find "$fixture/backups" -name COMPLETE -printf '%h\n' | sort | tail -1)"
test -s "$snapshot/snapshot.tar.age"
test ! -e "$snapshot/database.dump" && test ! -e "$snapshot/files.tar.gz" && test ! -e "$snapshot/deployment.tar.gz"
mkdir decrypted
age -d -i synthetic-recovery "$snapshot/snapshot.tar.age" | tar -xf - -C decrypted
docker compose exec -T db pg_restore --list < decrypted/database.dump > /dev/null
tar -tzf decrypted/files.tar.gz > /dev/null
tar -tzf decrypted/deployment.tar.gz | grep '.env' > /dev/null
echo 'PASS: actual legacy app backup is readable after off-server-key-compatible encryption; no plaintext snapshots remain.'
# Refuse to demote when an existing operator cannot authenticate.
good="$(printf '%064d' 1)"; bad="$(printf '%064d' 2)"
docker compose exec -T db psql -U bankstatements -d bankstatements -c "CREATE ROLE bsa_operator LOGIN SUPERUSER PASSWORD '$good';"
printf '%s' "$bad" > secrets/db_operator_password.txt
if bash deploy/prepare-upgrade.sh database "$snapshot"; then echo 'Mismatched operator secret was accepted.' >&2; exit 1; fi
[[ "$(docker compose exec -T db psql -U bankstatements -d bankstatements -Atc "SELECT rolsuper::text FROM pg_roles WHERE rolname='bankstatements'")" == true ]]
docker compose exec -T db psql -U bankstatements -d bankstatements -c 'DROP ROLE bsa_operator;'
rm secrets/db_operator_password.txt
bash deploy/prepare-upgrade.sh database "$snapshot"
first_secret="$(sha256sum secrets/db_operator_password.txt)"
bash deploy/prepare-upgrade.sh database "$snapshot"
[[ "$(sha256sum secrets/db_operator_password.txt)" == "$first_secret" ]]
echo 'PASS: operator authentication is verified before demotion; role migration succeeds and safely repeats without resetting its secret.'
# Exercise the complete server updater with only OS/service-manager checks stubbed.
# Real Docker, snapshots, role checks, .env preservation and image replacement run.
mkdir -p deploy/common .deployment-transfer
cp /work/deploy/common/prepare-upgrade.sh /work/deploy/common/project-config.sh deploy/common/
sed 's#^\. /etc/os-release$#ID=ubuntu#' /work/deploy/common/server-deploy.sh > deploy/common/server-deploy.sh
cp docker-compose.yml docker-compose.next.yml
ssh-keygen -y -f synthetic-recovery | awk '{print $1 " " $2}' > backup-recipient.pending.pub
systemctl() { :; }
export -f systemctl
bash deploy/common/server-deploy.sh synthetic.example.com test@example.com 4.0.0 unified
grep -Fx 'GOOGLE_CLIENT_ID=preserve-synthetic-id' .env > /dev/null
test -s .deployment-transfer/latest-snapshot.tar.age
test -s .env.previous && test -s docker-compose.previous.yml
[[ "$(docker compose exec -T db psql -U bankstatements -d bankstatements -Atc "SELECT rolcanlogin::text FROM pg_roles WHERE rolname='bsa_bootstrap_owner'")" == false ]]
[[ "$(docker compose exec -T db psql -U bankstatements -d bankstatements -Atc 'SELECT value FROM upgrade_marker')" == 42 ]]
docker compose exec -T app grep -q synthetic-data /app/Uploads/upgrade-marker
[[ "$(docker compose exec -T db psql -U bankstatements -d bankstatements -Atc "SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)::text FROM pg_roles WHERE rolname='bankstatements'")" == false ]]
echo 'PASS: real V3-to-V4 container update preserves database records and files and starts healthy with a restricted application role.'
