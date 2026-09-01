#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Hardening tests for .claude/hooks/bash-cli-spawn-gate.js -- WP3 supervisor-start
# background-launch authorization boundary (PLAN.md "Host-native lifecycle action
# boundary (frozen execution contract)" ~L162), layered on top of the pre-existing
# T-BUG-031-00 CLI-agent-spawn block (unchanged; regression-covered here too).
#
# This suite NEVER executes runtime-bridge-codex.cjs (it does not exist yet -- item
# C is a dedicated future session) -- it validates EXCLUSIVELY the gate's own
# authorizing-boundary DECISION by piping a synthetic PreToolUse hook payload
# (`{tool_name:"Bash", tool_input:{command,run_in_background}, agent_type}`) to the
# gate script's stdin and inspecting its stdout (`{decision:"block",reason}`, or
# empty for allow) plus exit code. A REAL supervisor-start action is minted through
# the actual runtime-role-lifecycle.cjs CLI (`ensure` under a fake
# codex-app-server-only capability) so every positive-path/mutation test exercises
# the genuine canonical `bridge_argv`/`bridge_command` this gate validates against,
# never a hand-typed guess at its shape.
#
# Key interpretive decision (documented, mirrors this wave's other bats suites'
# practice): the gate is a POSITIVE allowlist (render->parse->deep-equality against
# a minted action), not a heuristic blocklist -- so every injection-class test below
# (assignment/pipe/redirect/substitution/heredoc/metacharacter/alt-quoting/extra-flag)
# is expected to fail through the SAME single structural check
# ("not the canonical renderPosixDirect(bridge_argv) form"), not a bespoke per-class
# detector. This is intentional (see memory: "Write-gate = concrete argv allowlist").

GATE="$BATS_TEST_DIRNAME/../../.claude/hooks/bash-cli-spawn-gate.js"
RLL="$BATS_TEST_DIRNAME/../lib/runtime-role-lifecycle.cjs"
WAVE_SLUG="gate-test-wave"
TEST_CAPABILITY="bats-bash-cli-spawn-gate-fixture-capability"

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
  # registry -- exported before any node/CLI process starts so every
  # subprocess this test spawns inherits it. Mirrors
  # runtime-consultation-bridge.bats's own isolation.
  RUNTIME_TMP="$BATS_TEST_TMPDIR/runtime-tmp"
  mkdir -p "$RUNTIME_TMP"
  chmod 0700 "$RUNTIME_TMP"
  _assert_isolated_runtime_tmp "$RUNTIME_TMP"
  export TMPDIR="$RUNTIME_TMP"

  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
  PROJ_REGISTRY_DIR="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL" "$PROJ")"
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '# Fixture PLAN for bash-cli-spawn-gate.bats\n' > "$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md"
  mkdir -p "$PROJ/scripts/lib"
  # This suite validates the Codex supervisor-start gate, not the repository's
  # current host-selection preference. Pin a project-local v1 policy so a future
  # toolkit-level v2 selection (for example Claude with fallback=deny) cannot
  # silently redirect this deliberately single-driver Codex fixture.
  node -e '
    const fs = require("fs");
    const policy = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    policy.schema = "runtime-collaboration-policy/v1";
    policy.version = 1;
    delete policy.selection;
    fs.writeFileSync(process.argv[2], JSON.stringify(policy) + "\n", { mode: 0o600 });
  ' "$BATS_TEST_DIRNAME/../lib/runtime-collaboration-policy.json" "$PROJ/scripts/lib/runtime-collaboration-policy.json"
  cp "$BATS_TEST_DIRNAME/../lib/runtime-routing.json" "$PROJ/scripts/lib/runtime-routing.json"
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
  rm -rf "$PROJ"
}

