#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for .claude/hooks/subagent-start-context-bundle.js (BL-W47 L7).
# SubagentStart hook: injects context bundle as additionalContext when a peer
# starts and a fresh bundle exists for the current wave.
#
# Contract:
#   - main orchestrator (empty agent_type) → silent exit 0, no stdout
#   - wrong hook_event_name → silent exit 0, no stdout
#   - bundle absent → silent exit 0, no stdout
#   - bundle present + wave_slug matches → emit {"additionalContext": "<content>"}
#   - bundle present + wave_slug stale → silent exit 0, stderr "stale bundle"
#   - bundle present + wave_slug missing from frontmatter → silent exit 0
#   - non-feature branch (develop) → no slug → silent exit 0
#
# Infra: JSON-piped-to-node. All fixtures in BATS_TEST_TMPDIR (never live project).
# Git repo initialised in tmpdir so git rev-parse resolves to the fixture branch.
#
# Invocation: bats scripts/tests/subagent-start-context-bundle.bats (from repo root)

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/subagent-start-context-bundle.js"
INPUT_FILE="${BATS_TEST_TMPDIR}/bundle-input-$$.json"

setup() {
  # Isolated git repo in tmpdir with a feature branch matching our test wave slug.
  PROJECT_ROOT="${BATS_TEST_TMPDIR}/proj-$$"
  mkdir -p "$PROJECT_ROOT"
  git -C "$PROJECT_ROOT" init -q 2>/dev/null
  git -C "$PROJECT_ROOT" config user.email "test@test.com"
  git -C "$PROJECT_ROOT" config user.name "Test"
  git -C "$PROJECT_ROOT" commit --allow-empty -q -m "feat(core): init"
  git -C "$PROJECT_ROOT" checkout -b "feature/bl-w47-test" -q 2>/dev/null
  BUNDLE_DIR="$PROJECT_ROOT/.planning/wave-bl-w47-test/context-bundles"
}

teardown() {
  rm -rf "${BATS_TEST_TMPDIR}/proj-$$"
}

# Build JSON input for SubagentStart event.
# Args: <hook_event_name> <agent_type>
make_input() {
  local event="$1" agent="$2"
  python3 - "$event" "$agent" "$INPUT_FILE" <<'PYEOF'
import json, sys
event, agent, path = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"hook_event_name": event, "agent_type": agent}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
}

# Write a context bundle file with YAML frontmatter.
# Args: <role> <wave_slug_in_frontmatter_or_empty>
write_bundle() {
  local role="$1" slug="$2"
  mkdir -p "$BUNDLE_DIR"
  if [ -n "$slug" ]; then
    printf -- '---\nwave_slug: %s\n---\n# Context bundle for %s\nKey patterns here.\n' \
      "$slug" "$role" > "$BUNDLE_DIR/$role.md"
  else
    # No wave_slug field in frontmatter
    printf -- '---\ntitle: no slug here\n---\nsome content\n' > "$BUNDLE_DIR/$role.md"
  fi
}

# ── Case 1 — main orchestrator (empty agent_type) → silent exit 0 ─────────────

