#!/usr/bin/env node
'use strict';

// RED-first tests for scripts/lib/verdict-evidence-contract.cjs (does not exist yet,
// P1 of wave structured-verdict-evidence-contract; see PLAN.md sec 3.2-3.5, 3.7).
//
// REVISION (post toolkit-specialist/arch-testing sync): this module is PURE (no fs, no
// child_process). Byte-level cleanliness (CR/NUL/UTF-8/trailing-newline/confinement/
// symlink/size-cap/hard-link) lives in verdict-artifact-store.cjs's readConfinedFile --
// see verdict-artifact-store.test.cjs for those cases. The orchestrating
// `validateVerdict({path, expectRole, expectPhase, expectWaveSlug, expectPlanSha256,
// expectHead})` function (fs-bound, resolves request_ref internally, calls
// store.isAncestorCommit for prep-phase headBound) lives in
// verdict-evidence-contract-cli.cjs -- see verdict-evidence-contract.bats for its
// end-to-end coverage, including the real-git ancestor-vs-exact discriminating pair.
//
// Confirmed-final pieces (toolkit-specialist, directly -- NOT relayed via arch-testing;
// corrected attribution below, see the RETRACTED note further down for why this matters):
//   crossCheckBinding({request, verdict, expect}) -> {roleBound, requestBound, headBound, planBound}
//     headBound is phase-dependent: prep -> expect.headIsAncestor===true; verify-final
//     -> verdict.head===expect.head exact. expect.headIsAncestor is PRECOMPUTED by the
//     caller (via store.isAncestorCommit, a real git call) -- crossCheckBinding itself
//     stays pure/no-git, just consumes the boolean.
//     CORRECTION (post arch-testing line-by-line review): roleBound here is a PURE
//     3-way check among request.role/verdict.role/expect.role ONLY -- crossCheckBinding
//     never receives a filename or path, so it cannot and does not fold in
//     filename-vs-content agreement. That is satisfied-by-design instead, not folded
//     into any field here -- see the RETRACTED note below (parseVerdictFileName no
//     longer exists; this module's own tests correctly never exercise a
//     filename-vs-content mismatch, and neither does anything else in this wave).
//   composeResult({exists, wellFormed, roleBound, requestBound, headBound, planBound,
//     evidenceValid, decision}) -> {...all 8 fields..., decisionAuthorized, authorizes, reason}
//     decisionAuthorized = wellFormed && decision==='approve' ONLY -- independent of
//     roleBound/requestBound/headBound/planBound/evidenceValid (arch-platform's exact
//     correction). authorizes = AND of every field including exists.
//
// Pieces NOT exact-named by toolkit-specialist -- proposed here, flagged for review in
// my report-back (their message explicitly invited "flag it now before I start" for
// exactly this gap):
//   serializeRecord(obj) -> Buffer                    canonical 2-space + trailing \n.
//   decodeRecord(bytes) -> {ok,value}|{ok:false,reason}  JSON.parse + duplicate-key
//                                                      detection + object-only. Takes
//                                                      bytes ALREADY byte-validated by
//                                                      store.readConfinedFile -- this
//                                                      function does NOT re-check
//                                                      CR/NUL/UTF-8/newline.
//   validateRequestShape(value) / validateVerdictShape(value) -> {ok}|{ok:false,reason}
//                                                      exact-keys/enums/bounds on an
//                                                      ALREADY-DECODED value.
//   validateEvidenceEntryShape(entry) -> {ok}|{ok:false,reason}  shape-only (kind/path/
//                                                      sha256[/expected_schema]); does
//                                                      NOT read the referenced file --
//                                                      that is store.readConfinedFile,
//                                                      orchestrated by the CLI.
//   verdictsShareReplayedRequest(oldVerdict, newVerdict) -> boolean  pure in_reply_to
//                                                      comparison; enforced by the CLI's
//                                                      supersede path, see the bats file.
//
// RETRACTED (arch-testing review, resolved): this file previously proposed and tested
// `parseVerdictFileName(basename) -> {role,phase}|null` as a wellFormed-level filename-
// vs-content self-consistency check. Answered arch-testing's direct question -- no
// code path in this wave's confirmed design ever parses an untrusted/arbitrary filename
// to DERIVE a role/phase expectation: validateVerdict's confirmed signature takes
// expectRole/expectPhase as explicit caller-supplied params, and premature-execution-
// gate.js's redesign (per arch-integration) always constructs the expected path FROM a
// known role via closed 3-way enumeration, never the reverse. parseVerdictFileName was
// my own unprompted addition and corresponded to no actual requirement -- removed
// entirely (function proposal + its 2 unit tests + the bats filename-mismatch test)
// rather than keeping unused speculative surface. PLAN.md's "wrong filename" RED case
// is satisfied-by-design: roleBound (verdict.role vs expect.role) plus the phase check
// already folded into requestBound fully cover it, since every real caller derives both
// the path it requests AND the expectations it passes from the SAME known role/phase --
// there is no path where an expectation is derived FROM a filename, so there is nothing
// a dedicated filename-parse cross-check would catch that roleBound/requestBound don't
// already catch via the content-vs-expectation comparison itself.
//
// Isolation: fully in-memory/pure -- no fs, no tmpdir needed for any test in this file.
// Every sha256/hex fixture value is a fixed, readable stand-in (no real digests needed
// here since nothing in this file reads real bytes); the store and bats files compute
// real digests at run time per the CORE NON-VACUITY MANDATE where bytes are involved.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const LIB_DIR = path.resolve(__dirname, '../lib');
const CONTRACT_PATH = path.join(LIB_DIR, 'verdict-evidence-contract.cjs');
const STORE_PATH = path.join(LIB_DIR, 'verdict-artifact-store.cjs');
const CLI_PATH = path.join(LIB_DIR, 'verdict-evidence-contract-cli.cjs');
const STRUCTURAL_VALIDATORS_PATH = path.join(LIB_DIR, 'runtime-role-lifecycle/structural-validators.cjs');

