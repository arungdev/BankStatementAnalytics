#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
module="$(pwd)/deploy/common"
mkdir -p .build
fixture="$(mktemp -d "$(pwd)/.build/https-session.XXXXXX")"
mkdir -p "$fixture/deploy"
cat > "$fixture/deploy/project.env" <<'CONFIG'
DEPLOY_IMAGE=example/test
DEPLOY_VERSION=testing
DEPLOY_DIRECTORY=testapp
APP_SERVICE=testapp
DB_SERVICE=
APP_HOST_PORT=9090
DATA_ROOT=/data
DATA_DIRECTORIES=Files
HEALTH_URL=http://127.0.0.1:9090/health
SETUP_STATUS_URL=http://127.0.0.1:9090/api/auth/status
HTTPS_PROFILE=secure
SUPPORTED_ARCH=x86_64
CONFIG
printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/deploy/server-deploy.sh"
export DEPLOY_PROJECT_ROOT="$fixture"
export HTTPS_TEST_TRACE="$fixture/commands.txt"
docker() {
    printf '%s\n' "$*" >> "$HTTPS_TEST_TRACE"
    if [[ "$*" == *'/api/auth/options'* && "$HTTPS_TEST_SCENARIO" == cloud ]]; then printf '{"cloudGoogleOnly":true}'; fi
    if [[ "$*" == *'/api/auth/status'* ]]; then
        case "$HTTPS_TEST_SCENARIO" in
            invalid) printf '{"unexpected":true}' ;;
            pending)
                if [[ "$(grep -c '/api/auth/status' "$HTTPS_TEST_TRACE")" == 1 ]]; then
                    printf '{"needsSetup":true}'
                else printf '{"needsSetup":false}'; fi ;;
            *) printf '{"needsSetup":false}' ;;
        esac
    fi
}
sudo() { "$@"; }
sleep() { :; }
export -f docker sudo sleep
for HTTPS_TEST_SCENARIO in ready pending invalid google cloud; do
    export HTTPS_TEST_SCENARIO
    : > "$HTTPS_TEST_TRACE"
    rm -f "$fixture/.google-enabled"
    if [[ "$HTTPS_TEST_SCENARIO" == google ]]; then touch "$fixture/.google-enabled"; fi
    if [[ "$HTTPS_TEST_SCENARIO" == cloud ]]; then touch "$fixture/.google-enabled"; fi
    if [[ "$HTTPS_TEST_SCENARIO" == invalid ]]; then
        if bash "$module/session-deploy.sh" test.example.com test@example.com testing 18080; then
            echo 'Invalid setup response exposed HTTPS' >&2; exit 1
        fi
        ! grep -q -- '--profile secure up' "$HTTPS_TEST_TRACE"
    else
        bash "$module/session-deploy.sh" test.example.com test@example.com testing 18080
        grep -q -- '--profile secure up -d --no-build --wait' "$HTTPS_TEST_TRACE"
        if [[ "$HTTPS_TEST_SCENARIO" == google ]]; then grep -q -- '-f deploy/google-compose.yml --profile secure' "$HTTPS_TEST_TRACE"; fi
        if [[ "$HTTPS_TEST_SCENARIO" == cloud ]]; then ! grep -q '/api/auth/status' "$HTTPS_TEST_TRACE"; fi
        if [[ "$HTTPS_TEST_SCENARIO" == pending ]]; then
            [[ "$(grep -c '/api/auth/status' "$HTTPS_TEST_TRACE")" == 2 ]]
        fi
    fi
    echo "PASS: automatic HTTPS session, setup state=$HTTPS_TEST_SCENARIO"
done
