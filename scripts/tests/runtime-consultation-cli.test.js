#!/usr/bin/env node
'use strict';

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
// Node-computed expiry succeeded end-to-end, including a REAL `dispatch` on the
// resulting request resolving to the `noop` driver). Reported to arch-testing/
// team-lead per the "no fabrication" duty; NOT fixed here -- out of this file's
// single-owned scope (runtime-consultation-cli.bats is a different, unowned file
// for this task).

const assert = require('node:assert');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IMPL = path.resolve(__dirname, '../lib/runtime-consultation.cjs');
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
  return spawnSync(process.execPath, [IMPL, ...args], { env, encoding: 'utf8' });
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
  assert.strictEqual(data.status, expected.status);
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
  const dir = makeTempProject();
  try {
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

test('USAGE_ERROR/rc2: root-init with no --coordination-root at all -> MISSING_ARGUMENT', () => {
  const result = runTestCli(['root-init']);
  assertCliResult(result, { command: 'root-init', status: 'USAGE_ERROR', detail_code: 'MISSING_ARGUMENT' });
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
    writeRawRequest(requestPath, ctx, {});
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
    writeRawRequest(requestPath, ctx, { request_id: requestId, root_request_id: requestId });
    const result = runTestCli(['dispatch', '--coordination-root', ctx.coordRoot, '--request', requestPath]);
    assertCliResult(result, { command: 'dispatch', status: 'UNAVAILABLE', detail_code: 'DRIVER_UNAVAILABLE' });
  });
});

// ─── TIMEOUT/rc5 ─────────────────────────────────────────────────────────────

