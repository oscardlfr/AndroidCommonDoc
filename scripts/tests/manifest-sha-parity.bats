#!/usr/bin/env bats
#
# Tests for manifest SHA-256 parity between .claude/registry/agents.manifest.yaml
# and setup/agent-templates/*.md frontmatter.
#
# Scenarios (from BL-W42 PR3 PLAN):
#   1. Clean tree post-rehash → PASS
#   2. Dirty template frontmatter (insert comment line) without rehash → FAIL (drift detected)
#   3. After revert → PASS
#
# Hash algorithm mirrors mcp-server/src/registry/template-generator.ts:
#   - Extract YAML block between first two `---` markers (BOM stripped, CRLF→LF)
#   - Normalize: CRLF→LF, trimEnd, append "\n"
#   - SHA-256 hex digest

set -euo pipefail

PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
MANIFEST="$PROJECT_ROOT/.claude/registry/agents.manifest.yaml"
TEMPLATES_DIR="$PROJECT_ROOT/setup/agent-templates"
CANARY_TEMPLATE="$PROJECT_ROOT/setup/agent-templates/toolkit-specialist.md"

# Compute frontmatter SHA-256 for a template file, mirroring the TS algorithm.
# Strips \r from output to handle MSYS2/Windows subprocess capture.
compute_sha() {
  local template_path="$1"
  python3 - "$template_path" <<'PYEOF' | tr -d '\r'
import sys, hashlib

path = sys.argv[1]
with open(path, "rb") as f:
    raw = f.read()

if raw.startswith(b"\xef\xbb\xbf"):
    raw = raw[3:]

text = raw.decode("utf-8").replace("\r\n", "\n")

if not text.startswith("---\n"):
    sys.exit(0)

closing = text.find("\n---\n", 3)
if closing != -1:
    block = text[4:closing]
elif text.endswith("\n---"):
    block = text[4:len(text) - 4]
else:
    sys.exit(0)

normalized = block.rstrip() + "\n"
sys.stdout.write(hashlib.sha256(normalized.encode("utf-8")).hexdigest())
PYEOF
}

# Parse manifest: for each agent with a sha256 baseline, output "agent SHA" lines.
# Strips \r from output to handle MSYS2/Windows subprocess capture.
list_agents_with_sha() {
  python3 - "$MANIFEST" <<'PYEOF' | tr -d '\r'
import sys, re

with open(sys.argv[1], "rb") as f:
    raw = f.read()

content = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")

current_agent = None
for line in content.splitlines():
    m = re.match(r'^  ([a-z][a-z0-9_-]+):$', line)
    if m:
        current_agent = m.group(1)
        continue
    m = re.match(r'^    template_frontmatter_sha256:\s*([0-9a-f]{64})$', line)
    if m and current_agent:
        sys.stdout.write(f"{current_agent} {m.group(1)}\n")
PYEOF
}

# Get the manifest sha for a specific agent by name.
get_manifest_sha() {
  local agent="$1"
  list_agents_with_sha | awk -v a="$agent" '$1 == a { print $2; exit }'
}

# ── Tests ────────────────────────────────────────────────────────────────────

@test "clean tree: all manifest sha256 baselines match on-disk template frontmatter" {
  local failures=0
  local checked=0

  while read -r agent expected_sha; do
    local template="$TEMPLATES_DIR/${agent}.md"
    [ -f "$template" ] || continue

    local computed_sha
    computed_sha=$(compute_sha "$template")
    [ -n "$computed_sha" ] || continue

    checked=$((checked + 1))
    if [ "$computed_sha" != "$expected_sha" ]; then
      echo "MISMATCH: $agent" >&2
      echo "  Expected: $expected_sha" >&2
      echo "  Computed: $computed_sha" >&2
      echo "  Fix: node mcp-server/build/cli/generate-template.js $agent --update-manifest-hash" >&2
      failures=$((failures + 1))
    fi
  done < <(list_agents_with_sha)

  [ "$checked" -gt 0 ] || { echo "No agents with sha256 baseline found" >&2; return 1; }
  [ "$failures" -eq 0 ]
}

@test "dirty template frontmatter: sha mismatch detected before rehash" {
  [ -f "$CANARY_TEMPLATE" ] || skip "toolkit-specialist template not found"

  local expected_sha
  expected_sha=$(get_manifest_sha "toolkit-specialist")
  [ -n "$expected_sha" ] || skip "toolkit-specialist has no sha baseline in manifest"

  # Dirty the frontmatter by inserting a comment line after the opening `---`.
  python3 - "$CANARY_TEMPLATE" <<'PYEOF'
import sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    content = f.read()
lines = content.split("\n")
lines.insert(1, "# dirty-sentinel-bats-test")
with open(sys.argv[1], "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
PYEOF

  local computed_sha
  computed_sha=$(compute_sha "$CANARY_TEMPLATE")

  # Always revert before asserting
  git -C "$PROJECT_ROOT" checkout -- "$CANARY_TEMPLATE"

  [ "$computed_sha" != "$expected_sha" ]
}

@test "reverted template: sha parity restored after revert" {
  [ -f "$CANARY_TEMPLATE" ] || skip "toolkit-specialist template not found"

  local expected_sha
  expected_sha=$(get_manifest_sha "toolkit-specialist")
  [ -n "$expected_sha" ] || skip "toolkit-specialist has no sha baseline in manifest"

  local computed_sha
  computed_sha=$(compute_sha "$CANARY_TEMPLATE")

  [ "$computed_sha" = "$expected_sha" ]
}
