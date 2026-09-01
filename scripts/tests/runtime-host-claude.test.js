#!/usr/bin/env node
'use strict';

// runtime-host-claude.test.js -- Sequence151 P1-I observation-only RED
// AUTHENTICITY CORRECTION of Sequence150 (Codex rejection:
// sequence150-codex-audit.json, findings P1I-150-01/02). Full rewrite; both
// findings closed in this same file.
//
// P1I-150-01 (P0, the part owned by this file): a plain caller-supplied JSON
// event piped into the real hook executable is not proof of host-origin
// authenticity -- any local caller can do that. CLOSED for this file's own
// surface: the test-only brand seam now BINDS the owned observation root
// privately into the brand itself (`__TEST_ONLY__mintHostAdapterBrand({observationRoot})`),
// and createHostComposition(brand) obtains that root ONLY from the opaque
// brand -- never from a caller option or an environment variable (TICKET-*
// group below proves both vectors are ignored). beginObservation(preEvent)
// creates the private, no-clobber, digest-correlated admission TICKET the
// sibling scripts/tests/runtime-host-boundary.test.js now requires before it
// will trust a matching PreToolUse event -- this file is the producer half
// of that chain; the boundary file is the consumer half.
//
// P1I-150-02 (P1): the previous gates proved MISSING capability is denied
// but never proved a WRONG non-empty value is denied. CLOSED:
// BRAND-SEAM-WRONG-CAPABILITY-VALUE-DENIED proves the gate compares against
// the EXACT fixed capability value, not merely non-emptiness -- a
// correction to this file's own prior (inaccurate) claim that the
// established isTestCapability() convention was being mirrored verbatim;
// this module's gate is deliberately STRICTER (exact-value, not
// presence-only) because it guards minting an authentication brand, a more
// sensitive seam than the C3 credential-isolation precedent's own gates.
//
// Preserved from Sequence150 (per this order's point 3): digest-only public
// result, brand-gated composition creation (missing/plain/cloned/foreign/
// caller-shaped all still rejected), handle-layer unforgeability, zero
// authority-producing exports, closed composition method allowlist.
//
// ASSUMED API SHAPE (explicitly flagged; if real signatures differ, the
// affected test REDs on the exact call/value that differs):
//   hostClaude.__TEST_ONLY__mintHostAdapterBrand({observationRoot}): HostAdapterBrand
//     -- present and functional ONLY when isObservationTestCapability() is
//        true at CALL time: NODE_ENV==='test' AND
//        process.env.RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY === the ONE
//        fixed CAPABILITY_VALUE below (EXACT match, re-checked every call,
//        never cached -- P1I-150-02). Privately, irretrievably binds
//        observationRoot into the returned brand.
//   hostClaude.createHostComposition(hostAdapterBrand): HostComposition
//     -- rejects missing/plain/cloned/foreign/caller-shaped values (BRAND-*).
//        A genuine brand's bound root is the ONLY root the resulting
//        composition ever uses; a second caller-supplied options argument
//        attempting to redirect it, or an ambient RUNTIME_HOST_OBSERVATION_ROOT
//        env var, must both be ignored (TICKET-ROOT-*).
//   composition.beginObservation(preEvent): ObservationHandle
//     -- (unchanged in-memory correlation role from Sequence150) PLUS a new
//        disk side effect: writes a private admission ticket at
//        <observationRoot>/admission/<sessionDigest>__<toolUseDigest>.json,
//        no-clobber (a second call for the SAME identity must never change
//        the first ticket's bytes), containing no raw IDs and no action
//        authority. This file deliberately does NOT freeze the ticket's
//        complete field set (per this order's explicit "do not freeze
//        private MAC/key fields" instruction) -- only its existence,
//        privacy, digest-correlation and no-clobber outcomes.
//   composition.correlateToolResult(handle, postEvent): PublicObservationResult
//     -- unchanged from Sequence150: {schema,correlated,success,session_digest,
//        tool_use_digest,observed_at}, exactly 6 keys.
//   Forbidden exports and the composition's closed method allowlist are
//   unchanged (not part of this correction).
//
// Shared conventions used identically across the corrected files that need
// them (this file and its sibling runtime-host-boundary.test.js):
//   sha256hex(v) = crypto.createHash('sha256').update(String(v),'utf8').digest('hex')
//   CAPABILITY_ENV_VAR = 'RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY'
//   CAPABILITY_VALUE = the one fixed string below -- isObservationTestCapability()
//     now means NODE_ENV==='test' && env var === CAPABILITY_VALUE EXACTLY
//     (corrected per P1I-150-02; superseding this file's own earlier,
//     inaccurate "presence-only" claim).
//   admission ticket path: admission/<sessionDigest>__<toolUseDigest>.json
//     under the observation root -- the SAME root convention (pending/,
//     closure/) runtime-host-boundary.test.js already uses.
//
// Guarded require (never a bare top-level require(IMPL)): scripts/lib/
// runtime-host-claude.cjs does not exist on disk yet, so an unguarded
// require would crash the whole file under `node --test` -- every test
// instead asserts the concrete missing surface via
// requireHostClaude()/requireComposition(), so every predicate stays
// individually named, run and reported.

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const IMPL = path.resolve(__dirname, '../lib/runtime-host-claude.cjs');

let hostClaude = null;
let loadError = null;
try {
  hostClaude = require(IMPL);
} catch (err) {
  loadError = err;
}

const CAPABILITY_ENV_VAR = 'RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY';
const CAPABILITY_VALUE = 'p1i-observation-red-fixture-capability';
const WRONG_CAPABILITY_VALUE = 'p1i-observation-red-WRONG-capability';
const DIGEST_RE = /^[0-9a-f]{64}$/;
const ISO_MS_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rhc-test-'));
}

function admissionTicketPath(root, sessionDigest, toolUseDigest) {
  return path.join(root, 'admission', sessionDigest + '__' + toolUseDigest + '.json');
}

function requireHostClaude() {
  assert.ok(
    hostClaude,
    'scripts/lib/runtime-host-claude.cjs must exist and be requireable -- ' +
    'PLAN.md L77 host adapter (load error: ' + (loadError ? loadError.message : 'n/a') + ')',
  );
  return hostClaude;
}

