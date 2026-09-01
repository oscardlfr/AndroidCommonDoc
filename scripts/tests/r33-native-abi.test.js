#!/usr/bin/env node
'use strict';

// WP3-RED first-RED sentinel + full ABI matrix for the R33 native-provider
// closed production ABI. Frozen contract source: PLAN.md "Canonical R33
// Native-Provider Production Contract" S2.1 "Common result and scalar rules",
// S2.2 "Typed handles", S2.3 "Exact addon exports", S2.4 "ABI capability
// record", S3.1 "Encoding, parsing, and scalar grammar", S7.1 "Fixed child
// descriptor table", S8.2 "Lexical-before-canonical accreditation", and the
// S11.2 `ABI-COUNT/TAG-*` / `ABI-ARITY-*` / `ABI-BOUND-*` / `PATH-ACCREDIT-*`
// obligations. Path-Manifest row 15 (this file) targets row 7
// `scripts/native/r33-provider/index.js` plus rows 4/6 (`binding.gyp`,
// `src/r33_native.c`) -- toolkit-specialist-owned, WP3-ABI, absent as of this
// commit.
//
// SCOPE (test-specialist, WP3-RED): the currently-FAILING deliverable is the
// ONE named sentinel `R33-RED-ABI-ABSENT` (PLAN.md S11.1's eight-name RED
// set). Every case that needs the compiled addon is `{skip}`-gated on the real
// addon's existence, so today it reports SKIPPED (node:test's third category,
// disjoint from pass and fail) and the failing-name set stays exactly the
// sentinel; once WP3-ABI lands rows 1-7 each one un-skips and genuinely
// executes against the live addon.
//
// INSTRUMENT DISCIPLINE. Every verification instrument in this file ships with
// a negative control that RUNS TODAY and proves the instrument can fail in the
// intended direction. A gated case therefore never carries an unproven
// assertion: the fixture is gated, the assertion logic is not.
//
// DEFECT A1/A3 DISCRIMINATING TESTS (test-specialist, consolidated WP3-ABI
// correction pass). Two P0 fail-open defects the prior Codex adversarial audit
// found in scripts/native/r33-provider/src/r33_native.c (toolkit-specialist-
// owned):
//   A1 -- r33_hkdf_sha256_32 (lines 288-308) is `void`, and on an internal
//         malloc failure it silently fills its output with 32 zero bytes; its
//         caller r33_hkdf_sha256 (lines 2902-2923) has no way to observe that
//         and always wraps the result as a normal, successful SecretHandle.
//   A3 -- r33_spawn_with_slots (~2283-2525): after a SUCCESSFUL posix_spawn,
//         if ProcessHandle allocation or external wrap/type-tagging then
//         fails, the already-spawned child is reported as a closed
//         SYSTEM_ERROR but is never terminated or reaped -- r33_handle_close
//         only ever closes an fd, never a pid (PLAN.md S7.1/S7.2).
// Both are reproduced by compiling a disposable, in-memory-PATCHED COPY of
// r33_native.c directly via `cc` (SECTION 7's existing scratch-compile
// technique -- never node-gyp/build.cjs, never the tracked repository file)
// with at most ONE `#ifdef`-gated compile-time fault macro active per build
// (PLAN.md S11.4 permits scratch-build/test-process fault injection; a
// PRODUCTION runtime switch is forbidden, and none is added here). Every
// anchor the patcher targets is asserted to match the CURRENT source EXACTLY
// ONCE before being rewritten, so a future reshaping of these call sites
// fails the harness loudly instead of silently defusing the fault. See
// SECTION 13 (harness), SECTION 14 (A1), SECTION 15 (A3).

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NATIVE_PACKAGE_DIR = path.join(REPO_ROOT, 'scripts', 'native', 'r33-provider');
const ADDON_ENTRY_PATH = path.join(NATIVE_PACKAGE_DIR, 'index.js'); // Path-Manifest row 7

function addonExists() {
  return fs.existsSync(ADDON_ENTRY_PATH);
}

const ADDON_ABSENT_SKIP_REASON = 'scripts/native/r33-provider/index.js (row 7) does not exist yet -- WP3-ABI dependency; this case is structured to un-skip and execute once it does';

/** node:test `skip` option: `false` runs the case, a string skips it with that reason. */
function whenAddonExists() {
  return { skip: addonExists() ? false : ADDON_ABSENT_SKIP_REASON };
}

// PLAN.md S2.3 fixes `spawnWithSlots`' argv to the accredited sealed path
// ending `/tree/scripts/lib/runtime-r33-provider.cjs` -- Path-Manifest row 8,
// a WP3-WIRE deliverable and one of the three roster rows the build driver
// legitimately reports as pending until that unit lands. A ProcessHandle
// therefore CANNOT be constructed during WP3-ABI, by construction. This is a
// genuine later-unit dependency gate, not a way to dodge a failure: the eight
// tags that ARE constructible in WP3-ABI keep executing for real.
const CHILD_MODULE_ROW_REL = path.join('scripts', 'lib', 'runtime-r33-provider.cjs');
const CHILD_MODULE_ROW_PATH = path.join(REPO_ROOT, CHILD_MODULE_ROW_REL);

function childModuleRowExists() {
  return fs.existsSync(CHILD_MODULE_ROW_PATH);
}

const CHILD_MODULE_ABSENT_SKIP_REASON = 'scripts/lib/runtime-r33-provider.cjs (Path-Manifest row 8) does not exist yet -- WP3-WIRE dependency; PLAN.md S2.3 fixes spawnWithSlots argv to <sealed>/tree/scripts/lib/runtime-r33-provider.cjs, so ProcessHandle cannot be constructed in WP3-ABI. This case is structured to un-skip and execute for real once row 8 lands';

function whenChildModuleRowExists() {
  if (!addonExists()) return { skip: ADDON_ABSENT_SKIP_REASON };
  return { skip: childModuleRowExists() ? false : CHILD_MODULE_ABSENT_SKIP_REASON };
}

test('frozen vectors: the ProcessHandle gate names the exact PLAN S2.3 child-module row (a typo here would skip the case forever)', () => {
  assert.strictEqual(path.relative(REPO_ROOT, CHILD_MODULE_ROW_PATH), CHILD_MODULE_ROW_REL,
    'the gate must resolve to the repository-relative PLAN S9.3 roster row, not an absolute or drifted path');
  assert.strictEqual(CHILD_MODULE_ROW_REL, path.join('scripts', 'lib', 'runtime-r33-provider.cjs'),
    'PLAN.md S2.3 fixes this exact child-module path; a rename here silently disables ABI-COUNT/TAG-04');
  assert.strictEqual(typeof childModuleRowExists(), 'boolean', 'the gate predicate must be decidable');
  // The gate must be keyed to the SAME file the fixture will load, so it
  // cannot report "present" while the fixture looks somewhere else.
  assert.ok(CHILD_MODULE_ROW_PATH.endsWith(path.join('scripts', 'lib', 'runtime-r33-provider.cjs')));
});

// ---------------------------------------------------------------------------
// PLAN.md S2.3 -- exact 45 addon exports, in table (#) order, paired with
// PLAN.md S2.1 `ExactNativeArityV1 [45]`. Both literal arrays are derived
// byte-for-byte from the frozen PLAN; the pairing below is independently
// cross-checked against every export's own documented argument list in S2.3
// (e.g. `mkdirNoClobber(dir,name)` -> arity 2), not merely copied twice.
// ---------------------------------------------------------------------------
const EXPORT_NAMES_IN_ORDER = [
  'providerAbiInfo', 'openRootAccredited', 'mkdirNoClobber', 'createFileExclusiveRW',
  'dirOpenChild', 'dirOpenFileNoFollow', 'dirUnlinkNoFollow', 'fsyncHandle',
  'writeAllBounded', 'readBackSameFd', 'statHandle', 'handleIdentity',
  'aclOwnerOnly', 'localFilesystem', 'accreditAncestors', 'closeHandle',
  'bindListenerAbsolute', 'connectAbsolute', 'acceptConn', 'peerCred',
  'listenerKernelIdentity', 'dirSocketPathWitness', 'makeSocketpairStream', 'makePipe',
  'spawnWithSlots', 'adoptInheritedDir', 'adoptInheritedConn', 'adoptInheritedRead',
  'writeBytes', 'readExact', 'readOneOrEof', 'listOpenFds',
  'waitOwnedProcess', 'terminateOwnedProcess', 'secretRandom32', 'secretWriteOnce',
  'adoptSecret32', 'hkdfSha256', 'hmacSha256', 'zeroizeSecret',
  'secretIsUsable', 'clockOpen', 'sampleContinuousNs', 'sendHandleBatch',
  'receiveHandleBatch',
];

const EXACT_NATIVE_ARITY_V1 = [
  0, 1, 2, 2, 2, 2, 3, 1, 3, 2, 1, 1, 1, 1, 1,
  1, 3, 5, 2, 1, 1, 2, 0, 0, 6, 1, 1, 1, 4, 4,
  1, 1, 2, 2, 0, 2, 1, 3, 2, 1, 1, 0, 1, 4, 3,
];

const ARITY_BY_EXPORT_NAME = Object.freeze(
  EXPORT_NAMES_IN_ORDER.reduce((acc, name, i) => {
    acc[name] = EXACT_NATIVE_ARITY_V1[i];
    return acc;
  }, {}),
);

// PLAN.md S11.2 `ABI-ARITY-*`: "N-1 is mechanically inapplicable only to the
// five zero-arity exports". Derived, never hand-listed, so a PLAN vector change
// cannot silently move the exemption.
const ZERO_ARITY_EXPORTS = EXPORT_NAMES_IN_ORDER.filter((name) => ARITY_BY_EXPORT_NAME[name] === 0);

// PLAN.md S2.1 -- the closed `NativeCode` enum, byte-for-byte.
const NATIVE_CODES = [
  'EXISTS', 'NAME_INVALID', 'PATH_INVALID', 'PATH_TOO_LONG',
  'SYMLINK_REJECTED', 'TYPE_INVALID', 'OWNER_INVALID', 'MODE_INVALID',
  'ACL_INVALID', 'NLINK_INVALID', 'IDENTITY_DRIFT', 'NOT_LOCAL_FS',
  'SOCKET_CAP_INVALID', 'PEER_INVALID', 'CAP_EXCEEDED', 'TIMEOUT', 'EOF_OR_SHORT',
  'WRITE_AMBIGUOUS', 'HANDLE_INVALID', 'ADOPT_INVALID', 'SECRET_SHORT',
  'SECRET_OVERLONG', 'SECRET_ZEROIZED', 'CLOCK_UNAVAILABLE',
  'CLOCK_REGRESSION', 'PROCESS_STATE_UNKNOWN', 'CLOSE_FAILED_OR_UNKNOWN',
  'ARITY_INVALID', 'LENGTH_INVALID', 'UNSUPPORTED_PLATFORM', 'SYSTEM_ERROR',
];

// PLAN.md S2.2 -- exactly nine typed handle kinds; distinct compile-time
// napi_type_tag_object UUID per kind, cross-tag use is HANDLE_INVALID.
const TYPED_HANDLE_KINDS = [
  'AccreditedDirHandle', 'FileHandle', 'ListenerHandle', 'ConnectionHandle',
  'PipeReadHandle', 'PipeWriteHandle', 'SecretHandle', 'ClockHandle', 'ProcessHandle',
];

// PLAN.md S2.4 `NativeProviderAbiInfoV1 [13]`.
const ABI_INFO_KEYS = [
  'schema', 'brand', 'provider_abi', 'napi_version', 'platform', 'architecture',
  'sockaddr_un_sun_path_bytes', 'hkdf_salt_bytes', 'hkdf_info_cap_bytes',
  'hkdf_output_bytes', 'hmac_message_cap_bytes', 'exact_arities',
  'compiled_source_digest',
].slice().sort();

// PLAN.md S3.1: "`MonoNs` is canonical decimal `0..18446744073709551615`".
const MONO_NS_MIN = '0';
const MONO_NS_MAX = '18446744073709551615';

// ===========================================================================
// SECTION 1 -- structural oracles over the frozen PLAN vectors.
// These run TODAY, need no addon, and each has its own negative control.
// ===========================================================================

function assertExactExportRoster(exportNames) {
  assert.strictEqual(exportNames.length, 45, 'the addon must export EXACTLY 45 functions (PLAN.md S2.3)');
  assert.strictEqual(new Set(exportNames).size, 45, 'export names must be unique (no duplicate exports)');
  assert.deepStrictEqual([...exportNames].sort(), [...EXPORT_NAMES_IN_ORDER].sort(),
    'export name set must equal EXACTLY the frozen S2.3 roster -- no extra, no missing, no rename');
}

function assertExactArityPairing(aritiesByName) {
  for (const name of EXPORT_NAMES_IN_ORDER) {
    assert.ok(Object.prototype.hasOwnProperty.call(aritiesByName, name), 'missing arity entry for export ' + name);
    assert.strictEqual(aritiesByName[name], ARITY_BY_EXPORT_NAME[name],
      'export ' + name + ' must have exact arity ' + ARITY_BY_EXPORT_NAME[name] + ' (PLAN.md S2.1/S2.3)');
  }
  assert.strictEqual(Object.keys(aritiesByName).length, 45, 'arity map must cover EXACTLY 45 exports, no extras');
}

function assertClosedHandleTagSet(tagNames) {
  assert.strictEqual(tagNames.length, 9, 'there must be EXACTLY nine typed handle kinds (PLAN.md S2.2)');
  assert.strictEqual(new Set(tagNames).size, 9, 'handle tag kinds must be unique (distinct compile-time UUID each)');
  assert.deepStrictEqual([...tagNames].sort(), [...TYPED_HANDLE_KINDS].sort(),
    'handle tag kind set must equal EXACTLY the frozen S2.2 nine-row roster');
}

test('positive fixture: assertExactExportRoster accepts the exact frozen 45-name set', () => {
  assertExactExportRoster(EXPORT_NAMES_IN_ORDER);
  assertExactExportRoster([...EXPORT_NAMES_IN_ORDER].reverse()); // order-independence: a set, not a sequence
});

test('negative control: assertExactExportRoster rejects a 44-entry roster (missing receiveHandleBatch)', () => {
  assert.throws(
    () => assertExactExportRoster(EXPORT_NAMES_IN_ORDER.slice(0, 44)), // mutated: watched cardinality
    assert.AssertionError,
    'validator must reject a roster missing any one of the 45 exports',
  );
});

test('negative control: assertExactExportRoster rejects an extra spike-only export (probeClockDrift)', () => {
  assert.throws(
    () => assertExactExportRoster([...EXPORT_NAMES_IN_ORDER, 'probeClockDrift']), // mutated: watched extra-symbol invariant
    assert.AssertionError,
    'validator must reject an export set with any extra/spike-only symbol (PLAN.md S2.3: "Spike-only probe*... are absent")',
  );
});

test('positive fixture: assertExactArityPairing accepts the exact frozen arity map', () => {
  assertExactArityPairing(ARITY_BY_EXPORT_NAME);
});

test('negative control: assertExactArityPairing rejects a mutated connectAbsolute arity (5 -> 4)', () => {
  const mutated = Object.assign({}, ARITY_BY_EXPORT_NAME, { connectAbsolute: 4 }); // mutated: watched property
  assert.throws(() => assertExactArityPairing(mutated), assert.AssertionError,
    'validator must reject connectAbsolute(parent,name,absUtf8,expected,deadlineMonoNs) arity != 5');
});

test('negative control: assertExactArityPairing rejects a mutated makePipe arity (0 -> 1)', () => {
  const mutated = Object.assign({}, ARITY_BY_EXPORT_NAME, { makePipe: 1 }); // mutated: watched property
  assert.throws(() => assertExactArityPairing(mutated), assert.AssertionError,
    'validator must reject makePipe() arity != 0');
});

test('positive fixture: assertClosedHandleTagSet accepts the exact frozen nine handle kinds', () => {
  assertClosedHandleTagSet(TYPED_HANDLE_KINDS);
});

test('negative control: assertClosedHandleTagSet rejects a foreign tenth handle kind (RawFdHandle)', () => {
  assert.throws(
    () => assertClosedHandleTagSet([...TYPED_HANDLE_KINDS, 'RawFdHandle']), // mutated: watched extra-tag invariant
    assert.AssertionError,
    'validator must reject any handle kind outside the closed nine (PLAN.md S2.2: no raw FD/PID authority)',
  );
});

test('frozen vectors: the arity vector has exactly five zero-arity exports (the only N-1 exemption, PLAN.md S11.2)', () => {
  assert.strictEqual(EXACT_NATIVE_ARITY_V1.length, 45, 'ExactNativeArityV1 must have exactly 45 entries (PLAN.md S2.1)');
  assert.deepStrictEqual(ZERO_ARITY_EXPORTS,
    ['providerAbiInfo', 'makeSocketpairStream', 'makePipe', 'secretRandom32', 'clockOpen'],
    'the five zero-arity exports (the sole mechanical N-1 exemption) must be exactly exports #1/#23/#24/#35/#42');
  assert.strictEqual(ZERO_ARITY_EXPORTS.length, 5, 'exactly five exports are N-1-exempt (PLAN.md S11.2 ABI-ARITY-*)');
});

test('frozen vectors: the closed NativeCode enum has exactly 31 unique members (PLAN.md S2.1)', () => {
  assert.strictEqual(NATIVE_CODES.length, 31);
  assert.strictEqual(new Set(NATIVE_CODES).size, 31, 'NativeCode members must be unique');
  assert.ok(!NATIVE_CODES.includes('OK'), '"OK" is the success code, not a NativeCode failure member (PLAN.md S2.1)');
});

