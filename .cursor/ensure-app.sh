#!/usr/bin/env bash
#
# Ensure the Hijama Management System application source + Node dependencies are
# present and complete under the repository. Safe to run repeatedly (idempotent)
# and cheap when everything is already in place.
#
# The repository ships the app source as a committed review bundle zip on the
# delivery branches (e.g. main), while working branches keep it unpacked at the
# repo root. Untracked content under /workspace is NOT reliably preserved across
# a Cloud Agent build -> boot git re-provisioning, so this runs from both the
# install step (once, to warm caches) and the start step (every boot).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

FRESH=0
if [ -f "$ROOT/package.json" ]; then
  # Working branch: app source is unpacked at the repo root.
  APP_DIR="$ROOT"
else
  APP_DIR="$ROOT/app"
  # Treat app/ as ready only if it looks complete (package.json + tests tree).
  if [ -f "$APP_DIR/package.json" ] && [ -d "$APP_DIR/tests" ]; then
    :
  else
    BUNDLE="$(ls "$ROOT"/*Hijama-Clinic-COMPLETE-ORIGINAL-vs-CURRENT*.zip 2>/dev/null | head -n1 || true)"
    if [ -z "${BUNDLE:-}" ]; then
      echo "ERROR: no root package.json and no source bundle zip found in $ROOT" >&2
      exit 1
    fi
    echo "Unpacking application source from bundle: $BUNDLE"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    unzip -o -q "$BUNDLE" "./02-CURRENT/CURRENT-FINAL-RESTORE-SOURCE.zip" -d "$TMP"
    rm -rf "$APP_DIR"
    mkdir -p "$APP_DIR"
    unzip -o -q "$TMP/02-CURRENT/CURRENT-FINAL-RESTORE-SOURCE.zip" -d "$APP_DIR"
    if [ ! -f "$APP_DIR/package.json" ]; then
      echo "ERROR: extraction incomplete, $APP_DIR/package.json missing" >&2
      exit 1
    fi
    FRESH=1
  fi
fi

cd "$APP_DIR"

# Install dependencies (native modules better-sqlite3 + sharp) when the source
# was just (re)unpacked or node_modules is missing/incomplete. Uses the npm
# cache (persisted outside /workspace) so re-installs on boot are fast.
if [ "$FRESH" = 1 ] || [ ! -f node_modules/.package-lock.json ] || [ ! -d node_modules/better-sqlite3 ]; then
  echo "Installing Node dependencies in $APP_DIR ..."
  npm ci
fi

# Electron's binary download postinstall can be skipped under npm ci; ensure it.
if [ -f node_modules/electron/install.js ] && [ ! -x node_modules/electron/dist/electron ]; then
  echo "Fetching Electron runtime binary ..."
  node node_modules/electron/install.js
fi

echo "Application ready at $APP_DIR"
