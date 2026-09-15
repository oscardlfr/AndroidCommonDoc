#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# ci-prerequisite: mcp-server
#
# Part 2/3 of the former runtime-consultation-role-gate.bats (Sequence C20
# split -- see lib/role-gate-shared.bash's own header for why). Covers the
# S16-ROOT-SOURCE-E2E and ROOT-INGRESS-E2E five-role retained-plane families
# (session-run + fake app-server, real SubagentStart/WAL/dispatch/accept/ack
# chains) -- 5 of the original 9 retained-plane-start call sites
# (S16-ROOT-SOURCE-E2E: 2, ROOT-INGRESS-E2E: 3). Needs a built mcp-server:
# context-provider's internal-search path (exercised transitively via the
# retained plane's own routing) resolves '@modelcontextprotocol/sdk' for real
# from the shared lib's _s16e2e_bootstrap_project symlink.
#
# Siblings: runtime-consultation-role-gate-core.bats,
# runtime-consultation-role-gate-evidence.bats. Shared fixtures:
# lib/role-gate-shared.bash.
#
# Invocation: bats scripts/tests/runtime-consultation-role-gate-plane.bats (from repo root)

load 'lib/role-gate-shared'


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
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
  ' "$1"
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
    local observed_sha override_sha canonical_sha
    observed_sha="$(_r2c_s16_integrity_sha256_file "$R2C_S16_SNAPSHOT_PATH")"
    override_sha="$(_r2c_s16_integrity_sha256_file "$S16E2E_ROUTING_OVERRIDE_PATH")"
    canonical_sha="$(_r2c_s16_integrity_sha256_file "$LIB_DIR/runtime-routing.json")"
    echo "R2C-S16-INTEGRITY:snapshot-mutated:baseline=$R2C_S16_SNAPSHOT_BASELINE_SHA:observed=$observed_sha:override=$override_sha:canonical=$canonical_sha" >&2
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
    echo "R2C-S16-INTEGRITY:snapshot-hash-mismatch:baseline=$(printf '%q' "$R2C_S16_SNAPSHOT_BASELINE_SHA"):observed=$(printf '%q' "$snapshot_sha_after")" >&2
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

