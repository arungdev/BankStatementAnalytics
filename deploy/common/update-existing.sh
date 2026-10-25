#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run this update helper with sudo.' >&2; exit 2; }
[[ $# == 2 ]] || { echo 'Expected image version and tunnel port.' >&2; exit 2; }
[[ -f .env && ! -L .env && -f docker-compose.yml && -s secrets/db_password.txt ]] || {
    echo 'An existing installation is required. Use Setup.bat for a new server.' >&2; exit 2;
}
# Read only the two saved plain values. Never execute the .env as shell code.
domain="$(sed -n 's/^APP_DOMAIN=//p' .env | tail -1 | tr -d '\r')"
email="$(sed -n 's/^ACME_EMAIL=//p' .env | tail -1 | tr -d '\r')"
[[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,63}$ ]] || { echo 'Saved domain is missing or invalid. Run Setup.bat.' >&2; exit 2; }
[[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]] || { echo 'Saved certificate email is missing or invalid. Run Setup.bat.' >&2; exit 2; }
if [[ -f deploy/google-compose.yml ]]; then
    grep -Eq '^GOOGLE_CLIENT_ID=.+$' .env && [[ -s secrets/google_client_secret.txt ]] || {
        echo 'Saved Google settings are incomplete. Run Setup.bat first.' >&2; exit 2;
    }
fi
echo "Updating existing installation at https://$domain using saved settings."
export DEPLOY_REUSE_SETTINGS=true
exec bash deploy/common/session-deploy.sh "$domain" "$email" "$1" "$2" unified