const contract = require(CONTRACT_PATH);

// ── fixture helpers (pure, no fs) ───────────────────────────────────────────────────

function hex(n, ch) { return ch.repeat(n); }
function fortyHex(ch) { return hex(40, ch || 'a'); }
function sixtyFourHex(ch) { return hex(64, ch || 'b'); }
function thirtyTwoHex(ch) { return hex(32, ch || 'c'); }
function isoNow() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

function validRequestObj(overrides) {
  return Object.assign({
    schema: 'verdict-request/v1',
    request_id: thirtyTwoHex('3'),
    role: 'arch-testing',
    phase: 'prep',
    wave_slug: 'my-wave',
    plan_sha256: sixtyFourHex('2'),
    head: fortyHex('1'),
    subject: { kind: 'plan', path: 'PLAN.md', sha256: sixtyFourHex('4') },
    created_at: isoNow(),
  }, overrides);
}

function validVerdictObj(overrides) {
  return Object.assign({
    schema: 'verdict/v1',
    role: 'arch-testing',
    wave_slug: 'my-wave',
    phase: 'prep',
    decision: 'approve',
    rationale: 'ok',
    evidence: [],
    head: fortyHex('1'),
    plan_sha256: sixtyFourHex('2'),
    in_reply_to: thirtyTwoHex('3'),
    request_ref: { path: 'verdict-requests/r.json', sha256: sixtyFourHex('5') },
    created_at: isoNow(),
    supersedes: null,
  }, overrides);
}

function validExpect(overrides) {
  return Object.assign({
    role: 'arch-testing', phase: 'prep', waveSlug: 'my-wave',
    planSha256: sixtyFourHex('2'), head: fortyHex('1'), headIsAncestor: true,
  }, overrides);
}

