#!/usr/bin/env bash
# digest-helpers.sh — Canonical protocol_digest computation for quality-gate-manifest.json.
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/digest-helpers.sh"
#   digest=$(canonical_digest "$manifest_path")
#
# The digest is sha256 of the canonical JSON serialization of BOTH required_steps AND
# conditional_steps arrays (keys sorted, compact, CRLF->LF normalized).
#
# This helper is the SINGLE source of truth — sourced by emit-push-proof.sh (T3) so
# that the manifest writer and the emitter's re-derivation check are byte-identical.
# Drift in either array (required or conditional) will be caught at mint time.
#
# Reuses the rehash-registry.sh sha256+CRLF->LF precedent (rehash-registry.sh:80-85).

canonical_digest() {
    local manifest_path="$1"
    python3 - "$manifest_path" << 'PYEOF'
import json, hashlib, sys

manifest_path = sys.argv[1]
with open(manifest_path, 'r', encoding='utf-8') as f:
    manifest = json.load(f)

# Canonical form: sort keys, compact (no extra whitespace)
req  = json.dumps(manifest['required_steps'],   sort_keys=True, separators=(',', ':'))
cond = json.dumps(manifest['conditional_steps'], sort_keys=True, separators=(',', ':'))

# Concatenate both arrays, normalize CRLF->LF, hash
combined = (req + cond).encode('utf-8').replace(b'\r\n', b'\n')
print(hashlib.sha256(combined).hexdigest())
PYEOF
}
