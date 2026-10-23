# Deployment, Installation, Upgrade & Rollback Guide

> **Creator:** `MADE BY TANVEER`  
> **Supported Host OS:** Ubuntu 22.04 / 24.04 LTS, Debian 12+ (or any Linux x64/arm64 host with Node.js `>= 22.5.0` LTS)

## 1. Prerequisites

1. **Node.js LTS (`>= 22.5.0`)** and `npm`:
   ```bash
   node -v   # Must print v22.5.0 or higher (e.g., v22.22.3)
   npm -v
   ```
2. **Discord Application & Bot Credentials** from the Discord Developer Portal:
   - `DISCORD_CLIENT_ID` (Application ID)
   - `DISCORD_TOKEN` (Bot Token — never commit to Git)
   - `DEV_GUILD_ID` (Your private security lab Discord server ID)

---

## 2. Automated Safe Installer (`scripts/install.sh`)

From your checked-out working directory:

```bash
./scripts/install.sh
```

What `scripts/install.sh` performs and verifies:
1. Detects OS environment and checks `node` / `npm` availability.
2. Verifies Node.js `>= 22.5.0`.
3. Runs `npm ci --no-audit --no-fund` strictly from `package-lock.json`.
4. Preserves any existing `.env` file (tightening permissions to `0600`), or copies `.env.example` to `.env` (`0600`).
5. Creates `./data`, `./data/backups`, and `./data/exports` with `0700` permissions.
6. Runs SQLite migrations (`npm run db:migrate`) and verifies `PRAGMA integrity_check` (`npm run db:integrity`).
7. Runs the full automated test suite (`npm test`).
8. Validates runtime configuration (`npm run config:validate`).
9. Verifies clean application startup & shutdown (`node src/index.js --verify-startup`).

---

## 3. Registering Discord Slash Commands

After adding `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DEV_GUILD_ID` to `.env`:

```bash
# Validate credentials first
npm run config:validate -- --require-discord

# Register all 27 operator-only slash commands instantaneously to DEV_GUILD_ID
npm run commands:register

# Optional: Global registration across all guilds (Discord caches up to ~1 hour)
npm run commands:register -- --global
```

---

## 4. Optional `systemd` Service Setup

To install the hardened `systemd` unit (`deploy/tanveer-beta-newker.service`):

```bash
sudo ./scripts/install.sh --with-systemd
sudo systemctl enable --now tanveer-beta-newker
sudo systemctl status tanveer-beta-newker
```

Inspect logs safely (all secrets are automatically redacted by `Logger`):

```bash
sudo journalctl -u tanveer-beta-newker -f
```

---

## 5. Safe Upgrade Procedure

```bash
# 1. Create verified online SQLite backup
./scripts/backup.sh ./data/backups/pre-upgrade.sqlite

# 2. Record current commit for instant rollback if needed
git rev-parse HEAD > ./data/backups/pre-upgrade.commit

# 3. Pull latest verified code & run installer
git pull --ff-only
./scripts/install.sh

# 4. Re-register commands if command definitions changed & restart service
npm run commands:register
sudo systemctl restart tanveer-beta-newker
```

---

## 6. Rollback Procedure

```bash
sudo systemctl stop tanveer-beta-newker
git checkout "$(cat ./data/backups/pre-upgrade.commit)"
npm ci --no-audit --no-fund
./scripts/restore.sh ./data/backups/pre-upgrade.sqlite
npm test
sudo systemctl start tanveer-beta-newker
```

---

## 7. Backup & Uninstall Instructions

- **Manual Backup:** `./scripts/backup.sh`
- **Restore Backup:** `./scripts/restore.sh <path-to-backup.sqlite>`
- **Uninstall `systemd` Service:**
  ```bash
  sudo systemctl disable --now tanveer-beta-newker
  sudo rm -f /etc/systemd/system/tanveer-beta-newker.service
  sudo systemctl daemon-reload
  ```
  *(Preserve `./data/backups/` externally before deleting the working directory if you wish to retain historical evidence archives.)*