const ALL_BOUND_TRUE = Object.freeze({
  exists: true, wellFormed: true, roleBound: true, requestBound: true,
  headBound: true, planBound: true, evidenceValid: true,
});

// ── module boundaries (T12, PLAN.md sec 3.7) ────────────────────────────────────────

test('import boundaries: contract imports only node builtins + structural-validators.cjs', () => {
  const src = fs.readFileSync(CONTRACT_PATH, 'utf8');
  const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  for (const spec of requires) {
    const isRelative = spec.startsWith('.') || spec.startsWith('/');
    if (!isRelative) continue;
    const resolved = path.resolve(path.dirname(CONTRACT_PATH), spec);
    assert.strictEqual(
      resolved.replace(/\.cjs$/, ''),
      STRUCTURAL_VALIDATORS_PATH.replace(/\.cjs$/, ''),
      `verdict-evidence-contract.cjs must import only structural-validators.cjs among local modules, found: ${spec}`,
    );
  }
});

test('import boundaries: store and CLI import only the new focused modules + node builtins', () => {
  for (const modulePath of [STORE_PATH, CLI_PATH]) {
    const src = fs.readFileSync(modulePath, 'utf8');
    const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const spec of requires) {
      const isRelative = spec.startsWith('.') || spec.startsWith('/');
      if (!isRelative) continue;
      const resolved = path.resolve(path.dirname(modulePath), spec).replace(/\.cjs$/, '');
      const allowed = [CONTRACT_PATH, STORE_PATH, CLI_PATH].map((p) => p.replace(/\.cjs$/, ''));
      assert.ok(
        allowed.includes(resolved),
        `${path.basename(modulePath)} must import only the 3 new verdict-evidence modules among local files, found: ${spec}`,
      );
    }
  }
});

test('import boundaries: none of the 3 new modules ever require runtime-consultation (study-only prior art)', () => {
  for (const modulePath of [CONTRACT_PATH, STORE_PATH, CLI_PATH]) {
    const src = fs.readFileSync(modulePath, 'utf8');
    assert.ok(
      !/require\(\s*['"][^'"]*runtime-consultation[^'"]*['"]\s*\)/.test(src),
      `${path.basename(modulePath)} must never require runtime-consultation prior art (study-only, never import)`,
    );
  }
});

test('module size: each of the 3 new modules stays at or below the 250-line target', () => {
  for (const modulePath of [CONTRACT_PATH, STORE_PATH, CLI_PATH]) {
    const lines = fs.readFileSync(modulePath, 'utf8').split(/\r?\n/);
    assert.ok(
      lines.length <= 250,
      `${path.basename(modulePath)} has ${lines.length} lines (max 250 per PLAN.md sec 3.7 -- exceeding requires extraction, not a waiver)`,
    );
  }
});

// ── serialization / decode (parsing only -- byte strictness lives in the store) ────

test('serializeRecord produces canonical 2-space pretty JSON with exactly one trailing newline', () => {
  const obj = { b: 1, a: { d: 2, c: 3 } };
  const bytes = contract.serializeRecord(obj);
  assert.ok(Buffer.isBuffer(bytes));
  const text = bytes.toString('utf8');
  assert.strictEqual(text, JSON.stringify(obj, null, 2) + '\n');
  assert.strictEqual(text.endsWith('\n\n'), false);
});

test('decodeRecord round-trips a serialized record', () => {
  const obj = { schema: 'verdict-request/v1', n: 1 };
  const bytes = contract.serializeRecord(obj);
  const result = contract.decodeRecord(bytes);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.value, obj);
});

test('decodeRecord owns the JSON byte grammar while the artifact store remains opaque-byte safe', () => {
  assert.strictEqual(contract.decodeRecord(Buffer.from([0xc3, 0x28, 0x0a])).reason, 'invalid-utf8');
  assert.strictEqual(contract.decodeRecord(Buffer.from('{"a":1}\r\n', 'utf8')).reason, 'invalid-encoding');
  assert.strictEqual(contract.decodeRecord(Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x00, 0x31, 0x7d, 0x0a])).reason, 'invalid-encoding');
  assert.strictEqual(contract.decodeRecord(Buffer.from('{"a":1}', 'utf8')).reason, 'invalid-final-newline');
  assert.strictEqual(contract.decodeRecord(Buffer.from('{"a":1}\n\n', 'utf8')).reason, 'invalid-final-newline');
});

