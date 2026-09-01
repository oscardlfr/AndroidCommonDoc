#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822, Phase 3 (M9-A). Real, executable E2E
# coverage for the portable runtime-consultation protocol across 10 scenarios:
#   1. Persistent plane          6. Approved ingestion
#   2. Driver fallback           7. Denial/zero-write
#   3. Context7 down             8. ensure reuse
#   4. Mixed runtime chain       9. Restart rediscovery
#   5. Historical evidence      10. Cleanup
#
# Self-contained (this codebase's convention: no shared `load` between bats files --
# every file owns its own setup/teardown/fixtures). The S16E2E retained-plane
# infrastructure below (bootstrap_project, fake-codex-app-server, fake-context7-server,
# start/stop_retained_plane, root-source setup, CP-evidence helpers) is adapted from the
# proven, currently-green scripts/tests/runtime-consultation-role-gate.bats -- copied,
# not reinvented, per this mission's own dispatch. Scenarios 6/7 use the separate,
# simpler scripts/sh/write-coordination-artifact.sh generic writer (request/approval/
# result kinds), which is a DIFFERENT script from runtime-consultation.cjs and carries
# no role-command-grant authority layer of its own.
#
# Invocation: bash scripts/sh/run-bats.sh --project-root "$(pwd)" scripts/tests/runtime-consultation-e2e.bats

CP_GATE_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/context-provider-gate.js"
AGENT_SPAWN_GATE_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/agent-spawn-execution-gate.js"
SUBAGENT_START_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/subagent-start-context-bundle.js"
LIB_DIR="$(cd "$BATS_TEST_DIRNAME/../lib" && pwd)"
CONSULTATION_CLI="$LIB_DIR/runtime-consultation.cjs"
RLL_IMPL="$LIB_DIR/runtime-role-lifecycle.cjs"
WCA_SCRIPT="$BATS_TEST_DIRNAME/../sh/write-coordination-artifact.sh"
S16_RETAINED_FIXTURE="$BATS_TEST_DIRNAME/fixtures/runtime-consultation-grant-wrapper.cjs"
WAVE_SLUG="wave1-e2e-wave"
S16E2E_SUPPORT_ROLES="arch-platform,arch-testing,arch-integration,context-provider,doc-updater"
S16E2E_LC_CAPABILITY="wave1-e2e-fixture-capability"

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

  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '# fixture PLAN for runtime-consultation-e2e tests\n' > "$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md"
  INPUT_FILE="$(mktemp "$BATS_TEST_TMPDIR/e2e-input.XXXXXX.json")"
  S16E2E_BG_PID=""
  S16E2E_CONTEXT7_SERVER_PID=""
}

teardown() {
  unset RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH
  unset NODE_ENV
  unset RUNTIME_CONSULTATION_TEST_CAPABILITY
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
    chmod -R u+rwX "$RUNTIME_TMP" 2>/dev/null || true
    rm -rf "$RUNTIME_TMP"
  fi
  rm -rf "$PROJ"
  rm -f "$INPUT_FILE"
}

# ══════════════════════════════════════════════════════════════════════════
# Shared core helpers (mirrors runtime-consultation-role-gate.bats verbatim)
# ══════════════════════════════════════════════════════════════════════════

_render_posix_direct() {
  node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(rll.renderPosixDirect(process.argv.slice(2)));
  ' "$RLL_IMPL" "$@"
}

# _make_input <command> <agent_type> [session_id] [agent_id]
_make_input() {
  local command="$1" agent="$2" session="${3:-e2e-session}" agent_id="${4:-e2e-agent-id}"
  python3 - "$INPUT_FILE" "$command" "$agent" "$session" "$agent_id" <<'PYEOF'
import json, sys
path, command, agent, session, agent_id = sys.argv[1:6]
payload = {"tool_name": "Bash", "tool_input": {"command": command}, "agent_type": agent, "session_id": session, "agent_id": agent_id}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
}

_run_cp_hook() {
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJ' node '$CP_GATE_HOOK'"
}

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

# Relative-path + per-file sha256 manifest of every regular file under $1, sorted for a
# stable, directly diffable text form -- proves a rejected/no-op operation performed
# exactly zero writes.
_wave1_snapshot_tree() {
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

_wca_json_get() {
  python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
k = sys.argv[2]
if k not in d:
    print('MISSING')
    sys.exit(0)
v = d[k]
if isinstance(v, bool):
    print('true' if v else 'false')
elif isinstance(v, list):
    print(json.dumps(v))
elif v is None:
    print('null')
else:
    print(v)
" "$1" "$2"
}

# Lightweight direct binding prime. These scenarios need only the canonical
# MainOrchestratorBinding for the observed session; no role lifecycle action is
# involved, so do not route through ensure or an external host capability.
_wave1_prime_session_binding() {
  local session_key="$1"
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: process.argv[3] };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) process.exit(1);
    const created = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, plan.planDigest, 600);
    if (!created.ok) process.exit(1);
  ' "$RLL_IMPL" "$PROJ" "$session_key"
  [ "$status" -eq 0 ] || return 1
}

_wave1_write_subject_bundle() {
  local p="$PROJ/.planning/coordination-subject-bundle-manifest.json"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
  ' "$p"
  printf '%s' "$p"
}

# ══════════════════════════════════════════════════════════════════════════
# S16E2E retained-plane infrastructure (adapted verbatim from
# runtime-consultation-role-gate.bats -- real ensure -> real SupervisorExecutionClaim
# -> real session-run subprocess against a real JSONL fake-codex-app-server protocol
# peer; the fake substitutes ONLY the external model boundary).
# ══════════════════════════════════════════════════════════════════════════

