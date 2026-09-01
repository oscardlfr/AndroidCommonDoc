#!/usr/bin/env node
'use strict';

// runtime-host-boundary.test.js -- Sequence151 P1-I observation-only RED
// AUTHENTICITY CORRECTION of Sequence150 (Codex rejection:
// sequence150-codex-audit.json, findings P1I-150-01/02). Full rewrite; both
// findings closed in this same file.
//
// P1I-150-01 (P0, the part owned by this file): every positive test
// previously piped a plain caller-supplied JSON PreToolUse event straight
// into the real hook executable and treated that alone as "genuine" -- but
// any local caller can invoke that executable with any JSON, so this never
// proved host-origin authenticity and directly contradicted this same
// file's own caller-generated-event rejection contract (IDEMPOTENT-FORGED-
// PENDING-FILE-REJECTED). CLOSED: every positive test now calls
// admitHostOrigin() FIRST -- mints a genuine test brand bound to the exact
// observation root (via the sibling scripts/lib/runtime-host-claude.cjs's
// double-gated seam), creates the authenticated composition, and calls its
// beginObservation(preEvent) to create the private admission ticket -- ONLY
// THEN does the test invoke this hook with the matching PreToolUse event.
// Two new negative tests close the finding rigorously: DIRECT-HOOK-WITHOUT-
// PRIOR-ADMISSION-REJECTED-07 (a perfectly well-formed PreToolUse piped
// directly, skipping admitHostOrigin, exits 0 but creates no trusted
// pending/closure evidence) and TICKET-FORGED-FOR-ANOTHER-IDENTITY-
// REJECTED-22 (cloning a genuine ticket's bytes under a DIFFERENT identity's
// digest-keyed path cannot authenticate that different identity). Per this
// order's explicit instruction, no private MAC/key ticket field is frozen
// here -- only rejection, no-clobber and privacy outcomes are asserted (the
// ticket's own field-level contract is scripts/tests/runtime-host-claude.test.js's
// responsibility, the producer side of this same chain).
//
// P1I-150-02 (P1): SETTLE-HARNESS-WRONG-CAPABILITY-DENIED-13 (new) proves a
// non-empty but WRONG RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY value still
// denies both the writer-job and clock harness seams under NODE_ENV=test --
// only the ONE exact fixed value activates them, correcting this file's own
// earlier (inaccurate) claim that presence alone was sufficient.
//
// Preserved from Sequence150 (per this order's point 3): digest-only private
// paths/filenames, genuine PostToolUseFailure as its own hook_event_name,
// actual admitted-Promise writer settlement (never external unlink), the
// gated clock seam (never mutated captured_at bytes), the frozen
// runtime/raw-observation-closure/v1 schema, and zero authority anywhere in
// this surface.
//
// ASSUMED API SHAPE additions over Sequence150 (explicitly flagged; if real
// signatures differ, the affected test REDs on the exact call/value that
// differs) -- see scripts/tests/runtime-host-claude.test.js's own header for
// the producer-side brand/ticket contract this file consumes:
//   Before creating its own pending/<...>.pre.json on a genuine PreToolUse,
//   the boundary must find a matching, valid admission ticket at
//   <observationRoot>/admission/<sessionDigest>__<toolUseDigest>.json (the
//   SAME path scripts/tests/runtime-host-claude.test.js's beginObservation()
//   writes). Absent or identity-mismatched, the hook still exits 0
//   (fail-open at the process layer) but creates no trusted pending/closure
//   evidence at all.
//
// Shared conventions (identical to scripts/tests/runtime-host-claude.test.js):
//   sha256hex(v), CAPABILITY_ENV_VAR='RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY',
//   CAPABILITY_VALUE = the ONE fixed string (exact match required, P1I-150-02),
//   admission/<sessionDigest>__<toolUseDigest>.json ticket path,
//   pending/<sessionDigest>__<toolUseDigest>.{pre,post}.json,
//   closure/<sessionDigest>__<toolUseDigest>.json (frozen schema, unchanged).
//
// Modeled on this repo's own established dual CLI+library hook convention --
// confirmed by direct read before authoring: .claude/hooks/coordination-artifact.js:876
// (`module.exports = {...}`) and :893 (`if (require.main === module) {...}`).
// Test titles use the unique P1I-OBS- prefix, grouped by predicate.
// Deliberately top-level test() calls only (never nested in describe()), so
// an anchored `--test-name-pattern='^P1I-OBS-'` selects them directly.

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const HOOK = path.resolve(__dirname, '../../.claude/hooks/runtime-host-boundary.js');
const HOST_CLAUDE_IMPL = path.resolve(__dirname, '../lib/runtime-host-claude.cjs');

const CAPABILITY_ENV_VAR = 'RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY';
const CAPABILITY_VALUE = 'p1i-observation-red-fixture-capability';
const WRONG_CAPABILITY_VALUE = 'p1i-observation-red-WRONG-capability';
const DIGEST_RE = /^[0-9a-f]{64}$/;
const ISO_MS_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

let boundaryLib = null;
let boundaryLoadError = null;
try {
  boundaryLib = require(HOOK);
} catch (err) {
  boundaryLoadError = err;
}

let hostClaude = null;
let hostClaudeLoadError = null;
try {
  hostClaude = require(HOST_CLAUDE_IMPL);
} catch (err) {
  hostClaudeLoadError = err;
}

function requireBoundaryLib() {
  assert.ok(
    boundaryLib,
    '.claude/hooks/runtime-host-boundary.js must exist and be requireable as an in-process library ' +
    '(dual CLI+library export, matching .claude/hooks/coordination-artifact.js:876,893) for the ' +
    'test-only settlement/clock harness (load error: ' + (boundaryLoadError ? boundaryLoadError.message : 'n/a') + ')',
  );
  return boundaryLib;
}

function requireHostClaude() {
  assert.ok(
    hostClaude,
    'scripts/lib/runtime-host-claude.cjs must exist and be requireable -- P1I-150-01 host-origin ' +
    'admission is a precondition for every positive boundary test in this file (load error: ' +
    (hostClaudeLoadError ? hostClaudeLoadError.message : 'n/a') + ')',
  );
  return hostClaude;
}

/** Sync gate helper: mints the genuine test brand (used by admitHostOrigin() and the wrong-capability probe). */
function withCapabilityEnvSync(fn) {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedCap = process.env[CAPABILITY_ENV_VAR];
  process.env.NODE_ENV = 'test';
  process.env[CAPABILITY_ENV_VAR] = CAPABILITY_VALUE;
  try {
    return fn();
  } finally {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedCap === undefined) delete process.env[CAPABILITY_ENV_VAR]; else process.env[CAPABILITY_ENV_VAR] = savedCap;
  }
}