test('RED: decodeRecord rejects invalid JSON syntax', () => {
  const result = contract.decodeRecord(Buffer.from('{not json}\n', 'utf8'));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(typeof result.reason, 'string');
});

test('RED: decodeRecord rejects duplicate top-level keys', () => {
  const canonical = contract.serializeRecord({ schema: 'verdict-request/v1', role: 'arch-testing' }).toString('utf8');
  const lines = canonical.split('\n');
  const idx = lines.findIndex((l) => l.trim().startsWith('"schema"'));
  assert.ok(idx >= 0);
  lines.splice(idx, 0, lines[idx]); // duplicate the "schema" line verbatim -- still valid JSON grammar
  const result = contract.decodeRecord(Buffer.from(lines.join('\n'), 'utf8'));
  assert.strictEqual(result.ok, false);
});

test('RED: decodeRecord rejects a non-object top-level value', () => {
  assert.strictEqual(contract.decodeRecord(Buffer.from('[1,2,3]\n', 'utf8')).ok, false);
  assert.strictEqual(contract.decodeRecord(Buffer.from('"just a string"\n', 'utf8')).ok, false);
  assert.strictEqual(contract.decodeRecord(Buffer.from('42\n', 'utf8')).ok, false);
});

// ── request/verdict shape (unknown keys, enums, bounds) ─────────────────────────────

test('RED: validateRequestShape rejects an unknown key', () => {
  const value = validRequestObj({ extra_field: 'nope' });
  assert.strictEqual(contract.validateRequestShape(value).ok, false);
});

test('RED: validateRequestShape rejects a missing required key', () => {
  const value = validRequestObj();
  delete value.plan_sha256;
  assert.strictEqual(contract.validateRequestShape(value).ok, false);
});

test('RED: validateRequestShape rejects an invalid wave_slug pattern', () => {
  for (const badSlug of ['Has_Upper', 'trailing-', '-leading', 'has space', '']) {
    assert.strictEqual(contract.validateRequestShape(validRequestObj({ wave_slug: badSlug })).ok, false, `wave_slug=${JSON.stringify(badSlug)}`);
  }
});

test('RED: validateRequestShape rejects a non-40-hex head', () => {
  assert.strictEqual(contract.validateRequestShape(validRequestObj({ head: 'a'.repeat(39) })).ok, false);
});

test('RED: validateRequestShape rejects a non-64-hex plan_sha256', () => {
  assert.strictEqual(contract.validateRequestShape(validRequestObj({ plan_sha256: 'a'.repeat(63) })).ok, false);
});

test('RED: created_at must be a real UTC calendar timestamp, not only timestamp-shaped text', () => {
  assert.strictEqual(contract.validateRequestShape(validRequestObj({ created_at: '2026-02-30T00:00:00Z' })).ok, false);
  assert.strictEqual(contract.validateVerdictShape(validVerdictObj({ created_at: '2026-13-01T00:00:00Z' })).ok, false);
});

test('RED: validateRequestShape rejects subject.kind mismatched with phase', () => {
  assert.strictEqual(
    contract.validateRequestShape(validRequestObj({ phase: 'prep', subject: { kind: 'source-manifest', path: 'source-manifests/x.json', sha256: sixtyFourHex('4') } })).ok,
    false,
  );
  assert.strictEqual(
    contract.validateRequestShape(validRequestObj({ phase: 'verify-final', subject: { kind: 'plan', path: 'PLAN.md', sha256: sixtyFourHex('4') } })).ok,
    false,
  );
});