// ===========================================================================
// SECTION 2 -- the module-export-surface instrument.
//
// DEFECT THIS REPLACES: filtering the EXPECTED roster by `typeof mod[n] ===
// "function"` can only ever produce a subset of the expected names, so it is
// structurally incapable of detecting an EXTRA export. The surface below
// enumerates the module's own keys with Reflect.ownKeys -- which includes
// NON-ENUMERABLE and SYMBOL keys -- and demands exact set equality.
// ===========================================================================

function assertExactModuleExportSurface(mod) {
  assert.ok(mod !== null && typeof mod === 'object',
    'the addon module namespace must be a non-null object');

  const ownKeys = Reflect.ownKeys(mod);
  const symbolKeys = ownKeys.filter((k) => typeof k === 'symbol');
  assert.deepStrictEqual(symbolKeys.map(String), [],
    'the addon must expose ZERO symbol-keyed own properties (PLAN.md S2.1: "There are no extra properties")');

  const stringKeys = ownKeys.filter((k) => typeof k === 'string');
  // Exact SET equality: this is what makes an EXTRA export fail.
  assertExactExportRoster(stringKeys);

  for (const name of stringKeys) {
    assert.strictEqual(typeof mod[name], 'function',
      'export ' + name + ' must be a function, got ' + typeof mod[name] + ' (PLAN.md S2.3)');
  }

  const proto = Object.getPrototypeOf(mod);
  assert.ok(proto === Object.prototype || proto === null,
    'the addon module namespace must not inherit an extra prototype surface (PLAN.md S2.1: "There are no extra properties")');
}

function fabricateModuleNamespace(options) {
  const opts = options || {};
  const obj = opts.prototype === undefined ? {} : Object.create(opts.prototype);
  for (const name of (opts.names || EXPORT_NAMES_IN_ORDER)) {
    obj[name] = opts.nonFunction === name ? 'not-a-function' : function () { return null; };
  }
  if (opts.extraEnumerable) obj[opts.extraEnumerable] = function () { return null; };
  if (opts.extraNonEnumerable) {
    Object.defineProperty(obj, opts.extraNonEnumerable,
      { value: function () { return null; }, enumerable: false, configurable: true, writable: true });
  }
  if (opts.extraSymbol) obj[opts.extraSymbol] = function () { return null; };
  return obj;
}

test('positive fixture: assertExactModuleExportSurface accepts a namespace with exactly the 45 own function exports', () => {
  assertExactModuleExportSurface(fabricateModuleNamespace());
});

test('negative control: assertExactModuleExportSurface rejects an EXTRA ENUMERABLE export (the defect the old expected-name filter could not see)', () => {
  assert.throws(
    () => assertExactModuleExportSurface(fabricateModuleNamespace({ extraEnumerable: 'probeClockDrift' })), // mutated: watched extra-symbol invariant
    assert.AssertionError,
    'an extra 46th export MUST fail -- this is the exact defect a filter over the EXPECTED roster is structurally blind to',
  );
});

test('negative control: assertExactModuleExportSurface rejects an EXTRA NON-ENUMERABLE export (proves Reflect.ownKeys, not Object.keys)', () => {
  const fabricated = fabricateModuleNamespace({ extraNonEnumerable: 'hiddenMutationControl' }); // mutated: watched enumerability
  assert.deepStrictEqual(Object.keys(fabricated).length, 45,
    'precondition: the extra export is invisible to Object.keys, so only ownKeys enumeration can catch it');
  assert.throws(() => assertExactModuleExportSurface(fabricated), assert.AssertionError,
    'a NON-ENUMERABLE extra export MUST fail (PLAN.md S2.3 forbids any mutation control)');
});

test('negative control: assertExactModuleExportSurface rejects a SYMBOL-keyed own property', () => {
  assert.throws(
    () => assertExactModuleExportSurface(fabricateModuleNamespace({ extraSymbol: Symbol('r33.backdoor') })), // mutated: watched key type
    assert.AssertionError,
    'a symbol-keyed own property MUST fail -- it is still an extra property (PLAN.md S2.1)',
  );
});

test('negative control: assertExactModuleExportSurface rejects a declared export that is not a function', () => {
  assert.throws(
    () => assertExactModuleExportSurface(fabricateModuleNamespace({ nonFunction: 'clockOpen' })), // mutated: watched value type
    assert.AssertionError,
    'a non-function export MUST fail (PLAN.md S2.3: "exports exactly the following 45 functions")',
  );
});

test('negative control: assertExactModuleExportSurface rejects exports reachable only through the prototype chain (proves OWN-key enumeration)', () => {
  const proto = fabricateModuleNamespace();
  const inheritedOnly = Object.create(proto); // mutated: 45 names reachable via `in`, ZERO own keys
  assert.strictEqual('clockOpen' in inheritedOnly, true, 'precondition: every name is reachable with the `in` operator');
  assert.strictEqual(Reflect.ownKeys(inheritedOnly).length, 0, 'precondition: none of them is an OWN key');
  assert.throws(() => assertExactModuleExportSurface(inheritedOnly), assert.AssertionError,
    'a namespace whose exports live only on the prototype MUST fail');
});

test('negative control: assertExactModuleExportSurface rejects an exotic prototype carrying extra surface', () => {
  const fabricated = fabricateModuleNamespace({ prototype: { sneakyExtra() { return null; } } }); // mutated: watched prototype
  assertExactExportRoster(Reflect.ownKeys(fabricated).filter((k) => typeof k === 'string'));
  assert.throws(() => assertExactModuleExportSurface(fabricated), assert.AssertionError,
    'a namespace inheriting extra surface MUST fail even when its own 45 keys are exactly right');
});

// ===========================================================================
// SECTION 3 -- the NativeResultV1 / NativeCode rejection instruments.
// ===========================================================================

function assertNativeResultShape(result, label) {
  assert.ok(result !== null && typeof result === 'object' && !Array.isArray(result),
    label + ': every export must return a NativeResultV1 object (PLAN.md S2.1), got ' + Object.prototype.toString.call(result));
  assert.deepStrictEqual(Object.keys(result).slice().sort(), ['code', 'ok', 'value'],
    label + ': NativeResultV1 has EXACTLY the three keys {ok,code,value} -- no extra properties (PLAN.md S2.1)');
}

function assertRejection(result, expectedCode, label) {
  assertNativeResultShape(result, label);
  assert.strictEqual(result.ok, false, label + ': must be a rejection (ok:false)');
  assert.strictEqual(result.value, null, label + ': a rejection carries value:null exactly (PLAN.md S2.1)');
  assert.ok(NATIVE_CODES.includes(result.code),
    label + ': code must be a member of the closed NativeCode enum, got ' + JSON.stringify(result.code));
  assert.strictEqual(result.code, expectedCode, label + ': must be exactly ' + expectedCode);
}

function assertSuccess(result, label) {
  assertNativeResultShape(result, label);
  assert.strictEqual(result.ok, true, label + ': must succeed, got ' + JSON.stringify({ ok: result.ok, code: result.code }));
  assert.strictEqual(result.code, 'OK', label + ': a success carries code "OK" exactly (PLAN.md S2.1)');
}

/**
 * PLAN.md S2.1: "There is no implicit string conversion, truncation, streaming
 * continuation, or alternate error code." A whole family of grammar violations
 * must therefore collapse to ONE canonical code drawn from `allowedCodes`.
 * This is used where the PLAN closes the code SET but does not name a single
 * member per sub-case; asserting one-canonical-code is strictly stronger than
 * asserting set membership and cannot be satisfied by an implementation that
 * scatters TYPE_INVALID/LENGTH_INVALID across equivalent malformed inputs.
 */
function assertCanonicalRejectionFamily(labelledResults, allowedCodes, label) {
  assert.ok(labelledResults.length > 0, label + ': the rejection family must not be empty');
  const observed = new Set();
  for (const [caseLabel, result] of labelledResults) {
    assertNativeResultShape(result, label + ' / ' + caseLabel);
    assert.strictEqual(result.ok, false, label + ' / ' + caseLabel + ': must be a rejection');
    assert.strictEqual(result.value, null, label + ' / ' + caseLabel + ': a rejection carries value:null exactly');
    assert.ok(allowedCodes.includes(result.code),
      label + ' / ' + caseLabel + ': code must be one of ' + allowedCodes.join('|') + ', got ' + JSON.stringify(result.code));
    observed.add(result.code);
  }
  assert.strictEqual(observed.size, 1,
    label + ': PLAN.md S2.1 forbids an "alternate error code" -- the whole family must reject with ONE canonical code, observed: ' + [...observed].sort().join(', '));
  return [...observed][0];
}

test('positive fixture: assertRejection accepts an exact NativeResultV1 rejection', () => {
  assertRejection({ ok: false, code: 'ARITY_INVALID', value: null }, 'ARITY_INVALID', 'fixture');
});

test('negative control: assertRejection rejects the wrong code', () => {
  assert.throws(() => assertRejection({ ok: false, code: 'HANDLE_INVALID', value: null }, 'ARITY_INVALID', 'fixture'), // mutated: watched code
    assert.AssertionError, 'validator must reject a different NativeCode than the one demanded');
});

test('negative control: assertRejection rejects a code outside the closed NativeCode enum', () => {
  assert.throws(() => assertRejection({ ok: false, code: 'INVALID_ARGUMENT', value: null }, 'INVALID_ARGUMENT', 'fixture'), // mutated: watched closed enum
    assert.AssertionError, 'validator must reject a code that is not a member of the closed S2.1 enum');
});

test('negative control: assertRejection rejects an extra property on NativeResultV1', () => {
  assert.throws(() => assertRejection({ ok: false, code: 'ARITY_INVALID', value: null, errno: 22 }, 'ARITY_INVALID', 'fixture'), // mutated: watched closed-key set
    assert.AssertionError, 'validator must reject any NativeResultV1 with an extra property (PLAN.md S2.1)');
});

test('negative control: assertRejection rejects a non-null value on a rejection', () => {
  assert.throws(() => assertRejection({ ok: false, code: 'ARITY_INVALID', value: {} }, 'ARITY_INVALID', 'fixture'), // mutated: watched value:null
    assert.AssertionError, 'validator must reject a rejection carrying a non-null value');
});

test('negative control: assertRejection rejects a success masquerading as a rejection', () => {
  assert.throws(() => assertRejection({ ok: true, code: 'OK', value: null }, 'ARITY_INVALID', 'fixture'), // mutated: watched ok flag
    assert.AssertionError, 'validator must reject ok:true');
});

test('negative control: assertSuccess rejects a rejection and rejects ok:true with a non-OK code', () => {
  assert.throws(() => assertSuccess({ ok: false, code: 'TIMEOUT', value: null }, 'fixture'), assert.AssertionError);
  assert.throws(() => assertSuccess({ ok: true, code: 'TIMEOUT', value: 1 }, 'fixture'), assert.AssertionError, // mutated: watched OK code
    'validator must reject a success whose code is not exactly "OK"');
});

/**
 * Used only where the PLAN closes the code SET for a violation class but
 * genuinely does not assign one member (e.g. depth-overflow vs
 * component-overflow are different classes and may legitimately differ). The
 * subset is always closed, so a regression to any other code still fails.
 */
function assertRejectionWithinCodes(result, allowedCodes, label) {
  assertNativeResultShape(result, label);
  assert.strictEqual(result.ok, false, label + ': must be a rejection');
  assert.strictEqual(result.value, null, label + ': a rejection carries value:null exactly');
  assert.ok(allowedCodes.includes(result.code),
    label + ': code must be one of ' + allowedCodes.join('|') + ', got ' + JSON.stringify(result.code));
}

test('positive fixture + negative control: assertRejectionWithinCodes accepts a member of the closed subset and rejects everything else', () => {
  assertRejectionWithinCodes({ ok: false, code: 'NAME_INVALID', value: null }, ['NAME_INVALID', 'PATH_INVALID'], 'fixture');
  assert.throws(() => assertRejectionWithinCodes({ ok: false, code: 'SYSTEM_ERROR', value: null }, ['NAME_INVALID', 'PATH_INVALID'], 'fixture'), // mutated: watched subset
    assert.AssertionError, 'a code outside the closed subset must fail');
  assert.throws(() => assertRejectionWithinCodes({ ok: true, code: 'OK', value: 1 }, ['NAME_INVALID'], 'fixture'), // mutated: watched rejection requirement
    assert.AssertionError, 'an ACCEPTED result must fail');
});

test('positive fixture: assertCanonicalRejectionFamily accepts a family that collapses to one canonical code', () => {
  const code = assertCanonicalRejectionFamily([
    ['empty', { ok: false, code: 'TYPE_INVALID', value: null }],
    ['leading-zero', { ok: false, code: 'TYPE_INVALID', value: null }],
  ], ['TYPE_INVALID', 'LENGTH_INVALID'], 'fixture');
  assert.strictEqual(code, 'TYPE_INVALID');
});

test('negative control: assertCanonicalRejectionFamily rejects a family that splits across two allowed codes', () => {
  assert.throws(() => assertCanonicalRejectionFamily([
    ['empty', { ok: false, code: 'TYPE_INVALID', value: null }],
    ['leading-zero', { ok: false, code: 'LENGTH_INVALID', value: null }], // mutated: watched single-canonical-code invariant
  ], ['TYPE_INVALID', 'LENGTH_INVALID'], 'fixture'), assert.AssertionError,
  'validator must reject an implementation that returns an ALTERNATE error code for equivalent malformed inputs');
});

test('negative control: assertCanonicalRejectionFamily rejects a code outside the allowed set, and rejects a passing member', () => {
  assert.throws(() => assertCanonicalRejectionFamily([
    ['a', { ok: false, code: 'SYSTEM_ERROR', value: null }], // mutated: watched allowed set
  ], ['TYPE_INVALID'], 'fixture'), assert.AssertionError);
  assert.throws(() => assertCanonicalRejectionFamily([
    ['a', { ok: false, code: 'TYPE_INVALID', value: null }],
    ['b', { ok: true, code: 'OK', value: 1 }], // mutated: watched rejection requirement
  ], ['TYPE_INVALID'], 'fixture'), assert.AssertionError,
  'validator must reject a family member that was ACCEPTED rather than rejected');
});

// ===========================================================================
// SECTION 4 -- the ABI capability record instrument (complete 13-key record
// AND its values, not just napi_version + key count).
// ===========================================================================

function assertNativeProviderAbiInfoV1(value) {
  assert.ok(value !== null && typeof value === 'object', 'NativeProviderAbiInfoV1 must be a non-null object');
  assert.deepStrictEqual(Object.keys(value).slice().sort(), ABI_INFO_KEYS,
    'NativeProviderAbiInfoV1 must have EXACTLY these 13 keys (PLAN.md S2.4)');
  assert.strictEqual(value.schema, 'runtime/r33-native-provider-abi/v1', 'schema must be the exact frozen literal');
  assert.strictEqual(value.brand, 'acd-transition-lock-posix', 'brand must be the exact frozen literal');
  assert.strictEqual(value.provider_abi, 3, 'provider_abi must be exactly 3');
  assert.strictEqual(value.napi_version, 8, 'napi_version must be exactly 8 (N-API level 8, PLAN.md S2.1)');
  assert.ok(['linux', 'darwin'].includes(value.platform), 'platform must be linux|darwin, got ' + JSON.stringify(value.platform));
  assert.ok(['x64', 'arm64'].includes(value.architecture), 'architecture must be x64|arm64, got ' + JSON.stringify(value.architecture));
  assert.strictEqual(value.hkdf_salt_bytes, 32, 'hkdf_salt_bytes must be exactly 32 (fixed width)');
  assert.strictEqual(value.hkdf_info_cap_bytes, 1024, 'hkdf_info_cap_bytes must be exactly 1024');
  assert.strictEqual(value.hkdf_output_bytes, 32, 'hkdf_output_bytes must be exactly 32 ("No other width exists", PLAN.md S2.2)');
  assert.strictEqual(value.hmac_message_cap_bytes, 16842752, 'hmac_message_cap_bytes must be exactly 16,842,752');
  assert.deepStrictEqual(value.exact_arities, EXACT_NATIVE_ARITY_V1,
    'exact_arities must equal the frozen 45-entry ExactNativeArityV1 element-for-element (PLAN.md S2.1)');
  assert.match(value.compiled_source_digest, /^[0-9a-f]{64}$/,
    'compiled_source_digest must be 64-LOWERCASE-hex sha256 (PLAN.md S2.4, S9.4)');
  // Accepted path-cap pairs are exactly linux->108 and darwin->104 (S2.4).
  const expectedCap = value.platform === 'linux' ? 108 : 104;
  assert.strictEqual(value.sockaddr_un_sun_path_bytes, expectedCap,
    'sockaddr_un_sun_path_bytes must be exactly the closed linux->108 / darwin->104 pairing (PLAN.md S2.4)');
  // The accepted platform/architecture tuples are exactly linux/x64,
  // linux/arm64, darwin/arm64 (S2.4). darwin/x64 is UNSUPPORTED_PLATFORM.
  const tuple = value.platform + '/' + value.architecture;
  assert.ok(['linux/x64', 'linux/arm64', 'darwin/arm64'].includes(tuple),
    'platform/architecture must be one of the exactly three accepted tuples, got ' + tuple + ' (PLAN.md S2.4)');
}

function fixtureAbiInfo(overrides) {
  return Object.assign({
    schema: 'runtime/r33-native-provider-abi/v1',
    brand: 'acd-transition-lock-posix',
    provider_abi: 3,
    napi_version: 8,
    platform: 'darwin',
    architecture: 'arm64',
    sockaddr_un_sun_path_bytes: 104,
    hkdf_salt_bytes: 32,
    hkdf_info_cap_bytes: 1024,
    hkdf_output_bytes: 32,
    hmac_message_cap_bytes: 16842752,
    exact_arities: EXACT_NATIVE_ARITY_V1.slice(),
    compiled_source_digest: 'a'.repeat(64),
  }, overrides || {});
}

