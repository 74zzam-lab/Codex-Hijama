#!/usr/bin/env bash
#
# Cloud Agent install step for the Hijama Management System (Electron desktop app).
#
# Installs the system libraries needed to run Electron headlessly, then unpacks
# the application source and installs Node dependencies. Idempotent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# System libraries required by the Electron/Chromium runtime. Harmless if the
# base image already provides them. Guarded so a lack of sudo/apt is not fatal.
if command -v apt-get >/dev/null 2>&1; then
  SUDO=""
  if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  fi
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -qq || true
  $SUDO apt-get install -y -qq --no-install-recommends \
    libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2t64 libgtk-3-0t64 libpango-1.0-0 libcairo2 libatspi2.0-0 \
    libxshmfence1 || echo "WARN: could not install some Electron system libraries" >&2
fi

bash "$SCRIPT_DIR/ensure-app.sh"
echo "Install complete."