test('RED: validateVerdictShape rejects an unknown key', () => {
  assert.strictEqual(contract.validateVerdictShape(validVerdictObj({ extra_field: 'nope' })).ok, false);
});

test('RED: validateVerdictShape rejects empty rationale', () => {
  assert.strictEqual(contract.validateVerdictShape(validVerdictObj({ rationale: '' })).ok, false);
});

test('RED: validateVerdictShape rejects rationale over 8192 bytes', () => {
  assert.strictEqual(contract.validateVerdictShape(validVerdictObj({ rationale: 'x'.repeat(8193) })).ok, false);
});

test('RED: validateVerdictShape rejects reason_code present alongside decision=approve', () => {
  const value = validVerdictObj({ decision: 'approve' });
  value.reason_code = 'other';
  assert.strictEqual(contract.validateVerdictShape(value).ok, false);
});

test('RED: validateVerdictShape rejects a missing reason_code when decision=escalate', () => {
  assert.strictEqual(contract.validateVerdictShape(validVerdictObj({ decision: 'escalate' })).ok, false);
});

test('RED: validateVerdictShape rejects an invalid reason_code enum value', () => {
  const value = validVerdictObj({ decision: 'escalate' });
  value.reason_code = 'not-a-real-code';
  assert.strictEqual(contract.validateVerdictShape(value).ok, false);
});

test('RED: validateVerdictShape rejects more than 64 evidence entries', () => {
  const evidence = Array.from({ length: 65 }, (_, i) => ({ kind: 'opaque-file', path: `evidence/e${i}`, sha256: sixtyFourHex('7') }));
  assert.strictEqual(contract.validateVerdictShape(validVerdictObj({ evidence })).ok, false);
});

test('RED: validateVerdictShape rejects a non-object top-level value', () => {
  assert.strictEqual(contract.validateVerdictShape('not an object').ok, false);
  assert.strictEqual(contract.validateVerdictShape(null).ok, false);
  assert.strictEqual(contract.validateVerdictShape([1, 2]).ok, false);
});

// ── evidence entry shape (no fs -- shape only) ──────────────────────────────────────

test('RED: validateEvidenceEntryShape rejects an unknown kind', () => {
  assert.strictEqual(contract.validateEvidenceEntryShape({ kind: 'not-a-real-kind', path: 'evidence/e', sha256: sixtyFourHex('7') }).ok, false);
});

test('RED: validateEvidenceEntryShape rejects unknown/extra keys', () => {
  assert.strictEqual(contract.validateEvidenceEntryShape({ kind: 'opaque-file', path: 'evidence/e', sha256: sixtyFourHex('7'), extra: 1 }).ok, false);
});

test('RED: validateEvidenceEntryShape rejects a json-record entry missing expected_schema', () => {
  assert.strictEqual(contract.validateEvidenceEntryShape({ kind: 'json-record', path: 'evidence/e', sha256: sixtyFourHex('7') }).ok, false);
});

test('RED: validateEvidenceEntryShape rejects an opaque-file entry that carries expected_schema (kind-exclusive key)', () => {
  assert.strictEqual(contract.validateEvidenceEntryShape({ kind: 'opaque-file', path: 'evidence/e', sha256: sixtyFourHex('7'), expected_schema: 'x/v1' }).ok, false);
});

test('GREEN: validateEvidenceEntryShape accepts a well-shaped entry of each kind', () => {
  assert.strictEqual(contract.validateEvidenceEntryShape({ kind: 'opaque-file', path: 'evidence/e', sha256: sixtyFourHex('7') }).ok, true);
  assert.strictEqual(contract.validateEvidenceEntryShape({ kind: 'json-record', path: 'evidence/e', sha256: sixtyFourHex('7'), expected_schema: 'x/v1' }).ok, true);
});