/** Sets NODE_ENV=test + the EXACT fixed capability env var for the duration of fn(), then restores. */
function withCapabilityEnv(fn) {
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

/** Runs a clean-room child process (no inherited NODE_ENV/capability) to prove seam denial without ever risking polluting THIS process's env. */
function runCleanRoomProbe(script, envOverrides = {}) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.NODE_ENV;
  delete cleanEnv[CAPABILITY_ENV_VAR];
  Object.assign(cleanEnv, envOverrides);
  return spawnSync(process.execPath, ['-e', script], { env: cleanEnv, encoding: 'utf8' });
}

const MINT_PROBE_SCRIPT = (root) =>
  `const mod = require(${JSON.stringify(IMPL)});
   if (typeof mod.__TEST_ONLY__mintHostAdapterBrand !== 'function') { console.log('ABSENT'); process.exit(0); }
   try { const b = mod.__TEST_ONLY__mintHostAdapterBrand({ observationRoot: ${JSON.stringify(root)} }); console.log(b ? 'MINTED:' + JSON.stringify(b) : 'FALSY'); }
   catch (e) { console.log('THREW:' + e.message); }`;

/** Mints a genuine brand (bound to observationRoot) under the correct gate; fails the calling test clearly if the seam itself is missing. */
function mintGenuineBrand(mod, observationRoot) {
  return withCapabilityEnv(() => {
    assert.strictEqual(
      typeof mod.__TEST_ONLY__mintHostAdapterBrand,
      'function',
      'runtime-host-claude.cjs must export __TEST_ONLY__mintHostAdapterBrand({observationRoot}), functional under NODE_ENV=test + ' + CAPABILITY_ENV_VAR + '===<exact fixed value>',
    );
    const brand = mod.__TEST_ONLY__mintHostAdapterBrand({ observationRoot });
    assert.ok(brand !== null && brand !== undefined, 'the gated test seam must return a genuine, usable brand value');
    return brand;
  });
}

function attemptCreateComposition(mod, brandLikeValue, extraArg) {
  try {
    const composition = extraArg === undefined ? mod.createHostComposition(brandLikeValue) : mod.createHostComposition(brandLikeValue, extraArg);
    return { threw: false, composition, error: null };
  } catch (error) {
    return { threw: true, composition: null, error };
  }
}

function assertCompositionCreationRejected(outcome, message) {
  if (!outcome.threw) {
    const looksUsable = outcome.composition
      && typeof outcome.composition === 'object'
      && typeof outcome.composition.beginObservation === 'function'
      && typeof outcome.composition.correlateToolResult === 'function';
    assert.strictEqual(looksUsable, false, message + ' (got an apparently usable composition instead of a throw/denial: ' + JSON.stringify(outcome.composition) + ')');
  }
}

/** Mints a genuine brand bound to a fresh root and returns a real, working composition. */
function requireComposition(observationRoot) {
  const root = observationRoot || mkRoot();
  const mod = requireHostClaude();
  const brand = mintGenuineBrand(mod, root);
  assert.strictEqual(typeof mod.createHostComposition, 'function', 'runtime-host-claude.cjs must export createHostComposition(hostAdapterBrand)');
  const outcome = attemptCreateComposition(mod, brand);
  assert.strictEqual(outcome.threw, false, 'createHostComposition(<genuine test brand>) must succeed, not throw: ' + (outcome.error && outcome.error.message));
  const composition = outcome.composition;
  assert.ok(composition && typeof composition === 'object', 'createHostComposition(<genuine brand>) must return a composition object');
  assert.strictEqual(typeof composition.beginObservation, 'function', 'composition must expose beginObservation(preToolUseEvent)');
  assert.strictEqual(typeof composition.correlateToolResult, 'function', 'composition must expose correlateToolResult(handle, postToolUseEvent)');
  return { mod, brand, composition, root };
}

function genuineToolUseId() {
  return 'toolu_' + crypto.randomBytes(8).toString('hex');
}

function basePreToolUseEvent(overrides = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'sess-host-claude-' + crypto.randomBytes(4).toString('hex'),
    tool_use_id: genuineToolUseId(),
    tool_name: 'Agent',
    tool_input: { prompt: 'observation-only fixture, never a real native call' },
    cwd: process.cwd(),
    ...overrides,
  };
}

function basePostToolUseEvent(pre, overrides = {}) {
  return {
    hook_event_name: 'PostToolUse',
    session_id: pre.session_id,
    tool_use_id: pre.tool_use_id,
    tool_name: pre.tool_name,
    tool_response: { ok: true },
    ...overrides,
  };
}

function attemptCorrelate(composition, handle, postEvent) {
  try {
    const result = composition.correlateToolResult(handle, postEvent);
    return { threw: false, result, error: null };
  } catch (error) {
    return { threw: true, result: null, error };
  }
}

