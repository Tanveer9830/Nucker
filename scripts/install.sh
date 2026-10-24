#!/usr/bin/env bash
# ==============================================================================
# TANVEER KA BETA NEWKER — SAFE UBUNTU / DEBIAN INSTALLER
# Creator: MADE BY TANVEER
# Exclusive Operator ID: 1131248987173814336
# ==============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGURE_SYSTEMD=false
SERVICE_USER="${SUDO_USER:-$(whoami)}"

for arg in "$@"; do
  case "$arg" in
    --with-systemd)
      CONFIGURE_SYSTEMD=true
      ;;
    --help|-h)
      echo "Usage: ./scripts/install.sh [--with-systemd]"
      echo "  --with-systemd   Install and reload systemd unit (requires sudo/root & systemctl)"
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

echo "=================================================================="
echo " TANVEER KA BETA NEWKER — INSTALLATION & VERIFICATION"
echo " Creator: MADE BY TANVEER"
echo " Working Directory: ${PROJECT_DIR}"
echo "=================================================================="

# 1. Check OS & command prerequisites
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "[1/9] Detected OS: ${PRETTY_NAME:-Linux}"
else
  echo "[1/9] Detected OS: $(uname -s)"
fi

for cmd in node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[ERROR] Required command '$cmd' is not installed." >&2
    echo "        Install Node.js 22 LTS on Ubuntu/Debian before rerunning." >&2
    exit 1
  fi
done

# 2. Verify Node.js version (>= 22.5.0 LTS required for native node:sqlite)
NODE_VER_RAW="$(node -p "process.versions.node")"
NODE_MAJOR="$(echo "$NODE_VER_RAW" | cut -d. -f1)"
NODE_MINOR="$(echo "$NODE_VER_RAW" | cut -d. -f2)"

if (( NODE_MAJOR < 22 )) || { (( NODE_MAJOR == 22 )) && (( NODE_MINOR < 5 )); }; then
  echo "[ERROR] Node.js >= 22.5.0 LTS is required (found v${NODE_VER_RAW})." >&2
  exit 1
fi
echo "[2/9] Verified Node.js v${NODE_VER_RAW} and npm v$(npm -v)"

cd "$PROJECT_DIR"

# 3. Install dependencies strictly from lockfile
if [[ ! -f package-lock.json ]]; then
  echo "[ERROR] package-lock.json is missing; refusing unlocked installation." >&2
  exit 1
fi
echo "[3/9] Installing locked dependencies via npm ci..."
npm ci --no-audit --no-fund

# 4. Preserve existing .env or initialize restricted .env from .env.example
if [[ -f .env ]]; then
  echo "[4/9] Preserving existing .env file (permissions tightened to 0600)."
  chmod 600 .env
else
  echo "[4/9] Creating new .env from .env.example (mode 0600)."
  cp .env.example .env
  chmod 600 .env
fi

# 5. Create restricted data directories & initialize SQLite migrations
mkdir -p ./data ./data/backups ./data/exports
chmod 700 ./data ./data/backups ./data/exports

echo "[5/9] Initializing SQLite database and running schema migrations..."
npm run db:migrate
npm run db:integrity

# 6. Run automated unit & integration acceptance tests
echo "[6/9] Running automated test suite..."
npm test

# 7. Validate runtime configuration
echo "[7/9] Validating runtime security configuration..."
npm run config:validate

# 8. Verify standalone startup lifecycle
echo "[8/9] Verifying application startup lifecycle..."
node --no-warnings=ExperimentalWarning src/index.js --verify-startup

# 9. Optional systemd unit installation
if [[ "$CONFIGURE_SYSTEMD" == "true" ]]; then
  echo "[9/9] Configuring optional systemd service..."
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "[ERROR] systemctl is not available on this host; cannot configure systemd." >&2
    exit 1
  fi
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "[ERROR] --with-systemd requires root/sudo privileges to write /etc/systemd/system/." >&2
    exit 1
  fi

  UNIT_TARGET="/etc/systemd/system/tanveer-beta-newker.service"
  NODE_BIN="$(command -v node)"
  sed \
    -e "s|__WORKING_DIR__|${PROJECT_DIR}|g" \
    -e "s|__SERVICE_USER__|${SERVICE_USER}|g" \
    -e "s|__NODE_BIN__|${NODE_BIN}|g" \
    deploy/tanveer-beta-newker.service > "$UNIT_TARGET"

  chmod 644 "$UNIT_TARGET"
  systemctl daemon-reload
  echo "      Installed ${UNIT_TARGET}. Enable & start after setting DISCORD_TOKEN in .env:"
  echo "      sudo systemctl enable --now tanveer-beta-newker"
  echo "      sudo systemctl status tanveer-beta-newker"
else
  echo "[9/9] Skipped systemd setup (pass --with-systemd as root to install service unit)."
fi

cat <<'EOF'

==================================================================
 INSTALLATION VERIFIED SUCCESSFULLY
==================================================================
Next Steps:
  1. Edit .env and set DISCORD_TOKEN, DISCORD_CLIENT_ID, and DEV_GUILD_ID:
       nano .env
  2. Re-validate configuration with Discord credentials required:
       npm run config:validate -- --require-discord
  3. Register operator-only Discord slash commands:
       npm run commands:register          # Instant registration to DEV_GUILD_ID
       npm run commands:register -- --global  # Global registration
  4. Start the application:
       npm start

Lifecycle Operations:
  - Backup SQLite DB:   ./scripts/backup.sh
  - Restore SQLite DB:  ./scripts/restore.sh <path-to-backup.sqlite>
  - Update deployment:  ./scripts/backup.sh && git pull --ff-only && ./scripts/install.sh
  - Rollback version:   git checkout <previous-commit-or-tag> && npm ci && ./scripts/restore.sh <backup.sqlite>
  - Uninstall service:  sudo systemctl disable --now tanveer-beta-newker && sudo rm -f /etc/systemd/system/tanveer-beta-newker.service && sudo systemctl daemon-reload
==================================================================
EOF
