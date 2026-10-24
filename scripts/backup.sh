#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [[ $# -ge 1 ]]; then
  npm run db:backup -- "$1"
else
  npm run db:backup
fi