/** Async gate helper: the boundary's OWN writer-job/clock harness (Sequence150), unchanged except for the rename. */
async function withCapabilityEnvAsync(fn) {
  // async + `await fn()` (never a bare `return fn()`): every call site
  // passes an async callback and awaits the result, so the `finally` restore
  // must wait for the callback's real async work to settle first.
  const savedNodeEnv = process.env.NODE_ENV;
  const savedCap = process.env[CAPABILITY_ENV_VAR];
  process.env.NODE_ENV = 'test';
  process.env[CAPABILITY_ENV_VAR] = CAPABILITY_VALUE;
  try {
    return await fn();
  } finally {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedCap === undefined) delete process.env[CAPABILITY_ENV_VAR]; else process.env[CAPABILITY_ENV_VAR] = savedCap;
  }
}

function mintGenuineBrand(mod, observationRoot) {
  return withCapabilityEnvSync(() => {
    assert.strictEqual(
      typeof mod.__TEST_ONLY__mintHostAdapterBrand,
      'function',
      'runtime-host-claude.cjs must export __TEST_ONLY__mintHostAdapterBrand({observationRoot})',
    );
    const brand = mod.__TEST_ONLY__mintHostAdapterBrand({ observationRoot });
    assert.ok(brand, 'the gated test seam must return a genuine, usable brand value');
    return brand;
  });
}

/**
 * P1I-150-01: establishes host-origin admission BEFORE this file invokes the
 * boundary hook for the same event -- mints a genuine brand bound to `root`,
 * creates the authenticated composition, and calls beginObservation(pre) to
 * create the private admission ticket the boundary now requires.
 */
function admitHostOrigin(pre, observationRoot) {
  const mod = requireHostClaude();
  const brand = mintGenuineBrand(mod, observationRoot);
  assert.strictEqual(typeof mod.createHostComposition, 'function', 'runtime-host-claude.cjs must export createHostComposition(hostAdapterBrand)');
  const composition = mod.createHostComposition(brand);
  assert.ok(composition && typeof composition.beginObservation === 'function', 'createHostComposition(<genuine brand>) must return a usable composition');
  const handle = composition.beginObservation(pre);
  assert.ok(handle !== null && handle !== undefined, 'beginObservation(pre) must return a handle -- and, as its disk side effect, the admission ticket the boundary requires');
  return { mod, brand, composition, handle };
}

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rhb-test-'));
}

function digestKey(sessionDigest, toolUseDigest) { return sessionDigest + '__' + toolUseDigest; }
function admissionDir(root) { return path.join(root, 'admission'); }
function pendingDir(root) { return path.join(root, 'pending'); }
function closureDir(root) { return path.join(root, 'closure'); }
function admissionTicketPath(root, sessionDigest, toolUseDigest) { return path.join(admissionDir(root), digestKey(sessionDigest, toolUseDigest) + '.json'); }
function pendingPrePath(root, sessionDigest, toolUseDigest) { return path.join(pendingDir(root), digestKey(sessionDigest, toolUseDigest) + '.pre.json'); }
function pendingPostPath(root, sessionDigest, toolUseDigest) { return path.join(pendingDir(root), digestKey(sessionDigest, toolUseDigest) + '.post.json'); }
function closurePath(root, sessionDigest, toolUseDigest) { return path.join(closureDir(root), digestKey(sessionDigest, toolUseDigest) + '.json'); }

function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return undefined;
  const raw = fs.readFileSync(p, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return { __parseError: true, raw };
  }
}

function genuineToolUseId() {
  return 'toolu_' + crypto.randomBytes(8).toString('hex');
}

function basePre(overrides = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'sess-boundary-' + crypto.randomBytes(4).toString('hex'),
    tool_use_id: genuineToolUseId(),
    tool_name: 'Agent',
    tool_input: { prompt: 'observation-only boundary fixture' },
    cwd: process.cwd(),
    ...overrides,
  };
}

function basePost(pre, overrides = {}) {
  return {
    hook_event_name: 'PostToolUse',
    session_id: pre.session_id,
    tool_use_id: pre.tool_use_id,
    tool_name: pre.tool_name,
    tool_response: { ok: true },
    ...overrides,
  };
}

/** A GENUINE, distinct hook_event_name -- never PostToolUse + an error field. */
function basePostToolUseFailure(pre, overrides = {}) {
  return {
    hook_event_name: 'PostToolUseFailure',
    session_id: pre.session_id,
    tool_use_id: pre.tool_use_id,
    tool_name: pre.tool_name,
    error: { message: 'genuine PostToolUseFailure fixture, never a PostToolUse tool_response.error' },
    ...overrides,
  };
}

function runHook(payload, { observationRoot, extraEnv = {}, timeoutMs = 10000 } = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: observationRoot,
    RUNTIME_HOST_OBSERVATION_ROOT: observationRoot,
    ...extraEnv,
  };
  return spawnSync('node', [HOOK], { input, env, encoding: 'utf8', timeout: timeoutMs });
}

function runHookExpectOpen(payload, opts) {
  const result = runHook(payload, opts);
  assert.strictEqual(
    result.status,
    0,
    'runtime-host-boundary.js must fail OPEN like every other hook in .claude/hooks/ (never block/crash the real tool call): exit=' +
      result.status + ' stderr=' + String(result.stderr || '').slice(0, 300),
  );
  return result;
}

function assertClockHarnessAcknowledged(result, label) {
  assert.strictEqual(
    result && result.ok,
    true,
    label + ': __TEST_ONLY__setClockOverride() must explicitly acknowledge activation with {ok:true}; ' +
      'otherwise a wrong-capability denial cannot be distinguished from an override that silently took effect',
  );
}

