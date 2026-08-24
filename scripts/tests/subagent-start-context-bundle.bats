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

_assert_isolated_runtime_tmp() {
  local dir="$1"
  local real_dir real_bats
  real_dir="$(cd "$dir" 2>/dev/null && pwd -P)" || return 1
  real_bats="$(cd "$BATS_TEST_TMPDIR" && pwd -P)" || return 1
  case "$real_dir" in
    "$real_bats"|"$real_bats"/*) ;;
    *) echo "# runtime-tmp escaped BATS_TEST_TMPDIR: $real_dir not under $real_bats" >&2; return 1 ;;
  esac
  node -e '
    const fs = require("fs");
    let st;
    try { st = fs.lstatSync(process.argv[1]); } catch (err) { console.error("runtime-tmp stat failed: " + err.message); process.exit(1); }
    if (st.isSymbolicLink()) { console.error("runtime-tmp is a symlink"); process.exit(1); }
    if (!st.isDirectory()) { console.error("runtime-tmp is not a directory"); process.exit(1); }
    if ((st.mode & 0o777) !== 0o700) { console.error("runtime-tmp wrong mode: " + (st.mode & 0o777).toString(8)); process.exit(1); }
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) { console.error("runtime-tmp wrong owner"); process.exit(1); }
  ' "$dir"
}

setup() {
  RUNTIME_TMP="$BATS_TEST_TMPDIR/runtime-tmp"
  mkdir -p "$RUNTIME_TMP"
  chmod 0700 "$RUNTIME_TMP"
  _assert_isolated_runtime_tmp "$RUNTIME_TMP"
  export TMPDIR="$RUNTIME_TMP"

  # Isolated git repo in tmpdir with a feature branch matching our test wave slug.
  PROJECT_ROOT="${BATS_TEST_TMPDIR}/proj-$$"
  mkdir -p "$PROJECT_ROOT"
  git -C "$PROJECT_ROOT" init -q 2>/dev/null
  git -C "$PROJECT_ROOT" config user.email "test@test.com"
  git -C "$PROJECT_ROOT" config user.name "Test"
  git -C "$PROJECT_ROOT" commit --allow-empty -q -m "feat(core): init"
  PROJ_REGISTRY_DIR="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL_IMPL" "$PROJECT_ROOT")"
  git -C "$PROJECT_ROOT" checkout -b "feature/bl-w47-test" -q 2>/dev/null
  BUNDLE_DIR="$PROJECT_ROOT/.planning/wave-bl-w47-test/context-bundles"
}

teardown() {
  if [ -n "$RUNTIME_TMP" ] && _assert_isolated_runtime_tmp "$RUNTIME_TMP" >/dev/null 2>&1; then
    # M6+M7 SIXTEENTH Phase 2B follow-up: some fixtures materialize a
    # deliberately read-only projection under here (e.g. a role-read-view,
    # part of the production isolation model's own security posture) --
    # restore owner write+traverse on every path THIS test created before
    # sweeping, or a bare rm -rf leaves permission-denied debris behind
    # (which then also makes bats' own outer per-test tmpdir cleanup fail
    # non-silently).
    chmod -R u+rwX "$RUNTIME_TMP" 2>/dev/null || true
    rm -rf "$RUNTIME_TMP"
  fi
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

@test "★SB-4 bundle present + wave_slug matches → exit 0, stdout has additionalContext nested under the official hookSpecificOutput envelope" {
  write_bundle "arch-platform" "bl-w47-test"
  make_input "SubagentStart" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
  local stdout="$output"
  run node -e '
    const body = JSON.parse(process.argv[1]);
    if (typeof body.additionalContext !== "undefined") { process.stderr.write("unexpected top-level additionalContext: " + process.argv[1]); process.exit(1); }
    if (!body.hookSpecificOutput || body.hookSpecificOutput.hookEventName !== "SubagentStart") { process.stderr.write("missing/wrong hookSpecificOutput.hookEventName: " + process.argv[1]); process.exit(1); }
    if (typeof body.hookSpecificOutput.additionalContext !== "string" || !body.hookSpecificOutput.additionalContext.includes("Key patterns here")) { process.stderr.write("missing/wrong nested additionalContext: " + process.argv[1]); process.exit(1); }
  ' "$stdout"
  [ "$status" -eq 0 ]
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

@test "CR-R2-A: CRLF bundle frontmatter (\\r\\n line endings) + matching wave_slug → additionalContext emitted nested under the official hookSpecificOutput envelope" {
  # Write bundle with CRLF line endings via printf \r\n sequences.
  # Frontmatter: ---\r\n wave_slug: bl-w47-test\r\n ---\r\n followed by body.
  mkdir -p "$BUNDLE_DIR"
  printf -- '---\r\nwave_slug: bl-w47-test\r\ntitle: test bundle\r\n---\r\n# Context bundle\r\nKey CRLF patterns here.\r\n' \
    > "$BUNDLE_DIR/arch-platform.md"
  make_input "SubagentStart" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
  local stdout="$output"
  run node -e '
    const body = JSON.parse(process.argv[1]);
    if (typeof body.additionalContext !== "undefined") { process.stderr.write("unexpected top-level additionalContext: " + process.argv[1]); process.exit(1); }
    if (!body.hookSpecificOutput || body.hookSpecificOutput.hookEventName !== "SubagentStart") { process.stderr.write("missing/wrong hookSpecificOutput.hookEventName: " + process.argv[1]); process.exit(1); }
    if (typeof body.hookSpecificOutput.additionalContext !== "string" || !body.hookSpecificOutput.additionalContext.includes("Key CRLF patterns here")) { process.stderr.write("missing/wrong nested additionalContext: " + process.argv[1]); process.exit(1); }
  ' "$stdout"
  [ "$status" -eq 0 ]
}

@test "P2b SB-NF1 PASS: codex/bl-w47-demo branch → slug 'bl-w47-demo' → bundle injected if present" {
  # After P2b fix, subagent-start-context-bundle.js must resolve 'codex/bl-w47-demo'
  # to last-segment 'bl-w47-demo' and inject the bundle when it exists.
  # Switch the isolated repo to a codex/ branch.
  git -C "$PROJECT_ROOT" checkout -b "codex/bl-w47-demo" -q 2>/dev/null
  # Create a bundle for the resolved slug.
  local bundle_dir_demo="$PROJECT_ROOT/.planning/wave-bl-w47-demo/context-bundles"
  mkdir -p "$bundle_dir_demo"
  printf -- '---\nwave_slug: bl-w47-demo\n---\n# Context bundle for codex branch\nCodex patterns here.\n' \
    > "$bundle_dir_demo/arch-platform.md"
  make_input "SubagentStart" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *'"additionalContext"'* ]]
  [[ "$output" == *"Codex patterns here"* ]]
}

@test "P2b SB-NF2 PASS: develop branch checkout (reject-list, branch path) → no slug → silent exit 0" {
  # Drive the BRANCH path (no CLAUDE_WAVE_SLUG env) on an actual 'develop' branch.
  # BEFORE fix: the hook had only the feature/-strip path; bare 'develop' would fall
  # through to `return branch` and return 'develop' as slug (not rejected). RED.
  # AFTER fix: reject-list applied to branch-parsed slug → null → exit 0, output empty.
  # CodeRabbit #6: prior version used 'develop-test' branch + CLAUDE_WAVE_SLUG='develop' env
  # — that tested the env path, not the branch-detection reject-list. This uses a real
  # 'develop' branch checkout with no env override.
  git -C "$PROJECT_ROOT" checkout -b develop -q 2>/dev/null || \
    git -C "$PROJECT_ROOT" checkout develop -q 2>/dev/null
  make_input "SubagentStart" "arch-platform"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "B SB-BRANCH-REJECT-develop: develop branch → resolveWaveSlug returns null → no bundle injected even when bundle exists" {
  # subagent-start-context-bundle.js is env-free: resolveWaveSlug() reads the git branch,
  # never CLAUDE_WAVE_SLUG. On the 'develop' branch the reject-list returns null → no lookup.
  # Create a bundle for the 'develop' slug to prove it is NOT injected (reject fires
  # before the bundle lookup). If the reject-list were absent, the hook would find the
  # bundle and emit additionalContext — that's what this test prevents.
  git -C "$PROJECT_ROOT" checkout -b develop -q 2>/dev/null || \
    git -C "$PROJECT_ROOT" checkout develop -q 2>/dev/null
  local dev_bundle_dir="$PROJECT_ROOT/.planning/wave-develop/context-bundles"
  mkdir -p "$dev_bundle_dir"
  printf -- '---\nwave_slug: develop\n---\n# Should not be injected.\n' \
    > "$dev_bundle_dir/arch-platform.md"
  make_input "SubagentStart" "arch-platform"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "B SB-BRANCH-REJECT-master: master branch → resolveWaveSlug returns null → no bundle injected even when bundle exists" {
  # Same class as SB-BRANCH-REJECT-develop but for 'master' branch.
  # Branch-driven path: no CLAUDE_WAVE_SLUG env — resolveWaveSlug() reads git branch.
  git -C "$PROJECT_ROOT" checkout -b master -q 2>/dev/null || \
    git -C "$PROJECT_ROOT" checkout master -q 2>/dev/null
  local master_bundle_dir="$PROJECT_ROOT/.planning/wave-master/context-bundles"
  mkdir -p "$master_bundle_dir"
  printf -- '---\nwave_slug: master\n---\n# Should not be injected.\n' \
    > "$master_bundle_dir/arch-platform.md"
  make_input "SubagentStart" "arch-platform"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
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

# ══════════════════════════════════════════════════════════════════════════
# M7 probe evidence is host-private. SubagentStart must never create the old
# model-visible `.planning/.../probe-correlation` artifact, whether the spawn
# is persistent or one-shot. The actual raw trace/redacted capability path is
# covered in runtime-role-lifecycle-registry.test.js.
# ══════════════════════════════════════════════════════════════════════════

PROBE_WAVE_SLUG="bl-w47-test"
RLL_IMPL="$BATS_TEST_DIRNAME/../lib/runtime-role-lifecycle.cjs"
RC_IMPL="$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
PROBE_CAPABILITY="subagent-probe-fixture-capability"

# Mints a REAL pending role-spawn action for `role` via the actual production
# grant+ensure machinery (mirrors runtime-role-lifecycle.bats's own
# _mint_lifecycle_grant helper) -- never a hand-fabricated action file.
_mint_pending_role_spawn() {
  local role="$1" session_key="$2"
  mkdir -p "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG"
  printf '# fixture PLAN for SubagentStart lifecycle tests\n' > "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG/PLAN.md"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["claude-sendmessage"]' node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const role = process.argv[3];
    const sessionKey = process.argv[4];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionKey };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const crypto = require("crypto");
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const proofRole = "context-provider";
    function mintProbeAction(suffix) {
      const actionId = rll.generateActionId();
      const minted = rll.mintRoleLifecycleAction(
        projectRoot, actionId, "role-spawn", "claude-native",
        rll.computeRepoId(projectRoot), worktreeId, planResult.planDigest,
        crypto.createHash("sha256").update("subagent-bats-claude-id01:" + suffix).digest("hex"),
        generation.generationId, proofRole,
        rll.buildRoleSpawnPayload("claude-id01-probe", proofRole, proofRole, "fixture", "fixture"),
        new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, "Z")
      );
      if (!minted.ok) { process.stderr.write("probe action failed: " + JSON.stringify(minted)); process.exit(1); }
      return actionId;
    }
    const actionA = mintProbeAction("a");
    const actionB = mintProbeAction("b");
    const primary = "subagent-bats-primary";
    rll.recordClaudeId01SubagentStartObservation(projectRoot, { sessionId: sessionKey, agentId: primary, agentType: proofRole, actionId: actionA });
    rll.recordClaudeId01PreToolUseObservation(projectRoot, { sessionId: sessionKey, agentId: primary, agentType: proofRole, toolUseId: "subagent-bats-tu-1" });
    rll.recordClaudeId01PreToolUseObservation(projectRoot, { sessionId: sessionKey, agentId: primary, agentType: proofRole, toolUseId: "subagent-bats-tu-2" });
    rll.recordClaudeId01SubagentStartObservation(projectRoot, { sessionId: sessionKey, agentId: primary, agentType: proofRole, actionId: actionA });
    rll.recordClaudeId01PreToolUseObservation(projectRoot, { sessionId: sessionKey, agentId: primary, agentType: proofRole, toolUseId: "subagent-bats-tu-3" });
    rll.recordClaudeId01SubagentStartObservation(projectRoot, { sessionId: sessionKey, agentId: "subagent-bats-peer-b", agentType: proofRole, actionId: actionB });
    const capability = rll.checkClaudeId01RuntimeCapability(projectRoot, sessionKey, worktreeId, planResult.planDigest);
    if (!capability.ok) { process.stderr.write("capability proof failed: " + JSON.stringify(capability)); process.exit(1); }
    const bindingResult = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planResult.planDigest, 120);
    if (!bindingResult.ok) { process.stderr.write("binding mint failed"); process.exit(1); }
    const argvDigest = crypto.createHash("sha256").update("ensure:" + role).digest("hex");
    const grantResult = rll.mintLifecycleCommandGrant(projectRoot, bindingResult.binding, argvDigest, role, "ensure", "main-orchestrator", "orchestrator", "normal", null);
    if (!grantResult.ok) { process.stderr.write("grant mint failed: " + JSON.stringify(grantResult)); process.exit(1); }
    process.stdout.write(grantResult.grantId);
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$role" "$session_key" > "$BATS_TEST_TMPDIR/probe-grant-id.txt" 2>"$BATS_TEST_TMPDIR/probe-grant-err.txt"
  local grant_id; grant_id="$(cat "$BATS_TEST_TMPDIR/probe-grant-id.txt")"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["claude-sendmessage"]' \
    node "$RLL_IMPL" ensure --project-root "$PROJECT_ROOT" --role "$role" --lifecycle-binding "$grant_id" >/dev/null 2>&1
}

_probe_correlation_path() {
  printf '%s' "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG/probe-correlation/$1.json"
}

@test "M7-PROBE-1: a persistent SubagentStart never writes a model-visible probe-correlation artifact" {
  _mint_pending_role_spawn "arch-testing" "probe-session-1"
  make_input "SubagentStart" "arch-testing"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [ ! -e "$(_probe_correlation_path arch-testing)" ]
}

@test "M7-PROBE-2: a one-shot SubagentStart never writes a model-visible probe-correlation artifact" {
  # No _mint_pending_role_spawn call at all -- the registry has zero pending
  # actions for this role, exactly what a one-shot (Agent-Teams-disabled or
  # ephemeral) spawn looks like.
  make_input "SubagentStart" "arch-testing"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [ ! -f "$(_probe_correlation_path arch-testing)" ]
}

@test "M7-PROBE-3: no probe-correlation artifact exists in which a raw session_id could leak" {
  local raw_session="MUST-NEVER-LEAK-THIS-RAW-SESSION-ID-abc123"
  _mint_pending_role_spawn "arch-testing" "probe-session-3"
  python3 - "$INPUT_FILE" "$raw_session" <<'PYEOF'
import json, sys
path, session = sys.argv[1], sys.argv[2]
with open(path, "w", encoding="utf-8") as f:
    json.dump({"hook_event_name": "SubagentStart", "agent_type": "arch-testing", "session_id": session}, f)
PYEOF
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [ ! -e "$(_probe_correlation_path arch-testing)" ]
  [ ! -d "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG/probe-correlation" ]
}

@test "M7-BUNDLE-REGRESSION: bundle injection remains intact when a pending role-spawn also exists" {
  _mint_pending_role_spawn "arch-platform" "probe-session-4"
  write_bundle "arch-platform" "bl-w47-test"
  make_input "SubagentStart" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *'"additionalContext"'* ]]
  [[ "$output" == *"Key patterns here"* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# Third HOLD (dispatch: team-lead direct, task #7 "Third HOLD: fix
# grant-injection defects + build two-phase reserve/commit protocol";
# design validated by arch-testing-m7dispatch 2026-08-08) Part B, B2/B3/B4:
# SubagentStart confirmation of B1's atomic reservation.
#
# B2: correlates {session_id, agent_id, agent_type} against exactly the ONE
# reservation B1 made, then validates+atomically-consumes that SAME claim --
# never re-interprets the action itself (this hook must NOT call
# interpretRoleLifecycleAction directly, per the dispatch's own explicit
# constraint; it only correlates and confirms the reservation it expects to
# find is the one that's actually there). Extends the EXISTING
# The host-private reservation path never replaces bundle-injection behavior
# (reaffirmed by M7-BUNDLE-REGRESSION and RB2-CONFIRM below).
#
# B3: three DISTINCT, independently observable failure modes -- ABSENT (no
# reservation at all), AMBIGUOUS (more than one live candidate), MISMATCHED
# (a reservation exists but scoped wrong) -- each quarantines the role
# binding (an EXISTING, real ROLE_BINDING_STATE_ENUM terminal state whose
# own documented semantics already read "(ambiguous owner) -> QUARANTINED
# [terminal for this binding -- caller selects fallback... or STOPs; never
# reused]", runtime-role-lifecycle.cjs:1962) with a DISTINGUISHABLE reason
# each time -- each test below checks for its OWN specific keyword, so an
# implementation that collapsed all three into one generic reason would
# fail at least two of the three. The fourth mode (unidentifiable/
# unstoppable child) is not independently observable from a hook-level
# test -- proxied here as "an identification failure always hard-stops the
# same way, never silently degrades" (arch-testing-endorsed 2026-08-08).
#
# B4: a reservation minted but never confirmed by a genuinely correlating
# SubagentStart must never be treated as a completed/confirmed action -- no
# existing completion-read-path exists to target (arch-testing confirmed
# 2026-08-08: findActionAcrossRepos is an ID-lookup solver, not a
# completion oracle; the action record itself carries no completed_at/
# executed_at/status field), so this establishes the invariant fresh.
#
# Proposed NEW runtime-role-lifecycle.cjs exports these tests assume (see
# agent-spawn-execution-gate.test.js's own header comment for the full
# proposed schema/rationale -- not reproduced here to avoid drift between
# the two files' comments; both name the SAME schema):
#   mintRoleSpawnExecutionClaim, validateAndConsumeRoleSpawnExecutionClaim,
#   roleSpawnExecutionClaimPathFor, ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA,
#   ROLE_SPAWN_EXECUTION_CLAIM_KEYS. None exist yet -- calling them throws
#   "is not a function", which IS this section's RED for the library half
#   of the contract; the hook's own unchanged-today behavior is the RED for
#   the confirmation half.
# ══════════════════════════════════════════════════════════════════════════

# Mints a REAL pending role-spawn action for `role` (via the existing
# _mint_pending_role_spawn recipe) AND a genuine B1 reservation claim for
# that action (via the proposed mintRoleSpawnExecutionClaim library
# primitive, called directly -- never through the not-yet-existing B1 hook
# file, mirroring this suite's own established "drive production code
# directly" convention). Prints "<action_id> <reservation_id>" on success.
_mint_reserved_role_spawn() {
  local role="$1" session_key="$2" subagent_type="$3" name="$4"
  _mint_pending_role_spawn "$role" "$session_key"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const role = process.argv[4];
    const sessionKey = process.argv[5];
    const subagentType = process.argv[6];
    const name = process.argv[7];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionKey };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    const genResult = rll.resolveSessionGeneration(projectRoot, identity);
    const profileDigest = rll.roleProfileDigestFor(role);
    const stateResult = rll.readRoleBindingState(projectRoot, worktreeId, planResult.planDigest, profileDigest, genResult.generationId, role);
    if (!stateResult.ok || !stateResult.record || !stateResult.record.pending_action_id) {
      process.stderr.write("no pending action: " + JSON.stringify(stateResult)); process.exit(1);
    }
    const actionId = stateResult.record.pending_action_id;
    const actionRead = rll.findActionAcrossRepos(actionId);
    if (!actionRead.ok || actionRead.absent) { process.stderr.write("action not found"); process.exit(1); }
    const bindingResult = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planResult.planDigest, 120);
    if (!bindingResult.ok) { process.stderr.write("binding mint failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    const toolInputDigest = rc.sha256String(rc.canonicalJSONStringify({ subagent_type: subagentType, name }));
    const claimResult = rll.mintRoleSpawnExecutionClaim({ repoId: rll.computeRepoId(projectRoot) }, actionRead.action, bindingResult.binding.binding_id, toolInputDigest, 120);
    if (!claimResult.ok) { process.stderr.write("claim mint failed: " + JSON.stringify(claimResult)); process.exit(1); }
    process.stdout.write(actionId + " " + claimResult.record.reservation_id);
  ' "$RLL_IMPL" "$RC_IMPL" "$PROJECT_ROOT" "$role" "$session_key" "$subagent_type" "$name"
}

# Reads the current role-binding state for `role` under the fixture session
# tuple _mint_pending_role_spawn/_mint_reserved_role_spawn used to mint it.
_role_binding_state() {
  local role="$1" session_key="$2"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const role = process.argv[3];
    const sessionKey = process.argv[4];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionKey };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    const genResult = rll.resolveSessionGeneration(projectRoot, identity);
    const profileDigest = rll.roleProfileDigestFor(role);
    const stateResult = rll.readRoleBindingState(projectRoot, worktreeId, planResult.planDigest, profileDigest, genResult.generationId, role);
    process.stdout.write(stateResult.ok ? stateResult.state : ("ERROR:" + stateResult.reason));
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$role" "$session_key"
}

# Builds a SubagentStart payload carrying session_id/agent_id too (today's
# make_input only ever sets hook_event_name/agent_type -- neither
# session_id nor agent_id is read by this hook AT ALL today, which IS part
# of the regression: B2 needs both to correlate).
_make_subagent_start_input_full() {
  local agent="$1" session="$2" agent_id="$3"
  python3 - "$INPUT_FILE" "$agent" "$session" "$agent_id" <<'PYEOF'
import json, sys
path, agent, session, agent_id = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
payload = {"hook_event_name": "SubagentStart", "agent_type": agent, "session_id": session, "agent_id": agent_id}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
}

@test "M7-RB2-CONFIRM: a genuinely correlating SubagentStart (role has EXACTLY ONE live reservation, session_id/agent_id/agent_type all present) confirms/consumes B1's reservation, and pre-existing bundle-injection behavior is unaffected" {
  run _mint_reserved_role_spawn "arch-platform" "rb2-session" "arch-platform" "arch-platform"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  write_bundle "arch-platform" "bl-w47-test"
  _make_subagent_start_input_full "arch-platform" "rb2-session-caller" "rb2-agent-id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"additionalContext"'* ]]
  [[ "$output" == *"Key patterns here"* ]]
  run _role_binding_state "arch-platform" "rb2-session"
  [ "$output" != "QUARANTINED" ]
}

@test "M7-RB3-ABSENT: SubagentStart for a role with NO live B1 reservation (no claim minted at all) quarantines the role binding, injects no bundle, and logs a distinguishable 'absent' reason" {
  _mint_pending_role_spawn "arch-platform" "rb3a-session"
  write_bundle "arch-platform" "bl-w47-test"
  _make_subagent_start_input_full "arch-platform" "rb3a-session-caller" "rb3a-agent-id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>&1 1>/dev/null"
  [[ "$output" == *"absent"* ]] || [[ "$output" == *"ABSENT"* ]]
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [[ "$output" != *'"additionalContext"'* ]]
  run _role_binding_state "arch-platform" "rb3a-session"
  [ "$output" = "QUARANTINED" ]
}

@test "M7-RB3-AMBIGUOUS: two live B1 reservations for the same role (two independent session generations) quarantines with a reason DISTINGUISHABLE from ABSENT" {
  run _mint_reserved_role_spawn "arch-platform" "rb3b-session-one" "arch-platform" "arch-platform"
  [ "$status" -eq 0 ]
  run _mint_reserved_role_spawn "arch-platform" "rb3b-session-two" "arch-platform" "arch-platform"
  [ "$status" -eq 0 ]
  _make_subagent_start_input_full "arch-platform" "rb3b-session-caller" "rb3b-agent-id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>&1 1>/dev/null"
  [[ "$output" == *"ambigu"* ]] || [[ "$output" == *"AMBIGU"* ]]
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [[ "$output" != *'"additionalContext"'* ]]
}

@test "M7-RB3-MISMATCHED: a claim that EXISTS but is scoped to a DIFFERENT session_generation_id than the one currently live is rejected with a reason DISTINGUISHABLE from ABSENT, and quarantines the binding" {
  run _mint_reserved_role_spawn "arch-platform" "rb3c-session" "arch-platform" "arch-platform"
  [ "$status" -eq 0 ]
  local action_id; action_id="$(awk '{print $1}' <<< "$output")"
  [ -n "$action_id" ]
  # Tamper the claim's own session_generation_id to a bogus-but-well-formed
  # value -- the claim file EXISTS (unlike ABSENT) but no longer correlates
  # to the currently-live session generation.
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const projectRoot = process.argv[2];
    const actionId = process.argv[3];
    const claimPath = rll.roleSpawnExecutionClaimPathFor(projectRoot, actionId);
    const rec = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    rec.session_generation_id = "f".repeat(32);
    fs.writeFileSync(claimPath, JSON.stringify(rec));
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id"
  [ "$status" -eq 0 ]
  _make_subagent_start_input_full "arch-platform" "rb3c-session-caller" "rb3c-agent-id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>&1 1>/dev/null"
  [[ "$output" == *"mismatch"* ]] || [[ "$output" == *"MISMATCH"* ]]
  run _role_binding_state "arch-platform" "rb3c-session"
  [ "$output" = "QUARANTINED" ]
}

@test "M7-RB3-STOP: an unidentifiable spawn (empty agent_id, otherwise a perfectly-correlating reservation) hard-stops the SAME way ABSENT/AMBIGUOUS/MISMATCHED do -- never a silent skip/degrade" {
  run _mint_reserved_role_spawn "arch-platform" "rb3d-session" "arch-platform" "arch-platform"
  [ "$status" -eq 0 ]
  _make_subagent_start_input_full "arch-platform" "rb3d-session-caller" ""
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [[ "$output" != *'"additionalContext"'* ]]
  run _role_binding_state "arch-platform" "rb3d-session"
  [ "$output" = "QUARANTINED" ]
}

# Distinct from M7-RB3-ABSENT above, where a role-binding DOES already
# exist (ensure() WAS called) but the B1 claim confirmation is missing --
# THAT case genuinely IS quarantined. This test's role has NO role-binding
# to quarantine in the first place -- a genuinely ad-hoc, lifecycle-
# unrelated spawn (general-purpose/Explore or any role never ensure()'d),
# exactly like every ad-hoc specialist dispatch throughout this entire
# session. (arch-platform's gap finding, user-specified 2026-08-08, item 4:
# "SubagentStart only ever confirms an EXACT prior reservation. Without
# one, it's a lifecycle-unrelated spawn and must not touch lifecycle
# records at all -- no quarantine, no mutation, genuinely inert.")
#
# HONEST CHARACTERIZATION (learned from arch-testing-m7dispatch's precision
# correction on RB5-RB7, 2026-08-08): unlike this file's other new B2/B3/B4
# tests, this one is expected to be GREEN already today, not RED -- the
# pre-existing hook already gracefully no-ops bundle-injection/probe-
# correlation for an absent pending action, and nothing quarantines
# anything yet (quarantine logic itself does not exist). Its value is as a
# regression-PINNING test (mirrors M7-BUNDLE-REGRESSION): it must stay
# green once B2's NEW quarantine-on-ABSENT logic (M7-RB3-ABSENT) is
# implemented, catching an over-eager implementation that quarantines ANY
# unconfirmed SubagentStart rather than only ones where a role-binding
# already exists expecting one.
@test "M7-RB-NONOWNING: SubagentStart for a role with NO role-binding record at all is completely inert -- no quarantine, no mutation of any lifecycle record" {
  write_bundle "arch-platform" "bl-w47-test"
  _make_subagent_start_input_full "arch-platform" "rb-nonowning-session" "rb-nonowning-agent-id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  # Pre-existing bundle-injection behavior (the unrelated mechanism) is
# UNAFFECTED -- regression anchor, mirrors M7-BUNDLE-REGRESSION.
  [[ "$output" == *'"additionalContext"'* ]]
  # The role-binding state must remain genuinely ABSENT -- never created,
  # never quarantined, never touched in any way.
  run _role_binding_state "arch-platform" "rb-nonowning-session"
  [ "$output" = "ABSENT" ]
}

@test "M7-RB4: a B1 reservation minted but NEVER followed by a genuinely correlating SubagentStart is not treated as a completed/confirmed action -- the claim stays unconsumed (execution_state still ISSUED, no .consumed marker), never silently read as success" {
  run _mint_reserved_role_spawn "arch-platform" "rb4-session" "arch-platform" "arch-platform"
  [ "$status" -eq 0 ]
  local action_id; action_id="$(awk '{print $1}' <<< "$output")"
  [ -n "$action_id" ]
  # No SubagentStart fired at all -- simulates an abandoned reservation.
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const projectRoot = process.argv[2];
    const actionId = process.argv[3];
    const claimPath = rll.roleSpawnExecutionClaimPathFor(projectRoot, actionId);
    const rec = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    if (rec.execution_state !== "ISSUED") { process.stderr.write("expected still-ISSUED, got " + rec.execution_state); process.exit(1); }
    const consumedMarker = claimPath.replace(/\.json$/, ".consumed");
    if (fs.existsSync(consumedMarker)) { process.stderr.write("must NOT be consumed without a genuine confirming SubagentStart"); process.exit(1); }
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 Correction pass (m7-correction-spec.md §5): after B2 CONFIRMED (the
# exact point marked `// B2 CONFIRMED -- fall through...`), before falling
# through to bundle injection, create the RoleActorBinding -- the durable tie
# proving "the role-lifecycle machinery decided a specific actor now
# legitimately holds this role", scoped EXACTLY from the same already-read
# `action` object (worktree_id/plan_digest/session_generation_id, agentType
# for role) -- never re-derived or guessed. Downstream consumers (`ready`,
# item 1§C; consultation target grants, item 1§D) resolve this binding by
# role/worktree/plan scope. This hook is the production issuer:
# subagent-start-context-bundle.js calls createRoleActorBinding at exactly
# this point, after confirmed B2 reservation/correlation (see the
# M7-B2-ACTORBINDING test below); runtime-consultation-target-gate.js is the
# consumer -- it resolves and validates that binding and mints the
# corresponding target/lifecycle grants, never creating one itself.
# ══════════════════════════════════════════════════════════════════════════

# Scans role-actor-bindings/ for a genuinely live, correctly-scoped binding
# for {role, worktree_id, plan_digest} via the real exported validator
# (never a raw directory listing alone) and prints its binding_id.
_find_role_actor_binding() {
  local role="$1" worktree_id="$2" plan_digest="$3"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const path = require("path");
    const projectRoot = process.argv[2];
    const role = process.argv[3];
    const worktreeId = process.argv[4];
    const planDigest = process.argv[5];
    const dir = path.join(rll.registryRepoDir(projectRoot), "role-actor-bindings");
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const bindingId = entry.name.replace(/\.json$/, "");
      const result = rll.validateRoleActorBindingFor(projectRoot, bindingId, role, worktreeId, planDigest);
      if (result.ok) { process.stdout.write(bindingId); process.exit(0); }
    }
    process.exit(1);
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$role" "$worktree_id" "$plan_digest"
}

@test "M7-B2-ACTORBINDING: a confirmed B2 creates a RoleActorBinding whose scope (role, worktree, plan, session_generation) exactly matches the confirmed action" {
  run _mint_reserved_role_spawn "arch-platform" "actorbind-session" "arch-platform" "arch-platform"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  local action_id; action_id="$(awk '{print $1}' <<< "$output")"
  [ -n "$action_id" ]

  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const actionRead = rll.findActionAcrossRepos(process.argv[3]);
    if (!actionRead.ok || actionRead.absent) { process.exit(1); }
    process.stdout.write(actionRead.action.worktree_id + " " + actionRead.action.plan_digest + " " + actionRead.action.session_generation_id);
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id"
  [ "$status" -eq 0 ]
  local worktree_id plan_digest session_generation_id
  read -r worktree_id plan_digest session_generation_id <<< "$output"
  [ -n "$worktree_id" ]

  _make_subagent_start_input_full "arch-platform" "actorbind-session-caller" "actorbind-agent-id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]

  run _find_role_actor_binding "arch-platform" "$worktree_id" "$plan_digest"
  [ "$status" -eq 0 ]
  local binding_id="$output"
  [ -n "$binding_id" ]

  # The binding's own session_generation_id must match the confirmed
  # action's -- proves the scope came directly from the ACTION object, not
  # re-derived or guessed independently.
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const bindingRead = rll.readRegistryRecord(rll.roleActorBindingPathFor(process.argv[2], process.argv[3]));
    if (!bindingRead.ok || bindingRead.absent) process.exit(1);
    if (bindingRead.obj.session_generation_id !== process.argv[4]) process.exit(1);
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$binding_id" "$session_generation_id"
  [ "$status" -eq 0 ]
}

@test "M7-B2-ACTORBINDING-READY: the RoleActorBinding a confirmed B2 creates is genuinely usable by 'ready' end-to-end through the real production CLI" {
  run _mint_reserved_role_spawn "arch-platform" "actorbindready-session" "arch-platform" "arch-platform"
  [ "$status" -eq 0 ]
  local action_id; action_id="$(awk '{print $1}' <<< "$output")"
  [ -n "$action_id" ]

  _make_subagent_start_input_full "arch-platform" "actorbindready-session-caller" "actorbindready-agent-id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]

  # Drive the REAL production 'ready' path directly (mirrors this file's own
  # established "drive production code directly" convention): resolve the
  # just-created binding, mint a lifecycle-command-grant the SAME way the
  # (separately-corrected) target-gate hook is required to, then invoke the
  # real runtime-role-lifecycle.cjs CLI end-to-end.
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const projectRoot = process.argv[2];
    const actionId = process.argv[3];
    const actionRead = rll.findActionAcrossRepos(actionId);
    if (!actionRead.ok || actionRead.absent) { process.stderr.write("action not found"); process.exit(1); }
    const action = actionRead.action;
    const dir = path.join(rll.registryRepoDir(projectRoot), "role-actor-bindings");
    let bindingId = null;
    let dirEntries = [];
    try {
      dirEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      process.stderr.write("role-actor-bindings/ directory does not exist at all (" + e.code + ") -- no RoleActorBinding was ever created: " + dir);
      process.exit(1);
    }
    for (const entry of dirEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const candidateId = entry.name.replace(/\.json$/, "");
      const result = rll.validateRoleActorBindingFor(projectRoot, candidateId, action.role, action.worktree_id, action.plan_digest);
      if (result.ok) { bindingId = candidateId; break; }
    }
    if (!bindingId) { process.stderr.write("no live RoleActorBinding found"); process.exit(1); }
    const bindingRead = rll.readRegistryRecord(rll.roleActorBindingPathFor(projectRoot, bindingId));
    const argvDigest = crypto.createHash("sha256").update("ready:" + actionId).digest("hex");
    const mintResult = rll.mintLifecycleCommandGrant(projectRoot, bindingRead.obj, argvDigest, action.role, "ready", "role-actor", "target", "target", actionId);
    if (!mintResult.ok) { process.stderr.write("grant mint failed: " + JSON.stringify(mintResult)); process.exit(1); }
    const result = spawnSync("node", [process.argv[1], "ready", "--action", actionId, "--lifecycle-binding", mintResult.grantId], { encoding: "utf8" });
    process.stdout.write(result.stdout);
    if (result.status !== 0) { process.stderr.write("CLI exit " + result.status + ": " + result.stderr); process.exit(1); }
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":"READY"'* ]]
}

# M7/WP4 SECOND-PASS CORRECTION (2026-08-09, supersedes the FIRST pass's own
# M7-B2-ACTORBINDING-FAILURE-NONFATAL test below, renamed/rewritten here):
# the user's HARD NO-GO explicitly named the first pass's best-effort/
# non-fatal treatment of RoleActorBinding creation failure as WRONG --
# "if the binding doesn't exist, nothing downstream has anything real to
# authorize against; this should be a hard failure, not a soft one." A
# SubagentStart hook cannot literally block the spawn (the agent has already
# started by the time this hook fires) -- "fatal" here means: never fall
# through to bundle injection on a binding-creation failure, mirroring this
# file's OWN already-established B3 ABSENT/AMBIGUOUS/MISMATCHED hard-failure
# pattern exactly (quarantine the confirmed candidate, no bundle, distinct
# reason on stderr) -- never the silent "log to stderr but proceed as if
# nothing happened" shape the superseded test asserted.
@test "M7-B2-ACTORBINDING-FAILURE-FATAL: a RoleActorBinding creation failure after B2 CONFIRMED is FATAL -- bundle injection must NOT proceed, mirroring this file's own B3 hard-failure pattern (quarantine + no additionalContext), never best-effort/non-fatal" {
  run _mint_reserved_role_spawn "arch-platform" "actorbindfail-session" "arch-platform" "arch-platform"
  [ "$status" -eq 0 ]
  write_bundle "arch-platform" "bl-w47-test"

  # Force RoleActorBinding creation to fail: pre-create role-actor-bindings/
  # as a symlink, so createRoleActorBinding's own writeRegistryRecordReplace
  # -> ensureSecureRegistryDir rejects the pre-existing symlink (mirrors this
  # codebase's own established symlink-rejection precedent).
  local actorbind_dir
  actorbind_dir="$(NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e 'const rll=require(process.argv[1]); process.stdout.write(require("path").join(rll.registryRepoDir(process.argv[2]), "role-actor-bindings"));' "$RLL_IMPL" "$PROJECT_ROOT")"
  mkdir -p "$(dirname "$actorbind_dir")"
  local bogus_target; bogus_target="$(mktemp -d)"
  ln -s "$bogus_target" "$actorbind_dir"

  # SINGLE invocation, both streams captured from that ONE call. B2
  # confirmation is one-use by pre-existing, unchanged design
  # (validateAndConsumeRoleSpawnExecutionClaim's own no-clobber `.consumed`
  # marker) -- a SECOND separate hook call against the SAME reservation is a
  # genuine replay that B3 correctly quarantines (ABSENT: the claim is
  # already consumed), which is a different scenario than this test intends
  # to exercise. stderr is redirected to a temp file so it can be inspected
  # alongside stdout ($output/$status) from the same run.
  _make_subagent_start_input_full "arch-platform" "actorbindfail-session-caller" "actorbindfail-agent-id"
  local stderr_file; stderr_file="$(mktemp "$BATS_TEST_TMPDIR/actorbindfail-stderr.XXXXXX")"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>'$stderr_file'"
  [ "$status" -eq 0 ]
  # pre-fix (pre-fix): this is the FIRST assertion that fails -- the hook
  # currently DOES inject the bundle regardless of the binding-creation
  # failure (best-effort/non-fatal), which is exactly the rejected design.
  [[ "$output" != *'"additionalContext"'* ]]

  local stderr_content; stderr_content="$(cat "$stderr_file")"
  [[ "$stderr_content" == *"actor"* ]] || [[ "$stderr_content" == *"binding"* ]]

  # Mirrors B3's own hard-failure contract exactly: a genuine confirmation-
  # chain failure after B2 quarantines the role binding -- never leaves it
  # sitting in STARTING/REHYDRATING as if nothing happened.
  run _role_binding_state "arch-platform" "actorbindfail-session"
  [ "$output" = "QUARANTINED" ]

  rm -f "$stderr_file"
  rm -rf "$bogus_target"
}

# ══════════════════════════════════════════════════════════════════════════
# M6+M7 RESIDUAL AUTHORITY CORRECTION (2026-08-11, dispatch arch-testing
# arch-testing-20260811T162225Z): Section D / item 7 ("Para un SubagentStop de
# un role canónico, session_id/agent_id/agent_type ausente o malformed debe
# bloquear el stop. Main orchestrator con agent_type vacío continúa siendo
# no-op. ... La resolución de generación durante cleanup/stop es read-only; no
# crea una generación nueva.").
#
# Pre-existing coverage found (confirmed by direct read of this file's own
# handleSubagentStop before adding anything): "main orchestrator no-op" is
# already correct (`if (!agentType) { process.exit(0); return; }`, first
# check after the CLAUDE-ID-01 cleanup call); "stop exact retires only the
# exact actor" and "a stop never removes a DIFFERENT peer's own CLAUDE-ID-01
# capability" are already covered by runtime-role-lifecycle-registry.test.js's
# own "item 1 regression" pair and claude-one-shot-binding-red.bats's own
# COSB-E2E-SUBAGENTSTOP-WRONG-IDENTITY-DOES-NOT-RETIRE. The two properties
# below are NOT covered by any existing test in any of the 7 authorized files.
# ══════════════════════════════════════════════════════════════════════════

@test "ITEM7-SUBAGENTSTOP-MISSING-IDENTITY-MUST-BLOCK: a SubagentStop for a CANONICAL role (non-empty agent_type) with session_id/agent_id BOTH absent must BLOCK the stop -- pre-fix it silently no-ops (exit 0, no decision of any kind) instead" {
  make_input "SubagentStop" "arch-testing"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

@test "ITEM7-SUBAGENTSTOP-GENERATION-RESOLUTION-MUST-BE-READONLY: SubagentStop's own CLAUDE-ID-01 trace cleanup must NEVER mint a fresh session-generation record as a side effect, for a session that never had one before this call -- pre-fix deleteClaudeId01TraceForSession resolves its scope via resolveClaudeId01Scope, which calls the ENSURE-CREATE resolveSessionGeneration (the SAME primitive minting a fresh binding needs), never the read-only peekSessionGeneration this codebase's OWN established 'Point A.4: lookup-only' discipline (validateMainOrchestratorBindingFor, attachDerivedSessionGenerationId) already uses elsewhere for exactly this kind of read-only revalidation" {
  # A genuinely discoverable PLAN.md is REQUIRED for this test to be
  # non-vacuous: resolveClaudeId01Scope's own first checks
  # (computeWorktreeId + discoverPlan) return null EARLY -- before
  # resolveSessionGeneration is ever reached -- the moment discoverPlan finds
  # no PLAN.md at all (this file's own global setup() never writes one).
  # Confirmed empirically: without this fixture, the assertion below passed
  # vacuously (the mint-capable call was never reached at all, not because it
  # was genuinely read-only).
  mkdir -p "$PROJECT_ROOT/.planning/wave-item7-genreadonly"
  printf '# fixture PLAN for the item7 read-only generation-resolution test\n' > "$PROJECT_ROOT/.planning/wave-item7-genreadonly/PLAN.md"

  local fresh_session="item7-genreadonly-session-$$"
  local before
  before="$(node -e '
    const rll = require(process.argv[1]);
    const identity = { provider: "claude-hook", runtime_session_key: process.argv[3] };
    process.stdout.write(String(require("fs").existsSync(rll.sessionGenerationPathFor(process.argv[2], identity))));
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$fresh_session")"
  [ "$before" = "false" ]

  python3 - "$INPUT_FILE" "$fresh_session" <<'PYEOF'
import json, sys
path, session = sys.argv[1], sys.argv[2]
payload = {"hook_event_name": "SubagentStop", "agent_type": "arch-testing", "session_id": session, "agent_id": "item7-genreadonly-agent"}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]

  local after
  after="$(node -e '
    const rll = require(process.argv[1]);
    const identity = { provider: "claude-hook", runtime_session_key: process.argv[3] };
    process.stdout.write(String(require("fs").existsSync(rll.sessionGenerationPathFor(process.argv[2], identity))));
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$fresh_session")"
  [ "$after" = "false" ]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 defect 10 / checklist item 13 (2026-08-17 correction pass): section 8.4's
# own ordering ("Only AFTER the fence... is already durable does the
# best-effort CLAUDE-ID-01 trace/event cleanup run") is violated today --
# deleteClaudeId01TraceForSession (this file's own handleSubagentStop, the
# call site right after the shouldFence block) is a SIBLING `if`, not nested
# inside `if (shouldFence)`. A noncanonical custom-name Agent (this file's own
# doc comment: agentType may be the Agent tool's `name` param) with classifier
# state ABSENT computes shouldFence=false and correctly skips the fence
# publish -- but the trace-deletion call still runs unconditionally.
#
# The real production writer (recordClaudeId01SubagentStartObservation)
# itself refuses to write anything for a noncanonical agentType
# (CANONICAL_ROLES.includes guard, confirmed by direct source read) -- so a
# genuine trace can never exist at this exact identity+agentType key via the
# normal SubagentStart path. A direct plant at the exact resolved path
# (mirroring this suite's own established "plant one side of the fixture
# directly" convention) is required for a non-vacuous test: without it, a
# byte-identical assertion would trivially pass (nothing before, nothing
# after) regardless of whether the ordering bug exists.
# ══════════════════════════════════════════════════════════════════════════

@test "M7-SUBAGENTSTOP-NONCANONICAL-ABSENT-TRACE-UNTOUCHED-13: a SubagentStop for a NONCANONICAL custom-name agent_type with classifier state ABSENT (shouldFence=false) must leave a pre-existing CLAUDE-ID-01 trace record byte-identical -- pre-fix, deleteClaudeId01TraceForSession runs unconditionally (sibling if to shouldFence, not nested inside it) and unlinks it regardless" {
  mkdir -p "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG"
  printf '# fixture PLAN for the noncanonical-ABSENT trace-untouched test\n' > "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG/PLAN.md"

  local session_id="m7-noncanon-absent-session-$$"
  local agent_id="m7-noncanon-absent-agent-$$"
  local agent_type="m7-custom-instance-name-noncanonical"

  local record_path
  record_path="$(node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const fs = require("fs");
    const path = require("path");
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const agentId = process.argv[4];
    const agentType = process.argv[5];
    const identity = { provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    if (!generation.ok) { process.stderr.write("generation mint failed: " + JSON.stringify(generation)); process.exit(1); }
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const agentDigest = crypto.createHash("sha256").update(agentId, "utf8").digest("hex");
    const recordPath = rll.claudeId01RecordPathFor(
      projectRoot, generation.generationId, worktreeId, planResult.planDigest, agentType, agentDigest, undefined,
    );
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, JSON.stringify({ planted: "m7-item13-fixture", session_id: sessionId, agent_id: agentId }), { mode: 0o600 });
    process.stdout.write(recordPath);
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$session_id" "$agent_id" "$agent_type")"
  [ -n "$record_path" ]
  [ -f "$record_path" ]

  local before_bytes
  before_bytes="$(cat "$record_path")"

  python3 - "$INPUT_FILE" "$session_id" "$agent_id" "$agent_type" <<'PYEOF'
import json, sys
path, session, agent, agent_type = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
payload = {"hook_event_name": "SubagentStop", "agent_type": agent_type, "session_id": session, "agent_id": agent}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]

  [ -f "$record_path" ]
  local after_bytes
  after_bytes="$(cat "$record_path")"
  [ "$before_bytes" = "$after_bytes" ]
}

# Sixteenth §16b/16d RED: the source authority must originate at the real
# root-source lifecycle CLI, then cross the real Agent PreToolUse reservation
# hook before this real SubagentStart hook can mint the binding. No
# root-source action/reservation/binding constructor or grant-wrapper is used.
ROOT_SOURCE_AGENT_GATE="$BATS_TEST_DIRNAME/../../.claude/hooks/agent-spawn-execution-gate.js"
S16_RETAINED_FIXTURE="$BATS_TEST_DIRNAME/fixtures/runtime-consultation-grant-wrapper.cjs"

_mint_reserved_root_source_via_real_surfaces() {
  local session_id="$1"
  mkdir -p "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG"
  printf '# fixture PLAN for Sixteenth root-source SubagentStart RED\n' > "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG/PLAN.md"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-subagent-retained-plane" node -e '
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const lifecycleCli = process.argv[1];
    const agentGate = process.argv[3];
    const projectRoot = process.argv[4];
    const sessionId = process.argv[5];
    const retainedFixture = require(process.argv[6]);
    const intent = {
      source_role: "toolkit-specialist",
      reporting_architect: "arch-platform",
      question: "Inspect the bounded Sixteenth root-source fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
    };
    const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("S16 prerequisite PLAN missing: " + JSON.stringify(plan)); process.exit(1); }
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!generation.ok || !main.ok) { process.stderr.write("S16 prerequisite main authority failed"); process.exit(1); }
    retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
    const grant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
      "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
    );
    if (!grant.ok) {
      process.stderr.write("S16 missing root-source lifecycle admission: " + JSON.stringify(grant));
      process.exit(1);
    }
    const cli = spawnSync(process.execPath, [
      lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
      "--lifecycle-binding", grant.grantId,
    ], { encoding: "utf8", env: process.env });
    if (cli.status !== 0) {
      process.stderr.write("S16 real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
      process.exit(1);
    }
    let envelope;
    try { envelope = JSON.parse(cli.stdout); } catch { process.stderr.write("S16 root-source stdout not JSON"); process.exit(1); }
    if (envelope.status !== "ACTION_REQUIRED" || !envelope.operation || envelope.operation.kind !== "root-source" || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
      process.stderr.write("S16 root-source did not return one closed action: " + JSON.stringify(envelope)); process.exit(1);
    }
    const action = envelope.actions[0];
    const p = action.payload;
    const gate = spawnSync(process.execPath, [agentGate], {
      input: JSON.stringify({
        tool_name: "Agent",
        tool_input: { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message },
        tool_use_id: "s16-rsb-agent-tool-use-01",
        session_id: sessionId,
        agent_type: "",
        agent_id: "",
      }),
      encoding: "utf8",
      env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" }),
    });
    let gateBody;
    try { gateBody = JSON.parse(gate.stdout); } catch { gateBody = null; }
    if (gate.status !== 0 || !gateBody || !gateBody.hookSpecificOutput || gateBody.hookSpecificOutput.permissionDecision !== "allow") {
      process.stderr.write("S16 real Agent gate did not reserve the root source: " + JSON.stringify({ status: gate.status, stdout: gate.stdout, stderr: gate.stderr }));
      process.exit(1);
    }
    process.stdout.write(action.action_id + " " + main.binding.binding_id + " " + generation.generationId);
  ' "$RLL_IMPL" "$RC_IMPL" "$ROOT_SOURCE_AGENT_GATE" "$PROJECT_ROOT" "$session_id" "$S16_RETAINED_FIXTURE"
}

@test "S16-RSB-SUBAGENTSTART-BINDING-01: a reservation produced by the real root-source CLI and real Agent gate is consumed by the real SubagentStart hook into one exact root-source binding" {
  local session_id="s16-rsb-subagentstart-session"
  local agent_id="s16-rsb-subagentstart-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]

  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const actionId = process.argv[3];
    const sessionId = process.argv[4];
    const agentId = process.argv[5];
    const generationId = process.argv[6];
    const dir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) {
      process.stderr.write("root-source-bindings directory absent: " + err.code); process.exit(1);
    }
    const records = entries
      .filter((e) => e.isFile() && /^[a-f0-9]{32}\.json$/.test(e.name))
      .map((e) => JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8")))
      .filter((r) => r.action_id === actionId);
    if (records.length !== 1) { process.stderr.write("expected one exact binding, got " + records.length); process.exit(1); }
    const b = records[0];
    // Stale-value fix (same category as everything else this wave): the
    // real SubagentStart path (subagent-start-context-bundle.js -> real
    // createRootSourceBinding, runtime-role-lifecycle.cjs ~2210/2246/2252)
    // unconditionally mints v2 now (session_generation_id included), never
    // v1 -- confirmed by direct read, already-accepted Fase 2 behavior.
    const keys = [
      "schema", "binding_id", "action_id", "actor_instance_id", "runtime",
      "runtime_session_key", "agent_id", "agent_type", "role", "reporting_architect",
      "subject_bundle_ref", "subject_scope_digest", "request_expiry", "worktree_id",
      "plan_digest", "created_at", "expiry", "session_generation_id",
    ].sort();
    if (JSON.stringify(Object.keys(b).sort()) !== JSON.stringify(keys)) { process.stderr.write("binding key set not closed: " + JSON.stringify(b)); process.exit(1); }
    if (b.schema !== "runtime/root-source-binding/v2" || b.runtime !== "claude-hook"
      || b.runtime_session_key !== sessionId || b.agent_id !== agentId
      || b.agent_type !== "toolkit-specialist" || b.role !== "toolkit-specialist"
      || b.reporting_architect !== "arch-platform" || !/^[a-f0-9]{32}$/.test(b.actor_instance_id)
      || b.session_generation_id !== generationId) {
      process.stderr.write("binding correlation invalid: " + JSON.stringify(b)); process.exit(1);
    }
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id" "$session_id" "$agent_id" "$generation_id"
  [ "$status" -eq 0 ]
}

# M67-RS-HARNESS-SUFFIX-IDENTITY-01 (S16-RS-AUTOSUFFIX-BINDING-01): the exact
# same real root-source CLI + real Agent gate reservation as
# S16-RSB-SUBAGENTSTART-BINDING-01 above (minted under the ordinary canonical
# name -- exactly what the gate always requires), but the observed
# SubagentStart event now carries the harness's own numeric-suffixed
# agent_type ("toolkit-specialist-2"), simulating Claude Code's own
# collision-avoidance rename. Before the fix this leaves the reservation
# permanently ISSUED (never consumed) and mints no binding at all -- the
# observed agentType simply does not match anything in CANONICAL_ROLES, so
# the whole SubagentStart consumption path silently treats it as non-owning.
# After the fix: exactly one consumed marker and one canonical
# "toolkit-specialist" root-source binding for this exact session_id+agent_id
# -- indistinguishable from the ordinary unsuffixed case.
@test "S16-RS-AUTOSUFFIX-BINDING-01: a harness-suffixed observed agent_type (toolkit-specialist-2) is still consumed by the real SubagentStart hook into one exact canonical toolkit-specialist root-source binding" {
  local session_id="s16-autosuffix-binding-session"
  local agent_id="s16-autosuffix-binding-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  local consumed_path
  consumed_path="$(_a_root_reservation_consumed_path "$PROJECT_ROOT" "$action_id")"
  [ ! -e "$consumed_path" ]
  local before_binding_count
  before_binding_count="$(_a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id")"
  [ "$before_binding_count" -eq 0 ]

  _make_subagent_start_input_full "toolkit-specialist-2" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]

  [ -e "$consumed_path" ]
  local after_binding_count
  after_binding_count="$(_a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id")"
  [ "$after_binding_count" -eq 1 ]

  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const actionId = process.argv[3];
    const sessionId = process.argv[4];
    const agentId = process.argv[5];
    const generationId = process.argv[6];
    const dir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const records = entries
      .filter((e) => e.isFile() && /^[a-f0-9]{32}\.json$/.test(e.name))
      .map((e) => JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8")))
      .filter((r) => r.action_id === actionId);
    if (records.length !== 1) { process.stderr.write("expected one exact binding, got " + records.length); process.exit(1); }
    const b = records[0];
    // The durable binding uses the RESOLVED CANONICAL role throughout --
    // never the raw suffixed observed agentType -- indistinguishable from
    // the ordinary unsuffixed S16-RSB-SUBAGENTSTART-BINDING-01 case.
    if (b.schema !== "runtime/root-source-binding/v2" || b.runtime !== "claude-hook"
      || b.runtime_session_key !== sessionId || b.agent_id !== agentId
      || b.agent_type !== "toolkit-specialist" || b.role !== "toolkit-specialist"
      || b.reporting_architect !== "arch-platform" || !/^[a-f0-9]{32}$/.test(b.actor_instance_id)
      || b.session_generation_id !== generationId) {
      process.stderr.write("binding correlation invalid: " + JSON.stringify(b)); process.exit(1);
    }
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id" "$session_id" "$agent_id" "$generation_id"
  [ "$status" -eq 0 ]
}

_s16_autosuffix_stop_payload() {
  local session="$1" agent_id="$2" agent_type="$3"
  python3 - "$INPUT_FILE" "$session" "$agent_id" "$agent_type" <<'PYEOF'
import json, sys
path, session, agent_id, agent_type = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
payload = {"hook_event_name": "SubagentStop", "agent_type": agent_type, "session_id": session, "agent_id": agent_id}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
}

# M67-RS-HARNESS-SUFFIX-IDENTITY-01 (S16-RS-AUTOSUFFIX-STOP-01): the same
# real root-source binding as S16-RS-AUTOSUFFIX-BINDING-01 above (created via
# a genuinely harness-suffixed SubagentStart), now stopped. Per the mission
# ruling, SubagentStop classification remains keyed ONLY by exact
# session_id+agent_id (unaffected); only the LATER observed-agent_type-vs-
# binding-role CLAIM check may ever accept a numeric-suffixed claim, and only
# when classification is state ONE, family root-source, and the parsed
# suffix prefix exactly equals the binding's own role. Two sub-cases here:
#   1. positive -- the real owning identity, suffixed agent_type: not
#      blocked (the suffix is correctly accepted, canonical role used).
#   2. wrong session/agent -- an entirely unrelated identity (no binding
#      exists for it at all) presenting the identical suffixed agent_type:
#      classification is ABSENT for that identity, so it remains the
#      ordinary non-owning pass-through -- never fences or touches the real
#      binding it does not belong to.
# A third permutation (a DIFFERENT canonical role's suffix, e.g.
# "arch-platform-2", claimed against this same real owning identity) is
# deliberately NOT independently E2E-fixture-tested here: publishClaudeAuthorityFence
# is idempotent no-clobber, so any second SubagentStop for the SAME identity
# (regardless of the agent_type it claims) short-circuits at classification's
# own already-FENCED state before the role-claim check is ever reached --
# testing it properly needs a genuinely SEPARATE, not-yet-stopped owning
# identity, which needs a second real retained-plane mint via
# _mint_reserved_root_source_via_real_surfaces; empirically confirmed
# (2026-08-21) that this fixture's own RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY
# gate is single-use per process (a second establishRetainedCodexSupportPlane
# call in the same test fails CAPABILITY_UNAVAILABLE) -- a deliberate fixture
# scoping property, not a defect to route around. The role-mismatch
# comparison itself (harnessSuffixCandidateRole("arch-platform-2") ->
# "arch-platform", distinct from "toolkit-specialist") is the exact same
# duplicated regex already E2E-proven at the Agent-spawn-gate layer by
# S16-RS-AUTOSUFFIX-NAMESPACE-SPOOF-01's own "foreign prefix" case.
@test "S16-RS-AUTOSUFFIX-STOP-01: a harness-suffixed observed agent_type at SubagentStop is accepted as the observed claim for the exact owning root-source identity; an unrelated identity presenting the identical suffixed agent_type remains non-owning pass-through, never touching the real binding" {
  local session_id="s16-autosuffix-stop-session"
  local agent_id="s16-autosuffix-stop-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  _make_subagent_start_input_full "toolkit-specialist-2" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id"
  [ "$output" = "1" ]

  # Sub-case: wrong session/agent FIRST -- an entirely unrelated identity (no
  # binding at all) presenting the identical suffixed agent_type.
  # classification is ABSENT for this identity (agentType itself is not
  # canonical, so shouldFence is also false) -- ordinary non-owning
  # pass-through, never touches the real binding above. Run before the
  # positive sub-case below so neither leaves the OTHER identity fenced.
  _s16_autosuffix_stop_payload "s16-autosuffix-stop-UNRELATED-session" "s16-autosuffix-stop-UNRELATED-agent" "toolkit-specialist-2"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id"
  [ "$output" = "1" ]

  # Sub-case: positive -- the real owning identity, suffixed agent_type.
  _s16_autosuffix_stop_payload "$session_id" "$agent_id" "toolkit-specialist-2"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" != *'"decision":"block"'* ]]
}

# M67-RS-AUTOSUFFIX-STOP-WRONG-CLAIM-COVERAGE-01 (S16-RS-AUTOSUFFIX-STOP-WRONG-CLAIM-01):
# a genuinely fresh, never-before-stopped real root-source owning identity
# (its own isolated mint -- deliberately NOT reusing S16-RS-AUTOSUFFIX-STOP-01's
# own identity: publishClaudeAuthorityFence is idempotent no-clobber, so a
# SECOND stop for an already-stopped identity would short-circuit at the
# already-FENCED classification state before the role-claim check is ever
# reached again, testing nothing -- this is exactly why this case needs its
# own isolated fixture, never the valid-stop fixture reused). The FIRST-ever
# SubagentStop for this identity claims a DIFFERENT canonical role's
# harness-suffix shape ("arch-platform-2") instead of the real owning
# role's own ("toolkit-specialist-2"). Per the fix in handleSubagentStop:
# harnessSuffixCandidateRole("arch-platform-2") -> "arch-platform", which
# does not equal this binding's own role ("toolkit-specialist") -- the new
# suffix-acceptance branch is skipped entirely, falling through to the
# UNCHANGED pre-existing exact-match claim check, which denies exactly as
# it always has. This proves the new code path is exclusive, never lenient
# by shape alone: a wrong-role claim is never silently accepted merely
# because it has the right numeric-suffix shape.
@test "S16-RS-AUTOSUFFIX-STOP-WRONG-CLAIM-01: a first-ever SubagentStop for a real root-source owning identity claiming a DIFFERENT canonical role's harness-suffix shape is blocked/fenced, never accepted as canonical" {
  local session_id="s16-autosuffix-wrongclaim-session"
  local agent_id="s16-autosuffix-wrongclaim-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  _make_subagent_start_input_full "toolkit-specialist-2" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id"
  [ "$output" = "1" ]

  # The one and only stop for this identity: a wrong-role suffix claim.
  _s16_autosuffix_stop_payload "$session_id" "$agent_id" "arch-platform-2"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"block"'* ]]

  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id"
  [ "$output" = "1" ]
}

# ══════════════════════════════════════════════════════════════════════════
# M67-RS-RESERVATION-EXPIRED-HISTORY-LIVE-01 (round-4 ruling, 2026-08-21):
# findLiveRootSourceReservationsForRole validated each reservation but
# immediately returned root-source-reservation-expired for ANY valid
# unconsumed expired record -- unlike its own sibling
# findLiveRootSourceActionsForRole (M6-M7-ROOT-SOURCE-EXPIRED-HISTORY-
# CLOSURE-20260820, already accepted), it had no expired-history
# classification, so a single expired historical reservation permanently
# masked a newer, still-live reservation for the same role. The fix
# (runtime-role-lifecycle.cjs, findLiveRootSourceReservationsForRole)
# mirrors that sibling exactly: one clock capture per scan; a valid
# unconsumed expired reservation is classified sawExpiredHistory=true and
# the scan continues (never an early return, never deleted/rewritten/
# consumed); only after the full scan does >1 live win ambiguous, exactly
# 1 live win (even with expired history present), 0 live + history win
# expired, 0 live + no history win empty success.
#
# Construction note: findLiveRootSourceActionsForRole (the ALREADY-ACCEPTED
# sibling scanner, unrelated to this round's fix) independently enforces
# "at most one live ACTION per role" at the Agent-spawn-gate layer -- two
# real root-source CLI mints followed by two real gate calls in quick
# succession therefore cannot both succeed; the second gate call denies
# root-source-action-ambiguous before a second reservation ever exists.
# So EXPIRED-HISTORY-LIVE-01 and EXPIRED-ONLY-DENIES-01 below use a REAL
# wall-clock wait (bounded poll on the action's own recorded expires_at,
# never a fixture-mutated timestamp) to let the first action naturally,
# genuinely expire before minting the second -- zero fixture mutation for
# either test. Only TWO-LIVE-AMBIGUOUS-01 (below), which requires two
# SIMULTANEOUSLY live reservations -- structurally impossible to reach
# through the real gate given that same "at most one live action"
# invariant -- uses a fixture clone (a second, freshly-real-minted action
# copied to a new valid action_id) to exercise findLiveRootSourceReservationsForRole's
# own ambiguity branch directly.
_s16_wait_for_action_expiry() {
  local project_root="$1" action_id="$2"
  local expires_at_ms
  expires_at_ms="$(node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const action = JSON.parse(fs.readFileSync(rll.actionPathFor(process.argv[2], process.argv[3]), "utf8"));
    process.stdout.write(String(Date.parse(action.expires_at)));
  ' "$RLL_IMPL" "$project_root" "$action_id")"
  while true; do
    local now_ms
    now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
    [ "$now_ms" -ge "$expires_at_ms" ] && break
    sleep 0.2
  done
}

@test "M67-RS-RESERVATION-EXPIRED-HISTORY-LIVE-01: one genuinely (wall-clock) expired unconsumed historical reservation plus exactly one newer valid live reservation for the same role -- the real SubagentStart path consumes and binds exactly the fresh action, leaves the historical reservation bytes unchanged, and creates no consumed marker for the history entry" {
  local session_id="s16-exphist-live-session"
  local agent_id="s16-exphist-live-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local history_action_id main_binding_id generation_id
  read -r history_action_id main_binding_id generation_id <<< "$output"
  [ -n "$history_action_id" ]

  local history_reservation_path
  history_reservation_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootSourceReservationPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJECT_ROOT" "$history_action_id")"
  local history_bytes_at_mint
  history_bytes_at_mint="$(cat "$history_reservation_path")"

  # Real wall-clock wait -- never a fixture-mutated timestamp -- until this
  # action's own recorded expires_at genuinely passes.
  _s16_wait_for_action_expiry "$PROJECT_ROOT" "$history_action_id"

  local session_id_2="s16-exphist-live-session-2"
  run _mint_reserved_root_source_via_real_surfaces "$session_id_2"
  [ "$status" -eq 0 ]
  local live_action_id main_binding_id_2 generation_id_2
  read -r live_action_id main_binding_id_2 generation_id_2 <<< "$output"
  [ -n "$live_action_id" ]
  [ "$live_action_id" != "$history_action_id" ]

  _make_subagent_start_input_full "toolkit-specialist" "$session_id_2" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]

  # Exactly the fresh (live) action was consumed and bound; the historical
  # action received zero binding.
  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$live_action_id"
  [ "$output" = "1" ]
  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$history_action_id"
  [ "$output" = "0" ]

  # The historical reservation's own bytes are byte-identical to their
  # at-mint snapshot -- never deleted, rewritten, or consumed at any point.
  local history_bytes_after_stop
  history_bytes_after_stop="$(cat "$history_reservation_path")"
  [ "$history_bytes_at_mint" = "$history_bytes_after_stop" ]

  # No consumed marker was ever written for the historical entry; exactly
  # one, correctly correlated, was written for the live entry.
  local history_consumed_path
  history_consumed_path="$(_a_root_reservation_consumed_path "$PROJECT_ROOT" "$history_action_id")"
  [ ! -f "$history_consumed_path" ]

  local live_reservation_path live_reservation_json
  live_reservation_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootSourceReservationPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJECT_ROOT" "$live_action_id")"
  live_reservation_json="$(cat "$live_reservation_path")"
  run _a_root_assert_consumed_marker_exact "$PROJECT_ROOT" "$live_action_id" "$live_reservation_json"
  [ "$status" -eq 0 ]
}

@test "M67-RS-RESERVATION-EXPIRED-ONLY-DENIES-01: only genuinely (wall-clock) expired valid history, no live sibling, retains the exact root-source-reservation-expired fail-closed result and never degrades to non-owning pass-through" {
  local session_id="s16-exponly-denies-session"
  local agent_id="s16-exponly-denies-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  _s16_wait_for_action_expiry "$PROJECT_ROOT" "$action_id"

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"root-source-reservation-expired"* ]]

  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id"
  [ "$output" = "0" ]
  local consumed_path
  consumed_path="$(_a_root_reservation_consumed_path "$PROJECT_ROOT" "$action_id")"
  [ ! -f "$consumed_path" ]
}

# Fixture-only clone of an already-REAL-minted action+reservation pair to a
# freshly generated, valid action_id -- both remain genuinely live (their
# original, still-future expires_at/expiry is preserved verbatim, never
# mutated). Only action_id changes on the clone, plus the reservation's
# action_digest recomputed to match. This is the sole construction in this
# file that manufactures two SIMULTANEOUSLY live reservations, because the
# real Agent-spawn-gate's own "at most one live action" invariant makes that
# combination structurally unreachable through two genuine mints (see the
# comment above M67-RS-RESERVATION-EXPIRED-HISTORY-LIVE-01).
_s16_clone_reservation_to_fresh_action_id() {
  local project_root="$1" source_action_id="$2"
  node -e '
    const crypto = require("crypto");
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const sourceActionId = process.argv[4];

    const sourceAction = JSON.parse(fs.readFileSync(rll.actionPathFor(projectRoot, sourceActionId), "utf8"));
    const sourceReservation = JSON.parse(fs.readFileSync(rll.rootSourceReservationPathFor(projectRoot, sourceActionId), "utf8"));

    const newActionId = crypto.randomBytes(16).toString("hex");
    const clonedAction = Object.assign({}, sourceAction, { action_id: newActionId });
    const clonedReservation = Object.assign({}, sourceReservation, {
      action_id: newActionId,
      action_digest: rc.sha256String(rc.canonicalJSONStringify(clonedAction)),
    });

    const actionPath = rll.actionPathFor(projectRoot, newActionId);
    const reservationPath = rll.rootSourceReservationPathFor(projectRoot, newActionId);
    fs.writeFileSync(actionPath, rc.canonicalJSONStringify(clonedAction), { mode: 0o600 });
    fs.chmodSync(actionPath, 0o600);
    fs.writeFileSync(reservationPath, rc.canonicalJSONStringify(clonedReservation), { mode: 0o600 });
    fs.chmodSync(reservationPath, 0o600);
    process.stdout.write(newActionId);
  ' "$RLL_IMPL" "$RC_IMPL" "$project_root" "$source_action_id"
}

@test "M67-RS-RESERVATION-TWO-LIVE-AMBIGUOUS-01: two valid live reservations for the same role retain root-source-reservation-ambiguous with zero consumption/binding" {
  local session_id="s16-twolive-ambig-session"
  local agent_id="s16-twolive-ambig-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id_a main_binding_id generation_id
  read -r action_id_a main_binding_id generation_id <<< "$output"
  [ -n "$action_id_a" ]

  run _s16_clone_reservation_to_fresh_action_id "$PROJECT_ROOT" "$action_id_a"
  [ "$status" -eq 0 ]
  local action_id_b="$output"
  [ -n "$action_id_b" ]
  [ "$action_id_a" != "$action_id_b" ]

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"root-source-reservation-ambiguous"* ]]

  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id_a"
  [ "$output" = "0" ]
  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id_b"
  [ "$output" = "0" ]
}

@test "M67-RS-RESERVATION-MALFORMED-EXPIRED-DENIES-01: a genuinely (wall-clock) expired but malformed (tampered action_digest) reservation remains a specific validation failure, never benign history" {
  local session_id="s16-malformed-exp-session"
  local agent_id="s16-malformed-exp-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  _s16_wait_for_action_expiry "$PROJECT_ROOT" "$action_id"

  # Now genuinely, wall-clock expired -- tamper action_digest only (no
  # timestamp touched at all) so it is expired AND malformed.
  run node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const reservationPath = rll.rootSourceReservationPathFor(process.argv[2], process.argv[3]);
    const reservation = JSON.parse(fs.readFileSync(reservationPath, "utf8"));
    reservation.action_digest = "0".repeat(64);
    fs.writeFileSync(reservationPath, JSON.stringify(reservation));
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id"
  [ "$status" -eq 0 ]

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"root-source-reservation-action-mismatch"* ]]
  [[ "$output" != *'"root-source-reservation-expired"'* ]]

  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id"
  [ "$output" = "0" ]
  local consumed_path
  consumed_path="$(_a_root_reservation_consumed_path "$PROJECT_ROOT" "$action_id")"
  [ ! -f "$consumed_path" ]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL REMEDIATION Part A (2026-08-18, A_RED_TESTS): RootSource
# admit-before-consume atomicity. tryConsumeRootSourceReservation (this file,
# above) calls rll.validateAndConsumeRootSourceReservation (writes the
# reservation's own no-clobber `.reservation.consumed.json` marker)
# UNCONDITIONALLY, THEN calls rll.createRootSourceBinding. Direct read of
# createRootSourceBinding (runtime-role-lifecycle.cjs ~2297-2330) shows it
# structurally REQUIRES that consumed marker to already exist as an entry
# precondition (~2301-2302, `root-source-reservation-not-consumed` otherwise)
# BEFORE it ever reaches its own admitClaudeAuthorityOperation fence check
# (~2329) -- so there is no possible caller ordering where the fence is
# consulted before the marker is durably written. A durable identity fence
# for the exact (provider:'claude-hook', runtime_session_key, agent_id) this
# SubagentStart will use, published and confirmed durable BEFORE the hook
# even starts, therefore still lets the marker land -- only the LATER
# createRootSourceBinding call denies (correctly, but too late: the
# reservation is already irreversibly spent with zero binding to show for
# it). A-ROOT-CONTROL-01 proves the same real chain, with no fence, is not
# vacuous: exactly one marker, one correlated root-source-binding/v2.
# ══════════════════════════════════════════════════════════════════════════

_a_root_reservation_consumed_path() {
  node -e '
    const path = require("path");
    const rll = require(process.argv[1]);
    process.stdout.write(path.join(rll.registryRepoDir(process.argv[2]), "root-source-actions", process.argv[3] + ".reservation.consumed.json"));
  ' "$RLL_IMPL" "$1" "$2"
}

_a_root_source_binding_count_for_action() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const dir = path.join(rll.registryRepoDir(process.argv[2]), "root-source-bindings");
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
    const records = entries
      .filter((e) => e.isFile() && /^[a-f0-9]{32}\.json$/.test(e.name))
      .map((e) => JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8")))
      .filter((r) => r.action_id === process.argv[3]);
    process.stdout.write(String(records.length));
  ' "$RLL_IMPL" "$1" "$2"
}

# Full real-primitive parse+validate of the RootSourceReservation record at
# `projectRoot`/`actionId`: re-reads the real action record (rll.actionPathFor
# + rll.readRegistryRecord), runs it through rll.validateRootSourceReservationRecord
# (the real production validator -- schema, closed key set per its own
# ROOT_SOURCE_RESERVATION_KEYS, and full correlation against the action's own
# action_id/action_digest/session_generation_id/expiry), independently
# re-confirms the schema literal, re-derives the CURRENT live session
# generation via rll.peekSessionGeneration and requires it still matches the
# reservation's own session_generation_id, and requires the reservation's
# own deadline (`expiry`) has not yet passed. Prints "VALID" only if every
# check passes; any failure writes a diagnosis to stderr and exits non-zero.
_a_root_parse_and_validate_reservation() {
  local project_root="$1" action_id="$2" session_id="$3"
  node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const actionId = process.argv[3];
    const sessionId = process.argv[4];

    const actionRead = rll.readRegistryRecord(rll.actionPathFor(projectRoot, actionId));
    if (!actionRead.ok || actionRead.absent) { process.stderr.write("action unreadable/absent: " + JSON.stringify(actionRead)); process.exit(1); }
    const action = actionRead.obj;

    const reservationPath = rll.rootSourceReservationPathFor(projectRoot, actionId);
    const raw = fs.readFileSync(reservationPath);
    const record = JSON.parse(raw.toString("utf8"));

    const valid = rll.validateRootSourceReservationRecord(record, action);
    if (!valid.ok) { process.stderr.write("validateRootSourceReservationRecord failed: " + JSON.stringify(valid)); process.exit(1); }
    if (record.schema !== "runtime/root-source-reservation/v1") { process.stderr.write("schema literal mismatch: " + record.schema); process.exit(1); }

    const generation = rll.peekSessionGeneration(projectRoot, { provider: "claude-hook", runtime_session_key: sessionId });
    if (!generation.ok || generation.generationId !== record.session_generation_id) {
      process.stderr.write("session generation not live or mismatched: " + JSON.stringify(generation) + " vs " + record.session_generation_id); process.exit(1);
    }

    const nowMs = Date.now();
    const expiryMs = Date.parse(record.expiry);
    if (!(nowMs < expiryMs)) { process.stderr.write("reservation deadline already passed: now=" + nowMs + " expiry=" + expiryMs); process.exit(1); }

    process.stdout.write("VALID");
  ' "$RLL_IMPL" "$project_root" "$action_id" "$session_id"
}

# Exact real-schema/closed-key-set/correlation check of the reservation's own
# no-clobber consumed marker (ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA/KEYS are
# not exported constants, so the literal schema string and sorted key list
# here are copied verbatim from runtime-role-lifecycle.cjs ~2086-2089, read
# directly before writing this check -- never invented). reservation_digest
# is independently re-derived via rc.sha256String(rc.canonicalJSONStringify(...))
# over the CAPTURED pre-cut reservation bytes, never trusted from the marker
# itself.
_a_root_assert_consumed_marker_exact() {
  local project_root="$1" action_id="$2" reservation_json="$3"
  node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const actionId = process.argv[4];
    const reservationJson = process.argv[5];
    const path = require("path");
    const markerPath = path.join(rll.registryRepoDir(projectRoot), "root-source-actions", actionId + ".reservation.consumed.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    const expectedKeys = ["action_id", "consumed_at", "reservation_digest", "schema"];
    const actualKeys = Object.keys(marker).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) { process.stderr.write("marker key set not closed: " + JSON.stringify(actualKeys)); process.exit(1); }
    if (marker.schema !== "runtime/root-source-reservation-consumed/v1") { process.stderr.write("marker schema invalid: " + marker.schema); process.exit(1); }
    if (marker.action_id !== actionId) { process.stderr.write("marker action_id mismatch"); process.exit(1); }
    const expectedDigest = rc.sha256String(rc.canonicalJSONStringify(JSON.parse(reservationJson)));
    if (marker.reservation_digest !== expectedDigest) { process.stderr.write("marker reservation_digest mismatch: " + marker.reservation_digest + " vs " + expectedDigest); process.exit(1); }
  ' "$RLL_IMPL" "$RC_IMPL" "$project_root" "$action_id" "$reservation_json"
}

@test "A-ROOT-CONTROL-01: the real root-source CLI + Agent gate + SubagentStart chain, with no fence published, consumes exactly one reservation marker and mints exactly one correlated root-source-binding/v2" {
  local session_id="a-root-control-01-session"
  local agent_id="a-root-control-01-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  local reservation_path
  reservation_path="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.rootSourceReservationPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id")"
  local reservation_json_before; reservation_json_before="$(cat "$reservation_path")"

  run _a_root_parse_and_validate_reservation "$PROJECT_ROOT" "$action_id" "$session_id"
  [ "$status" -eq 0 ]
  [ "$output" = "VALID" ]

  local consumed_path; consumed_path="$(_a_root_reservation_consumed_path "$PROJECT_ROOT" "$action_id")"
  [ ! -e "$consumed_path" ]
  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id"
  [ "$output" = "0" ]

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  local hook_stdout_file hook_stderr_file
  hook_stdout_file="$(mktemp)"; hook_stderr_file="$(mktemp)"
  bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'" >"$hook_stdout_file" 2>"$hook_stderr_file"
  local hook_exit=$?
  [ "$hook_exit" -eq 0 ]
  [ -n "$hook_stdout_file" ]

  [ -f "$consumed_path" ]
  run _a_root_assert_consumed_marker_exact "$PROJECT_ROOT" "$action_id" "$reservation_json_before"
  [ "$status" -eq 0 ]

  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id"
  [ "$output" = "1" ]

  run node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const dir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
    const actionId = process.argv[3];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const rec = entries
      .filter((e) => e.isFile() && /^[a-f0-9]{32}\.json$/.test(e.name))
      .map((e) => JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8")))
      .find((r) => r.action_id === actionId);
    if (!rec) { process.stderr.write("binding not found"); process.exit(1); }
    if (rec.runtime_session_key !== process.argv[5] || rec.agent_id !== process.argv[4]) {
      process.stderr.write("binding correlation invalid: " + JSON.stringify(rec)); process.exit(1);
    }
    // Real production validator (positional: root, bindingId, role,
    // worktreeId, planDigest -- confirmed by direct source read,
    // runtime-role-lifecycle.cjs ~2407) -- exact schema/closed-key-set/
    // scope/generation/fence correlation.
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("plan not discoverable"); process.exit(1); }
    const check = rll.validateRootSourceBindingFor(projectRoot, rec.binding_id, "toolkit-specialist", worktreeId, planResult.planDigest);
    if (!check.ok) { process.stderr.write("validateRootSourceBindingFor failed: " + JSON.stringify(check)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id" "$agent_id" "$session_id"
  [ "$status" -eq 0 ]

  rm -f "$hook_stdout_file" "$hook_stderr_file"
}

@test "A-RED-ROOT-01 (RED): a durable identity fence for the exact (provider:claude-hook, runtime_session_key, agent_id) this SubagentStart will use, published and confirmed durable BEFORE the hook is ever invoked, must stop the real root-source chain before the reservation's own consumed marker is ever written -- today tryConsumeRootSourceReservation calls validateAndConsumeRootSourceReservation (writes the marker) unconditionally, then createRootSourceBinding (the function that actually checks the fence), so the marker lands durably even though the fence already existed before the hook started" {
  local session_id="a-red-root-01-session"
  local agent_id="a-red-root-01-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  local reservation_path
  reservation_path="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.rootSourceReservationPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id")"
  [ -f "$reservation_path" ]
  local reservation_json_before; reservation_json_before="$(cat "$reservation_path")"
  local reservation_sha_before; reservation_sha_before="$(shasum -a 256 "$reservation_path" | awk '{print $1}')"

  # Before-release oracle: real schema + closed key set + full correlation
  # (against the real action) + live session generation + deadline not yet
  # passed -- via the real production validator, never hand-approximated.
  run _a_root_parse_and_validate_reservation "$PROJECT_ROOT" "$action_id" "$session_id"
  [ "$status" -eq 0 ]
  [ "$output" = "VALID" ]

  local consumed_path; consumed_path="$(_a_root_reservation_consumed_path "$PROJECT_ROOT" "$action_id")"
  [ ! -e "$consumed_path" ]
  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id"
  [ "$output" = "0" ]

  # Durable identity fence for the EXACT identity SubagentStart will use,
  # published via the real primitive and reread to confirm durability BEFORE
  # the hook is ever invoked -- no rendezvous needed for this defect (unlike
  # A-RED-ONESHOT-01), since createRootSourceBinding's own admission check
  # runs strictly AFTER validateAndConsumeRootSourceReservation's
  # unconditional marker write; a fence durable before the hook starts is
  # already durable for the whole call.
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const agentId = process.argv[4];
    const identityId = rll.computeClaudeAuthorityIdentityId(projectRoot, "claude-hook", sessionId, agentId);
    const published = rll.publishClaudeAuthorityFence(projectRoot, identityId);
    if (!published.ok) { process.stderr.write("fence publish failed: " + JSON.stringify(published)); process.exit(1); }
    const reread = rll.readClaudeAuthorityFence(projectRoot, identityId);
    if (!reread.ok || reread.absent) { process.stderr.write("fence not durable after publish: " + JSON.stringify(reread)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  local hook_stdout_file hook_stderr_file
  hook_stdout_file="$(mktemp)"; hook_stderr_file="$(mktemp)"
  bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'" >"$hook_stdout_file" 2>"$hook_stderr_file"
  local hook_exit=$?
  local hook_stdout; hook_stdout="$(cat "$hook_stdout_file")"
  local hook_stderr; hook_stderr="$(cat "$hook_stderr_file")"

  # Real child exit + exact closed denial + no additionalContext. A crash,
  # timeout, empty output, generic nonzero, or fixture failure never counts
  # as satisfying this: the hook must exit 0 (it never hard-fails the spawn)
  # AND stderr must carry the EXACT closed reason
  # (`checkClaudeAuthorityClassificationAgainstExpected`'s own
  # `authority-fenced` literal, confirmed by direct source read,
  # runtime-role-lifecycle.cjs ~4748) -- not merely "no additionalContext",
  # which alone cannot distinguish a real fence-denial from any other
  # unrelated failure.
  [ "$hook_exit" -eq 0 ]
  [ -n "$hook_stderr" ]
  echo "$hook_stderr" | grep -qF "authority-fenced"
  [[ "$hook_stdout" != *'"additionalContext"'* ]]
  rm -f "$hook_stdout_file" "$hook_stderr_file"

  local reservation_sha_after; reservation_sha_after="$(shasum -a 256 "$reservation_path" | awk '{print $1}')"
  [ "$reservation_sha_after" = "$reservation_sha_before" ]
  [ "$(cat "$reservation_path")" = "$reservation_json_before" ]

  # After-release oracle: re-parse (not merely re-hash) via the same real
  # validator -- explicit, load-bearing, not merely implied by byte equality.
  run _a_root_parse_and_validate_reservation "$PROJECT_ROOT" "$action_id" "$session_id"
  [ "$status" -eq 0 ]
  [ "$output" = "VALID" ]

  run _a_root_source_binding_count_for_action "$PROJECT_ROOT" "$action_id"
  [ "$output" = "0" ]

  # Discriminating oracle (the ONLY assertion that differs between the
  # current buggy bytes and the desired fix -- everything above holds either
  # way, since createRootSourceBinding denies on the fence regardless of
  # whether consumption already happened): the reservation's own no-clobber
  # consumed marker must be absent.
  if [ -e "$consumed_path" ]; then
    echo "A-RED-ROOT-01: reservation-consumed-before-create-admission" >&2
    false
  fi
}

# ══════════════════════════════════════════════════════════════════════════
# M7 defect 10 / checklist item 14 (2026-08-17 correction pass): section 8.4's
# own ordering ("Only AFTER the fence... is already durable does the
# best-effort CLAUDE-ID-01 trace/event cleanup run... A cleanup failure still
# blocks the stop... but can never prevent the fence from having been
# written"). Unlike item 13 (a bug: cleanup runs when it must NOT), this is a
# POSITIVE regression guard for an OWNING actor (canonical role -- shouldFence
# is true unconditionally, independent of classifier state): today's two
# sequential top-level `if` blocks (fence at L584-596, cleanup at L608-619)
# already write the fence FIRST and return-early via blockStop on the fence's
# OWN failure, so a LATER cleanup fault cannot have prevented the earlier
# fence write. This test forces a genuine cleanup fault (a directory planted
# at the exact record path this suite's own claudeId01RecordPathFor
# resolves to -- fs.unlinkSync on a directory throws EISDIR, a non-ENOENT
# error deleteClaudeId01TraceForSession's own catch does NOT tolerate,
# mirroring this file's own established M7-B2-ACTORBINDING-FAILURE-FATAL
# symlink-rejection fixture technique) and proves the fence nonetheless
# durably exists after the blocked stop. Must stay green through the defect
# 10 fix (nesting deleteClaudeId01TraceForSession inside `if (shouldFence)`
# does not change this OWNING branch's own already-correct ordering).
# ══════════════════════════════════════════════════════════════════════════

@test "M7-SUBAGENTSTOP-OWNING-FENCE-DURABLE-BEFORE-CLEANUP-FAULT-14: for a CANONICAL-role (owning) SubagentStop, a genuine CLAUDE-ID-01 cleanup fault still blocks the stop, but the identity fence must already be durably written beforehand -- never rolled back or skipped by the later fault" {
  mkdir -p "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG"
  printf '# fixture PLAN for the owning fence-before-cleanup-fault test\n' > "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG/PLAN.md"

  local session_id="m7-owning-fencefault-session-$$"
  local agent_id="m7-owning-fencefault-agent-$$"
  local agent_type="arch-testing"

  # Plant a DIRECTORY (not a file) at the exact legacy-slot record path --
  # forces fs.unlinkSync to throw EISDIR inside deleteClaudeId01TraceForSession,
  # a non-ENOENT error its own catch propagates as a genuine {ok:false} fault.
  # fs.statSync (preflightClaudeId01TraceForSession's own check) does not
  # distinguish file-vs-directory, so preflight is unaffected -- confirmed by
  # direct source read of both functions before writing this fixture.
  run node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const fs = require("fs");
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const agentId = process.argv[4];
    const agentType = process.argv[5];
    const identity = { provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    if (!generation.ok) { process.stderr.write("generation mint failed: " + JSON.stringify(generation)); process.exit(1); }
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const agentDigest = crypto.createHash("sha256").update(agentId, "utf8").digest("hex");
    const recordPath = rll.claudeId01RecordPathFor(
      projectRoot, generation.generationId, worktreeId, planResult.planDigest, agentType, agentDigest, undefined,
    );
    fs.mkdirSync(recordPath, { recursive: true });
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$session_id" "$agent_id" "$agent_type"
  [ "$status" -eq 0 ]

  python3 - "$INPUT_FILE" "$session_id" "$agent_id" "$agent_type" <<'PYEOF'
import json, sys
path, session, agent, agent_type = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
payload = {"hook_event_name": "SubagentStop", "agent_type": agent_type, "session_id": session, "agent_id": agent}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"block"'* ]]

  # The fence must exist, and read back as durably NOT absent, despite the
  # blocked stop -- a real production reader (readClaudeAuthorityFence), never
  # a raw file-existence guess.
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const agentId = process.argv[4];
    const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    const authorityIdentityId = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", sessionId, agentId);
    const fenceRead = rll.readClaudeAuthorityFence(repoDescriptor, authorityIdentityId);
    if (!fenceRead.ok) { process.stderr.write("fence read failed: " + JSON.stringify(fenceRead)); process.exit(1); }
    if (fenceRead.absent) { process.stderr.write("fence is ABSENT -- must have been written before the cleanup fault"); process.exit(1); }
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 GREEN correction round 2, R6 (resolves GAP-1, disclosed in
# m7-correction-round-1-final-report-2026-08-18.md section 7): Codex's
# explicit ruling confirms the fence-before-preflight reorder IS intended to
# supersede RED-6/REQUESTER-PREFLIGHT-ZERO-MUTATION's old blanket "zero
# mutation on any pre-fence failure" reading -- grounded directly in
# M7-ATOMIC-REVOCATION-RECONCILIATION.md section 8.4's own text ("a canonical
# owning role... publishes the identity fence first" / "After a durable
# fence, raw CLAUDE-ID trace/event cleanup may run best-effort"). The
# narrower RED-6 guarantee survives unchanged for classification failures
# BEFORE ownership is established (see COSB-REQUESTER-PREFLIGHT-ZERO-
# MUTATION-BLOCKS in claude-one-shot-binding-red.bats, which blocks at
# classifyClaudeAuthorityForIdentity itself and is untouched by this reorder
# -- confirmed by direct trace: a malformed requester-binding record is
# caught by the classifier's own unconditional requester-bindings scan
# before shouldFence/fence/preflight are ever reached, regardless of this
# ordering change). THIS test instead exercises the previously-untested
# case Codex's ruling is actually about: an OWNING actor (shouldFence true,
# classification already succeeded) whose CLAUDE-ID-01 preflight itself then
# fails. Uses the SAME parent-directory-blocked-by-a-plain-file ENOTDIR
# technique as M7-SUBAGENTSTOP-PREFLIGHT-BEFORE-SHOULDFENCE-R13
# (runtime-role-lifecycle-registry.test.js) -- confirmed by direct source
# read of preflightClaudeId01TraceForSession that this makes fs.statSync
# throw a genuine non-ENOENT error without also tripping the classifier's
# separate requester-bindings scan (a completely different subtree).
# ══════════════════════════════════════════════════════════════════════════

@test "M7-SUBAGENTSTOP-FENCE-DURABLE-BEFORE-PREFLIGHT-FAULT-R6: for a CANONICAL-role (owning) SubagentStop, a genuine CLAUDE-ID-01 preflight fault still blocks the stop, but the identity fence must already be durably written beforehand -- correction round 2's R6 ruling (resolves GAP-1)" {
  mkdir -p "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG"
  printf '# fixture PLAN for the fence-before-preflight-fault test\n' > "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG/PLAN.md"

  local session_id="m7-r6-preflightfault-session-$$"
  local agent_id="m7-r6-preflightfault-agent-$$"
  local agent_type="arch-testing"

  # Mint a real session generation (prerequisite for resolveClaudeId01ScopeReadOnly
  # to resolve non-null), then block recordPath's own parent directory with a
  # plain file -- fs.statSync(recordPath) throws ENOTDIR, a genuine preflight
  # fault distinct from (and never reaching) deleteClaudeId01TraceForSession.
  run node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const path = require("path");
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const agentType = process.argv[4];
    const identity = { provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    if (!generation.ok) { process.stderr.write("generation mint failed: " + JSON.stringify(generation)); process.exit(1); }
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const crypto = require("crypto");
    const agentDigest = crypto.createHash("sha256").update(process.argv[5], "utf8").digest("hex");
    const recordPath = rll.claudeId01RecordPathFor(
      projectRoot, generation.generationId, worktreeId, planResult.planDigest, agentType, agentDigest, undefined,
    );
    const recordParentDir = path.dirname(recordPath);
    fs.mkdirSync(path.dirname(recordParentDir), { recursive: true });
    fs.writeFileSync(recordParentDir, Buffer.from("blocking plain file where a directory is expected\n", "utf8"));
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$session_id" "$agent_type" "$agent_id"
  [ "$status" -eq 0 ]

  python3 - "$INPUT_FILE" "$session_id" "$agent_id" "$agent_type" <<'PYEOF'
import json, sys
path, session, agent, agent_type = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
payload = {"hook_event_name": "SubagentStop", "agent_type": agent_type, "session_id": session, "agent_id": agent}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"preflight"* ]]

  # The fence must exist, and read back as durably NOT absent, despite the
  # blocked stop -- proves R6's fence-before-preflight reorder actually took
  # effect (before the fix, preflight ran first and this would be ABSENT).
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const agentId = process.argv[4];
    const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    const authorityIdentityId = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", sessionId, agentId);
    const fenceRead = rll.readClaudeAuthorityFence(repoDescriptor, authorityIdentityId);
    if (!fenceRead.ok) { process.stderr.write("fence read failed: " + JSON.stringify(fenceRead)); process.exit(1); }
    if (fenceRead.absent) { process.stderr.write("fence is ABSENT -- must have been written before the preflight fault"); process.exit(1); }
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Sequence 28 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822): RS-CONTEXT --
# authenticated root-source dispatch context. A successfully admitted
# root-source reservation must make the receiving SubagentStart peer a
# host-authenticated `AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1` additionalContext
# block, built ONLY from verified host state (never from the inline
# ROOT_SOURCE_BOOTSTRAP/v1 prompt text), and must exit before the generic
# wave-context-bundle path so a stale/unrelated bundle can never mix in.
# Reuses the exact real-surface fixture (_mint_reserved_root_source_via_real_
# surfaces) every other S16 test above already uses -- no hand-fabricated
# reservation/binding/action.
# ══════════════════════════════════════════════════════════════════════════

@test "RS-CONTEXT-1: a real root-source reservation consumed by the real SubagentStart hook emits one authenticated dispatch block from verified host fields only, and skips generic bundle injection even when a fresh stale generic bundle exists" {
  local session_id="rs-context-1-session"
  local agent_id="rs-context-1-agent"

  # Deliberately plant a wave-slug-valid generic bundle for the SAME role --
  # proves root-source success exits before generic bundle injection ever runs.
  write_bundle "toolkit-specialist" "$PROBE_WAVE_SLUG"

  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  local hook_stdout="$output"

  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const actionId = process.argv[3];
    const generationId = process.argv[4];
    const stdout = process.argv[5];
    let body;
    try { body = JSON.parse(stdout); } catch { process.stderr.write("hook stdout not JSON: " + stdout); process.exit(1); }
    if (typeof body.additionalContext !== "undefined") { process.stderr.write("unexpected top-level additionalContext: " + stdout); process.exit(1); }
    if (!body.hookSpecificOutput || body.hookSpecificOutput.hookEventName !== "SubagentStart") { process.stderr.write("missing/wrong hookSpecificOutput.hookEventName: " + stdout); process.exit(1); }
    if (typeof body.hookSpecificOutput.additionalContext !== "string") { process.stderr.write("no nested additionalContext: " + stdout); process.exit(1); }
    const ctx = body.hookSpecificOutput.additionalContext;
    if (!ctx.startsWith("AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1")) { process.stderr.write("missing stable marker: " + ctx); process.exit(1); }
    const dir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /^[a-f0-9]{32}\.json$/.test(e.name))
      .map((e) => JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8")))
      .filter((r) => r.action_id === actionId);
    if (entries.length !== 1) { process.stderr.write("expected one binding, got " + entries.length); process.exit(1); }
    const b = entries[0];
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("fixture PLAN missing"); process.exit(1); }
    const requiredPairs = [
      ["action_id", actionId], ["role", "toolkit-specialist"], ["reporting_architect", "arch-platform"],
      ["worktree_id", b.worktree_id], ["plan_digest", b.plan_digest], ["session_generation_id", generationId],
      ["subject_bundle_ref", b.subject_bundle_ref], ["subject_scope_digest", b.subject_scope_digest],
      ["scope_doc_path", plan.planPath],
    ];
    for (const [key, value] of requiredPairs) {
      const line = key + "=" + value;
      if (!ctx.includes(line)) { process.stderr.write("missing exact field line \"" + line + "\": " + ctx); process.exit(1); }
    }
    if (!/does not authorize/i.test(ctx)) { process.stderr.write("missing narrow-scope disclaimer: " + ctx); process.exit(1); }
    if (ctx.includes("Key patterns here")) { process.stderr.write("generic stale bundle content leaked into authenticated context: " + ctx); process.exit(1); }
    if (/session_id|agent_id=|secret|grant_id/i.test(ctx)) { process.stderr.write("leaked a disallowed raw identifier: " + ctx); process.exit(1); }
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id" "$generation_id" "$hook_stdout"
  [ "$status" -eq 0 ]
}

@test "RS-CONTEXT-2: an admitted root-source reservation whose live PLAN.md is missing at SubagentStart time fails closed -- no additionalContext, no generic-bundle fallback" {
  local session_id="rs-context-2-session"
  local agent_id="rs-context-2-agent"

  write_bundle "toolkit-specialist" "$PROBE_WAVE_SLUG"

  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  # Remove the live PLAN.md the fixture created -- discoverPlan() now fails.
  rm -f "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG/PLAN.md"

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  # bats `run` combines stdout+stderr into $output -- a stderr diagnostic is
  # expected and fine; the actual contract is no additionalContext at all
  # (neither the authenticated block nor a generic-bundle fallback).
  [[ "$output" != *'"additionalContext"'* ]]
}

@test "RS-CONTEXT-1B: a legitimate numeric harness-suffix observed agent_type (toolkit-specialist-2) for a real canonical toolkit-specialist reservation still emits the authenticated dispatch block, with role kept canonical and no generic-bundle content" {
  local session_id="rs-context-1b-session"
  local agent_id="rs-context-1b-agent"

  write_bundle "toolkit-specialist-2" "$PROBE_WAVE_SLUG"

  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  _make_subagent_start_input_full "toolkit-specialist-2" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"additionalContext"'* ]]
  [[ "$output" == *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]
  [[ "$output" == *"role=toolkit-specialist"* ]]
  [[ "$output" != *"role=toolkit-specialist-2"* ]]
  [[ "$output" != *"Key patterns here"* ]]
}

# RS-CONTEXT-3 (Codex sequence-28 mid-flight amendment, Finding B): the
# original single test claimed absent/ambiguous/mismatched/expired coverage
# but only exercised absent/non-owning. Split into one accurately-named
# absent/non-owning regression case plus one explicit case per remaining
# owning-but-invalid state, each reusing this file's own existing real-fixture
# helpers (never a hand-fabricated reservation) and each asserting the SAME
# two things: no authenticated marker, and no generic-bundle fallback either.

@test "RS-CONTEXT-3-ABSENT: no root-source reservation at all for this role is a completely ordinary, lifecycle-unrelated spawn -- pre-existing generic bundle injection is unaffected and never carries the new marker" {
  write_bundle "toolkit-specialist" "$PROBE_WAVE_SLUG"
  _make_subagent_start_input_full "toolkit-specialist" "rs-context-3-absent-session" "rs-context-3-absent-agent"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"additionalContext"'* ]]
  [[ "$output" != *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]
  [[ "$output" == *"Key patterns here"* ]]
}

@test "RS-CONTEXT-3-EXPIRED: a genuinely (wall-clock) expired root-source reservation, owning but invalid, emits no authenticated marker and no generic-bundle fallback" {
  local session_id="rs-context-3-expired-session"
  local agent_id="rs-context-3-expired-agent"
  write_bundle "toolkit-specialist" "$PROBE_WAVE_SLUG"

  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]
  _s16_wait_for_action_expiry "$PROJECT_ROOT" "$action_id"

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"root-source-reservation-expired"* ]]
  [[ "$output" != *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]
  [[ "$output" != *'"additionalContext"'* ]]
}

@test "RS-CONTEXT-3-AMBIGUOUS: two simultaneously live root-source reservations for the same role, owning but invalid, emit no authenticated marker and no generic-bundle fallback" {
  local session_id="rs-context-3-ambiguous-session"
  local agent_id="rs-context-3-ambiguous-agent"
  write_bundle "toolkit-specialist" "$PROBE_WAVE_SLUG"

  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id_a main_binding_id generation_id
  read -r action_id_a main_binding_id generation_id <<< "$output"
  [ -n "$action_id_a" ]
  run _s16_clone_reservation_to_fresh_action_id "$PROJECT_ROOT" "$action_id_a"
  [ "$status" -eq 0 ]
  local action_id_b="$output"
  [ -n "$action_id_b" ]

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"root-source-reservation-ambiguous"* ]]
  [[ "$output" != *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]
  [[ "$output" != *'"additionalContext"'* ]]
}

@test "RS-CONTEXT-3-MALFORMED: a malformed (tampered action_digest), genuinely expired root-source reservation, owning but invalid, emits no authenticated marker and no generic-bundle fallback" {
  local session_id="rs-context-3-malformed-session"
  local agent_id="rs-context-3-malformed-agent"
  write_bundle "toolkit-specialist" "$PROBE_WAVE_SLUG"

  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]
  _s16_wait_for_action_expiry "$PROJECT_ROOT" "$action_id"
  run node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const reservationPath = rll.rootSourceReservationPathFor(process.argv[2], process.argv[3]);
    const reservation = JSON.parse(fs.readFileSync(reservationPath, "utf8"));
    reservation.action_digest = "0".repeat(64);
    fs.writeFileSync(reservationPath, JSON.stringify(reservation));
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$action_id"
  [ "$status" -eq 0 ]

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"root-source-reservation-action-mismatch"* ]]
  [[ "$output" != *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]
  [[ "$output" != *'"additionalContext"'* ]]
}

@test "RS-CONTEXT-4: setup/agent-templates/toolkit-specialist.md and .claude/agents/toolkit-specialist.md remain byte-identical and both declare the narrow authenticated root-source exception" {
  run cmp -s "$BATS_TEST_DIRNAME/../../setup/agent-templates/toolkit-specialist.md" "$BATS_TEST_DIRNAME/../../.claude/agents/toolkit-specialist.md"
  [ "$status" -eq 0 ]
  run grep -l "AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1" "$BATS_TEST_DIRNAME/../../setup/agent-templates/toolkit-specialist.md" "$BATS_TEST_DIRNAME/../../.claude/agents/toolkit-specialist.md"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | wc -l | tr -d ' ')" -eq 2 ]
  run grep -c "never grants authority" "$BATS_TEST_DIRNAME/../../setup/agent-templates/toolkit-specialist.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Sequence 30 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822): RS-ENVELOPE --
# the official Claude Code SubagentStart hook contract (code.claude.com/docs/
# en/hooks) returns additionalContext nested under hookSpecificOutput with
# hookEventName exactly "SubagentStart" -- the same convention this repo's
# own PreToolUse hooks already use for their event. Sequence 28's unit tests
# validated a bare top-level {additionalContext} shape that a real live mint
# (sequence 29) proved is never actually promoted into the receiving model's
# context: the hook ran and stdout was recorded as a transcript attachment,
# but the receiving agent's first turn genuinely had no such block. These
# tests parse the hook's stdout JSON structurally (never substring-only) and
# require the correct nested envelope at both successful-injection sites.
# ══════════════════════════════════════════════════════════════════════════

@test "RS-ENVELOPE-1 ROOT-SOURCE: a real root-source reservation consumed by the real SubagentStart hook returns the official nested hookSpecificOutput envelope, never a bare top-level additionalContext" {
  local session_id="rs-envelope-1-session"
  local agent_id="rs-envelope-1-agent"

  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  local stdout="$output"

  run node -e '
    const body = JSON.parse(process.argv[1]);
    const actionId = process.argv[2];
    if (typeof body.additionalContext !== "undefined") { process.stderr.write("unexpected top-level additionalContext: " + process.argv[1]); process.exit(1); }
    if (!body.hookSpecificOutput || body.hookSpecificOutput.hookEventName !== "SubagentStart") { process.stderr.write("missing/wrong hookSpecificOutput.hookEventName: " + process.argv[1]); process.exit(1); }
    const ctx = body.hookSpecificOutput.additionalContext;
    if (typeof ctx !== "string" || !ctx.startsWith("AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1")) { process.stderr.write("missing/wrong nested marker: " + process.argv[1]); process.exit(1); }
    if (!ctx.includes("action_id=" + actionId)) { process.stderr.write("missing action_id correlation: " + ctx); process.exit(1); }
    if (Object.keys(body).length !== 1) { process.stderr.write("unexpected extra top-level keys: " + process.argv[1]); process.exit(1); }
  ' "$stdout" "$action_id"
  [ "$status" -eq 0 ]
}

@test "RS-ENVELOPE-2 GENERIC: an ordinary non-root-source teammate with a fresh valid generic bundle returns the same official nested envelope, never a bare top-level additionalContext" {
  write_bundle "arch-testing" "$PROBE_WAVE_SLUG"
  _make_subagent_start_input_full "arch-testing" "rs-envelope-2-session" "rs-envelope-2-agent"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
  local stdout="$output"

  run node -e '
    const body = JSON.parse(process.argv[1]);
    if (typeof body.additionalContext !== "undefined") { process.stderr.write("unexpected top-level additionalContext: " + process.argv[1]); process.exit(1); }
    if (!body.hookSpecificOutput || body.hookSpecificOutput.hookEventName !== "SubagentStart") { process.stderr.write("missing/wrong hookSpecificOutput.hookEventName: " + process.argv[1]); process.exit(1); }
    const ctx = body.hookSpecificOutput.additionalContext;
    if (typeof ctx !== "string" || !ctx.includes("Key patterns here")) { process.stderr.write("missing/wrong nested bundle content: " + process.argv[1]); process.exit(1); }
    if (Object.keys(body).length !== 1) { process.stderr.write("unexpected extra top-level keys: " + process.argv[1]); process.exit(1); }
  ' "$stdout"
  [ "$status" -eq 0 ]
}

@test "RS-ENVELOPE-3 FAIL-CLOSED: invalid root-source owning states and absent/stale generic bundles never manufacture hookSpecificOutput.additionalContext" {
  # Owning-but-invalid root-source case: live PLAN.md missing (same fixture as RS-CONTEXT-2).
  local session_id="rs-envelope-3-session"
  local agent_id="rs-envelope-3-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]
  rm -f "$PROJECT_ROOT/.planning/wave-$PROBE_WAVE_SLUG/PLAN.md"
  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [[ "$output" != *'"additionalContext"'* ]]
  [[ "$output" != *"hookSpecificOutput"* ]]

  # Absent bundle for an ordinary, lifecycle-unrelated role: no envelope at all.
  make_input "SubagentStart" "arch-integration"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  # Stale generic bundle: no envelope at all (existing fail-open behavior, stderr-only).
  write_bundle "arch-integration" "bl-w46-old"
  make_input "SubagentStart" "arch-integration"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ══════════════════════════════════════════════════════════════════════════
# Sequence 35 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822) root-source
# RESUME/ISOLATION repair.
#
# ACCEPTED RED EVIDENCE (Codex audit correction 2): the attempt-10 LIVE trace
# -- the first SubagentStart for {session 002bd90f-512e-4453-ba4a-444ff9698191,
# agent af65e5b13be8bdf3a, toolkit-specialist} carried a genuine
# AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1; the repeated SubagentStart for that
# exact identity, after tryConsumeRootSourceReservation() found the
# reservation already consumed, fell through to an unrelated generic M6
# context bundle dated 2026-08-08, and the receiving agent refused the
# continuation for lack of fresh host authentication. These three tests are
# post-fix GREEN regressions pinning that repair; they are NOT the RED.
# ══════════════════════════════════════════════════════════════════════════

# Distinct sentinel content for the generic toolkit-specialist bundle, so a
# regression that falls back to generic content is positively identifiable
# rather than merely "missing the marker".
SEQ35_GENERIC_SENTINEL="SEQ35-GENERIC-BUNDLE-SENTINEL-MUST-NOT-APPEAR"

_seq35_write_generic_toolkit_bundle() {
  mkdir -p "$BUNDLE_DIR"
  printf -- '---\nwave_slug: %s\n---\n# Generic context bundle for toolkit-specialist\n%s\n' \
    "$PROBE_WAVE_SLUG" "$SEQ35_GENERIC_SENTINEL" > "$BUNDLE_DIR/toolkit-specialist.md"
}

# Extracts hookSpecificOutput.additionalContext from a hook stdout body,
# asserting the official nested SubagentStart envelope shape. Prints the
# context on success; exits nonzero (with a diagnostic) on any shape error.
_seq35_extract_authenticated_context() {
  node -e '
    const raw = process.argv[1];
    let body;
    try { body = JSON.parse(raw); } catch { console.error("stdout is not JSON: " + raw); process.exit(1); }
    if (typeof body.additionalContext !== "undefined") { console.error("unexpected top-level additionalContext"); process.exit(1); }
    if (!body.hookSpecificOutput || body.hookSpecificOutput.hookEventName !== "SubagentStart") { console.error("missing/wrong hookSpecificOutput.hookEventName"); process.exit(1); }
    const ctx = body.hookSpecificOutput.additionalContext;
    if (typeof ctx !== "string" || ctx.length === 0) { console.error("missing nested additionalContext"); process.exit(1); }
    process.stdout.write(ctx);
  ' "$1"
}

@test "SEQUENCE35-RESUME-AUTHENTICATED-REGENERATION: a repeated exact-identity SubagentStart, after the reservation is already consumed, re-emits the SAME authenticated root-source dispatch (official nested envelope, exact correlations, byte-identical to the first start) and never the generic bundle" {
  local session_id="seq35-resume-isolation-session"
  local agent_id="seq35-resume-isolation-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]
  [ -n "$generation_id" ]

  # A FRESH, wave-matching generic toolkit-specialist bundle genuinely exists:
  # without it the "no generic fallback" assertions below would pass vacuously.
  _seq35_write_generic_toolkit_bundle

  # Resolve the durable scope the binding must correlate to, straight from the
  # real action record -- never re-derived independently by this test.
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const r = rll.findActionAcrossRepos(process.argv[2]);
    if (!r.ok || r.absent) { process.stderr.write("action not found"); process.exit(1); }
    process.stdout.write(r.action.worktree_id + " " + r.action.plan_digest);
  ' "$RLL_IMPL" "$action_id"
  [ "$status" -eq 0 ]
  local worktree_id plan_digest
  read -r worktree_id plan_digest <<< "$output"
  [ -n "$worktree_id" ]
  [ -n "$plan_digest" ]

  # ── FIRST start: consumes the reservation, mints the root-source binding.
  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  run _seq35_extract_authenticated_context "$output"
  [ "$status" -eq 0 ]
  local first_ctx="$output"
  [[ "$first_ctx" == *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]
  [[ "$first_ctx" != *"$SEQ35_GENERIC_SENTINEL"* ]]

  # ── SECOND start, identical identity: the reservation is now consumed, so
  # authority can only come from the durable binding via the classifier.
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  run _seq35_extract_authenticated_context "$output"
  [ "$status" -eq 0 ]
  local second_ctx="$output"

  [[ "$second_ctx" == *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]
  [[ "$second_ctx" == *"action_id=$action_id"* ]]
  [[ "$second_ctx" == *"role=toolkit-specialist"* ]]
  [[ "$second_ctx" == *"reporting_architect=arch-platform"* ]]
  [[ "$second_ctx" == *"worktree_id=$worktree_id"* ]]
  [[ "$second_ctx" == *"plan_digest=$plan_digest"* ]]
  [[ "$second_ctx" == *"session_generation_id=$generation_id"* ]]
  [[ "$second_ctx" == *"subject_bundle_ref="* ]]
  [[ "$second_ctx" == *"subject_scope_digest="* ]]
  [[ "$second_ctx" == *"scope_doc_path=$PROJECT_ROOT/.planning/"* ]]
  # The generic bundle exists and is wave-fresh, yet must never be injected.
  [[ "$second_ctx" != *"$SEQ35_GENERIC_SENTINEL"* ]]

  # Shared-helper anti-drift: first and repeat renders are byte-identical.
  [ "$first_ctx" = "$second_ctx" ]
}

@test "SEQUENCE35-RESUME-NEGATIVE-FENCED: once the exact actor identity is fenced, a repeated SubagentStart emits NO additionalContext, no authenticated marker and no generic bundle -- fail-closed, never a generic fallback" {
  local session_id="seq35-fenced-session"
  local agent_id="seq35-fenced-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  _seq35_write_generic_toolkit_bundle

  # First start: consumes the reservation and mints the binding.
  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [[ "$output" == *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]

  # Publish the fence for this EXACT identity through the real lifecycle API
  # (the same primitive the production SubagentStop path uses) -- never a
  # hand-written fence file.
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const repoDescriptor = { repoId: rll.computeRepoId(process.argv[2]) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", process.argv[3], process.argv[4]);
    const res = rll.publishClaudeAuthorityFence(repoDescriptor, id);
    if (!res.ok) { process.stderr.write("fence publish failed: " + JSON.stringify(res)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]

  # Repeated start for the fenced identity: fail-closed on every channel.
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [[ "$output" != *'"additionalContext"'* ]]
  [[ "$output" != *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]
  [[ "$output" != *"$SEQ35_GENERIC_SENTINEL"* ]]
}

@test "SEQUENCE35-RESUME-NEGATIVE-MALFORMED-BINDING: when the durable root-source binding is corrupted such that the canonical classifier reports failure, a repeated SubagentStart emits NO additionalContext, no authenticated marker and no generic bundle, and stderr identifies the classifier failure" {
  local session_id="seq35-malformed-session"
  local agent_id="seq35-malformed-agent"
  run _mint_reserved_root_source_via_real_surfaces "$session_id"
  [ "$status" -eq 0 ]
  local action_id main_binding_id generation_id
  read -r action_id main_binding_id generation_id <<< "$output"
  [ -n "$action_id" ]

  _seq35_write_generic_toolkit_bundle

  # First start: consumes the reservation and mints the binding.
  _make_subagent_start_input_full "toolkit-specialist" "$session_id" "$agent_id"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
  [[ "$output" == *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]

  # Corrupt the exact root-source binding this identity owns: locate it via
  # the real classifier, then write a shape the classifier itself rejects
  # (schema/key set no longer valid) at that same record path.
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$PROBE_CAPABILITY" node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    const c = rll.classifyClaudeAuthorityForIdentity(repoDescriptor, {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
      provider: "claude-hook",
      repo_id: repoDescriptor.repoId,
      runtime_session_key: process.argv[3],
      agent_id: process.argv[4],
    });
    if (!c.ok || c.state !== "ONE" || c.family !== "root-source") {
      process.stderr.write("precondition failed, expected ONE/root-source, got " + JSON.stringify({ ok: c.ok, state: c.state, family: c.family }));
      process.exit(1);
    }
    const p = rll.rootSourceBindingPathFor(repoDescriptor, c.binding.binding_id);
    const rec = JSON.parse(fs.readFileSync(p, "utf8"));
    rec.schema = "runtime/root-source-binding/CORRUPTED";
    fs.writeFileSync(p, JSON.stringify(rec), { mode: 0o600 });
  ' "$RLL_IMPL" "$PROJECT_ROOT" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]

  # Repeated start against the corrupted binding: fail-closed on every channel.
  local stderr_file; stderr_file="$(mktemp "$BATS_TEST_TMPDIR/seq35-malformed-stderr.XXXXXX")"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK' 2>'$stderr_file'"
  [ "$status" -eq 0 ]
  [[ "$output" != *'"additionalContext"'* ]]
  [[ "$output" != *"AUTHENTICATED_ROOT_SOURCE_DISPATCH/v1"* ]]
  [[ "$output" != *"$SEQ35_GENERIC_SENTINEL"* ]]

  # Sequence 36 tightening: assert the ACTUAL classifier-failure marker the
  # hook emits, not a weak "classifier OR root-source" substring alternation
  # (which the FENCED branch's own message would also have satisfied).
  local stderr_content; stderr_content="$(cat "$stderr_file")"
  [[ "$stderr_content" == *"root-source resume classifier FAILED"* ]]
  rm -f "$stderr_file"
}
