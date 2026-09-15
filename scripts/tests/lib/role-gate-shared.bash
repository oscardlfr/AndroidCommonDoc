#!/usr/bin/env bash
# Shared fixture/helper library for the runtime-consultation-role-gate-*.bats
# split files (Sequence C20; runtime-consultation-role-gate.bats was one
# 8646-line monolith whose ~19-minute critical path blocked CI shard
# parallelism -- CI run 34897150035). Loaded via bats' `load 'lib/role-gate-
# shared'` from each split file's own $BATS_TEST_DIRNAME, so every path below
# that resolves off $BATS_TEST_DIRNAME (fixtures/..., ../../.claude/hooks/...,
# ../lib/...) still resolves correctly regardless of which split file is
# actually running -- bats sets $BATS_TEST_DIRNAME to the EXECUTING .bats
# file's own directory (scripts/tests/), never this library's.
#
# Contents, in source order: global fixture path variables; setup()/
# teardown() (identical per-test isolation for every split file, including
# the S16E2E backgrounded-process cleanup every split file's tests may need);
# core hook/CLI-invocation primitives (_render_posix_direct/_make_input/
# _run_cp_hook/_extract_injected); and the full S16E2E five-role
# retained-plane bootstrap/mint/wait/teardown machinery plus the
# consult-root polling helpers -- genuinely called from two or more of the
# split files, never duplicated between them.

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
ID01_V2_FIXTURE="$BATS_TEST_DIRNAME/fixtures/runtime-claude-id01-v2-fixture.cjs"
# Bare (non-function) globals the S16E2E retained-plane machinery below
# depends on -- genuinely used from more than one split file (role-gate
# -plane.bats calls _s16e2e_start_retained_plane directly; role-gate
# -evidence.bats's own _s16e2e_cp_evidence_setup passes S16E2E_SUPPORT_ROLES
# through to the SAME shared function), so these must live here rather than
# in either individual split file.
S16E2E_SUPPORT_ROLES="arch-platform,arch-testing,arch-integration,context-provider,doc-updater"
S16E2E_LC_CAPABILITY="$TG_CAPABILITY"

_secure_private_directory() {
  local dir="$1"
  node -e '
    const fs = require("fs");
    const dir = process.argv[1];
    let st;
    try { st = fs.lstatSync(dir); } catch (err) { console.error("private-directory stat failed: " + err.message); process.exit(1); }
    if (st.isSymbolicLink()) { console.error("private-directory is a symlink"); process.exit(1); }
    if (!st.isDirectory()) { console.error("private-directory is not a directory"); process.exit(1); }
    if (process.platform === "win32") {
      const rc = require(process.argv[2]);
      const acl = rc.windowsPrivateDirectoryAcl(dir, { mode: "ensure" });
      if (!acl.ok) { console.error("private-directory Windows ACL is not private: " + JSON.stringify(acl)); process.exit(1); }
    } else {
      fs.chmodSync(dir, 0o700);
      st = fs.lstatSync(dir);
      if ((st.mode & 0o777) !== 0o700) { console.error("private-directory wrong mode: " + (st.mode & 0o777).toString(8)); process.exit(1); }
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) { console.error("private-directory wrong owner"); process.exit(1); }
    }
  ' "$dir" "$CONSULTATION_CLI"
}

