#!/usr/bin/env bash
# Shim — vc-proof-run.sh now delegates to system-proof-run.sh.
# Kept for back-compat; both run the same checks.
exec "$(dirname "${BASH_SOURCE[0]}")/system-proof-run.sh" "$@"
