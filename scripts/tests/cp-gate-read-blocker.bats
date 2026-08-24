#!/usr/bin/env bats
bats_require_minimum_version 1.5.0

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
  # Isolates this file's host-private registry (registryBaseDir() in
  # runtime-role-lifecycle.cjs resolves purely from $TMPDIR + this OS user's
  # uid) under bats' own per-test tmpdir, never the real shared canonical
  # registry -- exported before any node/CLI process starts (including the
  # later _setup_wave_proj() git-repo fixture and any hook/CLI invocation) so
  # every subprocess this test spawns inherits it. Mirrors
  # runtime-consultation-bridge.bats's own isolation. Replaces the previous
  # plain BATS_TMPDIR (suite-scoped) redirect with the fully test-unique
  # BATS_TEST_TMPDIR.
  RUNTIME_TMP="$BATS_TEST_TMPDIR/runtime-tmp"
  mkdir -p "$RUNTIME_TMP"
  chmod 0700 "$RUNTIME_TMP"
  _assert_isolated_runtime_tmp "$RUNTIME_TMP"
  export TMPDIR="$RUNTIME_TMP"
  export SESSION_ID="test-session-$$"
  export FLAG_FILE="${TMPDIR:-/tmp}/claude-cp-consulted-${SESSION_ID}.flag"
  rm -f "$FLAG_FILE"
  # M6/M7 terminal functional closure correction round 1: the bare-invocation
  # tests below (no explicit CLAUDE_PROJECT_DIR in their own `bash -c "..."`)
  # rely on resolvePostPlanContext seeing NO project root, matching
  # context-provider-gate.js's own documented "bare invocation" convention
  # (that file's resolvePostPlanContext doc comment names this exact file's
  # convention explicitly). Left inherited from THIS test process's own
  # environment (set whenever this suite runs the normal way, from inside a
  # Claude Code session already scoped to this checkout), CLAUDE_PROJECT_DIR
  # would resolve this repo's own real, frozen PLAN.md and spuriously require
  # a genuine accepted-consultation these simple flag-only fixtures never
  # plant -- confirmed empirically. Every later test using $PROJ still passes
  # its own explicit CLAUDE_PROJECT_DIR="$PROJ" per invocation, unaffected.
  unset CLAUDE_PROJECT_DIR
  unset CLAUDE_WAVE_SLUG
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
  rm -f "$FLAG_FILE"
  rm -f "${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-"*.flag
  # Wave 2 (portable-coordination-artifacts): guarded cleanup for the isolated
  # git-repo fixture used by the disk-consult adversarial matrix (CP-A..CP-N
  # below). $PROJ is unset for every pre-existing test above — no-op there.
  [ -n "${PROJ:-}" ] && rm -rf "$PROJ"
  true
}

INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/hook-input-$$.json"

