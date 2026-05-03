#!/usr/bin/env bash
set -euo pipefail
node "$(dirname "$0")/../mcp-server/build/cli/proguard-validate.js" "$@"