// One mutation per watched key -- all 13 covered, none hand-waved.
const ABI_INFO_MUTATIONS = [
  ['schema', { schema: 'runtime/r33-native-provider-abi/v2' }],
  ['brand', { brand: 'acd-transition-lock-posix-next' }],
  ['provider_abi', { provider_abi: 2 }],
  ['napi_version', { napi_version: 9 }],
  ['platform', { platform: 'win32' }],
  ['architecture', { architecture: 'ia32' }],
  ['sockaddr_un_sun_path_bytes', { sockaddr_un_sun_path_bytes: 108 }], // darwin fixture must pair with 104
  ['hkdf_salt_bytes', { hkdf_salt_bytes: 31 }],
  ['hkdf_info_cap_bytes', { hkdf_info_cap_bytes: 1023 }],
  ['hkdf_output_bytes', { hkdf_output_bytes: 64 }],
  ['hmac_message_cap_bytes', { hmac_message_cap_bytes: 16842751 }],
  ['exact_arities', { exact_arities: EXACT_NATIVE_ARITY_V1.slice(0, 44).concat([99]) }],
  ['compiled_source_digest', { compiled_source_digest: 'A'.repeat(64) }], // uppercase is not lowercase hex
];

test('positive fixture: assertNativeProviderAbiInfoV1 accepts each accepted platform/architecture tuple', () => {
  assertNativeProviderAbiInfoV1(fixtureAbiInfo());
  assertNativeProviderAbiInfoV1(fixtureAbiInfo({ platform: 'linux', architecture: 'x64', sockaddr_un_sun_path_bytes: 108 }));
  assertNativeProviderAbiInfoV1(fixtureAbiInfo({ platform: 'linux', architecture: 'arm64', sockaddr_un_sun_path_bytes: 108 }));
});

test('negative control: assertNativeProviderAbiInfoV1 rejects a mutation of EVERY ONE of its 13 keys', () => {
  assert.strictEqual(ABI_INFO_MUTATIONS.length, 13, 'the mutation sweep must cover all 13 keys, none skipped');
  assert.deepStrictEqual(ABI_INFO_MUTATIONS.map((m) => m[0]).slice().sort(), ABI_INFO_KEYS,
    'the mutation sweep key set must equal the record key set exactly (no unwatched field)');
  for (const [key, override] of ABI_INFO_MUTATIONS) {
    assert.throws(
      () => assertNativeProviderAbiInfoV1(fixtureAbiInfo(override)), // mutated: watched property
      assert.AssertionError,
      'validator must reject a mutated ' + key + ' -- otherwise that field is shape-checked only, never value-checked',
    );
  }
});

test('negative control: assertNativeProviderAbiInfoV1 rejects a missing key and an extra key', () => {
  const missing = fixtureAbiInfo();
  delete missing.hkdf_output_bytes; // mutated: watched cardinality
  assert.throws(() => assertNativeProviderAbiInfoV1(missing), assert.AssertionError, 'a 12-key record must fail');
  const extra = fixtureAbiInfo({ provider_source_digest: 'b'.repeat(64) }); // mutated: watched closed-key set
  assert.throws(() => assertNativeProviderAbiInfoV1(extra), assert.AssertionError, 'a 14-key record must fail');
});

test('negative control: assertNativeProviderAbiInfoV1 rejects the forbidden darwin/x64 tuple', () => {
  assert.throws(
    () => assertNativeProviderAbiInfoV1(fixtureAbiInfo({ platform: 'darwin', architecture: 'x64' })), // mutated: watched tuple closure
    assert.AssertionError,
    'darwin/x64 is UNSUPPORTED_PLATFORM and must never validate (PLAN.md S2.4)',
  );
});

// ===========================================================================
// SECTION 5 -- no-effect / resource-invariance instruments.
// ===========================================================================

/** PLAN.md S2.1: an invalid-arity call performs "zero allocation, handle-state change, syscall". */
function assertFdInventoryUnchanged(before, after, label) {
  assert.ok(Array.isArray(before) && Array.isArray(after), label + ': both FD inventories must be arrays');
  assert.deepStrictEqual(after, before,
    label + ': the open-FD inventory must be byte-identical before and after (PLAN.md S2.1 zero-syscall/zero-allocation rule)');
}

/**
 * Errnos that CONCLUSIVELY prove nothing exists at the path.
 * `ENOENT` -- the name resolved and nothing is there.
 * `ENAMETOOLONG` -- the kernel refused to resolve the name at all, so it
 * cannot have created anything under it. Required for the S8.2 over-long
 * lexical class, where the path is deliberately longer than the OS accepts.
 * Any OTHER errno (EACCES, ELOOP, EIO, ...) is inconclusive and must fail:
 * it means the probe could not determine absence, not that absence holds.
 */
const ABSENCE_PROVING_ERRNOS = ['ENOENT', 'ENAMETOOLONG'];

/** PLAN.md S2.4 / S6.3: a pre-cut rejection must leave NOTHING at the target path. */
function assertNoEffectAtPath(absPath, label) {
  let st = null;
  try {
    st = fs.lstatSync(absPath);
  } catch (err) {
    assert.ok(ABSENCE_PROVING_ERRNOS.includes(err.code),
      label + ': lstat failed with ' + err.code + ', which does not PROVE absence'
      + ' (only ' + ABSENCE_PROVING_ERRNOS.join('/') + ' do); the zero-write property is therefore unverified at ' + absPath);
    return;
  }
  assert.fail(label + ': a zero-write rejection must create nothing at ' + absPath
    + ' -- found mode ' + (st.mode & 0o7777).toString(8) + ' (' + (st.isDirectory() ? 'directory' : st.isSocket() ? 'socket' : 'other') + ')');
}

test('positive fixture: assertFdInventoryUnchanged accepts two identical inventories', () => {
  const inv = [{ fd: 0, type: 'other', dev_decimal: '1', ino_decimal: '2' }];
  assertFdInventoryUnchanged(inv, inv.map((e) => Object.assign({}, e)), 'fixture');
});

test('negative control: assertFdInventoryUnchanged rejects an inventory that gained an entry', () => {
  const before = [{ fd: 0, type: 'other', dev_decimal: '1', ino_decimal: '2' }];
  const after = before.concat([{ fd: 9, type: 'socket', dev_decimal: '1', ino_decimal: '3' }]); // mutated: watched leak
  assert.throws(() => assertFdInventoryUnchanged(before, after, 'fixture'), assert.AssertionError,
    'validator must detect a leaked descriptor');
});

test('negative control: assertFdInventoryUnchanged rejects an inventory whose entry drifted in place', () => {
  const before = [{ fd: 0, type: 'other', dev_decimal: '1', ino_decimal: '2' }];
  const after = [{ fd: 0, type: 'socket', dev_decimal: '1', ino_decimal: '2' }]; // mutated: watched identity
  assert.throws(() => assertFdInventoryUnchanged(before, after, 'fixture'), assert.AssertionError,
    'validator must detect a same-numbered descriptor that was rebound');
});

