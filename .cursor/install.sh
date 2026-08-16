#!/usr/bin/env bash
#
# Cloud Agent install step for the Hijama Management System (Electron desktop app).
#
# The repository ships the application source as a committed bundle zip on the
# delivery branches, while working branches keep the source unpacked at the repo
# root. This script handles both layouts and installs Node dependencies (including
# the native modules better-sqlite3 and sharp) from the lockfile.
#
# It is idempotent: existing unpacked source is preserved and dependencies are
# refreshed on every run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/package.json" ]; then
  # Working branch: application source is already unpacked at the repo root.
  APP_DIR="$ROOT"
  echo "Found application source at repository root."
else
  # Delivery branch (e.g. main): source lives inside the committed bundle zip.
  APP_DIR="$ROOT/app"
  if [ ! -f "$APP_DIR/package.json" ]; then
    BUNDLE="$(ls "$ROOT"/*Hijama-Clinic-COMPLETE-ORIGINAL-vs-CURRENT*.zip 2>/dev/null | head -n1 || true)"
    if [ -z "${BUNDLE:-}" ]; then
      echo "ERROR: no root package.json and no source bundle zip found in $ROOT" >&2
      exit 1
    fi
    echo "Extracting application source from bundle: $BUNDLE"

    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT

    # Pull the clean "current" source archive out of the outer review bundle.
    unzip -o -q "$BUNDLE" "./02-CURRENT/CURRENT-FINAL-RESTORE-SOURCE.zip" -d "$TMP"
    NESTED="$TMP/02-CURRENT/CURRENT-FINAL-RESTORE-SOURCE.zip"

    mkdir -p "$APP_DIR"
    unzip -o -q "$NESTED" -d "$APP_DIR"
    echo "Application source unpacked to $APP_DIR"
  else
    echo "Application source already unpacked at $APP_DIR"
  fi
fi

cd "$APP_DIR"

echo "Installing Node dependencies in $APP_DIR ..."
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# Ensure the Electron runtime binary is present. Its download postinstall can be
# skipped depending on the npm/CI configuration, which would break `npm start`.
if [ -f "node_modules/electron/install.js" ] && [ ! -x "node_modules/electron/dist/electron" ]; then
  echo "Fetching Electron runtime binary ..."
  node node_modules/electron/install.js
fi

echo "Install complete. Application directory: $APP_DIR"