# Root-source is a closed, durable delivery surface: it may reuse a unique
# live Claude peer through SendMessage, otherwise a live Codex app-server
# peer, but never mint a fresh claude-agent actor. Ordinary requester
# dispatch remains governed by the canonical route and is the control.
@test "S16-ROOT-SOURCE-CANONICAL-ROUTING-01: root-source without a Claude peer uses live codex-app-server while an ordinary requester retains claude-agent" {
  # No routing_override_role argument: frozen canonical routing, no seam.
  _s16e2e_setup_through_ingress "s16e2e-canon-session" "s16e2e-canon-agent"
  [ -z "${RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH:-}" ]
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local request_path="$S16E2E_REQUEST_PATH" coord_root="$S16E2E_COORD_ROOT"

  # ---- fixture sanity: canonical ordering still has claude-agent first,
  # Codex is live, and no Claude peer exists for this root-source target. ----
  node -e '
    const fs = require("fs");
    const path = require("path");
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
    const peerDir = path.join(rll.registryRepoDir(proj), "claude-peer-bindings");
    const peerCount = fs.existsSync(peerDir) ? fs.readdirSync(peerDir).filter((name) => name.endsWith(".json")).length : 0;
    if (peerCount !== 0) { process.stderr.write("fixture sanity: expected no Claude peer, got " + peerCount); process.exit(1); }
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
  echo "ROOT-SOURCE-DISPATCH selected_driver=$root_selected expected=codex-app-server"
  node -e '
    const selected = process.argv[1];
    if (selected !== "codex-app-server") {
      process.stderr.write("S16-ROOT-SOURCE-CANONICAL-ROUTING-01: root-source dispatch selected_driver=" + selected + " expected=codex-app-server\n");
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

_s16e2e_create_arch_platform_claude_peer() {
  local session_id="$1" peer_agent_id="$2"
  node -e '
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    const fixture = require(process.argv[5]);
    const projectRoot = process.argv[2];
    const sessionId = process.argv[3];
    const agentId = process.argv[4];
    const plan = rll.discoverPlan(projectRoot);
    const generation = rll.resolveSessionGeneration(projectRoot, {
      ok: true, provider: "claude-hook", runtime_session_key: sessionId,
    });
    if (!plan.ok || !generation.ok) {
      process.stderr.write("peer fixture scope failed: " + JSON.stringify({ plan, generation }));
      process.exit(1);
    }
    const actionId = rll.generateActionId();
    const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const minted = rll.mintRoleLifecycleAction(
      projectRoot, actionId, "role-spawn", "claude-native",
      rll.computeRepoId(projectRoot), rll.computeWorktreeId(projectRoot), plan.planDigest,
      crypto.createHash("sha256").update("root-source-sendmessage-peer").digest("hex"),
      generation.generationId, "arch-platform",
      rll.buildRoleSpawnPayload("root-source-sendmessage", "arch-platform", "arch-platform", null, "fixture"),
      expiry,
    );
    if (!minted.ok) { process.stderr.write("peer fixture action failed: " + JSON.stringify(minted)); process.exit(1); }
    fixture.primeClaudeId01V2ActorProof({
      projectRoot, agentType: "arch-platform", sessionId, agentId, actionId,
      prefix: "root-source-sendmessage-peer-v2",
    });
    fixture.primeProductionClaudeHostAdmission({
      projectRoot, sessionId, entrypoint: "monitor-docs", roleScope: "arch-platform",
    });
    const peer = rll.ensureClaudePeerBindingForObservedActor(projectRoot, {
      sessionId, agentId, agentType: "arch-platform",
    });
    if (!peer.ok) { process.stderr.write("peer fixture bind failed: " + JSON.stringify(peer)); process.exit(1); }
    process.stdout.write(JSON.stringify(peer.record));
  ' "$RLL_IMPL" "$PROJ" "$session_id" "$peer_agent_id" "$ID01_V2_FIXTURE"
}

@test "S16-ROOT-SOURCE-DRIVER-CLAUDE-SENDMESSAGE-01: a unique live Claude peer is reused through claude-sendmessage, never claude-agent" {
  _s16e2e_setup_through_ingress "s16e2e-sendmessage-session" "s16e2e-sendmessage-root-agent"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local request_path="$S16E2E_REQUEST_PATH" coord_root="$S16E2E_COORD_ROOT"
  local peer_json
  peer_json="$(_s16e2e_create_arch_platform_claude_peer "$session_id" "s16e2e-live-arch-platform-peer")"
  [ -n "$peer_json" ]

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
    const activation = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (activation.selected_driver !== "claude-sendmessage") {
      process.stderr.write("expected claude-sendmessage, got " + activation.selected_driver);
      process.exit(1);
    }
  ' "$activation_path"

  _s16e2e_stop_retained_plane
}

@test "S16-ROOT-SOURCE-DRIVER-UNAVAILABLE-01: no Claude peer and no live Codex returns DRIVER_UNAVAILABLE with zero coordination writes" {
  _s16e2e_setup_through_ingress "s16e2e-no-driver-session" "s16e2e-no-driver-root-agent"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local request_path="$S16E2E_REQUEST_PATH" coord_root="$S16E2E_COORD_ROOT"
  local dispatch_cmd; dispatch_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path")"
  _make_input "$dispatch_cmd" "toolkit-specialist" "$session_id" "$agent_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local dispatch_grant; dispatch_grant="$(_extract_injected requester-binding)"
  [ -n "$dispatch_grant" ]

  _s16e2e_stop_retained_plane
  node -e '
    const fs = require("fs");
    const path = require("path");
    const rll = require(process.argv[1]);
    const rbc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const peerDir = path.join(rll.registryRepoDir(projectRoot), "claude-peer-bindings");
    const peerCount = fs.existsSync(peerDir) ? fs.readdirSync(peerDir).filter((name) => name.endsWith(".json")).length : 0;
    const codex = rbc.resolveLiveCodexAppServerWorker(projectRoot, "arch-platform", rll.roleProfileDigestFor("arch-platform"));
    if (peerCount !== 0 || (codex && codex.ok === true && codex.available === true)) {
      process.stderr.write("fixture still has a live root-source driver: " + JSON.stringify({ peerCount, codex }));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$LIB_DIR/runtime-bridge-codex.cjs" "$PROJ"

  local before after
  before="$(_s16_snapshot_tree "$coord_root")"
  run node "$CONSULTATION_CLI" dispatch --coordination-root "$coord_root" --request "$request_path" --requester-binding "$dispatch_grant"
  [ "$status" -ne 0 ]
  [[ "$output" == *'"status":"UNAVAILABLE"'* ]]
  [[ "$output" == *'"detail_code":"DRIVER_UNAVAILABLE"'* ]]
  after="$(_s16_snapshot_tree "$coord_root")"
  [ "$after" = "$before" ]
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
  if [ "$(node -p 'process.platform')" = "win32" ]; then
    skip "POSIX SIGKILL semantics; native Windows process liveness is covered by the PowerShell suites"
  fi
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
  if [ "$(node -p 'process.platform')" = "win32" ]; then
    skip "POSIX /bin/kill semantics; native Windows process liveness is covered by the PowerShell suites"
  fi
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
  # Deterministic precondition, not a race: hold every non-bootstrap turn
  # open (role-bootstrap still completes, so all five roles reach READY).
  # Without this, a cooperative fake can dispatch AND complete the
  # root-consult turn before the plane is stopped -- proven on CI run
  # 34886292666 shard 1, where the captured consult-root-status output was
  # a fully completed READY (every ref/digest populated), not WAITING.
  local previous_fake_mode="${S16E2E_FAKE_MODE:-}"
  S16E2E_FAKE_MODE="hold-non-bootstrap"
  _s16e2e_start_retained_plane "$session_id"
  S16E2E_FAKE_MODE="$previous_fake_mode"

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

  # Prove the intended cut, not a race merely won: the target's non-bootstrap
  # turn genuinely started (bounded wait for the retained poll loop to
  # dispatch it) and -- by construction of hold-non-bootstrap -- can never
  # complete.
  local tries=0 saw_turn_start="false"
  while [ "$tries" -lt 100 ]; do
    saw_turn_start="$(node -e '
      const fs = require("fs");
      let lines = [];
      try { lines = fs.readFileSync(process.argv[1], "utf8").split("\n").map((l) => l.trim()).filter(Boolean); } catch (err) { lines = []; }
      const found = lines.some((l) => { try { const e = JSON.parse(l); return e.event === "turn-start" && e.expected_result_kind !== "role-bootstrap"; } catch (err) { return false; } });
      process.stdout.write(String(found));
    ' "$S16E2E_FAKE_APP_SERVER_EVENTS")"
    [ "$saw_turn_start" = "true" ] && break
    tries=$((tries + 1))
    sleep 0.1
  done
  [ "$saw_turn_start" = "true" ]
  local saw_turn_completed
  saw_turn_completed="$(node -e '
    const fs = require("fs");
    let lines = [];
    try { lines = fs.readFileSync(process.argv[1], "utf8").split("\n").map((l) => l.trim()).filter(Boolean); } catch (err) { lines = []; }
    const found = lines.some((l) => { try { const e = JSON.parse(l); return e.event === "turn-completed" && e.expected_result_kind !== "role-bootstrap"; } catch (err) { return false; } });
    process.stdout.write(String(found));
  ' "$S16E2E_FAKE_APP_SERVER_EVENTS")"
  [ "$saw_turn_completed" = "false" ]

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