test('positive fixture + negative control: assertNoEffectAtPath passes on absence and fails on any created object', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-noeffect-')));
  try {
    const target = path.join(scratch, 'must-not-exist');
    assertNoEffectAtPath(target, 'fixture: absent target'); // positive: absence passes

    fs.writeFileSync(target, ''); // mutated: watched zero-write property
    assert.throws(() => assertNoEffectAtPath(target, 'fixture: created target'), assert.AssertionError,
      'validator must fail once ANYTHING exists at the path -- otherwise "zero-write" is unfalsifiable');

    fs.rmSync(target);
    assertNoEffectAtPath(target, 'fixture: target removed again');

    // An over-long name: the kernel refuses to resolve it (ENAMETOOLONG),
    // which proves absence just as conclusively as ENOENT.
    const overLong = path.join(scratch, 'c'.repeat(400));
    let overLongErrno = null;
    try { fs.lstatSync(overLong); } catch (err) { overLongErrno = err.code; }
    assert.strictEqual(overLongErrno, 'ENAMETOOLONG',
      'precondition: this host must actually return ENAMETOOLONG for an over-long component');
    assertNoEffectAtPath(overLong, 'fixture: over-long name'); // positive: ENAMETOOLONG passes

    // ...but an INCONCLUSIVE errno must still fail. A 0000 parent makes lstat
    // return EACCES: the probe cannot see whether anything was created, so
    // accepting it would make the zero-write property unfalsifiable again.
    const denied = path.join(scratch, 'denied');
    fs.mkdirSync(denied, { mode: 0o700 });
    fs.writeFileSync(path.join(denied, 'hidden'), '');
    fs.chmodSync(denied, 0o000); // mutated: watched errno conclusiveness
    let deniedErrno = null;
    try { fs.lstatSync(path.join(denied, 'hidden')); } catch (err) { deniedErrno = err.code; }
    if (deniedErrno === 'EACCES') {
      assert.throws(() => assertNoEffectAtPath(path.join(denied, 'hidden'), 'fixture: unreadable parent'),
        assert.AssertionError,
        'an inconclusive errno must FAIL -- otherwise any lstat error would silently read as "nothing was created"');
    }
    fs.chmodSync(denied, 0o700);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ===========================================================================
// SECTION 6 -- fresh-process probe instrument.
//
// Used to prove "no pending JavaScript exception" survives a rejection: an
// escaping exception changes the child's EXIT CODE, which an in-process
// try/catch cannot observe.
// ===========================================================================

function runChildProbe(source, options) {
  const opts = options || {};
  const res = spawnSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    cwd: opts.cwd || REPO_ROOT,
    env: Object.assign({}, process.env, opts.env || {}),
    timeout: opts.timeoutMs || 180000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = res.stdout == null ? '' : res.stdout;
  const stderr = res.stderr == null ? '' : res.stderr;
  let json = null;
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length > 0) {
    try { json = JSON.parse(lines[lines.length - 1]); } catch (_err) { json = null; }
  }
  return { status: res.status, signal: res.signal, stdout, stderr, json };
}

function assertProbeExitedCleanly(probe, label) {
  assert.strictEqual(probe.signal, null, label + ': the probe process must not be killed by a signal, got ' + probe.signal);
  assert.strictEqual(probe.status, 0,
    label + ': the probe process must exit 0 -- a nonzero exit means an exception escaped.\n--- stderr ---\n' + probe.stderr);
  assert.ok(probe.json !== null, label + ': the probe must print one JSON object on its last stdout line.\n--- stdout ---\n' + probe.stdout);
}

test('positive fixture: runChildProbe reports a clean exit and parses the probe JSON', () => {
  const probe = runChildProbe('process.stdout.write(JSON.stringify({marker:"r33-probe",value:41+1}));');
  assertProbeExitedCleanly(probe, 'fixture');
  assert.deepStrictEqual(probe.json, { marker: 'r33-probe', value: 42 });
});

test('negative control: assertProbeExitedCleanly fails when an exception escapes the probe process', () => {
  const probe = runChildProbe('throw new Error("r33-escaping-exception");'); // mutated: watched escaping-exception property
  assert.notStrictEqual(probe.status, 0, 'precondition: an escaping exception must produce a nonzero exit');
  assert.throws(() => assertProbeExitedCleanly(probe, 'fixture'), assert.AssertionError,
    'the probe instrument must FAIL on an escaping exception -- otherwise "no pending exception" is unfalsifiable');
});

test('negative control: assertProbeExitedCleanly fails on a nonzero explicit exit and on missing JSON', () => {
  const exited = runChildProbe('process.stdout.write(JSON.stringify({ok:true}));process.exit(7);'); // mutated: watched exit status
  assert.strictEqual(exited.status, 7);
  assert.throws(() => assertProbeExitedCleanly(exited, 'fixture'), assert.AssertionError);

  const silent = runChildProbe('process.exitCode = 0;'); // mutated: watched JSON protocol
  assert.throws(() => assertProbeExitedCleanly(silent, 'fixture'), assert.AssertionError,
    'the probe instrument must FAIL when the child printed no JSON envelope');
});

// ===========================================================================
// SECTION 7 -- scratch FOREIGN external (an napi_external produced OUTSIDE
// this addon). PLAN.md S2.2 requires "a foreign external with any other type
// tag is HANDLE_INVALID"; PLAN.md S2.3 forbids the production addon from
// exporting a foreign-external constructor, so the fixture must come from a
// separately compiled scratch addon.
// ===========================================================================

const SCRATCH_FOREIGN_ADDON_SOURCE = [
  '#include <node_api.h>',
  'static void r33_scratch_finalize(napi_env env, void *data, void *hint) { (void)env; (void)data; (void)hint; }',
  'static napi_value r33_scratch_make(napi_env env, napi_callback_info info) {',
  '  (void)info;',
  '  static int scratch_payload = 33;',
  '  napi_value out;',
  '  if (napi_create_external(env, &scratch_payload, r33_scratch_finalize, NULL, &out) != napi_ok) return NULL;',
  '  return out;',
  '}',
  'static napi_value r33_scratch_init(napi_env env, napi_value exports) {',
  '  napi_value fn;',
  '  if (napi_create_function(env, "makeForeignExternal", NAPI_AUTO_LENGTH, r33_scratch_make, NULL, &fn) != napi_ok) return NULL;',
  '  if (napi_set_named_property(env, exports, "makeForeignExternal", fn) != napi_ok) return NULL;',
  '  return exports;',
  '}',
  'NAPI_MODULE(NODE_GYP_MODULE_NAME, r33_scratch_init)',
  '',
].join('\n');

/**
 * Locates a Node API include directory containing `node_api.h`. Ordered
 * candidates, first hit wins; returns null when none qualifies.
 */
function findNodeApiIncludeDir(candidateDirs) {
  for (const dir of candidateDirs) {
    try {
      if (fs.statSync(path.join(dir, 'node_api.h')).isFile()) return dir;
    } catch (_err) { /* candidate does not qualify */ }
  }
  return null;
}

function defaultNodeApiIncludeCandidates() {
  return [
    path.resolve(process.execPath, '..', '..', 'include', 'node'),
    path.resolve(process.execPath, '..', 'include', 'node'),
    path.join(os.homedir(), '.node-gyp', process.versions.node, 'include', 'node'),
    path.join(os.homedir(), 'Library', 'Caches', 'node-gyp', process.versions.node, 'include', 'node'),
  ];
}

/** Compiles the scratch foreign-external addon; returns its absolute .node path. */
function compileScratchForeignExternalAddon(scratchDir) {
  const includeDir = findNodeApiIncludeDir(defaultNodeApiIncludeCandidates());
  assert.ok(includeDir !== null,
    'the scratch FOREIGN-external fixture needs node_api.h; searched: ' + defaultNodeApiIncludeCandidates().join(', '));
  const sourcePath = path.join(scratchDir, 'r33_scratch_foreign.c');
  const addonPath = path.join(scratchDir, 'r33_scratch_foreign.node');
  fs.writeFileSync(sourcePath, SCRATCH_FOREIGN_ADDON_SOURCE);
  const argv = [
    '-shared', '-fPIC', '-std=c11', '-O0',
    '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=r33_scratch_foreign',
    '-I', includeDir,
  ];
  if (process.platform === 'darwin') argv.push('-undefined', 'dynamic_lookup');
  argv.push('-o', addonPath, sourcePath);
  const compiled = spawnSync('cc', argv, { encoding: 'utf8' });
  assert.strictEqual(compiled.status, 0,
    'the scratch foreign-external addon must compile.\n--- cc stderr ---\n' + (compiled.stderr || ''));
  return addonPath;
}

test('positive fixture: findNodeApiIncludeDir selects a directory that actually contains node_api.h', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-include-')));
  try {
    const good = path.join(scratch, 'good');
    fs.mkdirSync(good);
    fs.writeFileSync(path.join(good, 'node_api.h'), '/* fixture */');
    assert.strictEqual(findNodeApiIncludeDir([path.join(scratch, 'absent'), good]), good,
      'discovery must skip non-qualifying candidates and return the first qualifying one');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('negative control: findNodeApiIncludeDir returns null for a tree without node_api.h (and for a directory named node_api.h)', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-include-neg-')));
  try {
    const empty = path.join(scratch, 'empty');
    fs.mkdirSync(empty);
    assert.strictEqual(findNodeApiIncludeDir([empty]), null, 'a directory without node_api.h must not qualify');

    const decoy = path.join(scratch, 'decoy');
    fs.mkdirSync(path.join(decoy, 'node_api.h'), { recursive: true }); // mutated: watched isFile() requirement
    assert.strictEqual(findNodeApiIncludeDir([decoy]), null,
      'a DIRECTORY named node_api.h must not qualify -- discovery must require a regular file');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the scratch foreign-external addon compiles and yields a genuine napi_external (fixture self-proof)', () => {
  // This RUNS TODAY: it proves the foreign-external fixture the gated
  // ABI-COUNT/TAG cases depend on is real, before those cases can ever rely
  // on it. Without this, "a foreign external is rejected" would be an
  // assertion over a fixture nobody had shown could be built.
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-foreign-')));
  try {
    const addonPath = compileScratchForeignExternalAddon(scratch);
    const probe = runChildProbe(
      'const m = require(' + JSON.stringify(addonPath) + ');'
      + 'const { types } = require("node:util");'
      + 'const ext = m.makeForeignExternal();'
      + 'process.stdout.write(JSON.stringify({ isExternal: types.isExternal(ext), typeofExt: typeof ext }));',
    );
    assertProbeExitedCleanly(probe, 'scratch foreign-external self-proof');
    assert.strictEqual(probe.json.isExternal, true,
      'the scratch addon must produce a genuine napi_external (util.types.isExternal), not a plain object');
    assert.strictEqual(probe.json.typeofExt, 'object');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ===========================================================================
// SECTION 8 -- live-addon handle fixtures (gated).
// ===========================================================================

/** PLAN.md S9.5: `<pkg>/build/sealed/generation-<64-hex>`; exactly one live generation. */
function discoverSealedGenerationDir() {
  const sealedRoot = path.join(NATIVE_PACKAGE_DIR, 'build', 'sealed');
  const entries = fs.readdirSync(sealedRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^generation-[0-9a-f]{64}$/.test(e.name))
    .map((e) => e.name);
  assert.strictEqual(entries.length, 1,
    'PLAN.md S9.5 requires exactly one sealed generation directory under ' + sealedRoot + ', found: ' + JSON.stringify(entries));
  return path.join(sealedRoot, entries[0]);
}

/**
 * Builds one live handle of each of the EIGHT kinds whose creator signature is
 * unambiguous in PLAN.md S2.3. `ProcessHandle` is built separately in
 * ABI-COUNT/TAG-04 because `spawnWithSlots`'s `slots` argument ENCODING is not
 * frozen in the PLAN, and a construction problem there must not be able to
 * hide this matrix's result.
 */
function buildHandleFixtures(mod, scratchDir) {
  const value = (result, what) => { assertSuccess(result, what); return result.value; };

  const dir = value(mod.openRootAccredited(scratchDir), 'openRootAccredited(scratch root)');
  const file = value(mod.createFileExclusiveRW(dir, 'fixture-file'), 'createFileExclusiveRW(dir,"fixture-file")');
  const socketName = 'fx.sock';
  const listener = value(
    mod.bindListenerAbsolute(dir, socketName, path.join(scratchDir, socketName)),
    'bindListenerAbsolute(dir,"fx.sock",abs)',
  );
  const socketPair = value(mod.makeSocketpairStream(), 'makeSocketpairStream()');
  const pipePair = value(mod.makePipe(), 'makePipe()');
  const secret = value(mod.secretRandom32(), 'secretRandom32()');
  const clock = value(mod.clockOpen(), 'clockOpen()');

  return {
    AccreditedDirHandle: dir,
    FileHandle: file,
    ListenerHandle: listener,
    ConnectionHandle: socketPair.first,
    PipeReadHandle: pipePair.read,
    PipeWriteHandle: pipePair.write,
    SecretHandle: secret,
    ClockHandle: clock,
    _spare: { connectionSecond: socketPair.second },
  };
}

/**
 * The single tag-discriminating consumer for each handle kind, taken from
 * PLAN.md S2.3. `handleIdentity`/`statHandle` are deliberately NOT used: they
 * accept ANY handle and so discriminate nothing.
 */
const TAG_DISCRIMINATING_CONSUMER = {
  AccreditedDirHandle: { export: 'dirOpenChild', call: (mod, h) => mod.dirOpenChild(h, 'absent-child'), safePositive: true },
  FileHandle: { export: 'readBackSameFd', call: (mod, h) => mod.readBackSameFd(h, 4096), safePositive: true },
  ListenerHandle: { export: 'listenerKernelIdentity', call: (mod, h) => mod.listenerKernelIdentity(h), safePositive: true },
  ConnectionHandle: { export: 'peerCred', call: (mod, h) => mod.peerCred(h), safePositive: true },
  PipeReadHandle: { export: 'readOneOrEof', call: (mod, h) => mod.readOneOrEof(h), safePositive: false },
  PipeWriteHandle: { export: 'secretWriteOnce', call: (mod, h, ctx) => mod.secretWriteOnce(ctx.SecretHandle, h), safePositive: false },
  SecretHandle: { export: 'secretIsUsable', call: (mod, h) => mod.secretIsUsable(h), safePositive: true },
  ClockHandle: { export: 'sampleContinuousNs', call: (mod, h) => mod.sampleContinuousNs(h), safePositive: true },
  ProcessHandle: { export: 'waitOwnedProcess', call: (mod, h) => mod.waitOwnedProcess(h, true), safePositive: true },
};

test('frozen vectors: every one of the nine handle kinds has a distinct tag-discriminating consumer export', () => {
  const kinds = Object.keys(TAG_DISCRIMINATING_CONSUMER);
  assertClosedHandleTagSet(kinds);
  const consumers = kinds.map((k) => TAG_DISCRIMINATING_CONSUMER[k].export);
  assert.strictEqual(new Set(consumers).size, 9,
    'each handle kind needs its OWN discriminating consumer -- a shared consumer would prove nothing about tag separation');
  for (const name of consumers) {
    assert.ok(EXPORT_NAMES_IN_ORDER.includes(name), name + ' must be one of the 45 frozen exports (PLAN.md S2.3)');
  }
  assert.ok(!consumers.includes('handleIdentity') && !consumers.includes('statHandle'),
    'handleIdentity/statHandle accept ANY handle and must never be used as tag discriminators');
});

// ===========================================================================
// SECTION 9 -- `ABI-COUNT/TAG-*` (gated).
// ===========================================================================

test('ABI-COUNT/TAG-01: the module exposes EXACTLY the 45 own function exports and no other own property (PLAN.md S2.3)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  // Enumerates the module's ACTUAL own keys -- an EXTRA export fails here.
  assertExactModuleExportSurface(mod);
});

test('ABI-COUNT/TAG-02: providerAbiInfo() returns the COMPLETE 13-key record with every frozen value (PLAN.md S2.4)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const abi = mod.providerAbiInfo();
  assertSuccess(abi, 'providerAbiInfo()');
  assertNativeProviderAbiInfoV1(abi.value);

  // The record's own arity vector must agree with the export roster.
  const aritiesByName = EXPORT_NAMES_IN_ORDER.reduce((acc, name, i) => {
    acc[name] = abi.value.exact_arities[i];
    return acc;
  }, {});
  assertExactArityPairing(aritiesByName);

  // The reported platform/architecture must be the ACTUAL host, not a literal.
  assert.strictEqual(abi.value.platform, process.platform,
    'platform must report the real host platform');
  assert.strictEqual(abi.value.architecture, process.arch,
    'architecture must report the real host architecture');
});

test('ABI-COUNT/TAG-03: all EIGHT unambiguously-constructible handle tags reject every cross-tag misuse with exactly HANDLE_INVALID (PLAN.md S2.2)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-tags-')));
  try {
    const handles = buildHandleFixtures(mod, scratch);
    const kinds = TYPED_HANDLE_KINDS.filter((k) => k !== 'ProcessHandle');
    assert.strictEqual(kinds.length, 8);

    let crossTagAssertions = 0;
    for (const consumerKind of kinds) {
      const consumer = TAG_DISCRIMINATING_CONSUMER[consumerKind];
      for (const suppliedKind of kinds) {
        if (suppliedKind === consumerKind) continue;
        const result = consumer.call(mod, handles[suppliedKind], handles);
        assertRejection(result, 'HANDLE_INVALID',
          consumer.export + '() given a ' + suppliedKind + ' (requires ' + consumerKind + ')');
        crossTagAssertions += 1;
      }
    }
    assert.strictEqual(crossTagAssertions, 8 * 7,
      'the cross-tag matrix must cover every ordered (consumer,wrong-kind) pair');

    // Positive direction, for the consumers that are safe to drive here: the
    // RIGHT tag must NOT be HANDLE_INVALID. Without this, a consumer that
    // always returns HANDLE_INVALID would satisfy the matrix above vacuously.
    let positives = 0;
    for (const kind of kinds) {
      const consumer = TAG_DISCRIMINATING_CONSUMER[kind];
      if (!consumer.safePositive) continue; // readOneOrEof/secretWriteOnce do real I/O -- covered by ABI-COUNT/TAG-05
      const result = consumer.call(mod, handles[kind], handles);
      assertNativeResultShape(result, consumer.export + '() given its OWN ' + kind);
      assert.notStrictEqual(result.code, 'HANDLE_INVALID',
        consumer.export + '() given a genuine ' + kind + ' must NOT be HANDLE_INVALID -- otherwise the cross-tag matrix above is vacuous');
      positives += 1;
    }
    assert.strictEqual(positives, 6, 'six of the eight consumers are drivable without side effects');

    // The addon survives every rejection above with no pending exception.
    assertSuccess(mod.providerAbiInfo(), 'providerAbiInfo() after the full cross-tag matrix');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('ABI-COUNT/TAG-04: the ninth tag, ProcessHandle, is constructed through spawnWithSlots and rejects every cross-tag misuse (PLAN.md S2.2, S7.1)', whenChildModuleRowExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-proc-')));
  try {
    const handles = buildHandleFixtures(mod, scratch);
    const value = (r, what) => { assertSuccess(r, what); return r.value; };

    const sealedGeneration = discoverSealedGenerationDir();
    const childModulePath = path.join(sealedGeneration, 'tree', 'scripts', 'lib', 'runtime-r33-provider.cjs');
    assert.ok(fs.existsSync(childModulePath),
      'PLAN.md S2.3 fixes the child module path to <sealed>/tree/scripts/lib/runtime-r33-provider.cjs; not found at ' + childModulePath);

    const secondDir = value(mod.openRootAccredited(scratch), 'openRootAccredited(scratch) [slot 4 source]');
    const lifetimePipe = value(mod.makePipe(), 'makePipe() [slot 6 source]');
    const keyPipe = value(mod.makePipe(), 'makePipe() [slot 7 source]');
    const adminPair = value(mod.makeSocketpairStream(), 'makeSocketpairStream() [slot 5 source]');
    const stderrFile = value(mod.createFileExclusiveRW(handles.AccreditedDirHandle, 'child-stderr'), 'createFileExclusiveRW(stderr)');

    // PLAN.md S7.1 fixed child descriptor table, slots 3..7.
    const slotSources = [
      handles.AccreditedDirHandle, // 3: retained P_fd duplicate
      secondDir,                   // 4: retained R_fd duplicate
      adminPair.second,            // 5: child end of admin socketpair
      lifetimePipe.read,           // 6: child end of lifetime pipe
      keyPipe.read,                // 7: child end of master-key pipe
    ];
    // PLAN.md S2.3 fixes exec/argv/env exactly; only the `slots` CONTAINER
    // encoding is unstated, so the three plausible encodings are attempted and
    // the accepted one is used. Everything else is asserted verbatim.
    const encodings = [
      ['object-keyed-by-slot-number', { 3: slotSources[0], 4: slotSources[1], 5: slotSources[2], 6: slotSources[3], 7: slotSources[4] }],
      ['ordered-array-slots-3-to-7', slotSources],
      ['array-of-[slot,handle]-pairs', slotSources.map((h, i) => [i + 3, h])],
    ];
    const env = { NODE_ENV: 'production', R33_PROVIDER_CHILD: '1' };
    const argv = [process.execPath, childModulePath];

    const attempts = [];
    let processHandle = null;
    for (const [label, slots] of encodings) {
      const result = mod.spawnWithSlots(process.execPath, argv, handles.AccreditedDirHandle, env, slots, stderrFile);
      assertNativeResultShape(result, 'spawnWithSlots(' + label + ')');
      attempts.push([label, result.ok, result.code]);
      if (result.ok === true) { processHandle = result.value; break; }
    }
    assert.ok(processHandle !== null,
      'spawnWithSlots must accept one of the three PLAN.md S7.1-consistent slot encodings; attempts: ' + JSON.stringify(attempts));

    try {
      // Row: ProcessHandle supplied to each of the other eight consumers.
      for (const kind of TYPED_HANDLE_KINDS) {
        if (kind === 'ProcessHandle') continue;
        const consumer = TAG_DISCRIMINATING_CONSUMER[kind];
        assertRejection(consumer.call(mod, processHandle, handles), 'HANDLE_INVALID',
          consumer.export + '() given a ProcessHandle (requires ' + kind + ')');
      }
      // Column: each of the other eight supplied to waitOwnedProcess.
      for (const kind of TYPED_HANDLE_KINDS) {
        if (kind === 'ProcessHandle') continue;
        assertRejection(mod.waitOwnedProcess(handles[kind], true), 'HANDLE_INVALID',
          'waitOwnedProcess() given a ' + kind + ' (requires ProcessHandle)');
      }
      // Positive direction: the real ProcessHandle must not be HANDLE_INVALID.
      const wait = mod.waitOwnedProcess(processHandle, true);
      assertNativeResultShape(wait, 'waitOwnedProcess(real ProcessHandle, nohang)');
      assert.notStrictEqual(wait.code, 'HANDLE_INVALID',
        'waitOwnedProcess() given its OWN ProcessHandle must not be HANDLE_INVALID');
      // PLAN.md S2.3 #34: only SIGTERM|SIGKILL are accepted, and only against
      // the retained child identity -- never a caller-supplied PID. The PLAN
      // closes the accepted signal SET but does not name the rejection code,
      // so the closed subset is asserted rather than a guessed member.
      assertRejectionWithinCodes(mod.terminateOwnedProcess(processHandle, 'SIGUSR1'),
        ['TYPE_INVALID', 'NAME_INVALID', 'LENGTH_INVALID'],
        'terminateOwnedProcess() must accept only SIGTERM|SIGKILL (PLAN.md S2.3 #34)');
      assertRejectionWithinCodes(mod.terminateOwnedProcess(processHandle, 9),
        ['TYPE_INVALID', 'NAME_INVALID', 'LENGTH_INVALID'],
        'terminateOwnedProcess() must not accept a raw signal NUMBER (PLAN.md S2.1: no raw scalars as authority)');
    } finally {
      mod.terminateOwnedProcess(processHandle, 'SIGKILL');
      mod.waitOwnedProcess(processHandle, false);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('ABI-COUNT/TAG-05: plain object, Proxy, null, number, CLOSED handle, WRONG-TAG handle and a scratch FOREIGN external all reject as HANDLE_INVALID with no pending exception (PLAN.md S2.1, S2.2)', whenAddonExists(), () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-reject-')));
  try {
    const foreignAddonPath = compileScratchForeignExternalAddon(scratch);
    const workDir = path.join(scratch, 'work');
    fs.mkdirSync(workDir, { mode: 0o700 });

    // A FRESH PROCESS is required: an exception that escapes a native
    // rejection path changes the process exit code, which an in-process
    // try/catch cannot observe.
    const probeSource = [
      'const mod = require(' + JSON.stringify(ADDON_ENTRY_PATH) + ');',
      'const foreign = require(' + JSON.stringify(foreignAddonPath) + ');',
      'const out = { rejections: [], uncaught: [], usableAfter: null, foreignIsExternal: null };',
      'process.on("uncaughtException", (e) => { out.uncaught.push("uncaughtException: " + (e && e.message)); });',
      'process.on("unhandledRejection", (e) => { out.uncaught.push("unhandledRejection: " + String(e)); });',
      'const foreignExternal = foreign.makeForeignExternal();',
      'out.foreignIsExternal = require("node:util").types.isExternal(foreignExternal);',
      // CLOSED handle: a genuine handle from this addon, then closed.
      'const closedSecret = mod.secretRandom32();',
      'mod.closeHandle(closedSecret.value);',
      // WRONG-TAG handle: a genuine ClockHandle handed to a secret operation.
      'const clock = mod.clockOpen();',
      'const inputs = [',
      '  ["plain-object", {}],',
      '  ["proxy-over-plain-object", new Proxy({}, {})],',
      '  ["proxy-over-function", new Proxy(function () {}, {})],',
      '  ["null", null],',
      '  ["undefined", undefined],',
      '  ["number", 42],',
      '  ["string", "handle"],',
      '  ["array", []],',
      '  ["buffer", Buffer.alloc(8)],',
      '  ["closed-handle", closedSecret.value],',
      '  ["wrong-tag-handle", clock.value],',
      '  ["scratch-foreign-external", foreignExternal],',
      '];',
      'for (const [label, input] of inputs) {',
      '  const r = mod.secretIsUsable(input);',
      '  out.rejections.push([label, r && r.ok, r && r.code, r && r.value === null, r && Object.keys(r).sort().join(",")]);',
      '}',
      'const after = mod.providerAbiInfo();',
      'out.usableAfter = after.ok === true && after.value.napi_version === 8;',
      'process.stdout.write(JSON.stringify(out));',
    ].join('\n');

    const probe = runChildProbe(probeSource, { cwd: workDir });
    assertProbeExitedCleanly(probe, 'ABI-COUNT/TAG-05 rejection probe');

    assert.deepStrictEqual(probe.json.uncaught, [],
      'no exception may escape any rejection path (PLAN.md S2.1: every tag-API error path clears the pending exception)');
    assert.strictEqual(probe.json.foreignIsExternal, true,
      'precondition: the scratch fixture must be a genuine napi_external produced OUTSIDE this addon');
    assert.strictEqual(probe.json.usableAfter, true,
      'the addon must remain fully usable after every rejection -- proof that no pending exception survived');

    const observedLabels = probe.json.rejections.map((r) => r[0]);
    for (const required of ['plain-object', 'proxy-over-plain-object', 'null', 'number', 'closed-handle', 'wrong-tag-handle', 'scratch-foreign-external']) {
      assert.ok(observedLabels.includes(required), 'the rejection sweep must cover ' + required);
    }
    for (const [label, ok, code, valueIsNull, keys] of probe.json.rejections) {
      assert.strictEqual(ok, false, label + ' must be rejected');
      assert.strictEqual(code, 'HANDLE_INVALID', label + ' must be exactly HANDLE_INVALID, got ' + code);
      assert.strictEqual(valueIsNull, true, label + ' must carry value:null');
      assert.strictEqual(keys, 'code,ok,value', label + ' must return exactly the three NativeResultV1 keys');
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ===========================================================================
// SECTION 10 -- `ABI-ARITY-*` (gated).
// ===========================================================================

test('ABI-ARITY-01: every one of the 45 exports returns ONLY ARITY_INVALID at N-1/N+1, with zero FD/handle/resource change (PLAN.md S2.1, S11.2)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-arity-')));
  try {
    // Live state whose invariance across the invalid-arity sweep is the
    // "zero allocation/syscall/handle-state change" proof.
    const dirResult = mod.openRootAccredited(scratch);
    assertSuccess(dirResult, 'openRootAccredited(scratch) [arity witness]');
    const secretResult = mod.secretRandom32();
    assertSuccess(secretResult, 'secretRandom32() [arity witness]');

    const inventoryBefore = mod.listOpenFds(4096);
    assertSuccess(inventoryBefore, 'listOpenFds(4096) before the invalid-arity sweep');
    const statBefore = mod.statHandle(dirResult.value);
    assertSuccess(statBefore, 'statHandle(dir) before the invalid-arity sweep');
    const usableBefore = mod.secretIsUsable(secretResult.value);
    assertSuccess(usableBefore, 'secretIsUsable(secret) before the invalid-arity sweep');

    let overCalls = 0;
    let underCalls = 0;
    for (const name of EXPORT_NAMES_IN_ORDER) {
      const arity = ARITY_BY_EXPORT_NAME[name];
      const fn = mod[name];
      assert.strictEqual(typeof fn, 'function', name + ' must be a function');

      assertRejection(fn(...new Array(arity + 1).fill(undefined)), 'ARITY_INVALID',
        name + '(N+1 = ' + (arity + 1) + ' args)');
      overCalls += 1;

      if (arity > 0) {
        assertRejection(fn(...new Array(arity - 1).fill(undefined)), 'ARITY_INVALID',
          name + '(N-1 = ' + (arity - 1) + ' args)');
        underCalls += 1;
      }
    }
    assert.strictEqual(overCalls, 45, 'N+1 must be exercised for all 45 exports');
    assert.strictEqual(underCalls, 45 - ZERO_ARITY_EXPORTS.length,
      'N-1 must be exercised for all 40 positive-arity exports (the five zero-arity ones are mechanically exempt)');

    // Zero allocation / syscall / handle-state change across the whole sweep.
    const inventoryAfter = mod.listOpenFds(4096);
    assertSuccess(inventoryAfter, 'listOpenFds(4096) after the invalid-arity sweep');
    assertFdInventoryUnchanged(inventoryBefore.value, inventoryAfter.value, 'ABI-ARITY-01 invalid-arity sweep');
    assert.deepStrictEqual(mod.statHandle(dirResult.value), statBefore,
      'ABI-ARITY-01: no handle state may change across an invalid-arity sweep (PLAN.md S2.1)');
    assert.deepStrictEqual(mod.secretIsUsable(secretResult.value), usableBefore,
      'ABI-ARITY-01: no secret state may change across an invalid-arity sweep (PLAN.md S2.1)');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('ABI-ARITY-02: every export at EXACTLY N arguments reaches normal argument validation (PLAN.md S2.1)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  // Run separately from ABI-ARITY-01: the five zero-arity exports genuinely
  // EXECUTE at exact N and create real resources, so they must be outside the
  // zero-resource-change window above.
  const created = [];
  try {
    for (const name of EXPORT_NAMES_IN_ORDER) {
      const arity = ARITY_BY_EXPORT_NAME[name];
      const result = mod[name](...new Array(arity).fill(undefined));
      assertNativeResultShape(result, name + '(exactly N = ' + arity + ' args)');
      assert.notStrictEqual(result.code, 'ARITY_INVALID',
        name + '(exactly N args) must PASS arity validation -- arity is captured before any argument is decoded (PLAN.md S2.1)');
      if (result.ok === true && result.value !== null && typeof result.value === 'object') created.push(result.value);
    }
  } finally {
    // The zero-arity creators (makeSocketpairStream/makePipe return pairs).
    for (const value of created) {
      const isPair = Boolean(value.first) || Boolean(value.read);
      for (const handle of (isPair ? [value.first, value.second, value.read, value.write] : [value])) {
        if (handle) { try { mod.closeHandle(handle); } catch (_err) { /* best-effort fixture teardown */ } }
      }
    }
  }
});

// ===========================================================================
// SECTION 11 -- `ABI-BOUND-*` (gated). Every byte/numeric boundary in
// PLAN.md S11.2, not a sample.
// ===========================================================================

test('ABI-BOUND-01: HKDF salt fixed width -- 31 and 33 are LENGTH_INVALID, 32 passes (PLAN.md S2.1)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const secret = mod.secretRandom32();
  assertSuccess(secret, 'secretRandom32()');
  const info = Buffer.from('r33-bound-info');

  for (const saltLen of [31, 33]) {
    assertRejection(mod.hkdfSha256(secret.value, Buffer.alloc(saltLen), info), 'LENGTH_INVALID',
      'hkdfSha256 with a ' + saltLen + '-byte salt (fixed width is exactly 32)');
  }
  // PLAN.md S2.1: "SECRET_SHORT/SECRET_OVERLONG apply only to adoptSecret32;
  // HKDF salt-width failure is always LENGTH_INVALID."
  for (const saltLen of [31, 33]) {
    const code = mod.hkdfSha256(secret.value, Buffer.alloc(saltLen), info).code;
    assert.ok(code !== 'SECRET_SHORT' && code !== 'SECRET_OVERLONG',
      'HKDF salt-width failure is never SECRET_SHORT/SECRET_OVERLONG (PLAN.md S2.1)');
  }
  assertSuccess(mod.hkdfSha256(secret.value, Buffer.alloc(32), info), 'hkdfSha256 with the exact 32-byte salt');

  // A non-Uint8Array/Buffer salt is TYPE_INVALID, before any byte is copied.
  assertRejection(mod.hkdfSha256(secret.value, 'x'.repeat(32), info), 'TYPE_INVALID',
    'hkdfSha256 with a STRING salt (no implicit string conversion, PLAN.md S2.1)');
});

test('ABI-BOUND-02: HKDF info cap -- 0 is LENGTH_INVALID, 1 and 1024 pass, 1025 is CAP_EXCEEDED (PLAN.md S2.1)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const secret = mod.secretRandom32();
  assertSuccess(secret, 'secretRandom32()');
  const salt = Buffer.alloc(32);

  assertRejection(mod.hkdfSha256(secret.value, salt, Buffer.alloc(0)), 'LENGTH_INVALID',
    'hkdfSha256 with zero-byte info (minimum is 1)');
  assertSuccess(mod.hkdfSha256(secret.value, salt, Buffer.alloc(1)), 'hkdfSha256 with 1-byte info (exact minimum)');
  assertSuccess(mod.hkdfSha256(secret.value, salt, Buffer.alloc(1024)), 'hkdfSha256 with 1024-byte info (exact cap)');
  assertRejection(mod.hkdfSha256(secret.value, salt, Buffer.alloc(1025)), 'CAP_EXCEEDED',
    'hkdfSha256 with 1025-byte info (cap+1)');
});

test('ABI-BOUND-03: HKDF output is a FIXED 32-byte SecretHandle -- proven by the exact one-shot write width (PLAN.md S2.2, S2.3 #36/#38)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const abi = mod.providerAbiInfo();
  assertSuccess(abi, 'providerAbiInfo()');
  assert.strictEqual(abi.value.hkdf_output_bytes, 32, 'the record must declare a fixed 32-byte HKDF output');

  const secret = mod.secretRandom32();
  assertSuccess(secret, 'secretRandom32()');
  const derived = mod.hkdfSha256(secret.value, Buffer.alloc(32), Buffer.from('r33-output-width'));
  assertSuccess(derived, 'hkdfSha256(...) [derived SecretHandle]');

  // Empirical width proof: secretWriteOnce writes EXACTLY 32 bytes then closes
  // and poisons the endpoint (PLAN.md S2.3 #36). A derived handle of any other
  // width could not satisfy both the byte count and the immediate EOF.
  const pipe = mod.makePipe();
  assertSuccess(pipe, 'makePipe()');
  const written = mod.secretWriteOnce(derived.value, pipe.value.write);
  assertSuccess(written, 'secretWriteOnce(derived, pipeWrite)');
  assert.strictEqual(written.value, 32,
    'secretWriteOnce must report EXACTLY 32 written bytes -- "No other width exists" (PLAN.md S2.2)');

  const read = mod.readExact(pipe.value.read, 32, 33, MONO_NS_MAX);
  assertSuccess(read, 'readExact(pipeRead, 32, 33, deadline)');
  assert.strictEqual(read.value.length, 32, 'exactly 32 bytes must be readable from the one-shot write');
  // A 33rd byte must not exist: PLAN.md S2.3 #30 returns EOF_OR_SHORT when EOF
  // arrives before `n`. Together with the exact 32 above this pins the width
  // from both sides -- a 64-byte output would satisfy neither assertion.
  assertRejection(mod.readExact(pipe.value.read, 1, 1, MONO_NS_MAX), 'EOF_OR_SHORT',
    'the endpoint must be at EOF immediately after the fixed 32-byte write -- no 33rd byte exists');
  // The write endpoint is poisoned after its single use (PLAN.md S2.3 #36).
  assertRejection(mod.secretWriteOnce(derived.value, pipe.value.write), 'HANDLE_INVALID',
    'the pipe write endpoint is closed and poisoned after exactly one secretWriteOnce');
});

test('ABI-BOUND-04: HMAC message bounds -- 0 is LENGTH_INVALID, 1 and 16,842,752 pass, 16,842,753 is CAP_EXCEEDED, tag is 32 bytes (PLAN.md S2.1, S2.3 #39)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const secret = mod.secretRandom32();
  assertSuccess(secret, 'secretRandom32()');

  assertRejection(mod.hmacSha256(secret.value, Buffer.alloc(0)), 'LENGTH_INVALID',
    'hmacSha256 with a zero-byte message (minimum is 1)');

  const one = mod.hmacSha256(secret.value, Buffer.alloc(1));
  assertSuccess(one, 'hmacSha256 with a 1-byte message (exact minimum)');
  assert.strictEqual(one.value.length, 32, 'hmacSha256 returns exactly 32 public tag bytes (PLAN.md S2.3 #39)');

  const atCap = mod.hmacSha256(secret.value, Buffer.alloc(16842752));
  assertSuccess(atCap, 'hmacSha256 with a 16,842,752-byte message (exact cap)');
  assert.strictEqual(atCap.value.length, 32, 'the tag width is fixed at 32 bytes regardless of message size');

  assertRejection(mod.hmacSha256(secret.value, Buffer.alloc(16842753)), 'CAP_EXCEEDED',
    'hmacSha256 with a 16,842,753-byte message (cap+1)');
  assertRejection(mod.hmacSha256(secret.value, 'not-bytes'), 'TYPE_INVALID',
    'hmacSha256 with a non-Uint8Array/Buffer message (PLAN.md S2.1)');
});

test('ABI-BOUND-05: canonical MonoNs boundaries -- 0 and 18446744073709551615 are in range; every noncanonical form collapses to ONE code (PLAN.md S3.1)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const pair = mod.makeSocketpairStream();
  assertSuccess(pair, 'makeSocketpairStream()');
  const conn = pair.value.first;
  const payload = Buffer.from('x');

  // Noncanonical decimal STRING grammar (PLAN.md S3.1: canonical decimal
  // 0..18446744073709551615). PLAN.md S2.1 forbids an "alternate error code",
  // so the whole family must collapse to one canonical code.
  const malformedStrings = [
    ['empty', ''],
    ['negative', '-1'],
    ['explicit-plus', '+1'],
    ['leading-zero', '01'],
    ['fractional', '1.0'],
    ['hex', '0x10'],
    ['exponent', '1e3'],
    ['leading-space', ' 1'],
    ['trailing-space', '1 '],
    ['non-ascii-digit', '١'],
    ['above-u64-max', '18446744073709551616'],
    ['far-above-u64-max', '99999999999999999999999'],
  ];
  const stringCode = assertCanonicalRejectionFamily(
    malformedStrings.map(([label, v]) => [label, mod.writeBytes(conn, payload, 4096, v)]),
    ['TYPE_INVALID', 'LENGTH_INVALID'],
    'ABI-BOUND-05 noncanonical MonoNs string family',
  );

  // A non-string deadline never crosses the ABI (PLAN.md S2.1: canonical
  // monotonic nanoseconds cross "only as MonoNs decimal strings").
  assertCanonicalRejectionFamily([
    ['number', mod.writeBytes(conn, payload, 4096, 1)],
    ['bigint', mod.writeBytes(conn, payload, 4096, 1n)],
    ['null', mod.writeBytes(conn, payload, 4096, null)],
    ['object', mod.writeBytes(conn, payload, 4096, {})],
    ['buffer', mod.writeBytes(conn, payload, 4096, Buffer.from('1'))],
    ['array', mod.writeBytes(conn, payload, 4096, ['1'])],
  ], ['TYPE_INVALID'], 'ABI-BOUND-05 non-string MonoNs family');

  // The two in-range boundary literals must NOT be rejected as grammar.
  for (const [label, deadline] of [['minimum 0', MONO_NS_MIN], ['maximum 2^64-1', MONO_NS_MAX]]) {
    const result = mod.writeBytes(conn, payload, 4096, deadline);
    assertNativeResultShape(result, 'writeBytes(deadline=' + label + ')');
    assert.notStrictEqual(result.code, stringCode,
      'the canonical MonoNs boundary ' + label + ' must NOT be rejected as a grammar violation (PLAN.md S3.1)');
  }
});

test('ABI-BOUND-06: inherited-slot boundaries -- slots 3/4/5/6/7 are child-only, and out-of-range slots reject (PLAN.md S2.3 #26-28, S7.1)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  // This process is NOT the provider child, so every in-range slot adoption
  // must still reject: adoption is child-only. A parent that could adopt its
  // own FD 3 would be a direct authority escape.
  assertCanonicalRejectionFamily([
    ['adoptInheritedDir(3)', mod.adoptInheritedDir(3)],
    ['adoptInheritedDir(4)', mod.adoptInheritedDir(4)],
    ['adoptInheritedConn(5)', mod.adoptInheritedConn(5)],
    ['adoptInheritedRead(6)', mod.adoptInheritedRead(6)],
    ['adoptInheritedRead(7)', mod.adoptInheritedRead(7)],
  ], ['ADOPT_INVALID'], 'ABI-BOUND-06 in-range slots adopted from a NON-child process');

  // Out-of-range integer slots, including each export's exact neighbours.
  assertCanonicalRejectionFamily([
    ['adoptInheritedDir(2)', mod.adoptInheritedDir(2)],
    ['adoptInheritedDir(5)', mod.adoptInheritedDir(5)],
    ['adoptInheritedDir(0)', mod.adoptInheritedDir(0)],
    ['adoptInheritedDir(-1)', mod.adoptInheritedDir(-1)],
    ['adoptInheritedConn(4)', mod.adoptInheritedConn(4)],
    ['adoptInheritedConn(6)', mod.adoptInheritedConn(6)],
    ['adoptInheritedRead(5)', mod.adoptInheritedRead(5)],
    ['adoptInheritedRead(8)', mod.adoptInheritedRead(8)],
  ], ['ADOPT_INVALID', 'LENGTH_INVALID'], 'ABI-BOUND-06 out-of-range slot family');

  // Non-integer slot values never reach adoption.
  assertCanonicalRejectionFamily([
    ['string', mod.adoptInheritedDir('3')],
    ['float', mod.adoptInheritedDir(3.5)],
    ['null', mod.adoptInheritedDir(null)],
    ['bigint', mod.adoptInheritedDir(3n)],
    ['NaN', mod.adoptInheritedDir(NaN)],
    ['Infinity', mod.adoptInheritedDir(Infinity)],
  ], ['TYPE_INVALID'], 'ABI-BOUND-06 non-integer slot family');
});

test('ABI-BOUND-07: size and index boundaries -- readExact n, writeAllBounded cap, listOpenFds limit (PLAN.md S2.3 #9/#30/#32)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-size-')));
  try {
    const dir = mod.openRootAccredited(scratch);
    assertSuccess(dir, 'openRootAccredited(scratch)');
    const file = mod.createFileExclusiveRW(dir.value, 'bounded');
    assertSuccess(file, 'createFileExclusiveRW(dir,"bounded")');
    const filePath = path.join(scratch, 'bounded');

    // writeAllBounded: "Rejects bytes>cap before the first write."
    assertRejection(mod.writeAllBounded(file.value, Buffer.alloc(17), 16), 'CAP_EXCEEDED',
      'writeAllBounded with bytes(17) > cap(16)');
    assert.strictEqual(fs.statSync(filePath).size, 0,
      'ABI-BOUND-07: a cap rejection happens BEFORE the first write -- the file must still be empty');
    assertSuccess(mod.writeAllBounded(file.value, Buffer.alloc(16), 16), 'writeAllBounded at bytes == cap');
    assert.strictEqual(fs.statSync(filePath).size, 16, 'the exact-cap write must land in full');

    // readExact: "Requires 0<=n<=cap". Driven against a STREAM handle --
    // PLAN.md S2.3 #29/#30 are stream operations, so a FileHandle here would
    // reject as HANDLE_INVALID and prove nothing about the index bounds.
    const pair = mod.makeSocketpairStream();
    assertSuccess(pair, 'makeSocketpairStream() [readExact index witness]');
    assertCanonicalRejectionFamily([
      ['n = -1', mod.readExact(pair.value.first, -1, 16, MONO_NS_MAX)],
      ['n = cap+1', mod.readExact(pair.value.first, 17, 16, MONO_NS_MAX)],
    ], ['LENGTH_INVALID', 'CAP_EXCEEDED'], 'ABI-BOUND-07 readExact index family');
    // The in-range boundary must NOT be rejected as an index violation; with
    // the peer still open and a already-expired deadline it times out instead.
    const inRange = mod.readExact(pair.value.first, 16, 16, MONO_NS_MIN);
    assertNativeResultShape(inRange, 'readExact(n == cap)');
    assert.ok(inRange.code !== 'LENGTH_INVALID' && inRange.code !== 'CAP_EXCEEDED',
      'n == cap satisfies 0<=n<=cap and must not be rejected as an index violation, got ' + inRange.code);

    // listOpenFds: "diagnostic inventory capped at 4096".
    assertSuccess(mod.listOpenFds(4096), 'listOpenFds at the exact 4096 cap');
    assertRejection(mod.listOpenFds(4097), 'CAP_EXCEEDED', 'listOpenFds(4097) is cap+1');

    // readBackSameFd rejects overflow rather than truncating (PLAN.md S2.3 #10).
    assertRejection(mod.readBackSameFd(file.value, 15), 'CAP_EXCEEDED',
      'readBackSameFd must reject a 16-byte payload against a 15-byte cap, never truncate (PLAN.md S2.1)');
    assertSuccess(mod.readBackSameFd(file.value, 16), 'readBackSameFd at the exact cap');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('ABI-BOUND-08: endpoint byte-length boundary -- N+1==cap SUCCEEDS and N+1==cap+1 fails with the exact code and zero write (PLAN.md S2.4)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const abi = mod.providerAbiInfo();
  assertSuccess(abi, 'providerAbiInfo()');
  const cap = abi.value.sockaddr_un_sun_path_bytes;
  assert.strictEqual(cap, process.platform === 'linux' ? 108 : 104,
    'the endpoint cap must be exactly the closed linux->108 / darwin->104 pairing (PLAN.md S2.4)');

  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-cap-')));
  try {
    const rootBytes = Buffer.byteLength(scratch, 'utf8');
    // abs = scratch + "/" + name, so N = rootBytes + 1 + nameBytes.
    const atCapNameLen = cap - rootBytes - 2;   // N + 1 == cap
    const overCapNameLen = cap - rootBytes - 1; // N + 1 == cap + 1
    assert.ok(atCapNameLen >= 1 && overCapNameLen <= 255,
      'precondition: the scratch root must leave a usable 1..255-byte PathComponent inside the cap (root is '
      + rootBytes + ' bytes, cap is ' + cap + ')');

    const dir = mod.openRootAccredited(scratch);
    assertSuccess(dir, 'openRootAccredited(scratch)');

    const atCapName = 'a'.repeat(atCapNameLen);
    const atCapAbs = path.join(scratch, atCapName);
    assert.strictEqual(Buffer.byteLength(atCapAbs, 'utf8') + 1, cap, 'precondition: N+1 == cap exactly');
    const atCap = mod.bindListenerAbsolute(dir.value, atCapName, atCapAbs);
    assertSuccess(atCap, 'bindListenerAbsolute at N+1 == cap must SUCCEED (PLAN.md S2.4)');
    assert.ok(fs.lstatSync(atCapAbs).isSocket(), 'the at-cap bind must have created a real AF_UNIX socket');
    assertSuccess(mod.closeHandle(atCap.value), 'closeHandle(at-cap listener)');

    const overCapName = 'a'.repeat(overCapNameLen);
    const overCapAbs = path.join(scratch, overCapName);
    assert.strictEqual(Buffer.byteLength(overCapAbs, 'utf8') + 1, cap + 1, 'precondition: N+1 == cap+1 exactly');
    const overCap = mod.bindListenerAbsolute(dir.value, overCapName, overCapAbs);
    // PLAN.md S2.4 reserves SOCKET_CAP_INVALID for a wrong COMPILE-TIME cap
    // constant; a runtime endpoint that overflows the accredited cap is
    // PATH_TOO_LONG (the S2.1 enum member that exists for exactly this).
    assert.notStrictEqual(overCap.code, 'SOCKET_CAP_INVALID',
      'SOCKET_CAP_INVALID is reserved for an invalid COMPILE-TIME cap constant, not a runtime over-long endpoint (PLAN.md S2.4)');
    assertRejection(overCap, 'PATH_TOO_LONG', 'bindListenerAbsolute at N+1 == cap+1');
    assertNoEffectAtPath(overCapAbs, 'ABI-BOUND-08 cap+1 zero-write');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ===========================================================================
// SECTION 12 -- `PATH-ACCREDIT-*` (gated). Every S8.2 accreditation class.
// ===========================================================================

/** Creates an ancestor/final-P pair under a fresh owner-only scratch root. */
function accreditationFixture(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix)));
  fs.chmodSync(root, 0o700);
  return {
    root,
    ancestor: path.join(root, 'anc'),
    dispose() { try { fs.chmodSync(root, 0o700); } catch (_e) { /* best effort */ } fs.rmSync(root, { recursive: true, force: true }); },
  };
}