make_input() {
  local tool="$1" path="$2" agent="${3:-arch-integration}"
  printf '%s\n' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"$agent\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/context-provider-gate.js"

# ══════════════════════════════════════════════════════════════════════════
# Group C (dispatch arch-testing-20260810T142647Z): semantic allow/deny
# oracle repair. The official PreToolUse contract (code.claude.com/docs/en/
# hooks) is exit 0 always; DENY carries a JSON hookSpecificOutput body with
# permissionDecision:"deny" (never the deprecated exit-2/top-level
# decision:"block" shape this file originally asserted); ALLOW is either a
# silent passthrough (empty stdout -- the CP-consult-flag mechanism this
# whole file exercises, confirmed by direct read of context-provider-gate.js:
# every allow branch it reaches is a bare `process.exit(0)` with no stdout
# write at all) or, on a DIFFERENT surface this file never exercises (the
# M7/WP4 lifecycle/requester-grant injection paths, covered instead by
# context-provider-gate.test.js's LG-*/RQ-* sections), an explicit
# permissionDecision:"allow" + updatedInput.command rewrite. A bare
# `[ "$status" -eq 2 ]` no longer reflects production at all (which now
# always exits 0); a bare `[ "$status" -eq 0 ]` cannot by itself distinguish
# a genuine passthrough from a false-negative (a denial whose JSON body
# happened to still exit 0, which IS how deny is signaled today, so exit
# code alone can no longer discriminate allow from deny either). Every row
# below now asserts the real, distinguishing shape instead.
#
# `--separate-stderr` (bats >=1.5.0, required at the top of this file) keeps
# $output to stdout ONLY -- node's own [CP-GATE] audit-trail stderr writes
# (present on several allow branches, e.g. once an arch-response flag is
# read) would otherwise corrupt a JSON.parse($output) attempt on a row that
# also has stderr content; no row in this file asserts on stderr, so
# discarding it from $output is a pure precision fix, never a behavior
# change.
# ══════════════════════════════════════════════════════════════════════════

# Official PreToolUse deny: exit 0; stdout parses as JSON; hookEventName ==
# "PreToolUse"; permissionDecision == "deny"; a non-empty
# permissionDecisionReason string; and NO top-level legacy "decision" field.
_assert_deny() {
  [ "$status" -eq 0 ]
  node -e '
    let body;
    try {
      body = JSON.parse(process.argv[1]);
    } catch (e) {
      console.error("stdout did not parse as JSON (expected a PreToolUse deny body): " + e.message + " -- raw stdout: " + JSON.stringify(process.argv[1]));
      process.exit(1);
    }
    if (Object.prototype.hasOwnProperty.call(body, "decision")) {
      console.error("deny body must NOT carry the deprecated top-level \"decision\" field: " + JSON.stringify(body));
      process.exit(1);
    }
    if (!body.hookSpecificOutput) {
      console.error("deny body must carry hookSpecificOutput: " + JSON.stringify(body));
      process.exit(1);
    }
    if (body.hookSpecificOutput.hookEventName !== "PreToolUse") {
      console.error("hookEventName must be PreToolUse: " + JSON.stringify(body));
      process.exit(1);
    }
    if (body.hookSpecificOutput.permissionDecision !== "deny") {
      console.error("permissionDecision must be \"deny\": " + JSON.stringify(body));
      process.exit(1);
    }
    if (typeof body.hookSpecificOutput.permissionDecisionReason !== "string" || body.hookSpecificOutput.permissionDecisionReason.length === 0) {
      console.error("permissionDecisionReason must be a non-empty string: " + JSON.stringify(body));
      process.exit(1);
    }
  ' "$output"
}

# Official PreToolUse allow-passthrough: exit 0, stdout completely empty
# (the CP-consult-flag mechanism's own unconditional `process.exit(0)` with
# no write at all) -- distinct from an allow-REWRITE (permissionDecision
# "allow" + updatedInput.command), which this file's own fixtures never
# reach (that surface is main-orchestrator/named-role lifecycle- and
# requester-grant-CLI-invocation-specific, covered by
# context-provider-gate.test.js instead).
_assert_passthrough() {
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "blocks Read of docs pattern file when CP not consulted" {
  make_input Read '/project/docs/di/di-patterns-modules.md'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_deny
}

@test "blocks Read of .claude/agents/ file when CP not consulted" {
  make_input Read '/project/.claude/agents/arch-integration.md'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_deny
}

@test "allows Read of .planning/ file without CP flag" {
  make_input Read '/project/.planning/PLAN-W30.md'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_passthrough
}

@test "allows Read of docs pattern file when CP flag exists" {
  touch "$FLAG_FILE"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_passthrough
}

@test "allows Read of source .kt file without CP flag" {
  make_input Read '/project/src/main/kotlin/Foo.kt'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_passthrough
}

make_specialist_input() {
  local tool="$1" path="$2"
  # M6+M7 requester-authority closure (Group E): mintInternalValidateGrant's
  # own backing RequesterBinding now requires the REAL invoking hook caller's
  # non-empty agent_id (never defaulted/substituted) -- omitting it here
  # (as this fixture previously did) makes callerIdentity fail its own
  # non-empty-string check, failing the internal validate call closed
  # (AUTHORITY_INVALID) for post-PLAN specialist reads, regardless of
  # whether the test's own intent is about something else entirely. Mirrors
  # context-provider-gate.test.js's own runSpecialistPostPlan, which already
  # supplies agent_id: agentType.
  printf '%s\n' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"test-specialist\",\"agent_id\":\"test-specialist\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

make_arch_sendmsg_input() {
  # Simulates an arch→specialist SendMessage for consulted.js
  local to="$1"
  printf '%s\n' "{\"tool_name\":\"SendMessage\",\"tool_input\":{\"to\":\"$to\",\"message\":\"dispatch\"},\"agent_type\":\"arch-testing\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

CONSULTED_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/context-provider-consulted.js"

@test "specialist Read on docs blocked when only global CP flag set (C1 regression)" {
  # Global CP flag set (as if planner contacted CP) but no arch-response flag
  touch "$FLAG_FILE"
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_deny
}

@test "specialist Read on docs allowed when arch-response flag set (C1 happy path)" {
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  touch "$arch_flag"
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_passthrough
  rm -f "$arch_flag"
}

# NOTE (Group C scope): the two tests below exercise context-provider-consulted.js
# -- a DIFFERENT hook (the flag WRITER, triggered on an arch→specialist
# SendMessage) -- never the PreToolUse gate (context-provider-gate.js, the
# flag READER) this file's own deny/passthrough semantic helpers above are
# about. Their own contract is "did the writer hook complete and leave the
# correct side-effect flag file behind", which the existing
# `[ -f "$arch_flag" ]` / `[ ! -f "$arch_flag" ]` assertions already prove --
# strictly stronger than a bare exit-code check, and unrelated to the
# PreToolUse allow/deny protocol. Applying _assert_deny/_assert_passthrough
# here would be a category error (this hook never emits that shape at all),
# so these two rows are intentionally left using the plain exit-0 idiom.
@test "consulted hook writes arch-response flag on arch→specialist SendMessage" {
  make_arch_sendmsg_input 'test-specialist'
  run bash -c "cat '$INPUT_FILE' | node '$CONSULTED_HOOK'"
  [ "$status" -eq 0 ]
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  [ -f "$arch_flag" ]
  rm -f "$arch_flag"
}

@test "consulted hook does NOT write arch-response flag on planner→CP SendMessage" {
  printf '%s\n' "{\"tool_name\":\"SendMessage\",\"tool_input\":{\"to\":\"context-provider\",\"message\":\"query\"},\"agent_type\":\"planner\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
  run bash -c "cat '$INPUT_FILE' | node '$CONSULTED_HOOK'"
  [ "$status" -eq 0 ]
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-context-provider.flag"
  [ ! -f "$arch_flag" ]
}

@test "specialist Read on own template file blocked regardless of flags (C2)" {
  touch "$FLAG_FILE"
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  touch "$arch_flag"
  make_specialist_input Read '/project/setup/agent-templates/test-specialist.md'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_deny
  rm -f "$arch_flag"
}

@test "CLAUDE_CP_GATE_DISABLED=1 allows any specialist search (emergency bypass)" {
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  run --separate-stderr env CLAUDE_CP_GATE_DISABLED=1 bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_passthrough
}

@test "non-specialist arch agent Read still uses global CP flag (no regression)" {
  touch "$FLAG_FILE"
  make_input Read '/project/docs/di/di-patterns-modules.md' 'arch-integration'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_passthrough
}

# ── D12: main orchestrator exemption (empty agent_type) ───────────────────────
# Empty agent_type means the main orchestrator — always exempt regardless of path
# or CP flag state (line 44 of gate: if (agentType === '') process.exit(0)).

make_main_input() {
  local tool="$1" path="$2"
  printf '%s\n' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

@test "D12: main (empty agent_type) reading CLAUDE.md is always exempt" {
  # No CP flag set — main must still exit 0 via the empty-agent_type shortcut.
  make_main_input Read '/project/CLAUDE.md'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_passthrough
}

@test "D12: main (empty agent_type) reading tl-session-start.md is always exempt" {
  make_main_input Read '/project/docs/guides/tl-session-start.md'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_passthrough
}

# ── D12: Grep/Glob doc-path boundary — no trailing separator required ─────────
# Regex fix: /[/\\]docs([/\\]|$)/ — matches /foo/docs with no trailing slash.

make_grep_input() {
  local search_path="$1" agent="${2:-arch-integration}"
  printf '%s\n' "{\"tool_name\":\"Grep\",\"tool_input\":{\"path\":\"$search_path\"},\"agent_type\":\"$agent\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

@test "D12: Grep on /foo/docs (no trailing sep) blocked without CP flag" {
  # No CP flag — docs boundary regex must catch /foo/docs via ($) anchor.
  make_grep_input '/foo/docs'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_deny
}

@test "D12: Grep on /foo/docs/ (trailing sep) still blocked without CP flag (regression)" {
  make_grep_input '/foo/docs/'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_deny
}

# ── D12: specialist without arch-response flag regression guard ───────────────

@test "D12: toolkit-specialist Grep on docs blocked without arch-response flag (regression)" {
  # No flags set — specialist must be blocked even without an active CP flag.
  make_grep_input '/project/docs/testing/testing-patterns.md' 'toolkit-specialist'
  run --separate-stderr bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  _assert_deny
}

# ══════════════════════════════════════════════════════════════════════════
# Wave 2 (portable-coordination-artifacts): disk-consult adversarial matrix
# A-N (PLAN.md "CP-gate adversarial matrix" + arch-testing dispatch rows K/N).
#
# Additive OR-branch under test: allowed = <existing SendMessage session-flag>
# || coordinationArtifact.hasValidConsult(<wave>/inbox/context-provider, {slug}).
# Rows A/I prove the ORIGINAL path stays untouched; the rest exercise the NEW
# disk-consult branch. Row M (approval->request linkage) is validator-only —
# the CP-gate's disk branch only ever reads consult/v1, never approval/v1 — so
# M lives entirely in coordination-artifact-validation.bats, not repeated here.
#
# Isolation (mirrors slug-resolution-matrix.bats): mktemp -d + throwaway git
# init, CLAUDE_PROJECT_DIR + CLAUDE_WAVE_SLUG always explicit per invocation —
# NEVER touches the live .planning/wave-portable-coordination-artifacts/.
# teardown() above gained one guarded `rm -rf "$PROJ"` line; the pre-existing
# setup()/teardown() semantics for every test above this marker are otherwise
# unchanged.
# ══════════════════════════════════════════════════════════════════════════

CONSULT_WAVE_SLUG="cp-gate-consult-wave"
VALIDATOR="$BATS_TEST_DIRNAME/../../.claude/hooks/coordination-artifact.js"
RLL_IMPL_FOR_CHAIN="$BATS_TEST_DIRNAME/../lib/runtime-role-lifecycle.cjs"
RC_IMPL_FOR_CHAIN="$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
# Single source of truth (arch-testing/team-lead ratified): read constants via
# `node coordination-artifact.js const <NAME>` rather than hardcoding a duplicate
# that could drift from the validator's own values.
CONSULT_TTL_SECONDS="$(node "$VALIDATOR" const CONSULT_TTL_SECONDS)"
MAX_CONSULT_HARD_CAP="$(node "$VALIDATOR" const MAX_CONSULT_HARD_CAP)"
MAX_CONSULT_ENTRIES="$(node "$VALIDATOR" const MAX_CONSULT_ENTRIES)"
MAX_CONSULT_BYTES="$(node "$VALIDATOR" const MAX_CONSULT_BYTES)"

_setup_wave_proj() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
  PROJ_REGISTRY_DIR="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL_IMPL_FOR_CHAIN" "$PROJ")"
  # Deterministic protected default branch regardless of the host's
  # init.defaultBranch config — row N's "no wave" control needs this fixed.
  git -C "$PROJ" branch -m main 2>/dev/null || true
}

_consult_dir() {
  printf '%s' "$PROJ/.planning/wave-$CONSULT_WAVE_SLUG/inbox/context-provider"
}

_now_iso()     { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
_now_compact() { date -u '+%Y%m%dT%H%M%SZ'; }

# Portable "N hours ago" — GNU -d first, BSD/macOS -v fallback (mirrors the
# sha256sum||shasum idiom used throughout scripts/sh/*.sh in this repo).
_hours_ago_iso() {
  local n="$1"
  date -u -d "-${n} hours" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-"${n}"H '+%Y-%m-%dT%H:%M:%SZ'
}

# Portable "N seconds from now" — same GNU/BSD fallback shape as _hours_ago_iso,
# used for the directional-TTL future-skew E-future row below.
_seconds_from_now_iso() {
  local n="$1"
  date -u -d "+${n} seconds" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+"${n}"S '+%Y-%m-%dT%H:%M:%SZ'
}

# _write_consult <dir> <fname> <wave_slug> <to> <created_at>
_write_consult() {
  local dir="$1" fname="$2" wave_slug="$3" to="$4" created_at="$5"
  mkdir -p "$dir"
  printf '{"schema":"coordination/consult/v1","wave_slug":"%s","from":"test-specialist","to":"%s","created_at":"%s"}\n' \
    "$wave_slug" "$to" "$created_at" > "$dir/$fname"
}

# _write_oversized_file <path> <size_bytes> — byte-exact filler (python3, already
# a hard dependency of this wave's writer — see write-coordination-artifact.bats).
_write_oversized_file() {
  python3 -c "import sys; open(sys.argv[1], 'wb').write(b'0' * int(sys.argv[2]))" "$1" "$2"
}

make_specialist_grep_input() {
  local search_path="$1"
  printf '%s\n' "{\"tool_name\":\"Grep\",\"tool_input\":{\"path\":\"$search_path\"},\"agent_type\":\"test-specialist\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

# _run_hook_env <extra_env_assignments> — always unsets ambient CLAUDE_WAVE_SLUG
# first so every row controls slug resolution explicitly (row N relies on this).
# --separate-stderr (Group C): keeps $output to stdout only, so a row that
# reaches an audit-trail stderr write on its way to a deny/passthrough
# outcome never corrupts the JSON parse the semantic helpers perform.
_run_hook_env() {
  local extra_env="$1"
  run --separate-stderr bash -c "unset CLAUDE_WAVE_SLUG; cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJ' $extra_env node '$HOOK'"
}

# ── Row A: SendMessage session flag present -> exit 0 (existing path preserved, wave fixture active) ──

@test "CP-A-read: session flag present with an active wave fixture -> exit 0 (no regression from the new branch)" {
  _setup_wave_proj
  touch "$FLAG_FILE"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_passthrough
}

@test "CP-A-grep: session flag present with an active wave fixture -> exit 0 (no regression from the new branch)" {
  _setup_wave_proj
  touch "$FLAG_FILE"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_passthrough
}

# ── Row B: no flag; valid fresh consult-*.json for current wave -> exit 0 (NEW disk unblock) ──

@test "CP-B-read: no session flag; valid fresh consult-*.json -> exit 0 (NEW disk unblock)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_passthrough
}

@test "CP-B-grep: no session flag; valid fresh consult-*.json -> exit 0 (NEW disk unblock)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_passthrough
}

# ── Row C: no flag, no artifact -> exit 2 (block preserved) ──

@test "CP-C-read: no session flag, empty consult inbox -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-C-grep: no session flag, empty consult inbox -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

# ── Row D: artifact w/ wrong wave_slug -> exit 2 (fail-closed) ──

@test "CP-D-read: consult artifact stamped for a DIFFERENT wave_slug -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "some-other-wave" "context-provider" "$(_now_iso)"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-D-grep: consult artifact stamped for a DIFFERENT wave_slug -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "some-other-wave" "context-provider" "$(_now_iso)"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

# ── Row E: artifact w/ created_at beyond CONSULT_TTL_SECONDS -> exit 2 (stale) ──

@test "CP-E-read: consult artifact created_at beyond CONSULT_TTL_SECONDS -> exit 2 (stale, fail-closed)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_hours_ago_iso 13)"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-E-grep: consult artifact created_at beyond CONSULT_TTL_SECONDS -> exit 2 (stale, fail-closed)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_hours_ago_iso 13)"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

# ── Row E-future: consult artifact created_at far in the FUTURE -> exit 2 (directional
# TTL, team-lead / STOP-9 hardening: valid window is [now-CONSULT_TTL_SECONDS,
# now+MAX_CONSULT_FUTURE_SKEW_SECONDS], not a symmetric window). now+TTL+margin is
# unambiguously beyond the much-smaller future-skew allowance regardless of its exact
# configured value — distinct from row E above, which is the PAST-side bound.

@test "CP-Efuture-read: consult artifact created_at far in the future (beyond the skew allowance) -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$((CONSULT_TTL_SECONDS + 60))")"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-Efuture-grep: consult artifact created_at far in the future (beyond the skew allowance) -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$((CONSULT_TTL_SECONDS + 60))")"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

# ── Row E-regression: the DISCRIMINATING case (toolkit-specialist's own before/after
# repro) — created_at within the OLD symmetric TTL window (comfortably < TTL) but
# beyond the NEW directional skew (comfortably > skew). CP-Efuture above (now+TTL+
# margin) would ALSO have been rejected under the OLD Math.abs() check, so it can't
# prove the fix alone; this is the value that was WRONGLY valid pre-fix and is the
# actual /security-review finding being closed.

@test "CP-Eregression-read: consult artifact created_at halfway into the TTL window, in the future -> exit 2 (would have wrongly passed pre-fix)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$((CONSULT_TTL_SECONDS / 2))")"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-Eregression-grep: consult artifact created_at halfway into the TTL window, in the future -> exit 2 (would have wrongly passed pre-fix)" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$((CONSULT_TTL_SECONDS / 2))")"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

