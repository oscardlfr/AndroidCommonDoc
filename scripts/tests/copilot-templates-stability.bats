#!/usr/bin/env bats
#
# Tests for setup/copilot-templates/android-skills-consume.prompt.md stability.
# Verifies: (1) generate-registry.js does not modify the file, (2) stale
# "Regenerate:" instruction is gone, (3) MANUALLY MAINTAINED comment is present.
# Root cause: adapters/generate-all.sh deleted Wave 21 (BL-W44-S2 commit 4).

export KMP_TEST_RUNNER_BYPASS=1

REGISTRY_CLI="$BATS_TEST_DIRNAME/../../mcp-server/build/cli/generate-registry.js"
TEMPLATE_FILE="$BATS_TEST_DIRNAME/../../setup/copilot-templates/android-skills-consume.prompt.md"
REPO_ROOT="$BATS_TEST_DIRNAME/../.."

# ── Precondition ──────────────────────────────────────────────────────────────

setup_file() {
  if [[ ! -f "$REGISTRY_CLI" ]]; then
    skip "generate-registry.js not built — run 'cd mcp-server && npm run build' first"
  fi
  if ! command -v git >/dev/null 2>&1; then
    skip "git not on PATH"
  fi
}

# ── Test 1: generate-registry.js does not modify the file ────────────────────

@test "generate-registry.js leaves android-skills-consume.prompt.md unchanged" {
  # Capture content before
  local before
  before=$(cat "$TEMPLATE_FILE")

  # Run registry generation
  run node "$REGISTRY_CLI" 2>/dev/null
  # We don't assert status — registry may warn on partial state; what matters is file stability

  # Capture content after
  local after
  after=$(cat "$TEMPLATE_FILE")

  # File must be byte-identical
  [ "$before" = "$after" ]
}

@test "registry run introduces no new diff to android-skills-consume.prompt.md" {
  # Snapshot the diff state BEFORE running registry (captures any pre-existing uncommitted changes)
  local before_diff
  before_diff=$(git -C "$REPO_ROOT" diff -- setup/copilot-templates/android-skills-consume.prompt.md 2>/dev/null || true)

  node "$REGISTRY_CLI" 2>/dev/null || true

  # Diff state AFTER — must be identical to before (registry must not introduce new changes)
  local after_diff
  after_diff=$(git -C "$REPO_ROOT" diff -- setup/copilot-templates/android-skills-consume.prompt.md 2>/dev/null || true)

  [ "$before_diff" = "$after_diff" ]
}

# ── Test 2: stale "Regenerate:" instruction is absent ────────────────────────

@test "file header does not contain stale Regenerate instruction" {
  # The actionable stale line was: <!-- Regenerate: bash adapters/generate-all.sh -->
  # It must be gone — agents must not follow it
  run grep -c "Regenerate:" "$TEMPLATE_FILE"
  [ "$output" -eq 0 ]
}

# ── Test 3: MANUALLY MAINTAINED comment is present ───────────────────────────

@test "file header contains MANUALLY MAINTAINED comment" {
  run grep -c "MANUALLY MAINTAINED" "$TEMPLATE_FILE"
  [ "$output" -ge 1 ]
}
