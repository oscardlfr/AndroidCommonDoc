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
  fs.writeFileSync(destPath, JSON.stringify(merged));
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
  fs.writeFileSync(destPath, JSON.stringify(merged));
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// One representative case per closed status/rc member (Frozen CLI ABI, PLAN.md
// ~L779-781). Enum order matches the PLAN's own literal order:
// SUCCESS|USAGE_ERROR|INVALID|UNAVAILABLE|TIMEOUT|BLOCKED|CANCELLED|CONFLICT|INTERNAL.
// ─────────────────────────────────────────────────────────────────────────────

test('SUCCESS/rc0: root-init on a fresh coordination root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
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
    writeRawRequest(requestPath, ctx, { request_id: requestId, root_request_id: requestId });

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
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
    const reqPath = path.join(dir, 'transactions', 'ghost-request', 'request.json'); // deliberately never written
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

test('Gap#1 contrast: the identical oversized-but-under-POSIX-cap argv WITHOUT RUNTIME_CONSULTATION_FORCE_PLATFORM (real, non-win32 platform) is NOT rejected by the Windows-cap branch -- it is accepted past the argv-cap check entirely and fails later for an unrelated reason (no such request.json -> CORRELATION_INVALID)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
  try {
    const reqPath = path.join(dir, 'transactions', 'ghost-request', 'request.json'); // deliberately never written
    const result = runTestCli(['cancel', '--coordination-root', dir, '--request', reqPath, '--reason', OVERSIZED_ARGV_VALUE]);
    const data = assertCliResult(result, { command: 'cancel', status: 'INVALID', detail_code: 'CORRELATION_INVALID' });
    assert.notStrictEqual(data.detail_code, 'INVALID_ARGUMENT',
      'must guard the platform branch: this same oversized argv must NOT be rejected by the win32-only total-argv-cap check when the real platform is not win32');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Gap#1: RUNTIME_CONSULTATION_FORCE_PLATFORM is honored ONLY under the test capability -- without NODE_ENV=test/capability, the override is ignored and the real (non-win32) platform applies, so the same oversized-but-under-POSIX argv is accepted past the cap check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcc-node-'));
  try {
    const reqPath = path.join(dir, 'transactions', 'ghost-request', 'request.json'); // deliberately never written
    const result = spawnCli(
      ['cancel', '--coordination-root', dir, '--request', reqPath, '--reason', OVERSIZED_ARGV_VALUE],
      {
        NODE_ENV: undefined,
        RUNTIME_CONSULTATION_TEST_CAPABILITY: undefined,
        RUNTIME_CONSULTATION_FORCE_PLATFORM: 'win32',
      },
    );
    // If the override leaked outside the test capability, this would be
    // INVALID/INVALID_ARGUMENT (the Windows cap firing); instead it must fall
    // through to the same CORRELATION_INVALID the contrast case above hits,
    // proving the override is inert without NODE_ENV=test + capability.
    const data = assertCliResult(result, { command: 'cancel', status: 'INVALID', detail_code: 'CORRELATION_INVALID' });
    assert.notStrictEqual(data.detail_code, 'INVALID_ARGUMENT',
      'RUNTIME_CONSULTATION_FORCE_PLATFORM must be inert without the test capability (isTestCapability() gate), same as --fixed-ids/--fixed-clock');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
