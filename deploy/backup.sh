#!/usr/bin/env bash
set -euo pipefail
export DEPLOY_PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$DEPLOY_PROJECT_ROOT/deploy/common/backup.sh" "$@"