_s16e2e_bootstrap_project() {
  local routing_override_role="${1:-}"
  git -C "$PROJ" checkout -b "feature/wave1-e2e-fixture" -q 2>/dev/null
  mkdir -p "$PROJ/.planning/coordination"
  chmod 0700 "$PROJ/.planning/coordination"
  mkdir -p "$PROJ/scripts"
  cp -R "$BATS_TEST_DIRNAME/../lib" "$PROJ/scripts/lib"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const lib = process.argv[1];
    const rll = require(path.join(lib, "runtime-role-lifecycle.cjs"));
    const policyPath = path.join(lib, "runtime-collaboration-policy.json");
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    fs.writeFileSync(policyPath, JSON.stringify(rll.projectPolicyV2ToV1(policy)));
  ' "$PROJ/scripts/lib"
  S16E2E_BRIDGE="$PROJ/scripts/lib/runtime-bridge-codex.cjs"
  if [ -n "$routing_override_role" ]; then
    node -e '
      const fs = require("fs");
      const routingPath = process.argv[1];
      const role = process.argv[2];
      const policy = JSON.parse(fs.readFileSync(routingPath, "utf8"));
      if (policy.schema !== "runtime-routing/v1" || !policy.routes || !Array.isArray(policy.routes[role])) {
        process.stderr.write("reorder-routing: unexpected policy shape for role " + role); process.exit(1);
      }
      const original = policy.routes[role];
      if (!original.includes("codex-app-server") || !original.includes("claude-agent")) {
        process.stderr.write("reorder-routing: role " + role + " does not carry both drivers"); process.exit(1);
      }
      const rest = original.filter((d) => d !== "codex-app-server" && d !== "claude-agent");
      policy.routes[role] = ["codex-app-server", "claude-agent"].concat(rest);
      fs.writeFileSync(routingPath, JSON.stringify(policy));
    ' "$PROJ/scripts/lib/runtime-routing.json" "$routing_override_role"
    local override_path="$RUNTIME_TMP/test-routing-policy.json"
    cp "$PROJ/scripts/lib/runtime-routing.json" "$override_path"
    chmod 0600 "$override_path"
    S16E2E_ROUTING_OVERRIDE_PATH="$(cd "$(dirname "$override_path")" && pwd -P)/$(basename "$override_path")"
    export RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH="$S16E2E_ROUTING_OVERRIDE_PATH"
    export NODE_ENV=test
    export RUNTIME_CONSULTATION_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY"
  fi
  mkdir -p "$PROJ/setup"
  cp -R "$BATS_TEST_DIRNAME/../../setup/agent-templates" "$PROJ/setup/agent-templates"
  mkdir -p "$PROJ/.claude"
  cp -R "$BATS_TEST_DIRNAME/../../.claude/agents" "$PROJ/.claude/agents"

  mkdir -p "$PROJ/mcp-server"
  ln -s "$BATS_TEST_DIRNAME/../../mcp-server/node_modules" "$PROJ/mcp-server/node_modules"
  ln -s "$BATS_TEST_DIRNAME/../../mcp-server/build" "$PROJ/mcp-server/build"
  cp "$BATS_TEST_DIRNAME/../../mcp-server/package.json" "$PROJ/mcp-server/package.json"

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
  if (!next || next.hang === true) return;
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
    fs.writeFileSync(process.argv[1], JSON.stringify({ tokens: { access_token: accessToken, account_id: "wave1-e2e-account", id_token: accessToken } }), { mode: 0o600 });
  ' "$S16E2E_TEST_HOME/.codex/auth.json"
  chmod 0600 "$S16E2E_TEST_HOME/.codex/auth.json"

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
    const gapBranch = Array.isArray(wireEnvelope && wireEnvelope.anyOf)
      ? wireEnvelope.anyOf.find((branch) => branch && branch.properties && branch.properties.kind
          && Array.isArray(branch.properties.kind.enum) && branch.properties.kind.enum[0] === 'pattern-gap')
      : null;
    const emitGap = gapSpec && expectedKind !== 'role-bootstrap' && (
      (mode === 'context-provider-gap-once' && gapBranch && !gapEmittedForThread.has(frame.params.threadId))
      || mode === 'context-provider-gap-always'
      || (mode === 'consult-context-provider-once' && gapBranch)
    );
    const consultBranch = mode === 'consult-context-provider-once' && Array.isArray(wireEnvelope && wireEnvelope.anyOf)
      ? wireEnvelope.anyOf.find((branch) => branch && branch.properties && branch.properties.kind
          && Array.isArray(branch.properties.kind.enum) && branch.properties.kind.enum[0] === 'consult-intent')
      : null;
    const emitConsult = consultBranch && expectedKind !== 'role-bootstrap' && !consultEmittedForThread.has(frame.params.threadId);
    const consultTargetRole = emitConsult
      && consultBranch.properties.consult.properties.target_role.enum[0];
    const consultQuestionSchema = emitConsult && consultBranch.properties.consult.properties.question;
    const consultQuestion = emitConsult
      && (Array.isArray(consultQuestionSchema.enum) ? consultQuestionSchema.enum[0] : 'fake-codex-consult-question');
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
  S16E2E_FAKE_APP_SERVER_SPAWN_JSON="$(node -e '
    process.stdout.write(JSON.stringify({
      command: process.execPath,
      args: [process.argv[1], process.argv[3], "", process.argv[2], process.argv[4]],
    }));
  ' "$S16E2E_FAKE_CODEX" "$S16E2E_FAKE_APP_SERVER_EVENTS" "${S16E2E_FAKE_MODE:-cooperative}" "${S16E2E_FAKE_GAP_SPEC:-}")"
}

