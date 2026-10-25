#!/usr/bin/env bash
# Invoked by the SSH launcher using sudo. No passwords travel from the Windows PC.
set -euo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run this deployment helper with sudo.' >&2; exit 1; }
[[ $# == 3 ]] || { echo 'Expected domain, certificate email and image tag.' >&2; exit 2; }
domain="$1"
email="$2"
version="$3"
[[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,63}$ ]]
[[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]]
[[ "$version" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]
cd "$(dirname "$0")/.."
. /etc/os-release
[[ "$ID" == ubuntu ]] || { echo 'This automatic installer supports Ubuntu only.' >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
    apt-get update
    apt-get install -y ca-certificates curl
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
        "$(dpkg --print-architecture)" "${UBUNTU_CODENAME:-$VERSION_CODENAME}" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
docker compose version >/dev/null || { echo 'Install the Docker Compose plugin, then rerun.' >&2; exit 1; }
systemctl enable --now docker
[[ "$(docker info --format '{{.Architecture}}')" == x86_64 ]] || {
    echo 'This published image requires an AMD64/x86_64 Ubuntu server.' >&2; exit 1;
}

# Pull before touching the running installation. A missing/private image fails here.
docker pull "arungs125/bankstatementanalytics:$version"
if [[ -f .env ]]; then
    [[ -f docker-compose.yml && -s secrets/db_password.txt ]] || {
        echo 'Existing configuration is incomplete; inspect it manually before retrying.' >&2; exit 1;
    }
    docker compose exec -T bankstatementanalytics true || {
        echo 'Start the existing installation before updating, so a consistent backup can be taken.' >&2; exit 1;
    }
    bash deploy/backup.sh
    cp .env .env.previous
    cp docker-compose.yml docker-compose.previous.yml
fi

install -d -m 0700 secrets
if [[ ! -s secrets/db_password.txt ]]; then
    (umask 077; od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > secrets/db_password.txt)
fi
chmod 0444 secrets/db_password.txt
umask 077
printf 'APP_IMAGE=arungs125/bankstatementanalytics\nAPP_VERSION=%s\nAPP_DOMAIN=%s\nACME_EMAIL=%s\n' \
    "$version" "$domain" "$email" > .env
mv docker-compose.next.yml docker-compose.yml
docker compose config --quiet
docker compose pull db
docker compose up -d --no-build --wait --wait-timeout 180
docker compose exec -T bankstatementanalytics curl -fsS http://127.0.0.1:8080/health
echo
echo 'Application started. Use the SSH tunnel for admin setup, then enable HTTPS.'
echo 'Allow inbound TCP 80/443 in the provider firewall; keep PostgreSQL and 8080 private.'