# Mints a real MainOrchestratorBinding + one-use grant + `ensure` call for the
# given role under a fake single-driver capability, producing one genuine
# lifecycle action. Prints `<action_id>\t<bridge_command_or_empty>` on stdout.
# role=verifier + capability=["codex-app-server"] (routing.json lists
# codex-app-server FIRST for verifier) yields a real supervisor-start action;
# The wrong-kind test below derives its fixture from a genuine minted
# supervisor-start action and changes only its enum-valid `kind` field on
# disk. That keeps the test independent of any unrelated Claude capability
# oracle while still exercising this gate's own kind boundary.
_mint_action() {
  local role="$1" capability="$2"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TEST_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const { execFileSync } = require("child_process");
    const projectRoot = process.argv[2];
    const role = process.argv[3];
    const capability = process.argv[4];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "gate-bats-session-" + crypto.randomBytes(4).toString("hex") };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planDigest = rll.discoverPlan(projectRoot).planDigest;
    const binding = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planDigest, 120).binding;
    const sha256String = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
    const argvDigest = sha256String("ensure:" + role);
    const grant = rll.mintLifecycleCommandGrant(projectRoot, binding, argvDigest, role, "ensure", "main-orchestrator", "orchestrator", "normal", null);
    const out = execFileSync("node", [process.argv[1], "ensure", "--project-root", projectRoot, "--role", role, "--lifecycle-binding", grant.grantId], {
      encoding: "utf8",
      env: Object.assign({}, process.env, { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: capability }),
    });
    const result = JSON.parse(out.trim().split("\n").pop());
    const action = result.actions[0];
    const bridgeCommand = (action.payload && action.payload.bridge_command) || "";
    process.stdout.write(action.action_id + "\t" + bridgeCommand);
  ' "$RLL" "$PROJ" "$role" "$capability"
}

_mint_supervisor_start_action() {
  _mint_action verifier '["codex-app-server"]'
}

# Pipes a synthetic PreToolUse hook payload to the gate. Args: command,
# run_in_background ("true"/""), agent_type ("" for top-level).
_run_gate() {
  local cmd="$1" bg="$2" agent="$3"
  local payload_file
  payload_file="$(mktemp)"
  node -e '
    const cmd = process.argv[1];
    const bg = process.argv[2] === "true";
    const agent = process.argv[3];
    const payload = { tool_name: "Bash", tool_input: { command: cmd, run_in_background: bg } };
    if (agent) payload.agent_type = agent;
    process.stdout.write(JSON.stringify(payload));
  ' "$cmd" "$bg" "$agent" > "$payload_file"
  run --separate-stderr node "$GATE" < "$payload_file"
  rm -f "$payload_file"
}

_assert_allowed() {
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

_assert_blocked() {
  local expect_substring="$1"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision":"block"'* ]]
  if [ -n "$expect_substring" ]; then
    [[ "$output" == *"$expect_substring"* ]]
  fi
}

# ══════════════════════════════════════════════════════════════════════════
# T-BUG-031-00 regression (pre-existing behavior must survive hardening)
# ══════════════════════════════════════════════════════════════════════════

@test "GATE-regress-1: --agent-id is still blocked" {
  _run_gate 'claude --agent-id foo' '' ''
  _assert_blocked 'T-BUG-031-00'
}

@test "GATE-regress-2: --team-name is still blocked" {
  _run_gate 'claude --team-name foo' '' ''
  _assert_blocked 'T-BUG-031-00'
}

@test "GATE-regress-3: claude --help is still allowed" {
  _run_gate 'claude --help' '' ''
  _assert_allowed
}

@test "GATE-codexspawn-1: codex exec with an inline persona-assignment (double-quoted) prompt is blocked (WP3 correction #1)" {
  _run_gate 'codex exec "you are the arch-testing architect"' '' ''
  _assert_blocked 'T-BUG-031-00'
}

@test "GATE-codexspawn-2: codex e (the exec alias) with an inline persona-assignment (single-quoted) prompt is blocked" {
  _run_gate "codex e 'you are the verifier'" '' ''
  _assert_blocked 'T-BUG-031-00'
}

@test "GATE-codexspawn-3: the bare codex \"you are ...\" positional-prompt form (no subcommand) is blocked" {
  _run_gate 'codex "you are a helpful peer"' '' ''
  _assert_blocked 'T-BUG-031-00'
}

@test "GATE-codexspawn-4: codex exec with an ordinary (non-persona) prompt is NOT blocked -- the pattern is narrowly scoped, mirroring Claude's own \"you are\"-only trigger" {
  _run_gate 'codex exec "summarize this file"' '' ''
  _assert_allowed
}

@test "GATE-codexspawn-5: codex --help / codex exec --help are NOT blocked" {
  _run_gate 'codex exec --help' '' ''
  _assert_allowed
}

@test "GATE-regress-4: an unrelated background command (no bridge/session-run marker) is allowed" {
  _run_gate 'npm run dev' 'true' ''
  _assert_allowed
}

# ══════════════════════════════════════════════════════════════════════════
# Positive path + one-use replay
# ══════════════════════════════════════════════════════════════════════════

@test "GATE-positive-1: the EXACT canonical bridge_command, top-level, run_in_background=true is allowed" {
  local minted action_id bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  [ -n "$bridge_command" ]
  _run_gate "$bridge_command" 'true' ''
  _assert_allowed
}

@test "GATE-replay-1: a SECOND launch of the identical already-authorized command is rejected (one-use)" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "$bridge_command" 'true' ''
  _assert_allowed
  _run_gate "$bridge_command" 'true' ''
  _assert_blocked 'one-use'
}

