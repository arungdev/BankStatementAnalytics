#!/usr/bin/env bash
# One interactive SSH terminal for installation, admin setup and HTTPS activation.
set -euo pipefail
[[ $# == 4 || ( $# == 5 && "$5" == unified ) ]] || { echo 'Expected domain, email, image tag, local tunnel port and optional unified mode.' >&2; exit 2; }
if [[ "${5:-}" == unified && "$EUID" != 0 ]]; then
    echo 'Sudo password sample: your Ubuntu administrator password (hidden).'
    exec sudo bash "$0" "$@"
fi
domain="$1"
email="$2"
version="$3"
local_port="$4"
[[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,63}$ ]]
[[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]]
[[ "$version" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]
[[ "$local_port" =~ ^[0-9]+$ && "$local_port" -ge 1 && "$local_port" -le 65535 ]]
source "$(dirname "${BASH_SOURCE[0]}")/project-config.sh"
elevate=()
if [[ "$EUID" != 0 ]]; then elevate=(sudo); fi
server_arguments=("$domain" "$email" "$version")
if [[ "${5:-}" == unified ]]; then server_arguments+=(unified); fi
"${elevate[@]}" bash deploy/server-deploy.sh "${server_arguments[@]}"
echo
google_cloud=false
options="$("${elevate[@]}" docker compose exec -T "$APP_SERVICE" curl -fsS "http://127.0.0.1:$APP_HOST_PORT/api/auth/options")" || true
if printf '%s' "$options" | grep -Eq '"cloudGoogleOnly"[[:space:]]*:[[:space:]]*true'; then
    google_cloud=true
    echo 'Cloud users sign up/sign in directly with Google. No application password or linking step.'
    echo 'Every signup is a regular private workspace. There is no cloud owner/admin account.'
else
    echo "Open http://localhost:$local_port to create the administrator (sample username: admin; choose a password of at least 15 characters)."
fi
enable_https=true
if [[ "$google_cloud" == true ]]; then
    echo 'Enabling HTTPS for Google signup. No application administrator bootstrap is needed.'
elif [[ -n "${SETUP_STATUS_URL:-}" ]]; then
    echo 'HTTPS starts automatically after administrator setup is complete.'
    while true; do
        status="$("${elevate[@]}" docker compose exec -T "$APP_SERVICE" curl -fsS "$SETUP_STATUS_URL")" || {
            echo 'Cannot check administrator setup. Leaving the app private; retry deployment after checking logs.' >&2; exit 1;
        }
        if printf '%s' "$status" | grep -Eq '"needsSetup"[[:space:]]*:[[:space:]]*false'; then break; fi
        if ! printf '%s' "$status" | grep -Eq '"needsSetup"[[:space:]]*:[[:space:]]*true'; then
            echo 'Setup status response is unrecognized. Leaving the app private.' >&2; exit 1;
        fi
        sleep 3
    done
else
    # Projects with another authentication system can confirm setup manually.
    read -r -p 'After administrator setup, press Enter for HTTPS (sample: Enter; or type SKIP): ' answer < /dev/tty
    answer="${answer//$'\r'/}"
    if [[ "${answer^^}" == SKIP ]]; then enable_https=false; fi
fi
if [[ "$enable_https" == true ]]; then
    if [[ -f .google-enabled ]]; then
        "${elevate[@]}" docker compose -f docker-compose.yml -f deploy/google-compose.yml --profile "$HTTPS_PROFILE" up -d --no-build --wait --wait-timeout 180
    else
        "${elevate[@]}" docker compose --profile "$HTTPS_PROFILE" up -d --no-build --wait --wait-timeout 180
    fi
    echo "Deployment ready: https://$domain"
    if [[ "${5:-}" == unified ]]; then
        tls_ready=false
        echo 'Checking the public-domain HTTPS certificate and reverse proxy...'
        for attempt in $(seq 1 30); do
            if curl -fsS --connect-timeout 5 --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain/api/auth/status" 2>/dev/null |
                grep -Eq '"needsSetup"[[:space:]]*:[[:space:]]*(true|false)'; then tls_ready=true; break; fi
            echo 'Waiting for HTTPS. DNS must point here and provider inbound TCP 80/443 must be open.'
            sleep 3
        done
        [[ "$tls_ready" == true ]] || { echo 'HTTPS could not be verified. Containers were kept running; correct DNS/firewall settings and rerun Setup.bat.' >&2; exit 1; }
        if [[ "$google_cloud" == true ]]; then
            echo "Open https://$domain and choose Sign up with Google. Existing Google users choose Sign in with Google."
            echo 'The setup tunnel will close; the HTTPS site stays running.'
            exit 0
        fi
        echo "Google OAuth redirect URI to register: https://$domain/signin-google"
        read -r -p 'Configure Google login now? (sample: y; Enter/N keeps current settings): ' google_answer < /dev/tty
        google_answer="${google_answer//$'\r'/}"
        case "${google_answer,,}" in
            y|yes)
                bash -c "$(cat deploy/common/configure-google.sh)" -- "$DEPLOY_DIRECTORY" "$APP_SERVICE" "$APP_HOST_PORT" "$HTTPS_PROFILE" "$(dirname "$PROJECT_ROOT")"
                ;;
            ''|n|no) echo 'Google settings were kept. You can run Setup.bat again to configure Google later.' ;;
            *) echo 'Unrecognized answer; Google settings were kept.' ;;
        esac
    fi
else
    echo 'HTTPS was not enabled by this run. Existing proxy settings are unchanged.'
fi
echo 'The setup tunnel will close when this SSH session ends.'