// ── mutation check 1: enum closure ──────────────────────────────────────────────────

test('mutation check: ROLES enum is exactly 3 values, closed', () => {
  assert.deepStrictEqual(contract.ROLES.slice().sort(), ['arch-integration', 'arch-platform', 'arch-testing']);
  for (const role of contract.ROLES) assert.strictEqual(contract.validateRequestShape(validRequestObj({ role })).ok, true);
  assert.strictEqual(contract.validateRequestShape(validRequestObj({ role: 'arch-bogus' })).ok, false);
});

test('mutation check: PHASES enum is exactly 2 values, closed', () => {
  assert.deepStrictEqual(contract.PHASES.slice().sort(), ['prep', 'verify-final']);
  assert.strictEqual(contract.validateRequestShape(validRequestObj({ phase: 'implement' })).ok, false);
});

test('mutation check: DECISIONS enum is exactly 2 values, closed', () => {
  assert.deepStrictEqual(contract.DECISIONS.slice().sort(), ['approve', 'escalate']);
  assert.strictEqual(contract.validateVerdictShape(validVerdictObj({ decision: 'maybe' })).ok, false);
});

test('mutation check: REASON_CODES enum is exactly 6 values, closed', () => {
  assert.deepStrictEqual(contract.REASON_CODES.slice().sort(), [
    'cross-architect-disagreement', 'evidence-insufficient', 'other',
    'plan-defect', 'policy-violation', 'scope-conflict',
  ]);
  for (const reason_code of contract.REASON_CODES) {
    const value = validVerdictObj({ decision: 'escalate' });
    value.reason_code = reason_code;
    assert.strictEqual(contract.validateVerdictShape(value).ok, true, `reason_code=${reason_code}`);
  }
});

test('mutation check: EVIDENCE_KINDS enum is exactly 2 values, closed', () => {
  assert.deepStrictEqual(contract.EVIDENCE_KINDS.slice().sort(), ['json-record', 'opaque-file']);
  assert.strictEqual(contract.validateEvidenceEntryShape({ kind: 'bogus-kind', path: 'evidence/e', sha256: sixtyFourHex('7') }).ok, false);
});

test('RED: every record path is portable, relative, and confined by grammar before filesystem access', () => {
  for (const bad of ['/absolute', 'C:/absolute', '../escape', 'a/../escape', 'a\\windows']) {
    assert.strictEqual(contract.isSafeRelativePath(bad), false, bad);
  }
  assert.strictEqual(contract.isSafeRelativePath('evidence/result.json'), true);
});

// ── crossCheckBinding (pure) ─────────────────────────────────────────────────────────

test('GREEN: crossCheckBinding reports every bound flag true for a fully consistent request/verdict/expect', () => {
  const result = contract.crossCheckBinding({ request: validRequestObj(), verdict: validVerdictObj(), expect: validExpect() });
  assert.deepStrictEqual(result, { roleBound: true, requestBound: true, headBound: true, planBound: true });
});

test('RED: conflicting response -- verdict.phase disagrees with request.phase clears requestBound', () => {
  const result = contract.crossCheckBinding({
    request: validRequestObj({ phase: 'prep' }),
    verdict: validVerdictObj({ phase: 'verify-final' }),
    expect: validExpect({ phase: 'verify-final' }),
  });
  assert.strictEqual(result.requestBound, false);
});

test('RED: wrong request -- in_reply_to disagrees with request.request_id clears requestBound', () => {
  const result = contract.crossCheckBinding({
    request: validRequestObj(),
    verdict: validVerdictObj({ in_reply_to: thirtyTwoHex('f') }),
    expect: validExpect(),
  });
  assert.strictEqual(result.requestBound, false);
});