# ══════════════════════════════════════════════════════════════════════════
# Foreground / subagent / forged / expired / wrong-kind
# ══════════════════════════════════════════════════════════════════════════

@test "GATE-foreground-1: the same command WITHOUT run_in_background=true is untouched by this gate (a foreground call cannot achieve the detached process this boundary exists to prevent) and does NOT consume the action's one-use marker" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "$bridge_command" '' ''
  _assert_allowed
  # The one-use marker was never touched -- a SUBSEQUENT background launch of
  # the identical command must still succeed exactly once.
  _run_gate "$bridge_command" 'true' ''
  _assert_allowed
  _run_gate "$bridge_command" 'true' ''
  _assert_blocked 'one-use'
}

@test "GATE-subagent-1: a non-empty agent_type (subagent/peer) is rejected -- only top-level may force background" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "$bridge_command" 'true' 'context-provider'
  _assert_blocked 'top-level orchestrator'
}

@test "GATE-forged-1: a well-formed but never-minted action_id is rejected" {
  local minted bridge_command forged
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  forged="$(node -e 'process.stdout.write(process.argv[1].replace(/[0-9a-f]{32}/, "f".repeat(32)))' "$bridge_command")"
  _run_gate "$forged" 'true' ''
  _assert_blocked 'No current lifecycle action'
}

@test "GATE-expired-1: an EXPIRED supervisor-start action is rejected" {
  local minted action_id bridge_command
  minted="$(_mint_supervisor_start_action)"
  action_id="${minted%%$'\t'*}"
  bridge_command="${minted#*$'\t'}"
  node -e '
    const rll = require(process.argv[1]);
    const actionId = process.argv[3];
    const actionPath = rll.actionPathFor(process.argv[2], actionId);
    const fs = require("fs");
    const rec = JSON.parse(fs.readFileSync(actionPath, "utf8"));
    rec.expires_at = "2000-01-01T00:00:00Z";
    fs.chmodSync(actionPath, 0o600);
    fs.writeFileSync(actionPath, JSON.stringify(rec), { mode: 0o600 });
  ' "$RLL" "$PROJ" "$action_id"
  _run_gate "$bridge_command" 'true' ''
  _assert_blocked 'expired'
}

@test "GATE-wrongkind-1: an action that exists but is NOT kind=supervisor-start is rejected even if a caller crafts a bridge-shaped command around its id" {
  local minted action_id action_path
  minted="$(_mint_supervisor_start_action)"
  action_id="${minted%%$'\t'*}"
  [ -n "$action_id" ]
  action_path="$(node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(rll.actionPathFor(process.argv[2], process.argv[3]));
  ' "$RLL" "$PROJ" "$action_id")"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const action = JSON.parse(fs.readFileSync(p, "utf8"));
    action.kind = "role-spawn";
    fs.writeFileSync(p, JSON.stringify(action));
  ' "$action_path"
  local fake_cmd="'node' '/tmp/does-not-matter/runtime-bridge-codex.cjs' 'session-run' '--action' '$action_id' '--coordination-root' '/tmp/x' '--role' 'arch-testing' '--session-expiry' '2099-01-01T00:00:00Z'"
  _run_gate "$fake_cmd" 'true' ''
  _assert_blocked 'not a supervisor-start'
}

# ══════════════════════════════════════════════════════════════════════════
# Injection matrix: every class below is rejected by the SAME structural
# render->parse->deep-equality check (a positive allowlist, not a per-class
# heuristic blocklist).
# ══════════════════════════════════════════════════════════════════════════

@test "GATE-inject-extraflag: an extra trailing flag appended to the canonical command is rejected" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "$bridge_command "\''--extra'\' 'true' ''
  _assert_blocked 'deep-equal'
}

@test "GATE-inject-semicolon: a semicolon-chained second command is rejected" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "${bridge_command}; rm -rf /tmp/whatever" 'true' ''
  _assert_blocked 'canonical renderPosixDirect'
}

@test "GATE-inject-pipe: a piped second command is rejected" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "${bridge_command} | cat" 'true' ''
  _assert_blocked 'canonical renderPosixDirect'
}

@test "GATE-inject-redirect: an appended output redirect is rejected" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "${bridge_command} > /tmp/gate-inject-redirect-out" 'true' ''
  _assert_blocked 'canonical renderPosixDirect'
}

