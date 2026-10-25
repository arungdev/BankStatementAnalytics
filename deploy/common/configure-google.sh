#!/usr/bin/env bash
set -euo pipefail
# Credentials are read only on the remote terminal. Never enable shell tracing.
directory="$1"; service="$2"; port="$3"; profile="$4"; mode="${6:-configure}"
for name in "$directory" "$service" "$profile"; do [[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || exit 2; done
[[ "$port" =~ ^[0-9]+$ ]] && ((port >= 1 && port <= 65535)) || exit 2
[[ "$mode" == prepare || "$mode" == configure ]] || exit 2
[[ -t 0 ]] || { echo 'Run this helper in an interactive SSH terminal.' >&2; exit 2; }
if ((EUID != 0)); then
    if [[ -n "${BASH_EXECUTION_STRING:-}" ]]; then
        exec sudo bash -c "$BASH_EXECUTION_STRING" -- "$directory" "$service" "$port" "$profile" "$HOME" "$mode"
    else
        exec sudo bash "$0" "$directory" "$service" "$port" "$profile" "$HOME" "$mode"
    fi
fi
cd "${5:-$HOME}/$directory"
[[ -f .env && -f deploy/google-compose.yml ]] || { echo 'Updated deployment files are required. Run the newest Setup.bat.' >&2; exit 2; }
command -v python3 >/dev/null || { echo 'Install python3 first.' >&2; exit 2; }
if [[ "$mode" != prepare ]]; then
    curl -fsS --max-time 15 "http://127.0.0.1:$port/api/auth/options" |
        python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("cloudGoogleOnly") is True and "googleOwnerConfigured" not in d else 1)' || {
        echo 'Upgrade to the Google-only cloud application using the newest Setup.bat first.' >&2; exit 2;
    }
fi
[[ ! -L .env && ! -L secrets ]] || exit 2
umask 077
mkdir -p secrets; chmod 700 secrets
[[ ! -L secrets/google_client_secret.txt ]] || exit 2
client_id="$(sed -n 's/^GOOGLE_CLIENT_ID=//p' .env | tail -1 | tr -d '\r')"
reuse=false
if [[ -n "$client_id" && -s secrets/google_client_secret.txt ]]; then
    printf 'Saved Google Client ID: %s\n' "$client_id"
    echo 'Saved Google Client Secret: ******** (hidden)'
    while true; do
        read -r -p 'Reuse saved Google Client ID and Secret? (sample: y; Enter=Yes, n=replace, v=view saved credentials): ' answer
        case "${answer,,}" in
            ''|y|yes) reuse=true; break ;;
            n|no) break ;;
            v|view)
                echo 'Private credentials: visible in this terminal and its scrollback. Do not share screenshots.'
                printf 'Saved Google Client ID: %s\n' "$client_id"
                printf 'Saved Google Client Secret: '
                cat -- secrets/google_client_secret.txt
                printf '\n'
                ;;
            *) echo 'Enter y to reuse, n to replace, or v to view.' ;;
        esac
    done
fi
secret_tmp=''; env_tmp=''
cleanup() { unset client_secret; [[ -z "$secret_tmp" ]] || rm -f -- "$secret_tmp"; [[ -z "$env_tmp" ]] || rm -f -- "$env_tmp"; return 0; }
trap cleanup EXIT
if [[ "$reuse" != true ]]; then
    read -r -p 'Google Client ID (sample: your-client-id.apps.googleusercontent.com): ' client_id
    [[ "$client_id" =~ ^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$ ]] || { echo 'Invalid Google Client ID.' >&2; exit 2; }
    read -r -p 'Show Google Client Secret while entering? (sample: y; Enter=visible, n=hidden): ' show_secret
    case "${show_secret,,}" in
        ''|y|yes)
            echo 'The secret will remain visible in terminal scrollback. Do not share screenshots.'
            read -r -p 'Google Client Secret (sample format: paste-your-client-secret; visible): ' client_secret
            ;;
        n|no)
            read -r -s -p 'Google Client Secret (sample format: paste-your-client-secret; hidden): ' client_secret
            printf '\n'
            ;;
        *) echo 'Enter y or n.' >&2; exit 2 ;;
    esac
    [[ -n "$client_secret" && ${#client_secret} -le 512 && "$client_secret" != *$'\r'* ]] || { echo 'Invalid client secret.' >&2; exit 2; }
    secret_tmp="$(mktemp secrets/.google-secret.XXXXXX)"
    printf '%s' "$client_secret" > "$secret_tmp"; unset client_secret; chmod 444 "$secret_tmp"
fi
env_tmp="$(mktemp .google-env.XXXXXX)"
awk '!/^[[:space:]]*(export[[:space:]]+)?GOOGLE_(CLIENT_ID|OWNER_EMAIL)[[:space:]]*=/' .env > "$env_tmp"
printf '\nGOOGLE_CLIENT_ID=%s\n' "$client_id" >> "$env_tmp"
chmod 600 "$env_tmp"
if [[ -n "$secret_tmp" ]]; then mv -f -- "$secret_tmp" secrets/google_client_secret.txt; secret_tmp=''; fi
mv -f -- "$env_tmp" .env; env_tmp=''
touch .google-enabled; chmod 644 .google-enabled
if [[ "$mode" == prepare ]]; then echo 'Google-only cloud settings prepared. No application password or account linking is required.'; exit 0; fi
docker compose -f docker-compose.yml -f deploy/google-compose.yml --profile "$profile" config --quiet
docker compose -f docker-compose.yml -f deploy/google-compose.yml --profile "$profile" up -d --no-build --wait --wait-timeout 180
# File-backed Compose secrets can retain the old inode after atomic replacement.
# Google options are also read at process startup. Recreate only the application.
docker compose -f docker-compose.yml -f deploy/google-compose.yml --profile "$profile" up -d --no-deps --force-recreate --no-build --wait --wait-timeout 180 "$service"
curl -fsS --max-time 15 "http://127.0.0.1:$port/api/auth/options" |
    python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("google") and d.get("cloudGoogleOnly") else 1)' || {
    echo 'Google settings were not enabled. Inspect GoogleOAuth logs without printing secrets.' >&2; exit 1;
}
echo 'Google settings loaded and application healthy. Open the HTTPS site to verify Google sign-in; provider credentials are not validated by this health check.'
echo 'Every signup creates a regular private workspace. No cloud owner/admin account is assigned; management stays through SSH.'