test('TIMEOUT/rc5: await-result on a request with no candidate result -> DEADLINE_EXCEEDED once the bounded poll elapses', () => {
  withProject('rcc-node-timeout-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(requestPath, ctx, { request_id: requestId, root_request_id: requestId });
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
    writeRawRequest(requestPath, ctx, { request_id: requestId, root_request_id: requestId, initial_attempt_id: attemptId });
    const requestDigest = sha256Hex(fs.readFileSync(requestPath));

    const resultPath = resultPathFor(ctx.planRoot, requestId, attemptId);
    writeRawResult(resultPath, ctx, {
      in_reply_to: requestId,
      root_request_id: requestId,
      request_digest: requestDigest,
      attempt_id: attemptId,
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
    writeRawRequest(requestPath, ctx, {
      request_id: requestId,
      root_request_id: requestId,
      created_at: '2020-01-01T00:00:00.000Z',
      expiry: '2020-01-01T00:30:00.000Z',
    });

    const first = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--reason', 'expired']);
    assertCliResult(first, { command: 'cancel', status: 'SUCCESS', detail_code: 'NONE' });

    const second = runTestCli(['cancel', '--coordination-root', ctx.coordRoot, '--request', requestPath, '--reason', 'explicit']);
    assertCliResult(second, { command: 'cancel', status: 'CANCELLED', detail_code: 'TRANSACTION_CANCELLED' });
  });
});

// ─── INTERNAL/rc7 (best-effort OS-failure proxy) ─────────────────────────────

test('INTERNAL/rc7 (best-effort): root-init under a permission-denied parent returns a well-formed rejection envelope', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
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
  const dir = makeTempProject();
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

test('dispatch: a properly published request round-trips to SUCCESS/rc0 with the noop driver, activation_action null', () => {
  withProject('rcc-node-dispatch-wave', (ctx) => {
    const intentB64 = base64urlIntent({
      target_role: 'arch-testing',
      question: 'dispatch-noop-roundtrip fixture question',
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
    assert.strictEqual(dispatchedData.activation_action, null,
      'noop requires no caller execution -- activation_action must be null (PLAN.md ~L779: "(e) codex-app-server/noop adds no payload keys and therefore returns no action")');
    assert.ok(dispatchedData.artifact_ref, 'dispatch must return the activation artifact_ref');

    const activationObj = JSON.parse(fs.readFileSync(dispatchedData.artifact_ref, 'utf8'));
    assert.strictEqual(activationObj.schema, 'coordination/activation/v1');
    assert.strictEqual(activationObj.selected_driver, 'noop');
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

test('DET-clock: --fixed-clock forces every emitted timestamp (cancel.cancelled_at) to the frozen default base, never real wall-clock time (RED: nowIso() is unconditional real Date today)', () => {
  withProject('rcc-node-det-clock-default-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(requestPath, ctx, { request_id: requestId, root_request_id: requestId });

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

test('DET-clock override: RUNTIME_CONSULTATION_FAKE_CLOCK=<ISO> overrides the frozen base under --fixed-clock (RED: the env var is read nowhere in the implementation today)', () => {
  withProject('rcc-node-det-clock-override-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(requestPath, ctx, { request_id: requestId, root_request_id: requestId });

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

test('DET-deadline (W06 seam): RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS forces await-result past its deadline INSTANTLY, with no real sleep (RED: await-result uses a raw Date.now() deadline + a real Atomics.wait poll loop today, unconditionally)', () => {
  withProject('rcc-node-det-deadline-wave', (ctx) => {
    const requestId = 'a'.repeat(64);
    const requestPath = requestPathFor(ctx.planRoot, requestId);
    writeRawRequest(requestPath, ctx, { request_id: requestId, root_request_id: requestId });

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
  try {
    const reqPath = path.join(dir, 'fake-repo', 'fake-wave', 'fake-plan', 'transactions', 'ghost-request', 'request.json'); // deliberately never written, but properly-shaped (5-segment) so it fails at the request-read stage, not the geometry check
    const result = runTestCli(['cancel', '--coordination-root', dir, '--request', reqPath, '--reason', OVERSIZED_ARGV_VALUE]);
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Gap#1: RUNTIME_CONSULTATION_FORCE_PLATFORM is honored ONLY under the test capability -- without NODE_ENV=test/capability, the override is ignored and the real (non-win32) platform applies, so the same oversized-but-under-POSIX argv is rejected only by the unrelated --reason enum check, never the win32 cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
  try {
    const reqPath = path.join(dir, 'fake-repo', 'fake-wave', 'fake-plan', 'transactions', 'ghost-request', 'request.json'); // deliberately never written, but properly-shaped (5-segment) so it fails at the request-read stage, not the geometry check
    const result = spawnCli(
      ['cancel', '--coordination-root', dir, '--request', reqPath, '--reason', OVERSIZED_ARGV_VALUE],
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
    assertCliResult(result, { command: 'cancel', status: 'USAGE_ERROR', detail_code: 'INVALID_ARGUMENT' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  const dir = makeTempProject();
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
  const dir = makeTempProject();
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
    "const ROUTING_POLICY_CONTENT = fs.readFileSync(path.join(__dirname, 'runtime-routing.json'));", // WP3: toolkit-owned fixed file (sibling of this module), never request/caller-controlled -- same category as planPath above, read once at module load
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
const R33_EXPORTS_GATE_CLOSED = Object.freeze([
  'DURABLE_ABSENT', 'DURABLE_PENDING', 'DURABLE_PRESENT', 'acquireLock',
  'canonicalJSONStringify', 'classifyDurableRead', 'findResultWithStatus',
  'gitRevParse', 'isValidLockTokenFor', 'listResultFiles', 'publishNoClobber',
  'realpathOrSelf', 'reconcileOneNoClobberTemp', 'releaseLock',
  'runtimeTurnEnvelopeSchema', 'sha256Buffer', 'sha256File', 'sha256String',
  'validateRootConfinement', 'validateRuntimeTurnEnvelope', 'writeAllSync',
].sort());

const R33_EXPORTS_GATE_OPEN = Object.freeze([
  ...R33_EXPORTS_GATE_CLOSED,
  'R33_TUPLE_CORRELATION_KEYS',
  'checkProviderSessionV3Conformance',
  'checkR33ProfileTupleConformance',
  'checkRootProfileV3Conformance',
  'checkRuntimeProfileBindingV2Conformance',
  'providerSessionDigestV3',
  'rootProfileDigestV3',
  'temporalEnvelopeDigestV1',
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

test('R33-GATE: the module exports EXACTLY the 21-key base set unless NODE_ENV=test AND a non-empty capability are both present, in which case it exports EXACTLY 29', () => {
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
  assert.strictEqual(closed.length, 21, 'base surface is 21 exports');
  assert.strictEqual(open.length, 29, 'gated-open surface is 29 exports');
  assert.strictEqual(
    open.length - closed.length, 8,
    'exactly 8 exports are gated; a change to that count is a deliberate decision that must be reflected in both frozen sets above',
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
