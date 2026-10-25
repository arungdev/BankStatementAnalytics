#!/usr/bin/env bash
# Invoked by the SSH launcher using sudo. No passwords travel from the Windows PC.
set -euo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run this deployment helper with sudo.' >&2; exit 1; }
[[ $# == 3 || ( $# == 4 && "$4" == unified ) ]] || { echo 'Expected domain, certificate email, image tag and optional unified mode.' >&2; exit 2; }
domain="$1"
email="$2"
version="$3"
unified="${4:-}"
[[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,63}$ ]]
[[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]]
[[ "$version" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]
source "$(dirname "${BASH_SOURCE[0]}")/project-config.sh"
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
if [[ "$unified" == unified ]]; then
    if ! command -v python3 >/dev/null || ! command -v curl >/dev/null; then apt-get update; apt-get install -y python3 curl; fi
    bash deploy/common/prepare-upgrade.sh recipients
fi
if [[ "${REQUIRE_BACKUP_ENCRYPTION:-false}" == true ]] && ! command -v age >/dev/null; then
    apt-get update
    apt-get install -y age
fi
[[ "$(docker info --format '{{.Architecture}}')" == "$SUPPORTED_ARCH" ]] || {
    echo "This image requires architecture $SUPPORTED_ARCH." >&2; exit 1;
}

# Acquire the image before touching the running installation.
image_archive="images/application-$version.tar"
if [[ -s "$image_archive" ]]; then
    docker load -i "$image_archive"
    docker image inspect "$DEPLOY_IMAGE:$version" >/dev/null || {
        echo "The bundled archive does not contain $DEPLOY_IMAGE:$version." >&2; exit 1;
    }
    rm -- "$image_archive"
elif ! docker pull "$DEPLOY_IMAGE:$version"; then
    echo "Cannot download $DEPLOY_IMAGE:$version. Installation has not changed application data." >&2
    echo 'The publisher must upload this exact tag. For a private repository, run sudo docker login on this server and retry.' >&2
    exit 1
fi
if [[ -f .env ]]; then
    [[ -f docker-compose.yml && -s secrets/db_password.txt ]] || {
        echo 'Existing configuration is incomplete; inspect it manually before retrying.' >&2; exit 1;
    }
    docker compose exec -T "$APP_SERVICE" true || {
        echo 'Start the existing installation before updating, so a consistent backup can be taken.' >&2; exit 1;
    }
    backup_log="$(mktemp)"
    bash deploy/backup.sh | tee "$backup_log"
    if [[ "$unified" == unified ]]; then
        snapshot="$(sed -n 's/^Backup complete: //p' "$backup_log" | tail -1)"
        [[ -n "$snapshot" && -s "$snapshot/snapshot.tar.age" ]] || { echo 'No encrypted upgrade snapshot was produced.' >&2; exit 2; }
        [[ -d .deployment-transfer && ! -L .deployment-transfer ]] || exit 2
        install -m 0600 -o "${SUDO_UID:-0}" -g "${SUDO_GID:-0}" "$snapshot/snapshot.tar.age" .deployment-transfer/latest-snapshot.tar.age
        if [[ -n "${DB_SERVICE:-}" ]]; then bash deploy/common/prepare-upgrade.sh database "$snapshot"; fi
    fi
    rm -- "$backup_log"
    cp .env .env.previous
    cp docker-compose.yml docker-compose.previous.yml
fi

install -d -m 0700 secrets
if [[ ! -s secrets/db_password.txt ]]; then
    (umask 077; od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > secrets/db_password.txt)
fi
chmod 0444 secrets/db_password.txt
if [[ ! -s secrets/db_operator_password.txt ]]; then
    (umask 077; od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > secrets/db_operator_password.txt)
fi
chmod 0444 secrets/db_operator_password.txt
umask 077
touch .env
if [[ "$unified" == unified && -f deploy/google-compose.yml && "${DEPLOY_REUSE_SETTINGS:-false}" != true ]]; then
    echo "Google redirect URI to register: https://$domain/signin-google"
    bash -c "$(cat deploy/common/configure-google.sh)" -- "$DEPLOY_DIRECTORY" "$APP_SERVICE" "$APP_HOST_PORT" "$HTTPS_PROFILE" "$(dirname "$PROJECT_ROOT")" prepare
fi
env_tmp="$(mktemp .env-update.XXXXXX)"
awk '!/^(APP_IMAGE|APP_VERSION|APP_DOMAIN|ACME_EMAIL)=/' .env > "$env_tmp"
printf '\nAPP_IMAGE=%s\nAPP_VERSION=%s\nAPP_DOMAIN=%s\nACME_EMAIL=%s\n' \
    "$DEPLOY_IMAGE" "$version" "$domain" "$email" >> "$env_tmp"
chmod 600 "$env_tmp"
mv -- "$env_tmp" .env
mv docker-compose.next.yml docker-compose.yml
docker compose config --quiet
if [[ -n "${DB_SERVICE:-}" ]]; then docker compose pull "$DB_SERVICE"; fi
compose_files=(-f docker-compose.yml)
if [[ -s secrets/google_client_secret.txt ]] && grep -Eq '^GOOGLE_CLIENT_ID=.+$' .env; then
    compose_files+=(-f deploy/google-compose.yml)
    touch .google-enabled; chmod 644 .google-enabled
else rm -f .google-enabled; fi
docker compose "${compose_files[@]}" up -d --no-build --wait --wait-timeout 180
docker compose exec -T "$APP_SERVICE" curl -fsS "$HEALTH_URL"
echo
echo 'Application started. Use the SSH tunnel for admin setup, then enable HTTPS.'
echo 'Allow inbound TCP 80/443 in the provider firewall; keep PostgreSQL and 8080 private.'
