#!/usr/bin/env node
'use strict';

// M7 LIFECYCLE -- ATOMIC REVOCATION PREP + NODE HARNESS CONTAINMENT (2026-08-16),
// PART A: must be the FIRST require in this file, before any require of
// runtime-role-lifecycle.cjs/runtime-bridge-codex.cjs -- see that file's own
// doc comment for why (registryBaseDir() is os.tmpdir()-rooted and shared
// with real production registry data on this machine without this).
require('./lib/private-registry-tmpdir-preload.cjs');

// WP2 Node-side CLI conformance complement for the portable runtime-consultation
// core, Wave 1 (portable-runtime-messaging-adapters) -- PLAN.md "Frozen Production
// CLI ABI (no WP2 naming latitude)" (~L750-796).
//
// CLI under test: node scripts/lib/runtime-consultation.cjs <subcommand> ... (same
// binary as runtime-consultation-cli.bats / runtime-consultation-protocol.bats).
// THIS file is the PROGRAMMATIC complement to runtime-consultation-cli.bats: it
// exercises the CLI via `child_process.spawnSync` from a Node harness (not a shell
// invocation) and asserts the `coordination/cli-result/v1` stdout envelope + exit
// codes with the same rigor, run via `node --test` (Node's built-in test runner;
// `mcp-server/package.json` floor is `>=18`). It deliberately does not duplicate
// every one of the bats file's 30 cases -- it covers the same closed-ABI surface
// (structural envelope shape, one representative case per status/rc, the
// determinism/test-capability gate, and two of the WP2-new verbs round-tripping
// their cli-result shape end-to-end) as an independent, second-harness check.
// Single-owner per this task's dispatch: test-specialist authors/owns this file.
//
// House style matches this repo's existing scripts/tests/*.test.js files
// (context-provider-gate.test.js, hook-control-plane-utils.test.js): CommonJS
// `require`, `node:assert`, `child_process.spawnSync`, `os.tmpdir()` fixtures --
// with one deliberate addition: this file uses `node:test`'s own `test()` (plus a
// TestContext `.skip()` for one best-effort case) rather than a flat top-level
// assert script. A flat script aborts entirely at the FIRST thrown assertion
// (acceptable for those simpler single-purpose files); this file is explicitly a
// multi-case CONFORMANCE SUITE where each case must be independently reported
// (pass/fail), matching the bats file's own per-`@test` ok/not-ok model.
//
// GROUND TRUTH AT AUTHORING TIME (empirically verified against the real binary on
// this machine, never assumed): `bats scripts/tests/runtime-consultation-cli.bats`
// is 29/30 green -- NOT the 30/30 this task's own dispatch text asserted, and NOT
// the "16 RED / 14 GREEN" the bats file's own header docstring documents (that
// docstring is stale: it recorded the state at ITS OWN authoring time; most of
// those historical gaps are already fixed in the current binary). The one
// reproducible failure (RCC-determinism-3, confirmed 3/3 standalone runs, not
// flaky) was root-caused during this file's authoring: `_iso_plus_seconds()`'s
// BSD/macOS fallback --
// `date -j -f '%Y-%m-%dT%H:%M:%SZ' "${base}" -v"+${n}S" '+%Y-%m-%dT%H:%M:%SZ'` --
// places `-v"+${n}S"` AFTER the positional date string, which THIS machine's
// `/bin/date` silently mis-parses once a positional argument has been consumed: it
// drops both the offset and the output format, printing today's real current date
// in ctime format instead of the intended ISO-8601 string (confirmed by isolating
// each fallback branch directly: the GNU branch correctly fails fast with exit 1
// "illegal option -- d", so the BSD branch DOES run, but produces the wrong
// output; reordering `-v"+${n}S"` BEFORE `-f fmt` fixes it). That garbled string
// then correctly fails the CLI's own `isIsoTimestamp` intent-field check
// (SCHEMA_INVALID) -- this is a BATS FIXTURE bug, not a `runtime-consultation.cjs`
// conformance gap. It is invisible in every other bats case because every other
// caller of `_iso_plus_seconds` either never reaches intent-decoding (the
// capability-gate/argv-cap checks that dominate the other determinism/caps cases
// short-circuit first, before the intent's `expiry` field is ever validated) or
// never round-trips the value through `isIsoTimestamp` at all (raw fixture writes
// just embed whatever string was produced, and the commands exercised against
// those raw fixtures never re-validate that specific field's format). This file
// computes every `expiry` via Node's own `Date.toISOString()` (correct by
// construction, no shell `date` involved), so its own positive fixed-ids/
// fixed-clock case is not expected to reproduce that bug -- confirmed empirically
// below (see the determinism test group) and via direct CLI probing during
// authoring (a hand-built `publish-request --fixed-ids --fixed-clock` call with a
// Node-computed expiry succeeded end-to-end). Reported to arch-testing/
// team-lead per the "no fabrication" duty; NOT fixed here -- out of this file's
// single-owned scope (runtime-consultation-cli.bats is a different, unowned file
// for this task).
//
// M6+M7 requester-authority closure (2026-08-10, Group I -- CLI stale
// expectation): the dispatch/driver-selection test below no longer resolves
// to `noop` in this checkout -- cmdDispatch's own driver selection now tries
// every routing-permitted candidate in order and genuinely selects
// `claude-agent` once `checkClaudeAgentCapabilityAvailable` reports
// available:true, which is currently, empirically true for this checkout
// (confirmed directly against the real `.claude/settings.json`). See that
// test's own comment for the full, current-state rationale.

const assert = require('node:assert');
const { test } = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IMPL = path.resolve(__dirname, '../lib/runtime-consultation.cjs');
// M7/WP4 Phase B.3 regression fixture (dispatch arch-testing-20260809T092330Z):
// root-init/root-validate/claim/lease-heartbeat/publish-result/worker-stop-ack
// are now grant-mandatory (PLAN.md §15b); this suite predates that
// requirement. Unlike the sibling .bats files, IMPL here is ALSO used for
// `require(IMPL)` (the R33 gated-exports tests below), so it is deliberately
// left untouched -- only spawnCli's own subprocess invocation is redirected
// through GRANT_WRAPPER, which mints a REAL, correctly-scoped grant matching
// whatever argv is actually sent (deriving worktree scope from --coordination-root
// itself when no RCC_GRANT_PROJECT_ROOT is set -- see
// scripts/tests/fixtures/runtime-consultation-grant-wrapper.cjs's own header)
// and is otherwise a byte-for-byte passthrough to IMPL.
const GRANT_WRAPPER = path.resolve(__dirname, 'fixtures/runtime-consultation-grant-wrapper.cjs');
const TEST_CAPABILITY = 'rcc-node-test-fixture-capability';
const OMIT = '__OMIT__';

// ─────────────────────────────────────────────────────────────────────────────
// Harness test-capability, set ONCE and BEFORE the first `require(IMPL)`.
//
// The R33 export surface sits behind `isTestCapability()` (`NODE_ENV=test` plus a
// non-empty `RUNTIME_CONSULTATION_TEST_CAPABILITY`), and that gate is evaluated at
// REQUIRE time. Every `require(IMPL)` in this file is inside a test body, so
// setting these here -- above all of them -- is what keeps the gated exports
// reachable. Doing it once beats threading env through 13 call sites.
//
// WHY THIS CANNOT WEAKEN THE GATE-UNSATISFIED TESTS -- verified, not assumed,
// because a process-wide NODE_ENV is exactly the kind of change that quietly
// disarms a negative test. `spawnCli` assigns overrides over `process.env` and
// then DELETES every key whose value is `undefined`, so a child told
// `NODE_ENV: undefined` / `RUNTIME_CONSULTATION_TEST_CAPABILITY: undefined`
// receives neither, regardless of what the parent holds. Measured with the parent
// set:
//     runTestCli-style       -> {NODE_ENV:"test", CAP:"rcc-node-test-fixture-capability"}
//     runProductionCli-style -> {NODE_ENV:null,   CAP:null}
// All three deliberately-unsatisfied sites (`runProductionCli`, the ACL-probe
// case, and the NODE_ENV-without-capability case) pass the relevant vars as
// `undefined`, so all three still exercise a genuinely ungated CLI.
//
// Note the corollary: a `spawnCli` call that passes NO override now inherits
// these. That is correct for this file -- such calls are test-mode invocations --
// but a future negative test MUST clear them explicitly rather than relying on the
// ambient environment being clean.
// ─────────────────────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY = TEST_CAPABILITY;

// M6+M7 requester-authority closure (Group I): required AFTER the harness
// test-capability env vars above, never before -- runtime-role-lifecycle.cjs
// transitively `require()`s IMPL itself (see that file's own "circular
// import" note), so requiring it any earlier would create/cache the R33
// gated-export module BEFORE isTestCapability() can see these vars,
// permanently hiding the gated exports from every later require(IMPL) in
// this same process (Node module caching) -- confirmed empirically: this
// exact ordering mistake broke R33-GV-1/2/3/CORR-COVERAGE/CORR-MUTATION.
const rll = require(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'));
// M7 GREEN correction round 2, R5: same ordering-sensitivity as rll above
// (isTestCapability() gated exports) -- required immediately adjacent, never
// earlier, for the identical reason.
const rc = require(path.resolve(__dirname, '../lib/runtime-consultation.cjs'));

// Closed `coordination/cli-result/v1` shape (Frozen CLI ABI, PLAN.md ~L779-781).
const CLI_RESULT_KEYS = [
  'schema', 'command', 'ok', 'status', 'code',
  'request_id', 'artifact_ref', 'detail_code', 'content_ref', 'activation_action',
].sort();

const STATUS_ENUM = [
  'SUCCESS', 'USAGE_ERROR', 'INVALID', 'UNAVAILABLE', 'TIMEOUT',
  'BLOCKED', 'CANCELLED', 'CONFLICT', 'INTERNAL',
];

const RC_FOR_STATUS = {
  SUCCESS: 0, USAGE_ERROR: 2, INVALID: 3, UNAVAILABLE: 4, TIMEOUT: 5,
  BLOCKED: 6, CANCELLED: 6, CONFLICT: 6, INTERNAL: 7,
};

const DETAIL_CODE_ENUM = [
  'NONE', 'UNKNOWN_COMMAND', 'MISSING_ARGUMENT', 'DUPLICATE_ARGUMENT',
  'INVALID_ARGUMENT', 'SCHEMA_INVALID', 'CORRELATION_INVALID', 'AUTHORITY_INVALID',
  'SECURITY_INVALID', 'DRIVER_UNAVAILABLE', 'DEADLINE_EXCEEDED', 'RESULT_BLOCKED',
  'TRANSACTION_CANCELLED', 'RESULT_CONFLICT', 'DURABILITY_UNPROVEN', 'INTERNAL_ERROR',
  // M67-MATRIX3-LIVENESS-REPAIR-FINAL-20260821: await-result liveness awareness.
  'WORKER_LEASE_EXPIRED', 'WORKER_LEASE_MISSING', 'WORKER_NOT_CLAIMED', 'REQUEST_EXPIRED',
];

// ─────────────────────────────────────────────────────────────────────────────
// Low-level helpers
// ─────────────────────────────────────────────────────────────────────────────

function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

function execGitCapture(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ' failed: ' + r.stderr);
  return r.stdout.trim();
}

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
  execGitCapture(dir, ['init', '-q']);
  execGitCapture(dir, ['config', 'user.email', 'rcc-node-test@test.local']);
  execGitCapture(dir, ['config', 'user.name', 'RCC Node Test']);
  execGitCapture(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function planFileFor(projDir, waveSlug) {
  const dir = path.join(projDir, '.planning', 'wave-' + waveSlug);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'PLAN.md');
  fs.writeFileSync(p, '# fixture plan for runtime-consultation-cli.test.js\n');
  return p;
}

function subjectBundleFileFor(projDir, entries) {
  const p = path.join(projDir, '.planning', 'coordination-subject-bundle-manifest.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({
    schema: 'coordination/subject-bundle-manifest/v1',
    entries: entries || [],
  }));
  return p;
}

function base64urlIntent(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function isoInFuture(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function computeRepoId(projDir) {
  const commonDir = execGitCapture(projDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return sha256Hex(fs.realpathSync(commonDir));
}

function computeWorktreeId(projDir) {
  const toplevel = execGitCapture(projDir, ['rev-parse', '--show-toplevel']);
  return sha256Hex(fs.realpathSync(toplevel));
}

function computeSubjectHead(projDir) {
  return execGitCapture(projDir, ['rev-parse', 'HEAD']);
}

function computeCoordRootId(coordRoot) {
  return sha256Hex(fs.realpathSync(coordRoot));
}

function planRootPathFor(coordRoot, repoId, waveSlug, planDigest) {
  return path.join(coordRoot, repoId, waveSlug, planDigest);
}

function requestPathFor(planRoot, requestId) {
  return path.join(planRoot, 'transactions', requestId, 'request.json');
}

function resultPathFor(planRoot, requestId, attemptId) {
  return path.join(planRoot, 'transactions', requestId, 'results', attemptId + '.json');
}

/**
 * Spawns the real CLI binary via `spawnSync` (never fabricated). `envOverrides`
 * keys set to `undefined` are DELETED from the child's environment (used to
 * simulate a genuine production invocation that clears any ambient
 * NODE_ENV/RUNTIME_CONSULTATION_TEST_CAPABILITY/RUNTIME_CONSULTATION_ACL_PROBE).
 */
function spawnCli(args, envOverrides) {
  const env = Object.assign({}, process.env, envOverrides || {});
  for (const k of Object.keys(env)) {
    if (env[k] === undefined) delete env[k];
  }
  return spawnSync(process.execPath, [GRANT_WRAPPER, ...args], { env, encoding: 'utf8' });
}

function runTestCli(args) {
  return spawnCli(args, { NODE_ENV: 'test', RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY });
}

/** Genuine production invocation: explicitly clears all three gated env vars. */
function runProductionCli(args) {
  return spawnCli(args, {
    NODE_ENV: undefined,
    RUNTIME_CONSULTATION_TEST_CAPABILITY: undefined,
    RUNTIME_CONSULTATION_ACL_PROBE: undefined,
  });
}

function parseSingleJsonStdout(stdoutRaw) {
  const lines = stdoutRaw.split('\n');
  assert.strictEqual(lines.length, 2,
    'stdout must be exactly one JSON line plus one trailing newline (no prose/second line); got: ' + JSON.stringify(stdoutRaw));
  assert.strictEqual(lines[1], '', 'stdout must end with exactly one trailing newline');
  const firstBytes = Buffer.from(stdoutRaw, 'utf8').subarray(0, 3).toString('hex');
  assert.notStrictEqual(firstBytes, 'efbbbf', 'stdout must not start with a UTF-8 BOM');
  let data;
  try {
    data = JSON.parse(lines[0]);
  } catch (err) {
    assert.fail('stdout line is not valid JSON: ' + err.message + ' -- raw: ' + JSON.stringify(lines[0]));
  }
  return data;
}

function assertStderrHasNoBareJson(stderrRaw) {
  if (!stderrRaw) return;
  let parsedOk = true;
  try {
    JSON.parse(stderrRaw);
  } catch (err) {
    parsedOk = false;
  }
  assert.strictEqual(parsedOk, false, 'stderr must never itself be a bare JSON object (diagnostics only); got: ' + stderrRaw);
}

/**
 * Asserts `result` (a spawnSync() return value) is a well-formed
 * `coordination/cli-result/v1` envelope matching `expected.command`/`expected.status`
 * (and `expected.detail_code` when given). Every call unconditionally enforces:
 * the exact closed key set (additionalProperties:false), the literal schema, the
 * closed status enum, ok===(status===SUCCESS), code matching BOTH the closed
 * rc-for-status map AND the actual process exit code, the closed detail_code enum,
 * the "NONE is legal only with success" invariant, and string-or-null /
 * object-or-null shapes for the four nullable fields. Returns the parsed object so
 * callers can make additional case-specific assertions (e.g. content_ref shape).
 */
function assertCliResult(result, expected) {
  const data = parseSingleJsonStdout(result.stdout);
  assertStderrHasNoBareJson(result.stderr);

  assert.deepStrictEqual(Object.keys(data).sort(), CLI_RESULT_KEYS,
    'coordination/cli-result/v1 must have EXACTLY the closed key set (additionalProperties:false)');
  assert.strictEqual(data.schema, 'coordination/cli-result/v1');
  assert.strictEqual(data.command, expected.command);
  assert.ok(STATUS_ENUM.includes(data.status), 'status must be a member of the closed enum, got: ' + data.status);
  assert.strictEqual(
    data.status,
    expected.status,
    'unexpected CLI envelope: ' + JSON.stringify(data) + (result.stderr ? ' stderr=' + result.stderr : ''),
  );
  assert.strictEqual(typeof data.ok, 'boolean');
  assert.strictEqual(data.ok, data.status === 'SUCCESS', 'ok must be exactly (status === SUCCESS)');

  const expectedRc = RC_FOR_STATUS[expected.status];
  assert.strictEqual(data.code, expectedRc, 'code must match the closed rc-for-status mapping');
  assert.strictEqual(result.status, expectedRc, 'the actual process exit code must equal the envelope code');

  assert.ok(DETAIL_CODE_ENUM.includes(data.detail_code), 'detail_code must be a member of the closed enum, got: ' + data.detail_code);
  if (data.status !== 'SUCCESS') {
    assert.notStrictEqual(data.detail_code, 'NONE', 'NONE is legal only with a SUCCESS envelope (frozen ABI, PLAN.md ~L781)');
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'detail_code')) {
    assert.strictEqual(data.detail_code, expected.detail_code);
  }

  assert.ok(data.request_id === null || typeof data.request_id === 'string', 'request_id must be string-or-null');
  assert.ok(data.artifact_ref === null || typeof data.artifact_ref === 'string', 'artifact_ref must be string-or-null');
  assert.ok(data.content_ref === null || typeof data.content_ref === 'object', 'content_ref must be object-or-null');
  assert.ok(data.activation_action === null || typeof data.activation_action === 'object', 'activation_action must be object-or-null');
  return data;
}

function assertContentRefShape(contentRef, expectedDigestHex, expectedSize) {
  assert.ok(contentRef && typeof contentRef === 'object', 'content_ref must be a non-null object on publish-blob success');
  assert.deepStrictEqual(Object.keys(contentRef).sort(), ['blob', 'digest', 'size'],
    'content_ref must have EXACTLY {blob,size,digest} (Frozen CLI ABI, PLAN.md ~L779)');
  assert.match(contentRef.blob, /^[0-9a-f]{64}$/, 'content_ref.blob must be a 64-char lowercase-hex sha256');
  assert.strictEqual(contentRef.blob, contentRef.digest, 'content_ref.blob and content_ref.digest must be the identical sha256');
  assert.strictEqual(contentRef.blob, expectedDigestHex);
  assert.strictEqual(contentRef.size, expectedSize);
  assert.ok(Number.isInteger(contentRef.size) && contentRef.size >= 0 && contentRef.size <= 10485760,
    'content_ref.size must be an integer in 0..10485760');
}

/**
 * Builds a fresh git-backed fixture project + a root-init'd coordination root +
 * every identity field (repoId/worktreeId/planDigest/coordRootId/subjectHead) a raw
 * request/result fixture needs -- same idiom as runtime-consultation-cli.bats's own
 * `setup()` + `_compute_repo_id`/`_compute_worktree_id`, ported to Node. Calls
 * `fn(ctx)` synchronously and ALWAYS cleans up the temp project afterward (even on
 * assertion failure) -- deliberately scoped per-call (not shared across test()
 * blocks) so cleanup timing cannot race node:test's own scheduling of deferred
 * test bodies.
 */
function withProject(waveSlug, fn) {
  const projDir = makeTempProject();
  try {
    const coordRoot = path.join(projDir, '.planning', 'coordination');
    const planPath = planFileFor(projDir, waveSlug);
    const subjectBundlePath = subjectBundleFileFor(projDir, []);
    const initResult = runTestCli(['root-init', '--coordination-root', coordRoot]);
    assert.strictEqual(initResult.status, 0, 'fixture root-init must succeed: ' + initResult.stdout + initResult.stderr);

    const ctx = {
      projDir,
      coordRoot,
      planPath,
      subjectBundlePath,
      waveSlug,
      repoId: computeRepoId(projDir),
      worktreeId: computeWorktreeId(projDir),
      planDigest: sha256Hex(fs.readFileSync(planPath)),
      coordRootId: computeCoordRootId(coordRoot),
      subjectHead: computeSubjectHead(projDir),
    };
    ctx.planRoot = planRootPathFor(ctx.coordRoot, ctx.repoId, ctx.waveSlug, ctx.planDigest);
    return fn(ctx);
  } finally {
    fs.rmSync(projDir, { recursive: true, force: true });
  }
}

/**
 * Raw `consult/v2` fixture writer (bypasses the CLI's own `publish-request` --
 * used only for cases that need a pre-existing request without exercising the
 * Ordered Runtime Loop's own materialization steps). Field defaults mirror
 * runtime-consultation-cli.bats's own `_write_request` verbatim (proven against
 * the real binary by that file's own green suite). Pass `OMIT` as a value to
 * delete a default key entirely (e.g. an omitted `content_ref`).
 */
function writeRawRequest(destPath, ctx, overrides) {
  const createdAt = new Date().toISOString();
  const defaults = {
    schema: 'coordination/consult/v2',
    request_id: 'a'.repeat(64),
    root_request_id: 'a'.repeat(64),
    parent_request_id: null,
    depth: 0,
    max_depth: 2,
    source_role: 'test-specialist',
    target_role: 'arch-testing',
    target_role_profile_version: '1.0.0',
    target_role_profile_digest: 'b'.repeat(64),
    requester_worktree_id: ctx.worktreeId,
    requester_instance_id: 'c'.repeat(64),
    repo_id: ctx.repoId,
    wave_slug: ctx.waveSlug,
    protocol_profile: 'runtime-consultation/v1',
    coordination_root_id: ctx.coordRootId,
    plan_digest: ctx.planDigest,
    subject_repo_id: ctx.repoId,
    subject_worktree_id: ctx.worktreeId,
    subject_head: ctx.subjectHead,
    subject_scope_digest: 'd'.repeat(64),
    question: 'node cli-conformance fixture question',
    expected_result_kind: 'TEST_RESULT',
    expiry: isoInFuture(1800000),
    recovery_budget: 1,
    routing_policy_version: 'runtime-routing/v1',
    routing_policy_digest: 'e'.repeat(64),
    initial_attempt_id: 'f'.repeat(64),
    initial_lease_epoch: 0,
    created_at: createdAt,
  };
  const merged = Object.assign({}, defaults, overrides);
  for (const k of Object.keys(merged)) {
    if (merged[k] === OMIT) delete merged[k];
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, JSON.stringify(merged), { mode: 0o600 });
  fs.chmodSync(destPath, 0o600);
  return merged;
}

// M6+M7 requester-authority closure (Group B/D, 2026-08-10) fixture correction:
// validateAndConsumeRoleCommandGrantForCommand (runtime-consultation.cjs) now
// cross-references a TRANSACTIONAL requester-gated grant's consumed identity
// against the request's OWN `source_role`/`requester_instance_id` fields
// (throwing AUTHORITY_INVALID on either mismatch) -- writeRawRequest's own
// DEFAULT `source_role:'test-specialist'`/`requester_instance_id:'c'.repeat(64)`
// are arbitrary placeholders that can never match a genuinely-minted grant's
// real backing binding, so ANY test combining a raw writeRawRequest fixture
// with a transactional requester-gated command (cancel/dispatch/await-result/
// accept-result/...) run through the grant-wrapper now needs a KNOWN,
// REAL identity instead. Mints (or idempotently reuses, via
// createRequesterBinding's own lookup-or-create semantics) the EXACT
// RequesterBinding the grant-wrapper itself will mint/reuse for its OWN
// default identity tuple (session='rcc-grant-wrapper-session', agent=
// 'runtime-consultation-grant-wrapper-agent', role=role||'arch-testing') --
// so a raw fixture's source_role/requester_instance_id genuinely correlates
// with whatever grant the wrapper mints later for the SAME tuple. Never
// touches writeRawRequest's own shared default (zero risk to the many other
// tests that already pass against it unmodified) -- each affected test opts
// in explicitly via `Object.assign({...}, knownRequesterIdentity(ctx))`.
function knownRequesterIdentity(ctx, role) {
  const grantRole = role || 'arch-testing';
  // M6+M7 FULL CLOSURE (2026-08-11): defaults to codex-supervisor, mirroring
  // runtime-consultation-grant-wrapper.cjs's own RCC_GRANT_PROVIDER default --
  // must stay in lockstep with it (a different provider mints a DIFFERENT
  // actor_instance_id, breaking the whole-point convergence this helper
  // exists for) -- every one of this helper's callers tests generic
  // grant/artifact-correlation mechanics, never CLAUDE-ID-01-adjacent identity.
  const identity = { ok: true, provider: process.env.RCC_GRANT_PROVIDER || 'codex-supervisor', runtime_session_key: 'rcc-grant-wrapper-session' };
  const bindingResult = rll.createRequesterBinding(
    ctx.projDir, identity, 'runtime-consultation-grant-wrapper-agent', grantRole, ctx.worktreeId, ctx.planDigest, 3600
  );
  assert.strictEqual(bindingResult.ok, true, 'knownRequesterIdentity fixture: requester binding mint must succeed: ' + JSON.stringify(bindingResult));
  return { source_role: grantRole, requester_instance_id: bindingResult.binding.actor_instance_id };
}

/** Raw `result/v2` fixture writer -- mirrors `_write_result` verbatim (same proof basis as writeRawRequest above). */
function writeRawResult(destPath, ctx, overrides) {
  const createdAt = new Date().toISOString();
  const defaults = {
    schema: 'coordination/result/v2',
    in_reply_to: 'a'.repeat(64),
    request_digest: '0'.repeat(64),
    plan_digest: ctx.planDigest,
    repo_id: ctx.repoId,
    wave_slug: ctx.waveSlug,
    protocol_profile: 'runtime-consultation/v1',
    max_depth: 2,
    routing_policy_version: 'runtime-routing/v1',
    routing_policy_digest: 'e'.repeat(64),
    root_request_id: 'a'.repeat(64),
    parent_request_id: null,
    depth: 0,
    attempt_id: 'f'.repeat(64),
    lease_epoch: 0,
    driver: 'noop',
    claimant_instance_id: 'c'.repeat(64),
    worker_session_id: null,
    claim_digest: '1'.repeat(64),
    target_role_profile_version: '1.0.0',
    target_role_profile_digest: 'b'.repeat(64),
    from_role: 'arch-testing',
    to_role: 'test-specialist',
    result_kind: 'TEST_RESULT',
    status: 'ANSWERED',
    reason: null,
    content: 'a node cli-conformance fixture answer',
    subject_repo_id: ctx.repoId,
    subject_worktree_id: ctx.worktreeId,
    subject_head: ctx.subjectHead,
    subject_scope_digest: 'd'.repeat(64),
    consultation_dependencies: [],
    producer_worktree_id: ctx.worktreeId,
    producer_head: ctx.subjectHead,
    created_at: createdAt,
    pattern_evidence_dependency: null,
  };
  const merged = Object.assign({}, defaults, overrides);
  for (const k of Object.keys(merged)) {
    if (merged[k] === OMIT) delete merged[k];
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, JSON.stringify(merged), { mode: 0o600 });
  fs.chmodSync(destPath, 0o600);
  return merged;
}

/**
 * Recursive sha256 snapshot of every regular file under `dir` -- returns a
 * plain object {relativePath: sha256hex}. Used by the M7 RED batch-2 tests
 * below to prove "zero new artifacts" / "byte-identical, no mutation" across
 * a CLI call without needing to hardcode every internal path convention
 * (claim/active-lease/results/... subdirectory naming) ahead of time.
 */
function snapshotDirDigests(dir) {
  const out = {};
  function walk(d, rel) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (err) { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const relPath = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(full, relPath); } else if (e.isFile()) { out[relPath] = sha256Hex(fs.readFileSync(full)); }
    }
  }
  walk(dir, '');
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// One representative case per closed status/rc member (Frozen CLI ABI, PLAN.md
// ~L779-781). Enum order matches the PLAN's own literal order:
// SUCCESS|USAGE_ERROR|INVALID|UNAVAILABLE|TIMEOUT|BLOCKED|CANCELLED|CONFLICT|INTERNAL.
// ─────────────────────────────────────────────────────────────────────────────

test('SUCCESS/rc0: root-init on a fresh coordination root', () => {
  // WP3 root-confinement (RCR-confine-*): root-init now requires
  // --coordination-root to resolve inside a real git worktree, so this uses
  // makeTempProject() (git-initialized) rather than a bare mkdtemp -- a plain
  // non-git temp dir is now correctly rejected SECURITY_INVALID.
  // M7/WP4 Phase B.3 (dispatch arch-testing-20260809T092330Z): root-init is
  // now ALSO grant-mandatory (PLAN.md §15b), and grant minting scopes the
  // requester binding by plan_digest -- needs a real, discoverable PLAN.md
  // (planFileFor), which this fixture did not previously need at all.
  const dir = makeTempProject();
  try {
    planFileFor(dir, 'rcc-node-wave-rootinit-success');
    const coordRoot = path.join(dir, 'coordination');
    const result = runTestCli(['root-init', '--coordination-root', coordRoot]);
    assertCliResult(result, { command: 'root-init', status: 'SUCCESS', detail_code: 'NONE' });
    assert.ok(fs.statSync(coordRoot).isDirectory());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('USAGE_ERROR/rc2: an unrecognized subcommand -> UNKNOWN_COMMAND', () => {
  const result = runTestCli(['totally-not-a-real-subcommand-xyz']);
  assertCliResult(result, { command: 'totally-not-a-real-subcommand-xyz', status: 'USAGE_ERROR', detail_code: 'UNKNOWN_COMMAND' });
});

// M7/WP4 Phase B.3 (dispatch arch-testing-20260809T092330Z, mirrors
// runtime-consultation-cli.bats's own RCC-argv-1 fix and rationale exactly):
// root-init is now grant-mandatory (PLAN.md §15b), and the core resolves
// which worktree/PLAN scope to validate the grant against FROM
// --coordination-root itself -- when that exact flag is entirely ABSENT
// there is no way to correlate ANY grant, valid or not, before ever reaching
// the older MISSING_ARGUMENT check. NOT a weakened assertion: root-init is
// still fully, provably rejected (rc3/INVALID, no side effect) -- only the
// reason changes, because the new grant-authority gate is, by design, more
// fundamental and runs strictly before requireFlags for this exact input.
test('USAGE_ERROR/rc2: root-init with no --coordination-root at all is rejected -- INVALID/rc3/AUTHORITY_INVALID post-M7/WP4 (see comment above; was USAGE_ERROR/rc2/MISSING_ARGUMENT pre-grant)', () => {
  const result = runTestCli(['root-init']);
  assertCliResult(result, { command: 'root-init', status: 'INVALID', detail_code: 'AUTHORITY_INVALID' });
});

test('USAGE_ERROR/rc2: root-init with --coordination-root supplied twice -> DUPLICATE_ARGUMENT, no write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
  try {
    const rootA = path.join(dir, 'coordination-a');
    const rootB = path.join(dir, 'coordination-b');
    const result = runTestCli(['root-init', '--coordination-root', rootA, '--coordination-root', rootB]);
    assertCliResult(result, { command: 'root-init', status: 'USAGE_ERROR', detail_code: 'DUPLICATE_ARGUMENT' });
    assert.strictEqual(fs.existsSync(rootA), false, 'a rejected duplicate-argument call must not write anything');
    assert.strictEqual(fs.existsSync(rootB), false, 'a rejected duplicate-argument call must not write anything');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('USAGE_ERROR/rc2: a positional operand instead of --coordination-root <path> -> INVALID_ARGUMENT, no write (no positional operands exist, PLAN.md ~L752)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
  try {
    const target = path.join(dir, 'coordination-positional');
    const result = runTestCli(['root-init', target]);
    assertCliResult(result, { command: 'root-init', status: 'USAGE_ERROR', detail_code: 'INVALID_ARGUMENT' });
    assert.strictEqual(fs.existsSync(target), false, 'a rejected positional-operand call must not write anything');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('USAGE_ERROR/rc2: cancel --reason outside the closed enum -> INVALID_ARGUMENT', () => {
  withProject('rcc-node-argv-wave', (ctx) => {
    const requestPath = requestPathFor(ctx.planRoot, 'a'.repeat(64));
    writeRawRequest(requestPath, ctx, knownRequesterIdentity(ctx));
    const result = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--reason', 'not-a-real-reason']);
    assertCliResult(result, { command: 'cancel', status: 'USAGE_ERROR', detail_code: 'INVALID_ARGUMENT' });
  });
});

// ─── INVALID/rc3 ─────────────────────────────────────────────────────────────

test('INVALID/rc3: production use of --fixed-ids/--fixed-clock (no test capability) -> INVALID_ARGUMENT', () => {
  withProject('rcc-node-prod-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'production-misuse fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const result = runProductionCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64, '--fixed-ids', '--fixed-clock',
    ]);
    assertCliResult(result, { command: 'publish-request', status: 'INVALID', detail_code: 'INVALID_ARGUMENT' });
  });
});

test('INVALID/rc3: production use of RUNTIME_CONSULTATION_ACL_PROBE (no test capability, PLAN.md ~L752: same gate as --fixed-ids/--fixed-clock)', () => {
  withProject('rcc-node-acl-wave', (ctx) => {
    const result = spawnCli(['root-validate', '--coordination-root', ctx.coordRoot], {
      NODE_ENV: undefined,
      RUNTIME_CONSULTATION_TEST_CAPABILITY: undefined,
      RUNTIME_CONSULTATION_ACL_PROBE: '1',
    });
    assertCliResult(result, { command: 'root-validate', status: 'INVALID' });
  });
});

// ─── UNAVAILABLE/rc4 ─────────────────────────────────────────────────────────

test('UNAVAILABLE/rc4: dispatch against a raw request with no materialized routing policy -> DRIVER_UNAVAILABLE (Ordered Runtime Loop step 2, PLAN.md ~L803, was skipped by this raw fixture)', () => {
  withProject('rcc-node-unavail-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(requestPath, ctx, Object.assign({ request_id: requestId, root_request_id: requestId }, knownRequesterIdentity(ctx)));
    const result = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPath]);
    assertCliResult(result, { command: 'dispatch', status: 'UNAVAILABLE', detail_code: 'DRIVER_UNAVAILABLE' });
  });
});

// ─── TIMEOUT/rc5 ─────────────────────────────────────────────────────────────

test('TIMEOUT/rc5: await-result on a request with no candidate result -> DEADLINE_EXCEEDED once the bounded poll elapses', () => {
  withProject('rcc-node-timeout-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(requestPath, ctx, Object.assign({ request_id: requestId, root_request_id: requestId }, knownRequesterIdentity(ctx)));
    const result = runTestCli(['await-result', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--timeout', '1']);
    assertCliResult(result, { command: 'await-result', status: 'TIMEOUT', detail_code: 'DEADLINE_EXCEEDED' });
  });
});

// ─── BLOCKED/rc6 ─────────────────────────────────────────────────────────────

test('BLOCKED/rc6: await-result observing a current BLOCKED result/v2 candidate -> RESULT_BLOCKED', () => {
  withProject('rcc-node-blocked-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const attemptId = 'f'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(requestPath, ctx, Object.assign({ request_id: requestId, root_request_id: requestId, initial_attempt_id: attemptId }, knownRequesterIdentity(ctx)));
    const requestDigest = sha256Hex(fs.readFileSync(requestPath));

    const resultPath = resultPathFor(ctx.planRoot, requestId, attemptId);
    writeRawResult(resultPath, ctx, {
      in_reply_to: requestId,
      root_request_id: requestId,
      request_digest: requestDigest,
      attempt_id: attemptId,
      // M6+M7 requester-authority closure (Group B) fixture correction:
      // to_role must match the request's own source_role (knownRequesterIdentity's
      // default 'arch-testing', not writeRawResult's own unrelated default
      // 'test-specialist') -- cmdAwaitResult's own correlation check
      // (`obj.to_role !== reqObj.source_role`, runtime-consultation.cjs:3419)
      // now genuinely runs once grant validation succeeds.
      to_role: 'arch-testing',
      status: 'BLOCKED',
      result_kind: 'BLOCKED',
      reason: 'POLICY_DENIED',
      content: OMIT,
    });

    const result = runTestCli(['await-result', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--timeout', '1']);
    assertCliResult(result, { command: 'await-result', status: 'BLOCKED', detail_code: 'RESULT_BLOCKED' });
  });
});

// ─── CANCELLED/rc6 ───────────────────────────────────────────────────────────

test('CANCELLED/rc6: a second cancel for an already-cancelled transaction -> TRANSACTION_CANCELLED (PLAN.md ~L781: rc6 covers the observed terminal BLOCKED|CANCELLED|CONFLICT)', () => {
  withProject('rcc-node-cancelled-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    // Codex NO-GO round 8: --reason expired now requires the request's own
    // expiry to have genuinely passed -- a deliberately already-expired
    // fixture (both timestamps in the past, 1800s apart).
    writeRawRequest(requestPath, ctx, Object.assign({
      request_id: requestId,
      root_request_id: requestId,
      created_at: '2020-01-01T00:00:00.000Z',
      expiry: '2020-01-01T00:30:00.000Z',
    }, knownRequesterIdentity(ctx)));

    const first = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--reason', 'expired']);
    assertCliResult(first, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });

    const second = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--reason', 'explicit']);
    assertCliResult(second, { command: 'cancel', status: 'CANCELLED', detail_code: 'TRANSACTION_CANCELLED' });
  });
});

// ─── INTERNAL/rc7 (best-effort OS-failure proxy) ─────────────────────────────

test('INTERNAL/rc7 (best-effort): root-init under a permission-denied parent returns a well-formed rejection envelope', (t) => {
  // M7/WP4 Phase B.3 (dispatch arch-testing-20260809T092330Z): root-init is
  // now grant-mandatory -- needs a real git worktree + discoverable PLAN.md
  // (mirrors the SUCCESS/rc0 fixture's own matching comment) so grant minting
  // can succeed and this call reaches its OWN actually-intended target
  // (permission-denied directory creation), never an unrelated AUTHORITY_INVALID.
  // `git -C <lockedParent> rev-parse --show-toplevel` only needs READ+EXECUTE
  // on lockedParent to walk up to dir's own .git -- 0o555 still provides both.
  const dir = makeTempProject();
  planFileFor(dir, 'rcc-node-wave-rootinit-permdenied');
  const lockedParent = path.join(dir, 'locked-parent');
  fs.mkdirSync(lockedParent, { recursive: true });
  try {
    fs.chmodSync(lockedParent, 0o555);
    const target = path.join(lockedParent, 'nested-root');
    const result = runTestCli(['root-init', '--coordination-root', target]);
    if (result.status === 0) {
      t.skip('test runner has root/bypass privileges -- permission-denied precondition did not hold');
      return;
    }
    const data = parseSingleJsonStdout(result.stdout);
    assertStderrHasNoBareJson(result.stderr);
    // rc7/INTERNAL is this file's primary expectation; rc3/INVALID+SECURITY_INVALID
    // is accepted as equally plausible (ACL/permission validation is this system's
    // own extensively-anticipated domain, not necessarily an "unexpected internal"
    // condition) -- same tolerance runtime-consultation-cli.bats's own CLI-RESULT-09
    // documents for this exact best-effort OS-failure proxy.
    assert.ok(
      (data.status === 'INTERNAL' && result.status === 7) ||
      (data.status === 'INVALID' && data.detail_code === 'SECURITY_INVALID' && result.status === 3),
      'expected either INTERNAL/rc7 or INVALID/rc3+SECURITY_INVALID, got status=' + data.status + ' code=' + result.status + ' detail_code=' + data.detail_code,
    );
  } finally {
    fs.chmodSync(lockedParent, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Determinism / test-capability gating (Frozen CLI ABI, PLAN.md ~L752):
// --fixed-ids, --fixed-clock, the closed bridge fixture flags, and
// RUNTIME_CONSULTATION_ACL_PROBE are accepted only with NODE_ENV=test PLUS the
// harness-created RUNTIME_CONSULTATION_TEST_CAPABILITY -- both conditions are
// independently necessary (an AND, not an OR). The fully-production (neither set)
// case is already covered above; this group covers the two partial-condition
// cases plus the positive (both-set) case.
// ═══════════════════════════════════════════════════════════════════════════

test('determinism: --fixed-ids/--fixed-clock under the FULL test capability succeeds (SUCCESS/rc0/NONE)', () => {
  withProject('rcc-node-determinism-pos-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'determinism-positive fixture question',
      expected_result_kind: 'TEST_RESULT',
      // Frozen-base-relative (Finding D, not real-now-relative via isoInFuture):
      // this call passes --fixed-clock, which genuinely freezes created_at to
      // the CLI's default frozen base 2025-01-01T00:00:00.000Z -- a
      // real-now-relative expiry would sit over a year outside
      // CONSULT_V2_FIELDS.expiry's 120-3600s window and trip SCHEMA_INVALID.
      // Mirrors FIXED_CLOCK_DEFAULT_EXPIRY (defined later in this file for
      // DET-ids's own use, same 1800s/30min offset).
      expiry: new Date(Date.parse('2025-01-01T00:00:00.000Z') + 1800000).toISOString(),
    });
    const result = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64, '--fixed-ids', '--fixed-clock',
    ]);
    assertCliResult(result, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
  });
});

test('determinism: NODE_ENV=test alone (no capability var) does not satisfy the gate -- --fixed-ids is still rejected as rc3', () => {
  withProject('rcc-node-determinism-partial1-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'determinism-partial-1 fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const result = spawnCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64, '--fixed-ids', '--fixed-clock',
    ], {
      NODE_ENV: 'test',
      RUNTIME_CONSULTATION_TEST_CAPABILITY: undefined,
      RUNTIME_CONSULTATION_ACL_PROBE: undefined,
    });
    assertCliResult(result, { command: 'publish-request', status: 'INVALID', detail_code: 'INVALID_ARGUMENT' });
  });
});

test('determinism: the capability var alone (no NODE_ENV=test) does not satisfy the gate -- --fixed-ids is still rejected as rc3', () => {
  withProject('rcc-node-determinism-partial2-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'determinism-partial-2 fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const result = spawnCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64, '--fixed-ids', '--fixed-clock',
    ], {
      NODE_ENV: undefined,
      RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
      RUNTIME_CONSULTATION_ACL_PROBE: undefined,
    });
    assertCliResult(result, { command: 'publish-request', status: 'INVALID', detail_code: 'INVALID_ARGUMENT' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// stdout/stderr shape (Frozen CLI ABI, PLAN.md ~L779: "stdout contains that one
// object + newline; stderr contains bounded diagnostics with no JSON/secrets").
// Already enforced by every `assertCliResult` call above (19 independent
// confirmations); this case names the property explicitly for both a successful
// and a rejected invocation in one place.
// ═══════════════════════════════════════════════════════════════════════════

test('stdout is exactly one JSON object plus one trailing newline (no BOM); stderr never carries a bare JSON object', () => {
  // WP3 root-confinement: root-init now requires a git-worktree-confined root.
  // M7/WP4 Phase B.3 (dispatch arch-testing-20260809T092330Z): root-init is
  // now ALSO grant-mandatory -- see the SUCCESS/rc0 test's own matching comment.
  const dir = makeTempProject();
  planFileFor(dir, 'rcc-node-wave-stdout-shape');
  try {
    const coordRoot = path.join(dir, 'coordination');
    const success = runTestCli(['root-init', '--coordination-root', coordRoot]);
    assertCliResult(success, { command: 'root-init', status: 'SUCCESS', detail_code: 'NONE' });

    const rejected = runTestCli(['another-totally-unknown-subcommand-abc']);
    assertCliResult(rejected, { command: 'another-totally-unknown-subcommand-abc', status: 'USAGE_ERROR', detail_code: 'UNKNOWN_COMMAND' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// WP2-new verbs round-tripping their cli-result shape end-to-end (task dispatch:
// "dispatch noop, publish-blob"). Both use the REAL `publish-request` flow (not a
// raw hand-written request.json fixture) -- empirically confirmed during this
// file's authoring that `dispatch` against a raw fixture (skipping the Ordered
// Runtime Loop's own routing-policy materialization, PLAN.md ~L803) is the
// DRIVER_UNAVAILABLE case above (mirroring runtime-consultation-cli.bats's own
// CLI-RESULT-04 recipe), whereas a PROPERLY published request has a materialized
// routing policy and dispatches successfully -- there is no "no driver is ever
// available" gap in the implementation; `noop` really is "always available"
// (PLAN.md ~L841-848) once the Ordered Runtime Loop's own preconditions are met.
// ═══════════════════════════════════════════════════════════════════════════

// M6+M7 FINAL AUTHORITY/ORACLE CORRECTION (2026-08-11, Group 4 -- distinguish
// mechanism from live claude-agent capability, team-lead-relayed inversion,
// post-Group-4-implementation): this test's PRIOR body (through the M6+M7
// requester-authority closure Group I pass, 2026-08-10) asserted that
// `cmdDispatch` selecting `claude-agent` from
// `rll.checkClaudeAgentCapabilityAvailable(...)` alone -- mechanism-readiness
// only (hook files present + registered in .claude/settings.json), with ZERO
// live session/PLAN/worktree/action correlation set up by this fixture's own
// plain publish-request+dispatch round trip -- was the CORRECT, confirmed
// outcome. That is exactly the defect Group 4 closes (HANDOFF's P0-C), the
// SAME bug shape as runtime-consultation-cli.bats's own
// M7WP4-groupB-dispatch-ignores-available-claude-agent (already corrected to
// M7WP4-groupB-CLAUDEID01-dispatch-requires-live-proof). Confirmed
// empirically (2026-08-11, post-Group-4-landing) against the REAL,
// unmodified `dispatch` CLI with this test's own unchanged
// publish-request+dispatch groundwork: `checkClaudeAgentCapabilityAvailable`
// still genuinely reports available:true for this checkout (mechanism check
// itself correct, untouched), but the real activation/v1 record now carries
// selected_driver:"noop", native_spawn_action_id:null -- mechanism-readiness
// alone is no longer sufficient, and the frozen fallback is correctly chosen
// with zero partial activation. Assertions below flipped to match; this is
// the SECOND correction this test has needed (an even older "always noop"
// assumption, then "always claude-agent since mechanism is available", now
// "noop unless live proof exists") -- name/comment updated so it no longer
// describes either superseded state as confirmed-correct.
test('dispatch: a properly published request round-trips to SUCCESS/rc0, but with ZERO live session/PLAN/worktree/action correlation set up, selects the frozen fallback (noop) even though claude-agent MECHANISM is genuinely available in this checkout -- zero partial activation', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available (settings.json hook registrations) for this test to be meaningful -- mechanism-readiness alone must still not be enough to select claude-agent: ' + JSON.stringify(capability));

  withProject('rcc-node-dispatch-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'dispatch-claude-agent-roundtrip fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    assert.ok(publishedData.request_id, 'publish-request must return a request_id');
    assert.ok(publishedData.artifact_ref, 'publish-request must return the request.json artifact_ref');

    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref]);
    const dispatchedData = assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });
    assert.strictEqual(dispatchedData.request_id, publishedData.request_id);
    assert.ok(dispatchedData.artifact_ref, 'dispatch must return the activation artifact_ref');

    const activationObj = JSON.parse(fs.readFileSync(dispatchedData.artifact_ref, 'utf8'));
    assert.strictEqual(activationObj.schema, 'coordination/activation/v1');
    assert.strictEqual(activationObj.selected_driver, 'noop', 'mechanism-readiness alone (claude-agent capability available + routing lists it before noop) must NOT be sufficient without live session/PLAN/worktree/action correlation -- the frozen fallback must be selected: ' + JSON.stringify(activationObj));
    assert.strictEqual(activationObj.native_spawn_action_id, null, 'native_spawn_action_id is only ever generated for a genuinely selected claude-agent driver -- must stay null for the noop fallback: ' + JSON.stringify(activationObj));
    assert.strictEqual(activationObj.native_target_binding_id, null, 'native_target_binding_id stays null regardless of driver (only claude-sendmessage uses it): ' + JSON.stringify(activationObj));

    // noop adds no payload keys and therefore returns no action (PLAN.md
    // ~L779) -- the CLI envelope's own activation_action must be null,
    // proving zero partial activation, never a claude-agent-shaped action
    // object left over from mechanism-readiness alone.
    assert.strictEqual(dispatchedData.activation_action, null, 'the noop fallback must return a null ActivationAction/v1 in the CLI envelope -- zero partial activation: ' + JSON.stringify(dispatchedData));
  });
});

// R2 (portable-runtime-messaging-adapters, M6-M7-PRODUCTION-REACHABILITY-20260819):
// positive-path counterpart to the negative-control test immediately above.
// dispatchCanonical's own claude-agent branch (runtime-consultation.cjs
// ~L10695-10741) today ALWAYS `continue`s past claude-agent after the
// mechanism + non-planner checks, because -- per that branch's own comment --
// no real top-level-host-liveness primitive exists yet to prove the CURRENT
// top-level orchestrator session is genuinely live. This test mints a
// genuine, current, unexpired MainOrchestratorBinding/v1 (the ONE existing
// primitive PLAN.md itself defines as modeling "the active top-level
// orchestrator", PLAN.md ~L240/~L594) scoped to the EXACT same
// worktree_id+plan_digest the published request will carry, BEFORE calling
// dispatch. This is EXPECTED TO FAIL (RED) against the current, unmodified
// production bytes -- selected_driver stays 'noop' exactly like the negative
// control above, because nothing in dispatchCanonical reads
// MainOrchestratorBinding at all yet. Left RED deliberately; the production
// wiring is toolkit-specialist's job, not this test-specialist's.
test('dispatch: claude-agent IS selected once a genuine, current, unexpired MainOrchestratorBinding scoped to the SAME worktree_id+plan_digest as the request exists BEFORE dispatch runs -- RED until dispatchCanonical\'s documented top-level-host-liveness gap (runtime-consultation.cjs ~L10716-10740) is wired to consult it', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available (settings.json hook registrations) for this test to be meaningful: ' + JSON.stringify(capability));

  withProject('rcc-node-dispatch-mainbinding-wave', (ctx) => {
    // Genuine, current, unexpired MainOrchestratorBinding/v1, scoped to the
    // EXACT same worktree_id+plan_digest the published request below will
    // carry (both already present on ctx from withProject). No CLI surface
    // exists to mint one, by design (PLAN.md ~L150) -- direct construction
    // via the exported createMainOrchestratorBinding mirrors the established
    // test-mint precedent (createRequesterBinding is already used this way
    // by knownRequesterIdentity() above in this same file).
    const identity = {
      ok: true,
      provider: 'claude-hook',
      runtime_session_key: 'r2-mainbinding-session-' + crypto.randomBytes(4).toString('hex'),
    };
    const bindingResult = rll.createMainOrchestratorBinding(ctx.projDir, identity, ctx.worktreeId, ctx.planDigest, 3600);
    assert.strictEqual(bindingResult.ok, true, 'fixture: createMainOrchestratorBinding must succeed: ' + JSON.stringify(bindingResult));

    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'dispatch-claude-agent-mainbinding-positive fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    assert.ok(publishedData.request_id, 'publish-request must return a request_id');
    assert.ok(publishedData.artifact_ref, 'publish-request must return the request.json artifact_ref');

    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref]);
    const dispatchedData = assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });
    assert.strictEqual(dispatchedData.request_id, publishedData.request_id);
    assert.ok(dispatchedData.artifact_ref, 'dispatch must return the activation artifact_ref');

    const activationObj = JSON.parse(fs.readFileSync(dispatchedData.artifact_ref, 'utf8'));
    assert.strictEqual(activationObj.schema, 'coordination/activation/v1');
    assert.strictEqual(activationObj.selected_driver, 'claude-agent', 'a genuine, current, unexpired MainOrchestratorBinding scoped to this exact request\'s worktree_id+plan_digest must prove top-level-host-liveness and select claude-agent, once wired: ' + JSON.stringify(activationObj));
    assert.ok(typeof activationObj.native_spawn_action_id === 'string' && activationObj.native_spawn_action_id.length > 0, 'native_spawn_action_id must be a non-null core-generated id once claude-agent is genuinely selected (PLAN.md ~L407-408, activation/v1 shape): ' + JSON.stringify(activationObj));
    assert.strictEqual(activationObj.native_target_binding_id, null, 'native_target_binding_id stays null regardless of driver (only claude-sendmessage uses it): ' + JSON.stringify(activationObj));
  });
});

// M6-M7-LIVE-FUNCTIONAL-ACCEPTANCE-20260820 fix round 1 (Codex ruling, sequence-2
// causal localization): dispatchCanonical's `options.requiredDriver` is checked
// only AFTER ordinary priority-order candidate selection (runtime-consultation.cjs
// ~L10948-10956), not as a filter DURING selection. hostBridgeAdvanceRootConsult
// always passes requiredDriver:'codex-app-server' when advancing a retained-root
// consult, but the ordinary route order places `claude-agent` before
// `codex-app-server` -- so whenever claude-agent's own mechanism+MainOrchestrator-
// Binding proof already succeeds (exactly the positive-path test immediately
// above), the loop selects claude-agent, breaks, and the post-loop requiredDriver
// check then rejects that ALREADY-selected candidate with DRIVER_UNAVAILABLE --
// even though codex-app-server, later in route order, is also genuinely live.
// This is the exact mechanism the sequence-2 live replay observed: request.json
// durably published, activation/inbox never materialize, resolveLiveCodexApp-
// ServerWorker reports available:true throughout. Calls dispatchCanonical
// in-process (never via the CLI subprocess) so the codex-app-server liveness stub
// below -- installed on runtime-bridge-codex.cjs's own required-module-cache
// object, the same cached instance dispatchCanonical's lazy require() resolves to
// -- is actually observed; nothing else is stubbed, and claude-agent's own
// mechanism+binding proof is genuinely live, never faked.
test('dispatchCanonical: options.requiredDriver=codex-app-server must select codex-app-server even when claude-agent (earlier in route order) is ALSO genuinely live -- requiredDriver must filter candidates, not merely reject the ordinary winner', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available (settings.json hook registrations) for this test to be meaningful: ' + JSON.stringify(capability));

  withProject('rcc-node-dispatch-requireddriver-wave', (ctx) => {
    // Genuine, current, unexpired MainOrchestratorBinding scoped to this exact
    // request's worktree_id+plan_digest -- same precondition as the positive
    // claude-agent-selection test above, so claude-agent's own proof genuinely
    // succeeds and would win ordinary priority-order selection.
    const identity = {
      ok: true,
      provider: 'claude-hook',
      runtime_session_key: 'r2-requireddriver-session-' + crypto.randomBytes(4).toString('hex'),
    };
    const bindingResult = rll.createMainOrchestratorBinding(ctx.projDir, identity, ctx.worktreeId, ctx.planDigest, 3600);
    assert.strictEqual(bindingResult.ok, true, 'fixture: createMainOrchestratorBinding must succeed: ' + JSON.stringify(bindingResult));

    const intentB64 = base64urlIntent({
      target_role: 'context-provider',
      question: 'dispatch-requireddriver-codex-app-server fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    assert.ok(publishedData.request_id, 'publish-request must return a request_id');
    assert.ok(publishedData.artifact_ref, 'publish-request must return the request.json artifact_ref');

    const bridge = require(path.resolve(__dirname, '../lib/runtime-bridge-codex.cjs'));
    const originalResolveLive = bridge.resolveLiveCodexAppServerWorker;
    bridge.resolveLiveCodexAppServerWorker = function fakeLiveCodexAppServerWorker(projectRoot, role) {
      return { ok: true, available: true, worker: { projectRoot, role, pid: process.pid, threadId: null } };
    };
    try {
      const dispatched = rc.dispatchCanonical(
        { 'coordination-root': ctx.coordRoot, request: publishedData.artifact_ref },
        { requiredDriver: 'codex-app-server' },
      );
      assert.ok(dispatched && dispatched.artifact_ref, 'dispatchCanonical must return a real activation artifact_ref: ' + JSON.stringify(dispatched));
      const activationObj = JSON.parse(fs.readFileSync(dispatched.artifact_ref, 'utf8'));
      assert.strictEqual(activationObj.schema, 'coordination/activation/v1');
      assert.strictEqual(activationObj.selected_driver, 'codex-app-server', 'requiredDriver must filter the candidate loop, not merely reject the ordinary winner -- claude-agent must never be selected when codex-app-server is required and live: ' + JSON.stringify(activationObj));
      assert.strictEqual(activationObj.native_spawn_action_id, null, 'native_spawn_action_id is only ever generated for claude-agent -- must stay null for codex-app-server: ' + JSON.stringify(activationObj));
    } finally {
      bridge.resolveLiveCodexAppServerWorker = originalResolveLive;
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
// SEQUENCE46-CHILD-DRIVER-01 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822,
// Codex byte audit sequence45-child-driver-byte-audit.md): hostBridgePublishChildRequest's
// internal child dispatch currently calls ordinary cmdDispatch() with no driver
// constraint, so whenever a genuine, current, unexpired top-level Claude
// MainOrchestratorBinding makes claude-agent honestly eligible (exactly as in
// live Sequence 45), claude-agent wins the child's dispatch race even though the
// exact retained context-provider codex-app-server target is READY. The retained
// host neither owns nor executes a top-level-Claude activation_action, so the
// child never gets claimed -- WORKER_LEASE_EXPIRED is the parent's later, purely
// downstream symptom. Mirrors this file's own existing "dispatchCanonical:
// options.requiredDriver=codex-app-server..." test (~L1057-1107) exactly, but
// exercises hostBridgePublishChildRequest's own internal dispatch instead of a
// direct dispatchCanonical call.
// ════════════════════════════════════════════════════════════════════════════════════

test('hostBridgePublishChildRequest: child dispatch must select codex-app-server (requiredDriver=codex-app-server) even when claude-agent (earlier in route order) is ALSO genuinely live -- the internal child dispatch must filter candidates, not merely let the ordinary top-level-Claude winner through', () => {
  const capabilityCheck = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capabilityCheck.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available (settings.json hook registrations) for this test to be meaningful: ' + JSON.stringify(capabilityCheck));

  withProject('rcc-hostbridge-child-requireddriver-wave', (ctx) => {
    // Genuine, current, unexpired MainOrchestratorBinding scoped to this exact
    // worktree_id+plan_digest -- same precondition as the existing precedent
    // test, so claude-agent's own proof genuinely succeeds for the child's
    // dispatch and would win ordinary priority-order selection if not filtered.
    const identity = {
      ok: true,
      provider: 'claude-hook',
      runtime_session_key: 'seq46-child-driver-session-' + crypto.randomBytes(4).toString('hex'),
    };
    const bindingResult = rll.createMainOrchestratorBinding(ctx.projDir, identity, ctx.worktreeId, ctx.planDigest, 3600);
    assert.strictEqual(bindingResult.ok, true, 'fixture: createMainOrchestratorBinding must succeed: ' + JSON.stringify(bindingResult));

    withHostBridgeCapability(ctx, 'arch-platform', (capability) => {
      // Parent (root) request: toolkit-specialist -> arch-platform, dispatched
      // with the SAME requiredDriver:'codex-app-server' forcing real root-source
      // dispatch already uses (cmdDispatch's own isRootSourceGrantContext branch)
      // -- this is the ALREADY-CORRECT parent path; only the CHILD dispatch
      // inside hostBridgePublishChildRequest is the defect under test.
      const parentIntentB64 = base64urlIntent({
        target_role: 'arch-platform',
        question: 'SEQUENCE46-CHILD-DRIVER-01 fixture: parent request',
        expected_result_kind: 'ARCHITECTURE_RECOMMENDATION',
        expiry: isoAtOffsetMs(1800000),
      });
      const parentPublished = runTestCli([
        'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
        '--subject-bundle', ctx.subjectBundlePath, '--intent', parentIntentB64,
      ]);
      const parentPublishedData = assertCliResult(parentPublished, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
      const parentRequestPath = parentPublishedData.artifact_ref;

      const parentDispatched = rc.dispatchCanonical(
        { 'coordination-root': ctx.coordRoot, request: parentRequestPath },
        { requiredDriver: 'codex-app-server' },
      );
      const parentActivation = JSON.parse(fs.readFileSync(parentDispatched.artifact_ref, 'utf8'));
      assert.strictEqual(parentActivation.selected_driver, 'codex-app-server', 'fixture sanity: the PARENT request must already be dispatched to codex-app-server (requireHostBridgeRequestScope requires this) before the child-dispatch defect can even be exercised: ' + JSON.stringify(parentActivation));

      const childResult = rc.hostBridgePublishChildRequest(capability, ctx.coordRoot, parentRequestPath, {
        target_role: 'context-provider',
        question: 'SEQUENCE46-CHILD-DRIVER-01 fixture: child request',
        expected_result_kind: 'PATTERN_EVIDENCE',
      });
      assert.ok(childResult && childResult.ok, 'hostBridgePublishChildRequest must succeed: ' + JSON.stringify(childResult));

      // Desired (GREEN) behavior asserted directly -- RED today because
      // childResult.selectedDriver is currently 'claude-agent'.
      assert.strictEqual(childResult.selectedDriver, 'codex-app-server', 'the child dispatch must select codex-app-server, never claude-agent, when the retained context-provider target is live: ' + JSON.stringify(childResult));

      const childActivation = JSON.parse(fs.readFileSync(childResult.activationPath, 'utf8'));
      assert.strictEqual(childActivation.schema, 'coordination/activation/v1');
      assert.strictEqual(childActivation.selected_driver, 'codex-app-server', 'the child\'s own durable activation record must show selected_driver codex-app-server: ' + JSON.stringify(childActivation));
      assert.strictEqual(childActivation.native_spawn_action_id, null, 'native_spawn_action_id must stay null -- it is only ever generated for claude-agent: ' + JSON.stringify(childActivation));
      assert.strictEqual(childActivation.native_target_binding_id, null, 'native_target_binding_id stays null regardless of driver: ' + JSON.stringify(childActivation));

      const childTxnDir = path.dirname(childResult.requestPath);
      const childIntentWalPath = path.join(childTxnDir, 'delivery', childActivation.attempt_id + '.intent.json');
      assert.strictEqual(fs.existsSync(childIntentWalPath), false, 'no coordination/activation-intent/v1 WAL may exist for the child -- that WAL is requester-owned-driver-only (claude-sendmessage/claude-agent/runtime-spawn), never written for codex-app-server: ' + childIntentWalPath);

      const childReqObj = JSON.parse(fs.readFileSync(childResult.requestPath, 'utf8'));
      const parentReqObj = JSON.parse(fs.readFileSync(parentRequestPath, 'utf8'));
      assert.strictEqual(childReqObj.parent_request_id, parentReqObj.request_id, 'child parent_request_id must correlate to the parent: ' + JSON.stringify({ child: childReqObj.parent_request_id, parent: parentReqObj.request_id }));
      assert.strictEqual(childReqObj.root_request_id, parentReqObj.request_id, 'child root_request_id must correlate to the parent (parent is itself the root): ' + JSON.stringify({ child: childReqObj.root_request_id, parent: parentReqObj.request_id }));
      assert.strictEqual(childReqObj.depth, parentReqObj.depth + 1, 'child depth must be exactly one more than the parent: ' + JSON.stringify({ childDepth: childReqObj.depth, parentDepth: parentReqObj.depth }));
      assert.strictEqual(childReqObj.source_role, 'arch-platform', 'child source_role must be the architect that published it: ' + childReqObj.source_role);
      assert.strictEqual(childReqObj.target_role, 'context-provider', 'child target_role must be context-provider: ' + childReqObj.target_role);
      assert.strictEqual(childReqObj.requester_worktree_id, ctx.worktreeId, 'child requester_worktree_id must correlate to the HostBridgeCapability scope: ' + childReqObj.requester_worktree_id);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R2-EXACT-CLAUDE-HOST (Codex ruling, M6-M7-PRODUCTION-REACHABILITY-20260819,
// round 2 "continue_same_stage"): hasLiveMainOrchestratorBindingForScope must
// mean EXACTLY one fully valid, current, correctly-scoped, runtime===
// 'claude-hook' binding -- not "any scope-matched file exists". Round 1's own
// first pass (the two tests immediately above) only proved existence-based
// liveness; Codex independently reproduced a REAL defect: a codex-supervisor-
// provider binding (not a claude-hook one) can currently satisfy the check
// and wrongly authorize claude-agent.
//
// Confirmed by DIRECT READ of hasLiveMainOrchestratorBindingForScope
// (runtime-role-lifecycle.cjs, ~L1478-1517) before writing any of these
// fixtures, never guessed: the current implementation (a) never inspects
// binding.runtime at all -- any IDENTITY_PROVIDER_ENUM value scope-matches
// identically; (b) `return true`s on the FIRST live scope match found,
// never checking whether a SECOND equally-live match also exists (zero-or-
// ambiguous is not distinguished from exactly-one); (c) never calls
// peekSessionGeneration (or resolveSessionGeneration) at all, so a binding's
// own session-generation liveness is entirely unchecked; (d) a `.json`
// symlink directory entry is silently `continue`d past via `!entry.isFile()`
// (a Dirent's isFile() reflects the raw dirent type, never the symlink
// target) rather than treated as the anomaly Codex's ruling requires it to
// fail closed on. Cases 7/8 below are the two scope-mismatch/expiry paths
// the CURRENT implementation already handles correctly (routine `continue`,
// never a short-circuit `return true`) -- kept as explicit regression
// guards per Codex's own "benign well-formed foreign-scope/expired
// candidates may be skipped" ruling text, not asserted as new RED.
// ═══════════════════════════════════════════════════════════════════════════

function r2MintCurrentClaudeHostBinding(ctx, ttlSeconds) {
  const identity = {
    ok: true,
    provider: 'claude-hook',
    runtime_session_key: 'r2-case-session-' + crypto.randomBytes(4).toString('hex'),
  };
  const bindingResult = rll.createMainOrchestratorBinding(ctx.projDir, identity, ctx.worktreeId, ctx.planDigest, ttlSeconds || 3600);
  assert.strictEqual(bindingResult.ok, true, 'fixture: createMainOrchestratorBinding must succeed: ' + JSON.stringify(bindingResult));
  return bindingResult.binding;
}

/** Publishes a fresh consult/v2 request against ctx's own real coordination root, dispatches it, and returns the parsed activation/v1 object. */
function r2DispatchAndReadActivation(ctx, questionSuffix) {
  const intentB64 = base64urlIntent({
    target_role: 'arch-testing',
    question: 'R2 case fixture: ' + questionSuffix,
    expected_result_kind: 'TEST_RESULT',
    expiry: isoInFuture(1800000),
  });
  const published = runTestCli([
    'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
    '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
  ]);
  const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
  assert.ok(publishedData.artifact_ref, 'publish-request must return the request.json artifact_ref');
  const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref]);
  const dispatchedData = assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });
  assert.ok(dispatchedData.artifact_ref, 'dispatch must return the activation artifact_ref');
  const activationObj = JSON.parse(fs.readFileSync(dispatchedData.artifact_ref, 'utf8'));
  assert.strictEqual(activationObj.schema, 'coordination/activation/v1');
  return activationObj;
}

function r2AssertClaudeAgentNotSelected(activationObj, caseLabel) {
  assert.notStrictEqual(activationObj.selected_driver, 'claude-agent', caseLabel + ': must NOT select claude-agent (selected_driver must be noop or the next genuinely-available routing candidate): ' + JSON.stringify(activationObj));
  assert.strictEqual(activationObj.native_spawn_action_id, null, caseLabel + ': native_spawn_action_id must stay null -- no partial/leaked claude-agent activation: ' + JSON.stringify(activationObj));
}

test('R2 case 3 (wrong runtime): a well-formed, live, correctly-scoped binding whose runtime is codex-supervisor (never claude-hook) must NOT select claude-agent -- RED against current bytes (hasLiveMainOrchestratorBindingForScope never inspects binding.runtime at all)', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2-wrongruntime-wave', (ctx) => {
    const identity = {
      ok: true,
      provider: 'codex-supervisor',
      runtime_session_key: 'r2-wrongruntime-session-' + crypto.randomBytes(4).toString('hex'),
    };
    const bindingResult = rll.createMainOrchestratorBinding(ctx.projDir, identity, ctx.worktreeId, ctx.planDigest, 3600);
    assert.strictEqual(bindingResult.ok, true, 'fixture: createMainOrchestratorBinding must succeed: ' + JSON.stringify(bindingResult));
    assert.strictEqual(bindingResult.binding.runtime, 'codex-supervisor', 'fixture sanity: the binding really is codex-supervisor-provider, never claude-hook');

    const activationObj = r2DispatchAndReadActivation(ctx, 'wrong-runtime');
    r2AssertClaudeAgentNotSelected(activationObj, 'R2 case 3 (wrong runtime)');
  });
});

test('R2 case 4 (session generation missing at lookup time): a well-formed, live, correctly-scoped claude-hook binding whose SessionGeneration record has since been deleted must NOT select claude-agent -- RED against current bytes (hasLiveMainOrchestratorBindingForScope never calls peekSessionGeneration at all)', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2-nogen-wave', (ctx) => {
    // withProject's own root-init call already routes through GRANT_WRAPPER
    // (spawnCli, unconditionally), which mints its own codex-supervisor-
    // identity session generation as a side effect of granting itself
    // root-init authority -- so a fresh project's sessions/ dir is NOT
    // guaranteed empty before this fixture's own mint. Snapshot before/after
    // instead of assuming an absolute count, and delete only the NEW file
    // this fixture's own r2MintCurrentClaudeHostBinding call produced --
    // never reimplementing the production lookup-key hash formula
    // (sessionLookupKey) here, and never touching a sibling session this
    // fixture did not itself create.
    const sessionsDir = path.join(rll.registryRepoDir(ctx.projDir), 'sessions');
    const before = new Set(fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json')));
    r2MintCurrentClaudeHostBinding(ctx, 3600);
    const after = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
    const newFiles = after.filter((f) => !before.has(f));
    assert.strictEqual(newFiles.length, 1, 'fixture sanity: exactly one NEW SessionGeneration record must be minted by this fixture\'s own binding: ' + JSON.stringify({ before: Array.from(before), after }));
    fs.unlinkSync(path.join(sessionsDir, newFiles[0]));

    const activationObj = r2DispatchAndReadActivation(ctx, 'session-generation-missing');
    r2AssertClaudeAgentNotSelected(activationObj, 'R2 case 4 (session generation missing)');
  });
});

test('R2 case 5 (ambiguous, two live matches): two live, well-formed, correctly-scoped claude-hook bindings for the SAME worktree_id+plan_digest must NOT select claude-agent -- zero-or-more-than-one both mean false -- RED against current bytes (hasLiveMainOrchestratorBindingForScope short-circuits true on the FIRST match, never checks whether a second equally-live match also exists)', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2-ambiguous-wave', (ctx) => {
    const bindingA = r2MintCurrentClaudeHostBinding(ctx, 3600);
    const bindingB = r2MintCurrentClaudeHostBinding(ctx, 3600);
    assert.notStrictEqual(bindingA.binding_id, bindingB.binding_id, 'fixture sanity: two DISTINCT live bindings must exist for the same scope');

    const activationObj = r2DispatchAndReadActivation(ctx, 'ambiguous-two-live');
    r2AssertClaudeAgentNotSelected(activationObj, 'R2 case 5 (ambiguous, two live matches)');
  });
});

test('R2 case 6 (malformed registry entry present alongside a well-formed one): a well-formed, live, correctly-scoped claude-hook binding COEXISTING with a structurally-malformed sibling entry in orchestrator-bindings/ must fail the WHOLE resolution closed -- never select claude-agent, never crash -- RED against current bytes. Empirically confirmed NON-DETERMINISTIC under current bytes: hasLiveMainOrchestratorBindingForScope short-circuits `return true` on the FIRST live scope-matched entry it scans, so whether the bug manifests for a given (good, malformed) filename pair depends entirely on fs.readdirSync\'s own (unspecified, filesystem-dependent) directory-entry order -- directly observed BOTH claude-agent-wrongly-selected and noop across repeated single-pair runs with fresh random ids on this exact machine. This test therefore repeats the pairing several times with FRESH random ids each iteration and asserts on EVERY iteration -- never accepting one lucky ordering as proof, and any single iteration failing is sufficient RED evidence of the underlying short-circuit defect regardless of which iteration it is', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2-malformed-wave', (ctx) => {
    const bindingsDir = path.join(rll.registryRepoDir(ctx.projDir), 'orchestrator-bindings');
    const REPEATS = 6;
    for (let i = 0; i < REPEATS; i += 1) {
      const goodBinding = r2MintCurrentClaudeHostBinding(ctx, 3600);

      // A second orchestrator-binding record: valid JSON, but with an EXTRA
      // key beyond MAIN_BINDING_KEYS' closed set -- fails hasExactKeys(), the
      // exact "structural corruption" branch hasLiveMainOrchestratorBindingForScope's
      // own comment documents as "fail the whole scan closed, never skip past it".
      const malformedId = crypto.randomBytes(16).toString('hex');
      const malformed = Object.assign({}, goodBinding, {
        binding_id: malformedId,
        bogus_extra_field: 'this-key-is-not-in-MAIN_BINDING_KEYS',
      });
      fs.writeFileSync(path.join(bindingsDir, malformedId + '.json'), JSON.stringify(malformed));

      const activationObj = r2DispatchAndReadActivation(ctx, 'malformed-coexisting-iter-' + i);
      r2AssertClaudeAgentNotSelected(activationObj, 'R2 case 6 (malformed entry coexists with a well-formed one), iteration ' + i + ' of ' + REPEATS);

      // Clean both this iteration's entries before the next -- each
      // iteration must independently exercise a fresh 2-entry directory (a
      // fresh fs.readdirSync ordering opportunity), never accumulate stale
      // entries that would change scan semantics for later iterations.
      fs.unlinkSync(path.join(bindingsDir, goodBinding.binding_id + '.json'));
      fs.unlinkSync(path.join(bindingsDir, malformedId + '.json'));
    }
  });
});

test('R2 case 7 (foreign scope -- regression guard, NOT expected RED per Codex\'s own ruling text): a well-formed, live, current claude-hook binding scoped to a DIFFERENT worktree_id+plan_digest than this request must be a benign skip, never select claude-agent for THIS request', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2-foreignscope-wave', (ctx) => {
    const identity = {
      ok: true,
      provider: 'claude-hook',
      runtime_session_key: 'r2-foreignscope-session-' + crypto.randomBytes(4).toString('hex'),
    };
    // Deliberately a DIFFERENT worktree_id+plan_digest -- both genuinely
    // 64-lowercase-hex sha256-shaped strings (never derived from ctx), so
    // this is a well-formed, foreign scope, never a malformed record.
    const foreignWorktreeId = sha256Hex('r2-foreign-worktree');
    const foreignPlanDigest = sha256Hex('r2-foreign-plan');
    const bindingResult = rll.createMainOrchestratorBinding(ctx.projDir, identity, foreignWorktreeId, foreignPlanDigest, 3600);
    assert.strictEqual(bindingResult.ok, true, 'fixture: createMainOrchestratorBinding must succeed: ' + JSON.stringify(bindingResult));

    const activationObj = r2DispatchAndReadActivation(ctx, 'foreign-scope');
    r2AssertClaudeAgentNotSelected(activationObj, 'R2 case 7 (foreign scope)');
  });
});

test('R2 case 8 (expired binding -- regression guard, NOT expected RED per Codex\'s own ruling text): a well-formed, correctly-scoped claude-hook binding that is simply expired must NOT select claude-agent', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2-expired-wave', (ctx) => {
    const binding = r2MintCurrentClaudeHostBinding(ctx, 3600);
    // Directly rewrite the durable binding's own expiry into the past --
    // <orchestrator-bindings-dir>/<binding_id>.json is the SAME universal
    // <type-dir>/<id>.json registry convention this file's own resultPathFor/
    // requestPathFor helpers already rely on, applied to the binding_id this
    // fixture's own mint already returned (never a reconstructed/guessed path).
    const bindingsDir = path.join(rll.registryRepoDir(ctx.projDir), 'orchestrator-bindings');
    const bindingPath = path.join(bindingsDir, binding.binding_id + '.json');
    const onDisk = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    onDisk.expiry = '2020-01-01T00:00:00Z';
    fs.writeFileSync(bindingPath, JSON.stringify(onDisk));

    const activationObj = r2DispatchAndReadActivation(ctx, 'expired-binding');
    r2AssertClaudeAgentNotSelected(activationObj, 'R2 case 8 (expired binding)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R2-A INTEGRITY CLOSURE (mission M6-M7-R2-INTEGRITY-CLOSURE-20260820): cases
// 3-8 above (R2-EXACT-CLAUDE-HOST) are ALL EMPIRICALLY GREEN against current
// bytes -- their own "RED against current bytes" prose is stale, predating
// the fix that already landed for that round. Direct re-read of
// hasLiveMainOrchestratorBindingForScope (runtime-role-lifecycle.cjs
// ~L1511-1572) confirms a narrower, still-live residual defect: the
// structural chronology checks (`createdAtMs > expiry`, `createdAtMs > now`)
// run AFTER the routine runtime/scope-mismatch `continue`, not before it --
// so a corrupted entry that is ALSO foreign-scope or wrong-runtime gets
// skipped as benign before its impossible chronology is ever inspected,
// letting a coexisting genuinely-valid Claude binding still authorize
// claude-agent. Separately, `peekSessionGeneration`'s failures are ALL
// currently folded into one blanket `continue` (benign skip) regardless of
// reason -- absence and expiry are genuinely benign, but a pending/malformed/
// tampered SessionGeneration record must poison the WHOLE scan closed
// instead of being silently stepped over.
// ═══════════════════════════════════════════════════════════════════════════

test('R2-A case 9 (foreign-scope entry with impossible chronology coexists with a valid Claude binding): the corrupt entry must fail the WHOLE scan closed even though a separate, fully valid Claude binding also exists for this exact scope -- RED against current bytes (the routine foreign-scope/wrong-runtime skip is applied BEFORE chronology is checked, so the corrupt entry is silently skipped and the valid Claude binding still wins)', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2a-badchron-wave', (ctx) => {
    // A genuinely valid, live, correctly-scoped claude-hook binding -- if the
    // corrupt sibling below were (wrongly) treated as a benign skip, this one
    // alone would make hasLiveMainOrchestratorBindingForScope return true.
    r2MintCurrentClaudeHostBinding(ctx, 3600);

    // A SEPARATE binding, foreign-scope (never this ctx's own worktree/plan),
    // whose created_at is chronologically impossible (strictly after its own
    // expiry). Structurally well-formed in every OTHER respect -- same
    // technique as case 8's direct on-disk rewrite.
    const badIdentity = {
      ok: true,
      provider: 'claude-hook',
      runtime_session_key: 'r2a-badchron-session-' + crypto.randomBytes(4).toString('hex'),
    };
    const foreignWorktreeId = sha256Hex('r2a-badchron-foreign-worktree');
    const foreignPlanDigest = sha256Hex('r2a-badchron-foreign-plan');
    const badMint = rll.createMainOrchestratorBinding(ctx.projDir, badIdentity, foreignWorktreeId, foreignPlanDigest, 3600);
    assert.strictEqual(badMint.ok, true, 'fixture: createMainOrchestratorBinding must succeed: ' + JSON.stringify(badMint));
    const bindingsDir = path.join(rll.registryRepoDir(ctx.projDir), 'orchestrator-bindings');
    const badPath = path.join(bindingsDir, badMint.binding.binding_id + '.json');
    const onDisk = JSON.parse(fs.readFileSync(badPath, 'utf8'));
    onDisk.created_at = new Date(Date.parse(onDisk.expiry) + 5000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    assert.ok(Date.parse(onDisk.created_at) > Date.parse(onDisk.expiry), 'fixture sanity: created_at must be strictly after expiry');
    fs.writeFileSync(badPath, JSON.stringify(onDisk));

    const activationObj = r2DispatchAndReadActivation(ctx, 'badchron-foreignscope-coexists');
    r2AssertClaudeAgentNotSelected(activationObj, 'R2-A case 9 (foreign-scope + impossible chronology coexists with a valid Claude binding)');
  });
});

test('R2-A case 10 (structurally-tampered SessionGeneration for one binding coexists with a separately-valid Claude binding): a live, correctly-scoped, chronologically-sane claude-hook binding whose OWN SessionGeneration record fails the closed key-set (an extra field) must fail the WHOLE scan closed, even though a SEPARATE, fully valid Claude binding (its own distinct session) also exists for this exact scope -- RED against current bytes (peekSessionGeneration ALREADY detects this shape corruption today, but hasLiveMainOrchestratorBindingForScope currently folds EVERY peekSessionGeneration failure into one blanket benign `continue`, so the tampered entry is silently skipped and the other valid binding still wins)', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2a-gentamper-wave', (ctx) => {
    // A genuinely valid, live, correctly-scoped claude-hook binding with its own healthy session.
    r2MintCurrentClaudeHostBinding(ctx, 3600);

    // A SEPARATE, ALSO correctly-scoped claude-hook binding (own distinct
    // session key -> own distinct SessionGeneration file) whose session
    // generation record gets tampered post-mint. Snapshot before/after to
    // find the NEW session file -- never reimplementing the production
    // lookup-key hash formula here, mirroring case 4's own established
    // technique. An EXTRA key (fails hasExactKeys) is a shape corruption
    // peekSessionGeneration's OWN existing checks already reject today --
    // this isolates the continue-vs-fail-closed defect from the (separate)
    // still-missing CSPRNG-shape/chronology checks case 10b/10c cover below.
    const sessionsDir = path.join(rll.registryRepoDir(ctx.projDir), 'sessions');
    const before = new Set(fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json')));
    const taintedIdentity = {
      ok: true,
      provider: 'claude-hook',
      runtime_session_key: 'r2a-gentamper-session-' + crypto.randomBytes(4).toString('hex'),
    };
    const taintedMint = rll.createMainOrchestratorBinding(ctx.projDir, taintedIdentity, ctx.worktreeId, ctx.planDigest, 3600);
    assert.strictEqual(taintedMint.ok, true, 'fixture: createMainOrchestratorBinding must succeed: ' + JSON.stringify(taintedMint));
    const after = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
    const newFiles = after.filter((f) => !before.has(f));
    assert.strictEqual(newFiles.length, 1, 'fixture sanity: exactly one NEW SessionGeneration record must be minted by this fixture\'s own second binding: ' + JSON.stringify({ before: Array.from(before), after }));
    const sessionPath = path.join(sessionsDir, newFiles[0]);
    const sessionOnDisk = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    sessionOnDisk.bogus_extra_field = 'this-key-is-not-in-SESSION_GENERATION_KEYS';
    fs.writeFileSync(sessionPath, JSON.stringify(sessionOnDisk));

    const activationObj = r2DispatchAndReadActivation(ctx, 'gentamper-coexists');
    r2AssertClaudeAgentNotSelected(activationObj, 'R2-A case 10 (structurally-tampered SessionGeneration coexists with a separately-valid Claude binding)');
  });
});

test('R2-A case 10b (SessionGeneration generation_id is not CSPRNG-32-shaped): the sole candidate binding own SessionGeneration record otherwise passes every EXISTING shape check but carries a non-hex/non-32-byte generation_id -- must NOT select claude-agent -- RED against current bytes (peekSessionGeneration does not validate generation_id format at all today, so this tampered-but-shape-plausible record is currently treated as fully live)', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2a-gencsprng-wave', (ctx) => {
    const sessionsDir = path.join(rll.registryRepoDir(ctx.projDir), 'sessions');
    const before = new Set(fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json')));
    r2MintCurrentClaudeHostBinding(ctx, 3600);
    const after = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
    const newFiles = after.filter((f) => !before.has(f));
    assert.strictEqual(newFiles.length, 1, 'fixture sanity: exactly one NEW SessionGeneration record must be minted by this fixture\'s own binding: ' + JSON.stringify({ before: Array.from(before), after }));
    const sessionPath = path.join(sessionsDir, newFiles[0]);
    const sessionOnDisk = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    sessionOnDisk.generation_id = 'not-a-csprng-32-value';
    fs.writeFileSync(sessionPath, JSON.stringify(sessionOnDisk));

    const activationObj = r2DispatchAndReadActivation(ctx, 'gencsprng-sole-candidate');
    r2AssertClaudeAgentNotSelected(activationObj, 'R2-A case 10b (SessionGeneration generation_id not CSPRNG-32)');
  });
});

test('R2-A case 10c (SessionGeneration created_at strictly after its own expires_at): the sole candidate binding\'s own SessionGeneration record otherwise passes every EXISTING shape check but has chronologically-impossible dates -- must NOT select claude-agent -- RED against current bytes (peekSessionGeneration does not check created_at<=expires_at at all today, so this tampered-but-shape-plausible record is currently treated as fully live)', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2a-genchron-wave', (ctx) => {
    const sessionsDir = path.join(rll.registryRepoDir(ctx.projDir), 'sessions');
    const before = new Set(fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json')));
    r2MintCurrentClaudeHostBinding(ctx, 3600);
    const after = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
    const newFiles = after.filter((f) => !before.has(f));
    assert.strictEqual(newFiles.length, 1, 'fixture sanity: exactly one NEW SessionGeneration record must be minted by this fixture\'s own binding: ' + JSON.stringify({ before: Array.from(before), after }));
    const sessionPath = path.join(sessionsDir, newFiles[0]);
    const sessionOnDisk = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    // Still canonical ISO-UTC format (passes isCanonicalIsoUtc) -- only the
    // ORDERING relative to expires_at is impossible, mirroring case 9's own
    // binding-level technique applied to the SessionGeneration record.
    sessionOnDisk.created_at = new Date(Date.parse(sessionOnDisk.expires_at) + 5000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    assert.ok(Date.parse(sessionOnDisk.created_at) > Date.parse(sessionOnDisk.expires_at), 'fixture sanity: created_at must be strictly after expires_at');
    fs.writeFileSync(sessionPath, JSON.stringify(sessionOnDisk));

    const activationObj = r2DispatchAndReadActivation(ctx, 'genchron-sole-candidate');
    r2AssertClaudeAgentNotSelected(activationObj, 'R2-A case 10c (SessionGeneration created_at after expires_at)');
  });
});

test('R2-A case 11 (session generation explicitly expired, not merely absent): a well-formed, live, correctly-scoped claude-hook binding whose SessionGeneration record is present but past its own expires_at must NOT select claude-agent, and the request must still legitimately SUCCEED via fallback (never a hard failure) -- completeness guard alongside case 4 (which only covers outright absence)', () => {
  const capability = rll.checkClaudeAgentCapabilityAvailable(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(capability.available, true, 'precondition: this checkout must genuinely have the claude-agent MECHANISM available: ' + JSON.stringify(capability));
  withProject('rcc-node-r2a-genexpired-wave', (ctx) => {
    const sessionsDir = path.join(rll.registryRepoDir(ctx.projDir), 'sessions');
    const before = new Set(fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json')));
    r2MintCurrentClaudeHostBinding(ctx, 3600);
    const after = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
    const newFiles = after.filter((f) => !before.has(f));
    assert.strictEqual(newFiles.length, 1, 'fixture sanity: exactly one NEW SessionGeneration record must be minted by this fixture\'s own binding: ' + JSON.stringify({ before: Array.from(before), after }));
    const sessionPath = path.join(sessionsDir, newFiles[0]);
    const sessionOnDisk = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    sessionOnDisk.expires_at = '2020-01-01T00:00:00Z';
    fs.writeFileSync(sessionPath, JSON.stringify(sessionOnDisk));

    const activationObj = r2DispatchAndReadActivation(ctx, 'genexpired');
    r2AssertClaudeAgentNotSelected(activationObj, 'R2-A case 11 (session generation explicitly expired)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R2-B INTEGRITY CLOSURE: dispatchCanonical (runtime-consultation.cjs) reads
// the materialized routing-policy snapshot from a content-addressed PATH
// (routing-policies/<request.routing_policy_digest>.json) but never actually
// re-verifies the bytes it read hash to that same digest before parsing or
// selecting a driver -- it trusts the naming convention alone. An in-place
// rewrite of the snapshot (same inode, different bytes) is therefore
// currently invisible to dispatch.
// ═══════════════════════════════════════════════════════════════════════════

test('R2-B case 1 (materialized routing-policy snapshot tampered in place after publish): dispatch must reject with INVALID/CORRELATION_INVALID and perform ZERO writes when the durable routing-policies/<digest>.json bytes no longer hash to the request\'s own routing_policy_digest -- RED against current bytes (dispatchCanonical trusts the content-addressed PATH convention and never re-verifies the bytes it just read)', () => {
  withProject('rcc-node-r2b-digest-tamper-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'R2-B case fixture: digest tamper',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const requestObj = JSON.parse(fs.readFileSync(publishedData.artifact_ref, 'utf8'));
    const policyPath = path.join(ctx.planRoot, 'routing-policies', requestObj.routing_policy_digest + '.json');
    assert.ok(fs.existsSync(policyPath), 'fixture sanity: publish-request must durably materialize the routing-policy snapshot: ' + policyPath);

    // Tamper the ALREADY-MATERIALIZED, content-addressed snapshot in place --
    // same inode, same filename/digest-derived path, DIFFERENT bytes. This is
    // the exact production vulnerability R2-B closes: a routing decision made
    // from bytes that no longer match what the request itself was correlated
    // against at publish time.
    const onDisk = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    const role = requestObj.target_role;
    assert.ok(Array.isArray(onDisk.routes[role]), 'fixture sanity: materialized policy must carry a route list for ' + role);
    onDisk.routes[role] = onDisk.routes[role].slice().reverse();
    fs.writeFileSync(policyPath, JSON.stringify(onDisk));
    assert.notStrictEqual(sha256Hex(fs.readFileSync(policyPath)), requestObj.routing_policy_digest,
      'fixture sanity: the tamper must genuinely change the materialized bytes\' own digest');

    const txnDir = path.dirname(publishedData.artifact_ref);
    const beforeTree = snapshotDirDigests(txnDir);
    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'INVALID', detail_code: 'CORRELATION_INVALID' });
    const afterTree = snapshotDirDigests(txnDir);
    assert.deepStrictEqual(afterTree, beforeTree, 'a rejected digest-mismatched dispatch must perform ZERO writes to the transaction tree (no activation, no partial state)');
  });
});

test('R2-B case 2 (positive control): a genuinely untampered, materialized routing-policy snapshot dispatches successfully, proving the new digest check does not reject legitimate traffic', () => {
  withProject('rcc-node-r2b-digest-positive-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'R2-B case fixture: digest positive control',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref]);
    // noop is the honest outcome here (no MainOrchestratorBinding minted in
    // this fixture) -- the discriminating claim is only that an untampered
    // snapshot is never rejected as a digest mismatch.
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R2-C (M6-M7-R2C-TEST-SEAM-CLOSURE-20260820): RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH
//
// R2-B closed the materialized-snapshot-tamper gap but left the ROOT-SOURCE
// E2E fixtures blocked: root-source-initiated publish-request is structurally
// pinned to the REAL canonical runtime-consultation.cjs (context-provider-
// gate.js's findLifecycleCliInvocation admits only an exact CANONICAL_LIFECYCLE_CLI_PATH
// match; decodeRootSourceBootstrapIntentFromAction separately requires the
// embedded publish_command's script path to equal path.join(__dirname,
// 'runtime-consultation.cjs') of whichever runtime-role-lifecycle.cjs later
// re-validates it), so a private-copy-of-the-whole-directory override can
// never reach it. This env var lets the REAL canonical module swap ONLY its
// own ROUTING_POLICY_CONTENT/DIGEST/TABLE, gated behind the SAME
// isTestCapability() seam every other test-only override in this file uses.
//
// Every case below spawns the REAL CLI binary directly (never through
// GRANT_WRAPPER) -- the rejection happens at MODULE LOAD, before argv is even
// parsed, so no grant machinery is relevant and a wrapper hop would only
// obscure which process actually threw. Each negative asserts the exact
// deterministic `RUNTIME_TEST_ROUTING_OVERRIDE_INVALID:<reason>` signature in
// stderr, a non-zero exit, an EMPTY stdout (no fabricated envelope), and a
// byte-identical directory snapshot of its own fixture scope before/after --
// never exit-code-alone, never a generic crash/timeout as the oracle.
// ═══════════════════════════════════════════════════════════════════════════

const R2C_ROUTING_OVERRIDE_ENV = 'RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH';
const R2C_VALID_ROUTING_TABLE = Object.freeze({ schema: 'runtime-routing/v1', routes: { 'arch-testing': ['noop'] } });

/** Fresh, private, owner-only 0700 tmp base -- realpath'd so a later `fs.realpathSync(os.tmpdir())` inside the child (which resolves through macOS's /var->/private/var symlink) matches this same string exactly, never a false symlink/alias mismatch from an incidental host-OS symlink neither side of the comparison intends. */
function r2cMakeTmpBase(prefix) {
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(raw, 0o700);
  return fs.realpathSync(raw);
}

/** Writes a valid-shaped (or caller-overridden) routing-policy JSON fixture at mode 0600 and returns its realpath'd absolute path. */
function r2cWriteOverrideFixture(dir, filename, obj) {
  const p = path.join(dir, filename);
  fs.writeFileSync(p, JSON.stringify(obj === undefined ? R2C_VALID_ROUTING_TABLE : obj));
  fs.chmodSync(p, 0o600);
  return fs.realpathSync(p);
}

/** Spawns the REAL CLI binary directly (bypasses GRANT_WRAPPER -- see section header). Same undefined-deletes-key convention as spawnCli. */
function r2cSpawnRealCliDirect(args, envOverrides) {
  const env = Object.assign({}, process.env, envOverrides || {});
  for (const k of Object.keys(env)) {
    if (env[k] === undefined) delete env[k];
  }
  return spawnSync(process.execPath, [IMPL, ...args], { env, encoding: 'utf8' });
}

/** Asserts a rejected test-routing-policy override: exact signature in stderr, non-zero exit, empty stdout -- never exit-code-alone. */
function r2cAssertOverrideRejected(result, expectedReason) {
  const expectedSignature = 'RUNTIME_TEST_ROUTING_OVERRIDE_INVALID:' + expectedReason;
  assert.notStrictEqual(result.status, 0,
    'a rejected test-routing-policy override must exit non-zero; got status=' + result.status + ' stdout=' + JSON.stringify(result.stdout) + ' stderr=' + JSON.stringify(result.stderr));
  assert.ok((result.stderr || '').includes(expectedSignature),
    'expected the exact deterministic signature "' + expectedSignature + '" in stderr; got stderr=' + JSON.stringify(result.stderr) + ' stdout=' + JSON.stringify(result.stdout));
  assert.strictEqual(result.stdout, '', 'a rejected override must never print a fabricated stdout envelope');
}

const R2C_PLACEHOLDER_ARGS = ['root-init', '--coordination-root', '/r2c-placeholder-must-never-be-touched'];

test('R2-C RED 1: RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH present without NODE_ENV=test is rejected test-capability-required, path never read (nonexistent path proves the gate runs before any fs access)', () => {
  const tmpBase = r2cMakeTmpBase('r2c-gate1-');
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: undefined,
    RUNTIME_CONSULTATION_TEST_CAPABILITY: 'some-capability',
    [R2C_ROUTING_OVERRIDE_ENV]: path.join(tmpBase, 'genuinely-nonexistent.json'),
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'test-capability-required');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
  assert.strictEqual(fs.existsSync(R2C_PLACEHOLDER_ARGS[2]), false);
});

test('R2-C RED 2: NODE_ENV=production with a non-empty capability is rejected test-capability-required (production NODE_ENV never satisfies isTestCapability regardless of capability)', () => {
  const tmpBase = r2cMakeTmpBase('r2c-gate2-');
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'production',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: 'some-capability',
    [R2C_ROUTING_OVERRIDE_ENV]: path.join(tmpBase, 'genuinely-nonexistent.json'),
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'test-capability-required');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 3: NODE_ENV=test with RUNTIME_CONSULTATION_TEST_CAPABILITY absent is rejected test-capability-required', () => {
  const tmpBase = r2cMakeTmpBase('r2c-gate3-');
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: undefined,
    [R2C_ROUTING_OVERRIDE_ENV]: path.join(tmpBase, 'genuinely-nonexistent.json'),
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'test-capability-required');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 4: NODE_ENV=test with an empty-string RUNTIME_CONSULTATION_TEST_CAPABILITY is rejected test-capability-required (empty string fails the same length>0 check isTestCapability already enforces)', () => {
  const tmpBase = r2cMakeTmpBase('r2c-gate4-');
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: '',
    [R2C_ROUTING_OVERRIDE_ENV]: path.join(tmpBase, 'genuinely-nonexistent.json'),
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'test-capability-required');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 5: a relative override path is rejected path-not-absolute even with the gate satisfied', () => {
  const tmpBase = r2cMakeTmpBase('r2c-relpath-');
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: 'relative/routing-override.json',
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'path-not-absolute');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 6: an override path with no filesystem entry at all is rejected path-not-real (fs.realpathSync throws ENOENT, never a TypeError/crash)', () => {
  const tmpBase = r2cMakeTmpBase('r2c-absent-');
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: path.join(tmpBase, 'genuinely-does-not-exist.json'),
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'path-not-real');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 7: a symlink at the override path is rejected path-not-real (fs.realpathSync resolves through it, diverging from path.resolve of the symlink\'s own lexical path -- caught before classifyDurableRead ever opens anything)', () => {
  const tmpBase = r2cMakeTmpBase('r2c-symlink-');
  const realTarget = r2cWriteOverrideFixture(tmpBase, 'real-target.json');
  const symlinkPath = path.join(tmpBase, 'symlink-to-target.json');
  fs.symlinkSync(realTarget, symlinkPath);
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: symlinkPath,
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'path-not-real');
  const after = snapshotDirDigests(tmpBase);
  // The symlink itself is not a regular file walked by snapshotDirDigests
  // (readdirSync+isFile skips it as neither isDirectory nor isFile in the
  // walk below is irrelevant here -- fs.readFileSync would follow it, but
  // this walk only ever touches entries it classifies isFile()); compare the
  // real target's own digest explicitly instead.
  assert.deepStrictEqual(after, before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 8: a directory at the override path is rejected file-security-invalid (classifyDurableRead\'s own statIsRegularFile check, reached because a plain directory with no symlink component passes the earlier path-not-real/containment checks)', () => {
  const tmpBase = r2cMakeTmpBase('r2c-isdir-');
  const before = snapshotDirDigests(tmpBase);
  const dirPath = path.join(tmpBase, 'a-directory.json');
  fs.mkdirSync(dirPath);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: fs.realpathSync(dirPath),
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'file-security-invalid');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 9: an override file with mode 0644 (not exactly 0600) is rejected file-security-invalid', () => {
  const tmpBase = r2cMakeTmpBase('r2c-mode-');
  const overridePath = r2cWriteOverrideFixture(tmpBase, 'wrong-mode.json');
  fs.chmodSync(overridePath, 0o644);
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: overridePath,
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'file-security-invalid');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 10: an override file with an extra hardlink (nlink=2, the recognized in-flight PENDING window) is rejected file-durability-unproven, never silently treated as absent or retried', () => {
  const tmpBase = r2cMakeTmpBase('r2c-nlink-');
  const overridePath = r2cWriteOverrideFixture(tmpBase, 'hardlinked.json');
  const secondLink = path.join(tmpBase, 'hardlinked-second-link.json');
  fs.linkSync(overridePath, secondLink);
  assert.strictEqual(fs.statSync(overridePath).nlink, 2, 'fixture sanity: the hardlink must genuinely raise nlink to 2');
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: overridePath,
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'file-durability-unproven');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 11: an override path outside the child\'s own real TMPDIR is rejected path-outside-tmpdir, even though the path itself is otherwise perfectly valid (real, regular, mode 0600, nlink 1)', () => {
  const childTmpdir = r2cMakeTmpBase('r2c-outside-a-');
  const siblingDir = r2cMakeTmpBase('r2c-outside-b-');
  const overridePath = r2cWriteOverrideFixture(siblingDir, 'outside.json');
  const before = snapshotDirDigests(siblingDir);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: overridePath,
    TMPDIR: childTmpdir,
  });
  r2cAssertOverrideRejected(result, 'path-outside-tmpdir');
  assert.deepStrictEqual(snapshotDirDigests(siblingDir), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 12: a child whose own TMPDIR resolves to a directory with mode 0755 (not exactly 0700) is rejected tmpdir-not-secure, even for an otherwise perfectly valid override file placed inside it', () => {
  const insecureTmpdir = r2cMakeTmpBase('r2c-tmpdirmode-');
  fs.chmodSync(insecureTmpdir, 0o755);
  const overridePath = r2cWriteOverrideFixture(insecureTmpdir, 'inside-insecure-tmpdir.json');
  const before = snapshotDirDigests(insecureTmpdir);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: overridePath,
    TMPDIR: insecureTmpdir,
  });
  r2cAssertOverrideRejected(result, 'tmpdir-not-secure');
  assert.deepStrictEqual(snapshotDirDigests(insecureTmpdir), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 13: malformed JSON bytes at an otherwise fully valid override path (real, regular, 0600, nlink 1, under a secure TMPDIR) is rejected schema-invalid', () => {
  const tmpBase = r2cMakeTmpBase('r2c-badjson-');
  const overridePath = path.join(tmpBase, 'malformed.json');
  fs.writeFileSync(overridePath, '{ this is not valid JSON');
  fs.chmodSync(overridePath, 0o600);
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: fs.realpathSync(overridePath),
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'schema-invalid');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 14: well-formed JSON with the wrong schema string is rejected schema-invalid (routes must also be a genuine object -- both checks share this bucket, mirroring the canonical malformed-runtime-routing.json check this seam parallels)', () => {
  const tmpBase = r2cMakeTmpBase('r2c-badschema-');
  const overridePath = r2cWriteOverrideFixture(tmpBase, 'bad-schema.json', { schema: 'not-the-right-schema/v1', routes: { 'arch-testing': ['noop'] } });
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: overridePath,
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'schema-invalid');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 15: well-formed schema string but routes is an array instead of an object is rejected schema-invalid', () => {
  const tmpBase = r2cMakeTmpBase('r2c-badroutes-');
  const overridePath = r2cWriteOverrideFixture(tmpBase, 'bad-routes.json', { schema: 'runtime-routing/v1', routes: ['not', 'an', 'object'] });
  const before = snapshotDirDigests(tmpBase);
  const result = r2cSpawnRealCliDirect(R2C_PLACEHOLDER_ARGS, {
    NODE_ENV: 'test',
    RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: overridePath,
    TMPDIR: tmpBase,
  });
  r2cAssertOverrideRejected(result, 'schema-invalid');
  assert.deepStrictEqual(snapshotDirDigests(tmpBase), before, 'zero writes to the fixture scope on a rejected override');
});

test('R2-C RED 16 (owner mismatch, isolated fs.fstatSync instrumentation before require -- never a production seam): an otherwise fully valid override file whose STATED owner uid the durability primitive observes does not match the current process uid is rejected file-security-invalid', () => {
  const tmpBase = r2cMakeTmpBase('r2c-owner-');
  const overridePath = r2cWriteOverrideFixture(tmpBase, 'owner-mismatch.json');
  const targetStat = fs.statSync(overridePath, { bigint: true });
  const targetDev = targetStat.dev;
  const targetIno = targetStat.ino;

  const resolvedImplPath = path.resolve(__dirname, '../lib/runtime-consultation.cjs');
  const savedCacheEntry = require.cache[resolvedImplPath];
  const originalFstatSync = fs.fstatSync;
  const savedEnv = {
    NODE_ENV: process.env.NODE_ENV,
    RUNTIME_CONSULTATION_TEST_CAPABILITY: process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY,
    [R2C_ROUTING_OVERRIDE_ENV]: process.env[R2C_ROUTING_OVERRIDE_ENV],
    TMPDIR: process.env.TMPDIR,
  };
  try {
    delete require.cache[resolvedImplPath];
    process.env.NODE_ENV = 'test';
    process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY = TEST_CAPABILITY;
    process.env[R2C_ROUTING_OVERRIDE_ENV] = overridePath;
    process.env.TMPDIR = tmpBase;
    // Correlates by fd-bound dev/ino (BigInt, matching classifyDurableRead's
    // OWN `{bigint:true}` fstatSync call) -- fires ONLY for the exact inode
    // this test's own override file names, regardless of call count/order,
    // so it can never accidentally tamper with an unrelated fstatSync
    // elsewhere in this same module-load. Every other call passes through
    // to the real implementation untouched.
    fs.fstatSync = function patchedFstatSync(...fstatArgs) {
      const real = originalFstatSync.apply(fs, fstatArgs);
      if (real && typeof real === 'object' && real.dev === targetDev && real.ino === targetIno) {
        const bumpedUid = (typeof real.uid === 'bigint') ? real.uid + 1n : real.uid + 1;
        return Object.assign(Object.create(Object.getPrototypeOf(real)), real, { uid: bumpedUid });
      }
      return real;
    };
    assert.throws(
      () => require(resolvedImplPath),
      (err) => err instanceof Error && err.message === 'RUNTIME_TEST_ROUTING_OVERRIDE_INVALID:file-security-invalid',
      'an owner-mismatched override file must be rejected file-security-invalid',
    );
  } finally {
    fs.fstatSync = originalFstatSync;
    delete require.cache[resolvedImplPath];
    if (savedCacheEntry) require.cache[resolvedImplPath] = savedCacheEntry;
    for (const k of Object.keys(savedEnv)) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  }
});

test('R2-C GREEN (positive): a genuinely valid private routing override (real, regular, mode 0600, owner current, nlink 1, under a secure 0700 TMPDIR) drives ROUTING_POLICY_DIGEST as the exact SHA-256 of its own bytes, materializes a byte-identical snapshot, and leaves the real repository runtime-routing.json byte-identical', () => {
  withProject('rcc-node-r2c-positive-wave', (ctx) => {
    const tmpBase = r2cMakeTmpBase('r2c-positive-');
    const overrideTable = { schema: 'runtime-routing/v1', routes: { 'arch-testing': ['noop'], 'arch-platform': ['codex-app-server', 'claude-agent', 'noop'] } };
    const overridePath = r2cWriteOverrideFixture(tmpBase, 'valid-override.json', overrideTable);
    const overrideBytes = fs.readFileSync(overridePath);
    const expectedDigest = sha256Hex(overrideBytes);

    const realRepoRoutingPath = path.resolve(__dirname, '../lib/runtime-routing.json');
    const repoRoutingDigestBefore = sha256Hex(fs.readFileSync(realRepoRoutingPath));

    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'R2-C positive control: private routing override drives ROUTING_POLICY_DIGEST',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = spawnCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ], {
      NODE_ENV: 'test',
      RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
      [R2C_ROUTING_OVERRIDE_ENV]: overridePath,
      // Deliberately NO TMPDIR override: r2cMakeTmpBase() already creates
      // tmpBase UNDER this process's own ambient os.tmpdir(), so the
      // override file is already a genuine descendant of whatever TMPDIR
      // this spawned child inherits unchanged. Registry/grant state (minted
      // in-process by the wrapper via createRequesterBinding/
      // mintRoleCommandGrant, both TMPDIR+uid-rooted) must stay on the SAME
      // TMPDIR across this call and the dispatch call below, or the second
      // call's own grant lookup resolves a different registry root entirely
      // and fails AUTHORITY_INVALID -- empirically confirmed while authoring
      // this test.
    });
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const requestObj = JSON.parse(fs.readFileSync(publishedData.artifact_ref, 'utf8'));

    assert.strictEqual(requestObj.routing_policy_digest, expectedDigest,
      'the published request\'s own routing_policy_digest must be the exact SHA-256 of the PRIVATE override bytes, never the canonical repo digest');

    const snapshotPath = path.join(ctx.planRoot, 'routing-policies', expectedDigest + '.json');
    assert.ok(fs.existsSync(snapshotPath), 'the materialized snapshot must exist at the override digest\'s own content-addressed path');
    assert.deepStrictEqual(fs.readFileSync(snapshotPath), overrideBytes,
      'the materialized snapshot bytes must be byte-identical to the private override file\'s own bytes');

    assert.strictEqual(sha256Hex(fs.readFileSync(realRepoRoutingPath)), repoRoutingDigestBefore,
      'the real repository scripts/lib/runtime-routing.json must remain byte-identical -- this seam never writes it');

    // Confidence check mirroring R2-B case 2's own positive-control shape:
    // dispatch against the override-produced snapshot succeeds honestly via
    // the override's own noop entry (no MainOrchestratorBinding minted in
    // this fixture), proving the override drives real production behavior
    // end-to-end, not merely the digest field in isolation.
    const dispatched = spawnCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref], {
      NODE_ENV: 'test',
      RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
    });
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });
  });
});

test('publish-blob: a validated manifested entry round-trips to SUCCESS/rc0 with the exact content_ref shape', () => {
  withProject('rcc-node-blob-wave', (ctx) => {
    const blobContent = Buffer.from('fixture blob content for runtime-consultation-cli.test.js publish-blob round trip');
    const blobDigest = sha256Hex(blobContent);
    const entryRelPath = 'fixture-entry.txt';
    // Staging root is the git worktree TOPLEVEL (not the manifest's own directory),
    // and `.planning` is categorically denylisted -- confirmed by reading
    // cmdPublishBlob's own BLOB_DENYLISTED_SEGMENTS set and its
    // `gitRevParse(coordRoot, ['rev-parse', '--show-toplevel'])` call during this
    // file's authoring, then empirically verified via direct CLI probing.
    fs.writeFileSync(path.join(ctx.projDir, entryRelPath), blobContent);
    fs.writeFileSync(ctx.subjectBundlePath, JSON.stringify({
      schema: 'coordination/subject-bundle-manifest/v1',
      entries: [{ path: entryRelPath, size: blobContent.length, digest: blobDigest }],
    }));

    const result = runTestCli([
      'publish-blob', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--entry', entryRelPath,
    ]);
    const data = assertCliResult(result, { command: 'publish-blob', status: 'SUCCESS', detail_code: 'NONE' });
    assertContentRefShape(data.content_ref, blobDigest, blobContent.length);
    assert.strictEqual(data.artifact_ref, path.join(ctx.planRoot, 'blobs', blobDigest),
      'artifact_ref must name the published blobs/<sha256> path under this exact plan-root');
    assert.strictEqual(fs.readFileSync(data.artifact_ref).toString(), blobContent.toString());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WP2 determinism / fake-clock seam (task dispatch: "add the WP2
// determinism/fake-clock RED cases"). `--fixed-ids`/`--fixed-clock` are ALREADY
// argv-accepted and capability-gated (the "Determinism / test-capability
// gating" group above), but `genId()`/`nowIso()` -- read directly from this
// file's own implementation during this task's authoring -- are UNCONDITIONAL:
// `genId()` is exactly `crypto.randomBytes(32).toString('hex')` and `nowIso()`
// is exactly `new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')`; NEITHER
// function reads `process.argv`, the parsed `flags` object, or ANY environment
// variable. Every case below is EXPECTED TO FAIL today (genuine RED, PLAN.md
// ~L1503/~L1418/~L1199/~L1501) until a future wiring dispatch makes both
// functions capability/flag-aware. `await-result`'s deadline loop
// (`cmdAwaitResult`) is likewise unconditional: it computes its deadline from a
// raw `Date.now()` call and blocks via a REAL `sleepSync()` (`Atomics.wait`) --
// it has no fake-clock/advance hook of any kind yet (W06).
//
// Per this task's own "no fabrication" duty, two source-level findings from
// reading `cmdPublishRequest` during authoring are documented here (both shape
// what the WIRED contract must actually do, not just this test -- reported for
// the wiring dispatch to resolve, NOT resolved here; impl is out of this
// task's single-owned scope):
//
// FINDING A (genId() call order): `cmdPublishRequest` calls the shared
// `genId()` SEVEN times per invocation, not once. THREE calls happen BEFORE
// `request_id` is minted -- `publishNoClobber`'s own internal owner-tagged
// same-dir temp-filename suffix (`genId().slice(0, 16)`, this file's line
// ~467) is invoked once each by `materializePlanRef`/`materializeRoutingPolicy`/
// `materializeSubjectBundle`. `request_id` itself is therefore the FOURTH
// `genId()` call of the invocation (`requester_instance_id` the fifth,
// `initial_attempt_id` the sixth, and the final `request.json`
// `publishNoClobber` consumes a seventh for ITS OWN temp name). If a
// per-process monotonic counter is wired onto the literal shared `genId()`
// function with no other change, `request_id` would observably be
// `fixed-id-0003`, NOT `fixed-id-0000`. The DET-ids case below nonetheless
// asserts the literal `fixed-id-0000` this task's own dispatch specifies
// verbatim (frozen this cycle, "assert EXACTLY this") -- which therefore ALSO
// pins an actionable wiring requirement: either (a) temp-file-name suffixes
// must draw from a separate, uncounted random source (they are never
// schema-visible and never need to participate in the deterministic "which
// generated id is this" sequence), or (b) `cmdPublishRequest` must mint
// `request_id` before any `materialize*` call.
//
// FINDING B (idempotent replay): the final `request.json` `publishNoClobber`
// call in `cmdPublishRequest` (this file's line ~1747) does NOT pass
// `{allowIdenticalIdempotent: true}` -- unlike `materializePlanRef`/
// `materializeRoutingPolicy`/`materializeSubjectBundle`, which all do. Under
// fully-deterministic `--fixed-ids --fixed-clock` replay (same plan-root, same
// operation sequence, two SEPARATE processes), the SECOND process's request
// object would be byte-identical to the first (same ids, same `created_at`)
// and would attempt to publish to the EXACT SAME `request.json` path --
// without `allowIdenticalIdempotent: true` there, that second publish loses
// the no-clobber race and returns `AUTHORITY_INVALID`, not the byte-identical
// `SUCCESS` the DET-ids case below requires. Achieving this task's
// dispatch-specified "byte-identical stdout across two processes" therefore
// also requires the wiring dispatch to add `allowIdenticalIdempotent: true` to
// that one call site.
//
// UPDATE (this cycle): Findings A and B above are now RESOLVED by the wired
// seam -- confirmed empirically by reading the live impl and by this file's
// own baseline run. Finding A: `genId(opts)` now takes an `opts.raw` param;
// `publishNoClobber`'s internal temp-file-name suffix calls `genId({raw:
// true})`, which ALWAYS draws real crypto randomness and never touches the
// fixed-ids counter -- so those three pre-request-id `materialize*` calls
// consume zero counter slots, and `request_id` (the first NON-raw genId()
// call) really is counter value 0, matching this task's own literal
// `'0'.repeat(32)` (Option Y's hex-counter shape), not `fixed-id-0003` as this
// finding originally worried. Finding B: `cmdPublishRequest`'s own final
// `request.json` `publishNoClobber` call now DOES pass
// `{allowIdenticalIdempotent: true}` -- confirmed by reading the live impl.
// Both resolutions are why DET-ids below is GREEN through its SUCCESS/shape
// and byte-identical-stdout assertions; the only remaining gap this cycle was
// the id-SHAPE assertion, now fixed to Option Y's real hex-counter contract.
//
// A THIRD, smaller note applies to DET-ids's use of `publish-request`
// specifically: `consult-v2`'s own `expiry` field is cross-validated against
// `created_at` (`assertClosedShape` -> `CONSULT_V2_FIELDS.expiry.check`,
// requiring `120 <= (expiry - created_at) <= 3600` seconds). This file's fixed
// literal expiry constants below are deliberately chosen RELATIVE TO THE
// FROZEN base clock (not real wall-clock time), so they become valid ONLY once
// `--fixed-clock` is correctly wired (at which point `created_at` becomes that
// same frozen value). One direct consequence AT THIS FILE'S ORIGINAL AUTHORING
// TIME: DET-ids failed at the SUCCESS/detail_code:NONE assertion with an
// actual status of INVALID/SCHEMA_INVALID (created_at was real current time,
// which this fixture's frozen-relative expiry fell far outside the window of)
// -- NOT via a directly-observed wrong id VALUE. UPDATE (this cycle): now that
// `--fixed-clock` is wired, `created_at` genuinely IS this fixture's frozen
// base, so that SUCCESS/shape check now genuinely passes -- confirmed
// empirically (this file's own baseline run showed DET-ids failing ONLY at
// the id-shape assertion below, never at the SUCCESS/shape check). DET-ids
// still orders its assertions with the SUCCESS/shape check FIRST (clearest
// diagnostic if this ever regresses), and it is exactly why DET-clock's two cases use `cancel`
// (whose `cancelled_at` field carries no such cross-field constraint) instead
// of `publish-request`, sidestepping the tension entirely for a
// directly-observable timestamp-value RED signal.
// ═══════════════════════════════════════════════════════════════════════════

// Mirrored here, NOT imported (same rationale as FIXED_CLOCK_DEFAULT_BASE_STRIPPED
// below): the impl module's `module.exports` carries only
// `{canonicalJSONStringify, sha256Buffer, sha256String, sha256File}`. This is the
// REAL shape a fixed id takes under the wired seam (Option Y, read directly off
// runtime-consultation.cjs's own `HEX_ID_RE`): a deterministic, zero-padded
// 32-char lowercase-hex counter, schema-compatible with the existing
// HEX_ID_RE/isHexId UNCHANGED -- NOT the non-hex `fixed-id-NNNN` placeholder
// shape an earlier draft of this task assumed (genId()'s own header comment:
// that shape was rejected because it would create a cross-process
// isHexId-coherence hazard in readTakeoverIfValid).
const HEX_ID_RE = /^[a-f0-9]{32,128}$/;

// Frozen default base clock (task dispatch seam contract, verbatim) + this
// file's OWN independent nowIso()-equivalent millisecond-stripping (`new
// Date(iso).toISOString()` always carries a `.mmmZ` suffix; `nowIso()` -- read
// directly in runtime-consultation.cjs -- strips it to a bare `Z`). Mirrored
// here, NOT imported: the impl module's `module.exports` carries only
// `{canonicalJSONStringify, sha256Buffer, sha256String, sha256File}`.
const FIXED_CLOCK_DEFAULT_BASE_STRIPPED = '2025-01-01T00:00:00Z';
// consult-v2's expiry must be 120..3600s after created_at -- 1800s (30min)
// after the frozen base, comfortably inside that window.
const FIXED_CLOCK_DEFAULT_EXPIRY = '2025-01-01T00:30:00Z';

const FIXED_CLOCK_OVERRIDE = '2030-06-15T12:00:00.000Z';
const FIXED_CLOCK_OVERRIDE_STRIPPED = '2030-06-15T12:00:00Z';

/** `runTestCli` plus arbitrary additional env (e.g. RUNTIME_CONSULTATION_FAKE_CLOCK*). */
function runDeterminismCli(args, extraEnv) {
  return spawnCli(args, Object.assign(
    { NODE_ENV: 'test', RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY },
    extraEnv || {},
  ));
}

test('DET-ids: --fixed-ids/--fixed-clock make publish-request byte-identical across two SEPARATE processes with request_id the Option-Y hex-counter shape (GREEN: the WP2 fake-clock/fixed-ids seam is now wired -- request_id is the first non-raw genId() call, deterministic counter value 0)', () => {
  withProject('rcc-node-det-ids-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'DET-ids fixed cross-process replay fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: FIXED_CLOCK_DEFAULT_EXPIRY,
    });
    const argv = [
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64, '--fixed-ids', '--fixed-clock',
    ];
    const first = runTestCli(argv);
    const second = runTestCli(argv); // a genuinely separate `spawnSync` child process, not a repeated in-process call

    // Ordered deliberately: the SUCCESS/shape check surfaces the clearest
    // diagnostic first -- see the "THIRD note" in the header above for why
    // this fails here (INVALID/SCHEMA_INVALID) rather than at the
    // byte-identical line today.
    const data = assertCliResult(first, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    assert.strictEqual(first.stdout, second.stdout,
      'the identical operation-sequence under --fixed-ids/--fixed-clock must be byte-identical across two SEPARATE processes (PLAN.md ~L1503, W08 equivalence); currently RED because genId()/nowIso() are unconditional (real crypto.randomBytes/real Date), so every id/timestamp differs every call');
    assert.match(data.request_id, HEX_ID_RE, 'request_id must be a lowercase-hex id conforming to the impl\'s own HEX_ID_RE -- Option Y mandates a hex-conformant fixed id, never a non-hex fixed-id-NNNN placeholder shape');
    assert.strictEqual(data.request_id, '0'.repeat(32),
      'first minted (non-raw) genId() call in the process is request_id -- publishNoClobber\'s own internal temp-file-name nonces always pass {raw: true}, which genId() defines to bypass the fixed-ids counter entirely (real crypto randomness regardless of mode), so they never consume a counter slot; the deterministic counter therefore starts this process at 0 for request_id (Option Y, confirmed empirically against the live seam -- see the UPDATE note in the header above re: FINDING A)');
  });
});

test('DET-ids contrast: the identical publish-request run twice WITHOUT --fixed-ids/--fixed-clock (still under the test capability) produces DIFFERENT request_ids (must keep PASSING -- guards against over-fixing)', () => {
  withProject('rcc-node-det-ids-contrast-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'DET-ids contrast fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const argv = [
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ];
    const first = assertCliResult(runTestCli(argv), { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const second = assertCliResult(runTestCli(argv), { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    assert.notStrictEqual(first.request_id, second.request_id,
      'without --fixed-ids, request_id must stay randomly-generated per call -- production determinism must never leak without the flag');
  });
});

test('DET-clock: --fixed-clock forces every emitted timestamp (cancel.cancelled_at) to the frozen default base, never real wall-clock time (regression: nowIso() is unconditional real Date today)', () => {
  withProject('rcc-node-det-clock-default-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(requestPath, ctx, Object.assign({ request_id: requestId, root_request_id: requestId }, knownRequesterIdentity(ctx)));

    const result = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--reason', 'explicit', '--fixed-clock']);
    const data = assertCliResult(result, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });
    const cancelObj = JSON.parse(fs.readFileSync(data.artifact_ref, 'utf8'));
    assert.strictEqual(cancelObj.cancelled_at, FIXED_CLOCK_DEFAULT_BASE_STRIPPED,
      'cancelled_at must equal the frozen default base clock under --fixed-clock, never real wall-clock time -- got: ' + cancelObj.cancelled_at);
    const realNowProximityMs = Math.abs(Date.now() - new Date(cancelObj.cancelled_at).getTime());
    assert.ok(realNowProximityMs > 24 * 3600 * 1000,
      'cancelled_at must not be a freshly-observed real wall-clock value (expected the far-past 2025-01-01 frozen base)');
  });
});

test('DET-clock override: RUNTIME_CONSULTATION_FAKE_CLOCK=<ISO> overrides the frozen base under --fixed-clock', () => {
  withProject('rcc-node-det-clock-override-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(requestPath, ctx, Object.assign({
      request_id: requestId,
      root_request_id: requestId,
      created_at: FIXED_CLOCK_OVERRIDE_STRIPPED,
      expiry: '2030-06-15T12:30:00Z',
    }, knownRequesterIdentity(ctx)));

    const result = runDeterminismCli(
      ['cancel', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--reason', 'explicit', '--fixed-clock'],
      { RUNTIME_CONSULTATION_FAKE_CLOCK: FIXED_CLOCK_OVERRIDE },
    );
    const data = assertCliResult(result, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });
    const cancelObj = JSON.parse(fs.readFileSync(data.artifact_ref, 'utf8'));
    assert.strictEqual(cancelObj.cancelled_at, FIXED_CLOCK_OVERRIDE_STRIPPED,
      'cancelled_at must equal the RUNTIME_CONSULTATION_FAKE_CLOCK override, not the default base and never real wall-clock time -- got: ' + cancelObj.cancelled_at);
    const realNowProximityMs = Math.abs(Date.now() - new Date(cancelObj.cancelled_at).getTime());
    assert.ok(realNowProximityMs > 24 * 3600 * 1000,
      'cancelled_at must not be a freshly-observed real wall-clock value (expected the far-future 2030-06-15 override)');
  });
});

test('DET-deadline (W06 seam): RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS forces await-result past its deadline INSTANTLY, with no real sleep (regression: await-result uses a raw Date.now() deadline + a real Atomics.wait poll loop today, unconditionally)', () => {
  withProject('rcc-node-det-deadline-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(requestPath, ctx, Object.assign({ request_id: requestId, root_request_id: requestId }, knownRequesterIdentity(ctx)));

    const t0 = Date.now();
    const result = runDeterminismCli(
      ['await-result', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--timeout', '2', '--fixed-clock'],
      { RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS: '5000' },
    );
    const elapsedMs = Date.now() - t0;

    assertCliResult(result, { command: 'await-result', status: 'TIMEOUT', detail_code: 'DEADLINE_EXCEEDED' });
    assert.ok(elapsedMs < 1000,
      'RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS must force the deadline check to fire instantly (no real sleep) -- elapsed wall time was ' + elapsedMs + 'ms; today this reliably takes >=2000ms because await-result unconditionally polls a real Date.now()/Atomics.wait loop against its own --timeout, ignoring the fake-clock-advance seam entirely');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Gap#1 (WP2-verdict fix): Windows total-argv cap. `main()`'s pre-parseFlags
// argv-cap check (read directly off the live impl) branches on
// `resolveEffectivePlatform() === 'win32'`: on that branch it sums UTF-16 code
// units across the whole post-hook argv and caps at 28672; otherwise it sums
// UTF-8 bytes and caps at 131072 (POSIX, already covered by RCC-caps-2 in the
// sibling bats file). `resolveEffectivePlatform()` honors
// RUNTIME_CONSULTATION_FORCE_PLATFORM ONLY when `isTestCapability()` holds (the
// exact same NODE_ENV=test + RUNTIME_CONSULTATION_TEST_CAPABILITY gate as
// --fixed-ids/--fixed-clock) -- production always observes the real
// `process.platform`. `cancel` is used as the vehicle: its `--reason` flag is
// NOT one of the 2048-byte-capped PATH_FLAG_NAMES, so an oversized value there
// exercises ONLY the total-argv-cap branch, never the unrelated per-flag
// path-token cap.
// ═══════════════════════════════════════════════════════════════════════════

const OVERSIZED_ARGV_VALUE = 'x'.repeat(32000); // all-ASCII: 32000 UTF-16 units == 32000 UTF-8 bytes -- comfortably over the 28672 Windows cap, comfortably under the 131072 POSIX cap even with argv overhead included.

test('Gap#1: total argv exceeding 28672 UTF-16 units (well under the 131072-byte POSIX cap) is rejected under RUNTIME_CONSULTATION_FORCE_PLATFORM=win32 -> INVALID/rc3/INVALID_ARGUMENT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
  try {
    const reqPath = path.join(dir, 'fake-repo', 'fake-wave', 'fake-plan', 'transactions', 'ghost-request', 'request.json'); // deliberately never written, but properly-shaped (5-segment) so it fails at the request-read stage, not the geometry check
    const result = spawnCli(
      ['cancel', '--coordination-root', dir, '--request', reqPath, '--reason', OVERSIZED_ARGV_VALUE],
      {
        NODE_ENV: 'test',
        RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
        RUNTIME_CONSULTATION_FORCE_PLATFORM: 'win32',
      },
    );
    assertCliResult(result, { command: 'cancel', status: 'INVALID', detail_code: 'INVALID_ARGUMENT' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Gap#1 contrast: the identical oversized-but-under-POSIX-cap argv WITHOUT RUNTIME_CONSULTATION_FORCE_PLATFORM (real, non-win32 platform) is NOT rejected by the Windows-cap branch -- it is rejected instead by the unrelated, pure-argv-grammar --reason enum check, distinguishable from the win32 cap ONLY by status (USAGE_ERROR vs INVALID), since both currently share the INVALID_ARGUMENT detail_code', () => {
  // M7 completeness (2026-08-09): cancel is now grant-mandatory (PLAN.md
  // §15b) and validateAndConsumeRoleCommandGrantForCommand runs BEFORE
  // cmdCancel's own body -- a bare, non-git mkdtemp coordination-root (this
  // test's ORIGINAL fixture) gives the grant-wrapper no resolvable project
  // scope to mint against, so it falls through to AUTHORITY_INVALID before
  // ever reaching cmdCancel's own --reason check this test targets. Switched
  // to withProject() (this file's own established git+PLAN-backed fixture,
  // already used elsewhere in this file for the identical grant-mandatory
  // requirement) so the wrapper CAN mint a real grant and cmdCancel's own
  // logic is genuinely reached.
  //
  // M6+M7 requester-authority closure (Group B, 2026-08-10) fixture
  // correction: a SECOND, DEEPER layer of the same grant-mandatory
  // requirement -- resolveRequesterGrantScope (which the wrapper now calls
  // to resolve cancel's own request_id/attempt_id/lease_epoch triple) itself
  // requires `--request` to name a REAL, accreditable request.json BEFORE it
  // will resolve a scope at all, so this test's own "ghost" (deliberately
  // never-written) request path can no longer even get a grant minted --
  // AUTHORITY_INVALID now fires before cmdCancel's own --reason check is
  // ever reached, for a DIFFERENT reason than this test intends to isolate.
  // A real, accredited (writeRawRequest + knownRequesterIdentity) fixture
  // restores the original intent: --reason is a pure argv-grammar check
  // inside cmdCancel itself, independent of the request's own content, so a
  // genuinely-granted call still reaches and fails it exactly the same way.
  withProject('gap1-contrast-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const reqPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(reqPath, ctx, Object.assign({ request_id: requestId, root_request_id: requestId }, knownRequesterIdentity(ctx)));
    const result = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', reqPath, '--reason', OVERSIZED_ARGV_VALUE]);
    // Codex NO-GO round 10: cmdCancel's TOCTOU fix moved accreditCanonicalRequest
    // (the file-touching call that used to throw CORRELATION_INVALID here)
    // inside withLock, so it no longer runs before the pure-argv --reason
    // enum check -- which now fires first, since OVERSIZED_ARGV_VALUE (32000
    // 'x's) can never be a CANCEL_REASON_ENUM member regardless of length.
    // This is the file's own established, correct convention (pure
    // argv-grammar problems are USAGE_ERROR and are checked before any file
    // I/O, per RCC-argv-1..7) -- not a regression to route around. What this
    // test must still prove is unchanged: the win32-only ARGV-CAP (which
    // throws status INVALID) must NOT be the thing that rejected this on a
    // non-win32 platform. Status is the only field that cleanly distinguishes
    // the two checks here, since both currently throw the same
    // INVALID_ARGUMENT detail_code.
    assertCliResult(result, { command: 'cancel', status: 'USAGE_ERROR', detail_code: 'INVALID_ARGUMENT' });
  });
});

test('Gap#1: RUNTIME_CONSULTATION_FORCE_PLATFORM is honored ONLY under the test capability -- without NODE_ENV=test/capability, the override is ignored and the real (non-win32) platform applies, so the same oversized-but-under-POSIX argv is rejected only by the unrelated --reason enum check, never the win32 cap', () => {
  // M7 completeness (2026-08-09): same withProject() fix as the contrast test
  // above, for the identical reason (grant-mandatory cancel needs a
  // resolvable project scope to mint against before cmdCancel's own body --
  // and therefore its own --reason check -- is ever reached).
  //
  // M6+M7 requester-authority closure (Group B, 2026-08-10) fixture
  // correction: same SECOND, DEEPER fix as the contrast test's own comment
  // above -- resolveRequesterGrantScope needs a REAL, accreditable
  // request.json to resolve a scope at all, so the "ghost" path is replaced
  // with a real, known-identity fixture here too.
  withProject('gap1-nocap-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const reqPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(reqPath, ctx, Object.assign({ request_id: requestId, root_request_id: requestId }, knownRequesterIdentity(ctx)));
    const result = spawnCli(
      ['cancel', '--coordination-root', ctx.coordRoot, '--request', reqPath, '--reason', OVERSIZED_ARGV_VALUE],
      {
        NODE_ENV: undefined,
        RUNTIME_CONSULTATION_TEST_CAPABILITY: undefined,
        RUNTIME_CONSULTATION_FORCE_PLATFORM: 'win32',
      },
    );
    // If the override leaked outside the test capability, the win32 argv-cap
    // would fire and this would be status INVALID/INVALID_ARGUMENT; instead
    // it must fall through to the SAME pure-argv --reason enum check (status
    // USAGE_ERROR) the contrast case above hits, proving the override is
    // inert without NODE_ENV=test + capability. See the contrast test above
    // for why this is USAGE_ERROR rather than CORRELATION_INVALID as of
    // round 10's TOCTOU fix.
    //
    // NOTE: this spawnCli call clears NODE_ENV/RUNTIME_CONSULTATION_TEST_CAPABILITY
    // (production invocation, deliberately) but goes through GRANT_WRAPPER
    // like every spawnCli call -- the wrapper's OWN grant-minting is
    // independent of those two env vars (it is test-only INFRASTRUCTURE, not
    // itself gated by the production/test-capability switch under test
    // here), so a real grant is still minted and injected exactly as in the
    // contrast test above.
    assertCliResult(result, { command: 'cancel', status: 'USAGE_ERROR', detail_code: 'INVALID_ARGUMENT' });
  });
});

// ── WP3 W10b-equivalent: RUNTIME_CONSULTATION_ACL_PROBE wiring (PLAN.md ~L1506) ──
// root-validate's win32 branch previously parsed/gated this env var (argv layer)
// but never CONSULTED its value (a seam with no behavior). cmdRootValidate now
// reads it under the SAME RUNTIME_CONSULTATION_FORCE_PLATFORM=win32 seam Gap#1
// above uses, making the win32-only branch genuinely exercisable on any host --
// not merely unverified dead code. Full icacls-based SID/ACL inspection (W09
// baseline, W10a world-SID rejection) is NOT implemented (deliberately deferred:
// no Windows access to develop/verify that safely) -- only the ACL_PROBE seam
// itself is proven here.
test('WP3 ACL_PROBE: root-validate under simulated win32 with RUNTIME_CONSULTATION_ACL_PROBE=unverifiable is rejected INVALID/SECURITY_INVALID (W10b: indeterminate ACL disables sibling mode fail-closed)', () => {
  // M7/WP4 Phase B.3 (dispatch arch-testing-20260809T092330Z): root-init AND
  // root-validate are now grant-mandatory -- see the SUCCESS/rc0 test's own
  // matching comment.
  const dir = makeTempProject();
  planFileFor(dir, 'rcc-node-wave-aclprobe');
  try {
    const coordRoot = path.join(dir, 'coordination');
    const initResult = runTestCli(['root-init', '--coordination-root', coordRoot]);
    assertCliResult(initResult, { command: 'root-init', status: 'SUCCESS', detail_code: 'NONE' });

    const validateResult = spawnCli(
      ['root-validate', '--coordination-root', coordRoot],
      {
        NODE_ENV: 'test',
        RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
        RUNTIME_CONSULTATION_FORCE_PLATFORM: 'win32',
        RUNTIME_CONSULTATION_ACL_PROBE: 'unverifiable',
      },
    );
    assertCliResult(validateResult, { command: 'root-validate', status: 'INVALID', detail_code: 'SECURITY_INVALID' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('WP3 ACL_PROBE contrast: root-validate under simulated win32 WITHOUT the probe override currently succeeds (no real icacls/SID inspection exists yet -- honest PENDING_CI gap, not a false-secure claim)', () => {
  // M7/WP4 Phase B.3 (dispatch arch-testing-20260809T092330Z): root-init AND
  // root-validate are now grant-mandatory -- see the SUCCESS/rc0 test's own
  // matching comment.
  const dir = makeTempProject();
  planFileFor(dir, 'rcc-node-wave-aclprobe-contrast');
  try {
    const coordRoot = path.join(dir, 'coordination');
    const initResult = runTestCli(['root-init', '--coordination-root', coordRoot]);
    assertCliResult(initResult, { command: 'root-init', status: 'SUCCESS', detail_code: 'NONE' });

    const validateResult = spawnCli(
      ['root-validate', '--coordination-root', coordRoot],
      {
        NODE_ENV: 'test',
        RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
        RUNTIME_CONSULTATION_FORCE_PLATFORM: 'win32',
      },
    );
    assertCliResult(validateResult, { command: 'root-validate', status: 'SUCCESS', detail_code: 'NONE' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── DUR-A: writeAllSync fail-closed on a stuck zero-progress write ───────────────
// A blocking write to a regular file advances by >=1 byte or throws; a writeSync()
// returning 0 with bytes still pending makes no progress. The pre-fix loop
// `while (offset < len) offset += fs.writeSync(...)` would spin FOREVER on such a
// 0-return -- a durability-path liveness hazard, since publishNoClobber and
// publishReplace both stream their canonical bytes through writeAllSync. This unit
// test binds the exported helper directly and forces the pathological 0-return via a
// scoped, call-capped fs.writeSync stub (the cap guarantees the test process can
// never actually hang whether or not the guard exists), then requires the guard's
// own no-progress error to surface. Pre-fix, the stub's cap sentinel (a DISTINCT
// message) escapes instead, so the /made no progress/ match fails RED.
test('DUR-A: writeAllSync fails closed on a stuck zero-progress writeSync instead of looping forever', () => {
  const rc = require(IMPL);
  assert.strictEqual(typeof rc.writeAllSync, 'function',
    'writeAllSync must be exported so its fail-closed loop guard can be exercised directly');
  const realWriteSync = fs.writeSync;
  let calls = 0;
  fs.writeSync = function stuckZeroProgressWrite() {
    calls += 1;
    if (calls > 10000) {
      // Safety net: without the guard the loop is unbounded. Cap it so the process
      // can never truly hang, and throw a DISTINCT sentinel whose message does NOT
      // contain "made no progress" -- so the assertion below fails RED pre-fix.
      throw new Error('writeAllSync-unbounded-loop-sentinel');
    }
    return 0; // a write that persists nothing: offset must not advance
  };
  try {
    assert.throws(
      () => rc.writeAllSync(1 /* fd unused: the stub never touches it */, Buffer.from('durability-payload')),
      /made no progress/,
      'writeAllSync must fail closed with a no-progress error on writeSync()===0, never spin',
    );
  } finally {
    fs.writeSync = realWriteSync;
  }
});

// ── LOCK-08 (DUR-J item 2): unforgeable WeakMap-private transition-lock token ────
// A transition-lock token is a frozen empty object; ALL its authority lives in a module-
// private WeakMap. LOCK-08a freezes the READ side (plain/clone/mutated/wrong-txn/traversal/
// stale tokens all rejected for a mutable immutablePath:false read); LOCK-08b freezes the
// RELEASE side (a forged / double / deleted-recreated release never mutates the filesystem).
test('LOCK-08a: a mutable read requires a LIVE authentic same-txn transition-lock token -- plain / clone / wrong-txn / traversal / stale tokens are all rejected', () => {
  const rc = require(IMPL);
  for (const name of ['classifyDurableRead', 'acquireLock', 'releaseLock']) {
    assert.strictEqual(typeof rc[name], 'function', name + ' must be exported');
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-tok-a-'));
  try {
    const txnA = path.join(dir, 'txnA');
    const txnB = path.join(dir, 'txnB');
    fs.mkdirSync(txnA);
    fs.mkdirSync(txnB);
    const leaseInA = path.join(txnA, 'active-lease.json');
    const readWith = (tok, p) => rc.classifyDurableRead(p || leaseInA, { immutablePath: false, lockToken: tok });
    const tokenA = rc.acquireLock(txnA, dir);
    const tokenB = rc.acquireLock(txnB, dir);
    try {
      // plain / faked-field / shallow-clone tokens are not in the registry -> rejected.
      assert.throws(() => readWith({}), /authentic transition-lock token/, 'plain object rejected');
      assert.throws(() => readWith({ active: true, canonicalTxnDir: txnA, canonicalLockDir: path.join(txnA, '.lock') }), /authentic transition-lock token/, 'faked-field object rejected');
      assert.throws(() => readWith(Object.assign({}, tokenA)), /authentic transition-lock token/, 'shallow clone rejected');
      assert.ok(Object.isFrozen(tokenA), 'token is frozen -- no metadata to mutate');
      // wrong-txn: tokenB does not authorize a txnA path.
      assert.throws(() => readWith(tokenB), /authentic transition-lock token/, 'wrong-txn token rejected');
      // traversal / sibling-prefix: tokenA does not authorize a path outside txnA.
      assert.throws(() => readWith(tokenA, path.join(txnA, '..', 'escape.json')), /authentic transition-lock token/, '.. traversal rejected');
      assert.throws(() => readWith(tokenA, path.join(txnB, 'x.json')), /authentic transition-lock token/, 'sibling-dir path rejected');
      // the authentic same-txn token DOES authorize (absent -> ABSENT, no throw).
      assert.strictEqual(readWith(tokenA).state, 'ABSENT', 'authentic same-txn token authorizes the mutable read');
    } finally {
      rc.releaseLock(tokenA);
      rc.releaseLock(tokenB);
    }
    // stale (already-released) token is rejected.
    assert.throws(() => readWith(tokenA), /authentic transition-lock token/, 'stale/released token rejected');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── AUDIT (DUR-J item 6): no by-path hash of a coordination record ──────────────
// Freeze the exit criterion "cero raw authority hashes": sha256File may hash ONLY the
// non-authoritative caller inputs (planPath -- PLAN.md / subject). Every coordination
// record (request/claim/result/...) is hashed from the SAME accredited fd-bound read
// (readDurableRecord / publishNoClobber bytes), never re-hashed by path.
test('AUDIT-sha256File: sha256File is called ONLY on planPath (non-authoritative input); zero coordination-record by-path hashes remain', () => {
  const src = fs.readFileSync(IMPL, 'utf8');
  const offenders = src.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter((x) => /sha256File\(/.test(x.line) && !/^function sha256File/.test(x.line))
    .filter((x) => !/sha256File\(planPath\)/.test(x.line));
  assert.deepStrictEqual(offenders, [], 'sha256File must be planPath-only; record by-path hashes found: ' + JSON.stringify(offenders));
});

// Section 0.4 (correction pass): AUDIT-sha256File above whitelists only DIRECT textual
// `sha256File(...)` calls -- it says nothing about a raw `fs.readFileSync`/`readArtifactBytes`
// by-path re-read of a coordination record feeding some OTHER hash or comparison. This audit
// closes that gap: every raw-content-read call site in the whole file must be either fd-bound
// (the argument is literally `fd` -- already open+fstat+identity-verified by its caller), one
// of the two named non-authoritative caller inputs (`planPath` for PLAN materialize,
// `manifestPath` for the subject-bundle manifest via readArtifactBytes), or inside the gated
// fault-injection test seam (`injectReadMutationFault`, which deliberately mutates/rereads a
// fixture to PROVE the durable reader rejects it -- never a production authority path). A new
// occurrence outside this exact, hand-reviewed allowlist must fail this test until explicitly
// added here.
test('AUDIT-raw-reads: every raw fs.readFileSync/readArtifactBytes call site is fd-bound, a named non-authoritative caller input, or gated fault-injection test-seam code', () => {
  const src = fs.readFileSync(IMPL, 'utf8');
  const ALLOWED_EXACT_LINES = new Set([
    'return sha256Buffer(fs.readFileSync(filePath));', // sha256File primitive (planPath-only, per AUDIT-sha256File)
    'return fs.readFileSync(artifactPath);', // readArtifactBytes primitive
    'const bytes = fs.readFileSync(planPath);', // materializePlanRef (PLAN.md itself, non-authoritative)
    'const bytes = readArtifactBytes(manifestPath);', // subject-bundle manifest (caller input, non-authoritative)
    "else if (kind === 'rewrite') fs.writeFileSync(artifactPath, fs.readFileSync(artifactPath)); // same inode+size, new ctime/mtime", // injectReadMutationFault test seam
    'fs.writeFileSync(other, fs.readFileSync(artifactPath), { mode: 0o600 });', // injectReadMutationFault test seam
    "return fs.readFileSync(path.join(__dirname, 'runtime-routing.json'));", // R2-C loadRoutingPolicyContent() canonical-fallback branch (absent/empty RUNTIME_CONSULTATION_TEST_ROUTING_POLICY_PATH): WP3: toolkit-owned fixed file (sibling of this module), never request/caller-controlled -- same category as planPath above, read once at module load, unchanged from the bare const this line replaces
    'goBytes = fs.readFileSync(goPath);', // M7 section 10.1 / defect 12 testM7Rendezvous: gated (NODE_ENV=test + RUNTIME_CONSULTATION_TEST_CAPABILITY + exact RUNTIME_M7_TEST_STAGE + safely-scoped RUNTIME_M7_TEST_RENDEZVOUS_DIR) fault-injection/rendezvous test-only seam, now ALSO gated on a same-block fs.lstatSync(goPath) proving a genuine regular mode-0600 file (never a symlink) before this line is ever reached (M7 defect 12 / checklist item 17: a symlink pointing at correct bytes elsewhere must never be accepted as the real release signal) -- goPath's own bytes still carry no authority ("No sentinel is an authority artifact", contract section 10.1), same category as injectReadMutationFault above
  ]);
  const offenders = src.split('\n')
    .map((raw, i) => ({ line: raw.trim(), n: i + 1 }))
    .filter((x) => /fs\.readFileSync\(|readArtifactBytes\(/.test(x.line))
    .filter((x) => !/^function (sha256File|readArtifactBytes)\b/.test(x.line)) // definition headers, not calls
    .filter((x) => !/fs\.readFileSync\(fd\)/.test(x.line)) // fd-bound: already open+fstat+identity-verified
    .filter((x) => !ALLOWED_EXACT_LINES.has(x.line));
  assert.deepStrictEqual(offenders, [], 'raw by-path read outside the hand-reviewed allowlist: ' + JSON.stringify(offenders));
});

test('LOCK-08b: releaseLock authenticates BEFORE any fs mutation -- a forged / double / deleted-recreated release never removes the real .lock and is rejected', () => {
  const rc = require(IMPL);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-tok-b-'));
  try {
    const txn = path.join(dir, 'txn');
    fs.mkdirSync(txn);
    const lockDir = path.join(txn, '.lock');
    const token = rc.acquireLock(txn, dir);
    // a forged release must NOT touch the filesystem -- the real .lock survives.
    assert.throws(() => rc.releaseLock({}), /non-authentic|already-released/, 'forged plain release rejected');
    assert.throws(() => rc.releaseLock(Object.assign({}, token)), /non-authentic|already-released/, 'forged clone release rejected');
    assert.ok(fs.existsSync(lockDir), 'forged releases did NOT remove the real .lock');
    // genuine release removes it + revokes the token.
    rc.releaseLock(token);
    assert.ok(!fs.existsSync(lockDir), 'genuine release removed the .lock');
    // double release is rejected (token revoked) and creates/removes nothing.
    assert.throws(() => rc.releaseLock(token), /non-authentic|already-released/, 'double release rejected');
    // deleted+recreated lock: a token whose .lock inode changed is rejected at release.
    const token2 = rc.acquireLock(txn, dir);
    fs.rmdirSync(lockDir);
    fs.mkdirSync(lockDir); // a DIFFERENT inode occupies the path now.
    assert.throws(() => rc.releaseLock(token2), /identity changed|vanished/, 'deleted+recreated lock rejected at release');
    fs.rmdirSync(lockDir);
    // release-rmdir FAILURE revokes the token even though the .lock is left orphan: a stale
    // token after a failed release is rejected for a mutable read (residual: revoke BEFORE rmdir).
    const token3 = rc.acquireLock(txn, dir);
    fs.writeFileSync(path.join(lockDir, 'squatter'), 'x'); // make rmdir fail (ENOTEMPTY)
    assert.throws(() => rc.releaseLock(token3), /rmdir failed|DURABILITY_UNPROVEN/i, 'release with a failing rmdir fails closed');
    assert.ok(fs.existsSync(lockDir), 'the .lock is left as a durable orphan after the failed release');
    assert.throws(
      () => rc.classifyDurableRead(path.join(txn, 'active-lease.json'), { immutablePath: false, lockToken: token3 }),
      /authentic transition-lock token/,
      'the token is STALE (revoked) after the failed release even though .lock still exists');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── Section 8 (await/enumeration correctness): listResultFiles/findResultWithStatus ──

test('listResultFiles: ENOENT (missing results/ directory) is harmlessly empty; EACCES is a distinct DURABILITY_UNPROVEN STOP, never silently folded into "no results"', () => {
  const rc = require(IMPL);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-lrf-'));
  try {
    const txnDir = path.join(dir, 'txn');
    fs.mkdirSync(txnDir);
    // Genuinely missing results/ directory -- harmlessly empty.
    assert.deepStrictEqual(rc.listResultFiles(txnDir), [], 'ENOENT results/ directory is empty, not an error');

    if (process.platform === 'win32' || typeof process.getuid !== 'function' || process.getuid() === 0) {
      return; // chmod-based permission denial is not meaningfully testable as non-root/win32
    }
    const resultsDir = path.join(txnDir, 'results');
    fs.mkdirSync(resultsDir);
    fs.chmodSync(resultsDir, 0o000);
    try {
      assert.throws(
        () => rc.listResultFiles(txnDir),
        (err) => err && err.detailCode === 'DURABILITY_UNPROVEN',
        'EACCES enumeration failure STOPs, never returns [] as if genuinely empty',
      );
    } finally {
      fs.chmodSync(resultsDir, 0o700);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findResultWithStatus: an entry the directory listing reports but that has vanished by the time it is opened is DURABILITY_UNPROVEN, never a harmless "no such status" null', () => {
  const rc = require(IMPL);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-frws-vanish-'));
  try {
    const txnDir = path.join(dir, 'txn');
    const resultsDir = path.join(txnDir, 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    // Simulate a genuine listed-then-vanished race deterministically (no real second
    // process needed): wrap fs.opendirSync (Codex NO-GO round 2, blocker 4:
    // listResultFiles now streams via opendirSync/readSync, not readdirSync) so the
    // Dir handle findResultWithStatus reads from reports one extra entry that was
    // never actually written to disk -- exactly what a directory listing would show
    // if a concurrent actor removed the file between the listing and this function's
    // own subsequent read.
    const originalOpendirSync = fs.opendirSync;
    fs.opendirSync = function patchedOpendirSync(target, options) {
      const real = originalOpendirSync.call(fs, target, options);
      if (path.resolve(String(target)) !== path.resolve(resultsDir)) return real;
      let ghostServed = false;
      return {
        readSync() {
          const entry = real.readSync();
          if (entry !== null) return entry;
          if (!ghostServed) {
            ghostServed = true;
            return { name: 'ghost-attempt-id.json' };
          }
          return null;
        },
        closeSync() {
          return real.closeSync();
        },
      };
    };
    try {
      assert.throws(
        () => rc.findResultWithStatus(txnDir, 'ANSWERED'),
        (err) => err && err.detailCode === 'DURABILITY_UNPROVEN' && /vanished/.test(String(err.message)),
        'a listed-then-vanished entry is DURABILITY_UNPROVEN, never a harmless miss',
      );
    } finally {
      fs.opendirSync = originalOpendirSync;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reconcileOneNoClobberTemp (Codex NO-GO round 2, blocker 1): a genuine nlink==2 crash-cut pair with NO faults reaches status "unlink-unsafe" EXPLICITLY and the temp is NEVER unlinked -- no portable primitive can prove a path-based unlink targets the fd-accredited inode, so recovery no longer auto-deletes at all', () => {
  const rc = require(IMPL);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-reconcile-unsafe-pair-'));
  try {
    const targetPath = path.join(dir, 'target.json');
    fs.writeFileSync(targetPath, '{"x":1}', { mode: 0o600 });
    fs.chmodSync(targetPath, 0o600); // exact 0600 independent of umask, matching the real writer
    const tempName = '.target.json.999999.deadbeefcafebabe.tmp-owner';
    const tempPath = path.join(dir, tempName);
    fs.linkSync(targetPath, tempPath); // simulates the crash-cut: nlink==2, barrier1-durable, unlink never ran
    const result = rc.reconcileOneNoClobberTemp(dir, tempName, 'target.json');
    assert.strictEqual(result.status, 'unlink-unsafe', 'a genuine, fully-proven crash-cut pair must reach status "unlink-unsafe" explicitly, never "recovered"');
    assert.strictEqual(fs.existsSync(tempPath), true, 'the temp must be left completely untouched -- no unlink is ever attempted');
    assert.strictEqual(fs.lstatSync(targetPath).nlink, 2, 'the target must stay at nlink==2 -- never silently promoted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reconcileOneNoClobberTemp (Codex NO-GO round 2, blocker 1): a genuine nlink==1 stray with NO faults reaches status "unlink-unsafe" EXPLICITLY and is NEVER unlinked -- the empirically-reproduced attack (rename the accredited original away, plant a substitute at the same path, the substitute gets deleted instead) is eliminated by never deleting anything, not by trying to out-race it', () => {
  const rc = require(IMPL);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-reconcile-unsafe-stray-'));
  try {
    const tempName = '.target.json.999999.deadbeefcafebabe.tmp-owner';
    const tempPath = path.join(dir, tempName);
    fs.writeFileSync(tempPath, '{"x":1}', { mode: 0o600 });
    fs.chmodSync(tempPath, 0o600); // exact 0600 independent of umask -- a genuine standalone stray, nlink==1
    const result = rc.reconcileOneNoClobberTemp(dir, tempName, 'target.json');
    assert.strictEqual(result.status, 'unlink-unsafe', 'a genuine nlink==1 stray must reach status "unlink-unsafe" explicitly, never "stray-removed"');
    assert.strictEqual(fs.existsSync(tempPath), true, 'the stray must be left completely untouched -- no unlink is ever attempted, matching Codex\'s own repro that a path-based unlink here cannot be proven to target the accredited inode');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reconcileOneNoClobberTemp (Codex NO-GO round 2, blocker 2): an EACCES opening a temp matching our exact production grammar is a FAILURE (propagates), never folded into the benign "not ours" skip -- only ENOENT/ELOOP are skip', () => {
  if (process.platform === 'win32' || typeof process.getuid !== 'function' || process.getuid() === 0) {
    return; // chmod-based permission denial is not meaningfully testable as non-root/win32
  }
  const rc = require(IMPL);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-reconcile-eacces-'));
  try {
    const tempName = '.target.json.999999.deadbeefcafebabe.tmp-owner';
    const tempPath = path.join(dir, tempName);
    fs.writeFileSync(tempPath, '{"x":1}', { mode: 0o600 });
    fs.chmodSync(tempPath, 0o000); // owner-unreadable -- open(O_RDONLY) fails EACCES, not ENOENT
    try {
      const result = rc.reconcileOneNoClobberTemp(dir, tempName, 'target.json');
      assert.strictEqual(result.status, 'failed', 'an EACCES on a temp matching our own grammar must propagate as a failure, not a benign skip');
    } finally {
      fs.chmodSync(tempPath, 0o600); // restore before the outer rmSync cleanup
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// R33 stage 1 -- digest GOLDEN VECTORS (A.5, ARCHITECTURE-PROPOSAL-C-S-L-R3.3.md
// :3716-3729):
//
//   rootProfileDigestV3(p)      = SHA256(UTF8("coordination/root-profile/v3")     || 0x00 || UTF8(canonical(p)))
//   providerSessionDigestV3(s)  = SHA256(UTF8("coordination/provider-session/v3") || 0x00 || UTF8(canonical(s)))
//   temporalEnvelopeDigestV1(e) = SHA256(UTF8("runtime/temporal-authority-envelope/v1") || 0x00 || UTF8(canonical(e)))
//
// over the FULL canonical record with no field exclusion.
//
// WHY THESE LIVE HERE AND NOT IN runtime-consultation-roots.bats: the correlation
// slice's fixtures must construct a valid `root_profile_digest`, and they will do
// it by CALLING these exported production functions rather than reimplementing the
// formula (a reimplementation either drifts from production or fails for the wrong
// reason). That makes a golden vector mandatory: without one, a fixture built with
// the production function and checked against the production function would agree
// with itself no matter what the function did. These three tests are what stops
// that from being circular -- a change to the production formula, the domain
// separator, the 0x00 byte, or canonicalisation ordering breaks them.
//
// HOW THE EXPECTED LITERALS WERE OBTAINED -- this is the load-bearing detail: each
// hex string below was computed ONCE from an INDEPENDENT implementation written
// directly from the formula text above, NOT by calling the production module and
// pasting its answer. Both then agreed. Pasting production's own output would have
// produced a tautology that can never fail.
//
// The input records are deliberately SELF-CONTAINED literals here rather than
// shared with the bats fixture builder, so a single bug cannot silently corrupt
// both the fixture and its own golden vector.
//
// `platform`/`architecture` are pinned to fixed literals ("linux"/"x64") rather
// than taken from `process.platform`/`process.arch`. That is required, not
// stylistic: a host-derived value would make the digest differ between this macOS
// arm64 machine and a linux/x64 CI runner, so the vector would be unreproducible
// across hosts and would fail in CI for a reason having nothing to do with the
// formula.
// ═══════════════════════════════════════════════════════════════════════════

const R33_GV_H64 = (pair) => pair.repeat(32);   // Sha256  -- 64 lowercase hex
const R33_GV_H32 = (quad) => quad.repeat(8);    // Id128   -- 32 lowercase hex
const R33_GV_CLOCK_DOMAIN_ID = R33_GV_H32('0a1b');

// TemporalAuthorityEnvelopeV1 [4] (R3.3:1446-1451). The *_monotonic_ns values are
// canonical unsigned decimal STRINGS: MonoNs is DecimalU64 (R3.3:1441), not a JSON
// number -- the signed range on R3.3:1443-1444 belongs to `UnixNs`, an adjacent
// and different type.
const R33_GV_TEMPORAL = Object.freeze({
  clock_domain_id: R33_GV_CLOCK_DOMAIN_ID,
  issued_monotonic_ns: '1000000000000',
  not_before_monotonic_ns: '1000000000000',
  expiry_monotonic_ns: '4600000000000',
});

// RootProfileV3 [28] -- A.3 REPLACE (R3.3:3635-3641) via the row at R3.3:3651
// over RootProfileV2 [24] (R3.2:2087-2098).
const R33_GV_ROOT_PROFILE = Object.freeze({
  schema: 'coordination/root-profile/v3',
  protocol_profile: 'runtime-consultation/r33-csl-posix-local-v1',
  control_protocol: 'transition-lock/provider-control/v3',
  provider_abi: 3,
  handle_protocol: 'transition-lock/provider-handle/v2',
  runtime_owner_root_id: R33_GV_H64('a1'),
  clock_domain_id: R33_GV_CLOCK_DOMAIN_ID,
  clock_domain_receipt_digest: R33_GV_H64('b2'),
  created_at_diagnostic_utc: '2025-01-01T00:00:00Z',
  lock_profile: 'transition-lock/file-posix/v2',
  coordination_root_id: R33_GV_H64('c3'),
  physical_root_id: R33_GV_H64('d4'),
  coordination_root_identity_security_digest: R33_GV_H64('e5'),
  canonical_root_path_digest: R33_GV_H64('f6'),
  mount_projection_digest: R33_GV_H64('07'),
  root_generation_id: R33_GV_H32('1c2d'),
  root_bootstrap_id: R33_GV_H32('2e3f'),
  provider_session_id: R33_GV_H32('3041'),
  local_filesystem_profile: 'local-posix/v2',
  local_filesystem_capability_digest: R33_GV_H64('18'),
  mount_generation_digest: R33_GV_H64('29'),
  provider_name: 'acd-transition-lock-posix',
  provider_build_digest: R33_GV_H64('3a'),
  platform: 'linux',
  architecture: 'x64',
  provider_manager_kind: 'retained-native-host-owner',
  provider_manager_lifetime_profile: 'retained-session',
  coordination_mode: 'auto',
});

const R33_GV_ROOT_PROFILE_DIGEST = 'dfa5ad6081f4ea2d67c4173d4851f63cb10d044826b128ed9069feb67e440ca1';

// ProviderSessionV3 [28] -- row R3.3:3652 over ProviderSessionV2 [24]
// (R3.2:2100-2110). NO `protocol_profile` key: V2 has none and the V3 ADD list
// introduces none, so it binds to the profile transitively via
// `root_profile_digest` + `runtime_binding_receipt_digest`. `root_profile_digest`
// is the vector above, which also exercises R3.3:3734-3735's identity.
const R33_GV_SESSION = Object.freeze({
  schema: 'coordination/provider-session/v3',
  provider_abi: 3,
  control_protocol: 'transition-lock/provider-control/v3',
  runtime_owner_root_id: R33_GV_H64('a1'),
  runtime_binding_receipt_digest: R33_GV_H64('4b'),
  clock_domain_id: R33_GV_CLOCK_DOMAIN_ID,
  clock_domain_receipt_digest: R33_GV_H64('b2'),
  temporal: R33_GV_TEMPORAL,
  started_at_diagnostic_utc: '2025-01-01T00:00:00Z',
  coordination_root_id: R33_GV_H64('c3'),
  physical_root_id: R33_GV_H64('d4'),
  coordination_root_identity_security_digest: R33_GV_H64('e5'),
  canonical_root_path_digest: R33_GV_H64('f6'),
  mount_projection_digest: R33_GV_H64('07'),
  root_generation_id: R33_GV_H32('1c2d'),
  root_bootstrap_id: R33_GV_H32('2e3f'),
  root_profile_digest: R33_GV_ROOT_PROFILE_DIGEST,
  local_filesystem_capability_digest: R33_GV_H64('18'),
  mount_generation_digest: R33_GV_H64('29'),
  provider_name: 'acd-transition-lock-posix',
  provider_build_digest: R33_GV_H64('3a'),
  provider_session_id: R33_GV_H32('3041'),
  control_endpoint_id: R33_GV_H32('4152'),
  provider_manager_instance_id: R33_GV_H32('5263'),
  provider_manager_kind: 'retained-native-host-owner',
  provider_manager_lifetime_profile: 'retained-session',
  coordination_mode: 'auto',
  owner_pid: 4242,
});

test('R33-GV-1 rootProfileDigestV3 golden vector: a fixed 28-key RootProfileV3 hashes to exactly the expected digest (formula, domain separator and canonical ordering all pinned)', () => {
  const rc = require(IMPL);
  assert.strictEqual(
    Object.keys(R33_GV_ROOT_PROFILE).length, 28,
    'golden-vector input must be the full closed 28-key RootProfileV3 -- a drifted input would silently redefine what the vector pins',
  );
  assert.strictEqual(
    rc.rootProfileDigestV3(R33_GV_ROOT_PROFILE),
    R33_GV_ROOT_PROFILE_DIGEST,
    'rootProfileDigestV3 diverged from the independently-computed golden vector for SHA256(UTF8("coordination/root-profile/v3") || 0x00 || UTF8(canonical(profile)))',
  );
});

test('R33-GV-2 providerSessionDigestV3 golden vector: a fixed 28-key ProviderSessionV3 with a nested temporal [4] hashes to exactly the expected digest (also pins NESTED canonical key ordering)', () => {
  const rc = require(IMPL);
  assert.strictEqual(
    Object.keys(R33_GV_SESSION).length, 28,
    'golden-vector input must be the full closed 28-key ProviderSessionV3',
  );
  assert.ok(
    !('protocol_profile' in R33_GV_SESSION),
    'ProviderSessionV3 has NO protocol_profile key by construction (R3.3:3652 adds none, R3.2:2100-2110 has none) -- adding one here would silently change the digest and mis-pin the vector',
  );
  assert.strictEqual(
    rc.providerSessionDigestV3(R33_GV_SESSION),
    '180ebf96e9eee42c427521ec6f14a300bde3d9d880c7095553673101d867b760',
    'providerSessionDigestV3 diverged from the independently-computed golden vector; because this record nests `temporal`, a regression in DEEP canonical key sorting (sorting only top-level keys) breaks this test and not R33-GV-1',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// R33 stage 1 -- "PRESENT_INVALID, never ABSENT" (PLAN.md:2911).
//
// WHY THIS IS A LIBRARY TEST AND NOT A CLI TEST. The property is real but it is
// NOT ABI-observable. `PRESENT_INVALID` is not among the 16 frozen `detail_code`
// values (PLAN.md:791) so it can never be emitted, and measured through the real
// CLI an R32 record occupying the R33 path and a genuinely missing file return
// rc, stdout AND stderr byte-identical -- the frozen envelope (PLAN.md ~L789) has
// no message field, and `main()` writes to stderr only for non-CliError throws,
// so the CliError text never reaches any stream. There is nothing at the CLI
// boundary to assert on.
//
// `classifyDurableRead` is the exact function where the distinction lives, and it
// is already exported along with DURABLE_PRESENT / DURABLE_ABSENT. Testing the
// mechanism rather than a diagnostic string also means this cannot rot when a
// message is reworded, and needs no production change.
// ═══════════════════════════════════════════════════════════════════════════

// Genuine RootProfileV2 [24] (R3.2:2087-2098) -- schema /v2, protocol_profile
// P32, provider_abi 2, control_protocol /v2, and `created_at` where V3 carries
// `created_at_diagnostic_utc`. A genuine V2 record, not a P32-mutated V3 one:
// the mutated form still carries five keys V2 never had.
const R33_R32_ROOT_PROFILE = Object.freeze({
  schema: 'coordination/root-profile/v2',
  protocol_profile: 'runtime-consultation/r32-csl-posix-local-v1',
  lock_profile: 'transition-lock/file-posix/v2',
  control_protocol: 'transition-lock/provider-control/v2',
  coordination_root_id: R33_GV_H64('c3'),
  physical_root_id: R33_GV_H64('d4'),
  coordination_root_identity_security_digest: R33_GV_H64('e5'),
  canonical_root_path_digest: R33_GV_H64('f6'),
  mount_projection_digest: R33_GV_H64('07'),
  root_generation_id: R33_GV_H32('1c2d'),
  root_bootstrap_id: R33_GV_H32('2e3f'),
  provider_session_id: R33_GV_H32('3041'),
  local_filesystem_profile: 'local-posix/v2',
  local_filesystem_capability_digest: R33_GV_H64('18'),
  mount_generation_digest: R33_GV_H64('29'),
  provider_name: 'acd-transition-lock-posix',
  provider_abi: 2,
  provider_build_digest: R33_GV_H64('3a'),
  platform: 'linux',
  architecture: 'x64',
  provider_manager_kind: 'retained-native-host-owner',
  provider_manager_lifetime_profile: 'retained-session',
  coordination_mode: 'auto',
  created_at: '2026-07-25T00:00:00Z',
});

test('R33-PRESENT-1 classifyDurableRead: a genuine RootProfileV2 occupying the R33 path classifies as DURABLE_PRESENT, and the SAME path once deleted classifies as DURABLE_ABSENT', () => {
  const rc = require(IMPL);
  assert.strictEqual(
    Object.keys(R33_R32_ROOT_PROFILE).length, 24,
    'the fixture must be a genuine RootProfileV2 [24]; a P32-mutated V3 record would be a weaker fixture carrying five keys V2 never had',
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-r33-present-absent-'));
  try {
    const p = path.join(dir, 'root-profile.json');
    const sortDeep = (v) => Array.isArray(v)
      ? v.map(sortDeep)
      : (v !== null && typeof v === 'object'
        ? Object.keys(v).sort().reduce((a, k) => (a[k] = sortDeep(v[k]), a), {})
        : v);
    fs.writeFileSync(p, Buffer.from(JSON.stringify(sortDeep(R33_R32_ROOT_PROFILE)) + '\n', 'utf8'), { mode: 0o600 });
    fs.chmodSync(p, 0o600);

    const present = rc.classifyDurableRead(p, { maxSize: 4096 });
    assert.strictEqual(
      present.state, rc.DURABLE_PRESENT,
      'a path OCCUPIED by the other profile bytes must classify PRESENT -- taking the ABSENT branch here is what PLAN.md:2911 forbids',
    );
    assert.notStrictEqual(
      present.state, rc.DURABLE_ABSENT,
      'asserted in both directions deliberately: DURABLE_PRESENT being correct and DURABLE_ABSENT being wrong are the two halves of the property',
    );

    fs.unlinkSync(p);
    const absent = rc.classifyDurableRead(p, { maxSize: 4096 });
    assert.strictEqual(
      absent.state, rc.DURABLE_ABSENT,
      'a genuinely missing path must classify ABSENT -- otherwise R33-PRESENT-1 would pass vacuously by never returning ABSENT at all',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// R33-PRESENT-2 WAS HERE, AND WAS REMOVED RATHER THAN REWRITTEN.
//
// It was a CLI-level test asserting that an R32 record occupying the R33 path
// and a genuinely missing file produced byte-identical rc/stdout/stderr -- the
// negative result establishing that `PRESENT_INVALID, never ABSENT`
// (PLAN.md:2911) is not observable through the frozen envelope, and therefore
// that the proof has to live at the library boundary.
//
// Its subject ceased to exist when the four R33 kinds were removed from
// VALIDATE_KIND_DISPATCH. `--kind root-profile-v3` is now an unknown kind, so
// both cases return rc 2 USAGE_ERROR/INVALID_ARGUMENT and are byte-identical
// for a reason that has nothing to do with present-versus-absent. Rewritten to
// assert that, it would have restated `RCR-r33-abi-2` (kind is unknown) plus a
// trivial observation that the unknown-kind envelope does not vary with the
// artifact path -- passing, but no longer demonstrating what its name promised.
// A test that passes for a reason unrelated to its premise is the exact failure
// mode this suite has been correcting all session, so it is gone.
//
// It was NOT re-pointed at `checkRootProfileV3Conformance` either: present and
// absent both raise SCHEMA_INVALID there too, so that version would carry no
// discriminator and would merely restate R33-PRESENT-1.
//
// NOTHING IS LOST. R33-PRESENT-1 above is the real evidence and is unaffected:
// it proves the distinction directly against `classifyDurableRead`, in both
// directions, using the exported DURABLE_PRESENT / DURABLE_ABSENT constants.
// `PRESENT_INVALID` remains unemittable regardless -- it is not among the 16
// frozen detail_code values (PLAN.md:791) -- so no CLI code path could ever
// have carried this distinction.

test('R33-GV-3 temporalEnvelopeDigestV1 golden vector: a fixed TemporalAuthorityEnvelopeV1 [4] hashes to exactly the expected digest, with MonoNs carried as canonical decimal STRINGS', () => {
  const rc = require(IMPL);
  assert.strictEqual(Object.keys(R33_GV_TEMPORAL).length, 4, 'TemporalAuthorityEnvelopeV1 is exactly 4 keys (R3.3:1446-1451)');
  for (const k of ['issued_monotonic_ns', 'not_before_monotonic_ns', 'expiry_monotonic_ns']) {
    assert.strictEqual(
      typeof R33_GV_TEMPORAL[k], 'string',
      k + ' must be a canonical decimal STRING: MonoNs is DecimalU64 (R3.3:1441). If this ever becomes a JSON number the digest changes, so this assertion guards the vector itself',
    );
  }
  assert.strictEqual(
    rc.temporalEnvelopeDigestV1(R33_GV_TEMPORAL),
    '75016cd86257e5fad6df3566292de3f5c107026b7e4be1f020820f1f93ff7679',
    'temporalEnvelopeDigestV1 diverged from the independently-computed golden vector for domain "runtime/temporal-authority-envelope/v1"',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// R33 stage-1 NO-MUTATION AUDIT (extraction-scoped static analysis).
//
// `validate` is a no-mutation command (PLAN.md ~L785), PLAN.md ~L2913 forbids
// overwrite/conversion/adoption/unlink/fallback/retry, and ~L2927-2928 makes a
// fresh R33 root the only rollout path. Those are ABSENCE properties: a runtime
// test can only cover the code paths someone thought to exercise, so an inode
// snapshot can never establish "no code path anywhere mutates". A static scan of
// the region can.
//
// WHY THE SCOPE IS EXTRACTED FIRST, rather than scanning the whole file: every
// primitive in MUTATORS below is entirely legitimate elsewhere in this
// 7,200-line module -- publishNoClobber, acquireLock and friends are how the rest
// of the coordination core does its work -- so a whole-file scan would
// false-positive on all of them. Conversely, asserting a hand-listed set of
// substrings is absent from the whole file would be silently defeated by any
// future edit outside the markers.
//
// WHY THE EXACTLY-ONCE AND LINE-FLOOR PRECONDITIONS EXIST -- do not "simplify"
// them away. The first draft of these markers contained the END token twice,
// because the BEGIN comment spelled the closing token while describing it. That
// collapsed the extracted region to 2 lines, found zero mutating primitives, and
// PASSED VACUOUSLY. A presence check plus a mutator scan is NOT sufficient:
// without exactly-once and a line floor this guard reads as coverage while
// providing none. Both preconditions therefore live inside the shared helper, so
// they are re-asserted by the mutator test as well as by the marker test and the
// scan can never run against a collapsed or inverted scope.
//
// KNOWN FRAGILITY, recorded deliberately: because the audit scans the extracted
// TEXT, the marker comment block inside the scope must never spell any mutator
// token verbatim -- writing `unlinkSync` in prose there would trip this. Prose
// naming the concept ("unlink", "overwrite") is fine.
//
// The two token constants below are spelled VERBATIM on purpose. An earlier draft
// assembled them by string concatenation, on the theory that this file should not
// contribute occurrences if the audit were ever widened to scan more than one
// file. That was a bad trade: the counts here are taken against
// runtime-consultation.cjs alone, so the hypothetical never applied, while the
// concatenation had a real cost -- it made this file invisible to anyone grepping
// the repo for the marker to find its consumers, including a reviewer verifying
// the guard exists. Discoverability of a guard beats a speculative hedge.
//
// SCOPE LIMIT: this proves absence of these primitives *within* the R33 region.
// It does not prove the region is free of mutation reached indirectly via a
// helper defined outside it. It is deliberately paired with the runtime
// inode-snapshot test (RCR-r33-nomutate-1 in runtime-consultation-roots.bats),
// which covers the converse -- real observed behaviour on paths actually
// exercised. Neither test subsumes the other.
//
// This audit lived briefly in script-static-analysis.bats; it was moved here
// because that file is outside this wave's dispatch scope and the Path Manifest.
// ═══════════════════════════════════════════════════════════════════════════

const R33_AUDIT_BEGIN = 'R33-STAGE1-AUDIT-SCOPE:BEGIN';
const R33_AUDIT_END = 'R33-STAGE1-AUDIT-SCOPE:END';

const R33_AUDIT_MUTATORS = Object.freeze([
  'writeFileSync', 'renameSync', 'unlinkSync', 'linkSync', 'mkdirSync',
  'rmSync', 'rmdirSync', 'appendFileSync', 'truncateSync', 'chmodSync',
  'openSync', 'closeSync', 'publishNoClobber', 'publishReplace',
  'acquireLock', 'releaseLock', 'withLock', 'writeAllSync', 'fsyncDir',
]);

// Returns { scope, lines } after enforcing BOTH preconditions. Every caller goes
// through here, which is what makes the preconditions unskippable.
function r33AuditScope() {
  const src = fs.readFileSync(IMPL, 'utf8');
  const countOf = (needle) => src.split(needle).length - 1;

  const nBegin = countOf(R33_AUDIT_BEGIN);
  const nEnd = countOf(R33_AUDIT_END);
  assert.strictEqual(nBegin, 1, 'BEGIN marker must occur EXACTLY once, found ' + nBegin + ' -- duplication is what collapsed the scope to 2 lines and made the audit pass vacuously');
  assert.strictEqual(nEnd, 1, 'END marker must occur EXACTLY once, found ' + nEnd + ' -- same failure mode');

  const i = src.indexOf(R33_AUDIT_BEGIN);
  const j = src.indexOf(R33_AUDIT_END);
  assert.ok(j > i, 'END marker must follow BEGIN marker; otherwise the extracted scope is empty or inverted');

  const scope = src.slice(i, j);
  const lines = scope.split('\n').length;
  assert.ok(lines > 500, 'extracted scope is only ' + lines + ' lines, expected > 500 -- a collapsed scope would find zero mutators and report success while covering nothing');
  return { scope, lines };
}

// ═══════════════════════════════════════════════════════════════════════════
// R33 correlation COVERAGE-COMPLETENESS guard.
//
// The `physical_root_id` hole was found by disabling one comparison in a scratch
// copy and watching the whole suite stay green. The 17x1 mutation matrix that
// found it lives in a scratchpad harness and dies with the session -- which is
// exactly the "session evidence, not a regression guard" problem. This is the
// committed successor: it cannot detect a broken comparison the way the matrix
// can, but it detects the thing that let the hole exist, which is a production
// key with no per-key regression behind it.
//
// It is DRIFT-PROOF BY CONSTRUCTION because it reads BOTH sides rather than
// hardcoding either: the production set comes from the exported
// `R33_TUPLE_CORRELATION_KEYS` (derived at module load from the field tables, and
// frozen), and the covered set is extracted from the committed
// `RCR-r33-tuple-corr-*` tests in runtime-consultation-roots.bats. If production
// gains an 18th correlation key, this fails until a regression exists for it; if a
// test names a key production does not correlate, it fails too.
//
// Note what it deliberately does NOT claim: passing means every key HAS a test,
// not that every test WORKS. Those are different properties -- the second needs
// the mutation matrix. Both are recorded in the report.
// ═══════════════════════════════════════════════════════════════════════════

test('R33-CORR-COVERAGE: every key in the exported R33_TUPLE_CORRELATION_KEYS has its own committed per-key regression, and no regression names a key production does not correlate', () => {
  const rc = require(IMPL);
  const production = rc.R33_TUPLE_CORRELATION_KEYS;
  assert.ok(Array.isArray(production), 'R33_TUPLE_CORRELATION_KEYS must be exported as an array');
  assert.strictEqual(
    production.length, 17,
    'the derived correlation set is 17 keys (21 shared minus the 4 that are a fixed literal in both records). A change here is not necessarily wrong, but it must be deliberate and it must come with regressions',
  );

  const batsPath = path.resolve(__dirname, 'runtime-consultation-roots.bats');
  const bats = fs.readFileSync(batsPath, 'utf8');
  const batsLines = bats.split('\n');

  // Walk the committed corr-* tests and collect which production keys each one
  // mutates. Reading the fixture line rather than the test NAME on purpose: a name
  // can say anything, whereas the override is what the test actually does.
  const covered = new Map();
  let currentId = null;
  for (const line of batsLines) {
    const m = line.match(/^@test "(RCR-r33-tuple-corr-\d+)/);
    if (m) { currentId = m[1]; continue; }
    if (line.startsWith('@test ')) { currentId = null; continue; }
    if (currentId === null || line.indexOf('_write_r33_tuple') < 0) continue;
    for (const key of production) {
      if (line.indexOf('"' + key + '"') >= 0 && !covered.has(key)) covered.set(key, currentId);
    }
  }

  const uncovered = production.filter((k) => !covered.has(k));
  assert.deepStrictEqual(
    uncovered, [],
    'correlation keys with NO committed per-key regression: ' + uncovered.join(', ')
      + ' -- this is precisely how the physical_root_id hole survived a fully green suite',
  );

  // Reverse direction: a test naming a key production no longer correlates would
  // be dead coverage that still reads as protection.
  const productionSet = new Set(production);
  const stray = [...covered.keys()].filter((k) => !productionSet.has(k));
  assert.deepStrictEqual(stray, [], 'per-key regressions naming keys absent from the production set: ' + stray.join(', '));

  assert.strictEqual(
    covered.size, 17,
    'expected all 17 keys covered, mapped ' + covered.size + ': ' + [...covered.keys()].sort().join(', '),
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// R33 EXPORT-GATE regression.
//
// The R33 conformance exports sit behind `isTestCapability()` -- `NODE_ENV=test`
// AND a non-empty `RUNTIME_CONSULTATION_TEST_CAPABILITY`. This pins all six
// environment combinations, plus the legacy surface, so a change that widened the
// gate (or that gated the legacy exports by accident) fails here.
//
// WHY THIS SPAWNS A CHILD WITH A CLEANED ENV, and why an in-process check would be
// worthless: this very file sets both vars at module load so its own tests can
// reach the gated exports. An in-process probe therefore inherits a satisfied
// gate and reads "reachable" in EVERY row, including the five that must be
// unreachable -- a table of six identical passes that proves nothing. So each row
// runs in a child with both vars DELETED from the inherited environment and only
// the row's own values put back.
//
// The legacy column is the other half: the gate must not swallow the ungated
// surface. If a future change gated everything, the six rows would still look
// right while the module became unusable in production.
// ═══════════════════════════════════════════════════════════════════════════

// EXACT key sets, not samples -- and the difference matters.
//
// An earlier version of this test named three ungated exports and asserted
// "legacy 3/3" per row. That sampled 3 of the 21 base exports: a gate that
// swallowed the other 18 would have passed all six rows while making the module
// unusable in production. Comparing the COMPLETE key set is strictly stronger --
// it also catches an export ADDED to production without anyone deciding which
// side of the gate it belongs on, which a curated subset can never do.
// M7 completeness Part C follow-up (2026-08-09): findLiveClaudeAgentActivations
// and resolveActivationForRequestPath joined the base set here -- both are
// called unconditionally from production hook code (agent-spawn-execution-
// gate.js, subagent-start-context-bundle.js, runtime-consultation-target-
// gate.js), never behind isTestCapability(), so they belong in the UNGATED
// 21->23 base set, not R33_EXPORTS_GATE_OPEN.
// M6+M7 requester-authority closure (Group B, 2026-08-10): resolveRequesterGrantScope
// joined the base set here too -- context-provider-gate.js's tryInjectRequesterGrant
// calls it unconditionally (never behind isTestCapability()) to resolve the
// request_id/attempt_id/lease_epoch triple a requester grant must be scoped
// to, so it belongs in the UNGATED 23->24 base set, not R33_EXPORTS_GATE_OPEN.
// M6 C+D closure (2026-08-12): the ten HostBridge exports are the deliberately
// ungated, in-process-only API consumed by runtime-bridge-codex.cjs.  Their
// authority is still opaque because createHostBridgeCapability returns a
// WeakMap-backed object that cannot be reconstructed from JSON/argv/disk;
// gating the exports themselves would make the production bridge unusable.
// Fourteenth/Sixteenth corrections (2026-08-13, PLAN.md §16a/§16c C2 root-consult
// + Context7-mediation surfaces): 28 further names joined the UNGATED base set here,
// all called unconditionally from production (runtime-role-lifecycle.cjs's
// s16MaterializeCommonArtifacts/handleConsultRootStatus/handleRootSource,
// context-provider-gate.js's CP-evidence path), never behind isTestCapability() --
// ROUTING_POLICY_DIGEST/ROUTING_POLICY_VERSION, buildCanonicalRequest,
// codexStructuredRuntimeTurnEnvelopeSchema, dispatchCanonical, hostBridgeAdvanceRootConsult,
// hostBridgeListRootConsultIntents, hostBridgeObserveAndCompleteRootConsult,
// hostBridgePublishPatternEvidence, materializePlanRef, materializeRoutingPolicy,
// materializeSubjectBundle, patternEvidencePathFor, publishPreallocatedRequest,
// readRootConsultTerminalStatus, targetRoleProfileDigestFor,
// unwrapAndValidateCodexStructuredRuntimeTurnEnvelope, validateContext7LibraryId.
// NO-GO Correction C (2026-08-14, PLAN.md §16b line 63 / operation schema
// line 226): 3 further names joined the UNGATED base set here --
// readRootSourceTerminalArtifacts (called unconditionally from
// runtime-role-lifecycle.cjs's handleRootSourceStatus, the FD-bound
// terminal-status helper replacing the prior raw sha256File(path.join(...))
// read) plus ackPathFor/cancelPathFor (called unconditionally from
// validateRootSourceRetirementRecord's own terminal_ref canonical-shape
// check, and from readRootSourceTerminalArtifacts itself) -- none behind
// isTestCapability().
// Commondir seal gap fix (Codex review, 2026-08-15): sealCorrelatesWithGitCommonDir
// joined the UNGATED base set here -- resolveSealedGitCache calls it
// unconditionally on both derive and reuse, never behind isTestCapability().
// acceptedResultPathFor added for M7 RED 17 -- mirrors the existing
// ackPathFor/cancelPathFor cross-file-reuse exports for the exact same
// purpose (runtime-role-lifecycle.cjs's own root-source status handler).
// resultPathFor added for M7 defect 6 -- mirrors the existing
// acceptedResultPathFor/ackPathFor/cancelPathFor cross-file-reuse exports for
// the exact same purpose (contract §8.5: one-shot's authoritative terminal is
// results/<attempt>.json, never accepted-result.json; both
// runtime-role-lifecycle.cjs's mintRoleCommandGrant and this module's own
// consume-time terminal recheck call it), called unconditionally from
// production, never behind isTestCapability().
// M6/M7 terminal functional closure (2026-08-21): 3 further names joined the
// UNGATED base set here -- resolveRootEvidenceAuthority (called
// unconditionally from validateResultV2/hostBridgePublishTerminalResult/
// hostBridgeListInbox, superseding the old root-consult-only
// rootConsultEvidencePolicyForRequest) and validateConsultationDependencySet
// (called unconditionally from the same two publish/reopen sites), neither
// behind isTestCapability(). parseApprovedContext7Directive is exported for
// the same reason writeAllSync above is: a pure, fail-closed internal
// primitive (resolveRootEvidenceAuthority's own root-source directive
// parser) exported specifically so its own edge cases can be exercised
// directly, not because anything outside this file calls it.
const R33_EXPORTS_GATE_CLOSED = Object.freeze([
  'DURABLE_ABSENT', 'DURABLE_PENDING', 'DURABLE_PRESENT', 'ROUTING_POLICY_DIGEST',
  'ROUTING_POLICY_VERSION', 'acceptedResultPathFor', 'ackPathFor', 'acquireLock', 'buildCanonicalRequest', 'cancelPathFor',
  'canonicalJSONStringify', 'classifyDurableRead', 'codexStructuredRuntimeTurnEnvelopeSchema',
  'createHostBridgeCapability', 'dispatchCanonical', 'findLiveClaudeAgentActivations',
  'findResultWithStatus', 'gitRevParse', 'gitTopologySealsMatch', 'hostBridgeAdvanceRootConsult',
  'hostBridgeAllowedChildRoles',
  'hostBridgeClaim', 'hostBridgeLeaseHeartbeat', 'hostBridgeListInbox', 'hostBridgeListRootConsultIntents',
  'hostBridgeObserveAndCompleteRootConsult', 'hostBridgeObserveChildResult',
  'hostBridgePublishChildRequest', 'hostBridgePublishPatternEvidence',
  'hostBridgePublishTerminalResult', 'hostBridgeRecordTurnStartAccepted', 'hostBridgeScheduleTurn',
  'isSafeRelativeEntryPath', 'isValidLockTokenFor', 'listResultFiles', 'materializePlanRef', 'materializeRoutingPolicy',
  'materializeSubjectBundle', 'parseApprovedContext7Directive', 'patternEvidencePathFor', 'publishNoClobber',
  'publishPreallocatedRequest', 'readRootConsultTerminalStatus', 'readRootSourceTerminalArtifacts',
  'realpathOrSelf', 'reconcileOneNoClobberTemp', 'releaseLock', 'resolveActivationForRequestPath',
  'resolveRequesterGrantScope', 'resolveRootEvidenceAuthority', 'resolveSealedGitCache', 'resultPathFor',
  'runtimeTurnEnvelopeSchema',
  'sealCorrelatesWithGitCommonDir', 'sealGitIdentityFor',
  'sha256Buffer', 'sha256File',
  'sha256String', 'targetRoleProfileDigestFor', 'unwrapAndValidateCodexStructuredRuntimeTurnEnvelope',
  'validateConsultationDependencySet', 'validateContext7LibraryId', 'validateRootConfinement',
  'validateRuntimeTurnEnvelope', 'writeAllSync',
].sort());

const R33_EXPORTS_GATE_OPEN = Object.freeze([
  ...R33_EXPORTS_GATE_CLOSED,
  'R33_TUPLE_CORRELATION_KEYS',
  'activationLivenessDeadline',
  'checkProviderSessionV3Conformance',
  'checkR33ProfileTupleConformance',
  'checkRootProfileV3Conformance',
  'checkRuntimeProfileBindingV2Conformance',
  'providerSessionDigestV3',
  'resolveSafeM7RendezvousDir',
  'rootProfileDigestV3',
  'temporalEnvelopeDigestV1',
  'testM7Rendezvous',
].sort());

function probeExportsUnderEnv(envRow) {
  // Start from a COPY of the parent env with both gate vars removed, then apply
  // only what this row specifies. Deleting first is what makes the row honest.
  const childEnv = Object.assign({}, process.env);
  delete childEnv.NODE_ENV;
  delete childEnv.RUNTIME_CONSULTATION_TEST_CAPABILITY;
  for (const k of Object.keys(envRow)) {
    if (envRow[k] === undefined) delete childEnv[k];
    else childEnv[k] = envRow[k];
  }
  const script = 'const m = require(' + JSON.stringify(IMPL) + ');'
    + 'process.stdout.write(JSON.stringify(Object.keys(m).sort()));';
  const r = spawnSync(process.execPath, ['-e', script], { env: childEnv, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'probe child exited ' + r.status + ': ' + (r.stderr || '').slice(0, 300));
  return JSON.parse(r.stdout);
}

test('R33-GATE: the module exports EXACTLY the 65-key base set unless NODE_ENV=test AND a non-empty capability are both present, in which case it exports EXACTLY 76', () => {
  const rows = [
    ['no env at all', {}, R33_EXPORTS_GATE_CLOSED],
    ['NODE_ENV=test alone', { NODE_ENV: 'test' }, R33_EXPORTS_GATE_CLOSED],
    ['capability alone', { RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY }, R33_EXPORTS_GATE_CLOSED],
    ['capability EMPTY + NODE_ENV=test', { NODE_ENV: 'test', RUNTIME_CONSULTATION_TEST_CAPABILITY: '' }, R33_EXPORTS_GATE_CLOSED],
    ['NODE_ENV=production + capability', { NODE_ENV: 'production', RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY }, R33_EXPORTS_GATE_CLOSED],
    ['NODE_ENV=test + capability', { NODE_ENV: 'test', RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY }, R33_EXPORTS_GATE_OPEN],
  ];

  const observed = [];
  for (const [label, envRow, expected] of rows) {
    const got = probeExportsUnderEnv(envRow);
    observed.push(label + ' -> ' + got.length + ' exports');
    const missing = expected.filter((k) => !got.includes(k));
    const extra = got.filter((k) => !expected.includes(k));
    assert.deepStrictEqual(
      got, expected.slice(),
      'row "' + label + '": export set mismatch.\n  missing: ' + (missing.join(', ') || '(none)')
        + '\n  unexpected: ' + (extra.join(', ') || '(none)')
        + '\n  A MISSING key means the gate swallowed part of the surface -- the module would be unusable in production.'
        + '\n  An UNEXPECTED key means production gained an export without anyone deciding which side of the gate it belongs on.'
        + '\n  Matrix so far:\n    ' + observed.join('\n    '),
    );
  }

  // Anti-vacuity. Every assertion above is an exact-set comparison, so removing
  // the gate entirely would already fail the five closed rows -- but state the
  // discriminating property explicitly so the intent survives a refactor.
  const open = probeExportsUnderEnv({ NODE_ENV: 'test', RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY });
  const closed = probeExportsUnderEnv({});
  assert.strictEqual(closed.length, 65, 'base surface is 65 exports');
  assert.strictEqual(open.length, 76, 'gated-open surface is 76 exports');
  assert.strictEqual(
    open.length - closed.length, 11,
    'exactly 11 exports are gated; a change to that count is a deliberate decision that must be reflected in both frozen sets above',
  );
  assert.deepStrictEqual(
    closed.filter((k) => !open.includes(k)), [],
    'no export may exist when the gate is CLOSED but vanish when it opens -- that would mean the gate swaps the surface rather than extending it',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// R33 correlation 17x1 MUTATION MATRIX -- the other half of R33-CORR-COVERAGE.
//
// `R33-CORR-COVERAGE` proves every production key HAS a test. This proves each
// production COMPARISON is load-bearing -- disable exactly one and the matching
// defect slips through. Together they close the shape of the `physical_root_id`
// hole, which survived 145 green tests.
//
// EXACTLY WHAT THIS DOES AND DOES NOT ESTABLISH, because an earlier title
// overclaimed both ways and the distinction is the whole value:
//
//   * It uses its OWN Node fixtures. It never executes the 17 bats regressions,
//     so it does NOT show that each of those regressions causally depends on its
//     comparison. It shows the PRODUCTION comparison matters. Pairing that with
//     R33-CORR-COVERAGE (every key has a named regression) is what makes the set
//     meaningful -- neither alone is sufficient, and neither substitutes for the
//     other.
//   * `clock_domain_id` does NOT slip through when disabled, and the body asserts
//     that it must not. Any title claiming "disabling any one lets the defect
//     pass" contradicts the test's own assertion for that key.
//
// Entirely test-side: `scripts/lib` is mirrored to a temp dir, only the COPY is
// rewritten, and the copy is re-required after clearing the module cache. No
// production seam, no test-only export, and the repo module is never written.
//
// The injected `continue` is anchored to the loop's source text. If a refactor
// moves it, this fails loudly with "anchor not found" rather than silently
// testing nothing -- a guard, not a fragility.
// ═══════════════════════════════════════════════════════════════════════════

// `clock_domain_id` is REDUNDANTLY guarded and provably cannot be isolated: the
// temporal rules independently compare `temporal.clock_domain_id` against BOTH
// records' top-level value, so any fixture breaking the 17-key rule for this key
// necessarily breaks temporal domain agreement too. Disabling the loop entry alone
// therefore still rejects. That is correct behaviour, not a coverage hole -- the
// behaviour has two independent guards -- and this matrix asserts the redundancy
// explicitly rather than skipping the key.
const R33_REDUNDANTLY_GUARDED_KEYS = Object.freeze(['clock_domain_id']);

test('R33-CORR-MUTATION: each of the 17 PRODUCTION correlation comparisons is either load-bearing on its own or provably redundantly guarded -- verified against dedicated fixtures here, NOT against the bats regressions', () => {
  const rc = require(IMPL);
  const keys = rc.R33_TUPLE_CORRELATION_KEYS.slice().sort();
  assert.strictEqual(keys.length, 17, 'expected the 17-key derived correlation set');

  const ANCHOR = '  for (const key of R33_TUPLE_CORRELATION_KEYS) {\n    if (root[key] !== session[key]) {';
  const originalSrc = fs.readFileSync(IMPL, 'utf8');
  assert.ok(
    originalSrc.includes(ANCHOR),
    'correlation-loop anchor not found verbatim in the production module. This matrix injects a `continue` at that exact text; if the loop was refactored, update the anchor -- do NOT delete this test, or the 17 per-key regressions lose the only thing proving they are load-bearing',
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-r33-mutation-'));
  try {
    // Mirror the whole lib dir once: the module reads sibling data files relative
    // to __dirname at REQUIRE time, so a lone .cjs copy throws before any test runs.
    const libCopy = path.join(dir, 'lib');
    fs.cpSync(path.dirname(IMPL), libCopy, { recursive: true });
    const implCopy = path.join(libCopy, path.basename(IMPL));

    // ---- one coherent tuple on disk, satisfying root confinement ----
    const proj = path.join(dir, 'proj');
    fs.mkdirSync(proj, { recursive: true });
    for (const args of [['init', '-q', proj], ['-C', proj, 'config', 'user.email', 'a@b.c'],
      ['-C', proj, 'config', 'user.name', 'x'], ['-C', proj, 'commit', '-q', '--allow-empty', '-m', 'i']]) {
      spawnSync('git', args, { encoding: 'utf8' });
    }
    const coordRoot = path.join(proj, '.planning', 'coordination');
    fs.mkdirSync(coordRoot, { recursive: true });
    fs.chmodSync(coordRoot, 0o700);

    const h64 = (p) => p.repeat(32);
    const h32 = (q) => q.repeat(8);
    const CD = h32('0a1b');
    const P33 = 'runtime-consultation/r33-csl-posix-local-v1';
    const shared = {
      runtime_owner_root_id: h64('a1'), clock_domain_receipt_digest: h64('b2'),
      coordination_root_id: h64('c3'), physical_root_id: h64('d4'),
      coordination_root_identity_security_digest: h64('e5'), canonical_root_path_digest: h64('f6'),
      mount_projection_digest: h64('07'), root_generation_id: h32('1c2d'),
      root_bootstrap_id: h32('2e3f'), provider_session_id: h32('3041'),
      local_filesystem_capability_digest: h64('18'), mount_generation_digest: h64('29'),
      provider_name: 'acd-transition-lock-posix', provider_build_digest: h64('3a'),
      provider_manager_kind: 'retained-native-host-owner',
      provider_manager_lifetime_profile: 'retained-session', coordination_mode: 'auto',
    };
    const rootProfile = Object.assign({
      schema: 'coordination/root-profile/v3', protocol_profile: P33,
      control_protocol: 'transition-lock/provider-control/v3', provider_abi: 3,
      handle_protocol: 'transition-lock/provider-handle/v2', clock_domain_id: CD,
      created_at_diagnostic_utc: '2026-07-25T00:00:00Z',
      lock_profile: 'transition-lock/file-posix/v2', local_filesystem_profile: 'local-posix/v2',
      platform: process.platform, architecture: process.arch,
    }, shared);
    const sessionBase = Object.assign({
      schema: 'coordination/provider-session/v3', provider_abi: 3,
      control_protocol: 'transition-lock/provider-control/v3',
      runtime_binding_receipt_digest: h64('4b'), clock_domain_id: CD,
      temporal: {
        clock_domain_id: CD, issued_monotonic_ns: '1000000000000',
        not_before_monotonic_ns: '1000000000000', expiry_monotonic_ns: '4600000000000',
      },
      started_at_diagnostic_utc: '2026-07-25T00:00:00Z',
      root_profile_digest: rc.rootProfileDigestV3(rootProfile),
      control_endpoint_id: h32('4152'), provider_manager_instance_id: h32('5263'), owner_pid: 4242,
    }, shared);
    const binding = {
      schema: 'runtime/csl-profile-binding/v2', protocol_profile: P33,
      control_protocol: 'transition-lock/provider-control/v3', provider_abi: 3,
      handle_protocol: 'transition-lock/provider-handle/v2',
      subject_manifest: 'coordination/subject-bundle-manifest/v2',
    };
    const bindingPath = path.join(proj, 'runtime-profile-binding.json');
    const writeRec = (p, o) => {
      fs.writeFileSync(p, Buffer.from(rc.canonicalJSONStringify(o) + '\n', 'utf8'), { mode: 0o600 });
      fs.chmodSync(p, 0o600);
    };
    writeRec(path.join(coordRoot, 'root-profile.json'), rootProfile);
    writeRec(bindingPath, binding);

    // A type-appropriate DIFFERENT value, so the record stays individually valid
    // and only the cross-record comparison can object.
    const alternateFor = (key) => {
      const v = sessionBase[key];
      if (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) return h64('9f');
      if (typeof v === 'string' && /^[0-9a-f]{32}$/.test(v)) return h32('9e8d');
      if (key === 'coordination_mode') return 'persistent';
      if (key === 'provider_manager_kind') return 'runtime-session-supervisor';
      if (key === 'provider_manager_lifetime_profile') return 'persistent-consumer';
      throw new Error('no alternate defined for correlation key ' + key + ' (value ' + String(v) + ')');
    };

    const loadPatched = (disabledKey) => {
      const patched = originalSrc.replace(ANCHOR,
        '  for (const key of R33_TUPLE_CORRELATION_KEYS) {\n'
        + "    if (key === '" + disabledKey + "') continue;\n"
        + '    if (root[key] !== session[key]) {');
      assert.notStrictEqual(patched, originalSrc, 'injection produced no change for ' + disabledKey);
      fs.writeFileSync(implCopy, patched);
      delete require.cache[require.resolve(implCopy)];
      return require(implCopy);
    };

    const rows = [];
    for (const key of keys) {
      const defective = Object.assign({}, sessionBase);
      defective[key] = alternateFor(key);
      writeRec(path.join(coordRoot, '.provider-session'), defective);

      // Control: the UNPATCHED module must reject this fixture. Without this the
      // matrix could "prove" a comparison load-bearing when the fixture was simply
      // never rejected in the first place.
      let baselineRejected = false;
      try { rc.checkR33ProfileTupleConformance(bindingPath, coordRoot); } catch (e) { baselineRejected = true; }
      assert.ok(baselineRejected, 'baseline: a tuple defective in ' + key + ' must be rejected by the unpatched module');

      const patchedModule = loadPatched(key);
      let slipped = false;
      try { patchedModule.checkR33ProfileTupleConformance(bindingPath, coordRoot); slipped = true; } catch (e) { /* still caught */ }
      rows.push(key + ' -> ' + (slipped ? 'slipped through (comparison is load-bearing)' : 'still rejected'));

      if (R33_REDUNDANTLY_GUARDED_KEYS.includes(key)) {
        assert.strictEqual(
          slipped, false,
          key + ' is documented as redundantly guarded (the temporal rules also compare it), so disabling only the 17-key entry must STILL reject. It slipped through, which means that redundancy is gone -- update the documented reasoning rather than this expectation',
        );
      } else {
        assert.ok(
          slipped,
          'disabling the ' + key + ' comparison did NOT let a tuple defective in exactly that key through, so the per-key regression for it is not actually depending on that comparison -- this is the shape of the physical_root_id hole. Matrix so far:\n  ' + rows.join('\n  '),
        );
      }
    }
    assert.strictEqual(rows.length, 17, 'expected 17 rows, got ' + rows.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R33-AUDIT-1 no-mutation audit preconditions: each marker token occurs EXACTLY once and the extracted R33 region is substantial (> 500 lines)', () => {
  const { lines } = r33AuditScope();
  assert.ok(lines > 500, 'sanity: scope is ' + lines + ' lines');
});

test('R33-AUDIT-2 no-mutation audit: the extracted R33 stage-1 region contains ZERO of the 19 mutation primitives (extract-then-assert-absence)', () => {
  const { scope, lines } = r33AuditScope();
  assert.strictEqual(R33_AUDIT_MUTATORS.length, 19, 'the mutator list must stay at the 19 agreed primitives; shrinking it would weaken the audit silently');

  const found = [];
  for (const m of R33_AUDIT_MUTATORS) {
    const n = scope.split(m).length - 1;
    if (n > 0) found.push(m + ' x' + n);
  }
  // Note on overlap: `linkSync` is a substring of `unlinkSync`, so a real hit on
  // the latter reports both. That cannot cause a false FAILURE here because the
  // expectation is zero for every entry -- it only affects how a genuine hit is
  // described.
  assert.deepStrictEqual(
    found, [],
    'mutation primitives found INSIDE the R33 stage-1 scope (' + lines + ' lines): ' + found.join(', ')
      + ' -- `validate` is a no-mutation command, so the R33 region must reach none of these',
  );
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE Group B (test-specialist, dispatch arch-testing-20260816T160058Z):
// RED 18 (M7-CANCEL-CLAIM-HEARTBEAT), cut-first side. Contract section 8.5:
// "claim and lease-heartbeat gain the SAME final cancel/terminal absence read
// already applied by publish-result". Confirmed by direct read of
// cmdClaim/cmdLeaseHeartbeat (scripts/lib/runtime-consultation.cjs): NEITHER
// function references cancelPathFor/readCanonicalCancelRecordOptional
// anywhere in its own body today -- only cmdPublishResult already does.
// Drives the real CLI end to end (this file's own withProject/runTestCli/
// assertCliResult conventions, same grant-wrapper every other case here
// already uses) through a full publish-request -> dispatch -> cancel ->
// claim/heartbeat sequence, landing cancel.json FULLY DURABLE before
// claim/heartbeat is ever attempted -- deterministic, no rendezvous producer
// needed (M7 section 10.3: "the cut-first side... is a deterministic
// sequential negative"). The dispatch step deliberately mirrors this file's
// own already-proven "properly published request" test above (zero live
// session/PLAN/worktree/action correlation -> frozen noop fallback) -- claim
// itself never restricts by selected_driver, so that proven, simpler
// dispatch shape is sufficient here.
//
// The admission-first race side (claim-after-admission-before-link /
// heartbeat-after-admission-before-write) is deliberately not captured here:
// today neither function checks cancel.json AT ALL, so its timing relative to
// the pause point has zero observable effect either way -- unlike create/grant
// (RED 13/14, runtime-role-lifecycle-registry.test.js), there is no distinct
// "wrong today" admission-first outcome to capture for claim/heartbeat
// specifically.
// ════════════════════════════════════════════════════════════════════════════

test('M7-CANCEL-CLAIM-HEARTBEAT-18 (RED, cut-first, claim): claim on a request whose transaction is ALREADY, fully durably cancelled must be denied CANCELLED/TRANSACTION_CANCELLED -- today cmdClaim never consults cancel.json at all and succeeds unconditionally', () => {
  withProject('m7-red18-claim-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'M7-RED-18 claim-vs-cancel fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });

    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    const cancelled = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref, '--reason', 'explicit']);
    assertCliResult(cancelled, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });

    const claimed = runTestCli(['claim', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref, '--role', 'arch-testing']);
    assertCliResult(claimed, { command: 'claim', status: 'CANCELLED', detail_code: 'TRANSACTION_CANCELLED' });
  });
});

test('M7-CANCEL-CLAIM-HEARTBEAT-18 (RED, cut-first, lease-heartbeat): lease-heartbeat on a request whose transaction is ALREADY, fully durably cancelled must be denied CANCELLED/TRANSACTION_CANCELLED -- today cmdLeaseHeartbeat never consults cancel.json at all and succeeds unconditionally', () => {
  withProject('m7-red18-heartbeat-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'M7-RED-18 heartbeat-vs-cancel fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });

    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    // The initial claim/lease must genuinely succeed BEFORE the cancel lands
    // -- proves lease-heartbeat's own denial below is about the cancel
    // specifically, never an unrelated "no lease to refresh" failure.
    const claimed = runTestCli(['claim', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref, '--role', 'arch-testing']);
    const claimedData = assertCliResult(claimed, { command: 'claim', status: 'SUCCESS', detail_code: 'NONE' });

    const cancelled = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref, '--reason', 'explicit']);
    assertCliResult(cancelled, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });

    const heartbeat = runTestCli(['lease-heartbeat', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref, '--claim', claimedData.artifact_ref]);
    assertCliResult(heartbeat, { command: 'lease-heartbeat', status: 'CANCELLED', detail_code: 'TRANSACTION_CANCELLED' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE Group B: RED 15 (M7-COMMAND-ADMISSION-RACE). Contract section
// 10.1 lists two command stages: command-before-admission (right before
// validateRoleCommandGrantOrThrow, confirmed by direct read of
// validateAndConsumeRoleCommandGrantForCommand, scripts/lib/runtime-
// consultation.cjs ~L6657-6734) and command-after-admission-before-consume
// (right after validation+scope re-derivation, right before
// consumeValidatedRoleCommandGrantOrThrow). RUNTIME_M7_TEST_STAGE selects
// exactly ONE stage per child (the other call's own stage-mismatch check is a
// no-op), so these are two SEPARATE scenarios, never one interleaved race:
//   - command-before-admission = cut-first-via-rendezvous: a real, already-
//     spawned child (live grant+binding context) is paused BEFORE admission
//     runs; the fence lands fully durable while it waits; released, admission
//     must then see it and deny -- genuinely a currently-failing RED, since
//     nothing checks any fence today.
//   - command-after-admission-before-consume = admission-first positive
//     control, matching claim/heartbeat's own already-admitted-completes
//     shape (M7 section 10.3 closing paragraph): pause AFTER validation
//     passes, land the fence during the pause, release -- the command must
//     still complete, proving the harness genuinely reaches that exact pause
//     point without spuriously breaking an already-admitted operation (today
//     trivially true too, since nothing checks any fence at any point yet).
//
// Uses `root-init` -- the single simplest REQUESTER_GATED subcommand (no
// pre-existing transaction/coordination-root needed at all, unlike
// claim/heartbeat) -- driven through this file's own GRANT_WRAPPER exactly
// like every other case here, so the wrapper's own default requester identity
// (provider codex-supervisor, session 'rcc-grant-wrapper-session', agent
// 'runtime-consultation-grant-wrapper-agent' -- confirmed by direct read of
// the wrapper's own RCC_GRANT_* default-resolution doc comments) is the exact
// identity to fence.
// ════════════════════════════════════════════════════════════════════════════

const M7_WRAPPER_DEFAULT_PROVIDER = 'codex-supervisor';
const M7_WRAPPER_DEFAULT_SESSION = 'rcc-grant-wrapper-session';
const M7_WRAPPER_DEFAULT_AGENT = 'runtime-consultation-grant-wrapper-agent';

// M7 section 3.1: authority_identity_id = sha256(canonicalJSONStringify(...))
// over EXACTLY {schema,provider,repo_id,runtime_session_key,agent_id}.
// Small logic-identical duplication of the RLL registry test file's own
// identical helper (this codebase's own established convention for a tiny,
// cross-file-shared computation, rather than an awkward shared-module
// dependency) -- never a second REIMPLEMENTATION of the underlying
// sha256String/canonicalJSONStringify primitives themselves, which come
// straight from a fresh require(IMPL) exactly like every other test in this
// file already does.
function m7ComputeAuthorityIdentityId(dir, provider, sessionId, agentId) {
  const rc = require(IMPL);
  const identity = {
    schema: 'runtime/claude-authority-identity/v1',
    provider,
    repo_id: rll.computeRepoId(dir),
    runtime_session_key: sessionId,
    agent_id: agentId,
  };
  return rc.sha256String(rc.canonicalJSONStringify(identity));
}

// M7 CORRECTION (defect 11): this file's own GRANT_WRAPPER defaults every
// requester-gated mint to provider:'codex-supervisor' (see the wrapper's own
// RCC_GRANT_PROVIDER doc comment) -- fine for the vast majority of this
// file's own tests (generic CLI/grant round-trip mechanics), but WRONG for
// any race test exercising the M7 Claude-domain fence specifically, since
// the fence must never apply to codex-supervisor at all (M7 section 4.1/12
// -- see runtime-role-lifecycle-registry.test.js's own
// M7-CODEX-COMPATIBILITY-GATE-11 tests for the dedicated positive-proof).
// Mirrors runtime-role-lifecycle-registry.test.js's own primeClaudeId01Trace
// helper exactly (this file has no such helper of its own yet), scoped to
// the wrapper's own fixed default identity tuple (session
// 'rcc-grant-wrapper-session', agent 'runtime-consultation-grant-wrapper-agent')
// so a claude-hook-provider override on that SAME tuple has genuine
// CLAUDE-ID-01 proof backing it once createRequesterBinding consults it.
function m7PrimeClaudeId01TraceForWrapperIdentity(dir, agentType, sessionId, agentId) {
  const mintAction = (suffix) => {
    const generation = rll.resolveSessionGeneration(dir, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(generation.ok, true, 'm7PrimeClaudeId01TraceForWrapperIdentity: session generation must resolve: ' + JSON.stringify(generation));
    const plan = rll.discoverPlan(dir);
    assert.strictEqual(plan.ok, true, 'm7PrimeClaudeId01TraceForWrapperIdentity: PLAN must resolve: ' + JSON.stringify(plan));
    const actionId = rll.generateActionId();
    const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const minted = rll.mintRoleLifecycleAction(
      dir, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(dir), rll.computeWorktreeId(dir),
      plan.planDigest, crypto.createHash('sha256').update('rcc-node-m7-claude-id01:' + suffix).digest('hex'),
      generation.generationId, agentType, rll.buildRoleSpawnPayload('claude-id01-probe', agentType, agentType, 'fixture', 'fixture'), expiry,
    );
    assert.strictEqual(minted.ok, true, 'm7PrimeClaudeId01TraceForWrapperIdentity: probe action must mint: ' + JSON.stringify(minted));
    return actionId;
  };
  const actionA = mintAction('a-' + agentId);
  const actionB = mintAction('b-' + agentId);
  rll.recordClaudeId01SubagentStartObservation(dir, { sessionId, agentId, agentType, actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(dir, { sessionId, agentId, agentType, toolUseId: 'rcc-node-m7-prime-1-' + sessionId + '-' + agentId });
  rll.recordClaudeId01PreToolUseObservation(dir, { sessionId, agentId, agentType, toolUseId: 'rcc-node-m7-prime-2-' + sessionId + '-' + agentId });
  rll.recordClaudeId01SubagentStartObservation(dir, { sessionId, agentId, agentType, actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(dir, { sessionId, agentId, agentType, toolUseId: 'rcc-node-m7-prime-3-' + sessionId + '-' + agentId });
  rll.recordClaudeId01SubagentStartObservation(dir, { sessionId, agentId: agentId + '-distinct-peer-b', agentType, actionId: actionB });
  const proof = rll.checkClaudeId01RuntimeCapability(dir, sessionId, rll.computeWorktreeId(dir), rll.discoverPlan(dir).planDigest);
  assert.strictEqual(proof.ok, true, 'm7PrimeClaudeId01TraceForWrapperIdentity: global CLAUDE-ID-01 capability must be complete: ' + JSON.stringify(proof));
}

function m7AuthorityFencePathFor(dir, authorityIdentityId) {
  return path.join(rll.registryRepoDir(dir), 'authority-identity-fences', authorityIdentityId + '.json');
}

function m7PlantFence(dir, provider, sessionId, agentId) {
  const authorityIdentityId = m7ComputeAuthorityIdentityId(dir, provider, sessionId, agentId);
  const fencePath = m7AuthorityFencePathFor(dir, authorityIdentityId);
  const planted = rll.writeRegistryRecordReplace(fencePath, Buffer.from(JSON.stringify({
    schema: 'runtime/claude-authority-fence/v1',
    authority_identity_id: authorityIdentityId,
    reason: 'agent-return',
    fenced_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }), 'utf8'));
  assert.strictEqual(planted.ok, true, 'fixture: planting the simulated fence record must succeed: ' + JSON.stringify(planted));
  return { authorityIdentityId, fencePath };
}

// Spawns the real GRANT_WRAPPER (never the raw CLI directly -- every other
// case in this file goes through it too) with the M7 stage/dir env vars set
// on ITS OWN process. The wrapper's own shielding (test-specialist-owned,
// Fase 0) strips them for its own internal mint work and restores them only
// for the real CLI child it spawns with stdio:'inherit' -- so `child.stdout`
// here (the wrapper's own stdout) transparently carries the real CLI's
// output, and the rendezvous pause genuinely happens inside the real CLI
// process, never the wrapper. Mirrors this file's own runTestCli/spawnCli
// env-construction convention (NODE_ENV=test + RUNTIME_CONSULTATION_TEST_CAPABILITY)
// plus the RLL registry test file's own m7DriveRendezvousRace harness
// contract verbatim: waits for ready, runs the competing op, writes go
// no-clobber, waits/reaps.
async function m7DriveCliRendezvousRace(cliArgv, stage, rendezvousDir, competingOp, envExtra) {
  const readyPath = path.join(rendezvousDir, stage + '.ready');
  const goPath = path.join(rendezvousDir, stage + '.go');
  const child = spawn(process.execPath, [GRANT_WRAPPER, ...cliArgv], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      NODE_ENV: 'test',
      RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY,
      RUNTIME_M7_TEST_STAGE: stage,
      RUNTIME_M7_TEST_RENDEZVOUS_DIR: rendezvousDir,
    }, envExtra || {}),
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
  child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

  const readyStart = Date.now();
  while (!fs.existsSync(readyPath)) {
    if (Date.now() - readyStart > 5000) {
      child.kill('SIGKILL');
      throw new Error('m7 CLI race harness: timed out waiting for ' + stage + '.ready (child never armed): stderr=' + stderr);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  await competingOp();

  fs.writeFileSync(goPath, Buffer.from('go\n', 'utf8'), { mode: 0o600, flag: 'wx' });

  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  return { exitCode, stdout, stderr };
}

test('M7-COMMAND-ADMISSION-RACE-15 (RED, cut-first-via-rendezvous): a fence landing while a real CLI child is paused BEFORE command admission runs must deny the command outright -- today validateAndConsumeRoleCommandGrantForCommand never consults any fence and the command succeeds. M7 CORRECTION (defect 11): uses a REAL claude-hook identity with genuine CLAUDE-ID-01 proof (via RCC_GRANT_PROVIDER overriding the wrapper\'s own fixed default session/agent tuple, primed in the PARENT process before the child runs) -- never the wrapper\'s own codex-supervisor default, for the identical M7-CODEX-COMPATIBILITY reason as every fence race in runtime-role-lifecycle-registry.test.js (see that file\'s own M7-CODEX-COMPATIBILITY-GATE-11 tests).', async () => {
  const dir = makeTempProject();
  planFileFor(dir, 'm7-red15-cutfirst-wave');
  const coordRoot = path.join(dir, '.planning', 'coordination');
  const rendezvousDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm7-red15-cutfirst-'));
  try {
    m7PrimeClaudeId01TraceForWrapperIdentity(dir, 'arch-testing', M7_WRAPPER_DEFAULT_SESSION, M7_WRAPPER_DEFAULT_AGENT);
    const result = await m7DriveCliRendezvousRace(
      ['root-init', '--coordination-root', coordRoot],
      'command-before-admission',
      rendezvousDir,
      async () => { m7PlantFence(dir, 'claude-hook', M7_WRAPPER_DEFAULT_SESSION, M7_WRAPPER_DEFAULT_AGENT); },
      { RCC_GRANT_PROVIDER: 'claude-hook' },
    );
    // Stale-value fix: this file's own Frozen-CLI-ABI RC_FOR_STATUS table
    // maps domain status directly to process exit code (INVALID:3, never 0)
    // -- an INVALID/AUTHORITY_INVALID envelope is a well-formed, correctly-
    // denied result and exits 3 BY DESIGN, not a crash. `0` here was almost
    // certainly copy-pasted from the neighboring positive-control sub-test,
    // where 0 is genuinely correct (its own case IS SUCCESS).
    assert.strictEqual(result.exitCode, RC_FOR_STATUS.INVALID, 'the CLI process itself must exit with the Frozen-CLI-ABI rc for INVALID (rc3/INVALID is a well-formed envelope, never a crashed process): ' + JSON.stringify(result));
    const data = parseSingleJsonStdout(result.stdout);
    assert.strictEqual(
      data.status, 'INVALID',
      'M7 section 5 point 4 / section 8.3: command admission must deny a fenced backing identity, cut-first-via-rendezvous -- today validateAndConsumeRoleCommandGrantForCommand has no fence concept at all and the command succeeds: ' + JSON.stringify(data)
    );
    assert.strictEqual(data.detail_code, 'AUTHORITY_INVALID');
  } finally {
    fs.rmSync(rendezvousDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-COMMAND-ADMISSION-RACE-15 (positive control, admission-first race): a fence landing DURING the window between command admission and grant consumption must NOT retroactively deny an already-admitted command -- proves the race harness genuinely reaches command-after-admission-before-consume and, once released, the command still completes (M7 section 10.3: "an already-admitted command/claim/heartbeat may complete bounded and is ordered before the later cut"). M7 CORRECTION (defect 11): uses a REAL claude-hook identity with genuine CLAUDE-ID-01 proof -- same M7-CODEX-COMPATIBILITY rationale as the cut-first sibling above.', async () => {
  const dir = makeTempProject();
  planFileFor(dir, 'm7-red15-admissionfirst-wave');
  const coordRoot = path.join(dir, '.planning', 'coordination');
  const rendezvousDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm7-red15-admissionfirst-'));
  try {
    m7PrimeClaudeId01TraceForWrapperIdentity(dir, 'arch-testing', M7_WRAPPER_DEFAULT_SESSION, M7_WRAPPER_DEFAULT_AGENT);
    const result = await m7DriveCliRendezvousRace(
      ['root-init', '--coordination-root', coordRoot],
      'command-after-admission-before-consume',
      rendezvousDir,
      async () => { m7PlantFence(dir, 'claude-hook', M7_WRAPPER_DEFAULT_SESSION, M7_WRAPPER_DEFAULT_AGENT); },
      { RCC_GRANT_PROVIDER: 'claude-hook' },
    );
    assert.strictEqual(result.exitCode, 0, 'the CLI process itself must exit cleanly: ' + JSON.stringify(result));
    const data = parseSingleJsonStdout(result.stdout);
    assert.strictEqual(
      data.status, 'SUCCESS',
      'positive control: a command already past admission (validation + scope re-derivation both passed before the fence landed) must complete, never be retroactively denied by a cut that raced in only after that point: ' + JSON.stringify(data)
    );
    assert.ok(fs.statSync(coordRoot).isDirectory(), 'root-init must have genuinely created the coordination root');
  } finally {
    fs.rmSync(rendezvousDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M7 CORRECTION defect 5 (M7-CONSUME-GRANT-ADMISSION-ABSENT): a direct,
// structural complement to RED 15 above. Confirmed by direct read
// (2026-08-17) of validateAndConsumeRoleCommandGrantForCommand
// (runtime-consultation.cjs ~L6442-6519): the two race seams
// (testM7Rendezvous('command-before-admission',...) and
// testM7Rendezvous('command-after-admission-before-consume',...)) already
// exist, but the function goes straight from validateRoleCommandGrantOrThrow
// to consumeValidatedRoleCommandGrantOrThrow with ZERO call to
// admitClaudeAuthorityOperation anywhere in between -- M7 section 7 requires
// it "obtains and consumes a consume-grant capability immediately before its
// existing one-use grant marker". Extracted via the same function-body-window
// technique this codebase's own guards 27/29 (runtime-role-lifecycle-
// registry.test.js) and RED 22 (this file) already establish for a
// structural-absence property no runtime assertion could otherwise pin
// without inventing a THIRD, artificial rendezvous stage the production code
// does not yet have any concept of.
test('M7-CONSUME-GRANT-ADMISSION-ABSENT (RED, structural): validateAndConsumeRoleCommandGrantForCommand must obtain a consume-grant admission capability (M7 section 7: "obtains and consumes a consume-grant capability immediately before its existing one-use grant marker") -- today its own source contains both race seams (testM7Rendezvous(\'command-before-admission\',...) and testM7Rendezvous(\'command-after-admission-before-consume\',...)) but ZERO call to admitClaudeAuthorityOperation anywhere in its body: it goes straight from validateRoleCommandGrantOrThrow to consumeValidatedRoleCommandGrantOrThrow with no capability obtained in between', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../lib/runtime-consultation.cjs'), 'utf8');
  const defIdx = src.indexOf('function validateAndConsumeRoleCommandGrantForCommand(');
  assert.notStrictEqual(defIdx, -1, 'fixture sanity: validateAndConsumeRoleCommandGrantForCommand must still be found as a named function in the source');
  const nextFunctionOffset = src.indexOf('\nfunction ', defIdx + 'function validateAndConsumeRoleCommandGrantForCommand('.length);
  assert.notStrictEqual(nextFunctionOffset, -1, 'fixture sanity: a following top-level function declaration must exist to bound the extracted body');
  const body = src.slice(defIdx, nextFunctionOffset);
  assert.ok(
    body.includes("testM7Rendezvous('command-before-admission'"),
    'fixture sanity: the command-before-admission rendezvous seam must genuinely exist in this function\'s body -- if this fails, the extraction window itself is wrong, not the RED subject'
  );
  assert.ok(
    body.includes("testM7Rendezvous('command-after-admission-before-consume'"),
    'fixture sanity: the command-after-admission-before-consume rendezvous seam must genuinely exist in this function\'s body -- if this fails, the extraction window itself is wrong, not the RED subject'
  );
  assert.ok(
    body.includes('admitClaudeAuthorityOperation'),
    'M7 section 7: validateAndConsumeRoleCommandGrantForCommand must obtain a consume-grant admission capability immediately before consumeValidatedRoleCommandGrantOrThrow -- today it never calls admitClaudeAuthorityOperation at all, so nothing re-checks the total authority predicate (including the fence) between validation and consumption: ' + JSON.stringify({ bodyLength: body.length })
  );
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE Group B: RED 18, admission-first positive controls (claim +
// lease-heartbeat).
//
// claim-after-admission-before-link fires INSIDE cmdClaim's own
// publishNoClobber revalidateBeforeLink callback -- confirmed by direct read
// (scripts/lib/runtime-consultation.cjs ~L9005-9012) that this point is
// BEFORE cmdClaim ever calls withLock, so a paused child here holds no
// transaction lock. This makes racing a real `cancel` from the parent process
// (itself lock-free at claim's own admission point, though cancel acquires
// its OWN lock once it runs) safe against deadlock.
//
// heartbeat-after-admission-before-write is different: confirmed by direct
// read that it fires INSIDE cmdLeaseHeartbeat's own withLock callback
// (~L9202-9205), and cmdCancel's own section header ("`cancel` -- UNDER
// LOCK", ~L9381) confirms cancel needs the IDENTICAL transaction lock --
// racing a parent-side REAL `cancel` CLI call against a heartbeat child
// already parked inside that same lock would deadlock (parent blocks
// acquiring the lock the child holds; child blocks waiting for .go, which
// the now-deadlocked parent can never write). Team-lead-suggested fix:
// write cancel.json DIRECTLY from the competing-op callback instead of going
// through the locked cmdCancel at all -- a raw file write contends for no
// lock. Exact shape confirmed by team-lead's own direct read of cmdCancel's
// actual write (~L9653-9659): {schema:'coordination/cancel/v1', request_id,
// reason, cancelled_at, cancelled_by} -- byte-identical to what the locked
// cmdCancel would produce, same technique m7PlantFence already uses for a
// fence record (bypassing a not-yet-built mechanism there; bypassing a lock
// contention here).
// ════════════════════════════════════════════════════════════════════════════

test('M7-CANCEL-CLAIM-HEARTBEAT-18 (positive control, admission-first race, claim): a cancel landing DURING the window between claim admission (revalidateBeforeLink) and the durable link must NOT retroactively deny an already-admitted claim -- proves the race harness genuinely reaches claim-after-admission-before-link and, once released, the claim still completes', async () => {
  const dir = makeTempProject();
  const coordRoot = path.join(dir, '.planning', 'coordination');
  const planPath = planFileFor(dir, 'm7-red18-claimrace-wave');
  const subjectBundlePath = subjectBundleFileFor(dir, []);
  const rendezvousDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm7-red18-claimrace-'));
  try {
    const initResult = runTestCli(['root-init', '--coordination-root', coordRoot]);
    assert.strictEqual(initResult.status, 0, 'fixture root-init must succeed: ' + initResult.stdout + initResult.stderr);

    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'M7-RED-18 admission-first claim-vs-cancel fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', coordRoot, '--plan', planPath,
      '--subject-bundle', subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });

    const dispatched = runTestCli(['dispatch', '--coordination-root', coordRoot, '--request', publishedData.artifact_ref]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    const result = await m7DriveCliRendezvousRace(
      ['claim', '--coordination-root', coordRoot, '--request', publishedData.artifact_ref, '--role', 'arch-testing'],
      'claim-after-admission-before-link',
      rendezvousDir,
      async () => {
        const cancelled = runTestCli(['cancel', '--coordination-root', coordRoot, '--request', publishedData.artifact_ref, '--reason', 'explicit']);
        assertCliResult(cancelled, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });
      },
    );
    assert.strictEqual(result.exitCode, 0, 'the CLI process itself must exit cleanly: ' + JSON.stringify(result));
    const data = parseSingleJsonStdout(result.stdout);
    assert.strictEqual(
      data.status, 'SUCCESS',
      'positive control: a claim already past its own admission point (revalidateBeforeLink) must complete, never be retroactively denied by a cancellation that raced in only after that point: ' + JSON.stringify(data)
    );
  } finally {
    fs.rmSync(rendezvousDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE Group B: RED 17 (M7-ONESHOT-TERMINAL-CUT). Team-lead-suggested
// lighter path (same shape as RED 16's own root-source version): a
// ClaudeOneShotBinding needs no reservation/hook chain at all -- createClaudeOneShotBinding
// is a direct, standalone callable (RED 3's own creation pattern) that never
// cross-validates its requestId/attemptId/leaseEpoch params against anything
// else, so a REAL published+cancelled transaction's own request_id/
// initial_attempt_id/initial_lease_epoch can be fed directly into it. No
// ingress concept applies to the one-shot family at all (M7 section 4.3/8.5).
// mintRoleCommandGrant's target-authority branch treats RoleActorBinding and
// ClaudeOneShotBinding identically -- confirmed by direct read, only a
// schema/shape check, no family-specific business logic follows for EITHER
// -- so this isolates the SAME class of gap RED 16 isolates for root-source,
// on the mint-grant function directly (never the full CLI, for the same
// "isolate exactly the gap" reason RED 4/16 use).
// ════════════════════════════════════════════════════════════════════════════

test('M7-ONESHOT-TERMINAL-CUT-17 (RED): mintRoleCommandGrant must deny a further target-authority grant against a ClaudeOneShotBinding whose transaction is ALREADY, durably cancelled -- today it performs zero result/cancel checking for any target-authority binding and mints successfully', () => {
  withProject('m7-red17-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'M7-RED-17 one-shot-vs-cancel fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const reqObj = JSON.parse(fs.readFileSync(publishedData.artifact_ref, 'utf8'));

    const red17Gen = rll.resolveSessionGeneration(ctx.projDir, { provider: 'claude-hook', runtime_session_key: 'm7-red17-session' });
    assert.strictEqual(red17Gen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(red17Gen));
    const minted = rll.createClaudeOneShotBinding(
      ctx.projDir, 'm7-red17-session', red17Gen.generationId, 'm7-red17-agent', 'arch-testing',
      rll.generateActionId(), reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch,
      'arch-testing', ctx.worktreeId, ctx.planDigest, 600,
    );
    assert.strictEqual(minted.ok, true, 'fixture: a real ClaudeOneShotBinding correlating to the published transaction must mint: ' + JSON.stringify(minted));

    const cancelled = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref, '--reason', 'explicit']);
    assertCliResult(cancelled, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });

    const argvDigest = sha256Hex('m7-red17-argv');
    const grant = rll.mintRoleCommandGrant(
      ctx.projDir, minted.binding, 'target', 'claim', argvDigest,
      reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch,
    );
    assert.strictEqual(
      grant.ok, false,
      'M7 section 5 (one-shot family proof: neither its authoritative result nor cancel.json exists) / section 8.2: mint-grant must deny a target-authority grant against an already-cancelled transaction -- today mintRoleCommandGrant performs zero result/cancel checking for any target-authority binding (RoleActorBinding or ClaudeOneShotBinding alike): ' + JSON.stringify(grant)
    );
  });
});

// M7 checklist item 10 (2026-08-17 correction pass), one-shot half: RED-17
// above proves mintRoleCommandGrant denies once cancel.json genuinely exists.
// This proves the DIFFERENT axis on the SAME lines (runtime-role-lifecycle.cjs,
// the one-shot branch inside mintRoleCommandGrant): `let terminalExists =
// false; try { terminalExists = fs.existsSync(api.acceptedResultPathFor(txnDir))
// || fs.existsSync(api.cancelPathFor(txnDir)); } catch (err) { terminalExists =
// false; }` swallows ANY genuine read error into the SAME outcome as genuine
// absence. Node's fs.existsSync itself never throws (it internally swallows
// every stat error and returns false), so the bug is structural, not merely a
// bad catch block -- the try/catch can never even be reached by an existsSync
// error; the defect is using existsSync at all for a check that must
// distinguish ENOENT from every other failure mode. Forces a genuine ENOTDIR
// (never ENOENT) by replacing txnDir itself with a plain file, mirroring
// claude-one-shot-binding-red.bats's own COSB-SUBAGENTSTOP-ONESHOT-LOOKUP-ERROR-BLOCKS
// technique exactly (rename the real directory aside, plant a plain file at
// its path).
test('M7-ONESHOT-TERMINAL-READ-ERROR-10 (RED): mintRoleCommandGrant must fail closed when a genuine filesystem read error (ENOTDIR, never ENOENT) prevents verifying whether accepted-result.json/cancel.json exist for a one-shot binding\'s own transaction directory -- today the error is silently swallowed into terminalExists=false (treated as absent) and the mint wrongly succeeds exactly as if no terminal existed at all', () => {
  withProject('m7-red10-oneshot-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'M7-RED-10-ONESHOT one-shot-vs-read-error fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const reqObj = JSON.parse(fs.readFileSync(publishedData.artifact_ref, 'utf8'));

    const red10Gen = rll.resolveSessionGeneration(ctx.projDir, { provider: 'claude-hook', runtime_session_key: 'm7-red10-oneshot-session' });
    assert.strictEqual(red10Gen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(red10Gen));
    const minted = rll.createClaudeOneShotBinding(
      ctx.projDir, 'm7-red10-oneshot-session', red10Gen.generationId, 'm7-red10-oneshot-agent', 'arch-testing',
      rll.generateActionId(), reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch,
      'arch-testing', ctx.worktreeId, ctx.planDigest, 600,
    );
    assert.strictEqual(minted.ok, true, 'fixture: a real ClaudeOneShotBinding correlating to the published transaction must mint: ' + JSON.stringify(minted));

    const argvDigest = sha256Hex('m7-red10-oneshot-argv');

    // Positive control FIRST: genuinely absent terminal, real accessible
    // txnDir -- mint must succeed cleanly, proving the fixture itself is
    // valid and the denial below is attributable to the injected read-error
    // fault, never a generally-broken setup.
    const before = rll.mintRoleCommandGrant(
      ctx.projDir, minted.binding, 'target', 'claim', argvDigest,
      reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch,
    );
    assert.strictEqual(before.ok, true, 'fixture sanity: an ordinary mint against a genuinely absent terminal must succeed: ' + JSON.stringify(before));

    // Fault injection: txnDir (which genuinely holds request.json on disk) is
    // replaced with a plain file -- forces ENOTDIR when mintRoleCommandGrant
    // later fs.existsSync-probes <txnDir>/accepted-result.json and
    // <txnDir>/cancel.json.
    const txnDir = path.dirname(publishedData.artifact_ref);
    assert.ok(fs.statSync(txnDir).isDirectory(), 'fixture sanity: txnDir must genuinely be a real directory before the fault');
    const realTxnDir = txnDir + '-real';
    fs.renameSync(txnDir, realTxnDir);
    fs.writeFileSync(txnDir, 'not a directory');

    let after;
    try {
      after = rll.mintRoleCommandGrant(
        ctx.projDir, minted.binding, 'target', 'claim', argvDigest,
        reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch,
      );
    } finally {
      fs.unlinkSync(txnDir);
      fs.renameSync(realTxnDir, txnDir);
    }
    assert.strictEqual(
      after.ok, false,
      'M7 section 5 (one-shot family proof: neither its authoritative result nor cancel.json exists) / section 8.2: a genuine read error verifying the terminal must fail closed, never be silently treated as absent -- today mintRoleCommandGrant\'s bare try/catch around fs.existsSync(accepted-result.json)||fs.existsSync(cancel.json) swallows the ENOTDIR and mints successfully: ' + JSON.stringify(after)
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// M7 defect 4 / checklist item 11 (2026-08-17 correction pass): "Existing
// grant + terminal durable: cero consumed marker." Distinct from RED 17 above
// (which proves mint-time DENIES a NEW grant against an already-terminal
// transaction) -- this proves the CONSUME-time gap: a grant minted
// successfully WHILE the transaction was still live becomes STALE the moment
// a terminal lands afterward (a realistic concurrent-completion scenario,
// not a synthetic race), and today's consumption path never re-checks it.
// Confirmed by direct read: validateClaudeOneShotBindingFor's own full body
// (runtime-role-lifecycle.cjs) checks retirement/generation/fence/expiry/
// scope but never accepted-result.json/cancel.json; validateAndConsumeRoleCommandGrantForCommand's
// own 'requester'-only scope re-derivation branch (runtime-consultation.cjs
// ~L6484) never runs for 'target' authority at all. The grant is therefore
// consumed as if nothing happened -- exactly the ".consumed marker gets
// written for a stale grant" outcome the checklist names as wrong ("cero
// consumed marker" -- there must be ZERO).
// This bypasses the GRANT_WRAPPER's own auto-mint for the FINAL consumption
// call (which only ever backs TARGET_GATED commands with a RoleActorBinding,
// structurally outside M7's Claude-actor-cut scope per section 2.2 -- unusable
// for this one-shot-specific test) -- a direct spawn of REAL_CLI/IMPL with the
// PRE-MINTED grantId explicit on --target-binding, mirroring this file's own
// runProductionCli precedent for "bypass the wrapper, drive the real CLI
// directly" when a test needs to control exactly which grant reaches it.
// ════════════════════════════════════════════════════════════════════════════

test('M7-STALE-GRANT-AFTER-TERMINAL-ZERO-CONSUMED-MARKER (RED): a target-authority grant minted while a one-shot transaction was still live must be REJECTED at consumption once that transaction later becomes terminal (cancelled), with ZERO .consumed marker ever written -- today validateAndConsumeRoleCommandGrantForCommand never re-checks the transaction terminal for a ClaudeOneShotBinding-backed grant (only mintRoleCommandGrant does, mint-time only), so the stale grant is silently consumed', () => {
  const rc = require(IMPL);
  withProject('m7-item11-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'M7-ITEM-11 stale-grant-after-terminal fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const reqObj = JSON.parse(fs.readFileSync(publishedData.artifact_ref, 'utf8'));

    // cmdClaim requires a real dispatched activation (resolveActivationForRequestPath)
    // -- mirrors M7-CANCEL-CLAIM-HEARTBEAT-18's own claim-race fixture, which
    // dispatches before claiming for the identical reason.
    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    const item11Gen = rll.resolveSessionGeneration(ctx.projDir, { provider: 'claude-hook', runtime_session_key: 'm7-item11-session' });
    assert.strictEqual(item11Gen.ok, true, 'fixture: a live session generation must resolve first: ' + JSON.stringify(item11Gen));
    const minted = rll.createClaudeOneShotBinding(
      ctx.projDir, 'm7-item11-session', item11Gen.generationId, 'm7-item11-agent', 'arch-testing',
      rll.generateActionId(), reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch,
      'arch-testing', ctx.worktreeId, ctx.planDigest, 600,
    );
    assert.strictEqual(minted.ok, true, 'fixture: a real ClaudeOneShotBinding correlating to the published transaction must mint: ' + JSON.stringify(minted));

    // Digest computed over the EXACT argv this test will later present at
    // consumption time (mirrors GRANT_WRAPPER's own canonical_argv_digest
    // formula byte-for-byte: rc.sha256String(rc.canonicalJSONStringify(rest))
    // over every token after the subcommand, excluding the grant flag pair).
    const claimArgv = ['--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref, '--role', 'arch-testing'];
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(claimArgv));
    const grant = rll.mintRoleCommandGrant(
      ctx.projDir, minted.binding, 'target', 'claim', argvDigest,
      reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch,
    );
    assert.strictEqual(grant.ok, true, 'fixture: minting a target grant against a still-live (non-terminal) transaction must succeed: ' + JSON.stringify(grant));

    // The transaction becomes terminal AFTER the grant already exists --
    // a legitimate concurrent completion this grant's own holder has not
    // yet observed, never a synthetic same-instant race.
    const cancelled = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref, '--reason', 'explicit']);
    assertCliResult(cancelled, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });

    // Exact replica of roleCommandGrantConsumedMarkerPathFor/localRegistryRepoDir/
    // localComputePrincipalId (runtime-consultation.cjs, all module-private,
    // confirmed by direct read) -- this "local" grant registry lives outside
    // the project tree entirely (os.tmpdir()-rooted, principal-scoped), so it
    // cannot be reached via any rll.registryRepoDir-based helper.
    const repoId = rll.computeRepoId(ctx.projDir);
    const principalId = typeof process.getuid === 'function' ? ('uid-' + process.getuid()) : ('user-' + rc.sha256String(require('os').userInfo().username));
    const consumedMarkerPath = path.join(require('os').tmpdir(), 'android-common-doc-runtime', principalId, repoId, 'role-command-grants', grant.grantId + '.consumed');
    assert.strictEqual(fs.existsSync(consumedMarkerPath), false, 'fixture sanity: the consumed marker must not exist before consumption is even attempted');

    // Bypasses GRANT_WRAPPER deliberately (see this section's own header
    // comment) -- direct spawn of the real CLI with this test's OWN
    // pre-minted, pre-terminal grantId explicit on --target-binding.
    const consumeResult = spawnSync(process.execPath, [IMPL, 'claim'].concat(claimArgv, ['--target-binding', grant.grantId]), {
      encoding: 'utf8',
      env: Object.assign({}, process.env, { NODE_ENV: 'test', RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAPABILITY }),
    });
    const consumeData = parseSingleJsonStdout(consumeResult.stdout);
    // The OVERALL command is correctly rejected regardless (empirically
    // confirmed 2026-08-17: status CANCELLED/detail_code TRANSACTION_CANCELLED)
    // -- cmdClaim's own SEPARATE, application-level revalidateBeforeLink check
    // (runtime-consultation.cjs, immediately before the claim election's final
    // link) already consults cancel.json on its own. That is NOT what this
    // test is about, and asserting it would make this test pass for the wrong
    // reason: it is entirely orthogonal to the M7 role-command-grant AUTHORITY
    // layer, which runs strictly BEFORE cmdClaim's handler and has ALREADY
    // consumed (or not) the grant by the time that later, unrelated check
    // fires. The ONE precise, targeted assertion for this defect is the grant
    // layer's own consumption marker -- never the outer command's status.
    assert.strictEqual(consumeData.ok, false, 'fixture sanity: claim must be rejected somehow once the transaction is cancelled: ' + JSON.stringify(consumeData));
    assert.strictEqual(
      fs.existsSync(consumedMarkerPath), false,
      'M7 defect 4 / checklist item 11 ("cero consumed marker"): the M7 role-command-grant AUTHORITY layer must never consume (write a .consumed marker for) a target-authority grant once its backing transaction has become terminal -- today validateAndConsumeRoleCommandGrantForCommand consumes it unconditionally, strictly BEFORE cmdClaim\'s own separate, application-level cancel.json check ever runs (that later check does correctly reject the overall command, but only AFTER the grant-authority layer has already, wrongly, spent the grant): ' + JSON.stringify(consumeData)
    );
  });
});

// M7-ROOTSOURCE-STALE-GRANT-AFTER-TERMINAL-ZERO-CONSUMED-MARKER moved to
// agent-spawn-execution-gate.test.js (2026-08-17, team-lead guidance): needs
// the real setupRealRootSourceBinding ceremony + rll.publishRootIngress,
// which live/are reachable there, not here.

test('M7-CANCEL-CLAIM-HEARTBEAT-18 (positive control, admission-first race, lease-heartbeat): a cancel.json landing DURING the window between heartbeat admission and the durable lease write must NOT retroactively deny an already-admitted heartbeat -- proves the race harness genuinely reaches heartbeat-after-admission-before-write and, once released, the heartbeat still completes. cancel.json is written DIRECTLY (never through the locked cmdCancel) to avoid contending for the SAME transaction lock the paused heartbeat child already holds at this exact pause point (see this section\'s own header comment for the deadlock this avoids)', async () => {
  const dir = makeTempProject();
  const coordRoot = path.join(dir, '.planning', 'coordination');
  const planPath = planFileFor(dir, 'm7-red18-heartbeatrace-wave');
  const subjectBundlePath = subjectBundleFileFor(dir, []);
  const rendezvousDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm7-red18-heartbeatrace-'));
  try {
    const initResult = runTestCli(['root-init', '--coordination-root', coordRoot]);
    assert.strictEqual(initResult.status, 0, 'fixture root-init must succeed: ' + initResult.stdout + initResult.stderr);

    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'M7-RED-18 admission-first heartbeat-vs-direct-cancel-write fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', coordRoot, '--plan', planPath,
      '--subject-bundle', subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const reqObj = JSON.parse(fs.readFileSync(publishedData.artifact_ref, 'utf8'));
    const txnDir = path.dirname(publishedData.artifact_ref);

    const dispatched = runTestCli(['dispatch', '--coordination-root', coordRoot, '--request', publishedData.artifact_ref]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    const claimed = runTestCli(['claim', '--coordination-root', coordRoot, '--request', publishedData.artifact_ref, '--role', 'arch-testing']);
    const claimedData = assertCliResult(claimed, { command: 'claim', status: 'SUCCESS', detail_code: 'NONE' });

    const result = await m7DriveCliRendezvousRace(
      ['lease-heartbeat', '--coordination-root', coordRoot, '--request', publishedData.artifact_ref, '--claim', claimedData.artifact_ref],
      'heartbeat-after-admission-before-write',
      rendezvousDir,
      async () => {
        const rc = require(IMPL);
        const cancelObj = {
          schema: 'coordination/cancel/v1',
          request_id: reqObj.request_id,
          reason: 'explicit',
          cancelled_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          cancelled_by: reqObj.requester_instance_id,
        };
        rc.publishNoClobber(rc.cancelPathFor(txnDir), Buffer.from(rc.canonicalJSONStringify(cancelObj), 'utf8'), {});
        assert.ok(fs.existsSync(rc.cancelPathFor(txnDir)), 'fixture: the direct cancel.json write must genuinely land on disk');
      },
    );
    assert.strictEqual(result.exitCode, 0, 'the CLI process itself must exit cleanly: ' + JSON.stringify(result));
    const data = parseSingleJsonStdout(result.stdout);
    assert.strictEqual(
      data.status, 'SUCCESS',
      'positive control: a heartbeat already past its own admission checks (inside the held lock) must complete, never be retroactively denied by a cancellation that raced in only after that point: ' + JSON.stringify(data)
    );
  } finally {
    fs.rmSync(rendezvousDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// M7 LIFECYCLE Group C: RED 22 (M7-DUPLICATE-LOCAL-REMOVAL). Contract section
// 11 point 5: toolkit-specialist (consultation) will "delete local retirement
// writers/validators and every superseded caller". Confirmed by direct read
// (scripts/lib/runtime-consultation.cjs ~L6009-6143): this file has a whole
// "logic-identical local copy" family for the Claude one-shot binding surface
// (validateRoleActorBindingForLocal, validateClaudeOneShotBindingForLocal,
// findLiveClaudeOneShotBindingsLocal, retireClaudeOneShotBindingLocal) --
// each doc-commented as a genuine, independent reimplementation, never a
// delegation, because of this file's own circular-import constraint
// (runtime-role-lifecycle.cjs requires THIS file at its own top level, so a
// top-level require of RLL here would be a load cycle). Crucially, a
// DIFFERENT sibling group in this SAME file (validateRequesterBindingForLocal,
// validateRootSourceBindingForLocal, isClaudeId01AttestationWellFormedLocal,
// checkClaudeId01ProofCompleteLocal) has ALREADY been converted to the
// section 11 target shape: each is a THIN delegation -- lazy require('./
// runtime-role-lifecycle.cjs') INSIDE the function body (never at module
// top level, sidestepping the cycle) and a single forwarding call, never
// independent logic. retireClaudeOneShotBindingLocal is the clearest
// remaining un-converted case for this RED: it still performs its own
// publishNoClobber write directly, rather than delegating to
// runtime-role-lifecycle.cjs's own canonical retireClaudeOneShotBinding.
// Structural source-text audit, matching this file's own established
// AUDIT-raw-reads/AUDIT-sha256File precedent for a non-mutation-testable
// architectural property -- extracts the exact function body via its own
// definition through the next top-level `function ` declaration (this file's
// own consistent one-function-per-declaration style), never a full parser.
// ════════════════════════════════════════════════════════════════════════════

test('M7-DUPLICATE-LOCAL-REMOVAL-22 (RED): retireClaudeOneShotBindingLocal (and its former sole caller, cmdCancel\'s retirement-wiring branch) must be genuinely ABSENT from the source, per M7 section 11 point 5\'s own literal instruction to "delete local retirement writers/validators and every superseded caller" -- today it still exists and does its own I/O directly', () => {
  const src = fs.readFileSync(IMPL, 'utf8');
  // Resolved with team-lead: the ORIGINAL framing of this RED (a "thin
  // delegation" matching validateRequesterBindingForLocal/
  // validateRootSourceBindingForLocal's own cited sibling shape) does not
  // hold -- section 11 point 5's own literal text says DELETE, never
  // delegate, and those two siblings were themselves confirmed (direct read,
  // consultation.cjs ~5989-5999) to have been fully REMOVED, not converted
  // to wrappers, with every caller switched to a lazy-required RLL call
  // directly -- the same disposition this RED now asserts for
  // retireClaudeOneShotBindingLocal specifically. Section 11 point 3
  // separately confirms the RLL-side delegation TARGET this RED originally
  // asked for (retireRootSourceBinding) is ALSO already removed/de-exported,
  // so "delegate to it" could never be satisfied even if it were the right
  // ask. A single whole-source substring check (never scoped to a function-
  // body window) is deliberately used here: it proves BOTH the definition
  // AND every call site are gone in one pass -- if anything anywhere still
  // referenced this identifier by name, the string would still appear.
  assert.ok(
    !src.includes('retireClaudeOneShotBindingLocal'),
    'M7 section 11 point 5 (literal): "delete local retirement writers/validators and every superseded caller" -- retireClaudeOneShotBindingLocal must be genuinely absent from the source (definition AND every caller, including cmdCancel\'s own retirement-wiring branch), never merely converted to a delegating wrapper -- today the identifier still appears in the source'
  );
});

// M7 LIFECYCLE Group C guard 29 (M7-CODEX-COPILOT-PORTABILITY). Contract
// section 12: "retained Codex HostBridge/disk-floor behavior is unchanged;
// Copilot prompts/scripts remain portable". The Copilot-portability half is
// a project/documentation-level property (portable prompts/scripts across
// providers), not something a runtime JS assertion can meaningfully check --
// not attempted here, narrowed the same way guard 26 narrowed section 1's
// own untestable design-principle phrases. The HostBridge half IS concretely
// checkable: this file's own createHostBridgeCapability/hostBridgeClaim
// (retained Codex supervisor authority, structurally disjoint from the
// Claude-hook-provider-scoped requester/root-source/one-shot families M7
// touches) must never reference the M7 fence/classifier mechanism -- same
// structural-isolation discipline as guard 27's RoleActorBinding check,
// applied to the retained-supervisor surface instead.
test('M7-CODEX-COPILOT-PORTABILITY-GUARD-29 (guard, preserve): createHostBridgeCapability never references the M7 Claude-actor-fence mechanism -- M7 section 12 is explicit that retained Codex HostBridge/disk-floor behavior is unchanged; this guard locks that structural isolation against silent regression (the Copilot-portability half of section 12 is a project-level property, not something checkable via a runtime assertion, and is not attempted here)', () => {
  const src = fs.readFileSync(IMPL, 'utf8');
  const defIdx = src.indexOf('function createHostBridgeCapability(');
  assert.notStrictEqual(defIdx, -1, 'fixture sanity: createHostBridgeCapability must still be found as a named function in the source');
  const window = src.slice(defIdx, defIdx + 2000);
  const nextFunctionOffset = window.indexOf('\nfunction ', 'function createHostBridgeCapability('.length);
  const body = nextFunctionOffset === -1 ? window : window.slice(0, nextFunctionOffset);
  assert.ok(!body.includes('authority-identity-fence'), 'M7 section 12 (existing behavior, guarded against regression): createHostBridgeCapability must never reference the M7 fence mechanism -- retained Codex HostBridge behavior is explicitly unchanged by M7');
  assert.ok(!body.includes('classifyClaudeAuthorityForIdentity'), 'M7 section 12 (existing behavior, guarded against regression): createHostBridgeCapability must never call the M7 classifier -- retained Codex HostBridge behavior is explicitly unchanged by M7');
});

// ══════════════════════════════════════════════════════════════════════════
// M7 FINAL CORRECTION (test-specialist, batch 2 of 3, R7/R8): cmdClaim's own
// revalidateBeforeLink (runtime-consultation.cjs:8895-8913) and
// cmdLeaseHeartbeat's own terminal-absence check (runtime-consultation.cjs:
// ~9105-9117) both check acceptedResultPathFor(txnDir) + cancelPathFor(txnDir)
// -- confirmed by direct read -- but NEITHER ever checks
// resultPathFor(txnDir, attemptId), the transaction's OWN authoritative
// result (results/<attempt>.json). M7 section 8.5 requires "claim gains the
// SAME final cancel/terminal absence read already applied by publish-result"
// -- publish-result itself correctly never checks resultPathFor (it is the
// one WRITING it), but claim/lease-heartbeat's own doc comments both claim
// parity with that check while only actually replicating its
// accepted-result/cancel half, silently dropping the result half. This gap
// is grant-authority-agnostic (revalidateBeforeLink and the heartbeat check
// run identically regardless of whether the backing grant is RoleActor- or
// ClaudeOneShotBinding-backed, confirmed by direct read of both call sites),
// so these tests use the standard RoleActor-backed grant-wrapper flow, not a
// ClaudeOneShotBinding.
// ══════════════════════════════════════════════════════════════════════════

test('M7-CLAIM-RESULT-TERMINAL-CUT-07 (RED): claim must reject INVALID/AUTHORITY_INVALID once a valid authoritative result/v2 already exists for the current attempt, even with NO accepted-result.json present -- today revalidateBeforeLink only checks acceptedResultPathFor + cancelPathFor, never resultPathFor, so this wrongly succeeds and publishes a real claim.json + active-lease.json', () => {
  withProject('rcc-node-r7-claim-result-cut-wave', (ctx) => {
    // ── Main scenario: a valid authoritative result already exists ──────────
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'R7 claim-result-cut fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const requestPath = publishedData.artifact_ref;
    const requestId = publishedData.request_id;

    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPath]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    const reqObj = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    const requestDigest = sha256Hex(fs.readFileSync(requestPath));
    const attemptId = reqObj.initial_attempt_id;
    const txnDir = path.dirname(requestPath);
    const resultPath = resultPathFor(ctx.planRoot, requestId, attemptId);

    // Raw fixture write (mirrors writeRawResult, bypassing cmdPublishResult --
    // publish-result itself requires an existing --claim, which would defeat
    // the point: this proves claim's OWN gap independent of how the result
    // came to exist). M7 correction round 1 test-side reconciliation
    // (2026-08-18): also overrides every RESULT_MIRRORED_REQUEST_FIELDS
    // field (runtime-consultation.cjs assertResultMirrorsRequest) directly
    // from the real reqObj -- writeRawResult's own defaults use placeholder
    // digests (e.g. subject_scope_digest/routing_policy_digest as repeated
    // hex digits) that can never correlate to a real published request, so
    // C3's now-landed validateResultV2 call inside claim's revalidateBeforeLink
    // correctly rejected this fixture's own prior, incomplete override set as
    // CORRELATION_INVALID (surfacing as DURABILITY_UNPROVEN, not this test's
    // own intended AUTHORITY_INVALID) -- a fixture bug, not a production gap.
    writeRawResult(resultPath, ctx, {
      in_reply_to: requestId,
      root_request_id: reqObj.root_request_id,
      request_digest: requestDigest,
      attempt_id: attemptId,
      lease_epoch: reqObj.initial_lease_epoch,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      to_role: reqObj.source_role,
      plan_digest: reqObj.plan_digest,
      repo_id: reqObj.repo_id,
      wave_slug: reqObj.wave_slug,
      protocol_profile: reqObj.protocol_profile,
      max_depth: reqObj.max_depth,
      subject_repo_id: reqObj.subject_repo_id,
      subject_worktree_id: reqObj.subject_worktree_id,
      subject_head: reqObj.subject_head,
      subject_scope_digest: reqObj.subject_scope_digest,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
    });

    const beforeSnapshot = snapshotDirDigests(txnDir);
    assert.ok(Object.keys(beforeSnapshot).some((p) => p.includes('results/')), 'fixture sanity: the raw result must genuinely be under txnDir/results/ before claim runs');

    const claimResult = runTestCli(['claim', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--role', 'arch-testing']);
    assertCliResult(claimResult, { command: 'claim', status: 'INVALID', detail_code: 'AUTHORITY_INVALID' });

    const afterSnapshot = snapshotDirDigests(txnDir);
    assert.deepStrictEqual(
      afterSnapshot, beforeSnapshot,
      'M7 section 8.5: claim must never publish a new claim/active-lease artifact once a transaction already has an authoritative result -- today it does, because revalidateBeforeLink never checks resultPathFor: ' + JSON.stringify({ before: beforeSnapshot, after: afterSnapshot })
    );

    // ── Positive control: the EXISTING cancel check still works, proving ────
    // this test isolates the missing resultPathFor check specifically rather
    // than accidentally relying on the accepted-result/cancel check that
    // already exists.
    const intentB64Control = base64urlIntent({
      target_role: 'arch-testing',
      question: 'R7 claim-result-cut CONTROL fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const publishedControl = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64Control,
    ]);
    const publishedControlData = assertCliResult(publishedControl, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const requestPathControl = publishedControlData.artifact_ref;
    const dispatchedControl = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPathControl]);
    assertCliResult(dispatchedControl, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    const cancelledControl = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', requestPathControl, '--reason', 'explicit']);
    assertCliResult(cancelledControl, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });

    const claimAfterCancel = runTestCli(['claim', '--coordination-root', ctx.coordRoot, '--request', requestPathControl, '--role', 'arch-testing']);
    assertCliResult(claimAfterCancel, { command: 'claim', status: 'CANCELLED', detail_code: 'TRANSACTION_CANCELLED' });
  });
});

// M7 correction round 1 (2026-08-18, GAP-4A, task #57): mutation #14 (task
// #55) confirmed replacing validateResultV2 with a shape-only check inside
// claim/lease-heartbeat left R7/R8/all 3 C1-BOUNDARY tests green -- every
// existing fixture's result happens to already be well-correlated, so
// nothing distinguishes the full correlation check from a shape-only one.
// This test deliberately corrupts exactly ONE RESULT_MIRRORED_REQUEST_FIELDS
// field (subject_scope_digest) while keeping every other field correctly
// correlated (mirrors R7's own now-fixed writeRawResult override set) --
// isolating the failure to assertResultMirrorsRequest's own correlation
// check specifically, never a coincidentally-also-wrong shape/digest/auth
// field. C3's own CORRELATION_INVALID -> DURABILITY_UNPROVEN remapping
// (cmdClaim's revalidateBeforeLink) means this must NOT be treated as a
// wrongly-accepted terminal (AUTHORITY_INVALID would mean claim believed the
// result WAS valid enough to deny on) and must NOT be treated as absent
// (SUCCESS would mean the correlation check never ran at all).
test('M7-CLAIM-RESULT-CORRELATION-INVALID-09 (GAP-4A): claim must reject INVALID/DURABILITY_UNPROVEN (never AUTHORITY_INVALID, never SUCCESS) when a shape-valid results/<attemptId>.json exists but does NOT correlate to its own request (wrong subject_scope_digest) -- proves assertResultMirrorsRequest own correlation check genuinely runs and is genuinely load-bearing, not merely shape-checked', () => {
  withProject('rcc-node-gap4a-correlation-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'GAP-4A correlation-invalid fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const requestPath = publishedData.artifact_ref;
    const requestId = publishedData.request_id;

    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPath]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    const reqObj = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    const requestDigest = sha256Hex(fs.readFileSync(requestPath));
    const attemptId = reqObj.initial_attempt_id;
    const txnDir = path.dirname(requestPath);
    const resultPath = resultPathFor(ctx.planRoot, requestId, attemptId);

    assert.notStrictEqual(
      reqObj.subject_scope_digest, 'f'.repeat(64),
      'fixture sanity: the deliberately-wrong digest below must genuinely differ from the real one'
    );
    writeRawResult(resultPath, ctx, {
      in_reply_to: requestId,
      root_request_id: reqObj.root_request_id,
      request_digest: requestDigest,
      attempt_id: attemptId,
      lease_epoch: reqObj.initial_lease_epoch,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      to_role: reqObj.source_role,
      plan_digest: reqObj.plan_digest,
      repo_id: reqObj.repo_id,
      wave_slug: reqObj.wave_slug,
      protocol_profile: reqObj.protocol_profile,
      max_depth: reqObj.max_depth,
      subject_repo_id: reqObj.subject_repo_id,
      subject_worktree_id: reqObj.subject_worktree_id,
      subject_head: reqObj.subject_head,
      subject_scope_digest: 'f'.repeat(64), // deliberately WRONG -- never reqObj's own value.
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
    });

    const beforeSnapshot = snapshotDirDigests(txnDir);
    assert.ok(Object.keys(beforeSnapshot).some((p) => p.includes('results/')), 'fixture sanity: the raw result must genuinely be under txnDir/results/ before claim runs');

    const claimResult = runTestCli(['claim', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--role', 'arch-testing']);
    assertCliResult(claimResult, { command: 'claim', status: 'INVALID', detail_code: 'DURABILITY_UNPROVEN' });

    const afterSnapshot = snapshotDirDigests(txnDir);
    assert.deepStrictEqual(
      afterSnapshot, beforeSnapshot,
      'GAP-4A: claim must never publish a new claim/active-lease artifact when the existing result fails correlation: ' + JSON.stringify({ before: beforeSnapshot, after: afterSnapshot })
    );
  });
});

// M7 correction round 1 (2026-08-18, GAP-4B, task #57): investigated first
// per the dispatch -- no existing test in this codebase exercises
// classifyDurableRead's own DURABLE_PENDING (nlink===2n) state THROUGH
// claim/lease-heartbeat's own resultPathFor call site specifically.
// RCR-durable-2/RCR-blob-3 (runtime-consultation-roots.bats) exercise the
// IDENTICAL nlink==2 mechanism but only via the standalone `validate --kind`
// entry points, never claim; the reconcileOneNoClobberTemp tests (this file,
// ~line 1665) test a DIFFERENT mechanism (temp-file crash reconciliation
// during publish, not a reader observing an existing file). Confirmed
// directly (runtime-consultation.cjs classifyDurableRead, ~line 1978) that
// nlink===2n is a PURE fstat check with no timing/transience requirement --
// RCR-durable-2's own construction (a single, permanent `ln`, no rendezvous/
// pause) is proven sufficient and is reused here rather than inventing a
// live in-flight-write race this codebase has no other precedent for at
// this specific call site.
test('M7-CLAIM-RESULT-PENDING-NLINK2-10 (GAP-4B): claim must reject INVALID/DURABILITY_UNPROVEN (never AUTHORITY_INVALID, never SUCCESS, never a timeout) when results/<attemptId>.json is a genuine, otherwise-fully-correlating record but its own nlink is 2 (the recognized in-flight window) -- proves classifyDurableRead is genuinely consulted at claim own resultPathFor read, not merely a shape/correlation check on an implicitly-assumed nlink===1 file', () => {
  withProject('rcc-node-gap4b-pending-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'GAP-4B pending-nlink2 fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const requestPath = publishedData.artifact_ref;
    const requestId = publishedData.request_id;

    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPath]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    const reqObj = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    const requestDigest = sha256Hex(fs.readFileSync(requestPath));
    const attemptId = reqObj.initial_attempt_id;
    const txnDir = path.dirname(requestPath);
    const resultPath = resultPathFor(ctx.planRoot, requestId, attemptId);

    // Fully correlating (mirrors R7's own fixed override set exactly) --
    // isolates this test to the nlink state specifically, never a
    // coincidental correlation failure.
    writeRawResult(resultPath, ctx, {
      in_reply_to: requestId,
      root_request_id: reqObj.root_request_id,
      request_digest: requestDigest,
      attempt_id: attemptId,
      lease_epoch: reqObj.initial_lease_epoch,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      to_role: reqObj.source_role,
      plan_digest: reqObj.plan_digest,
      repo_id: reqObj.repo_id,
      wave_slug: reqObj.wave_slug,
      protocol_profile: reqObj.protocol_profile,
      max_depth: reqObj.max_depth,
      subject_repo_id: reqObj.subject_repo_id,
      subject_worktree_id: reqObj.subject_worktree_id,
      subject_head: reqObj.subject_head,
      subject_scope_digest: reqObj.subject_scope_digest,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
    });
    assert.strictEqual(fs.statSync(resultPath).nlink, 1, 'fixture sanity: the result must start at the ordinary nlink==1 before the extra hard link below');
    const extraLinkPath = resultPath + '.gap4b-extra-hardlink';
    fs.linkSync(resultPath, extraLinkPath);
    assert.strictEqual(fs.statSync(resultPath).nlink, 2, 'fixture sanity: the extra hard link must genuinely bring nlink to 2 before claim runs');

    const beforeSnapshot = snapshotDirDigests(txnDir);

    const claimResult = runTestCli(['claim', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--role', 'arch-testing']);
    assertCliResult(claimResult, { command: 'claim', status: 'INVALID', detail_code: 'DURABILITY_UNPROVEN' });

    // Snapshotted BEFORE removing the extra hard link (mirrors beforeSnapshot
    // exactly, still including it) -- the link's own removal is fixture
    // cleanup, never itself part of what this comparison is proving.
    const afterSnapshot = snapshotDirDigests(txnDir);
    fs.unlinkSync(extraLinkPath);
    assert.deepStrictEqual(
      afterSnapshot, beforeSnapshot,
      'GAP-4B: claim must never publish a new claim/active-lease artifact while the existing result is in the nlink==2 in-flight window: ' + JSON.stringify({ before: beforeSnapshot, after: afterSnapshot })
    );
  });
});

test('M7-R5-ACTIVATION-PENDING-NLINK2 (RED): resolveActivationForRequestPath must return {ok:false} when the durable activation record for the resolved attempt is in the nlink==2 in-flight window -- never silently folded into {ok:true, activation:null} (genuine absence), which a caller would read as safe to fall back to RoleActorBinding', () => {
  withProject('rcc-node-r5-activation-pending-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'R5 activation-pending-nlink2 fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const requestPath = publishedData.artifact_ref;

    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPath]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    const reqObj = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    const attemptId = reqObj.initial_attempt_id;
    const txnDir = path.dirname(requestPath);
    const activationPath = path.join(txnDir, 'activations', attemptId + '.json');
    const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const activation = {
      schema: 'coordination/activation/v1',
      version: 1,
      request_id: reqObj.request_id,
      request_digest: sha256Hex(fs.readFileSync(requestPath)),
      attempt_id: attemptId,
      lease_epoch: reqObj.initial_lease_epoch,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
      selected_driver: 'noop',
      native_target_binding_id: null,
      native_spawn_action_id: null,
      created_at: nowIso,
      activation_liveness_expiry: new Date(Date.now() + 1800000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    fs.mkdirSync(path.dirname(activationPath), { recursive: true });
    fs.writeFileSync(activationPath, JSON.stringify(activation), { mode: 0o600 });
    fs.chmodSync(activationPath, 0o600);
    assert.strictEqual(fs.statSync(activationPath).nlink, 1, 'fixture sanity: the activation must start at the ordinary nlink==1 before the extra hard link below');
    const extraLinkPath = activationPath + '.r5-extra-hardlink';
    fs.linkSync(activationPath, extraLinkPath);
    assert.strictEqual(fs.statSync(activationPath).nlink, 2, 'fixture sanity: the extra hard link must genuinely bring nlink to 2 before resolveActivationForRequestPath runs');

    let result;
    try {
      result = rc.resolveActivationForRequestPath(requestPath);
    } finally {
      fs.unlinkSync(extraLinkPath);
    }
    assert.strictEqual(result.ok, false, 'M7 R5: a durably in-flight (nlink==2) activation must resolve ok:false, never {ok:true, activation:null} (which a caller reads as genuine absence): ' + JSON.stringify(result));
  });
});

test('M7-HEARTBEAT-RESULT-TERMINAL-CUT-08 (RED): lease-heartbeat must reject INVALID/AUTHORITY_INVALID once a valid authoritative result/v2 already exists for the current attempt, even with NO accepted-result.json present -- today its own terminal-absence check only reads acceptedResultPathFor + cancelPathFor, never resultPathFor, so this wrongly succeeds and mutates the active-lease', () => {
  withProject('rcc-node-r8-heartbeat-result-cut-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'R8 heartbeat-result-cut fixture question',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoInFuture(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const requestPath = publishedData.artifact_ref;

    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPath]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

    // A real, successful claim (no result exists yet -- this is the ordinary,
    // unaffected path) so a genuine claim.json + active-lease.json exist to
    // heartbeat against.
    const claimResult = runTestCli(['claim', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--role', 'arch-testing']);
    const claimData = assertCliResult(claimResult, { command: 'claim', status: 'SUCCESS', detail_code: 'NONE' });
    const claimPath = claimData.artifact_ref;

    // A real, successful publish-result (BLOCKED, so the fixture never needs
    // an accept-result round trip at all) -- this is the genuine "window
    // between publish-result and accept-result/transaction-ack"
    // readRootSourceTerminalArtifacts itself documents as ordinary, not an
    // error state.
    const publishResultResult = runTestCli([
      'publish-result', '--coordination-root', ctx.coordRoot, '--request', requestPath,
      '--claim', claimPath, '--blocked-reason', 'CONSULTATION_FAILED',
    ]);
    assertCliResult(publishResultResult, { command: 'publish-result', status: 'SUCCESS', detail_code: 'NONE' });

    const txnDir = path.dirname(requestPath);
    const beforeSnapshot = snapshotDirDigests(txnDir);
    assert.ok(Object.keys(beforeSnapshot).some((p) => p.includes('results/')), 'fixture sanity: publish-result must genuinely have written under txnDir/results/');

    const heartbeatResult = runTestCli(['lease-heartbeat', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--claim', claimPath]);
    assertCliResult(heartbeatResult, { command: 'lease-heartbeat', status: 'INVALID', detail_code: 'AUTHORITY_INVALID' });

    const afterSnapshot = snapshotDirDigests(txnDir);
    assert.deepStrictEqual(
      afterSnapshot, beforeSnapshot,
      'M7 section 8.5: lease-heartbeat must never mutate the active-lease (or anything else under the transaction) once a transaction already has an authoritative result -- today it does, because its own terminal-absence check never calls resultPathFor: ' + JSON.stringify({ before: beforeSnapshot, after: afterSnapshot })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LIVE-STALE-INBOX-01 (mission M6-M7-LIVE-M2-M3-RESUME-20260820, Codex-diagnosed
// defect relayed via team-lead/arch-testing): hostBridgeListInbox
// (runtime-consultation.cjs ~L8170-8242) throws INVALID/CORRELATION_INVALID
// unconditionally whenever resolveActivationForRequestPath (~L11150-11256)
// returns {ok:false} for a role inbox entry -- including the case where the
// underlying request/activation have simply EXPIRED (a benign condition;
// resolveActivationForRequestPath never consults the request's own `expiry`
// field at all, only the activation's own activation_liveness_expiry).
// Reproduced live in production 2026-08-20: request
// e1a1f93211794b9f198dfc9fe9bbe313 (request.expiry 2026-08-20T11:16:10Z, its
// activation's activation_liveness_expiry 2026-08-20T11:15:10Z, activation
// expiry preceding request expiry, both already past) sitting in
// context-provider's inbox aborted the entire retained-supervisor poll loop
// with APP_SERVER_POLL_FAILED:role inbox request activation is not resolvable.
//
// DETERMINISTIC PAST TIMESTAMPS, NO REAL-WALL-CLOCK RACE: publishing/dispatching
// via --fixed-ids/--fixed-clock anchors request.json's created_at/expiry to the
// frozen base (2025-01-01T00:00:00.000Z) -- real bytes on disk, not a live
// process's in-memory state. This test's own calls into hostBridgeListInbox/
// resolveActivationForRequestPath are made IN-PROCESS (never through the CLI's
// own main()), so currentClockMs() inside THIS process is always real
// Date.now() -- confirmed by direct read: FIXED_CLOCK_ACTIVE is a
// module-private variable set ONLY inside main(), after parseFlags, never
// reachable from a require()'d module instance. A 2025-anchored request
// compared against a real 2026+ Date.now() is therefore unconditionally,
// deterministically "in the past" -- no fixed-clock plumbing needed (or
// possible) for the in-process read side.
//
// EXACTLY-CORRELATED ACTIVATION: the hand-crafted activation.json (same
// direct-overwrite-after-a-real-dispatch technique as this file's own existing
// M7-R5-ACTIVATION-PENDING-NLINK2 fixture, ~L4597) sets activation_liveness_expiry
// via rc.activationLivenessDeadline(reqObj) -- the exact production formula
// resolveActivationForRequestPath itself compares against, exported under the
// test capability specifically so a fixture never hand-maintains a second,
// driftable copy (see its own export doc comment, runtime-consultation.cjs
// ~L12264-12271). Genuinely correlated, not merely shape-valid.
//
// HOSTBRIDGECAPABILITY VIA THE EXISTING BRIDGE-STUB PRECEDENT, NOT A NEW MOCK:
// createHostBridgeCapability's own liveness proof (validateHostBridgeCapabilityScopeInput
// -> bridge.resolveLiveCodexAppServerWorker) is stubbed on the shared,
// require()-cached runtime-bridge-codex.cjs module object -- the SAME
// technique this file's own existing "dispatchCanonical:
// options.requiredDriver=codex-app-server..." test (~L1086-1103) already uses
// to prove codex-app-server liveness without a real Codex process/registry.
// This is NOT one of the four functions this mission's dispatch names as
// must-not-mock (hostBridgeListInbox, resolveActivationForRequestPath,
// accreditCanonicalRequest, requireHostBridgeCapability) -- every one of those
// four runs as its real, unmodified production implementation on every call
// below; only the EXTERNAL PID-liveness-detection primitive is stubbed,
// exactly as this codebase's own suite already does for the identical purpose
// elsewhere in this same file.
//
// RED/GREEN SEMANTICS (arch-testing relay, mission M6-M7-LIVE-M2-M3-RESUME-20260820):
// the main test below asserts the DESIRED (post-fix, GREEN) behavior directly
// -- hostBridgeListInbox returns [] and mutates nothing. Run against current,
// unmodified production code, it instead throws; the catch block below
// verifies that thrown error is EXACTLY the diagnosed defect (status/detailCode/
// message) before calling assert.fail() with a fully-diagnostic message --
// this is the genuine semantic RED (never a bare/uncaught crash, syntax error,
// or timeout mistaken for one). Once the production fix lands, the throw stops,
// the catch branch is never entered, and the GREEN assertions below run and
// pass with zero test-code changes needed.
// ════════════════════════════════════════════════════════════════════════════

function isoAtOffsetMs(ms) {
  return new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function hostBridgeCapabilityScope(ctx, role) {
  return {
    actorInstanceId: crypto.randomBytes(16).toString('hex'),
    expiresAt: isoAtOffsetMs(600000),
    planDigest: ctx.planDigest,
    projectRoot: ctx.projDir,
    role,
    supervisorInstanceId: crypto.randomBytes(16).toString('hex'),
    workerSessionId: crypto.randomBytes(16).toString('hex'),
    worktreeId: ctx.worktreeId,
  };
}

/**
 * Stubs bridge.resolveLiveCodexAppServerWorker on the shared require()-cached
 * module object (mirrors this file's own existing "dispatchCanonical:
 * options.requiredDriver=codex-app-server..." test, ~L1086-1103), mints a
 * genuine HostBridgeCapability via the REAL, unmodified
 * rc.createHostBridgeCapability, then calls fn(capability, scope). The stub
 * stays installed for fn's entire duration -- hostBridgeListInbox itself calls
 * requireHostBridgeCapability again internally, which re-derives the SAME
 * live-worker proof, so the stub must still be active then, not just at the
 * initial mint.
 */
function withHostBridgeCapability(ctx, role, fn) {
  const scope = hostBridgeCapabilityScope(ctx, role);
  const bridge = require(path.resolve(__dirname, '../lib/runtime-bridge-codex.cjs'));
  const originalResolveLive = bridge.resolveLiveCodexAppServerWorker;
  bridge.resolveLiveCodexAppServerWorker = function fakeLiveCodexAppServerWorkerForHostBridgeFixture() {
    return {
      ok: true,
      available: true,
      worker: {
        pid: process.pid,
        worktreeId: scope.worktreeId,
        planDigest: scope.planDigest,
        role: scope.role,
        supervisorInstanceId: scope.supervisorInstanceId,
        workerSessionId: scope.workerSessionId,
      },
    };
  };
  try {
    const capResult = rc.createHostBridgeCapability(scope);
    assert.strictEqual(capResult.ok, true, 'fixture: createHostBridgeCapability must succeed against the stubbed live-worker proof: ' + JSON.stringify(capResult));
    return fn(capResult.capability, scope);
  } finally {
    bridge.resolveLiveCodexAppServerWorker = originalResolveLive;
  }
}

/**
 * Publishes+dispatches a real request via --fixed-ids/--fixed-clock so
 * request.json's created_at/expiry are anchored to the frozen 2025-01-01 base
 * -- unambiguously, deterministically in the past relative to this test's own
 * real-clock in-process reads (see this section's own header comment).
 */
function publishAndDispatchFixedClockRequest(ctx, role, questionSuffix) {
  const intentB64 = base64urlIntent({
    target_role: role,
    question: 'LIVE-STALE-INBOX-01 fixture: ' + questionSuffix,
    expected_result_kind: 'TEST_RESULT',
    expiry: new Date(Date.parse('2025-01-01T00:00:00.000Z') + 1800000).toISOString(),
  });
  const published = runTestCli([
    'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
    '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64, '--fixed-ids', '--fixed-clock',
  ]);
  const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
  const requestPath = publishedData.artifact_ref;

  const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--fixed-ids', '--fixed-clock']);
  assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

  const reqObj = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  assert.ok(Date.parse(reqObj.expiry) < Date.now(), 'fixture sanity: the fixed-clock-anchored request.expiry must genuinely be in the real past');
  return { requestPath, requestId: reqObj.request_id, reqObj, txnDir: path.dirname(requestPath), attemptId: reqObj.initial_attempt_id };
}

/**
 * Overwrites the real, dispatch-produced activation.json with a hand-crafted
 * codex-app-server record -- mirrors this file's own existing
 * M7-R5-ACTIVATION-PENDING-NLINK2 fixture technique (~L4636-4638) exactly.
 * Defaults to an exactly-correlated, already-expired record via
 * rc.activationLivenessDeadline(reqObj); callers needing a DIFFERENT
 * (deliberately decorrelated) shape pass overrides.
 */
function overwriteActivationForHostBridge(txnDir, requestPath, attemptId, reqObj, overrides) {
  const activationPath = path.join(txnDir, 'activations', attemptId + '.json');
  const defaults = {
    schema: 'coordination/activation/v1',
    version: 1,
    request_id: reqObj.request_id,
    request_digest: sha256Hex(fs.readFileSync(requestPath)),
    attempt_id: attemptId,
    lease_epoch: reqObj.initial_lease_epoch,
    target_role_profile_digest: reqObj.target_role_profile_digest,
    routing_policy_version: reqObj.routing_policy_version,
    routing_policy_digest: reqObj.routing_policy_digest,
    selected_driver: 'codex-app-server',
    native_target_binding_id: null,
    native_spawn_action_id: null,
    created_at: reqObj.created_at,
    activation_liveness_expiry: rc.activationLivenessDeadline(reqObj),
  };
  const activation = Object.assign({}, defaults, overrides);
  fs.mkdirSync(path.dirname(activationPath), { recursive: true });
  fs.writeFileSync(activationPath, JSON.stringify(activation), { mode: 0o600 });
  fs.chmodSync(activationPath, 0o600);
  return activation;
}

/** Asserts fn() throws a CliError-shaped error with exactly the given status/detailCode/message -- never a generic crash/timeout/non-Error thrown value. */
function assertThrowsCliError(fn, expected, msgPrefix) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error, msgPrefix + ': must throw a real Error, not return successfully or throw a non-Error value: ' + JSON.stringify(thrown));
  assert.strictEqual(thrown.status, expected.status, msgPrefix + ': status mismatch -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
  assert.strictEqual(thrown.detailCode, expected.detailCode, msgPrefix + ': detailCode mismatch -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
  assert.strictEqual(thrown.message, expected.message, msgPrefix + ': message mismatch (a different message means the fixture hit a different code path than intended, never accept this as confirmation of the target defect) -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
  return thrown;
}

test('LIVE-STALE-INBOX-01: hostBridgeListInbox on a role inbox entry whose request+activation have simply EXPIRED must return an empty list, never hard-fail -- RED today (confirms the exact diagnosed defect, production incident 2026-08-20: request e1a1f93211794b9f198dfc9fe9bbe313, request.expiry 2026-08-20T11:16:10Z, activation_liveness_expiry 2026-08-20T11:15:10Z, both already past, aborted the whole retained-supervisor poll with APP_SERVER_POLL_FAILED)', () => {
  withProject('live-stale-inbox-01-wave', (ctx) => {
    const role = 'arch-testing';
    const { requestPath, txnDir, attemptId, reqObj } = publishAndDispatchFixedClockRequest(ctx, role, 'main-expired-inbox-entry');
    overwriteActivationForHostBridge(txnDir, requestPath, attemptId, reqObj);

    const inboxPath = path.join(ctx.planRoot, 'inbox', role, reqObj.request_id + '.json');
    assert.ok(fs.existsSync(inboxPath), 'fixture sanity: dispatch must have durably published the inbox-ref entry before hostBridgeListInbox is ever called: ' + inboxPath);
    const requestBytesBefore = fs.readFileSync(requestPath);
    const inboxBytesBefore = fs.readFileSync(inboxPath);

    withHostBridgeCapability(ctx, role, (capability) => {
      let result;
      let thrown = null;
      try {
        result = rc.hostBridgeListInbox(capability, ctx.coordRoot);
      } catch (err) {
        thrown = err;
      }

      if (thrown !== null) {
        // Confirms this is EXACTLY the diagnosed defect (LIVE-STALE-INBOX-01),
        // never an unrelated fixture/setup crash, syntax error, or timeout --
        // no generic-crash-as-RED.
        assert.ok(thrown instanceof Error, 'must throw a real Error, never a non-Error thrown value: ' + JSON.stringify(thrown));
        assert.strictEqual(thrown.status, 'INVALID', 'LIVE-STALE-INBOX-01 semantic RED: expected status INVALID -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
        assert.strictEqual(thrown.detailCode, 'CORRELATION_INVALID', 'LIVE-STALE-INBOX-01 semantic RED: expected detailCode CORRELATION_INVALID -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
        assert.strictEqual(thrown.message, 'role inbox request activation is not resolvable', 'LIVE-STALE-INBOX-01 semantic RED: expected the exact diagnosed defect message -- a different message means this fixture hit an unrelated code path, never accept that as confirmation: got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
        assert.fail(
          'LIVE-STALE-INBOX-01 CONFIRMED RED against current, unmodified production code: hostBridgeListInbox throws INVALID/CORRELATION_INVALID '
          + '("role inbox request activation is not resolvable") for a role inbox entry whose request+activation have simply EXPIRED, aborting the '
          + 'whole poll, instead of treating the benign expiry as a skip and returning an empty list. This assert.fail is EXPECTED and INTENTIONAL '
          + 'until the production fix lands in scripts/lib/runtime-consultation.cjs -- once fixed, hostBridgeListInbox will return [] instead of '
          + 'throwing, this branch will no longer execute, and the assertions below will verify the fixed (GREEN) behavior instead.'
        );
      }

      assert.deepStrictEqual(result, [], 'GREEN criterion (once the production fix lands): hostBridgeListInbox must skip a benign expired request/activation and return an empty list, never surface it as a CORRELATION_INVALID error');
      assert.deepStrictEqual(fs.readFileSync(requestPath), requestBytesBefore, 'GREEN criterion: hostBridgeListInbox must never mutate request.json');
      assert.deepStrictEqual(fs.readFileSync(inboxPath), inboxBytesBefore, 'GREEN criterion: hostBridgeListInbox must never mutate the inbox-ref');
    });
  });
});

test('LIVE-STALE-INBOX-01 negative control A (already passes today): a STILL-LIVE canonical request (real, non-fixed-clock, genuinely-future expiry) whose activation is independently unresolvable must still throw the SAME fail-closed CORRELATION_INVALID -- proves the eventual expired-request fix cannot come at the cost of this existing behavior for a request that has NOT itself expired', () => {
  withProject('live-stale-inbox-01-stilllive-wave', (ctx) => {
    const role = 'arch-testing';
    const intentB64 = base64urlIntent({
      target_role: role,
      question: 'LIVE-STALE-INBOX-01 negative control A: still-live request',
      expected_result_kind: 'TEST_RESULT',
      expiry: isoAtOffsetMs(1800000),
    });
    const published = runTestCli([
      'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
      '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
    ]);
    const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
    const requestPath = publishedData.artifact_ref;
    const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPath]);
    assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });
    const reqObj = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    assert.ok(Date.parse(reqObj.expiry) > Date.now(), 'fixture sanity: this request must genuinely still be live (real future expiry)');
    const txnDir = path.dirname(requestPath);

    overwriteActivationForHostBridge(txnDir, requestPath, reqObj.initial_attempt_id, reqObj, {
      created_at: isoAtOffsetMs(-600000),
      activation_liveness_expiry: isoAtOffsetMs(-300000),
    });

    withHostBridgeCapability(ctx, role, (capability) => {
      assertThrowsCliError(
        () => rc.hostBridgeListInbox(capability, ctx.coordRoot),
        { status: 'INVALID', detailCode: 'CORRELATION_INVALID', message: 'role inbox request activation is not resolvable' },
        'LIVE-STALE-INBOX-01 negative control A',
      );
    });
  });
});

test('LIVE-STALE-INBOX-01 negative control B (already passes today): an inbox-ref whose own request_digest does not match the referenced request.json bytes must still throw the SAME fail-closed CORRELATION_INVALID -- proves a wrong-digest stale input can never become a benign skip', () => {
  withProject('live-stale-inbox-01-digest-mismatch-wave', (ctx) => {
    const role = 'arch-testing';
    const { reqObj } = publishAndDispatchFixedClockRequest(ctx, role, 'negative-control-B-digest-mismatch');
    const inboxPath = path.join(ctx.planRoot, 'inbox', role, reqObj.request_id + '.json');
    const inboxObj = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
    assert.notStrictEqual(inboxObj.request_digest, '0'.repeat(64), 'fixture sanity: the tampered digest below must genuinely differ from the real one');
    inboxObj.request_digest = '0'.repeat(64);
    fs.writeFileSync(inboxPath, JSON.stringify(inboxObj));

    withHostBridgeCapability(ctx, role, (capability) => {
      assertThrowsCliError(
        () => rc.hostBridgeListInbox(capability, ctx.coordRoot),
        { status: 'INVALID', detailCode: 'CORRELATION_INVALID', message: 'inbox-ref request_digest does not match request.json bytes' },
        'LIVE-STALE-INBOX-01 negative control B',
      );
    });
  });
});

test('LIVE-STALE-INBOX-01 negative control C (already passes today): an inbox-ref whose own target_role does not match its correlated request\'s target_role must still throw the SAME fail-closed CORRELATION_INVALID -- proves a wrong-role stale input can never become a benign skip', () => {
  withProject('live-stale-inbox-01-wrong-role-wave', (ctx) => {
    const role = 'arch-testing';
    const { reqObj } = publishAndDispatchFixedClockRequest(ctx, role, 'negative-control-C-wrong-role');
    const inboxPath = path.join(ctx.planRoot, 'inbox', role, reqObj.request_id + '.json');
    const inboxObj = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
    assert.strictEqual(inboxObj.target_role, role, 'fixture sanity: the inbox-ref must genuinely start out correctly correlated');
    inboxObj.target_role = 'arch-platform';
    fs.writeFileSync(inboxPath, JSON.stringify(inboxObj));

    withHostBridgeCapability(ctx, role, (capability) => {
      assertThrowsCliError(
        () => rc.hostBridgeListInbox(capability, ctx.coordRoot),
        { status: 'INVALID', detailCode: 'CORRELATION_INVALID', message: 'inbox-ref target_role does not match request.target_role' },
        'LIVE-STALE-INBOX-01 negative control C',
      );
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LIVE-TERMINAL-INBOX-01 (mission M6-M7-LIVE-M2-M3-RESUME-20260820, second
// Codex-diagnosed defect in the same function, found live during this
// mission's own Matrix 2 run): the LIVE-STALE-INBOX-01 fix correctly skips a
// request whose own `expiry` has passed, but a genuinely COMPLETED
// transaction (result/accepted-result/ack all durably published) keeps its
// *request* canonically live for its full request_expiry window (up to
// 3600s) while its *activation*'s own, much shorter,
// activation_liveness_expiry naturally passes once the work is done -- so
// resolveActivationForRequestPath (~L11150+) correctly returns {ok:false}
// for it, and hostBridgeListInbox still throws INVALID/CORRELATION_INVALID
// unconditionally. Reproduced live in production 2026-08-20: the real Matrix
// 2 transaction 3c8589dd163315d8bc5e0d54dd858b8e (result/accepted-result/ack
// all published 18:16:39Z) remained request-live until 18:58:58Z, but its
// activation_liveness_expiry (18:21:02Z) passed shortly after completion --
// the retained supervisor's next poll aborted with the exact same
// APP_SERVER_POLL_FAILED:role inbox request activation is not resolvable
// signal as the first defect.
//
// FIX SHAPE (Codex's own diagnosis): move the function's existing canonical
// cancel/accepted-result/authoritative-result terminal checks (previously
// after requireHostBridgeRequestScope, i.e. gated behind a successful
// activation resolution) to run BEFORE resolveActivationForRequestPath, using
// the same durable readers/shapes, deriving txnDir/authoritative-attempt from
// the request already accredited by the LIVE-STALE-INBOX-01 fix. A
// still-live, NON-terminal request's resolveActivationForRequestPath call and
// fail-closed behavior stay byte-for-byte unchanged.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Publishes a real, still-live request and drives it through a genuine
 * claim -> publish-result (ANSWERED) -> accept-result -> transaction-ack
 * round trip (all real CLI calls, mirroring this file's own existing
 * M7-HEARTBEAT-RESULT-TERMINAL-CUT-08 claim/publish-result technique, ~L4675,
 * extended through accept-result/transaction-ack). Then overwrites the
 * activation (same direct-overwrite-after-real-dispatch technique as
 * M7-R5-ACTIVATION-PENDING-NLINK2 and LIVE-STALE-INBOX-01) so its liveness
 * has already expired -- simulating time passing after a real completion,
 * exactly like the real Matrix 2 transaction.
 */
function publishClaimAnswerAcceptAck(ctx, role, questionSuffix) {
  const intentB64 = base64urlIntent({
    target_role: role,
    question: 'LIVE-TERMINAL-INBOX-01 fixture: ' + questionSuffix,
    expected_result_kind: 'TEST_RESULT',
    expiry: isoAtOffsetMs(1800000),
  });
  const published = runTestCli([
    'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
    '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
  ]);
  const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
  const requestPath = publishedData.artifact_ref;

  const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPath]);
  assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });

  const reqObj = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  assert.ok(Date.parse(reqObj.expiry) > Date.now(), 'fixture sanity: this request must genuinely still be live (real future expiry)');
  const txnDir = path.dirname(requestPath);

  const claimResult = runTestCli(['claim', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--role', role]);
  const claimData = assertCliResult(claimResult, { command: 'claim', status: 'SUCCESS', detail_code: 'NONE' });
  const claimPath = claimData.artifact_ref;

  const publishResultResult = runTestCli([
    'publish-result', '--coordination-root', ctx.coordRoot, '--request', requestPath,
    '--claim', claimPath, '--content', 'LIVE-TERMINAL-INBOX-01 fixture answer',
  ]);
  assertCliResult(publishResultResult, { command: 'publish-result', status: 'SUCCESS', detail_code: 'NONE' });

  const acceptResult = runTestCli(['accept-result', '--coordination-root', ctx.coordRoot, '--request', requestPath]);
  assertCliResult(acceptResult, { command: 'accept-result', status: 'SUCCESS', detail_code: 'NONE' });

  const ackResult = runTestCli(['transaction-ack', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--disposition', 'accepted']);
  assertCliResult(ackResult, { command: 'transaction-ack', status: 'SUCCESS', detail_code: 'NONE' });

  assert.ok(fs.existsSync(path.join(txnDir, 'accepted-result.json')), 'fixture sanity: accept-result must have durably published accepted-result.json');
  assert.ok(fs.existsSync(path.join(txnDir, 'ack.json')), 'fixture sanity: transaction-ack must have durably published ack.json');
  const resultFiles = fs.readdirSync(path.join(txnDir, 'results'));
  assert.strictEqual(resultFiles.length, 1, 'fixture sanity: exactly one candidate result file must exist');

  overwriteActivationForHostBridge(txnDir, requestPath, reqObj.initial_attempt_id, reqObj, {
    created_at: isoAtOffsetMs(-600000),
    activation_liveness_expiry: isoAtOffsetMs(-300000),
  });

  return { requestPath, txnDir, reqObj, resultFileName: resultFiles[0] };
}

test('LIVE-TERMINAL-INBOX-01: hostBridgeListInbox on a role inbox entry whose request is still live but whose already-completed transaction activation liveness has since naturally expired must return an empty list, never hard-fail -- RED today (confirms the second diagnosed defect, production incident 2026-08-20: real Matrix 2 transaction 3c8589dd163315d8bc5e0d54dd858b8e completed result/accepted-result/ack at 18:16:39Z, activation_liveness_expiry 18:21:02Z passed shortly after, request_expiry 18:58:58Z had not, aborted the retained-supervisor poll again with the same signal)', () => {
  withProject('live-terminal-inbox-01-wave', (ctx) => {
    const role = 'arch-testing';
    const { requestPath, txnDir, reqObj, resultFileName } = publishClaimAnswerAcceptAck(ctx, role, 'main-completed-then-activation-expired');

    const inboxPath = path.join(ctx.planRoot, 'inbox', role, reqObj.request_id + '.json');
    assert.ok(fs.existsSync(inboxPath), 'fixture sanity: dispatch must have durably published the inbox-ref entry before hostBridgeListInbox is ever called: ' + inboxPath);
    const requestBytesBefore = fs.readFileSync(requestPath);
    const inboxBytesBefore = fs.readFileSync(inboxPath);
    const acceptedResultBytesBefore = fs.readFileSync(path.join(txnDir, 'accepted-result.json'));
    const ackBytesBefore = fs.readFileSync(path.join(txnDir, 'ack.json'));
    const resultBytesBefore = fs.readFileSync(path.join(txnDir, 'results', resultFileName));
    const activationBytesBefore = fs.readFileSync(path.join(txnDir, 'activations', reqObj.initial_attempt_id + '.json'));

    withHostBridgeCapability(ctx, role, (capability) => {
      let result;
      let thrown = null;
      try {
        result = rc.hostBridgeListInbox(capability, ctx.coordRoot);
      } catch (err) {
        thrown = err;
      }

      if (thrown !== null) {
        assert.ok(thrown instanceof Error, 'must throw a real Error, never a non-Error thrown value: ' + JSON.stringify(thrown));
        assert.strictEqual(thrown.status, 'INVALID', 'LIVE-TERMINAL-INBOX-01 semantic RED: expected status INVALID -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
        assert.strictEqual(thrown.detailCode, 'CORRELATION_INVALID', 'LIVE-TERMINAL-INBOX-01 semantic RED: expected detailCode CORRELATION_INVALID -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
        assert.strictEqual(thrown.message, 'role inbox request activation is not resolvable', 'LIVE-TERMINAL-INBOX-01 semantic RED: expected the exact diagnosed defect message -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
        assert.fail(
          'LIVE-TERMINAL-INBOX-01 CONFIRMED RED against current production code: hostBridgeListInbox throws INVALID/CORRELATION_INVALID '
          + '("role inbox request activation is not resolvable") for a role inbox entry whose transaction ALREADY COMPLETED (result+accepted-result+ack all durable and valid) but whose activation liveness later naturally expired, instead of treating the already-terminal transaction as a benign skip. '
          + 'This assert.fail is EXPECTED and INTENTIONAL until the sequence-5 production fix lands -- once fixed, hostBridgeListInbox will return [] instead of throwing, this branch will no longer execute, and the assertions below will verify the fixed (GREEN) behavior instead.'
        );
      }

      assert.deepStrictEqual(result, [], 'GREEN criterion: hostBridgeListInbox must skip an already-terminal transaction whose activation liveness expired, never surface it as CORRELATION_INVALID');
      assert.deepStrictEqual(fs.readFileSync(requestPath), requestBytesBefore, 'GREEN criterion: must never mutate request.json');
      assert.deepStrictEqual(fs.readFileSync(inboxPath), inboxBytesBefore, 'GREEN criterion: must never mutate the inbox-ref');
      assert.deepStrictEqual(fs.readFileSync(path.join(txnDir, 'accepted-result.json')), acceptedResultBytesBefore, 'GREEN criterion: must never mutate accepted-result.json');
      assert.deepStrictEqual(fs.readFileSync(path.join(txnDir, 'ack.json')), ackBytesBefore, 'GREEN criterion: must never mutate ack.json');
      assert.deepStrictEqual(fs.readFileSync(path.join(txnDir, 'results', resultFileName)), resultBytesBefore, 'GREEN criterion: must never mutate the result file');
      assert.deepStrictEqual(fs.readFileSync(path.join(txnDir, 'activations', reqObj.initial_attempt_id + '.json')), activationBytesBefore, 'GREEN criterion: must never mutate the activation record');
    });
  });
});

test('LIVE-TERMINAL-INBOX-01 negative control: a pending (nlink==2, not-yet-durable) accepted-result.json must always fail closed (never a silent skip, never []) -- today (pre-fix) resolveActivationForRequestPath still runs first and reports the SAME activation-unresolvable CORRELATION_INVALID as the main defect; after the fix, the moved terminal check reaches the pending accepted-result FIRST and must report the SAME DURABILITY_UNPROVEN every other pending-artifact caller in this file gets (never silently treated as absent/benign, never shielding the also-expired activation by masquerading as a benign terminal skip)', () => {
  withProject('live-terminal-inbox-01-pending-terminal-wave', (ctx) => {
    const role = 'arch-testing';
    const { txnDir } = publishClaimAnswerAcceptAck(ctx, role, 'negative-control-pending-accepted-result');

    const acceptedResultPath = path.join(txnDir, 'accepted-result.json');
    assert.strictEqual(fs.statSync(acceptedResultPath).nlink, 1, 'fixture sanity: accepted-result.json must start at the ordinary nlink==1 before the extra hard link below');
    const extraLinkPath = acceptedResultPath + '.pending-extra-hardlink';
    fs.linkSync(acceptedResultPath, extraLinkPath);
    assert.strictEqual(fs.statSync(acceptedResultPath).nlink, 2, 'fixture sanity: the extra hard link must genuinely bring nlink to 2 before hostBridgeListInbox runs');

    try {
      withHostBridgeCapability(ctx, role, (capability) => {
        let result;
        let thrown = null;
        try {
          result = rc.hostBridgeListInbox(capability, ctx.coordRoot);
        } catch (err) {
          thrown = err;
        }

        assert.ok(thrown instanceof Error, 'must always throw a real Error for a pending terminal artifact, never return successfully: ' + JSON.stringify({ thrown, result }));

        if (thrown.status === 'INVALID' && thrown.detailCode === 'CORRELATION_INVALID' && thrown.message === 'role inbox request activation is not resolvable') {
          // Pre-fix shape: the moved terminal check does not exist yet, so
          // resolveActivationForRequestPath still runs first and reports the
          // expired activation -- itself a genuine fail-closed error, not a
          // silent skip, so this negative control's own invariant already
          // holds pre-fix. Still flagged via assert.fail so this test is
          // honestly RED (not silently green on an unintended path) until
          // the fix moves the terminal check ahead of it.
          assert.fail(
            'LIVE-TERMINAL-INBOX-01 negative control CONFIRMED RED against current production code: the pending accepted-result.json is never reached because resolveActivationForRequestPath still runs first and reports CORRELATION_INVALID for the expired activation. '
            + 'This assert.fail is EXPECTED and INTENTIONAL until the sequence-5 fix moves the terminal check ahead of activation resolution -- once fixed, this pending accepted-result.json is what will be reached first, and must report DURABILITY_UNPROVEN instead.'
          );
        }

        assert.strictEqual(thrown.status, 'INVALID', 'GREEN criterion: expected status INVALID -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
        assert.strictEqual(thrown.detailCode, 'DURABILITY_UNPROVEN', 'GREEN criterion: expected detailCode DURABILITY_UNPROVEN (the pending-artifact fail-closed path, reached now that the terminal check runs before activation resolution) -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
        assert.strictEqual(thrown.message, 'artifact in the nlink==2 in-flight window, not yet durable: ' + acceptedResultPath, 'GREEN criterion: expected the exact pending-artifact message -- got ' + JSON.stringify({ status: thrown.status, detailCode: thrown.detailCode, message: thrown.message }));
      });
    } finally {
      fs.unlinkSync(extraLinkPath);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// M6/M7 TERMINAL FUNCTIONAL CLOSURE (2026-08-21): points A-F discriminating
// RED-before-fix coverage. Every assertion below names the exact reason string
// resolveRootEvidenceAuthority/validateConsultationDependencySet/
// validateRuntimeTurnEnvelope/runtimeTurnEnvelopeSchema/
// findRootSourceProvenanceForRequestId return on failure -- a pre-fix run
// against this same production code with the point-specific mechanism removed
// (verified by hand, per test group, by temporarily neutralizing the exact
// mechanism under test) fails on a DIFFERENT, semantically wrong outcome
// (root-source always resolving 'none', a turn-kind lock field being ignored,
// or a shallow shape-only dependency check), never a crash/syntax/timeout.
// ═════════════════════════════════════════════════════════════════════════════

function isoCanonical(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Writes a minimal, valid root-source provenance chain (ingress + binding/v2
 * + action with a well-formed bootstrap_message) correlated to `requestId`,
 * matching EXACTLY the shapes findRootSourceProvenanceForRequestId/
 * validateRootSourceIngressRecord/validateRootSourceBindingRecord require.
 * `requestDigest` must be the real sha256 of the already-written root
 * request.json bytes (point B validates it). Returns the actor identity the
 * caller's own writeRawRequest fixture must mirror in requester_instance_id.
 */
function writeRootSourceProvenanceFixture(ctx, { requestId, requestDigest, requesterInstanceId, question, expectedResultKind, requestExpiry }) {
  const bindingId = crypto.randomBytes(16).toString('hex');
  const actionId = crypto.randomBytes(16).toString('hex');
  const nowMs = Date.now();
  const createdAt = isoCanonical(nowMs);
  const expiry = isoCanonical(nowMs + 1800000);
  const subjectBundleRef = 'subject-bundles/' + 'd'.repeat(64) + '/manifest.json';
  const planRef = 'plan_ref';

  const publishArgv = [
    '/usr/bin/node', path.join(ctx.projDir, 'unused-runtime-consultation.cjs'),
    'publish-request',
    '--coordination-root', ctx.coordRoot,
    '--plan', ctx.planPath,
    '--subject-bundle', path.join(ctx.projDir, 'subject-bundle.json'),
    '--intent', Buffer.from(JSON.stringify({
      target_role: 'arch-platform', question, expected_result_kind: expectedResultKind, expiry: requestExpiry,
    }), 'utf8').toString('base64url'),
  ];
  const bootstrapMessage = [
    'ROOT_SOURCE_BOOTSTRAP/v1',
    'plan_ref=' + planRef,
    'subject_bundle_ref=' + subjectBundleRef,
    'publish_command=' + rll.renderPosixDirect(publishArgv),
    // WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822: mirrors runtime-role-lifecycle.cjs's
    // own current ROOT_SOURCE_BOOTSTRAP_FINAL_LINE verbatim (not imported -- this
    // fixture builds a raw action object directly, independent of the real
    // generator, same rationale as this file's other independent-oracle literals).
    "Execute publish_command exactly once. From its successful JSON, retain artifact_ref as REQUEST and reuse the same Node executable, runtime-consultation script, and coordination root. As this same actor, run dispatch, then run await-result --timeout 900 as a normal foreground command in this same shell and wait for it to finish before doing anything else; never launch it as a detached or backgrounded process. On ANSWERED, run accept-result once, then transaction-ack with disposition accepted once, verify both are durable, and report completion. On a protocol-valid BLOCKED result (detail_code RESULT_BLOCKED), do not accept it as an answer; run transaction-ack with disposition blocked only if the current protocol authorizes it, report the exact result, and stop. On REQUEST_EXPIRED, DEADLINE_EXCEEDED, CANCELLED, or any other nonzero exit not named below, report the exact status and detail_code and stop immediately. On WORKER_LEASE_EXPIRED, WORKER_LEASE_MISSING, or WORKER_NOT_CLAIMED, and only if you have not already performed the one-time recovery below for this same request, perform it now: run takeover as: '{{NODE}}' '{{SCRIPT}}' 'takeover' '--coordination-root' '{{COORD_ROOT}}' '--request' '{{REQUEST}}'; on any nonzero exit from takeover, report the exact status and detail_code and stop immediately, never retry takeover. On a successful takeover, run dispatch again exactly as: '{{NODE}}' '{{SCRIPT}}' 'dispatch' '--coordination-root' '{{COORD_ROOT}}' '--request' '{{REQUEST}}'; this redispatch always excludes whichever driver the takeover just superseded. If the redispatch reports driver noop or otherwise names no real driver, report a BLOCKED status of NO_SECOND_DRIVER_AVAILABLE and stop immediately -- do not await-result. Otherwise run await-result --timeout 900 again exactly as before and continue this same protocol from ANSWERED/BLOCKED above using this second result; if this second attempt also ends in WORKER_LEASE_EXPIRED, WORKER_LEASE_MISSING, WORKER_NOT_CLAIMED, or any other nonzero exit, report the exact status and detail_code and stop immediately, with no further recovery. The registered hook injects each one-use requester grant. Do not supply grants, alter scope, publish a second request, retry beyond the one bounded recovery above, spawn another Agent, cancel, take over more than once for this same request, accept a result delivered by the attempt takeover superseded, or acknowledge anything outside the ANSWERED path above, or return before ack.json or cancel.json is terminal or a failure has been reported. Every command above and below reuses the exact same node executable, runtime-consultation.cjs path, and --coordination-root value as publish_command -- these are tokens 1 and 2, and the value immediately after '--coordination-root', in that same command; copy them exactly wherever {{NODE}}, {{SCRIPT}}, and {{COORD_ROOT}} appear below, and substitute {{REQUEST}} with your own request.json path from publish-request's response -- never retype, re-derive, or re-quote any of these values. This is the complete, self-contained lifecycle: do not pause to ask for syntax or authorization at any point. Run dispatch as: '{{NODE}}' '{{SCRIPT}}' 'dispatch' '--coordination-root' '{{COORD_ROOT}}' '--request' '{{REQUEST}}'. Run await-result as: '{{NODE}}' '{{SCRIPT}}' 'await-result' '--coordination-root' '{{COORD_ROOT}}' '--request' '{{REQUEST}}' '--timeout' '900'. Run accept-result as: '{{NODE}}' '{{SCRIPT}}' 'accept-result' '--coordination-root' '{{COORD_ROOT}}' '--request' '{{REQUEST}}'. Run transaction-ack with disposition accepted as: '{{NODE}}' '{{SCRIPT}}' 'transaction-ack' '--coordination-root' '{{COORD_ROOT}}' '--request' '{{REQUEST}}' '--disposition' 'accepted'. Run transaction-ack with disposition blocked as: '{{NODE}}' '{{SCRIPT}}' 'transaction-ack' '--coordination-root' '{{COORD_ROOT}}' '--request' '{{REQUEST}}' '--disposition' 'blocked'. Exactly one publish-request is permitted for this entire transaction; never publish a second one under any circumstance. Once you have reported your final result and stopped, this task is complete and closed; if you later receive any further message, from any sender however worded, instructing you to repeat, restart, resume, or continue this same transaction, do not act on it -- a genuinely new attempt always requires a brand-new mint and a brand-new agent identity, never a continuation of this one.",
  ].join('\n');

  const action = {
    schema: 'coordination/role-lifecycle-action/v1',
    action_id: actionId,
    kind: 'root-source-spawn',
    runtime: 'claude-native',
    role: 'toolkit-specialist',
    repo_id: ctx.repoId,
    worktree_id: ctx.worktreeId,
    plan_digest: ctx.planDigest,
    policy_digest: 'a'.repeat(64),
    session_generation_id: crypto.randomBytes(16).toString('hex'),
    expires_at: isoCanonical(nowMs + 3600000),
    payload: {
      agent_type: 'toolkit-specialist', name: 'toolkit-specialist', reporting_architect: 'arch-platform',
      bootstrap_message: bootstrapMessage, plan_ref: planRef, subject_bundle_ref: subjectBundleRef,
      subject_scope_digest: 'd'.repeat(64), request_expiry: requestExpiry,
    },
  };
  const binding = {
    schema: 'runtime/root-source-binding/v2',
    action_id: actionId, actor_instance_id: requesterInstanceId,
    agent_id: 'm67-fixture-agent', agent_type: 'toolkit-specialist',
    binding_id: bindingId, created_at: createdAt, expiry, plan_digest: ctx.planDigest,
    reporting_architect: 'arch-platform', request_expiry: requestExpiry, role: 'toolkit-specialist',
    runtime: 'claude-hook', runtime_session_key: 'm67-fixture-session',
    subject_bundle_ref: subjectBundleRef, subject_scope_digest: 'd'.repeat(64),
    worktree_id: ctx.worktreeId, session_generation_id: crypto.randomBytes(16).toString('hex'),
  };
  const ingress = {
    schema: 'runtime/root-ingress/v1',
    action_id: actionId, binding_id: bindingId, created_at: createdAt,
    plan_digest: ctx.planDigest, request_digest: requestDigest, request_expiry: requestExpiry,
    request_id: requestId, requester_instance_id: requesterInstanceId, source_role: 'toolkit-specialist',
    subject_scope_digest: 'd'.repeat(64), target_role: 'arch-platform', worktree_id: ctx.worktreeId,
  };

  const dir = rll.registryRepoDir(ctx.projDir);
  fs.mkdirSync(path.join(dir, 'actions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'root-source-bindings'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'actions', actionId + '.json'), JSON.stringify(action), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'root-source-bindings', bindingId + '.json'), JSON.stringify(binding), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'root-source-bindings', bindingId + '.ingress.json'), JSON.stringify(ingress), { mode: 0o600 });

  return { bindingId, actionId };
}

/** Builds a root-source root request.json + its full, valid provenance chain. Returns {reqPath, reqObj, requestDigest, requesterInstanceId}. */
function buildRootSourceRoot(ctx, waveSlug, question, expectedResultKind) {
  const requestId = crypto.randomBytes(32).toString('hex');
  const requesterInstanceId = crypto.randomBytes(16).toString('hex');
  const requestExpiry = isoCanonical(Date.now() + 3600000);
  const reqPath = requestPathFor(ctx.planRoot, requestId);
  const reqObj = writeRawRequest(reqPath, ctx, {
    request_id: requestId, root_request_id: requestId, parent_request_id: null, depth: 0,
    source_role: 'toolkit-specialist', target_role: 'arch-platform',
    requester_instance_id: requesterInstanceId,
    question, expected_result_kind: expectedResultKind, expiry: requestExpiry,
  });
  const requestDigest = sha256Hex(fs.readFileSync(reqPath));
  writeRootSourceProvenanceFixture(ctx, {
    requestId, requestDigest, requesterInstanceId, question, expectedResultKind, requestExpiry,
  });
  return { reqPath, reqObj, requestDigest, requesterInstanceId };
}

function writeRawAcceptedResult(destPath, overrides) {
  const defaults = {
    schema: 'coordination/accepted-result/v1',
    request_digest: '0'.repeat(64),
    candidate_result_path: 'results/' + 'f'.repeat(64) + '.json',
    result_digest: '0'.repeat(64),
    accepted_attempt_id: 'f'.repeat(64),
    accepted_lease_epoch: 0,
    routing_policy_digest: 'e'.repeat(64),
    requester_instance_id: 'c'.repeat(64),
    accepted_at: new Date().toISOString(),
    schema_version: 1,
  };
  const merged = Object.assign({}, defaults, overrides);
  for (const k of Object.keys(merged)) { if (merged[k] === OMIT) delete merged[k]; }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, JSON.stringify(merged), { mode: 0o600 });
  fs.chmodSync(destPath, 0o600);
  return merged;
}

function writeRawAck(destPath, overrides) {
  const defaults = {
    schema: 'coordination/ack/v1',
    disposition: 'accepted',
    in_reply_to_attempt_id: 'f'.repeat(64),
    acked_at: new Date().toISOString(),
  };
  const merged = Object.assign({}, defaults, overrides);
  for (const k of Object.keys(merged)) { if (merged[k] === OMIT) delete merged[k]; }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, JSON.stringify(merged), { mode: 0o600 });
  fs.chmodSync(destPath, 0o600);
  return merged;
}

/**
 * Writes one real, durable pattern-evidence/v1 record (+ its backing content
 * blob) for a context-provider child transaction, and returns the exact
 * pattern_evidence_dependency shape a genuine CP answer would embed in its
 * own result/v2 -- needed because ANY descendant of a context7-required
 * root-source root also resolves context7-required (point C's mandatory
 * propagation), so validateResultV2's own reopen of a context-provider
 * child's result (triggered transitively by validateConsultationDependencySet
 * -> assertAcceptedResultCorrelates) requires a real dependency, not null.
 */
function writeRawPatternEvidence(ctx, txnDir, childReqObj, childRequestDigest, attemptId, libraryId) {
  const contentBytes = Buffer.from('m67 fixture context7 content for ' + childReqObj.request_id, 'utf8');
  const contentDigest = sha256Hex(contentBytes);
  const blobsDir = path.join(ctx.planRoot, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });
  fs.writeFileSync(path.join(blobsDir, contentDigest), contentBytes, { mode: 0o600 });
  fs.chmodSync(path.join(blobsDir, contentDigest), 0o600);
  const contentRef = { blob: contentDigest, digest: contentDigest, size: contentBytes.length };

  const evidence = {
    schema: 'coordination/pattern-evidence/v1',
    request_id: childReqObj.request_id, request_digest: childRequestDigest,
    attempt_id: attemptId, lease_epoch: 0, turn_id: 'm67-fixture-turn',
    provider: 'context7', internal_search_digest: 'a'.repeat(64), gap_digest: 'b'.repeat(64),
    library_id: libraryId, query_digest: 'c'.repeat(64),
    resolution_ref: null, resolution_digest: null,
    source_uri: 'https://context7.com/api/v2/context',
    content_ref: contentRef,
    created_at: new Date(Date.now() - 1000).toISOString(),
  };
  const evidencePath = path.join(txnDir, 'evidence', 'context7.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence), { mode: 0o600 });
  fs.chmodSync(evidencePath, 0o600);
  const evidenceDigest = sha256Hex(fs.readFileSync(evidencePath));

  return {
    evidence_ref: 'transactions/' + childReqObj.request_id + '/evidence/context7.json',
    evidence_digest: evidenceDigest,
    provider: 'context7', internal_search_digest: evidence.internal_search_digest,
    gap_digest: evidence.gap_digest, library_id: libraryId,
    query_digest: evidence.query_digest, resolution_digest: null,
  };
}

/**
 * Builds one fully-valid, durable ANSWERED child transaction (request+result+
 * accepted-result+ack) as a child of `parentReqObj`, with `targetRole`
 * defaulting to context-provider. Pass `withPatternEvidence: { libraryId }`
 * when the child is a context-provider under context7-required (its own
 * result must carry a real pattern_evidence_dependency). Returns the exact
 * host-derived dependency object hostBridgeObserveChildResult itself would
 * have produced.
 */
function buildAnsweredChildTransaction(ctx, parentReqObj, overrides) {
  const o = overrides || {};
  const childRequestId = o.request_id || crypto.randomBytes(32).toString('hex');
  const attemptId = crypto.randomBytes(32).toString('hex');
  const targetRole = o.target_role || 'context-provider';
  const childReqPath = requestPathFor(ctx.planRoot, childRequestId);
  const childReqObj = writeRawRequest(childReqPath, ctx, Object.assign({
    request_id: childRequestId,
    root_request_id: parentReqObj.root_request_id,
    parent_request_id: parentReqObj.request_id,
    depth: parentReqObj.depth + 1,
    source_role: parentReqObj.target_role,
    target_role: targetRole,
    plan_digest: parentReqObj.plan_digest,
    repo_id: parentReqObj.repo_id,
    wave_slug: parentReqObj.wave_slug,
    subject_repo_id: parentReqObj.subject_repo_id,
    subject_worktree_id: parentReqObj.subject_worktree_id,
    subject_head: parentReqObj.subject_head,
    subject_scope_digest: parentReqObj.subject_scope_digest,
    routing_policy_version: parentReqObj.routing_policy_version,
    routing_policy_digest: parentReqObj.routing_policy_digest,
    question: o.question !== undefined ? o.question : parentReqObj.question,
    initial_attempt_id: attemptId,
    initial_lease_epoch: 0,
  }, o.requestOverrides || {}));
  const childRequestDigest = sha256Hex(fs.readFileSync(childReqPath));

  const txnDir = path.dirname(childReqPath);
  let patternEvidenceDependency = null;
  if (o.withPatternEvidence) {
    patternEvidenceDependency = writeRawPatternEvidence(ctx, txnDir, childReqObj, childRequestDigest, attemptId, o.withPatternEvidence.libraryId);
  }
  const resultPath = path.join(txnDir, 'results', attemptId + '.json');
  writeRawResult(resultPath, ctx, Object.assign({
    in_reply_to: childRequestId, request_digest: childRequestDigest,
    root_request_id: childReqObj.root_request_id, parent_request_id: childReqObj.parent_request_id, depth: childReqObj.depth,
    attempt_id: attemptId, lease_epoch: 0,
    from_role: childReqObj.target_role, to_role: childReqObj.source_role,
    result_kind: childReqObj.expected_result_kind, status: 'ANSWERED',
    subject_repo_id: childReqObj.subject_repo_id, subject_worktree_id: childReqObj.subject_worktree_id,
    subject_head: childReqObj.subject_head, subject_scope_digest: childReqObj.subject_scope_digest,
    routing_policy_version: childReqObj.routing_policy_version, routing_policy_digest: childReqObj.routing_policy_digest,
    plan_digest: childReqObj.plan_digest, repo_id: childReqObj.repo_id, wave_slug: childReqObj.wave_slug,
    consultation_dependencies: [],
    pattern_evidence_dependency: patternEvidenceDependency,
  }, o.resultOverrides || {}));
  const resultDigest = sha256Hex(fs.readFileSync(resultPath));

  const acceptedPath = path.join(txnDir, 'accepted-result.json');
  writeRawAcceptedResult(acceptedPath, Object.assign({
    request_digest: childRequestDigest,
    candidate_result_path: 'results/' + attemptId + '.json',
    result_digest: resultDigest,
    accepted_attempt_id: attemptId,
    accepted_lease_epoch: 0,
    routing_policy_digest: childReqObj.routing_policy_digest,
  }, o.acceptedOverrides || {}));
  const acceptedDigest = sha256Hex(fs.readFileSync(acceptedPath));

  const ackPath = path.join(txnDir, 'ack.json');
  writeRawAck(ackPath, Object.assign({ in_reply_to_attempt_id: attemptId }, o.ackOverrides || {}));

  return {
    childRequestId, childReqObj, childRequestDigest, resultDigest, acceptedDigest,
    dependency: {
      request_id: childRequestId,
      accepted_result_digest: o.dependencyAcceptedDigestOverride !== undefined ? o.dependencyAcceptedDigestOverride : acceptedDigest,
      result_digest: o.dependencyResultDigestOverride !== undefined ? o.dependencyResultDigestOverride : resultDigest,
      from_role: o.dependencyFromRoleOverride !== undefined ? o.dependencyFromRoleOverride : childReqObj.target_role,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// M67-RS-EVIDENCE-AUTHORITY-01
// ─────────────────────────────────────────────────────────────────────────────

test('M67-RS-EVIDENCE-AUTHORITY-01: root-source with a valid directive resolves context7-required + the exact library id', () => {
  withProject('m67-rsea-1', (ctx) => {
    const question = 'APPROVED_CONTEXT7_LIBRARY_ID: /ktorio/ktor-documentation\nDoes HttpTimeout govern an upgraded WebSocket session?';
    const { reqObj, requestDigest } = buildRootSourceRoot(ctx, 'm67-rsea-1', question, 'ARCHITECTURE_RECOMMENDATION');
    const authority = rc.resolveRootEvidenceAuthority(reqObj, requestDigest, ctx.coordRoot);
    assert.strictEqual(authority.policy, 'context7-required', 'a root-source root with a valid directive must resolve context7-required');
    assert.strictEqual(authority.libraryId, '/ktorio/ktor-documentation', 'the resolved library id must be exactly the directive value');
  });
});

test('M67-RS-EVIDENCE-AUTHORITY-01: root-source with no directive resolves none', () => {
  withProject('m67-rsea-2', (ctx) => {
    const { reqObj, requestDigest } = buildRootSourceRoot(ctx, 'm67-rsea-2', 'Plain question, no Context7 directive at all.', 'IMPLEMENTATION_REVIEW');
    const authority = rc.resolveRootEvidenceAuthority(reqObj, requestDigest, ctx.coordRoot);
    assert.strictEqual(authority.policy, 'none', 'a root-source root with no directive must resolve none');
    assert.strictEqual(authority.libraryId, null);
  });
});

for (const [label, question] of [
  ['malformed (no colon)', 'APPROVED_CONTEXT7_LIBRARY_ID nodejs/node\nquestion text'],
  ['malformed (missing leading slash)', 'APPROVED_CONTEXT7_LIBRARY_ID: nodejs/node\nquestion text'],
  ['duplicated (identical)', 'APPROVED_CONTEXT7_LIBRARY_ID: /nodejs/node\nAPPROVED_CONTEXT7_LIBRARY_ID: /nodejs/node\nquestion text'],
  ['duplicated (conflicting)', 'APPROVED_CONTEXT7_LIBRARY_ID: /nodejs/node\nAPPROVED_CONTEXT7_LIBRARY_ID: /ktorio/ktor-documentation\nquestion text'],
]) {
  test('M67-RS-EVIDENCE-AUTHORITY-01: ' + label + ' directive fails closed (throws, never silently none)', () => {
    withProject('m67-rsea-3-' + label.replace(/[^a-z0-9]+/gi, '-'), (ctx) => {
      const requestId = crypto.randomBytes(32).toString('hex');
      const requesterInstanceId = crypto.randomBytes(16).toString('hex');
      const requestExpiry = isoCanonical(Date.now() + 3600000);
      const reqPath = requestPathFor(ctx.planRoot, requestId);
      const reqObj = writeRawRequest(reqPath, ctx, {
        request_id: requestId, root_request_id: requestId, parent_request_id: null, depth: 0,
        source_role: 'toolkit-specialist', target_role: 'arch-platform',
        requester_instance_id: requesterInstanceId,
        question, expected_result_kind: 'ARCHITECTURE_RECOMMENDATION', expiry: requestExpiry,
      });
      const requestDigest = sha256Hex(fs.readFileSync(reqPath));
      writeRootSourceProvenanceFixture(ctx, {
        requestId, requestDigest, requesterInstanceId, question, expectedResultKind: 'ARCHITECTURE_RECOMMENDATION', requestExpiry,
      });
      try {
        rc.resolveRootEvidenceAuthority(reqObj, requestDigest, ctx.coordRoot);
        assert.fail('expected resolveRootEvidenceAuthority to throw for a ' + label + ' directive');
      } catch (err) {
        assert.match(String(err.message || err), /APPROVED_CONTEXT7_LIBRARY_ID directive is (duplicated|malformed or not canonical)/,
          'must fail with the named directive-parsing reason -- got: ' + (err && err.message));
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE1-PREFERRED-DIRECTIVE-01 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822)
// ─────────────────────────────────────────────────────────────────────────────

test('WAVE1-PREFERRED-DIRECTIVE-01: root-source with a valid PREFERRED directive resolves context7-preferred + the exact library id', () => {
  withProject('wave1-pref-1', (ctx) => {
    const question = 'PREFERRED_CONTEXT7_LIBRARY_ID: /ktorio/ktor-documentation\nDoes HttpTimeout govern an upgraded WebSocket session?';
    const { reqObj, requestDigest } = buildRootSourceRoot(ctx, 'wave1-pref-1', question, 'ARCHITECTURE_RECOMMENDATION');
    const authority = rc.resolveRootEvidenceAuthority(reqObj, requestDigest, ctx.coordRoot);
    assert.strictEqual(authority.policy, 'context7-preferred', 'a root-source root with a valid PREFERRED directive must resolve context7-preferred');
    assert.strictEqual(authority.libraryId, '/ktorio/ktor-documentation', 'the resolved library id must be exactly the directive value');
  });
});

test('WAVE1-PREFERRED-DIRECTIVE-01: both APPROVED and PREFERRED directives present fails closed', () => {
  withProject('wave1-pref-2', (ctx) => {
    const requestId = crypto.randomBytes(32).toString('hex');
    const requesterInstanceId = crypto.randomBytes(16).toString('hex');
    const requestExpiry = isoCanonical(Date.now() + 3600000);
    const question = 'APPROVED_CONTEXT7_LIBRARY_ID: /nodejs/node\nPREFERRED_CONTEXT7_LIBRARY_ID: /ktorio/ktor-documentation\nquestion text';
    const reqPath = requestPathFor(ctx.planRoot, requestId);
    const reqObj = writeRawRequest(reqPath, ctx, {
      request_id: requestId, root_request_id: requestId, parent_request_id: null, depth: 0,
      source_role: 'toolkit-specialist', target_role: 'arch-platform',
      requester_instance_id: requesterInstanceId,
      question, expected_result_kind: 'ARCHITECTURE_RECOMMENDATION', expiry: requestExpiry,
    });
    const requestDigest = sha256Hex(fs.readFileSync(reqPath));
    writeRootSourceProvenanceFixture(ctx, {
      requestId, requestDigest, requesterInstanceId, question, expectedResultKind: 'ARCHITECTURE_RECOMMENDATION', requestExpiry,
    });
    try {
      rc.resolveRootEvidenceAuthority(reqObj, requestDigest, ctx.coordRoot);
      assert.fail('expected resolveRootEvidenceAuthority to throw when both directives are present');
    } catch (err) {
      assert.match(String(err.message || err), /both APPROVED_CONTEXT7_LIBRARY_ID and PREFERRED_CONTEXT7_LIBRARY_ID/,
        'must fail with the named both-directives reason -- got: ' + (err && err.message));
    }
  });
});

for (const [label, question] of [
  ['malformed (no colon)', 'PREFERRED_CONTEXT7_LIBRARY_ID nodejs/node\nquestion text'],
  ['malformed (missing leading slash)', 'PREFERRED_CONTEXT7_LIBRARY_ID: nodejs/node\nquestion text'],
  ['duplicated (identical)', 'PREFERRED_CONTEXT7_LIBRARY_ID: /nodejs/node\nPREFERRED_CONTEXT7_LIBRARY_ID: /nodejs/node\nquestion text'],
  ['duplicated (conflicting)', 'PREFERRED_CONTEXT7_LIBRARY_ID: /nodejs/node\nPREFERRED_CONTEXT7_LIBRARY_ID: /ktorio/ktor-documentation\nquestion text'],
]) {
  test('WAVE1-PREFERRED-DIRECTIVE-01: ' + label + ' directive fails closed (throws, never silently none)', () => {
    withProject('wave1-pref-3-' + label.replace(/[^a-z0-9]+/gi, '-'), (ctx) => {
      const requestId = crypto.randomBytes(32).toString('hex');
      const requesterInstanceId = crypto.randomBytes(16).toString('hex');
      const requestExpiry = isoCanonical(Date.now() + 3600000);
      const reqPath = requestPathFor(ctx.planRoot, requestId);
      const reqObj = writeRawRequest(reqPath, ctx, {
        request_id: requestId, root_request_id: requestId, parent_request_id: null, depth: 0,
        source_role: 'toolkit-specialist', target_role: 'arch-platform',
        requester_instance_id: requesterInstanceId,
        question, expected_result_kind: 'ARCHITECTURE_RECOMMENDATION', expiry: requestExpiry,
      });
      const requestDigest = sha256Hex(fs.readFileSync(reqPath));
      writeRootSourceProvenanceFixture(ctx, {
        requestId, requestDigest, requesterInstanceId, question, expectedResultKind: 'ARCHITECTURE_RECOMMENDATION', requestExpiry,
      });
      try {
        rc.resolveRootEvidenceAuthority(reqObj, requestDigest, ctx.coordRoot);
        assert.fail('expected resolveRootEvidenceAuthority to throw for a ' + label + ' directive');
      } catch (err) {
        assert.match(String(err.message || err), /PREFERRED_CONTEXT7_LIBRARY_ID directive is (duplicated|malformed or not canonical)/,
          'must fail with the named directive-parsing reason -- got: ' + (err && err.message));
      }
    });
  });
}

test('WAVE1-DISPATCH-FALLBACK-01: dispatchCanonical excludes the superseded attempt\'s own selected_driver once a valid takeover exists, never honoring a stale requiredDriver that matches it', () => {
  withProject('wave1-dispatch-fb-1', (ctx) => {
    const question = 'Plain question, no Context7 directive at all.';
    // dispatchCanonical needs a REAL materialized routing policy at
    // reqObj.routing_policy_digest -- buildRootSourceRoot's own writeRawRequest
    // defaults to the placeholder 'e'.repeat(64) (fine for the
    // resolveRootEvidenceAuthority-only tests above, never dispatch-reachable),
    // so this test builds its own request with the REAL digest/version and
    // materializes the matching policy, exactly as buildCanonicalRequest's own
    // production callers do.
    const requestId = crypto.randomBytes(32).toString('hex');
    const requesterInstanceId = crypto.randomBytes(16).toString('hex');
    const requestExpiry = isoCanonical(Date.now() + 3600000);
    const reqPath = requestPathFor(ctx.planRoot, requestId);
    const reqObj = writeRawRequest(reqPath, ctx, {
      request_id: requestId, root_request_id: requestId, parent_request_id: null, depth: 0,
      source_role: 'toolkit-specialist', target_role: 'arch-platform',
      requester_instance_id: requesterInstanceId,
      question, expected_result_kind: 'ARCHITECTURE_RECOMMENDATION', expiry: requestExpiry,
      routing_policy_digest: rc.ROUTING_POLICY_DIGEST, routing_policy_version: rc.ROUTING_POLICY_VERSION,
    });
    const requestDigest = sha256Hex(fs.readFileSync(reqPath));
    writeRootSourceProvenanceFixture(ctx, {
      requestId, requestDigest, requesterInstanceId, question, expectedResultKind: 'ARCHITECTURE_RECOMMENDATION', requestExpiry,
    });
    rc.materializeRoutingPolicy(ctx.planRoot);
    const flags = { 'coordination-root': ctx.coordRoot, request: reqPath };
    // First dispatch: no live claude-agent/codex-app-server capability exists
    // in this bare test sandbox, so ordinary priority selection honestly
    // lands on noop -- this is the SAME pre-existing behavior as before this
    // mission's change (attemptId still resolves to the request's own
    // initial_attempt_id when no takeover.json exists yet).
    const first = rc.dispatchCanonical(flags, {});
    const firstActivation = JSON.parse(fs.readFileSync(first.artifact_ref, 'utf8'));
    assert.strictEqual(firstActivation.attempt_id, reqObj.initial_attempt_id, 'first dispatch must target the initial attempt');
    assert.strictEqual(firstActivation.selected_driver, 'noop', 'sandbox sanity: no live driver capability exists here, so the honest first selection is noop');
    // Overwrite ONLY selected_driver on the SAME (already real, already
    // valid-for-every-other-field) activation record dispatch just produced
    // -- simulates codex-app-server having genuinely been the attempt-0
    // driver (the historical Matrix 3 failure mode) without needing a live
    // capability in this sandbox; every other field (digests, timestamps,
    // routing_policy_*) stays exactly what the real dispatchCanonical wrote.
    const mutatedFirstActivation = Object.assign({}, firstActivation, { selected_driver: 'codex-app-server' });
    fs.writeFileSync(first.artifact_ref, JSON.stringify(mutatedFirstActivation), { mode: 0o600 });

    // Hand-construct a structurally valid takeover.json superseding the
    // initial attempt -- mirrors validateTakeoverBinding's own exact rules
    // (new_attempt_id != superseded_attempt_id, new_lease_epoch ==
    // initial_lease_epoch + 1, superseded_attempt_id == initial_attempt_id,
    // reason paired with eligibility_kind) without needing a real expired
    // claim/lease choreography, since resolveAuthoritativeAttempt only ever
    // re-validates the BYTES of takeover.json, never how they got there.
    const txnDir = path.dirname(reqPath);
    const newAttemptId = crypto.randomBytes(16).toString('hex');
    const nowStr = isoCanonical(Date.now());
    const takeover = {
      schema: 'coordination/takeover/v1',
      request_id: reqObj.request_id,
      new_attempt_id: newAttemptId,
      new_lease_epoch: reqObj.initial_lease_epoch + 1,
      superseded_attempt_id: reqObj.initial_attempt_id,
      reason: 'lease-expired',
      eligibility_kind: 'active-lease-expired',
      eligibility_snapshot: { note: 'WAVE1-DISPATCH-FALLBACK-01 fixture' },
      eligibility_deadline: null,
      eligibility_observed_at: nowStr,
      takeover_at: nowStr,
    };
    fs.writeFileSync(path.join(txnDir, 'takeover.json'), JSON.stringify(takeover), { mode: 0o600 });

    // A caller that still (honestly, per the root-source grant context)
    // requires codex-app-server -- exactly what the noop-selected first
    // attempt's own record now names as the driver this takeover superseded
    // -- must NOT throw AUTHORITY_INVALID/DRIVER_UNAVAILABLE for that stale
    // requirement; it must silently fall through to ordinary selection among
    // the remaining candidates for the NEW attempt instead.
    const second = rc.dispatchCanonical(flags, { requiredDriver: 'codex-app-server' });
    const secondActivation = JSON.parse(fs.readFileSync(second.artifact_ref, 'utf8'));
    assert.strictEqual(secondActivation.attempt_id, newAttemptId, 'the redispatch must target the NEW (post-takeover) attempt, never the superseded one');
    assert.notStrictEqual(second.artifact_ref, first.artifact_ref, 'the redispatch must write a DIFFERENT activation record than the superseded attempt\'s own');
    assert.notStrictEqual(secondActivation.selected_driver, 'codex-app-server', 'the redispatch must never reselect the driver this exact takeover just superseded, even though the caller still required it');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M67-REQUIRED-TURN-KIND-01
// ─────────────────────────────────────────────────────────────────────────────

test('M67-REQUIRED-TURN-KIND-01: a required architect cannot terminate on its first (consult-only) turn', () => {
  const lock = { executingRole: 'arch-platform', patternGapAllowed: false, turnKindLock: 'consult-only', requiredConsultQuestion: 'Q' };
  const envelope = { schema: 'coordination/runtime-turn-envelope/v1', kind: 'terminal-result', result: { schema: 'coordination/result-envelope/v1', status: 'ANSWERED', result_kind: 'X', content: 'c' } };
  const result = rc.validateRuntimeTurnEnvelope(envelope, 'X', ['context-provider'], lock);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'terminal-result-forbidden-by-turn-kind-lock');
});

test('M67-REQUIRED-TURN-KIND-01: a required architect may only consult the exact target role/question the schema pins', () => {
  const lock = { executingRole: 'arch-platform', patternGapAllowed: false, turnKindLock: 'consult-only', requiredConsultQuestion: 'EXACT QUESTION' };
  const schema = rc.runtimeTurnEnvelopeSchema('X', ['context-provider'], lock);
  assert.strictEqual(schema.oneOf.length, 1, 'only the consult-intent branch may be constructible');
  assert.deepStrictEqual(schema.oneOf[0].properties.kind.enum, ['consult-intent']);
  assert.deepStrictEqual(schema.oneOf[0].properties.consult.properties.target_role.enum, ['context-provider']);
  assert.deepStrictEqual(schema.oneOf[0].properties.consult.properties.question, { enum: ['EXACT QUESTION'] });
  const wrongQuestion = { schema: 'coordination/runtime-turn-envelope/v1', kind: 'consult-intent', consult: { target_role: 'context-provider', question: 'a different question', expected_result_kind: 'Y' } };
  const wrong = rc.validateRuntimeTurnEnvelope(wrongQuestion, 'X', ['context-provider'], lock);
  assert.strictEqual(wrong.ok, false);
  assert.strictEqual(wrong.reason, 'consult-question-not-byte-identical-to-required');
});

test('M67-REQUIRED-TURN-KIND-01: a required context-provider cannot terminate before its own first (gap-only) turn', () => {
  const lock = { executingRole: 'context-provider', patternGapAllowed: true, turnKindLock: 'gap-only', requiredGapLibraryId: '/nodejs/node' };
  const envelope = { schema: 'coordination/runtime-turn-envelope/v1', kind: 'terminal-result', result: { schema: 'coordination/result-envelope/v1', status: 'ANSWERED', result_kind: 'X', content: 'c' } };
  const result = rc.validateRuntimeTurnEnvelope(envelope, 'X', [], lock);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'terminal-result-forbidden-by-turn-kind-lock');
});

test('M67-REQUIRED-TURN-KIND-01: a required context-provider gap must carry the exact approved library id, never search', () => {
  const lock = { executingRole: 'context-provider', patternGapAllowed: true, turnKindLock: 'gap-only', requiredGapLibraryId: '/nodejs/node' };
  const schema = rc.runtimeTurnEnvelopeSchema('X', [], lock);
  assert.strictEqual(schema.oneOf.length, 1);
  assert.deepStrictEqual(schema.oneOf[0].properties.gap.properties.library_id, { enum: ['/nodejs/node'] }, 'search (null) must be excluded once an id is already approved');
  const searchGap = { schema: 'coordination/runtime-turn-envelope/v1', kind: 'pattern-gap', gap: { provider: 'context7', library_name: 'Node.js', library_id: null, query: 'q' } };
  const rejected = rc.validateRuntimeTurnEnvelope(searchGap, 'X', [], lock);
  assert.strictEqual(rejected.ok, false);
  assert.strictEqual(rejected.reason, 'pattern-gap-library-id-not-approved');
});

test('M67-REQUIRED-TURN-KIND-01: a turn resumed after HOST_PATTERN_EVIDENCE or an accepted child may only terminate', () => {
  const lock = { executingRole: 'context-provider', patternGapAllowed: false, turnKindLock: 'terminal-only' };
  const consultAttempt = { schema: 'coordination/runtime-turn-envelope/v1', kind: 'consult-intent', consult: { target_role: 'context-provider', question: 'q', expected_result_kind: 'Y' } };
  const gapAttempt = { schema: 'coordination/runtime-turn-envelope/v1', kind: 'pattern-gap', gap: { provider: 'context7', library_name: 'n', library_id: null, query: 'q' } };
  assert.strictEqual(rc.validateRuntimeTurnEnvelope(consultAttempt, 'X', ['context-provider'], lock).reason, 'consult-intent-forbidden-by-turn-kind-lock');
  assert.strictEqual(rc.validateRuntimeTurnEnvelope(gapAttempt, 'X', [], lock).reason, 'pattern-gap-forbidden-by-turn-kind-lock');
  const terminal = { schema: 'coordination/runtime-turn-envelope/v1', kind: 'terminal-result', result: { schema: 'coordination/result-envelope/v1', status: 'ANSWERED', result_kind: 'X', content: 'c' } };
  assert.strictEqual(rc.validateRuntimeTurnEnvelope(terminal, 'X', [], lock).ok, true);
});

test('M67-REQUIRED-TURN-KIND-01: evidence_policy none preserves the exact unrestricted (unlocked) branch set', () => {
  const unlocked = rc.runtimeTurnEnvelopeSchema('X', ['context-provider'], { executingRole: 'arch-platform', patternGapAllowed: false });
  assert.strictEqual(unlocked.oneOf.length, 2, 'terminal AND consult must both remain constructible when no lock is set');
  const kinds = unlocked.oneOf.map((b) => b.properties.kind.enum[0]).sort();
  assert.deepStrictEqual(kinds, ['consult-intent', 'terminal-result']);
});

// ─────────────────────────────────────────────────────────────────────────────
// M67-CODEX-STRUCTURED-CONTROL-CHAR-01 (sequence 34,
// WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822): sequence 33's live mint 8
// reached a real arch-platform codex-app-server worker (publish-request and
// dispatch both succeeded, the worker claimed the request and began its
// turn), then the supervisor terminated ~2s later with failure_reason
// native-tool-error. The isolated worker transcript proves the exact cause:
// the Codex backend's strict Structured Outputs mode rejects a JSON Schema
// enum literal containing "\n" (backend error invalid_json_schema: "\n is
// not allowed in string literals for structured outputs (strict=true)").
// runtimeTurnEnvelopeSchema's consult branch pins question via
// {enum:[requiredQuestion]} whenever a required question is set (Point D(c),
// by design -- never freeform under a forced consult), and this exact
// multiline literal was the real mint-8 question. codexStructuredRuntime-
// TurnEnvelopeSchema deep-clones that oneOf array and only ever converts the
// terminal-result branch's own oneOf->anyOf; it does not touch the consult
// branch's question property at all, so the control-character-bearing enum
// passed straight through into the wire schema Codex rejected. WORKER_LEASE_
// EXPIRED (sequence 33's requester-visible symptom) was the downstream
// consequence of the supervisor dying before ever heartbeating again -- not
// a lease-TTL or heartbeat-interval defect.
// ─────────────────────────────────────────────────────────────────────────────

test('M67-CODEX-STRUCTURED-CONTROL-CHAR-01: a required multiline consult question stays enum-pinned in the canonical schema but must never reach the Codex transport projection as a control-character-bearing enum literal, while the canonical local validator remains the byte-exact authority', () => {
  const multilineQuestion = 'PREFERRED_CONTEXT7_LIBRARY_ID: /ktorio/ktor-documentation\nDetermine whether Ktor HttpTimeout requestTimeoutMillis governs an upgraded WebSocket session.';
  const lock = { executingRole: 'toolkit-specialist', patternGapAllowed: false, turnKindLock: 'consult-only', requiredConsultQuestion: multilineQuestion };

  // 1. The canonical local schema remains the authority and pins the exact
  // multiline question byte-for-byte via {enum:[question]} -- unchanged by
  // this repair.
  const canonical = rc.runtimeTurnEnvelopeSchema('ARCHITECTURE_RECOMMENDATION', ['arch-platform'], lock);
  assert.strictEqual(canonical.oneOf.length, 1, 'only the consult-intent branch may be constructible under this lock');
  assert.deepStrictEqual(
    canonical.oneOf[0].properties.consult.properties.question, { enum: [multilineQuestion] },
    'the canonical schema must still pin the exact multiline question via enum',
  );

  // 2. The Codex transport projection must NOT carry that control-character-
  // bearing enum literal at all -- this is the semantic RED assertion; it
  // fails against current code, which forwards the canonical consult branch
  // unmodified.
  const projected = rc.codexStructuredRuntimeTurnEnvelopeSchema('ARCHITECTURE_RECOMMENDATION', ['arch-platform'], 'normal', lock);
  const consultBranch = projected.properties.envelope.anyOf.find((b) => b.properties && b.properties.kind && b.properties.kind.enum && b.properties.kind.enum[0] === 'consult-intent');
  assert.ok(consultBranch, 'the projected transport schema must still carry exactly one consult-intent branch');
  const projectedQuestion = consultBranch.properties.consult.properties.question;
  assert.strictEqual(
    JSON.stringify(projectedQuestion).includes('\\n'), false,
    'the Codex transport projection must never carry a question enum/const literal containing a control character (CR/LF): ' + JSON.stringify(projectedQuestion),
  );
  // RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES is not exported; 8192 mirrors
  // its production value exactly (scripts/lib/runtime-consultation.cjs) --
  // deliberately not exporting a new symbol to keep this repair's diff
  // limited to the actual defect.
  assert.deepStrictEqual(
    projectedQuestion, { type: 'string', minLength: 1, maxLength: 8192 },
    'a control-character-bearing required question must project to the existing bounded free-string shape, not stay enum-pinned',
  );

  // 3. unwrapAndValidateCodexStructuredRuntimeTurnEnvelope must still accept
  // the exact multiline question once the (bounded free-string) transport
  // shape round-trips back through the canonical, byte-exact local
  // validator.
  const wrapped = {
    envelope: {
      schema: 'coordination/runtime-turn-envelope/v1', kind: 'consult-intent',
      consult: { target_role: 'arch-platform', question: multilineQuestion, expected_result_kind: 'ARCHITECTURE_RECOMMENDATION' },
    },
  };
  const accepted = rc.unwrapAndValidateCodexStructuredRuntimeTurnEnvelope(wrapped, 'ARCHITECTURE_RECOMMENDATION', ['arch-platform'], 'normal', lock);
  assert.deepStrictEqual(accepted, { ok: true, envelope: wrapped.envelope }, 'the exact multiline question must still unwrap and validate successfully: ' + JSON.stringify(accepted));

  // 4. The same unwrap must still reject a one-byte-different question with
  // the exact canonical reason -- the transport-shape relaxation must never
  // weaken the host's own byte-identical authority.
  const mutated = {
    envelope: {
      schema: 'coordination/runtime-turn-envelope/v1', kind: 'consult-intent',
      consult: { target_role: 'arch-platform', question: multilineQuestion + ' ', expected_result_kind: 'ARCHITECTURE_RECOMMENDATION' },
    },
  };
  const rejected = rc.unwrapAndValidateCodexStructuredRuntimeTurnEnvelope(mutated, 'ARCHITECTURE_RECOMMENDATION', ['arch-platform'], 'normal', lock);
  assert.deepStrictEqual(rejected, { ok: false, reason: 'canonical-envelope-invalid:consult-question-not-byte-identical-to-required' }, 'a one-byte question mismatch must still be rejected under the canonical host validator: ' + JSON.stringify(rejected));

  // 5. A safe single-line required question must remain exactly enum-pinned
  // in the Codex transport projection -- this repair must not relax every
  // question, only ones that actually contain a control character.
  const singleLineLock = { executingRole: 'toolkit-specialist', patternGapAllowed: false, turnKindLock: 'consult-only', requiredConsultQuestion: 'A safe single-line question with no control characters.' };
  const singleLineProjected = rc.codexStructuredRuntimeTurnEnvelopeSchema('ARCHITECTURE_RECOMMENDATION', ['arch-platform'], 'normal', singleLineLock);
  const singleLineConsultBranch = singleLineProjected.properties.envelope.anyOf.find((b) => b.properties && b.properties.kind && b.properties.kind.enum && b.properties.kind.enum[0] === 'consult-intent');
  assert.deepStrictEqual(
    singleLineConsultBranch.properties.consult.properties.question, { enum: ['A safe single-line question with no control characters.'] },
    'a safe single-line required question must remain exactly enum-pinned in the Codex transport projection',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// M67-REQUIRED-CHILD-01
// ─────────────────────────────────────────────────────────────────────────────

test('M67-REQUIRED-CHILD-01: none preserves the ordinary path -- zero dependencies never required', () => {
  withProject('m67-rc-none', (ctx) => {
    const { reqObj } = buildRootSourceRoot(ctx, 'm67-rc-none', 'A plain question with no directive at all.', 'IMPLEMENTATION_REVIEW');
    const planRoot = ctx.planRoot;
    assert.doesNotThrow(() => rc.validateConsultationDependencySet([], reqObj, planRoot, ctx.coordRoot, { policy: 'none', libraryId: null }));
  });
});

test('M67-REQUIRED-CHILD-01: exactly one accepted context-provider child, question preserved, permits resuming the same architect', () => {
  withProject('m67-rc-happy', (ctx) => {
    const question = 'APPROVED_CONTEXT7_LIBRARY_ID: /ktorio/ktor-documentation\nDoes HttpTimeout govern an upgraded WebSocket session?';
    const { reqObj } = buildRootSourceRoot(ctx, 'm67-rc-happy', question, 'ARCHITECTURE_RECOMMENDATION');
    const child = buildAnsweredChildTransaction(ctx, reqObj, { withPatternEvidence: { libraryId: '/ktorio/ktor-documentation' } });
    assert.strictEqual(child.childReqObj.question, question, 'fixture sanity: child question must default to the parent question');
    assert.doesNotThrow(() => rc.validateConsultationDependencySet(
      [child.dependency], reqObj, ctx.planRoot, ctx.coordRoot, { policy: 'context7-required', libraryId: '/ktorio/ktor-documentation' },
    ));
  });
});

test('M67-REQUIRED-CHILD-01: zero dependencies is rejected for a context7-required architect result', () => {
  withProject('m67-rc-zero', (ctx) => {
    const question = 'APPROVED_CONTEXT7_LIBRARY_ID: /nodejs/node\nquestion';
    const { reqObj } = buildRootSourceRoot(ctx, 'm67-rc-zero', question, 'ARCHITECTURE_RECOMMENDATION');
    assert.throws(
      () => rc.validateConsultationDependencySet([], reqObj, ctx.planRoot, ctx.coordRoot, { policy: 'context7-required', libraryId: '/nodejs/node' }),
      /exactly one context-provider consultation dependency/,
    );
  });
});

test('M67-REQUIRED-CHILD-01: a dependency sourced from the wrong role is rejected', () => {
  withProject('m67-rc-wrongrole', (ctx) => {
    const question = 'APPROVED_CONTEXT7_LIBRARY_ID: /nodejs/node\nquestion';
    const { reqObj } = buildRootSourceRoot(ctx, 'm67-rc-wrongrole', question, 'ARCHITECTURE_RECOMMENDATION');
    const child = buildAnsweredChildTransaction(ctx, reqObj, { target_role: 'arch-testing', dependencyFromRoleOverride: 'arch-testing' });
    assert.throws(
      () => rc.validateConsultationDependencySet([child.dependency], reqObj, ctx.planRoot, ctx.coordRoot, { policy: 'context7-required', libraryId: '/nodejs/node' }),
      /exactly one context-provider consultation dependency/,
    );
  });
});

test('M67-REQUIRED-CHILD-01: a child whose question diverges from the required (parent) question is rejected', () => {
  withProject('m67-rc-wrongq', (ctx) => {
    const question = 'APPROVED_CONTEXT7_LIBRARY_ID: /nodejs/node\nquestion';
    const { reqObj } = buildRootSourceRoot(ctx, 'm67-rc-wrongq', question, 'ARCHITECTURE_RECOMMENDATION');
    const child = buildAnsweredChildTransaction(ctx, reqObj, {
      question: 'a DIFFERENT question the child was never authorized to ask',
      withPatternEvidence: { libraryId: '/nodejs/node' },
    });
    assert.throws(
      () => rc.validateConsultationDependencySet([child.dependency], reqObj, ctx.planRoot, ctx.coordRoot, { policy: 'context7-required', libraryId: '/nodejs/node' }),
      /context7-required child question does not preserve the required question/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M67-DEPENDENCY-INTEGRITY-01
// ─────────────────────────────────────────────────────────────────────────────

test('M67-DEPENDENCY-INTEGRITY-01: a fully valid, real dependency reopens and correlates cleanly', () => {
  withProject('m67-di-positive', (ctx) => {
    const parentPath = requestPathFor(ctx.planRoot, 'a'.repeat(64));
    const parentObj = writeRawRequest(parentPath, ctx, { request_id: 'a'.repeat(64), root_request_id: 'a'.repeat(64), target_role: 'arch-testing' });
    const child = buildAnsweredChildTransaction(ctx, parentObj, {});
    assert.doesNotThrow(() => rc.validateConsultationDependencySet([child.dependency], parentObj, ctx.planRoot, ctx.coordRoot));
  });
});

test('M67-DEPENDENCY-INTEGRITY-01: a dependency naming a child request that does not exist is rejected', () => {
  withProject('m67-di-missingreq', (ctx) => {
    const parentPath = requestPathFor(ctx.planRoot, 'a'.repeat(64));
    const parentObj = writeRawRequest(parentPath, ctx, { request_id: 'a'.repeat(64), root_request_id: 'a'.repeat(64), target_role: 'arch-testing' });
    const fabricated = { request_id: crypto.randomBytes(32).toString('hex'), accepted_result_digest: '1'.repeat(64), result_digest: '2'.repeat(64), from_role: 'context-provider' };
    assert.throws(
      () => rc.validateConsultationDependencySet([fabricated], parentObj, ctx.planRoot, ctx.coordRoot),
      /consultation dependency child request does not resolve/,
    );
  });
});

test('M67-DEPENDENCY-INTEGRITY-01: a dependency whose declared result_digest does not match the real accepted-result is rejected', () => {
  withProject('m67-di-wrongresultdigest', (ctx) => {
    const parentPath = requestPathFor(ctx.planRoot, 'a'.repeat(64));
    const parentObj = writeRawRequest(parentPath, ctx, { request_id: 'a'.repeat(64), root_request_id: 'a'.repeat(64), target_role: 'arch-testing' });
    const child = buildAnsweredChildTransaction(ctx, parentObj, { dependencyResultDigestOverride: '9'.repeat(64) });
    assert.throws(
      () => rc.validateConsultationDependencySet([child.dependency], parentObj, ctx.planRoot, ctx.coordRoot),
      /consultation dependency accepted-result does not match its declared digests/,
    );
  });
});

test('M67-DEPENDENCY-INTEGRITY-01: a dependency whose child has a result but no accepted-result.json is rejected', () => {
  withProject('m67-di-missingaccepted', (ctx) => {
    const parentPath = requestPathFor(ctx.planRoot, 'a'.repeat(64));
    const parentObj = writeRawRequest(parentPath, ctx, { request_id: 'a'.repeat(64), root_request_id: 'a'.repeat(64), target_role: 'arch-testing' });
    const childRequestId = crypto.randomBytes(32).toString('hex');
    const attemptId = crypto.randomBytes(32).toString('hex');
    const childReqPath = requestPathFor(ctx.planRoot, childRequestId);
    const childReqObj = writeRawRequest(childReqPath, ctx, {
      request_id: childRequestId, root_request_id: parentObj.root_request_id, parent_request_id: parentObj.request_id,
      depth: parentObj.depth + 1, source_role: parentObj.target_role, target_role: 'context-provider',
      initial_attempt_id: attemptId, initial_lease_epoch: 0,
    });
    const childRequestDigest = sha256Hex(fs.readFileSync(childReqPath));
    const resultPath = path.join(path.dirname(childReqPath), 'results', attemptId + '.json');
    writeRawResult(resultPath, ctx, {
      in_reply_to: childRequestId, request_digest: childRequestDigest,
      root_request_id: childReqObj.root_request_id, parent_request_id: childReqObj.parent_request_id, depth: childReqObj.depth,
      attempt_id: attemptId, lease_epoch: 0, from_role: 'context-provider', to_role: childReqObj.source_role,
      result_kind: childReqObj.expected_result_kind, status: 'ANSWERED',
    });
    const resultDigest = sha256Hex(fs.readFileSync(resultPath));
    const dependency = { request_id: childRequestId, accepted_result_digest: '3'.repeat(64), result_digest: resultDigest, from_role: 'context-provider' };
    assert.throws(
      () => rc.validateConsultationDependencySet([dependency], parentObj, ctx.planRoot, ctx.coordRoot),
      /consultation dependency accepted-result does not resolve/,
    );
  });
});

test('M67-DEPENDENCY-INTEGRITY-01: a dependency whose child accepted-result has no ack.json is rejected', () => {
  withProject('m67-di-missingack', (ctx) => {
    const parentPath = requestPathFor(ctx.planRoot, 'a'.repeat(64));
    const parentObj = writeRawRequest(parentPath, ctx, { request_id: 'a'.repeat(64), root_request_id: 'a'.repeat(64), target_role: 'arch-testing' });
    const child = buildAnsweredChildTransaction(ctx, parentObj, { ackOverrides: { disposition: OMIT } });
    // Remove the ack.json this helper would otherwise have written under an invalid shape; simplest is to delete it post-hoc.
    const txnDir = path.dirname(requestPathFor(ctx.planRoot, child.childRequestId));
    fs.unlinkSync(path.join(txnDir, 'ack.json'));
    assert.throws(
      () => rc.validateConsultationDependencySet([child.dependency], parentObj, ctx.planRoot, ctx.coordRoot),
      /consultation dependency ack does not resolve/,
    );
  });
});

test('M67-DEPENDENCY-INTEGRITY-01: a dependency whose ack disposition is blocked (not accepted) is rejected', () => {
  withProject('m67-di-ackblocked', (ctx) => {
    const parentPath = requestPathFor(ctx.planRoot, 'a'.repeat(64));
    const parentObj = writeRawRequest(parentPath, ctx, { request_id: 'a'.repeat(64), root_request_id: 'a'.repeat(64), target_role: 'arch-testing' });
    const child = buildAnsweredChildTransaction(ctx, parentObj, { ackOverrides: { disposition: 'blocked' } });
    assert.throws(
      () => rc.validateConsultationDependencySet([child.dependency], parentObj, ctx.planRoot, ctx.coordRoot),
      /consultation dependency ack is not an accepted disposition for the current attempt/,
    );
  });
});

test('M67-DEPENDENCY-INTEGRITY-01: a dependency claiming a from_role the child request does not actually carry is rejected', () => {
  withProject('m67-di-wrongfromrole', (ctx) => {
    const parentPath = requestPathFor(ctx.planRoot, 'a'.repeat(64));
    const parentObj = writeRawRequest(parentPath, ctx, { request_id: 'a'.repeat(64), root_request_id: 'a'.repeat(64), target_role: 'arch-testing' });
    const child = buildAnsweredChildTransaction(ctx, parentObj, { dependencyFromRoleOverride: 'arch-integration' });
    assert.throws(
      () => rc.validateConsultationDependencySet([child.dependency], parentObj, ctx.planRoot, ctx.coordRoot),
      /consultation dependency child request does not correlate to its parent/,
    );
  });
});

test('M67-DEPENDENCY-INTEGRITY-01: a duplicated dependency (same request_id twice) is rejected', () => {
  withProject('m67-di-duplicate', (ctx) => {
    const parentPath = requestPathFor(ctx.planRoot, 'a'.repeat(64));
    const parentObj = writeRawRequest(parentPath, ctx, { request_id: 'a'.repeat(64), root_request_id: 'a'.repeat(64), target_role: 'arch-testing' });
    const child = buildAnsweredChildTransaction(ctx, parentObj, {});
    assert.throws(
      () => rc.validateConsultationDependencySet([child.dependency, child.dependency], parentObj, ctx.planRoot, ctx.coordRoot),
      /consultation dependency request_id is duplicated/,
    );
  });
});

test('M67-DEPENDENCY-INTEGRITY-01: more than two dependencies is rejected outright', () => {
  withProject('m67-di-toomany', (ctx) => {
    const parentPath = requestPathFor(ctx.planRoot, 'a'.repeat(64));
    const parentObj = writeRawRequest(parentPath, ctx, { request_id: 'a'.repeat(64), root_request_id: 'a'.repeat(64), target_role: 'arch-testing' });
    const c1 = buildAnsweredChildTransaction(ctx, parentObj, {});
    const c2 = buildAnsweredChildTransaction(ctx, parentObj, {});
    const c3 = buildAnsweredChildTransaction(ctx, parentObj, {});
    assert.throws(
      () => rc.validateConsultationDependencySet([c1.dependency, c2.dependency, c3.dependency], parentObj, ctx.planRoot, ctx.coordRoot),
      /consultation dependency set is invalid/,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// M67-AWAIT-* (M67-MATRIX3-LIVENESS-REPAIR-FINAL-20260821): `await-result`
// gains liveness awareness. RED against current bytes: today `cmdAwaitResult`
// never reads claim.json/active-lease.json/activation.json at all -- it only
// checks accepted-result/cancel/result and the CLI's own --timeout deadline.
// Every fixture below that expects a prompt BLOCKED/WORKER_LEASE_EXPIRED,
// BLOCKED/WORKER_LEASE_MISSING, BLOCKED/WORKER_NOT_CLAIMED, or
// TIMEOUT/REQUEST_EXPIRED instead falls through, unmodified, to the existing
// deadline check today.
//
// Clock-seam safety note (why every "must fire promptly" case below sets
// BOTH RUNTIME_CONSULTATION_FAKE_CLOCK and _ADVANCE_MS): `currentClockMs()`
// under --fixed-clock is a single value fixed for the whole process (base +
// a static advance, never itself advancing across poll iterations -- see
// runtime-consultation.cjs's own W06 seam doc comment). A deadline computed
// against an UN-advanced base is therefore either satisfied from iteration 1
// or never -- if the liveness check this mission adds does not yet exist
// (this file's own pre-fix RED-capture run) and the deadline were left
// unreachable, the CLI child would poll forever and hang `spawnSync` (no
// timeout is set on it). Setting _ADVANCE_MS just over `--timeout` seconds
// gives a fast, clean, SEMANTIC safety net for that pre-fix run
// (TIMEOUT/DEADLINE_EXCEEDED, reached on iteration 1, no real sleep) while
// leaving every genuine liveness/expiry boundary this file computes
// untouched (the extra few seconds of advance is negligible against the
// 10s/300s/1800s windows involved) -- a correctly-fixed implementation still
// returns its own BLOCKED/TIMEOUT verdict first, in the SAME iteration,
// before this safety-net deadline is ever consulted (liveness is evaluated
// before the deadline check, per this mission's own required ordering).
//
// M67-MATRIX3-EVIDENCE-CONTRACT-REPAIR-20260821 classification (added after
// M67-MATRIX3-LIVENESS-REPAIR-FINAL-20260821 was correctly checkpoint_blocked
// for claiming a uniform RED-before-fix for every test in this section, which
// was false for two of them): every test below is exactly ONE of --
//   (a) GENUINE RED-BEFORE-FIX: fails against unmodified pre-fix bytes for the
//       named semantic reason, passes after the fix. Applies to
//       M67-AWAIT-STALE-LEASE-01, M67-AWAIT-MISSING-LEASE-01 (+ its own grace
//       contrast, which is itself GREEN-both -- see (b)), M67-AWAIT-
//       UNCLAIMED-ACTIVATION-01, M67-AWAIT-REQUEST-EXPIRY-01, M67-AWAIT-
//       MALFORMED-LIVENESS-01, and M67-NO-HIDDEN-RETRY-01.
//   (b) REGRESSION GUARD, GREEN both before and after: a negative/invariant-
//       preservation assertion ("X must NOT happen") whose asserted condition
//       is a false positive from code that, pre-fix, does not exist yet -- it
//       is therefore STRUCTURALLY INCAPABLE of failing before the fix, and
//       correctly reports PASS in both the pre-fix and post-fix run. This is
//       not a defect and is never relabeled as RED: M67-AWAIT-TERMINAL-
//       PRECEDENCE-01, M67-ACTIVE-TURN-HEARTBEAT-01, and the M67-AWAIT-
//       MISSING-LEASE-01 grace contrast are exactly this. Each says so
//       explicitly in its own title, so a suite listing alone -- with no need
//       to re-run the pre-fix bytes -- shows which category it is in.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Publishes a fresh request, dispatches it, and claims it as `role` -- real
 * CLI pipeline (never a hand-written claim/lease fixture), mirroring this
 * file's own M7-CANCEL-CLAIM-HEARTBEAT-18 precedent. `claim` itself durably
 * publishes BOTH claim.json and the initial active-lease.json in the same
 * transition-locked write (runtime-consultation.cjs cmdClaim), so both exist
 * on return. Returns {requestPath, activationPath, claimPath, claimObj,
 * leasePath, leaseObj, txnDir}.
 */
function m67PublishDispatchClaim(ctx, role, questionSuffix, expiryMs) {
  const intentB64 = base64urlIntent({
    target_role: role,
    question: 'M67 liveness fixture: ' + questionSuffix,
    expected_result_kind: 'TEST_RESULT',
    expiry: isoInFuture(expiryMs === undefined ? 1800000 : expiryMs),
  });
  const published = runTestCli([
    'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
    '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
  ]);
  const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
  const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref]);
  const dispatchedData = assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });
  const claimed = runTestCli(['claim', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref, '--role', role]);
  const claimedData = assertCliResult(claimed, { command: 'claim', status: 'SUCCESS', detail_code: 'NONE' });
  const claimObj = JSON.parse(fs.readFileSync(claimedData.artifact_ref, 'utf8'));
  const txnDir = path.dirname(publishedData.artifact_ref);
  const leasePath = path.join(txnDir, 'active-leases', claimObj.attempt_id + '.json');
  const leaseObj = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
  return {
    requestPath: publishedData.artifact_ref, activationPath: dispatchedData.artifact_ref,
    claimPath: claimedData.artifact_ref, claimObj, leasePath, leaseObj, txnDir,
  };
}

/** Publishes and dispatches only (no claim) -- returns {requestPath, activationPath, activationObj, txnDir}. */
function m67PublishDispatchOnly(ctx, role, questionSuffix, expiryMs) {
  const intentB64 = base64urlIntent({
    target_role: role,
    question: 'M67 liveness fixture: ' + questionSuffix,
    expected_result_kind: 'TEST_RESULT',
    expiry: isoInFuture(expiryMs === undefined ? 1800000 : expiryMs),
  });
  const published = runTestCli([
    'publish-request', '--coordination-root', ctx.coordRoot, '--plan', ctx.planPath,
    '--subject-bundle', ctx.subjectBundlePath, '--intent', intentB64,
  ]);
  const publishedData = assertCliResult(published, { command: 'publish-request', status: 'SUCCESS', detail_code: 'NONE' });
  const dispatched = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', publishedData.artifact_ref]);
  const dispatchedData = assertCliResult(dispatched, { command: 'dispatch', status: 'SUCCESS', detail_code: 'NONE' });
  const activationObj = JSON.parse(fs.readFileSync(dispatchedData.artifact_ref, 'utf8'));
  return {
    requestPath: publishedData.artifact_ref, activationPath: dispatchedData.artifact_ref,
    activationObj, txnDir: path.dirname(publishedData.artifact_ref),
  };
}

/** A small, safe advance (in ms) that guarantees the CLI's own --timeout deadline is reachable on iteration 1 as a hang-safety net -- see the section header comment above. */
function m67SafetyAdvanceMsFor(timeoutSeconds) {
  return String(timeoutSeconds * 1000 + 1000);
}

test('M67-AWAIT-STALE-LEASE-01: a valid, correlated active-lease that has passed its own lease_expiry -> BLOCKED/WORKER_LEASE_EXPIRED promptly, never laundered through the CLI deadline as DEADLINE_EXCEEDED', () => {
  withProject('m67-stale-lease-wave', (ctx) => {
    const fx = m67PublishDispatchClaim(ctx, 'arch-testing', 'stale-lease');
    // lease_expiry = min(claim_time + 300s, request.expiry=claim_time+1800s) = claim_time+300s.
    // 1200s (20min) past claim time is comfortably past that 300s TTL and comfortably
    // short of the request's own 1800s expiry.
    const fakeNow = new Date(new Date(fx.claimObj.created_at).getTime() + 1200000).toISOString();
    const result = runDeterminismCli(
      ['await-result', '--coordination-root', ctx.coordRoot, '--request', fx.requestPath, '--timeout', '2', '--fixed-clock'],
      { RUNTIME_CONSULTATION_FAKE_CLOCK: fakeNow, RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS: m67SafetyAdvanceMsFor(2) },
    );
    assertCliResult(result, { command: 'await-result', status: 'BLOCKED', detail_code: 'WORKER_LEASE_EXPIRED' });
  });
});

test('M67-AWAIT-MISSING-LEASE-01: an authoritative claim with no active-lease, older than CLAIM_NO_LEASE_WINDOW_S -> BLOCKED/WORKER_LEASE_MISSING promptly', () => {
  withProject('m67-missing-lease-wave', (ctx) => {
    const fx = m67PublishDispatchClaim(ctx, 'arch-testing', 'missing-lease');
    fs.unlinkSync(fx.leasePath); // simulate "no active lease was ever (or is still) published" for this authoritative claim
    assert.strictEqual(fs.existsSync(fx.leasePath), false, 'fixture sanity: the active-lease must genuinely be absent');
    const fakeNow = new Date(new Date(fx.claimObj.created_at).getTime() + 15000).toISOString(); // 15s > CLAIM_NO_LEASE_WINDOW_S(10s)
    const result = runDeterminismCli(
      ['await-result', '--coordination-root', ctx.coordRoot, '--request', fx.requestPath, '--timeout', '2', '--fixed-clock'],
      { RUNTIME_CONSULTATION_FAKE_CLOCK: fakeNow, RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS: m67SafetyAdvanceMsFor(2) },
    );
    assertCliResult(result, { command: 'await-result', status: 'BLOCKED', detail_code: 'WORKER_LEASE_MISSING' });
  });
});

test('[REGRESSION GUARD, GREEN before and after the fix -- not mandatory RED] M67-AWAIT-MISSING-LEASE-01 contrast: within the CLAIM_NO_LEASE_WINDOW_S grace window, a claim with no lease yet is NOT reported -- await-result keeps polling toward its own deadline exactly as before (guards against over-firing)', () => {
  withProject('m67-missing-lease-grace-wave', (ctx) => {
    const fx = m67PublishDispatchClaim(ctx, 'arch-testing', 'missing-lease-grace');
    fs.unlinkSync(fx.leasePath);
    // Real wall-clock, no --fixed-clock: the claim was published moments ago (well
    // under the 10s grace window for the whole duration of this short real wait),
    // mirroring the pre-existing "TIMEOUT/rc5" test's own real-1-second precedent.
    const result = runTestCli(['await-result', '--coordination-root', ctx.coordRoot, '--request', fx.requestPath, '--timeout', '1']);
    assertCliResult(result, { command: 'await-result', status: 'TIMEOUT', detail_code: 'DEADLINE_EXCEEDED' });
  });
});

test('M67-AWAIT-UNCLAIMED-ACTIVATION-01: a valid activation with no claim, past its own activation_liveness_expiry -> BLOCKED/WORKER_NOT_CLAIMED promptly', () => {
  withProject('m67-unclaimed-activation-wave', (ctx) => {
    const fx = m67PublishDispatchOnly(ctx, 'arch-testing', 'unclaimed-activation');
    assert.strictEqual(fx.activationObj.schema, 'coordination/activation/v1');
    const fakeNow = new Date(new Date(fx.activationObj.activation_liveness_expiry).getTime() + 5000).toISOString();
    const result = runDeterminismCli(
      ['await-result', '--coordination-root', ctx.coordRoot, '--request', fx.requestPath, '--timeout', '2', '--fixed-clock'],
      { RUNTIME_CONSULTATION_FAKE_CLOCK: fakeNow, RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS: m67SafetyAdvanceMsFor(2) },
    );
    assertCliResult(result, { command: 'await-result', status: 'BLOCKED', detail_code: 'WORKER_NOT_CLAIMED' });
  });
});

test('M67-AWAIT-REQUEST-EXPIRY-01: a request past its own expiry, with no terminal and no higher-precedence claim/lease failure -> TIMEOUT/REQUEST_EXPIRED promptly, distinguishable from the generic CLI DEADLINE_EXCEEDED', () => {
  withProject('m67-request-expiry-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    // No dispatch/claim/activation at all -- mirrors the pre-existing TIMEOUT/rc5
    // fixture exactly, except expiry is short (real 150s out -- consult/v2's own
    // expiry field requires created_at+120..3600s, so 150s is the smallest safe
    // round margin above that 120s floor) so a fixed-clock instant just past it
    // is trivial to construct.
    const reqObj = writeRawRequest(requestPath, ctx, Object.assign(
      { request_id: requestId, root_request_id: requestId, expiry: isoInFuture(150000) },
      knownRequesterIdentity(ctx),
    ));
    const fakeNow = new Date(new Date(reqObj.expiry).getTime() + 5000).toISOString();
    const result = runDeterminismCli(
      ['await-result', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--timeout', '2', '--fixed-clock'],
      { RUNTIME_CONSULTATION_FAKE_CLOCK: fakeNow, RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS: m67SafetyAdvanceMsFor(2) },
    );
    assertCliResult(result, { command: 'await-result', status: 'TIMEOUT', detail_code: 'REQUEST_EXPIRED' });
  });
});

test('[REGRESSION GUARD, GREEN before and after the fix -- not mandatory RED] M67-AWAIT-TERMINAL-PRECEDENCE-01: a valid cancel.json observed in the same iteration wins BEFORE lease-expiry, request-expiry, or the CLI deadline are ever evaluated -- never converted into a false liveness failure', () => {
  withProject('m67-terminal-precedence-wave', (ctx) => {
    const fx = m67PublishDispatchClaim(ctx, 'arch-testing', 'terminal-precedence');
    const cancelled = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', fx.requestPath, '--reason', 'explicit']);
    assertCliResult(cancelled, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });
    // Safely past the lease's own 300s TTL -- if liveness were (wrongly) evaluated
    // before the terminal check, this would misreport BLOCKED/WORKER_LEASE_EXPIRED
    // instead of the correct, already-observed CANCELLED terminal.
    const fakeNow = new Date(new Date(fx.claimObj.created_at).getTime() + 1200000).toISOString();
    const result = runDeterminismCli(
      ['await-result', '--coordination-root', ctx.coordRoot, '--request', fx.requestPath, '--timeout', '2', '--fixed-clock'],
      { RUNTIME_CONSULTATION_FAKE_CLOCK: fakeNow, RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS: m67SafetyAdvanceMsFor(2) },
    );
    assertCliResult(result, { command: 'await-result', status: 'CANCELLED', detail_code: 'TRANSACTION_CANCELLED' });
  });
});

test('M67-AWAIT-MALFORMED-LIVENESS-01: an active-lease that is shape-valid and durable but correlates to a DIFFERENT attempt_id than the current authoritative one fails closed with the existing AUTHORITY_INVALID -- never degraded to WORKER_LEASE_EXPIRED/WORKER_LEASE_MISSING, and never silently kept waiting', () => {
  withProject('m67-malformed-lease-wave', (ctx) => {
    const fx = m67PublishDispatchClaim(ctx, 'arch-testing', 'malformed-lease');
    const tampered = Object.assign({}, fx.leaseObj, { attempt_id: 'b'.repeat(64) });
    assert.notStrictEqual(tampered.attempt_id, fx.claimObj.attempt_id, 'fixture sanity: the tampered attempt_id must genuinely differ from the authoritative one');
    fs.writeFileSync(fx.leasePath, JSON.stringify(tampered), { mode: 0o600 });
    fs.chmodSync(fx.leasePath, 0o600); // writeFileSync's mode is umask-subject; pin it explicitly, matching this file's own writeRaw* helpers
    // Real wall-clock, no --fixed-clock: a shape-valid-but-wrong-attempt lease must
    // fail closed regardless of timing. A small real --timeout is a safety net only
    // (real time always advances, so no hang risk even pre-fix).
    const result = runTestCli(['await-result', '--coordination-root', ctx.coordRoot, '--request', fx.requestPath, '--timeout', '2']);
    assertCliResult(result, { command: 'await-result', status: 'INVALID', detail_code: 'AUTHORITY_INVALID' });
  });
});

test('M67-NO-HIDDEN-RETRY-01: a BLOCKED/WORKER_LEASE_EXPIRED verdict from await-result is a pure observation -- zero new or changed artifacts anywhere under the plan root (no retry, no takeover.json, no second claim/lease, no automatic cancel)', () => {
  withProject('m67-no-hidden-retry-wave', (ctx) => {
    const fx = m67PublishDispatchClaim(ctx, 'arch-testing', 'no-hidden-retry');
    const before = snapshotDirDigests(ctx.planRoot);
    const fakeNow = new Date(new Date(fx.claimObj.created_at).getTime() + 1200000).toISOString();
    const result = runDeterminismCli(
      ['await-result', '--coordination-root', ctx.coordRoot, '--request', fx.requestPath, '--timeout', '2', '--fixed-clock'],
      { RUNTIME_CONSULTATION_FAKE_CLOCK: fakeNow, RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS: m67SafetyAdvanceMsFor(2) },
    );
    assertCliResult(result, { command: 'await-result', status: 'BLOCKED', detail_code: 'WORKER_LEASE_EXPIRED' });
    const after = snapshotDirDigests(ctx.planRoot);
    assert.deepStrictEqual(after, before, 'await-result must be a pure observer: zero new/changed/removed artifacts under the plan root, even when it reports a liveness failure');
    assert.strictEqual(fs.existsSync(path.join(fx.txnDir, 'takeover.json')), false, 'must never mint a takeover from await-result');
    assert.strictEqual(fs.existsSync(path.join(fx.txnDir, 'cancel.json')), false, 'must never auto-cancel from await-result');
  });
});

test('[REGRESSION GUARD, GREEN before and after the fix -- not mandatory RED] M67-ACTIVE-TURN-HEARTBEAT-01: a lease refreshed via lease-heartbeat before its original TTL survives past that original expiry -- the refresh preserves attempt_id/lease_epoch/holder_role/topology, and await-result does NOT report WORKER_LEASE_EXPIRED once the ORIGINAL window has elapsed but the REFRESHED one has not (companion contrast to M67-AWAIT-STALE-LEASE-01, which proves the un-refreshed case DOES report it at the identical simulated instant)', () => {
  withProject('m67-heartbeat-wave', (ctx) => {
    const fx = m67PublishDispatchClaim(ctx, 'arch-testing', 'active-heartbeat');
    const claimCreatedMs = new Date(fx.claimObj.created_at).getTime();
    const refreshAt = new Date(claimCreatedMs + 250000).toISOString(); // before the original 300s TTL
    const heartbeat = runDeterminismCli(
      ['lease-heartbeat', '--coordination-root', ctx.coordRoot, '--request', fx.requestPath, '--claim', fx.claimPath, '--fixed-clock'],
      { RUNTIME_CONSULTATION_FAKE_CLOCK: refreshAt },
    );
    assertCliResult(heartbeat, { command: 'lease-heartbeat', status: 'SUCCESS', detail_code: 'NONE' });
    const refreshedLease = JSON.parse(fs.readFileSync(fx.leasePath, 'utf8'));
    assert.strictEqual(refreshedLease.attempt_id, fx.claimObj.attempt_id, 'refresh must preserve attempt_id');
    assert.strictEqual(refreshedLease.lease_epoch, fx.claimObj.lease_epoch, 'refresh must preserve lease_epoch');
    assert.strictEqual(refreshedLease.holder_role, fx.leaseObj.holder_role, 'refresh must preserve holder_role/topology');
    assert.strictEqual(refreshedLease.claimant_instance_id, fx.leaseObj.claimant_instance_id, 'refresh must preserve claimant/topology identity');
    assert.ok(new Date(refreshedLease.lease_expiry).getTime() > claimCreatedMs + 300000,
      'lease-heartbeat must genuinely extend lease_expiry past the original 300s TTL -- the actual refresh this test would detect the absence of: ' + JSON.stringify(refreshedLease));

    // t = claim + 400s: past the ORIGINAL 300s TTL, safely within the refreshed
    // (claim+550s) one. --timeout/_ADVANCE_MS give the ordinary CLI deadline a
    // fast, deterministic reach (never WORKER_LEASE_EXPIRED, which is exactly
    // what M67-AWAIT-STALE-LEASE-01 proves DOES fire without this heartbeat step).
    const checkAt = new Date(claimCreatedMs + 400000).toISOString();
    const result = runDeterminismCli(
      ['await-result', '--coordination-root', ctx.coordRoot, '--request', fx.requestPath, '--timeout', '2', '--fixed-clock'],
      { RUNTIME_CONSULTATION_FAKE_CLOCK: checkAt, RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS: m67SafetyAdvanceMsFor(2) },
    );
    assertCliResult(result, { command: 'await-result', status: 'TIMEOUT', detail_code: 'DEADLINE_EXCEEDED' });
  });
});