function grantForeignAclWrite(absPath) {
  if (process.platform === 'darwin') {
    const r = spawnSync('/bin/chmod', ['+a', 'everyone allow write,add_file,add_subdirectory,delete_child', absPath], { encoding: 'utf8' });
    return r.status === 0;
  }
  const r = spawnSync('setfacl', ['-m', 'o::rwx', absPath], { encoding: 'utf8' });
  return r.status === 0;
}

test('PATH-ACCREDIT-01: an eUID-owned non-writable ancestor chain plus a correctly-restricted final P is accredited (PLAN.md S8.2 class 3)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const fx = accreditationFixture('r33-accredit-euid-');
  try {
    fs.mkdirSync(fx.ancestor, { mode: 0o755 }); // eUID-owned, group/other WRITE clear
    const finalP = path.join(fx.ancestor, 'final-p');
    fs.mkdirSync(finalP, { mode: 0o700 });
    assertSuccess(mod.openRootAccredited(finalP), 'eUID-owned non-writable ancestor + 0700 final P');
  } finally {
    fx.dispose();
  }
});

test('PATH-ACCREDIT-02: a final P with group/other READ+EXECUTE but no WRITE is accredited (PLAN.md S8.2 step 3d)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const fx = accreditationFixture('r33-accredit-finalp-rx-');
  try {
    fs.mkdirSync(fx.ancestor, { mode: 0o755 });
    // "Group/other read or execute bits alone are not owner-authority and are
    // permitted, exactly matching preserved R3.3 S3.2."
    for (const mode of [0o755, 0o750, 0o705, 0o711, 0o700]) {
      const finalP = path.join(fx.ancestor, 'final-' + mode.toString(8));
      fs.mkdirSync(finalP, { mode: 0o700 });
      fs.chmodSync(finalP, mode);
      assertSuccess(mod.openRootAccredited(finalP),
        'final P mode 0' + mode.toString(8) + ' (no group/other write) must be accredited');
    }
  } finally {
    fx.dispose();
  }
});