_assert_isolated_runtime_tmp() {
  local dir="$1"
  local real_dir real_bats
  real_dir="$(cd "$dir" 2>/dev/null && pwd -P)" || return 1
  real_bats="$(cd "$BATS_TEST_TMPDIR" && pwd -P)" || return 1
  case "$real_dir" in
    "$real_bats"|"$real_bats"/*) ;;
    *) echo "# runtime-tmp escaped BATS_TEST_TMPDIR: $real_dir not under $real_bats" >&2; return 1 ;;
  esac
  _secure_private_directory "$dir"
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
  # Keep the canonical v2 policy: current startup claims and actor authority
  # are deliberately invalid under the historical v1 projection. Individual
  # retained-Codex tests opt into the deterministic app-server test backend
  # rather than downgrading the whole fixture's policy contract.
  mkdir -p "$PROJ/scripts/lib"
  cp "$BATS_TEST_DIRNAME/../lib/runtime-collaboration-policy.json" "$PROJ/scripts/lib/runtime-collaboration-policy.json"
  cp "$BATS_TEST_DIRNAME/../lib/runtime-routing.json" "$PROJ/scripts/lib/runtime-routing.json"
  mkdir -p "$PROJ/.claude"
  cp "$BATS_TEST_DIRNAME/../../.claude/model-profiles.json" "$PROJ/.claude/model-profiles.json"
  TEST_HOME="$PROJ/test-home"
  mkdir -p "$TEST_HOME/.codex"
  _secure_private_directory "$TEST_HOME/.codex"
  # Node resolves os.homedir() from USERPROFILE on native Windows. Isolate
  # both variables so Git Bash cannot fall through to the developer profile;
  # POSIX continues to resolve the same fixture through HOME.
  export HOME="$TEST_HOME"
  export USERPROFILE="$TEST_HOME"
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
payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_use_id": "tg-tool-use-" + session + "-" + agent_id, "tool_input": {"command": command}, "agent_type": agent, "session_id": session, "agent_id": agent_id}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
}

# Same input shape, targets context-provider-gate.js instead -- used for the
# REQUESTER surface (context-provider-gate.js owns requester grants per
# PLAN.md ~L600, regardless of calling agent_type).
_run_cp_hook() {
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJ' node '$CP_GATE_HOOK'"
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
  _secure_private_directory "$PROJ/.planning/coordination"
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
    // hold-non-bootstrap (S16-ROOT-INGRESS-TARGET-LOST-01): role-bootstrap
    // still completes normally so every role reaches READY, but any OTHER
    // turn (a real root-consult dispatch) is deliberately left inProgress
    // forever -- turn-start above already recorded proof it was dispatched;
    // no turn-completed event, ever, for this thread. Makes "the target
    // cannot complete the turn before the plane is stopped" a fixture
    // property, never a race against a cooperative fake that might finish
    // first (CI run 34886292666 shard 1: captured output showed a fully
    // completed READY with every ref populated, not WAITING).
    if (mode === 'hold-non-bootstrap' && expectedKind !== 'role-bootstrap') return;
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
  ensure_out="$(NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_TEST_BACKEND=deterministic-app-server-v1 RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["codex-app-server"]' node "$RLL_IMPL" ensure --project-root "$PROJ" "${role_flags[@]}" --lifecycle-binding "$lifecycle_grant")"
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
    process.stdout.write(JSON.stringify(action.payload.bridge_argv));
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
  [ "${#args[@]}" -ge 3 ]
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
  # Execute the immutable action's exact node/bridge/subcommand tuple. The
  # previous fixture discarded bridge_argv[0..2] and substituted a separate
  # project-local copy, which correctly failed the production bridge's own
  # __filename correlation as bridge-argv-path-mismatch.
  env HOME="$S16E2E_TEST_HOME" NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_FAKE_APP_SERVER_SPAWN="$S16E2E_FAKE_APP_SERVER_SPAWN_JSON" S16E2E_TIMING_LOG="$S16E2E_TIMING_LOG" RUNTIME_BRIDGE_CODEX_FAKE_CONTEXT7_SERVER_PORT="$context7_server_port" RUNTIME_BRIDGE_CODEX_FAKE_CONTEXT7_CONN_LOG="$context7_conn_log" "${args[@]}" >"$S16E2E_BG_OUT" 2>&1 &
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
  if [ -n "${S16E2E_ACTION_JSON:-}" ]; then printf '# action: %s\n' "$S16E2E_ACTION_JSON" >&2; fi
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
  local observed="" deadline=$((SECONDS + 15))
  # Bound elapsed time, not iteration count.  A state read intentionally
  # performs native DACL validation on Windows and can itself take longer
  # than the nominal 0.1s sleep; 150 iterations therefore did not mean the
  # documented 15 seconds on that host.  Bash SECONDS is available on both
  # Windows Git Bash and POSIX/macOS.
  while [ "$SECONDS" -lt "$deadline" ]; do
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
# and the real $PROJ/mcp-server/build/runtime-search-stdio.js composition to
# spawn -- _s16e2e_bootstrap_
# project symlinks both from the real checkout (never copies -- node_modules
# is 100MB+) so this runs the SAME production internal-search code CP-
# EVIDENCE-E2E exercises, just with zero matching docs in the fixture (a
# legitimate real "no pattern gap" outcome, not a stub).
# ══════════════════════════════════════════════════════════════════════════

_s16e2e_poll_consult_root_status() {
  local session_id="$1" intent_id="$2" wanted="$3"
  local observed="" deadline=$((SECONDS + 90))
  # Bound actual elapsed time, not `iterations * sleep`.  Each status probe
  # invokes the real hook and native Windows ACL checks can take seconds, so
  # 900 iterations was not a 90-second ceiling there.  Ninety real seconds
  # still comfortably covers the full request/dispatch/serve/accept/ack
  # chain, while the same Bash SECONDS contract works on macOS/POSIX.  A
  # status probe is a full security-hook + one-use-grant operation, not a
  # cheap in-memory read; spacing probes by two seconds prevents the test
  # driver itself from continuously competing with the MCP child it is
  # trying to observe.
  while [ "$SECONDS" -lt "$deadline" ]; do
    sleep 2
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
