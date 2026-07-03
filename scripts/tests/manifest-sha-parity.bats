#!/usr/bin/env bats
#
# Tests for manifest SHA-256 parity between .claude/registry/agents.manifest.yaml
# and setup/agent-templates/*.md frontmatter.
#
# Scenarios:
#   1. Clean tree post-rehash → PASS (reads live templates read-only)
#   2. Dirty template frontmatter (isolated temp copy) without rehash →
#      FAIL (drift detected); live template on disk never modified
#   3. Hygiene: dirtying the temp copy leaves the live git worktree unchanged
#   4. After revert (in the temp copy) → PASS
#   5. Safety guard: dirty_template() refuses to mutate any path outside
#      WORK_DIR (defense-in-depth — refuses the live tracked template too)
#
# Hash algorithm mirrors mcp-server/src/registry/template-generator.ts:
#   - Extract YAML block between first two `---` markers (BOM stripped, CRLF→LF)
#   - Normalize: CRLF→LF, trimEnd, append "\n"
#   - SHA-256 hex digest

set -euo pipefail

PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
MANIFEST="$PROJECT_ROOT/.claude/registry/agents.manifest.yaml"
TEMPLATES_DIR="$PROJECT_ROOT/setup/agent-templates"
LIVE_CANARY_TEMPLATE="$PROJECT_ROOT/setup/agent-templates/toolkit-specialist.md"

setup() {
  WORK_DIR="$(mktemp -d)"
  CANARY_TEMPLATE="$WORK_DIR/toolkit-specialist.md"
  if [ -f "$LIVE_CANARY_TEMPLATE" ]; then
    cp "$LIVE_CANARY_TEMPLATE" "$CANARY_TEMPLATE"
  fi
}

teardown() {
  rm -rf "${WORK_DIR:-}"
}

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

# Insert a sentinel comment line after the opening `---` frontmatter fence,
# simulating an unrehashed frontmatter edit. Operates in-place on whatever
# path is given — tests pass the WORK_DIR temp copy, never the live file.
dirty_template() {
  local template_path="$1"
  # Safety guard (defense-in-depth): only ever mutate the isolated WORK_DIR temp
  # copy — never the live tracked template. Refuse any path outside WORK_DIR.
  case "$template_path" in
    "$WORK_DIR"/*) : ;;
    *)
      echo "dirty_template: refusing to mutate '$template_path' — only the WORK_DIR temp copy is permitted" >&2
      return 1 ;;
  esac
  python3 - "$template_path" <<'PYEOF'
import sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    content = f.read()
lines = content.split("\n")
lines.insert(1, "# dirty-sentinel-bats-test")
with open(sys.argv[1], "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
PYEOF
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

  local tree_before
  tree_before="$(git -C "$PROJECT_ROOT" status --porcelain)"

  dirty_template "$CANARY_TEMPLATE"

  local computed_sha
  computed_sha=$(compute_sha "$CANARY_TEMPLATE")

  local tree_after
  tree_after="$(git -C "$PROJECT_ROOT" status --porcelain)"

  [ "$computed_sha" != "$expected_sha" ]
  [ "$tree_before" = "$tree_after" ]
}

@test "hygiene: dirtying the temp copy leaves the live git worktree unchanged" {
  [ -f "$CANARY_TEMPLATE" ] || skip "toolkit-specialist template not found"

  local tree_before
  tree_before="$(git -C "$PROJECT_ROOT" status --porcelain)"

  dirty_template "$CANARY_TEMPLATE"

  local tree_after
  tree_after="$(git -C "$PROJECT_ROOT" status --porcelain)"

  [ "$tree_before" = "$tree_after" ]
}

@test "safety: dirty_template refuses to mutate the live tracked template" {
  [ -f "$LIVE_CANARY_TEMPLATE" ] || skip "toolkit-specialist template not found"

  local tree_before
  tree_before="$(git -C "$PROJECT_ROOT" status --porcelain)"

  run dirty_template "$LIVE_CANARY_TEMPLATE"
  [ "$status" -ne 0 ]

  local tree_after
  tree_after="$(git -C "$PROJECT_ROOT" status --porcelain)"
  [ "$tree_before" = "$tree_after" ]
}

@test "reverted template: sha parity restored after revert" {
  [ -f "$CANARY_TEMPLATE" ] || skip "toolkit-specialist template not found"

  local expected_sha
  expected_sha=$(get_manifest_sha "toolkit-specialist")
  [ -n "$expected_sha" ] || skip "toolkit-specialist has no sha baseline in manifest"

  dirty_template "$CANARY_TEMPLATE"

  # Revert-in-temp — CANARY_TEMPLATE lives in WORK_DIR, never the live tree.
  cp "$LIVE_CANARY_TEMPLATE" "$CANARY_TEMPLATE"

  local computed_sha
  computed_sha=$(compute_sha "$CANARY_TEMPLATE")

  [ "$computed_sha" = "$expected_sha" ]
}