_s16e2e_mint_raw_action() {
  local roles_csv="$1" session_key="$2" ttl="${3:-3600}"
  local -a role_flags=()
  local r
  for r in ${roles_csv//,/ }; do role_flags+=(--role "$r"); done

  local ensure_cmd; ensure_cmd="$(_render_posix_direct node "$RLL_IMPL" ensure --project-root "$PROJ" "${role_flags[@]}")"
  _make_input "$ensure_cmd" "" "$session_key"
  _run_cp_hook
  if [ "$status" -ne 0 ]; then echo "ensure hook call failed: $output" >&2; return 1; fi
  local lifecycle_grant; lifecycle_grant="$(_extract_injected lifecycle-binding)"
  if [ -z "$lifecycle_grant" ]; then echo "ensure hook did not inject a lifecycle-binding grant: $output" >&2; return 1; fi

  local ensure_out
  ensure_out="$(HOME="$S16E2E_TEST_HOME" CODEX_CLI_PATH="$S16E2E_FAKE_CODEX" NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["codex-app-server"]' node "$RLL_IMPL" ensure --project-root "$PROJ" "${role_flags[@]}" --lifecycle-binding "$lifecycle_grant")"
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
  node -e 'JSON.parse(process.argv[1]).forEach((v) => process.stdout.write(v + "\n"))' "$1"
}

_s16e2e_start_bridge_bg() {
  local argv_json="$1"
  local args=()
  while IFS= read -r line; do args+=("$line"); done < <(_s16e2e_args_from_json "$argv_json")
  S16E2E_TIMING_LOG="$(mktemp)"
  S16E2E_CONTEXT7_SERVER_PID=""
  local context7_responses_path="" context7_server_port=""
  S16E2E_FAKE_CONTEXT7_REQUEST_LOG=""
  local context7_conn_log=""
  if [ -n "${S16E2E_FAKE_CONTEXT7_RESPONSES:-}" ]; then
    context7_responses_path="$(mktemp)"
    printf '%s' "$S16E2E_FAKE_CONTEXT7_RESPONSES" > "$context7_responses_path"
    local port_file; port_file="$(mktemp)"
    S16E2E_FAKE_CONTEXT7_REQUEST_LOG="$(mktemp)"
    context7_conn_log="$(mktemp)"
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
  for role in ${roles_csv//,/ }; do
    _s16e2e_wait_for_owner_file "$role" >/dev/null
    _s16e2e_wait_for_role_state "$role" "$S16E2E_ACTION_JSON" READY >/dev/null
  done
}

_s16e2e_stop_retained_plane() {
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
# Root-source setup (adapted from runtime-consultation-role-gate.bats's
# S16-ROOT-SOURCE-E2E spec): real five-role plane -> real root-source CLI -> real
# Agent/SubagentStart -> real WAL publish+ingress via hook/CLI.
# ══════════════════════════════════════════════════════════════════════════

_s16e2e_setup_through_binding() {
  local session_id="$1" agent_id="$2"
  local routing_override_role="${3:-}"
  local question_override="${4:-WAVE1 E2E: review the WAL serialization implementation.}"
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

  local gate_body
  gate_body="$(NODE_ENV=test CLAUDE_PROJECT_DIR="$PROJ" node "$AGENT_SPAWN_GATE_HOOK" <<EOF
{"tool_name":"Agent","tool_input":{"subagent_type":"$agent_type_p","name":"$name_p","prompt":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$bootstrap_message")},"tool_use_id":"$session_id-tool-use-01","session_id":"$session_id","agent_type":"","agent_id":""}
EOF
)"
  node -e '
    const b = JSON.parse(process.argv[1]);
    if (!b.hookSpecificOutput || b.hookSpecificOutput.permissionDecision !== "allow") process.exit(1);
  ' "$gate_body"

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

_s16e2e_setup_through_ingress() {
  _s16e2e_setup_through_binding "$1" "$2" "$3" "$4" "$5"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local bootstrap_message="$S16E2E_BOOTSTRAP_MESSAGE"

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
}

# ══════════════════════════════════════════════════════════════════════════
# CP-evidence / consult-root helpers (adapted from runtime-consultation-role-gate.bats)
# ══════════════════════════════════════════════════════════════════════════

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
  ' "$CONSULTATION_CLI" "WAVE1 $2: describe the WAL ingress invariant." "$evidence_policy")"
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

_s16e2e_poll_consult_root_status() {
  local session_id="$1" intent_id="$2" wanted="$3" tries=0
  local observed=""
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

# ══════════════════════════════════════════════════════════════════════════
# SCENARIO 1: Persistent plane
# ══════════════════════════════════════════════════════════════════════════

@test "WAVE1-E2E-01-PERSISTENT-PLANE: real five-role retained plane (session-run + fake app-server) reaches READY for all five roles" {
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "wave1e2e-persistent-session"
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

# ══════════════════════════════════════════════════════════════════════════
# SCENARIO 2: Driver fallback
# ══════════════════════════════════════════════════════════════════════════

@test "WAVE1-E2E-02-DRIVER-FALLBACK: real dispatch -> claim -> forced lease expiry -> real takeover -> real redispatch for the new attempt all succeed end to end (the inbox-ref no-clobber bug this test originally discovered and pinned is now fixed -- see dispatchCanonical's inbox-ref handling in runtime-consultation.cjs)" {
  # Ordinary (non-root-source) requester dispatch, no retained plane needed
  # -- deliberately NOT the root-source path (empirically, a root-source-
  # authenticated dispatch is constrained to its one designated retained
  # target at the CLI authority layer, AUTHORITY_INVALID once that target is
  # excluded -- a genuinely different, narrower contract than
  # dispatchCanonical's own general exclusion logic proven at the internal-
  # function level by WAVE1-DISPATCH-FALLBACK-01) and deliberately NOT a live
  # retained bridge worker (empirically, the bridge-path/codex-app-server
  # worker never publishes claim.json/active-lease.json at all, so takeover
  # against a SIGKILLed real bridge worker is itself rejected
  # AUTHORITY_INVALID -- nothing ever qualified for takeover in the first
  # place). A bare-sandbox dispatch honestly resolves to `noop` (matching
  # WAVE1-DISPATCH-FALLBACK-01's own precedent), then a real `claim` + a
  # real, genuinely wall-clock-expired active-lease.json + a real `takeover`
  # deterministically reaches genuine takeover eligibility through the real
  # CLI authority/grant layer end to end -- a cross-check a hand-constructed
  # takeover.json cannot reach at all (confirmed empirically: a hand-written
  # record was rejected downstream with AUTHORITY_INVALID).
  local session_id="wave1e2e-fallback-session"
  local coord_root="$PROJ/.planning/coordination"
  mkdir -p "$coord_root"
  chmod 0700 "$coord_root"

  local subject="$PROJ/.planning/coordination-subject-bundle-manifest.json"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({ schema: "coordination/subject-bundle-manifest/v1", entries: [] }));
  ' "$subject"
  local plan_path; plan_path="$(node -e 'process.stdout.write(require(process.argv[1]).discoverPlan(process.argv[2]).planPath)' "$RLL_IMPL" "$PROJ")"
  [ -n "$plan_path" ]
  local intent; intent="$(node -e '
    process.stdout.write(Buffer.from(JSON.stringify({
      target_role: "arch-testing",
      question: "WAVE1-E2E-02-DRIVER-FALLBACK ordinary requester fixture.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    }), "utf8").toString("base64url"));
  ')"

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_SESSION="$session_id" \
    node "$S16_RETAINED_FIXTURE" publish-request --coordination-root "$coord_root" --plan "$plan_path" --subject-bundle "$subject" --intent "$intent"
  [ "$status" -eq 0 ]
  local request_path; request_path="$(node -e 'const e=JSON.parse(process.argv[1]); if (e.status !== "SUCCESS") process.exit(1); process.stdout.write(e.artifact_ref)' "$output")"
  [ -f "$request_path" ]
  local txn_dir; txn_dir="$(dirname "$request_path")"

  # dispatchCanonical() directly (never the grant wrapper) for BOTH dispatch
  # calls in this test -- empirically required for consistency: the
  # requester-binding grant path writes requester-identity-tinged inbox-ref
  # bytes that genuinely differ, byte-for-byte, from a grant-free
  # dispatchCanonical() call's own bytes for the exact same request/target,
  # so mixing the two across the pre- and post-takeover dispatch calls hits a
  # real no-clobber collision on the (request_id-keyed, write-once) inbox-ref
  # path -- confirmed empirically by direct read of the thrown
  # AUTHORITY_INVALID/"no-clobber race lost (existing durable target
  # differs)" error. WAVE1-DISPATCH-FALLBACK-01 itself calls dispatchCanonical()
  # directly for both of its own two calls for the identical reason, whether
  # or not its own header comment says so explicitly.
  local first_activation_path; first_activation_path="$(node -e '
    const rc = require(process.argv[1]);
    const flags = { "coordination-root": process.argv[2], request: process.argv[3] };
    const result = rc.dispatchCanonical(flags, {});
    process.stdout.write(result.artifact_ref);
  ' "$CONSULTATION_CLI" "$coord_root" "$request_path")"
  [ -f "$first_activation_path" ]
  local first_selected; first_selected="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).selected_driver)' "$first_activation_path")"
  [ "$first_selected" = "noop" ]

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_SESSION="$session_id" RCC_GRANT_ROLE="arch-testing" \
    node "$S16_RETAINED_FIXTURE" claim --coordination-root "$coord_root" --request "$request_path" --role arch-testing
  [ "$status" -eq 0 ]
  local claim_path; claim_path="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  [ -f "$claim_path" ]
  local claim_attempt_id; claim_attempt_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).attempt_id)' "$claim_path")"
  local lease_path="$txn_dir/active-leases/$claim_attempt_id.json"
  [ -f "$lease_path" ]
  node -e '
    const fs = require("fs");
    const lease = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    lease.lease_expiry = "2020-01-01T00:00:00Z";
    fs.writeFileSync(process.argv[1], JSON.stringify(lease), { mode: 0o600 });
  ' "$lease_path"

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_SESSION="$session_id" \
    node "$S16_RETAINED_FIXTURE" takeover --coordination-root "$coord_root" --request "$request_path"
  [ "$status" -eq 0 ]
  [ -f "$txn_dir/takeover.json" ]
  local new_attempt_id; new_attempt_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).new_attempt_id)' "$txn_dir/takeover.json")"

  # FIXED (was a discovered production bug, reported alongside this file):
  # this redispatch -- the exact final step WAVE1-DISPATCH-FALLBACK-01's own
  # unit test performs, and the exact step the root-source bootstrap protocol
  # text (runtime-role-lifecycle.cjs's ROOT_SOURCE_BOOTSTRAP_FINAL_LINE)
  # instructs a real agent to perform after a real takeover -- used to throw
  # an uncaught AUTHORITY_INVALID from publishNoClobber ("no-clobber race
  # lost (existing durable target differs)") on the request's own
  # inbox/<target_role>/<request_id>.json: that inbox-ref is a write-once,
  # no-clobber artifact keyed ONLY by request_id (never attempt_id), so ANY
  # second dispatchCanonical() call for the same request_id computed a FRESH
  # created_at and collided with the first dispatch's already-durable one.
  # dispatchCanonical now reads any existing, request-correlated inbox-ref
  # unconditionally and reuses its created_at, converging every dispatch for
  # the same request on identical inbox-ref bytes regardless of attempt --
  # this assertion proves the redispatch now genuinely succeeds end to end.
  run node -e '
    const rc = require(process.argv[1]);
    const flags = { "coordination-root": process.argv[2], request: process.argv[3] };
    const result = rc.dispatchCanonical(flags, {});
    process.stdout.write(JSON.stringify(result));
  ' "$CONSULTATION_CLI" "$coord_root" "$request_path"
  [ "$status" -eq 0 ]
  local second_activation_path; second_activation_path="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  [ -f "$second_activation_path" ]
  [ "$second_activation_path" != "$first_activation_path" ]
  node -e '
    const fs = require("fs");
    const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expectedAttemptId = process.argv[2];
    if (a.attempt_id !== expectedAttemptId) { process.stderr.write("redispatch activation targets the wrong attempt: " + JSON.stringify(a)); process.exit(1); }
  ' "$second_activation_path" "$new_attempt_id"
  echo "# WAVE1-E2E-02-DRIVER-FALLBACK: real dispatch(noop)->claim->forced-lease-expiry->real takeover(new_attempt_id=$new_attempt_id)->real redispatch(activation=$second_activation_path) all verified end to end; the inbox-ref no-clobber collision this test originally discovered is fixed." >&2
}

# ══════════════════════════════════════════════════════════════════════════
# SCENARIO 3: Context7 down (context7-preferred graceful degradation)
# ══════════════════════════════════════════════════════════════════════════

@test "WAVE1-E2E-03-CONTEXT7-DOWN: context7-preferred degrades gracefully (ANSWERED, null dependency) when the one mandatory Context7 attempt hits a 503, never fails closed the way context7-required would" {
  local session_id="wave1e2e-c7down-session"
  local gap_spec; gap_spec='{"provider":"context7","library_name":"Node.js","library_id":"/nodejs/node","query":"WAVE1-E2E-03-CONTEXT7-DOWN: structuredClone deep-copy semantics for Map"}'
  S16E2E_FAKE_CONTEXT7_RESPONSES='[{"statusCode":503,"headers":{"content-type":"text/plain"},"bodyBase64":""}]'
  _s16e2e_cp_evidence_setup "$session_id" "$gap_spec"

  _s16e2e_consult_root_publish "$session_id" "CONTEXT7-DOWN" "context7-preferred"
  local intent_id="$S16E2E_CR_INTENT_ID"

  if ! _s16e2e_poll_consult_root_status "$session_id" "$intent_id" "READY" >/dev/null; then
    echo "DEBUG bridge log tail:" >&2
    tail -80 "$S16E2E_BG_OUT" >&2
    false
  fi

  local call_count; call_count="$(wc -l < "$S16E2E_FAKE_CONTEXT7_REQUEST_LOG" | tr -d ' ')"
  [ "$call_count" -eq 1 ]

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
    const result = JSON.parse(fs.readFileSync(path.join(process.argv[1], process.argv[2]), "utf8"));
    if (result.status !== "ANSWERED") { process.stderr.write("expected ANSWERED even though Context7 was down (context7-preferred degrades, never fails closed): " + JSON.stringify(result)); process.exit(1); }
    if (result.pattern_evidence_dependency !== null) { process.stderr.write("expected a null pattern_evidence_dependency once the one mandatory attempt hit an availability failure: " + JSON.stringify(result.pattern_evidence_dependency)); process.exit(1); }
  ' "$plan_root" "$result_ref"

  local completion_path; completion_path="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.rootConsultCompletionPathFor(process.argv[2], process.argv[3]));' "$RLL_IMPL" "$PROJ" "$intent_id")"
  [ -f "$completion_path" ]

  _s16e2e_stop_retained_plane
}

# ══════════════════════════════════════════════════════════════════════════
# SCENARIO 4: Mixed runtime without human relay
# ══════════════════════════════════════════════════════════════════════════

@test "WAVE1-E2E-04-MIXED-RUNTIME-CHAIN: toolkit-specialist(root-source) -> arch-platform(fake codex) -> context-provider(fake codex) -> arch-platform -> toolkit-specialist completes purely through disk artifacts, with no test-injected message between the two driver-backed roles" {
  S16E2E_FAKE_MODE="consult-context-provider-once"
  _s16e2e_setup_through_ingress "wave1e2e-mixed-session" "wave1e2e-mixed-agent" "arch-platform"
  local session_id="$S16E2E_SESSION_ID" agent_id="$S16E2E_AGENT_ID"
  local coord_root="$S16E2E_COORD_ROOT" request_path="$S16E2E_REQUEST_PATH"

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

  # Exactly one context-provider child, real, correlated -- proves the
  # arch-platform -> context-provider -> arch-platform hop genuinely ran.
  local child_request_id; child_request_id="$(node -e '
    const fs = require("fs"), path = require("path");
    const requestPath = process.argv[1];
    const parent = JSON.parse(fs.readFileSync(requestPath, "utf8"));
    const transactionsDir = path.dirname(path.dirname(requestPath));
    const children = fs.readdirSync(transactionsDir).filter((n) => /^[a-f0-9]{64}$/.test(n)).map((n) => {
      const p = path.join(transactionsDir, n, "request.json");
      return fs.existsSync(p) ? { dir: path.join(transactionsDir, n), request: JSON.parse(fs.readFileSync(p, "utf8")) } : null;
    }).filter((e) => e && e.request.parent_request_id === parent.request_id);
    if (children.length !== 1) { process.stderr.write("expected exactly one context-provider child, got " + children.length); process.exit(1); }
    const child = children[0];
    if (child.request.target_role !== "context-provider") { process.stderr.write("child target_role: " + child.request.target_role); process.exit(1); }
    if (child.request.source_role !== "arch-platform") { process.stderr.write("child source_role: " + child.request.source_role); process.exit(1); }
    if (!fs.existsSync(path.join(child.dir, "accepted-result.json")) || !fs.existsSync(path.join(child.dir, "ack.json"))) {
      process.stderr.write("child transaction never durably completed"); process.exit(1);
    }
    const ack = JSON.parse(fs.readFileSync(path.join(child.dir, "ack.json"), "utf8"));
    if (ack.disposition !== "accepted") { process.stderr.write("child ack disposition: " + ack.disposition); process.exit(1); }
    process.stdout.write(child.request.request_id);
  ' "$request_path")"
  [ -n "$child_request_id" ]

  # No outbox/ directory exists anywhere under coordination -- the ONLY
  # producer of that path is write-coordination-artifact.sh's own --kind
  # message mirror step, which this chain never invokes: every hop above ran
  # purely off the disk transaction/WAL state the retained bridge's own poll
  # loop consumes, never a test-injected message between the driver-backed roles.
  local outbox_count; outbox_count="$(find "$PROJ/.planning/coordination" -type d -name outbox 2>/dev/null | wc -l | tr -d ' ')"
  [ "${outbox_count:-0}" -eq 0 ]

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

  local status_cmd; status_cmd="$(_render_posix_direct node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$S16E2E_ACTION_ID")"
  _make_input "$status_cmd" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local status_grant; status_grant="$(_extract_injected lifecycle-binding)"
  [ -n "$status_grant" ]
  run env NODE_ENV=test node "$RLL_IMPL" root-source-status --project-root "$PROJ" --action "$S16E2E_ACTION_ID" --lifecycle-binding "$status_grant"
  [ "$status" -eq 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.status !== "READY" || !e.operation || e.operation.state !== "READY") {
      process.stderr.write("root-source-status: " + JSON.stringify(e)); process.exit(1);
    }
  ' "$output"

  _s16e2e_stop_retained_plane
}

# ══════════════════════════════════════════════════════════════════════════
# SCENARIO 5: Real historical Context7/capability proof (read-only)
# ══════════════════════════════════════════════════════════════════════════

@test "WAVE1-E2E-05-HISTORICAL-EVIDENCE: the real, already-accepted Matrix 2 transaction on disk re-validates structurally and correlates end-to-end, read-only, no re-mining" {
  # NOTE: this transaction predates the context7-required pattern-evidence
  # enforcement (its own question carries an APPROVED_CONTEXT7_LIBRARY_ID
  # directive, but its durable result has pattern_evidence_dependency:null
  # and consultation_dependencies:[], and no evidence/context7.json exists on
  # disk at all -- verified directly, not assumed). This test therefore
  # validates the real, historically-accepted CORE consultation-protocol
  # capability (real dispatch -> real codex-app-server ANSWERED -> real
  # accept -> real ack, durably correlated), not Context7 evidence
  # specifically.
  local txn_dir="$BATS_TEST_DIRNAME/../../.planning/coordination/995536204e7647535786a43bed041d76c80bc4346c16d0bc98929e855099d3ff/portable-runtime-messaging-adapters/a488db2b04fec8f4bb112f48516839f5c75760c34692760ac21df48c4c3ef55d/transactions/9c6116bda67ab96808afe1aebc024fc8d9a5692d8f6a78fd3016b1a9eb9e3b8a"
  [ -d "$txn_dir" ]
  local before_digest; before_digest="$(_wave1_snapshot_tree "$txn_dir")"

  run node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const txnDir = process.argv[1];
    const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

    const reqBytes = fs.readFileSync(path.join(txnDir, "request.json"));
    const req = JSON.parse(reqBytes);
    const acceptedBytes = fs.readFileSync(path.join(txnDir, "accepted-result.json"));
    const accepted = JSON.parse(acceptedBytes);
    const ackBytes = fs.readFileSync(path.join(txnDir, "ack.json"));
    const ack = JSON.parse(ackBytes);
    const resolvedResultPath = path.join(txnDir, accepted.candidate_result_path);
    const resultBytes = fs.readFileSync(resolvedResultPath);
    const result = JSON.parse(resultBytes);

    const checks = {};
    checks.schemaRequest = req.schema === "coordination/consult/v2";
    checks.schemaResult = result.schema === "coordination/result/v2";
    checks.schemaAccepted = accepted.schema === "coordination/accepted-result/v1";
    checks.schemaAck = ack.schema === "coordination/ack/v1";
    checks.requestDigestMatchesBytes = accepted.request_digest === sha256(reqBytes);
    checks.resultDigestMatchesBytes = accepted.result_digest === sha256(resultBytes);
    checks.resultRequestDigestMatchesRequest = result.request_digest === sha256(reqBytes);
    checks.candidateResultPathMatchesAttempt = accepted.candidate_result_path === ("results/" + accepted.accepted_attempt_id + ".json");
    checks.attemptChain = result.attempt_id === req.initial_attempt_id
      && result.attempt_id === accepted.accepted_attempt_id
      && result.attempt_id === ack.in_reply_to_attempt_id;
    checks.leaseEpochChain = result.lease_epoch === req.initial_lease_epoch
      && result.lease_epoch === accepted.accepted_lease_epoch;
    checks.correlation = result.in_reply_to === req.request_id
      && result.root_request_id === req.root_request_id
      && result.from_role === req.target_role
      && result.to_role === req.source_role;
    checks.status = result.status === "ANSWERED" && ack.disposition === "accepted";
    checks.routingDigestChain = accepted.routing_policy_digest === req.routing_policy_digest
      && result.routing_policy_digest === req.routing_policy_digest;
    checks.subjectPinning = result.subject_head === req.subject_head
      && result.subject_scope_digest === req.subject_scope_digest;
    checks.driverRecorded = result.driver === "codex-app-server";

    process.stdout.write(JSON.stringify(checks));
    const allOk = Object.values(checks).every(Boolean);
    process.exit(allOk ? 0 : 1);
  ' "$txn_dir"
  local re_check_output="$output"
  local re_check_status="$status"

  local after_digest; after_digest="$(_wave1_snapshot_tree "$txn_dir")"
  [ "$before_digest" = "$after_digest" ]

  if [ "$re_check_status" -ne 0 ]; then
    echo "structural re-validation failed: $re_check_output" >&2
  fi
  [ "$re_check_status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# SCENARIO 6: Approved ingestion
# ══════════════════════════════════════════════════════════════════════════

@test "WAVE1-E2E-06-APPROVED-INGESTION: PATTERN-GAP request -> explicit user approval -> doc-updater wake -> correlated result, fully correlated by request_id" {
  local wave_dir="$PROJ/.planning/wave-$WAVE_SLUG"

  run bash -c "cd '$PROJ' && printf '{\"kind\":\"ingestion\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$WCA_SCRIPT' \
    --kind request --from context-provider --to main --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local dir="$wave_dir/requests/ingestion"
  local req_matches=("$dir"/context-provider-*.json)
  [ -f "${req_matches[0]}" ]
  local request_file="${req_matches[0]}"
  local request_id; request_id="$(basename "$request_file" .json)"
  [ "$(_wca_json_get "$request_file" schema)" = "coordination/request/v1" ]
  [ "$(_wca_json_get "$request_file" request_id)" = "$request_id" ]

  run bash -c "cd '$PROJ' && printf '{\"decision\":\"authorized\",\"request_kind\":\"ingestion\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$WCA_SCRIPT' \
    --kind approval --from main --to context-provider --re '$request_id' --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local approval_file="$wave_dir/approvals/$request_id.json"
  [ -f "$approval_file" ]
  [ "$(_wca_json_get "$approval_file" schema)" = "coordination/approval/v1" ]
  [ "$(_wca_json_get "$approval_file" decision)" = "authorized" ]
  [ "$(_wca_json_get "$approval_file" request_kind)" = "ingestion" ]
  [ "$(_wca_json_get "$approval_file" request_id)" = "$request_id" ]
  [ "$(_wca_json_get "$approval_file" approver)" = "main" ]

  # doc-updater's own wake + search/dedup/ingest/validate/write/audit is
  # production workflow logic outside this script's scope (the
  # mcp__androidcommondoc__ingest-content MCP tool is not in this agent's own
  # toolset either) -- this proves the DISK PROTOCOL doc-updater's real
  # completion write would use: a correlated result/v1, referencing this
  # exact request_id, written only after the real authorized approval above
  # already durably exists.
  run bash -c "cd '$PROJ' && printf '{\"status\":\"done\",\"ingestion_request_id\":\"$request_id\",\"ingested_disposition\":\"ingested\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$WCA_SCRIPT' \
    --kind result --from doc-updater --to context-provider --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local result_dir="$wave_dir/results/doc-updater"
  local result_matches=("$result_dir"/doc-updater-*.json)
  [ -f "${result_matches[0]}" ]
  local result_file="${result_matches[0]}"
  [ "$(_wca_json_get "$result_file" schema)" = "coordination/result/v1" ]
  [ "$(_wca_json_get "$result_file" status)" = "done" ]
  [ "$(_wca_json_get "$result_file" ingestion_request_id)" = "$request_id" ]
  [ "$(_wca_json_get "$result_file" from)" = "doc-updater" ]
  [ "$(_wca_json_get "$result_file" to)" = "context-provider" ]

  # Second, equivalent ingestion request -> deduplication path (BACKLOG.md:
  # "a second equivalent ingestion must take the deduplication path"). This
  # proves only that a genuinely NEW request_id is minted for the second
  # attempt (never silently reusing the first's own request_id/approval);
  # the dedup DECISION itself (same content -> no new doc write) lives in
  # doc-updater's own production workflow, outside this generic writer's scope.
  run bash -c "cd '$PROJ' && printf '{\"kind\":\"ingestion\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$WCA_SCRIPT' \
    --kind request --from context-provider --to main --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local req_matches_2=("$dir"/context-provider-*.json)
  [ "${#req_matches_2[@]}" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# SCENARIO 7: Denial/zero-write
# ══════════════════════════════════════════════════════════════════════════

@test "WAVE1-E2E-07A-INGESTION-ZERO-WRITE-NO-APPROVAL: an ingestion request with NO approval yet produces zero documentation/result writes beyond the request record itself" {
  local wave_dir="$PROJ/.planning/wave-$WAVE_SLUG"
  local before; before="$(_wave1_snapshot_tree "$wave_dir")"

  run bash -c "cd '$PROJ' && printf '{\"kind\":\"ingestion\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$WCA_SCRIPT' \
    --kind request --from context-provider --to main --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]

  local after; after="$(_wave1_snapshot_tree "$wave_dir")"
  [ "$before" != "$after" ]
  [ ! -d "$wave_dir/results" ]
  [ ! -d "$wave_dir/approvals" ]

  # A second snapshot after a bounded, deliberate wait -- proves nothing else
  # (no background process, no lifecycle wake) reacts to an unapproved
  # ingestion request on its own.
  sleep 1
  local after_wait; after_wait="$(_wave1_snapshot_tree "$wave_dir")"
  [ "$after" = "$after_wait" ]
  [ ! -d "$wave_dir/results" ]
}

@test "WAVE1-E2E-07B-INGESTION-ZERO-WRITE-DENIED: an explicitly denied ingestion approval still produces zero documentation/result writes -- only the request+denial records exist" {
  local wave_dir="$PROJ/.planning/wave-$WAVE_SLUG"

  run bash -c "cd '$PROJ' && printf '{\"kind\":\"ingestion\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$WCA_SCRIPT' \
    --kind request --from context-provider --to main --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local dir="$wave_dir/requests/ingestion"
  local matches=("$dir"/context-provider-*.json)
  [ -f "${matches[0]}" ]
  local request_id; request_id="$(basename "${matches[0]}" .json)"

  run bash -c "cd '$PROJ' && printf '{\"decision\":\"denied\",\"request_kind\":\"ingestion\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$WCA_SCRIPT' \
    --kind approval --from main --to context-provider --re '$request_id' --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local approval_file="$wave_dir/approvals/$request_id.json"
  [ -f "$approval_file" ]
  [ "$(_wca_json_get "$approval_file" decision)" = "denied" ]

  local after_denial; after_denial="$(_wave1_snapshot_tree "$wave_dir")"
  [ ! -d "$wave_dir/results" ]

  sleep 1
  local after_wait; after_wait="$(_wave1_snapshot_tree "$wave_dir")"
  [ "$after_denial" = "$after_wait" ]
  [ ! -d "$wave_dir/results" ]
}

# ══════════════════════════════════════════════════════════════════════════
# SCENARIO 8: Reuse
# ══════════════════════════════════════════════════════════════════════════

@test "WAVE1-E2E-08-ENSURE-REUSE: calling ensure twice for the same roles/session reuses the same retained worker -- no second spawn, no new supervisor-start action" {
  local session_id="wave1e2e-reuse-session"
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "$session_id"
  local first_pid="$S16E2E_BG_PID"
  [ -n "$first_pid" ]
  kill -0 "$first_pid" 2>/dev/null

  local -a role_flags=()
  local r
  for r in ${S16E2E_SUPPORT_ROLES//,/ }; do role_flags+=(--role "$r"); done
  local ensure_cmd_2; ensure_cmd_2="$(_render_posix_direct node "$RLL_IMPL" ensure --project-root "$PROJ" "${role_flags[@]}")"
  _make_input "$ensure_cmd_2" "" "$session_id"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local lifecycle_grant_2; lifecycle_grant_2="$(_extract_injected lifecycle-binding)"
  [ -n "$lifecycle_grant_2" ]
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["codex-app-server"]' node "$RLL_IMPL" ensure --project-root "$PROJ" "${role_flags[@]}" --lifecycle-binding "$lifecycle_grant_2"
  [ "$status" -eq 0 ]
  local second_ensure_out="$output"
  node -e '
    const out = JSON.parse(process.argv[1]);
    const spawnAction = (out.actions || []).find((a) => a.kind === "supervisor-start");
    if (spawnAction) { process.stderr.write("second ensure minted a NEW supervisor-start action for an already-READY role set: " + JSON.stringify(spawnAction)); process.exit(1); }
  ' "$second_ensure_out"

  kill -0 "$first_pid" 2>/dev/null
  [ "$S16E2E_BG_PID" = "$first_pid" ]
  local live; live="$(node -e '
    const rbc = require(process.argv[1]);
    const rll = require(process.argv[3]);
    const l = rbc.resolveLiveCodexAppServerWorker(process.argv[2], "arch-platform", rll.roleProfileDigestFor("arch-platform"));
    process.stdout.write(JSON.stringify(l));
  ' "$LIB_DIR/runtime-bridge-codex.cjs" "$PROJ" "$RLL_IMPL")"
  [[ "$live" == *'"available":true'* ]]

  _s16e2e_stop_retained_plane
}

# ══════════════════════════════════════════════════════════════════════════
# SCENARIO 9: Restart
# ══════════════════════════════════════════════════════════════════════════

@test "WAVE1-E2E-09-RESTART-REDISCOVERY: the retained codex-app-server worker's own liveness is rediscoverable independent of any particular session, and survives untouched when a concurrent different session's own ensure for the same roles is correctly quarantined rather than silently merged" {
  local session_a="wave1e2e-restart-session-a"
  S16E2E_BG_PID=""
  _s16e2e_start_retained_plane "$session_a"
  local pid_a="$S16E2E_BG_PID"
  [ -n "$pid_a" ]

  # resolveLiveCodexAppServerWorker itself takes no session argument at all
  # (projectRoot + role + roleProfileDigest only) -- worker liveness is
  # already, by construction, a session-independent fact. This is the
  # concrete mechanism behind BACKLOG.md's "a healthy retained worker may be
  # rediscovered": ANY caller, in ANY session, can positively observe this
  # SAME live worker without needing to have been the one that started it.
  local live_before; live_before="$(node -e '
    const rbc = require(process.argv[1]);
    const rll = require(process.argv[3]);
    const l = rbc.resolveLiveCodexAppServerWorker(process.argv[2], "arch-platform", rll.roleProfileDigestFor("arch-platform"));
    process.stdout.write(JSON.stringify(l));
  ' "$LIB_DIR/runtime-bridge-codex.cjs" "$PROJ" "$RLL_IMPL")"
  [[ "$live_before" == *'"available":true'* ]]

  # A genuinely different session (never session_a's own in-memory handle)
  # asking `ensure` for the SAME roles while session_a's own claim is still
  # nominally current is empirically, correctly QUARANTINED (UNAVAILABLE/
  # CAPABILITY_UNAVAILABLE), never silently handed session A's live binding
  # or treated as an ambiguous merge -- confirmed by a direct run against
  # this exact fixture. This matches BACKLOG.md's own "Idle, dead, and
  # ambiguous are distinct states" / "ambiguous/multiple owners are
  # quarantined rather than guessed": two concurrently-current sessions for
  # the same role set is the ambiguous case, distinct from a genuine restart
  # (where the OLD session's own claim would first go dead/expired).
  local session_b="wave1e2e-restart-session-b"
  local -a role_flags=()
  local r
  for r in ${S16E2E_SUPPORT_ROLES//,/ }; do role_flags+=(--role "$r"); done
  local ensure_cmd_b; ensure_cmd_b="$(_render_posix_direct node "$RLL_IMPL" ensure --project-root "$PROJ" "${role_flags[@]}")"
  _make_input "$ensure_cmd_b" "" "$session_b"
  _run_cp_hook
  [ "$status" -eq 0 ]
  local lifecycle_grant_b; lifecycle_grant_b="$(_extract_injected lifecycle-binding)"
  [ -n "$lifecycle_grant_b" ]
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" node "$RLL_IMPL" ensure --project-root "$PROJ" "${role_flags[@]}" --lifecycle-binding "$lifecycle_grant_b"
  [ "$status" -ne 0 ]
  node -e '
    const e = JSON.parse(process.argv[1]);
    if (e.ok !== false || e.status !== "UNAVAILABLE" || e.detail_code !== "CAPABILITY_UNAVAILABLE") {
      process.stderr.write("expected the concurrent-session claim to be quarantined as UNAVAILABLE/CAPABILITY_UNAVAILABLE, got: " + JSON.stringify(e)); process.exit(1);
    }
  ' "$output"

  # Crucially: the retained worker itself is UNTOUCHED by this rejected
  # concurrent claim -- same PID, still genuinely live -- proving the
  # quarantine protects the worker rather than tearing it down, and that its
  # own liveness remains rediscoverable afterward exactly as before.
  kill -0 "$pid_a" 2>/dev/null
  [ "$S16E2E_BG_PID" = "$pid_a" ]
  local live_after; live_after="$(node -e '
    const rbc = require(process.argv[1]);
    const rll = require(process.argv[3]);
    const l = rbc.resolveLiveCodexAppServerWorker(process.argv[2], "arch-platform", rll.roleProfileDigestFor("arch-platform"));
    process.stdout.write(JSON.stringify(l));
  ' "$LIB_DIR/runtime-bridge-codex.cjs" "$PROJ" "$RLL_IMPL")"
  [[ "$live_after" == *'"available":true'* ]]

  _s16e2e_stop_retained_plane
}

# ══════════════════════════════════════════════════════════════════════════
# SCENARIO 10: Cleanup
# ══════════════════════════════════════════════════════════════════════════

@test "WAVE1-E2E-10-CLEANUP: the cleanup CLI command runs successfully against a terminal (cancelled) transaction, preserves the durable record, and is idempotent" {
  # Ordinary requester, via the same test-only grant wrapper scenario 2 uses
  # -- "main" (empty agent_type) can mint a --lifecycle-binding grant but can
  # never satisfy CLAUDE-ID-01 (no SubagentStart is ever observed for it), so
  # it can never mint a --requester-binding grant for CONSULTATION_CLI
  # commands like publish-request/cancel/cleanup through the real hook
  # (confirmed by a direct run against this exact fixture); the fixture
  # wrapper is this codebase's own established vehicle for an ordinary,
  # non-agent-spawn-bound requester.
  local session_id="wave1e2e-cleanup-session"
  _wave1_prime_session_binding "$session_id"

  local subject_bundle; subject_bundle="$(_wave1_write_subject_bundle)"
  local plan_path; plan_path="$(node -e 'process.stdout.write(require(process.argv[1]).discoverPlan(process.argv[2]).planPath)' "$RLL_IMPL" "$PROJ")"
  [ -n "$plan_path" ]

  local intent; intent="$(node -e '
    process.stdout.write(Buffer.from(JSON.stringify({
      target_role: "arch-testing",
      question: "WAVE1-E2E-10-CLEANUP fixture question.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
      expiry: new Date(Date.now() + 1800000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    }), "utf8").toString("base64url"));
  ')"
  local coord_root="$PROJ/.planning/coordination"
  mkdir -p "$coord_root"
  chmod 0700 "$coord_root"
  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_SESSION="$session_id" \
    node "$S16_RETAINED_FIXTURE" publish-request --coordination-root "$coord_root" --plan "$plan_path" --subject-bundle "$subject_bundle" --intent "$intent"
  [ "$status" -eq 0 ]
  local request_path; request_path="$(node -e 'const e=JSON.parse(process.argv[1]); if (e.status !== "SUCCESS") process.exit(1); process.stdout.write(e.artifact_ref)' "$output")"
  [ -f "$request_path" ]
  local txn_dir; txn_dir="$(dirname "$request_path")"

  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_SESSION="$session_id" \
    node "$S16_RETAINED_FIXTURE" cancel --coordination-root "$coord_root" --request "$request_path" --reason explicit
  [ "$status" -eq 0 ]
  [ -f "$txn_dir/cancel.json" ]

  local before; before="$(_wave1_snapshot_tree "$txn_dir")"
  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_SESSION="$session_id" \
    node "$S16_RETAINED_FIXTURE" cleanup --coordination-root "$coord_root" --request "$request_path"
  [ "$status" -eq 0 ]
  local after; after="$(_wave1_snapshot_tree "$txn_dir")"
  echo "# WAVE1-E2E-10-CLEANUP before: $before" >&2
  echo "# WAVE1-E2E-10-CLEANUP after:  $after" >&2

  # The durable terminal record (request.json + cancel.json, the whole
  # authoritative account of this consultation) must survive cleanup.
  [ -f "$request_path" ]
  [ -f "$txn_dir/cancel.json" ]

  # Idempotent: cleaning an already-cleaned transaction is a no-op.
  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$S16E2E_LC_CAPABILITY" RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_SESSION="$session_id" \
    node "$S16_RETAINED_FIXTURE" cleanup --coordination-root "$coord_root" --request "$request_path"
  [ "$status" -eq 0 ]
  local after_2; after_2="$(_wave1_snapshot_tree "$txn_dir")"
  [ "$after" = "$after_2" ]
}