test('PATH-ACCREDIT-03: any group/other WRITE bit on final P is MODE_INVALID with zero effect (PLAN.md S8.2 step 3d)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const fx = accreditationFixture('r33-accredit-finalp-w-');
  try {
    fs.mkdirSync(fx.ancestor, { mode: 0o755 });
    for (const mode of [0o770, 0o707, 0o777, 0o720, 0o702]) {
      const finalP = path.join(fx.ancestor, 'final-' + mode.toString(8));
      fs.mkdirSync(finalP, { mode: 0o700 });
      fs.chmodSync(finalP, mode);
      assertRejection(mod.openRootAccredited(finalP), 'MODE_INVALID',
        'final P mode 0' + mode.toString(8) + ' grants group/other write');
      // The rejection must not have mutated the subject.
      assert.strictEqual(fs.statSync(finalP).mode & 0o7777, mode,
        'a MODE_INVALID rejection must not alter the rejected directory');
    }
  } finally {
    fx.dispose();
  }
});

test('PATH-ACCREDIT-04: a group/other-writable ANCESTOR is rejected before any mutation (PLAN.md S8.2 step 3c)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const fx = accreditationFixture('r33-accredit-anc-w-');
  try {
    // eUID-owned but group/other writable: outside class 1 (needs uid 0),
    // class 2 (needs uid 0 + sticky) and class 3 (needs write bits clear).
    for (const mode of [0o777, 0o775, 0o757, 0o1777]) {
      const ancestor = path.join(fx.root, 'anc-' + mode.toString(8));
      fs.mkdirSync(ancestor, { mode: 0o700 });
      const finalP = path.join(ancestor, 'final-p');
      fs.mkdirSync(finalP, { mode: 0o700 });
      fs.chmodSync(ancestor, mode);
      const result = mod.openRootAccredited(finalP);
      assertRejection(result, 'MODE_INVALID',
        'ancestor mode 0' + mode.toString(8) + ' (eUID-owned, group/other writable' + (mode & 0o1000 ? ', sticky but NOT root-owned' : '') + ')');
      fs.chmodSync(ancestor, 0o700);
    }
  } finally {
    fx.dispose();
  }
});