@test "★SB-1 main orchestrator (empty agent_type) → silent exit 0, no stdout" {
  make_input "SubagentStart" ""
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── Case 2 — wrong hook_event_name → silent exit 0 ────────────────────────────

@test "★SB-2 wrong hook_event_name (PreToolUse) → silent exit 0, no stdout" {
  make_input "PreToolUse" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── Case 3 — bundle absent → silent exit 0 ────────────────────────────────────

@test "★SB-3 bundle absent → silent exit 0, no stdout" {
  # Bundle directory and file deliberately not created
  make_input "SubagentStart" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── Case 4 — bundle present, wave_slug matches → emit additionalContext ────────

@test "★SB-4 bundle present + wave_slug matches → exit 0, stdout has additionalContext" {
  write_bundle "arch-platform" "bl-w47-test"
  make_input "SubagentStart" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
  # stdout must be valid JSON with an additionalContext key
  [[ "$output" == *'"additionalContext"'* ]]
  # content of the bundle file must be embedded
  [[ "$output" == *"Key patterns here"* ]]
}

# ── Case 5 — bundle present, wave_slug stale (mismatch) → silent + stderr warn ─

@test "★SB-5 bundle present + wave_slug stale → exit 0, stdout empty, stderr 'stale bundle'" {
  write_bundle "arch-platform" "bl-w46-old"
  make_input "SubagentStart" "arch-platform"
  # Capture stderr separately via bash 2>&1 redirect trick
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>&1 1>/dev/null"
  [ "$status" -eq 0 ]
  [[ "$output" == *"stale bundle"* ]]
  # Verify stdout itself is empty (run again capturing only stdout)
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── Case 6 — bundle present, wave_slug missing from frontmatter → silent exit 0 ─

@test "★SB-6 bundle present + wave_slug missing from frontmatter → silent exit 0, no stdout" {
  # wave_slug absent from frontmatter → hook treats bundleSlug as null → stale path →
  # stderr warning emitted (same branch as case 5), stdout empty, exit 0.
  write_bundle "arch-platform" ""
  make_input "SubagentStart" "arch-platform"
  # Verify stderr carries the stale-bundle warning
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>&1 1>/dev/null"
  [ "$status" -eq 0 ]
  [[ "$output" == *"stale bundle"* ]]
  # Verify stdout itself is empty (stderr discarded)
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── Case 7 — non-feature branch (develop) → no slug → silent exit 0 ───────────

@test "★SB-7 develop branch (non-feature) → no wave slug → silent exit 0, no stdout" {
  # Switch the tmpdir repo to develop — hook resolveWaveSlug returns null
  git -C "$PROJECT_ROOT" checkout -b develop -q 2>/dev/null || \
    git -C "$PROJECT_ROOT" checkout develop -q 2>/dev/null
  make_input "SubagentStart" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── CR-5 (ca13f47): /m flag removed from frontmatter regex ────────────────────
# ca13f47 removed the /m flag from extractWaveSlugFromFrontmatter regex so that
# a bundle file whose second line starts with '---' (but first char is NOT '---')
# does NOT produce a false-positive frontmatter match.

# ── CR-R2-A (2364ed2): CRLF line endings in frontmatter tolerated ─────────────
# 2364ed2 added \r?\n to the frontmatter regex. Without it, a Windows-checkout
# bundle with CRLF (\r\n) endings would fail to parse the wave_slug, treating
# the bundle as stale and silently skipping additionalContext injection.

@test "CR-R2-A: CRLF bundle frontmatter (\\r\\n line endings) + matching wave_slug → additionalContext emitted" {
  # Write bundle with CRLF line endings via printf \r\n sequences.
  # Frontmatter: ---\r\n wave_slug: bl-w47-test\r\n ---\r\n followed by body.
  mkdir -p "$BUNDLE_DIR"
  printf -- '---\r\nwave_slug: bl-w47-test\r\ntitle: test bundle\r\n---\r\n# Context bundle\r\nKey CRLF patterns here.\r\n' \
    > "$BUNDLE_DIR/arch-platform.md"
  make_input "SubagentStart" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
  # stdout must be valid JSON with an additionalContext key
  [[ "$output" == *'"additionalContext"'* ]]
  # bundle body content must be present
  [[ "$output" == *"Key CRLF patterns here"* ]]
}

@test "CR5-A: bundle with '---' on second line (not first) does NOT produce false-positive match" {
  # File content: line 1 = plain text, line 2 = '---' (looks like frontmatter end but
  # there is no opening '---' at byte 0). Pre-ca13f47 with /m flag, ^ matched line
  # boundaries so a mid-file '---' could satisfy the regex. Post-fix: ^ is anchored
  # to start-of-string only, so this file has no valid frontmatter → bundleSlug=null
  # → stale path → exit 0, stdout empty.
  mkdir -p "$BUNDLE_DIR"
  printf 'some content line\n---\nwave_slug: bl-w47-test\nmore content\n' \
    > "$BUNDLE_DIR/arch-platform.md"
  make_input "SubagentStart" "arch-platform"
  # stdout must be empty (no additionalContext injected — false-positive blocked)
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
