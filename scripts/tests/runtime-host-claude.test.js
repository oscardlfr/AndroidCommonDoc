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
const { test, after } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const IMPL = path.resolve(__dirname, '../lib/runtime-host-claude.cjs');
const rll = require(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'));
const rc = require(path.resolve(__dirname, '../lib/runtime-consultation.cjs'));

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

function sha256bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

function makeNativeOutcomeFixture(label, proposedOverride = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rhc-native-outcome-'));
  for (const args of [
    ['-C', projectRoot, 'init', '-q'],
    ['-C', projectRoot, 'config', 'user.email', 'runtime-host-test@test.local'],
    ['-C', projectRoot, 'config', 'user.name', 'Runtime Host Test'],
    ['-C', projectRoot, 'commit', '-q', '--allow-empty', '-m', 'init'],
  ]) {
    const git = spawnSync('git', args, { encoding: 'utf8' });
    assert.strictEqual(git.status, 0, git.stderr);
  }
  const waveDir = path.join(projectRoot, '.planning', 'wave-native-outcome-' + label);
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# native outcome fixture\n');
  const plan = rll.discoverPlan(projectRoot);
  const worktreeId = rll.computeWorktreeId(projectRoot);
  const sessionId = 'native-outcome-session-' + label;
  const toolUseId = 'native-outcome-tool-' + label;
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const generation = rll.resolveSessionGeneration(projectRoot, identity);
  const binding = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, plan.planDigest, 600);
  assert.strictEqual(generation.ok, true);
  assert.strictEqual(binding.ok, true);
  const actionId = rll.generateActionId();
  const payload = rll.buildRoleSpawnPayload('native-outcome', 'arch-platform', 'arch-platform', null, 'canonical bootstrap ' + label);
  const minted = rll.mintRoleLifecycleAction(
    projectRoot, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(projectRoot),
    worktreeId, plan.planDigest, sha256hex('native-outcome-policy'), generation.generationId,
    'arch-platform', payload, new Date(Date.now() + 300000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  );
  assert.strictEqual(minted.ok, true);
  const canonicalInput = rll.canonicalNativeAgentInputForAction(minted.action);
  const proposedInput = Object.assign({}, canonicalInput, proposedOverride);
  const claim = rll.mintRoleSpawnExecutionClaim({ repoId: rll.computeRepoId(projectRoot) }, minted.action, binding.binding.binding_id, {
    runtimeSessionId: sessionId,
    sourceToolUseId: toolUseId,
    canonicalInputDigest: sha256hex(rc.canonicalJSONStringify(canonicalInput)),
    proposedInputDigest: sha256hex(rc.canonicalJSONStringify(proposedInput)),
    modelDeviation: rc.canonicalJSONStringify(canonicalInput) !== rc.canonicalJSONStringify(proposedInput),
  }, 240);
  assert.strictEqual(claim.ok, true, JSON.stringify(claim));
  return { projectRoot, sessionId, toolUseId, action: minted.action, claim: claim.record, canonicalInput, proposedInput };
}

function cleanupNativeOutcomeFixture(fixture) {
  try { fs.rmSync(rll.registryRepoDir(fixture.projectRoot), { recursive: true, force: true }); } catch { /* best effort */ }
  fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
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
let SESSION_HOST_FIXTURE = null;

function sessionHostFixture() {
  if (SESSION_HOST_FIXTURE) return SESSION_HOST_FIXTURE;
  SESSION_HOST_FIXTURE = writeHostContractFixture('session');
  const published = requireHostClaude().publishClaudeHostContractPackage({
    projectRoot: SESSION_HOST_FIXTURE.projectRoot,
    qualificationPath: SESSION_HOST_FIXTURE.qualificationPath,
    evidenceRoot: SESSION_HOST_FIXTURE.evidenceRoot,
    observerPath: SESSION_HOST_FIXTURE.observerPath,
  });
  assert.strictEqual(published.ok, true, JSON.stringify(published));
  return SESSION_HOST_FIXTURE;
}

function sessionHostPin(fixture) {
  return {
    executablePath: fixture.executablePath,
    cliVersion: fixture.qualification.cli.version,
    observerPath: fixture.observerPath,
    transportProfile: fixture.qualification.transport_profile,
    os: process.platform,
  };
}

after(() => {
  if (SESSION_HOST_FIXTURE) cleanupHostContractFixture(SESSION_HOST_FIXTURE);
});

function mintProductionAdmission(overrides) {
  const mod = requireHostClaude();
  const fixture = sessionHostFixture();
  const projectRoot = fixture.projectRoot;
  const sessionId = 'r131-host-production-' + crypto.randomBytes(12).toString('hex');
  const sessionEvidence = mod.recordProductionSessionIdentity({
    projectRoot,
    event: {
      type: 'system', subtype: 'init', session_id: sessionId,
      model: 'claude-sonnet-5', cwd: projectRoot,
      tools: ['Task', 'Bash', 'SendMessage', 'Read'], mcp_servers: [{ name: 'docs', status: 'connected' }],
    },
    hostPin: sessionHostPin(fixture),
  });
  assert.strictEqual(sessionEvidence.ok, true, 'production mint precondition: genuine SessionStart evidence');
  assert.strictEqual(sessionEvidence.record.observation_source, 'managed-system-init-stream');
  assert.match(sessionEvidence.record.pin_digest, DIGEST_RE);
  assert.match(sessionEvidence.record.host_contract_digest, DIGEST_RE);
  const base = {
    projectRoot,
    event: { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: sessionId },
    entrypoint: 'monitor-docs',
    argvDigest: sha256hex('entrypoint:monitor-docs:readonly'),
    roleScope: null,
  };
  return Object.assign(mod.mintProductionHostComposition(Object.assign(base, overrides || {})), { projectRoot });
}

test('R131-HOST-PRODUCTION-SIGNED-ADMISSION-POSITIVE-31: signed production admission validates for its exact scope', () => {
  const mod = requireHostClaude();
  assert.strictEqual(mod.operationForAction({ kind: 'root-source-spawn', runtime: 'claude-native' }), 'Agent');
  assert.strictEqual(mod.operationForAction({ kind: 'root-source-spawn', runtime: 'host-process' }), null);
  const minted = mintProductionAdmission();
  assert.strictEqual(minted.ok, true);
  assert.match(minted.compositionId, /^[0-9a-f]{32}$/);
  assert.strictEqual(minted.record.schema, 'runtime/claude-host-composition/v2');
  assert.strictEqual(minted.record.requested_profile_name, 'balanced');
  assert.match(minted.record.requested_profile_digest, DIGEST_RE);
  assert.strictEqual(minted.record.actual_model, 'claude-sonnet-5');
  assert.deepStrictEqual(minted.record.supported_operations, ['Agent', 'Bash', 'SendMessage', 'TaskOutput']);
  const consumed = mod.consumeProductionHostComposition(minted.projectRoot, minted.compositionId, {
    entrypoint: 'monitor-docs', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null,
  });
  assert.strictEqual(consumed.ok, true);
});

test('HC-CE managed conductor authority requires a signed system/init session and no hook event', () => {
  const mod = requireHostClaude();
  const fixture = sessionHostFixture();
  const projectRoot = fixture.projectRoot;
  const sessionId = `managed-conductor-${crypto.randomBytes(12).toString('hex')}`;
  const recorded = mod.recordProductionSessionIdentity({
    projectRoot,
    event: {
      type: 'system', subtype: 'init', session_id: sessionId,
      model: 'claude-sonnet-5', cwd: projectRoot,
      tools: ['Task', 'Bash', 'SendMessage'], mcp_servers: [],
    },
    hostPin: sessionHostPin(fixture),
  });
  assert.equal(recorded.ok, true);
  const argvDigest = sha256hex('managed-conductor-entrypoint');
  const composition = mod.mintManagedHostComposition({
    projectRoot, sessionId, entrypoint: 'init-session', argvDigest, roleScope: 'arch-platform',
  });
  assert.equal(composition.ok, true);
  assert.equal(composition.evidenceMethod, 'CONDUCTOR_DIRECT_EXECUTION');
  assert.equal(mod.validateProductionHostComposition(projectRoot, composition.compositionId, {
    entrypoint: 'init-session', argvDigest, roleScope: 'arch-platform',
  }).ok, true);
  assert.equal(mod.mintManagedHostComposition({
    projectRoot, sessionId: `${sessionId}-foreign`, entrypoint: 'init-session', argvDigest,
    roleScope: 'arch-platform',
  }).ok, false);
  const multiRoleScope = [
    'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater',
  ];
  const lifecycleAuthority = mod.mintManagedLifecycleCommandAuthority({
    projectRoot, sessionId, subcommand: 'ensure', argvDigest,
    role: multiRoleScope, actionId: null,
  });
  assert.equal(lifecycleAuthority.ok, true,
    'managed init-session must admit the canonical sorted multi-role ensure scope');
  assert.equal(mod.mintManagedLifecycleCommandAuthority({
    projectRoot, sessionId, subcommand: 'ensure', argvDigest: sha256hex('invalid-order'),
    role: [...multiRoleScope].reverse(), actionId: null,
  }).ok, false, 'managed authority must reject a non-canonical multi-role scope');
});

test('HC-CE managed ingest denial needs host composition but no lifecycle grant', async () => {
  const mod = requireHostClaude();
  const fixture = sessionHostFixture();
  const projectRoot = fixture.projectRoot;
  const sessionId = `managed-ingest-denied-${crypto.randomBytes(12).toString('hex')}`;
  assert.equal(mod.recordProductionSessionIdentity({
    projectRoot,
    event: {
      type: 'system', subtype: 'init', session_id: sessionId,
      model: 'claude-sonnet-5', cwd: projectRoot,
      tools: ['Task', 'Bash', 'SendMessage'], mcp_servers: [],
    },
    hostPin: sessionHostPin(fixture),
  }).ok, true);
  const entrypointPath = require.resolve('../lib/runtime-collaboration-entrypoints.cjs');
  const savedNodeEnv = process.env.NODE_ENV;
  const savedEntrypointCapability = process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY;
  process.env.NODE_ENV = 'test';
  process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY = 'p3-entrypoints-v1';
  delete require.cache[entrypointPath];
  const entrypoint = require(entrypointPath);
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
  if (savedEntrypointCapability === undefined) delete process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY;
  else process.env.RUNTIME_COLLABORATION_ENTRYPOINTS_TEST_CAPABILITY = savedEntrypointCapability;
  const intent = { request_ref: `request:${'a'.repeat(64)}`, approval_ref: '' };
  const plan = entrypoint.planEntrypointStep('ingest-content', intent, projectRoot);
  assert.equal(plan.command, null);
  const consumptionProbe = mod.mintManagedHostComposition({
    projectRoot, sessionId, entrypoint: 'ingest-content',
    argvDigest: plan.argv_digest, roleScope: plan.role_scope,
  });
  assert.equal(consumptionProbe.ok, true);
  const consumed = mod.consumeProductionHostComposition(projectRoot, consumptionProbe.compositionId, {
    entrypoint: 'ingest-content', argvDigest: plan.argv_digest, roleScope: plan.role_scope,
  });
  assert.equal(consumed.ok, true);
  const ports = entrypoint.__TEST_ONLY__createProductionPorts({
    entrypoint: 'ingest-content', projectRoot, intent, lifecycleBinding: null,
  }, plan, consumed.record);
  const context = entrypoint.__TEST_ONLY__createTrustedHostContext(ports);
  assert.equal((await entrypoint.executeEntrypoint('ingest-content', intent, context)).status, 'BLOCKED');
  const composition = mod.mintManagedHostComposition({
    projectRoot, sessionId, entrypoint: 'ingest-content',
    argvDigest: plan.argv_digest, roleScope: plan.role_scope,
  });
  assert.equal(composition.ok, true);
  const result = spawnSync(process.execPath, [
    IMPL.replace(/runtime-host-claude\.cjs$/, 'runtime-collaboration-entrypoints.cjs'),
    'execute', '--entrypoint', 'ingest-content', '--project-root', projectRoot,
    '--intent', Buffer.from(rc.canonicalJSONStringify(intent)).toString('base64url'),
    '--host-composition', composition.compositionId,
  ], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(result.status, 5, result.stderr || result.stdout);
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    actions: [], detail: 'approval-required', entrypoint: 'ingest-content',
    result: null, schema: 'runtime/collaboration-entrypoint-result/v1',
    selection: null, status: 'BLOCKED',
  });
});

test('P1-MODEL-32: actual model is an observed bounded literal distinct from the requested profile alias', () => {
  const mod = requireHostClaude();
  const fixture = sessionHostFixture();
  const projectRoot = fixture.projectRoot;
  const sessionId = 'r131-host-wrong-model-' + crypto.randomBytes(12).toString('hex');
  assert.strictEqual(mod.recordProductionSessionIdentity({
    projectRoot,
    event: { hook_event_name: 'SessionStart', source: 'startup', session_id: sessionId, model: 'claude-haiku-4-5', cwd: projectRoot },
    hostPin: sessionHostPin(fixture),
  }).ok, false);
  const observed = mod.recordProductionSessionIdentity({
    projectRoot,
    event: {
      type: 'system', subtype: 'init', session_id: sessionId,
      model: 'claude-fable-5-1', cwd: projectRoot,
      tools: ['Task', 'Bash', 'SendMessage', 'Read'], mcp_servers: [{ name: 'docs' }],
    },
    hostPin: sessionHostPin(fixture),
  });
  assert.strictEqual(observed.ok, true);
  assert.strictEqual(observed.record.actual_model, 'claude-fable-5-1');
  assert.strictEqual(observed.record.requested_profile_name, 'balanced');
  assert.notStrictEqual(observed.record.actual_model, 'sonnet');
  const base = {
    projectRoot,
    entrypoint: 'monitor-docs', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null,
  };
  const minted = mod.mintProductionHostComposition(Object.assign({}, base, {
    event: { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: sessionId, model: 'forged-model-is-ignored' },
  }));
  assert.strictEqual(minted.ok, true);
  assert.strictEqual(minted.record.actual_model, 'claude-fable-5-1');
  assert.strictEqual(mod.mintProductionHostComposition(Object.assign({}, base, {
    event: { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
  })).ok, false);
});

test('P1-CAPABILITIES-33: system/init requires a typed subset while permitting extra tools and MCP', () => {
  const mod = requireHostClaude();
  const fixture = sessionHostFixture();
  const projectRoot = fixture.projectRoot;
  const valid = (suffix, tools, mcpServers) => mod.recordProductionSessionIdentity({
    projectRoot,
    event: {
      type: 'system', subtype: 'init', session_id: `p1-cap-${suffix}-${crypto.randomBytes(8).toString('hex')}`,
      model: 'claude-sonnet-5', cwd: projectRoot, tools, mcp_servers: mcpServers,
    },
    hostPin: sessionHostPin(fixture),
  });
  assert.strictEqual(valid('extra', ['Read', 'Agent', 'Bash', 'SendMessage', 'Glob'], [{ name: 'docs' }]).ok, true);
  assert.strictEqual(valid('task', ['Task', 'Bash', 'SendMessage'], []).ok, true);
  assert.strictEqual(valid('missing-send', ['Agent', 'Bash'], []).ok, false);
  assert.strictEqual(valid('missing-agent', ['Read', 'Bash', 'SendMessage'], []).ok, false);
  assert.strictEqual(valid('bad-tool', ['Agent', 'Bash', 'SendMessage', { name: 'Read' }], []).ok, false);
  assert.strictEqual(valid('bad-mcp', ['Agent', 'Bash', 'SendMessage'], [{ config: { token: 'secret' } }]).ok, false);
});

test('P1-DRIFT-34: same-session model drift is stale rather than silently reusing old evidence', () => {
  const mod = requireHostClaude();
  const fixture = sessionHostFixture();
  const projectRoot = fixture.projectRoot;
  const sessionId = 'p1-model-drift-' + crypto.randomBytes(12).toString('hex');
  const event = (model) => ({
    type: 'system', subtype: 'init', session_id: sessionId, model, cwd: projectRoot,
    tools: ['Agent', 'Bash', 'SendMessage'], mcp_servers: [],
  });
  assert.strictEqual(mod.recordProductionSessionIdentity({ projectRoot, event: event('claude-sonnet-5'), hostPin: sessionHostPin(fixture) }).ok, true);
  const drift = mod.recordProductionSessionIdentity({ projectRoot, event: event('claude-fable-5-1'), hostPin: sessionHostPin(fixture) });
  assert.strictEqual(drift.ok, false);
  assert.strictEqual(drift.reason, 'STALE_OBSERVATION');
});

test('P1-PROFILE-35: current requested profile is validated and digested independently of actual model', () => {
  const mod = requireHostClaude();
  const root = mkRoot();
  try {
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'model-profiles.json'), JSON.stringify({
      current: 'balanced',
      profiles: { balanced: { description: 'test', default_model: 'sonnet', overrides: { 'arch-platform': 'haiku' } } },
    }));
    const resolved = mod.resolveRequestedModelProfile(root, 'arch-platform');
    assert.strictEqual(resolved.ok, true);
    assert.strictEqual(resolved.name, 'balanced');
    assert.strictEqual(resolved.requestedModel, 'haiku');
    assert.match(resolved.digest, DIGEST_RE);
    fs.writeFileSync(path.join(root, '.claude', 'model-profiles.json'), JSON.stringify({
      current: 'missing', profiles: {},
    }));
    assert.strictEqual(mod.resolveRequestedModelProfile(root, 'arch-platform').ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R131-HOST-PRODUCTION-WRONG-SCOPE-33: an exact admission rejects a foreign entrypoint or argv scope', () => {
  const mod = requireHostClaude();
  const minted = mintProductionAdmission();
  assert.strictEqual(minted.ok, true);
  assert.strictEqual(mod.consumeProductionHostComposition(minted.projectRoot, minted.compositionId, {
    entrypoint: 'ingest-content', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null,
  }).ok, false);
  assert.strictEqual(mod.consumeProductionHostComposition(minted.projectRoot, minted.compositionId, {
    entrypoint: 'monitor-docs', argvDigest: 'f'.repeat(64), roleScope: null,
  }).ok, false);
});

test('R131-HOST-PRODUCTION-EXPIRY-34: expired admission is rejected before consumption', () => {
  const mod = requireHostClaude();
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  const minted = mintProductionAdmission();
  assert.strictEqual(minted.ok, true);
  const recordPath = path.join(rll.registryRepoDir(minted.projectRoot), 'host-compositions', minted.compositionId + '.json');
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  record.expires_at = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
  assert.strictEqual(mod.consumeProductionHostComposition(minted.projectRoot, minted.compositionId, {
    entrypoint: 'monitor-docs', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null,
  }).ok, false);
});

test('R131-HOST-PRODUCTION-REPLAY-35: exact composition is consumable once only', () => {
  const mod = requireHostClaude();
  const minted = mintProductionAdmission();
  const expected = { entrypoint: 'monitor-docs', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null };
  assert.strictEqual(mod.consumeProductionHostComposition(minted.projectRoot, minted.compositionId, expected).ok, true);
  assert.strictEqual(mod.consumeProductionHostComposition(minted.projectRoot, minted.compositionId, expected).ok, false);
});

test('R131-HOST-PRODUCTION-FORGERY-36: record or signature forgery is rejected', () => {
  const mod = requireHostClaude();
  const rll = require('../lib/runtime-role-lifecycle.cjs');
  for (const mutate of [
    (record) => { record.actual_model = 'claude-haiku-4-5'; },
    (record) => { record.signature_ed25519_base64 = Buffer.alloc(64).toString('base64'); },
  ]) {
    const minted = mintProductionAdmission();
    const recordPath = path.join(rll.registryRepoDir(minted.projectRoot), 'host-compositions', minted.compositionId + '.json');
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    mutate(record);
    fs.writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
    assert.strictEqual(mod.consumeProductionHostComposition(minted.projectRoot, minted.compositionId, {
      entrypoint: 'monitor-docs', argvDigest: sha256hex('entrypoint:monitor-docs:readonly'), roleScope: null,
    }).ok, false);
  }
});

test('P1-A31-A33 native outcome recorder resolves the v2 owner by session/tool identity and distinguishes absent, different, and correct executed input', () => {
  const mod = requireHostClaude();
  assert.strictEqual(typeof mod.recordProductionNativeToolOutcome, 'function');
  const fixtures = [
    makeNativeOutcomeFixture('absent'),
    makeNativeOutcomeFixture('different', { prompt: 'model proposal with explanation' }),
    makeNativeOutcomeFixture('correct'),
  ];
  try {
    const events = [
      { hook_event_name: 'PostToolUse', session_id: fixtures[0].sessionId, tool_use_id: fixtures[0].toolUseId, tool_name: 'Agent' },
      { hook_event_name: 'PostToolUse', session_id: fixtures[1].sessionId, tool_use_id: fixtures[1].toolUseId, tool_name: 'Agent', tool_input: fixtures[1].proposedInput },
      { hook_event_name: 'PostToolUse', session_id: fixtures[2].sessionId, tool_use_id: fixtures[2].toolUseId, tool_name: 'Agent', tool_input: fixtures[2].canonicalInput },
    ];
    const results = events.map((event, index) => mod.recordProductionNativeToolOutcome({ projectRoot: fixtures[index].projectRoot, event }));
    assert.deepStrictEqual(results.map((result) => result.ok), [true, true, true]);
    assert.deepStrictEqual(results.map((result) => result.record.execution_input_exact), [null, false, true]);
    assert.deepStrictEqual(results.map((result) => result.record.observed_input_digest), [null, sha256hex(rc.canonicalJSONStringify(fixtures[1].proposedInput)), sha256hex(rc.canonicalJSONStringify(fixtures[2].canonicalInput))]);
    for (let index = 0; index < results.length; index += 1) {
      const record = results[index].record;
      assert.deepStrictEqual(Object.keys(record).sort(), [
        'action_digest', 'action_id', 'canonical_input_digest', 'evidence_method',
        'execution_input_exact', 'model_deviation', 'observed_at', 'observed_input_digest',
        'original_input_digest', 'outcome', 'reservation_digest', 'schema',
        'session_digest', 'tool_use_digest',
      ].sort());
      assert.strictEqual(record.schema, 'runtime/native-tool-outcome/v1');
      assert.strictEqual(record.evidence_method, 'POST_TOOL_INPUT');
      assert.strictEqual(record.session_digest, sha256hex(fixtures[index].sessionId));
      assert.strictEqual(record.tool_use_digest, sha256hex(fixtures[index].toolUseId));
      assert.strictEqual(record.action_id, fixtures[index].action.action_id);
      assert.strictEqual(record.action_digest, sha256hex(rc.canonicalJSONStringify(fixtures[index].action)));
      assert.strictEqual(record.reservation_digest, sha256hex(rc.canonicalJSONStringify(fixtures[index].claim)));
    }
  } finally {
    fixtures.forEach(cleanupNativeOutcomeFixture);
  }
});

test('P1-NATIVE-OUTCOME-REPLAY identical replay is idempotent and conflicting duplicate never overwrites', () => {
  const mod = requireHostClaude();
  const fixture = makeNativeOutcomeFixture('replay');
  try {
    const event = {
      hook_event_name: 'PostToolUse', session_id: fixture.sessionId, tool_use_id: fixture.toolUseId,
      tool_name: 'Agent', tool_input: fixture.canonicalInput,
    };
    const first = mod.recordProductionNativeToolOutcome({ projectRoot: fixture.projectRoot, event });
    const replay = mod.recordProductionNativeToolOutcome({ projectRoot: fixture.projectRoot, event });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(replay.ok, true);
    assert.strictEqual(replay.idempotent, true);
    assert.strictEqual(replay.record.observed_at, first.record.observed_at);
    const conflicting = mod.recordProductionNativeToolOutcome({
      projectRoot: fixture.projectRoot,
      event: Object.assign({}, event, { hook_event_name: 'PostToolUseFailure', error: 'host failure' }),
    });
    assert.strictEqual(conflicting.ok, false);
    assert.strictEqual(conflicting.reason, 'NATIVE_OUTCOME_CONFLICT');
    assert.strictEqual(JSON.parse(fs.readFileSync(first.recordPath, 'utf8')).outcome, 'SUCCEEDED');
  } finally {
    cleanupNativeOutcomeFixture(fixture);
  }
});

function writeHostContractFixture(label) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rhc-host-package-' + label + '-'));
  for (const args of [
    ['-C', projectRoot, 'init', '-q'],
    ['-C', projectRoot, 'config', 'user.email', 'runtime-host-test@test.local'],
    ['-C', projectRoot, 'config', 'user.name', 'Runtime Host Test'],
    ['-C', projectRoot, 'commit', '-q', '--allow-empty', '-m', 'init'],
  ]) {
    const git = spawnSync('git', args, { encoding: 'utf8' });
    assert.strictEqual(git.status, 0, git.stderr);
  }
  const evidenceRoot = path.join(projectRoot, 'probe-evidence');
  const observerPath = path.join(projectRoot, 'scripts', 'tests', 'fixtures', 'claude-host-contract-probe.cjs');
  const executablePath = path.join(projectRoot, 'bin', 'claude.exe');
  fs.mkdirSync(path.dirname(observerPath), { recursive: true });
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(evidenceRoot, 'observer'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.planning', 'wave-host-package'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.planning', 'wave-host-package', 'PLAN.md'), '# host package fixture\n');
  fs.copyFileSync(path.resolve(__dirname, 'fixtures', 'claude-host-contract-probe.cjs'), observerPath);
  fs.copyFileSync(path.resolve(__dirname, '..', '..', '.claude', 'model-profiles.json'), path.join(projectRoot, '.claude', 'model-profiles.json'));
  fs.writeFileSync(executablePath, Buffer.from('isolated claude executable ' + label, 'utf8'));

  const sessionId = 'host-package-session-' + label;
  const agentA = 'host-package-agent-a-' + label;
  const agentB = 'host-package-agent-b-' + label;
  const toolA = 'host-package-tool-a-' + label;
  const toolWake = 'host-package-tool-wake-' + label;
  const toolB = 'host-package-tool-b-' + label;
  const inputA = { description: 'probe A', subagent_type: 'probe-peer', name: 'probe-peer-a', prompt: 'A', run_in_background: true };
  const inputB = { description: 'probe B', subagent_type: 'probe-peer', name: 'probe-peer-b', prompt: 'B', run_in_background: false };
  const event = (hook, extras = {}) => {
    const raw = Object.assign({ hook_event_name: hook, session_id: sessionId }, extras);
    return {
      schema: 'runtime/claude-host-contract-probe-event/v1', evidence_mode: 'genuine-pinned',
      producer: 'claude-host-contract-probe', hook_event_name: hook,
      session_digest: sha256hex(sessionId),
      tool_use_digest: raw.tool_use_id ? sha256hex(raw.tool_use_id) : null,
      prompt_id_digest: null,
      agent_id_digest: raw.agent_id ? sha256hex(raw.agent_id) : null,
      agent_type: raw.agent_type || null,
      tool_name: raw.tool_name || null,
      tool_input_digest: raw.tool_input === undefined ? null : sha256hex(rc.canonicalJSONStringify(raw.tool_input)),
      updated_input_digest: extras.updated_input_digest || null,
      raw_event: raw,
      observed_at: '2026-09-05T14:50:00.000Z',
    };
  };
  const events = [
    event('SessionStart', { source: 'startup' }),
    event('PreToolUse', { tool_name: 'Agent', tool_use_id: toolA, tool_input: inputA,
      updated_input_digest: sha256hex(rc.canonicalJSONStringify(inputA)) }),
    event('SubagentStart', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-1', tool_input: { file_path: 'a1' } }),
    event('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-1', tool_input: { file_path: 'a1' } }),
    event('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-2', tool_input: { file_path: 'a2' } }),
    event('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-2', tool_input: { file_path: 'a2' } }),
    event('SubagentStop', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PostToolUse', { tool_name: 'Agent', tool_use_id: toolA, tool_input: inputA,
      tool_response: { isAsync: true, status: 'async_launched', agentId: agentA } }),
    event('PreToolUse', { tool_name: 'SendMessage', tool_use_id: toolWake, tool_input: { recipient: 'probe-peer-a', message: 'wake' } }),
    event('PostToolUse', { tool_name: 'SendMessage', tool_use_id: toolWake, tool_input: { recipient: 'probe-peer-a', message: 'wake' },
      tool_response: { success: true, resumedAgentId: agentA } }),
    event('SubagentStart', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PreToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-3', tool_input: { file_path: 'nonce' } }),
    event('PostToolUse', { agent_id: agentA, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-a-3', tool_input: { file_path: 'nonce' } }),
    event('SubagentStop', { agent_id: agentA, agent_type: 'probe-peer' }),
    event('PreToolUse', { tool_name: 'Agent', tool_use_id: toolB, tool_input: inputB,
      updated_input_digest: sha256hex(rc.canonicalJSONStringify(inputB)) }),
    event('SubagentStart', { agent_id: agentB, agent_type: 'probe-peer' }),
    event('PreToolUse', { agent_id: agentB, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-b-1', tool_input: { file_path: 'b1' } }),
    event('PostToolUse', { agent_id: agentB, agent_type: 'probe-peer', tool_name: 'Read', tool_use_id: 'read-b-1', tool_input: { file_path: 'b1' } }),
    event('SubagentStop', { agent_id: agentB, agent_type: 'probe-peer' }),
    event('PostToolUse', { tool_name: 'Agent', tool_use_id: toolB, tool_input: inputB,
      tool_response: { status: 'completed', agentId: agentB, totalToolUseCount: 1 } }),
  ];
  const observerBytes = Buffer.from(events.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  const streamRows = [{
    type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-sonnet-5',
    claude_code_version: '2.1.261', tools: ['Task', 'Bash', 'Read', 'SendMessage'],
    mcp_servers: [{ name: 'fixture-mcp', status: 'connected' }],
  }];
  fs.writeFileSync(path.join(evidenceRoot, 'observer', 'events.jsonl'), observerBytes);
  fs.writeFileSync(path.join(evidenceRoot, 'claude-stream.jsonl'), streamRows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const evidenceSha = {
    'observer/events.jsonl': sha256bytes(observerBytes),
    'claude-stream.jsonl': sha256bytes(fs.readFileSync(path.join(evidenceRoot, 'claude-stream.jsonl'))),
  };
  const qualification = {
    schema: 'androidcommondoc/p1-native-host-contract-qualification/v1',
    status: 'HOST_CONTRACT_OBSERVED',
    session_id: sessionId,
    qualified_at: '2026-09-05T14:58:31.667Z',
    transport_profile: 'native-claude-cli',
    cli: {
      version: '2.1.261', executable_realpath: fs.realpathSync(executablePath),
      executable_sha256: sha256bytes(fs.readFileSync(executablePath)), actual_model: 'claude-sonnet-5',
    },
    evidence_sha256: evidenceSha,
    observed_contract: {
      same_actor_resume: true, different_same_type_peer: true, required_tools_present: true,
      additional_tools_allowed: true, post_tool_use_exposes_executed_input: true,
      canonical_five_key_input_executed: true,
    },
  };
  const qualificationPath = path.join(projectRoot, 'qualification.json');
  fs.writeFileSync(qualificationPath, JSON.stringify(qualification));
  return { projectRoot, evidenceRoot, observerPath, executablePath, qualificationPath, qualification, events };
}

function cleanupHostContractFixture(fixture) {
  try { fs.rmSync(rll.registryRepoDir(fixture.projectRoot), { recursive: true, force: true }); } catch { /* best effort */ }
  fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
}

test('P1-HOST-CERT-PUBLISH RED: independently verified retained observations produce one closed signed fixed toolkit package', () => {
  const mod = requireHostClaude();
  const fixture = writeHostContractFixture('publish');
  try {
    assert.strictEqual(typeof mod.publishClaudeHostContractPackage, 'function');
    const published = mod.publishClaudeHostContractPackage({
      projectRoot: fixture.projectRoot, qualificationPath: fixture.qualificationPath,
      evidenceRoot: fixture.evidenceRoot, observerPath: fixture.observerPath,
    });
    assert.strictEqual(published.ok, true, JSON.stringify(published));
    assert.strictEqual(published.packagePath, path.join(fixture.projectRoot, 'setup', 'claude-host-contract.json'));
    const pkg = JSON.parse(fs.readFileSync(published.packagePath, 'utf8'));
    assert.deepStrictEqual(Object.keys(pkg).sort(), ['anchor', 'certificate', 'schema']);
    assert.strictEqual(pkg.schema, 'runtime/claude-host-contract-package/v1');
    assert.deepStrictEqual(Object.keys(pkg.anchor).sort(), ['key_id', 'public_key_spki_der_base64', 'schema']);
    assert.deepStrictEqual(Object.keys(pkg.certificate).sort(), [
      'bundle_digest', 'cli_version', 'distinct_same_type_peers', 'evidence_method',
      'executable_digest', 'extra_tools_mcp_compatible', 'key_id', 'observations_digest',
      'observed_at', 'observer_digest', 'os', 'pin_digest', 'probe_contract_version',
      'required_hooks_observed', 'schema', 'signature_ed25519_base64',
      'stable_actor_resume', 'transport_profile',
    ].sort());
    assert.strictEqual(pkg.certificate.schema, 'runtime/claude-id01-host-contract/v1');
    assert.strictEqual(pkg.certificate.bundle_digest, null);
    assert.strictEqual(pkg.certificate.observations_digest, fixture.qualification.evidence_sha256['observer/events.jsonl']);
    assert.strictEqual(pkg.certificate.stable_actor_resume, true);
    assert.strictEqual(pkg.certificate.distinct_same_type_peers, true);
    assert.strictEqual(pkg.certificate.required_hooks_observed, true);
    assert.strictEqual(pkg.certificate.extra_tools_mcp_compatible, true);
    const verified = mod.verifyClaudeHostContractPackage(fixture.projectRoot, {
      executablePath: fixture.executablePath, cliVersion: '2.1.261',
      observerPath: fixture.observerPath, transportProfile: 'native-claude-cli', os: process.platform,
    });
    assert.strictEqual(verified.ok, true, JSON.stringify(verified));
    assert.strictEqual(verified.hostContractDigest, sha256hex(rc.canonicalJSONStringify(pkg.certificate)));
    assert.strictEqual(verified.pinDigest, pkg.certificate.pin_digest);
  } finally {
    cleanupHostContractFixture(fixture);
  }
});

test('P1-HOST-CERT-VERIFY RED: fixed package verifies across fresh registries and rejects evidence, signature, anchor, binary, observer, version, OS and transport drift', () => {
  const mod = requireHostClaude();
  const fixture = writeHostContractFixture('verify');
  const consumers = [];
  try {
    const published = mod.publishClaudeHostContractPackage({
      projectRoot: fixture.projectRoot, qualificationPath: fixture.qualificationPath,
      evidenceRoot: fixture.evidenceRoot, observerPath: fixture.observerPath,
    });
    assert.strictEqual(published.ok, true, JSON.stringify(published));
    const packageBytes = fs.readFileSync(published.packagePath);
    for (const label of ['fresh-run-root-b', 'ordinary-temp-root-c']) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), label + '-'));
      consumers.push(root);
      fs.mkdirSync(path.join(root, 'setup'), { recursive: true });
      fs.mkdirSync(path.dirname(path.join(root, 'scripts', 'tests', 'fixtures', 'claude-host-contract-probe.cjs')), { recursive: true });
      fs.writeFileSync(path.join(root, 'setup', 'claude-host-contract.json'), packageBytes);
      fs.copyFileSync(fixture.observerPath, path.join(root, 'scripts', 'tests', 'fixtures', 'claude-host-contract-probe.cjs'));
      assert.strictEqual(mod.verifyClaudeHostContractPackage(root, {
        executablePath: fixture.executablePath, cliVersion: '2.1.261',
        observerPath: path.join(root, 'scripts', 'tests', 'fixtures', 'claude-host-contract-probe.cjs'),
        transportProfile: 'native-claude-cli', os: process.platform,
      }).ok, true);
    }
    const baseOptions = {
      executablePath: fixture.executablePath, cliVersion: '2.1.261', observerPath: fixture.observerPath,
      transportProfile: 'native-claude-cli', os: process.platform,
    };
    for (const [label, mutateOptions] of [
      ['binary', (o) => { o.executablePath = fixture.observerPath; }],
      ['observer', (o) => { o.observerPath = fixture.executablePath; }],
      ['version', (o) => { o.cliVersion = '2.1.262'; }],
      ['os', (o) => { o.os = 'foreign-os'; }],
      ['transport', (o) => { o.transportProfile = 'foreign-transport'; }],
    ]) {
      const options = Object.assign({}, baseOptions);
      mutateOptions(options);
      assert.strictEqual(mod.verifyClaudeHostContractPackage(fixture.projectRoot, options).ok, false, label);
    }
    const original = fs.readFileSync(published.packagePath);
    for (const mutate of [
      (pkg) => { pkg.certificate.observations_digest = '0'.repeat(64); },
      (pkg) => { pkg.certificate.signature_ed25519_base64 = Buffer.alloc(64).toString('base64'); },
      (pkg) => { pkg.anchor.key_id = '1'.repeat(64); },
    ]) {
      const pkg = JSON.parse(original.toString('utf8'));
      mutate(pkg);
      fs.writeFileSync(published.packagePath, JSON.stringify(pkg));
      assert.strictEqual(mod.verifyClaudeHostContractPackage(fixture.projectRoot, baseOptions).ok, false);
    }
    fs.writeFileSync(published.packagePath, original);
  } finally {
    consumers.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
    cleanupHostContractFixture(fixture);
  }
});

test('P1-HOST-CERT-FAIL-CLOSED RED: publisher rejects trusted-summary lies, observer mutation, bad topology and conflicting fixed-package replay', () => {
  const mod = requireHostClaude();
  const fixtures = [];
  try {
    const mutateQualification = writeHostContractFixture('summary-lie');
    fixtures.push(mutateQualification);
    mutateQualification.qualification.observed_contract.same_actor_resume = false;
    fs.writeFileSync(mutateQualification.qualificationPath, JSON.stringify(mutateQualification.qualification));
    assert.strictEqual(mod.publishClaudeHostContractPackage({
      projectRoot: mutateQualification.projectRoot, qualificationPath: mutateQualification.qualificationPath,
      evidenceRoot: mutateQualification.evidenceRoot, observerPath: mutateQualification.observerPath,
    }).ok, false);

    const mutatedEvidence = writeHostContractFixture('mutated-evidence');
    fixtures.push(mutatedEvidence);
    fs.appendFileSync(path.join(mutatedEvidence.evidenceRoot, 'observer', 'events.jsonl'), '{}\n');
    assert.strictEqual(mod.publishClaudeHostContractPackage({
      projectRoot: mutatedEvidence.projectRoot, qualificationPath: mutatedEvidence.qualificationPath,
      evidenceRoot: mutatedEvidence.evidenceRoot, observerPath: mutatedEvidence.observerPath,
    }).ok, false);

    const badTopology = writeHostContractFixture('bad-topology');
    fixtures.push(badTopology);
    const rows = fs.readFileSync(path.join(badTopology.evidenceRoot, 'observer', 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    rows[16].raw_event.agent_id = rows[2].raw_event.agent_id;
    rows[16].agent_id_digest = rows[2].agent_id_digest;
    const badBytes = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    fs.writeFileSync(path.join(badTopology.evidenceRoot, 'observer', 'events.jsonl'), badBytes);
    badTopology.qualification.evidence_sha256['observer/events.jsonl'] = sha256bytes(badBytes);
    fs.writeFileSync(badTopology.qualificationPath, JSON.stringify(badTopology.qualification));
    assert.strictEqual(mod.publishClaudeHostContractPackage({
      projectRoot: badTopology.projectRoot, qualificationPath: badTopology.qualificationPath,
      evidenceRoot: badTopology.evidenceRoot, observerPath: badTopology.observerPath,
    }).ok, false);

    const replay = writeHostContractFixture('no-clobber');
    fixtures.push(replay);
    const args = { projectRoot: replay.projectRoot, qualificationPath: replay.qualificationPath,
      evidenceRoot: replay.evidenceRoot, observerPath: replay.observerPath };
    const first = mod.publishClaudeHostContractPackage(args);
    assert.strictEqual(first.ok, true, JSON.stringify(first));
    const exactBytes = fs.readFileSync(first.packagePath);
    const same = mod.publishClaudeHostContractPackage(args);
    assert.strictEqual(same.ok, true);
    assert.deepStrictEqual(fs.readFileSync(first.packagePath), exactBytes);
    fs.writeFileSync(first.packagePath, '{}');
    assert.strictEqual(mod.publishClaudeHostContractPackage(args).ok, false);
  } finally {
    fixtures.forEach(cleanupHostContractFixture);
  }
});

test('DRH-01 RED: a genuine restricted role system/init becomes one signed direct-role identity and resolves only with its parent proof', () => {
  const mod = requireHostClaude();
  for (const name of ['recordDirectRoleHostIdentity', 'getDirectRoleHostIdentity',
    'resolveObservedClaudeActor']) {
    assert.strictEqual(typeof mod[name], 'function', `${name} must be exported`);
  }
  const fixture = sessionHostFixture();
  const projectRoot = fixture.projectRoot;
  const parentSessionId = `drh-parent-${crypto.randomBytes(12).toString('hex')}`;
  const roleSessionId = `drh-role-${crypto.randomBytes(12).toString('hex')}`;
  const parent = mod.recordProductionSessionIdentity({
    projectRoot,
    event: {
      type: 'system', subtype: 'init', session_id: parentSessionId,
      model: 'claude-sonnet-5', cwd: projectRoot,
      tools: ['Task', 'Bash', 'SendMessage'], mcp_servers: [],
    },
    hostPin: sessionHostPin(fixture),
  });
  assert.strictEqual(parent.ok, true, JSON.stringify(parent));
  const action = {
    action_id: crypto.randomBytes(16).toString('hex'),
    kind: 'role-spawn', runtime: 'claude-native', role: 'arch-platform',
    payload: {
      agent_type: 'arch-platform',
      bootstrap_message: 'FIRST Bash=fixture-ready-command\n{"n":"node","r":"arch-platform"}\nWAIT.',
    },
  };
  const base = {
    projectRoot, parentSessionId, role: action.role, action,
    definitionDigest: sha256hex('arch-platform-definition'),
    launchArgv: ['claude', '--setting-sources', '', '--agent', action.role],
    processId: 12345,
    processBirth: 'fixture-process-birth',
    event: {
      type: 'system', subtype: 'init', session_id: roleSessionId,
      model: 'claude-sonnet-5', cwd: projectRoot,
      tools: ['Bash', 'Read', 'Grep'], agents: [action.role], mcp_servers: [],
    },
  };
  const recorded = mod.recordDirectRoleHostIdentity(base);
  assert.strictEqual(recorded.ok, true, JSON.stringify(recorded));
  assert.strictEqual(recorded.record.schema, 'runtime/claude-direct-role-host/v1');
  assert.strictEqual(recorded.record.parent_session_digest, sha256hex(parentSessionId));
  assert.strictEqual(recorded.record.session_digest, sha256hex(roleSessionId));
  assert.strictEqual(recorded.record.role, action.role);
  assert.strictEqual(recorded.record.action_id, action.action_id);
  assert.strictEqual(recorded.record.bootstrap_digest, sha256hex(action.payload.bootstrap_message));
  assert.strictEqual(recorded.record.observation_source, 'managed-role-system-init-stream');
  assert.strictEqual(mod.getDirectRoleHostIdentity(projectRoot, roleSessionId).ok, true);
  const actor = mod.resolveObservedClaudeActor(projectRoot, {
    session_id: roleSessionId,
  }, { parentSessionId });
  assert.deepStrictEqual({
    ok: actor.ok, family: actor.family, sessionId: actor.sessionId,
    agentId: actor.agentId, agentType: actor.agentType, actionId: actor.actionId,
  }, {
    ok: true, family: 'direct-role-host', sessionId: parentSessionId,
    agentId: roleSessionId, agentType: action.role, actionId: action.action_id,
  });
  assert.strictEqual(mod.resolveObservedClaudeActor(projectRoot,
    { session_id: roleSessionId }, { parentSessionId: parentSessionId + '-foreign' }).ok, false);
  assert.strictEqual(mod.recordDirectRoleHostIdentity({
    ...base,
    action: {
      ...action,
      payload: { ...action.payload, bootstrap_message: `${action.payload.bootstrap_message}\u0000forged` },
    },
    event: { ...base.event, session_id: `${roleSessionId}-control` },
  }).ok, false, 'a canonical multiline bootstrap must still reject embedded control bytes');
  assert.strictEqual(mod.recordDirectRoleHostIdentity({
    ...base,
    event: { ...base.event, session_id: `${roleSessionId}-send`, tools: ['Bash', 'SendMessage'] },
  }).ok, false, 'a role host must never expose parent-only SendMessage');
  assert.strictEqual(mod.recordDirectRoleHostIdentity({
    ...base,
    event: { ...base.event, session_id: `${roleSessionId}-agent`, tools: ['Bash', 'Agent'] },
  }).ok, false, 'a role host must never expose nested Agent');
  const rootSessionId = `drh-root-${crypto.randomBytes(12).toString('hex')}`;
  const rootAction = {
    action_id: crypto.randomBytes(16).toString('hex'),
    kind: 'root-source-spawn', runtime: 'claude-native',
    payload: { agent_type: 'toolkit-specialist', bootstrap_message: 'ROOT_SOURCE_BOOTSTRAP/v1' },
  };
  const rootRecorded = mod.recordDirectRoleHostIdentity({
    ...base,
    role: 'toolkit-specialist', action: rootAction,
    definitionDigest: sha256hex('toolkit-specialist-definition'),
    event: { ...base.event, session_id: rootSessionId,
      tools: ['Bash', 'SendMessage'], agents: ['toolkit-specialist'] },
  });
  assert.strictEqual(rootRecorded.ok, true, JSON.stringify(rootRecorded));
  const rootActor = mod.resolveObservedClaudeActor(projectRoot,
    { session_id: rootSessionId }, { parentSessionId });
  assert.strictEqual(rootActor.ok, true, JSON.stringify(rootActor));
  assert.strictEqual(rootActor.agentType, 'toolkit-specialist');
  assert.strictEqual(rootActor.actionId, rootAction.action_id);
});

test('DRH-04 RED: direct-role admission consumes the existing claim once and creates the ordinary actor binding', (t) => {
  assert.strictEqual(typeof rll.admitDirectRoleHostStartup, 'function');
  const fixture = writeHostContractFixture('drh-admit');
  const decoyDirs = [];
  t.after(() => {
    cleanupHostContractFixture(fixture);
    for (const decoy of decoyDirs) fs.rmSync(decoy, { recursive: true, force: true });
  });
  const published = requireHostClaude().publishClaudeHostContractPackage({
    projectRoot: fixture.projectRoot,
    qualificationPath: fixture.qualificationPath,
    evidenceRoot: fixture.evidenceRoot,
    observerPath: fixture.observerPath,
  });
  assert.strictEqual(published.ok, true, JSON.stringify(published));
  const projectRoot = fixture.projectRoot;
  const parentSessionId = `drh-admit-parent-${crypto.randomBytes(12).toString('hex')}`;
  const parent = requireHostClaude().recordProductionSessionIdentity({
    projectRoot,
    event: { type: 'system', subtype: 'init', session_id: parentSessionId,
      model: 'claude-sonnet-5', cwd: projectRoot,
      tools: ['Task', 'Bash', 'SendMessage'], mcp_servers: [] },
    hostPin: sessionHostPin(fixture),
  });
  assert.strictEqual(parent.ok, true, JSON.stringify(parent));
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: parentSessionId };
  const plan = rll.discoverPlan(projectRoot);
  const worktreeId = rll.computeWorktreeId(projectRoot);
  const generation = rll.resolveSessionGeneration(projectRoot, identity);
  const binding = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, plan.planDigest, 600);
  const actionId = rll.generateActionId();
  const payload = rll.buildRoleSpawnPayload('drh-admit', 'arch-platform', 'arch-platform', null, 'canonical direct bootstrap');
  const minted = rll.mintRoleLifecycleAction(
    projectRoot, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(projectRoot),
    worktreeId, plan.planDigest, sha256hex('direct-role-policy'), generation.generationId,
    'arch-platform', payload, new Date(Date.now() + 300000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  );
  assert.strictEqual(minted.ok, true, JSON.stringify(minted));
  const starting = rll.transitionRoleBinding(
    projectRoot, worktreeId, plan.planDigest, rll.roleProfileDigestFor(minted.action.role),
    generation.generationId, minted.action.role, 'ABSENT', 'STARTING', null,
    { driver: 'claude-sendmessage', respawn_count: 0, pending_action_id: minted.action.action_id },
  );
  assert.strictEqual(starting.ok, true, JSON.stringify(starting));
  const roleSessionId = `direct-role-${crypto.randomBytes(12).toString('hex')}`;
  const reserved = requireHostClaude().reserveDirectRoleHostLaunch({
    projectRoot,
    parentSessionId,
    roleSessionId,
    action: { ...minted.action, operation: 'Agent' },
  });
  assert.strictEqual(reserved.ok, true, JSON.stringify(reserved));
  // A long-lived Windows registry can contain thousands of unrelated repo
  // scopes. Admission already owns the canonical projectRoot and must not
  // fall back to the bounded global action scan used by scope-less callers.
  const registryBase = rll.registryBaseDir();
  for (let index = 0; index < 1025; index += 1) {
    const decoy = path.join(registryBase, sha256hex(`drh-admit-decoy-${index}`));
    fs.mkdirSync(decoy, { recursive: true });
    decoyDirs.push(decoy);
  }
  assert.deepStrictEqual(rll.findActionAcrossRepos(minted.action.action_id), {
    ok: false,
    reason: 'action-repo-scan-cap-exceeded',
  });
  assert.strictEqual(rll.findActionDirect(projectRoot, minted.action.action_id).ok, true);
  const beforeAdmission = rll.readRoleBindingState(
    projectRoot, minted.action.worktree_id, minted.action.plan_digest,
    rll.roleProfileDigestFor(minted.action.role), minted.action.session_generation_id,
    minted.action.role,
  );
  assert.strictEqual(beforeAdmission.state, 'STARTING', JSON.stringify(beforeAdmission));
  assert.strictEqual(beforeAdmission.record.pending_action_id, minted.action.action_id,
    JSON.stringify(beforeAdmission));
  try {
    const actor = {
      family: 'direct-role-host',
      sessionId: parentSessionId,
      agentId: roleSessionId,
      agentType: minted.action.role,
      actionId: minted.action.action_id,
    };
    const admitted = rll.admitDirectRoleHostStartup(projectRoot, actor, minted.action.action_id);
    assert.strictEqual(admitted.ok, true, JSON.stringify(admitted));
    assert.strictEqual(admitted.idempotent, false);
    const actorBinding = rll.validateRoleActorBindingFor(
      projectRoot, admitted.actorBinding.binding_id, minted.action.role,
      minted.action.worktree_id, minted.action.plan_digest,
    );
    assert.strictEqual(actorBinding.ok, true, JSON.stringify(actorBinding));
    assert.strictEqual(actorBinding.binding.session_generation_id, minted.action.session_generation_id);
    const parked = rll.parkClaudeResumeHandleForRoleActor(projectRoot, {
      sessionId: parentSessionId,
      agentId: roleSessionId,
      agentType: minted.action.role,
    });
    assert.strictEqual(parked.ok, true, JSON.stringify(parked));
    const replay = rll.admitDirectRoleHostStartup(projectRoot, actor, minted.action.action_id);
    assert.strictEqual(replay.ok, true, JSON.stringify(replay));
    assert.strictEqual(replay.idempotent, true);
    assert.strictEqual(rll.admitDirectRoleHostStartup(projectRoot,
      { ...actor, agentType: 'arch-testing' }, minted.action.action_id).ok, false);
  } finally {
    fs.rmSync(rll.registryRepoDir(projectRoot), { recursive: true, force: true });
  }
});

// --- Wave 1 macOS stabilization: host executable pin on darwin (defect A) ---
//
// The only pin observation was a Windows PowerShell parent-chain walk, hard
// gated by `process.platform !== 'win32'` and by a certificate whose `os` had
// to be literally 'win32'. On darwin it returned HOST_PIN_UNPROVEN before doing
// any work, so the SessionStart hook was inert and no macOS host identity could
// ever be established. These fences pin the darwin counterpart.
//
// Platform guard is load-bearing: this file runs UNCONDITIONALLY on
// ubuntu-latest via reusable-shell-tests.yml's bats-post "Run Node.js hook
// tests" step (scripts/tests/*.test.js under set -e), which feeds shell-tests,
// which ci-gate requires. queryHostParentChain() correctly returns null on any
// platform that is neither win32 nor darwin, so these two BEHAVIOURAL tests
// must skip there rather than assert a chain that cannot exist. The other two
// are platform-agnostic and keep running everywhere.
const PIN_OBSERVATION_UNSUPPORTED_PLATFORM = process.platform !== 'darwin' && process.platform !== 'win32';

test('MACOS-PIN-01 the host parent chain is observable on this platform', { skip: PIN_OBSERVATION_UNSUPPORTED_PLATFORM }, () => {
  const chain = hostClaude.__TEST_ONLY__queryHostParentChain(process.pid, 10_000);
  assert.ok(Array.isArray(chain) && chain.length > 0, 'a parent chain must be observable');
  const self = chain[0];
  assert.equal(self.process_id, process.pid, 'the chain must start at the observed process');
  assert.ok(Number.isInteger(self.parent_process_id), 'each row needs a parent pid');
  assert.ok(Number.isFinite(Date.parse(self.creation_time)), 'each row needs a parsable birth time');
  assert.ok(chain.length <= 8, 'the walk stays bounded');
});

test('MACOS-PIN-02 the observation source is bound to the platform that produced it', () => {
  const sourceFor = hostClaude.__TEST_ONLY__pinObservationSourceFor;
  assert.equal(sourceFor('win32'), 'interactive-windows-parent-chain');
  assert.equal(sourceFor('darwin'), 'interactive-darwin-parent-chain');
  // An unsupported platform yields no source at all, so it cannot be observed.
  assert.equal(sourceFor('linux'), null);
  assert.equal(sourceFor('sunos'), null);
  assert.notEqual(
    sourceFor('darwin'), sourceFor('win32'),
    'a darwin record must never be able to claim the windows chain',
  );
});

// The pin must come from the OBSERVED image, never from a version string, PATH,
// configuration or a SessionStart claim. Proven necessary on this very host: the
// executing binary was .../claude-code/2.1.260/claude.app/Contents/MacOS/claude
// while `claude` on PATH was a different 2.1.272 image, so a PATH- or
// version-derived pin would have pinned the wrong binary outright.
test('MACOS-PIN-03 a PATH-launched ancestor reports a bare name and stays unprovable', { skip: PIN_OBSERVATION_UNSUPPORTED_PLATFORM }, () => {
  // The hazard is concrete: a process launched through a PATH lookup reports a
  // BARE image name, and resolving that against the current working directory
  // can match an unrelated file of the same name. Here a decoy file literally
  // named after the runtime sits in the child's cwd; the child reports its own
  // chain row, and that row must be non-absolute so the production matcher
  // excludes it instead of resolving the decoy.
  const decoyDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rhc-decoy-')));
  const runtimeName = path.basename(process.execPath);
  const decoyPath = path.join(decoyDir, runtimeName);
  fs.writeFileSync(decoyPath, 'not the real runtime\n');

  const probe = `const h=require(${JSON.stringify(IMPL)});`
    + 'const c=h.__TEST_ONLY__queryHostParentChain(process.pid,10000);'
    + 'process.stdout.write(JSON.stringify(c&&c[0]||null));';
  const run = spawnSync(runtimeName, ['-e', probe], {
    cwd: decoyDir, encoding: 'utf8', env: process.env, timeout: 20_000,
  });
  if (run.error || run.status !== 0) return; // PATH lookup unavailable here; nothing to prove
  const self = JSON.parse(run.stdout);
  assert.ok(self, 'the child must observe its own chain row');
  assert.equal(
    path.isAbsolute(self.executable_path), false,
    'a PATH-launched process reports a bare image name -- this is the hazard the guard exists for',
  );
  // And the decoy really was resolvable from that cwd, so the guard is what
  // prevents it being proven, not mere absence of a file.
  assert.equal(fs.existsSync(path.resolve(decoyDir, self.executable_path)), true,
    'the decoy is resolvable from the cwd, so only the absolute-path guard prevents a false match');
});

test('MACOS-PIN-04 observation fails closed without a platform-matched host contract', () => {
  const observed = hostClaude.observeClaudeExecutablePin({
    projectRoot: process.cwd(), startingPid: process.pid,
  });
  // No contract package is published for this root, so the answer must be a
  // refusal -- never a pin synthesised from the ambient environment.
  assert.equal(observed.ok, false);
  assert.equal(observed.reason, 'HOST_PIN_UNPROVEN');
  assert.equal(observed.executablePath, undefined, 'a refusal must not leak an executable path');
  assert.equal(observed.pinDigest, undefined, 'a refusal must not leak a pin digest');
});

// --- Wave 1 macOS stabilization: wake/resume ordering in the PUBLISHER (defect F) ---
//
// verifyHostProbeObservations required indexOf(wakePost) < resumeStartIndex, but a
// real host starts the resumed actor while the wake call is still in flight, so the
// resumed SubagentStart can precede PostToolUse(SendMessage). Observed live on darwin
// in BOTH orders across runs. The driver already carried this same wrong assumption
// (fixed separately); the publisher carried it too, so a genuinely complete probe was
// rejected with HOST_PROBE_SEQUENCE_INVALID and no host contract could be published.
function pubseqInitEvent() {
  return {
    type: 'system',
    subtype: 'init',
    session_id: 'pubseq-' + crypto.randomBytes(8).toString('hex'),
    model: 'claude-sonnet-5',
    tools: ['Agent', 'Bash', 'SendMessage', 'Read'],
    mcp_servers: [],
  };
}

test('MACOS-PUBSEQ-01 an interleaved resume start is accepted by the contract publisher', () => {
  const { mintIsolatedHostContractSession } = require(path.resolve(__dirname, 'lib/host-contract-fixture.cjs'));
  const repoRoot = path.resolve(__dirname, '..', '..');
  const minted = mintIsolatedHostContractSession(repoRoot, {
    rc, runtimeHostClaude: hostClaude, wakeInterleaved: true, event: pubseqInitEvent(),
  });
  try {
    assert.strictEqual(minted.result.ok, true,
      'a probe whose resumed SubagentStart precedes the wake PostToolUse must still publish and admit: '
      + JSON.stringify(minted.result));
  } finally {
    if (typeof minted.cleanup === 'function') minted.cleanup();
  }
});

test('MACOS-PUBSEQ-02 the historical ordering still publishes', () => {
  const { mintIsolatedHostContractSession } = require(path.resolve(__dirname, 'lib/host-contract-fixture.cjs'));
  const repoRoot = path.resolve(__dirname, '..', '..');
  const minted = mintIsolatedHostContractSession(repoRoot, {
    rc, runtimeHostClaude: hostClaude, wakeInterleaved: false, event: pubseqInitEvent(),
  });
  try {
    assert.strictEqual(minted.result.ok, true, JSON.stringify(minted.result));
  } finally {
    if (typeof minted.cleanup === 'function') minted.cleanup();
  }
});