test('RED: a verdict timestamp before its immutable request is not request-bound', () => {
  const result = contract.crossCheckBinding({
    request: validRequestObj({ created_at: '2026-01-02T00:00:00Z' }),
    verdict: validVerdictObj({ created_at: '2026-01-01T23:59:59Z' }),
    expect: validExpect(),
  });
  assert.strictEqual(result.requestBound, false);
});

test('headBound: prep phase requires expect.headIsAncestor===true (not merely any head value)', () => {
  const boundWhenAncestor = contract.crossCheckBinding({
    request: validRequestObj({ phase: 'prep' }), verdict: validVerdictObj({ phase: 'prep' }),
    expect: validExpect({ phase: 'prep', headIsAncestor: true }),
  });
  assert.strictEqual(boundWhenAncestor.headBound, true);
  const notBoundWhenNotAncestor = contract.crossCheckBinding({
    request: validRequestObj({ phase: 'prep' }), verdict: validVerdictObj({ phase: 'prep' }),
    expect: validExpect({ phase: 'prep', headIsAncestor: false }),
  });
  assert.strictEqual(notBoundWhenNotAncestor.headBound, false);
});

test('headBound: verify-final phase requires EXACT head equality regardless of headIsAncestor (discriminates the two code paths)', () => {
  // The critical case (arch-platform, relayed by arch-testing): a genuine ancestor
  // relationship (headIsAncestor=true) must NOT satisfy verify-final's exact-match
  // requirement -- proves verify-final does not silently reuse prep's ancestor check.
  const ancestorButNotExact = contract.crossCheckBinding({
    request: validRequestObj({ phase: 'verify-final', head: fortyHex('1') }),
    verdict: validVerdictObj({ phase: 'verify-final', head: fortyHex('1') }),
    expect: validExpect({ phase: 'verify-final', head: fortyHex('2'), headIsAncestor: true }),
  });
  assert.strictEqual(ancestorButNotExact.headBound, false, 'verify-final must reject an ancestor that is not the exact current HEAD');

  const exactMatch = contract.crossCheckBinding({
    request: validRequestObj({ phase: 'verify-final', head: fortyHex('1') }),
    verdict: validVerdictObj({ phase: 'verify-final', head: fortyHex('1') }),
    expect: validExpect({ phase: 'verify-final', head: fortyHex('1'), headIsAncestor: false }),
  });
  assert.strictEqual(exactMatch.headBound, true, 'verify-final must accept an exact match even when headIsAncestor is false/unset');
});

// ── mutation check 2: cross-binding fields each independently gate authorization ────

test('mutation check: cross-binding fields each independently gate their bound flag (request-side flips)', () => {
  const flips = [
    { field: 'role', badValue: 'arch-platform', bound: 'roleBound' },
    { field: 'wave_slug', badValue: 'a-different-wave', bound: 'requestBound' },
    { field: 'plan_sha256', badValue: sixtyFourHex('9'), bound: 'planBound' },
  ];
  for (const { field, badValue, bound } of flips) {
    const result = contract.crossCheckBinding({
      request: validRequestObj({ [field]: badValue }), verdict: validVerdictObj(), expect: validExpect(),
    });
    assert.strictEqual(result[bound], false, `flipping request.${field} should clear ${bound}`);
  }
});

test('mutation check: cross-binding fields each independently gate their bound flag (verdict-side flips)', () => {
  const flips = [
    { field: 'role', badValue: 'arch-integration', bound: 'roleBound' },
    { field: 'wave_slug', badValue: 'a-different-wave', bound: 'requestBound' },
    { field: 'plan_sha256', badValue: sixtyFourHex('9'), bound: 'planBound' },
  ];
  for (const { field, badValue, bound } of flips) {
    const result = contract.crossCheckBinding({
      request: validRequestObj(), verdict: validVerdictObj({ [field]: badValue }), expect: validExpect(),
    });
    assert.strictEqual(result[bound], false, `flipping verdict.${field} should clear ${bound}`);
  }
});