test('PATH-ACCREDIT-05: a root-owned 0755 ancestor chain under /Users (darwin) or /home (linux) is accredited (PLAN.md S8.2 class 1)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const home = fs.realpathSync(os.homedir());
  const expectedPrefix = process.platform === 'darwin' ? '/Users/' : '/home/';
  assert.ok(home.startsWith(expectedPrefix),
    'precondition: the home directory must sit under ' + expectedPrefix + ' for this class, got ' + home);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(home, '.r33-accredit-home-')));
  try {
    fs.chmodSync(scratch, 0o700);
    // "/, /Users, and /home are not required to have the manager eUID."
    assertSuccess(mod.openRootAccredited(scratch),
      'a root-owned ' + expectedPrefix.slice(0, -1) + ' ancestor plus eUID-owned descendants must be accredited');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('PATH-ACCREDIT-06: a root-owned STICKY /private/tmp (darwin) or /tmp (linux) ancestor is accredited (PLAN.md S8.2 class 2)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const stickyRoot = process.platform === 'darwin' ? '/private/tmp' : '/tmp';
  const st = fs.lstatSync(stickyRoot);
  assert.strictEqual(st.uid, 0, 'precondition: ' + stickyRoot + ' must be root-owned');
  assert.ok((st.mode & 0o1000) !== 0, 'precondition: ' + stickyRoot + ' must have the sticky bit set');
  assert.ok(!st.isSymbolicLink(), 'precondition: ' + stickyRoot + ' must not be a symlink component');

  const scratch = fs.mkdtempSync(path.join(stickyRoot, 'r33-accredit-sticky-'));
  try {
    fs.chmodSync(scratch, 0o700);
    assertSuccess(mod.openRootAccredited(scratch),
      'a root-owned sticky ' + stickyRoot + ' ancestor satisfies class 2; final P still requires the exact eUID');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('PATH-ACCREDIT-07: a final P owned by another uid is OWNER_INVALID (PLAN.md S8.2 step 3d)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  // A real, existing root-owned directory whose ancestors are all class 1 --
  // so the ONLY failing predicate is final P's exact-eUID requirement.
  const rootOwnedFinalP = process.platform === 'darwin' ? '/private/etc' : '/etc';
  const st = fs.lstatSync(rootOwnedFinalP);
  assert.strictEqual(st.uid, 0, 'precondition: ' + rootOwnedFinalP + ' must be root-owned');
  assert.ok(!st.isSymbolicLink(), 'precondition: ' + rootOwnedFinalP + ' must be a real directory, not a symlink');
  assert.notStrictEqual(process.geteuid(), 0,
    'precondition: this test is meaningless when running as root -- final P would legitimately match the eUID');

  assertRejection(mod.openRootAccredited(rootOwnedFinalP), 'OWNER_INVALID',
    'final P must require uid EXACTLY equal to the manager eUID, even for a root-owned directory whose ancestors are all trusted');
});

test('PATH-ACCREDIT-08: an ANCESTOR owned by a third principal is rejected (PLAN.md S8.2 step 3c)', {
  skip: !addonExists()
    ? ADDON_ABSENT_SKIP_REASON
    : (process.geteuid() !== 0
      ? 'creating a directory owned by a uid that is neither 0 nor the manager eUID requires root; this case un-skips in a root context (the PLAN S9.2 Linux CI jobs)'
      : false),
}, () => {
  const mod = require(ADDON_ENTRY_PATH);
  const fx = accreditationFixture('r33-accredit-foreign-uid-');
  try {
    fs.mkdirSync(fx.ancestor, { mode: 0o755 });
    const finalP = path.join(fx.ancestor, 'final-p');
    fs.mkdirSync(finalP, { mode: 0o700 });
    const foreignUid = 65534; // nobody
    fs.chownSync(fx.ancestor, foreignUid, 0);
    assertRejection(mod.openRootAccredited(finalP), 'OWNER_INVALID',
      'an ancestor owned by neither uid 0 nor the manager eUID is outside all three trusted-ancestor classes');
  } finally {
    fx.dispose();
  }
});

test('PATH-ACCREDIT-09: an extended ACL granting write/add/delete-child to another principal is ACL_INVALID, on both an ancestor and final P (PLAN.md S8.2 steps 3c/3d)', {
  skip: !addonExists()
    ? ADDON_ABSENT_SKIP_REASON
    : (process.platform === 'darwin' || process.platform === 'linux' ? false : 'extended ACLs are only exercised on linux/darwin'),
}, () => {
  const mod = require(ADDON_ENTRY_PATH);
  const fx = accreditationFixture('r33-accredit-acl-');
  try {
    fs.mkdirSync(fx.ancestor, { mode: 0o700 });
    const finalP = path.join(fx.ancestor, 'final-p');
    fs.mkdirSync(finalP, { mode: 0o700 });

    // Sanity: with POSIX bits alone this exact tree accredits. The ONLY delta
    // below is the extended ACL, so the rejection cannot come from anything else.
    assertSuccess(mod.openRootAccredited(finalP), 'baseline: the same tree accredits before any ACL is granted');

    assert.ok(grantForeignAclWrite(fx.ancestor),
      'precondition: the extended-ACL fixture must be creatable on this host');
    assertRejection(mod.openRootAccredited(finalP), 'ACL_INVALID',
      'an ancestor whose extended ACL grants write/add_file/delete_child to another principal is outside every trusted-ancestor class');

    const fx2 = accreditationFixture('r33-accredit-acl-final-');
    try {
      fs.mkdirSync(fx2.ancestor, { mode: 0o700 });
      const finalP2 = path.join(fx2.ancestor, 'final-p');
      fs.mkdirSync(finalP2, { mode: 0o700 });
      assertSuccess(mod.openRootAccredited(finalP2), 'baseline: the second tree accredits before any ACL is granted');
      assert.ok(grantForeignAclWrite(finalP2), 'precondition: the final-P ACL fixture must be creatable');
      assertRejection(mod.openRootAccredited(finalP2), 'ACL_INVALID',
        'final P with an ACL write/add/delete-child grant to another principal is rejected');
    } finally {
      fx2.dispose();
    }
  } finally {
    fx.dispose();
  }
});

test('PATH-ACCREDIT-10: a SYMLINK ancestor component is SYMLINK_REJECTED with zero effect -- no realpath resolution (PLAN.md S8.2 step 3b)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const fx = accreditationFixture('r33-accredit-symlink-');
  try {
    const realDir = path.join(fx.root, 'real');
    fs.mkdirSync(realDir, { mode: 0o700 });
    const realFinal = path.join(realDir, 'final-p');
    fs.mkdirSync(realFinal, { mode: 0o700 });

    // Baseline: the same final P accredits through its REAL lexical path.
    assertSuccess(mod.openRootAccredited(realFinal), 'baseline: the real lexical path accredits');

    const viaSymlink = path.join(fx.root, 'via-symlink');
    fs.symlinkSync(realDir, viaSymlink, 'dir'); // mutated: watched symlink component
    assertRejection(mod.openRootAccredited(path.join(viaSymlink, 'final-p')), 'SYMLINK_REJECTED',
      'a symlink ancestor component must be rejected lexically, never silently resolved to the accepted real path');

    // A symlink as the FINAL component is likewise rejected.
    const finalSymlink = path.join(fx.root, 'final-symlink');
    fs.symlinkSync(realFinal, finalSymlink, 'dir');
    assertRejection(mod.openRootAccredited(finalSymlink), 'SYMLINK_REJECTED',
      'a symlinked final P must be rejected (O_NOFOLLOW, lexical before canonical)');
  } finally {
    fx.dispose();
  }
});

test('PATH-ACCREDIT-11: on darwin a raw /tmp path is SYMLINK_REJECTED while its /private/tmp real path accredits (PLAN.md S8.2)', {
  skip: !addonExists()
    ? ADDON_ABSENT_SKIP_REASON
    : (process.platform === 'darwin' ? false : 'the raw /tmp symlink component is a darwin-specific S8.2 requirement'),
}, () => {
  const mod = require(ADDON_ENTRY_PATH);
  assert.ok(fs.lstatSync('/tmp').isSymbolicLink(), 'precondition: /tmp must be a symlink on this host');
  const real = fs.mkdtempSync('/private/tmp/r33-accredit-rawtmp-');
  try {
    fs.chmodSync(real, 0o700);
    const raw = real.replace(/^\/private/, ''); // the SAME directory, addressed through the symlink
    assert.ok(raw.startsWith('/tmp/'), 'precondition: the raw form must traverse the /tmp symlink');

    assertRejection(mod.openRootAccredited(raw), 'SYMLINK_REJECTED',
      'a raw /tmp/... path must be rejected: "It never silently turns a rejected path into an accepted one" (PLAN.md S8.2)');
    assertSuccess(mod.openRootAccredited(real),
      'the corresponding already-lexical /private/tmp/... real path must be accredited');
  } finally {
    fs.rmSync(real, { recursive: true, force: true });
  }
});

test('PATH-ACCREDIT-12: every S8.2 step-1 lexical class is rejected before any open, with one canonical code per class (PLAN.md S8.2, S3.1)', whenAddonExists(), () => {
  const mod = require(ADDON_ENTRY_PATH);
  const fx = accreditationFixture('r33-accredit-lexical-');
  try {
    fs.mkdirSync(fx.ancestor, { mode: 0o700 });
    const finalP = path.join(fx.ancestor, 'final-p');
    fs.mkdirSync(finalP, { mode: 0o700 });
    assertSuccess(mod.openRootAccredited(finalP), 'baseline: the well-formed lexical path accredits');

    // PATH-level structure: relative form and empty components. One canonical
    // code, because PLAN.md S8.2 step 1 rejects these as a single class.
    assertCanonicalRejectionFamily([
      ['relative', mod.openRootAccredited(path.relative('/', finalP))],
      ['empty', mod.openRootAccredited('')],
      ['bare-dot', mod.openRootAccredited(fx.ancestor + '/./final-p')],
      ['bare-dotdot', mod.openRootAccredited(fx.ancestor + '/../anc/final-p')],
      ['repeated-separator', mod.openRootAccredited(fx.ancestor + '//final-p')],
      ['trailing-separator', mod.openRootAccredited(finalP + '/')],
    ], ['PATH_INVALID', 'NAME_INVALID'], 'PATH-ACCREDIT-12 path-structure family');

    // COMPONENT-level grammar: PLAN.md S3.1 forbids NUL, slash, backslash, C0,
    // DEL and invalid UTF-8 inside a PathComponent -- also a single class.
    assertCanonicalRejectionFamily([
      ['backslash', mod.openRootAccredited(fx.ancestor + '\\final-p')],
      ['C0-control', mod.openRootAccredited(finalP + '\u0001')],
      ['DEL', mod.openRootAccredited(finalP + '\u007f')],
      ['NUL', mod.openRootAccredited(finalP + '\u0000suffix')],
      ['invalid-utf8-lone-surrogate', mod.openRootAccredited(finalP + '\ud800')],
    ], ['NAME_INVALID', 'PATH_INVALID'], 'PATH-ACCREDIT-12 component-grammar family');

    // Length classes (PLAN.md S3.1): BoundedPathString is 1..2,048 UTF-8
    // bytes, depth is <=256, each PathComponent is 1..255 UTF-8 bytes. Each
    // fixture below violates EXACTLY ONE of the three -- verified by explicit
    // preconditions -- so they are asserted per class instead of being
    // collapsed into one canonical code they need not share.
    const overLongTotal = '/' + new Array(30).fill('a'.repeat(100)).join('/');
    assert.ok(Buffer.byteLength(overLongTotal) > 2048, 'precondition: total length exceeds 2,048 bytes');
    assert.ok(overLongTotal.split('/').filter(Boolean).every((c) => c.length <= 255),
      'precondition: every component stays within the 255-byte component bound');
    assert.ok(overLongTotal.split('/').filter(Boolean).length <= 256, 'precondition: depth stays within 256');
    assertRejection(mod.openRootAccredited(overLongTotal), 'PATH_TOO_LONG',
      'PATH-ACCREDIT-12: total > 2,048 UTF-8 bytes, with no other bound violated');

    const overDeep = '/' + new Array(300).fill('d').join('/');
    assert.ok(Buffer.byteLength(overDeep) <= 2048, 'precondition: the deep path stays within the total byte bound');
    assertRejectionWithinCodes(mod.openRootAccredited(overDeep), ['PATH_INVALID', 'PATH_TOO_LONG', 'NAME_INVALID'],
      'PATH-ACCREDIT-12: depth > 256');

    const overLongComponent = path.join(fx.ancestor, 'c'.repeat(300));
    assert.ok(Buffer.byteLength(overLongComponent) <= 2048, 'precondition: only the COMPONENT bound is violated');
    assertRejectionWithinCodes(mod.openRootAccredited(overLongComponent), ['NAME_INVALID', 'PATH_TOO_LONG', 'PATH_INVALID'],
      'PATH-ACCREDIT-12: component > 255 UTF-8 bytes');

    // Nothing above may have created anything.
    assertNoEffectAtPath(overLongComponent, 'PATH-ACCREDIT-12 zero-write');
    assert.deepStrictEqual(fs.readdirSync(fx.ancestor).sort(), ['final-p'],
      'a lexical rejection sweep must leave the ancestor directory byte-identical');
  } finally {
    fx.dispose();
  }
});

// ===========================================================================
// SECTION 13 -- defect A1/A3 discriminating fault-injection harness.
//
// Compiles a disposable COPY of r33_native.c directly via `cc` (SECTION 7's
// existing technique for the scratch foreign-external fixture -- never
// node-gyp/build.cjs, and NEVER writing back into the repository). Every
// `#ifdef`-gated seam is behaviorally IDENTICAL to the original when its
// macro is undefined; the "positive control" tests in SECTIONS 14/15 prove
// that empirically, not just by inspection.
// ===========================================================================

const R33_NATIVE_SRC_REL = path.join('scripts', 'native', 'r33-provider', 'src', 'r33_native.c'); // Path-Manifest row 6
const R33_NATIVE_SRC_PATH = path.join(REPO_ROOT, R33_NATIVE_SRC_REL);

function r33NativeSourceExists() {
  return fs.existsSync(R33_NATIVE_SRC_PATH);
}

const R33_SOURCE_ABSENT_SKIP_REASON = 'scripts/native/r33-provider/src/r33_native.c (row 6) does not exist yet -- WP3-ABI dependency; this case is structured to un-skip and execute once it does';

function whenR33NativeSourceExists() {
  return { skip: r33NativeSourceExists() ? false : R33_SOURCE_ABSENT_SKIP_REASON };
}

/**
 * Rewrites `anchor` to `replacement` inside `sourceText`, but ONLY if `anchor`
 * matches EXACTLY ONCE. Fails loudly otherwise -- never silently a no-op --
 * so a future reshaping of these call sites cannot silently defuse the fault
 * (the harness would keep compiling the UNPATCHED call site and every
 * discriminating assertion below would then test nothing).
 */
function applyExactSeam(sourceText, anchor, replacement, label) {
  const count = sourceText.split(anchor).length - 1;
  assert.strictEqual(count, 1,
    'fault-injection seam "' + label + '" must match r33_native.c EXACTLY once, found ' + count
    + ' -- the harness is coupled to the CURRENT source shape and must be updated to match a reshaped call site');
  return sourceText.split(anchor).join(replacement);
}

// --- A1: r33_hkdf_sha256_32's internal scratch-buffer allocation (r33_native.c:296) ---
const R33_A1_HKDF_MALLOC_ANCHOR = '  buf = (unsigned char *)malloc(infolen + 1u);\n';
const R33_A1_HKDF_MALLOC_SEAM = [
  '#ifdef R33_TEST_FORCE_HKDF_MALLOC_FAIL',
  '  buf = NULL;',
  '#else',
  '  buf = (unsigned char *)malloc(infolen + 1u);',
  '#endif',
  '',
].join('\n');

// --- A3: r33_spawn_with_slots' ProcessHandle allocation, after a successful posix_spawn (r33_native.c:2520) ---
const R33_A3_HANDLE_ALLOC_ANCHOR = '  h = r33_handle_new(R33_PROCESS, -1);\n';
const R33_A3_HANDLE_ALLOC_SEAM = [
  '#ifdef R33_TEST_FORCE_PROCESS_HANDLE_ALLOC_FAIL',
  '  h = NULL;',
  '#else',
  '  h = r33_handle_new(R33_PROCESS, -1);',
  '#endif',
  '',
].join('\n');

// --- A3: r33_spawn_with_slots' external wrap/type-tagging (r33_native.c:2522-2523). Anchored
// together with the preceding `h->pid = pid;` line -- the wrap-failure text alone is NOT unique
// (r33_secret_wrap at r33_native.c:2810 contains the byte-identical line on its own). ---
const R33_A3_HANDLE_WRAP_ANCHOR = [
  '  h->pid = pid;',
  '  if (!r33_handle_wrap(env, h, &ext)) { r33_finalize(env, h, NULL); return R33_FAIL(C_SYSTEM_ERROR); }',
  '',
].join('\n');
const R33_A3_HANDLE_WRAP_SEAM = [
  '  h->pid = pid;',
  '#ifdef R33_TEST_FORCE_PROCESS_HANDLE_WRAP_FAIL',
  '  { r33_finalize(env, h, NULL); return R33_FAIL(C_SYSTEM_ERROR); }',
  '#else',
  '  if (!r33_handle_wrap(env, h, &ext)) { r33_finalize(env, h, NULL); return R33_FAIL(C_SYSTEM_ERROR); }',
  '#endif',
  '',
].join('\n');

// --- Test-only additive export (SECTION 14's known-answer fixture). Anchored on the
// EXACT R33_EXPORTS declaration -- inserts a new function immediately before it. Never
// registered unless R33_TEST_ENABLE_SECRET_FROM_BYTES is -D'd, so the PRODUCTION 45-export
// roster (built only from the unmodified repository source) is completely unaffected. ---
const R33_EXPORTS_TABLE_ANCHOR = 'static const r33_export_t R33_EXPORTS[45] = {';
const R33_TEST_EXPORT_FN_SEAM = [
  '#ifdef R33_TEST_ENABLE_SECRET_FROM_BYTES',
  '/*',
  ' * TEST-ONLY export. Compiled ONLY into the test-specialist disposable',
  ' * scratch fault-injection addon (r33-native-abi.test.js SECTION 13) --',
  ' * NEVER into the production artifact, which build.cjs/binding.gyp compile',
  ' * exclusively from the unmodified tracked repository source. Lets a',
  ' * known-answer test place a CHOSEN 32-byte value into an opaque',
  ' * SecretHandle without ever exposing raw key bytes through the closed',
  ' * production ABI (PLAN.md S2.1/S2.2).',
  ' */',
  'static napi_value r33_test_secret_from_bytes(napi_env env, napi_callback_info info) {',
  '  unsigned char *data = NULL;',
  '  size_t len = 0;',
  '  const char *code = C_SYSTEM_ERROR;',
  '  unsigned char bytes[32];',
  '  R33_ENTER(1, argv);',
  '  if (!r33_get_bytes(env, argv[0], &data, &len, &code)) return R33_FAIL(code);',
  '  if (len != 32u) return R33_FAIL(C_LENGTH_INVALID);',
  '  memcpy(bytes, data, 32u);',
  '  return r33_secret_wrap(env, bytes);',
  '}',
  '#endif',
  '',
  R33_EXPORTS_TABLE_ANCHOR,
].join('\n');

// --- Registration of the test-only export, inside r33_init's existing body. ---
const R33_INIT_TAIL_ANCHOR = [
  '  }',
  '  return exports;',
  '}',
  '',
  'NAPI_MODULE(NODE_GYP_MODULE_NAME, r33_init)',
].join('\n');
const R33_INIT_TAIL_SEAM = [
  '  }',
  '#ifdef R33_TEST_ENABLE_SECRET_FROM_BYTES',
  '  {',
  '    napi_value fn = NULL;',
  '    if (napi_create_function(env, "testSecretFromBytes", NAPI_AUTO_LENGTH,',
  '                             r33_test_secret_from_bytes, NULL, &fn) != napi_ok) {',
  '      return NULL;',
  '    }',
  '    if (napi_set_named_property(env, exports, "testSecretFromBytes", fn) != napi_ok) {',
  '      return NULL;',
  '    }',
  '  }',
  '#endif',
  '  return exports;',
  '}',
  '',
  'NAPI_MODULE(NODE_GYP_MODULE_NAME, r33_init)',
].join('\n');

/** Reads r33_native.c fresh and applies every seam. Never writes back to the repo file. */
function buildFaultInjectedSource() {
  let text = fs.readFileSync(R33_NATIVE_SRC_PATH, 'utf8');
  text = applyExactSeam(text, R33_A1_HKDF_MALLOC_ANCHOR, R33_A1_HKDF_MALLOC_SEAM, 'A1 hkdf malloc');
  text = applyExactSeam(text, R33_A3_HANDLE_ALLOC_ANCHOR, R33_A3_HANDLE_ALLOC_SEAM, 'A3 handle alloc');
  text = applyExactSeam(text, R33_A3_HANDLE_WRAP_ANCHOR, R33_A3_HANDLE_WRAP_SEAM, 'A3 handle wrap');
  text = applyExactSeam(text, R33_EXPORTS_TABLE_ANCHOR, R33_TEST_EXPORT_FN_SEAM, 'test-only export insertion point');
  text = applyExactSeam(text, R33_INIT_TAIL_ANCHOR, R33_INIT_TAIL_SEAM, 'module-init registration tail');
  return text;
}

/**
 * Compiles the patched source standalone (mirrors compileScratchForeignExternalAddon /
 * SECTION 7's technique) with `extraDefines` (bare macro names, no node-gyp/binding.gyp
 * involved). At most one R33_TEST_FORCE_* fault macro is ever passed per build.
 */
function compileR33NativeScratchAddon(scratchDir, extraDefines, basename) {
  const includeDir = findNodeApiIncludeDir(defaultNodeApiIncludeCandidates());
  assert.ok(includeDir !== null,
    'the r33_native.c scratch fault-injection harness needs node_api.h; searched: ' + defaultNodeApiIncludeCandidates().join(', '));
  const patchedSource = buildFaultInjectedSource();
  const sourcePath = path.join(scratchDir, basename + '.c');
  const addonPath = path.join(scratchDir, basename + '.node');
  fs.writeFileSync(sourcePath, patchedSource);
  const argv = ['-shared', '-fPIC', '-std=c11', '-O0', '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=' + basename]
    .concat((extraDefines || []).map((d) => '-D' + d));
  if (process.platform === 'darwin') argv.push('-undefined', 'dynamic_lookup');
  argv.push('-I', includeDir);
  if (process.platform === 'linux') argv.push('-lacl'); // matches binding.gyp's OS=="linux" libraries
  argv.push('-o', addonPath, sourcePath);
  const compiled = spawnSync('cc', argv, { encoding: 'utf8' });
  assert.strictEqual(compiled.status, 0,
    'the r33_native.c scratch fault-injection addon "' + basename + '" must compile.\n--- cc argv ---\n'
    + argv.join(' ') + '\n--- cc stderr ---\n' + (compiled.stderr || ''));
  return addonPath;
}

let R33_FAULT_SCRATCH_ROOT = null;
function r33FaultScratchRoot() {
  if (R33_FAULT_SCRATCH_ROOT !== null) return R33_FAULT_SCRATCH_ROOT;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-fault-')));
  process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_err) { /* best effort */ } });
  R33_FAULT_SCRATCH_ROOT = root;
  return root;
}

const R33_FAULT_ADDON_CACHE = {};
/**
 * Builds (and caches) ONE fault-scenario variant. `defineName` is `null` for
 * the instrumented BASELINE (no A1/A3 fault active -- used both as the KAT
 * fixture in SECTION 14 and as the positive control proving the seams are
 * inert), or one of the R33_TEST_FORCE_* macro names above for a fault variant.
 */
function r33FaultAddon(defineName) {
  const key = defineName || 'baseline';
  if (R33_FAULT_ADDON_CACHE[key]) return R33_FAULT_ADDON_CACHE[key];
  const root = r33FaultScratchRoot();
  const defines = ['R33_TEST_ENABLE_SECRET_FROM_BYTES'].concat(defineName ? [defineName] : []);
  const addonPath = compileR33NativeScratchAddon(root, defines, 'r33_fault_' + key);
  R33_FAULT_ADDON_CACHE[key] = { addonPath: addonPath };
  return R33_FAULT_ADDON_CACHE[key];
}

test('frozen vectors: every A1/A3 fault-injection seam anchor matches r33_native.c EXACTLY once today (fast, no compile)', whenR33NativeSourceExists(), () => {
  const text = fs.readFileSync(R33_NATIVE_SRC_PATH, 'utf8');
  for (const [label, anchor] of [
    ['A1 hkdf malloc', R33_A1_HKDF_MALLOC_ANCHOR],
    ['A3 handle alloc', R33_A3_HANDLE_ALLOC_ANCHOR],
    ['A3 handle wrap', R33_A3_HANDLE_WRAP_ANCHOR],
    ['test-export insertion point', R33_EXPORTS_TABLE_ANCHOR],
    ['module-init registration tail', R33_INIT_TAIL_ANCHOR],
  ]) {
    const count = text.split(anchor).length - 1;
    assert.strictEqual(count, 1, label + ' anchor must match r33_native.c exactly once today, found ' + count);
  }
  // Exercises the SAME assertions through the real patch path, not merely a
  // parallel check that could drift from what compileR33NativeScratchAddon
  // actually does.
  assert.strictEqual(typeof buildFaultInjectedSource(), 'string');
});

// ===========================================================================
// SECTION 14 -- defect A1 (HKDF fail-closed). PLAN.md S2.1/S2.2:
// r33_hkdf_sha256_32 must never silently succeed with a derived key that
// depends on an internal allocation it never actually performed.
// ===========================================================================

