#!/usr/bin/env bash
set -euo pipefail

# runtime-consultation.sh -- thin argv->node forwarder for the portable
# runtime-consultation core (Wave 1, portable-runtime-messaging-adapters).
#
# Frozen Production CLI ABI note (PLAN.md ~L750-755): this wrapper is a
# byte-for-byte argv forwarder to `node scripts/lib/runtime-consultation.cjs`
# with zero embedded protocol/state/security logic of its own -- no argument
# parsing, no flag interpretation, no output transformation. It resolves its
# own directory (so it works from any caller CWD, including via a symlink or
# PATH lookup) and then execs node against the sibling lib implementation,
# forwarding every argument exactly as received. `exec` replaces this
# process with node, so stdin/stdout/stderr and the eventual exit code all
# pass through completely unchanged -- there is no wrapper-side exit code
# translation.
#
# Windows/PowerShell counterpart: scripts/ps1/runtime-consultation.ps1 (same
# contract, same sibling lib target).
#
# Usage:
#   scripts/sh/runtime-consultation.sh <subcommand> [args...]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec node "$SCRIPT_DIR/../lib/runtime-consultation.cjs" "$@"