test('mutation check: cross-binding fields each independently gate their bound flag (expect-side flips)', () => {
  const flips = [
    { field: 'role', badValue: 'arch-platform', bound: 'roleBound' },
    { field: 'waveSlug', badValue: 'a-different-wave', bound: 'requestBound' },
    { field: 'planSha256', badValue: sixtyFourHex('9'), bound: 'planBound' },
  ];
  for (const { field, badValue, bound } of flips) {
    const result = contract.crossCheckBinding({
      request: validRequestObj(), verdict: validVerdictObj(), expect: validExpect({ [field]: badValue }),
    });
    assert.strictEqual(result[bound], false, `flipping expect.${field} should clear ${bound}`);
  }
});

// ── composeResult (pure) -- the 4-case authorizes/decisionAuthorized matrix ────────

test('4-case matrix (a): escalate + every binding true -> decisionAuthorized=false, authorizes=false', () => {
  const result = contract.composeResult(Object.assign({}, ALL_BOUND_TRUE, { decision: 'escalate' }));
  assert.strictEqual(result.decisionAuthorized, false);
  assert.strictEqual(result.authorizes, false);
});

test('4-case matrix (b): approve + every binding true -> decisionAuthorized=true, authorizes=true', () => {
  const result = contract.composeResult(Object.assign({}, ALL_BOUND_TRUE, { decision: 'approve' }));
  assert.strictEqual(result.decisionAuthorized, true);
  assert.strictEqual(result.authorizes, true);
});

test('4-case matrix (c): approve + wellFormed true + exactly one OTHER binding false -> decisionAuthorized=TRUE, authorizes=false', () => {
  const input = Object.assign({}, ALL_BOUND_TRUE, { headBound: false, decision: 'approve' });
  const result = contract.composeResult(input);
  assert.strictEqual(result.decisionAuthorized, true, 'decisionAuthorized depends only on wellFormed+decision, never on headBound/roleBound/etc.');
  assert.strictEqual(result.authorizes, false, 'authorizes is a real AND over every binding, not a copy of decisionAuthorized');
});

test('4-case matrix (d): approve + wellFormed FALSE -> decisionAuthorized=false, authorizes=false', () => {
  const input = Object.assign({}, ALL_BOUND_TRUE, { wellFormed: false, decision: 'approve' });
  const result = contract.composeResult(input);
  assert.strictEqual(result.decisionAuthorized, false, 'wellFormed genuinely gates decisionAuthorized, not just the decision string');
  assert.strictEqual(result.authorizes, false);
});

test('RED: composeResult with exists=false clears authorizes even when every other field is true', () => {
  const input = Object.assign({}, ALL_BOUND_TRUE, { exists: false, decision: 'approve' });
  const result = contract.composeResult(input);
  assert.strictEqual(result.authorizes, false);
  assert.strictEqual(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

test('composeResult exposes exactly the sec 3.5 field set, nothing more', () => {
  const result = contract.composeResult(Object.assign({}, ALL_BOUND_TRUE, { decision: 'approve' }));
  assert.deepStrictEqual(Object.keys(result).sort(), [
    'authorizes', 'decisionAuthorized', 'evidenceValid', 'exists', 'headBound',
    'planBound', 'reason', 'requestBound', 'roleBound', 'wellFormed',
  ]);
});

// ── replay primitive (pure, no fs) ──────────────────────────────────────────────────

test('RED: verdictsShareReplayedRequest is true only when in_reply_to is reused across two verdicts', () => {
  const v1 = validVerdictObj({ in_reply_to: thirtyTwoHex('1') });
  const v2Same = validVerdictObj({ in_reply_to: thirtyTwoHex('1') });
  const v2Fresh = validVerdictObj({ in_reply_to: thirtyTwoHex('2') });
  assert.strictEqual(contract.verdictsShareReplayedRequest(v1, v2Same), true);
  assert.strictEqual(contract.verdictsShareReplayedRequest(v1, v2Fresh), false);
});