function assertNotSuccessfulCorrelation(outcome, message) {
  if (!outcome.threw) {
    assert.notStrictEqual(
      outcome.result && outcome.result.correlated,
      true,
      message + ' (got a returned result instead of a throw: ' + JSON.stringify(outcome.result) + ')',
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BRAND -- brand-gated composition creation; positive fixtures only via the
// double-gated test-only seam (Sequence150, preserved); P1I-150-02 adds the
// wrong-value negative case.
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-HOSTCOMP-BRAND-SEAM-ABSENT-OUTSIDE-TEST-MODE-01 RED: the test-only brand-minting seam is unavailable or denies in a clean-room process with no NODE_ENV=test and no capability env var', () => {
  const root = mkRoot();
  try {
    const result = runCleanRoomProbe(MINT_PROBE_SCRIPT(root));
    assert.strictEqual(result.status, 0, 'clean-room probe process itself must run to completion: ' + result.stderr);
    assert.ok(
      !result.stdout.includes('MINTED:'),
      'outside NODE_ENV=test + ' + CAPABILITY_ENV_VAR + ', the seam must never mint a usable brand (probe stdout: ' + result.stdout + ')',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-HOSTCOMP-BRAND-SEAM-MISSING-CAPABILITY-DENIED-02 RED: NODE_ENV=test alone, without the capability env var, still denies the seam (double-gate, not a single-gate)', () => {
  const root = mkRoot();
  try {
    const result = runCleanRoomProbe(MINT_PROBE_SCRIPT(root), { NODE_ENV: 'test' });
    assert.strictEqual(result.status, 0, 'probe process must run to completion: ' + result.stderr);
    assert.ok(
      !result.stdout.includes('MINTED:'),
      'NODE_ENV=test WITHOUT ' + CAPABILITY_ENV_VAR + ' must still deny the seam (probe stdout: ' + result.stdout + ')',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-HOSTCOMP-BRAND-SEAM-WRONG-CAPABILITY-VALUE-DENIED-03 RED: NODE_ENV=test WITH a non-empty but WRONG capability value still denies the seam -- P1I-150-02, only the exact fixed capability activates it', () => {
  const root = mkRoot();
  try {
    const result = runCleanRoomProbe(MINT_PROBE_SCRIPT(root), { NODE_ENV: 'test', [CAPABILITY_ENV_VAR]: WRONG_CAPABILITY_VALUE });
    assert.strictEqual(result.status, 0, 'probe process must run to completion: ' + result.stderr);
    assert.ok(
      !result.stdout.includes('MINTED:'),
      'NODE_ENV=test with a WRONG non-empty ' + CAPABILITY_ENV_VAR + ' value must still deny the seam -- an implementation accepting any non-empty value would wrongly pass here (probe stdout: ' + result.stdout + ')',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-HOSTCOMP-BRAND-SEAM-CORRECT-GATE-MINTS-WORKING-BRAND-04 RED: with NODE_ENV=test AND the EXACT capability value set, the seam mints a brand that createHostComposition() genuinely accepts (positive control)', () => {
  const mod = requireHostClaude();
  const root = mkRoot();
  try {
    const brand = mintGenuineBrand(mod, root);
    assert.strictEqual(typeof mod.createHostComposition, 'function', 'runtime-host-claude.cjs must export createHostComposition(hostAdapterBrand)');
    const outcome = attemptCreateComposition(mod, brand);
    assert.strictEqual(outcome.threw, false, 'a genuine test-minted brand must be accepted, not rejected: ' + (outcome.error && outcome.error.message));
    assert.strictEqual(typeof outcome.composition.beginObservation, 'function', 'the resulting composition must be genuinely usable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-HOSTCOMP-BRAND-MISSING-ARGUMENT-REJECTED-05 RED: createHostComposition() called with no argument at all is rejected -- no production general minter', () => {
  const mod = requireHostClaude();
  assert.strictEqual(typeof mod.createHostComposition, 'function', 'runtime-host-claude.cjs must export createHostComposition(hostAdapterBrand)');
  const outcome = attemptCreateComposition(mod, undefined);
  assertCompositionCreationRejected(outcome, 'createHostComposition() with a missing argument must be rejected');
});

test('P1I-OBS-HOSTCOMP-BRAND-PLAIN-VALUE-REJECTED-06 RED: createHostComposition() called with a plain object/string/number (never derived from the genuine seam) is rejected', () => {
  const mod = requireHostClaude();
  for (const plain of [{}, 'brand', 42, true, []]) {
    const outcome = attemptCreateComposition(mod, plain);
    assertCompositionCreationRejected(outcome, 'createHostComposition(' + JSON.stringify(plain) + ') (a plain value) must be rejected');
  }
});

test('P1I-OBS-HOSTCOMP-BRAND-CLONED-REJECTED-07 RED: a JSON round-trip clone of a genuine brand is rejected -- the brand cannot be reconstructed from its own serialized shape', () => {
  const mod = requireHostClaude();
  const root = mkRoot();
  try {
    const genuine = mintGenuineBrand(mod, root);
    let cloned;
    try {
      cloned = JSON.parse(JSON.stringify(genuine));
    } catch {
      cloned = {};
    }
    const outcome = attemptCreateComposition(mod, cloned);
    assertCompositionCreationRejected(outcome, 'a JSON-cloned brand must never be accepted as the genuine one');

    const realOutcome = attemptCreateComposition(mod, genuine);
    assert.strictEqual(realOutcome.threw, false, 'positive control: the real, unforged brand must still be accepted: ' + (realOutcome.error && realOutcome.error.message));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-HOSTCOMP-BRAND-FOREIGN-SHALLOW-COPY-REJECTED-08 RED: a shallow property copy of a genuine brand\'s own enumerable shape (a distinct forgery technique from JSON cloning) is rejected', () => {
  const mod = requireHostClaude();
  const root = mkRoot();
  try {
    const genuine = mintGenuineBrand(mod, root);
    const foreign = { ...genuine };
    const outcome = attemptCreateComposition(mod, foreign);
    assertCompositionCreationRejected(outcome, 'a shallow-copied "foreign" value sharing the genuine brand\'s enumerable shape must never be accepted');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1I-OBS-HOSTCOMP-BRAND-CALLER-SHAPED-GUESS-REJECTED-09 RED: a caller-constructed value that merely GUESSES a plausible brand shape (never derived from any genuine mint) is rejected', () => {
  const mod = requireHostClaude();
  const callerGuess = { __hostAdapterBrand: true, mintedAt: new Date().toISOString(), nonce: crypto.randomBytes(16).toString('hex') };
  const outcome = attemptCreateComposition(mod, callerGuess);
  assertCompositionCreationRejected(outcome, 'a caller-shaped guess must never be accepted merely for looking plausible');
});

// ═══════════════════════════════════════════════════════════════════════════
// TICKET -- P1I-150-01: beginObservation() creates the private, no-clobber,
// digest-correlated admission ticket the boundary requires; its root comes
// ONLY from the brand, never a caller option or env var.
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-HOSTCOMP-TICKET-CREATED-UNDER-BRAND-ROOT-10 RED: beginObservation(preEvent) creates a private admission ticket file under the exact root bound into the genuine brand', () => {
  const { composition, root } = requireComposition();
  const pre = basePreToolUseEvent();
  composition.beginObservation(pre);
  const sDig = sha256hex(pre.session_id);
  const tDig = sha256hex(pre.tool_use_id);
  assert.ok(fs.existsSync(admissionTicketPath(root, sDig, tDig)), 'beginObservation must create a digest-keyed admission ticket under <observationRoot>/admission/');
});

test('P1I-OBS-HOSTCOMP-TICKET-PRIVACY-NO-RAW-ID-11 RED: the admission ticket file (path and content) never contains the raw session_id or raw tool_use_id', () => {
  const { composition, root } = requireComposition();
  const pre = basePreToolUseEvent();
  composition.beginObservation(pre);
  const sDig = sha256hex(pre.session_id);
  const tDig = sha256hex(pre.tool_use_id);
  const ticketPath = admissionTicketPath(root, sDig, tDig);
  assert.ok(fs.existsSync(ticketPath), 'precondition: ticket must exist');
  assert.ok(!ticketPath.includes(pre.session_id) && !ticketPath.includes(pre.tool_use_id), 'the ticket FILENAME must be digest-keyed, never contain a raw ID');
  const content = fs.readFileSync(ticketPath, 'utf8');
  assert.ok(!content.includes(pre.session_id), 'the ticket content must never contain the raw session_id');
  assert.ok(!content.includes(pre.tool_use_id), 'the ticket content must never contain the raw tool_use_id');
});

test('P1I-OBS-HOSTCOMP-TICKET-DIGEST-CORRELATION-CORRECT-12 RED: the admission ticket carries the exact same session_digest/tool_use_digest a consumer would independently derive via sha256hex', () => {
  const { composition, root } = requireComposition();
  const pre = basePreToolUseEvent();
  composition.beginObservation(pre);
  const sDig = sha256hex(pre.session_id);
  const tDig = sha256hex(pre.tool_use_id);
  const ticketPath = admissionTicketPath(root, sDig, tDig);
  assert.ok(fs.existsSync(ticketPath), 'precondition: ticket must exist at the identity-derived digest path (this IS the correlation proof -- the path itself is keyed by the correct digests)');
  const parsed = JSON.parse(fs.readFileSync(ticketPath, 'utf8'));
  assert.strictEqual(parsed.session_digest, sDig, 'ticket content session_digest must equal the independently-derived sha256hex(session_id)');
  assert.strictEqual(parsed.tool_use_digest, tDig, 'ticket content tool_use_digest must equal the independently-derived sha256hex(tool_use_id)');
});

test('P1I-OBS-HOSTCOMP-TICKET-NO-CLOBBER-DUPLICATE-UNCHANGED-13 RED: a second beginObservation() call for the exact same identity never changes the first ticket\'s bytes on disk', () => {
  const { composition, root } = requireComposition();
  const pre = basePreToolUseEvent();
  const sDig = sha256hex(pre.session_id);
  const tDig = sha256hex(pre.tool_use_id);
  composition.beginObservation(pre);
  const ticketPath = admissionTicketPath(root, sDig, tDig);
  assert.ok(fs.existsSync(ticketPath), 'precondition: first ticket must exist');
  const firstBytes = fs.readFileSync(ticketPath);

  try {
    composition.beginObservation({ ...pre, tool_input: { prompt: 'a DIFFERENT payload, same identity' } });
  } catch {
    // A throw on the duplicate attempt is an equally valid no-clobber form.
  }
  const secondBytes = fs.readFileSync(ticketPath);
  assert.deepStrictEqual(secondBytes, firstBytes, 'no-clobber: a duplicate beginObservation() for the SAME identity must never overwrite the original ticket bytes, regardless of whether the second call throws or returns');
});

test('P1I-OBS-HOSTCOMP-TICKET-ROOT-FROM-BRAND-ONLY-ENV-IGNORED-14 RED: an ambient RUNTIME_HOST_OBSERVATION_ROOT environment variable never redirects where the ticket is written -- only the brand\'s own bound root does', () => {
  const mod = requireHostClaude();
  const genuineRoot = mkRoot();
  const attackerEnvRoot = mkRoot();
  const savedEnvRoot = process.env.RUNTIME_HOST_OBSERVATION_ROOT;
  try {
    process.env.RUNTIME_HOST_OBSERVATION_ROOT = attackerEnvRoot;
    const brand = mintGenuineBrand(mod, genuineRoot);
    const composition = mod.createHostComposition(brand);
    const pre = basePreToolUseEvent();
    composition.beginObservation(pre);
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    assert.ok(fs.existsSync(admissionTicketPath(genuineRoot, sDig, tDig)), 'the ticket must land under the BRAND\'s own bound root');
    assert.strictEqual(fs.existsSync(admissionTicketPath(attackerEnvRoot, sDig, tDig)), false, 'the ticket must NEVER land under an ambient env-var-claimed root, even when that env var is set to a plausible-looking different root');
  } finally {
    if (savedEnvRoot === undefined) delete process.env.RUNTIME_HOST_OBSERVATION_ROOT; else process.env.RUNTIME_HOST_OBSERVATION_ROOT = savedEnvRoot;
    fs.rmSync(genuineRoot, { recursive: true, force: true });
    fs.rmSync(attackerEnvRoot, { recursive: true, force: true });
  }
});

test('P1I-OBS-HOSTCOMP-TICKET-ROOT-FROM-BRAND-ONLY-CALLER-OPTION-IGNORED-15 RED: a second caller-supplied options argument to createHostComposition attempting to redirect the root is ignored -- only the brand\'s own bound root is ever used', () => {
  const mod = requireHostClaude();
  const genuineRoot = mkRoot();
  const attackerOptionRoot = mkRoot();
  try {
    const brand = mintGenuineBrand(mod, genuineRoot);
    const outcome = attemptCreateComposition(mod, brand, { observationRoot: attackerOptionRoot });
    assert.strictEqual(outcome.threw, false, 'createHostComposition(brand, <extra caller option>) must not itself throw -- the extra option is simply ignored, not a hard error');
    const pre = basePreToolUseEvent();
    outcome.composition.beginObservation(pre);
    const sDig = sha256hex(pre.session_id);
    const tDig = sha256hex(pre.tool_use_id);
    assert.ok(fs.existsSync(admissionTicketPath(genuineRoot, sDig, tDig)), 'the ticket must land under the BRAND\'s own bound root');
    assert.strictEqual(fs.existsSync(admissionTicketPath(attackerOptionRoot, sDig, tDig)), false, 'a caller-supplied options argument must never redirect where the ticket is written');
  } finally {
    fs.rmSync(genuineRoot, { recursive: true, force: true });
    fs.rmSync(attackerOptionRoot, { recursive: true, force: true });
  }
});

test('P1I-OBS-HOSTCOMP-TICKET-NOT-AUTHORITY-OR-BRAND-15A RED: the on-disk admission ticket is correlation evidence only -- treating its parsed bytes as a host brand can never create a usable composition or action authority', () => {
  const mod = requireHostClaude();
  const root = mkRoot();
  try {
    const brand = mintGenuineBrand(mod, root);
    const composition = mod.createHostComposition(brand);
    const pre = basePreToolUseEvent();
    composition.beginObservation(pre);
    const ticket = JSON.parse(fs.readFileSync(
      admissionTicketPath(root, sha256hex(pre.session_id), sha256hex(pre.tool_use_id)),
      'utf8',
    ));

    const outcome = attemptCreateComposition(mod, ticket);
    assertCompositionCreationRejected(
      outcome,
      'a parsed admission ticket must never be accepted as a host adapter brand or confer composition/action authority',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CORRELATE (unaffected by this correction; routed through the same
// brand-gated flow, now with an explicit observationRoot).
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-HOSTCOMP-CORRELATE-BEGIN-RETURNS-HANDLE-16 RED: beginObservation(genuine PreToolUse event) on a genuinely-created composition returns a non-null opaque handle distinct from the raw input event', () => {
  const { composition } = requireComposition();
  const pre = basePreToolUseEvent();
  const handle = composition.beginObservation(pre);
  assert.ok(handle !== null && handle !== undefined, 'beginObservation must return a handle');
  assert.notStrictEqual(handle, pre, 'the handle must not simply be the caller-supplied event object echoed back');
});

test('P1I-OBS-HOSTCOMP-CORRELATE-MATCHING-TOOL-USE-ID-17 RED: correlateToolResult with the exact genuine tool_use_id/session_id succeeds and its digests match sha256hex of the ORIGINAL raw IDs', () => {
  const { composition } = requireComposition();
  const pre = basePreToolUseEvent();
  const handle = composition.beginObservation(pre);
  const post = basePostToolUseEvent(pre);
  const result = composition.correlateToolResult(handle, post);
  assert.ok(result, 'a genuine matching correlation must return a result');
  assert.strictEqual(result.correlated, true, 'a genuine matching correlation must report correlated:true');
  assert.strictEqual(result.session_digest, sha256hex(pre.session_id), 'session_digest must be the exact sha256hex of the genuine raw session_id');
  assert.strictEqual(result.tool_use_digest, sha256hex(pre.tool_use_id), 'tool_use_digest must be the exact sha256hex of the genuine raw tool_use_id');
});

test('P1I-OBS-HOSTCOMP-CORRELATE-MISMATCHED-TOOL-USE-ID-REJECTED-18 RED: a PostToolUse event whose tool_use_id differs from the one beginObservation was given must never be reported as a successful correlation', () => {
  const { composition } = requireComposition();
  const pre = basePreToolUseEvent();
  const handle = composition.beginObservation(pre);
  const foreignPost = basePostToolUseEvent(pre, { tool_use_id: genuineToolUseId() });
  const outcome = attemptCorrelate(composition, handle, foreignPost);
  assertNotSuccessfulCorrelation(outcome, 'a mismatched tool_use_id must never correlate successfully');
});

// ═══════════════════════════════════════════════════════════════════════════
// UNFORGEABLE -- HANDLE layer (distinct from the BRAND layer above;
// unaffected by this correction).
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-HOSTCOMP-UNFORGEABLE-CLONED-HANDLE-REJECTED-19 RED: a JSON round-trip clone of a genuine observation handle must be rejected by correlateToolResult', () => {
  const { composition } = requireComposition();
  const pre = basePreToolUseEvent();
  const handle = composition.beginObservation(pre);
  let clonedHandle;
  try {
    clonedHandle = JSON.parse(JSON.stringify(handle));
  } catch {
    clonedHandle = {};
  }
  const post = basePostToolUseEvent(pre);
  const outcome = attemptCorrelate(composition, clonedHandle, post);
  assertNotSuccessfulCorrelation(outcome, 'a JSON-cloned handle must never be accepted as the genuine private handle');

  const realOutcome = attemptCorrelate(composition, handle, post);
  assert.strictEqual(realOutcome.threw, false, 'positive control: the real handle must not throw: ' + (realOutcome.error && realOutcome.error.message));
  assert.strictEqual(realOutcome.result && realOutcome.result.correlated, true, 'positive control: the real, unforged handle must still correlate successfully');
});

test('P1I-OBS-HOSTCOMP-UNFORGEABLE-FOREIGN-COMPOSITION-HANDLE-REJECTED-20 RED: a handle minted by one createHostComposition() instance must be rejected by a DIFFERENT independent composition instance', () => {
  const mod = requireHostClaude();
  const rootA = mkRoot();
  const rootB = mkRoot();
  try {
    const brandA = mintGenuineBrand(mod, rootA);
    const brandB = mintGenuineBrand(mod, rootB);
    const outcomeA = attemptCreateComposition(mod, brandA);
    const outcomeB = attemptCreateComposition(mod, brandB);
    assert.strictEqual(outcomeA.threw, false, 'composition A must be creatable from a genuine brand: ' + (outcomeA.error && outcomeA.error.message));
    assert.strictEqual(outcomeB.threw, false, 'composition B must be creatable from a genuine brand: ' + (outcomeB.error && outcomeB.error.message));
    const compositionA = outcomeA.composition;
    const compositionB = outcomeB.composition;
    assert.notStrictEqual(compositionA, compositionB, 'two independent createHostComposition() calls must not return the same shared singleton');

    const pre = basePreToolUseEvent();
    const handleFromA = compositionA.beginObservation(pre);
    const post = basePostToolUseEvent(pre);
    const outcome = attemptCorrelate(compositionB, handleFromA, post);
    assertNotSuccessfulCorrelation(outcome, "composition B must reject composition A's handle -- private authenticated composition is per-instance, never globally shared");
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test('P1I-OBS-HOSTCOMP-UNFORGEABLE-CALLER-AUTHORITY-FIELDS-IGNORED-21 RED: caller-supplied authority-shaped fields (role, grant_id, capability) on the PreToolUse/PostToolUse payloads never appear in or influence the public result', () => {
  const { composition } = requireComposition();
  const pre = basePreToolUseEvent({ role: 'arch-platform', grant_id: 'fake-grant-0001', capability: 'fake-capability-token' });
  const handle = composition.beginObservation(pre);
  const post = basePostToolUseEvent(pre, { role: 'quality-gater', grant_id: 'fake-grant-0002', capability: 'fake-capability-token-2' });
  const result = composition.correlateToolResult(handle, post);
  assert.ok(result, 'a genuine matching correlation must still succeed even when extraneous fields are present');
  for (const forbiddenKey of ['role', 'grant_id', 'capability', 'grantId', 'roleName']) {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(result, forbiddenKey),
      false,
      'caller-supplied authority-shaped field "' + forbiddenKey + '" must never be laundered into the public observation result',
    );
  }
});

test('P1I-OBS-HOSTCOMP-UNFORGEABLE-ENV-IDENTITY-IGNORED-22 RED: environment-variable role/identity claims never influence beginObservation/correlateToolResult output -- identity comes only from genuine host events (PLAN.md L77)', () => {
  const { composition } = requireComposition();
  const savedEnv = {
    CLAUDE_ROLE: process.env.CLAUDE_ROLE,
    ROLE: process.env.ROLE,
    CLAUDE_AGENT_TYPE: process.env.CLAUDE_AGENT_TYPE,
  };
  try {
    process.env.CLAUDE_ROLE = 'arch-platform';
    process.env.ROLE = 'verifier';
    process.env.CLAUDE_AGENT_TYPE = 'quality-gater';
    const pre = basePreToolUseEvent();
    const handle = composition.beginObservation(pre);
    const post = basePostToolUseEvent(pre);
    const result = composition.correlateToolResult(handle, post);
    assert.strictEqual(result.correlated, true, 'a genuine correlation must still succeed regardless of ambient env identity claims');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'role'), false, 'environment-variable role claims must never surface as a `role` field on the public result');
  } finally {
    for (const key of Object.keys(savedEnv)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// REDACTED (unaffected by this correction: bounded public result with
// digests only, never raw session_id/tool_use_id).
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-HOSTCOMP-REDACTED-EXACT-KEY-ALLOWLIST-23 RED: the public observation result has EXACTLY the corrected 6-key digest-only schema, no more and no less', () => {
  const { composition } = requireComposition();
  const pre = basePreToolUseEvent();
  const handle = composition.beginObservation(pre);
  const post = basePostToolUseEvent(pre);
  const result = composition.correlateToolResult(handle, post);
  const expectedKeys = ['correlated', 'observed_at', 'schema', 'session_digest', 'success', 'tool_use_digest'].sort();
  assert.deepStrictEqual(
    Object.keys(result).sort(),
    expectedKeys,
    'public observation result must expose exactly {schema,correlated,success,session_digest,tool_use_digest,observed_at}, never a raw-ID-bearing shape',
  );
  assert.strictEqual(result.schema, 'runtime/host-observation-result/v1', 'result schema literal must be present and exact');
  assert.match(result.session_digest, DIGEST_RE, 'session_digest must be 64 lowercase hex');
  assert.match(result.tool_use_digest, DIGEST_RE, 'tool_use_digest must be 64 lowercase hex');
  assert.match(result.observed_at, ISO_MS_Z_RE, 'observed_at must be UTC ISO8601 with milliseconds and Z');
});

test('P1I-OBS-HOSTCOMP-REDACTED-NO-RAW-ID-OR-PAYLOAD-LEAK-24 RED: the raw session_id, raw tool_use_id, and raw tool_input/tool_response content never appear anywhere in the serialized public result, even adversarially', () => {
  const { composition } = requireComposition();
  const secretInputMarker = 'RAW-INPUT-MARKER-' + crypto.randomBytes(12).toString('hex');
  const secretOutputMarker = 'RAW-OUTPUT-MARKER-' + crypto.randomBytes(12).toString('hex');
  const pre = basePreToolUseEvent({
    session_id: 'sess-redaction-probe-' + crypto.randomBytes(8).toString('hex'),
    tool_use_id: 'toolu_redaction_probe_' + crypto.randomBytes(8).toString('hex'),
    tool_input: { prompt: secretInputMarker, nested: { again: secretInputMarker } },
  });
  const handle = composition.beginObservation(pre);
  const post = basePostToolUseEvent(pre, {
    tool_response: { content: secretOutputMarker, blob: 'x'.repeat(2048) + secretOutputMarker },
  });
  const result = composition.correlateToolResult(handle, post);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(pre.session_id), 'the raw session_id must never appear in the public result');
  assert.ok(!serialized.includes(pre.tool_use_id), 'the raw tool_use_id must never appear in the public result');
  assert.ok(!serialized.includes(secretInputMarker), 'raw tool_input content must never leak into the public result');
  assert.ok(!serialized.includes(secretOutputMarker), 'raw tool_response content must never leak into the public result');
  assert.ok(serialized.length < 2048, 'the redacted public result must be bounded, never proportional to raw payload size: got ' + serialized.length + ' bytes');
});

test('P1I-OBS-HOSTCOMP-REDACTED-DIGEST-CORRECTNESS-DISTINGUISHES-INPUTS-25 RED: two correlations with different raw IDs produce different, individually-correct digests -- proving genuine per-call correlation capability without ever exposing the raw values themselves', () => {
  const { composition } = requireComposition();
  const preA = basePreToolUseEvent();
  const resultA = composition.correlateToolResult(composition.beginObservation(preA), basePostToolUseEvent(preA));
  const preB = basePreToolUseEvent();
  const resultB = composition.correlateToolResult(composition.beginObservation(preB), basePostToolUseEvent(preB));

  assert.strictEqual(resultA.session_digest, sha256hex(preA.session_id));
  assert.strictEqual(resultA.tool_use_digest, sha256hex(preA.tool_use_id));
  assert.strictEqual(resultB.session_digest, sha256hex(preB.session_id));
  assert.strictEqual(resultB.tool_use_digest, sha256hex(preB.tool_use_id));
  assert.notStrictEqual(resultA.session_digest, resultB.session_digest, 'distinct raw session_ids must produce distinct session_digest values');
  assert.notStrictEqual(resultA.tool_use_digest, resultB.tool_use_digest, 'distinct raw tool_use_ids must produce distinct tool_use_digest values');
});

// ═══════════════════════════════════════════════════════════════════════════
// NOAUTHORITY (unaffected by this correction).
// ═══════════════════════════════════════════════════════════════════════════

test('P1I-OBS-HOSTCOMP-NOAUTHORITY-FORBIDDEN-MODULE-EXPORTS-ABSENT-26 RED: runtime-host-claude.cjs exports none of the authority-producing verbs this observation-only slice must never create', () => {
  const mod = requireHostClaude();
  const forbidden = [
    'spawn', 'spawnAgent', 'dispatch', 'dispatchBusinessWork', 'requestWork',
    'acceptConsultation', 'ackConsultation', 'accept', 'ack',
    'mintCapability', 'grantCapability', 'mintPrep', 'mintCP',
    'mutateFence', 'mutateTerminalFence', 'setTerminalFence',
    'createRequesterBinding', 'publishCapability', 'sendMessage',
  ];
  for (const verb of forbidden) {
    assert.strictEqual(
      typeof mod[verb],
      'undefined',
      'runtime-host-claude.cjs must NOT export "' + verb + '" -- this observation-only slice creates no requester, role, spawn, CP, PREP, capability, grant, business-dispatch or fence authority',
    );
  }
});

test('P1I-OBS-HOSTCOMP-NOAUTHORITY-COMPOSITION-METHOD-ALLOWLIST-27 RED: the composition object exposes ONLY beginObservation and correlateToolResult as its own callable surface -- no additional authority-shaped method is attached', () => {
  const { composition } = requireComposition();
  const ownMethodNames = Object.keys(composition)
    .filter((key) => typeof composition[key] === 'function')
    .sort();
  assert.deepStrictEqual(
    ownMethodNames,
    ['beginObservation', 'correlateToolResult'],
    'the private authenticated composition must expose exactly this closed observation-only method surface, never an additional spawn/grant/dispatch-shaped method',
  );
});

function p1iaIbindFixture() {
  const sessionId = '7129a24c-ff6e-45db-91d8-a6e79f81de33';
  const toolUseId = 'toolu_01CayLyCEDjY6tXnia1gRV67';
  const denyLiteral = 'IBIND_DENY_TASK_V1';
  const hookId = '233abbf7-a4dd-41e5-b977-fa1450f150a9';
  return {
    observationRoot: mkRoot(),
    ownerStreamRows: [
      { type: 'system', subtype: 'init', session_id: sessionId, tools: ['Task'] },
      { type: 'assistant', session_id: sessionId, message: { content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { run_in_background: true } }] } },
      { type: 'system', subtype: 'hook_started', session_id: sessionId, hook_event: 'PreToolUse', hook_name: 'PreToolUse:Agent', hook_id: hookId },
      { type: 'system', subtype: 'hook_response', session_id: sessionId, hook_event: 'PreToolUse', hook_name: 'PreToolUse:Agent', hook_id: hookId, exit_code: 2, stderr: denyLiteral },
      { type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: true, content: denyLiteral }] } },
      { type: 'assistant', session_id: sessionId, message: { content: [{ type: 'text', text: 'SEQUENCE1_PROBE_RESULT nonce DENIED' }] } },
      { type: 'result', subtype: 'success', session_id: sessionId, result: 'SEQUENCE1_PROBE_RESULT nonce DENIED', permission_denials: [{ tool_name: 'Task', tool_use_id: toolUseId }] },
    ],
    automaticHookRecords: [{
      schema: 'sequence1-ibind-deny-hook-record-v2',
      hookEventName: 'PreToolUse',
      matcherToolName: 'Task',
      payloadToolName: 'Agent',
      sessionIdSha256: sha256hex(sessionId),
      toolUseIdSha256: sha256hex(toolUseId),
      denyLiteral,
      authority: false,
    }],
  };
}

function cloneP1iaFixture(value) {
  return JSON.parse(JSON.stringify(value));
}

function attemptP1iaAdmission(mod, fixture) {
  try {
    const brand = withCapabilityEnv(() => mod.__TEST_ONLY__admitIbindEvidence(fixture));
    return { threw: false, brand };
  } catch (error) {
    return { threw: true, error, brand: null };
  }
}

test('P1IA-IBIND-HOST-DUAL-CHANNEL-POSITIVE-28 RED: exact owner stream plus one independently correlated automatic Task/Agent denial record yields only an opaque process-local composition brand', () => {
  const mod = requireHostClaude();
  assert.strictEqual(typeof mod.__TEST_ONLY__admitIbindEvidence, 'function', 'production must expose the exact gated I-BIND evidence-admission seam');
  const fixture = p1iaIbindFixture();
  try {
    const outcome = attemptP1iaAdmission(mod, fixture);
    assert.strictEqual(outcome.threw, false, 'the exact accepted dual-channel fixture must be admitted: ' + (outcome.error && outcome.error.message));
    assert.ok(outcome.brand && typeof outcome.brand === 'object', 'admission must yield an opaque process-local brand');
    assert.doesNotThrow(() => mod.createHostComposition(outcome.brand), 'the genuine admitted brand must create the observation-only composition');
    const cloned = cloneP1iaFixture(outcome.brand);
    assertCompositionCreationRejected(attemptCreateComposition(mod, cloned), 'JSON cloning must never preserve the process-local brand');
  } finally {
    fs.rmSync(fixture.observationRoot, { recursive: true, force: true });
  }
});

test('P1IA-IBIND-HOST-FAIL-CLOSED-MATRIX-29 RED: every missing, mismatched, duplicated, manual or dispatched variant is rejected and never becomes a composition brand', () => {
  const mod = requireHostClaude();
  assert.strictEqual(typeof mod.__TEST_ONLY__admitIbindEvidence, 'function', 'precondition: exact gated I-BIND seam');
  const base = p1iaIbindFixture();
  const cases = {
    stream_only: (x) => { x.automaticHookRecords = []; },
    record_only: (x) => { x.ownerStreamRows = []; },
    duplicate_record: (x) => { x.automaticHookRecords.push(cloneP1iaFixture(x.automaticHookRecords[0])); },
    session_digest_mismatch: (x) => { x.automaticHookRecords[0].sessionIdSha256 = '0'.repeat(64); },
    tool_use_digest_mismatch: (x) => { x.automaticHookRecords[0].toolUseIdSha256 = '1'.repeat(64); },
    wrong_surfaces: (x) => { x.automaticHookRecords[0].matcherToolName = 'Agent'; x.automaticHookRecords[0].payloadToolName = 'Task'; },
    missing_permission_denial: (x) => { x.ownerStreamRows.at(-1).permission_denials = []; },
    hook_allowed: (x) => { x.ownerStreamRows.find((r) => r.subtype === 'hook_response').exit_code = 0; },
    second_agent_attempt: (x) => { x.ownerStreamRows.splice(2, 0, cloneP1iaFixture(x.ownerStreamRows[1])); },
    child_artifact: (x) => { x.ownerStreamRows.push({ type: 'system', subtype: 'task_started', task_id: 'forbidden-child' }); },
    task_progress_artifact: (x) => { x.ownerStreamRows.push({ type: 'system', subtype: 'task_progress', task_id: 'forbidden-child' }); },
    background_tasks_changed_artifact: (x) => { x.ownerStreamRows.push({ type: 'system', subtype: 'background_tasks_changed', handle: 'forbidden-handle' }); },
    child_session_row_artifact: (x) => { x.ownerStreamRows.push({ type: 'system', subtype: 'init', session_id: 'sess-forbidden-child-survivor', tools: ['Task'] }); },
    task_output_path_artifact: (x) => { x.ownerStreamRows.push({ type: 'system', subtype: 'task_output_reference', path: '/tasks/forbidden-child/result.output' }); },
    manual_claims: (x) => { x.manual = true; x.role = 'arch-platform'; x.grant_id = 'forged'; x.pid = 1; x.argv = ['claude']; x.operatorApproved = true; },
    object_shaped_tool_registry: (x) => { x.ownerStreamRows.find((r) => r.subtype === 'init').tools = [{ name: 'Task' }]; },
  };
  try {
    for (const [name, mutate] of Object.entries(cases)) {
      const fixture = cloneP1iaFixture(base);
      mutate(fixture);
      const outcome = attemptP1iaAdmission(mod, fixture);
      if (!outcome.threw && outcome.brand) {
        assertCompositionCreationRejected(attemptCreateComposition(mod, outcome.brand), name + ' must not yield a usable composition brand');
      }
    }
  } finally {
    fs.rmSync(base.observationRoot, { recursive: true, force: true });
  }
});

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function mintProductionAdmission(overrides) {
  const mod = requireHostClaude();
  const base = {
    projectRoot: PROJECT_ROOT,
    event: { hook_event_name: 'PreToolUse', tool_name: 'Bash', model: 'claude-sonnet-5' },
    entrypoint: 'monitor-docs',
    argvDigest: sha256hex('entrypoint:monitor-docs:readonly'),
    roleScope: null,
  };
  return mod.mintProductionHostComposition(Object.assign(base, overrides || {}));
}

test('R131-HOST-PRODUCTION-SIGNED-ADMISSION-POSITIVE-31: signed production admission validates for its exact scope', () => {
  const mod = requireHostClaude();
  assert.strictEqual(mod.operationForAction({ kind: 'root-source-spawn', runtime: 'claude-native' }), 'Agent');
  assert.strictEqual(mod.operationForAction({ kind: 'root-source-spawn', runtime: 'host-process' }), null);
  const minted = mintProductionAdmission();
  assert.strictEqual(minted.ok, true);
  assert.match(minted.compositionId, /^[0-9a-f]{32}$/);
  assert.deepStrictEqual(minted.record.supported_operations, ['Agent', 'Bash', 'SendMessage', 'TaskOutput']);
  const consumed = mod.consumeProductionHostComposition(PROJECT_ROOT, minted.compositionId, {
    entrypoint: 'monitor-docs', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null,
  });
  assert.strictEqual(consumed.ok, true);
});

test('R131-HOST-PRODUCTION-WRONG-MODEL-32: non-sonnet or absent model evidence cannot mint', () => {
  assert.strictEqual(mintProductionAdmission({ event: { hook_event_name: 'PreToolUse', tool_name: 'Bash', model: 'claude-haiku-4-5' } }).ok, false);
  assert.strictEqual(mintProductionAdmission({ event: { hook_event_name: 'PreToolUse', tool_name: 'Bash' } }).ok, false);
});

test('R131-HOST-PRODUCTION-WRONG-SCOPE-33: an exact admission rejects a foreign entrypoint or argv scope', () => {
  const mod = requireHostClaude();
  const minted = mintProductionAdmission();
  assert.strictEqual(minted.ok, true);
  assert.strictEqual(mod.consumeProductionHostComposition(PROJECT_ROOT, minted.compositionId, {
    entrypoint: 'ingest-content', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null,
  }).ok, false);
  assert.strictEqual(mod.consumeProductionHostComposition(PROJECT_ROOT, minted.compositionId, {
    entrypoint: 'monitor-docs', argvDigest: 'f'.repeat(64), roleScope: null,
  }).ok, false);
});

test('R131-HOST-PRODUCTION-EXPIRY-34: expired admission is rejected before consumption', () => {
  const mod = requireHostClaude();
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  const minted = mintProductionAdmission();
  assert.strictEqual(minted.ok, true);
  const recordPath = path.join(rll.registryRepoDir(PROJECT_ROOT), 'host-compositions', minted.compositionId + '.json');
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  record.expires_at = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
  assert.strictEqual(mod.consumeProductionHostComposition(PROJECT_ROOT, minted.compositionId, {
    entrypoint: 'monitor-docs', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null,
  }).ok, false);
});

test('R131-HOST-PRODUCTION-REPLAY-35: exact composition is consumable once only', () => {
  const mod = requireHostClaude();
  const minted = mintProductionAdmission();
  const expected = { entrypoint: 'monitor-docs', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null };
  assert.strictEqual(mod.consumeProductionHostComposition(PROJECT_ROOT, minted.compositionId, expected).ok, true);
  assert.strictEqual(mod.consumeProductionHostComposition(PROJECT_ROOT, minted.compositionId, expected).ok, false);
});

test('R131-HOST-PRODUCTION-FORGERY-36: record or signature forgery is rejected', () => {
  const mod = requireHostClaude();
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  for (const mutate of [
    (record) => { record.actual_model = 'claude-haiku-4-5'; },
    (record) => { record.signature_ed25519_base64 = Buffer.alloc(64).toString('base64'); },
  ]) {
    const minted = mintProductionAdmission();
    const recordPath = path.join(rll.registryRepoDir(PROJECT_ROOT), 'host-compositions', minted.compositionId + '.json');
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    mutate(record);
    fs.writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
    assert.strictEqual(mod.consumeProductionHostComposition(PROJECT_ROOT, minted.compositionId, {
      entrypoint: 'monitor-docs', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null,
    }).ok, false);
  }
});