test('positive fixture + plausibility control: a known-answer HKDF-SHA256 derivation matches an independent JS reference, observed indirectly via hmacSha256 tags (PLAN.md S2.1: raw key bytes never cross the closed ABI; defect A1 context r33_native.c:288-308)', whenR33NativeSourceExists(), () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-a1-kat-')));
  try {
    const addonPath = r33FaultAddon(null).addonPath; // instrumented baseline, no A1/A3 fault macro active
    const ikm = crypto.randomBytes(32);
    const salt = crypto.randomBytes(32);
    const info = Buffer.from('r33-a1-kat-info-0123456789abcdef');
    const message = Buffer.from('r33-a1-kat-hmac-observation-message');

    const probeSource = [
      'const mod = require(' + JSON.stringify(addonPath) + ');',
      'const ikmSecret = mod.testSecretFromBytes(Buffer.from(' + JSON.stringify(ikm.toString('base64')) + ', "base64"));',
      'if (ikmSecret.ok !== true) { process.stdout.write(JSON.stringify({ setupFailed: "ikm", detail: ikmSecret })); process.exit(1); }',
      'const derived = mod.hkdfSha256(ikmSecret.value, Buffer.from(' + JSON.stringify(salt.toString('base64')) + ', "base64"), Buffer.from(' + JSON.stringify(info.toString('base64')) + ', "base64"));',
      'if (derived.ok !== true) { process.stdout.write(JSON.stringify({ setupFailed: "derive", detail: derived })); process.exit(1); }',
      'const tag = mod.hmacSha256(derived.value, Buffer.from(' + JSON.stringify(message.toString('base64')) + ', "base64"));',
      'if (tag.ok !== true) { process.stdout.write(JSON.stringify({ setupFailed: "hmac", detail: tag })); process.exit(1); }',
      'process.stdout.write(JSON.stringify({ tagHex: Buffer.from(tag.value).toString("hex") }));',
    ].join('\n');
    const probe = runChildProbe(probeSource, { cwd: scratch });
    assertProbeExitedCleanly(probe, 'A1 KAT probe');
    assert.strictEqual(probe.json.setupFailed, undefined, 'KAT fixture setup must succeed: ' + JSON.stringify(probe.json));

    // Independent JS reference for the SAME formula as r33_hkdf_sha256_32:
    // PRK = HMAC-SHA256(salt, IKM); OKM = HMAC-SHA256(PRK, info || 0x01).
    const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
    const okm = crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([0x01])])).digest();
    const expectedTag = crypto.createHmac('sha256', okm).update(message).digest('hex');

    assert.strictEqual(probe.json.tagHex, expectedTag,
      'the addon-derived HKDF output must match an INDEPENDENT reference computation over the same known IKM/salt/info');

    // PLAUSIBILITY CONTROL: prove this instrument can actually tell zero-key
    // apart from a real derivation -- otherwise a silent all-zero-key defect
    // (exactly the A1 failure mode) could coincidentally read as a pass.
    const allZeroKey = Buffer.alloc(32, 0);
    const zeroKeyTag = crypto.createHmac('sha256', allZeroKey).update(message).digest('hex');
    assert.notStrictEqual(expectedTag, zeroKeyTag,
      'precondition: the reference derivation and the all-zero-key tag must differ, or this control proves nothing');
    assert.notStrictEqual(probe.json.tagHex, zeroKeyTag,
      'plausibility control: the real addon output must be distinguishable from an all-zero-key derivation');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('R33-A1-DISCRIMINATING: a scratch build whose HKDF internal allocation is forced to fail must NOT return ok:true, and must NOT yield a SecretHandle derived from the all-zero fallback key (defect A1, r33_native.c:288-308 r33_hkdf_sha256_32)', whenR33NativeSourceExists(), () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-a1-fault-')));
  try {
    const faultedPath = r33FaultAddon('R33_TEST_FORCE_HKDF_MALLOC_FAIL').addonPath;
    const message = Buffer.from('r33-a1-fault-observation-message');

    const probeSource = [
      'const mod = require(' + JSON.stringify(faultedPath) + ');',
      'const secret = mod.secretRandom32();',
      'if (secret.ok !== true) { process.stdout.write(JSON.stringify({ setupFailed: "secret", detail: secret })); process.exit(1); }',
      'const salt = Buffer.alloc(32, 7);',
      'const info = Buffer.from("r33-a1-fault-info");',
      'const derived = mod.hkdfSha256(secret.value, salt, info);',
      'let tagHex = null;',
      'if (derived.ok === true) {',
      '  const tag = mod.hmacSha256(derived.value, Buffer.from(' + JSON.stringify(message.toString('base64')) + ', "base64"));',
      '  tagHex = tag.ok === true ? Buffer.from(tag.value).toString("hex") : null;',
      '}',
      'process.stdout.write(JSON.stringify({ derived: derived, tagHex: tagHex }));',
    ].join('\n');
    const probe = runChildProbe(probeSource, { cwd: scratch });
    assertProbeExitedCleanly(probe, 'A1 fault probe');
    assert.strictEqual(probe.json.setupFailed, undefined, 'fault fixture setup must succeed: ' + JSON.stringify(probe.json));

    // THE DISCRIMINATING ASSERTION. Today r33_hkdf_sha256_32 swallows the
    // forced malloc failure, fills its output with 32 zero bytes, and the
    // caller (r33_hkdf_sha256) has no way to see that and wraps it as a
    // normal SecretHandle -- so this is RED now.
    assertRejection(probe.json.derived, 'SYSTEM_ERROR',
      'hkdfSha256 must fail closed when its internal derivation cannot allocate scratch memory (PLAN.md S2.1)');

    // Belt-and-braces: even if some future regression reopened this as
    // ok:true, the derived key must never be the all-zero fallback.
    if (probe.json.derived.ok === true) {
      const allZeroKey = Buffer.alloc(32, 0);
      const zeroKeyTag = crypto.createHmac('sha256', allZeroKey).update(message).digest('hex');
      assert.notStrictEqual(probe.json.tagHex, zeroKeyTag,
        'a SecretHandle derived from the all-zero fallback key must never be returned as a success (PLAN.md S2.1 fail-closed)');
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('positive control: the SAME patched source with the A1 fault macro UNDEFINED derives normally (proves the fault seam itself is inert)', whenR33NativeSourceExists(), () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-a1-control-')));
  try {
    const baselinePath = r33FaultAddon(null).addonPath;
    const probeSource = [
      'const mod = require(' + JSON.stringify(baselinePath) + ');',
      'const secret = mod.secretRandom32();',
      'const derived = mod.hkdfSha256(secret.value, Buffer.alloc(32, 7), Buffer.from("r33-a1-control-info"));',
      'process.stdout.write(JSON.stringify({ secretOk: secret.ok, derivedOk: derived.ok, derivedCode: derived.code }));',
    ].join('\n');
    const probe = runChildProbe(probeSource, { cwd: scratch });
    assertProbeExitedCleanly(probe, 'A1 positive-control probe');
    assert.strictEqual(probe.json.secretOk, true);
    assert.strictEqual(probe.json.derivedOk, true, 'with the fault macro undefined, hkdfSha256 must succeed normally');
    assert.strictEqual(probe.json.derivedCode, 'OK');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ===========================================================================
// SECTION 15 -- defect A3 (ProcessHandle post-spawn cleanup). PLAN.md
// S7.1/S7.2: a successfully spawned OS child must never be left alive and
// unreaped when spawnWithSlots reports failure.
// ===========================================================================

function psSnapshotAll() {
  const res = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,stat='], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, 'ps -A -o pid=,ppid=,stat= must succeed on this host for the reap-proof instrument to mean anything.\n' + (res.stderr || ''));
  return res.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/\s+/);
    return { pid: Number(parts[0]), ppid: Number(parts[1]), stat: parts[2] || '' };
  });
}

function findPsRow(pid) {
  return psSnapshotAll().find((row) => row.pid === pid) || null;
}

test('positive fixture + negative control: the OS process-presence probe (findPsRow) distinguishes a LIVE pid from an ALREADY-REAPED one', () => {
  // Positive: this very test process is unambiguously alive.
  const self = findPsRow(process.pid);
  assert.ok(self !== null, 'findPsRow must find THIS running process -- otherwise the probe cannot detect presence at all');
  assert.strictEqual(self.pid, process.pid);

  // Negative control: a child already reaped by spawnSync must be ABSENT --
  // otherwise "the pid is gone" below could never be proven, only asserted.
  const reaped = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
  assert.strictEqual(reaped.status, 0);
  assert.ok(Number.isInteger(reaped.pid) && reaped.pid > 0, 'spawnSync must report the real child pid');
  assert.strictEqual(findPsRow(reaped.pid), null,
    'a child already reaped by spawnSync must be ABSENT from ps -- otherwise reap-proof would be unfalsifiable');
});

const R33_IDLE_CHILD_SCRIPT = [
  "'use strict';",
  '// Scratch fault-injection fixture (test-specialist, defect A3). Idles',
  '// until killed; discovered by the outer test via ps(1), never via its own',
  '// output (stdout/stderr are redirected to the fixed diagnostic FileHandle',
  '// per PLAN.md S7.1 slots 1/2).',
  'setInterval(() => {}, 3600000);',
  '',
].join('\n');

/**
 * Spawns ONE idle child through spawnWithSlots and reports the native result
 * plus a ps(1) snapshot of the PROBE's OWN children, taken immediately after
 * spawnWithSlots returns. The probe process is the real OS parent of any
 * spawned child at that point, and a synchronous native call cannot return to
 * JS until any kill+reap it performs internally has completed -- so this one
 * post-call snapshot already reflects the post-cleanup state, with no timing
 * race against the fix.
 */
function r33ProcessFaultProbeSource(addonPath, scratchDir, childScriptPath) {
  return [
    'const mod = require(' + JSON.stringify(addonPath) + ');',
    'const cp = require("node:child_process");',
    'const scratchDir = ' + JSON.stringify(scratchDir) + ';',
    'function must(r, what) {',
    '  if (!r || r.ok !== true) { process.stdout.write(JSON.stringify({ setupFailed: what, detail: r })); process.exit(1); }',
    '  return r.value;',
    '}',
    'const dir = must(mod.openRootAccredited(scratchDir), "dir");',
    'const secondDir = must(mod.openRootAccredited(scratchDir), "secondDir");',
    'const adminPair = must(mod.makeSocketpairStream(), "adminPair");',
    'const lifetimePipe = must(mod.makePipe(), "lifetimePipe");',
    'const keyPipe = must(mod.makePipe(), "keyPipe");',
    'const stderrFile = must(mod.createFileExclusiveRW(dir, "child-stderr"), "stderrFile");',
    'const slots = { 3: dir, 4: secondDir, 5: adminPair.second, 6: lifetimePipe.read, 7: keyPipe.read };',
    'const argv = [process.execPath, ' + JSON.stringify(childScriptPath) + '];',
    'const env = { NODE_ENV: "production", R33_PROVIDER_CHILD: "1" };',
    'const result = mod.spawnWithSlots(process.execPath, argv, dir, env, slots, stderrFile);',
    'function psRows() {',
    '  const out = cp.execFileSync("ps", ["-A", "-o", "pid=,ppid=,stat="], { encoding: "utf8" });',
    '  return out.split("\\n").map((l) => l.trim()).filter(Boolean).map((l) => {',
    '    const parts = l.split(/\\s+/);',
    '    return { pid: Number(parts[0]), ppid: Number(parts[1]), stat: parts[2] || "" };',
    '  });',
    '}',
    'const mine = psRows().filter((p) => p.ppid === process.pid);',
    '// Defensive cleanup: if a ProcessHandle WAS returned, this probe must not',
    '// itself leak it, regardless of what the discriminating assertion finds.',
    'if (result.ok === true && result.value) {',
    '  try { mod.terminateOwnedProcess(result.value, "SIGKILL"); } catch (_e) { /* best effort */ }',
    '  try { mod.waitOwnedProcess(result.value, false); } catch (_e) { /* best effort */ }',
    '}',
    'process.stdout.write(JSON.stringify({ result: result, myPid: process.pid, childrenRightAfterSpawn: mine }));',
  ].join('\n');
}

function runProcessHandleFaultCase(defineName, label) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-a3-' + label.toLowerCase() + '-')));
  let sentinel = null;
  let leakedPids = [];
  try {
    const faultedPath = r33FaultAddon(defineName).addonPath;
    const childScriptPath = path.join(scratch, 'idle-child.js');
    fs.writeFileSync(childScriptPath, R33_IDLE_CHILD_SCRIPT);

    // An UNRELATED sentinel process this test owns -- proves whatever
    // cleanup the eventual fix performs is scoped to the faulted spawn, not
    // some overly broad "kill everything" hack.
    sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 3600000);'], { stdio: 'ignore' });
    assert.ok(Number.isInteger(sentinel.pid) && sentinel.pid > 0, 'the sentinel process must report a real pid');
    assert.ok(findPsRow(sentinel.pid) !== null, 'precondition: the sentinel must be observably alive before the fault case runs');

    const probe = runChildProbe(r33ProcessFaultProbeSource(faultedPath, scratch, childScriptPath), { cwd: scratch });
    assertProbeExitedCleanly(probe, label + ' probe');
    assert.strictEqual(probe.json.setupFailed, undefined, label + ' fixture setup must succeed: ' + JSON.stringify(probe.json));

    // The native call already reports a closed failure correctly today --
    // that part of A3 is not the bug.
    assertRejection(probe.json.result, 'SYSTEM_ERROR',
      label + ': spawnWithSlots must report a closed SYSTEM_ERROR once the fault fires (this part already works today)');

    const children = probe.json.childrenRightAfterSpawn;
    assert.ok(Array.isArray(children), label + ': the probe must report its own ps-derived child list');
    leakedPids = children.map((c) => c.pid);

    // THE DISCRIMINATING ASSERTION. Today neither fault branch kills or reaps
    // the child posix_spawn already created -- r33_handle_close only ever
    // closes an fd, never a pid (PLAN.md S7.1/S7.2). RED now: `children` is
    // non-empty, one live/sleeping grandchild the probe just spawned.
    assert.deepStrictEqual(children, [],
      label + ': the successfully-spawned OS child must be terminated AND reaped before spawnWithSlots returns failure -- found '
      + JSON.stringify(children) + ' (native result: ' + JSON.stringify(probe.json.result) + ')');

    // The sentinel must be untouched by whatever the eventual fix does.
    assert.ok(findPsRow(sentinel.pid) !== null, label + ': an UNRELATED process this test owns must still be alive');
  } finally {
    for (const pid of leakedPids) { try { process.kill(pid, 'SIGKILL'); } catch (_err) { /* best effort: may already be gone */ } }
    if (sentinel !== null) { try { sentinel.kill('SIGKILL'); } catch (_err) { /* best effort */ } }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test('R33-A3-ALLOC-DISCRIMINATING: a scratch build whose ProcessHandle allocation is forced to fail AFTER a successful spawn must terminate+reap the child, and must not touch an unrelated process (defect A3, r33_native.c ~2520-2521)', whenR33NativeSourceExists(), () => {
  runProcessHandleFaultCase('R33_TEST_FORCE_PROCESS_HANDLE_ALLOC_FAIL', 'R33-A3-ALLOC');
});

test('R33-A3-WRAP-DISCRIMINATING: a scratch build whose external wrap/type-tagging is forced to fail AFTER a successful spawn must terminate+reap the child, and must not touch an unrelated process (defect A3, r33_native.c ~2522-2523)', whenR33NativeSourceExists(), () => {
  runProcessHandleFaultCase('R33_TEST_FORCE_PROCESS_HANDLE_WRAP_FAIL', 'R33-A3-WRAP');
});

test('positive control: the SAME patched source with BOTH A3 fault macros UNDEFINED spawns a real ProcessHandle normally, and its own teardown leaves no lingering child (proves the seams are inert)', whenR33NativeSourceExists(), () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-a3-control-')));
  try {
    const baselinePath = r33FaultAddon(null).addonPath;
    const childScriptPath = path.join(scratch, 'idle-child.js');
    fs.writeFileSync(childScriptPath, R33_IDLE_CHILD_SCRIPT);
    const probe = runChildProbe(r33ProcessFaultProbeSource(baselinePath, scratch, childScriptPath), { cwd: scratch });
    assertProbeExitedCleanly(probe, 'A3 positive-control probe');
    assert.strictEqual(probe.json.setupFailed, undefined, 'fixture setup must succeed: ' + JSON.stringify(probe.json));
    assert.strictEqual(probe.json.result.ok, true, 'with both fault macros undefined, spawnWithSlots must succeed normally');
    assert.deepStrictEqual(probe.json.childrenRightAfterSpawn, [],
      'the successful path must also leave no lingering child once the probe explicitly tears it down via terminateOwnedProcess+waitOwnedProcess');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// First RED (PLAN.md S11.1). Exact sentinel name required by the eight-name
// RED set and by the ordered sub-DAG's WP3-RED exit evidence. Genuinely fails
// today because `scripts/native/r33-provider/index.js` (and its compiled
// `src/r33_native.c` addon, Path-Manifest row 6) does not exist yet -- honest
// first-RED absence, not an instrument defect.
// ---------------------------------------------------------------------------
test('R33-RED-ABI-ABSENT', () => {
  const mod = require(ADDON_ENTRY_PATH);
  assertExactModuleExportSurface(mod);

  const abi = mod.providerAbiInfo();
  assertSuccess(abi, 'providerAbiInfo()');
  assertNativeProviderAbiInfoV1(abi.value);

  const aritiesByName = EXPORT_NAMES_IN_ORDER.reduce((acc, name, i) => {
    acc[name] = abi.value.exact_arities[i];
    return acc;
  }, {});
  assertExactArityPairing(aritiesByName);
});