# ── Row F: artifact w/ wrong `to` (not context-provider) -> exit 2 (fail-closed) ──

@test "CP-F-read: consult artifact addressed to a role other than context-provider -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "arch-testing" "$(_now_iso)"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-F-grep: consult artifact addressed to a role other than context-provider -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "arch-testing" "$(_now_iso)"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

# ── Row G: malformed/empty/non-JSON artifact -> exit 2 (fail-closed, NOT fail-open) ──

@test "CP-G-read: non-JSON consult candidate (only candidate) -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  printf 'not valid json at all' > "$(_consult_dir)/consult-$(_now_compact).json"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-G-grep: non-JSON consult candidate (only candidate) -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  printf 'not valid json at all' > "$(_consult_dir)/consult-$(_now_compact).json"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-G2-read: empty consult candidate (only candidate) -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  : > "$(_consult_dir)/consult-$(_now_compact).json"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-G2-grep: empty consult candidate (only candidate) -> exit 2" {
  _setup_wave_proj
  mkdir -p "$(_consult_dir)"
  : > "$(_consult_dir)/consult-$(_now_compact).json"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

# ── Row H: symlink-escape consult candidate resolving outside the confined inbox dir -> exit 2 ──
# (Slug-level traversal, e.g. CLAUDE_WAVE_SLUG=../evil, is already proven closed
# upstream at the shared getWaveSlug()/get_wave_slug() layer — see
# slug-resolution-matrix.bats "SRM-TRAVERSAL"; not re-tested here.)

@test "CP-H-read: symlink-escape consult candidate resolving outside the confined inbox dir -> exit 2" {
  _setup_wave_proj
  local outside_dir="$PROJ/outside-escape"
  mkdir -p "$outside_dir" "$(_consult_dir)"
  _write_consult "$outside_dir" "evil.json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  ln -s "$outside_dir/evil.json" "$(_consult_dir)/consult-$(_now_compact).json"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-H-grep: symlink-escape consult candidate resolving outside the confined inbox dir -> exit 2" {
  _setup_wave_proj
  local outside_dir="$PROJ/outside-escape"
  mkdir -p "$outside_dir" "$(_consult_dir)"
  _write_consult "$outside_dir" "evil.json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  ln -s "$outside_dir/evil.json" "$(_consult_dir)/consult-$(_now_compact).json"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

# ── Row I: specialist + valid disk consult but NO arch-responded flag -> exit 2 (specialist gating NOT bypassed) ──

@test "CP-I-read: test-specialist with a valid disk consult but no arch-responded flag -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-I-grep: test-specialist with a valid disk consult but no arch-responded flag -> exit 2" {
  _setup_wave_proj
  _write_consult "$(_consult_dir)" "consult-$(_now_compact).json" "$CONSULT_WAVE_SLUG" "context-provider" "$(_now_iso)"
  make_specialist_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

# ── Row J: many-file consult dir (300 valid+invalid) -> exit 0, deterministic newest-valid selection ──
# The lexicographically-NEWEST file (highest seq) is deliberately INVALID (wrong wave),
# forcing the scan to fall through past it. The ONE true positive's position is DERIVED
# (Codex/PR#236 hardening — was a hardcoded "150" magic number) from MAX_CONSULT_ENTRIES
# rather than an arbitrary constant: it sits at half of MAX_CONSULT_ENTRIES ranks back
# from the newest file, which is comfortably inside the retained top-N collection window
# (with margin on both sides) for any sane MAX_CONSULT_ENTRIES value, and proves the
# selection isn't "just grab whatever opendir returns first" / doesn't depend on
# directory iteration order.

_populate_many_consult_files() {
  local dir="$1" total="$2"
  mkdir -p "$dir"
  local max_val=$((total - 1))
  local width=${#max_val}
  local rank_from_newest=$((MAX_CONSULT_ENTRIES / 2))
  local valid_seq
  printf -v valid_seq "%0${width}d" "$((max_val - rank_from_newest))"
  local n fresh
  fresh="$(_now_iso)"
  for n in $(seq -w 0 "$max_val"); do
    if [ "$n" = "$valid_seq" ]; then
      _write_consult "$dir" "consult-20260101T000${n}Z.json" "$CONSULT_WAVE_SLUG" "context-provider" "$fresh"
    else
      _write_consult "$dir" "consult-20260101T000${n}Z.json" "wrong-wave-noise" "context-provider" "$fresh"
    fi
  done
}

@test "CP-J-read: 300-file consult dir, newest file deliberately invalid -> exit 0 (deterministic fallback, in-budget)" {
  _setup_wave_proj
  _populate_many_consult_files "$(_consult_dir)" 300
  make_input Read '/project/docs/di/di-patterns-modules.md'
  SECONDS=0
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_passthrough
  [ "$SECONDS" -le 3 ]
}

@test "CP-J-grep: 300-file consult dir, newest file deliberately invalid -> exit 0 (deterministic fallback, in-budget)" {
  _setup_wave_proj
  _populate_many_consult_files "$(_consult_dir)" 300
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  SECONDS=0
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_passthrough
  [ "$SECONDS" -le 3 ]
}

# ── Row K: consult dir over MAX_CONSULT_HARD_CAP -> exit 2 (DoS fail-closed) ──
# REQUIRED construction (arch-testing, ratified by team-lead + confirmed against the
# real toolkit implementation): EVERY entry over the hard cap is a genuinely VALID
# consult-*.json (not tiny/padding junk) — i.e. any single one of them would unblock
# (exit 0) if the scan ever reached/selected it. This is order-independent and airtight
# regardless of opendir/readSync iteration order: the confirmed real behavior is an
# UNCONDITIONAL `return false` the moment total-entries-scanned exceeds the cap — it
# never falls through to validate whatever it already collected. If a regression ever
# removed that early abort (falling through to "sort collected candidates, validate
# newest-first" instead), it WOULD find a valid one among the up-to-MAX_CONSULT_ENTRIES
# it gathered and incorrectly return exit 0 — so a genuine deny here is the primary,
# discriminating proof, not just an incidental exit-code check. Files are realistically
# sized (not maximally tiny) as a supplementary signal: the wall-clock assertion stays
# as a backstop, though the deny shape is what actually catches a missing early-stop.

_populate_all_valid_over_cap() {
  local dir="$1" count="$2"
  mkdir -p "$dir"
  local fresh; fresh="$(_now_iso)"
  # Pure-bash padding (no per-file subprocess spawn across ~1000+ files): printf's
  # field-width trick produces N spaces, translated to a filler character.
  local padding; printf -v padding '%*s' 4096 ''; padding="${padding// /x}"
  local n
  for n in $(seq -w 0 "$((count - 1))"); do
    printf '{"schema":"coordination/consult/v1","wave_slug":"%s","from":"test-specialist","to":"context-provider","created_at":"%s","padding":"%s"}\n' \
      "$CONSULT_WAVE_SLUG" "$fresh" "$padding" > "$dir/consult-20260101T0${n}Z.json"
  done
}

@test "CP-K-read: ALL entries over MAX_CONSULT_HARD_CAP are genuinely valid consult files -> exit 2 anyway (hard-cap overrides unconditionally, order-independent)" {
  _setup_wave_proj
  local dir; dir="$(_consult_dir)"
  _populate_all_valid_over_cap "$dir" "$((MAX_CONSULT_HARD_CAP + 6))"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  SECONDS=0
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
  [ "$SECONDS" -le 3 ]
}

@test "CP-K-grep: ALL entries over MAX_CONSULT_HARD_CAP are genuinely valid consult files -> exit 2 anyway (hard-cap overrides unconditionally, order-independent)" {
  _setup_wave_proj
  local dir; dir="$(_consult_dir)"
  _populate_all_valid_over_cap "$dir" "$((MAX_CONSULT_HARD_CAP + 6))"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  SECONDS=0
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
  [ "$SECONDS" -le 3 ]
}

# ── Row L: single oversized consult candidate (> MAX_CONSULT_BYTES), only candidate -> exit 2 ──

@test "CP-L-read: single consult candidate exceeding MAX_CONSULT_BYTES -> exit 2 (skipped-as-invalid, no fallback candidate)" {
  _setup_wave_proj
  local dir; dir="$(_consult_dir)"
  mkdir -p "$dir"
  _write_oversized_file "$dir/consult-$(_now_compact).json" "$((MAX_CONSULT_BYTES + 1))"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

@test "CP-L-grep: single consult candidate exceeding MAX_CONSULT_BYTES -> exit 2 (skipped-as-invalid, no fallback candidate)" {
  _setup_wave_proj
  local dir; dir="$(_consult_dir)"
  mkdir -p "$dir"
  _write_oversized_file "$dir/consult-$(_now_compact).json" "$((MAX_CONSULT_BYTES + 1))"
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
}

# Row M (approval/v1 referencing a missing/invalid request) is validator-only —
# the CP-gate's disk-consult branch never reads approval/v1. See the
# approval-linkage tests in coordination-artifact-validation.bats.

# ── Row N: unresolvable/null wave slug -> exit 2, NOT fail-open (distinct code path from row D) ──
# Row D exercises "slug resolves, but the artifact names a DIFFERENT wave" (a
# string mismatch). Row N exercises "slug does not resolve AT ALL" (getWaveSlug
# returns null — no env, no non-protected branch, no single wave-*/PLAN.md
# alias). These are different branches in the gate's own slug handling; a gate
# that only guards against wrong-non-null-slug could still fail open on null.

@test "CP-N-read: unresolvable/null wave slug (no env override, protected branch, no wave dir) -> exit 2" {
  _setup_wave_proj
  make_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env ""
  _assert_deny
}

@test "CP-N-grep: unresolvable/null wave slug (no env override, protected branch, no wave dir) -> exit 2" {
  _setup_wave_proj
  make_grep_input '/project/docs/di/di-patterns-modules.md'
  _run_hook_env ""
  _assert_deny
}

# ══════════════════════════════════════════════════════════════════════════
# M6 Block C + M7/WP4 dependency closure (dispatch arch-testing-20260808T142647Z,
# Section 3): post-PLAN accepted-result fail-closed read/gate regression,
# including disabled-override rejection. Native bats idiom for the SAME
# proposed coordination/consult-result/v1 fixture + architect arch-response-
# flag correlation this suite's sibling context-provider-gate.test.js
# establishes in detail (PP1-PP16) -- this block is the bats-native
# complement named explicitly by the dispatch for THIS file, not a
# duplicate of that coverage.
# ══════════════════════════════════════════════════════════════════════════

_sha256_of_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

_write_postplan_fixture_plan() {
  mkdir -p "$PROJ/.planning/wave-$CONSULT_WAVE_SLUG"
  printf '# fixture PLAN for post-PLAN CP-gate bats coverage\n' > "$PROJ/.planning/wave-$CONSULT_WAVE_SLUG/PLAN.md"
  _sha256_of_file "$PROJ/.planning/wave-$CONSULT_WAVE_SLUG/PLAN.md"
}

_write_consult_result() {
  local dir="$1" to="$2" architect_instance_id="$3" plan_sha256="$4" subject="$5" accepted="${6:-true}"
  mkdir -p "$dir"
  printf '{"schema":"coordination/consult-result/v1","wave_slug":"%s","from":"context-provider","to":"%s","architect_instance_id":"%s","plan_sha256":"%s","subject":"%s","accepted":%s,"created_at":"%s"}\n' \
    "$CONSULT_WAVE_SLUG" "$to" "$architect_instance_id" "$plan_sha256" "$subject" "$accepted" "$(_now_iso)" > "$dir/consult-result-$(_now_compact).json"
}

# _write_canonical_accepted_consultation <proj> <wave_slug> <plan_sha256> <role> [with_accepted:true|false]
# M6+M7 requester-authority closure (Group G, 2026-08-10): bats-native mirror
# of context-provider-gate.test.js's own buildCanonicalAcceptedConsultation --
# a REAL, durable consult/v2 -> result/v2 chain (accepted-result.json included
# only when the 5th arg is "true", the default) under
# transactions/<request_id>/ within this exact PLAN coordination root -- the
# EXACT chain hasCurrentAcceptedConsultation/isAcceptedConsultationTransactionValid
# scans for. Never the old self-asserted coordination/consult-result/v1 shape
# (_write_consult_result above), which the current canonical-chain mechanism
# no longer reads at all.
_write_canonical_accepted_consultation() {
  local proj="$1" wave_slug="$2" plan_sha256="$3" role="$4" with_accepted="${5:-true}"
  node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const proj = process.argv[3];
    const waveSlug = process.argv[4];
    const planSha256 = process.argv[5];
    const role = process.argv[6];
    const withAccepted = process.argv[7] === "true";

    const coordRoot = path.join(proj, ".planning", "coordination");
    const repoId = rll.computeRepoId(proj);
    const worktreeId = rll.computeWorktreeId(proj);
    const coordRootId = rc.sha256String(rc.realpathOrSelf(coordRoot));
    const subjectHead = rc.gitRevParse(proj, ["rev-parse", "HEAD"]);
    const targetRoleProfileDigest = rll.roleProfileDigestFor("context-provider");

    const requestId = crypto.randomBytes(32).toString("hex");
    const attemptId = crypto.randomBytes(32).toString("hex");
    // M6+M7 requester-authority closure (Group G fix): requester_instance_id
    // must be a REAL RequesterBinding actor_instance_id -- resolveArchitectRequesterBinding
    // scans requester-bindings/ for a live match, so a fabricated random hex
    // value here (the old shape) can never resolve. "arch-testing-instance-1"
    // matches the agent_id literal both PP-BATS-2/PP-BATS-3 own arch_flag
    // printf already carries, so architectIdentityFromFlagMeta resolved
    // instanceId lines up with this binding own agent_key.
    const openerIdentity = { ok: true, provider: "claude-hook", runtime_session_key: "cp-gate-read-blocker-canonical-chain-opener-session" };
    const openerAgentId = "arch-testing-instance-1";
    // Prime the genuine generation-scoped CLAUDE-ID-01 capability the
    // production RequesterBinding constructor now requires. Two distinct,
    // live role-spawn actions prove the primary sequence and the same-role
    // peer observation; no fixture bypasses the production gate.
    const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, "Z");
    function primeCapability(identity, primaryAgentId, proofRole, labelPrefix) {
      const generation = rll.resolveSessionGeneration(proj, identity);
      if (!generation.ok) throw new Error(labelPrefix + " fixture generation failed: " + JSON.stringify(generation));
      function mintProbeAction(label) {
        const actionId = rll.generateActionId();
        const minted = rll.mintRoleLifecycleAction(
          proj, actionId, "role-spawn", "claude-native", repoId, worktreeId,
          planSha256, rc.sha256String("cp-gate-read-blocker-id01:" + labelPrefix + ":" + label),
          generation.generationId, proofRole,
          rll.buildRoleSpawnPayload("claude-id01-probe", proofRole, proofRole, "fixture", "fixture"),
          expiry,
        );
        if (!minted.ok) throw new Error(labelPrefix + " probe action failed: " + JSON.stringify(minted));
        return actionId;
      }
      const primaryAction = mintProbeAction("primary");
      const peerAction = mintProbeAction("peer");
      rll.recordClaudeId01SubagentStartObservation(proj, { sessionId: identity.runtime_session_key, agentId: primaryAgentId, agentType: proofRole, actionId: primaryAction });
      rll.recordClaudeId01PreToolUseObservation(proj, { sessionId: identity.runtime_session_key, agentId: primaryAgentId, agentType: proofRole, toolUseId: labelPrefix + "-before-1" });
      rll.recordClaudeId01PreToolUseObservation(proj, { sessionId: identity.runtime_session_key, agentId: primaryAgentId, agentType: proofRole, toolUseId: labelPrefix + "-before-2" });
      rll.recordClaudeId01SubagentStartObservation(proj, { sessionId: identity.runtime_session_key, agentId: primaryAgentId, agentType: proofRole, actionId: primaryAction });
      rll.recordClaudeId01PreToolUseObservation(proj, { sessionId: identity.runtime_session_key, agentId: primaryAgentId, agentType: proofRole, toolUseId: labelPrefix + "-after-1" });
      rll.recordClaudeId01SubagentStartObservation(proj, { sessionId: identity.runtime_session_key, agentId: primaryAgentId + "-peer", agentType: proofRole, actionId: peerAction });
      const capability = rll.checkClaudeId01RuntimeCapability(proj, identity.runtime_session_key, worktreeId, planSha256);
      if (!capability.ok) throw new Error(labelPrefix + " CLAUDE-ID-01 capability failed: " + JSON.stringify(capability));
    }
    primeCapability(openerIdentity, openerAgentId, role, "cp-bats-opener");
    // The hook mints its internal validate grant from the CURRENT specialist
    // event, which is a distinct session/actor from the reporting architect.
    // Prime that exact observed caller too; otherwise the canonical chain is
    // valid but the validation grant correctly fails closed.
    primeCapability(
      { ok: true, provider: "claude-hook", runtime_session_key: process.env.SESSION_ID },
      "test-specialist", "test-specialist", "cp-bats-caller",
    );
    const openerBindingResult = rll.createRequesterBinding(proj, openerIdentity, openerAgentId, role, worktreeId, planSha256, 3600);
    if (!openerBindingResult.ok) {
      throw new Error("_write_canonical_accepted_consultation: opener requester binding mint must succeed: " + JSON.stringify(openerBindingResult));
    }
    const requesterInstanceId = openerBindingResult.binding.actor_instance_id;
    const txnDir = path.join(coordRoot, repoId, waveSlug, planSha256, "transactions", requestId);

    const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const isoPlus = (base, s) => new Date(new Date(base).getTime() + s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const createdAt = nowIso();
    const routingPolicyDigest = rc.sha256String("cp-gate-read-blocker-fixture-routing-policy-v1");
    const subjectScopeDigest = crypto.randomBytes(32).toString("hex");

    function writeDurable(p, obj) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, rc.canonicalJSONStringify(obj), { mode: 0o600 });
      fs.chmodSync(p, 0o600);
    }

    const requestObj = {
      schema: "coordination/consult/v2", request_id: requestId, root_request_id: requestId, parent_request_id: null,
      depth: 0, max_depth: 2, source_role: role, target_role: "context-provider", target_role_profile_version: "1.0.0",
      target_role_profile_digest: targetRoleProfileDigest, requester_worktree_id: worktreeId, requester_instance_id: requesterInstanceId,
      repo_id: repoId, wave_slug: waveSlug, protocol_profile: "runtime-consultation/v1", coordination_root_id: coordRootId,
      plan_digest: planSha256, subject_repo_id: repoId, subject_worktree_id: worktreeId, subject_head: subjectHead,
      subject_scope_digest: subjectScopeDigest, created_at: createdAt, question: "cp-gate-read-blocker canonical-chain fixture question",
      expected_result_kind: "TEST_RESULT", expiry: isoPlus(createdAt, 1800), recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1", routing_policy_digest: routingPolicyDigest,
      initial_attempt_id: attemptId, initial_lease_epoch: 0,
    };
    const requestPath = path.join(txnDir, "request.json");
    writeDurable(requestPath, requestObj);
    const requestDigest = rc.sha256File(requestPath);

    const resultObj = {
      schema: "coordination/result/v2", in_reply_to: requestId, request_digest: requestDigest, plan_digest: planSha256,
      repo_id: repoId, wave_slug: waveSlug, protocol_profile: "runtime-consultation/v1", max_depth: 2,
      routing_policy_version: "runtime-routing/v1", routing_policy_digest: routingPolicyDigest, root_request_id: requestId,
      parent_request_id: null, depth: 0, attempt_id: attemptId, lease_epoch: 0, driver: "noop",
      claimant_instance_id: crypto.randomBytes(32).toString("hex"), worker_session_id: null, claim_digest: "a".repeat(64),
      target_role_profile_version: "1.0.0", target_role_profile_digest: targetRoleProfileDigest, from_role: "context-provider",
      to_role: role, result_kind: "TEST_RESULT", status: "ANSWERED", reason: null, content: "cp-gate-read-blocker canonical-chain fixture answer",
      subject_repo_id: repoId, subject_worktree_id: worktreeId, subject_head: subjectHead, subject_scope_digest: subjectScopeDigest,
      consultation_dependencies: [], producer_worktree_id: worktreeId, producer_head: subjectHead, created_at: isoPlus(createdAt, 5),
      pattern_evidence_dependency: null,
    };
    const resultPath = path.join(txnDir, "results", attemptId + ".json");
    writeDurable(resultPath, resultObj);
    const resultDigest = rc.sha256File(resultPath);

    if (withAccepted) {
      const acceptedObj = {
        schema: "coordination/accepted-result/v1", schema_version: 1, accepted_at: isoPlus(createdAt, 10),
        accepted_attempt_id: attemptId, accepted_lease_epoch: 0, candidate_result_path: "results/" + attemptId + ".json",
        request_digest: requestDigest, requester_instance_id: requesterInstanceId, result_digest: resultDigest, routing_policy_digest: routingPolicyDigest,
      };
      const acceptedPath = path.join(txnDir, "accepted-result.json");
      writeDurable(acceptedPath, acceptedObj);
    }
  ' "$RLL_IMPL_FOR_CHAIN" "$RC_IMPL_FOR_CHAIN" "$proj" "$wave_slug" "$plan_sha256" "$role" "$with_accepted"
}

@test "PP-BATS-1 BLOCK: post-PLAN, specialist arch-response flag present but NO consult-result at all -> exit 2 (message/candidate-only)" {
  _setup_wave_proj
  _write_postplan_fixture_plan >/dev/null
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  printf '{"written_by":"context-provider-consulted","agent_id":"arch-testing-instance-1","architect_role":"arch-testing","session_id":"cp-gate-read-blocker-canonical-chain-opener-session"}' > "$arch_flag"
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
  rm -f "$arch_flag"
}

@test "PP-BATS-2 PASS: post-PLAN, specialist arch-response flag PLUS a REAL canonical consult/v2 -> result/v2 -> accepted-result.json chain for the exact correlated architect/PLAN -> exit 0" {
  _setup_wave_proj
  local plan_sha256; plan_sha256="$(_write_postplan_fixture_plan)"
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  printf '{"written_by":"context-provider-consulted","agent_id":"arch-testing-instance-1","architect_role":"arch-testing","session_id":"cp-gate-read-blocker-canonical-chain-opener-session"}' > "$arch_flag"
  # Group G (M6+M7 requester-authority closure, 2026-08-10): the canonical
  # consult/v2 -> result/v2 -> accepted-result.json chain -- never the OLD
  # self-asserted coordination/consult-result/v1 shape
  # (_write_consult_result), which hasCurrentAcceptedConsultation no longer
  # reads at all post-PLAN (it only ever scans transactions/<request_id>/
  # under this exact PLAN's coordination root). Mirrors
  # context-provider-gate.test.js's own already-confirmed-passing
  # GROUPB-CANONICAL-CHAIN-1/PP1 fixtures.
  _write_canonical_accepted_consultation "$PROJ" "$CONSULT_WAVE_SLUG" "$plan_sha256" "arch-testing" true
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_passthrough
  rm -f "$arch_flag"
}

@test "PP-BATS-3 BLOCK: post-PLAN, a canonical candidate (request.json + results/<attempt>.json genuinely ANSWERED) that was never accepted -- no accepted-result.json at all -- never authorizes, even with exact correlation otherwise" {
  _setup_wave_proj
  local plan_sha256; plan_sha256="$(_write_postplan_fixture_plan)"
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  printf '{"written_by":"context-provider-consulted","agent_id":"arch-testing-instance-1","architect_role":"arch-testing","session_id":"cp-gate-read-blocker-canonical-chain-opener-session"}' > "$arch_flag"
  # Group G: rewritten as a canonical CANDIDATE lacking accepted-result.json
  # (5th arg "false") -- never restoring consult-result/v1 authority (the OLD
  # accepted:false fixture this row used to build). isAcceptedConsultationTransactionValid
  # requires accepted-result.json to be genuinely DURABLE_PRESENT before it
  # ever even reaches request/result correlation -- an ANSWERED candidate with
  # no acceptance at all must be rejected exactly like an explicitly denied one.
  _write_canonical_accepted_consultation "$PROJ" "$CONSULT_WAVE_SLUG" "$plan_sha256" "arch-testing" false
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG"
  _assert_deny
  rm -f "$arch_flag"
}

@test "PP-BATS-4: CLAUDE_CP_GATE_DISABLED=1 legacy-only escape still unblocks post-PLAN too (unchanged, pre-existing top-of-hook behavior -- distinct from a NEW post-PLAN-specific bypass)" {
  _setup_wave_proj
  _write_postplan_fixture_plan >/dev/null
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  _run_hook_env "CLAUDE_WAVE_SLUG=$CONSULT_WAVE_SLUG CLAUDE_CP_GATE_DISABLED=1"
  _assert_passthrough
}

# ══════════════════════════════════════════════════════════════════════════
# M6+M7 requester-authority closure (Group H, 2026-08-10): ingestion consumer
# boundary. coordination-artifact.js's require()-able validate()/
# validateIngestionResultFor() API is exercised directly here (mirrors this
# file's own VALIDATOR-based direct-require precedent) -- never through the
# PreToolUse hook, which never itself calls the ingestion-specific path.
# ══════════════════════════════════════════════════════════════════════════

@test "GROUPH-1 (regression): generic validate('result') remains status-only even when its filename collides with an EXISTING requests/ingestion/<id>.json sibling -- pre-fix isResultValid derives reqId from the result's own filename and silently upgrades to the FULL ingestion-specific check the moment ANY sibling file with kind:'ingestion' exists at that path, even a completely malformed one" {
  _setup_wave_proj
  local wave_dir="$PROJ/.planning/wave-$CONSULT_WAVE_SLUG"
  mkdir -p "$wave_dir"
  printf '# fixture PLAN for GROUPH-1\n' > "$wave_dir/PLAN.md"
  local head; head="$(git -C "$PROJ" rev-parse HEAD)"
  local plan_sha256; plan_sha256="$(_sha256_of_file "$wave_dir/PLAN.md")"

  local req_id="grouph1-generic-result-id"
  mkdir -p "$wave_dir/requests/ingestion"
  printf '{"kind":"ingestion"}' > "$wave_dir/requests/ingestion/$req_id.json"
  mkdir -p "$wave_dir/results"
  local result_path="$wave_dir/results/$req_id.json"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      schema: "coordination/result/v1", wave_slug: process.argv[2], from: "test-specialist", to: "arch-testing",
      created_at: new Date().toISOString(), head: process.argv[3], plan_sha256: process.argv[4], status: "done"
    }));
  ' "$result_path" "$CONSULT_WAVE_SLUG" "$head" "$plan_sha256"

  run node -e '
    const ca = require(process.argv[1]);
    const ok = ca.validate("result", process.argv[2], { slug: process.argv[3], projectRoot: process.argv[4] });
    process.exit(ok ? 0 : 1);
  ' "$VALIDATOR" "$result_path" "$CONSULT_WAVE_SLUG" "$PROJ"
  [ "$status" -eq 0 ]
}

@test "GROUPH-2 (regression): validateIngestionResultFor requires an EXPLICIT approver:'user' field on the approval -- a missing approver key that merely falls back to from:'user' must FAIL specialized ingestion validation, even though it remains compatible with generic approval validation" {
  _setup_wave_proj
  local wave_dir="$PROJ/.planning/wave-$CONSULT_WAVE_SLUG"
  mkdir -p "$wave_dir"
  printf '# fixture PLAN for GROUPH-2\n' > "$wave_dir/PLAN.md"
  local head; head="$(git -C "$PROJ" rev-parse HEAD)"
  local plan_sha256; plan_sha256="$(_sha256_of_file "$wave_dir/PLAN.md")"

  local req_id="grouph2-approver-gap-id"
  mkdir -p "$wave_dir/requests/ingestion"
  local req_path="$wave_dir/requests/ingestion/$req_id.json"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      schema: "coordination/request/v1", wave_slug: process.argv[2], from: "context-provider", to: "doc-updater",
      created_at: new Date().toISOString(), head: process.argv[3], plan_sha256: process.argv[4], request_id: process.argv[5], kind: "ingestion"
    }));
  ' "$req_path" "$CONSULT_WAVE_SLUG" "$head" "$plan_sha256" "$req_id"

  # Deliberately NO "approver" key -- effectiveApprover falls back to "from",
  # which IS "user"; generic isApprovalValid does not care about this
  # distinction at all (it only checks "decision").
  mkdir -p "$wave_dir/approvals"
  local appr_path="$wave_dir/approvals/$req_id.json"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      schema: "coordination/approval/v1", wave_slug: process.argv[2], from: "user", to: "context-provider",
      created_at: new Date().toISOString(), head: process.argv[3], plan_sha256: process.argv[4],
      decision: "authorized", request_id: process.argv[5], request_kind: "ingestion"
    }));
  ' "$appr_path" "$CONSULT_WAVE_SLUG" "$head" "$plan_sha256" "$req_id"

  local target_rel="docs/guides/grouph2-fixture.md"
  mkdir -p "$PROJ/docs/guides"
  printf '# fixture doc\n' > "$PROJ/$target_rel"

  mkdir -p "$wave_dir/results"
  local result_path="$wave_dir/results/$req_id-generic.json"
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const apprDigest = crypto.createHash("sha256").update(fs.readFileSync(process.argv[6])).digest("hex");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      schema: "coordination/result/v1", wave_slug: process.argv[2], from: "doc-updater", to: "context-provider",
      created_at: new Date().toISOString(), head: process.argv[3], plan_sha256: process.argv[4], status: "done",
      request_id: process.argv[5], request_kind: "ingestion", approval_sha256: apprDigest,
      audit_status: "clean", follow_ups: [], disposition: "written", files_touched: [process.argv[7]]
    }));
  ' "$result_path" "$CONSULT_WAVE_SLUG" "$head" "$plan_sha256" "$req_id" "$appr_path" "$target_rel"

  run node -e '
    const ca = require(process.argv[1]);
    const result = ca.validateIngestionResultFor(process.argv[2], process.argv[3], process.argv[4], { slug: process.argv[5], projectRoot: process.argv[6] });
    process.stdout.write(JSON.stringify(result));
    process.exit(result.valid ? 0 : 1);
  ' "$VALIDATOR" "$req_path" "$appr_path" "$result_path" "$CONSULT_WAVE_SLUG" "$PROJ"
  [ "$status" -eq 1 ]
}
