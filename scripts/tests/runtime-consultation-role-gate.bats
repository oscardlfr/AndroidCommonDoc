#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for .claude/hooks/runtime-consultation-target-gate.js AND the real
# core-side role-command-grant/v1 enforcement inside scripts/lib/
# runtime-consultation.cjs, PLUS .claude/hooks/context-provider-gate.js's
# REQUESTER-side grant injection into the same core.
#
# SECOND-PASS REWRITE per the M7/WP4 HARD NO-GO correction (2026-08-09,
# .planning/wave-portable-runtime-messaging-adapters/m7-correction-verdict-
# 2026-08-09.md). The FIRST correction pass (m7-correction-spec.md §1)
# concluded the consultation-target surface (claim/lease-heartbeat/
# publish-result/worker-stop-ack) could only ever be a HOOK-ONLY mint+audit
# record with NO flag injection, because runtime-consultation.cjs's
# COMMAND_FLAGS table had no landing spot and was declared out of scope to
# edit. The user's HARD NO-GO identified this as the real defect: the mint
# was theater (nothing downstream ever consumed the grant), and the actual
# blocker (Path-Manifest scope) should have been named and stopped on, not
# approximated around. Path-Manifest reconciliation now authorizes WP4 to
# touch runtime-consultation.cjs for the narrow purpose of adding real
# --requester-binding/--target-binding flags plus atomic mint/consume before
# any read or mutation (PLAN.md §15b/§15d, ~L592-608).
#
# The corrected design under test:
#   - context-provider-gate.js mints+injects REQUESTER role-command-grant/v1
#     as a NEW --requester-binding <id> flag (any calling agent_type, not
#     just the main orchestrator -- PLAN.md ~L590's RequesterIdentityProvider
#     is role=agent_type generically).
#   - runtime-consultation-target-gate.js mints+injects TARGET
#     role-command-grant/v1 as a NEW --target-binding <id> flag (claim/
#     lease-heartbeat/publish-result/worker-stop-ack), and continues to
#     mint+inject --lifecycle-binding for `ready` unchanged.
#   - runtime-consultation.cjs itself RECEIVES these flags and atomically
#     one-time-consumes+fully-validates the referenced grant BEFORE any read
#     or mutation (PLAN.md ~L604: "wins <grant_id>.used, strips only its own
#     injected flag, recomputes the exact pre-injection argv digest, and
#     revalidates schema/surface/binding/authority/profile/subcommand/PLAN/
#     worktree/role/action ... before any read or mutation").
#   - Exact grant schema (PLAN.md §15b verbatim, ~L592): {schema,grant_id,
#     binding_id,actor_instance_id,authority,subcommand,request_id,
#     attempt_id,lease_epoch,canonical_argv_digest,plan_digest,worktree_id,
#     role,created_at,expiry} -- authority enum requester|target. This
#     SUPERSEDES the prior pass's own grant object, which had NO
#     attempt_id/lease_epoch fields at all and instead carried an
#     ad-hoc extra `stop_id` field -- RCG-SCHEMA-CLOSED below pins the real,
#     literal PLAN schema.
#
# Empirically confirmed (read directly from runtime-consultation.cjs, ~L243-
# 262 COMMAND_FLAGS + each cmd* handler's own requireFlags call) real argv
# for the four consultation-target subcommands -- NONE of them carry
# --attempt/--epoch/--actor-instance at all (those only exist for
# record-delivery, a DIFFERENT, non-target subcommand):
#   claim:            --coordination-root --request --role [--worker-session]
#   lease-heartbeat:  --coordination-root --request --claim
#   publish-result:   --coordination-root --request --claim (--content XOR --blocked-reason)
#   worker-stop-ack:  --coordination-root --stop --disposition
# root-init/root-validate: --coordination-root only. validate: --coordination-root
# --kind --artifact. Confirmed directly against runtime-consultation.cjs's
# own COMMAND_FLAGS table (unmodified since HEAD 7622e84 -- not in this
# session's git-status diff at all).
#
# Test-file division of labor (avoids duplicate coverage): the HOOK-level
# injection mechanics for the requester surface (re-render, internal mint
# failure blocks, missing session_id blocks, caller-supplied-flag rejected,
# per-subcommand table) live in context-provider-gate.test.js, mirroring its
# own already-proven LG1-LG9/LG-TABLE pattern for the lifecycle surface. THIS
# file owns: the full hook-mint -> real-CLI-subprocess-consume round trip for
# BOTH surfaces, the exact PLAN-literal closed grant schema, and the
# core-level adversarial matrix (absent/replay/expired/altered/argv-tamper/
# cross-role/authority-swap/direct-bypass) that only a real CLI subprocess
# can prove.
#
# Invocation: bats scripts/tests/runtime-consultation-role-gate.bats (from repo root)

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/runtime-consultation-target-gate.js"
CP_GATE_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/context-provider-gate.js"
AGENT_SPAWN_GATE_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/agent-spawn-execution-gate.js"
SUBAGENT_START_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/subagent-start-context-bundle.js"
# Fully resolved (no ".." segments) so a byte-exact canonical-path comparison
# inside the hook (mirroring findLifecycleCliInvocation's discipline -- exact
# match, never basename-only) actually matches. A raw "$BATS_TEST_DIRNAME/../lib/..."
# string would NOT byte-match the hook's own path.resolve(__dirname, '../../scripts/lib/...').
LIB_DIR="$(cd "$BATS_TEST_DIRNAME/../lib" && pwd)"
CONSULTATION_CLI="$LIB_DIR/runtime-consultation.cjs"
RLL_IMPL="$LIB_DIR/runtime-role-lifecycle.cjs"
TG_CAPABILITY="tg-fixture-capability"
S16_RETAINED_FIXTURE="$BATS_TEST_DIRNAME/fixtures/runtime-consultation-grant-wrapper.cjs"

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
  # M6+M7 Bats registry isolation: registryBaseDir() (runtime-role-
  # lifecycle.cjs) resolves purely from $TMPDIR + this OS user's uid --
  # isolated here under bats' own per-test tmpdir, never the real shared
  # canonical registry, exported before ANY node/hook/CLI process starts so
  # every subprocess this test spawns inherits it.
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
  # Captured immediately after git init, while .git is known-good -- defensive
  # only, mirrors runtime-consultation-bridge.bats' own precedent.
  PROJ_REGISTRY_DIR="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL_IMPL" "$PROJ")"
  mkdir -p "$PROJ/.planning/wave-tg-wave"
  printf '# fixture PLAN for runtime-consultation-target-gate tests\n' > "$PROJ/.planning/wave-tg-wave/PLAN.md"
  # The supervisor/action half of this suite deliberately exercises the
  # retained Codex compatibility lane, whereas production's current v2 pair
  # pins Claude-native selection. Install the canonical v1 projection only in
  # this hermetic fixture so those tests reach their own gate assertions.
  mkdir -p "$PROJ/scripts/lib"
  cp "$BATS_TEST_DIRNAME/../lib/runtime-collaboration-policy.json" "$PROJ/scripts/lib/runtime-collaboration-policy.json"
  cp "$BATS_TEST_DIRNAME/../lib/runtime-routing.json" "$PROJ/scripts/lib/runtime-routing.json"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const policy = JSON.parse(fs.readFileSync(p, "utf8"));
    policy.schema = "runtime-collaboration-policy/v1";
    policy.version = 1;
    delete policy.selection;
    fs.writeFileSync(p, JSON.stringify(policy, null, 2) + "\n");
  ' "$PROJ/scripts/lib/runtime-collaboration-policy.json"
  TEST_HOME="$PROJ/test-home"
  mkdir -p "$TEST_HOME/.codex"
  node -e '
    const fs = require("fs");
    const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const token = enc({ alg: "none", typ: "JWT" }) + "." + enc({ exp: Math.floor(Date.now() / 1000) + 3600 }) + ".fixture";
    fs.writeFileSync(process.argv[1], JSON.stringify({ tokens: { access_token: token, account_id: "role-gate-test-account", id_token: token } }), { mode: 0o600 });
  ' "$TEST_HOME/.codex/auth.json"
  FAKE_CODEX="$PROJ/fake-codex"
  printf '#!/bin/sh\nexit 0\n' > "$FAKE_CODEX"
  chmod 0755 "$FAKE_CODEX"
  INPUT_FILE="$(mktemp "$BATS_TEST_TMPDIR/target-gate-input.XXXXXX.json")"
}

teardown() {
  # R2-C (M6-M7-R2C-TEST-SEAM-CLOSURE-20260820): disarm the test-routing-policy
  # seam unconditionally -- a no-op for every test that never armed it
  # (_s16e2e_arm_test_routing_seam is the only exporter), correct hygiene for
  # the four that do, so no exported value ever leaks into a later test.
  unset RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH
  unset NODE_ENV
  unset RUNTIME_CONSULTATION_TEST_CAPABILITY
  # S16E2E tests that fail (or are interrupted) before reaching their own
  # trailing _s16e2e_stop_retained_plane call would otherwise leak the
  # backgrounded `session-run` process -- it only self-terminates lazily,
  # once it next touches a file under the about-to-be-removed $PROJ below,
  # which races the rm -rf itself ("Directory not empty") and leaves an
  # orphaned process (plus its own 5 fake-codex-app-server children)
  # competing for CPU with whatever test runs next.
  if [ -n "${S16E2E_BG_PID:-}" ]; then
    kill -TERM "$S16E2E_BG_PID" 2>/dev/null
    wait "$S16E2E_BG_PID" 2>/dev/null || true
    S16E2E_BG_PID=""
  fi
  if [ -n "${S16E2E_CONTEXT7_SERVER_PID:-}" ]; then
    kill -TERM "$S16E2E_CONTEXT7_SERVER_PID" 2>/dev/null
    wait "$S16E2E_CONTEXT7_SERVER_PID" 2>/dev/null || true
    S16E2E_CONTEXT7_SERVER_PID=""
  fi
  if [ -n "$RUNTIME_TMP" ] && _assert_isolated_runtime_tmp "$RUNTIME_TMP" >/dev/null 2>&1; then
    # M6+M7 SIXTEENTH Phase 2B follow-up: some S16E2E fixtures materialize a
    # deliberately read-only role-read-view projection under here (the
    # production isolation model's own security posture) -- restore owner
    # write+traverse on every path THIS test created before sweeping, or a
    # bare rm -rf leaves permission-denied debris behind (which then also
    # makes bats' own outer per-test tmpdir cleanup fail non-silently).
    chmod -R u+rwX "$RUNTIME_TMP" 2>/dev/null || true
    rm -rf "$RUNTIME_TMP"
  fi
  rm -rf "$PROJ"
  rm -f "$INPUT_FILE"
}

_registry_repo_dir() {
  node -e '
    const rll = require(process.argv[1]);
    try { process.stdout.write(rll.registryRepoDir(process.argv[2])); } catch { process.stdout.write(""); }
  ' "$RLL_IMPL" "$PROJ" 2>/dev/null
}

_render_posix_direct() {
  node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(rll.renderPosixDirect(process.argv.slice(2)));
  ' "$RLL_IMPL" "$@"
}

# _make_input <command> <agent_type> [session_id] [agent_id]
_make_input() {
  local command="$1" agent="$2" session="${3:-tg-session}" agent_id="${4:-tg-agent-id}"
  python3 - "$INPUT_FILE" "$command" "$agent" "$session" "$agent_id" <<'PYEOF'
import json, sys
path, command, agent, session, agent_id = sys.argv[1:6]
payload = {"tool_name": "Bash", "tool_input": {"command": command}, "agent_type": agent, "session_id": session, "agent_id": agent_id}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
}

_run_hook() {
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJ' node '$HOOK'"
}

# Same input shape, targets context-provider-gate.js instead -- used for the
# REQUESTER surface (context-provider-gate.js owns requester grants per
# PLAN.md ~L600, regardless of calling agent_type).
_run_cp_hook() {
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJ' node '$CP_GATE_HOOK'"
}

# CLAUDE-ID-01 capability primer. The fixture uses the same host-private
# lifecycle primitives as production and two distinct, live role-spawn
# actions: peer A supplies the full start/tool/resume/tool sequence and peer B
# supplies the required same-role/different-agent observation. This proves the
# session-generation capability without relying on a model-visible artifact
# or on repeated copies of one hook payload.
# _prime_claude_id01_trace <agent_type> <session_id> [agent_id]
_prime_claude_id01_trace() {
  local agent_type="$1" session_id="$2" agent_id="${3:-tg-agent-id}"
  node -e '
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const agentType = process.argv[3];
    const sessionId = process.argv[4];
    const agentId = process.argv[5];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const plan = rll.discoverPlan(projectRoot);
    if (!generation.ok || !plan.ok) {
      process.stderr.write("_prime_claude_id01_trace: scope resolution failed");
      process.exit(1);
    }
    const worktreeId = rll.computeWorktreeId(projectRoot);
    function mintAction(suffix) {
      const actionId = rll.generateActionId();
      const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, "Z");
      const minted = rll.mintRoleLifecycleAction(
        projectRoot, actionId, "role-spawn", "claude-native",
        rll.computeRepoId(projectRoot), worktreeId, plan.planDigest,
        crypto.createHash("sha256").update("role-gate-claude-id01:" + suffix).digest("hex"),
        generation.generationId, agentType,
        rll.buildRoleSpawnPayload("claude-id01-probe", agentType, agentType, "fixture", "fixture"),
        expiry,
      );
      if (!minted.ok) {
        process.stderr.write("_prime_claude_id01_trace: action mint failed: " + JSON.stringify(minted));
        process.exit(1);
      }
      return actionId;
    }
    const actionA = mintAction("a-" + agentId);
    const actionB = mintAction("b-" + agentId);
    const observeStart = (id, actionId) => rll.recordClaudeId01SubagentStartObservation(
      projectRoot, { sessionId, agentId: id, agentType, actionId }
    );
    const observeTool = (suffix) => rll.recordClaudeId01PreToolUseObservation(
      projectRoot, { sessionId, agentId, agentType, toolUseId: "role-gate-prime-" + suffix + "-" + sessionId + "-" + agentId }
    );
    observeStart(agentId, actionA);
    observeTool("1");
    observeTool("2");
    observeStart(agentId, actionA);
    observeTool("3");
    observeStart(agentId + "-distinct-peer-b", actionB);
    const proof = rll.checkClaudeId01RuntimeCapability(projectRoot, sessionId, worktreeId, plan.planDigest);
    if (!proof.ok) {
      process.stderr.write("_prime_claude_id01_trace: global capability absent: " + JSON.stringify(proof));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$PROJ" "$agent_type" "$session_id" "$agent_id"
}

# Extracts a --<flag> value from the last hook stdout ($output), reading the
# rewritten command out of hookSpecificOutput.updatedInput.command.
#
# M7 Correction infra fix: the hook re-renders an injected flag via
# renderPosixDirect (spec sec 1C/2A), which single-quotes EVERY token --
# e.g. '--lifecycle-binding' '<id>' -- so the closing quote immediately
# follows the flag name with no real whitespace there, and a naive \s+-based
# regex can never match it. Tries the canonical parser first (handles the
# real, correctly-quoted output), falling back to the naive regex for
# robustness. Does not change what is being verified (that a grant was
# genuinely injected and is extractable), only how it locates the value.
_extract_injected() {
  local flag="$1"
  node -e '
    const rll = require(process.argv[3]);
    const flag = process.argv[1];
    let body;
    try { body = JSON.parse(process.argv[2]); } catch { process.stdout.write(""); process.exit(0); }
    const cmd = body && body.hookSpecificOutput && body.hookSpecificOutput.updatedInput && body.hookSpecificOutput.updatedInput.command;
    if (typeof cmd !== "string") { process.stdout.write(""); process.exit(0); }
    const tokens = rll.parsePosixDirect(cmd);
    if (Array.isArray(tokens)) {
      const idx = tokens.indexOf("--" + flag);
      if (idx !== -1 && idx + 1 < tokens.length) { process.stdout.write(tokens[idx + 1]); process.exit(0); }
    }
    const m = new RegExp("--" + flag + "\\s+\\S+").exec(cmd);
    process.stdout.write(m ? m[0].split(/\s+/)[1] : "");
  ' "$flag" "$output" "$RLL_IMPL"
}

# Mints a REAL pending role-spawn action for `role` via the actual production
# ensure()/grant machinery. Prints "<action_id> <worktree_id> <plan_digest> <session_generation_id>".
_mint_pending_role_spawn_full() {
  local role="$1" session_key="$2"
  _prime_claude_id01_trace "context-provider" "$session_key" "tg-lifecycle-capability-primary"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["claude-sendmessage"]' node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const role = process.argv[3];
    const sessionKey = process.argv[4];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionKey };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const bindingResult = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planResult.planDigest, 120);
    if (!bindingResult.ok) { process.stderr.write("binding mint failed"); process.exit(1); }
    const crypto = require("crypto");
    const argvDigest = crypto.createHash("sha256").update("ensure:" + role).digest("hex");
    const grantResult = rll.mintLifecycleCommandGrant(projectRoot, bindingResult.binding, argvDigest, role, "ensure", "main-orchestrator", "orchestrator", "normal", null);
    if (!grantResult.ok) { process.stderr.write("grant mint failed: " + JSON.stringify(grantResult)); process.exit(1); }
    const { spawnSync } = require("child_process");
    const ensureResult = spawnSync("node", [process.argv[1], "ensure", "--project-root", projectRoot, "--role", role, "--lifecycle-binding", grantResult.grantId], { env: process.env, encoding: "utf8" });
    if (ensureResult.status !== 0) { process.stderr.write("ensure CLI failed: " + ensureResult.stdout + ensureResult.stderr); process.exit(1); }
    const genResult = rll.resolveSessionGeneration(projectRoot, identity);
    if (!genResult.ok) { process.stderr.write("session generation lookup failed"); process.exit(1); }
    const profileDigest = rll.roleProfileDigestFor(role);
    const stateResult = rll.readRoleBindingState(projectRoot, worktreeId, planResult.planDigest, profileDigest, genResult.generationId, role);
    if (!stateResult.ok || !stateResult.record || !stateResult.record.pending_action_id) { process.stderr.write("no pending_action_id: " + JSON.stringify(stateResult)); process.exit(1); }
    process.stdout.write(stateResult.record.pending_action_id + " " + worktreeId + " " + planResult.planDigest + " " + genResult.generationId);
  ' "$RLL_IMPL" "$PROJ" "$role" "$session_key"
}

# _mint_role_actor_binding <role> <worktree_id> <plan_digest> <session_generation_id> [ttl_seconds]
_mint_role_actor_binding() {
  local role="$1" worktree_id="$2" plan_digest="$3" session_generation_id="$4" ttl="${5:-60}"
  node -e '
    const rll = require(process.argv[1]);
    const result = rll.createRoleActorBinding(process.argv[2], process.argv[3], process.argv[4], process.argv[5], process.argv[6], Number(process.argv[7]));
    if (!result.ok) { process.stderr.write("createRoleActorBinding failed: " + JSON.stringify(result)); process.exit(1); }
    process.stdout.write(result.binding.binding_id);
  ' "$RLL_IMPL" "$PROJ" "$role" "$worktree_id" "$plan_digest" "$session_generation_id" "$ttl"
}

_random_hex32() {
  node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))'
}

_role_command_grants_dir() {
  node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(require("path").join(rll.registryRepoDir(process.argv[2]), "role-command-grants"));
  ' "$RLL_IMPL" "$PROJ"
}

# Reads hookSpecificOutput.updatedInput.command from the last hook stdout
# ($output) verbatim.
_returned_command() {
  node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch { process.stdout.write(""); process.exit(0); }
    const cmd = body && body.hookSpecificOutput && body.hookSpecificOutput.updatedInput && body.hookSpecificOutput.updatedInput.command;
    process.stdout.write(typeof cmd === "string" ? cmd : "");
  ' "$output"
}

# Actually EXECUTES a rewritten command string as the real production CLI
# subprocess would run it (mirrors _run_hook's own "cat | node" subprocess
# style, but runs the CLI itself, never a hook) -- the only way to prove the
# core genuinely, atomically consumes+validates an injected grant "before any
# read or mutation" (PLAN.md ~L604), not merely that a hook's own JSON claims
# to have minted one.
_run_cli_command() {
  local cmd="$1"
  run bash -c "$cmd"
}

# Reads a role-command-grant/v1 record straight off disk by its grant_id
# (universal <type-dir>/<id>.json registry convention this codebase uses
# throughout -- grantPathFor, roleActorBindingPathFor, roleCommandGrantPathFor
# all follow it) -- used by the adversarial on-disk-tamper tests below.
_role_command_grant_path() {
  printf '%s/%s.json' "$(_role_command_grants_dir)" "$1"
}

# _set_grant_field <grant_id> <field> <json_value_literal>
# Hand-edits one field of an on-disk role-command-grant/v1 record (e.g. to
# simulate expiry or tampering) -- json_value_literal is a JSON literal
# (e.g. '"2000-01-01T00:00:00Z"' for a string) parsed via JSON.parse, never
# eval, since every call site here only ever needs a JSON string literal.
_set_grant_field() {
  local grant_id="$1" field="$2" value_literal="$3"
  local grant_path; grant_path="$(_role_command_grant_path "$grant_id")"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const field = process.argv[2];
    const rec = JSON.parse(fs.readFileSync(p, "utf8"));
    rec[field] = JSON.parse(process.argv[3]);
    fs.writeFileSync(p, JSON.stringify(rec));
  ' "$grant_path" "$field" "$value_literal"
}

_worktree_id() { node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.computeWorktreeId(process.argv[2]));' "$RLL_IMPL" "$PROJ"; }
_plan_digest() { node -e 'const rll=require(process.argv[1]);const r=rll.discoverPlan(process.argv[2]);process.stdout.write(r.ok?r.planDigest:"");' "$RLL_IMPL" "$PROJ"; }

# M7 correction round 1 test-side reconciliation (2026-08-18, task #49):
# writes a minimal, genuinely correlating coordination/consult/v2 request.json
# at $1 for a claim/lease-heartbeat/publish-result target-surface fixture.
# resolveActivationForRequestPath (runtime-consultation.cjs) only needs
# request.json to genuinely be there and readable (readRequestForTxnOrCorrelationInvalid)
# plus resolveAuthoritativeAttempt to succeed off its own initial_attempt_id/
# initial_lease_epoch -- no activation.json/dispatch is required at all: an
# absent activation record resolves ok:true/activation:null, which
# runtime-consultation-target-gate.js's own documented contract (see its
# "Genuine ABSENCE... is NEVER a block by itself" comment, which names
# TG-CLAIM-1/TG-LEASE-1/TG-PUBLISH-1 directly) falls through cleanly to the
# pre-existing RoleActorBinding path -- exactly what _mint_role_actor_binding
# already sets up in these fixtures. Field shape mirrors this file's own
# PROVEN _req12_write_request defaults (same coordination_root_id placeholder
# precedent), sourced from $PROJ instead of the REQ12-specific globals.
_tg_write_minimal_request() {
  local out="$1" target_role="$2"
  mkdir -p "$(dirname "$out")"
  local worktree_id plan_digest repo_id subject_head created_at expiry
  worktree_id="$(_worktree_id)"
  plan_digest="$(_plan_digest)"
  repo_id="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.computeRepoId(process.argv[2]));' "$RLL_IMPL" "$PROJ")"
  subject_head="$(git -C "$PROJ" rev-parse HEAD)"
  created_at="$(node -e 'process.stdout.write(new Date().toISOString().replace(/\.\d{3}Z$/,"Z"))')"
  expiry="$(node -e 'process.stdout.write(new Date(Date.parse(process.argv[1])+1800000).toISOString().replace(/\.\d{3}Z$/,"Z"))' "$created_at")"
  TG_TARGET_ROLE="$target_role" TG_WORKTREE_ID="$worktree_id" TG_PLAN_DIGEST="$plan_digest" \
  TG_REPO_ID="$repo_id" TG_SUBJECT_HEAD="$subject_head" TG_CREATED_AT="$created_at" TG_EXPIRY="$expiry" \
  node -e '
    const fs = require("fs");
    const path = require("path");
    const e = process.env;
    const outPath = process.argv[1];
    // readCanonicalRequestRecord (runtime-consultation.cjs) requires the
    // request own embedded request_id to equal its OWN containing
    // transaction directory basename -- derived here so this helper is
    // self-correlating regardless of which directory name the caller
    // chooses, as long as that name is itself a valid 32-128 char hex id.
    const requestId = path.basename(path.dirname(outPath));
    const obj = {
      schema: "coordination/consult/v2",
      request_id: requestId,
      root_request_id: requestId,
      parent_request_id: null,
      depth: 0,
      max_depth: 2,
      source_role: "test-specialist",
      target_role: e.TG_TARGET_ROLE,
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: "b".repeat(64),
      requester_worktree_id: e.TG_WORKTREE_ID,
      requester_instance_id: "c".repeat(64),
      repo_id: e.TG_REPO_ID,
      wave_slug: "tg-wave",
      protocol_profile: "runtime-consultation/v1",
      coordination_root_id: "0".repeat(64),
      plan_digest: e.TG_PLAN_DIGEST,
      subject_repo_id: e.TG_REPO_ID,
      subject_worktree_id: e.TG_WORKTREE_ID,
      subject_head: e.TG_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      question: "role-gate target-surface fixture question",
      expected_result_kind: "TEST_RESULT",
      expiry: e.TG_EXPIRY,
      recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: "e".repeat(64),
      initial_attempt_id: "f".repeat(64),
      initial_lease_epoch: 0,
      created_at: e.TG_CREATED_AT,
    };
    fs.writeFileSync(outPath, JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$out"
}

# Stage C (M7-FINAL-REMEDIATION-20260818, required_red_before_green item 3):
# identical to _tg_write_minimal_request above, except Object.assign(obj,
# overridesObj) is applied BEFORE writing -- lets exactly one of
# target_role/subject_worktree_id/plan_digest be corrupted relative to what
# the CALLING identity/current project scope actually is, while every other
# field stays genuinely correlating (mirrors
# _tg_write_activation_for_request_tampered's own rationale).
_tg_write_minimal_request_tampered() {
  local out="$1" target_role="$2" overrides_json="$3"
  mkdir -p "$(dirname "$out")"
  local worktree_id plan_digest repo_id subject_head created_at expiry
  worktree_id="$(_worktree_id)"
  plan_digest="$(_plan_digest)"
  repo_id="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.computeRepoId(process.argv[2]));' "$RLL_IMPL" "$PROJ")"
  subject_head="$(git -C "$PROJ" rev-parse HEAD)"
  created_at="$(node -e 'process.stdout.write(new Date().toISOString().replace(/\.\d{3}Z$/,"Z"))')"
  expiry="$(node -e 'process.stdout.write(new Date(Date.parse(process.argv[1])+1800000).toISOString().replace(/\.\d{3}Z$/,"Z"))' "$created_at")"
  TG_TARGET_ROLE="$target_role" TG_WORKTREE_ID="$worktree_id" TG_PLAN_DIGEST="$plan_digest" \
  TG_REPO_ID="$repo_id" TG_SUBJECT_HEAD="$subject_head" TG_CREATED_AT="$created_at" TG_EXPIRY="$expiry" \
  TG_OVERRIDES="$overrides_json" \
  node -e '
    const fs = require("fs");
    const path = require("path");
    const e = process.env;
    const outPath = process.argv[1];
    const requestId = path.basename(path.dirname(outPath));
    const obj = {
      schema: "coordination/consult/v2",
      request_id: requestId,
      root_request_id: requestId,
      parent_request_id: null,
      depth: 0,
      max_depth: 2,
      source_role: "test-specialist",
      target_role: e.TG_TARGET_ROLE,
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: "b".repeat(64),
      requester_worktree_id: e.TG_WORKTREE_ID,
      requester_instance_id: "c".repeat(64),
      repo_id: e.TG_REPO_ID,
      wave_slug: "tg-wave",
      protocol_profile: "runtime-consultation/v1",
      coordination_root_id: "0".repeat(64),
      plan_digest: e.TG_PLAN_DIGEST,
      subject_repo_id: e.TG_REPO_ID,
      subject_worktree_id: e.TG_WORKTREE_ID,
      subject_head: e.TG_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      question: "role-gate target-surface scope-mismatch fixture question",
      expected_result_kind: "TEST_RESULT",
      expiry: e.TG_EXPIRY,
      recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: "e".repeat(64),
      initial_attempt_id: "f".repeat(64),
      initial_lease_epoch: 0,
      created_at: e.TG_CREATED_AT,
    };
    Object.assign(obj, JSON.parse(e.TG_OVERRIDES));
    fs.writeFileSync(outPath, JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$out"
}

# M7 GREEN correction round 2, R5: writes a genuine, well-formed
# coordination/activation/v1 record correlated against a request written by
# _tg_write_minimal_request above (same request_id via the txn directory
# basename). `driver` is caller-chosen so the SAME helper covers both the
# RoleActor-path positive control (driver something other than claude-agent,
# e.g. "noop") and the claude-agent-path fixture.
#
# Stage C correction (2026-08-19, M7-FINAL-REMEDIATION-20260818, required_red_
# before_green item 1): this helper used to hardcode request_digest="a"x64 (a
# placeholder never derived from the request it claims to correlate against)
# plus duplicate-literal copies of target_role_profile_digest/routing_policy_
# digest/attempt_id/lease_epoch that only "matched" the request because both
# sides repeated the same hand-picked constant -- not because either was
# genuinely derived from the other. Once resolveActivationForRequestPath
# actually checks request_digest (Stage C production fix), the old helper
# would have started failing its own callers' PASS fixtures. Fixed: reads the
# EXACT request.json bytes _tg_write_minimal_request already wrote at
# request_path, computes request_digest as the real SHA-256 of those bytes,
# and derives target_role_profile_digest/routing_policy_version/routing_
# policy_digest/attempt_id(initial_attempt_id)/lease_epoch(initial_lease_
# epoch) directly from the parsed request object -- never a second, separately
# hand-maintained copy. native_spawn_action_id/native_target_binding_id are
# now driver-coherent: claude-agent gets a real 32-hex action id (never
# infer/repair a placeholder), every other driver keeps both null.
_tg_write_activation_for_request() {
  local request_path="$1" driver="$2"
  local txn_dir; txn_dir="$(dirname "$request_path")"
  local activation_dir="$txn_dir/activations"
  mkdir -p "$activation_dir"
  TG_REQUEST_PATH="$request_path" TG_ACTIVATION_DIR="$activation_dir" TG_DRIVER="$driver" \
  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const rc = require(process.argv[1]);
    const e = process.env;
    const requestBytes = fs.readFileSync(e.TG_REQUEST_PATH);
    const reqObj = JSON.parse(requestBytes.toString("utf8"));
    const requestDigest = crypto.createHash("sha256").update(requestBytes).digest("hex");
    const isClaudeAgent = e.TG_DRIVER === "claude-agent";
    const obj = {
      schema: "coordination/activation/v1",
      version: 1,
      request_id: reqObj.request_id,
      request_digest: requestDigest,
      attempt_id: reqObj.initial_attempt_id,
      lease_epoch: reqObj.initial_lease_epoch,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
      selected_driver: e.TG_DRIVER,
      native_target_binding_id: null,
      native_spawn_action_id: isClaudeAgent ? crypto.randomBytes(16).toString("hex") : null,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      activation_liveness_expiry: rc.activationLivenessDeadline(reqObj),
    };
    const out = path.join(e.TG_ACTIVATION_DIR, obj.attempt_id + ".json");
    fs.writeFileSync(out, JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(out, 0o600);
  ' "$CONSULTATION_CLI"
}

# Stage C (M7-FINAL-REMEDIATION-20260818, required_red_before_green item 2):
# identical to _tg_write_activation_for_request above, except after computing
# the genuinely-correlated obj it applies Object.assign(obj, overridesObj) --
# `overrides_json` is a JSON object literal of fields to corrupt -- BEFORE
# writing. Lets a single genuinely-correlating base fixture be tampered along
# exactly one axis at a time, so a failure to deny is attributable to that
# ONE axis, never a compound fixture defect.
_tg_write_activation_for_request_tampered() {
  local request_path="$1" driver="$2" overrides_json="$3"
  local txn_dir; txn_dir="$(dirname "$request_path")"
  local activation_dir="$txn_dir/activations"
  mkdir -p "$activation_dir"
  TG_REQUEST_PATH="$request_path" TG_ACTIVATION_DIR="$activation_dir" TG_DRIVER="$driver" TG_OVERRIDES="$overrides_json" \
  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const rc = require(process.argv[1]);
    const e = process.env;
    const requestBytes = fs.readFileSync(e.TG_REQUEST_PATH);
    const reqObj = JSON.parse(requestBytes.toString("utf8"));
    const requestDigest = crypto.createHash("sha256").update(requestBytes).digest("hex");
    const isClaudeAgent = e.TG_DRIVER === "claude-agent";
    const obj = {
      schema: "coordination/activation/v1",
      version: 1,
      request_id: reqObj.request_id,
      request_digest: requestDigest,
      attempt_id: reqObj.initial_attempt_id,
      lease_epoch: reqObj.initial_lease_epoch,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
      selected_driver: e.TG_DRIVER,
      native_target_binding_id: null,
      native_spawn_action_id: isClaudeAgent ? crypto.randomBytes(16).toString("hex") : null,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      activation_liveness_expiry: rc.activationLivenessDeadline(reqObj),
    };
    Object.assign(obj, JSON.parse(e.TG_OVERRIDES));
    const out = path.join(e.TG_ACTIVATION_DIR, obj.attempt_id + ".json");
    fs.writeFileSync(out, JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(out, 0o600);
  ' "$CONSULTATION_CLI"
}

# Stage C table-driven negative fixture: mints a live RoleActorBinding (so a
# denial can never be attributed to "no RoleActorBinding either"), writes a
# correlating request, then writes ONE tampered/PENDING activation for it and
# runs `subcommand` through the real hook. Prints a one-line reason and
# returns 1 on ANY deviation from "genuine deny, zero new role-command-grant
# file" -- never aborts the caller, so a table loop can collect every failing
# dimension from ONE pass instead of stopping at the first (required_red_
# before_green item 5 needs one coherent RED signature per subcommand, not N
# separate incremental discoveries).
# $1=subcommand $2=label $3=driver $4=overrides_json ("__PENDING__" for the
# nlink==2 case, which ignores $4's content and hard-links a VALID activation
# instead of tampering a field). Caller (_tg_run_tamper_table) mints the
# single shared RoleActorBinding ONCE for the whole table -- minting a fresh
# one per row would leave MULTIPLE live bindings for the same {role,
# worktree, plan} from row 2 onward, so findLiveRoleActorBindings's own
# ambiguity check ("no single live RoleActorBinding") would deny every
# subsequent row for THAT unrelated reason, silently masking whatever the
# row's own activation tamper was supposed to prove (empirically caught:
# first draft of this table passed 10/10 rows pre-fix).
_tg_run_tamper_case() {
  local subcommand="$1" label="$2" driver="$3" overrides="$4"
  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing

  if [ "$overrides" = "__PENDING__" ]; then
    _tg_write_activation_for_request "$request_path" "$driver"
    local attempt_id activation_path
    attempt_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).initial_attempt_id)' "$request_path")"
    activation_path="$(dirname "$request_path")/activations/$attempt_id.json"
    ln "$activation_path" "$activation_path.extra-hardlink-$(_random_hex32)"
  else
    _tg_write_activation_for_request_tampered "$request_path" "$driver" "$overrides"
  fi

  local cmd
  case "$subcommand" in
    claim)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session "tg-tamper-worker")" ;;
    lease-heartbeat)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" lease-heartbeat --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json")" ;;
    publish-result)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" publish-result --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json" --content aGVsbG8)" ;;
  esac

  local grants_before grants_after
  grants_before="$(ls -1 "$(_role_command_grants_dir)" 2>/dev/null | wc -l | tr -d ' ')"
  _make_input "$cmd" arch-testing "tg-tamper-${subcommand}-caller"
  _run_hook
  grants_after="$(ls -1 "$(_role_command_grants_dir)" 2>/dev/null | wc -l | tr -d ' ')"

  local reason=""
  if [ "$status" -ne 0 ]; then
    reason="hook-exit-nonzero:$status"
  elif ! node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.exit(1); }
    if (!body || typeof body !== "object") process.exit(1);
    if (Object.prototype.hasOwnProperty.call(body, "decision")) process.exit(1);
    const hso = body.hookSpecificOutput;
    if (!hso || hso.hookEventName !== "PreToolUse") process.exit(1);
    if (hso.permissionDecision !== "deny") process.exit(1);
    if (typeof hso.permissionDecisionReason !== "string" || hso.permissionDecisionReason.length === 0) process.exit(1);
  ' "$output"; then
    reason="not-a-genuine-deny:$output"
  elif [ "$grants_after" != "$grants_before" ]; then
    reason="grant-count-changed:${grants_before}->${grants_after}"
  fi

  if [ -n "$reason" ]; then
    printf '%s: %s\n' "$label" "$reason"
    return 1
  fi
  return 0
}

# Stage C table-driven negative coverage (required_red_before_green item 2):
# for `subcommand`, every one of these 9 rows across 6 dimensions (PENDING,
# request_digest, lease_epoch, profile digest, routing version, routing
# digest, driver/native coherence, created_at/expiry x2) must deny with zero
# grant. Mints ONE shared RoleActorBinding for the whole table (see
# _tg_run_tamper_case's own header for why per-row minting is wrong) --
# 300s TTL comfortably covers 9 sequential real hook subprocess spawns.
# Excludes the claude-agent-driver native-coherence sub-case deliberately: no
# ClaudeOneShotBinding is ever minted in this fixture universe, so that
# sub-case denies identically before AND after the fix ("no single live
# ClaudeOneShotBinding") regardless of native_spawn_action_id -- it cannot
# discriminate RED from GREEN through the hook. Covered instead by
# TG-ACTIVATION-COHERENCE-DIRECT-* below, which calls
# resolveActivationForRequestPath directly (no binding-selection layer to
# mask the result).
#
# TTL is 60s (the same value every other test in this file uses), NOT a
# longer value picked "to be safe": empirically, createRoleActorBinding
# rejects a 300s TTL outright (reason:"invalid-ttl") -- and since the fixture
# helper's stderr was piped to /dev/null with no exit-code check, that mint
# failure was SILENT, leaving zero live bindings for the whole table and
# denying every row for "no single live RoleActorBinding" -- a second,
# different way for this harness to mask the real defect (first draft's own
# bug was the opposite: too MANY live bindings from per-row minting). Caught
# by manually replicating one row outside bats and printing every
# intermediate value. Guarded now: a mint failure aborts the table loudly.
_tg_run_tamper_table() {
  local subcommand="$1"
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  local mint_out
  mint_out="$(_mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60)"
  if [ -z "$mint_out" ]; then
    printf 'SETUP FAILURE: _mint_role_actor_binding produced no binding_id for %s table\n' "$subcommand"
    return 1
  fi

  local near_future all_zero_hex64 alt_hex64_1 alt_hex64_2 fake_native_hex32 far_expiry
  # Stage D (M7-FINAL-REMEDIATION-20260818, D8a mutation-survival finding):
  # +1h was ALSO caught by the separate created_at<=activation_liveness_expiry
  # check (activationLivenessDeadline's own ~300s window from the request's
  # real created_at), so removing ONLY the not-in-the-future condition in
  # production left this row still denying -- a genuine mutant-survival gap,
  # not a false pass. +30s stays inside that same ~300s window while still
  # being strictly in the future relative to "now", isolating the
  # not-in-the-future check on its own.
  near_future="$(node -e 'process.stdout.write(new Date(Date.now()+30000).toISOString().replace(/\.\d{3}Z$/,"Z"))')"
  far_expiry="2099-01-01T00:00:00Z"
  all_zero_hex64="$(node -e 'process.stdout.write("0".repeat(64))')"
  alt_hex64_1="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  alt_hex64_2="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  fake_native_hex32="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  # Stage D (M7-FINAL-REMEDIATION-20260818, D9d mutation-survival finding):
  # the pre-existing driver_native-nonclaude_has_native row only ever
  # tampers native_spawn_action_id -- a mutation removing ONLY the
  # non-Claude native_target_binding_id===null check had zero discriminating
  # coverage in this table before this row existed. Found by actually
  # applying that mutation and observing it survive, not assumed.
  local fake_binding_hex32; fake_binding_hex32="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"

  local failures=()

  local pending_out
  if ! pending_out="$(_tg_run_tamper_case "$subcommand" pending noop "__PENDING__")"; then
    failures+=("$pending_out")
  fi

  local row
  for row in \
    "request_digest-mismatch|noop|{\"request_digest\":\"$all_zero_hex64\"}" \
    "lease_epoch-mismatch|noop|{\"lease_epoch\":999}" \
    "profile_digest-mismatch|noop|{\"target_role_profile_digest\":\"$alt_hex64_1\"}" \
    "routing_version-mismatch|noop|{\"routing_policy_version\":\"runtime-routing/v2-tampered\"}" \
    "routing_digest-mismatch|noop|{\"routing_policy_digest\":\"$alt_hex64_2\"}" \
    "driver_native-nonclaude_has_native|noop|{\"native_spawn_action_id\":\"$fake_native_hex32\"}" \
    "driver_native-nonclaude_has_target_binding|noop|{\"native_target_binding_id\":\"$fake_binding_hex32\"}" \
    "created_at-future|noop|{\"created_at\":\"$near_future\"}" \
    "expiry-mismatch|noop|{\"activation_liveness_expiry\":\"$far_expiry\"}" \
  ; do
    local label driver overrides out
    label="${row%%|*}"; row="${row#*|}"
    driver="${row%%|*}"; overrides="${row#*|}"
    if ! out="$(_tg_run_tamper_case "$subcommand" "$label" "$driver" "$overrides")"; then
      failures+=("$out")
    fi
  done

  if [ "${#failures[@]}" -ne 0 ]; then
    printf 'FAILING DIMENSIONS for %s (%d/10):\n' "$subcommand" "${#failures[@]}"
    printf '  %s\n' "${failures[@]}"
    return 1
  fi
  return 0
}

# ══════════════════════════════════════════════════════════════════════════
# Stage C (M7-FINAL-REMEDIATION-20260818) RED: table-driven negative coverage
# for the activation_resolution defect -- resolveActivationForRequestPath
# currently only checks request_id/attempt_id/expiry (Codex's sequence-4
# architecture_ruling), so PENDING and 9 field-tamper rows across request_
# digest/lease_epoch/profile digest/routing version+digest/driver-native
# coherence/created_at/expiry currently do NOT deny -- these three tests are
# RED against pre-fix production and must go GREEN, unmodified, once
# resolveActivationForRequestPath enforces the full DURABLE_PRESENT
# predicate. Each preserves the pre-existing ABSENT/DECORRELATED/EXPIRED
# coverage above untouched (TG-*-1-ABSENT-BLOCKS,
# TG-CLAIM-1-DECORRELATED-BLOCKS, TG-CLAIM-1-EXPIRED-BLOCKS).
# ══════════════════════════════════════════════════════════════════════════

@test "TG-CLAIM-TAMPER-TABLE BLOCK: 'claim' denies with zero grant under PENDING and every field-tamper dimension on the request-resolved activation" {
  run _tg_run_tamper_table claim
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-LEASE-TAMPER-TABLE BLOCK: 'lease-heartbeat' denies with zero grant under PENDING and every field-tamper dimension on the request-resolved activation" {
  run _tg_run_tamper_table lease-heartbeat
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-PUBLISH-TAMPER-TABLE BLOCK: 'publish-result' denies with zero grant under PENDING and every field-tamper dimension on the request-resolved activation" {
  run _tg_run_tamper_table publish-result
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

# Direct-call driver/native-coherence coverage (required_red_before_green
# item 2's remaining named dimension, not coverable through the hook -- see
# _tg_run_tamper_table's own header for why the claude-agent sub-case is
# excluded from the table above). Calls resolveActivationForRequestPath
# directly against a real, durable, on-disk request+activation pair -- no
# binding-selection layer downstream to mask the result either way.
@test "TG-ACTIVATION-COHERENCE-DIRECT-1 BLOCK: resolveActivationForRequestPath rejects a claude-agent-driver activation whose native_spawn_action_id is null" {
  local txn_id request_path
  txn_id="$(_random_hex32)"
  request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request_tampered "$request_path" claude-agent '{"native_spawn_action_id":null}'
  run node -e '
    const rc = require(process.argv[1]);
    const result = rc.resolveActivationForRequestPath(process.argv[2]);
    process.stdout.write(JSON.stringify(result));
    process.exit(result.ok === false ? 0 : 1);
  ' "$CONSULTATION_CLI" "$request_path"
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-ACTIVATION-COHERENCE-DIRECT-2 BLOCK: resolveActivationForRequestPath rejects a non-claude-agent-driver activation whose native_spawn_action_id is non-null" {
  local txn_id request_path fake_native
  txn_id="$(_random_hex32)"
  request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  fake_native="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request_tampered "$request_path" noop "{\"native_spawn_action_id\":\"$fake_native\"}"
  run node -e '
    const rc = require(process.argv[1]);
    const result = rc.resolveActivationForRequestPath(process.argv[2]);
    process.stdout.write(JSON.stringify(result));
    process.exit(result.ok === false ? 0 : 1);
  ' "$CONSULTATION_CLI" "$request_path"
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-ACTIVATION-COHERENCE-DIRECT-3 PASS: resolveActivationForRequestPath still resolves a genuinely COHERENT claude-agent-driver activation (real 32-hex native_spawn_action_id, native_target_binding_id null) -- regression guard against the coherence gate over-rejecting" {
  local txn_id request_path
  txn_id="$(_random_hex32)"
  request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request "$request_path" claude-agent
  run node -e '
    const rc = require(process.argv[1]);
    const result = rc.resolveActivationForRequestPath(process.argv[2]);
    process.stdout.write(JSON.stringify(result));
    process.exit(result.ok === true && result.activation !== null ? 0 : 1);
  ' "$CONSULTATION_CLI" "$request_path"
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

# Stage D (M7-FINAL-REMEDIATION-20260818, mutation D9-DRIVER-NATIVE
# coverage-gap finding): DIRECT-1/-2 exercise native_spawn_action_id only --
# neither ever sets a non-null native_target_binding_id on a claude-agent-
# driver record, so a mutation removing ONLY the claude-agent
# native_target_binding_id===null check had zero discriminating coverage
# before this test existed. Found by actually applying that mutation during
# Stage D mutation testing and observing it survive, not assumed.
@test "TG-ACTIVATION-COHERENCE-DIRECT-4 BLOCK: resolveActivationForRequestPath rejects a claude-agent-driver activation whose native_target_binding_id is non-null (even with an otherwise-valid native_spawn_action_id)" {
  local txn_id request_path fake_binding_id
  txn_id="$(_random_hex32)"
  request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  fake_binding_id="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request_tampered "$request_path" claude-agent "{\"native_target_binding_id\":\"$fake_binding_id\"}"
  run node -e '
    const rc = require(process.argv[1]);
    const result = rc.resolveActivationForRequestPath(process.argv[2]);
    process.stdout.write(JSON.stringify(result));
    process.exit(result.ok === false ? 0 : 1);
  ' "$CONSULTATION_CLI" "$request_path"
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

# ══════════════════════════════════════════════════════════════════════════
# Stage C (M7-FINAL-REMEDIATION-20260818) RED: exact-scope coverage
# (required_red_before_green item 3). Today findLiveRoleActorBindings is
# queried with the CALLING agentType/current worktree/current plan -- it
# never cross-checks the REQUEST's own claimed target_role/subject_worktree_
# id/plan_digest at all. A live RoleActorBinding for the CALLER's real
# identity therefore still gets found and granted even when the request it
# is being used against claims a DIFFERENT role/worktree/plan scope
# entirely. The activation itself is left genuinely coherent in every row
# (written by _tg_write_activation_for_request AFTER the tampered request,
# so its digest/profile/routing fields correlate with the ACTUAL, tampered
# request bytes) -- only the request's own scope-identifying fields disagree
# with the calling context, isolating this from the field-tamper dimensions
# TG-*-TAMPER-TABLE already covers.
# ══════════════════════════════════════════════════════════════════════════

# $1=subcommand $2=label $3=request_overrides_json
_tg_run_scope_mismatch_case() {
  local subcommand="$1" label="$2" overrides="$3"
  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request_tampered "$request_path" arch-testing "$overrides"
  _tg_write_activation_for_request "$request_path" noop

  local cmd
  case "$subcommand" in
    claim)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session "tg-scope-worker")" ;;
    lease-heartbeat)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" lease-heartbeat --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json")" ;;
    publish-result)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" publish-result --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json" --content aGVsbG8)" ;;
  esac

  local grants_before grants_after
  grants_before="$(ls -1 "$(_role_command_grants_dir)" 2>/dev/null | wc -l | tr -d ' ')"
  _make_input "$cmd" arch-testing "tg-scope-${subcommand}-caller"
  _run_hook
  grants_after="$(ls -1 "$(_role_command_grants_dir)" 2>/dev/null | wc -l | tr -d ' ')"

  local reason=""
  if [ "$status" -ne 0 ]; then
    reason="hook-exit-nonzero:$status"
  elif ! node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.exit(1); }
    if (!body || typeof body !== "object") process.exit(1);
    if (Object.prototype.hasOwnProperty.call(body, "decision")) process.exit(1);
    const hso = body.hookSpecificOutput;
    if (!hso || hso.hookEventName !== "PreToolUse") process.exit(1);
    if (hso.permissionDecision !== "deny") process.exit(1);
    if (typeof hso.permissionDecisionReason !== "string" || hso.permissionDecisionReason.length === 0) process.exit(1);
  ' "$output"; then
    reason="not-a-genuine-deny:$output"
  elif [ "$grants_after" != "$grants_before" ]; then
    reason="grant-count-changed:${grants_before}->${grants_after}"
  fi

  if [ -n "$reason" ]; then
    printf '%s: %s\n' "$label" "$reason"
    return 1
  fi
  return 0
}

_tg_run_scope_mismatch_table() {
  local subcommand="$1"
  local worktree_id plan_digest gen_id mint_out
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  mint_out="$(_mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60)"
  if [ -z "$mint_out" ]; then
    printf 'SETUP FAILURE: _mint_role_actor_binding produced no binding_id for %s scope table\n' "$subcommand"
    return 1
  fi

  local alt_worktree alt_plan
  alt_worktree="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  alt_plan="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"

  local failures=()
  local row
  for row in \
    "target_role-mismatch|{\"target_role\":\"toolkit-specialist\"}" \
    "worktree_id-mismatch|{\"subject_worktree_id\":\"$alt_worktree\"}" \
    "plan_digest-mismatch|{\"plan_digest\":\"$alt_plan\"}" \
  ; do
    local label overrides out
    label="${row%%|*}"; overrides="${row#*|}"
    if ! out="$(_tg_run_scope_mismatch_case "$subcommand" "$label" "$overrides")"; then
      failures+=("$out")
    fi
  done

  if [ "${#failures[@]}" -ne 0 ]; then
    printf 'FAILING SCOPE DIMENSIONS for %s (%d/3):\n' "$subcommand" "${#failures[@]}"
    printf '  %s\n' "${failures[@]}"
    return 1
  fi
  return 0
}

@test "TG-CLAIM-SCOPE-TABLE BLOCK: 'claim' denies with zero grant when the request-resolved target_role/worktree_id/plan_digest disagrees with the calling identity/current project scope, even though a live RoleActorBinding for the CALLER's own real identity exists" {
  run _tg_run_scope_mismatch_table claim
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-LEASE-SCOPE-TABLE BLOCK: 'lease-heartbeat' denies with zero grant when the request-resolved target_role/worktree_id/plan_digest disagrees with the calling identity/current project scope" {
  run _tg_run_scope_mismatch_table lease-heartbeat
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-PUBLISH-SCOPE-TABLE BLOCK: 'publish-result' denies with zero grant when the request-resolved target_role/worktree_id/plan_digest disagrees with the calling identity/current project scope" {
  run _tg_run_scope_mismatch_table publish-result
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

# The claude-agent branch can never be proven via "denies with zero grant"
# alone (see _tg_run_tamper_table's own header): no ClaudeOneShotBinding is
# ever minted in this fixture universe, so a claude-agent-driver activation
# ALREADY denies today with "no single live ClaudeOneShotBinding..." --
# before AND after the fix, for an unrelated reason. This test instead
# discriminates on the DENY REASON TEXT itself: today the scope mismatch is
# never checked before that classifier lookup runs, so the reason can only
# ever be the classifier's own generic one; once the universal scope gate
# lands immediately after activation resolution (Codex's own ruling: "This
# universal scope gate applies to claude-agent and every non-Claude
# driver"), the SAME tampered request must instead be denied by the scope
# gate's own reason, before the classifier is ever reached.
@test "TG-CLAIM-SCOPE-CLAUDE-AGENT BLOCK: 'claim' against a target_role-mismatched request with a claude-agent-driver activation is denied by the SCOPE gate specifically, not merely by the downstream 'no live ClaudeOneShotBinding' classifier lookup" {
  local txn_id request_path
  txn_id="$(_random_hex32)"
  request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request_tampered "$request_path" arch-testing '{"target_role":"toolkit-specialist"}'
  _tg_write_activation_for_request "$request_path" claude-agent

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-scope-claude-worker)"
  _make_input "$cmd" arch-testing tg-scope-claude-caller
  _run_hook
  _assert_pretooluse_deny
  local reason; reason="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).hookSpecificOutput.permissionDecisionReason)' "$output")"
  [[ "$reason" == *"target_role/worktree_id/plan_digest"* ]] || { echo "reason was: $reason" >&2; false; }
}

# M7/WP4 hook-protocol cleanup: asserts a genuine PreToolUse deny per the
# official contract (code.claude.com/docs/en/hooks) against the last `run`
# ($status/$output) -- exit 0, hookSpecificOutput.hookEventName:"PreToolUse",
# permissionDecision:"deny", a non-empty permissionDecisionReason, and no
# deprecated top-level "decision" field. Never merely `[ "$status" -eq 2 ]`.
_assert_pretooluse_deny() {
  [ "$status" -eq 0 ]
  node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.stderr.write("not JSON: " + e.message + "\n"); process.exit(1); }
    if (!body || typeof body !== "object") { process.stderr.write("body not an object\n"); process.exit(1); }
    if (Object.prototype.hasOwnProperty.call(body, "decision")) { process.stderr.write("deprecated top-level decision field present\n"); process.exit(1); }
    const hso = body.hookSpecificOutput;
    if (!hso || hso.hookEventName !== "PreToolUse") { process.stderr.write("hookEventName mismatch: " + JSON.stringify(hso) + "\n"); process.exit(1); }
    if (hso.permissionDecision !== "deny") { process.stderr.write("permissionDecision mismatch: " + JSON.stringify(hso) + "\n"); process.exit(1); }
    if (typeof hso.permissionDecisionReason !== "string" || hso.permissionDecisionReason.length === 0) { process.stderr.write("permissionDecisionReason missing/empty\n"); process.exit(1); }
  ' "$output"
}

# ══════════════════════════════════════════════════════════════════════════
# Lifecycle target surface: `ready` only. Design UNCHANGED by this pass
# (COMMAND_FLAGS-extension only applies to runtime-consultation.cjs;
# runtime-role-lifecycle.cjs's own --lifecycle-binding slot already existed).
# ══════════════════════════════════════════════════════════════════════════

@test "TG-READY-1 PASS: 'ready' end-to-end through a real RoleActorBinding mints+injects --lifecycle-binding, genuinely round-trip-consumable" {
  local out action_id worktree_id plan_digest gen_id
  out="$(_mint_pending_role_spawn_full arch-testing tg-ready-1-session)"
  read -r action_id worktree_id plan_digest gen_id <<< "$out"
  [ -n "$action_id" ]
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local cmd; cmd="$(_render_posix_direct node "$RLL_IMPL" ready --action "$action_id")"
  _make_input "$cmd" arch-testing tg-ready-1-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  local grant_id; grant_id="$(_extract_injected lifecycle-binding)"
  [ -n "$grant_id" ]

  # Genuine round-trip proof via the SAME exported validator the real CLI
  # itself uses -- never a shape-only check on the hook's own stdout.
  run node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const argvDigest = crypto.createHash("sha256").update("ready:" + process.argv[3]).digest("hex");
    const result = rll.validateAndConsumeLifecycleCommandGrant(process.argv[2], process.argv[4], argvDigest, "arch-testing", "ready", process.argv[3]);
    if (!result.ok) { process.stderr.write(JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJ" "$action_id" "$grant_id"
  [ "$status" -eq 0 ]
}

@test "TG-READY-ABSOLUTE-NODE PASS: accepted resolved-Node bootstrap command mints+injects --lifecycle-binding" {
  local out action_id worktree_id plan_digest gen_id
  out="$(_mint_pending_role_spawn_full arch-testing tg-ready-absolute-node-session)"
  read -r action_id worktree_id plan_digest gen_id <<< "$out"
  [ -n "$action_id" ]
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local resolved_node
  resolved_node="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.resolvedNodePath());' "$RLL_IMPL")"
  [ -n "$resolved_node" ]
  [[ "$resolved_node" = /* ]]

  local cmd; cmd="$(_render_posix_direct "$resolved_node" "$RLL_IMPL" ready --action "$action_id")"
  _make_input "$cmd" arch-testing tg-ready-absolute-node-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  local grant_id; grant_id="$(_extract_injected lifecycle-binding)"
  [ -n "$grant_id" ]

  run node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const argvDigest = crypto.createHash("sha256").update("ready:" + process.argv[3]).digest("hex");
    const result = rll.validateAndConsumeLifecycleCommandGrant(process.argv[2], process.argv[4], argvDigest, "arch-testing", "ready", process.argv[3]);
    if (!result.ok) { process.stderr.write(JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJ" "$action_id" "$grant_id"
  [ "$status" -eq 0 ]
}

@test "TG-READY-2 BLOCK: a caller-supplied --lifecycle-binding on a 'ready' command is rejected outright, never trusted" {
  local out action_id worktree_id plan_digest gen_id
  out="$(_mint_pending_role_spawn_full arch-testing tg-ready-2-session)"
  read -r action_id worktree_id plan_digest gen_id <<< "$out"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  local forged; forged="$(_random_hex32)"

  local cmd; cmd="$(_render_posix_direct node "$RLL_IMPL" ready --action "$action_id" --lifecycle-binding "$forged")"
  _make_input "$cmd" arch-testing tg-ready-2-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-READY-3 BLOCK: 'ready' for a nonexistent action is a lookup failure inside an owning flow -- blocks, never falls through to passthrough" {
  local bogus_action; bogus_action="$(_random_hex32)"
  local cmd; cmd="$(_render_posix_direct node "$RLL_IMPL" ready --action "$bogus_action")"
  _make_input "$cmd" arch-testing tg-ready-3-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-READY-4 BLOCK: 'ready' for an action whose kind is not role-spawn/role-rebind (e.g. role-notify) is pre-validated and blocked here too, never minted" {
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["claude-sendmessage"]' \
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "tg-ready-4-session" };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    const bindingResult = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planResult.planDigest, 120);
    const genResult = rll.resolveSessionGeneration(projectRoot, identity);
    const repoId = rll.computeRepoId(projectRoot);
    const pair = rll.resolvePolicyPair(projectRoot);
    const policyDigest = require("crypto").createHash("sha256").update(JSON.stringify(pair.routing)).digest("hex");
    const actionId = rll.generateActionId();
    const payload = rll.buildRoleNotifyPayload(bindingResult.binding.binding_id, "arch-testing", "fixture-ref", "context", "fixture message");
    const expiresAtIso = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const mintResult = rll.mintRoleLifecycleAction(projectRoot, actionId, "role-notify", "claude-native", repoId, worktreeId, planResult.planDigest, policyDigest, genResult.generationId, "arch-testing", payload, expiresAtIso);
    if (!mintResult.ok) { process.stderr.write("mint failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(actionId);
  ' "$RLL_IMPL" "$PROJ"
  [ "$status" -eq 0 ]
  local action_id="$output"
  [ -n "$action_id" ]

  local cmd; cmd="$(_render_posix_direct node "$RLL_IMPL" ready --action "$action_id")"
  _make_input "$cmd" arch-testing tg-ready-4-caller
  _run_hook
  _assert_pretooluse_deny
}

# P0 (HARD NO-GO finding #4, corrected this pass): "ready can resolve a
# same-named binding." findLiveRoleActorBindings (called from
# handleReadyOwning) scopes ONLY by {role, worktree_id, plan_digest} --
# validateRoleActorBindingFor's own signature has NO sessionGenerationId
# parameter at all (confirmed by direct read) -- so a SINGLE live binding
# whose session_generation_id does NOT match the target action's own is
# happily accepted today: candidates.length===1, no ambiguity ever fires,
# and the wrong-generation binding is used to mint a real, valid grant. This
# is the exact "resolve a same-named binding" gap: not two simultaneously-
# live bindings (TG-CONSULT-AMBIGUOUS's own scenario, already blocked), but
# ONE live binding that is honestly the WRONG one for this action.
@test "TG-READY-WRONG-GENERATION BLOCK: exactly one live RoleActorBinding exists for {role,worktree,plan}, but its session_generation_id does NOT match the target action's own -- must block, never silently accepted as if it were the action's real binding" {
  local out action_id worktree_id plan_digest gen_id
  out="$(_mint_pending_role_spawn_full arch-testing tg-readywronggen-session)"
  read -r action_id worktree_id plan_digest gen_id <<< "$out"
  [ -n "$action_id" ]

  # A single live binding for the identical {role, worktree, plan} scope, but
  # deliberately minted under a DIFFERENT (stale/foreign) session_generation_id
  # than the one the target action actually carries -- e.g. left over from an
  # earlier spawn attempt of the same role that was later rebound/restarted.
  local wrong_gen; wrong_gen="$(_random_hex32)"
  [ "$wrong_gen" != "$gen_id" ]
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$wrong_gen" 60

  local cmd; cmd="$(_render_posix_direct node "$RLL_IMPL" ready --action "$action_id")"
  _make_input "$cmd" arch-testing tg-readywronggen-caller
  _run_hook
  _assert_pretooluse_deny

  # Regression/positive-control half: the SAME action, once the CORRECT
  # (matching-generation) binding also exists (both simultaneously live is
  # itself the pre-existing TG-CONSULT-AMBIGUOUS-style multiplicity case, so
  # this half is proven via a FRESH action/session pair instead) still
  # succeeds when its own binding's generation genuinely matches.
  local out2 action_id2 worktree_id2 plan_digest2 gen_id2
  out2="$(_mint_pending_role_spawn_full arch-testing tg-readywronggen-session-2)"
  read -r action_id2 worktree_id2 plan_digest2 gen_id2 <<< "$out2"
  _mint_role_actor_binding arch-testing "$worktree_id2" "$plan_digest2" "$gen_id2" 60
  local cmd2; cmd2="$(_render_posix_direct node "$RLL_IMPL" ready --action "$action_id2")"
  _make_input "$cmd2" arch-testing tg-readywronggen-caller-2
  _run_hook
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Consultation target surface: claim / lease-heartbeat / publish-result /
# worker-stop-ack. CORRECTED DESIGN (supersedes the first-pass "no injection"
# conclusion, see file header): the hook now mints+INJECTS a real
# --target-binding <id> flag, mirroring the `ready` surface exactly, and the
# CORE (runtime-consultation.cjs) now genuinely receives+consumes+validates
# it before any read or mutation.
# ══════════════════════════════════════════════════════════════════════════

@test "TG-CLAIM-1 PASS: a real 'claim' invocation with a live RoleActorBinding for the calling role AND a live, correlated, non-claude-agent activation gets --target-binding INJECTED, and the injected flag is genuinely recognized/processed by the REAL production CLI (never rejected as an unrecognized flag)" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: claim/lease-heartbeat/publish-result now
  # REQUIRE a resolvable, live activation (genuine absence blocks -- see
  # TG-CLAIM-1-ABSENT-BLOCKS below) -- a real, correlated, non-claude-agent
  # activation is the precondition for reaching the RoleActorBinding branch.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-claim-1-worker-session)"
  _make_input "$cmd" arch-testing tg-claim-1-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  # The command IS rewritten now (design correction: claim gains a real
  # --target-binding landing spot on COMMAND_FLAGS) -- pre-fix (pre-fix) the
  # hook still returns the unmodified command (no injection exists yet), so
  # this is the exact regression: no --target-binding is present to extract.
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"
  [ "$rewritten" != "$cmd" ]

  # Round trip via the real production CLI subprocess -- proves the flag is
  # genuinely recognized argv (COMMAND_FLAGS extended), never rejected at the
  # parse layer. NOT asserting full business-level SUCCESS here deliberately:
  # this fixture's --request path has no real request.json behind it (this
  # test's own scope is the GRANT layer, not full transaction-state-machine
  # setup), so even a fully-correct implementation would still fail later on
  # CORRELATION_INVALID ("no such request") -- asserting full success would
  # make this test permanently un-greenable for a reason unrelated to grants.
  # "never unrecognized-flag" is the precise, achievable, honest claim: pre-fix
  # this fails with exactly "unrecognized flag for claim: --target-binding"
  # (a USAGE_ERROR at the argv-parsing layer, before ANY grant logic could
  # even run) -- once COMMAND_FLAGS is extended, the SAME command must get
  # past that layer entirely, regardless of what happens next.
  _run_cli_command "$rewritten"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
}

@test "TG-LEASE-1 PASS: a real 'lease-heartbeat' invocation with a live RoleActorBinding gets --target-binding INJECTED and round-trips through the REAL production CLI" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" lease-heartbeat --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json")"
  _make_input "$cmd" arch-testing tg-lease-1-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"
  [ "$rewritten" != "$cmd" ]

  # No live request/claim exists for this fixture (this test's own scope is
  # the GRANT layer, not full transaction-state-machine setup) -- the real
  # CLI is expected to fail on CORRELATION_INVALID (no such request/claim),
  # never on the GRANT itself. The discriminator that proves the grant layer
  # passed is that it fails for a DIFFERENT, later reason than "unrecognized
  # flag" -- captured precisely by TG-CLAIM-1's own full-success round trip
  # above (a real request DOES exist there); this test instead pins that the
  # flag itself is now a real, recognized landing spot (never USAGE_ERROR/
  # unrecognized-flag) once the fix lands.
  _run_cli_command "$rewritten"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
}

@test "TG-PUBLISH-1 PASS: a real 'publish-result' invocation with a live RoleActorBinding gets --target-binding INJECTED (round-trip proof mirrors TG-LEASE-1: real flag recognition, never unrecognized-flag)" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" publish-result --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json" --content aGVsbG8)"
  _make_input "$cmd" arch-testing tg-publish-1-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"
  [ "$rewritten" != "$cmd" ]

  _run_cli_command "$rewritten"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 GREEN correction round 2, R5: negative table for claim/lease-heartbeat/
# publish-result. Each of these three commands must now BLOCK with zero
# grant when the request's own activation is genuinely ABSENT, DECORRELATED
# (present but wrong request/attempt), or EXPIRED -- never a silent
# RoleActorBinding fallback. A live RoleActorBinding is minted in every case
# below specifically to prove the block is NOT merely "no RoleActorBinding
# either" -- the activation-resolution gate itself is what denies.
# ══════════════════════════════════════════════════════════════════════════

@test "TG-CLAIM-1-ABSENT-BLOCKS: 'claim' against a request with NO activation record at all is blocked with zero grant -- correction round 2's R5 ruling reverses the prior 'absence allowed' design" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-claim-absent-worker-session)"
  _make_input "$cmd" arch-testing tg-claim-absent-caller
  _run_hook
  _assert_pretooluse_deny
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -z "$grant_id" ]
}

@test "TG-LEASE-1-ABSENT-BLOCKS: 'lease-heartbeat' against a request with NO activation record at all is blocked with zero grant -- correction round 2's R5 ruling" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" lease-heartbeat --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json")"
  _make_input "$cmd" arch-testing tg-lease-absent-caller
  _run_hook
  _assert_pretooluse_deny
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -z "$grant_id" ]
}

@test "TG-PUBLISH-1-ABSENT-BLOCKS: 'publish-result' against a request with NO activation record at all is blocked with zero grant -- correction round 2's R5 ruling" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" publish-result --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json" --content aGVsbG8)"
  _make_input "$cmd" arch-testing tg-publish-absent-caller
  _run_hook
  _assert_pretooluse_deny
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -z "$grant_id" ]
}

@test "TG-CLAIM-1-DECORRELATED-BLOCKS: 'claim' against a request whose activation record lives at the CORRECT resolved-attempt path but carries a mismatched embedded request_id is blocked with zero grant, never silently folded into ABSENT/RoleActor fallback -- correction round 2's R5 ruling" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request "$request_path" noop
  local real_attempt_id; real_attempt_id="$(printf 'f%.0s' $(seq 1 64))"
  local activation_path; activation_path="$(dirname "$request_path")/activations/$real_attempt_id.json"
  # Tamper the activation's OWN embedded request_id, in place, at the exact
  # CORRECT path (activationPathFor(txnDir, resolvedAttemptId) still finds
  # this file -- DURABLE_PRESENT) -- proves the resolver checks the
  # record's own content correlation, never merely "something exists at the
  # expected path".
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    obj.request_id = "9".repeat(64);
    fs.writeFileSync(p, JSON.stringify(obj), { mode: 0o600 });
  ' "$activation_path"

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-claim-decorrelated-worker-session)"
  _make_input "$cmd" arch-testing tg-claim-decorrelated-caller
  _run_hook
  _assert_pretooluse_deny
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -z "$grant_id" ]
}

@test "TG-CLAIM-1-EXPIRED-BLOCKS: 'claim' against a request whose ONLY correlated activation is already past its own activation_liveness_expiry is blocked with zero grant, never treated as still valid -- correction round 2's R5 ruling" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request "$request_path" noop
  local real_attempt_id; real_attempt_id="$(printf 'f%.0s' $(seq 1 64))"
  local activation_path; activation_path="$(dirname "$request_path")/activations/$real_attempt_id.json"
  # Rewrite activation_liveness_expiry to genuinely already past.
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    obj.activation_liveness_expiry = new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, "Z");
    fs.writeFileSync(p, JSON.stringify(obj), { mode: 0o600 });
  ' "$activation_path"

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-claim-expired-worker-session)"
  _make_input "$cmd" arch-testing tg-claim-expired-caller
  _run_hook
  _assert_pretooluse_deny
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -z "$grant_id" ]
}

@test "TG-STOPACK-1 PASS: a real 'worker-stop-ack' invocation with a live RoleActorBinding gets --target-binding INJECTED (round-trip proof mirrors TG-LEASE-1)" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local stop_path="$PROJ/.planning/coordination/stops/stop.json"
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" worker-stop-ack --coordination-root "$PROJ/.planning/coordination" --stop "$stop_path" --disposition exact-transaction)"
  _make_input "$cmd" arch-testing tg-stopack-1-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"
  [ "$rewritten" != "$cmd" ]

  _run_cli_command "$rewritten"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
}

@test "TG-CONSULT-NOBIND BLOCK: 'claim' with NO live RoleActorBinding for the calling role at all is a lookup failure inside an owning flow -- blocks, never passthrough" {
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --role arch-testing --worker-session tg-nobind-worker-session)"
  _make_input "$cmd" arch-testing tg-nobind-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-CONSULT-AMBIGUOUS BLOCK: two simultaneously-live RoleActorBindings for the identical {role,worktree,plan} scope deny as ambiguous, never silently pick one" {
  local worktree_id plan_digest
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  # Two independent, both-live bindings for the SAME exact scope -- neither
  # superseded, neither expired. Order of creation is irrelevant: a correct
  # fix collects ALL live candidates before deciding, so this is genuinely
  # deterministic regardless of directory-iteration order.
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$(_random_hex32)" 60
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$(_random_hex32)" 60

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --role arch-testing --worker-session tg-ambiguous-worker-session)"
  _make_input "$cmd" arch-testing tg-ambiguous-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-CONSULT-CALLERBINDING BLOCK: a caller-supplied --target-binding on an otherwise-real 'claim' command is rejected outright, never validated-and-allowed" {
  local worktree_id plan_digest gen_id forged
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  forged="$(_random_hex32)"

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --role arch-testing --worker-session tg-callerbind-worker-session --target-binding "$forged")"
  _make_input "$cmd" arch-testing tg-callerbind-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-CONSULT-WRONGFLAG BLOCK: a caller-supplied --lifecycle-binding (the OTHER grant flag) on a 'claim' command is ALSO rejected outright -- proves the check is not naively scoped to only one flag name" {
  local worktree_id plan_digest gen_id forged
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  forged="$(_random_hex32)"

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --role arch-testing --worker-session tg-wrongflag-worker-session --lifecycle-binding "$forged")"
  _make_input "$cmd" arch-testing tg-wrongflag-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-ACCEPT-RESULT-NONTARGET: 'accept-result' (requester-owned, PLAN.md §15b) is never treated as target-surface owning -- passthrough, zero side effects" {
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" accept-result --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json")"
  _make_input "$cmd" arch-testing tg-acceptresult-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "TG-TRANSACTION-ACK-NONTARGET: 'transaction-ack' (requester-owned, PLAN.md §15b) is never treated as target-surface owning -- passthrough, zero side effects" {
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" transaction-ack --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --disposition accepted)"
  _make_input "$cmd" arch-testing tg-transactionack-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "TG-STORAGE-LOCATION: a genuinely minted+injected target grant lives under registryRepoDir, never under .planning/ (host-private, never model-visible)" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-storage-worker-session)"
  _make_input "$cmd" arch-testing tg-storage-caller
  _run_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]

  # Never model-visible under .planning/ (the OLD, superseded design's own path).
  [ ! -d "$PROJ/.planning/coordination/target-grants" ]

  # Genuinely present under the host-private registry base for this repo, and
  # that base itself is never anywhere inside the project tree.
  local grants_dir; grants_dir="$(_role_command_grants_dir)"
  [ -n "$grants_dir" ]
  [[ "$grants_dir" != "$PROJ"* ]]
  [ -f "$grants_dir/$grant_id.json" ]
}

@test "TG-NONCANONICAL: a non-canonical (unquoted) 'claim' command is never recognized as owning -- allowed as ordinary passthrough, with EMPTY stdout (no hookSpecificOutput of any kind)" {
  local cmd="node $CONSULTATION_CLI claim --coordination-root $PROJ/.planning/coordination --request $PROJ/.planning/coordination/txn/request.json --role arch-testing --worker-session tg-noncanon-worker-session"
  _make_input "$cmd" arch-testing tg-noncanon-caller
  _run_hook
  [ "$status" -eq 0 ]
  # Under the corrected inject-a-real-flag design, a LEGITIMATELY recognized-
  # and-allowed claim call now ALWAYS emits a real JSON hookSpecificOutput
  # body carrying the injected --target-binding (see TG-CLAIM-1) -- so empty
  # stdout remains the correct, unambiguous discriminator for "never even
  # recognized as owning" specifically.
  [ -z "$output" ]
}

@test "TG-CHAINED: a chained 'claim' command (';' operator) is never recognized as owning -- no injection, never a security bypass via chaining, EMPTY stdout" {
  local base; base="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --role arch-testing --worker-session tg-chained-worker-session)"
  local cmd="$base; echo pwned"
  _make_input "$cmd" arch-testing tg-chained-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "TG-UNRELATED PASS: an unrelated Bash command (not a target-surface subcommand at all) is allowed, zero side effects" {
  _make_input "git status" arch-testing tg-unrelated-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ══════════════════════════════════════════════════════════════════════════
# CPG-SUPERVISOR (M6-CODEX-SUPERVISOR-ACTIVATION-CLOSURE, RED phase): argv-
# canonicalization negatives for context-provider-gate.js's (currently
# nonexistent) supervisor-start bridge_command recognition -- PLAN.md's own
# manifest names THIS file as the home for "the top-level-only background
# supervisor form... chained/redirection/extra-flag/background negatives"
# (~L195). The full semantic validation matrix (positive path, subagent,
# forged/expired/wrong-plan/wrong-worktree/cross-session, genuine
# SupervisorExecutionClaim/v1 round-trip) lives in context-provider-gate.
# test.js (M6 GROUP A section), mirroring its own established LG-*/RQ-*
# table-driven JS pattern; this section owns ONLY the bash-argv-shape
# negatives, mirroring bash-cli-spawn-gate.bats' own injection matrix but
# targeting context-provider-gate.js (_run_cp_hook, already defined above)
# instead of bash-cli-spawn-gate.js -- proving THIS hook's own (future)
# recognition is ALSO a positive allowlist, independently.
# ══════════════════════════════════════════════════════════════════════════

M6A_CAPABILITY="cpg-m6a-supervisor-fixture-capability"

# Mints a REAL batched 5-role supervisor-start action (the exact configured
# support-plane role set) via the actual production ensure()/grant machinery
# under a fake codex-app-server-only capability -- mirrors bash-cli-spawn-
# gate.bats' own _mint_action/_mint_supervisor_start_action precedent
# exactly (no CLAUDE-ID-01 priming needed for codex-app-server, confirmed:
# that file's own extensively-green fixture never primes it either). Prints
# the real bridge_command on stdout.
#
# LEAD FIX (mutation-testing pass, 2026-08-12): takes the session key as an
# explicit argument, used BOTH to mint the MainOrchestratorBinding here AND
# by every caller's own subsequent `_make_input ... <session>` invocation --
# the two must be the SAME session. The original version minted under an
# internally-generated random session while every call site invoked the hook
# under a DIFFERENT, hardcoded one; mutation testing caught that this
# mismatch alone (independent of any argv tampering) already triggers
# `main-binding-shape-mismatch`, verified directly: the SAME untampered
# bridge_command, replayed under a mismatched session with zero argv
# manipulation, is denied for that reason alone. That made the argv-specific
# checks these 4 tests are named for and the dispatch's own RED requirements
# describe unfalsifiable by this fixture -- a session mismatch would mask a
# broken/removed argv check and still show a passing "DENIED" assertion.
_m6a_mint_supervisor_start_action() {
  local session_key="$1"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$M6A_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const { execFileSync } = require("child_process");
    const projectRoot = process.argv[2];
    const sessionKey = process.argv[3];
    const roles = ["arch-platform","arch-testing","arch-integration","context-provider","doc-updater"];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionKey };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planDigest = rll.discoverPlan(projectRoot).planDigest;
    const binding = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planDigest, 120).binding;
    const sha256String = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
    const sortedRoles = roles.slice().sort();
    const argvDigest = sha256String("ensure:" + sortedRoles.join(","));
    const grant = rll.mintLifecycleCommandGrant(projectRoot, binding, argvDigest, sortedRoles, "ensure", "main-orchestrator", "orchestrator", "normal", null);
    const args = [process.argv[1], "ensure", "--project-root", projectRoot];
    for (const r of roles) args.push("--role", r);
    args.push("--lifecycle-binding", grant.grantId);
    const out = execFileSync("node", args, {
      encoding: "utf8",
      env: Object.assign({}, process.env, {
        HOME: process.argv[4],
        CODEX_CLI_PATH: process.argv[5],
        RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(["codex-app-server"]),
      }),
    });
    const result = JSON.parse(out.trim().split("\n").pop());
    // M67-ROLE-GATE-FLAKE-01: explicit shape/status assertions BEFORE ever
    // dereferencing the found action -- a missing/wrong-shaped action must
    // fail loudly with the full raw result, never collapse into a generic
    // "Cannot read properties of undefined" a few lines below that gives no
    // diagnostic signal at all about WHY the expected ACTION_REQUIRED
    // supervisor-start action was not where this fixture expects it.
    if (result.status !== "ACTION_REQUIRED") {
      process.stderr.write("M6A fixture: expected ensure() status ACTION_REQUIRED, got " + JSON.stringify(result));
      process.exit(1);
    }
    if (!Array.isArray(result.actions)) {
      process.stderr.write("M6A fixture: result.actions is not an array: " + JSON.stringify(result));
      process.exit(1);
    }
    const action = result.actions.find((a) => a.kind === "supervisor-start");
    if (!action || !action.payload || typeof action.payload.bridge_command !== "string" || action.payload.bridge_command.length === 0) {
      process.stderr.write("M6A fixture: no well-formed supervisor-start action with a non-empty bridge_command among the actions ensure() returned: " + JSON.stringify(result));
      process.exit(1);
    }
    process.stdout.write(action.payload.bridge_command);
  ' "$RLL_IMPL" "$PROJ" "$session_key" "$TEST_HOME" "$FAKE_CODEX"
}

@test "CPG-SUPERVISOR-EXTRAFLAG: an extra trailing flag appended to the canonical bridge_command is explicitly DENIED by context-provider-gate.js -- mirrors bash-cli-spawn-gate.js's own established recognition discipline (BRIDGE_MARKER_RE substring match -> full scrutiny -> fail-closed on non-round-trip, GATE-inject-extraflag's own precedent), independently enforced here" {
  local bridge_command; bridge_command="$(_m6a_mint_supervisor_start_action cpg-m6a-extraflag-session)"
  [ -n "$bridge_command" ]
  _make_input "${bridge_command} '--extra'" "" cpg-m6a-extraflag-session
  _run_cp_hook
  _assert_pretooluse_deny
}

@test "CPG-SUPERVISOR-CHAINED: a semicolon-chained second command appended to the canonical bridge_command is explicitly DENIED by context-provider-gate.js, never a security bypass via chaining (mirrors GATE-inject-semicolon's own precedent)" {
  local bridge_command; bridge_command="$(_m6a_mint_supervisor_start_action cpg-m6a-chained-session)"
  [ -n "$bridge_command" ]
  _make_input "${bridge_command}; rm -rf /tmp/whatever" "" cpg-m6a-chained-session
  _run_cp_hook
  _assert_pretooluse_deny
}

@test "CPG-SUPERVISOR-REDIRECT: an appended output redirect on the canonical bridge_command is explicitly DENIED by context-provider-gate.js (mirrors GATE-inject-redirect's own precedent)" {
  local bridge_command; bridge_command="$(_m6a_mint_supervisor_start_action cpg-m6a-redirect-session)"
  [ -n "$bridge_command" ]
  _make_input "${bridge_command} > /tmp/cpg-m6a-redirect-out" "" cpg-m6a-redirect-session
  _run_cp_hook
  _assert_pretooluse_deny
}

@test "CPG-SUPERVISOR-NONCANONICAL: a non-canonical (unquoted) rendering of the SAME underlying bridge_argv is explicitly DENIED by context-provider-gate.js -- canonical parser only, never a structurally-equivalent-but-differently-formatted match (mirrors GATE-inject-altquoting's own precedent)" {
  local bridge_command unquoted
  bridge_command="$(_m6a_mint_supervisor_start_action cpg-m6a-noncanonical-session)"
  [ -n "$bridge_command" ]
  unquoted="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.parsePosixDirect(process.argv[2]).join(" "));' "$RLL_IMPL" "$bridge_command")"
  [ "$unquoted" != "$bridge_command" ]
  _make_input "$unquoted" "" cpg-m6a-noncanonical-session
  _run_cp_hook
  _assert_pretooluse_deny
}

# ══════════════════════════════════════════════════════════════════════════
# RCG-SCHEMA: the exact PLAN.md §15b closed grant schema, verbatim.
# ══════════════════════════════════════════════════════════════════════════

@test "RCG-SCHEMA-CLOSED: a genuinely minted role-command-grant/v1 has EXACTLY the PLAN.md §15b closed key-set (schema,grant_id,binding_id,actor_instance_id,authority,subcommand,request_id,attempt_id,lease_epoch,canonical_argv_digest,plan_digest,worktree_id,role,created_at,expiry) -- no extra field (e.g. the prior pass's own ad-hoc stop_id), none missing (e.g. attempt_id/lease_epoch, absent entirely from the prior pass's grant object)" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session rcg-schema-worker-session)"
  _make_input "$cmd" arch-testing rcg-schema-caller
  _run_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]

  run node -e '
    const fs = require("fs");
    const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expected = ["actor_instance_id","attempt_id","authority","binding_id","canonical_argv_digest","created_at","expiry","grant_id","lease_epoch","plan_digest","request_id","role","schema","subcommand","worktree_id"];
    const actual = Object.keys(rec).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      process.stderr.write("key-set mismatch. expected=" + JSON.stringify(expected) + " actual=" + JSON.stringify(actual));
      process.exit(1);
    }
    if (rec.schema !== "runtime/role-command-grant/v1") { process.stderr.write("wrong schema: " + rec.schema); process.exit(1); }
    if (rec.authority !== "target") { process.stderr.write("wrong authority: " + rec.authority); process.exit(1); }
  ' "$(_role_command_grant_path "$grant_id")"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Requester/admin surface: root-init/root-validate (nullable request/attempt/
# epoch, PLAN.md ~L592) via context-provider-gate.js. Table-driven hook-only
# mechanics (rerender, internal mint failure, missing session_id, caller-
# supplied-flag rejection, per-subcommand coverage of every requester-owned
# subcommand) live in context-provider-gate.test.js -- this section owns the
# full hook-mint -> real-CLI-consume round trip and the PLAN §592 nullability
# contract specifically.
# ══════════════════════════════════════════════════════════════════════════

_admin_root_init_cmd() {
  _render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$PROJ/.planning/coordination"
}

@test "RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01 BLOCK: a main-orchestrator (role-null) 'root-init' invocation must NEVER get a --requester-binding minted -- main-orchestrator structurally cannot satisfy CLAUDE-ID-01 (PLAN.md ~L588: a bounded disposable peer must produce a host-private correlation trace covering SubagentStart, two distinct PreToolUse events, a sleep/wake or resume boundary, and a final PreToolUse), since the main orchestrator never receives a SubagentStart event about itself. Not merely a plausible inference: PLAN.md ~L594 independently defines the SEPARATE MainOrchestratorBinding/v1's own derivation as requiring 'no correlated pending SubagentStart' -- PLAN already treats absence-of-SubagentStart as main-orchestrator's own defining characteristic elsewhere, so this exclusion is CLAUDE-ID-01 applied uniformly, not a carve-out invented for this pass. M7/WP4 FINAL COMPLETENESS correction (2026-08-09): supersedes this test's own prior PASS expectation, which asserted the OPPOSITE (main-orchestrator minting succeeds) against the pre-CLAUDE-ID-01-enforcement implementation -- see runtime-role-lifecycle.cjs ~L1354-1386's own 'never CLAUDE-ID-01-gated' scope note for the (now-superseded) rationale that shipped createRequesterBinding without this check." {
  local cmd; cmd="$(_admin_root_init_cmd)"
  _make_input "$cmd" "" rcg-claudeid01-rootinit-session
  local grants_dir; grants_dir="$(_role_command_grants_dir)"
  local before=0
  [ -d "$grants_dir" ] && before="$(find "$grants_dir" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"

  _run_cp_hook
  _assert_pretooluse_deny

  # No side effect: main-orchestrator's disqualification must be decided
  # BEFORE any binding/grant is minted, never mint-then-discard.
  local after=0
  [ -d "$grants_dir" ] && after="$(find "$grants_dir" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
  [ "$after" -eq "$before" ]
}

@test "RCG-ADMIN-NULLFIELDS: a requester grant minted for an admin op (root-init) carries request_id/attempt_id/lease_epoch ALL null (PLAN.md ~L592: 'For root-init|root-validate|validate, request/attempt/epoch are null but actor/PLAN/worktree/argv remain exact and the grant is still mandatory'), while every other field remains genuinely populated" {
  # M7/WP4 FINAL COMPLETENESS correction (2026-08-09): identity changed from
  # main-orchestrator (agent_type:"") to a named role (arch-testing) -- main-
  # orchestrator can no longer mint a requester grant at all (see
  # RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01), so this test's OWN concern (the
  # null-fields SHAPE of an admin-op grant) is now proven via an identity that
  # CAN still mint, mirroring RCG-ADMIN-NONMAIN's own already-proven pattern.
  _prime_claude_id01_trace arch-testing rcg-nullfields-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  _make_input "$cmd" arch-testing rcg-nullfields-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]

  run node -e '
    const fs = require("fs");
    const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (rec.request_id !== null) { process.stderr.write("request_id must be null for root-init: " + JSON.stringify(rec.request_id)); process.exit(1); }
    if (rec.attempt_id !== null) { process.stderr.write("attempt_id must be null for root-init: " + JSON.stringify(rec.attempt_id)); process.exit(1); }
    if (rec.lease_epoch !== null) { process.stderr.write("lease_epoch must be null for root-init: " + JSON.stringify(rec.lease_epoch)); process.exit(1); }
    if (rec.authority !== "requester") { process.stderr.write("authority must be requester: " + rec.authority); process.exit(1); }
    if (typeof rec.plan_digest !== "string" || rec.plan_digest.length === 0) { process.stderr.write("plan_digest must still be populated"); process.exit(1); }
    if (typeof rec.worktree_id !== "string" || rec.worktree_id.length === 0) { process.stderr.write("worktree_id must still be populated"); process.exit(1); }
  ' "$(_role_command_grant_path "$grant_id")"
  [ "$status" -eq 0 ]
}

@test "RCG-ADMIN-ROOTVALIDATE-ROUNDTRIP-CLAUDEID01 BLOCK: 'root-validate' from a main-orchestrator (role-null) invocation must ALSO never get a --requester-binding minted (proves the CLAUDE-ID-01 exclusion generalizes beyond root-init specifically, mirroring this test's own prior 'proves the mechanism generalizes' framing but for the corrected, restrictive direction)" {
  # root-validate needs a coordination_root that already genuinely exists.
  mkdir -p "$PROJ/.planning/coordination"
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-validate --coordination-root "$PROJ/.planning/coordination")"
  _make_input "$cmd" "" rcg-claudeid01-rootvalidate-session
  _run_cp_hook
  _assert_pretooluse_deny
}

@test "RCG-ADMIN-NONMAIN PASS: requester-grant injection is NOT scoped to the main orchestrator only -- a named role (e.g. arch-testing) invoking root-init via Bash ALSO gets --requester-binding injected (PLAN.md ~L590: RequesterIdentityProvider role=agent_type generically, not main-orchestrator-specific)" {
  _prime_claude_id01_trace arch-testing rcg-nonmain-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  _make_input "$cmd" arch-testing rcg-nonmain-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]
}

@test "RCG-ADMIN-CALLERSUPPLIED BLOCK: a root-init command already carrying --requester-binding when it reaches context-provider-gate.js is rejected outright, mirroring the --lifecycle-binding precedent exactly" {
  local forged; forged="$(_random_hex32)"
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$PROJ/.planning/coordination" --requester-binding "$forged")"
  _make_input "$cmd" "" rcg-callersupplied-session
  _run_cp_hook
  _assert_pretooluse_deny
}

# ══════════════════════════════════════════════════════════════════════════
# RCG-ATTACK: core-level adversarial matrix. Every test here mints a
# genuinely REAL grant (via the owning hook), then attacks the resulting
# on-disk artifact or executed command in exactly one specific way, and
# proves the REAL production CLI subprocess rejects it -- never merely that
# a hook says so.
# ══════════════════════════════════════════════════════════════════════════

# NOTE on vehicle choice below: `claim` needs a REAL request.json to reach
# full business success, which this file deliberately does not build (its
# own scope is the grant layer, not the full publish-request/dispatch
# pipeline) -- so a claim-based "must reject" test whose only observable
# signal is a raw non-zero exit code is VACUOUS: claim already fails with
# CORRELATION_INVALID ("no such request") for a reason totally unrelated to
# grants, so it would show as passing even if grant enforcement were never
# implemented at all. `root-init` (--coordination-root only, empirically
# confirmed idempotent -- see this file's own dev history) has no such
# fixture gap: a legitimate, untampered call genuinely succeeds end-to-end,
# so a subsequent attack's failure is UNAMBIGUOUSLY attributable to the
# grant layer. root-init is therefore the primary vehicle for every
# attack below that does not intrinsically require a --role concept.

@test "RCG-ATTACK-ARGV-TAMPER-ROOTINIT BLOCK: a requester grant minted+injected for root-init against coordination-root A is replayed against a DIFFERENT coordination-root B (same grant_id, argv otherwise altered post-mint) -- the recomputed pre-injection argv digest no longer matches, so the core must reject, never silently authorize a different call than the one actually authorized" {
  # M7 correction round 1 test-side reconciliation (2026-08-18, task #50):
  # coordination-root A and B must be two INDEPENDENT projects' own genuinely
  # canonical roots, never two subdirectories of one project -- C2's new
  # one-canonical-root-per-project invariant (coordinationRootPathFor always
  # resolves to the SAME .planning/coordination for a given project, no
  # suffix support) means a "coordination-a"/"coordination-b" subdirectory
  # pair can never BOTH be canonical, so even the legitimate control call
  # below would be rejected as non-canonical -- a reason unrelated to the
  # argv-tamper property this test isolates. proj_b mirrors this file's own
  # setup() git-init pattern; no PLAN.md needed since proj_b is never minted
  # against, only used as the literal --coordination-root value for the
  # final tampered replay (a direct CLI call, never through a hook).
  local proj_b; proj_b="$(mktemp -d)"
  git -C "$proj_b" init -q 2>/dev/null
  git -C "$proj_b" config user.email "bats@test.local"
  git -C "$proj_b" config user.name "Bats Test"
  git -C "$proj_b" commit -q --allow-empty -m init 2>/dev/null

  local root_a="$PROJ/.planning/coordination"
  local root_b="$proj_b/.planning/coordination"
  _prime_claude_id01_trace arch-testing rcg-argvtamper-session
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$root_a")"
  # M7/WP4 FINAL COMPLETENESS correction: named-role identity (main-orchestrator
  # can no longer mint at all -- see RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01).
  # This test's own subject (argv-tamper rejection) is orthogonal to identity.
  _make_input "$cmd" arch-testing rcg-argvtamper-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]

  # Control: the legitimate, untampered command genuinely succeeds --
  # establishes that a failure below is attributable to the tamper, not to
  # some unrelated fixture gap.
  local legit; legit="$(_returned_command)"
  _run_cli_command "$legit"
  [ "$status" -eq 0 ]

  # Same grant_id, but --coordination-root now points at a COMPLETELY
  # DIFFERENT root than the one the grant actually authorizes. Uses a FRESH
  # grant (re-mint) since the control call above already consumed the first.
  # M6+M7 FINAL AUTHORITY CORRECTION (2026-08-11, narrow team-lead follow-up):
  # a distinct agent_id here (never the helper's shared 'tg-agent-id'
  # default) -- the SAME agent_id under a different session is exactly the
  # shape case 4's cross-peer collision check now correctly rejects (the
  # FIRST createRequesterBinding call above already minted a live binding for
  # {role:arch-testing, agent_id:tg-agent-id, session:rcg-argvtamper-session},
  # so a second mint for the same agent_id under a different session collides
  # with it), and this test isn't testing identity collision at all; it just
  # needs a second, independent fresh grant for argv-tamper-across-
  # coordination-roots. The distinct agent_id must be threaded through BOTH
  # the priming call AND the real _make_input call below (confirmed
  # empirically: priming alone is not sufficient -- the real PreToolUse call's
  # own recordClaudeId01PreToolUseObservation runs first and discards the
  # freshly-primed trace on ANY agent_id mismatch against it, reproducing the
  # identical claude-id01-trace-absent symptom for a different reason).
  _prime_claude_id01_trace arch-testing rcg-argvtamper-session-2 rcg-argvtamper-agent-2
  local cmd2; cmd2="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$root_a")"
  _make_input "$cmd2" arch-testing rcg-argvtamper-session-2 rcg-argvtamper-agent-2
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id2; grant_id2="$(_extract_injected requester-binding)"
  [ -n "$grant_id2" ]
  local tampered; tampered="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$root_b" --requester-binding "$grant_id2")"
  _run_cli_command "$tampered"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
  [ "$status" -ne 0 ]
}

@test "RCG-ATTACK-REPLAY-ROOTINIT BLOCK: a genuinely-consumed grant cannot be reused a second time -- one-time consumption, atomic 'wins <grant_id>.used' (PLAN.md ~L604)" {
  _prime_claude_id01_trace arch-testing rcg-replay-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  # M7/WP4 FINAL COMPLETENESS correction: named-role identity (main-orchestrator
  # can no longer mint at all -- see RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01).
  # This test's own subject (replay rejection) is orthogonal to identity.
  _make_input "$cmd" arch-testing rcg-replay-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"

  # First use: must succeed. root-init is itself empirically idempotent, so
  # this is a genuine end-to-end SUCCESS, not merely "unrecognized flag".
  _run_cli_command "$rewritten"
  [ "$status" -eq 0 ]

  # Second use of the EXACT SAME rewritten command (same grant_id): must be
  # rejected -- the grant was already consumed. Root-init's OWN idempotency
  # (proven above via the CP-consult-flag-free first call) means this second
  # failure can ONLY be attributed to the grant replay, never to root-init
  # objecting to being called twice.
  _run_cli_command "$rewritten"
  [ "$status" -ne 0 ]
}

@test "RCG-ATTACK-EXPIRED-ROOTINIT BLOCK: a grant whose on-disk expiry has already passed is rejected, never treated as still-live" {
  _prime_claude_id01_trace arch-testing rcg-expired-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  # M7/WP4 FINAL COMPLETENESS correction: named-role identity (main-orchestrator
  # can no longer mint at all -- see RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01).
  # This test's own subject (expiry rejection) is orthogonal to identity.
  _make_input "$cmd" arch-testing rcg-expired-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"

  _set_grant_field "$grant_id" expiry '"2000-01-01T00:00:00Z"'

  _run_cli_command "$rewritten"
  [ "$status" -ne 0 ]
}

@test "RCG-ATTACK-ALTERED-ROOTINIT BLOCK: a grant whose on-disk 'plan_digest' field is tampered post-mint (still well-formed hex, no longer what was actually minted) is rejected" {
  _prime_claude_id01_trace arch-testing rcg-altered-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  # M7/WP4 FINAL COMPLETENESS correction: named-role identity (main-orchestrator
  # can no longer mint at all -- see RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01).
  # This test's own subject (field-tamper rejection) is orthogonal to identity.
  _make_input "$cmd" arch-testing rcg-altered-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"

  _set_grant_field "$grant_id" plan_digest "\"$(printf 'f%.0s' {1..64})\""

  _run_cli_command "$rewritten"
  [ "$status" -ne 0 ]
}

# KNOWN SCOPE LIMITATION (documented rather than silently accepted): unlike
# the root-init-based attacks above, this test's vehicle (claim) cannot
# reach full business success without a real request.json this file does
# not build (see the NOTE above this section). "not unrecognized-flag" is
# the strongest claim achievable without that fixture -- it proves the
# --target-binding flag is genuinely processed argv, but a WEAKER
# implementation that recognizes the flag/consumes the grant WITHOUT
# actually cross-checking --role against the grant's own bound role could
# in principle still make this test read as informative-but-not-fully-
# conclusive proof of cross-role rejection specifically (a claim call also
# fails downstream for the unrelated missing-request reason either way).
# Flagged explicitly for toolkit-specialist/arch-integration rather than
# silently presented as a full proof.
@test "RCG-ATTACK-CROSS-ROLE-CLAIM: a target grant genuinely minted for role A's RoleActorBinding, presented on a 'claim --role B' invocation, is at minimum never accepted as valid recognized-and-authorized argv" {
  local worktree_id plan_digest gen_id_a gen_id_b
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id_a="$(_random_hex32)"
  gen_id_b="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id_a" 60
  _mint_role_actor_binding toolkit-specialist "$worktree_id" "$plan_digest" "$gen_id_b" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session rcg-crossrole-worker-session)"
  _make_input "$cmd" arch-testing rcg-crossrole-caller
  _run_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]

  # Present the arch-testing-scoped grant on an otherwise-real
  # toolkit-specialist claim -- same request/worker-session shape, different
  # --role.
  local swapped; swapped="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role toolkit-specialist --worker-session rcg-crossrole-worker-session --target-binding "$grant_id")"
  _run_cli_command "$swapped"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
  [ "$status" -ne 0 ]
}

# KNOWN SCOPE LIMITATION: mirrors RCG-ATTACK-CROSS-ROLE-CLAIM's own note --
# claim cannot reach full business success without a real request.json this
# file does not build, so "not unrecognized-flag" + non-zero exit is the
# strongest achievable claim without that fixture.
@test "RCG-ATTACK-AUTHORITY-SWAP-REQUESTER-AS-TARGET: a genuinely-minted REQUESTER grant (root-init) presented as --target-binding on a 'claim' command is at minimum never accepted as valid recognized-and-authorized argv (authority mismatch, direct core call bypassing the target-gate hook entirely)" {
  _prime_claude_id01_trace arch-testing rcg-authswap1-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  # M7/WP4 FINAL COMPLETENESS correction: named-role identity (main-orchestrator
  # can no longer mint at all -- see RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01).
  # This test's own subject (authority-kind swap rejection) is orthogonal to identity.
  _make_input "$cmd" arch-testing rcg-authswap1-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local requester_grant; requester_grant="$(_extract_injected requester-binding)"
  [ -n "$requester_grant" ]

  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  local request_path="$PROJ/.planning/coordination/txn/request.json"
  local claim_cmd; claim_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session rcg-authswap1-worker-session --target-binding "$requester_grant")"
  _run_cli_command "$claim_cmd"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
  [ "$status" -ne 0 ]
}

@test "RCG-ATTACK-AUTHORITY-SWAP-TARGET-AS-REQUESTER BLOCK: a genuinely-minted TARGET grant (claim) is presented as --requester-binding on a 'root-init' command -- must reject on authority mismatch, direct core call bypassing context-provider-gate.js entirely" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local claim_cmd; claim_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session rcg-authswap2-worker-session)"
  _make_input "$claim_cmd" arch-testing rcg-authswap2-caller
  _run_hook
  [ "$status" -eq 0 ]
  local target_grant; target_grant="$(_extract_injected target-binding)"
  [ -n "$target_grant" ]

  local root_init_cmd; root_init_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$PROJ/.planning/coordination" --requester-binding "$target_grant")"
  _run_cli_command "$root_init_cmd"
  [ "$status" -ne 0 ]
}

@test "RCG-BYPASS-ROOTINIT-NOGRANT: a direct 'root-init' invocation with NO grant flag at all, entirely bypassing context-provider-gate.js, must be rejected once the fix lands -- pre-fix it reaches and completes the protected operation unauthorized, which is exactly the vulnerability this whole pass closes" {
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$PROJ/.planning/coordination")"
  _run_cli_command "$cmd"
  [ "$status" -ne 0 ]
}

@test "RCG-BYPASS-ROOTINIT-FORGED: a direct 'root-init' invocation carrying a random, never-minted hex value as --requester-binding is rejected for a GRANT reason (absent/invalid), never treated as a valid reference -- distinct from RCG-BYPASS-ROOTINIT-NOGRANT (flag entirely absent) since this proves a well-formed-looking but fabricated value is equally rejected, not merely an omitted flag" {
  local forged; forged="$(_random_hex32)"
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$PROJ/.planning/coordination" --requester-binding "$forged")"
  _run_cli_command "$cmd"
  # Discriminating specifically: pre-fix --requester-binding is not even a
  # recognized flag on root-init's COMMAND_FLAGS entry, so this already
  # exits non-zero for an entirely unrelated reason (USAGE_ERROR:
  # unrecognized flag) -- a bare `$status -ne 0` check would be vacuously
  # true regardless of whether grant validation is ever implemented. Once
  # the flag is real, the SAME forged value must be rejected for a genuine
  # grant reason (absent/invalid), which requires first getting PAST the
  # argv-parsing layer.
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
  [ "$status" -ne 0 ]
}

# claim-vehicle bypass coverage deliberately NOT duplicated here: without a
# real request.json (out of this file's scope, see the RCG-ATTACK section
# note above), a no-grant/forged-grant claim call already fails today for
# the unrelated "no such request" reason, which would make such a test
# vacuously green regardless of whether grant enforcement is ever
# implemented -- RCG-BYPASS-ROOTINIT-NOGRANT/FORGED above already prove the
# identical "direct core call bypassing hooks entirely" vulnerability on a
# vehicle where the signal is unambiguous.

# ══════════════════════════════════════════════════════════════════════════
# M7 completeness FINAL PASS (2026-08-09, RED phase only, dispatch
# team-lead-20260809-final-completeness): extends role-command-grant/v1
# requester-authority coverage to the 12 PLAN.md §15b requester subcommands
# NOT yet in ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND (runtime-consultation.cjs
# ~L5298-5305): publish-blob, publish-request, dispatch, record-delivery,
# takeover, await-result, accept-result, transaction-ack, cancel,
# worker-stop, cleanup, validate. This is the deliberate, disclosed
# scope-narrowing that constant's own comment (and context-provider-gate.js's
# own REQUESTER_ADMIN_SUBCOMMANDS comment) names as a reported follow-up, not
# a bug. No production fix lands in this pass -- every test below proves the
# gap still exists today.
#
# Wiring confirmed by direct read: main() calls
# validateAndConsumeRoleCommandGrantForCommand(command, flags, rawArgv)
# UNCONDITIONALLY before every handler (~L5676-5678), which itself no-ops
# for any command absent from ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND
# (~L5563-5564: "if (!authority) return; // not grant-gated in this pass's
# scope"). Extending enforcement to these 12 is therefore a pure DATA change
# (12 more map entries + a COMMAND_FLAGS extension) -- but that data change
# IS the implementation-phase fix, out of scope here.
#
# Discriminator: each command is called with argv conformant to the Frozen
# CLI ABI (PLAN.md ~L776-795) and NO grant flag at all. The target (GREEN,
# post-fix) assertion is `detail_code:"AUTHORITY_INVALID"` -- which is FALSE
# today for every one of the 12, since the check does not run. Each fixture
# is built to reach as far into real business logic as practically achievable
# without a grant (mirroring this file's own "vehicle choice" discipline from
# the RCG-ATTACK section above), so the RED is attributable to the missing
# CHECK, never to an unrelated fixture gap.
#
# KNOWN SCOPE LIMITATION (documented, not silently omitted -- mirrors this
# file's own RCG-ATTACK-CROSS-ROLE-CLAIM/AUTHORITY-SWAP precedent): COMMAND_FLAGS
# is NOT extended for any of these 12 (confirmed: the extension loop at
# runtime-consultation.cjs ~L5307-5310 only touches
# ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND's CURRENT 6 keys), so a
# --requester-binding flag on any of these 12 is UNRECOGNIZED ARGV today,
# rejected at the parseFlags layer (USAGE_ERROR) strictly BEFORE grant
# validation could ever run. The deeper adversarial matrix (replay,
# argv-tamper, expiry, authority-kind-swap, wrong request/attempt/epoch/
# role/worktree/plan_digest) all require the CLI to first ACCEPT a
# --requester-binding flag at all -- so it is NOT meaningfully testable at
# the CLI-argv level for these 12 commands until COMMAND_FLAGS is extended
# in the implementation phase. Writing such a test today would only ever
# prove "unrecognized flag -> USAGE_ERROR", true regardless of whether grant
# validation is ever wired -- a vacuous, non-discriminating test this file's
# own established philosophy explicitly rejects. Reported here, not faked.
#
# CARRIED FORWARD TO THE GREEN-PHASE PASS (explicit, per team-lead
# 2026-08-09): once toolkit-specialist extends COMMAND_FLAGS for these 12
# commands, the GREEN-phase test-specialist pass on this file MUST ALSO add
# the deeper adversarial matrix (replay/argv-tamper/expiry/authority-swap/
# wrong-scope-field) for them, mirroring the RCG-ATTACK-* section above's
# existing coverage of the 6 already-gated commands. A GREEN result on
# THIS pass's own RCG-REQ12-*-NOGRANT tests alone must never be read as
# "the 12 new commands' adversarial surface is fully covered" -- it proves
# only that the missing-grant gap has closed, not that the closed gate is
# itself adversarially hardened.
# ══════════════════════════════════════════════════════════════════════════

REQ12_WAVE_SLUG="tg-wave"
REQ12_GRANT_WRAPPER="$BATS_TEST_DIRNAME/fixtures/runtime-consultation-grant-wrapper.cjs"

_req12_sha256_string() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

_req12_repo_id() {
  local common_dir resolved
  common_dir="$(git -C "$PROJ" rev-parse --path-format=absolute --git-common-dir)"
  resolved="$(cd "$common_dir" 2>/dev/null && pwd -P)" || resolved="$common_dir"
  _req12_sha256_string "$resolved"
}

# Per-test fixture scope: root-inits $REQ12_COORD_ROOT (via the SAME grant-
# wrapper the pre-existing cli.bats/roots.bats/protocol.bats suites already
# rely on for this exact purpose -- root-init is one of the 6 ALREADY-gated
# commands, so it genuinely needs a grant to succeed at all) and computes
# every identity/scope field the request.json fixture builder below needs.
# Must be called once at the START of every @test in this section.
_req12_setup() {
  REQ12_COORD_ROOT="$PROJ/.planning/coordination"
  mkdir -p "$REQ12_COORD_ROOT"
  RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_ROLE=arch-testing NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$REQ12_GRANT_WRAPPER" root-init --coordination-root "$REQ12_COORD_ROOT" >/dev/null 2>&1
  REQ12_REPO_ID="$(_req12_repo_id)"
  REQ12_WORKTREE_ID="$(_worktree_id)"
  REQ12_PLAN_DIGEST="$(_plan_digest)"
  REQ12_SUBJECT_HEAD="$(git -C "$PROJ" rev-parse HEAD)"
}

_req12_plan_root() {
  printf '%s/%s/%s/%s' "$REQ12_COORD_ROOT" "$REQ12_REPO_ID" "$REQ12_WAVE_SLUG" "$REQ12_PLAN_DIGEST"
}

_req12_request_path() {
  printf '%s/transactions/%s/request.json' "$(_req12_plan_root)" "$1"
}

# consult/v2 fixture builder -- same override/__OMIT__ idiom as
# runtime-consultation-cli.bats/-roots.bats's own _write_request (this
# section's own scope reuses their PROVEN field defaults verbatim, including
# the routing_policy_digest placeholder those suites already establish is
# not strictly cross-checked against the live runtime-routing.json for the
# operations this section exercises).
_req12_write_request() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  local created_at expiry
  created_at="$(node -e 'process.stdout.write(new Date().toISOString().replace(/\.\d{3}Z$/,"Z"))')"
  expiry="$(node -e 'process.stdout.write(new Date(Date.parse(process.argv[1])+1800000).toISOString().replace(/\.\d{3}Z$/,"Z"))' "$created_at")"
  REQ12_CREATED_AT="$created_at" REQ12_EXPIRY="$expiry" \
  R12_REPO_ID="$REQ12_REPO_ID" R12_WORKTREE_ID="$REQ12_WORKTREE_ID" R12_PLAN_DIGEST="$REQ12_PLAN_DIGEST" \
  R12_SUBJECT_HEAD="$REQ12_SUBJECT_HEAD" \
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const e = process.env;
    const defaults = {
      schema: "coordination/consult/v2",
      request_id: "a".repeat(64),
      root_request_id: "a".repeat(64),
      parent_request_id: null,
      depth: 0,
      max_depth: 2,
      source_role: "test-specialist",
      target_role: "arch-testing",
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: "b".repeat(64),
      requester_worktree_id: e.R12_WORKTREE_ID,
      requester_instance_id: "c".repeat(64),
      repo_id: e.R12_REPO_ID,
      wave_slug: "tg-wave",
      protocol_profile: "runtime-consultation/v1",
      // Empirically confirmed (2026-08-09): a REAL-but-differently-derived
      // coordination_root_id hash trips SECURITY_INVALID (a forgery/identity
      // check, not a shape check) BEFORE reaching the target business logic
      // in this section -- vacuously "discriminating" for the wrong reason.
      // The placeholder below matches the proven _write_request convention
      // already established in runtime-consultation-roots.bats (RCR-blob-1
      // etc. reach real business logic with this exact placeholder). NOTE:
      // no apostrophes anywhere in this comment block -- it lives inside a
      // bash single-quoted node -e block (no escape mechanism), and a bare
      // apostrophe here silently truncates the script and breaks every
      // caller (empirically confirmed 2026-08-09 after m7-toolkit-impl found
      // this exact defect; see git history for the isolated repro).
      coordination_root_id: "0".repeat(64),
      plan_digest: e.R12_PLAN_DIGEST,
      subject_repo_id: e.R12_REPO_ID,
      subject_worktree_id: e.R12_WORKTREE_ID,
      subject_head: e.R12_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      question: "req12 fixture question",
      expected_result_kind: "TEST_RESULT",
      expiry: e.REQ12_EXPIRY,
      recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: "e".repeat(64),
      initial_attempt_id: "f".repeat(64),
      initial_lease_epoch: 0,
      created_at: e.REQ12_CREATED_AT
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$overrides" "$out"
}

_req12_write_subject_bundle() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = { schema: "coordination/subject-bundle-manifest/v1", entries: [] };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$overrides" "$out"
}

_req12_base64url_encode() {
  node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0)).toString("base64url"))'
}

@test "RCG-REQ12-PUBLISHREQUEST-NOGRANT: 'publish-request' with well-formed argv (PLAN.md ~L781) and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix publish-request is entirely ungated, so this same call reaches real business logic and genuinely SUCCEEDS (materializes plan_ref/routing-policy/subject-bundle and publishes request.json), proving the grant check does not run at all" {
  _req12_setup
  local intent intent_b64
  intent="$(printf '{"target_role":"arch-testing","question":"req12 publish-request fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(node -e 'process.stdout.write(new Date(Date.now()+1800000).toISOString().replace(/\.\d{3}Z$/,"Z"))')")"
  intent_b64="$(printf '%s' "$intent" | _req12_base64url_encode)"
  local bundle_file="$PROJ/.planning/req12-subject-bundle.json"
  _req12_write_subject_bundle "$bundle_file" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" publish-request --coordination-root "$REQ12_COORD_ROOT" --plan "$PROJ/.planning/wave-tg-wave/PLAN.md" \
      --subject-bundle "$bundle_file" --intent "$intent_b64"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-DISPATCH-NOGRANT: 'dispatch' with a well-formed, business-logic-reachable request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation (PLAN.md §15b names dispatch as requester-authority) -- pre-fix dispatch is entirely ungated, so this same call reaches real business logic and fails for the UNRELATED reason UNAVAILABLE/DRIVER_UNAVAILABLE instead (no routing-policy driver registered for this fixture, mirroring runtime-consultation-cli.bats's own CLI-RESULT-04 precedent exactly) -- proof the grant check does not run at all, not merely that it runs after this file's own driver-selection logic" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" dispatch --coordination-root "$REQ12_COORD_ROOT" --request "$req_f"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-AWAITRESULT-NOGRANT: 'await-result' with a well-formed request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix await-result is entirely ungated, so this same call reaches its own bounded poll and fails for the UNRELATED reason TIMEOUT/DEADLINE_EXCEEDED instead (no candidate result ever published, mirroring CLI-RESULT-05's own precedent) -- proof the grant check does not run first" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" await-result --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --timeout 1
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-ACCEPTRESULT-NOGRANT: 'accept-result' with a well-formed request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix accept-result is entirely ungated, so this same call reaches its own real correlation/state logic and fails for the DIFFERENT, grant-unrelated reason INVALID/CORRELATION_INVALID (no candidate result exists to accept, empirically confirmed 2026-08-09) instead of AUTHORITY_INVALID -- proof the grant check does not run first" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" accept-result --coordination-root "$REQ12_COORD_ROOT" --request "$req_f"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-TRANSACTIONACK-NOGRANT: 'transaction-ack' with a well-formed request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix transaction-ack is entirely ungated, so this same call reaches its own real correlation/state logic and fails for the DIFFERENT, grant-unrelated reason INVALID/CORRELATION_INVALID (no accepted-result.json exists yet, empirically confirmed 2026-08-09) instead of AUTHORITY_INVALID -- proof the grant check does not run first" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" transaction-ack --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --disposition accepted
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-CANCEL-NOGRANT: 'cancel' with a well-formed request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix cancel is entirely ungated, so this same call reaches real business logic and genuinely SUCCEEDS (publishes cancel.json, mirroring CLI-RESULT-07's own first-call precedent), proving the grant check does not run at all" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cancel --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --reason explicit
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-CLEANUP-NOGRANT: 'cleanup' with a well-formed request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix cleanup is entirely ungated" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-TAKEOVER-NOGRANT: 'takeover' with a well-formed request PLUS a genuinely eligible takeover predicate (an existing claim + an ALREADY-EXPIRED active-lease for its own attempt/epoch) and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix takeover is entirely ungated, so this same call reaches real business logic and genuinely SUCCEEDS (publishes a new activation + takeover.json), proving the grant check does not run at all. Empirically confirmed (2026-08-09): a request with NO claim/lease at all is NOT a safe vehicle here -- takeover's OWN domain logic already reports AUTHORITY_INVALID for 'no legal takeover eligibility exists', which would make a no-claim fixture vacuously pass this exact assertion for a reason having nothing to do with role-command-grant/v1 -- exactly the non-discriminating-test trap this file's own RCG-ATTACK section explicitly guards against." {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  local txn_dir; txn_dir="$(dirname "$req_f")"
  mkdir -p "$txn_dir/claims" "$txn_dir/active-leases"
  local attempt_id; attempt_id="$(printf 'f%.0s' {1..64})"
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const txnDir = process.argv[1];
    const worktreeId = process.argv[2];
    const attemptId = process.argv[3];
    const claim = { schema: "coordination/claim/v1", request_id: "a".repeat(64), attempt_id: attemptId, lease_epoch: 0, claimant_role: "arch-testing", claimant_worktree_id: worktreeId, claimant_instance_id: "1".repeat(64), worker_session_id: null, target_role_profile_digest: "b".repeat(64), driver: "noop", created_at: "2020-01-01T00:00:00Z" };
    const claimPath = txnDir + "/claims/" + attemptId + ".json";
    fs.writeFileSync(claimPath, JSON.stringify(claim), { mode: 0o600 });
    fs.chmodSync(claimPath, 0o600);
    const claimDigest = crypto.createHash("sha256").update(fs.readFileSync(claimPath)).digest("hex");
    const lease = { schema: "coordination/active-lease/v1", attempt_id: attemptId, lease_epoch: 0, holder_role: "arch-testing", claimant_instance_id: "1".repeat(64), worker_session_id: null, claim_digest: claimDigest, ttl_seconds: 300, heartbeat_interval_seconds: 60, last_heartbeat_at: "2020-01-01T00:00:00Z", lease_expiry: "2020-01-01T00:05:00Z", created_at: "2020-01-01T00:00:00Z" };
    const leasePath = txnDir + "/active-leases/" + attemptId + ".json";
    fs.writeFileSync(leasePath, JSON.stringify(lease), { mode: 0o600 });
    fs.chmodSync(leasePath, 0o600);
  ' "$txn_dir" "$REQ12_WORKTREE_ID" "$attempt_id"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" takeover --coordination-root "$REQ12_COORD_ROOT" --request "$req_f"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-RECORDDELIVERY-NOGRANT: 'record-delivery' with a well-formed request and its own initial_attempt_id/epoch, and NO grant flag, must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix record-delivery is entirely ungated, so this same call fails for the DIFFERENT, grant-unrelated reason INVALID/INVALID_ARGUMENT (empirically confirmed 2026-08-09 -- reached before any grant concept) instead of AUTHORITY_INVALID" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" record-delivery --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" \
      --attempt "$(printf 'f%.0s' {1..64})" --epoch 0 --driver noop --outcome noop --commit-point none
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-WORKERSTOP-NOGRANT: 'worker-stop' (session-shutdown kind, no --request needed per the ABI table) with NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix worker-stop is entirely ungated, so this same call reaches real business logic and genuinely SUCCEEDS (mints a new stop ID + publishes stop correlation), proving the grant check does not run at all" {
  _req12_setup
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" worker-stop --coordination-root "$REQ12_COORD_ROOT" --role arch-testing \
      --worker-session req12-workerstop-session --kind session-shutdown
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-VALIDATE-NOGRANT: 'validate' against a well-formed request artifact with NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix validate is entirely ungated, so this same call reaches real business logic and genuinely SUCCEEDS (full schema/path/authority validation passes, mirroring runtime-consultation-roots.bats's own RCR-blob-1 precedent), proving the grant check does not run at all" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" validate --coordination-root "$REQ12_COORD_ROOT" --kind consult-v2 --artifact "$req_f"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-PUBLISHBLOB-NOGRANT: 'publish-blob' with NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix publish-blob is entirely ungated, so this same call fails for the DIFFERENT, grant-unrelated reason INVALID/SCHEMA_INVALID (empirically confirmed 2026-08-09) instead of AUTHORITY_INVALID. KNOWN SCOPE LIMITATION: this fixture's manifest entry is not a full BLOB-AUTH-style validated staging entry (that fixture machinery is cli.bats/protocol.bats's own, out of this section's budget) -- the discriminating claim is only that today's failure is not AUTHORITY_INVALID, proving the grant check itself does not run" {
  _req12_setup
  local bundle_file="$PROJ/.planning/req12-blob-subject-bundle.json"
  _req12_write_subject_bundle "$bundle_file" '{"entries":[{"path":"req12-fixture-entry.txt","size":4,"digest":"'"$(printf 'a%.0s' {1..64})"'"}]}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" publish-blob --coordination-root "$REQ12_COORD_ROOT" --plan "$PROJ/.planning/wave-tg-wave/PLAN.md" \
      --subject-bundle "$bundle_file" --entry req12-fixture-entry.txt
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 completeness GREEN-phase carry-forward (2026-08-09, task #24): deeper
# adversarial matrix for the 12 commands newly gated in Part A -- replay,
# argv-tamper, expiry, field-tamper, authority-kind-swap. Now testable:
# COMMAND_FLAGS was extended alongside ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND
# (confirmed by direct read, runtime-consultation.cjs ~L5331-5334), so a
# --requester-binding flag is real, recognized argv for all 18 commands now.
#
# Vehicle choice: `cleanup` (--coordination-root --request only), matching
# root-init's own precedent above -- a legitimate call genuinely reaches
# SUCCESS today (empirically confirmed during the RED phase), so a
# subsequent attack's failure is unambiguously attributable to the grant
# layer, never an unrelated fixture gap.
#
# Scope (reported, matching this file's own established practice): this
# section does NOT repeat the full matrix for all 12 commands individually.
# the shared validation+consumption pipeline (the code under test here) is
# COMPLETELY GENERIC across subcommands -- confirmed by direct read
# (runtime-consultation.cjs ~L5480-5576): it takes `expectedSubcommand` as a
# bare comparison value with no per-command branching anywhere in its own
# body. There is no per-command logic left to exercise per-command -- the
# SAME code path this section proves correct for `cleanup` is, byte-for-byte,
# the code path every other one of the 18 commands also runs through
# validateAndConsumeRoleCommandGrantForCommand. This mirrors the file's own
# root-init-as-primary-vehicle precedent (see the RCG-ATTACK section header
# above) rather than mechanically duplicating 5 variants x 12 commands.
#
# No hook mints requester grants for these 12 commands yet (context-provider-gate.js's
# own REQUESTER_ADMIN_SUBCOMMANDS is still root-init/root-validate only,
# confirmed by direct read 2026-08-09) -- so, unlike the RCG-ATTACK section's
# own root-init tests (which mint via the REAL hook, _run_cp_hook), this
# section mints DIRECTLY via the same production primitives the wrapper/hooks
# use (rll.createRequesterBinding + rll.mintRoleCommandGrant), mirroring this
# file's own _mint_role_actor_binding/_mint_pending_role_spawn_full precedent
# for the target surface exactly.
# ══════════════════════════════════════════════════════════════════════════

# Mints a REAL requester grant for `cleanup` against a well-formed request
# fixture, prints "<grant_id> <request_path>" -- the caller builds the
# legitimate command by appending `--requester-binding <grant_id>`. Callers
# MUST call `_req12_setup` THEMSELVES, directly, BEFORE this -- never inside
# a `$(...)` command-substitution subshell together with this function (a
# subshell's own variable assignments -- PROJ/REQ12_COORD_ROOT/etc, all set
# by _req12_setup -- never propagate back to the calling @test's own shell;
# empirically confirmed 2026-08-09 as the exact cause of an earlier version
# of this helper silently invoking _req12_setup INSIDE the substitution,
# which left the caller's own $REQ12_COORD_ROOT permanently empty).
_req12_mint_cleanup_grant() {
  # M6+M7 requester-authority closure (Group G fix): the shared
  # _req12_request_path helper builds .../transactions/a/request.json (a
  # LITERAL one-char directory), but _req12_write_request default template
  # hardcodes request_id:"a".repeat(64) into the JSON -- assertExactCanonicalGeometry
  # derives requestId from the directory segment and readCanonicalRequestRecord
  # cross-checks it against the JSON field, so a bare "a" directory never
  # accredits. Every OTHER caller of _req12_request_path never reaches
  # accreditation (fails earlier on the missing-grant-flag pre-check), so this
  # was latent everywhere else -- only this helper genuinely needs the
  # directory segment to match the JSON request_id.
  local req_f; req_f="$(_req12_plan_root)/transactions/$(printf 'a%.0s' {1..64})/request.json"
  _req12_write_request "$req_f" '{}'
  local grant_id
  grant_id="$(node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const fs = require("fs");
    const projectRoot = process.argv[3];
    const reqPath = process.argv[4];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    // M6+M7 FULL CLOSURE (2026-08-11): defaults to codex-supervisor, mirroring
    // runtime-consultation-grant-wrapper.cjs own RCC_GRANT_PROVIDER default --
    // this helper own callers (ROUNDTRIP/REPLAY/EXPIRED/ALTERED/AUTHORITYSWAP)
// test the generic grant validation+consumption mechanics, never
    // CLAUDE-ID-01-adjacent identity. No apostrophes in this comment block --
    // bash single-quoted node -e block, no escape mechanism.
    const identity = { ok: true, provider: process.env.RCC_GRANT_PROVIDER || "codex-supervisor", runtime_session_key: "req12-adversarial-session" };
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "req12-cleanup-grant-agent", "arch-testing", worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("binding mint failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    // M6+M7 requester-authority closure (Group G fix): the fixture request
    // default source_role/requester_instance_id placeholders never correlate
    // with any real binding -- rewrite both to this exact minted binding
    // before the grant is consumed, mirroring resolveRequesterGrantScope own
    // requesterInstanceId/sourceRole cross-check inside
    // validateAndConsumeRoleCommandGrantForCommand.
    const reqObjForRewrite = JSON.parse(fs.readFileSync(reqPath, "utf8"));
    reqObjForRewrite.source_role = "arch-testing";
    reqObjForRewrite.requester_instance_id = bindingResult.binding.actor_instance_id;
    fs.writeFileSync(reqPath, rc.canonicalJSONStringify(reqObjForRewrite), { mode: 0o600 });
    fs.chmodSync(reqPath, 0o600);
    const rest = ["--coordination-root", process.argv[5], "--request", reqPath];
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    // M6+M7 requester-authority closure (Group B): bind the grant to the
    // REAL request_id/initial_attempt_id/initial_lease_epoch this exact
    // fixture request carries, never null -- "cleanup" is one of the
    // TRANSACTIONAL (non-administrative) commands PLAN.md ~L592 requires to
    // "bind the exact request and its authoritative current attempt/epoch";
    // null is only correct for root-init/root-validate/validate (pre-request/
    // read-only admin ops). A null-modeled transactional grant here would
    // silently mask the missing request/attempt/epoch cross-check inside
// the shared grant pipeline (see RCG-REQ12-ATTACK-WRONGSCOPE-CLEANUP
    // below), since a null field is trivially shape-valid regardless of
    // whether it was ever cross-checked against anything real.
    const reqObj = JSON.parse(fs.readFileSync(reqPath, "utf8"));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", "cleanup", argvDigest, reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch);
    if (!mintResult.ok) { process.stderr.write("grant mint failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$LIB_DIR/runtime-consultation.cjs" "$PROJ" "$req_f" "$REQ12_COORD_ROOT")"
  printf '%s %s' "$grant_id" "$req_f"
}

# M6+M7 requester-authority closure (Group B, 2026-08-10): a 'cleanup' grant
# minted with a FABRICATED request_id/attempt_id/lease_epoch that does NOT
# match the real transaction it is presented against (argv/--request path
# UNCHANGED, zero argv tampering -- isolates this from
# RCG-REQ12-ATTACK-ARGVTAMPER-CLEANUP's own different-path mechanism) must be
# rejected. The regression below proves the full pipeline independently
# re-derives request.json plus the current authoritative attempt/epoch before
# creating the one-shot consumption marker; a valid-shape fabricated triple
# neither authorizes the transaction nor burns the grant.
@test "RCG-REQ12-ATTACK-WRONGSCOPE-CLEANUP BLOCK: a 'cleanup' grant minted with a fabricated request_id/attempt_id/lease_epoch unrelated to the real transaction it is presented against must be rejected" {
  _req12_setup
  # M6+M7 requester-authority closure (Group G fix): a bare "a" directory
  # never accredits against the JSON request_id:"a".repeat(64) default (see
  # _req12_mint_cleanup_grant own comment) -- without this, the assertion
  # below passes VACUOUSLY (any accreditation failure also yields
  # AUTHORITY_INVALID), never actually proving wrong-scope detection.
  local req_f; req_f="$(_req12_plan_root)/transactions/$(printf 'a%.0s' {1..64})/request.json"
  _req12_write_request "$req_f" '{}'
  local grant_id
  grant_id="$(node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const reqPath = process.argv[4];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    // M6+M7 FULL CLOSURE (2026-08-11): defaults to codex-supervisor -- this
    // test own subject (wrong request/attempt/epoch scope rejection) is
    // provider-agnostic, never CLAUDE-ID-01-adjacent. No apostrophes in this
    // comment block -- bash single-quoted node -e block, no escape mechanism.
    const identity = { ok: true, provider: process.env.RCC_GRANT_PROVIDER || "codex-supervisor", runtime_session_key: "req12-wrongscope-session" };
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "req12-wrongscope-agent", "arch-testing", worktreeId, planResult.planDigest, 3600);
    const rest = ["--coordination-root", process.argv[5], "--request", reqPath];
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", "cleanup", argvDigest, "b".repeat(64), "c".repeat(64), 999);
    process.stdout.write(mintResult.ok ? mintResult.grantId : "");
  ' "$RLL_IMPL" "$LIB_DIR/runtime-consultation.cjs" "$PROJ" "$req_f" "$REQ12_COORD_ROOT")"
  [ -n "$grant_id" ]

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --requester-binding "$grant_id"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]

  # Scope accreditation precedes the one-shot write: a valid-shape but wrong
  # transaction triple must not burn the grant or leave any `.consumed`
  # marker behind.
  run node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const marker = rll.roleCommandGrantConsumedMarkerPathFor(process.argv[2], process.argv[3]);
    process.exit(fs.existsSync(marker) ? 1 : 0);
  ' "$RLL_IMPL" "$PROJ" "$grant_id"
  [ "$status" -eq 0 ]
}

@test "RCG-REQ12-ATTACK-ROUNDTRIP-CLEANUP PASS: a genuinely-minted requester grant for 'cleanup', presented via --requester-binding, lets the real production CLI reach SUCCESS -- control case establishing every attack below is attributable to the tamper, not an unrelated fixture gap" {
  _req12_setup
  local out grant_id req_f; out="$(_req12_mint_cleanup_grant)"; read -r grant_id req_f <<< "$out"
  [ -n "$grant_id" ]
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --requester-binding "$grant_id"
  [[ "$output" == *'"status":"SUCCESS"'* ]]
}

@test "RCG-REQ12-ATTACK-REPLAY-CLEANUP BLOCK: a genuinely-consumed 'cleanup' grant cannot be reused a second time -- one-time consumption" {
  _req12_setup
  local out grant_id req_f; out="$(_req12_mint_cleanup_grant)"; read -r grant_id req_f <<< "$out"
  local cmd; cmd="node \"$CONSULTATION_CLI\" cleanup --coordination-root \"$REQ12_COORD_ROOT\" --request \"$req_f\" --requester-binding \"$grant_id\""
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" bash -c "$cmd"
  [[ "$output" == *'"status":"SUCCESS"'* ]]
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" bash -c "$cmd"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-ATTACK-ARGVTAMPER-CLEANUP BLOCK: a genuinely-minted 'cleanup' grant, presented against a DIFFERENT --request path than the one it was minted for, is rejected -- the recomputed pre-injection argv digest no longer matches" {
  _req12_setup
  local req_a req_b; req_a="$(_req12_request_path a)"; req_b="$(_req12_request_path b)"
  _req12_write_request "$req_a" '{}'
  _req12_write_request "$req_b" "{\"request_id\":\"$(printf 'b%.0s' {1..64})\"}"
  local grant_id
  grant_id="$(node -e '
    const rll = require(process.argv[1]); const rc = require(process.argv[2]);
    const projectRoot = process.argv[3]; const reqPath = process.argv[4];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    // M6+M7 FULL CLOSURE (2026-08-11): defaults to codex-supervisor -- this
    // test own subject (argv-tamper-across-request-paths rejection) is
    // provider-agnostic, never CLAUDE-ID-01-adjacent. No apostrophes in this
    // comment block -- bash single-quoted node -e block, no escape mechanism.
    const identity = { ok: true, provider: process.env.RCC_GRANT_PROVIDER || "codex-supervisor", runtime_session_key: "req12-argvtamper-session" };
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "req12-argvtamper-agent", "arch-testing", worktreeId, planResult.planDigest, 3600);
    const rest = ["--coordination-root", process.argv[5], "--request", reqPath];
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", "cleanup", argvDigest, null, null, null);
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$LIB_DIR/runtime-consultation.cjs" "$PROJ" "$req_a" "$REQ12_COORD_ROOT")"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_b" --requester-binding "$grant_id"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-ATTACK-EXPIRED-CLEANUP BLOCK: a 'cleanup' grant whose on-disk expiry has already passed is rejected, never treated as still-live" {
  _req12_setup
  local out grant_id req_f; out="$(_req12_mint_cleanup_grant)"; read -r grant_id req_f <<< "$out"
  _set_grant_field "$grant_id" expiry '"2000-01-01T00:00:00Z"'
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --requester-binding "$grant_id"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-ATTACK-ALTERED-CLEANUP BLOCK: a 'cleanup' grant whose on-disk 'plan_digest' field is tampered post-mint (still well-formed hex, no longer what was actually minted) is rejected" {
  _req12_setup
  local out grant_id req_f; out="$(_req12_mint_cleanup_grant)"; read -r grant_id req_f <<< "$out"
  _set_grant_field "$grant_id" plan_digest "\"$(printf 'f%.0s' {1..64})\""
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --requester-binding "$grant_id"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-ATTACK-AUTHORITYSWAP-CLEANUP BLOCK: a genuinely-minted TARGET grant (claim) is presented as --requester-binding on a 'cleanup' command -- must reject on authority mismatch" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  local txn_id; txn_id="$(_random_hex32)"
  local claim_request_path="$REQ12_COORD_ROOT/$txn_id/request.json"
  _tg_write_minimal_request "$claim_request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$claim_request_path" noop
  local claim_cmd; claim_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$REQ12_COORD_ROOT" --request "$claim_request_path" --role arch-testing --worker-session req12-authswap-worker-session)"
  _make_input "$claim_cmd" arch-testing req12-authswap-caller
  _run_hook
  [ "$status" -eq 0 ]
  local target_grant; target_grant="$(_extract_injected target-binding)"
  [ -n "$target_grant" ]

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --requester-binding "$target_grant"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

# Sixteenth §16b/16d RED. Produces a root-source action via the real lifecycle
# CLI, reserves it through the real Agent PreToolUse hook, creates its binding
# through the real SubagentStart hook, and retires it through the real
# SubagentStop hook. No root-source authority factory or grant-wrapper occurs.
_s16_create_and_retire_real_root_source() {
  local session_id="$1" agent_id="$2"
  # S16-RSB fixture correction: setup()'s $PROJ never leaves the protected
  # default branch (main/master), so subagent-start-context-bundle.js's own
  # getWaveSlug({useBranch:true,useAlias:false}) call returns null and its
  # `if (!waveSlug) process.exit(0)` fires BEFORE the root-source reservation
  # is ever consumed -- silently skipping createRootSourceBinding and leaving
  # `root-source-bindings/` absent (ENOENT). Root-source correlation itself
  # is wave-independent (PLAN.md §16b never references a wave slug); the real
  # fix is giving this fixture the same resolvable non-protected branch the
  # already-GREEN S16-RSB-SUBAGENTSTART-BINDING-01 fixture uses
  # (subagent-start-context-bundle.bats' own `checkout -b feature/...`).
  git -C "$PROJ" checkout -b "feature/s16-rsb-retired-fixture" -q 2>/dev/null
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-role-gate-retained-plane" node -e '
    const fs = require("fs");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const lifecycleCli = process.argv[1];
    const agentGate = process.argv[4];
    const subagentHook = process.argv[5];
    const sessionId = process.argv[6];
    const agentId = process.argv[7];
    const retainedFixture = require(process.argv[8]);
    const intent = {
      source_role: "toolkit-specialist",
      reporting_architect: "arch-platform",
      question: "Inspect the bounded Sixteenth retired-binding fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
    };
    const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("S16 PLAN missing"); process.exit(1); }
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!generation.ok || !main.ok) { process.stderr.write("S16 main authority setup failed"); process.exit(1); }
    retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
    const lifecycleGrant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
      "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
    );
    if (!lifecycleGrant.ok) {
      process.stderr.write("S16 missing root-source lifecycle admission: " + JSON.stringify(lifecycleGrant));
      process.exit(1);
    }
    const cli = spawnSync(process.execPath, [
      lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
      "--lifecycle-binding", lifecycleGrant.grantId,
    ], { encoding: "utf8", env: process.env });
    let envelope;
    try { envelope = JSON.parse(cli.stdout); } catch { envelope = null; }
    if (cli.status !== 0 || !envelope || envelope.status !== "ACTION_REQUIRED"
      || !envelope.operation || envelope.operation.kind !== "root-source"
      || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
      process.stderr.write("S16 real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
      process.exit(1);
    }
    const action = envelope.actions[0];
    const p = action.payload;
    const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" });
    const gate = spawnSync(process.execPath, [agentGate], {
      input: JSON.stringify({
        tool_name: "Agent",
        tool_input: { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message },
        tool_use_id: "s16-retired-tool-use-01", session_id: sessionId, agent_type: "", agent_id: "",
      }), encoding: "utf8", env: commonEnv,
    });
    let gateBody;
    try { gateBody = JSON.parse(gate.stdout); } catch { gateBody = null; }
    if (gate.status !== 0 || !gateBody || !gateBody.hookSpecificOutput || gateBody.hookSpecificOutput.permissionDecision !== "allow") {
      process.stderr.write("S16 Agent gate reservation failed: " + JSON.stringify({ status: gate.status, stdout: gate.stdout, stderr: gate.stderr }));
      process.exit(1);
    }
    const start = spawnSync(process.execPath, [subagentHook], {
      input: JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "toolkit-specialist", session_id: sessionId, agent_id: agentId }),
      encoding: "utf8", env: commonEnv,
    });
    if (start.status !== 0) { process.stderr.write("S16 SubagentStart failed: " + JSON.stringify(start)); process.exit(1); }
    const bindingsDir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
    let entries = [];
    try { entries = fs.readdirSync(bindingsDir, { withFileTypes: true }); } catch (err) {
      process.stderr.write("S16 genuine binding directory absent: " + err.code + "; SubagentStart=" + JSON.stringify({ status: start.status, stdout: start.stdout, stderr: start.stderr })); process.exit(1);
    }
    const bindings = entries.filter((e) => e.isFile() && /^[a-f0-9]{32}\.json$/.test(e.name))
      .map((e) => JSON.parse(fs.readFileSync(path.join(bindingsDir, e.name), "utf8")))
      .filter((b) => b.action_id === action.action_id && b.runtime_session_key === sessionId && b.agent_id === agentId);
    if (bindings.length !== 1) { process.stderr.write("S16 expected one genuine binding, got " + bindings.length); process.exit(1); }
    const binding = bindings[0];
    const stop = spawnSync(process.execPath, [subagentHook], {
      input: JSON.stringify({ hook_event_name: "SubagentStop", agent_type: "toolkit-specialist", session_id: sessionId, agent_id: agentId }),
      encoding: "utf8", env: commonEnv,
    });
    if (stop.status !== 0) { process.stderr.write("S16 SubagentStop failed: " + JSON.stringify(stop)); process.exit(1); }
    // Post-GREEN fixture update: the rewritten SubagentStop hook now
    // publishes an identity FENCE (M7 section 8.5: "no new retirement
    // artifact is written"), never the old per-binding <id>.retired.json --
    // that writer (retireRootSourceBinding) is already removed. Exact
    // authority_identity_id derivation (schema/provider/repo_id/
    // runtime_session_key/agent_id, hashed via canonicalJSONStringify) and
    // fence record shape (schema/authority_identity_id/reason/fenced_at,
    // reason CLOSED to exactly "agent-return") confirmed by direct read of
    // runtime-role-lifecycle.cjs own CLAUDE_AUTHORITY_IDENTITY_SCHEMA/
    // computeClaudeAuthorityIdentityId/CLAUDE_AUTHORITY_FENCE_SCHEMA/
    // CLAUDE_AUTHORITY_FENCE_KEYS/CLAUDE_AUTHORITY_FENCE_REASON_ENUM
    // constants (~1545-1571) before relying on any of it here.
    const authorityIdentity = {
      schema: "runtime/claude-authority-identity/v1",
      provider: "claude-hook",
      repo_id: rll.computeRepoId(projectRoot),
      runtime_session_key: sessionId,
      agent_id: agentId,
    };
    const authorityIdentityId = rc.sha256String(rc.canonicalJSONStringify(authorityIdentity));
    const fencePath = path.join(rll.registryRepoDir(projectRoot), "authority-identity-fences", authorityIdentityId + ".json");
    if (!fs.existsSync(fencePath)) { process.stderr.write("S16 fence record absent: " + fencePath); process.exit(1); }
    const fence = JSON.parse(fs.readFileSync(fencePath, "utf8"));
    if (fence.schema !== "runtime/claude-authority-fence/v1" || fence.authority_identity_id !== authorityIdentityId
      || fence.reason !== "agent-return") {
      process.stderr.write("S16 fence correlation invalid: " + JSON.stringify(fence)); process.exit(1);
    }
    process.stdout.write(binding.binding_id);
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$AGENT_SPAWN_GATE_HOOK" "$SUBAGENT_START_HOOK" "$session_id" "$agent_id" "$S16_RETAINED_FIXTURE"
}

_s16_grant_tree_digest() {
  local dir; dir="$(_role_command_grants_dir)"
  node -e '
    const fs = require("fs"); const path = require("path"); const crypto = require("crypto");
    const root = process.argv[1]; const rows = [];
    function walk(dir, prefix) {
      let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") return; throw e; }
      for (const ent of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
        const abs = path.join(dir, ent.name); const rel = prefix ? prefix + "/" + ent.name : ent.name;
        if (ent.isDirectory() && !ent.isSymbolicLink()) walk(abs, rel);
        else rows.push(rel + "\t" + crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"));
      }
    }
    walk(root, ""); process.stdout.write(crypto.createHash("sha256").update(rows.join("\n")).digest("hex") + ":" + rows.length);
  ' "$dir"
}

@test "S16-RSB-RETIRED-NO-LATER-GRANT-01: a genuine root-source binding retired by real SubagentStop is denied across the real requester command table with no grants, used markers, or project edits" {
  local session_id="s16-retired-session" agent_id="s16-retired-agent"
  run _s16_create_and_retire_real_root_source "$session_id" "$agent_id"
  [ "$status" -eq 0 ]
  local binding_id="$output"
  [ -n "$binding_id" ]

  local coord="$PROJ/.planning/coordination"
  local request="$coord/transactions/$(printf 'a%.0s' {1..64})/request.json"
  local plan="$PROJ/.planning/wave-tg-wave/PLAN.md"
  local subject="$coord/subject-placeholder.json"
  local artifact="$request"
  local before_grants before_status
  before_grants="$(_s16_grant_tree_digest)"
  before_status="$(git -C "$PROJ" status --porcelain=v1 -uall)"

  local -a commands=(
    "$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$coord")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" root-validate --coordination-root "$coord")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" validate --coordination-root "$coord" --kind consult-v2 --artifact "$artifact")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" publish-blob --coordination-root "$coord" --plan "$plan" --subject-bundle "$subject" --entry fixture.txt)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" publish-request --coordination-root "$coord" --plan "$plan" --subject-bundle "$subject" --intent e30)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" dispatch --coordination-root "$coord" --request "$request")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" record-delivery --coordination-root "$coord" --request "$request" --attempt "$(printf 'b%.0s' {1..64})" --epoch 0 --driver noop --outcome delivered --commit-point accepted)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" takeover --coordination-root "$coord" --request "$request")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" await-result --coordination-root "$coord" --request "$request" --timeout 1)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" accept-result --coordination-root "$coord" --request "$request")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" transaction-ack --coordination-root "$coord" --request "$request" --disposition accepted)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" cancel --coordination-root "$coord" --request "$request" --reason operator)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" worker-stop --coordination-root "$coord" --role toolkit-specialist --worker-session s16-retired-worker --kind session-shutdown --request "$request")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" cleanup --coordination-root "$coord" --request "$request")"
  )
  [ "${#commands[@]}" -eq 14 ]

  local command hook_body
  for command in "${commands[@]}"; do
    _make_input "$command" "toolkit-specialist" "$session_id" "$agent_id"
    _run_cp_hook
    [ "$status" -eq 0 ]
    hook_body="$output"
    node -e '
      const body = JSON.parse(process.argv[1]);
      const h = body && body.hookSpecificOutput;
      if (!h || h.permissionDecision !== "deny" || typeof h.permissionDecisionReason !== "string"
        || !/root-source/i.test(h.permissionDecisionReason) || !/authority-fenced/.test(h.permissionDecisionReason)) process.exit(1);
    ' "$hook_body"
    [ "$(_s16_grant_tree_digest)" = "$before_grants" ]
    [ "$(git -C "$PROJ" status --porcelain=v1 -uall)" = "$before_status" ]
  done
}

# ══════════════════════════════════════════════════════════════════════════
# S16-ROOT-SOURCE-E2E: real five-role retained plane, verbatim mechanism from
# runtime-consultation-bridge.bats (real `ensure` CLI -> real
# SupervisorExecutionClaim via fakeHostExecutorExecute's own double gate ->
# real `session-run` subprocess against a real JSONL fake-codex-app-server
# protocol peer). The fake substitutes ONLY the external model boundary
# (turn/start responses); every claim/delivery/result/accept/ack step below
# runs through production CLI/API surfaces. No READY binding is planted
# directly -- this is the harness itself, not a shortcut around it.
# ══════════════════════════════════════════════════════════════════════════

S16E2E_SUPPORT_ROLES="arch-platform,arch-testing,arch-integration,context-provider,doc-updater"
S16E2E_LC_CAPABILITY="$TG_CAPABILITY"

# _s16e2e_reorder_routing_codex_first <routing_json_path> <role>
# R2-CODEX-E2E-FIXTURE (Codex ruling, M6-M7-PRODUCTION-REACHABILITY-20260819
# round 2): rewrites ONLY the given PRIVATE fixture copy of
# runtime-routing.json (never the real repo file) so <role>'s own candidate
# list orders codex-app-server strictly before claude-agent, preserving the
# exact same driver SET and runtime-routing/v1 schema -- only <role>'s own
# array is reordered, nothing added or removed. The S16 codex-app-server
# mechanics tests below need codex-app-server to keep winning the routing
# race in THEIR OWN private fixture even now that a genuine live
# MainOrchestratorBinding (this fixture's own real hook-mediated `ensure`
# flow legitimately creates one, scoped to this exact worktree+plan) can
# make claude-agent's own liveness check pass too.
_s16e2e_reorder_routing_codex_first() {
  local routing_path="$1" role="$2"
  node -e '
    const fs = require("fs");
    const routingPath = process.argv[1];
    const role = process.argv[2];
    const policy = JSON.parse(fs.readFileSync(routingPath, "utf8"));
    if (policy.schema !== "runtime-routing/v1" || !policy.routes || !Array.isArray(policy.routes[role])) {
      process.stderr.write("reorder-routing: unexpected policy shape for role " + role + ": " + JSON.stringify(policy));
      process.exit(1);
    }
    const original = policy.routes[role];
    const driverSetSorted = original.slice().sort();
    if (!original.includes("codex-app-server") || !original.includes("claude-agent")) {
      process.stderr.write("reorder-routing: role " + role + " does not carry both codex-app-server and claude-agent: " + JSON.stringify(original));
      process.exit(1);
    }
    const rest = original.filter((d) => d !== "codex-app-server" && d !== "claude-agent");
    const reordered = ["codex-app-server", "claude-agent"].concat(rest);
    if (JSON.stringify(reordered.slice().sort()) !== JSON.stringify(driverSetSorted)) {
      process.stderr.write("reorder-routing: driver set changed for role " + role);
      process.exit(1);
    }
    policy.routes[role] = reordered;
    fs.writeFileSync(routingPath, JSON.stringify(policy));
  ' "$routing_path" "$role"
}

# _s16e2e_arm_test_routing_seam <already_reordered_routing_json_path>
# R2-C (M6-M7-R2C-TEST-SEAM-CLOSURE-20260820): the private-copy-of-scripts/lib
# reorder above has no effect on a root-source-initiated publish-request --
# that flow is structurally pinned to the REAL canonical
# runtime-consultation.cjs (context-provider-gate.js's
# findLifecycleCliInvocation admits only an exact CANONICAL_LIFECYCLE_CLI_PATH
# match; decodeRootSourceBootstrapIntentFromAction separately requires the
# embedded publish_command's own script path to equal path.join(__dirname,
# 'runtime-consultation.cjs') of whichever runtime-role-lifecycle.cjs later
# re-validates it -- always the canonical one). This arms
# RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH so the REAL canonical module
# loads ITS OWN ROUTING_POLICY_CONTENT/DIGEST from a private, TMPDIR-confined
# copy of the ALREADY-reordered bytes instead. Copies (never moves) from the
# private-copy path so both mechanisms keep working off byte-identical
# routes; placed under $RUNTIME_TMP, which every child this test spawns
# already sees as os.tmpdir() (TMPDIR exported in setup(), the seam's own
# containment check target) at mode 0600. Disarmed in teardown().
_s16e2e_arm_test_routing_seam() {
  local already_reordered_path="$1"
  local override_path="$RUNTIME_TMP/test-routing-policy.json"
  cp "$already_reordered_path" "$override_path"
  chmod 0600 "$override_path"
  S16E2E_ROUTING_OVERRIDE_PATH="$(cd "$(dirname "$override_path")" && pwd -P)/$(basename "$override_path")"
  export RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH="$S16E2E_ROUTING_OVERRIDE_PATH"
  export NODE_ENV=test
  export RUNTIME_CONSULTATION_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY"
}

# Mirrors runtime-consultation-bridge.bats' setup() exactly: session-run
# validates bridge_argv[1] against its OWN running __filename, so a real
# (non-symlink) copy of scripts/lib must live under $PROJ; roleProfileDigestFor
# resolves setup/agent-templates/<role>.md relative to that copy's __dirname.
#
# _s16e2e_bootstrap_project [routing_override_role]
# routing_override_role: optional, unset by every pre-existing caller
# (default: no override -- frozen Claude-first routing exactly as shipped in
# the real repo). When set, applies _s16e2e_reorder_routing_codex_first to
# THIS PRIVATE fixture copy immediately after the cp -R below and before any
# routing-policy-consuming call in the caller chain (the first such call is
# _s16e2e_mint_raw_action's `ensure`, inside _s16e2e_start_retained_plane).
_s16e2e_bootstrap_project() {
  local routing_override_role="${1:-}"
  # Same S16-RSB-RETIRED-NO-LATER-GRANT-01 fixture correction: subagent-start-
  # context-bundle.js's own getWaveSlug({useBranch:true,useAlias:false}) call
  # returns null on the protected default branch, and its `if (!waveSlug)
  # process.exit(0)` gate sits BEFORE root-source reservation consumption --
  # give this fixture the same resolvable non-protected branch.
  git -C "$PROJ" checkout -b "feature/s16e2e-fixture" -q 2>/dev/null
  mkdir -p "$PROJ/.planning/coordination"
  chmod 0700 "$PROJ/.planning/coordination"
  mkdir -p "$PROJ/scripts"
  # setup() already creates scripts/lib and its hermetic v1 policy fixture.
  # Preserve that projection while copying the canonical module CONTENTS;
  # copying the directory itself would create scripts/lib/lib and leave the
  # exact bridge path below absent.
  local fixture_policy
  fixture_policy="$(mktemp)"
  cp "$PROJ/scripts/lib/runtime-collaboration-policy.json" "$fixture_policy"
  cp -R "$BATS_TEST_DIRNAME/../lib/." "$PROJ/scripts/lib/"
  cp "$fixture_policy" "$PROJ/scripts/lib/runtime-collaboration-policy.json"
  S16E2E_BRIDGE="$PROJ/scripts/lib/runtime-bridge-codex.cjs"
  if [ -n "$routing_override_role" ]; then
    _s16e2e_reorder_routing_codex_first "$PROJ/scripts/lib/runtime-routing.json" "$routing_override_role"
    _s16e2e_arm_test_routing_seam "$PROJ/scripts/lib/runtime-routing.json"
  fi
  mkdir -p "$PROJ/setup"
  cp -R "$BATS_TEST_DIRNAME/../../setup/agent-templates" "$PROJ/setup/agent-templates"
  mkdir -p "$PROJ/.claude"
  cp -R "$BATS_TEST_DIRNAME/../../.claude/agents" "$PROJ/.claude/agents"

  # context-provider's real serving path (runContextProviderInternalSearch)
  # spawns the real mcp-server over stdio and resolves '@modelcontextprotocol/
  # sdk' relative to $PROJ/mcp-server/package.json -- symlink the real
  # checkout's already-built output + node_modules (100MB+, never copied) so
  # that resolution succeeds for real instead of stubbing the internal MCP
  # boundary. No docs/ exists under $PROJ, so searches legitimately return
  # zero matches -- a real "no pattern gap" outcome, not a fake one.
  mkdir -p "$PROJ/mcp-server"
  ln -s "$BATS_TEST_DIRNAME/../../mcp-server/node_modules" "$PROJ/mcp-server/node_modules"
  ln -s "$BATS_TEST_DIRNAME/../../mcp-server/build" "$PROJ/mcp-server/build"
  cp "$BATS_TEST_DIRNAME/../../mcp-server/package.json" "$PROJ/mcp-server/package.json"

  # NO-GO Correction D: the real socket-level fixture for Context7 --
  # resolveTestContext7SocketAgent redirects performDirectContext7Request's
  # own https.request to this local server (loopback only, never
  # caller/env-derived beyond a port number -- see that function's own
  # comment in runtime-bridge-codex.cjs), so the server itself only needs to
  # speak real HTTPS and answer from the SAME fixture-queue shape the prior
  # design used (statusCode/headers/bodyBase64/hang), preserving every
  # existing CP-EVIDENCE test's own S16E2E_FAKE_CONTEXT7_RESPONSES payload.
  # A throwaway self-signed cert (never added to any trust store; the test
  # agent's rejectUnauthorized:false is what accepts it, and only for
  # loopback connections) is generated once per fixture project.
  S16E2E_FAKE_CONTEXT7_SERVER="$PROJ/fake-context7-server.cjs"
  cat > "$S16E2E_FAKE_CONTEXT7_SERVER" <<'CTX7EOF'
#!/usr/bin/env node
'use strict';
const https = require('node:https');
const fs = require('node:fs');
const [, , certPath, keyPath, responsesPath, portFilePath, requestLogPath] = process.argv;
let queue = [];
try { queue = JSON.parse(fs.readFileSync(responsesPath, 'utf8')); } catch { queue = []; }
const server = https.createServer({
  cert: fs.readFileSync(certPath),
  key: fs.readFileSync(keyPath),
}, (req, res) => {
  // M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction D: recorded from the
  // request this server ACTUALLY received over the real (local) TLS
  // socket -- never the client's own pre-flight intent. `req.url` is
  // Node's raw, unparsed path+query exactly as sent (order preserved);
  // `req.headers` is the complete real header set (lower-cased keys, per
  // Node's http module); `req.socket.servername` is the SNI hostname the
  // TLS layer actually negotiated for this connection, independent of and
  // unfakeable via any header.
  if (requestLogPath) {
    try {
      fs.appendFileSync(requestLogPath, JSON.stringify({
        method: req.method,
        url: req.url,
        httpVersion: req.httpVersion,
        headers: req.headers,
        servername: req.socket.servername || null,
      }) + '\n');
    } catch { /* diagnostic only; must never block the response below */ }
  }
  const next = queue.shift();
  if (!next || next.hang === true) return; // queue exhausted or deliberate hang: let the real client-side deadline fire
  res.writeHead(next.statusCode, next.headers || {});
  res.end(Buffer.from(next.bodyBase64 || '', 'base64'));
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(portFilePath, String(server.address().port));
});
CTX7EOF
  S16E2E_FAKE_CONTEXT7_CERT="$PROJ/fake-context7-cert.pem"
  S16E2E_FAKE_CONTEXT7_KEY="$PROJ/fake-context7-key.pem"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$S16E2E_FAKE_CONTEXT7_KEY" -out "$S16E2E_FAKE_CONTEXT7_CERT" \
    -days 1 -subj "/CN=androidcommondoc-context7-test-fixture" >/dev/null 2>&1

  S16E2E_TEST_HOME="$PROJ/test-home"
  mkdir -p "$S16E2E_TEST_HOME/.codex"
  node -e '
    const fs = require("fs");
    const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const accessToken = enc({ alg: "none", typ: "JWT" }) + "." + enc({ exp: Math.floor(Date.now() / 1000) + 3600 }) + ".fixture";
    fs.writeFileSync(process.argv[1], JSON.stringify({ tokens: { access_token: accessToken, account_id: "s16-e2e-account", id_token: accessToken } }), { mode: 0o600 });
  ' "$S16E2E_TEST_HOME/.codex/auth.json"
  chmod 0600 "$S16E2E_TEST_HOME/.codex/auth.json"

  # Verbatim copy of runtime-consultation-bridge.bats' own embedded fake --
  # a real JSONL protocol peer for the full mandatory path (initialize ->
  # login+account/updated -> thread/start -> turn/start -> thread/read),
  # answering ANSWERED with content driven by the outputSchema's own
  # result_kind enum (never a hand-picked value this fixture invents).
  S16E2E_FAKE_CODEX="$PROJ/fake-codex-app-server.cjs"
  cat > "$S16E2E_FAKE_CODEX" <<'STUBEOF'
#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const readline = require('node:readline');
const mode = process.argv[2] || 'cooperative';
const pidFile = process.argv[3] || '';
const eventFile = process.argv[4] || '';
const gapSpecRaw = process.argv[5] || '';
// M67-ROOT-CONTEXT7-E2E-01 fixture fix: optional exact required-consult-question
// passthrough. When the real wire schema retains an enum, the enum branch below
// is used unchanged (existing callers that never set this stay on that path).
// When the enum is intentionally absent (the real required question contains
// CR/LF, so the production Codex wire projection uses a bounded free string
// instead of an enum), this stub must relay the caller-supplied EXACT question
// bytes rather than inventing a second, different copy -- production still
// enforces byte identity against the real required question, so any invented
// value is correctly rejected.
const requiredQuestionRaw = process.argv[6] || '';
let gapSpec = null;
if ((mode === 'context-provider-gap-once' || mode === 'context-provider-gap-always' || mode === 'consult-context-provider-once') && gapSpecRaw) {
  try { gapSpec = JSON.parse(gapSpecRaw); } catch { gapSpec = null; }
}
if (pidFile) fs.writeFileSync(pidFile, String(process.pid));
if (mode === 'ignore-term') process.on('SIGTERM', () => {});
let threadOrdinal = 0;
let turnOrdinal = 0;
const threadRecords = new Map();
const gapEmittedForThread = new Set();
// M67-ROOT-CONTEXT7-E2E-01: mirrors gapEmittedForThread's own once-per-thread
// bookkeeping, for the new 'consult-context-provider-once' mode below.
const consultEmittedForThread = new Set();
function containsKey(value, key) {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Array.isArray(value)
    ? value.some((item) => containsKey(item, key))
    : Object.values(value).some((item) => containsKey(item, key));
}
function send(frame) { process.stdout.write(JSON.stringify(frame) + '\n'); }
function record(event) {
  if (eventFile) fs.appendFileSync(eventFile, JSON.stringify(event) + '\n');
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let frame;
  try { frame = JSON.parse(line); } catch { process.exit(2); }
  if (frame.method === 'initialize') {
    send({ id: frame.id, result: { codexHome: '/tmp/fake-codex-home', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake-codex-stub/1.0.0' } });
    return;
  }
  if (frame.method === 'account/login/start') {
    send({ id: frame.id, result: { type: 'chatgptAuthTokens' } });
    send({ method: 'account/updated', params: { authMode: 'chatgptAuthTokens', planType: null } });
    return;
  }
  if (frame.method === 'thread/start') {
    threadOrdinal += 1;
    const id = 'fixture-thread-' + threadOrdinal;
    const cwd = frame.params.cwd;
    const developerInstructions = frame.params.developerInstructions || '';
    record({
      event: 'thread-start', thread_id: id, pid: process.pid,
      cwd,
      developer_instructions_sha256: crypto.createHash('sha256').update(Buffer.from(developerInstructions, 'utf8')).digest('hex'),
      developer_instructions_bytes: Buffer.byteLength(developerInstructions, 'utf8'),
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const thread = { id, sessionId: 'fixture-session-' + threadOrdinal, forkedFromId: null, parentThreadId: null, preview: '', ephemeral: false, modelProvider: 'openai', createdAt: nowSec, updatedAt: nowSec, recencyAt: null, status: { type: 'idle' }, path: null, cwd, cliVersion: '0.145.0-alpha.18', source: 'cli', threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] };
    threadRecords.set(id, thread);
    send({ id: frame.id, result: {
      thread,
      approvalPolicy: 'never', approvalsReviewer: 'user', cwd, instructionSources: [], model: 'gpt-5', modelProvider: 'openai', sandbox: { type: 'readOnly', networkAccess: false }, serviceTier: null, reasoningEffort: null,
    } });
    return;
  }
  if (frame.method === 'turn/start') {
    if (containsKey(frame.params && frame.params.outputSchema, 'oneOf')) {
      send({ id: frame.id, error: { code: -32602, message: "Invalid schema for response_format 'codex_output_schema': 'oneOf' is not permitted." } });
      return;
    }
    turnOrdinal += 1;
    const turnId = 'fixture-turn-' + turnOrdinal;
    send({ id: frame.id, result: { turn: { id: turnId, status: 'inProgress', items: [], itemsView: 'full' } } });
    const wireEnvelope = frame.params && frame.params.outputSchema
      && frame.params.outputSchema.properties
      && frame.params.outputSchema.properties.envelope;
    const terminalBranch = wireEnvelope && Array.isArray(wireEnvelope.anyOf)
      ? wireEnvelope.anyOf[0] : wireEnvelope;
    const resultBranches = terminalBranch && terminalBranch.properties
      && terminalBranch.properties.result && Array.isArray(terminalBranch.properties.result.anyOf)
      ? terminalBranch.properties.result.anyOf : [terminalBranch && terminalBranch.properties && terminalBranch.properties.result];
    const answeredBranch = resultBranches.find((branch) => branch && branch.properties && branch.properties.result_kind);
    const expectedKind = answeredBranch && answeredBranch.properties.result_kind
      && Array.isArray(answeredBranch.properties.result_kind.enum)
      ? answeredBranch.properties.result_kind.enum[0] : 'UNKNOWN';
    record({ event: 'turn-start', thread_id: frame.params.threadId, turn_id: turnId, expected_result_kind: expectedKind, pid: process.pid });
    // context-provider-gap-once: emit ONE pattern-gap instead of a terminal
    // result, but ONLY when the outputSchema the real production code sent
    // THIS turn actually admits a pattern-gap branch (codexStructuredRuntime
    // TurnEnvelopeSchema's own patternGapAllowed-gated branch) -- the resumed
    // turn after HOST_PATTERN_EVIDENCE is fed back always sets
    // patternGapAllowed:false, so that schema naturally has no such branch
    // and this falls through to terminal-result on its own, with no separate
    // "already gapped" bookkeeping required to enforce "never twice".
    const gapBranch = Array.isArray(wireEnvelope && wireEnvelope.anyOf)
      ? wireEnvelope.anyOf.find((branch) => branch && branch.properties && branch.properties.kind
          && Array.isArray(branch.properties.kind.enum) && branch.properties.kind.enum[0] === 'pattern-gap')
      : null;
    // context-provider-gap-always (S16-CP-EVIDENCE-SECOND-GAP-01): a
    // deliberately schema-noncompliant model that tries pattern-gap on
    // EVERY non-bootstrap turn including the resumed one, where
    // patternGapAllowed:false means the real outputSchema no longer offers
    // that branch at all -- proves production rejects this rather than a
    // stub that politely stays inside the schema it was handed. Bootstrap
    // (role-bootstrap) turns are EXCLUDED unconditionally: all five roles'
    // own plane-startup turn shares this same stub, and expectedKind there
    // is always 'role-bootstrap', never this test's own consult turn.
    const emitGap = gapSpec && expectedKind !== 'role-bootstrap' && (
      (mode === 'context-provider-gap-once' && gapBranch && !gapEmittedForThread.has(frame.params.threadId))
      || mode === 'context-provider-gap-always'
      || (mode === 'consult-context-provider-once' && gapBranch)
    );
    // M67-ROOT-CONTEXT7-E2E-01: schema-introspection-driven consult, mirroring
    // gapBranch's own detection -- the real production
    // codexStructuredRuntimeTurnEnvelopeSchema omits the consult-intent
    // branch entirely once a turnKindLock forbids it (point D), so "the
    // schema still offers it, and this thread has not consulted yet" is
    // sufficient; no separate role/thread bookkeeping is needed. target_role
    // and (when point D's requiredConsultQuestion pinned it) question are
    // both read directly off the real schema enum the production host just
    // sent -- never a value this stub invents independently.
    const consultBranch = mode === 'consult-context-provider-once' && Array.isArray(wireEnvelope && wireEnvelope.anyOf)
      ? wireEnvelope.anyOf.find((branch) => branch && branch.properties && branch.properties.kind
          && Array.isArray(branch.properties.kind.enum) && branch.properties.kind.enum[0] === 'consult-intent')
      : null;
    const emitConsult = consultBranch && expectedKind !== 'role-bootstrap' && !consultEmittedForThread.has(frame.params.threadId);
    const consultTargetRole = emitConsult
      && consultBranch.properties.consult.properties.target_role.enum[0];
    const consultQuestionSchema = emitConsult && consultBranch.properties.consult.properties.question;
    const consultQuestion = emitConsult
      && (Array.isArray(consultQuestionSchema.enum) ? consultQuestionSchema.enum[0] : (requiredQuestionRaw || 'fake-codex-consult-question'));
    const envelope = emitConsult
      ? (consultEmittedForThread.add(frame.params.threadId), {
        schema: 'coordination/runtime-turn-envelope/v1',
        kind: 'consult-intent',
        consult: { target_role: consultTargetRole, question: consultQuestion, expected_result_kind: 'PATTERN_EVIDENCE_REVIEW' },
      })
      : emitGap
      ? (gapEmittedForThread.add(frame.params.threadId), {
        schema: 'coordination/runtime-turn-envelope/v1',
        kind: 'pattern-gap',
        gap: gapSpec,
      })
      : {
        schema: 'coordination/runtime-turn-envelope/v1',
        kind: 'terminal-result',
        result: {
          schema: 'coordination/result-envelope/v1',
          status: 'ANSWERED',
          result_kind: expectedKind,
          content: expectedKind === 'role-bootstrap' ? 'READY' : 'fake-codex-answer:' + expectedKind,
        },
      };
    const completeTurn = () => {
      const completedTurn = {
        id: turnId, status: 'completed', itemsView: 'full',
        items: [{
          type: 'agentMessage', id: 'fixture-agent-message-' + turnOrdinal,
          phase: 'final_answer', text: JSON.stringify({ envelope }), memoryCitation: null,
        }],
      };
      const thread = threadRecords.get(frame.params.threadId);
      if (thread) thread.turns.push(completedTurn);
      record({ event: 'turn-completed', thread_id: frame.params.threadId, turn_id: turnId, expected_result_kind: expectedKind, pid: process.pid });
      send({ method: 'turn/completed', params: { threadId: frame.params.threadId, turn: completedTurn } });
    };
    setImmediate(completeTurn);
    return;
  }
  if (frame.method === 'thread/read') {
    record({ event: 'thread-read', thread_id: frame.params.threadId, include_turns: frame.params.includeTurns, pid: process.pid });
    const thread = threadRecords.get(frame.params.threadId);
    if (!thread) { send({ id: frame.id, error: { code: -32000, message: 'thread not found' } } ); return; }
    send({ id: frame.id, result: { thread: { ...thread, turns: frame.params.includeTurns ? thread.turns : [] } } });
    return;
  }
  if (frame.method === 'thread/archive') {
    record({ event: 'thread-archive', thread_id: frame.params.threadId, pid: process.pid });
    send({ id: frame.id, result: {} });
    return;
  }
});
STUBEOF
  chmod +x "$S16E2E_FAKE_CODEX"
  S16E2E_FAKE_APP_SERVER_EVENTS="$(mktemp)"
  # S16E2E_FAKE_MODE/S16E2E_FAKE_GAP_SPEC: optional caller-set overrides (unset
  # by every existing caller, so "cooperative"/"" -- today's exact behavior --
  # is unchanged). CP-EVIDENCE-E2E sets S16E2E_FAKE_MODE=context-provider-gap-once
  # plus a JSON gap descriptor before calling this.
  S16E2E_FAKE_APP_SERVER_SPAWN_JSON="$(node -e '
    process.stdout.write(JSON.stringify({
      command: process.execPath,
      args: [process.argv[1], process.argv[3], "", process.argv[2], process.argv[4], process.argv[5]],
    }));
  ' "$S16E2E_FAKE_CODEX" "$S16E2E_FAKE_APP_SERVER_EVENTS" "${S16E2E_FAKE_MODE:-cooperative}" "${S16E2E_FAKE_GAP_SPEC:-}" "${S16E2E_FAKE_REQUIRED_QUESTION:-}")"
}

# Mirrors _mint_raw_action from runtime-consultation-bridge.bats: mints a
# REAL supervisor-start action via the real `ensure` CLI. Prints action_json\tbinding_id.
_s16e2e_mint_raw_action() {
  local roles_csv="$1" session_key="$2" ttl="${3:-3600}"
  local -a role_flags=()
  local r
  for r in ${roles_csv//,/ }; do role_flags+=(--role "$r"); done

  # NO-GO Correction D: the real hook-mediated round trip -- no direct
  # createMainOrchestratorBinding/mintLifecycleCommandGrant call anywhere in
  # this path. context-provider-gate.js's own tryInjectLifecycleGrant ->
  # resolveOrMintLifecycleGrant -> getOrCreateMainOrchestratorBindingForSession
  # creates the MainOrchestratorBinding on demand for a session with none
  # yet (this fixture's `ensure` IS that session's first lifecycle command,
  # exactly as a real top-level orchestrator's own first `ensure` would be),
  # then mints+injects a real one-use lifecycle-command-grant/v1 -- the SAME
  # round trip context-provider-gate.test.js's own MAIN-BINDING-LIVE-SEQUENCE
  # proves for `ensure`, and _s16e2e_consult_root_publish/
  # _s16e2e_setup_through_binding already prove elsewhere in this file for
  # consult-root/root-source.
  local ensure_cmd; ensure_cmd="$(_render_posix_direct node "$RLL_IMPL" ensure --project-root "$PROJ" "${role_flags[@]}")"
  _make_input "$ensure_cmd" "" "$session_key"
  _run_cp_hook
  if [ "$status" -ne 0 ]; then echo "ensure hook call failed: $output" >&2; return 1; fi
  local lifecycle_grant; lifecycle_grant="$(_extract_injected lifecycle-binding)"
  if [ -z "$lifecycle_grant" ]; then echo "ensure hook did not inject a lifecycle-binding grant: $output" >&2; return 1; fi

  # RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES is a routing-only seam (pretends
  # codex-app-server is a capability-proven connector without a real Codex
  # install) -- ttl (process.argv[5] in the prior direct-construction form)
  # is no longer caller-selected: the grant/binding TTL now comes from the
  # SAME production derivation every real ensure call uses.
  local ensure_out
  ensure_out="$(NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["codex-app-server"]' node "$RLL_IMPL" ensure --project-root "$PROJ" "${role_flags[@]}" --lifecycle-binding "$lifecycle_grant")"
  if [ $? -ne 0 ]; then echo "real ensure CLI failed: $ensure_out" >&2; return 1; fi

  node -e '
    const result = JSON.parse(process.argv[1]);
    const action = result.actions && result.actions.find((a) => a.kind === "supervisor-start");
    if (!action) { process.stderr.write("no supervisor-start action minted: " + process.argv[1]); process.exit(1); }
    process.stdout.write(JSON.stringify(action));
  ' "$ensure_out"
}

_s16e2e_mint_execution_claim() {
  local action_json="$1" session_key="$2"
  # NO-GO Correction D: the real bridge_command admission hook
  # (context-provider-gate.js's tryInjectSupervisorExecutionClaim) recognizes
  # the canonical rendering of THIS action's own bridge_argv, deep-validates
  # it against the real, current, unconsumed action, and mints a REAL
  # SupervisorExecutionClaim/v1 via mintSupervisorExecutionClaimForSession --
  # never the test-only double-gated fakeHostExecutorExecute. session-run
  # independently re-validates+consumes the claim itself when it starts
  # (validateAndConsumeExecutionClaim), so nothing here needs to hand it
  # anything beyond proving the hook's own admission actually fired.
  local bridge_command; bridge_command="$(node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    process.stdout.write(rll.renderPosixDirect(action.payload.bridge_argv));
  ' "$RLL_IMPL" "$action_json")"

  _make_input "$bridge_command" "" "$session_key"
  _run_cp_hook
  if [ "$status" -ne 0 ]; then echo "supervisor-start hook call failed: $output" >&2; return 1; fi
  node -e '
    const b = JSON.parse(process.argv[1]);
    const h = b && b.hookSpecificOutput;
    if (!h || h.permissionDecision !== "allow" || !h.updatedInput
      || h.updatedInput.run_in_background !== true || h.updatedInput.command !== process.argv[2]) {
      process.stderr.write("supervisor-start admission failed: " + process.argv[1]); process.exit(1);
    }
  ' "$output" "$bridge_command"
}

_s16e2e_argv_from_action() {
  node -e '
    const action = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(action.payload.bridge_argv.slice(3)));
  ' "$1"
}

_s16e2e_args_from_json() {
  local args=()
  while IFS= read -r line; do args+=("$line"); done < <(node -e 'JSON.parse(process.argv[1]).forEach((v) => process.stdout.write(v + "\n"))' "$1")
  printf '%s\n' "${args[@]}"
}

_s16e2e_start_bridge_bg() {
  local argv_json="$1"
  local args=()
  while IFS= read -r line; do args+=("$line"); done < <(_s16e2e_args_from_json "$argv_json")
  S16E2E_TIMING_LOG="$(mktemp)"
  # NO-GO Correction D: RUNTIME_BRIDGE_CODEX_FAKE_CONTEXT7_SERVER_PORT points
  # the bridge's own resolveTestContext7SocketAgent at a REAL local HTTPS
  # server (started below) instead of substituting the whole request/
  # response round trip -- optional, unset by every caller except
  # CP-EVIDENCE-E2E, so this is a pure no-op addition for every other test.
  S16E2E_CONTEXT7_SERVER_PID=""
  local context7_responses_path="" context7_server_port=""
  # M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction D: S16E2E_FAKE_CONTEXT7_REQUEST_LOG
  # is the server-side, real-socket recording (fake-context7-server.cjs's own
  # req.method/req.url/req.headers/req.socket.servername) -- the ONLY log a
  # test's own assertions may read. RUNTIME_BRIDGE_CODEX_FAKE_CONTEXT7_CONN_LOG
  # is resolveTestContext7SocketAgent's OWN createConnection-boundary
  # recording of the real connection options node's https.Agent internals
  # pass it. Both always created alongside the server (never conditional on
  # S16E2E_FAKE_CONTEXT7_LOG, which no longer exists as a client-side
  # pre-flight substitute).
  S16E2E_FAKE_CONTEXT7_REQUEST_LOG=""
  local context7_conn_log=""
  if [ -n "${S16E2E_FAKE_CONTEXT7_RESPONSES:-}" ]; then
    context7_responses_path="$(mktemp)"
    printf '%s' "$S16E2E_FAKE_CONTEXT7_RESPONSES" > "$context7_responses_path"
    local port_file; port_file="$(mktemp)"
    S16E2E_FAKE_CONTEXT7_REQUEST_LOG="$(mktemp)"
    context7_conn_log="$(mktemp)"
    # M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction F: explicit stdin/stdout/
    # stderr, never inherited from this script. An inherited stdout fd stays
    # OPEN in this backgrounded child for as long as the child itself is
    # alive -- any LATER `run`/`$(...)` capture elsewhere in the SAME shell
    # that tries to read that same fd to EOF (bats' own `run` included) can
    # then block until this long-lived server eventually exits, regardless
    # of whether the command actually being captured already finished. This
    # is the harness hang root cause for the CP-EVIDENCE negative suite
    # below, never a production one.
    node "$S16E2E_FAKE_CONTEXT7_SERVER" "$S16E2E_FAKE_CONTEXT7_CERT" "$S16E2E_FAKE_CONTEXT7_KEY" "$context7_responses_path" "$port_file" "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" \
      < /dev/null > "$(mktemp)" 2>&1 &
    S16E2E_CONTEXT7_SERVER_PID=$!
    local tries=0
    while [ ! -s "$port_file" ] && [ "$tries" -lt 100 ]; do sleep 0.05; tries=$((tries + 1)); done
    context7_server_port="$(cat "$port_file" 2>/dev/null)"
    [ -n "$context7_server_port" ]
  fi
  S16E2E_FAKE_CONTEXT7_CONN_LOG="$context7_conn_log"
  env HOME="$S16E2E_TEST_HOME" NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_FAKE_APP_SERVER_SPAWN="$S16E2E_FAKE_APP_SERVER_SPAWN_JSON" S16E2E_TIMING_LOG="$S16E2E_TIMING_LOG" RUNTIME_BRIDGE_CODEX_FAKE_CONTEXT7_SERVER_PORT="$context7_server_port" RUNTIME_BRIDGE_CODEX_FAKE_CONTEXT7_CONN_LOG="$context7_conn_log" node "$S16E2E_BRIDGE" session-run "${args[@]}" >"$S16E2E_BG_OUT" 2>&1 &
  S16E2E_BG_PID=$!
}

_s16e2e_owner_file() {
  local role="$1"
  find "$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL_IMPL" "$PROJ")/rendezvous/role-owners" -name "${role}.json" 2>/dev/null | head -1
}

_s16e2e_wait_for_owner_file() {
  local role="$1"
  for _ in $(seq 1 150); do
    local f; f="$(_s16e2e_owner_file "$role")"
    if [ -n "$f" ] && [ -f "$f" ]; then echo "$f"; return 0; fi
    sleep 0.1
  done
  if [ -f "$S16E2E_BG_OUT" ]; then sed 's/^/# bridge: /' "$S16E2E_BG_OUT" >&2; fi
  return 1
}

_s16e2e_binding_state_json() {
  local role="$1" action_json="$2"
  node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    const role = process.argv[3];
    const state = rll.readRoleBindingState(process.argv[4], action.worktree_id, action.plan_digest, rll.roleProfileDigestFor(role), action.session_generation_id, role);
    process.stdout.write(JSON.stringify(state));
  ' "$RLL_IMPL" "$action_json" "$role" "$PROJ"
}

_s16e2e_wait_for_role_state() {
  local role="$1" action_json="$2" wanted="$3"
  local observed=""
  for _ in $(seq 1 150); do
    observed="$(_s16e2e_binding_state_json "$role" "$action_json")"
    [[ "$observed" == *'"state":"'"$wanted"'"'* ]] && { printf '%s' "$observed"; return 0; }
    sleep 0.1
  done
  printf '# last binding: %s\n' "$observed" >&2
  if [ -f "$S16E2E_BG_OUT" ]; then sed 's/^/# bridge: /' "$S16E2E_BG_OUT" >&2; fi
  return 1
}

# Mints + starts the real five-role retained plane, waits for every role to
# reach READY. Sets S16E2E_ACTION_JSON/S16E2E_BG_PID/S16E2E_BG_OUT as a side
# effect; caller is responsible for `kill -TERM "$S16E2E_BG_PID"` teardown.
_s16e2e_start_retained_plane() {
  local session_key="$1"
  local roles_csv="${2:-$S16E2E_SUPPORT_ROLES}"
  local ttl="${3:-3600}"
  local routing_override_role="${4:-}"
  _s16e2e_bootstrap_project "$routing_override_role"
  S16E2E_BG_OUT="$(mktemp)"
  local argv_json role
  S16E2E_ACTION_JSON="$(_s16e2e_mint_raw_action "$roles_csv" "$session_key" "$ttl")"
  [ -n "$S16E2E_ACTION_JSON" ]
  _s16e2e_mint_execution_claim "$S16E2E_ACTION_JSON" "$session_key" >/dev/null
  argv_json="$(_s16e2e_argv_from_action "$S16E2E_ACTION_JSON")"
  _s16e2e_start_bridge_bg "$argv_json"
  # Split on commas via parameter expansion, never `IFS=','` -- bash `local`
  # is dynamically scoped, so mutating IFS here would leak into every callee
  # for the rest of this function's call stack, including
  # _s16e2e_wait_for_owner_file's `for _ in $(seq 1 150)` retry loop (which
  # needs the DEFAULT whitespace/newline IFS to split seq's output into 150
  # iterations -- with IFS=',' that loop silently collapses to one).
  for role in ${roles_csv//,/ }; do
    _s16e2e_wait_for_owner_file "$role" >/dev/null
    _s16e2e_wait_for_role_state "$role" "$S16E2E_ACTION_JSON" READY >/dev/null
  done
}

# M6+M7 SIXTEENTH Phase 2D: a relative-path + per-file sha256 manifest of
# every regular file under $1, sorted for a stable, directly diffable text
# form -- used to prove a rejected/fail-closed operation performed exactly
# zero writes (no new activation/delivery/inbox/result file, no changed
# byte in any pre-existing one) rather than hand-listing specific
# subdirectory names a future change could silently miss.
_s16_snapshot_tree() {
  local root="$1"
  if [ ! -d "$root" ]; then printf 'ABSENT'; return 0; fi
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const root = process.argv[1];
    const lines = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.isFile()) continue;
        const digest = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
        lines.push(path.relative(root, full).split(path.sep).join("/") + " " + digest);
      }
    })(root);
    lines.sort();
    process.stdout.write(lines.join("\n"));
  ' "$root"
}

_s16e2e_stop_retained_plane() {
  # `wait <pid>` on a process this same function just SIGTERM'd reports that
  # signal's own 128+15=143 exit status (bash's standard encoding) even on a
  # perfectly clean, expected shutdown -- e.g. the fake Context7 server has no
  # SIGTERM handler of its own and always dies via the OS default action.
  # Bare (non-`run`-wrapped) at every call site, so without `|| true` bats
  # treats that as the TEST failing at its own cleanup line regardless of
  # whether every real assertion above already passed -- pure cleanup, never
  # an assertion, so its own exit code must never fail the caller.
  if [ -n "$S16E2E_BG_PID" ]; then
    kill -TERM "$S16E2E_BG_PID" 2>/dev/null
    wait "$S16E2E_BG_PID" 2>/dev/null || true
    S16E2E_BG_PID=""
  fi
  if [ -n "${S16E2E_CONTEXT7_SERVER_PID:-}" ]; then
    kill -TERM "$S16E2E_CONTEXT7_SERVER_PID" 2>/dev/null
    wait "$S16E2E_CONTEXT7_SERVER_PID" 2>/dev/null || true
    S16E2E_CONTEXT7_SERVER_PID=""
  fi
}

@test "S16E2E-SMOKE: real five-role retained plane (session-run + fake app-server) reaches READY for all five roles" {
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "s16e2e-smoke-session"
  local live
  live="$(node -e '
    const rbc = require(process.argv[1]);
    const live = rbc.resolveLiveCodexAppServerWorker(process.argv[2], "arch-platform", require(process.argv[3]).roleProfileDigestFor("arch-platform"));
    process.stdout.write(JSON.stringify({ ok: live.ok, available: live.available }));
  ' "$LIB_DIR/runtime-bridge-codex.cjs" "$PROJ" "$RLL_IMPL")"
  _s16e2e_stop_retained_plane
  [[ "$live" == *'"ok":true'* ]]
  [[ "$live" == *'"available":true'* ]]
}


# Shared setup, steps 1-6 of the S16-ROOT-SOURCE-E2E spec: real five-role
# plane -> real root-source CLI -> real Agent/SubagentStart (incl. replay-
# deny + zero-candidate passthrough) -> real WAL publish+ingress via
# hook/CLI. Sets S16E2E_{ACTION_ID,BINDING_ID,BINDINGS_DIR,REQUEST_ID,
# REQUEST_PATH,COORD_ROOT,SESSION_ID,AGENT_ID}. Caller supplies distinct
# session_id/agent_id so parallel bats processes (race controls) never collide.
_s16e2e_setup_through_binding() {
  local session_id="$1" agent_id="$2"
  local routing_override_role="${3:-}"
  # M67-ROOT-CONTEXT7-E2E-01: optional 4th/5th positional overrides for the
  # root-source question/expected_result_kind, defaulting to the original
  # hardcoded values verbatim -- every pre-existing caller (all of which pass
  # at most 3 args) is byte-for-byte unaffected.
  local question_override="${4:-S16 ROOT-SOURCE-E2E: review the WAL serialization implementation.}"
  local result_kind_override="${5:-IMPLEMENTATION_REVIEW}"
  S16E2E_SESSION_ID="$session_id"
  S16E2E_AGENT_ID="$agent_id"
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "$session_id" "" "" "$routing_override_role"

  local intent
  intent="$(node -e '
    const rc = require(process.argv[1]);
    process.stdout.write(Buffer.from(rc.canonicalJSONStringify({
      source_role: "toolkit-specialist", reporting_architect: "arch-platform",
      question: process.argv[2],
      expected_result_kind: process.argv[3],
    }), "utf8").toString("base64url"));
  ' "$CONSULTATION_CLI" "$question_override" "$result_kind_override")"
  local rs_cmd; rs_cmd="$(_render_posix_direct node "$RLL_IMPL" root-source --project-root "$PROJ" --intent "$intent")"
  _make_input "$rs_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local lifecycle_grant; lifecycle_grant="$(_extract_injected lifecycle-binding)"
  [ -n "$lifecycle_grant" ]

  run env NODE_ENV=test node "$RLL_IMPL" root-source --project-root "$PROJ" --intent "$intent" --lifecycle-binding "$lifecycle_grant"
  [ "$status" -eq 0 ]
  local rs_envelope="$output"
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "ACTION_REQUIRED" || !e.operation || e.operation.kind !== "root-source"
      || e.operation.request_id !== null || !Array.isArray(e.actions) || e.actions.length !== 1) process.exit(1);
  ' "$rs_envelope"

  S16E2E_ACTION_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation.operation_id)' "$rs_envelope")"
  local bootstrap_message; bootstrap_message="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).actions[0].payload.bootstrap_message)' "$rs_envelope")"
  local agent_type_p; agent_type_p="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).actions[0].payload.agent_type)' "$rs_envelope")"
  local name_p; name_p="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).actions[0].payload.name)' "$rs_envelope")"
  S16E2E_BOOTSTRAP_MESSAGE="$bootstrap_message"

  # ---- 4: real PreToolUse/Agent gate ----
  local gate_body
  gate_body="$(NODE_ENV=test CLAUDE_PROJECT_DIR="$PROJ" node "$AGENT_SPAWN_GATE_HOOK" <<EOF
{"tool_name":"Agent","tool_input":{"subagent_type":"$agent_type_p","name":"$name_p","prompt":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$bootstrap_message")},"tool_use_id":"$session_id-tool-use-01","session_id":"$session_id","agent_type":"","agent_id":""}
EOF
)"
  node -e '
    const b = JSON.parse(process.argv[1]);
    if (!b.hookSpecificOutput || b.hookSpecificOutput.permissionDecision !== "allow") process.exit(1);
  ' "$gate_body"

  # Replay of the SAME owning call must be denied (no-clobber reservation).
  local replay_body
  replay_body="$(NODE_ENV=test CLAUDE_PROJECT_DIR="$PROJ" node "$AGENT_SPAWN_GATE_HOOK" <<EOF
{"tool_name":"Agent","tool_input":{"subagent_type":"$agent_type_p","name":"$name_p","prompt":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$bootstrap_message")},"tool_use_id":"$session_id-tool-use-01b","session_id":"$session_id","agent_type":"","agent_id":""}
EOF
)"
  node -e '
    const b = JSON.parse(process.argv[1]);
    if (!b.hookSpecificOutput || b.hookSpecificOutput.permissionDecision !== "deny") process.exit(1);
  ' "$replay_body"

  # Zero-candidate call (unrelated role) stays silent non-owning pass-through.
  run env NODE_ENV=test CLAUDE_PROJECT_DIR="$PROJ" node "$AGENT_SPAWN_GATE_HOOK" <<< "{\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"verifier\",\"name\":\"verifier\"},\"tool_use_id\":\"$session_id-unrelated\",\"session_id\":\"$session_id-unrelated-session\",\"agent_type\":\"\",\"agent_id\":\"\"}"
  [ "$status" -eq 0 ]
  [ -z "$output" ]

  # ---- 5: real SubagentStart -> exactly one correlated RootSourceBinding ----
  run env NODE_ENV=test CLAUDE_PROJECT_DIR="$PROJ" node "$SUBAGENT_START_HOOK" <<< "{\"hook_event_name\":\"SubagentStart\",\"agent_type\":\"toolkit-specialist\",\"session_id\":\"$session_id\",\"agent_id\":\"$agent_id\"}"
  [ "$status" -eq 0 ]

  S16E2E_BINDINGS_DIR="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL_IMPL" "$PROJ")/root-source-bindings"
  local action_id="$S16E2E_ACTION_ID"
  S16E2E_BINDING_ID="$(node -e '
    const fs = require("fs"); const path = require("path");
    const dir = process.argv[1]; const actionId = process.argv[2];
    const sessionId = process.argv[3]; const agentId = process.argv[4];
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /^[a-f0-9]{32}\.json$/.test(e.name))
      .map((e) => JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8")))
      .filter((b) => b.action_id === actionId && b.runtime_session_key === sessionId && b.agent_id === agentId);
    if (entries.length !== 1) { process.stderr.write("expected exactly one binding, got " + entries.length); process.exit(1); }
    process.stdout.write(entries[0].binding_id);
  ' "$S16E2E_BINDINGS_DIR" "$action_id" "$session_id" "$agent_id")"
  [ -n "$S16E2E_BINDING_ID" ]
}

# Steps 1-6: through binding creation, then the real WAL publish+ingress via
# hook/CLI. Depends on _s16e2e_setup_through_binding's globals.
_s16e2e_setup_through_ingress() {
  _s16e2e_setup_through_binding "$1" "$2" "$3" "$4" "$5"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local bootstrap_message="$S16E2E_BOOTSTRAP_MESSAGE"

  # ---- 6: real serializeRootSourcePublishRequest via hook/CLI ----
  local publish_cmd; publish_cmd="$(node -e '
    const msg = process.argv[1];
    const lines = msg.split("\n");
    process.stdout.write(lines[3].slice("publish_command=".length));
  ' "$bootstrap_message")"
  S16E2E_PUBLISH_CMD="$publish_cmd"
  _make_input "$publish_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local requester_grant_1; requester_grant_1="$(_extract_injected requester-binding)"
  [ -n "$requester_grant_1" ]
  local publish_argv; publish_argv="$(node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(JSON.stringify(rll.parsePosixDirect(process.argv[2])));
  ' "$RLL_IMPL" "$publish_cmd")"
  S16E2E_PUBLISH_ARGV="$publish_argv"
  S16E2E_COORD_ROOT="$(node -e '
    const rll = require(process.argv[1]);
    const tokens = rll.parsePosixDirect(process.argv[2]);
    process.stdout.write(tokens[tokens.indexOf("--coordination-root") + 1]);
  ' "$RLL_IMPL" "$publish_cmd")"
  [ -n "$S16E2E_COORD_ROOT" ]
  run node -e '
    const { spawnSync } = require("child_process");
    const argv = JSON.parse(process.argv[1]).slice(1).concat(["--requester-binding", process.argv[2]]);
    const r = spawnSync(process.execPath, argv, { encoding: "utf8", env: Object.assign({}, process.env, { NODE_ENV: "test" }) });
    process.stdout.write(r.stdout || "");
    process.stderr.write(r.stderr || "");
    process.exit(r.status === 0 ? 0 : 1);
  ' "$publish_argv" "$requester_grant_1"
  [ "$status" -eq 0 ]
  local publish_envelope="$output"
  S16E2E_REQUEST_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).request_id)' "$publish_envelope")"
  S16E2E_REQUEST_PATH="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).artifact_ref)' "$publish_envelope")"
  [ -n "$S16E2E_REQUEST_ID" ]
  [ -f "$S16E2E_REQUEST_PATH" ]

  local ingress_path="$S16E2E_BINDINGS_DIR/$S16E2E_BINDING_ID.ingress.json"
  [ -f "$ingress_path" ]
  node -e '
    const fs = require("fs");
    const ingress = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (ingress.request_id !== process.argv[2] || ingress.binding_id !== process.argv[3]) process.exit(1);
  ' "$ingress_path" "$S16E2E_REQUEST_ID" "$S16E2E_BINDING_ID"

  # Once ingress is durable, publish-request is no longer an admitted
  # pre-ingress subcommand for this binding -- the hook's own admission gate
  # (mintRoleCommandGrant's ingress-aware pre/post partition) refuses a
  # second grant outright, never minting a duplicate. This is the PRIMARY
  # defense; S16-ROOT-SOURCE-WAL-RECOVERY (below) separately proves the WAL
  # layer's own crash-before-ingress recovery for the narrower window this
  # gate cannot see (a retry racing back in BEFORE ingress exists).
  _make_input "$publish_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  node -e '
    const b = JSON.parse(process.argv[1]);
    const h = b && b.hookSpecificOutput;
    if (!h || h.permissionDecision !== "deny") process.exit(1);
  ' "$output"
  local txn_count; txn_count="$(find "$(dirname "$(dirname "$S16E2E_REQUEST_PATH")")" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
  [ "$txn_count" -eq 1 ]
}

# R2C-S16-INTEGRITY (M6-M7-R2C-EVIDENCE-CLOSURE-20260820): test-only routing-
# integrity invariants bracketing the real dispatch call in the four S16
# root-source tests below. Independently of each test's own SUCCESS/
# UNAVAILABLE assertion, proves the REAL canonical runtime-consultation.cjs
# this dispatch call executes (a) actually loaded its ROUTING_POLICY_CONTENT
# from the SAME bytes this test's own private, TMPDIR-confined override
# ($S16E2E_ROUTING_OVERRIDE_PATH) holds -- never a stale/substituted/
# canonical-fallback digest -- and (b) never mutates that override's
# published plan-root snapshot or the real repo's own
# scripts/lib/runtime-routing.json as a side effect of dispatch. Read-only:
# touches no production file, writes only its own baseline copies under this
# test's own private $RUNTIME_TMP (already isolated/mode-0700/owner-checked
# by setup()'s own _assert_isolated_runtime_tmp), and never rewrites the
# snapshot itself after publish-request.
_r2c_s16_integrity_sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# _r2c_s16_integrity_predispatch <request_path>
# Run immediately before the real dispatch subprocess launches. Sets the
# R2C_S16_* globals the matching _r2c_s16_integrity_postdispatch call below
# re-verifies against -- every baseline is captured HERE, never re-derived
# from the artifact being validated at check time.
_r2c_s16_integrity_predispatch() {
  local request_path="$1"
  if [ ! -f "$request_path" ]; then
    echo "R2C-S16-INTEGRITY:snapshot-missing" >&2
    return 1
  fi
  local req_digest
  req_digest="$(node -e '
    const fs = require("fs");
    process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).routing_policy_digest || "");
  ' "$request_path")"
  local override_digest
  override_digest="$(_r2c_s16_integrity_sha256_file "$S16E2E_ROUTING_OVERRIDE_PATH")"
  if [ -z "$req_digest" ] || [ "$req_digest" != "$override_digest" ]; then
    echo "R2C-S16-INTEGRITY:request-digest-mismatch" >&2
    return 1
  fi

  local plan_root snapshot_path
  plan_root="$(dirname "$(dirname "$(dirname "$request_path")")")"
  snapshot_path="$plan_root/routing-policies/$req_digest.json"
  if [ ! -f "$snapshot_path" ]; then
    echo "R2C-S16-INTEGRITY:snapshot-missing" >&2
    return 1
  fi
  if ! cmp -s "$snapshot_path" "$S16E2E_ROUTING_OVERRIDE_PATH"; then
    echo "R2C-S16-INTEGRITY:snapshot-not-override" >&2
    return 1
  fi

  local baseline_dir="$RUNTIME_TMP/r2c-s16-integrity-baseline"
  mkdir -p "$baseline_dir"
  chmod 0700 "$baseline_dir"
  cp "$snapshot_path" "$baseline_dir/snapshot-baseline.json"
  chmod 0600 "$baseline_dir/snapshot-baseline.json"
  cp "$LIB_DIR/runtime-routing.json" "$baseline_dir/canonical-baseline.json"
  chmod 0600 "$baseline_dir/canonical-baseline.json"

  R2C_S16_BASELINE_DIR="$baseline_dir"
  R2C_S16_SNAPSHOT_PATH="$snapshot_path"
  R2C_S16_REQUEST_DIGEST="$req_digest"
  R2C_S16_SNAPSHOT_BASELINE_SHA="$(_r2c_s16_integrity_sha256_file "$baseline_dir/snapshot-baseline.json")"
  R2C_S16_CANONICAL_BASELINE_SHA="$(_r2c_s16_integrity_sha256_file "$baseline_dir/canonical-baseline.json")"
}

# _r2c_s16_integrity_postdispatch <request_path>
# Run immediately after the real dispatch subprocess returns, unconditionally
# on its SUCCESS/UNAVAILABLE outcome. Every comparison target was captured by
# the matching _r2c_s16_integrity_predispatch call above, BEFORE dispatch
# ran -- no check here derives its "expected" value from the artifact it is
# validating.
_r2c_s16_integrity_postdispatch() {
  local request_path="$1"
  if [ ! -f "$request_path" ]; then
    echo "R2C-S16-INTEGRITY:snapshot-missing" >&2
    return 1
  fi
  local req_digest_after
  req_digest_after="$(node -e '
    const fs = require("fs");
    process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).routing_policy_digest || "");
  ' "$request_path")"
  if [ "$req_digest_after" != "$R2C_S16_REQUEST_DIGEST" ]; then
    echo "R2C-S16-INTEGRITY:request-digest-mismatch" >&2
    return 1
  fi
  if [ ! -f "$R2C_S16_SNAPSHOT_PATH" ]; then
    echo "R2C-S16-INTEGRITY:snapshot-missing" >&2
    return 1
  fi
  if ! cmp -s "$R2C_S16_SNAPSHOT_PATH" "$R2C_S16_BASELINE_DIR/snapshot-baseline.json"; then
    echo "R2C-S16-INTEGRITY:snapshot-mutated" >&2
    return 1
  fi
  if ! cmp -s "$R2C_S16_SNAPSHOT_PATH" "$S16E2E_ROUTING_OVERRIDE_PATH"; then
    echo "R2C-S16-INTEGRITY:snapshot-not-override" >&2
    return 1
  fi
  if ! cmp -s "$LIB_DIR/runtime-routing.json" "$R2C_S16_BASELINE_DIR/canonical-baseline.json"; then
    echo "R2C-S16-INTEGRITY:repo-routing-mutated" >&2
    return 1
  fi

  local snapshot_sha_after canonical_sha_after
  snapshot_sha_after="$(_r2c_s16_integrity_sha256_file "$R2C_S16_SNAPSHOT_PATH")"
  if [ "$snapshot_sha_after" != "$R2C_S16_SNAPSHOT_BASELINE_SHA" ]; then
    echo "R2C-S16-INTEGRITY:snapshot-mutated" >&2
    return 1
  fi
  canonical_sha_after="$(_r2c_s16_integrity_sha256_file "$LIB_DIR/runtime-routing.json")"
  if [ "$canonical_sha_after" != "$R2C_S16_CANONICAL_BASELINE_SHA" ]; then
    echo "R2C-S16-INTEGRITY:repo-routing-mutated" >&2
    return 1
  fi
}

@test "S16-ROOT-SOURCE-E2E: real five-role plane -> real root-source CLI -> real Agent/SubagentStart -> real WAL publish -> dispatch selects codex-app-server -> real bridge-path result -> real accept/ack -> durable retirement -> root-source-status READY" {
  _s16e2e_setup_through_ingress "s16e2e-rs-session" "s16e2e-rs-agent" "arch-platform"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local action_id="$S16E2E_ACTION_ID" binding_id="$S16E2E_BINDING_ID" bindings_dir="$S16E2E_BINDINGS_DIR"
  local request_path="$S16E2E_REQUEST_PATH" coord_root="$S16E2E_COORD_ROOT"

  # ---- 7-9: dispatch selects codex-app-server; retained bridge answers via
  # the real turn/start->turn/completed->thread/read protocol; await-result
  # observes it ----
  # R2-C (M6-M7-R2C-TEST-SEAM-CLOSURE-20260820): the private-copy override
  # alone was proven insufficient for this exact root-source-initiated flow
  # (see _s16e2e_arm_test_routing_seam's own header comment for the full,
  # empirically-confirmed root cause). _s16e2e_setup_through_ingress above
  # already armed RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH for the REAL
  # canonical runtime-consultation.cjs this dispatch call actually executes,
  # so codex-app-server now genuinely wins the routing race for this request.
  local dispatch_cmd; dispatch_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path")"
  _make_input "$dispatch_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local dispatch_grant; dispatch_grant="$(_extract_injected requester-binding)"
  [ -n "$dispatch_grant" ]
  _r2c_s16_integrity_predispatch "$request_path"
  run node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path" --requester-binding "$dispatch_grant"
  _r2c_s16_integrity_postdispatch "$request_path"
  [ "$status" -eq 0 ]
  local activation_path; activation_path="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  node -e '
    const fs = require("fs");
    const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (a.selected_driver !== "codex-app-server") { process.stderr.write("wrong driver: " + a.selected_driver); process.exit(1); }
  ' "$activation_path"

  local await_cmd; await_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" await-result --coordination-root "$coord_root" --request "$request_path" --timeout 15)"
  _make_input "$await_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local await_grant; await_grant="$(_extract_injected requester-binding)"
  [ -n "$await_grant" ]
  run node "$CONSULTATION_CLI" await-result --coordination-root "$coord_root" --request "$request_path" --timeout 15 --requester-binding "$await_grant"
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "SUCCESS" && e.status !== "READY") { process.stderr.write("await-result: " + JSON.stringify(e)); process.exit(1); }
  ' "$output"

  # ---- 10: real accept-result + transaction-ack ----
  local accept_cmd; accept_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" accept-result --coordination-root "$coord_root" --request "$request_path")"
  _make_input "$accept_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local accept_grant; accept_grant="$(_extract_injected requester-binding)"
  [ -n "$accept_grant" ]
  run node "$CONSULTATION_CLI" accept-result --coordination-root "$coord_root" --request "$request_path" --requester-binding "$accept_grant"
  [ "$status" -eq 0 ]

  local ack_cmd; ack_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" transaction-ack --coordination-root "$coord_root" --request "$request_path" --disposition accepted)"
  _make_input "$ack_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local ack_grant; ack_grant="$(_extract_injected requester-binding)"
  [ -n "$ack_grant" ]
  run node "$CONSULTATION_CLI" transaction-ack --coordination-root "$coord_root" --request "$request_path" --disposition accepted --requester-binding "$ack_grant"
  [ "$status" -eq 0 ]

  # ---- 11: root-source-status READY, refs/digests reopened directly from
  # the durable ack.json/accepted-result.json -- post-GREEN, transaction-ack-
  # triggered retirement writes no artifact at all (consultation.cjs ~8048-
  # 8056: "no new retirement artifact is ever written" -- confirmed by direct
  # read, and fences are SubagentStop-only, M7 section 8.4/8.5, so there is
  # no replacement artifact to check for here either), so this status read is
  # now the SOLE confirmation step -- never a separate retirement-marker
  # existence check first.
  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local status_grant; status_grant="$(_extract_injected lifecycle-binding)"
  [ -n "$status_grant" ]
  run env NODE_ENV=test node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id" --lifecycle-binding "$status_grant"
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    const o = e.operation;
    // NO-GO Correction C (M6+M7 SIXTEENTH): request_ref -- always a pure,
    // deterministic function of a durable request_id -- must be populated
    // here alongside request_id/request_digest, never silently omitted.
    if (e.status !== "READY" || !o || o.state !== "READY" || o.request_id === null
      || o.request_ref === null || o.request_digest === null
      || o.ack_ref === null || o.ack_digest === null) {
      process.stderr.write("root-source-status: " + JSON.stringify(e)); process.exit(1);
    }
  ' "$output"

  # ---- 12: post-terminal, no further requester command may obtain a grant ----
  # Stale-value fix (same category as the "durable retirement" step above):
  # empirically re-derived, not guessed -- the real current rejection reason
  # is "[Sixteenth/root-source] unable to mint the exact phase-scoped
  # requester grant: root-source-transaction-terminal" (confirmed by direct
  # run), never anything containing "retir" -- the underlying transaction
  # being terminal (not a retirement marker) is what denies a further grant now.
  local post_cmd; post_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" cancel --coordination-root "$coord_root" --request "$request_path" --reason operator)"
  _make_input "$post_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  node -e '
    const body = JSON.parse(process.argv[1]);
    const h = body && body.hookSpecificOutput;
    if (!h || h.permissionDecision !== "deny" || !/root-source/i.test(h.permissionDecisionReason || "") || !/root-source-transaction-terminal/.test(h.permissionDecisionReason || "")) process.exit(1);
  ' "$output"

  _s16e2e_stop_retained_plane
}

# M67-ROOT-CONTEXT7-E2E-01 (M6/M7 terminal functional closure, 2026-08-21):
# the loopback/fake Context7 HTTPS server is the ONLY substitution, at the
# real network boundary -- everything else (root-source CLI, real
# Agent/SubagentStart, real WAL publish, real dispatch/retained-worker
# turn/start<->turn/completed protocol, real accept/ack) is the SAME real
# machinery S16-ROOT-SOURCE-E2E already proves. The root-source question
# carries a single APPROVED_CONTEXT7_LIBRARY_ID directive; the retained
# arch-platform must therefore consult exactly one context-provider child
# before it may terminate, and that child must reach the fake server with
# ZERO /api/v2/libs/search calls (the id is already approved) and EXACTLY
# ONE /api/v2/context call.
@test "M67-ROOT-CONTEXT7-E2E-01: root-source root with an approved directive -> exactly one context-provider child -> zero search, one real context call -> child and root each durably result/accepted/ack" {
  local context_body; context_body="$(node -e 'process.stdout.write(Buffer.from("Context7 fixture content for M67-ROOT-CONTEXT7-E2E-01: HttpTimeout does not govern an upgraded WebSocket session.", "utf8").toString("base64"))')"
  S16E2E_FAKE_CONTEXT7_RESPONSES="$(node -e '
    process.stdout.write(JSON.stringify([
      { statusCode: 200, headers: { "content-type": "text/plain; charset=utf-8" }, bodyBase64: process.argv[1] },
    ]));
  ' "$context_body")"
  # Drives the shared fake-codex stub: arch-platform's schema will only ever
  # offer consult-intent (point D's turnKindLock), so it consults exactly
  # once; context-provider's schema will only ever offer pattern-gap on its
  # own first turn, with gapSpec's library_id already the approved one (point
  # D/E's schema-pinned zero-search guarantee).
  S16E2E_FAKE_MODE="consult-context-provider-once"
  S16E2E_FAKE_GAP_SPEC='{"provider":"context7","library_name":"Ktor Documentation","library_id":"/ktorio/ktor-documentation","query":"Does HttpTimeout requestTimeoutMillis govern an upgraded WebSocket session?"}'
  local question; question="$(printf 'APPROVED_CONTEXT7_LIBRARY_ID: /ktorio/ktor-documentation\nDetermine whether Ktor HttpTimeout requestTimeoutMillis governs an upgraded WebSocket session, and return the architecture recommendation with official source evidence; do not modify repository files.')"
  # Fixture fix (not a production change): this question's embedded newline means
  # the real wire schema omits the enum for it, so the fake app-server's default
  # fallback ('fake-codex-consult-question') would diverge from the byte-identical
  # value production requires -- pass the exact bytes through explicitly instead.
  S16E2E_FAKE_REQUIRED_QUESTION="$question"
  _s16e2e_setup_through_ingress "m67-rce2e-session" "m67-rce2e-agent" "arch-platform" "$question" "ARCHITECTURE_RECOMMENDATION"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local action_id="$S16E2E_ACTION_ID"
  local request_path="$S16E2E_REQUEST_PATH" coord_root="$S16E2E_COORD_ROOT"

  local dispatch_cmd; dispatch_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path")"
  _make_input "$dispatch_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local dispatch_grant; dispatch_grant="$(_extract_injected requester-binding)"
  [ -n "$dispatch_grant" ]
  run node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path" --requester-binding "$dispatch_grant"
  [ "$status" -eq 0 ]
  local activation_path; activation_path="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  node -e '
    const fs = require("fs");
    const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (a.selected_driver !== "codex-app-server") { process.stderr.write("wrong driver: " + a.selected_driver); process.exit(1); }
  ' "$activation_path"

  local await_cmd; await_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" await-result --coordination-root "$coord_root" --request "$request_path" --timeout 30)"
  _make_input "$await_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local await_grant; await_grant="$(_extract_injected requester-binding)"
  [ -n "$await_grant" ]
  run node "$CONSULTATION_CLI" await-result --coordination-root "$coord_root" --request "$request_path" --timeout 30 --requester-binding "$await_grant"
  if [ "$status" -ne 0 ] && [ -f "$S16E2E_BG_OUT" ]; then sed 's/^/# bridge: /' "$S16E2E_BG_OUT" >&2; fi
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "SUCCESS" && e.status !== "READY") { process.stderr.write("await-result: " + JSON.stringify(e)); process.exit(1); }
  ' "$output"

  # ---- exactly one Context7 call, the context GET, zero search ----
  local call_count; call_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" | tr -d ' ')"
  [ "$call_count" -eq 1 ]
  node -e '
    const fs = require("fs");
    const req = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
    if (req.method !== "GET" || req.servername !== "context7.com") { process.stderr.write("unexpected request: " + JSON.stringify(req)); process.exit(1); }
    if (!req.url.startsWith("/api/v2/context?libraryId=%2Fktorio%2Fktor-documentation")) {
      process.stderr.write("expected exactly one context call for the pre-approved library id, zero search: " + JSON.stringify(req)); process.exit(1);
    }
  ' "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG"

  # ---- exactly one child, targeting context-provider, question preserved,
  # its own result/accepted/ack all durable, with a matching pattern-evidence
  # dependency ----
  local child_summary; child_summary="$(node -e '
    const fs = require("fs"), path = require("path");
    const requestPath = process.argv[1], approvedQuestion = process.argv[2];
    const parent = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const transactionsDir = path.dirname(path.dirname(requestPath));
    const children = fs.readdirSync(transactionsDir).filter((n) => /^[a-f0-9]{64}$/.test(n)).map((n) => {
      const p = path.join(transactionsDir, n, "request.json");
      return fs.existsSync(p) ? { dir: path.join(transactionsDir, n), request: JSON.parse(fs.readFileSync(p, "utf8")) } : null;
    }).filter((e) => e && e.request.parent_request_id === parent.request_id);
    if (children.length !== 1) { process.stderr.write("expected exactly one child, got " + children.length); process.exit(1); }
    const child = children[0];
    if (child.request.target_role !== "context-provider") { process.stderr.write("child target_role: " + child.request.target_role); process.exit(1); }
    if (child.request.question !== approvedQuestion) { process.stderr.write("child question diverged from the required question"); process.exit(1); }
    const resultFiles = fs.readdirSync(path.join(child.dir, "results"));
    if (resultFiles.length !== 1) { process.stderr.write("expected exactly one child result file"); process.exit(1); }
    const childResult = JSON.parse(fs.readFileSync(path.join(child.dir, "results", resultFiles[0]), "utf8"));
    const dep = childResult.pattern_evidence_dependency;
    if (!dep || dep.library_id !== "/ktorio/ktor-documentation") { process.stderr.write("child pattern_evidence_dependency: " + JSON.stringify(dep)); process.exit(1); }
    if (!fs.existsSync(path.join(child.dir, "accepted-result.json"))) { process.stderr.write("child accepted-result.json missing"); process.exit(1); }
    if (!fs.existsSync(path.join(child.dir, "ack.json"))) { process.stderr.write("child ack.json missing"); process.exit(1); }
    const ack = JSON.parse(fs.readFileSync(path.join(child.dir, "ack.json"), "utf8"));
    if (ack.disposition !== "accepted") { process.stderr.write("child ack disposition: " + ack.disposition); process.exit(1); }
    process.stdout.write(JSON.stringify({ requestId: child.request.request_id }));
  ' "$request_path" "$question")"
  local child_request_id; child_request_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).requestId)' "$child_summary")"

  # ---- the root'"'"'s own result carries exactly that one dependency ----
  node -e '
    const fs = require("fs"), path = require("path");
    const requestPath = process.argv[1], expectedChildId = process.argv[2];
    const parent = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const txnDir = path.dirname(requestPath);
    const resultFiles = fs.readdirSync(path.join(txnDir, "results"));
    if (resultFiles.length !== 1) { process.stderr.write("expected exactly one root result file"); process.exit(1); }
    const rootResult = JSON.parse(fs.readFileSync(path.join(txnDir, "results", resultFiles[0]), "utf8"));
    if (!Array.isArray(rootResult.consultation_dependencies) || rootResult.consultation_dependencies.length !== 1) {
      process.stderr.write("root consultation_dependencies: " + JSON.stringify(rootResult.consultation_dependencies)); process.exit(1);
    }
    const dep = rootResult.consultation_dependencies[0];
    if (dep.request_id !== expectedChildId || dep.from_role !== "context-provider") {
      process.stderr.write("root dependency does not point at the real context-provider child: " + JSON.stringify(dep)); process.exit(1);
    }
  ' "$request_path" "$child_request_id"

  # ---- real accept-result + transaction-ack for the root ----
  local accept_cmd; accept_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" accept-result --coordination-root "$coord_root" --request "$request_path")"
  _make_input "$accept_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local accept_grant; accept_grant="$(_extract_injected requester-binding)"
  [ -n "$accept_grant" ]
  run node "$CONSULTATION_CLI" accept-result --coordination-root "$coord_root" --request "$request_path" --requester-binding "$accept_grant"
  [ "$status" -eq 0 ]

  local ack_cmd; ack_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" transaction-ack --coordination-root "$coord_root" --request "$request_path" --disposition accepted)"
  _make_input "$ack_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local ack_grant; ack_grant="$(_extract_injected requester-binding)"
  [ -n "$ack_grant" ]
  run node "$CONSULTATION_CLI" transaction-ack --coordination-root "$coord_root" --request "$request_path" --disposition accepted --requester-binding "$ack_grant"
  [ "$status" -eq 0 ]

  # ---- root-source-status READY ----
  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local status_grant; status_grant="$(_extract_injected lifecycle-binding)"
  [ -n "$status_grant" ]
  run env NODE_ENV=test node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id" --lifecycle-binding "$status_grant"
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    const o = e.operation;
    if (e.status !== "READY" || !o || o.state !== "READY" || o.request_id === null
      || o.request_ref === null || o.request_digest === null || o.ack_ref === null || o.ack_digest === null
      || o.accepted_result_ref === null || o.accepted_result_digest === null) {
      process.stderr.write("root-source-status: " + JSON.stringify(e)); process.exit(1);
    }
  ' "$output"

  _s16e2e_stop_retained_plane
}

# S16-ROOT-SOURCE-CANONICAL-ROUTING-01 (M6-M7-ROOT-SOURCE-CONTINUATION-
# CLOSURE-20260820): the production Matrix 3 defect -- under the CANONICAL
# runtime-routing.json (claude-agent ordered before codex-app-server for
# arch-platform; NO R2-C private reorder, NO RUNTIME_CONSULTATION_TEST_
# ROUTING_POLICY_PATH seam) a root-source-authenticated dispatch must be
# constrained to codex-app-server (the retained architect the root-source
# action was minted against), even though a genuine live
# MainOrchestratorBinding makes claude-agent's own liveness proof pass too.
# The discriminating signal is the activation's own selected_driver, never a
# generic non-zero exit. An ORDINARY (non-root-source) requester dispatch in
# the SAME fixture is the control: canonical routing is untouched for it, so
# it still selects claude-agent.
@test "S16-ROOT-SOURCE-CANONICAL-ROUTING-01: canonical runtime-routing.json applies capability order to root-source and ordinary requester dispatches; retained Codex remains a fallback, not an authority-derived override" {
  # No routing_override_role argument: frozen canonical routing, no seam.
  _s16e2e_setup_through_ingress "s16e2e-canon-session" "s16e2e-canon-agent"
  [ -z "${RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH:-}" ]
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local request_path="$S16E2E_REQUEST_PATH" coord_root="$S16E2E_COORD_ROOT"

  # ---- fixture sanity (fields DISTINCT from the semantic assertion below):
  # the request is pinned to the CANONICAL repo routing policy, whose
  # arch-platform route orders claude-agent strictly before codex-app-server;
  # and BOTH candidates are genuinely live right now. ----
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    const rbc = require(process.argv[2]);
    const canonicalRoutingPath = process.argv[3];
    const requestPath = process.argv[4];
    const proj = process.argv[5];
    const req = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const canonicalBytes = fs.readFileSync(canonicalRoutingPath);
    const canonicalDigest = crypto.createHash("sha256").update(canonicalBytes).digest("hex");
    if (req.routing_policy_digest !== canonicalDigest) {
      process.stderr.write("fixture sanity: request is not pinned to the canonical routing policy: " + req.routing_policy_digest + " != " + canonicalDigest);
      process.exit(1);
    }
    const route = JSON.parse(canonicalBytes.toString("utf8")).routes["arch-platform"];
    if (!Array.isArray(route) || route.indexOf("claude-agent") === -1 || route.indexOf("codex-app-server") === -1
      || route.indexOf("claude-agent") > route.indexOf("codex-app-server")) {
      process.stderr.write("fixture sanity: canonical arch-platform route must order claude-agent before codex-app-server: " + JSON.stringify(route));
      process.exit(1);
    }
    if (req.target_role !== "arch-platform") { process.stderr.write("fixture sanity: target_role " + req.target_role); process.exit(1); }
    const mainLive = rll.hasLiveMainOrchestratorBindingForScope(proj, req.requester_worktree_id, req.plan_digest);
    if (mainLive !== true) { process.stderr.write("fixture sanity: no live MainOrchestratorBinding for the request scope -- claude-agent would not even be a live candidate"); process.exit(1); }
    const codexLive = rbc.resolveLiveCodexAppServerWorker(proj, "arch-platform");
    if (!codexLive || codexLive.ok !== true || codexLive.available !== true) { process.stderr.write("fixture sanity: retained codex-app-server arch-platform not live: " + JSON.stringify(codexLive)); process.exit(1); }
  ' "$RLL_IMPL" "$LIB_DIR/runtime-bridge-codex.cjs" "$LIB_DIR/runtime-routing.json" "$request_path" "$PROJ"

  # ---- root-source-authenticated dispatch: real hook-injected one-use
  # requester grant backed by this actor's own RootSourceBinding ----
  local dispatch_cmd; dispatch_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path")"
  _make_input "$dispatch_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local dispatch_grant; dispatch_grant="$(_extract_injected requester-binding)"
  [ -n "$dispatch_grant" ]
  run node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path" --requester-binding "$dispatch_grant"
  [ "$status" -eq 0 ]
  local activation_path; activation_path="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  local root_selected; root_selected="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).selected_driver)' "$activation_path")"
  echo "ROOT-SOURCE-DISPATCH selected_driver=$root_selected expected=claude-agent"
  node -e '
    const selected = process.argv[1];
    if (selected !== "claude-agent") {
      process.stderr.write("S16-ROOT-SOURCE-CANONICAL-ROUTING-01: root-source dispatch selected_driver=" + selected + " expected=claude-agent\n");
      process.exit(1);
    }
  ' "$root_selected"

  # ---- control: an ORDINARY requester (arch-testing RequesterBinding minted
  # by the S16_RETAINED_FIXTURE wrapper, never a root-source binding)
  # publishes its own request to the same arch-platform under the same
  # canonical policy and dispatches it -- canonical routing must be
  # untouched for it: claude-agent (first live candidate) is selected. ----
  local control_subject="$PROJ/.planning/coordination-subject-bundle-manifest.json"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
  ' "$control_subject"
  local control_plan; control_plan="$(node -e 'process.stdout.write(require(process.argv[1]).discoverPlan(process.argv[2]).planPath)' "$RLL_IMPL" "$PROJ")"
  [ -n "$control_plan" ]
  local control_intent; control_intent="$(node -e '
    process.stdout.write(Buffer.from(JSON.stringify({
      target_role: "arch-platform",
      question: "S16-ROOT-SOURCE-CANONICAL-ROUTING-01 ordinary requester control",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    }), "utf8").toString("base64url"));
  ')"
  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_SESSION="s16e2e-canon-control-session" \
    node "$S16_RETAINED_FIXTURE" publish-request --coordination-root "$coord_root" --plan "$control_plan" --subject-bundle "$control_subject" --intent "$control_intent"
  [ "$status" -eq 0 ]
  local control_request; control_request="$(node -e 'const e = JSON.parse(process.argv[1]); if (e.status !== "SUCCESS") process.exit(1); process.stdout.write(e.artifact_ref)' "$output")"
  [ -f "$control_request" ]
  node -e '
    const fs = require("fs");
    const req = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const root = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    if (req.routing_policy_digest !== root.routing_policy_digest) { process.stderr.write("control sanity: control request pinned to a different routing policy"); process.exit(1); }
    if (req.source_role === "toolkit-specialist") { process.stderr.write("control sanity: control must not be the root-source actor"); process.exit(1); }
  ' "$control_request" "$request_path"
  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_SESSION="s16e2e-canon-control-session" \
    node "$S16_RETAINED_FIXTURE" dispatch --coordination-root "$coord_root" --request "$control_request"
  [ "$status" -eq 0 ]
  local control_activation; control_activation="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  local control_selected; control_selected="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).selected_driver)' "$control_activation")"
  echo "ORDINARY-CONTROL-DISPATCH selected_driver=$control_selected expected=claude-agent"
  node -e '
    const selected = process.argv[1];
    if (selected !== "claude-agent") {
      process.stderr.write("S16-ROOT-SOURCE-CANONICAL-ROUTING-01: ordinary control dispatch selected_driver=" + selected + " expected=claude-agent\n");
      process.exit(1);
    }
  ' "$control_selected"

  _s16e2e_stop_retained_plane
}

@test "S16-ROOT-SOURCE-RACE-01: two real concurrent publish-request grants for the same binding produce exactly one durable request and one ingress" {
  _s16e2e_setup_through_binding "s16e2e-race-session" "s16e2e-race-agent"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local publish_cmd="" grant_a="" grant_b=""
  publish_cmd="$(node -e '
    const msg = process.argv[1];
    process.stdout.write(msg.split("\n")[3].slice("publish_command=".length));
  ' "$S16E2E_BOOTSTRAP_MESSAGE")"

  # Two REAL, independently-minted grants for the SAME binding, both minted
  # while ingress is still absent (mirrors this file's own DX-noconcurrent-01
  # precedent: two real OS processes, not a sequential simulation).
  _make_input "$publish_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  grant_a="$(_extract_injected requester-binding)"
  [ -n "$grant_a" ]
  _make_input "$publish_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  grant_b="$(_extract_injected requester-binding)"
  [ -n "$grant_b" ]
  [ "$grant_a" != "$grant_b" ]

  local publish_argv; publish_argv="$(node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(JSON.stringify(rll.parsePosixDirect(process.argv[2])));
  ' "$RLL_IMPL" "$publish_cmd")"
  local out_a; out_a="$(mktemp)"
  local out_b; out_b="$(mktemp)"
  node -e '
    const argv = JSON.parse(process.argv[1]).slice(1).concat(["--requester-binding", process.argv[2]]);
    require("child_process").execFileSync(process.execPath, argv, { encoding: "utf8", env: Object.assign({}, process.env, { NODE_ENV: "test" }) });
  ' "$publish_argv" "$grant_a" >"$out_a" 2>&1 &
  local pid_a=$!
  node -e '
    const argv = JSON.parse(process.argv[1]).slice(1).concat(["--requester-binding", process.argv[2]]);
    require("child_process").execFileSync(process.execPath, argv, { encoding: "utf8", env: Object.assign({}, process.env, { NODE_ENV: "test" }) });
  ' "$publish_argv" "$grant_b" >"$out_b" 2>&1 &
  local pid_b=$!
  local rc_a=0 rc_b=0
  wait "$pid_a" || rc_a=$?
  wait "$pid_b" || rc_b=$?
  # Both requester grants are real and single-use; whichever loses the lock
  # race for the SAME underlying WAL either recovers the winner's own
  # request (rc 0) or is rejected (never fabricates a second root) -- either
  # way, never two transactions or two ingresses.
  [ "$rc_a" -eq 0 ] || [ "$rc_b" -eq 0 ]

  local coord_root; coord_root="$(node -e '
    const rll = require(process.argv[1]);
    const tokens = rll.parsePosixDirect(process.argv[2]);
    process.stdout.write(tokens[tokens.indexOf("--coordination-root") + 1]);
  ' "$RLL_IMPL" "$publish_cmd")"
  local txn_count; txn_count="$(node -e '
    const fs = require("fs"); const path = require("path");
    function findTransactionsDirs(dir, depth) {
      if (depth > 6) return [];
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
      let found = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const p = path.join(dir, e.name);
        if (e.name === "transactions") found.push(p); else found = found.concat(findTransactionsDirs(p, depth + 1));
      }
      return found;
    }
    const dirs = findTransactionsDirs(process.argv[1], 0);
    let total = 0;
    for (const d of dirs) total += fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    process.stdout.write(String(total));
  ' "$coord_root")"
  [ "$txn_count" -eq 1 ]

  local ingress_count; ingress_count="$(find "$S16E2E_BINDINGS_DIR" -maxdepth 1 -name "$S16E2E_BINDING_ID.ingress.json" | wc -l | tr -d ' ')"
  [ "$ingress_count" -eq 1 ]

  _s16e2e_stop_retained_plane
}

@test "S16-ROOT-SOURCE-WAL-RECOVERY-01: crash between durable request.json and durable ingress recovers the SAME request on retry, never mints a second one" {
  _s16e2e_setup_through_binding "s16e2e-crash-session" "s16e2e-crash-agent"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local publish_cmd; publish_cmd="$(node -e '
    const msg = process.argv[1];
    process.stdout.write(msg.split("\n")[3].slice("publish_command=".length));
  ' "$S16E2E_BOOTSTRAP_MESSAGE")"

  # First real attempt: publishes request.json + ingress together (my own
  # WAL's single lock-protected call). Then simulate "crashed between the two
  # durable writes" by deleting ONLY the ingress this attempt itself just
  # published, leaving the durable request.json as the sole survivor -- the
  # exact post-request/pre-ingress disk state a real crash would leave.
  _make_input "$publish_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_1; grant_1="$(_extract_injected requester-binding)"
  local publish_argv; publish_argv="$(node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(JSON.stringify(rll.parsePosixDirect(process.argv[2])));
  ' "$RLL_IMPL" "$publish_cmd")"
  run node -e '
    const { spawnSync } = require("child_process");
    const argv = JSON.parse(process.argv[1]).slice(1).concat(["--requester-binding", process.argv[2]]);
    const r = spawnSync(process.execPath, argv, { encoding: "utf8", env: Object.assign({}, process.env, { NODE_ENV: "test" }) });
    process.stdout.write(r.stdout || ""); process.exit(r.status === 0 ? 0 : 1);
  ' "$publish_argv" "$grant_1"
  [ "$status" -eq 0 ]
  local request_id_1; request_id_1="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).request_id)' "$output")"
  local request_path_1; request_path_1="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  [ -n "$request_id_1" ]

  local ingress_path="$S16E2E_BINDINGS_DIR/$S16E2E_BINDING_ID.ingress.json"
  [ -f "$ingress_path" ]
  rm -f "$ingress_path"

  # Retry with a FRESH real grant (mirrors a genuinely new attempt after a
  # crash -- the original grant was already one-use-consumed). Must recover
  # request_id_1's own durable request, never mint request_id_2.
  _make_input "$publish_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_2; grant_2="$(_extract_injected requester-binding)"
  [ -n "$grant_2" ]
  [ "$grant_2" != "$grant_1" ]
  run node -e '
    const { spawnSync } = require("child_process");
    const argv = JSON.parse(process.argv[1]).slice(1).concat(["--requester-binding", process.argv[2]]);
    const r = spawnSync(process.execPath, argv, { encoding: "utf8", env: Object.assign({}, process.env, { NODE_ENV: "test" }) });
    process.stdout.write(r.stdout || ""); process.exit(r.status === 0 ? 0 : 1);
  ' "$publish_argv" "$grant_2"
  [ "$status" -eq 0 ]
  local request_id_2; request_id_2="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).request_id)' "$output")"
  [ "$request_id_2" = "$request_id_1" ]
  [ -f "$ingress_path" ]
  node -e '
    const fs = require("fs");
    const ingress = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (ingress.request_id !== process.argv[2]) { process.stderr.write("recovered ingress names the wrong request: " + JSON.stringify(ingress)); process.exit(1); }
  ' "$ingress_path" "$request_id_1"
  local txn_count; txn_count="$(find "$(dirname "$(dirname "$request_path_1")")" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
  [ "$txn_count" -eq 1 ]

  _s16e2e_stop_retained_plane
}

@test "S16-ROOT-SOURCE-TARGET-LOST-01: dispatch after the retained arch-platform worker is gone fails closed, never selects noop or fabricates delivery" {
  _s16e2e_setup_through_ingress "s16e2e-lost-session" "s16e2e-lost-agent" "arch-platform"
  local coord_root="$S16E2E_COORD_ROOT" request_path="$S16E2E_REQUEST_PATH"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"

  # Target lost: SIGKILL the retained worker BEFORE dispatch -- never a
  # graceful SIGTERM. A graceful shutdown transitions the lifecycle owner
  # record itself away from RETAINED as part of its own clean release,
  # which reads identically, at the dispatch layer, to a role that was
  # never retained in the first place. SIGKILL leaves the owner record
  # genuinely ACTIVE/RETAINED with a now-dead PID -- the actual "genuinely
  # retained, now lost" shape PLAN §16d describes, and the one production's
  # own resolveLiveCodexAppServerWorkerUncached can positively distinguish
  # via `reason:"supervisor-process-not-live"` (checked below). Liveness
  # detection is not instantaneous with the kill, so poll the SAME
  # production liveness check dispatch itself consumes until it genuinely
  # reports unavailable, bounded, before ever attempting dispatch with a
  # real (single-use) grant.
  if [ -n "$S16E2E_BG_PID" ]; then
    kill -KILL "$S16E2E_BG_PID" 2>/dev/null || true
    wait "$S16E2E_BG_PID" 2>/dev/null || true
    S16E2E_BG_PID=""
  fi
  local live="unknown" tries=0
  while [ "$tries" -lt 100 ]; do
    live="$(node -e '
      const rbc = require(process.argv[1]);
      const rll = require(process.argv[3]);
      const r = rbc.resolveLiveCodexAppServerWorker(process.argv[2], "arch-platform", rll.roleProfileDigestFor("arch-platform"));
      process.stdout.write(JSON.stringify(r));
    ' "$LIB_DIR/runtime-bridge-codex.cjs" "$PROJ" "$RLL_IMPL")"
    [[ "$live" == *'"available":false'* ]] && break
    tries=$((tries + 1))
    sleep 0.1
  done
  [[ "$live" == *'"available":false'* ]]
  # M6+M7 SIXTEENTH Phase 2D: must specifically be the "genuinely retained,
  # now crashed" reason (resolveLiveCodexAppServerWorkerUncached reaches
  # `supervisor-process-not-live` only after independently confirming the
  # lifecycle owner was ACTIVE/RETAINED and exactly scope-matched) -- a
  # GRACEFUL SIGTERM shutdown instead transitions the owner record itself
  # away from RETAINED first (`supervisor-lifecycle-owner-not-active`),
  # which is legitimately indistinguishable, at the dispatch layer, from a
  # role that was never retained in the first place (still eligible for the
  # routing policy's ordinary noop fallback). This test's own SIGKILL below
  # (mirroring S16-HOSTBRIDGE-LIVENESS-NO-STALE-CACHE-01's proven mechanism)
  # is what actually produces the discriminating "lost", not merely "never
  # available", signal.
  [[ "$live" == *'"reason":"supervisor-process-not-live"'* ]]

  # M6+M7 SIXTEENTH Phase 2D (PLAN.md §16d): a target that was genuinely
  # retained for this exact request and has since been lost must make
  # dispatch fail CLOSED -- never fall back to noop or any other candidate,
  # since that would launder an already-possible commitment into a
  # fabricated non-delivery success. Snapshot the whole transaction
  # directory tree (paths + content digests) BEFORE the failing attempt so
  # "zero new activation/delivery/inbox/result/evidence" is proven by an
  # exact byte-identical comparison, not a hand-picked subset of paths.
  local txn_dir; txn_dir="$(dirname "$request_path")"
  local snapshot_before snapshot_after
  snapshot_before="$(_s16_snapshot_tree "$txn_dir")"

  # R2-C (M6-M7-R2C-TEST-SEAM-CLOSURE-20260820): the private-copy override
  # alone was proven insufficient for this exact root-source-initiated flow
  # (see _s16e2e_arm_test_routing_seam's own header comment for the full,
  # empirically-confirmed root cause). _s16e2e_setup_through_ingress above
  # already armed RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH for the REAL
  # canonical runtime-consultation.cjs this dispatch call actually executes,
  # so codex-app-server genuinely wins the routing race and was the live,
  # now-lost target this test's own SIGKILL above targeted.
  local dispatch_cmd; dispatch_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path")"
  _make_input "$dispatch_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local dispatch_grant; dispatch_grant="$(_extract_injected requester-binding)"
  [ -n "$dispatch_grant" ]
  _r2c_s16_integrity_predispatch "$request_path"
  run node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path" --requester-binding "$dispatch_grant"
  _r2c_s16_integrity_postdispatch "$request_path"
  [ "$status" -ne 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "UNAVAILABLE" || e.detail_code !== "DRIVER_UNAVAILABLE") { process.stderr.write("expected UNAVAILABLE/DRIVER_UNAVAILABLE once the retained target is lost, got: " + JSON.stringify(e)); process.exit(1); }
  ' "$output"

  snapshot_after="$(_s16_snapshot_tree "$txn_dir")"
  if [ "$snapshot_before" != "$snapshot_after" ]; then
    diff <(printf '%s' "$snapshot_before") <(printf '%s' "$snapshot_after") >&2 || true
    echo "post-target-loss dispatch mutated the transaction tree (expected byte-identical: zero new activation/delivery/inbox/result)" >&2
    return 1
  fi

  # await-result must also never observe a fabricated answer for a request
  # dispatch has never successfully activated -- a short bounded wait
  # genuinely times out (DEADLINE_EXCEEDED), never SUCCESS/READY.
  local await_cmd; await_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" await-result --coordination-root "$coord_root" --request "$request_path" --timeout 1)"
  _make_input "$await_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local await_grant; await_grant="$(_extract_injected requester-binding)"
  [ -n "$await_grant" ]
  run node "$CONSULTATION_CLI" await-result --coordination-root "$coord_root" --request "$request_path" --timeout 1 --requester-binding "$await_grant"
  [ "$status" -ne 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "TIMEOUT" || e.detail_code !== "DEADLINE_EXCEEDED") { process.stderr.write("expected TIMEOUT/DEADLINE_EXCEEDED, got " + JSON.stringify(e)); process.exit(1); }
  ' "$output"
  # No results/ file was ever fabricated for this request.
  local results_dir; results_dir="$(dirname "$request_path")/results"
  local result_count=0
  if [ -d "$results_dir" ]; then result_count="$(find "$results_dir" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"; fi
  [ "$result_count" -eq 0 ]
}

@test "S16-HOSTBRIDGE-LIVENESS-NO-STALE-CACHE-01: a target SIGKILLed immediately after being observed available is seen unavailable well inside the deleted cache's old 3s window, in the SAME process -- dispatch against it then fails closed with zero fabricated delivery" {
  _s16e2e_setup_through_ingress "s16e2e-nostale-session" "s16e2e-nostale-agent" "arch-platform"
  local coord_root="$S16E2E_COORD_ROOT" request_path="$S16E2E_REQUEST_PATH"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"

  # Discriminates the DELETED 3s TTL cache specifically (NO-GO Correction B,
  # M6+M7 SIXTEENTH): resolves TRUE, kills the target, then re-resolves for
  # FALSE -- all inside the SAME node process/module instance, since that
  # cache was keyed at module scope and is invisible across the separate
  # per-call `node -e` processes most OTHER tests in this file use for this
  # same check (each starts with an empty cache regardless of whether the
  # cache exists in production, so those are NOT discriminating for this
  # specific bug -- S16-ROOT-SOURCE-TARGET-LOST-01's own 10s-bounded,
  # fresh-process-per-poll liveness wait is exactly this non-discriminating
  # shape; it stays correct/useful for its own eventual-consistency claim,
  # this test targets the narrower "no 3s-scale staleness at all" property).
  # Bounded to 1.5s of polling -- comfortably inside the deleted cache's
  # 3000ms TTL, so a restored cache would still be serving the stale `true`
  # throughout this whole window and this assertion goes RED (§16d ledger).
  run node -e '
    const rbc = require(process.argv[1]);
    const rll = require(process.argv[2]);
    const proj = process.argv[3];
    const bgPid = Number(process.argv[4]);
    const digest = rll.roleProfileDigestFor("arch-platform");
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      const before = rbc.resolveLiveCodexAppServerWorker(proj, "arch-platform", digest);
      if (!before || before.ok !== true || before.available !== true) {
        process.stderr.write("precondition failed: target not available before kill: " + JSON.stringify(before));
        process.exit(1);
      }
      process.kill(bgPid, "SIGKILL");
      // Each iteration awaits a REAL setTimeout (a macrotask boundary, not
      // just a synchronous loop) so the operation-scoped memo above
      // genuinely gets a chance to clear between checks -- a bare
      // synchronous while-loop here would never yield the event loop at
      // all, making every resolve within it indistinguishable from ONE
      // long operation regardless of whether the production memo is
      // correctly operation-scoped or a disguised time-based cache; that is
      // not what "immediately re-resolve within 3s" means for any real
      // caller (pollRetainedWorkers itself only ever re-resolves on a LATER
      // tick, always past its own `await asyncSleep(0)` yield).
      const deadlineMs = Date.now() + 1500;
      let after = null;
      while (Date.now() < deadlineMs) {
        after = rbc.resolveLiveCodexAppServerWorker(proj, "arch-platform", digest);
        if (after && after.ok === true && after.available === false) {
          process.stdout.write("OK " + JSON.stringify(after));
          process.exit(0);
        }
        await sleep(20);
      }
      process.stderr.write("target still reported available 1.5s after SIGKILL (stale cache?): " + JSON.stringify(after));
      process.exit(1);
    })();
  ' "$LIB_DIR/runtime-bridge-codex.cjs" "$RLL_IMPL" "$PROJ" "$S16E2E_BG_PID"
  [ "$status" -eq 0 ]
  [[ "$output" == OK* ]]

  # M6+M7 SIXTEENTH Phase 2D (PLAN.md §16d): same fail-closed property
  # S16-ROOT-SOURCE-TARGET-LOST-01 proves, for this test's own
  # same-tick-staleness scenario -- dispatch against the now-genuinely-dead
  # (but genuinely once-retained) target must fail CLOSED, never fall back
  # to noop or fabricate delivery. Byte-identical transaction-tree snapshot
  # proves zero writes on the rejected attempt.
  local txn_dir; txn_dir="$(dirname "$request_path")"
  local snapshot_before snapshot_after
  snapshot_before="$(_s16_snapshot_tree "$txn_dir")"

  # R2-C (M6-M7-R2C-TEST-SEAM-CLOSURE-20260820): the private-copy override
  # alone was proven insufficient for this exact root-source-initiated flow
  # (see _s16e2e_arm_test_routing_seam's own header comment for the full,
  # empirically-confirmed root cause). _s16e2e_setup_through_ingress above
  # already armed RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH for the REAL
  # canonical runtime-consultation.cjs this dispatch call actually executes,
  # so codex-app-server genuinely wins the routing race and was the live,
  # now-lost target this test's own SIGKILL above targeted.
  local dispatch_cmd; dispatch_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path")"
  _make_input "$dispatch_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local dispatch_grant; dispatch_grant="$(_extract_injected requester-binding)"
  [ -n "$dispatch_grant" ]
  _r2c_s16_integrity_predispatch "$request_path"
  run node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path" --requester-binding "$dispatch_grant"
  _r2c_s16_integrity_postdispatch "$request_path"
  [ "$status" -ne 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "UNAVAILABLE" || e.detail_code !== "DRIVER_UNAVAILABLE") { process.stderr.write("expected UNAVAILABLE/DRIVER_UNAVAILABLE once the retained target is lost, got: " + JSON.stringify(e)); process.exit(1); }
  ' "$output"

  snapshot_after="$(_s16_snapshot_tree "$txn_dir")"
  if [ "$snapshot_before" != "$snapshot_after" ]; then
    diff <(printf '%s' "$snapshot_before") <(printf '%s' "$snapshot_after") >&2 || true
    echo "post-target-loss dispatch mutated the transaction tree (expected byte-identical: zero new activation/delivery/inbox/result)" >&2
    return 1
  fi
  local results_dir; results_dir="$(dirname "$request_path")/results"
  local result_count=0
  if [ -d "$results_dir" ]; then result_count="$(find "$results_dir" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"; fi
  [ "$result_count" -eq 0 ]

  # $S16E2E_BG_PID was SIGKILLed above by the node script (an unrelated
  # sibling process, not this shell), so it is a zombie until this shell
  # itself -- its real parent -- reaps it; `wait` (inside
  # _s16e2e_stop_retained_plane, already `|| true`-guarded) is what actually
  # reaps it. `kill -TERM` on an already-dead PID exits non-zero itself
  # (2>/dev/null only silences its message, not its status) -- `|| true`
  # here, unlike this file's ~20 other bare call sites, is specifically
  # because THIS test always reaches this line with an already-dead PID.
  _s16e2e_stop_retained_plane || true
}

@test "S16-HOSTBRIDGE-LIVENESS-NO-SAME-TICK-STALE-01: a target killed via a synchronous spawnSync between two immediate resolves (no await, same synchronous burst) is seen unavailable on the second resolve -- a queueMicrotask-scoped memo would still be serving the stale first result" {
  _s16e2e_setup_through_ingress "s16e2e-notick-session" "s16e2e-notick-agent"
  local coord_root="$S16E2E_COORD_ROOT" request_path="$S16E2E_REQUEST_PATH"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"

  # Discriminates the queueMicrotask-scoped memo specifically (M6+M7
  # SIXTEENTH CIERRE DEFINITIVO Phase 1): resolve (available:true), then --
  # with NO await, NO setTimeout, NO Promise boundary of any kind -- run a
  # BLOCKING spawnSync that kills the target, then resolve again in the SAME
  # synchronous script execution. spawnSync never yields to the event loop
  # (unlike spawn/exec), so queueMicrotask's callback cannot have run between
  # the two resolves; a memo cleared only via queueMicrotask would still hold
  # the first (stale) result for this second call. The whole script is
  # deliberately NOT wrapped in an async function -- no `await` anywhere in
  # it at all -- so there is no way for this test to accidentally cross a
  # microtask boundary itself.
  run node -e '
    const rbc = require(process.argv[1]);
    const rll = require(process.argv[2]);
    const proj = process.argv[3];
    const bgPid = Number(process.argv[4]);
    const digest = rll.roleProfileDigestFor("arch-platform");

    const before = rbc.resolveLiveCodexAppServerWorker(proj, "arch-platform", digest);
    if (!before || before.ok !== true || before.available !== true) {
      process.stderr.write("precondition failed: target not available before kill: " + JSON.stringify(before));
      process.exit(1);
    }

    const killResult = require("child_process").spawnSync("/bin/kill", ["-KILL", String(bgPid)]);
    if (killResult.error || killResult.status !== 0) {
      process.stderr.write("precondition failed: spawnSync kill did not succeed: " + JSON.stringify(killResult.error || killResult.status));
      process.exit(1);
    }
    // spawnSync only blocks until the kill COMMAND itself exits (signal
    // sent); SIGKILL delivery/reaping at the kernel is asynchronous, so a
    // brief real window can exist where `ps` still observes the dying
    // process as PRESENT with its original birth token. Spin (still
    // synchronously -- process.kill(pid,0) is a direct syscall, no
    // subprocess, no event-loop yield) until the OS itself confirms ESRCH,
    // so the discriminating claim is about the memo, never a leftover
    // kernel-reaping race this test would otherwise inherit.
    let reaped = false;
    for (let i = 0; i < 20000 && !reaped; i += 1) {
      try { process.kill(bgPid, 0); } catch (err) { if (err && err.code === "ESRCH") reaped = true; }
    }
    if (!reaped) {
      process.stderr.write("precondition failed: target pid " + bgPid + " was not reaped as dead within the spin bound");
      process.exit(1);
    }

    const after = rbc.resolveLiveCodexAppServerWorker(proj, "arch-platform", digest);
    if (after && after.ok === true && after.available === true) {
      process.stderr.write("STALE: second resolve in the same synchronous burst still reported available:true after a synchronous kill: " + JSON.stringify(after));
      process.exit(1);
    }
    process.stdout.write("OK " + JSON.stringify(after));
    process.exit(0);
  ' "$LIB_DIR/runtime-bridge-codex.cjs" "$RLL_IMPL" "$PROJ" "$S16E2E_BG_PID"
  [ "$status" -eq 0 ]
  [[ "$output" == OK* ]]

  # $S16E2E_BG_PID was SIGKILLed above by the node script's spawnSync child
  # (an unrelated sibling process, not this shell), so it is a zombie until
  # this shell itself -- its real parent -- reaps it via `wait` inside
  # _s16e2e_stop_retained_plane.
  _s16e2e_stop_retained_plane || true
}

@test "S16-ROOT-SOURCE-ACTION-EXPIRY-01: the root-source action's own <=120s expiry does not shorten an already-activated binding's independent lifetime" {
  _s16e2e_setup_through_binding "s16e2e-expiry-session" "s16e2e-expiry-agent"
  local binding_path="$S16E2E_BINDINGS_DIR/$S16E2E_BINDING_ID.json"
  [ -f "$binding_path" ]

  # Force the immutable action record's OWN expires_at into the past --
  # the binding was already durably created by the real SubagentStart above
  # and PLAN.md §16b requires its lifetime be independently
  # min(request_expiry, MainOrchestratorBinding.expiry, SessionGeneration.expires_at),
  # "never shortened merely because the spawn action expires after successful
  # activation."
  node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const binding = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    const actionPath = rll.actionPathFor(process.argv[2], binding.action_id);
    const action = JSON.parse(fs.readFileSync(actionPath, "utf8"));
    action.expires_at = "2020-01-01T00:00:00Z";
    fs.writeFileSync(actionPath, JSON.stringify(action));
  ' "$RLL_IMPL" "$PROJ" "$binding_path"

  run node -e '
    const rll = require(process.argv[1]);
    const binding = JSON.parse(require("fs").readFileSync(process.argv[3], "utf8"));
    const checked = rll.validateRootSourceBindingFor({ repoId: rll.computeRepoId(process.argv[2]) }, binding.binding_id, "toolkit-specialist", binding.worktree_id, binding.plan_digest);
    process.stdout.write(JSON.stringify(checked));
    process.exit(checked.ok ? 0 : 1);
  ' "$RLL_IMPL" "$PROJ" "$binding_path"
  [ "$status" -eq 0 ]

  _s16e2e_stop_retained_plane
}

@test "S16-ROOT-SOURCE-STATUS-WAITING-REQUEST-REF-01: root-source-status reports a non-null request_ref (alongside request_id/request_digest) once ingress is durable but before any retirement -- NO-GO Correction C" {
  _s16e2e_setup_through_ingress "s16e2e-waitingref-session" "s16e2e-waitingref-agent"
  local action_id="$S16E2E_ACTION_ID"

  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id")"
  # Empty agent_type, not "toolkit-specialist": the M7/WP4 lifecycle-grant-
  # injection path (tryInjectLifecycleGrant, which owns root-source-status)
  # is gated behind `agentType === ''` ("main orchestrator") in context-
  # provider-gate.js -- a non-empty agent_type falls through to the
  # unrelated CP-consult gate instead and silently allows with zero
  # hookSpecificOutput, so no grant is ever injected. Mirrors S16-ROOT-
  # SOURCE-E2E's own root-source-status call exactly (_make_input "$status_cmd" "" "$session_id").
  _make_input "$status_cmd" "" "$S16E2E_SESSION_ID"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local status_grant; status_grant="$(_extract_injected lifecycle-binding)"
  [ -n "$status_grant" ]
  run env NODE_ENV=test node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id" --lifecycle-binding "$status_grant"
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    const o = e.operation;
    const expectedRef = "transactions/" + process.argv[2] + "/request.json";
    if (e.status !== "WAITING" || !o || o.state !== "WAITING" || o.request_id !== process.argv[2]
      || o.request_ref !== expectedRef || o.request_digest === null) {
      process.stderr.write("root-source-status WAITING: " + JSON.stringify(e)); process.exit(1);
    }
  ' "$output" "$S16E2E_REQUEST_ID"

  _s16e2e_stop_retained_plane
}

@test "S16-ROOT-SOURCE-TAMPER-01: a tampered terminal ack digest after retirement is rejected -- root-source-status fails closed, never a false READY" {
  _s16e2e_setup_through_ingress "s16e2e-tamper-session" "s16e2e-tamper-agent" "arch-platform"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local coord_root="$S16E2E_COORD_ROOT" request_path="$S16E2E_REQUEST_PATH"
  local action_id="$S16E2E_ACTION_ID" binding_id="$S16E2E_BINDING_ID" bindings_dir="$S16E2E_BINDINGS_DIR"

  # R2-C (M6-M7-R2C-TEST-SEAM-CLOSURE-20260820): the private-copy override
  # alone was proven insufficient for this exact root-source-initiated flow
  # (see _s16e2e_arm_test_routing_seam's own header comment for the full,
  # empirically-confirmed root cause). _s16e2e_setup_through_ingress above
  # already armed RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH for the REAL
  # canonical runtime-consultation.cjs this dispatch call actually executes,
  # so codex-app-server genuinely wins the routing race and the rest of this
  # test's own bridge-path result/accept/ack/status chain now reaches READY.
  local dispatch_cmd; dispatch_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path")"
  _make_input "$dispatch_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  local dispatch_grant; dispatch_grant="$(_extract_injected requester-binding)"
  _r2c_s16_integrity_predispatch "$request_path"
  run node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path" --requester-binding "$dispatch_grant"
  _r2c_s16_integrity_postdispatch "$request_path"
  [ "$status" -eq 0 ]

  local await_cmd; await_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" await-result --coordination-root "$coord_root" --request "$request_path" --timeout 15)"
  _make_input "$await_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  local await_grant; await_grant="$(_extract_injected requester-binding)"
  run node "$CONSULTATION_CLI" await-result --coordination-root "$coord_root" --request "$request_path" --timeout 15 --requester-binding "$await_grant"
  [ "$status" -eq 0 ]

  local accept_cmd; accept_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" accept-result --coordination-root "$coord_root" --request "$request_path")"
  _make_input "$accept_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  local accept_grant; accept_grant="$(_extract_injected requester-binding)"
  run node "$CONSULTATION_CLI" accept-result --coordination-root "$coord_root" --request "$request_path" --requester-binding "$accept_grant"
  [ "$status" -eq 0 ]

  local ack_cmd; ack_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" transaction-ack --coordination-root "$coord_root" --request "$request_path" --disposition accepted)"
  _make_input "$ack_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  local ack_grant; ack_grant="$(_extract_injected requester-binding)"
  run node "$CONSULTATION_CLI" transaction-ack --coordination-root "$coord_root" --request "$request_path" --disposition accepted --requester-binding "$ack_grant"
  [ "$status" -eq 0 ]

  # Positive control first: status genuinely reports READY before any tamper.
  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  local status_grant_1; status_grant_1="$(_extract_injected lifecycle-binding)"
  run env NODE_ENV=test node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id" --lifecycle-binding "$status_grant_1"
  [ "$status" -eq 0 ]
  node -e 'if (JSON.parse(process.argv[1]).status !== "READY") process.exit(1);' "$output"

  # Tamper the real terminal ack.json's bytes in place -- its digest no
  # longer matches what root-source-status itself will re-derive on the
  # next call. Post-GREEN: no retirement marker exists to read terminal_ref
  # off of -- ack_ref (identical path shape/semantics, relative to plan_root,
  # confirmed by direct read of readRootSourceTerminalArtifacts) now comes
  # straight off root-source-status's own READY response instead (already
  # captured in $output from the positive-control call immediately above).
  local ack_ref; ack_ref="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation.ack_ref)' "$output")"
  local plan_root; plan_root="$(dirname "$(dirname "$(dirname "$request_path")")")"
  local ack_abs_path="$plan_root/$ack_ref"
  [ -f "$ack_abs_path" ]
  node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    obj.disposition = "accepted-TAMPERED";
    fs.writeFileSync(process.argv[1], JSON.stringify(obj));
  ' "$ack_abs_path"

  local status_cmd2; status_cmd2="$(_render_posix_direct node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id")"
  _make_input "$status_cmd2" "" "$session_id"
  _run_cp_hook
  local status_grant_2; status_grant_2="$(_extract_injected lifecycle-binding)"
  run env NODE_ENV=test node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id" --lifecycle-binding "$status_grant_2"
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status === "READY") { process.stderr.write("tampered ack still reported READY: " + JSON.stringify(e)); process.exit(1); }
    if (e.status !== "BLOCKED" || e.detail_code !== "DURABILITY_UNPROVEN") { process.stderr.write("expected BLOCKED/DURABILITY_UNPROVEN, got " + JSON.stringify(e)); process.exit(1); }
  ' "$output"

  _s16e2e_stop_retained_plane
}

# ══════════════════════════════════════════════════════════════════════════
# ROOT-INGRESS-E2E (PLAN.md §16a). Begins at the real main hook -> consult-
# root CLI, never a preplanted intent. The retained SOURCE worker (arch-
# testing) consumes the WAL and the retained TARGET (context-provider) serves
# it entirely through the SAME production poll loop (pollRetainedWorkers ->
# hostBridgeListRootConsultIntents/hostBridgeAdvanceRootConsult/
# hostBridgeObserveAndCompleteRootConsult) the already-running five-role
# plane already exercises -- no Agent gate/SubagentStart is part of this flow
# (§16a's source is an existing retained architect, never a freshly-spawned
# one-shot actor). Target is NOT a free choice: hostBridgeAllowedChildRoles
# restricts EVERY architect role (arch-platform/arch-testing/arch-integration)
# to ['context-provider'] as its only legal consult-root target -- confirmed
# empirically when arch-platform was tried instead and buildCanonicalRequest
# correctly rejected it AUTHORITY_INVALID ("routing/topology/profile is not
# current"). Serving a context-provider request always calls
# runContextProviderInternalSearch (runtime-bridge-codex.cjs, unconditional on
# role, independent of this intent's own evidence_policy), which needs a real
# '@modelcontextprotocol/sdk' resolvable from $PROJ/mcp-server/package.json
# and a real $PROJ/mcp-server/build/index.js to spawn -- _s16e2e_bootstrap_
# project symlinks both from the real checkout (never copies -- node_modules
# is 100MB+) so this runs the SAME production internal-search code CP-
# EVIDENCE-E2E exercises, just with zero matching docs in the fixture (a
# legitimate real "no pattern gap" outcome, not a stub).
# ══════════════════════════════════════════════════════════════════════════

_s16e2e_poll_consult_root_status() {
  local session_id="$1" intent_id="$2" wanted="$3" tries=0
  local observed=""
  # 900 tries * 0.1s = 90s. Not 150 (15s): context-provider's real internal-
  # search round trip alone measured ~32s under the five-role plane's own
  # poll contention (see CONTEXT_PROVIDER_MCP_TIMEOUT_MS's comment in
  # runtime-bridge-codex.cjs) -- this status poll must comfortably outlast
  # the full request/dispatch/serve/accept/ack chain it is waiting on, not
  # just the one sub-step.
  while [ "$tries" -lt 900 ]; do
    local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id")"
    _make_input "$status_cmd" "" "$session_id"
    _run_cp_hook
    if [ "$status" -eq 0 ]; then
      local grant; grant="$(_extract_injected lifecycle-binding)"
      if [ -n "$grant" ]; then
        run env NODE_ENV=test node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id" --lifecycle-binding "$grant"
        observed="$output"
        [[ "$observed" == *'"status":"'"$wanted"'"'* ]] && { printf '%s' "$observed"; return 0; }
      fi
    fi
    tries=$((tries + 1))
    sleep 0.1
  done
  printf '# last consult-root-status: %s\n' "$observed" >&2
  return 1
}

# Shared by the two ROOT-INGRESS-E2E discriminating negative controls below:
# publishes a real consult-root intent through the actual main hook/CLI (never
# a preplanted intent) against an ALREADY-running retained plane. Sets
# S16E2E_CR_INTENT_ID; caller polls/interrupts from there.
_s16e2e_consult_root_publish() {
  local session_id="$1"
  local evidence_policy="${3:-none}"
  local intent; intent="$(node -e '
    const rc = require(process.argv[1]);
    process.stdout.write(Buffer.from(rc.canonicalJSONStringify({
      requester_role: "arch-testing", target_role: "context-provider",
      question: process.argv[2],
      expected_result_kind: "IMPLEMENTATION_REVIEW", evidence_policy: process.argv[3],
    }), "utf8").toString("base64url"));
  ' "$CONSULTATION_CLI" "S16 $2: describe the WAL ingress invariant." "$evidence_policy")"
  local cr_cmd; cr_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root --project-root "$PROJ" --intent "$intent")"
  _make_input "$cr_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local lifecycle_grant; lifecycle_grant="$(_extract_injected lifecycle-binding)"
  [ -n "$lifecycle_grant" ]
  run env NODE_ENV=test node "$RLL_IMPL" consult-root --project-root "$PROJ" --intent "$intent" --lifecycle-binding "$lifecycle_grant"
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "WAITING" || !e.operation || e.operation.kind !== "root-consult" || e.operation.operation_id === null) process.exit(1);
  ' "$output"
  S16E2E_CR_INTENT_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation.operation_id)' "$output")"
  [ -n "$S16E2E_CR_INTENT_ID" ]
}

# Polls consult-root-status until the operation's own request_ref goes
# non-null (the retained source has durably advanced the WAL past the
# reservation+request.json+published-marker triple), independent of overall
# status (which reads WAITING both before and after that point). Prints the
# last observed envelope on timeout.
_s16e2e_poll_consult_root_request_published() {
  local session_id="$1" intent_id="$2" tries=0
  local observed=""
  while [ "$tries" -lt 300 ]; do
    local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id")"
    _make_input "$status_cmd" "" "$session_id"
    _run_cp_hook
    if [ "$status" -eq 0 ]; then
      local grant; grant="$(_extract_injected lifecycle-binding)"
      if [ -n "$grant" ]; then
        run env NODE_ENV=test node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id" --lifecycle-binding "$grant"
        observed="$output"
        [[ "$observed" == *'"request_ref":"transactions'* ]] && { printf '%s' "$observed"; return 0; }
      fi
    fi
    tries=$((tries + 1))
    sleep 0.1
  done
  printf '# last consult-root-status: %s\n' "$observed" >&2
  return 1
}

@test "ROOT-INGRESS-E2E: real main hook -> consult-root CLI -> retained source WAL -> retained target serves -> source accept+ack -> completion only after both -> consult-root-status READY reopens refs/digests" {
  local session_id="s16e2e-ci-session"
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "$session_id"

  local intent; intent="$(node -e '
    const rc = require(process.argv[1]);
    process.stdout.write(Buffer.from(rc.canonicalJSONStringify({
      requester_role: "arch-testing", target_role: "context-provider",
      question: "S16 ROOT-INGRESS-E2E: describe the WAL ingress invariant.",
      expected_result_kind: "IMPLEMENTATION_REVIEW", evidence_policy: "none",
    }), "utf8").toString("base64url"));
  ' "$CONSULTATION_CLI")"
  local cr_cmd; cr_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root --project-root "$PROJ" --intent "$intent")"
  _make_input "$cr_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local lifecycle_grant; lifecycle_grant="$(_extract_injected lifecycle-binding)"
  [ -n "$lifecycle_grant" ]

  run env NODE_ENV=test node "$RLL_IMPL" consult-root --project-root "$PROJ" --intent "$intent" --lifecycle-binding "$lifecycle_grant"
  [ "$status" -eq 0 ]
  local cr_envelope="$output"
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "WAITING" || !e.operation || e.operation.kind !== "root-consult" || e.operation.operation_id === null) process.exit(1);
  ' "$cr_envelope"
  local intent_id; intent_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation.operation_id)' "$cr_envelope")"
  [ -n "$intent_id" ]

  # main never appears as requester/source/acceptor: the intent's own
  # requester identity is the RETAINED arch-testing worker's actor, never
  # main's own binding/actor.
  local intent_path; intent_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL_IMPL" "$PROJ")/root-consult-intents/$intent_id.json"
  [ -f "$intent_path" ]
  node -e '
    const fs = require("fs");
    const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (rec.requester_role !== "arch-testing" || rec.requester_actor_instance_id === rec.main_actor_instance_id) process.exit(1);
  ' "$intent_path"

  # Retained source consumes the WAL and dispatches, retained target serves
  # it via the SAME production poll loop -- entirely automatic once the
  # plane is up; no Agent gate/SubagentStart is part of this flow at all.
  if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
    echo "DEBUG bridge log tail:" >&2
    tail -80 "$S16E2E_BG_OUT" >&2
    echo "DEBUG timing log:" >&2
    [ -f "$S16E2E_TIMING_LOG" ] && cat "$S16E2E_TIMING_LOG" >&2
    false
  fi

  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local final_grant; final_grant="$(_extract_injected lifecycle-binding)"
  run env NODE_ENV=test node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id" --lifecycle-binding "$final_grant"
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    const o = e.operation;
    if (e.status !== "READY" || !o || o.state !== "READY"
      || o.request_id === null || o.request_ref === null || o.request_digest === null
      || o.result_ref === null || o.result_digest === null
      || o.accepted_result_ref === null || o.accepted_result_digest === null
      || o.ack_ref === null || o.ack_digest === null) {
      process.stderr.write("consult-root-status: " + JSON.stringify(e)); process.exit(1);
    }
  ' "$output"

  # completion is published only after BOTH accept and ack are durable --
  # the completion record's own refs correlate to REAL, currently-readable files.
  local completion_path; completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
  [ -f "$completion_path" ]
  node -e '
    const fs = require("fs");
    const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (c.accepted_result_ref === null || c.accepted_result_digest === null || c.ack_ref === null || c.ack_digest === null) process.exit(1);
  ' "$completion_path"

  _s16e2e_stop_retained_plane
}

@test "S16-ROOT-INGRESS-WAL-RECOVERY-01: crash between durable request.json and durable published-marker recovers the SAME preallocated request_id, never mints a second transaction" {
  local session_id="s16e2e-ri-crash-session"
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "$session_id"
  _s16e2e_consult_root_publish "$session_id" "ROOT-INGRESS-WAL-RECOVERY-01"
  local intent_id="$S16E2E_CR_INTENT_ID"

  if ! _s16e2e_poll_consult_root_request_published "$session_id" "$intent_id" >/dev/null; then
    echo "DEBUG timing log:" >&2
    [ -f "$S16E2E_TIMING_LOG" ] && cat "$S16E2E_TIMING_LOG" >&2
    false
  fi

  local published_path; published_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultPublishedPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
  [ -f "$published_path" ]
  local request_id_1; request_id_1="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).request_id)' "$published_path")"
  [ -n "$request_id_1" ]
  local request_ref_1; request_ref_1="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).request_ref)' "$published_path")"

  # Simulate "crashed after the durable request.json landed but before the
  # durable published-marker did" -- the exact post-request/pre-marker disk
  # state a real crash between hostBridgeAdvanceRootConsult's two no-clobber
  # writes would leave (reservation + request.json survive; only the LAST
  # write in that lock body is deleted here, mirroring S16-ROOT-SOURCE-WAL-
  # RECOVERY-01's own precedent of deleting the last-written artifact).
  rm -f "$published_path"
  [ ! -f "$published_path" ]

  # The SAME running retained plane's own poll loop must recover -- not a
  # fresh actor, not a fresh grant: this is the source's OWN idempotent WAL
  # replay, automatic on its very next tick.
  if ! _s16e2e_poll_consult_root_request_published "$session_id" "$intent_id" >/dev/null; then
    echo "DEBUG timing log:" >&2
    [ -f "$S16E2E_TIMING_LOG" ] && cat "$S16E2E_TIMING_LOG" >&2
    false
  fi
  [ -f "$published_path" ]
  local request_id_2; request_id_2="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).request_id)' "$published_path")"
  local request_ref_2; request_ref_2="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).request_ref)' "$published_path")"
  [ "$request_id_2" = "$request_id_1" ]
  [ "$request_ref_2" = "$request_ref_1" ]

  # Exactly one transaction directory exists under the SAME plan root
  # production code itself resolves to (planRootPath's own coordRoot/repoId/
  # waveSlug/planDigest join) -- recovery must never have minted a second.
  local txn_count; txn_count="$(node -e '
    const fs = require("fs"); const path = require("path");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const intentId = process.argv[3];
    const intentPath = path.join(rll.registryRepoDir(projectRoot), "root-consult-intents", intentId + ".json");
    const intent = JSON.parse(fs.readFileSync(intentPath, "utf8"));
    const coordRoot = rll.coordinationRootPathFor(projectRoot);
    const waveSlug = path.basename(path.dirname(rll.discoverPlan(projectRoot).planPath)).replace(/^wave-/, "");
    const planRoot = path.join(coordRoot, intent.repo_id, waveSlug, intent.plan_digest);
    const txnRoot = path.join(planRoot, "transactions");
    const count = fs.readdirSync(txnRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    process.stdout.write(String(count));
  ' "$RLL_IMPL" "$PROJ" "$intent_id")"
  [ "$txn_count" -eq 1 ]

  _s16e2e_stop_retained_plane
}

@test "S16-ROOT-INGRESS-TARGET-LOST-01: loss of the retained source+target after WAL publish returns BLOCKED, never a fabricated completion" {
  local session_id="s16e2e-ri-lost-session"
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "$session_id"
  _s16e2e_consult_root_publish "$session_id" "ROOT-INGRESS-TARGET-LOST-01"
  local intent_id="$S16E2E_CR_INTENT_ID"

  # Cut BEFORE the target ever serves it: the durable request exists (source
  # has advanced the WAL at least once) but nothing has been dispatched to a
  # model turn yet, so there is no legitimate in-flight work to race against
  # -- this isolates "the retained pair is simply gone" from WAL-RECOVERY-01's
  # own "the pair is alive but an artifact was lost" scenario.
  if ! _s16e2e_poll_consult_root_request_published "$session_id" "$intent_id" >/dev/null; then
    echo "DEBUG timing log:" >&2
    [ -f "$S16E2E_TIMING_LOG" ] && cat "$S16E2E_TIMING_LOG" >&2
    false
  fi

  _s16e2e_stop_retained_plane

  # consult-root-status is a read-only query -- it must derive BLOCKED from
  # s16ResolveRetainedPair's own liveness check finding no live source/target
  # (rootConsultIntentContext's 'source-actor-retired' path is the SAME
  # mechanism the retained bridge's own poll loop would hit), never stay
  # stuck reporting WAITING forever and never fabricate READY/a completion
  # record that was never durably produced.
  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant; grant="$(_extract_injected lifecycle-binding)"
  [ -n "$grant" ]
  run env NODE_ENV=test node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id" --lifecycle-binding "$grant"
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "BLOCKED" || !e.operation || e.operation.state !== "BLOCKED") {
      process.stderr.write("expected BLOCKED once the retained pair is gone, got " + JSON.stringify(e)); process.exit(1);
    }
  ' "$output"

  local completion_path; completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
  [ ! -f "$completion_path" ]
}

# ══════════════════════════════════════════════════════════════════════════
# NO-GO Correction A (PLAN.md §16a line 53): intent.expiry is the <=30s
# ACTIVATION window, independent of and never widened to match the up-to-
# 3600s request_expiry. It governs only whether the source's WAL may still
# RESERVE the intent; once reserved, continued work (publish/dispatch/
# observe/complete) is bound to request_expiry instead, never re-blocked by
# the activation window it already satisfied.
# ══════════════════════════════════════════════════════════════════════════

@test "S16-ROOT-CONSULT-INTENT-EXPIRY-CAP-01: validateRootConsultIntentRecord rejects any activation window wider than 30s or reaching past request_expiry" {
  run node -e '
    const rll = require(process.argv[1]);
    function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"); }
    const hex32 = "a".repeat(32);
    const hex64 = "b".repeat(64);
    const createdMs = Date.parse("2026-01-01T00:00:00Z");
    function baseRecord(expiryMs, requestExpiryMs) {
      return {
        schema: "runtime/root-consult-intent/v1",
        intent_id: hex32, main_binding_id: hex32, main_actor_instance_id: hex32,
        session_generation_id: hex32, repo_id: hex64, worktree_id: hex64,
        plan_digest: hex64, coordination_root_id: hex64,
        requester_role: "arch-testing", requester_binding_id: hex32,
        requester_actor_instance_id: "worker-1",
        target_role: "context-provider", target_role_profile_version: "1.0.0",
        target_role_profile_digest: hex64,
        question: "q", expected_result_kind: "IMPLEMENTATION_REVIEW",
        evidence_policy: "none",
        routing_policy_version: "runtime-routing/v1", routing_policy_digest: hex64,
        subject_repo_id: hex64, subject_worktree_id: hex64, subject_head: "deadbeef",
        subject_bundle_ref: "subject-bundles/x/manifest.json", subject_scope_digest: hex64,
        request_id: hex32, initial_attempt_id: hex32,
        request_created_at: iso(createdMs), request_expiry: iso(requestExpiryMs),
        created_at: iso(createdMs), expiry: iso(expiryMs),
      };
    }
    // Exactly at the 30s cap, well inside request_expiry: legal boundary.
    const okAtCap = rll.validateRootConsultIntentRecord(baseRecord(createdMs + 30000, createdMs + 3600000));
    // A full second past the 30s cap: illegal even though still far inside
    // request_expiry. (Canonical ISO timestamps in this system are
    // second-granularity -- the iso() helper above strips milliseconds on
    // round-trip, so a sub-second delta like +30001ms is indistinguishable
    // from +30000ms once serialized; the over-cap case must differ by a
    // full second to actually exercise the check.)
    const overCap = rll.validateRootConsultIntentRecord(baseRecord(createdMs + 31000, createdMs + 3600000));
    // Well inside the 30s cap, but past request_expiry: illegal -- the two
    // bounds are independent and BOTH must hold.
    const overRequestExpiry = rll.validateRootConsultIntentRecord(baseRecord(createdMs + 5000, createdMs + 4000));
    const results = {
      okAtCap: okAtCap.ok,
      overCap: overCap.ok, overCapReason: overCap.reason,
      overRequestExpiry: overRequestExpiry.ok, overRequestExpiryReason: overRequestExpiry.reason,
    };
    process.stdout.write(JSON.stringify(results));
    if (!okAtCap.ok || overCap.ok || overRequestExpiry.ok) process.exit(1);
  ' "$RLL_IMPL"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"overCapReason":"root-consult-intent-time-invalid"'* ]]
  [[ "$output" == *'"overRequestExpiryReason":"root-consult-intent-time-invalid"'* ]]
}

@test "S16-ROOT-CONSULT-NO-RESERVATION-ZEROWRITE-01: an intent nobody reserves before its own 30s window closes is zero-write/BLOCKED" {
  local session_id="s16e2e-noreserve-session"
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "$session_id"

  # Deterministic, not probabilistic: SIGSTOP freezes the ENTIRE Node
  # process backing $S16E2E_BG_PID -- runtime-bridge-codex.cjs's own
  # pollRetainedWorkers comment literally calls this process "this
  # supervisor process" ("Polling and admission are shared by all role
  # children in this supervisor process"). Its 250ms-tick poll loop
  # (RETAINED_WORKER_POLL_INTERVAL_MS) is the ONLY thing capable of
  # reserving a root-consult intent; while stopped it cannot run at all, so
  # there is no race left to lose -- this replaces the prior version's 3
  # skip-guards against a genuine race with a real guarantee.
  # _s16e2e_consult_root_publish writes the intent via a real, SEPARATE
  # hook+CLI invocation that never talks to this PID over IPC (confirmed by
  # reading its body: it only touches disk through the lifecycle library
  # directly), so publishing under a stopped supervisor is safe and requires
  # no special-casing.
  #
  # The whole STOP -> publish -> natural-expiry wait -> CONT -> assert
  # sequence runs inside its own subshell whose LOCAL `trap ... EXIT`
  # guarantees SIGCONT fires on every exit path, including a failed
  # assertion, before the failure propagates outward. NOT `trap ... RETURN`
  # -- UMASK-0600-01's own comment elsewhere in this repo documents that a
  # RETURN trap conflicts with bats' internal RETURN-trap use inside `run`.
  # A subshell's own EXIT trap is untouched by bats: reading bats-core's
  # bats-exec-test source directly confirms bats sets its EXIT trap only on
  # the outer per-test process, never on a nested subshell. If this subshell
  # exits non-zero, the outer test aborts before reaching
  # _s16e2e_stop_retained_plane below, but the file's own teardown() hook
  # (already `|| true`-hardened) is the established safety net for exactly
  # that case -- and by then SIGCONT has already run, so its SIGTERM lands
  # on a live, not a permanently-stopped, process.
  (
    trap 'kill -CONT "$S16E2E_BG_PID" 2>/dev/null || true' EXIT
    kill -STOP "$S16E2E_BG_PID"

    _s16e2e_consult_root_publish "$session_id" "NO-RESERVE" "none"
    intent_id="$S16E2E_CR_INTENT_ID"
    intent_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultIntentPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    reservation_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultReservationPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    published_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultPublishedPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    # request.json's path is coordRoot-relative (hostBridgeAdvanceRootConsult's
    # own requestRef = 'transactions/<request_id>/request.json'); this test's
    # supervisor is frozen so it can never be published, but the discriminating
    # assertion below still needs its absolute path to check.
    # request.json's real location per readRootConsultTerminalStatus/
    # canonicalRequestPathForRootIntent (runtime-consultation.cjs): NOT
    # coordRoot directly -- planRootPath(coordRoot, repoId, waveSlug,
    # planDigest)/transactions/<requestId>/request.json. planRootPath and
    # requestPathFor are both internal (unexported); the formula is inlined
    # here from their own definitions rather than duplicated as a guess.
    request_path="$(node -e '
      const rll = require(process.argv[1]);
      const path = require("path");
      const fs = require("fs");
      const proj = process.argv[2];
      const intent = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
      const coordRoot = rll.coordinationRootPathFor(proj);
      const plan = rll.discoverPlan(proj);
      const waveSlug = path.basename(path.dirname(plan.planPath)).replace(/^wave-/, "");
      const planRoot = path.join(coordRoot, intent.repo_id, waveSlug, intent.plan_digest);
      process.stdout.write(path.join(planRoot, "transactions", intent.request_id, "request.json"));
    ' "$RLL_IMPL" "$PROJ" "$intent_path")"
    created_at_ms="$(node -e '
      const fs = require("fs");
      process.stdout.write(String(Date.parse(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).created_at)));
    ' "$intent_path")"

    # Let the real (frozen) 30s activation window elapse on the wall clock,
    # with a 500ms margin -- a single computed sleep, never rewriting the
    # immutable intent record itself (the prior version's non-atomic
    # `rec.expiry = rec.created_at` self-write is exactly what this
    # deterministic replacement eliminates).
    now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
    wait_ms=$(( created_at_ms + 30500 - now_ms ))
    if [ "$wait_ms" -gt 0 ]; then
      sleep "$(node -e 'process.stdout.write((Number(process.argv[1]) / 1000).toFixed(3))' "$wait_ms")"
    fi

    kill -CONT "$S16E2E_BG_PID"
    # A real, generous number of 250ms poll ticks for the just-resumed loop
    # to observe this already-expired, still-unreserved intent -- not just
    # an instant read racing the very first tick after resume. This margin
    # is load-bearing, not cosmetic: empirically (direct instrumentation,
    # since reverted), if rootConsultIntentContext's own pre-reservation
    # expiry gate is bypassed, the resumed WAL loop actually reserves +
    # publishes + writes request.json for this exact intent within ~1.2s --
    # a short sleep here would let that race resolve in the mutation's
    # favor often enough to make the assertions below flaky rather than
    # discriminating. 3s is a >2x margin over that observed ceiling.
    sleep 3

    [ ! -f "$reservation_path" ]
    [ ! -f "$published_path" ]
    [ ! -f "$completion_path" ]
    [ ! -f "$request_path" ]

    # Reuses the established robust poller (transient "unable to resolve
    # scope" hook denials are a known, already-handled retry case for
    # consult-root-status -- see _s16e2e_poll_consult_root_status's own loop)
    # rather than a one-shot hook call.
    if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "BLOCKED" >/dev/null; then
      echo "DEBUG bridge log tail:" >&2
      tail -80 "$S16E2E_BG_OUT" >&2
      exit 1
    fi
    [ ! -f "$reservation_path" ]
    [ ! -f "$published_path" ]
    [ ! -f "$completion_path" ]
    [ ! -f "$request_path" ]
  )

  _s16e2e_stop_retained_plane
}

@test "S16-ROOT-CONSULT-RESERVED-PAST-30S-READY-01: an intent reserved before its own activation window closes still reaches READY after that window elapses, bound by request_expiry instead" {
  local session_id="s16e2e-past30s-session"
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "$session_id"

  # M67-ROLE-GATE-FLAKE-01 deterministic redesign, round 4 (2026-08-21):
  # replaces the racing fixture ordering entirely with the SAME real
  # SIGSTOP/SIGCONT protocol S16-ROOT-CONSULT-NO-RESERVATION-ZEROWRITE-01
  # (this file, above) already established and proved -- SIGSTOP freezes
  # the ENTIRE retained supervisor process backing $S16E2E_BG_PID (its own
  # 250ms-tick poll loop is the ONLY thing capable of reserving/publishing
  # a root-consult intent), so while stopped there is no race left to lose
  # at all -- a real guarantee, never a timing margin. The whole
  # STOP -> publish+mutate -> assert-zero-write -> CONT -> assert
  # sequence runs inside its own subshell with a LOCAL `trap ... EXIT`
  # (never `trap ... RETURN`, which conflicts with bats' own internal use)
  # guaranteeing SIGCONT fires on every exit path, including a failed
  # assertion, before the failure ever propagates outward -- identical
  # discipline to the precedent test, same rationale, not re-explained
  # here in full.
  (
    trap 'kill -CONT "$S16E2E_BG_PID" 2>/dev/null || true' EXIT
    kill -STOP "$S16E2E_BG_PID"

    # M67-SIGSTOP-STATE-CONFIRMATION-01: SIGSTOP is a request, not a
    # synchronous guarantee -- prove the supervisor has ACTUALLY reached a
    # stopped (T/t) ps state before the first publish/mutate below, rather
    # than assuming delivery happened by the time this line runs. A bounded
    # poll (never a fixed sleep, never an elapsed-time margin) on the
    # process's own reported state; a specific diagnostic distinguishes
    # "process disappeared" from "never stopped" so a real failure here is
    # never confused with the discriminating assertions later in this test.
    local stopped_confirmed=""
    local _s16_stopwait_i
    for _s16_stopwait_i in $(seq 1 50); do
      local ps_state
      ps_state="$(ps -o state= -p "$S16E2E_BG_PID" 2>/dev/null | tr -d '[:space:]')"
      if [ -z "$ps_state" ]; then
        echo "S16-ROOT-CONSULT-RESERVED-PAST-30S-READY-01: supervisor PID $S16E2E_BG_PID disappeared while waiting for SIGSTOP to take effect" >&2
        exit 1
      fi
      case "$ps_state" in
        T*|t*) stopped_confirmed=1; break ;;
      esac
      sleep 0.05
    done
    if [ -z "$stopped_confirmed" ]; then
      echo "S16-ROOT-CONSULT-RESERVED-PAST-30S-READY-01: supervisor PID $S16E2E_BG_PID never reached a stopped (T/t) ps state after SIGSTOP" >&2
      exit 1
    fi

    local short_window_seconds=5
    _s16e2e_consult_root_publish "$session_id" "PAST-30S" "none"
    intent_id="$S16E2E_CR_INTENT_ID"
    intent_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultIntentPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    reservation_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultReservationPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    published_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultPublishedPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
    completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"

    # ONE mutation, while the supervisor is provably frozen and cannot
    # observe any intermediate state -- never a second, later rewrite.
    node -e '
      const fs = require("fs");
      const rc = require(process.argv[1]);
      const intentPath = process.argv[2];
      const windowSeconds = Number(process.argv[3]);
      const rec = JSON.parse(fs.readFileSync(intentPath, "utf8"));
      const createdMs = Date.parse(rec.created_at);
      rec.expiry = new Date(createdMs + windowSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
      fs.writeFileSync(intentPath, rc.canonicalJSONStringify(rec));
    ' "$CONSULTATION_CLI" "$intent_path" "$short_window_seconds"
    intent_digest_final="$(node -e '
      const fs = require("fs");
      const rc = require(process.argv[1]);
      process.stdout.write(rc.sha256String(rc.canonicalJSONStringify(JSON.parse(fs.readFileSync(process.argv[2], "utf8")))));
    ' "$CONSULTATION_CLI" "$intent_path")"
    intent_expiry_ms="$(node -e '
      const fs = require("fs");
      process.stdout.write(String(Date.parse(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).expiry)));
    ' "$intent_path")"

    # While still frozen: zero write of any kind -- the mutation above is
    # this test\'s OWN direct file write, never observed or reacted to by
    # the (provably stopped) supervisor.
    [ ! -f "$reservation_path" ]
    [ ! -f "$published_path" ]
    [ ! -f "$completion_path" ]

    kill -CONT "$S16E2E_BG_PID"

    if ! _s16e2e_poll_consult_root_request_published "$session_id" "$intent_id" >/dev/null; then
      echo "DEBUG bridge log tail:" >&2
      tail -80 "$S16E2E_BG_OUT" >&2
      exit 1
    fi

    # reservation.intent_digest must equal the ONE, final, immutable
    # intent digest computed above -- proves the resumed supervisor
    # reserved the already-short-windowed intent (never an earlier,
    # unmutated snapshot), and that this test never mutated it again.
    reservation_digest="$(node -e '
      const fs = require("fs");
      process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).intent_digest);
    ' "$reservation_path")"
    [ "$reservation_digest" = "$intent_digest_final" ]

    # Wait by RECORDED STATE (the intent\'s own fixed, already-mutated
    # expiry) until it is genuinely in the past -- never a fixed sleep
    # duration, never an elapsed-time margin assertion on this test\'s own
    # wall-clock progress.
    while true; do
      now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
      [ "$now_ms" -ge "$intent_expiry_ms" ] && break
      sleep 0.1
    done

    # The discriminating assertion: this real flow crosses the intent\'s
    # own (short, fixed) activation boundary -- now provably, not just
    # probably, in the past -- while already reserved, and still reaches
    # READY, proving continued work is bound to request_expiry (3600s),
    # never re-orphaned at the activation window it already cleared.
    if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
      echo "DEBUG bridge log tail:" >&2
      tail -80 "$S16E2E_BG_OUT" >&2
      exit 1
    fi
  )

  _s16e2e_stop_retained_plane
}

# ══════════════════════════════════════════════════════════════════════════
# NO-GO Correction C (PLAN.md §16b line 63 / operation schema line 226):
# a root-source retirement's terminal_ref must be exactly the canonical ref
# ackPathFor/cancelPathFor derive for the record's OWN request_id -- never
# "any non-empty string". Pure validator-level unit tests (no live plane):
# fast, deterministic, exercise validateRootSourceRetirementRecord directly.
# ══════════════════════════════════════════════════════════════════════════

@test "S16-ROOT-SOURCE-RETIREMENT-TERMINAL-REF-CANONICAL-01: a path-traversal, absolute, or foreign-request terminal_ref is rejected" {
  run node -e '
    const rll = require(process.argv[1]);
    const hex32 = "a".repeat(32);
    const hex64a = "c".repeat(64);
    const hex64b = "d".repeat(64);
    const nowIso = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    function baseRecord(requestId, terminalRef, terminalDigest) {
      return {
        schema: "runtime/root-source-retirement/v1",
        binding_id: hex32, action_id: hex32, request_id: requestId,
        reason: "acked", terminal_ref: terminalRef, terminal_digest: terminalDigest,
        retired_at: nowIso,
      };
    }
    const canonicalRef = "transactions/" + hex64a + "/ack.json";
    const okCanonical = rll.validateRootSourceRetirementRecord(baseRecord(hex64a, canonicalRef, hex64b));
    const traversal = rll.validateRootSourceRetirementRecord(baseRecord(hex64a, "transactions/../../etc/passwd", hex64b));
    const absolute = rll.validateRootSourceRetirementRecord(baseRecord(hex64a, "/etc/passwd", hex64b));
    const foreignRequest = rll.validateRootSourceRetirementRecord(baseRecord(hex64a, "transactions/" + hex64b + "/ack.json", hex64b));
    const wrongBasename = rll.validateRootSourceRetirementRecord(baseRecord(hex64a, "transactions/" + hex64a + "/cancel.json", hex64b));
    const results = {
      okCanonical: okCanonical.ok,
      traversal: traversal.ok, traversalReason: traversal.reason,
      absolute: absolute.ok, absoluteReason: absolute.reason,
      foreignRequest: foreignRequest.ok, foreignRequestReason: foreignRequest.reason,
      wrongBasename: wrongBasename.ok, wrongBasenameReason: wrongBasename.reason,
    };
    process.stdout.write(JSON.stringify(results));
    if (!okCanonical.ok || traversal.ok || absolute.ok || foreignRequest.ok || wrongBasename.ok) process.exit(1);
  ' "$RLL_IMPL"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"traversalReason":"root-source-retirement-terminal-ref-not-canonical"'* ]]
  [[ "$output" == *'"absoluteReason":"root-source-retirement-terminal-ref-not-canonical"'* ]]
  [[ "$output" == *'"foreignRequestReason":"root-source-retirement-terminal-ref-not-canonical"'* ]]
  [[ "$output" == *'"wrongBasenameReason":"root-source-retirement-terminal-ref-not-canonical"'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# CP-EVIDENCE-E2E (PLAN.md §16c). A real root-consult intent with
# evidence_policy:context7-required, served by the SAME real retained
# context-provider worker ROOT-INGRESS-E2E already exercises (real internal
# MCP search first, real turn-read projection, real WAL/accept/ack). The
# fake app-server's ONLY substitution is the model's own turn response
# (context-provider-gap-once mode: emit ONE pattern-gap, then resume the
# SAME threadId with HOST_PATTERN_EVIDENCE and answer for real). The
# Context7 network call is substituted at resolveTestContext7RequestExecutor's
# boundary -- the SAME boundary S16-CP-CONTEXT7-SUPPLIED-ID-ZERO-SEARCH-01
# (runtime-consultation-bridge.bats) already established as this codebase's
# own "HTTPS socket boundary" convention for Context7 -- so executeContext7Sequence's
# real URL construction, header/content-type validation, and response
# parsing all run for real; only the raw network round trip is recorded and
# answered from a fixture queue.
# ══════════════════════════════════════════════════════════════════════════

# Absolute plan-root path production code itself resolves for a given
# consult-root intent (coordRoot/repoId/waveSlug/planDigest join, mirroring
# planRootPath's own construction) -- shared by every CP-EVIDENCE-E2E test
# that needs to read a transaction's result.json off disk directly.
_s16e2e_consult_root_plan_root() {
  local intent_id="$1"
  node -e '
    const fs = require("fs"); const path = require("path");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const intentId = process.argv[3];
    const intentPath = path.join(rll.registryRepoDir(projectRoot), "root-consult-intents", intentId + ".json");
    const intent = JSON.parse(fs.readFileSync(intentPath, "utf8"));
    const coordRoot = rll.coordinationRootPathFor(projectRoot);
    const waveSlug = path.basename(path.dirname(rll.discoverPlan(projectRoot).planPath)).replace(/^wave-/, "");
    process.stdout.write(path.join(coordRoot, intent.repo_id, waveSlug, intent.plan_digest));
  ' "$RLL_IMPL" "$PROJ" "$intent_id"
}

_s16e2e_cp_evidence_setup() {
  local session_id="$1" gap_spec_json="$2" ttl="${3:-3600}"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="${S16E2E_FAKE_MODE:-context-provider-gap-once}"
  S16E2E_FAKE_GAP_SPEC="$gap_spec_json"
  _s16e2e_start_retained_plane "$session_id" "$S16E2E_SUPPORT_ROLES" "$ttl"
}

# M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction D: asserts every recorded
# Context7 call against the REAL sockets only -- $S16E2E_FAKE_CONTEXT7_REQUEST_LOG
# (fake-context7-server.cjs's own req.method/req.url/req.headers/
# req.socket.servername, from the actual local TLS connection
# resolveTestContext7SocketAgent redirected to) and
# $S16E2E_FAKE_CONTEXT7_CONN_LOG (that same function's own createConnection-
# boundary recording of the real host/port/servername node's https.Agent
# internals passed it, BEFORE the loopback substitution). Never the deleted
# client-side pre-flight spec log. `expectedPath` is Node's raw req.url --
# path+query exactly as sent, order preserved, never re-parsed/re-ordered.
_s16e2e_assert_context7_calls() {
  local expected_count="$1" expected_path="$2"
  local call_count; call_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" | tr -d ' ')"
  [ "$call_count" -eq "$expected_count" ]
  local conn_count; conn_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_CONN_LOG" | tr -d ' ')"
  [ "$conn_count" -eq "$expected_count" ]
  node -e '
    const fs = require("fs");
    const reqLines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
    const connLines = fs.readFileSync(process.argv[2], "utf8").trim().split("\n");
    const expectedPath = process.argv[3];
    // Closed allow-set, not just a forbidden-set: Node itself adds Host/
    // Connection/Content-Length, production adds Accept/User-Agent -- ANY
    // other key (a proxy header, a secret, or anything else) fails closed,
    // satisfying "absence of Authorization, Cookie, proxy headers AND
    // extras" as one property rather than an enumerable blocklist.
    const ALLOWED_HEADERS = new Set(["accept", "user-agent", "host", "connection", "content-length"]);
    for (const line of reqLines) {
      const req = JSON.parse(line);
      if (req.method !== "GET") { process.stderr.write("expected method GET, got: " + line); process.exit(1); }
      if (req.url !== expectedPath) { process.stderr.write("expected url " + expectedPath + ", got: " + line); process.exit(1); }
      if (req.servername !== "context7.com") { process.stderr.write("expected socket servername context7.com (real TLS SNI as received), got: " + line); process.exit(1); }
      const h = req.headers || {};
      if (h.host !== "context7.com") { process.stderr.write("expected Host header context7.com, got: " + line); process.exit(1); }
      if (h.accept !== "text/plain" && h.accept !== "application/json") { process.stderr.write("unexpected Accept header: " + line); process.exit(1); }
      if (h["user-agent"] !== "AndroidCommonDoc-runtime/1") { process.stderr.write("unexpected User-Agent: " + line); process.exit(1); }
      for (const key of Object.keys(h)) {
        if (!ALLOWED_HEADERS.has(key)) { process.stderr.write("unexpected extra header " + key + " present: " + line); process.exit(1); }
      }
    }
    for (const line of connLines) {
      const conn = JSON.parse(line);
      if (conn.host !== "context7.com" || conn.port !== 443 || conn.servername !== "context7.com") {
        process.stderr.write("unexpected real connection options (pre-loopback-redirect): " + line); process.exit(1);
      }
    }
  ' "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" "$S16E2E_FAKE_CONTEXT7_CONN_LOG" "$expected_path"
}

@test "CP-EVIDENCE-E2E: real root intent (context7-required) -> real internal MCP search -> fake app-server emits ONE pattern-gap -> production Context7 builder/validator (supplied library_id) -> resumed SAME threadId -> result/v2 pattern_evidence_dependency -> real accept+ack" {
  local session_id="s16e2e-cpe-session"
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"S16 CP-EVIDENCE-E2E: structuredClone deep-copy semantics for Map"}'
  local fixture_body; fixture_body="$(node -e 'process.stdout.write(Buffer.from("Context7 fixture content for CP-EVIDENCE-E2E supplied-id.", "utf8").toString("base64"))')"
  S16E2E_FAKE_CONTEXT7_RESPONSES="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"text/plain; charset=utf-8"},bodyBase64:process.argv[1]}]))' "$fixture_body")"
  _s16e2e_cp_evidence_setup "$session_id" "$gap_spec"

  _s16e2e_consult_root_publish "$session_id" "CP-EVIDENCE-E2E-SUPPLIED-ID" "context7-required"
  local intent_id="$S16E2E_CR_INTENT_ID"

  if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
    echo "DEBUG bridge log tail:" >&2
    tail -80 "$S16E2E_BG_OUT" >&2
    echo "DEBUG timing log:" >&2
    [ -f "$S16E2E_TIMING_LOG" ] && cat "$S16E2E_TIMING_LOG" >&2
    false
  fi

  # Exactly one recorded Context7 call -- zero search, one context GET.
  _s16e2e_assert_context7_calls 1 "/api/v2/context?libraryId=%2Fnodejs%2Fnode&query=S16%20CP-EVIDENCE-E2E%3A%20structuredClone%20deep-copy%20semantics%20for%20Map"

  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local final_grant; final_grant="$(_extract_injected lifecycle-binding)"
  run env NODE_ENV=test node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id" --lifecycle-binding "$final_grant"
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "READY" || !e.operation || e.operation.state !== "READY" || e.operation.result_ref === null) {
      process.stderr.write("consult-root-status: " + JSON.stringify(e)); process.exit(1);
    }
  ' "$output"
  local result_ref; result_ref="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation.result_ref)' "$output")"

  local plan_root; plan_root="$(_s16e2e_consult_root_plan_root "$intent_id")"
  node -e '
    const fs = require("fs"); const path = require("path");
    const resultPath = path.join(process.argv[1], process.argv[2]);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    if (result.status !== "ANSWERED") { process.stderr.write("expected ANSWERED, got " + JSON.stringify(result)); process.exit(1); }
    const dep = result.pattern_evidence_dependency;
    const expectedKeys = ["evidence_digest", "evidence_ref", "gap_digest", "internal_search_digest", "library_id", "provider", "query_digest", "resolution_digest"];
    if (!dep || typeof dep !== "object") { process.stderr.write("expected a non-null pattern_evidence_dependency, got " + JSON.stringify(result)); process.exit(1); }
    const gotKeys = Object.keys(dep).sort();
    if (JSON.stringify(gotKeys) !== JSON.stringify(expectedKeys.sort())) {
      process.stderr.write("pattern_evidence_dependency key set drift: " + JSON.stringify(gotKeys)); process.exit(1);
    }
    if (dep.provider !== "context7" || dep.library_id !== "/nodejs/node" || dep.resolution_digest !== null) {
      process.stderr.write("pattern_evidence_dependency field mismatch: " + JSON.stringify(dep)); process.exit(1);
    }
  ' "$plan_root" "$result_ref"

  local completion_path; completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
  [ -f "$completion_path" ]
  node -e '
    const fs = require("fs");
    const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (c.accepted_result_ref === null || c.accepted_result_digest === null || c.ack_ref === null || c.ack_digest === null) process.exit(1);
  ' "$completion_path"

  _s16e2e_stop_retained_plane
}

@test "S16-CP-EVIDENCE-NULL-LIBRARY-ID-01: null library_id performs one deterministic search resolving a single match, then one context GET" {
  local session_id="s16e2e-cpe-null-session"
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":null,"query":"S16 CP-EVIDENCE-E2E: null library_id resolution"}'
  local search_body; search_body="$(node -e 'process.stdout.write(Buffer.from(JSON.stringify({results:[{id:"/nodejs/node",title:"Node.js"}]}),"utf8").toString("base64"))')"
  local context_body; context_body="$(node -e 'process.stdout.write(Buffer.from("Context7 fixture content for CP-EVIDENCE-E2E null-id.", "utf8").toString("base64"))')"
  S16E2E_FAKE_CONTEXT7_RESPONSES="$(node -e '
    process.stdout.write(JSON.stringify([
      { statusCode: 200, headers: { "content-type": "application/json" }, bodyBase64: process.argv[1] },
      { statusCode: 200, headers: { "content-type": "text/plain; charset=utf-8" }, bodyBase64: process.argv[2] },
    ]));
  ' "$search_body" "$context_body")"
  _s16e2e_cp_evidence_setup "$session_id" "$gap_spec"

  _s16e2e_consult_root_publish "$session_id" "CP-EVIDENCE-NULL-LIBRARY-ID-01" "context7-required"
  local intent_id="$S16E2E_CR_INTENT_ID"

  if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
    echo "DEBUG bridge log tail:" >&2
    tail -80 "$S16E2E_BG_OUT" >&2
    echo "DEBUG timing log:" >&2
    [ -f "$S16E2E_TIMING_LOG" ] && cat "$S16E2E_TIMING_LOG" >&2
    false
  fi

  # M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction D: from the fake server's own
  # real-socket recording ($S16E2E_FAKE_CONTEXT7_REQUEST_LOG), never a
  # client-side pre-flight log -- see _s16e2e_assert_context7_calls's own
  # header comment. This test's two calls have DIFFERENT expected paths/
  # Accept headers (search then context), so it checks them individually
  # rather than through that shared single-shape helper.
  local call_count; call_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" | tr -d ' ')"
  [ "$call_count" -eq 2 ]
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const search = lines[0]; const ctx = lines[1];
    for (const req of lines) {
      if (req.method !== "GET" || req.servername !== "context7.com" || (req.headers || {}).host !== "context7.com") {
        process.stderr.write("unexpected recorded Context7 request: " + JSON.stringify(req)); process.exit(1);
      }
    }
    if (!search.url.startsWith("/api/v2/libs/search?") || !search.url.includes("libraryName=Node.js")) {
      process.stderr.write("expected the search call first: " + JSON.stringify(search)); process.exit(1);
    }
    if (search.headers.accept !== "application/json") { process.stderr.write("expected Accept: application/json for search"); process.exit(1); }
    if (!ctx.url.startsWith("/api/v2/context?libraryId=%2Fnodejs%2Fnode")) {
      process.stderr.write("expected the resolved library id on the context call: " + JSON.stringify(ctx)); process.exit(1);
    }
  ' "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG"

  local plan_root; plan_root="$(_s16e2e_consult_root_plan_root "$intent_id")"
  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local final_grant; final_grant="$(_extract_injected lifecycle-binding)"
  run env NODE_ENV=test node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id" --lifecycle-binding "$final_grant"
  [ "$status" -eq 0 ]
  local result_ref; result_ref="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation.result_ref)' "$output")"
  node -e '
    const fs = require("fs"); const path = require("path");
    const result = JSON.parse(fs.readFileSync(path.join(process.argv[1], process.argv[2]), "utf8"));
    const dep = result.pattern_evidence_dependency;
    if (!dep || dep.library_id !== "/nodejs/node" || dep.resolution_digest === null) {
      process.stderr.write("expected a resolved library_id with a non-null resolution_digest: " + JSON.stringify(dep)); process.exit(1);
    }
  ' "$plan_root" "$result_ref"

  _s16e2e_stop_retained_plane
}

@test "S16-CP-EVIDENCE-NO-GAP-01: evidence_policy:none never triggers Context7 -- zero recorded calls, zero pattern_evidence_dependency" {
  local session_id="s16e2e-cpe-nogap-session"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="cooperative"
  S16E2E_FAKE_GAP_SPEC=""
  S16E2E_FAKE_CONTEXT7_RESPONSES=""
  _s16e2e_start_retained_plane "$session_id"

  _s16e2e_consult_root_publish "$session_id" "CP-EVIDENCE-NO-GAP-01" "none"
  local intent_id="$S16E2E_CR_INTENT_ID"

  if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
    echo "DEBUG bridge log tail:" >&2
    tail -80 "$S16E2E_BG_OUT" >&2
    false
  fi

  # No S16E2E_FAKE_CONTEXT7_RESPONSES means _s16e2e_start_bridge_bg never
  # started a fake server at all for this test (evidence_policy:none should
  # never need one) -- S16E2E_FAKE_CONTEXT7_REQUEST_LOG stays the empty
  # string in that case; tolerate that alongside an existing-but-empty file.
  [ -z "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" ] || [ ! -s "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" ]

  local plan_root; plan_root="$(_s16e2e_consult_root_plan_root "$intent_id")"
  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local final_grant; final_grant="$(_extract_injected lifecycle-binding)"
  run env NODE_ENV=test node "$RLL_IMPL" consult-root-status --project-root "$PROJ" --intent-id "$intent_id" --lifecycle-binding "$final_grant"
  [ "$status" -eq 0 ]
  local result_ref; result_ref="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).operation.result_ref)' "$output")"
  node -e '
    const fs = require("fs"); const path = require("path");
    const result = JSON.parse(fs.readFileSync(path.join(process.argv[1], process.argv[2]), "utf8"));
    if (result.pattern_evidence_dependency !== null) { process.stderr.write("expected null: " + JSON.stringify(result.pattern_evidence_dependency)); process.exit(1); }
  ' "$plan_root" "$result_ref"

  _s16e2e_stop_retained_plane
}

# ── CP-EVIDENCE-E2E mandatory negatives ─────────────────────────────────────
# S16-PATTERN-GAP-CP-ONLY-01 (runtime-consultation-bridge.bats) already proves
# validateRuntimeTurnEnvelope itself rejects a second gap and a non-CP-role
# gap at the unit level -- including that a non-CP role's OWN Codex output
# schema never even contains a pattern-gap branch to begin with (built via
# patternGapAllowed:false for every role but context-provider). The E2E
# topology itself structurally can never construct "a non-context-provider
# target with evidence" (hostBridgeAllowedChildRoles/s16ResolveRetainedPair
# force consult-root's target to context-provider -- see ROOT-INGRESS-E2E's
# own header comment), so that specific negative has no meaningful E2E
# surface beyond what the unit test already proves. The negatives below
# instead prove the REAL retained-worker wiring fails closed end-to-end
# for the network-boundary and resolution-ambiguity failure modes, which
# the unit-level validator tests never touch (they stop at the schema).

# Publishes a context7-required consult-root intent against a context-
# provider-gap-once plane and asserts the retained bridge fails CLOSED
# (never a fabricated ANSWERED/READY) -- checked via the bridge's own final
# bridge-result summary signal, which is guaranteed to flush because it is
# written at process exit (session-run's own last, synchronous act).
# M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction F: called DIRECTLY by every
# S16-CP-EVIDENCE-* negative below -- never `run _s16e2e_cp_evidence_expect_
# shutdown_signal ...` (the harness hang this correction closes: an
# inherited-stdout fake-context7-server child, fixed above in
# _s16e2e_start_bridge_bg, could keep bats' own `run` capture blocked on EOF
# long after this function's own real work was done). Its own pass/fail is
# now carried entirely by ITS exit code via plain errexit propagation, never
# a separately-checked $status.
#
# The whole body runs inside a subshell with a LOCAL `trap ... EXIT` (never
# `trap ... RETURN` -- see UMASK-0600-01's own comment elsewhere in this
# repo: a RETURN trap conflicts with bats' internal RETURN-trap use inside
# `run`; a subshell's own EXIT trap is untouched by bats, confirmed against
# bats-core's bats-exec-test source during NO-GO Correction A above) so
# _s16e2e_stop_retained_plane runs on EVERY exit path -- the bounded-wait
# timeout, the substring mismatch, the final completion-absence check, or a
# clean pass -- never leaving the bridge or fake Context7 server as an
# orphan the caller's own final _s16e2e_stop_retained_plane (never reached
# on an early failure) or teardown()'s safety net would otherwise have to
# catch blind.

# M6+M7 SIXTEENTH Phase 2A: byte-bound evidence for exactly ONE real Context7
# call (every one of the 8 CP-EVIDENCE negatives makes exactly one -- search
# XOR context, depending on whether gap_spec's library_id is null or
# supplied -- before failing). Requires BOTH:
#   - the connection log (resolveTestContext7SocketAgent's own pre-tls.connect
#     recording of the real host/port/servername Node's https.Agent internals
#     were given, before the loopback redirect);
#   - the request log, written by the fake HTTPS server ONLY AFTER it
#     genuinely received the request over the real local TLS socket (proves
#     the failure happened downstream of a real request/response round trip
#     or a genuine no-response hang, never merely "a connection was opened").
# Computes the exact expected path from gap_spec_json using the SAME
# rfc3986Encode + path formula as performDirectContext7Sequence
# (runtime-bridge-codex.cjs) -- never a looser startsWith/includes check.
_s16e2e_cp_evidence_assert_negative_call() {
  local gap_spec_json="$1"
  local call_count; call_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" 2>/dev/null | tr -d ' ')"
  if [ "${call_count:-0}" -ne 1 ]; then
    echo "DEBUG: expected exactly 1 recorded Context7 request, got ${call_count:-0}:" >&2
    [ -f "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" ] && cat "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" >&2
    return 1
  fi
  local conn_count; conn_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_CONN_LOG" 2>/dev/null | tr -d ' ')"
  if [ "${conn_count:-0}" -ne 1 ]; then
    echo "DEBUG: expected exactly 1 recorded Context7 connection, got ${conn_count:-0}:" >&2
    [ -f "$S16E2E_FAKE_CONTEXT7_CONN_LOG" ] && cat "$S16E2E_FAKE_CONTEXT7_CONN_LOG" >&2
    return 1
  fi
  node -e '
    const fs = require("fs");
    function rfc3986Encode(value) {
      return encodeURIComponent(value).replace(/[!\x27()*]/g, (char) => (
        "%" + char.charCodeAt(0).toString(16).toUpperCase()
      ));
    }
    const gap = JSON.parse(process.argv[1]);
    const reqLog = process.argv[2];
    const connLog = process.argv[3];
    const expectedPath = gap.library_id === null
      ? "/api/v2/libs/search?libraryName=" + rfc3986Encode(gap.library_name) + "&query=" + rfc3986Encode(gap.query)
      : "/api/v2/context?libraryId=" + rfc3986Encode(gap.library_id) + "&query=" + rfc3986Encode(gap.query);
    const expectedAccept = gap.library_id === null ? "application/json" : "text/plain";
    const ALLOWED_HEADERS = new Set(["accept", "user-agent", "host", "connection", "content-length"]);
    const FORBIDDEN_HEADERS = ["authorization", "cookie", "proxy-authorization", "proxy-connection", "x-forwarded-for", "via"];
    const req = JSON.parse(fs.readFileSync(reqLog, "utf8").trim());
    if (req.method !== "GET") { process.stderr.write("expected method GET, got: " + JSON.stringify(req)); process.exit(1); }
    if (req.url !== expectedPath) { process.stderr.write("expected url " + expectedPath + ", got: " + JSON.stringify(req)); process.exit(1); }
    if (req.servername !== "context7.com") { process.stderr.write("expected socket servername context7.com, got: " + JSON.stringify(req)); process.exit(1); }
    const h = req.headers || {};
    if (h.host !== "context7.com") { process.stderr.write("expected Host header context7.com, got: " + JSON.stringify(req)); process.exit(1); }
    if (h.accept !== expectedAccept) { process.stderr.write("expected Accept " + expectedAccept + ", got: " + JSON.stringify(req)); process.exit(1); }
    if (h["user-agent"] !== "AndroidCommonDoc-runtime/1") { process.stderr.write("unexpected User-Agent: " + JSON.stringify(req)); process.exit(1); }
    for (const key of Object.keys(h)) {
      if (!ALLOWED_HEADERS.has(key)) { process.stderr.write("unexpected extra header " + key + " present (closed allowlist): " + JSON.stringify(req)); process.exit(1); }
    }
    for (const forbidden of FORBIDDEN_HEADERS) {
      if (forbidden in h) { process.stderr.write("forbidden header " + forbidden + " present: " + JSON.stringify(req)); process.exit(1); }
    }
    if ("location" in h) { process.stderr.write("unexpected redirect-shaped Location header on a REQUEST record: " + JSON.stringify(req)); process.exit(1); }
    const conn = JSON.parse(fs.readFileSync(connLog, "utf8").trim());
    if (conn.host !== "context7.com" || conn.port !== 443 || conn.servername !== "context7.com") {
      process.stderr.write("unexpected real connection options (pre-loopback-redirect): " + JSON.stringify(conn)); process.exit(1);
    }
  ' "$gap_spec_json" "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" "$S16E2E_FAKE_CONTEXT7_CONN_LOG"
}

# M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction F (Phase 2A hardened): called
# DIRECTLY by every S16-CP-EVIDENCE-* negative below -- never `run
# _s16e2e_cp_evidence_expect_shutdown_signal ...` (the harness hang this
# correction closes: an inherited-stdout fake-context7-server child could
# keep bats' own `run` capture blocked on EOF long after this function's own
# real work was done). Its own pass/fail is carried entirely by its exit code
# via plain errexit propagation, never a separately-checked $status.
_s16e2e_cp_evidence_expect_shutdown_signal() {
  local session_id="$1" gap_spec_json="$2" responses_json="$3" expected_reason="$4" ttl="${5:-3600}"
  (
    trap '_s16e2e_stop_retained_plane || true' EXIT
    S16E2E_FAKE_CONTEXT7_RESPONSES="$responses_json"
    _s16e2e_cp_evidence_setup "$session_id" "$gap_spec_json" "$ttl"
    _s16e2e_consult_root_publish "$session_id" "cp-evidence-negative" "context7-required"
    intent_id="$S16E2E_CR_INTENT_ID"
    completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"

    # M6+M7 SIXTEENTH Phase 2A: active monotonic poll, never a fixed
    # sleep-then-check-once. A completion appearing at ANY point during the
    # wait is an immediate FAIL (a durability failure must never race a
    # fabricated success into existence) -- checked on every tick, not only
    # after the bridge process has already exited.
    tries=0
    while true; do
      if [ -f "$completion_path" ]; then
        echo "DEBUG: a completion record appeared while awaiting fail-closed shutdown -- this must never happen:" >&2
        cat "$completion_path" >&2
        exit 1
      fi
      if ! kill -0 "$S16E2E_BG_PID" 2>/dev/null; then
        break
      fi
      tries=$((tries + 1))
      if [ "$tries" -ge 3600 ]; then
        echo "DEBUG: bridge never exited on its own within deadline" >&2
        tail -80 "$S16E2E_BG_OUT" >&2
        exit 1
      fi
      sleep 0.1
    done
    # PID confirmed dead: wait/reap, then recheck completion is still absent
    # (closes the gap between the last poll tick and the process actually
    # exiting) before trusting anything the process wrote on its way out.
    wait "$S16E2E_BG_PID" 2>/dev/null || true
    S16E2E_BG_PID=""
    if [ -f "$completion_path" ]; then
      echo "DEBUG: a completion record appeared between the final poll and process reap -- this must never happen:" >&2
      cat "$completion_path" >&2
      exit 1
    fi

    # M6+M7 SIXTEENTH Phase 2A: parse the LAST coordination/bridge-result/v1
    # line (session-run's own final, synchronous, guaranteed-to-flush act --
    # its process.exit only happens after this write), never a substring
    # grep over the raw log. Requires EXACT equality against the fully
    # constructed signal -- no OTHER reason, including a same-shaped MCP-
    # layer failure or (outside TIMEOUT-01) a genuine context7-timeout, may
    # satisfy this.
    local expected_signal="APP_SERVER_WORKER_LOOP_FAILED:$expected_reason"
    node -e '
      const fs = require("fs");
      const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
      let last = null;
      for (const line of lines) {
        let obj;
        try { obj = JSON.parse(line); } catch (err) { continue; }
        if (obj && obj.schema === "coordination/bridge-result/v1") last = obj;
      }
      const expected = process.argv[2];
      if (!last) { process.stderr.write("no coordination/bridge-result/v1 line found in bridge output"); process.exit(1); }
      if (last.signal !== expected) {
        process.stderr.write("expected signal exactly " + JSON.stringify(expected) + ", got " + JSON.stringify(last.signal) + " (full record: " + JSON.stringify(last) + ")");
        process.exit(1);
      }
    ' "$S16E2E_BG_OUT" "$expected_signal"

    # A durability failure like this must never publish a completion -- the
    # consult-root intent stays WAITING/BLOCKED-at-the-transaction-level
    # forever, never a fabricated READY. (Final re-confirmation, after the
    # monotonic poll above already proved it never transiently appeared.)
    [ ! -f "$completion_path" ]

    # M6+M7 SIXTEENTH Phase 2A: the exact-signal match above proves the
    # bridge's OWN log carries the right reason, but not that Context7 was
    # genuinely REACHED and genuinely answered/hung as this scenario's own
    # fixture dictates -- an internal-search/MCP failure occurring BEFORE the
    # model ever gets a turn could, in principle, produce a similarly-worded
    # message for the wrong reason. Byte-bound exact-phase evidence closes
    # that gap.
    _s16e2e_cp_evidence_assert_negative_call "$gap_spec_json"
  )
}

@test "S16-CP-EVIDENCE-SECOND-GAP-01: a model that tries to emit a second pattern-gap on the resumed turn is rejected, never a fabricated answer" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"S16 CP-EVIDENCE-SECOND-GAP-01"}'
  local fixture_body; fixture_body="$(node -e 'process.stdout.write(Buffer.from("fixture", "utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"text/plain; charset=utf-8"},bodyBase64:process.argv[1]}]))' "$fixture_body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-always"
  # A model that keeps re-offering pattern-gap after validation rejects it
  # isn't treated as instantly fatal (waitForValidatedTurnCompletion polls
  # for a still-possible valid answer) -- it only gives up at the request's
  # own expiry-derived deadline. A short-lived binding (300s, safely above
  # s16ResolveMainContext's 120s creation-lifetime floor) makes that bound
  # reachable in this test instead of the real ~1h default.
  # M6+M7 SIXTEENTH Phase 2A: the FULL exact chained reason -- production
  # wraps this specific rejection through two outer layers (an invalid
  # canonical envelope wrapping the inner pattern-gap-forbidden cause)
  # before it ever reaches workerFailureSignal, unlike every other negative
  # below whose reason is a single unwrapped Error#message.
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-2ndgap-session" "$gap_spec" "$responses" "turn-completed-envelope-invalid:canonical-envelope-invalid:pattern-gap-forbidden-for-execution-context" 300
}

@test "S16-CP-EVIDENCE-MALFORMED-SEARCH-01: a non-JSON search response body fails closed, never a fabricated answer" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":null,"query":"S16 CP-EVIDENCE-MALFORMED-SEARCH-01"}'
  local bad_body; bad_body="$(node -e 'process.stdout.write(Buffer.from("{not valid json", "utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"application/json"},bodyBase64:process.argv[1]}]))' "$bad_body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-malformed-session" "$gap_spec" "$responses" "context7-search-json-invalid"
}

@test "S16-CP-EVIDENCE-OVERSIZED-CONTEXT-01: a context response body over CONTEXT7_CONTEXT_RESPONSE_CAP fails closed, never a fabricated answer" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"S16 CP-EVIDENCE-OVERSIZED-CONTEXT-01"}'
  # The 1MB+ base64 body must never cross an argv boundary (ARG_MAX) --
  # generated and JSON-wrapped in one single node invocation.
  local responses; responses="$(node -e '
    const body = Buffer.alloc(1024 * 1024 + 16, 97).toString("base64");
    process.stdout.write(JSON.stringify([
      { statusCode: 200, headers: { "content-type": "text/plain; charset=utf-8" }, bodyBase64: body },
    ]));
  ')"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-oversized-session" "$gap_spec" "$responses" "context7-response-too-large"
}

@test "S16-CP-EVIDENCE-ZERO-MATCH-01: a search with zero results is an ambiguous resolution, fails closed" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":null,"query":"S16 CP-EVIDENCE-ZERO-MATCH-01"}'
  local search_body; search_body="$(node -e 'process.stdout.write(Buffer.from(JSON.stringify({results:[]}),"utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"application/json"},bodyBase64:process.argv[1]}]))' "$search_body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-zeromatch-session" "$gap_spec" "$responses" "context7-library-selection-ambiguous"
}

@test "S16-CP-EVIDENCE-N-MATCH-01: a search with more than one equally-titled match is an ambiguous resolution, fails closed" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":null,"query":"S16 CP-EVIDENCE-N-MATCH-01"}'
  local search_body; search_body="$(node -e 'process.stdout.write(Buffer.from(JSON.stringify({results:[{id:"/nodejs/node",title:"Node.js"},{id:"/nodejs/node-other",title:"Node.js"}]}),"utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"application/json"},bodyBase64:process.argv[1]}]))' "$search_body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-nmatch-session" "$gap_spec" "$responses" "context7-library-selection-ambiguous"
}

@test "S16-CP-EVIDENCE-LIBRARY-MISMATCH-01: a search result whose title does not match the requested library_name is filtered to zero matches, fails closed" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":null,"query":"S16 CP-EVIDENCE-LIBRARY-MISMATCH-01"}'
  local search_body; search_body="$(node -e 'process.stdout.write(Buffer.from(JSON.stringify({results:[{id:"/some/other-lib",title:"Some Other Library"}]}),"utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:200,headers:{"content-type":"application/json"},bodyBase64:process.argv[1]}]))' "$search_body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-mismatch-session" "$gap_spec" "$responses" "context7-library-selection-ambiguous"
}

@test "S16-CP-EVIDENCE-TIMEOUT-01: a Context7 call that never responds genuinely times out via the real bounded timeout, fails closed" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"S16 CP-EVIDENCE-TIMEOUT-01"}'
  local responses; responses='[{"hang":true}]'
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-timeout-session" "$gap_spec" "$responses" "context7-timeout"
}

@test "S16-CP-EVIDENCE-429-RETRY-AFTER-01: a 429 with Retry-After is a non-200 response, fails closed, never silently retried into a fabricated answer" {
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"S16 CP-EVIDENCE-429-RETRY-AFTER-01"}'
  local body; body="$(node -e 'process.stdout.write(Buffer.from("rate limited", "utf8").toString("base64"))')"
  local responses; responses="$(node -e 'process.stdout.write(JSON.stringify([{statusCode:429,headers:{"content-type":"text/plain","retry-after":"30"},bodyBase64:process.argv[1]}]))' "$body")"
  S16E2E_BG_PID=""
  S16E2E_FAKE_MODE="context-provider-gap-once"
  _s16e2e_cp_evidence_expect_shutdown_signal "s16e2e-cpe-429-session" "$gap_spec" "$responses" "context7-response-invalid"
}

@test "S16-CP-EVIDENCE-MCP-CLEANUP-01: the internal-search MCP child is genuinely gone (no orphan) after a real context-provider turn completes" {
  local session_id="s16e2e-cpe-cleanup-session"
  # M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction F: scoped to THIS test's own
  # $PROJ (a fresh mktemp -d, unique per test) rather than a global `pgrep
  # -f "mcp-server/build/index.js"` -- the prior bare substring matches ANY
  # process on the machine with that path fragment anywhere in its argv,
  # including a totally unrelated concurrently-running test's own MCP child
  # or an orphan left by a PRIOR test run, either of which would make this
  # count comparison spuriously pass OR fail for a reason having nothing to
  # do with THIS test's own cleanup.
  local before; before="$(pgrep -f "$PROJ/mcp-server/build/index.js" 2>/dev/null | wc -l | tr -d ' ')"
  S16E2E_FAKE_MODE="cooperative"
  S16E2E_FAKE_GAP_SPEC=""
  S16E2E_FAKE_CONTEXT7_RESPONSES=""
  _s16e2e_cp_evidence_setup "$session_id" ""
  _s16e2e_consult_root_publish "$session_id" "CP-EVIDENCE-MCP-CLEANUP-01" "none"
  local intent_id="$S16E2E_CR_INTENT_ID"
  if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
    tail -80 "$S16E2E_BG_OUT" >&2
    false
  fi
  # runContextProviderInternalSearch's own finally block requires
  # stopOwnedAppServerChildBounded to CONFIRM the child is gone (throwing
  # DURABILITY_UNPROVEN otherwise) before ever returning -- by the time
  # consult-root-status reports READY, the search's own child is already
  # provably reaped. Confirm no orphan survives independently too.
  local after; after="$(pgrep -f "$PROJ/mcp-server/build/index.js" 2>/dev/null | wc -l | tr -d ' ')"
  [ "$after" -eq "$before" ]
  _s16e2e_stop_retained_plane
}

# NO-GO Correction E (§16d line 79: "the MCP executable/argv/cwd/shell/
# environment confinement is widened or inherits a secret/proxy/credential"):
# the S16-CP-EVIDENCE-* tests above exercise the real internal-search child
# end-to-end, but none of them can DIRECTLY observe the exact env object
# handed to StdioClientTransport -- a widened env that still lets search-docs
# resolve would pass every one of them silently. This fast, direct check on
# closedMcpEnvironment's own return value (exported specifically for this,
# same rationale as childEnvFromTopology) closes that gap without spawning a
# real child.
@test "S16-CP-SPAWN-CONFINEMENT-ENV-01: closedMcpEnvironment returns EXACTLY the PLAN.md §16c closed POSIX key set, no inherited/secret/proxy value" {
  run env NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const rbc = require(process.argv[1]);
    if (process.platform === "win32") { process.stdout.write(JSON.stringify({skip:"win32"})); process.exit(0); }
    const projectRoot = "/example/project-root";
    const isolatedHome = "/example/isolated-home";
    const env = rbc.closedMcpEnvironment(projectRoot, isolatedHome);
    const expectedKeys = ["ANDROID_COMMON_DOC","HOME","LOGNAME","PATH","SHELL","TERM","USER","HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","NO_PROXY"];
    const actualKeys = Object.keys(env).sort();
    const keysMatch = JSON.stringify(actualKeys) === JSON.stringify(expectedKeys.slice().sort());
    const result = {
      keysMatch, actualKeys,
      androidCommonDoc: env.ANDROID_COMMON_DOC, home: env.HOME, logname: env.LOGNAME,
      path: env.PATH, shell: env.SHELL, term: env.TERM, user: env.USER,
      httpProxy: env.HTTP_PROXY, httpsProxy: env.HTTPS_PROXY, allProxy: env.ALL_PROXY, noProxy: env.NO_PROXY,
    };
    process.stdout.write(JSON.stringify(result));
    const ok = (
      keysMatch && env.ANDROID_COMMON_DOC === projectRoot && env.HOME === isolatedHome
      && env.LOGNAME === "runtime" && env.PATH === "" && env.SHELL === "" && env.TERM === "dumb"
      && env.USER === "runtime" && env.HTTP_PROXY === "" && env.HTTPS_PROXY === ""
      && env.ALL_PROXY === "" && env.NO_PROXY === "*"
    );
    if (!ok) process.exit(1);
  ' "$LIB_DIR/runtime-bridge-codex.cjs"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"keysMatch":true'* ]]
  [[ "$output" == *'"path":""'* ]]
  [[ "$output" == *'"httpProxy":""'* ]]
  [[ "$output" == *'"noProxy":"*"'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 LIFECYCLE -- IMMUTABLE AUTHORITY CUTS AND ADMISSION LINEARIZATION (v4).
# Fase 1 (test-specialist, dispatch arch-testing-20260816T160058Z): RED 2
# (M7-BINDING-V2-ROOT-GENERATION-02) from .planning/wave-portable-runtime-
# messaging-adapters/M7-ATOMIC-REVOCATION-RECONCILIATION.md section 10.3.
# Group A's own remaining item -- deferred until confirming a real fixture
# chain existed for createRootSourceBinding rather than hand-rolling an
# action+reservation. Reuses _s16_create_and_retire_real_root_source's own
# proven chain (real lifecycle CLI root-source -> real Agent PreToolUse gate
# reservation -> real SubagentStart binding creation) verbatim through
# binding creation, deliberately never calling SubagentStop -- this file's
# own established "small logic-identical duplication is safer than an
# awkward shared parameter shape" convention (mirrors runtime-role-
# lifecycle.cjs's own findLiveClaudeOneShotBindingsByIdentity precedent) --
# the retiring sibling above is reused by other tests and must not change
# shape.
# ══════════════════════════════════════════════════════════════════════════

_m7_create_real_active_root_source_binding() {
  local session_id="$1" agent_id="$2"
  git -C "$PROJ" checkout -b "feature/m7-red02-active-fixture" -q 2>/dev/null
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-role-gate-retained-plane" node -e '
    const fs = require("fs");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const lifecycleCli = process.argv[1];
    const agentGate = process.argv[4];
    const subagentHook = process.argv[5];
    const sessionId = process.argv[6];
    const agentId = process.argv[7];
    const retainedFixture = require(process.argv[8]);
    const intent = {
      source_role: "toolkit-specialist",
      reporting_architect: "arch-platform",
      question: "Inspect the bounded M7 RED-02 active-binding fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
    };
    const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("M7 RED-02 PLAN missing"); process.exit(1); }
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!generation.ok || !main.ok) { process.stderr.write("M7 RED-02 main authority setup failed"); process.exit(1); }
    retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
    const lifecycleGrant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
      "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
    );
    if (!lifecycleGrant.ok) {
      process.stderr.write("M7 RED-02 missing root-source lifecycle admission: " + JSON.stringify(lifecycleGrant));
      process.exit(1);
    }
    const cli = spawnSync(process.execPath, [
      lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
      "--lifecycle-binding", lifecycleGrant.grantId,
    ], { encoding: "utf8", env: process.env });
    let envelope;
    try { envelope = JSON.parse(cli.stdout); } catch { envelope = null; }
    if (cli.status !== 0 || !envelope || envelope.status !== "ACTION_REQUIRED"
      || !envelope.operation || envelope.operation.kind !== "root-source"
      || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
      process.stderr.write("M7 RED-02 real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
      process.exit(1);
    }
    const action = envelope.actions[0];
    const p = action.payload;
    const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" });
    const gate = spawnSync(process.execPath, [agentGate], {
      input: JSON.stringify({
        tool_name: "Agent",
        tool_input: { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message },
        tool_use_id: "m7-red02-tool-use-01", session_id: sessionId, agent_type: "", agent_id: "",
      }), encoding: "utf8", env: commonEnv,
    });
    let gateBody;
    try { gateBody = JSON.parse(gate.stdout); } catch { gateBody = null; }
    if (gate.status !== 0 || !gateBody || !gateBody.hookSpecificOutput || gateBody.hookSpecificOutput.permissionDecision !== "allow") {
      process.stderr.write("M7 RED-02 Agent gate reservation failed: " + JSON.stringify({ status: gate.status, stdout: gate.stdout, stderr: gate.stderr }));
      process.exit(1);
    }
    const start = spawnSync(process.execPath, [subagentHook], {
      input: JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "toolkit-specialist", session_id: sessionId, agent_id: agentId }),
      encoding: "utf8", env: commonEnv,
    });
    if (start.status !== 0) { process.stderr.write("M7 RED-02 SubagentStart failed: " + JSON.stringify(start)); process.exit(1); }
    const bindingsDir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
    let entries = [];
    try { entries = fs.readdirSync(bindingsDir, { withFileTypes: true }); } catch (err) {
      process.stderr.write("M7 RED-02 genuine binding directory absent: " + err.code + "; SubagentStart=" + JSON.stringify({ status: start.status, stdout: start.stdout, stderr: start.stderr })); process.exit(1);
    }
    const bindings = entries.filter((e) => e.isFile() && /^[a-f0-9]{32}\.json$/.test(e.name))
      .map((e) => JSON.parse(fs.readFileSync(path.join(bindingsDir, e.name), "utf8")))
      .filter((b) => b.action_id === action.action_id && b.runtime_session_key === sessionId && b.agent_id === agentId);
    if (bindings.length !== 1) { process.stderr.write("M7 RED-02 expected one genuine binding, got " + bindings.length); process.exit(1); }
    const binding = bindings[0];
    process.stdout.write(binding.binding_id);
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$AGENT_SPAWN_GATE_HOOK" "$SUBAGENT_START_HOOK" "$session_id" "$agent_id" "$S16_RETAINED_FIXTURE"
}

@test "M7-BINDING-V2-ROOT-GENERATION-02 RED: createRootSourceBinding must persist schema runtime/root-source-binding/v2 with a session_generation_id field -- today it persists v1 with no such field" {
  local session_id="m7-red02-session" agent_id="m7-red02-agent"
  run _m7_create_real_active_root_source_binding "$session_id" "$agent_id"
  [ "$status" -eq 0 ]
  local binding_id="$output"
  [ -n "$binding_id" ]

  run node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const rec = JSON.parse(fs.readFileSync(path.join(rll.registryRepoDir(process.argv[2]), "root-source-bindings", process.argv[3] + ".json"), "utf8"));
    process.stdout.write(JSON.stringify(rec));
  ' "$RLL_IMPL" "$PROJ" "$binding_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"schema":"runtime/root-source-binding/v2"'* ]]
  [[ "$output" == *'"session_generation_id":"'* ]]
}

# M7 FINAL CORRECTION (test-specialist, batch 1 of 3): R3
# (M7-ROOT-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS). Same defect family as R2
# (M7-REQUESTER-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS in
# runtime-role-lifecycle-registry.test.js) applied to createRootSourceBinding:
# its own post-write predicate re-check (confirmed by direct read, ~L2296-
# 2298) is fence-only (readClaudeAuthorityFence+.absent), never
# classifyClaudeAuthorityForIdentity -- a same-identity FOREIGN-FAMILY
# (one-shot) binding landing during the admission-to-write window is
# invisible to it. Calls createRootSourceBinding DIRECTLY (never through the
# SubagentStart hook, which always exits 0 fail-open regardless of the
# underlying result -- confirmed by direct read of
# subagent-start-context-bundle.js ~L697-700: a tryConsumeRootSourceReservation
# failure is reported to stderr only, exit code stays 0), reusing
# _m7_create_real_active_root_source_binding's own proven setup (root-source
# CLI -> Agent gate reservation) through the point of a genuine `action`,
# then consuming the reservation directly via
# rll.validateAndConsumeRootSourceReservation (the SAME call
# tryConsumeRootSourceReservation itself makes) to obtain the real
# {reservation, action} pair createRootSourceBinding needs -- mirrors R2's
# own direct-call structure exactly, adapted only for root-source's
# multi-step reservation chain. The cut-first sibling below is a CONTROL
# (already correctly denied today), included only to isolate the
# race-specific defect, exactly like R2's own cut-first sibling.

@test "M7-ROOT-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS RED (cut-first): a fully durable ONE-SHOT binding for the SAME identity landed BEFORE createRootSourceBinding is even attempted must deny the mint outright via the pre-admission classify+expected-ABSENT check -- this ordering is already correctly denied today; included as an isolating control for the admission-first race sibling below" {
  local session_id="m7-red-rootxfam-cutfirst-session" agent_id="m7-red-rootxfam-cutfirst-agent"
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-role-gate-retained-plane" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const lifecycleCli = process.argv[1];
    const agentGate = process.argv[4];
    const sessionId = process.argv[5];
    const agentId = process.argv[6];
    const retainedFixture = require(process.argv[7]);

    const intent = {
      source_role: "toolkit-specialist", reporting_architect: "arch-platform",
      question: "Inspect the bounded M7 RED root-source cut-first cross-family fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
    };
    const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("M7 ROOT-CUTFIRST PLAN missing"); process.exit(1); }
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!generation.ok || !main.ok) { process.stderr.write("M7 ROOT-CUTFIRST main authority setup failed"); process.exit(1); }
    retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
    const lifecycleGrant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
      "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
    );
    if (!lifecycleGrant.ok) { process.stderr.write("M7 ROOT-CUTFIRST missing root-source lifecycle admission: " + JSON.stringify(lifecycleGrant)); process.exit(1); }
    const cli = spawnSync(process.execPath, [
      lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
      "--lifecycle-binding", lifecycleGrant.grantId,
    ], { encoding: "utf8", env: process.env });
    let envelope;
    try { envelope = JSON.parse(cli.stdout); } catch { envelope = null; }
    if (cli.status !== 0 || !envelope || envelope.status !== "ACTION_REQUIRED"
      || !envelope.operation || envelope.operation.kind !== "root-source"
      || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
      process.stderr.write("M7 ROOT-CUTFIRST real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
      process.exit(1);
    }
    const action = envelope.actions[0];
    const p = action.payload;
    const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" });
    const gate = spawnSync(process.execPath, [agentGate], {
      input: JSON.stringify({
        tool_name: "Agent",
        tool_input: { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message },
        tool_use_id: "m7-root-cutfirst-tool-use-01", session_id: sessionId, agent_type: "", agent_id: "",
      }), encoding: "utf8", env: commonEnv,
    });
    let gateBody;
    try { gateBody = JSON.parse(gate.stdout); } catch { gateBody = null; }
    if (gate.status !== 0 || !gateBody || !gateBody.hookSpecificOutput || gateBody.hookSpecificOutput.permissionDecision !== "allow") {
      process.stderr.write("M7 ROOT-CUTFIRST Agent gate reservation failed: " + JSON.stringify({ status: gate.status, stdout: gate.stdout, stderr: gate.stderr }));
      process.exit(1);
    }

    const oneShotGen = rll.resolveSessionGeneration(projectRoot, { provider: "claude-hook", runtime_session_key: sessionId });
    if (!oneShotGen.ok) { process.stderr.write("M7 ROOT-CUTFIRST one-shot generation resolve failed: " + JSON.stringify(oneShotGen)); process.exit(1); }
    const oneShot = rll.createClaudeOneShotBinding(
      projectRoot, sessionId, oneShotGen.generationId, agentId, "toolkit-specialist",
      rll.generateActionId(), crypto.randomBytes(32).toString("hex"), crypto.randomBytes(32).toString("hex"),
      0, "toolkit-specialist", rll.computeWorktreeId(projectRoot), plan.planDigest, 600,
    );
    if (!oneShot.ok) { process.stderr.write("M7 ROOT-CUTFIRST competing one-shot bind failed: " + JSON.stringify(oneShot)); process.exit(1); }

    const lookup = rll.findLiveRootSourceReservationsForRole(projectRoot, "toolkit-specialist");
    if (!lookup.ok || lookup.reservations.length !== 1) { process.stderr.write("M7 ROOT-CUTFIRST reservation lookup failed: " + JSON.stringify(lookup)); process.exit(1); }
    const consumed = rll.validateAndConsumeRootSourceReservation(projectRoot, action.action_id, { runtimeSessionKey: sessionId, agentType: "toolkit-specialist" });
    if (!consumed.ok) { process.stderr.write("M7 ROOT-CUTFIRST reservation consume failed: " + JSON.stringify(consumed)); process.exit(1); }

    const denied = rll.createRootSourceBinding(projectRoot, consumed.reservation, consumed.action, { agentId, agentType: "toolkit-specialist" });
    const rootBindingsDir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
    let rootFiles = [];
    try { rootFiles = fs.readdirSync(rootBindingsDir); } catch (e) { /* absent is the expected zero-write outcome */ }
    process.stdout.write(JSON.stringify({ ok: denied.ok, reason: denied.reason || null, rootFileCount: rootFiles.length }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$AGENT_SPAWN_GATE_HOOK" "$session_id" "$agent_id" "$S16_RETAINED_FIXTURE"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":false'* ]]
  [[ "$output" == *'"reason":"authority-binding-conflict"'* ]]
  [[ "$output" == *'"rootFileCount":0'* ]]
}

@test "M7-ROOT-CREATE-RACE-CROSS-FAMILY-AMBIGUOUS RED (admission-first race): a same-identity ONE-SHOT binding landing DURING the window between createRootSourceBinding's own admission and its durable write must still deny the root-source mint via a post-write predicate re-check using the FULL cross-family classifier -- today createRootSourceBinding's post-write recheck is fence-only, never classifyClaudeAuthorityForIdentity, so a cross-family ambiguity landing in that window is invisible to it and the root-source mint wrongly reports success" {
  local session_id="m7-red-rootxfam-race-session" agent_id="m7-red-rootxfam-race-agent"
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-role-gate-retained-plane" node -e '
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const crypto = require("crypto");
    const { spawn, spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const lifecycleCli = process.argv[1];
    const agentGate = process.argv[4];
    const sessionId = process.argv[5];
    const agentId = process.argv[6];
    const retainedFixture = require(process.argv[7]);
    // Created via THIS process own os.tmpdir(), never a bash-side mktemp --
    // bats overrides TMPDIR to a per-test isolated subtree, and a dir minted
    // outside that exact subtree fails resolveSafeM7RendezvousDirs own
    // realpath-prefix check silently (testM7Rendezvous then no-ops with
    // zero I/O, per its own documented fail-closed-skip contract), mirroring
    // m7MakeRendezvousDir in runtime-role-lifecycle-registry.test.js exactly.
    const rendezvousDir = fs.mkdtempSync(path.join(os.tmpdir(), "m7-root-race-"));

    (async () => {
      const intent = {
        source_role: "toolkit-specialist", reporting_architect: "arch-platform",
        question: "Inspect the bounded M7 RED root-source admission-first cross-family race fixture and return the implementation review.",
        expected_result_kind: "IMPLEMENTATION_REVIEW",
      };
      const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
      const plan = rll.discoverPlan(projectRoot);
      if (!plan.ok) { process.stderr.write("M7 ROOT-RACE PLAN missing"); process.exit(1); }
      const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
      const generation = rll.resolveSessionGeneration(projectRoot, identity);
      const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
      if (!generation.ok || !main.ok) { process.stderr.write("M7 ROOT-RACE main authority setup failed"); process.exit(1); }
      retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
      const lifecycleGrant = rll.mintLifecycleCommandGrant(
        projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
        "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
      );
      if (!lifecycleGrant.ok) { process.stderr.write("M7 ROOT-RACE missing root-source lifecycle admission: " + JSON.stringify(lifecycleGrant)); process.exit(1); }
      const cli = spawnSync(process.execPath, [
        lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
        "--lifecycle-binding", lifecycleGrant.grantId,
      ], { encoding: "utf8", env: process.env });
      let envelope;
      try { envelope = JSON.parse(cli.stdout); } catch { envelope = null; }
      if (cli.status !== 0 || !envelope || envelope.status !== "ACTION_REQUIRED"
        || !envelope.operation || envelope.operation.kind !== "root-source"
        || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
        process.stderr.write("M7 ROOT-RACE real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
        process.exit(1);
      }
      const action = envelope.actions[0];
      const p = action.payload;
      const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" });
      const gate = spawnSync(process.execPath, [agentGate], {
        input: JSON.stringify({
          tool_name: "Agent",
          tool_input: { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message },
          tool_use_id: "m7-root-race-tool-use-01", session_id: sessionId, agent_type: "", agent_id: "",
        }), encoding: "utf8", env: commonEnv,
      });
      let gateBody;
      try { gateBody = JSON.parse(gate.stdout); } catch { gateBody = null; }
      if (gate.status !== 0 || !gateBody || !gateBody.hookSpecificOutput || gateBody.hookSpecificOutput.permissionDecision !== "allow") {
        process.stderr.write("M7 ROOT-RACE Agent gate reservation failed: " + JSON.stringify({ status: gate.status, stdout: gate.stdout, stderr: gate.stderr }));
        process.exit(1);
      }

      const lookup = rll.findLiveRootSourceReservationsForRole(projectRoot, "toolkit-specialist");
      if (!lookup.ok || lookup.reservations.length !== 1) { process.stderr.write("M7 ROOT-RACE reservation lookup failed: " + JSON.stringify(lookup)); process.exit(1); }
      const consumed = rll.validateAndConsumeRootSourceReservation(projectRoot, action.action_id, { runtimeSessionKey: sessionId, agentType: "toolkit-specialist" });
      if (!consumed.ok) { process.stderr.write("M7 ROOT-RACE reservation consume failed: " + JSON.stringify(consumed)); process.exit(1); }

      const stage = "create-after-admission-before-write";
      const readyPath = path.join(rendezvousDir, stage + ".ready");
      const goPath = path.join(rendezvousDir, stage + ".go");
      const childSource = [
        "const rll=require(process.argv[1]);",
        "const reservation=JSON.parse(process.argv[3]);",
        "const action=JSON.parse(process.argv[4]);",
        "const out=rll.createRootSourceBinding(process.argv[2],reservation,action,{agentId:process.argv[5],agentType:process.argv[6]});",
        "process.stdout.write(JSON.stringify(out));",
      ].join("");
      const childEnv = Object.assign({}, process.env, {
        RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY: process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY,
        NODE_ENV: "test",
        RUNTIME_M7_TEST_STAGE: stage,
        RUNTIME_M7_TEST_RENDEZVOUS_DIR: rendezvousDir,
      });
      // Never forward the parent-process-only fake-executor capability into
      // the raced child -- it exists solely for the establishRetainedCodexSupportPlane
      // call above, and its presence here is the one uncontrolled difference
      // from the already-proven requester-binding race harness
      // (m7DriveRendezvousRace in runtime-role-lifecycle-registry.test.js),
      // whose child never has it set at all.
      delete childEnv.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY;
      const child = spawn(process.execPath, [
        "-e", childSource, lifecycleCli, projectRoot,
        JSON.stringify(consumed.reservation), JSON.stringify(consumed.action), agentId, "toolkit-specialist",
      ], {
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      });
      let childStdout = ""; let childStderr = ""; let childExited = false; let childExitCode = null;
      child.stdout.on("data", (d) => { childStdout += d.toString("utf8"); });
      child.stderr.on("data", (d) => { childStderr += d.toString("utf8"); });
      child.on("close", (code) => { childExited = true; childExitCode = code; });

      const readyStart = Date.now();
      while (!fs.existsSync(readyPath)) {
        if (childExited) {
          process.stderr.write("M7 ROOT-RACE child exited BEFORE reaching ready (never paused): exitCode=" + childExitCode + " stdout=" + childStdout + " stderr=" + childStderr);
          process.exit(1);
        }
        if (Date.now() - readyStart > 5000) {
          child.kill("SIGKILL");
          process.stderr.write("M7 ROOT-RACE timed out waiting for ready: stdout=" + childStdout + " stderr=" + childStderr);
          process.exit(1);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const oneShotGen = rll.resolveSessionGeneration(projectRoot, { provider: "claude-hook", runtime_session_key: sessionId });
      if (!oneShotGen.ok) {
        child.kill("SIGKILL");
        process.stderr.write("M7 ROOT-RACE one-shot generation resolve failed: " + JSON.stringify(oneShotGen));
        process.exit(1);
      }
      const oneShot = rll.createClaudeOneShotBinding(
        projectRoot, sessionId, oneShotGen.generationId, agentId, "toolkit-specialist",
        rll.generateActionId(), crypto.randomBytes(32).toString("hex"), crypto.randomBytes(32).toString("hex"),
        0, "toolkit-specialist", rll.computeWorktreeId(projectRoot), plan.planDigest, 600,
      );
      if (!oneShot.ok) {
        child.kill("SIGKILL");
        process.stderr.write("M7 ROOT-RACE competing one-shot bind failed: " + JSON.stringify(oneShot));
        process.exit(1);
      }

      fs.writeFileSync(goPath, Buffer.from("go\n", "utf8"), { mode: 0o600, flag: "wx" });
      const exitCode = await new Promise((resolve) => child.on("close", resolve));

      const rootBindingsDir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
      const oneShotBindingsDir = path.join(rll.registryRepoDir(projectRoot), "claude-one-shot-bindings");
      let rootFiles = []; let oneShotFiles = [];
      try { rootFiles = fs.readdirSync(rootBindingsDir); } catch (e) { /* empty is a genuine failure below */ }
      try { oneShotFiles = fs.readdirSync(oneShotBindingsDir); } catch (e) { /* empty is a genuine failure below */ }

      if (exitCode !== 0) { process.stderr.write("M7 ROOT-RACE child exited nonzero: " + exitCode + " stderr=" + childStderr); process.exit(1); }
      let childOut;
      try { childOut = JSON.parse(childStdout); } catch (e) { process.stderr.write("M7 ROOT-RACE child stdout unparseable: " + childStdout + " stderr=" + childStderr); process.exit(1); }

      fs.rmSync(rendezvousDir, { recursive: true, force: true });
      process.stdout.write(JSON.stringify({
        childOk: childOut.ok, childReason: childOut.reason || null,
        rootFileCount: rootFiles.length, oneShotFileCount: oneShotFiles.length,
      }));
    })().catch((e) => { process.stderr.write("M7 ROOT-RACE threw: " + ((e && e.stack) || e)); process.exit(1); });
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$AGENT_SPAWN_GATE_HOOK" "$session_id" "$agent_id" "$S16_RETAINED_FIXTURE"
  [ "$status" -eq 0 ]
  # Fixture/race sanity FIRST, from filesystem counts embedded above --
  # proves BOTH families' writes genuinely landed before the semantic check.
  [[ "$output" == *'"rootFileCount":1'* ]]
  [[ "$output" == *'"oneShotFileCount":1'* ]]
  [[ "$output" == *'"childOk":false'* ]]
  [[ "$output" == *'"childReason":"authority-current-binding-ambiguous"'* ]]
}

# M7 RED 16 (M7-ROOT-TERMINAL-CUT-16). Team-lead-suggested lighter path: reuse
# _m7_create_real_active_root_source_binding for the binding (the ONLY step
# that genuinely needs the real hook/reservation chain), then publishRootIngress
# directly (a plain callable, never hook/CLI-gated -- confirmed by direct
# read), a real `cancel` CLI run through the SAME S16_RETAINED_FIXTURE wrapper
# already proven as a CLI-wrapper elsewhere (its own require.main===module
# self-execution path), and a direct mintRoleCommandGrant call to isolate
# EXACTLY the gap under test (never the full CLI, which could fail downstream
# for an unrelated reason and mask which layer the gap is actually in -- same
# isolation discipline as M7-LEGACY-V1-NONAUTH-04). No ack.json needed:
# M7 section 5's root-source family-proof condition is "neither ack.json NOR
# cancel.json exists" -- cancel alone proves the terminal-cut concept.
@test "M7-ROOT-TERMINAL-CUT-16 RED: mintRoleCommandGrant must deny a further grant against a root-source binding whose transaction is ALREADY, durably cancelled -- today it only checks ingress existence and before/after-ingress subcommand admission, never ack/cancel presence, and mints successfully" {
  local session_id="m7-red16-session" agent_id="m7-red16-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("RED-16 binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("RED-16 PLAN missing"); process.exit(1); }
    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    // A carrier request -- deliberately unrelated identity/role to the
    // root-source binding itself (publishRootIngress below only needs
    // shape-valid requestId/requestDigest, never that they correlate to a
    // caller-matching identity) -- exists purely so the real `cancel` CLI
    // command below has a genuine request.json to operate on.
    const intent = {
      target_role: "arch-platform",
      question: "M7 RED-16 carrier request for root-source ingress correlation",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("RED-16 carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    const requestId = publishedEnvelope.request_id;
    const requestPath = publishedEnvelope.artifact_ref;
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("RED-16 publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    const cancelled = spawnSync(process.execPath, [
      wrapper, "cancel", "--coordination-root", coordRoot, "--request", requestPath, "--reason", "explicit",
    ], { encoding: "utf8", env: process.env });
    let cancelledEnvelope;
    try { cancelledEnvelope = JSON.parse(cancelled.stdout); } catch { cancelledEnvelope = null; }
    if (cancelled.status !== 0 || !cancelledEnvelope || cancelledEnvelope.status !== "SUCCESS") {
      process.stderr.write("RED-16 carrier cancel failed: " + JSON.stringify({ status: cancelled.status, stdout: cancelled.stdout, stderr: cancelled.stderr }));
      process.exit(1);
    }

    // THE RED: mintRoleCommandGrant (requester authority, root-source binding)
    // must deny minting against an ALREADY-cancelled transaction -- today it
    // only checks ingress existence + before/after-ingress subcommand
    // membership + requestId correlation, never ack.json/cancel.json presence.
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(["--coordination-root", coordRoot, "--request", requestPath]));
    const grant = rll.mintRoleCommandGrant(projectRoot, binding, "requester", "cleanup", argvDigest, requestId, null, null);
    process.stdout.write(JSON.stringify({ ok: grant.ok, reason: grant.reason || null }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":false'* ]]
}

# M7 checklist item 10 (2026-08-17 correction pass), root-source half: RED-16
# above proves mintRoleCommandGrant denies once cancel.json genuinely exists.
# This proves the DIFFERENT axis on the SAME lines (runtime-role-lifecycle.cjs,
# the root-source branch inside mintRoleCommandGrant): `let terminalExists =
# false; try { terminalExists = fs.existsSync(api.ackPathFor(txnDir)) ||
# fs.existsSync(api.cancelPathFor(txnDir)); } catch (err) { terminalExists =
# false; }` swallows ANY genuine read error into the SAME outcome as genuine
# absence. Node fs.existsSync itself never throws (it internally swallows
# every stat error and returns false), so the bug is structural, not merely a
# bad catch block -- the try/catch cannot even be reached by an existsSync
# error; the defect is using existsSync at all for a check that must
# distinguish ENOENT from every other failure mode. Forces a genuine ENOTDIR
# (never ENOENT) by replacing txnDir itself with a plain file, mirroring
# claude-one-shot-binding-red.bats own COSB-SUBAGENTSTOP-ONESHOT-LOOKUP-ERROR-BLOCKS
# technique exactly (rename the real directory aside, plant a plain file at
# its path).
@test "M7-ROOT-TERMINAL-READ-ERROR-10 RED: mintRoleCommandGrant must fail closed when a genuine filesystem read error (ENOTDIR, never ENOENT) prevents verifying whether ack.json/cancel.json exist for a root-source binding own transaction directory -- today the error is silently swallowed into terminalExists=false (treated as absent) and the mint wrongly succeeds exactly as if no terminal existed at all" {
  local session_id="m7-red10-root-session" agent_id="m7-red10-root-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("RED-10-ROOT binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("RED-10-ROOT PLAN missing"); process.exit(1); }
    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    const intent = {
      target_role: "arch-platform",
      question: "M7 RED-10-ROOT carrier request for root-source ingress correlation",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("RED-10-ROOT carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    const requestId = publishedEnvelope.request_id;
    const requestPath = publishedEnvelope.artifact_ref;
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("RED-10-ROOT publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    // Positive control FIRST: real, accessible txnDir, genuinely no ack/cancel
    // yet -- mint must succeed cleanly, proving the fixture itself is valid
    // and the denial below is attributable to the injected read-error fault,
    // never a generally-broken setup.
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(["--coordination-root", coordRoot, "--request", requestPath]));
    const before = rll.mintRoleCommandGrant(projectRoot, binding, "requester", "cleanup", argvDigest, requestId, null, null);
    if (!before.ok) { process.stderr.write("RED-10-ROOT fixture sanity: an ordinary mint against a genuinely absent terminal must succeed: " + JSON.stringify(before)); process.exit(1); }

    // Fault injection: txnDir (which genuinely holds request.json on disk,
    // confirmed by the publish-request call above) is replaced with a plain
    // file -- forces ENOTDIR when mintRoleCommandGrant later
    // fs.existsSync-probes <txnDir>/ack.json and <txnDir>/cancel.json.
    const repoId = rll.computeRepoId(projectRoot);
    const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, "");
    const txnDir = path.join(coordRoot, repoId, waveSlug, binding.plan_digest, "transactions", requestId);
    if (!fs.statSync(txnDir).isDirectory()) { process.stderr.write("RED-10-ROOT fixture sanity: txnDir must genuinely be a real directory before the fault"); process.exit(1); }
    const realTxnDir = txnDir + "-real";
    fs.renameSync(txnDir, realTxnDir);
    fs.writeFileSync(txnDir, "not a directory");

    let after;
    try {
      after = rll.mintRoleCommandGrant(projectRoot, binding, "requester", "cleanup", argvDigest, requestId, null, null);
    } finally {
      fs.unlinkSync(txnDir);
      fs.renameSync(realTxnDir, txnDir);
    }
    process.stdout.write(JSON.stringify({ beforeOk: before.ok, afterOk: after.ok, afterReason: after.reason || null }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"beforeOk":true'* ]]
  [[ "$output" == *'"afterOk":false'* ]]
}

# M7 RED 20 (M7-ROOT-STATUS-V2). Resolved with team-lead across two passes --
# first hypothesis (a blocked-vs-accepted ack disposition mismatch) was ruled
# out by a full read of readRootSourceTerminalArtifacts (consultation.cjs
# ~7846): it DOES check ack disposition and throws CORRELATION_INVALID on a
# mismatch, which handleRootSourceStatus's own try/catch correctly folds into
# BLOCKED/DURABILITY_UNPROVEN -- that path is already correct today, so a
# fixture built on it would be vacuous. The REAL gap, found by a full read of
# handleRootSourceStatus's entire body (RLL ~7941-8014): its whole ready/
# READY-computation block only runs `if (!retirement.absent)` -- if NO
# retirement marker exists at all, execution falls through unconditionally to
# WAITING at the very end, regardless of whether a fully genuine, accepted,
# durable transaction (ack.json+accepted-result.json, both correlated)
# already exists. A retirement marker is written ONLY as a side-effect of
# transaction-ack/cancel being authorized via a ROOT-SOURCE-SCHEMA-SCOPED
# grant specifically (consultation.cjs ~8263-8287, gated on grantContext.
# bindingSchema === ROOT_SOURCE_BINDING_SCHEMA_LOCAL) -- the plain retained-
# support-plane grant this file's own S16_RETAINED_FIXTURE wrapper injects
# for every other command in this file is never root-source-scoped, so this
# fixture's own genuine, successful transaction chain (run entirely through
# that SAME plain wrapper, exactly like every non-root-source test already
# in this file) never triggers retirement -- proving the fixture is a
# faithful, non-contrived reproduction of the real gap, never a forced edge
# case. The positive control writes the SAME retirement marker shape the real
# dispatcher would have written (consultation.cjs's own exact call site),
# directly, to isolate EXACTLY this one gap -- same discipline as RED 4/16/17.
@test "M7-ROOT-STATUS-V2-20 RED: root-source-status must derive READY from the genuinely durable ack+accepted-result artifacts directly, not depend on a retirement marker that only exists as a side-effect of a root-source-scoped grant -- today a fully complete, accepted transaction authorized through a plain (non-root-source-scoped) grant leaves status stuck at WAITING forever" {
  local session_id="m7-red20-session" agent_id="m7-red20-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];
    const sessionId = process.argv[6];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("RED-20 binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;
    const actionId = binding.action_id;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("RED-20 PLAN missing"); process.exit(1); }
    // getOrCreateMainOrchestratorBindingForSession (unlike raw createMainOrchestratorBinding)
    // is this file/RLL own proven-idempotent re-derivation for the SAME live
    // session/worktree/PLAN -- safely re-resolves the SAME main binding the
    // shared fixture helper already minted, in this SEPARATE process, without
    // risking a second, conflicting MainOrchestratorBinding. Takes a raw
    // sessionId string directly (confirmed by direct read of its own test),
    // never an identity object.
    const mainBinding = rll.getOrCreateMainOrchestratorBindingForSession(projectRoot, sessionId, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!mainBinding.ok) { process.stderr.write("RED-20 main binding re-derivation failed: " + JSON.stringify(mainBinding)); process.exit(1); }

    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    // PIVOTED (team-lead, second correction): the claude-agent driver on the
    // dispatch command is UNCONDITIONALLY unavailable today by explicit,
    // documented design (dispatchCanonical ~10608-10627, an honest not-yet-
    // provable gap) -- NOT environment/settings.json-dependent as first
    // suspected. The CLI chain (root-init/publish-request/dispatch/claim/
    // publish-result/accept-result/transaction-ack) always falls through to
    // the frozen noop driver or fails for reasons entirely orthogonal to
    // what RED 20 targets. Per team-lead direction: construct the whole
    // transaction DIRECTLY instead (an established writeRawRequest-style
    // technique already used in runtime-consultation-cli.test.js, and RED
    // 18 own direct-cancel.json write, both in this same wave) -- request/
    // result/accepted-result/ack, each built to the EXACT closed schema
    // (CONSULT_V2_FIELDS/RESULT_V2_FIELDS/ACCEPTED_RESULT_V1_FIELDS/
    // ACK_V1_FIELDS, all confirmed by direct read of consultation.cjs
    // ~3260-4087) with every correlation field genuinely, mutually correct
    // -- never through the CLI at all, so the dispatch gap is fully
    // sidestepped. No claim.json is needed: validateResultV2 never opens or
    // cross-checks one against disk, only shape-checking claimant_instance_id/
    // claim_digest on the result record itself (confirmed by direct read).
    function writeDirectRecord(p, obj) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(obj), { mode: 0o600 });
      fs.chmodSync(p, 0o600);
    }

    const repoId = rll.computeRepoId(projectRoot);
    const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, "");
    const planDigest = plan.planDigest;
    const planRoot = path.join(coordRoot, repoId, waveSlug, planDigest);
    const requestId = crypto.randomBytes(32).toString("hex");
    const txnDir = path.join(planRoot, "transactions", requestId);
    const nowIso = new Date().toISOString();
    const expiryIso = new Date(Date.now() + 1800000).toISOString();
    const attemptId = crypto.randomBytes(32).toString("hex");
    // M6/M7 terminal functional closure correction round 1: target_role,
    // question, expected_result_kind, and requester_instance_id must each
    // equal the REAL root-source binding/action this fixture deliberately
    // reuses the publish authority of (per _m7_create_real_active_root_source_binding
    // own intent above: reporting_architect "arch-platform", the exact
    // question/expected_result_kind literals, actor_instance_id) -- point B/C
    // provenance correlation (resolveRootEvidenceAuthority, runtime-
    // consultation.cjs) now cross-validates every root-source-derived root
    // against its action own bootstrap-embedded intent field-by-field, so a
    // manually-built transaction attached to a real binding must genuinely
    // agree on all of them -- confirmed empirically (any mismatch produced
    // CORRELATION_INVALID, BLOCKED never READY).
    const targetRoleProfileDigest = rll.roleProfileDigestFor("arch-platform");
    const routingPolicyDigest = crypto.randomBytes(32).toString("hex");
    const subjectScopeDigest = crypto.randomBytes(32).toString("hex");
    const requesterInstanceId = binding.actor_instance_id;
    const subjectWorktreeId = rll.computeWorktreeId(projectRoot);
    const subjectHead = crypto.randomBytes(20).toString("hex");

    const requestObj = {
      schema: "coordination/consult/v2",
      request_id: requestId,
      root_request_id: requestId,
      parent_request_id: null,
      depth: 0,
      max_depth: 2,
      source_role: "toolkit-specialist",
      target_role: "arch-platform",
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: targetRoleProfileDigest,
      requester_worktree_id: subjectWorktreeId,
      requester_instance_id: requesterInstanceId,
      repo_id: repoId,
      wave_slug: waveSlug,
      protocol_profile: "runtime-consultation/v1",
      coordination_root_id: rll.computeCoordinationRootId(projectRoot),
      plan_digest: planDigest,
      subject_repo_id: repoId,
      subject_worktree_id: subjectWorktreeId,
      subject_head: subjectHead,
      subject_scope_digest: subjectScopeDigest,
      question: "Inspect the bounded M7 RED-02 active-binding fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: expiryIso,
      recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: routingPolicyDigest,
      initial_attempt_id: attemptId,
      initial_lease_epoch: 0,
      created_at: nowIso,
    };
    const requestPath = path.join(txnDir, "request.json");
    writeDirectRecord(requestPath, requestObj);
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("RED-20 publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    const resultObj = {
      schema: "coordination/result/v2",
      in_reply_to: requestId,
      request_digest: requestDigest,
      plan_digest: planDigest,
      repo_id: repoId,
      wave_slug: waveSlug,
      protocol_profile: "runtime-consultation/v1",
      max_depth: 2,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: routingPolicyDigest,
      root_request_id: requestId,
      parent_request_id: null,
      depth: 0,
      attempt_id: attemptId,
      lease_epoch: 0,
      driver: "test-fixture-driver",
      claimant_instance_id: crypto.randomBytes(32).toString("hex"),
      claim_digest: crypto.randomBytes(32).toString("hex"),
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: targetRoleProfileDigest,
      from_role: "arch-platform",
      to_role: "toolkit-specialist",
      result_kind: "IMPLEMENTATION_REVIEW",
      status: "ANSWERED",
      reason: null,
      content: "M7 RED-20 genuine direct-fixture result content",
      subject_repo_id: repoId,
      subject_worktree_id: subjectWorktreeId,
      subject_head: subjectHead,
      subject_scope_digest: subjectScopeDigest,
      consultation_dependencies: [],
      pattern_evidence_dependency: null,
      producer_worktree_id: subjectWorktreeId,
      producer_head: subjectHead,
      created_at: nowIso,
    };
    const resultPath = path.join(txnDir, "results", attemptId + ".json");
    writeDirectRecord(resultPath, resultObj);
    const resultDigest = crypto.createHash("sha256").update(fs.readFileSync(resultPath)).digest("hex");

    const acceptedObj = {
      schema: "coordination/accepted-result/v1",
      request_digest: requestDigest,
      candidate_result_path: "results/" + attemptId + ".json",
      result_digest: resultDigest,
      accepted_attempt_id: attemptId,
      accepted_lease_epoch: 0,
      routing_policy_digest: routingPolicyDigest,
      requester_instance_id: requesterInstanceId,
      accepted_at: nowIso,
      schema_version: 1,
    };
    const acceptedResultPath = path.join(txnDir, "accepted-result.json");
    writeDirectRecord(acceptedResultPath, acceptedObj);

    const ackObj = {
      schema: "coordination/ack/v1",
      disposition: "accepted",
      in_reply_to_attempt_id: attemptId,
      acked_at: nowIso,
    };
    const ackPath = path.join(txnDir, "ack.json");
    writeDirectRecord(ackPath, ackObj);

    function mintStatusGrantAndCheck() {
      const policyDigest = rc.sha256String("root-source-status:" + actionId);
      const statusGrant = rll.mintLifecycleCommandGrant(
        projectRoot, mainBinding.binding, policyDigest,
        "toolkit-specialist", "root-source-status", "main-orchestrator", "orchestrator", "normal", actionId,
      );
      if (!statusGrant.ok) { process.stderr.write("RED-20 status grant mint failed: " + JSON.stringify(statusGrant)); process.exit(1); }
      const res = spawnSync(process.execPath, [
        process.argv[1], "root-source-status", "--project-root", projectRoot, "--action", actionId, "--lifecycle-binding", statusGrant.grantId,
      ], { encoding: "utf8", env: process.env });
      let envelope;
      try { envelope = JSON.parse(res.stdout); } catch { envelope = null; }
      if (res.status !== 0 || !envelope) { process.stderr.write("RED-20 root-source-status failed: " + JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })); process.exit(1); }
      return envelope;
    }

    // Fixture sanity FIRST (part of the RED itself, not a separate check):
    // confirm the underlying transaction really did land as genuinely,
    // durably ACCEPTED before ever asking root-source-status about it.
    if (!fs.existsSync(acceptedResultPath)) { process.stderr.write("RED-20 fixture sanity: accepted-result.json must genuinely exist"); process.exit(1); }
    if (!fs.existsSync(ackPath)) { process.stderr.write("RED-20 fixture sanity: ack.json must genuinely exist"); process.exit(1); }

    // Post-GREEN simplification (team-lead delegated this call, confirmed
    // empirically before applying it): root-source-status now derives READY
    // directly from the durable ack+accepted-result artifacts regardless of
    // retirement-marker presence -- this test ITSELF now passes with zero
    // retirement marker involved, proving the original "positive control"
    // (retirement present -> READY) has become redundant with statusResult
    // below (no marker, real artifacts present -> also READY, for the exact
    // SAME reason). Preserving a call to rll.retireRootSourceBinding purely
    // to keep a now-redundant second assertion would also directly block
    // toolkit-specialist own removal of that function (contract section 11:
    // non-authoritative once nothing production-side depends on it). Kept
    // as a single, direct assertion -- this is effectively now a regression
    // guard (mirrors the guards 24/26/27/28/29 own "(RED)"-labelled-but-now-
    // passing precedent elsewhere in this wave: the label documents original
    // intent, never a live status requiring rename once GREEN lands).
    const statusResult = mintStatusGrantAndCheck();
    process.stdout.write(JSON.stringify({ statusResultStatus: statusResult.status }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id" "$session_id"
  [ "$status" -eq 0 ]
  # The M7 contract requires root-source-status to derive READY from the
  # genuinely durable ack+accepted-result artifacts DIRECTLY, with zero
  # retirement-marker involved anywhere in this fixture -- confirmed passing
  # empirically (GREEN has landed for this exact gap).
  [[ "$output" == *'"statusResultStatus":"READY"'* ]]
}

# M7 checklist item 10 (2026-08-17 correction pass), root-source-status half:
# handleRootSourceStatus (runtime-role-lifecycle.cjs) has TWO separate
# fs.existsSync try/catch probes on ack.json and cancel.json inside its
# `if (!ingress.absent)` branch: `try { ackExists = fs.existsSync(...); }
# catch (err) { ackExists = false; }` and the identical shape for
# cancelExists. A genuine read error on either probe is silently swallowed
# into false (treated as genuine absence), so the handler falls all the way
# through to the ordinary WAITING projection at the very end of the function
# -- exactly the "no terminal yet" outcome, even though the true state is
# unverifiable. Node's fs.existsSync itself never throws (it swallows every
# stat error internally and returns false), so this is a structural defect,
# not a bad catch block. Forces a genuine ENOTDIR by replacing the ingress
# request own txnDir with a plain file, same technique as the mint-grant RED
# above.
@test "M7-ROOT-STATUS-READ-ERROR-10 RED: root-source-status must fail closed (BLOCKED/DURABILITY_UNPROVEN) when a genuine filesystem read error (ENOTDIR, never ENOENT) prevents verifying whether ack.json/cancel.json exist for the ingress own transaction directory -- today the error on EITHER probe is silently swallowed into ackExists=false/cancelExists=false and status wrongly falls through to WAITING exactly as if no terminal existed at all" {
  local session_id="m7-red10-status-session" agent_id="m7-red10-status-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];
    const sessionId = process.argv[6];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("RED-10-STATUS binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;
    const actionId = binding.action_id;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("RED-10-STATUS PLAN missing"); process.exit(1); }
    const mainBinding = rll.getOrCreateMainOrchestratorBindingForSession(projectRoot, sessionId, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!mainBinding.ok) { process.stderr.write("RED-10-STATUS main binding re-derivation failed: " + JSON.stringify(mainBinding)); process.exit(1); }

    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    const intent = {
      target_role: "arch-platform",
      question: "M7 RED-10-STATUS carrier request for root-source ingress correlation",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("RED-10-STATUS carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    const requestId = publishedEnvelope.request_id;
    const requestPath = publishedEnvelope.artifact_ref;
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("RED-10-STATUS publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    function statusOnce() {
      const policyDigest = rc.sha256String("root-source-status:" + actionId);
      const statusGrant = rll.mintLifecycleCommandGrant(
        projectRoot, mainBinding.binding, policyDigest,
        "toolkit-specialist", "root-source-status", "main-orchestrator", "orchestrator", "normal", actionId,
      );
      if (!statusGrant.ok) { process.stderr.write("RED-10-STATUS status grant mint failed: " + JSON.stringify(statusGrant)); process.exit(1); }
      const res = spawnSync(process.execPath, [
        process.argv[1], "root-source-status", "--project-root", projectRoot, "--action", actionId, "--lifecycle-binding", statusGrant.grantId,
      ], { encoding: "utf8", env: process.env });
      let envelope;
      try { envelope = JSON.parse(res.stdout); } catch { envelope = null; }
      if (res.status !== 0 || !envelope) { process.stderr.write("RED-10-STATUS root-source-status failed: " + JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })); process.exit(1); }
      return envelope;
    }

    // Positive control FIRST: real, accessible txnDir, genuinely no ack/cancel
    // yet -- status must report the ordinary WAITING projection, proving the
    // fixture itself is valid and the fail-closed denial below is
    // attributable to the injected read-error fault, never a
    // generally-broken setup.
    const before = statusOnce();
    if (before.status !== "WAITING") { process.stderr.write("RED-10-STATUS fixture sanity: expected WAITING before the fault, got: " + JSON.stringify(before)); process.exit(1); }

    // Fault injection: txnDir (which genuinely holds request.json on disk) is
    // replaced with a plain file -- forces ENOTDIR when handleRootSourceStatus
    // later fs.existsSync-probes <txnDir>/ack.json and <txnDir>/cancel.json
    // (two SEPARATE try/catch blocks, both must be shown to fail closed).
    const repoId = rll.computeRepoId(projectRoot);
    const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, "");
    const txnDir = path.join(coordRoot, repoId, waveSlug, binding.plan_digest, "transactions", requestId);
    if (!fs.statSync(txnDir).isDirectory()) { process.stderr.write("RED-10-STATUS fixture sanity: txnDir must genuinely be a real directory before the fault"); process.exit(1); }
    const realTxnDir = txnDir + "-real";
    fs.renameSync(txnDir, realTxnDir);
    fs.writeFileSync(txnDir, "not a directory");

    let after;
    try {
      after = statusOnce();
    } finally {
      fs.unlinkSync(txnDir);
      fs.renameSync(realTxnDir, txnDir);
    }
    process.stdout.write(JSON.stringify({ beforeStatus: before.status, afterStatus: after.status, afterDetailCode: after.detail_code || null }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id" "$session_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"beforeStatus":"WAITING"'* ]]
  [[ "$output" == *'"afterStatus":"BLOCKED"'* ]]
  [[ "$output" == *'"afterDetailCode":"DURABILITY_UNPROVEN"'* ]]
}

# M7 checklist item 12 (2026-08-17 correction pass): M7 contract section 9
# closing paragraph -- "a read-only root-source-status invocation... does not
# require action.session_generation_id to equal the current generation...
# so an old-generation binding can reach the generation-cut row above and
# project BLOCKED; no create, grant, or mutating command receives this
# exception." Confirmed by direct read of handleRootSourceStatus
# (runtime-role-lifecycle.cjs): its own context-resolution gate unconditionally
# requires `action.session_generation_id === context.generation.generationId`,
# rejecting IDENTITY_MISMATCH BEFORE ever reaching the later
# WAITING/BLOCKED/READY projection logic -- this is the one existing handler
# equality gate section 9 says must be removed only for this read-only
# command. Rotates the SAME orchestrator session own generation between
# action-mint time and the status call, same technique as
# claude-one-shot-binding-red.bats own COSB-E2E-GENERATION-ROTATION-REJECTED-ZERO-BINDING
# (expire the live generation record directly, then resolveSessionGeneration
# mints a genuinely fresh, live G2 in its place).
#
# SCOPE WARNING for whoever implements GREEN, confirmed jointly with
# team-lead (2026-08-17): deleting the L8455-8456 action-level equality gate
# ALONE does not make this test pass. findRootSourceBindingsByAction
# (~L2409-2425) resolves candidate bindings via validateRootSourceBindingRecord
# (~L2282-2298), which is PURELY STRUCTURAL -- schema/key-set/hex-format/
# timestamp-ordering only. It never compares the binding own expiry against
# the current clock and never compares the binding own session_generation_id
# against the current live generation, so it returns ANY structurally-valid
# binding for the action_id regardless of staleness. With only the two-line
# gate removed, execution would fall through past the binding lookup (~L8465,
# the G1 binding is still found) straight into the ordinary
# ingress/WAITING projection -- never reaching a BLOCKED/NONE result at all.
# The correct fix therefore also needs a NEW binding-level generation/expiry
# cut somewhere after the binding lookup, which is what actually makes the
# contract section 9 table row ("structurally valid v2 binding but expiry/
# generation cut -> BLOCKED/NONE, zero writes") hold. This test still asserts
# exactly that CORRECT target outcome -- it is the toolkit-specialist own
# implementation problem to add the missing binding-level check, not a sign
# this test is wrong.
#
# Also note: the lifecycle-binding grant for BOTH status calls below is
# minted through the REAL context-provider-gate.js hook (_make_input +
# _run_cp_hook + _extract_injected lifecycle-binding, empty agent_type since
# root-source-status is main-orchestrator-gated) rather than a direct
# mintLifecycleCommandGrant call -- mirrors S16-ROOT-SOURCE-STATUS-WAITING-
# REQUEST-REF-01 and S16-ROOT-SOURCE-TAMPER-01's own established two-call
# pattern exactly (team-lead direction, 2026-08-17), each call minting its
# own fresh one-time-use grant. The positive control genuinely, independently
# succeeds (WAITING) before rotation is ever attempted.
@test "M7-ROOT-STATUS-OLD-GENERATION-V2-12 RED: a read-only root-source-status invocation for an action minted under an old, now-superseded session generation must NOT be rejected IDENTITY_MISMATCH -- it must instead reach the generation-cut projection and report BLOCKED/NONE, with the root-source binding own authority record left completely unwritten. Today the handler own unconditional action.session_generation_id-vs-current-generation equality check rejects it at the very top, before ever reaching that row" {
  local session_id="m7-red12-oldgen-session" agent_id="m7-red12-oldgen-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  local action_id
  action_id="$(node -e '
    const rll = require(process.argv[1]);
    const b = rll.readRegistryRecord(rll.rootSourceBindingPathFor(process.argv[2], process.argv[3]));
    if (!b.ok || b.absent) { process.stderr.write("binding missing"); process.exit(1); }
    process.stdout.write(b.obj.action_id);
  ' "$RLL_IMPL" "$PROJ" "$binding_id")"
  [ -n "$action_id" ]

  local g1_generation_id
  g1_generation_id="$(node -e '
    const rll = require(process.argv[1]);
    const a = rll.findActionDirect(process.argv[2], process.argv[3]);
    if (!a.ok || a.absent) { process.stderr.write("action missing"); process.exit(1); }
    if (typeof a.action.session_generation_id !== "string" || a.action.session_generation_id.length === 0) { process.stderr.write("fixture sanity: action must carry a genuine session_generation_id"); process.exit(1); }
    process.stdout.write(a.action.session_generation_id);
  ' "$RLL_IMPL" "$PROJ" "$action_id")"
  [ -n "$g1_generation_id" ]

  local binding_path
  binding_path="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.rootSourceBindingPathFor(process.argv[2],process.argv[3]));' "$RLL_IMPL" "$PROJ" "$binding_id")"
  local binding_hash_before
  binding_hash_before="$(node -e 'const c=require("crypto");const fs=require("fs");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$binding_path")"

  # Positive control FIRST: status against the SAME still-live generation
  # (G1, unrotated), grant minted through the real hook -- must succeed
  # cleanly (WAITING -- no ingress yet), proving the fixture/binding/action
  # itself is genuinely valid before rotation, and that any denial after
  # rotation is attributable to the generation cut specifically.
  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local status_grant_1; status_grant_1="$(_extract_injected lifecycle-binding)"
  [ -n "$status_grant_1" ]
  run env NODE_ENV=test node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id" --lifecycle-binding "$status_grant_1"
  [ "$status" -eq 0 ]
  node -e 'const e = JSON.parse(process.argv[1]); if (e.status !== "WAITING" || e.detail_code !== "NONE") { process.stderr.write("RED-12 fixture sanity: expected WAITING/NONE before rotation, got: " + process.argv[1]); process.exit(1); }' "$output"

  # Rotate G1 -> a genuinely live G2 for the IDENTICAL orchestrator session --
  # same technique as claude-one-shot-binding-red.bats own
  # COSB-E2E-GENERATION-ROTATION-REJECTED-ZERO-BINDING (expire the live
  # generation record directly, then resolveSessionGeneration mints a
  # genuinely fresh, live G2 in its place).
  run node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const projectRoot = process.argv[2];
    const identity = { provider: "claude-hook", runtime_session_key: process.argv[3] };
    const genPath = rll.sessionGenerationPathFor(projectRoot, identity);
    const genRec = JSON.parse(fs.readFileSync(genPath, "utf8"));
    if (genRec.generation_id !== process.argv[4]) { process.stderr.write("fixture sanity: the live generation record must equal G1 (the action generation) before rotation"); process.exit(1); }
    genRec.expires_at = "2000-01-01T00:00:00Z";
    fs.writeFileSync(genPath, JSON.stringify(genRec));
    const rotated = rll.resolveSessionGeneration(projectRoot, identity);
    if (!rotated.ok) { process.stderr.write("G2 mint failed: " + JSON.stringify(rotated)); process.exit(1); }
    if (rotated.generationId === process.argv[4]) { process.stderr.write("fixture sanity: G2 must genuinely differ from G1"); process.exit(1); }
    process.stdout.write(rotated.generationId);
  ' "$RLL_IMPL" "$PROJ" "$session_id" "$g1_generation_id"
  [ "$status" -eq 0 ]
  local g2_generation_id="$output"
  [ -n "$g2_generation_id" ]
  [ "$g2_generation_id" != "$g1_generation_id" ]

  # The action itself genuinely still carries G1 (never silently updated by
  # the rotation) -- isolates "the action is stale" from "the action was
  # somehow mutated along with the generation".
  run node -e '
    const rll = require(process.argv[1]);
    const a = rll.findActionDirect(process.argv[2], process.argv[3]);
    if (!a.ok || a.absent || a.action.session_generation_id !== process.argv[4]) { process.stderr.write("action session_generation_id must remain G1, untouched by rotation: " + JSON.stringify(a)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJ" "$action_id" "$g1_generation_id"
  [ "$status" -eq 0 ]

  # After rotation: the SAME read-only status call, a fresh one-time-use
  # grant minted through the real hook again, must NOT be rejected
  # IDENTITY_MISMATCH -- it must reach the generation-cut projection and
  # report BLOCKED/NONE, with the root-source binding own authority record
  # left completely unwritten.
  local status_cmd2; status_cmd2="$(_render_posix_direct node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id")"
  _make_input "$status_cmd2" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local status_grant_2; status_grant_2="$(_extract_injected lifecycle-binding)"
  [ -n "$status_grant_2" ]
  run env NODE_ENV=test node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$action_id" --lifecycle-binding "$status_grant_2"
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.detail_code === "IDENTITY_MISMATCH") { process.stderr.write("M7 section 9: an old-generation binding must reach the generation-cut projection, never be rejected IDENTITY_MISMATCH at the top-level action-generation gate: " + JSON.stringify(e)); process.exit(1); }
    if (e.status !== "BLOCKED" || e.detail_code !== "NONE") { process.stderr.write("expected BLOCKED/NONE, got: " + JSON.stringify(e)); process.exit(1); }
  ' "$output"

  local binding_hash_after
  binding_hash_after="$(node -e 'const c=require("crypto");const fs=require("fs");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$binding_path")"
  [ "$binding_hash_before" = "$binding_hash_after" ]
}

# M7 checklist item 12 (2026-08-17 correction pass), CANCELLED coverage gap:
# team-lead grepped this file plus registry.test.js/consultation-cli.test.js
# for any root-source-status test touching the CANCELLED state and found
# zero matches -- S16-ROOT-SOURCE-STATUS-WAITING-REQUEST-REF-01 (this file,
# ~L3381-3411) already genuinely covers OPEN/WAITING (real E2E through the CP
# gate, ingress durable, no ack/cancel yet) and S16-ROOT-SOURCE-TAMPER-01
# (this file, ~L3413 onward) already genuinely covers ACKED/READY (full real
# E2E chain through transaction-ack, positive-controlled before its own
# tamper half) -- neither is duplicated here. This closes the third state:
# M7 section 9 table row "ingress + valid cancel -> BLOCKED/NONE with
# request/result-if-present/cancel refs/digests", and the mapping section 9
# names explicitly ("CANCELLED -> BLOCKED"). Confirmed by direct read of
# handleRootSourceStatus (runtime-role-lifecycle.cjs ~L8495-8514): once
# ingress is durable and cancelExists is true (ackExists false), `reason`
# becomes 'cancelled', `ready` becomes false, and -- provided
# readRootSourceTerminalArtifacts resolves a well-formed terminal whose
# requestDigest correlates -- the handler emits exactly BLOCKED/NONE (the
# ready-only accepted-result null-check is skipped for the non-ready path).
# Mirrors RED-16 own cancel step (real carrier publish-request +
# publishRootIngress + a real `cancel` CLI call through the retained-plane
# wrapper) combined with this file own root-source-status-calling convention
# (mainBinding re-derivation + a fresh lifecycle-command-grant per call).
@test "M7-ROOT-SOURCE-STATUS-CANCELLED-12: root-source-status must report BLOCKED/NONE once ingress is durable and the transaction has been genuinely, durably cancelled -- fills the CANCELLED gap in this file own OPEN/ACKED coverage (S16-ROOT-SOURCE-STATUS-WAITING-REQUEST-REF-01/S16-ROOT-SOURCE-TAMPER-01), never duplicating either" {
  local session_id="m7-cancelled-status-session" agent_id="m7-cancelled-status-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];
    const sessionId = process.argv[6];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("CANCELLED-12 binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;
    const actionId = binding.action_id;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("CANCELLED-12 PLAN missing"); process.exit(1); }
    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");
    const mainBinding = rll.getOrCreateMainOrchestratorBindingForSession(projectRoot, sessionId, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!mainBinding.ok) { process.stderr.write("CANCELLED-12 main binding re-derivation failed: " + JSON.stringify(mainBinding)); process.exit(1); }

    const intent = {
      target_role: "arch-platform",
      question: "M7 CANCELLED-12 carrier request for root-source ingress correlation",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("CANCELLED-12 carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    const requestId = publishedEnvelope.request_id;
    const requestPath = publishedEnvelope.artifact_ref;
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("CANCELLED-12 publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    function statusOnce() {
      const policyDigest = rc.sha256String("root-source-status:" + actionId);
      const statusGrant = rll.mintLifecycleCommandGrant(
        projectRoot, mainBinding.binding, policyDigest,
        "toolkit-specialist", "root-source-status", "main-orchestrator", "orchestrator", "normal", actionId,
      );
      if (!statusGrant.ok) { process.stderr.write("CANCELLED-12 status grant mint failed: " + JSON.stringify(statusGrant)); process.exit(1); }
      const res = spawnSync(process.execPath, [
        process.argv[1], "root-source-status", "--project-root", projectRoot, "--action", actionId, "--lifecycle-binding", statusGrant.grantId,
      ], { encoding: "utf8", env: process.env });
      let envelope;
      try { envelope = JSON.parse(res.stdout); } catch { envelope = null; }
      if (res.status !== 0 || !envelope) { process.stderr.write("CANCELLED-12 root-source-status failed: " + JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })); process.exit(1); }
      return envelope;
    }

    // Positive control FIRST: ingress durable, no terminal yet -- WAITING,
    // proving the fixture itself is valid before cancellation.
    const before = statusOnce();
    if (before.status !== "WAITING") { process.stderr.write("CANCELLED-12 fixture sanity: expected WAITING before cancel, got: " + JSON.stringify(before)); process.exit(1); }

    const cancelled = spawnSync(process.execPath, [
      wrapper, "cancel", "--coordination-root", coordRoot, "--request", requestPath, "--reason", "explicit",
    ], { encoding: "utf8", env: process.env });
    let cancelledEnvelope;
    try { cancelledEnvelope = JSON.parse(cancelled.stdout); } catch { cancelledEnvelope = null; }
    if (cancelled.status !== 0 || !cancelledEnvelope || cancelledEnvelope.status !== "SUCCESS") {
      process.stderr.write("CANCELLED-12 real cancel failed: " + JSON.stringify({ status: cancelled.status, stdout: cancelled.stdout, stderr: cancelled.stderr }));
      process.exit(1);
    }

    const after = statusOnce();
    process.stdout.write(JSON.stringify({
      beforeStatus: before.status, afterStatus: after.status, afterDetailCode: after.detail_code || null,
      afterRequestId: (after.operation && after.operation.request_id) || null,
      afterOperation: after.operation || null,
    }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id" "$session_id"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"beforeStatus":"WAITING"'* ]]
  [[ "$output" == *'"afterStatus":"BLOCKED"'* ]]
  [[ "$output" == *'"afterDetailCode":"NONE"'* ]]

  # M7 FINAL CORRECTION (test-specialist, batch 2 of 3, R9 -- extends this
  # pre-existing BLOCKED/NONE-only coverage, which would already pass
  # unconditionally today and does not by itself prove the real gap):
  # readRootSourceTerminalArtifacts (runtime-consultation.cjs) reuses
  # ack_ref/ack_digest for the cancel.json ref/digest inside its own
  # CANCELLED branch (confirmed by direct read: 'ackRef =
  # path.posix.join(...,"cancel.json"); ackDigest = cancelRec.digest;', no
  # separate cancel_ref/cancel_digest concept exists at that layer at all),
  # and OPERATION_KEYS/makeOperation (runtime-role-lifecycle.cjs) have no
  # cancel_ref/cancel_digest members either -- so a CANCELLED status wrongly
  # reports the cancel's own data under ack_ref/ack_digest and can never
  # expose cancel_ref/cancel_digest under any name.
  run node -e '
    const data = JSON.parse(process.argv[1]);
    const op = data.afterOperation || {};
    const errors = [];
    if (op.ack_ref !== null) errors.push("ack_ref must be null for CANCELLED, got: " + JSON.stringify(op.ack_ref));
    if (op.ack_digest !== null) errors.push("ack_digest must be null for CANCELLED, got: " + JSON.stringify(op.ack_digest));
    if (op.accepted_result_ref !== null || op.accepted_result_digest !== null) errors.push("accepted_result fields must both be null: " + JSON.stringify({ ref: op.accepted_result_ref, digest: op.accepted_result_digest }));
    if (op.result_ref !== null || op.result_digest !== null) errors.push("result fields must both be null (no result was ever published in this fixture): " + JSON.stringify({ ref: op.result_ref, digest: op.result_digest }));
    if (typeof op.request_ref !== "string" || typeof op.request_digest !== "string") errors.push("request_ref/request_digest must be populated: " + JSON.stringify({ ref: op.request_ref, digest: op.request_digest }));
    if (typeof op.cancel_ref !== "string" || !op.cancel_ref.endsWith("/cancel.json")) errors.push("cancel_ref must be the exact coordination-relative cancel.json ref, got: " + JSON.stringify(op.cancel_ref));
    if (typeof op.cancel_digest !== "string" || op.cancel_digest.length !== 64) errors.push("cancel_digest must be a 64-hex fd-bound digest, got: " + JSON.stringify(op.cancel_digest));
    const expectedKeys = ["accepted_result_digest","accepted_result_ref","ack_digest","ack_ref","cancel_digest","cancel_ref","kind","operation_id","request_digest","request_id","request_ref","result_digest","result_ref","state"];
    const actualKeys = Object.keys(op).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) errors.push("operation key set mismatch -- expected exactly " + JSON.stringify(expectedKeys) + ", got " + JSON.stringify(actualKeys));
    if (errors.length > 0) {
      process.stderr.write("M7 R9 CANCELLED ABI violations:\n" + errors.join("\n") + "\nfull operation: " + JSON.stringify(op));
      process.exit(1);
    }
  ' "$output"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 CORRECTION defect 9 (M7-SUPERSEDED-RESOLVER-*): section 6 requires every
# hook-local/consultation-local per-family binding scanner be replaced by the
# ONE canonical classifyClaudeAuthorityForIdentity -- "Hook-local and
# consultation-local binding/retirement scanners are removed." Confirmed by
# direct read (2026-08-17): resolveArchitectRequesterBinding
# (context-provider-gate.js, called from tryInjectRequesterGrant's
# root-source branch) still exists and still scans requester-bindings/
# directly; resolveRootSourceBindingForHook (runtime-role-lifecycle.cjs,
# called from context-provider-gate.js) still exists and is still called;
# findLiveClaudeOneShotBindings (runtime-consultation-target-gate.js, used by
# handleConsultationTargetOwning's claude-agent branch) still exists and is
# still called; requesterBindingNamespaceAbsent/rootSourceBindingNamespaceAbsent
# (runtime-consultation.cjs, used inside validateRoleCommandGrantOrThrow's
# requester-authority branch) still exist and still implement a bespoke
# dual-family-probe instead of clean namespace discrimination. The four
# structural tests below mirror this codebase's own established
# "must-be-genuinely-absent" technique (runtime-consultation-cli.test.js's own
# M7-DUPLICATE-LOCAL-REMOVAL-22, and guards 27/29 in
# runtime-role-lifecycle-registry.test.js) -- a single whole-source substring
# check proves BOTH the definition AND every call site are gone in one pass.
#
# DISCLOSED FINDING (not silently omitted): a companion behavioral test was
# attempted here -- a session/agent identity holding BOTH a live root-source
# binding AND a live one-shot binding, driven through a real root-init call,
# expecting context-provider-gate.js's own resolveRootSourceBindingForHook
# success path (which checks ambiguity against ONLY a persistent
# RequesterBinding via resolveArchitectRequesterBinding, never the one-shot
# family) to let it through. Empirically, it does NOT: the call is correctly
# denied today, with reason "...authority-current-binding-ambiguous" -- but
# NOT via resolveArchitectRequesterBinding at all. It is caught downstream,
# inside rll.mintRoleCommandGrant's own admitClaudeAuthorityOperation('mint-
# grant',...) call, which already runs the full classifyClaudeAuthorityForIdentity
# scan (confirmed by direct trace: the returned denial reason is literally the
# classifier's own authority-current-binding-ambiguous, propagated through
# "[Sixteenth/root-source] unable to mint the exact phase-scoped requester
# grant: authority-current-binding-ambiguous"). That downstream admission call
# is a genuine, already-correct safety net for THIS specific path (root-source
# admin subcommands, and by the identical mechanism, target-gate's
# claude-agent branch) -- so a test asserting today's code fails here would
# itself be dishonest (it does not fail). This is reported to team-lead/
# arch-testing rather than kept as a test that passes for the wrong reason:
# the observable, currently-exploitable consequence of the four superseded
# resolvers above is narrower than "hooks let cross-family ambiguity through"
# -- it is the architectural duplication/redundancy section 6 names
# ("Hook-local and consultation-local binding/retirement scanners are
# removed"), proven by the four structural tests, not a live security gap on
# this specific admin-subcommand path.
# ══════════════════════════════════════════════════════════════════════════

@test "M7-SUPERSEDED-RESOLVER-ABSENT-ARCHITECT-BINDING: resolveArchitectRequesterBinding must be genuinely ABSENT from context-provider-gate.js -- M7 section 6 requires every per-family resolver be replaced by the ONE canonical classifyClaudeAuthorityForIdentity; today this hook-local scanner still exists and is still called" {
  run node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    process.exit(src.includes("resolveArchitectRequesterBinding") ? 1 : 0);
  ' "$CP_GATE_HOOK"
  [ "$status" -eq 0 ]
}

@test "M7-SUPERSEDED-RESOLVER-ABSENT-ROOT-SOURCE-HOOK: resolveRootSourceBindingForHook must be genuinely ABSENT from runtime-role-lifecycle.cjs -- M7 section 6 requires the classifier replace every per-family resolver; today this hook-local scanner still exists and is still called from context-provider-gate.js" {
  run node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    process.exit(src.includes("resolveRootSourceBindingForHook") ? 1 : 0);
  ' "$RLL_IMPL"
  [ "$status" -eq 0 ]
}

@test "M7-SUPERSEDED-RESOLVER-ABSENT-ONESHOT-TARGET-GATE: findLiveClaudeOneShotBindings must be genuinely ABSENT from runtime-consultation-target-gate.js for the claude-agent activation path -- M7 section 6 requires the classifier replace it (the RoleActor resolver stays for non-Claude drivers)" {
  run node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    process.exit(src.includes("findLiveClaudeOneShotBindings") ? 1 : 0);
  ' "$HOOK"
  [ "$status" -eq 0 ]
}

@test "M7-SUPERSEDED-RESOLVER-ABSENT-NAMESPACE-DUAL-PROBE: requesterBindingNamespaceAbsent/rootSourceBindingNamespaceAbsent must be genuinely ABSENT from runtime-consultation.cjs -- M7 section 6 requires clean namespace discrimination (exactly one namespace present; malformed or both present: deny) instead of this dual-family-probe fallback" {
  run node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    process.exit((src.includes("requesterBindingNamespaceAbsent") || src.includes("rootSourceBindingNamespaceAbsent")) ? 1 : 0);
  ' "$CONSULTATION_CLI"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL CORRECTION (test-specialist, batch 2 of 3, R9/R10):
# handleRootSourceStatus (runtime-role-lifecycle.cjs:8530-8624, located with
# team-lead). Reuses _m7_create_real_active_root_source_binding above for the
# binding (the only step that genuinely needs the real hook/reservation
# chain) plus RED-16's own carrier-request + publishRootIngress pattern,
# never hand-rolled action/reservation records.
# ══════════════════════════════════════════════════════════════════════════

# Publishes a real carrier request (through the S16_RETAINED_FIXTURE wrapper,
# mirrors RED-16's own pattern exactly) and correlates it to `binding_id`'s
# root-source binding via publishRootIngress (a plain callable, never hook/
# CLI-gated). Prints "<request_id> <request_path>".
_m7_publish_carrier_and_ingress_for_root_source() {
  local binding_id="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const wrapper = process.argv[4];
    const bindingId = process.argv[5];

    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("R9/R10 fixture: binding missing: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("R9/R10 fixture: PLAN missing"); process.exit(1); }
    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    const intent = {
      target_role: "arch-platform",
      question: "M7 R9/R10 carrier request for root-source ingress correlation",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("R9/R10 fixture: carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    const requestId = publishedEnvelope.request_id;
    const requestPath = publishedEnvelope.artifact_ref;
    const requestDigest = crypto.createHash("sha256").update(fs.readFileSync(requestPath)).digest("hex");

    const ingress = rll.publishRootIngress(projectRoot, binding, { requestId, requestDigest });
    if (!ingress.ok) { process.stderr.write("R9/R10 fixture: publishRootIngress failed: " + JSON.stringify(ingress)); process.exit(1); }

    process.stdout.write(requestId + " " + requestPath);
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$S16_RETAINED_FIXTURE" "$binding_id"
}

# Mints a fresh lifecycle-command-grant for root-source-status (main-
# orchestrator/orchestrator/normal profile, actionId required -- confirmed
# against the GRANT_AUTHORITY_FOR_BINDING_KIND/GRANT_ACTION_ID_REQUIRED_
# SUBCOMMANDS tables) and calls the REAL root-source-status CLI. Prints one
# JSON line: {"status":<exit code>,"stdout":<raw stdout>,"stderr":<raw
# stderr>}.
_m7_call_root_source_status() {
  local action_id="$1" session_id="$2"
  node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const { spawnSync } = require("child_process");
    const lifecycleCli = process.argv[1];
    const projectRoot = process.argv[3];
    const actionId = process.argv[4];
    const sessionId = process.argv[5];

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("R9/R10 fixture: PLAN missing"); process.exit(1); }
    // Pre-existing bug fix (found independently by toolkit-specialist during
    // the original GREEN phase, and again here): the raw createMainOrchestratorBinding
    // mints a BRAND NEW binding on every call, never reusing the live one for
    // the SAME session -- structurally incompatible with a status helper this
    // file calls repeatedly against the identical live session and expects
    // stable/minimal registry deltas across calls. getOrCreateMainOrchestratorBindingForSession
    // (this codebase own proven-idempotent re-derivation, RED-20 precedent,
    // runtime-role-lifecycle-registry.test.js) takes the raw sessionId string
    // directly, never an identity object.
    const main = rll.getOrCreateMainOrchestratorBindingForSession(projectRoot, sessionId, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!main.ok) { process.stderr.write("R9/R10 fixture: main-orchestrator binding failed: " + JSON.stringify(main)); process.exit(1); }
    const argvDigest = rc.sha256String("root-source-status:" + actionId);
    const grant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, argvDigest, "toolkit-specialist", "root-source-status",
      "main-orchestrator", "orchestrator", "normal", actionId,
    );
    if (!grant.ok) { process.stderr.write("R9/R10 fixture: root-source-status lifecycle grant failed: " + JSON.stringify(grant)); process.exit(1); }

    const result = spawnSync(process.execPath, [
      lifecycleCli, "root-source-status", "--project-root", projectRoot, "--action", actionId,
      "--lifecycle-binding", grant.grantId,
    ], { encoding: "utf8", env: process.env });
    process.stdout.write(JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr }));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$action_id" "$session_id"
}

@test "M7-ROOT-STATUS-FENCE-OPEN-BLOCKED (RED): root-source-status for a live v2 binding with no transaction terminal must project BLOCKED/NONE once the actor's own identity fence is durably published -- today handleRootSourceStatus has zero fence-awareness (confirmed by direct read of the full 8530-8624 body: no readClaudeAuthorityFence call anywhere), so status keeps projecting the SAME pre-fence WAITING/NONE both before and after, and the fence-publish call itself is the ONLY registry write across both status calls" {
  local session_id="m7-red10-session" agent_id="m7-red10-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  local carrier
  carrier="$(_m7_publish_carrier_and_ingress_for_root_source "$binding_id")"
  local request_id request_path
  read -r request_id request_path <<< "$carrier"
  [ -n "$request_id" ]

  local binding_action_id
  binding_action_id="$(node -e '
    const rll = require(process.argv[1]);
    const rec = JSON.parse(require("fs").readFileSync(rll.rootSourceBindingPathFor(process.argv[2], process.argv[3]), "utf8"));
    process.stdout.write(rec.action_id);
  ' "$RLL_IMPL" "$PROJ" "$binding_id")"
  [ -n "$binding_action_id" ]

  # Fixture sanity (this test's own header comment requires verifying, never
  # assuming, the pre-fence projection): with a live binding, live ingress,
  # and no transaction terminal, this OPEN case must currently project
  # WAITING/NONE.
  local beforeResult
  beforeResult="$(_m7_call_root_source_status "$binding_action_id" "$session_id")"
  local beforeStatusCode
  beforeStatusCode="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).status));' "$beforeResult")"
  [ "$beforeStatusCode" = "0" ]
  local beforeEnvelope
  beforeEnvelope="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).stdout);' "$beforeResult")"
  local beforeOverallStatus
  beforeOverallStatus="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status);' "$beforeEnvelope")"
  [ "$beforeOverallStatus" = "WAITING" ]

  local registry_before
  registry_before="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    function walk(d) {
      const out = {};
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) Object.assign(out, walk(full));
        else out[full] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
      }
      return out;
    }
    process.stdout.write(JSON.stringify(walk(rll.registryRepoDir(process.argv[2]))));
  ' "$RLL_IMPL" "$PROJ")"

  # Publish a REAL, durable identity fence for the exact (session,agent)
  # identity the root-source binding was minted for.
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", process.argv[3], process.argv[4]);
    const result = rll.publishClaudeAuthorityFence(repoDescriptor, id);
    if (!result.ok) { process.stderr.write("fence plant failed: " + JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJ" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]

  local afterResult
  afterResult="$(_m7_call_root_source_status "$binding_action_id" "$session_id")"
  local afterStatusCode
  afterStatusCode="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).status));' "$afterResult")"
  [ "$afterStatusCode" = "0" ]
  local afterEnvelope
  afterEnvelope="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).stdout);' "$afterResult")"

  run node -e '
    const data = JSON.parse(process.argv[1]);
    const op = data.operation || {};
    const errors = [];
    if (data.status !== "BLOCKED" || data.detail_code !== "NONE") errors.push("envelope status/detail_code mismatch (expected BLOCKED/NONE once the actor fence is published): " + JSON.stringify({ status: data.status, detail_code: data.detail_code }));
    if (op.result_ref !== null || op.result_digest !== null || op.accepted_result_ref !== null || op.accepted_result_digest !== null || op.ack_ref !== null || op.ack_digest !== null) {
      errors.push("must expose only the already-proven request ref/digest, never result/accepted/ack/cancel fields: " + JSON.stringify(op));
    }
    if (errors.length > 0) {
      process.stderr.write("M7 R10 fence-projection violations:\n" + errors.join("\n") + "\nfull envelope: " + process.argv[1]);
      process.exit(1);
    }
  ' "$afterEnvelope"
  [ "$status" -eq 0 ]

  local registry_after
  registry_after="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    function walk(d) {
      const out = {};
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) Object.assign(out, walk(full));
        else out[full] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
      }
      return out;
    }
    process.stdout.write(JSON.stringify(walk(rll.registryRepoDir(process.argv[2]))));
  ' "$RLL_IMPL" "$PROJ")"

  # "zero writes by status": the ONLY registry delta ATTRIBUTABLE TO STATUS
  # ITSELF across both calls must be the fence file (published explicitly
  # above, never by status) -- no existing file may change, and no new file
  # outside grants/ may appear. grants/ is deliberately excluded: each
  # _m7_call_root_source_status invocation mints its own one-time
  # lifecycle-command-grant (grant.json + its .consumed marker) to authorize
  # the CLI call at all -- that is the surrounding authorization mechanism's
  # own, correct, by-design behavior for EVERY command invocation (one-time
  # grants are never reused), completely orthogonal to whether the
  # root-source-status HANDLER's own internal logic performs any writes. A
  # second call producing a second grant is expected and irrelevant noise
  # here, never a signal about the handler itself.
  run node -e '
    const before = JSON.parse(process.argv[1]);
    const after = JSON.parse(process.argv[2]);
    const isGrantPath = (k) => k.includes("/grants/");
    const beforeKeys = new Set(Object.keys(before));
    const newKeys = Object.keys(after).filter((k) => !beforeKeys.has(k) && !isGrantPath(k));
    const changedKeys = Object.keys(after).filter((k) => beforeKeys.has(k) && before[k] !== after[k] && !isGrantPath(k));
    if (changedKeys.length > 0) { process.stderr.write("existing registry files changed by a read-only status call: " + JSON.stringify(changedKeys)); process.exit(1); }
    if (newKeys.length !== 1) { process.stderr.write("expected exactly one new non-grant file (the fence itself, published explicitly by this test, never by status): " + JSON.stringify(newKeys)); process.exit(1); }
  ' "$registry_before" "$registry_after"
  [ "$status" -eq 0 ]
}

# M7 correction round 1 (2026-08-18, GAP-5, task #58): mutation #18 (task
# #55, the last of 18) confirmed removing ONLY the fenced+absent-ingress
# BLOCKED branch in handleRootSourceStatus left all 4 named ROOT-STATUS
# tests green -- the sibling FENCE-OPEN-BLOCKED test above exercises the
# OPEN-with-ingress case specifically (isFenced true, ingress present), a
# DIFFERENT branch than this one (isFenced true, ingress absent). Confirmed
# directly (runtime-role-lifecycle.cjs handleRootSourceStatus, ~8880-8888):
# fenced+absent-ingress returns makeResult(...,'BLOCKED','NONE',...,
# makeOperation('root-source', actionId, 'BLOCKED', {})) -- an EMPTY values
# object, so EVERY operation field (including request_id/request_ref/
# request_digest, unlike the sibling's own OPEN-with-ingress case where
# those remain populated) defaults to null.
@test "M7-ROOT-STATUS-FENCE-ABSENT-INGRESS-BLOCKED (GAP-5): root-source-status for a live v2 binding with NO ingress at all must project BLOCKED/NONE (never WAITING/NONE) once the actor's own identity fence is durably published, with EVERY operation ref/digest field null (including request_ref/request_digest, since no ingress exists to populate them)" {
  local session_id="m7-gap5-session" agent_id="m7-gap5-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  local binding_action_id
  binding_action_id="$(node -e '
    const rll = require(process.argv[1]);
    const rec = JSON.parse(require("fs").readFileSync(rll.rootSourceBindingPathFor(process.argv[2], process.argv[3]), "utf8"));
    process.stdout.write(rec.action_id);
  ' "$RLL_IMPL" "$PROJ" "$binding_id")"
  [ -n "$binding_action_id" ]

  # Fixture sanity: with a live binding, NO ingress, and no fence yet, the
  # pre-fence baseline must be the existing WAITING/NONE projection.
  local beforeResult
  beforeResult="$(_m7_call_root_source_status "$binding_action_id" "$session_id")"
  local beforeStatusCode
  beforeStatusCode="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).status));' "$beforeResult")"
  [ "$beforeStatusCode" = "0" ]
  local beforeEnvelope
  beforeEnvelope="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).stdout);' "$beforeResult")"
  local beforeOverallStatus
  beforeOverallStatus="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status);' "$beforeEnvelope")"
  [ "$beforeOverallStatus" = "WAITING" ]

  # Publish a REAL, durable identity fence for the exact (session,agent)
  # identity the root-source binding was minted for -- ingress is
  # deliberately never published in this test (unlike FENCE-OPEN-BLOCKED).
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
    const id = rll.computeClaudeAuthorityIdentityId(repoDescriptor, "claude-hook", process.argv[3], process.argv[4]);
    const result = rll.publishClaudeAuthorityFence(repoDescriptor, id);
    if (!result.ok) { process.stderr.write("fence plant failed: " + JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJ" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]

  local afterResult
  afterResult="$(_m7_call_root_source_status "$binding_action_id" "$session_id")"
  local afterStatusCode
  afterStatusCode="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).status));' "$afterResult")"
  [ "$afterStatusCode" = "0" ]
  local afterEnvelope
  afterEnvelope="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).stdout);' "$afterResult")"

  run node -e '
    const data = JSON.parse(process.argv[1]);
    const op = data.operation || {};
    const errors = [];
    if (data.status !== "BLOCKED" || data.detail_code !== "NONE") errors.push("envelope status/detail_code mismatch (expected BLOCKED/NONE once the actor fence is published, still zero ingress): " + JSON.stringify({ status: data.status, detail_code: data.detail_code }));
    const mustBeNull = ["request_id", "request_ref", "request_digest", "result_ref", "result_digest", "accepted_result_ref", "accepted_result_digest", "ack_ref", "ack_digest", "cancel_ref", "cancel_digest"];
    for (const field of mustBeNull) {
      if (op[field] !== null) errors.push("operation." + field + " must be null (no ingress exists at all), got: " + JSON.stringify(op[field]));
    }
    if (errors.length > 0) {
      process.stderr.write("M7 GAP-5 fence+absent-ingress projection violations:\n" + errors.join("\n") + "\nfull envelope: " + process.argv[1]);
      process.exit(1);
    }
  ' "$afterEnvelope"
  [ "$status" -eq 0 ]
}

# M7 checklist item G25 (M7-OWNING-NAME-GUARD-25), Codex own required literal
# test name. Existing-behavior guard (not a fresh RED): proves
# agent-spawn-execution-gate.js own already-implemented name===subagent_type
# ownership check (root-source branch, ~L313: "Agent input does not exactly
# match the reserved root-source action payload"). Three SEPARATE @test
# blocks, each calling the real root-source action fixture exactly once --
# mirrors this file own established one-call-per-test convention for
# _m7_create_real_active_root_source_binding (never called twice in the same
# process anywhere else in this file either).
_m7_mint_real_root_source_action_only() {
  local session_id="$1" tag="$2"
  git -C "$PROJ" checkout -b "feature/m7-red02-active-fixture" -q 2>/dev/null
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-role-gate-retained-plane" node -e '
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const lifecycleCli = process.argv[1];
    const sessionId = process.argv[4];
    const tag = process.argv[5];
    const retainedFixture = require(process.argv[6]);
    const intent = {
      source_role: "toolkit-specialist",
      reporting_architect: "arch-platform",
      question: "Inspect the bounded M7 G25 " + tag + " fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
    };
    const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("M7 G25 PLAN missing"); process.exit(1); }
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!generation.ok || !main.ok) { process.stderr.write("M7 G25 main authority setup failed"); process.exit(1); }
    retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
    const lifecycleGrant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
      "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
    );
    if (!lifecycleGrant.ok) {
      process.stderr.write("M7 G25 missing root-source lifecycle admission: " + JSON.stringify(lifecycleGrant));
      process.exit(1);
    }
    const cli = spawnSync(process.execPath, [
      lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
      "--lifecycle-binding", lifecycleGrant.grantId,
    ], { encoding: "utf8", env: process.env });
    let envelope;
    try { envelope = JSON.parse(cli.stdout); } catch { envelope = null; }
    if (cli.status !== 0 || !envelope || envelope.status !== "ACTION_REQUIRED"
      || !envelope.operation || envelope.operation.kind !== "root-source"
      || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
      process.stderr.write("M7 G25 real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(envelope.actions[0]));
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$session_id" "$tag" "$S16_RETAINED_FIXTURE"
}

_m7_g25_call_gate() {
  local session_id="$1" subagent_type="$2" name="$3" prompt="$4"
  node -e '
    const { spawnSync } = require("child_process");
    const projectRoot = process.argv[1];
    const agentGate = process.argv[2];
    const sessionId = process.argv[3];
    const subagentType = process.argv[4];
    const name = process.argv[5];
    const prompt = process.argv[6];
    const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" });
    const gate = spawnSync(process.execPath, [agentGate], {
      input: JSON.stringify({
        tool_name: "Agent",
        tool_input: { subagent_type: subagentType, name, prompt },
        tool_use_id: "m7-g25-tool-use-" + sessionId, session_id: sessionId, agent_type: "", agent_id: "",
      }), encoding: "utf8", env: commonEnv,
    });
    let body;
    try { body = JSON.parse(gate.stdout); } catch { body = null; }
    const decision = body && body.hookSpecificOutput && body.hookSpecificOutput.permissionDecision;
    process.stdout.write(JSON.stringify({ status: gate.status, decision: decision || null, stdoutEmpty: gate.stdout === "" }));
  ' "$PROJ" "$AGENT_SPAWN_GATE_HOOK" "$session_id" "$subagent_type" "$name" "$prompt"
}

@test "M7-OWNING-NAME-GUARD-25 (matching pair, admitted): a canonical owning subagent_type/name pair must be admitted by agent-spawn-execution-gate.js" {
  local session_id="m7-red-g25-match-session"
  local action_json
  action_json="$(_m7_mint_real_root_source_action_only "$session_id" "match")"
  [ -n "$action_json" ]
  local agent_type name prompt
  agent_type="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.agent_type)' "$action_json")"
  name="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.name)' "$action_json")"
  prompt="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.bootstrap_message)' "$action_json")"
  run _m7_g25_call_gate "$session_id" "$agent_type" "$name" "$prompt"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":0'* ]]
  [[ "$output" == *'"decision":"allow"'* ]]
}

@test "M7-OWNING-NAME-GUARD-25 (diverging custom name, denied): a custom name diverging from an owning spawn own reserved action payload must be denied with zero root-source-binding reservations written" {
  local session_id="m7-red-g25-diverge-session"
  local action_json
  action_json="$(_m7_mint_real_root_source_action_only "$session_id" "diverge")"
  [ -n "$action_json" ]
  local agent_type prompt
  agent_type="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.agent_type)' "$action_json")"
  prompt="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).payload.bootstrap_message)' "$action_json")"

  local before_count after_count
  before_count="$(node -e 'const rll=require(process.argv[1]);const fs=require("fs");const path=require("path");const dir=path.join(rll.registryRepoDir(process.argv[2]),"root-source-bindings");try{process.stdout.write(String(fs.readdirSync(dir).length));}catch{process.stdout.write("0");}' "$RLL_IMPL" "$PROJ")"

  run _m7_g25_call_gate "$session_id" "$agent_type" "my-custom-non-canonical-name" "$prompt"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":0'* ]]
  [[ "$output" == *'"decision":"deny"'* ]]

  after_count="$(node -e 'const rll=require(process.argv[1]);const fs=require("fs");const path=require("path");const dir=path.join(rll.registryRepoDir(process.argv[2]),"root-source-bindings");try{process.stdout.write(String(fs.readdirSync(dir).length));}catch{process.stdout.write("0");}' "$RLL_IMPL" "$PROJ")"
  [ "$before_count" = "$after_count" ]
}

@test "M7-OWNING-NAME-GUARD-25 (non-owning custom Agent, pass-through): an ordinary non-canonical, non-owning Agent spawn must be a silent zero-stdout pass-through" {
  run _m7_g25_call_gate "m7-red-g25-passthrough-session" "my-totally-custom-non-owning-agent" "my-totally-custom-non-owning-agent" "irrelevant prompt"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":0'* ]]
  [[ "$output" == *'"stdoutEmpty":true'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 FINAL CORRECTION, correction round 1 (2026-08-18, C2 root-source half):
# same transaction-substitution bypass as claude-one-shot-binding-red.bats'
# own C2 section, applied to root-source. checkAuthorityOperationTransactionTerminal's
# root-source branch (runtime-role-lifecycle.cjs ~4814-4822) also reads
# operationContext.txnDir from the caller for the terminal check once ingress
# exists (post-ingress) -- same caller-supplied-context gap as one-shot.
# Structurally SIMPLER to reproduce than one-shot: checkRootSourceTransactionTerminalAbsentAtTxnDir
# resolves ack.json/cancel.json purely from txnDir (~4752-4760, no separate
# attempt_id parameter the way one-shot's resultPathFor needs) -- so no
# hybrid-path construction is required here; a terminal planted at each
# transaction's own natural directory is exactly what the vulnerable lookup
# examines when operationContext.txnDir points there. mintRoleCommandGrant's
# own root-source branch has the identical requestId!==ingress.request_id
# mint-time cross-check (~4939) as one-shot's requestId!==binding.request_id
# (~4958) -- same reasoning applies for why a naive CLI-level --request swap
# on one grant would be blocked by the argv-digest coincidence, not exercised
# here since these tests target rll.admitClaudeAuthorityOperation directly
# (Layer 1 only -- the CLI round-trip layer needs cmdCancel's exact argv
# shape, not yet located; time-boxed, flagged rather than silently added).
# Reuses _m7_create_real_active_root_source_binding (established above in
# this file) for the real binding and _m7_publish_carrier_and_ingress_for_root_source's
# own wrapper-invocation pattern for both the real (ingress-correlated) and
# decoy (uncorrelated) carrier requests.
# ══════════════════════════════════════════════════════════════════════════

# Publishes a real, standalone carrier request via the SAME wrapper
# _m7_publish_carrier_and_ingress_for_root_source itself uses, deliberately
# WITHOUT correlating it to any binding via publishRootIngress -- a genuine,
# unrelated decoy transaction. Prints "<request_id> <request_path>".
_c2_root_build_decoy_transaction() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const wrapper = process.argv[3];

    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("C2-ROOT decoy: PLAN missing"); process.exit(1); }
    const planPath = plan.planPath;
    const subjectBundlePath = path.join(projectRoot, ".planning", "coordination-subject-bundle-manifest.json");
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
    const coordRoot = path.join(projectRoot, ".planning", "coordination");

    const intent = {
      target_role: "arch-platform",
      question: "C2 root-source decoy carrier request, deliberately never ingress-correlated",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString(),
    };
    const intentB64 = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const published = spawnSync(process.execPath, [
      wrapper, "publish-request", "--coordination-root", coordRoot, "--plan", planPath,
      "--subject-bundle", subjectBundlePath, "--intent", intentB64,
    ], { encoding: "utf8", env: process.env });
    let publishedEnvelope;
    try { publishedEnvelope = JSON.parse(published.stdout); } catch { publishedEnvelope = null; }
    if (published.status !== 0 || !publishedEnvelope || publishedEnvelope.status !== "SUCCESS") {
      process.stderr.write("C2-ROOT decoy: carrier publish-request failed: " + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
      process.exit(1);
    }
    process.stdout.write(publishedEnvelope.request_id + " " + publishedEnvelope.artifact_ref);
  ' "$RLL_IMPL" "$PROJ" "$S16_RETAINED_FIXTURE"
}

# Plants a minimal, well-formed cancel.json directly at `request_path`'s own
# transaction directory -- checkRootSourceTransactionTerminalAbsentAtTxnDir
# only checks PRESENCE (readCoordinationArtifactPresence, never a deep
# validateResultV2-style shape/correlation pass), confirmed by direct read of
# runtime-role-lifecycle.cjs's own checkRootSourceTransactionTerminalAbsentAtTxnDir
# (~4752-4760) and readCoordinationArtifactPresence (~4720-4724). A shape-only
# but genuinely schema-labeled record, never raw garbage bytes.
_c2_root_plant_cancel() {
  local request_path="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const requestPath = process.argv[1];
    const reqObj = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const cancelPath = path.join(path.dirname(requestPath), "cancel.json");
    const cancelObj = {
      schema: "coordination/cancel/v1",
      request_id: reqObj.request_id,
      reason: "C2 root-source fixture cancellation",
      cancelled_at: new Date().toISOString(),
    };
    fs.writeFileSync(cancelPath, JSON.stringify(cancelObj), { mode: 0o600 });
    fs.chmodSync(cancelPath, 0o600);
  ' "$request_path"
}

@test "C2-ROOTSOURCE-WRONG-TRANSACTION-REAL-TERMINAL-DECOY-OPEN (RED): real root-source transaction A (post-ingress, the grant's own backing) has a durable cancel.json; decoy transaction B (operationContext txnDir) is open. admitClaudeAuthorityOperation must FAIL authority-scan-failed with zero capability -- today the terminal check examines B (open), wrongly finds nothing wrong, and admission wrongly succeeds" {
  local session_id="c2-root-terminal-session" agent_id="c2-root-terminal-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  local carrier
  carrier="$(_m7_publish_carrier_and_ingress_for_root_source "$binding_id")"
  local real_request_id real_request_path
  read -r real_request_id real_request_path <<< "$carrier"
  [ -n "$real_request_path" ]

  local decoy
  decoy="$(_c2_root_build_decoy_transaction)"
  local decoy_request_id decoy_request_path
  read -r decoy_request_id decoy_request_path <<< "$decoy"
  [ -n "$decoy_request_path" ]
  [ "$decoy_request_path" != "$real_request_path" ]

  run _c2_root_plant_cancel "$real_request_path"
  [ "$status" -eq 0 ]

  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const sessionId = process.argv[4];
    const agentId = process.argv[5];
    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("fixture: binding read failed: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;
    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: "claude-hook",
      repo_id: rll.computeRepoId(projectRoot), runtime_session_key: sessionId, agent_id: agentId,
    };
    const admission = rll.admitClaudeAuthorityOperation(
      projectRoot, identity, "consume-grant", binding.expiry,
      { family: "root-source", bindingId },
    );
    if (admission.ok) {
      process.stderr.write("M7 C2-ROOT: admission must FAIL when the real backing transaction A has a durable cancel.json -- today it wrongly succeeds: " + JSON.stringify(admission));
      process.exit(1);
    }
    if (admission.reason !== "root-source-transaction-terminal") {
      process.stderr.write("M7 C2-ROOT: expected reason root-source-transaction-terminal, got: " + JSON.stringify(admission));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$PROJ" "$binding_id" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]
}

@test "C2-ROOTSOURCE-WRONG-TRANSACTION-REAL-OPEN-DECOY-TERMINAL (positive direction, RED): real root-source transaction A (post-ingress, the grant's own backing) is genuinely open; decoy transaction B (operationContext txnDir) has a durable cancel.json. admitClaudeAuthorityOperation must SUCCEED -- since A itself has no terminal, B's terminal is correctly irrelevant. Today the terminal check wrongly examines B, finds ITS cancel.json, and admission wrongly denies -- proves a fix examines the RIGHT transaction, not just 'some' transaction" {
  local session_id="c2-root-open-session" agent_id="c2-root-open-agent"
  local binding_id
  binding_id="$(_m7_create_real_active_root_source_binding "$session_id" "$agent_id")"
  [ -n "$binding_id" ]

  local carrier
  carrier="$(_m7_publish_carrier_and_ingress_for_root_source "$binding_id")"
  local real_request_id real_request_path
  read -r real_request_id real_request_path <<< "$carrier"
  [ -n "$real_request_path" ]

  local decoy
  decoy="$(_c2_root_build_decoy_transaction)"
  local decoy_request_id decoy_request_path
  read -r decoy_request_id decoy_request_path <<< "$decoy"
  [ -n "$decoy_request_path" ]
  [ "$decoy_request_path" != "$real_request_path" ]

  run _c2_root_plant_cancel "$decoy_request_path"
  [ "$status" -eq 0 ]

  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const bindingId = process.argv[3];
    const sessionId = process.argv[4];
    const agentId = process.argv[5];
    const bindingRead = rll.readRegistryRecord(rll.rootSourceBindingPathFor(projectRoot, bindingId));
    if (!bindingRead.ok || bindingRead.absent) { process.stderr.write("fixture: binding read failed: " + JSON.stringify(bindingRead)); process.exit(1); }
    const binding = bindingRead.obj;
    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: "claude-hook",
      repo_id: rll.computeRepoId(projectRoot), runtime_session_key: sessionId, agent_id: agentId,
    };
    const admission = rll.admitClaudeAuthorityOperation(
      projectRoot, identity, "consume-grant", binding.expiry,
      { family: "root-source", bindingId },
    );
    if (!admission.ok) {
      process.stderr.write("M7 C2-ROOT positive direction: admission must SUCCEED when the real backing transaction A is genuinely open, regardless of an unrelated decoy transaction own cancel.json -- today it wrongly denies: " + JSON.stringify(admission));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$PROJ" "$binding_id" "$session_id" "$agent_id"
  [ "$status" -eq 0 ]
}