@test "GATE-inject-substitution: a command substitution appended is rejected" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "${bridge_command} \$(whoami)" 'true' ''
  _assert_blocked 'canonical renderPosixDirect'
}

@test "GATE-inject-heredoc: a heredoc wrap around the canonical command is rejected" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "$(printf '%s\n<<EOF\nEOF' "$bridge_command")" 'true' ''
  _assert_blocked 'canonical renderPosixDirect'
}

@test "GATE-inject-altquoting: double-quoting instead of the canonical single-quoting is rejected" {
  local minted bridge_command double_quoted
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  double_quoted="$(node -e 'process.stdout.write(process.argv[1].replace(/'"'"'/g, "\""))' "$bridge_command")"
  _run_gate "$double_quoted" 'true' ''
  _assert_blocked 'canonical renderPosixDirect'
}

@test "GATE-inject-assignment: a leading shell variable assignment prepended to the canonical command is rejected" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "FOO=bar ${bridge_command}" 'true' ''
  _assert_blocked 'canonical renderPosixDirect'
}

@test "GATE-inject-metacharacter: a background metacharacter (&) appended is rejected" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  _run_gate "${bridge_command} &" 'true' ''
  _assert_blocked 'canonical renderPosixDirect'
}

# ══════════════════════════════════════════════════════════════════════════
# M6-CODEX-SUPERVISOR-ACTIVATION-CLOSURE: no sequential-hook assumption.
# CONFIRMED, not RED (mirrors context-provider-gate.test.js's own precedent
# for a deliberately-non-RED persisted regression witness, e.g. GROUP F /
# GROUPF-1 there): direct read of .claude/settings.json shows a Bash tool
# call fires FOUR INDEPENDENT PreToolUse matcher blocks -- "Write|Edit|Bash"
# (premature-execution-gate.js), "Bash" (12 hooks including THIS gate),
# "Grep|Glob|Bash|Read" (context-provider-gate.js ALONE), and
# "Bash|Task|Agent" (wave-phase-gate.js) -- never a single chained pipeline
# where one hook's updatedInput becomes the next hook's own input.
# context-provider-gate.js's own tryInjectLifecycleGrant/tryInjectRequesterGrant
# already prove this mechanism is real and production-active TODAY (both
# rewrite updatedInput.command for a Bash call in this exact multi-hook
# environment) -- this test grounds the SAME architectural fact in THIS
# gate's own real supervisor-start logic instead of guessing at internals:
# the model's own plausible FIRST attempt at a supervisor-start Bash call may
# well carry run_in_background:false (context-provider-gate.js's M6 job,
# once implemented, is to FORCE it true in ITS OWN separate updatedInput,
# never this gate's). Fed that SAME genuine original (unforced) payload --
# exactly what Claude Code's harness actually delivers to this gate, never a
# chained, already-forced one -- this gate's own real, already-shipped
# validateSupervisorStartLaunch short-circuits on `!runInBackground` and
# allows silently, WITHOUT consuming the action's one-use launch marker
# (GATE-foreground-1's own established behavior) -- correct ONLY if this
# gate genuinely never observes a forced-true value from a sibling hook. If
# hooks were (wrongly) assumed to chain, a future change to this gate could
# be tempted to trust an already-forced run_in_background as proof of prior
# validation; this test pins that no such trust is ever legitimate, and the
# marker's one-use genuinely survives for a REAL subsequent background
# launch.
# ══════════════════════════════════════════════════════════════════════════

@test "GATE-nosequential-1: this gate processes the ORIGINAL raw PreToolUse Bash payload (run_in_background:false, exactly as the top-level model actually issued it) -- never a sibling hook's own forced-true updatedInput -- and therefore takes no action at all on it, leaving the one-use launch marker genuinely untouched for a real subsequent background launch" {
  local minted bridge_command
  minted="$(_mint_supervisor_start_action)"
  bridge_command="${minted#*$'\t'}"
  [ -n "$bridge_command" ]

  # The genuine original event this gate actually receives -- run_in_background
  # still false, since forcing it true is context-provider-gate.js's own,
  # separate M6 job, never chained into what THIS gate is given.
  _run_gate "$bridge_command" '' ''
  _assert_allowed

  # Proof the one-use marker was genuinely never touched by that call: a
  # REAL subsequent background launch of the identical command still
  # succeeds exactly once -- would be impossible if this gate had instead
  # observed (and acted on) an already-forced run_in_background:true.
  _run_gate "$bridge_command" 'true' ''
  _assert_allowed
  _run_gate "$bridge_command" 'true' ''
  _assert_blocked 'one-use'
}
