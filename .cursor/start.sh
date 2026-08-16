#!/usr/bin/env bash
#
# Cloud Agent start step. Runs on every container boot AFTER the repository is
# checked out. Because untracked /workspace content (the unpacked app/) is not
# reliably preserved across a build -> boot, this re-materializes the app source
# and dependencies each boot. It is fast when everything is already present.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/ensure-app.sh"