function assertValidRawClosure(record, label) {
  assert.ok(record !== undefined, label + ': closure record must exist on disk');
  assert.ok(record && typeof record === 'object' && !record.__parseError, label + ': closure record must be valid JSON: ' + JSON.stringify(record));
  assert.deepStrictEqual(
    Object.keys(record).sort(),
    [
      'all_identified_writers_settled', 'authority_records_preserved', 'closed_at',
      'launch_digest', 'observation_set_digest', 'owned_capture_manifest_digest',
      'raw_observations_removed', 'schema',
    ].sort(),
    label + ': closure record must have EXACTLY the frozen runtime/raw-observation-closure/v1 field set (sequence123-codex-r129-binding.md section 3), no more and no less',
  );
  assert.strictEqual(record.schema, 'runtime/raw-observation-closure/v1', label + ': schema literal must match the frozen binding exactly');
  assert.strictEqual(record.all_identified_writers_settled, true, label);
  assert.strictEqual(record.raw_observations_removed, true, label);
  assert.strictEqual(record.authority_records_preserved, true, label);
  assert.match(record.closed_at, ISO_MS_Z_RE, label + ': closed_at must be UTC ISO8601 with milliseconds and Z, got ' + record.closed_at);
  for (const digestField of ['launch_digest', 'observation_set_digest', 'owned_capture_manifest_digest']) {
    assert.match(record[digestField], DIGEST_RE, label + ': ' + digestField + ' must be a 64-lowercase-hex Digest, got ' + record[digestField]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CORRELATE -- every positive case now begins with admitHostOrigin() (P1I-150-01).
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-BOUNDARY-CORRELATE-PRE-THEN-POST-SUCCESS-CLOSES-01 RED: after genuine host-origin admission, a matching PreToolUse then PostToolUse produces one valid, digest-keyed closure record', () => {
  const root = mkRoot();
  try {
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    runHookExpectOpen(pre, { observationRoot: root });
    assert.ok(fs.existsSync(pendingPrePath(root, sDig, tDig)), 'precondition: an admitted, ticket-backed PreToolUse must leave a digest-keyed raw pending capture');

    runHookExpectOpen(basePost(pre), { observationRoot: root });
    assertValidRawClosure(readJsonIfExists(closurePath(root, sDig, tDig)), 'happy-path success closure');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-CORRELATE-GENUINE-POSTTOOLUSEFAILURE-EVENT-CLOSES-02 RED: after genuine host-origin admission, an ACTUAL hook_event_name:"PostToolUseFailure" event (never PostToolUse+error field) also produces a valid closure record', () => {
  const root = mkRoot();
  try {
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    runHookExpectOpen(pre, { observationRoot: root });
    assert.ok(fs.existsSync(pendingPrePath(root, sDig, tDig)), 'precondition: raw pending capture must exist');

    const failure = basePostToolUseFailure(pre);
    assert.strictEqual(failure.hook_event_name, 'PostToolUseFailure', 'test fixture sanity: this is a genuinely distinct event name, not PostToolUse');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(failure, 'tool_response'), false, 'test fixture sanity: a real PostToolUseFailure event carries no tool_response at all');
    runHookExpectOpen(failure, { observationRoot: root });
    assertValidRawClosure(readJsonIfExists(closurePath(root, sDig, tDig)), 'genuine PostToolUseFailure closure');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-CORRELATE-DUPLICATE-POST-DOES-NOT-OVERWRITE-03 RED: a second, CONFLICTING PostToolUse for an already-closed tool_use_id must never overwrite or recompute the original settled closure', () => {
  const root = mkRoot();
  try {
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    runHookExpectOpen(pre, { observationRoot: root });
    runHookExpectOpen(basePost(pre), { observationRoot: root });
    const firstClosure = readJsonIfExists(closurePath(root, sDig, tDig));
    assertValidRawClosure(firstClosure, 'precondition: first closure');

    const conflictingPost = basePost(pre, { tool_response: { error: 'a conflicting, later duplicate must not be trusted' } });
    runHookExpectOpen(conflictingPost, { observationRoot: root });
    const secondClosure = readJsonIfExists(closurePath(root, sDig, tDig));
    assertValidRawClosure(secondClosure, 'closure after conflicting duplicate');
    assert.deepStrictEqual(secondClosure, firstClosure, 'a conflicting duplicate PostToolUse must never change the already-settled closure record');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-CORRELATE-CROSS-SESSION-REJECTED-04 RED: a PostToolUse whose tool_use_id matches but whose session_id differs from the admitted PreToolUse must never correlate', () => {
  const root = mkRoot();
  try {
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    runHookExpectOpen(pre, { observationRoot: root });
    assert.ok(fs.existsSync(pendingPrePath(root, sDig, tDig)), 'precondition: raw pending capture must exist');

    const foreignSessionPost = basePost(pre, { session_id: 'sess-boundary-foreign-' + crypto.randomBytes(4).toString('hex') });
    const foreignSDig = sha256hex(foreignSessionPost.session_id);
    runHookExpectOpen(foreignSessionPost, { observationRoot: root });

    assert.strictEqual(readJsonIfExists(closurePath(root, sDig, tDig)), undefined, 'no closure may appear under the ORIGINAL session digest key');
    assert.strictEqual(readJsonIfExists(closurePath(root, foreignSDig, tDig)), undefined, 'no closure may appear under the FOREIGN session digest key either -- tool_use_id alone must never be sufficient');
    assert.ok(fs.existsSync(pendingPrePath(root, sDig, tDig)), 'the original raw pending capture must be PRESERVED, never consumed by an illegitimate cross-session post');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-CORRELATE-MISMATCHED-TOOL-NAME-REJECTED-05 RED: a PostToolUse reporting a DIFFERENT tool_name than the admitted PreToolUse for the same identity must fail closed as an integrity mismatch', () => {
  const root = mkRoot();
  try {
    const pre = basePre({ tool_name: 'Agent' });
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    runHookExpectOpen(pre, { observationRoot: root });
    assert.ok(fs.existsSync(pendingPrePath(root, sDig, tDig)), 'precondition: raw pending capture must exist');

    const mismatchedPost = basePost(pre, { tool_name: 'Bash' });
    runHookExpectOpen(mismatchedPost, { observationRoot: root });
    assert.strictEqual(readJsonIfExists(closurePath(root, sDig, tDig)), undefined, 'a tool_name mismatch between Pre and Post must never be closed');
    assert.ok(fs.existsSync(pendingPrePath(root, sDig, tDig)), 'the raw pending capture must be preserved, not silently discarded, when the mismatch is detected');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-CORRELATE-POST-WITHOUT-PRIOR-PRE-REJECTED-06 RED: a bare PostToolUse with no preceding admission or PreToolUse for its identity can never be correlated or closed', () => {
  const root = mkRoot();
  try {
    const orphanPost = basePost(basePre());
    const sDig = sha256hex(orphanPost.session_id);
    const tDig = sha256hex(orphanPost.tool_use_id);
    runHookExpectOpen(orphanPost, { observationRoot: root });
    assert.strictEqual(readJsonIfExists(closurePath(root, sDig, tDig)), undefined, 'a PostToolUse with no prior admission or PreToolUse must never produce a closure');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-DIRECT-HOOK-WITHOUT-PRIOR-ADMISSION-REJECTED-07 RED: a perfectly well-formed PreToolUse piped DIRECTLY into the hook, skipping host-origin admission entirely, exits 0 but creates no trusted pending or closure evidence -- P1I-150-01', () => {
  const root = mkRoot();
  try {
    const pre = basePre(); // deliberately NO admitHostOrigin(pre, root) call
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    runHookExpectOpen(pre, { observationRoot: root });
    assert.strictEqual(fs.existsSync(pendingPrePath(root, sDig, tDig)), false, 'a direct, unadmitted PreToolUse invocation must never create a trusted pending capture -- a caller who can merely pipe JSON into this executable is not proof of host origin');

    runHookExpectOpen(basePost(pre), { observationRoot: root });
    assert.strictEqual(readJsonIfExists(closurePath(root, sDig, tDig)), undefined, 'without a genuine admission ticket, no closure evidence may ever be produced, even when Pre and Post otherwise correlate perfectly');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONFINE (unaffected in outcome by this correction; now begins with
// admitHostOrigin()).
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-BOUNDARY-CONFINE-RAW-UNDER-OWNED-ROOT-ONLY-08 RED: raw captures and closure records land ONLY under the explicitly owned RUNTIME_HOST_OBSERVATION_ROOT, never under the ordinary CLAUDE_PROJECT_DIR project area', () => {
  const observationRoot = mkRoot();
  const ordinaryProjectDir = mkRoot();
  try {
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, observationRoot);
    const preResult = runHook(pre, { observationRoot: undefined, extraEnv: { CLAUDE_PROJECT_DIR: ordinaryProjectDir, RUNTIME_HOST_OBSERVATION_ROOT: observationRoot } });
    assert.strictEqual(preResult.status, 0, 'hook must fail open even with a distinct project dir vs. observation root: ' + preResult.stderr);
    assert.ok(fs.existsSync(pendingPrePath(observationRoot, sDig, tDig)), 'precondition: raw capture must exist under the OWNED observation root');

    const postResult = runHook(basePost(pre), { observationRoot: undefined, extraEnv: { CLAUDE_PROJECT_DIR: ordinaryProjectDir, RUNTIME_HOST_OBSERVATION_ROOT: observationRoot } });
    assert.strictEqual(postResult.status, 0, 'hook must fail open: ' + postResult.stderr);
    assertValidRawClosure(readJsonIfExists(closurePath(observationRoot, sDig, tDig)), 'closure under the owned root');

    const leakedIntoOrdinaryProjectDir = fs.existsSync(path.join(ordinaryProjectDir, '.androidcommondoc', 'observation'))
      || fs.existsSync(path.join(ordinaryProjectDir, 'pending'))
      || fs.existsSync(path.join(ordinaryProjectDir, 'closure'))
      || fs.existsSync(path.join(ordinaryProjectDir, 'admission'));
    assert.strictEqual(leakedIntoOrdinaryProjectDir, false, 'no raw capture, closure or admission artifact may ever be written under the ordinary (non-owned) CLAUDE_PROJECT_DIR area');
  } finally {
    fs.rmSync(observationRoot, { recursive: true, force: true });
    fs.rmSync(ordinaryProjectDir, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-CONFINE-OVERSIZED-INPUT-BOUNDED-09 RED: a PreToolUse whose tool_input exceeds the frozen 64KiB bound never lands verbatim on disk and never crashes/hangs the hook', () => {
  const root = mkRoot();
  const MAX_RAW_BYTES = 65536; // 64KiB -- sequence123-codex-r129-binding.md section 1, reused verbatim
  try {
    const oversizedPre = basePre({ tool_input: { big: 'x'.repeat(MAX_RAW_BYTES + 4096) } });
    const sDig = sha256hex(oversizedPre.session_id);
    const tDig = sha256hex(oversizedPre.tool_use_id);
    admitHostOrigin(oversizedPre, root);
    const result = runHookExpectOpen(oversizedPre, { observationRoot: root });
    assert.strictEqual(result.signal, null, 'the hook must never be killed by a signal (e.g. a crash) on oversized input');

    const capturePath = pendingPrePath(root, sDig, tDig);
    if (fs.existsSync(capturePath)) {
      const size = fs.statSync(capturePath).size;
      assert.ok(size <= MAX_RAW_BYTES, 'a raw capture that IS written must be bounded to <= 64KiB, got ' + size + ' bytes');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-CONFINE-DEADLINE-WITHIN-BOUND-STILL-CLOSES-10 RED: with the gated test clock advanced only a small amount past capture, the SAME correlation still closes normally (bounded, not merely "always expire")', async () => {
  const lib = requireBoundaryLib();
  const root = mkRoot();
  try {
    assert.strictEqual(typeof lib.__TEST_ONLY__setClockOverride, 'function', 'runtime-host-boundary.js must export __TEST_ONLY__setClockOverride(), gated the same way as the writer-job harness');
    await withCapabilityEnvAsync(async () => {
      let now = Date.parse('2026-01-01T00:00:00.000Z');
        assertClockHarnessAcknowledged(
          lib.__TEST_ONLY__setClockOverride(() => new Date(now)),
          'correct-capability clock setup',
        );
      try {
        const pre = basePre();
        const sDig = sha256hex(pre.session_id);
        const tDig = sha256hex(pre.tool_use_id);
        admitHostOrigin(pre, root);
        assert.strictEqual((await lib.processPreToolUse(pre, { observationRoot: root })).admitted, true, 'precondition: an admitted, ticket-backed PreToolUse must be accepted under the gated clock');
        now += 1; // one millisecond -- comfortably within ANY reasonable bound
        const post = basePost(pre);
        const outcome = await lib.processPostToolUse(post, { observationRoot: root });
        assert.strictEqual(outcome.closed, true, 'a 1ms-old pending capture must still close normally -- the bound must be selective, not immediate');
        assertValidRawClosure(readJsonIfExists(closurePath(root, sDig, tDig)), 'closure within bound');
      } finally {
        assertClockHarnessAcknowledged(
          lib.__TEST_ONLY__setClockOverride(null),
          'correct-capability clock reset',
        );
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-CONFINE-DEADLINE-EXCEEDED-FAILS-CLOSED-11 RED: with the gated test clock advanced far past capture, the pending capture is treated as expired/uncertain and fails closed -- proven via clock control, never by editing captured_at bytes', async () => {
  const lib = requireBoundaryLib();
  const root = mkRoot();
  try {
    assert.strictEqual(typeof lib.__TEST_ONLY__setClockOverride, 'function', 'runtime-host-boundary.js must export __TEST_ONLY__setClockOverride()');
    await withCapabilityEnvAsync(async () => {
      let now = Date.parse('2026-01-01T00:00:00.000Z');
        assertClockHarnessAcknowledged(
          lib.__TEST_ONLY__setClockOverride(() => new Date(now)),
          'correct-capability clock setup',
        );
      try {
        const pre = basePre();
        const sDig = sha256hex(pre.session_id);
        const tDig = sha256hex(pre.tool_use_id);
        admitHostOrigin(pre, root);
        const preOutcome = await lib.processPreToolUse(pre, { observationRoot: root });
        assert.strictEqual(preOutcome.admitted, true, 'precondition: an admitted, ticket-backed PreToolUse must be accepted under the gated clock');
        const rawBefore = fs.readFileSync(pendingPrePath(root, sDig, tDig));

        now += 1000 * 60 * 60 * 24 * 365; // one full year -- comfortably beyond any reasonable bound
        const post = basePost(pre);
        const outcome = await lib.processPostToolUse(post, { observationRoot: root });
        assert.strictEqual(outcome.closed, false, 'a capture aged far beyond any reasonable bound must fail closed, never close as if freshly settled');
        assert.strictEqual(readJsonIfExists(closurePath(root, sDig, tDig)), undefined, 'no closure record may exist for an expired capture');

        const rawAfter = fs.readFileSync(pendingPrePath(root, sDig, tDig));
        assert.deepStrictEqual(rawAfter, rawBefore, 'the pending capture bytes themselves must never be mutated by this test to simulate time -- only the injected clock moves');
      } finally {
        assertClockHarnessAcknowledged(
          lib.__TEST_ONLY__setClockOverride(null),
          'correct-capability clock reset',
        );
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SETTLE -- real admitted writer-job settlement via the gated test-only
// in-process harness (unaffected in mechanism by this correction; adds the
// P1I-150-02 wrong-capability negative case).
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-BOUNDARY-SETTLE-HARNESS-ABSENT-OUTSIDE-TEST-MODE-12 RED: the writer-job and clock test-only harness seams are unavailable/inert outside NODE_ENV=test + the capability env var, proven in a clean-room child process', () => {
  const script =
    `const mod = require(${JSON.stringify(HOOK)});
     const hasJob = typeof mod.__TEST_ONLY__admitFinalWriterJob === 'function';
     const hasClock = typeof mod.__TEST_ONLY__setClockOverride === 'function';
     let jobDenied = true, clockDenied = true;
     if (hasJob) { try { const r = mod.__TEST_ONLY__admitFinalWriterJob({observationRoot:'/nonexistent'}, 'a'.repeat(64), 'b'.repeat(64), Promise.resolve()); jobDenied = !(r && r.ok); } catch { jobDenied = true; } }
     if (hasClock) { try { const r = mod.__TEST_ONLY__setClockOverride(() => new Date()); clockDenied = !(r && r.ok); } catch { clockDenied = true; } }
     console.log(JSON.stringify({ jobDenied: !hasJob || jobDenied, clockDenied: !hasClock || clockDenied }));`;
  const cleanEnv = { ...process.env };
  delete cleanEnv.NODE_ENV;
  delete cleanEnv[CAPABILITY_ENV_VAR];
  const result = spawnSync(process.execPath, ['-e', script], { env: cleanEnv, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, 'clean-room probe process itself must run to completion: ' + result.stderr);
  let parsed;
  try {
    parsed = JSON.parse((result.stdout || '').trim());
  } catch {
    assert.fail('clean-room probe must print a parseable JSON verdict; got stdout=' + result.stdout + ' stderr=' + result.stderr);
  }
  assert.strictEqual(parsed.jobDenied, true, 'outside the test gate, the writer-job harness must never admit a job');
  assert.strictEqual(parsed.clockDenied, true, 'outside the test gate, the clock override seam must never take effect');
});

test('P1I-OBS-BOUNDARY-SETTLE-HARNESS-WRONG-CAPABILITY-DENIED-13 RED: NODE_ENV=test WITH a non-empty but WRONG capability value still denies both harness seams -- P1I-150-02, only the exact fixed capability activates them', () => {
  const script =
    `const mod = require(${JSON.stringify(HOOK)});
     const hasJob = typeof mod.__TEST_ONLY__admitFinalWriterJob === 'function';
     const hasClock = typeof mod.__TEST_ONLY__setClockOverride === 'function';
     let jobDenied = true, clockDenied = true;
     if (hasJob) { try { const r = mod.__TEST_ONLY__admitFinalWriterJob({observationRoot:'/nonexistent'}, 'a'.repeat(64), 'b'.repeat(64), Promise.resolve()); jobDenied = !(r && r.ok); } catch { jobDenied = true; } }
     if (hasClock) { try { const r = mod.__TEST_ONLY__setClockOverride(() => new Date()); clockDenied = !(r && r.ok); } catch { clockDenied = true; } }
     console.log(JSON.stringify({ jobDenied: !hasJob || jobDenied, clockDenied: !hasClock || clockDenied }));`;
  const wrongEnv = { ...process.env, NODE_ENV: 'test', [CAPABILITY_ENV_VAR]: WRONG_CAPABILITY_VALUE };
  const result = spawnSync(process.execPath, ['-e', script], { env: wrongEnv, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, 'probe process must run to completion: ' + result.stderr);
  let parsed;
  try {
    parsed = JSON.parse((result.stdout || '').trim());
  } catch {
    assert.fail('probe must print a parseable JSON verdict; got stdout=' + result.stdout + ' stderr=' + result.stderr);
  }
  assert.strictEqual(parsed.jobDenied, true, 'a wrong non-empty capability value must still deny the writer-job harness -- an implementation accepting any non-empty value would wrongly pass here');
  assert.strictEqual(parsed.clockDenied, true, 'a wrong non-empty capability value must still deny the clock override seam');
});

test('P1I-OBS-BOUNDARY-SETTLE-PENDING-WRITER-JOB-BLOCKS-CLOSURE-14 RED: an admitted-but-unresolved final-writer job blocks closure even though Pre and Post themselves correlate correctly', async () => {
  const lib = requireBoundaryLib();
  const root = mkRoot();
  try {
    await withCapabilityEnvAsync(async () => {
      const pre = basePre();
      const sDig = sha256hex(pre.session_id);
      const tDig = sha256hex(pre.tool_use_id);
      admitHostOrigin(pre, root);
      assert.strictEqual((await lib.processPreToolUse(pre, { observationRoot: root })).admitted, true, 'precondition: an admitted, ticket-backed PreToolUse must be accepted');

      assert.strictEqual(typeof lib.__TEST_ONLY__admitFinalWriterJob, 'function', 'runtime-host-boundary.js must export __TEST_ONLY__admitFinalWriterJob(ctx, sessionDigest, toolUseDigest, jobPromise)');
      let neverResolve;
      const pendingJob = new Promise((resolve) => { neverResolve = resolve; });
      const admitResult = lib.__TEST_ONLY__admitFinalWriterJob({ observationRoot: root }, sDig, tDig, pendingJob);
      assert.strictEqual(admitResult && admitResult.ok, true, 'the gated harness must genuinely admit the job: ' + JSON.stringify(admitResult));

      const outcome = await lib.processPostToolUse(basePost(pre), { observationRoot: root });
      assert.strictEqual(outcome.closed, false, 'closure must be denied while an admitted final-writer job remains unresolved');
      assert.strictEqual(readJsonIfExists(closurePath(root, sDig, tDig)), undefined, 'no closure record may exist while settlement is uncertain');
      assert.ok(fs.existsSync(pendingPrePath(root, sDig, tDig)), 'the raw set must be preserved while the admitted job is unresolved');

      neverResolve(); // avoid leaving a dangling unhandled promise across tests
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-SETTLE-CLOSURE-AFTER-JOB-RESOLVED-AND-JOINED-15 RED: once the exact admitted job genuinely resolves and is joined, the SAME correlation now closes successfully -- proves the prior block was caused by real unsettlement, not an unrelated defect', async () => {
  const lib = requireBoundaryLib();
  const root = mkRoot();
  try {
    await withCapabilityEnvAsync(async () => {
      const pre = basePre();
      const sDig = sha256hex(pre.session_id);
      const tDig = sha256hex(pre.tool_use_id);
      admitHostOrigin(pre, root);
      assert.strictEqual((await lib.processPreToolUse(pre, { observationRoot: root })).admitted, true, 'precondition: an admitted, ticket-backed PreToolUse must be accepted');

      let resolveJob;
      const job = new Promise((resolve) => { resolveJob = resolve; });
      const admitResult = lib.__TEST_ONLY__admitFinalWriterJob({ observationRoot: root }, sDig, tDig, job);
      assert.strictEqual(admitResult && admitResult.ok, true, 'the gated harness must genuinely admit the job');

      const blockedOutcome = await lib.processPostToolUse(basePost(pre), { observationRoot: root });
      assert.strictEqual(blockedOutcome.closed, false, 'precondition: closure must still be blocked before the job resolves');

      resolveJob({ settled: true });
      await job; // genuinely join/await the EXACT admitted job, never a fabricated settlement signal

      const finalOutcome = await lib.processPostToolUse(basePost(pre), { observationRoot: root });
      assert.strictEqual(finalOutcome.closed, true, 'closure must succeed once the exact admitted job has genuinely settled and been joined');
      assertValidRawClosure(readJsonIfExists(closurePath(root, sDig, tDig)), 'closure after genuine settlement');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CLOSURE (frozen schema unaffected by this correction; now begins with
// admitHostOrigin()).
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-BOUNDARY-CLOSURE-EXACT-SCHEMA-FIELDS-16 RED: a successful closure record has EXACTLY the frozen runtime/raw-observation-closure/v1 field set with correctly-shaped values', () => {
  const root = mkRoot();
  try {
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    runHookExpectOpen(pre, { observationRoot: root });
    runHookExpectOpen(basePost(pre), { observationRoot: root });
    assertValidRawClosure(readJsonIfExists(closurePath(root, sDig, tDig)), 'exact-schema closure');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-CLOSURE-REMOVES-RAW-PENDING-17 RED: after a proven successful closure, the temporary raw pending captures for that identity no longer exist on disk', () => {
  const root = mkRoot();
  try {
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    runHookExpectOpen(pre, { observationRoot: root });
    assert.ok(fs.existsSync(pendingPrePath(root, sDig, tDig)), 'precondition: raw pre capture must exist before closure');

    runHookExpectOpen(basePost(pre), { observationRoot: root });
    assertValidRawClosure(readJsonIfExists(closurePath(root, sDig, tDig)), 'precondition: closure must succeed');

    assert.strictEqual(fs.existsSync(pendingPrePath(root, sDig, tDig)), false, 'raw pre capture must be removed after proven settlement');
    assert.strictEqual(fs.existsSync(pendingPostPath(root, sDig, tDig)), false, 'raw post capture must be removed after proven settlement');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-CLOSURE-PRESERVES-UNRELATED-AUTHORITY-RECORD-18 RED: an unrelated immutable-authority-shaped fixture living near the observation root is never touched by a full correlate-and-close cycle', () => {
  const root = mkRoot();
  try {
    const authorityPath = path.join(root, 'authority', 'main-binding.json');
    fs.mkdirSync(path.dirname(authorityPath), { recursive: true });
    const authorityBytes = JSON.stringify({ schema: 'runtime/main-binding/v2', note: 'immutable authority fixture, must remain byte-identical' });
    fs.writeFileSync(authorityPath, authorityBytes);

    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    runHookExpectOpen(pre, { observationRoot: root });
    runHookExpectOpen(basePost(pre), { observationRoot: root });
    assertValidRawClosure(readJsonIfExists(closurePath(root, sDig, tDig)), 'precondition: closure must succeed');

    assert.strictEqual(fs.readFileSync(authorityPath, 'utf8'), authorityBytes, 'an unrelated immutable authority record must remain byte-for-byte unchanged after the full observation lifecycle');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTENT (unaffected by this correction; forged/missing-identity cases
// deliberately do NOT call admitHostOrigin(), since they test what happens
// WITHOUT genuine admission).
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-BOUNDARY-IDEMPOTENT-REPEATED-CLOSE-SAME-RESULT-19 RED: re-delivering the exact same genuine PostToolUse after closure returns the identical settled closure record, never a newly recomputed one', () => {
  const root = mkRoot();
  try {
    const pre = basePre();
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    admitHostOrigin(pre, root);
    runHookExpectOpen(pre, { observationRoot: root });
    const post = basePost(pre);
    runHookExpectOpen(post, { observationRoot: root });
    const firstClosure = readJsonIfExists(closurePath(root, sDig, tDig));
    assertValidRawClosure(firstClosure, 'precondition: first closure');

    runHookExpectOpen(post, { observationRoot: root });
    const secondClosure = readJsonIfExists(closurePath(root, sDig, tDig));
    assertValidRawClosure(secondClosure, 'closure after idempotent replay');
    assert.deepStrictEqual(secondClosure, firstClosure, 'a repeated close must return the exact same settled result, including an unchanged closed_at timestamp -- never a fresh recomputation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-IDEMPOTENT-FORGED-PENDING-FILE-REJECTED-20 RED: a hand-placed pending capture that was never genuinely admitted through the hook\'s own PreToolUse invocation must never be trusted -- a caller-generated event is not accepted', () => {
  const root = mkRoot();
  try {
    const sessionId = 'sess-boundary-forged';
    const toolUseId = genuineToolUseId();
    const sDig = sha256hex(sessionId);
    const tDig = sha256hex(toolUseId);
    fs.mkdirSync(pendingDir(root), { recursive: true });
    fs.writeFileSync(
      pendingPrePath(root, sDig, tDig),
      JSON.stringify({ schema: 'not-the-real-schema', session_digest: sDig, tool_use_digest: tDig }),
    );

    const genuinePost = basePost({ session_id: sessionId, tool_use_id: toolUseId, tool_name: 'Agent' });
    runHookExpectOpen(genuinePost, { observationRoot: root });
    assert.strictEqual(
      readJsonIfExists(closurePath(root, sDig, tDig)),
      undefined,
      'a forged/caller-generated pending file must never be treated as a genuine admission, even when a real PostToolUse later references the same identity',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-BOUNDARY-IDEMPOTENT-MISSING-IDENTITY-NOT-INFERRED-21 RED: a PreToolUse/PostToolUse pair with session_id/tool_use_id fields OMITTED entirely, sent directly with no admission attempt, can never correlate or close -- absent identity is never inferred or defaulted', () => {
  const root = mkRoot();
  try {
    const preNoSession = basePre();
    delete preNoSession.session_id;
    runHookExpectOpen(preNoSession, { observationRoot: root });

    const postNoSession = basePost({ ...preNoSession, session_id: undefined });
    delete postNoSession.session_id;
    runHookExpectOpen(postNoSession, { observationRoot: root });

    const closureEntries = fs.existsSync(closureDir(root)) ? fs.readdirSync(closureDir(root)) : [];
    assert.strictEqual(closureEntries.length, 0, 'no closure record of any kind may be produced when required identity is missing -- never inferred from partial data, and (per P1I-150-01) doubly so since no admission ticket exists either');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TICKET -- P1I-150-01, the boundary's own consumer-side authenticity check.
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-BOUNDARY-TICKET-FORGED-FOR-ANOTHER-IDENTITY-REJECTED-22 RED: cloning a genuine admission ticket\'s bytes under a DIFFERENT identity\'s digest-keyed path cannot authenticate a boundary event for that different identity', () => {
  const root = mkRoot();
  try {
    const preA = basePre();
    admitHostOrigin(preA, root);
    const sDigA = sha256hex(preA.session_id);
    const tDigA = sha256hex(preA.tool_use_id);
    const ticketPathA = admissionTicketPath(root, sDigA, tDigA);
    assert.ok(fs.existsSync(ticketPathA), 'precondition: a genuine admission ticket for identity A must exist');
    const ticketBytesA = fs.readFileSync(ticketPathA);

    const preB = basePre(); // a genuinely DIFFERENT identity, never admitted
    const sDigB = sha256hex(preB.session_id);
    const tDigB = sha256hex(preB.tool_use_id);
    const ticketPathB = admissionTicketPath(root, sDigB, tDigB);
    fs.mkdirSync(path.dirname(ticketPathB), { recursive: true });
    fs.writeFileSync(ticketPathB, ticketBytesA); // clone A's genuine ticket bytes under B's path

    runHookExpectOpen(preB, { observationRoot: root });
    assert.strictEqual(
      fs.existsSync(pendingPrePath(root, sDigB, tDigB)),
      false,
      'a ticket whose own content still references identity A must never authenticate a PreToolUse for identity B merely because it was cloned under B\'s digest-keyed filename',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PRIVACY (unaffected in intent by this correction; the generic filesystem
// walk now also implicitly covers the new admission/ directory).
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-BOUNDARY-PRIVACY-NO-RAW-ID-IN-FILENAMES-OR-CONTENT-23 RED: after a full genuine admit-correlate-and-close cycle, no file path or file content anywhere under the observation root (including the admission/ ticket directory) contains the raw session_id or raw tool_use_id substring', () => {
  const root = mkRoot();
  try {
    const pre = basePre({
      session_id: 'sess-privacy-probe-' + crypto.randomBytes(8).toString('hex'),
      tool_use_id: 'toolu_privacy_probe_' + crypto.randomBytes(8).toString('hex'),
    });
    admitHostOrigin(pre, root);
    runHookExpectOpen(pre, { observationRoot: root });
    runHookExpectOpen(basePost(pre), { observationRoot: root });

    const offenders = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full.includes(pre.session_id) || full.includes(pre.tool_use_id)) offenders.push(full + ' (directory name)');
          walk(full);
        } else {
          if (full.includes(pre.session_id) || full.includes(pre.tool_use_id)) offenders.push(full + ' (file name)');
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes(pre.session_id)) offenders.push(full + ' (content contains raw session_id)');
          if (content.includes(pre.tool_use_id)) offenders.push(full + ' (content contains raw tool_use_id)');
        }
      }
    };
    walk(root);
    assert.deepStrictEqual(offenders, [], 'no path or content anywhere under the observation root (pending/, closure/ or admission/) may contain a raw session_id/tool_use_id substring: ' + JSON.stringify(offenders));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1IA-IBIND-BOUNDARY-RECORD-V2-24 RED: the gated boundary producer emits exactly one no-clobber zero-authority Task/Agent digest record and an exit-2 denial result', () => {
  const lib = requireBoundaryLib();
  assert.strictEqual(typeof lib.__TEST_ONLY__produceIbindDenyRecord, 'function', 'production boundary must expose the exact gated v2 record-producer seam');
  const root = mkRoot();
  const destination = path.join(root, 'automatic-capture.jsonl');
  const event = basePre({ tool_name: 'Agent' });
  try {
    const first = withCapabilityEnvSync(() => lib.__TEST_ONLY__produceIbindDenyRecord(event, { destination, matcherToolName: 'Task' }));
    assert.deepStrictEqual(first, { denied: true, exitCode: 2, denyLiteral: 'IBIND_DENY_TASK_V1' });
    const rows = fs.readFileSync(destination, 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(rows.length, 1, 'exactly one automatic record is permitted');
    assert.deepStrictEqual({
      schema: rows[0].schema,
      hookEventName: rows[0].hookEventName,
      matcherToolName: rows[0].matcherToolName,
      payloadToolName: rows[0].payloadToolName,
      sessionIdSha256: rows[0].sessionIdSha256,
      toolUseIdSha256: rows[0].toolUseIdSha256,
      denyLiteral: rows[0].denyLiteral,
      authority: rows[0].authority,
    }, {
      schema: 'sequence1-ibind-deny-hook-record-v2',
      hookEventName: 'PreToolUse',
      matcherToolName: 'Task',
      payloadToolName: 'Agent',
      sessionIdSha256: sha256hex(event.session_id),
      toolUseIdSha256: sha256hex(event.tool_use_id),
      denyLiteral: 'IBIND_DENY_TASK_V1',
      authority: false,
    });
    withCapabilityEnvSync(() => lib.__TEST_ONLY__produceIbindDenyRecord(event, { destination, matcherToolName: 'Task' }));
    assert.strictEqual(fs.readFileSync(destination, 'utf8').trim().split('\n').length, 1, 'replay must not append a duplicate record');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1IA-IBIND-BOUNDARY-MANUAL-ZERO-AUTHORITY-25 RED: manual/env/role/PID/argv/operator claims never enter the v2 record or create a brand, composition, dispatch or grant capability', () => {
  const lib = requireBoundaryLib();
  assert.strictEqual(typeof lib.__TEST_ONLY__produceIbindDenyRecord, 'function', 'precondition: exact gated v2 producer');
  const root = mkRoot();
  const destination = path.join(root, 'manual.jsonl');
  const event = basePre({ tool_name: 'Agent', role: 'arch-platform', grant_id: 'forged', pid: 1, argv: ['claude'], operatorApproved: true });
  try {
    const result = withCapabilityEnvSync(() => lib.__TEST_ONLY__produceIbindDenyRecord(event, { destination, matcherToolName: 'Task', manual: true }));
    const record = JSON.parse(fs.readFileSync(destination, 'utf8').trim());
    assert.strictEqual(record.authority, false);
    const serialized = JSON.stringify({ result, record });
    for (const forbidden of ['arch-platform', 'forged', 'operatorApproved', 'argv', 'grant_id']) assert.ok(!serialized.includes(forbidden), 'manual authority claim leaked: ' + forbidden);
    for (const verb of ['brand', 'composition', 'spawn', 'dispatch', 'grant', 'authorityToken']) assert.strictEqual(Object.prototype.hasOwnProperty.call(result, verb), false, 'manual producer must not return ' + verb);
    const savedNodeEnv = process.env.NODE_ENV;
    const saved = process.env[CAPABILITY_ENV_VAR];
    process.env.NODE_ENV = 'test'; process.env[CAPABILITY_ENV_VAR] = WRONG_CAPABILITY_VALUE;
    try {
      const wrong = lib.__TEST_ONLY__produceIbindDenyRecord(event, { destination: path.join(root, 'wrong.jsonl'), matcherToolName: 'Task' });
      assert.ok(!wrong || wrong.denied !== true, 'wrong capability must not activate the seam');
    } finally {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
      if (saved === undefined) delete process.env[CAPABILITY_ENV_VAR]; else process.env[CAPABILITY_ENV_VAR] = saved;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const PROJECT_ROOT = path.resolve(__dirname, '../..');

test('R131-BOUNDARY-ADMITTED-ENTRYPOINT-PRETOOLUSE-26: exact signed rewritten entrypoint command is admitted', () => {
  const lib = requireBoundaryLib();
  const host = require('../lib/runtime-host-claude.cjs');
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  const entrypoints = require('../lib/runtime-collaboration-entrypoints.cjs');
  const intent = { scope: 'all' };
  const plan = entrypoints.planEntrypointStep('monitor-docs', intent, PROJECT_ROOT);
  const minted = host.mintProductionHostComposition({
    projectRoot: PROJECT_ROOT,
    event: { hook_event_name: 'PreToolUse', tool_name: 'Bash', model: 'claude-sonnet-5' },
    entrypoint: 'monitor-docs', argvDigest: plan.argv_digest, roleScope: plan.role_scope,
  });
  assert.strictEqual(minted.ok, true);
  const command = rll.renderPosixDirect([
    process.execPath, path.join(PROJECT_ROOT, 'scripts/lib/runtime-collaboration-entrypoints.cjs'), 'execute',
    '--entrypoint', 'monitor-docs', '--project-root', PROJECT_ROOT,
    '--intent', Buffer.from(JSON.stringify(intent)).toString('base64url'),
    '--host-composition', minted.compositionId,
  ]);
  assert.deepStrictEqual(lib.admitEntrypointPreToolUse({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: PROJECT_ROOT, tool_input: { command },
  }), { admitted: true, compositionId: minted.compositionId });
});

test('R131-BOUNDARY-EXACT-ACTION-CORRELATION-27: Agent event must match exact durable action and bootstrap', () => {
  const lib = requireBoundaryLib();
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  const actionId = 'd'.repeat(32);
  const message = 'Execute `ready --action ' + actionId + '`, then wait.';
  const savedFind = rll.findActionAcrossRepos;
  const savedRepo = rll.computeRepoId;
  const savedOperation = rll.resolveHostOperationForAction;
  rll.findActionAcrossRepos = () => ({ ok: true, absent: false, action: {
    action_id: actionId, repo_id: 'repo-test', kind: 'role-spawn', runtime: 'claude-native',
    payload: { agent_type: 'arch-platform', bootstrap_message: message },
  } });
  rll.computeRepoId = () => 'repo-test';
  rll.resolveHostOperationForAction = () => 'Agent';
  try {
    assert.deepStrictEqual(lib.admitNativeActionEvent({
      hook_event_name: 'PreToolUse', tool_name: 'Agent', cwd: PROJECT_ROOT,
      tool_input: { subagent_type: 'arch-platform', prompt: message },
    }), { admitted: true, actionId, operation: 'Agent' });
    assert.strictEqual(lib.admitNativeActionEvent({
      hook_event_name: 'PreToolUse', tool_name: 'Agent', cwd: PROJECT_ROOT,
      tool_input: { subagent_type: 'arch-testing', prompt: message },
    }).admitted, false);
  } finally {
    rll.findActionAcrossRepos = savedFind;
    rll.computeRepoId = savedRepo;
    rll.resolveHostOperationForAction = savedOperation;
  }
});

test('R131-BOUNDARY-CALLER-COMPOSITION-REJECTION-28: forged composition id cannot admit an entrypoint event', () => {
  const lib = requireBoundaryLib();
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  const intent = Buffer.from(JSON.stringify({ scope: 'all' })).toString('base64url');
  const command = rll.renderPosixDirect([
    process.execPath, path.join(PROJECT_ROOT, 'scripts/lib/runtime-collaboration-entrypoints.cjs'), 'execute',
    '--entrypoint', 'monitor-docs', '--project-root', PROJECT_ROOT, '--intent', intent,
    '--host-composition', 'e'.repeat(32),
  ]);
  assert.strictEqual(lib.admitEntrypointPreToolUse({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: PROJECT_ROOT, tool_input: { command },
  }).admitted, false);
});

test('R131-BOUNDARY-FAILURE-CLOSURE-29: admitted PostToolUseFailure closes and removes owned pending captures', () => {
  const lib = requireBoundaryLib();
  const root = mkRoot();
  try {
    const pre = basePre();
    admitHostOrigin(pre, root);
    assert.strictEqual(lib.processPreToolUse(pre, { observationRoot: root }).admitted, true);
    const failed = basePost(pre, { hook_event_name: 'PostToolUseFailure', error: 'native-call-failed' });
    assert.strictEqual(lib.processPostToolUse(failed, { observationRoot: root }).closed, true);
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    assert.strictEqual(fs.existsSync(pendingPrePath(root, sDig, tDig)), false);
    assert.ok(fs.existsSync(path.join(closureDir(root), sDig + '__' + tDig + '.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
