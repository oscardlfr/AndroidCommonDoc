#!/usr/bin/env node
'use strict';

// WP3-RED first-RED sentinel + full LOAD-* matrix for the R33 native-provider
// LOADER surface. Frozen contract source: PLAN.md "Canonical R33
// Native-Provider Production Contract" S2.4 "ABI capability record", S9.1 "One
// source-build model", S9.2 "Toolchain lock", S9.3 "Closed build-input
// roster", S9.4 "Digest definitions", S9.5 "Sealed hash-to-compile and
// hash-to-load ordering", S9.6 "Loader outcomes". Path-Manifest row 14 (this
// file) targets row 7 `scripts/native/r33-provider/index.js` plus its sealed
// build inputs rows 1/2/3/5 -- all toolkit-specialist-owned, WP3-ABI, and
// absent as of this commit.
//
// SCOPE (test-specialist, WP3-RED): the currently-FAILING deliverable is the
// ONE named sentinel `R33-RED-LOADER-ABSENT` (PLAN.md S11.1's eight-name RED
// set). Every case needing the built package is `{skip}`-gated on the loader
// existing, so today it reports SKIPPED and the failing-name set stays exactly
// the sentinel.
//
// TWO PROPERTIES THIS FILE ENFORCES ON ITSELF:
//
// 1. FRESH PROCESSES. Every load-outcome case runs the loader in a child
//    process and asserts on its JSON stdout plus exit code. A shared
//    `require()` cache makes the second and later load-outcome cases in one
//    process meaningless, because the module object is returned from cache
//    without re-running a single loader check.
//
// 2. THE ORACLE IS NOT EVIDENCE. `fixtureOracle_classifyLoaderOutcome` below
//    is a local replica of the S9.6 decision table. It exists ONLY to shape
//    fixtures and to be mutation-tested itself. No LOAD-* case may derive its
//    verdict from it; the verdict always comes from the live loader. A static
//    guard test below enforces that separation.

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NATIVE_PACKAGE_REL = path.join('scripts', 'native', 'r33-provider');
const NATIVE_PACKAGE_DIR = path.join(REPO_ROOT, NATIVE_PACKAGE_REL);
const LOADER_PATH = path.join(NATIVE_PACKAGE_DIR, 'index.js'); // Path-Manifest row 7
const BUILD_DRIVER_PATH = path.join(NATIVE_PACKAGE_DIR, 'build.cjs'); // Path-Manifest row 5

function loaderExists() {
  return fs.existsSync(LOADER_PATH);
}

const LOADER_ABSENT_SKIP_REASON = 'scripts/native/r33-provider/index.js (row 7) does not exist yet -- WP3-ABI dependency; this case is structured to un-skip and execute once it does';

function whenLoaderExists() {
  return { skip: loaderExists() ? false : LOADER_ABSENT_SKIP_REASON };
}

// PLAN.md S9.3 -- `provider_source_digest` covers exactly these eleven
// repository-relative production/build inputs, in the PLAN's own order.
const PROVIDER_SOURCE_ROWS = [
  path.join(NATIVE_PACKAGE_REL, 'package.json'),
  path.join(NATIVE_PACKAGE_REL, 'package-lock.json'),
  path.join(NATIVE_PACKAGE_REL, 'toolchain-lock.json'),
  path.join(NATIVE_PACKAGE_REL, 'binding.gyp'),
  path.join(NATIVE_PACKAGE_REL, 'build.cjs'),
  path.join(NATIVE_PACKAGE_REL, 'src', 'r33_native.c'),
  path.join(NATIVE_PACKAGE_REL, 'index.js'),
  path.join('scripts', 'lib', 'runtime-consultation.cjs'),
  path.join('scripts', 'lib', 'runtime-r33-provider.cjs'),
  path.join('scripts', 'lib', 'runtime-r33-composition.cjs'),
  path.join('scripts', 'lib', 'runtime-r33-wire.cjs'),
];

// PLAN.md S2.1 `ExactNativeArityV1 [45]` and the S2.3 export roster.
const EXACT_NATIVE_ARITY_V1 = [
  0, 1, 2, 2, 2, 2, 3, 1, 3, 2, 1, 1, 1, 1, 1,
  1, 3, 5, 2, 1, 1, 2, 0, 0, 6, 1, 1, 1, 4, 4,
  1, 1, 2, 2, 0, 2, 1, 3, 2, 1, 1, 0, 1, 4, 3,
];

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

// PLAN.md S9.6 -- the closed loader-outcome codes (R2 bootstrap-carrier
// reconciliation, 2026-08-07): the eight BOOTSTRAP_* rows are pre-step-5
// carrier-accreditation outcomes (S2.5, S9.1, S9.5 steps 5-7 -- performed by
// the externally accredited carrier, never by a repository-path require() or
// process.dlopen); the four ADDON_*/PROVIDER_BUILD_DRIFT rows remain the
// post-accreditation addon-level outcomes this file's LOAD-* matrix targets.
// Both groups are included here because this file claims S9.6 as a whole for
// `assertLoaderRejected`'s validity/no-other-code strictness check, even
// though today's LOAD-* fixtures exercise only the addon-level four.
const LOADER_FAILURE_CODES = [
  'BOOTSTRAP_ABSENT', 'BOOTSTRAP_INSTALL_DRIFT', 'BOOTSTRAP_PROFILE_UNSUPPORTED',
  'BOOTSTRAP_INTERNAL_LOADER_ABI', 'BOOTSTRAP_LOAD_ERROR', 'BOOTSTRAP_ABI_MISMATCH',
  'BOOTSTRAP_CONTRACT_VIOLATION', 'BOOTSTRAP_BUILD_SUPERVISION',
  'ADDON_ABSENT', 'ADDON_LOAD_ERROR', 'ADDON_SYMBOL_MISMATCH', 'PROVIDER_BUILD_DRIFT',
];

// The Tier-2 fault-injection seam contract (frozen by the dispatching lead).
const SEAM_VERB = 'selftest-interpose';
const SEAM_SCHEMA = 'runtime/r33-native-selftest-interpose/v1';
const SEAM_FAULTS = ['SOURCE_MUTATE_AFTER_HASH', 'ARTIFACT_MUTATE_IN_QUARANTINE'];
const SEAM_TOKENS = [SEAM_VERB, SEAM_SCHEMA, 'selftestInterpose'];
const PRODUCTION_ENTRY_NAME = 'buildAndLoadVerified'; // PLAN.md S9.1

// ===========================================================================
// SECTION 1 -- closed-record oracles (always run, each with negative controls).
// ===========================================================================

const ABI_INFO_KEYS = [
  'schema', 'brand', 'provider_abi', 'napi_version', 'platform', 'architecture',
  'sockaddr_un_sun_path_bytes', 'hkdf_salt_bytes', 'hkdf_info_cap_bytes',
  'hkdf_output_bytes', 'hmac_message_cap_bytes', 'exact_arities',
  'compiled_source_digest',
].slice().sort();

function assertNativeProviderAbiInfoV1(value) {
  assert.ok(value !== null && typeof value === 'object', 'NativeProviderAbiInfoV1 must be a non-null object');
  assert.deepStrictEqual(Object.keys(value).slice().sort(), ABI_INFO_KEYS,
    'NativeProviderAbiInfoV1 must have EXACTLY these 13 keys (PLAN.md S2.4)');
  assert.strictEqual(value.schema, 'runtime/r33-native-provider-abi/v1');
  assert.strictEqual(value.brand, 'acd-transition-lock-posix');
  assert.strictEqual(value.provider_abi, 3);
  assert.strictEqual(value.napi_version, 8);
  assert.ok(['linux', 'darwin'].includes(value.platform), 'platform must be linux|darwin');
  assert.ok(['x64', 'arm64'].includes(value.architecture), 'architecture must be x64|arm64');
  assert.strictEqual(value.hkdf_salt_bytes, 32);
  assert.strictEqual(value.hkdf_info_cap_bytes, 1024);
  assert.strictEqual(value.hkdf_output_bytes, 32);
  assert.strictEqual(value.hmac_message_cap_bytes, 16842752);
  assert.deepStrictEqual(value.exact_arities, EXACT_NATIVE_ARITY_V1,
    'exact_arities must equal the frozen 45-entry ExactNativeArityV1 (PLAN.md S2.1)');
  assert.match(value.compiled_source_digest, /^[0-9a-f]{64}$/,
    'compiled_source_digest must be 64-lowercase-hex sha256');
  const expectedCap = value.platform === 'linux' ? 108 : 104;
  assert.strictEqual(value.sockaddr_un_sun_path_bytes, expectedCap,
    'sockaddr_un_sun_path_bytes must be exactly linux->108 / darwin->104 (PLAN.md S2.4)');
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

test('positive fixture: assertNativeProviderAbiInfoV1 accepts the exact frozen shape', () => {
  assertNativeProviderAbiInfoV1(fixtureAbiInfo());
  assertNativeProviderAbiInfoV1(fixtureAbiInfo({ platform: 'linux', architecture: 'x64', sockaddr_un_sun_path_bytes: 108 }));
});

test('negative control: assertNativeProviderAbiInfoV1 rejects a mutated hkdf_salt_bytes (32 -> 31)', () => {
  assert.throws(() => assertNativeProviderAbiInfoV1(fixtureAbiInfo({ hkdf_salt_bytes: 31 })), // mutated: watched property
    assert.AssertionError, 'validator must reject hkdf_salt_bytes != 32');
});

test('negative control: assertNativeProviderAbiInfoV1 rejects a truncated exact_arities (44 entries)', () => {
  assert.throws(() => assertNativeProviderAbiInfoV1(fixtureAbiInfo({ exact_arities: EXACT_NATIVE_ARITY_V1.slice(0, 44) })), // mutated: watched cardinality
    assert.AssertionError, 'validator must reject an exact_arities array shorter than 45');
});

test('negative control: assertNativeProviderAbiInfoV1 rejects a linux/104 cap mismatch', () => {
  assert.throws(() => assertNativeProviderAbiInfoV1(fixtureAbiInfo({ platform: 'linux', architecture: 'x64', sockaddr_un_sun_path_bytes: 104 })), // mutated: watched pairing
    assert.AssertionError, 'validator must reject the darwin cap paired with a linux platform');
});

// ---------------------------------------------------------------------------
// PLAN.md S9.2 -- the three closed toolchain records.
// ---------------------------------------------------------------------------

// PLAN.md S9.2 R33BootstrapProfileLockV2 [2] / R33BootstrapReleaseLockV2 [4] --
// added by the R2 bootstrap-carrier reconciliation, nested as toolchain-lock's
// new `bootstrap_release` field (below).
const BOOTSTRAP_PROFILE_LOCK_KEYS = ['carrier_sha256', 'internal_loader_abi_digest'].slice().sort();
const BOOTSTRAP_RELEASE_LOCK_KEYS = ['release_id', 'release_digest', 'bootstrap_abi_digest', 'profiles'].slice().sort();

// PLAN.md S9.2 R33ObservedBootstrapV2 [7] -- added by the same reconciliation,
// nested as build-toolchain's new `bootstrap` field (below). Distinct from the
// two records above: this one records what a SPECIFIC build observed, not the
// tracked lock.
const OBSERVED_BOOTSTRAP_KEYS = [
  'release_digest', 'receipt_digest', 'bootstrap_identity_digest', 'carrier_sha256',
  'bootstrap_abi_digest', 'internal_loader_abi_digest', 'mapped_carrier_identity_digest',
].slice().sort();

// PLAN.md S9.2 R33ToolchainLockV2 [11] (bumped from v1 -- adds bootstrap_release).
const TOOLCHAIN_LOCK_KEYS = [
  'schema', 'node_version', 'node_headers_url', 'node_headers_archive_sha256',
  'node_headers_tree_sha256', 'node_gyp_version', 'python_version',
  'napi_version', 'profiles', 'bootstrap_release', 'lock_digest',
].slice().sort();

const TOOLCHAIN_PROFILE_KEYS = [
  'platform', 'architecture', 'runner_image', 'c_family', 'c_version',
  'platform_sdk', 'system_packages', 'toolchain_selector', 'deployment_target',
  'toolchain_identity_sha256', 'build_flags',
].slice().sort();

// PLAN.md S9.2 R33BuildToolchainV2 [20] (bumped from v1 -- adds bootstrap).
const BUILD_TOOLCHAIN_KEYS = [
  'schema', 'lock_digest', 'profile_id', 'platform', 'architecture',
  'runner_image', 'c_family', 'c_version', 'platform_sdk', 'system_packages',
  'toolchain_selector', 'node_version', 'node_headers_archive_sha256',
  'node_headers_tree_sha256', 'node_gyp_version', 'python_version',
  'napi_version', 'toolchain_identity_sha256', 'build_flags_digest', 'bootstrap',
].slice().sort();

const CLOSED_PROFILE_IDS = ['linux-x64', 'linux-arm64', 'darwin-arm64'].slice().sort();

const LINUX_SYSTEM_PACKAGES = ['libacl1=2.3.2-1build1.1', 'libacl1-dev=2.3.2-1build1.1'];
const LINUX_PLATFORM_SDK = 'glibc-2.39/libacl-packages-2.3.2-1build1.1';
const DARWIN_PLATFORM_SDK = 'xcode-26.5-build-17F42/macos-sdk-26.5';
const LINUX_SELECTOR = { cc: '/usr/bin/clang-18', cxx: '/usr/bin/clang++-18' };
const DARWIN_SELECTOR = { developer_dir: '/Applications/Xcode_26.5.app/Contents/Developer' };
const BUILD_FLAGS = ['-std=c11', '-Wall', '-Wextra', '-Werror'];

/**
 * PLAN.md S9.2: "The profile cross-product is closed to these three rows... No
 * union member may be paired across rows." This asserts the WHOLE row, so a
 * darwin runner cannot appear beside a linux platform.
 */
function assertClosedProfileRow(row, profileId) {
  const label = 'profile ' + profileId;
  assert.ok(CLOSED_PROFILE_IDS.includes(profileId), label + ': profile id must be one of the closed three');
  if (profileId === 'darwin-arm64') {
    assert.strictEqual(row.platform, 'darwin', label + ': platform');
    assert.strictEqual(row.architecture, 'arm64', label + ': architecture');
    assert.strictEqual(row.runner_image, 'r33-macos-26-arm64-v1', label + ': runner_image');
    assert.strictEqual(row.c_family, 'apple-clang', label + ': c_family');
    assert.strictEqual(row.c_version, '21.0.0', label + ': c_version');
    assert.strictEqual(row.platform_sdk, DARWIN_PLATFORM_SDK, label + ': platform_sdk');
    assert.deepStrictEqual(row.system_packages, [], label + ': darwin carries system_packages=[]');
    assert.deepStrictEqual(row.toolchain_selector, DARWIN_SELECTOR, label + ': toolchain_selector must be the developer_dir form');
    return;
  }
  assert.strictEqual(row.platform, 'linux', label + ': platform');
  assert.strictEqual(row.architecture, profileId === 'linux-x64' ? 'x64' : 'arm64', label + ': architecture');
  assert.strictEqual(row.runner_image, profileId === 'linux-x64' ? 'r33-ubuntu-24.04-x64-v1' : 'r33-ubuntu-24.04-arm64-v1', label + ': runner_image');
  assert.strictEqual(row.c_family, 'llvm', label + ': c_family');
  assert.strictEqual(row.c_version, '18.1.3', label + ': c_version');
  assert.strictEqual(row.platform_sdk, LINUX_PLATFORM_SDK, label + ': platform_sdk');
  assert.deepStrictEqual(row.system_packages, LINUX_SYSTEM_PACKAGES, label + ': exact two-element libacl pair');
  assert.deepStrictEqual(row.toolchain_selector, LINUX_SELECTOR, label + ': toolchain_selector must be the cc/cxx form');
}

function assertR33ToolchainProfileV2(row, profileId) {
  assert.ok(row !== null && typeof row === 'object', 'R33ToolchainProfileV2 must be a non-null object');
  assert.deepStrictEqual(Object.keys(row).slice().sort(), TOOLCHAIN_PROFILE_KEYS,
    'R33ToolchainProfileV2 must have EXACTLY these 11 keys (PLAN.md S9.2)');
  assertClosedProfileRow(row, profileId);
  assert.strictEqual(row.deployment_target, profileId === 'darwin-arm64' ? '11.0' : null,
    'profile ' + profileId + ': deployment_target is "11.0" on darwin and null on linux');
  assert.deepStrictEqual(row.build_flags, BUILD_FLAGS,
    'profile ' + profileId + ': build_flags must be the exact frozen four-element vector');
  assert.match(row.toolchain_identity_sha256, /^[0-9a-f]{64}$/, 'profile ' + profileId + ': toolchain_identity_sha256');
}

function assertR33BootstrapProfileLockV2(value, profileId) {
  assert.ok(value !== null && typeof value === 'object', 'R33BootstrapProfileLockV2 must be a non-null object');
  assert.deepStrictEqual(Object.keys(value).slice().sort(), BOOTSTRAP_PROFILE_LOCK_KEYS,
    'R33BootstrapProfileLockV2 must have EXACTLY these 2 keys (PLAN.md S9.2), profile ' + profileId);
  assert.match(value.carrier_sha256, /^[0-9a-f]{64}$/, 'profile ' + profileId + ': carrier_sha256 must be 64-lowercase-hex');
  assert.match(value.internal_loader_abi_digest, /^[0-9a-f]{64}$/, 'profile ' + profileId + ': internal_loader_abi_digest must be 64-lowercase-hex');
}

function assertR33BootstrapReleaseLockV2(value) {
  assert.ok(value !== null && typeof value === 'object', 'R33BootstrapReleaseLockV2 must be a non-null object');
  assert.deepStrictEqual(Object.keys(value).slice().sort(), BOOTSTRAP_RELEASE_LOCK_KEYS,
    'R33BootstrapReleaseLockV2 must have EXACTLY these 4 keys (PLAN.md S9.2)');
  assert.strictEqual(value.release_id, 'androidcommondoc-r33-bootstrap/v2');
  assert.match(value.release_digest, /^[0-9a-f]{64}$/, 'release_digest must be 64-lowercase-hex');
  assert.match(value.bootstrap_abi_digest, /^[0-9a-f]{64}$/, 'bootstrap_abi_digest must be 64-lowercase-hex');
  assert.ok(value.profiles !== null && typeof value.profiles === 'object', 'bootstrap_release.profiles must be a non-null object');
  assert.deepStrictEqual(Object.keys(value.profiles).slice().sort(), CLOSED_PROFILE_IDS,
    'bootstrap_release.profiles must have EXACTLY the three closed rows (PLAN.md S9.2)');
  for (const profileId of Object.keys(value.profiles)) {
    assertR33BootstrapProfileLockV2(value.profiles[profileId], profileId);
  }
}

function assertR33ToolchainLockV2(value) {
  assert.ok(value !== null && typeof value === 'object', 'R33ToolchainLockV2 must be a non-null object');
  assert.deepStrictEqual(Object.keys(value).slice().sort(), TOOLCHAIN_LOCK_KEYS,
    'R33ToolchainLockV2 must have EXACTLY these 11 keys (PLAN.md S9.2)');
  assert.strictEqual(value.schema, 'runtime/r33-native-toolchain-lock/v2');
  assert.strictEqual(value.node_version, '26.0.0');
  assert.strictEqual(value.node_headers_url, 'https://nodejs.org/dist/v26.0.0/node-v26.0.0-headers.tar.gz');
  assert.match(value.node_headers_archive_sha256, /^[0-9a-f]{64}$/, 'node_headers_archive_sha256 must be real lowercase hex, not a wildcard');
  assert.match(value.node_headers_tree_sha256, /^[0-9a-f]{64}$/, 'node_headers_tree_sha256 must be real lowercase hex, not a wildcard');
  assert.strictEqual(value.node_gyp_version, '13.0.1');
  assert.strictEqual(value.python_version, '3.13.5');
  assert.strictEqual(value.napi_version, 8);
  assert.match(value.lock_digest, /^[0-9a-f]{64}$/, 'lock_digest must be 64-lowercase-hex');
  assert.ok(value.profiles !== null && typeof value.profiles === 'object', 'profiles must be a non-null object');
  assert.deepStrictEqual(Object.keys(value.profiles).slice().sort(), CLOSED_PROFILE_IDS,
    'profiles must have EXACTLY the three closed rows (PLAN.md S9.2)');
  for (const profileId of Object.keys(value.profiles)) {
    assertR33ToolchainProfileV2(value.profiles[profileId], profileId);
  }
  assertR33BootstrapReleaseLockV2(value.bootstrap_release);
}

function assertR33ObservedBootstrapV2(value) {
  assert.ok(value !== null && typeof value === 'object', 'R33ObservedBootstrapV2 must be a non-null object');
  assert.deepStrictEqual(Object.keys(value).slice().sort(), OBSERVED_BOOTSTRAP_KEYS,
    'R33ObservedBootstrapV2 must have EXACTLY these 7 keys (PLAN.md S9.2)');
  for (const digestKey of OBSERVED_BOOTSTRAP_KEYS) {
    assert.match(value[digestKey], /^[0-9a-f]{64}$/, digestKey + ' must be 64-lowercase-hex sha256');
  }
}

/**
 * PLAN.md S9.4: `R33BuildProvenanceV2.observed_toolchain` is an
 * `R33BuildToolchainV2 [20]` -- the OBSERVED build facts. It is NOT an
 * `R33ToolchainLockV2 [11]`: the lock is the tracked input, the build
 * toolchain is what the build actually saw.
 */
function assertR33BuildToolchainV2(value) {
  assert.ok(value !== null && typeof value === 'object', 'R33BuildToolchainV2 must be a non-null object');
  assert.deepStrictEqual(Object.keys(value).slice().sort(), BUILD_TOOLCHAIN_KEYS,
    'R33BuildToolchainV2 must have EXACTLY these 20 keys (PLAN.md S9.2) -- an 11-key R33ToolchainLockV2 here is the wrong record');
  assert.strictEqual(value.schema, 'runtime/r33-native-build-toolchain/v2',
    'observed_toolchain.schema must be the BUILD-TOOLCHAIN schema, not the toolchain-LOCK schema');
  assert.ok(CLOSED_PROFILE_IDS.includes(value.profile_id),
    'profile_id must be one of the exactly three closed selectors, got ' + JSON.stringify(value.profile_id));
  assertClosedProfileRow(value, value.profile_id);
  assert.strictEqual(value.node_version, '26.0.0');
  assert.strictEqual(value.node_gyp_version, '13.0.1');
  assert.strictEqual(value.python_version, '3.13.5');
  assert.strictEqual(value.napi_version, 8);
  for (const digestKey of ['lock_digest', 'node_headers_archive_sha256', 'node_headers_tree_sha256', 'toolchain_identity_sha256', 'build_flags_digest']) {
    assert.match(value[digestKey], /^[0-9a-f]{64}$/, digestKey + ' must be 64-lowercase-hex sha256');
  }
  assertR33ObservedBootstrapV2(value.bootstrap);
}

function fixtureToolchainProfile(profileId, overrides) {
  const darwin = profileId === 'darwin-arm64';
  return Object.assign({
    platform: darwin ? 'darwin' : 'linux',
    architecture: profileId === 'linux-x64' ? 'x64' : 'arm64',
    runner_image: darwin ? 'r33-macos-26-arm64-v1' : (profileId === 'linux-x64' ? 'r33-ubuntu-24.04-x64-v1' : 'r33-ubuntu-24.04-arm64-v1'),
    c_family: darwin ? 'apple-clang' : 'llvm',
    c_version: darwin ? '21.0.0' : '18.1.3',
    platform_sdk: darwin ? DARWIN_PLATFORM_SDK : LINUX_PLATFORM_SDK,
    system_packages: darwin ? [] : LINUX_SYSTEM_PACKAGES.slice(),
    toolchain_selector: darwin ? Object.assign({}, DARWIN_SELECTOR) : Object.assign({}, LINUX_SELECTOR),
    deployment_target: darwin ? '11.0' : null,
    toolchain_identity_sha256: '1'.repeat(64),
    build_flags: BUILD_FLAGS.slice(),
  }, overrides || {});
}

function fixtureBootstrapProfileLock() {
  return { carrier_sha256: '3'.repeat(64), internal_loader_abi_digest: '4'.repeat(64) };
}

function fixtureBootstrapReleaseLock(overrides) {
  return Object.assign({
    release_id: 'androidcommondoc-r33-bootstrap/v2',
    release_digest: '5'.repeat(64),
    bootstrap_abi_digest: '6'.repeat(64),
    profiles: {
      'linux-x64': fixtureBootstrapProfileLock(),
      'linux-arm64': fixtureBootstrapProfileLock(),
      'darwin-arm64': fixtureBootstrapProfileLock(),
    },
  }, overrides || {});
}

function fixtureObservedBootstrap(overrides) {
  return Object.assign({
    release_digest: '7'.repeat(64),
    receipt_digest: '8'.repeat(64),
    bootstrap_identity_digest: '9'.repeat(64),
    carrier_sha256: 'a1'.repeat(32),
    bootstrap_abi_digest: 'a2'.repeat(32),
    internal_loader_abi_digest: 'a3'.repeat(32),
    mapped_carrier_identity_digest: 'a4'.repeat(32),
  }, overrides || {});
}

function fixtureToolchainLock(overrides) {
  return Object.assign({
    schema: 'runtime/r33-native-toolchain-lock/v2',
    node_version: '26.0.0',
    node_headers_url: 'https://nodejs.org/dist/v26.0.0/node-v26.0.0-headers.tar.gz',
    node_headers_archive_sha256: 'a'.repeat(64),
    node_headers_tree_sha256: 'b'.repeat(64),
    node_gyp_version: '13.0.1',
    python_version: '3.13.5',
    napi_version: 8,
    profiles: {
      'linux-x64': fixtureToolchainProfile('linux-x64'),
      'linux-arm64': fixtureToolchainProfile('linux-arm64'),
      'darwin-arm64': fixtureToolchainProfile('darwin-arm64'),
    },
    bootstrap_release: fixtureBootstrapReleaseLock(),
    lock_digest: 'c'.repeat(64),
  }, overrides || {});
}

function fixtureBuildToolchain(profileId, overrides) {
  const profile = fixtureToolchainProfile(profileId);
  return Object.assign({
    schema: 'runtime/r33-native-build-toolchain/v2',
    lock_digest: 'c'.repeat(64),
    profile_id: profileId,
    platform: profile.platform,
    architecture: profile.architecture,
    runner_image: profile.runner_image,
    c_family: profile.c_family,
    c_version: profile.c_version,
    platform_sdk: profile.platform_sdk,
    system_packages: profile.system_packages,
    toolchain_selector: profile.toolchain_selector,
    node_version: '26.0.0',
    node_headers_archive_sha256: 'a'.repeat(64),
    node_headers_tree_sha256: 'b'.repeat(64),
    node_gyp_version: '13.0.1',
    python_version: '3.13.5',
    napi_version: 8,
    toolchain_identity_sha256: '1'.repeat(64),
    build_flags_digest: '2'.repeat(64),
    bootstrap: fixtureObservedBootstrap(),
  }, overrides || {});
}

test('positive fixture: assertR33ToolchainLockV2 accepts the exact frozen shape with all three fully-specified profile rows', () => {
  assertR33ToolchainLockV2(fixtureToolchainLock());
});

test('negative control: assertR33ToolchainLockV2 rejects an EMPTY profile row (the previous fixture stubbed profiles as {})', () => {
  assert.throws(() => assertR33ToolchainLockV2(fixtureToolchainLock({
    profiles: { 'linux-x64': {}, 'linux-arm64': {}, 'darwin-arm64': {} }, // mutated: watched profile contents
  })), assert.AssertionError,
  'a lock whose profile rows are empty objects MUST fail -- otherwise every R33ToolchainProfileV1 field is unvalidated');
});

test('negative control: assertR33ToolchainLockV2 rejects a fourth profile row and node_gyp_version drift', () => {
  const profiles = fixtureToolchainLock().profiles;
  profiles['darwin-x64'] = fixtureToolchainProfile('darwin-arm64'); // mutated: watched cardinality
  assert.throws(() => assertR33ToolchainLockV2(fixtureToolchainLock({ profiles })), assert.AssertionError);
  assert.throws(() => assertR33ToolchainLockV2(fixtureToolchainLock({ node_gyp_version: '13.0.2' })), // mutated: watched property
    assert.AssertionError, 'validator must reject a node-gyp version other than the pinned 13.0.1');
});

test('positive fixture: assertR33BuildToolchainV2 accepts each of the three closed profile rows', () => {
  for (const profileId of ['linux-x64', 'linux-arm64', 'darwin-arm64']) {
    assertR33BuildToolchainV2(fixtureBuildToolchain(profileId));
  }
});

test('negative control: assertR33BuildToolchainV2 rejects an R33ToolchainLockV2 supplied in its place', () => {
  assert.throws(() => assertR33BuildToolchainV2(fixtureToolchainLock()), assert.AssertionError, // mutated: watched record TYPE
    'an 11-key R33ToolchainLockV2 must NOT validate as the 20-key R33BuildToolchainV2 that observed_toolchain requires');
});

test('negative control: assertR33BuildToolchainV2 rejects every cross-row union pairing (PLAN.md S9.2 "No union member may be paired across rows")', () => {
  const crossPairings = [
    ['darwin runner on a linux profile', 'linux-x64', { runner_image: 'r33-macos-26-arm64-v1' }],
    ['apple-clang on a linux profile', 'linux-x64', { c_family: 'apple-clang' }],
    ['darwin c_version on a linux profile', 'linux-x64', { c_version: '21.0.0' }],
    ['darwin SDK on a linux profile', 'linux-x64', { platform_sdk: DARWIN_PLATFORM_SDK }],
    ['developer_dir selector on a linux profile', 'linux-x64', { toolchain_selector: Object.assign({}, DARWIN_SELECTOR) }],
    ['empty system_packages on a linux profile', 'linux-x64', { system_packages: [] }],
    ['x64 architecture on the linux-arm64 profile', 'linux-arm64', { architecture: 'x64' }],
    ['non-arm runner on the linux-arm64 profile', 'linux-arm64', { runner_image: 'r33-ubuntu-24.04-x64-v1' }],
    ['linux platform on the darwin profile', 'darwin-arm64', { platform: 'linux' }],
    ['llvm family on the darwin profile', 'darwin-arm64', { c_family: 'llvm' }],
    ['ubuntu runner on the darwin profile', 'darwin-arm64', { runner_image: 'r33-ubuntu-24.04-x64-v1' }],
    ['cc/cxx selector on the darwin profile', 'darwin-arm64', { toolchain_selector: Object.assign({}, LINUX_SELECTOR) }],
    ['libacl packages on the darwin profile', 'darwin-arm64', { system_packages: LINUX_SYSTEM_PACKAGES.slice() }],
  ];
  for (const [label, profileId, override] of crossPairings) {
    assert.throws(() => assertR33BuildToolchainV2(fixtureBuildToolchain(profileId, override)), // mutated: watched cross-product closure
      assert.AssertionError, 'validator must reject ' + label);
  }
  assert.throws(() => assertR33BuildToolchainV2(fixtureBuildToolchain('linux-x64', { profile_id: 'darwin-x64' })), // mutated: watched selector closure
    assert.AssertionError, 'validator must reject the non-existent darwin-x64 profile selector');
});

test('negative control: assertR33BuildToolchainV2 rejects a non-hex toolchain_identity_sha256 and build_flags_digest', () => {
  assert.throws(() => assertR33BuildToolchainV2(fixtureBuildToolchain('linux-x64', { toolchain_identity_sha256: 'not-a-digest' })), assert.AssertionError);
  assert.throws(() => assertR33BuildToolchainV2(fixtureBuildToolchain('linux-x64', { build_flags_digest: 'B'.repeat(64) })), // mutated: uppercase is not lowercase hex
    assert.AssertionError, 'digests must be 64-LOWERCASE-hex');
});

test('negative control: assertR33ToolchainProfileV2 rejects a mutated deployment_target and build_flags vector', () => {
  assert.throws(() => assertR33ToolchainProfileV2(fixtureToolchainProfile('darwin-arm64', { deployment_target: null }), 'darwin-arm64'), // mutated: watched property
    assert.AssertionError, 'darwin must carry deployment_target "11.0"');
  assert.throws(() => assertR33ToolchainProfileV2(fixtureToolchainProfile('linux-x64', { deployment_target: '11.0' }), 'linux-x64'), // mutated: watched property
    assert.AssertionError, 'linux must carry deployment_target null');
  assert.throws(() => assertR33ToolchainProfileV2(fixtureToolchainProfile('linux-x64', { build_flags: ['-std=c11', '-Wall', '-Wextra'] }), 'linux-x64'), // mutated: -Werror dropped
    assert.AssertionError, 'validator must reject a build_flags vector missing -Werror');
});

// ---------------------------------------------------------------------------
// PLAN.md S9.4 `R33BuildProvenanceV2 [8]` -- emitted r33-provenance.json
// (bumped from v1 -- adds bootstrap_identity_digest, binding every generation
// to the exact accredited carrier instance that produced it, R2 S1.6/S2.5).
// ---------------------------------------------------------------------------

const BUILD_PROVENANCE_KEYS = [
  'schema', 'build_generation_id', 'bootstrap_identity_digest', 'provider_source_digest',
  'provider_toolchain_digest', 'provider_artifact_digest',
  'provider_build_digest', 'observed_toolchain',
].slice().sort();

function assertR33BuildProvenanceV2(value) {
  assert.ok(value !== null && typeof value === 'object', 'R33BuildProvenanceV2 must be a non-null object');
  assert.deepStrictEqual(Object.keys(value).slice().sort(), BUILD_PROVENANCE_KEYS,
    'R33BuildProvenanceV2 must have EXACTLY these 8 keys (PLAN.md S9.4)');
  assert.strictEqual(value.schema, 'runtime/r33-native-build-provenance/v2');
  assert.match(value.build_generation_id, /^[0-9a-f]{64}$/,
    'build_generation_id must be 64-lowercase-hex (S9.5 LOWERCASE_HEX(32 fresh CSPRNG bytes))');
  for (const digestKey of ['bootstrap_identity_digest', 'provider_source_digest', 'provider_toolchain_digest', 'provider_artifact_digest', 'provider_build_digest']) {
    assert.match(value[digestKey], /^[0-9a-f]{64}$/, digestKey + ' must be 64-lowercase-hex sha256');
  }
  // The nested record is the OBSERVED 20-key build toolchain, not the lock.
  assertR33BuildToolchainV2(value.observed_toolchain);
  // PLAN.md S9.4: build_generation_id "is deliberately outside
  // provider_build_digest" -- a locator, never authority.
  assert.notStrictEqual(value.build_generation_id, value.provider_build_digest,
    'build_generation_id is a locator and must never be reused as the build identity');
}

function fixtureProvenance(overrides) {
  return Object.assign({
    schema: 'runtime/r33-native-build-provenance/v2',
    build_generation_id: 'd'.repeat(64),
    bootstrap_identity_digest: 'f'.repeat(64),
    provider_source_digest: 'a'.repeat(64),
    provider_toolchain_digest: 'b'.repeat(64),
    provider_artifact_digest: 'c'.repeat(64),
    provider_build_digest: 'e'.repeat(64),
    observed_toolchain: fixtureBuildToolchain('darwin-arm64'),
  }, overrides || {});
}

test('positive fixture: assertR33BuildProvenanceV2 accepts the exact frozen shape with a real 20-key observed_toolchain', () => {
  assertR33BuildProvenanceV2(fixtureProvenance());
});

test('negative control: assertR33BuildProvenanceV2 rejects an extra unlisted key and a missing key', () => {
  assert.throws(() => assertR33BuildProvenanceV2(fixtureProvenance({ extra_undeclared_field: 'nope' })), // mutated: watched closed-key set
    assert.AssertionError, 'validator must reject any key outside the closed 8-key set');
  const missing = fixtureProvenance();
  delete missing.provider_toolchain_digest; // mutated: watched cardinality
  assert.throws(() => assertR33BuildProvenanceV2(missing), assert.AssertionError);
});

test('negative control: assertR33BuildProvenanceV2 rejects observed_toolchain carrying the LOCK record (the defect this fixture used to encode)', () => {
  assert.throws(() => assertR33BuildProvenanceV2(fixtureProvenance({ observed_toolchain: fixtureToolchainLock() })), // mutated: watched nested record type
    assert.AssertionError,
    'observed_toolchain must be R33BuildToolchainV2 [20]; an R33ToolchainLockV2 [11] there must fail');
});

// ===========================================================================
// SECTION 2 -- PLAN.md S9.4 digest arithmetic, used to rebuild a CONSISTENT
// provenance record after a deliberate artifact mutation. Without this, a
// truncated artifact would be caught as digest drift and could never reach the
// ADDON_LOAD_ERROR row.
// ===========================================================================

function sha256Hex(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(Buffer.isBuffer(p) ? p : Buffer.from(p, 'utf8'));
  return h.digest('hex');
}

/** PLAN.md S3.1: `LP(x) = uint32_be(byte_length(x)) || x`. */
function lengthPrefixed(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([header, bytes]);
}

function hexDecode(hex) {
  assert.match(hex, /^[0-9a-f]+$/, 'hexDecode requires lowercase hex');
  return Buffer.from(hex, 'hex');
}

/** PLAN.md S9.4 `provider_build_digest` (bumped from v2 to v3 -- the R2
 * bootstrap-carrier reconciliation adds bootstrap_identity_digest as a fourth
 * LP-framed input, binding every build to the exact accredited carrier
 * instance that produced it). */
function providerBuildDigest(sourceDigest, toolchainDigest, artifactDigest, bootstrapIdentityDigest) {
  return sha256Hex(Buffer.concat([
    Buffer.from('runtime/r33/provider-build/v3', 'utf8'),
    Buffer.from([0x00]),
    lengthPrefixed(hexDecode(sourceDigest)),
    lengthPrefixed(hexDecode(toolchainDigest)),
    lengthPrefixed(hexDecode(artifactDigest)),
    lengthPrefixed(hexDecode(bootstrapIdentityDigest)),
  ]));
}

test('positive fixture: lengthPrefixed emits a big-endian uint32 length header', () => {
  assert.deepStrictEqual(lengthPrefixed(Buffer.alloc(0)), Buffer.from([0, 0, 0, 0]));
  assert.deepStrictEqual(lengthPrefixed(Buffer.from([0xaa])), Buffer.from([0, 0, 0, 1, 0xaa]));
  assert.strictEqual(lengthPrefixed(Buffer.alloc(258)).subarray(0, 4).toString('hex'), '00000102',
    'a 258-byte payload must be prefixed 00 00 01 02 (big-endian), never little-endian');
});

test('negative control: lengthPrefixed is not length-blind -- two different payloads of equal length differ, and the prefix tracks length', () => {
  assert.notDeepStrictEqual(lengthPrefixed(Buffer.from([1, 2])), lengthPrefixed(Buffer.from([1, 3]))); // mutated: watched payload
  assert.notDeepStrictEqual(lengthPrefixed(Buffer.alloc(1)).subarray(0, 4), lengthPrefixed(Buffer.alloc(2)).subarray(0, 4)); // mutated: watched length
});

test('positive fixture + negative control: providerBuildDigest is deterministic and changes when ANY of its four inputs changes', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const c = 'c'.repeat(64);
  const d = 'd'.repeat(64);
  const base = providerBuildDigest(a, b, c, d);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.strictEqual(providerBuildDigest(a, b, c, d), base, 'the digest must be deterministic for identical inputs');
  // One flipped nibble in each position, independently.
  assert.notStrictEqual(providerBuildDigest('b' + a.slice(1), b, c, d), base, 'source-digest change must change the build digest'); // mutated: watched input 1
  assert.notStrictEqual(providerBuildDigest(a, 'c' + b.slice(1), c, d), base, 'toolchain-digest change must change the build digest'); // mutated: watched input 2
  assert.notStrictEqual(providerBuildDigest(a, b, 'd' + c.slice(1), d), base, 'artifact-digest change must change the build digest'); // mutated: watched input 3
  assert.notStrictEqual(providerBuildDigest(a, b, c, 'a' + d.slice(1)), base, 'bootstrap-identity-digest change must change the build digest'); // mutated: watched input 4
  // Length-prefixing must prevent a concatenation collision between adjacent fields.
  assert.notStrictEqual(providerBuildDigest(a, b, c, d), providerBuildDigest(b, a, c, d),
    'the digest must be order-sensitive across its four length-prefixed fields');
});

// ===========================================================================
// SECTION 3 -- the S9.6 FIXTURE ORACLE.
//
// !!! NOT PRODUCTION EVIDENCE !!!
// This is a local replica of the PLAN.md S9.6 decision table. Its only
// legitimate uses are (a) shaping fixtures and (b) being mutation-tested
// itself. Every LOAD-* case derives its verdict from the LIVE loader through a
// child process; a static guard below enforces that separation.
// ===========================================================================

function fixtureOracle_classifyLoaderOutcome({ artifactPresent, loadable, symbolsExact, digestsMatch }) {
  if (!artifactPresent) return 'ADDON_ABSENT';
  if (!loadable) return 'ADDON_LOAD_ERROR';
  if (!symbolsExact) return 'ADDON_SYMBOL_MISMATCH';
  if (!digestsMatch) return 'PROVIDER_BUILD_DRIFT';
  return 'CONTINUE';
}

test('fixture oracle: fixtureOracle_classifyLoaderOutcome reproduces every PLAN.md S9.6 row in its documented precedence order', () => {
  assert.strictEqual(fixtureOracle_classifyLoaderOutcome({ artifactPresent: false, loadable: false, symbolsExact: false, digestsMatch: false }), 'ADDON_ABSENT');
  assert.strictEqual(fixtureOracle_classifyLoaderOutcome({ artifactPresent: true, loadable: false, symbolsExact: false, digestsMatch: false }), 'ADDON_LOAD_ERROR');
  assert.strictEqual(fixtureOracle_classifyLoaderOutcome({ artifactPresent: true, loadable: true, symbolsExact: false, digestsMatch: false }), 'ADDON_SYMBOL_MISMATCH');
  assert.strictEqual(fixtureOracle_classifyLoaderOutcome({ artifactPresent: true, loadable: true, symbolsExact: true, digestsMatch: false }), 'PROVIDER_BUILD_DRIFT');
  assert.strictEqual(fixtureOracle_classifyLoaderOutcome({ artifactPresent: true, loadable: true, symbolsExact: true, digestsMatch: true }), 'CONTINUE');
});

test('fixture oracle negative control: absence outranks a simultaneous load/symbol/digest fault, and symbol mismatch outranks digest drift', () => {
  assert.strictEqual(fixtureOracle_classifyLoaderOutcome({ artifactPresent: false, loadable: false, symbolsExact: true, digestsMatch: true }), 'ADDON_ABSENT'); // mutated: watched precedence
  assert.strictEqual(fixtureOracle_classifyLoaderOutcome({ artifactPresent: true, loadable: true, symbolsExact: false, digestsMatch: true }), 'ADDON_SYMBOL_MISMATCH'); // mutated: watched precedence
});

// ===========================================================================
// SECTION 4 -- the LIVE-loader observation instrument (fresh processes).
// ===========================================================================

function runProbe(source, options) {
  const opts = options || {};
  const res = spawnSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    cwd: opts.cwd || REPO_ROOT,
    env: Object.assign({}, process.env, opts.env || {}),
    timeout: opts.timeoutMs || 600000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return normalizeProbe(res);
}

function runCli(argv, options) {
  const opts = options || {};
  const res = spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    cwd: opts.cwd || REPO_ROOT,
    env: Object.assign({}, process.env, opts.env || {}),
    timeout: opts.timeoutMs || 600000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return normalizeProbe(res);
}

function normalizeProbe(res) {
  const stdout = res.stdout == null ? '' : res.stdout;
  const stderr = res.stderr == null ? '' : res.stderr;
  let json = null;
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length > 0) {
    try { json = JSON.parse(lines[lines.length - 1]); } catch (_err) { json = null; }
  }
  return { status: res.status, signal: res.signal, stdout, stderr, json };
}

/** A child probe that requires the loader and reports what happened, as JSON. */
function loaderProbeSource(loaderPath) {
  return [
    'const out = { loaded: false, outcome: null, diagnostic: null, exportCount: null, abi: null };',
    'try {',
    '  const mod = require(' + JSON.stringify(loaderPath) + ');',
    '  out.loaded = true;',
    '  out.exportCount = Reflect.ownKeys(mod).length;',
    '  const info = mod.providerAbiInfo();',
    '  out.abi = info && info.ok === true ? info.value : null;',
    '} catch (err) {',
    '  out.diagnostic = String((err && err.stack) || err);',
    '  out.outcome = String((err && err.code) || (err && err.outcome) || "");',
    '  process.stdout.write(JSON.stringify(out));',
    '  process.exit(1);',
    '}',
    'process.stdout.write(JSON.stringify(out));',
  ].join('\n');
}

/**
 * Asserts the live loader rejected with EXACTLY one S9.6 outcome code.
 * Deliberately shape-tolerant about HOW the loader reports the code (thrown
 * Error, `err.code`, structured diagnostic) but EXACT about WHICH code: the
 * whole captured diagnostic must contain the expected code and no other.
 */
function assertLoaderRejected(probe, expectedCode, label) {
  assert.ok(LOADER_FAILURE_CODES.includes(expectedCode), label + ': expectedCode must be an S9.6 failure row');
  assert.notStrictEqual(probe.status, 0,
    label + ': the loader MUST fail closed (nonzero exit). PLAN.md S9.6: "Mandatory CI never treats any UNAVAILABLE row as a pass".'
    + '\n--- stdout ---\n' + probe.stdout + '\n--- stderr ---\n' + probe.stderr);
  const diagnostic = probe.stdout + '\n' + probe.stderr;
  const present = LOADER_FAILURE_CODES.filter((code) => diagnostic.includes(code));
  assert.deepStrictEqual(present, [expectedCode],
    label + ': EXACTLY the ' + expectedCode + ' outcome must be reported, observed ' + JSON.stringify(present)
    + '\n--- diagnostic ---\n' + diagnostic);
}

function assertLoaderReady(probe, label) {
  assert.strictEqual(probe.signal, null, label + ': the loader probe must not be killed by a signal');
  assert.strictEqual(probe.status, 0,
    label + ': a verified sealed module must load cleanly.\n--- stderr ---\n' + probe.stderr);
  assert.ok(probe.json !== null, label + ': the probe must emit its JSON envelope.\n--- stdout ---\n' + probe.stdout);
  assert.strictEqual(probe.json.loaded, true, label + ': the module must have loaded');
  assert.strictEqual(probe.json.exportCount, 45, label + ': a READY module exposes exactly 45 own keys (PLAN.md S2.3)');
  assertNativeProviderAbiInfoV1(probe.json.abi);
}

test('positive fixture: assertLoaderRejected accepts a nonzero-exit diagnostic naming exactly one S9.6 code', () => {
  assertLoaderRejected({ status: 1, stdout: '', stderr: 'Error: PROVIDER_BUILD_DRIFT at step 5' }, 'PROVIDER_BUILD_DRIFT', 'fixture');
});

test('negative control: assertLoaderRejected fails on a CLEAN EXIT even when the diagnostic names the code', () => {
  assert.throws(() => assertLoaderRejected({ status: 0, stdout: 'PROVIDER_BUILD_DRIFT', stderr: '' }, 'PROVIDER_BUILD_DRIFT', 'fixture'), // mutated: watched fail-closed property
    assert.AssertionError, 'a loader that PRINTS the code but exits 0 has not failed closed');
});

test('negative control: assertLoaderRejected fails on the wrong code, on no code, and on an AMBIGUOUS multi-code diagnostic', () => {
  assert.throws(() => assertLoaderRejected({ status: 1, stdout: '', stderr: 'ADDON_ABSENT' }, 'ADDON_LOAD_ERROR', 'fixture'), // mutated: watched code
    assert.AssertionError, 'the wrong S9.6 row must fail');
  assert.throws(() => assertLoaderRejected({ status: 1, stdout: '', stderr: 'something broke' }, 'ADDON_LOAD_ERROR', 'fixture'), // mutated: watched code presence
    assert.AssertionError, 'a diagnostic naming no S9.6 row must fail');
  assert.throws(() => assertLoaderRejected({ status: 1, stdout: 'ADDON_LOAD_ERROR', stderr: 'PROVIDER_BUILD_DRIFT' }, 'ADDON_LOAD_ERROR', 'fixture'), // mutated: watched exactness
    assert.AssertionError, 'a diagnostic naming TWO S9.6 rows is ambiguous and must fail');
});

test('negative control: assertLoaderReady fails on a nonzero exit, a short export roster, and a malformed ABI record', () => {
  const good = { status: 0, signal: null, stdout: '{}', stderr: '', json: { loaded: true, exportCount: 45, abi: fixtureAbiInfo() } };
  assertLoaderReady(good, 'fixture'); // positive direction
  assert.throws(() => assertLoaderReady(Object.assign({}, good, { status: 1 }), 'fixture'), assert.AssertionError);
  assert.throws(() => assertLoaderReady(Object.assign({}, good, { json: { loaded: true, exportCount: 44, abi: fixtureAbiInfo() } }), 'fixture'), // mutated: watched roster size
    assert.AssertionError);
  assert.throws(() => assertLoaderReady(Object.assign({}, good, { json: { loaded: true, exportCount: 45, abi: fixtureAbiInfo({ provider_abi: 2 }) } }), 'fixture'), // mutated: watched ABI value
    assert.AssertionError);
});

test('separation guard: the live-loader instrument does not consult the fixture oracle', () => {
  // Mechanical, falsifiable proof of the "oracle is not evidence" rule: if
  // anyone routes a real verdict through the replica, this fails.
  for (const [name, fn] of [['assertLoaderRejected', assertLoaderRejected], ['assertLoaderReady', assertLoaderReady]]) {
    assert.ok(!String(fn).includes('fixtureOracle'),
      name + ' must derive its verdict from the LIVE loader, never from the local S9.6 replica');
  }
  assert.ok(String(fixtureOracle_classifyLoaderOutcome).length > 0, 'the oracle still exists for fixture shaping');
});

// ===========================================================================
// SECTION 5 -- TIER 1 fault injection: a disposable scratch copy of the whole
// native package, built for real, then mutated. No production seam at all.
//
// ROSTER PARTITION. PLAN.md S9.3's roster is the FINAL eleven rows. Three of
// them are later-unit deliverables and are legitimately absent until their
// work package lands; `build.cjs` reports exactly those as `pending_rows` in
// its result envelope. ONLY these three may ever be pending -- any other
// absent roster row is PROVIDER_BUILD_DRIFT, so it must fail loudly here
// rather than being silently skipped as an environment quirk.
// ===========================================================================

/**
 * PLAN.md S9.5 step 4 leaves the sealed artifact directory `0500` and both its
 * files `0444`, and step 3 drops source-only directories to `0500`. A plain
 * `fs.rmSync(..., {recursive:true, force:true})` cannot unlink inside a
 * non-writable directory and dies with ENOTEMPTY, so every disposal path in
 * this file restores owner write on each directory first.
 */
function removeScratchTree(root) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    try { fs.chmodSync(dir, 0o700); } catch (_err) { /* best effort */ }
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_err) { entries = []; }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(path.join(dir, entry.name));
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

test('positive fixture + negative control: removeScratchTree disposes a sealed-permission tree that a plain rmSync cannot', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-rmtree-')));
  const makeSealedShape = (root) => {
    const artifactDir = path.join(root, 'build', 'sealed', 'generation-x', 'artifact');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'r33_native.node'), 'x');
    fs.chmodSync(path.join(artifactDir, 'r33_native.node'), 0o444); // as S9.5 step 4 leaves it
    fs.chmodSync(artifactDir, 0o500);
    return artifactDir;
  };
  try {
    // Negative control: reproduce the exact ENOTEMPTY teardown failure.
    const doomed = path.join(base, 'plain');
    fs.mkdirSync(doomed);
    makeSealedShape(doomed);
    assert.throws(() => fs.rmSync(doomed, { recursive: true, force: true }), // mutated: watched 0500 sealed directory
      (err) => err.code === 'ENOTEMPTY' || err.code === 'EACCES' || err.code === 'EPERM',
      'precondition: a plain recursive rmSync must genuinely fail on a 0500 sealed directory');
    removeScratchTree(doomed);
    assert.strictEqual(fs.existsSync(doomed), false, 'removeScratchTree must succeed where plain rmSync failed');

    // Positive: an ordinary tree is removed just the same.
    const ordinary = path.join(base, 'ordinary');
    fs.mkdirSync(path.join(ordinary, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(ordinary, 'a', 'b', 'f'), 'y');
    removeScratchTree(ordinary);
    assert.strictEqual(fs.existsSync(ordinary), false);

    removeScratchTree(path.join(base, 'never-existed')); // absent root is a no-op, not a throw
  } finally {
    removeScratchTree(base);
  }
});

const PENDING_ROW_ALLOWLIST = [
  path.join('scripts', 'lib', 'runtime-r33-provider.cjs'),    // Path-Manifest row 8, WP3-WIRE
  path.join('scripts', 'lib', 'runtime-r33-composition.cjs'), // Path-Manifest row 9, WP3-COMPOSITION
  path.join('scripts', 'lib', 'runtime-r33-wire.cjs'),        // Path-Manifest row 10, WP3-WIRE
];

const BUILD_RESULT_SCHEMA = 'runtime/r33-native-build-result/v1';

/** Pure partition, so the allowlist rule is unit-testable without the repo. */
function partitionRoster(rows, existsFn) {
  const present = [];
  const pending = [];
  for (const rel of rows) {
    if (existsFn(rel)) present.push(rel); else pending.push(rel);
  }
  const unexpected = pending.filter((rel) => !PENDING_ROW_ALLOWLIST.includes(rel));
  assert.deepStrictEqual(unexpected, [],
    'ONLY the three later-unit roster rows may be absent. A missing ' + JSON.stringify(unexpected)
    + ' is PROVIDER_BUILD_DRIFT (PLAN.md S9.3: "an undeclared local import, extra native source,'
    + ' additional gyp target, or missing row is drift and fails closed"), not an environment quirk.');
  assert.strictEqual(present.length + pending.length, rows.length, 'the partition must be total');
  return { present, pending };
}

function partitionSourceRows() {
  return partitionRoster(PROVIDER_SOURCE_ROWS, (rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
}

test('positive fixture: partitionRoster accepts a fully-present roster and an allowlisted-only pending set', () => {
  const all = partitionRoster(PROVIDER_SOURCE_ROWS, () => true);
  assert.strictEqual(all.present.length, 11, 'the frozen roster is eleven rows (PLAN.md S9.3)');
  assert.deepStrictEqual(all.pending, [], 'nothing is pending when every row exists');

  const later = partitionRoster(PROVIDER_SOURCE_ROWS, (rel) => !PENDING_ROW_ALLOWLIST.includes(rel));
  assert.deepStrictEqual(later.pending.slice().sort(), PENDING_ROW_ALLOWLIST.slice().sort());
  assert.strictEqual(later.present.length, 8, 'the eight non-deferred rows remain present');
});

test('negative control: partitionRoster FAILS when any NON-allowlisted roster row is missing', () => {
  for (const victim of PROVIDER_SOURCE_ROWS.filter((r) => !PENDING_ROW_ALLOWLIST.includes(r))) {
    assert.throws(
      () => partitionRoster(PROVIDER_SOURCE_ROWS, (rel) => rel !== victim), // mutated: watched drift signal
      assert.AssertionError,
      'a missing ' + victim + ' is real drift and MUST fail -- treating any absent row as "pending" would hide it',
    );
  }
});

test('negative control: the pending allowlist is exactly the three later-unit rows, and every one is a real roster member', () => {
  assert.strictEqual(PENDING_ROW_ALLOWLIST.length, 3, 'exactly three rows may ever be pending');
  for (const rel of PENDING_ROW_ALLOWLIST) {
    assert.ok(PROVIDER_SOURCE_ROWS.includes(rel),
      rel + ' must be a member of the frozen S9.3 roster -- an allowlist entry outside it would be meaningless');
  }
  // The allowlist must not have quietly grown to cover a row that exists.
  const stillMissing = PENDING_ROW_ALLOWLIST.filter((rel) => !fs.existsSync(path.join(REPO_ROOT, rel)));
  const nowPresent = PENDING_ROW_ALLOWLIST.filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
  assert.strictEqual(stillMissing.length + nowPresent.length, 3);
});

let SHARED_SCRATCH = null;

function copyRepoInputsInto(scratchRoot) {
  // Copies only the roster rows that EXIST. PROVIDER_SOURCE_ROWS is the final
  // eleven-row roster; three of them are later-unit deliverables that the
  // build driver itself reports as `pending_rows`. Copying unconditionally
  // dies with ENOENT before a single loader property is exercised.
  const { present } = partitionSourceRows();
  for (const rel of present) {
    const from = path.join(REPO_ROOT, rel);
    const to = path.join(scratchRoot, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  return present;
}

/** Builds the scratch package once; later cases clone the BUILT tree. */
function sharedScratchBuild() {
  if (SHARED_SCRATCH !== null) return SHARED_SCRATCH;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-scratch-build-')));
  process.on('exit', () => { try { removeScratchTree(root); } catch (_err) { /* best effort */ } });
  const { present, pending } = partitionSourceRows();
  copyRepoInputsInto(root);
  const pkgDir = path.join(root, NATIVE_PACKAGE_REL);
  const built = runCli([path.join(pkgDir, 'build.cjs'), 'build-and-verify'], { cwd: pkgDir });
  assert.strictEqual(built.status, 0,
    'the disposable scratch build must succeed before any fault can be injected.\n--- stderr ---\n' + built.stderr);

  // Bind the driver's own view of the roster to this file's view, so the two
  // cannot silently diverge: if the driver ever starts sealing a different
  // set, this fails instead of the sweeps quietly shrinking.
  assert.ok(built.json !== null,
    'build-and-verify must print ONE JSON result envelope on stdout.\n--- stdout ---\n' + built.stdout);
  assert.strictEqual(built.json.schema, BUILD_RESULT_SCHEMA, 'unexpected build-result schema');
  assert.strictEqual(built.json.status, 'VERIFIED', 'a successful build must report status VERIFIED');
  assert.strictEqual(built.json.export_count, 45, 'a verified build must report exactly 45 exports (PLAN.md S2.3)');
  assert.deepStrictEqual((built.json.pending_rows || []).slice().sort(), pending.slice().sort(),
    'the driver-reported pending_rows must equal exactly the roster rows this file found absent');

  SHARED_SCRATCH = {
    root,
    pkgDir,
    presentRows: present,
    pendingRows: pending,
    sealed: locateSealedGeneration(pkgDir),
  };
  return SHARED_SCRATCH;
}

/** Clones the already-built scratch tree so each mutation is isolated. */
function cloneBuiltScratch(label) {
  const source = sharedScratchBuild();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-clone-' + label + '-')));
  fs.cpSync(source.root, root, { recursive: true, verbatimSymlinks: true });
  const pkgDir = path.join(root, NATIVE_PACKAGE_REL);
  return {
    root,
    pkgDir,
    loaderPath: path.join(pkgDir, 'index.js'),
    sealed: locateSealedGeneration(pkgDir),
    dispose() { removeScratchTree(root); },
  };
}

/** PLAN.md S9.5: exactly one `<pkg>/build/sealed/generation-<64-hex>`. */
function locateSealedGeneration(pkgDir) {
  const sealedRoot = path.join(pkgDir, 'build', 'sealed');
  const names = fs.readdirSync(sealedRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^generation-[0-9a-f]{64}$/.test(e.name))
    .map((e) => e.name);
  assert.strictEqual(names.length, 1,
    'PLAN.md S9.5 requires exactly one sealed generation directory, found ' + JSON.stringify(names));
  const generationDir = path.join(sealedRoot, names[0]);
  const artifactDir = path.join(generationDir, 'artifact');
  const artifacts = fs.readdirSync(artifactDir).filter((n) => /^r33_native\.[0-9a-f]{64}\.node$/.test(n));
  assert.strictEqual(artifacts.length, 1,
    'PLAN.md S9.5 step 4 requires exactly one digest-named artifact, found ' + JSON.stringify(artifacts));
  return {
    generationDir,
    treeDir: path.join(generationDir, 'tree'),
    artifactDir,
    artifactPath: path.join(artifactDir, artifacts[0]),
    provenancePath: path.join(artifactDir, 'r33-provenance.json'),
  };
}

/** The sealed artifact/provenance land 0444 in a 0500 directory (S9.5 step 4). */
function makeWritable(...targets) {
  for (const t of targets) fs.chmodSync(t, fs.statSync(t).isDirectory() ? 0o700 : 0o600);
}

function readProvenance(sealed) {
  return JSON.parse(fs.readFileSync(sealed.provenancePath, 'utf8'));
}

function writeProvenance(sealed, record) {
  makeWritable(sealed.artifactDir, sealed.provenancePath);
  fs.writeFileSync(sealed.provenancePath, JSON.stringify(record) + '\n');
}

/**
 * Replaces the sealed artifact with `bytes`, renames it to its NEW digest, and
 * rewrites provenance so every digest is self-consistent. The loader therefore
 * cannot reject on drift and must reach the S9.6 row under test.
 */
function replaceArtifactConsistently(sealed, bytes) {
  makeWritable(sealed.artifactDir, sealed.artifactPath, sealed.provenancePath);
  const digest = sha256Hex(bytes);
  const newPath = path.join(sealed.artifactDir, 'r33_native.' + digest + '.node');
  fs.rmSync(sealed.artifactPath);
  fs.writeFileSync(newPath, bytes);
  const provenance = readProvenance(sealed);
  provenance.provider_artifact_digest = digest;
  provenance.provider_build_digest = providerBuildDigest(
    provenance.provider_source_digest, provenance.provider_toolchain_digest, digest,
    provenance.bootstrap_identity_digest,
  );
  fs.writeFileSync(sealed.provenancePath, JSON.stringify(provenance) + '\n');
  sealed.artifactPath = newPath;
  return newPath;
}

// A scratch addon that is LOADABLE but exports the wrong symbol roster.
function wrongSymbolAddonSource(exportNames) {
  const literals = exportNames.map((n) => '"' + n + '"').join(', ');
  return [
    '#include <node_api.h>',
    'static napi_value r33_noop(napi_env env, napi_callback_info info) {',
    '  (void)info; napi_value u; napi_get_undefined(env, &u); return u;',
    '}',
    'static const char *r33_names[] = { ' + literals + ' };',
    'static napi_value r33_init(napi_env env, napi_value exports) {',
    '  for (size_t i = 0; i < sizeof(r33_names) / sizeof(r33_names[0]); ++i) {',
    '    napi_value fn;',
    '    if (napi_create_function(env, r33_names[i], NAPI_AUTO_LENGTH, r33_noop, NULL, &fn) != napi_ok) return NULL;',
    '    if (napi_set_named_property(env, exports, r33_names[i], fn) != napi_ok) return NULL;',
    '  }',
    '  return exports;',
    '}',
    'NAPI_MODULE(NODE_GYP_MODULE_NAME, r33_init)',
    '',
  ].join('\n');
}

function findNodeApiIncludeDir() {
  const candidates = [
    path.resolve(process.execPath, '..', '..', 'include', 'node'),
    path.resolve(process.execPath, '..', 'include', 'node'),
    path.join(os.homedir(), '.node-gyp', process.versions.node, 'include', 'node'),
    path.join(os.homedir(), 'Library', 'Caches', 'node-gyp', process.versions.node, 'include', 'node'),
  ];
  for (const dir of candidates) {
    try { if (fs.statSync(path.join(dir, 'node_api.h')).isFile()) return dir; } catch (_err) { /* skip */ }
  }
  assert.fail('node_api.h not found; searched ' + candidates.join(', '));
  return null;
}

function compileScratchAddon(scratchDir, source, basename) {
  const includeDir = findNodeApiIncludeDir();
  const sourcePath = path.join(scratchDir, basename + '.c');
  const addonPath = path.join(scratchDir, basename + '.node');
  fs.writeFileSync(sourcePath, source);
  const argv = ['-shared', '-fPIC', '-std=c11', '-O0', '-DNAPI_VERSION=8',
    '-DNODE_GYP_MODULE_NAME=' + basename, '-I', includeDir];
  if (process.platform === 'darwin') argv.push('-undefined', 'dynamic_lookup');
  argv.push('-o', addonPath, sourcePath);
  const compiled = spawnSync('cc', argv, { encoding: 'utf8' });
  assert.strictEqual(compiled.status, 0,
    'the scratch addon must compile.\n--- cc stderr ---\n' + (compiled.stderr || ''));
  return addonPath;
}

test('the wrong-symbol scratch addon compiles and exposes exactly the roster it was given (fixture self-proof)', () => {
  // RUNS TODAY. Without this, LOAD-SYMBOL-MISMATCH would rest on a fixture
  // nobody had shown could be built.
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-symfix-')));
  try {
    const roster = EXPORT_NAMES_IN_ORDER.slice(0, 44);
    const addonPath = compileScratchAddon(scratch, wrongSymbolAddonSource(roster), 'r33_scratch_wrongsym');
    const probe = runProbe(
      'const m = require(' + JSON.stringify(addonPath) + ');'
      + 'process.stdout.write(JSON.stringify({ keys: Reflect.ownKeys(m).length, hasLast: typeof m.receiveHandleBatch }));',
    );
    assert.strictEqual(probe.status, 0, 'the scratch addon must load.\n' + probe.stderr);
    assert.strictEqual(probe.json.keys, 44, 'the scratch addon must expose exactly the 44-name roster it was given');
    assert.strictEqual(probe.json.hasLast, 'undefined', 'the omitted 45th export must genuinely be absent');
  } finally {
    removeScratchTree(scratch);
  }
});

// ---------------------------------------------------------------------------
// LOAD-* against the live loader. All gated; all use fresh processes.
// ---------------------------------------------------------------------------

test('LOAD-READY: only a pre/post-identical sealed source+artifact identity loads, and it exposes the full verified ABI (PLAN.md S9.5 steps 5-7, S9.6)', whenLoaderExists(), () => {
  const clone = cloneBuiltScratch('ready');
  try {
    assertLoaderReady(runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir }), 'LOAD-READY');

    // The sealed identity is stable across independent processes (S9.5 step 7:
    // "Manager and child load the same sealed source/artifact identities").
    const second = runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir });
    assertLoaderReady(second, 'LOAD-READY second independent process');
    const first = runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir });
    assert.strictEqual(second.json.abi.compiled_source_digest, first.json.abi.compiled_source_digest,
      'two independent loads of the same sealed generation must agree on the embedded source digest');
  } finally {
    clone.dispose();
  }
});

test('LOAD-ABSENT: a removed artifact is ADDON_ABSENT (PLAN.md S9.6 row 1)', whenLoaderExists(), () => {
  const clone = cloneBuiltScratch('absent');
  try {
    makeWritable(clone.sealed.artifactDir);
    fs.rmSync(clone.sealed.artifactPath);
    assertLoaderRejected(runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir }), 'ADDON_ABSENT', 'LOAD-ABSENT');
  } finally {
    clone.dispose();
  }
});

test('LOAD-TRUNCATED: a present-but-unloadable artifact with CONSISTENT digests is ADDON_LOAD_ERROR (PLAN.md S9.6 row 2)', whenLoaderExists(), () => {
  const clone = cloneBuiltScratch('truncated');
  try {
    const original = fs.readFileSync(clone.sealed.artifactPath);
    // Truncate to a prefix, then rebuild every digest so the loader cannot
    // reject on drift and MUST reach the load-error row.
    replaceArtifactConsistently(clone.sealed, original.subarray(0, Math.floor(original.length / 3)));
    assertLoaderRejected(runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir }), 'ADDON_LOAD_ERROR', 'LOAD-TRUNCATED');
  } finally {
    clone.dispose();
  }
});

test('LOAD-SYMBOL-MISMATCH: a LOADABLE artifact with a wrong symbol roster is ADDON_SYMBOL_MISMATCH (PLAN.md S9.6 row 3)', whenLoaderExists(), () => {
  const clone = cloneBuiltScratch('symbol');
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-symsrc-')));
  try {
    // Both directions of "additional/missing native symbol" (PLAN.md S8.3).
    for (const [label, roster] of [
      ['missing the 45th export', EXPORT_NAMES_IN_ORDER.slice(0, 44)],
      ['carrying a 46th spike-only export', EXPORT_NAMES_IN_ORDER.concat(['probeClockDrift'])],
    ]) {
      const addonPath = compileScratchAddon(scratch, wrongSymbolAddonSource(roster), 'r33_wrongsym_' + roster.length);
      replaceArtifactConsistently(clone.sealed, fs.readFileSync(addonPath));
      assertLoaderRejected(runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir }),
        'ADDON_SYMBOL_MISMATCH', 'LOAD-SYMBOL-MISMATCH ' + label);
    }
  } finally {
    removeScratchTree(scratch);
    clone.dispose();
  }
});

test('LOAD-SOURCE-DRIFT: mutating EACH ACTUALLY-SEALED source row provokes PROVIDER_BUILD_DRIFT (PLAN.md S9.3, S9.6 row 4)', whenLoaderExists(), () => {
  // The previous version of this case only asserted that
  // compiled_source_digest matched /^[0-9a-f]{64}$/. A hex-format assertion
  // over an unmutated build cannot detect drift at all; real drift is provoked
  // here, one row at a time.
  //
  // The sweep iterates the rows genuinely sealed into the generation, not the
  // frozen eleven -- three are later-unit deliverables. The assertions below
  // pin that set on both sides so the sweep cannot silently shrink to a
  // trivial subset: the sealed set must equal the present set, and the
  // excluded set must equal the driver-reported pending set exactly.
  const shared = sharedScratchBuild();
  const sealedRows = PROVIDER_SOURCE_ROWS.filter((rel) => fs.existsSync(path.join(shared.sealed.treeDir, rel)));
  const excludedRows = PROVIDER_SOURCE_ROWS.filter((rel) => !sealedRows.includes(rel));

  assert.deepStrictEqual(sealedRows.slice().sort(), shared.presentRows.slice().sort(),
    'every roster row that exists in the repository must have been sealed into the generation (PLAN.md S9.5 step 1)');
  assert.deepStrictEqual(excludedRows.slice().sort(), shared.pendingRows.slice().sort(),
    'the rows excluded from the seal must be EXACTLY the driver-reported pending_rows -- no more, no fewer');
  for (const rel of excludedRows) {
    assert.ok(PENDING_ROW_ALLOWLIST.includes(rel),
      'an excluded row outside the three-row allowlist is drift, not a deferred deliverable: ' + rel);
  }
  assert.strictEqual(sealedRows.length, PROVIDER_SOURCE_ROWS.length - shared.pendingRows.length,
    'the sweep must cover every sealed row');
  assert.ok(sealedRows.length >= PROVIDER_SOURCE_ROWS.length - PENDING_ROW_ALLOWLIST.length,
    'at most three rows may ever be deferred, so the sweep can never shrink below eight rows');

  let mutatedRows = 0;
  for (const rel of sealedRows) {
    const clone = cloneBuiltScratch('srcdrift');
    try {
      const sealedRow = path.join(clone.sealed.treeDir, rel);
      assert.ok(fs.existsSync(sealedRow),
        'PLAN.md S9.5 step 1 seals the tree "preserving repository-relative names"; missing ' + rel);
      // Baseline: this exact clone loads before the mutation, so the rejection
      // below cannot be attributed to anything but the one-byte change.
      assertLoaderReady(runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir }), 'baseline before mutating ' + rel);

      makeWritable(clone.sealed.treeDir, path.dirname(sealedRow), sealedRow);
      fs.appendFileSync(sealedRow, '\n');
      assertLoaderRejected(runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir }),
        'PROVIDER_BUILD_DRIFT', 'LOAD-SOURCE-DRIFT on sealed row ' + rel);
      mutatedRows += 1;
    } finally {
      clone.dispose();
    }
  }
  assert.strictEqual(mutatedRows, sealedRows.length,
    'every sealed row must have been mutated and rejected; the sweep must not exit early');
});

test('LOAD-ARTIFACT-DRIFT: a mutated artifact whose provenance still names the old digest is PROVIDER_BUILD_DRIFT (PLAN.md S9.6 row 4)', whenLoaderExists(), () => {
  const clone = cloneBuiltScratch('artdrift');
  try {
    makeWritable(clone.sealed.artifactDir, clone.sealed.artifactPath);
    const bytes = fs.readFileSync(clone.sealed.artifactPath);
    bytes[bytes.length - 1] = bytes[bytes.length - 1] ^ 0xff; // mutated: watched artifact bytes
    fs.writeFileSync(clone.sealed.artifactPath, bytes); // digest-named path deliberately unchanged
    assertLoaderRejected(runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir }),
      'PROVIDER_BUILD_DRIFT', 'LOAD-ARTIFACT-DRIFT');
  } finally {
    clone.dispose();
  }
});

test('LOAD-PROVENANCE-DRIFT: mutating each provenance digest field, and the nested toolchain, is PROVIDER_BUILD_DRIFT (PLAN.md S9.4, S9.6 row 4)', whenLoaderExists(), () => {
  const mutations = [
    ['provider_source_digest', (p) => { p.provider_source_digest = 'f'.repeat(64); }],
    ['provider_toolchain_digest', (p) => { p.provider_toolchain_digest = 'f'.repeat(64); }],
    ['provider_artifact_digest', (p) => { p.provider_artifact_digest = 'f'.repeat(64); }],
    ['provider_build_digest', (p) => { p.provider_build_digest = 'f'.repeat(64); }],
    ['build_generation_id', (p) => { p.build_generation_id = '0'.repeat(64); }],
    ['observed_toolchain.lock_digest', (p) => { p.observed_toolchain.lock_digest = 'f'.repeat(64); }],
    ['observed_toolchain.toolchain_identity_sha256', (p) => { p.observed_toolchain.toolchain_identity_sha256 = 'f'.repeat(64); }],
    ['observed_toolchain.build_flags_digest', (p) => { p.observed_toolchain.build_flags_digest = 'f'.repeat(64); }],
    ['observed_toolchain.profile_id', (p) => { p.observed_toolchain.profile_id = 'linux-x64'; }],
  ];
  for (const [label, mutate] of mutations) {
    const clone = cloneBuiltScratch('provdrift');
    try {
      const provenance = readProvenance(clone.sealed);
      // The emitted record must itself be the exact closed shape before we
      // touch it -- otherwise this case would be mutating an unknown object.
      assertR33BuildProvenanceV2(provenance);
      mutate(provenance); // mutated: watched provenance field
      writeProvenance(clone.sealed, provenance);
      assertLoaderRejected(runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir }),
        'PROVIDER_BUILD_DRIFT', 'LOAD-PROVENANCE-DRIFT on ' + label);
    } finally {
      clone.dispose();
    }
  }
});

test('LOAD-LOCK-DRIFT: a mutated tracked toolchain-lock.json fails the build closed before any artifact is produced (PLAN.md S9.2)', whenLoaderExists(), () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-lockdrift-')));
  try {
    copyRepoInputsInto(root);
    const pkgDir = path.join(root, NATIVE_PACKAGE_REL);
    const lockPath = path.join(pkgDir, 'toolchain-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assertR33ToolchainLockV2(lock); // the tracked lock must be the exact closed record
    lock.node_gyp_version = '13.0.2'; // mutated: watched pin -- lock_digest no longer matches
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

    const built = runCli([path.join(pkgDir, 'build.cjs'), 'build-and-verify'], { cwd: pkgDir });
    assert.notStrictEqual(built.status, 0,
      'PLAN.md S9.2: "Missing evidence or any mismatch fails before compiling"');
    assert.ok(!fs.existsSync(path.join(pkgDir, 'build', 'sealed')) || locateSealedGenerationOrNull(pkgDir) === null,
      'a lock mismatch must fail BEFORE a sealed generation with an artifact is published');
  } finally {
    removeScratchTree(root);
  }
});

function locateSealedGenerationOrNull(pkgDir) {
  try { return locateSealedGeneration(pkgDir); } catch (_err) { return null; }
}

test('LOAD-ARTIFACT-SWAP-BEFORE-LOAD: replacing the digest-named artifact between build and load is rejected (PLAN.md S9.5 step 5)', whenLoaderExists(), () => {
  const clone = cloneBuiltScratch('swap');
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-swapsrc-')));
  try {
    // A genuinely loadable substitute placed at the ACCREDITED pathname, with
    // provenance untouched: the digest-named path no longer matches its bytes.
    const substitute = compileScratchAddon(scratch, wrongSymbolAddonSource(EXPORT_NAMES_IN_ORDER), 'r33_substitute');
    makeWritable(clone.sealed.artifactDir, clone.sealed.artifactPath);
    fs.writeFileSync(clone.sealed.artifactPath, fs.readFileSync(substitute));
    assertLoaderRejected(runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir }),
      'PROVIDER_BUILD_DRIFT', 'LOAD-ARTIFACT-SWAP-BEFORE-LOAD');
  } finally {
    removeScratchTree(scratch);
    clone.dispose();
  }
});

test('LOAD-POST-LOAD-PATH-SWAP: repointing the accredited pathname at a different dev/ino after load is rejected (PLAN.md S9.5 step 6)', whenLoaderExists(), () => {
  const clone = cloneBuiltScratch('pathswap');
  try {
    makeWritable(clone.sealed.artifactDir, clone.sealed.artifactPath);
    const originalBytes = fs.readFileSync(clone.sealed.artifactPath);
    const decoyPath = clone.sealed.artifactPath + '.decoy';
    fs.writeFileSync(decoyPath, originalBytes); // byte-identical, but a DIFFERENT inode

    const before = fs.statSync(clone.sealed.artifactPath).ino;
    fs.rmSync(clone.sealed.artifactPath);
    fs.renameSync(decoyPath, clone.sealed.artifactPath); // mutated: watched parent/name->dev/ino witness
    const after = fs.statSync(clone.sealed.artifactPath).ino;
    assert.notStrictEqual(after, before,
      'precondition: the pathname must now resolve to a DIFFERENT inode -- identical bytes, different identity');

    // PLAN.md S9.5 step 6 revalidates parent/name->dev/ino after load, so an
    // identity swap must be caught even though the bytes still hash correctly.
    assertLoaderRejected(runProbe(loaderProbeSource(clone.loaderPath), { cwd: clone.pkgDir }),
      'PROVIDER_BUILD_DRIFT', 'LOAD-POST-LOAD-PATH-SWAP');
  } finally {
    clone.dispose();
  }
});

// ===========================================================================
// SECTION 6 -- TIER 2: the narrow argv-gated interposition seam, for the two
// genuinely intra-process races that cannot be driven from outside.
//
// Seam contract (frozen by the dispatching lead; toolkit-specialist implements
// it in build.cjs):
//   node build.cjs selftest-interpose --plan <abs-path-to-fault-plan.json>
//   fault plan: {schema:"runtime/r33-native-selftest-interpose/v1",
//                fault:"SOURCE_MUTATE_AFTER_HASH"|"ARTIFACT_MUTATE_IN_QUARANTINE"}
// It runs the identical six-phase chain with the declared fault injected at the
// declared point, prints ONE JSON object carrying the observed S9.6 outcome
// code, and preserves a real exit code.
//
// Reachability rule: the fault dispatcher is referenced ONLY from that argv
// branch; `buildAndLoadVerified()` must not reach it transitively.
// ===========================================================================

function writeFaultPlan(dir, fault) {
  const planPath = path.join(dir, 'fault-plan.json');
  fs.writeFileSync(planPath, JSON.stringify({ schema: SEAM_SCHEMA, fault }) + '\n');
  return planPath;
}

function runSeam(pkgDir, planPath) {
  return runCli([path.join(pkgDir, 'build.cjs'), SEAM_VERB, '--plan', planPath], { cwd: pkgDir });
}

function assertSeamOutcome(probe, expectedCode, label) {
  assert.notStrictEqual(probe.status, 0, label + ': the seam must preserve a real failing exit code');
  assert.ok(probe.json !== null,
    label + ': the seam must print ONE JSON object on stdout.\n--- stdout ---\n' + probe.stdout);
  assert.strictEqual(probe.json.outcome, expectedCode,
    label + ': the observed S9.6 outcome must be exactly ' + expectedCode + ', got ' + JSON.stringify(probe.json.outcome));
}

test('LOAD-TOCTOU-SOURCE-AFTER-HASH: mutating a sealed source row after hashing but BEFORE compile is PROVIDER_BUILD_DRIFT (PLAN.md S9.5 step 3)', whenLoaderExists(), () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-toctou-src-')));
  try {
    copyRepoInputsInto(root);
    const pkgDir = path.join(root, NATIVE_PACKAGE_REL);
    const planPath = writeFaultPlan(root, 'SOURCE_MUTATE_AFTER_HASH');
    // PLAN.md S9.5 step 3: "Immediately after link, all eleven sealed rows are
    // rehashed again and must still equal provider_source_digest."
    assertSeamOutcome(runSeam(pkgDir, planPath), 'PROVIDER_BUILD_DRIFT', 'LOAD-TOCTOU-SOURCE-AFTER-HASH');
    assert.ok(locateSealedGenerationOrNull(pkgDir) === null || !fs.existsSync(path.join(pkgDir, 'index.js.loaded')),
      'the interposed build must not publish a loadable generation');
  } finally {
    removeScratchTree(root);
  }
});

test('LOAD-TOCTOU-ARTIFACT-IN-QUARANTINE: mutating the artifact while it sits in the load quarantine is PROVIDER_BUILD_DRIFT (PLAN.md S9.5 steps 5-6)', whenLoaderExists(), () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-toctou-art-')));
  try {
    copyRepoInputsInto(root);
    const pkgDir = path.join(root, NATIVE_PACKAGE_REL);
    const planPath = writeFaultPlan(root, 'ARTIFACT_MUTATE_IN_QUARANTINE');
    // PLAN.md S9.5 step 6: "requires byte-identical pre/post artifact digests.
    // Any mismatch discards the quarantine variable and fails before step 5."
    assertSeamOutcome(runSeam(pkgDir, planPath), 'PROVIDER_BUILD_DRIFT', 'LOAD-TOCTOU-ARTIFACT-IN-QUARANTINE');
  } finally {
    removeScratchTree(root);
  }
});

test('SEAM-GUARD-01: the seam is fail-closed -- an unknown fault, a wrong schema, and a missing plan are all rejected', whenLoaderExists(), () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'r33-seam-closed-')));
  try {
    copyRepoInputsInto(root);
    const pkgDir = path.join(root, NATIVE_PACKAGE_REL);

    const unknownFault = path.join(root, 'unknown.json');
    fs.writeFileSync(unknownFault, JSON.stringify({ schema: SEAM_SCHEMA, fault: 'ARBITRARY_CODE_PATH' }) + '\n');
    assert.notStrictEqual(runSeam(pkgDir, unknownFault).status, 0,
      'an undeclared fault name must be rejected -- the seam is a closed two-member enum, not an escape hatch');

    const wrongSchema = path.join(root, 'wrong-schema.json');
    fs.writeFileSync(wrongSchema, JSON.stringify({ schema: 'runtime/anything-else/v1', fault: SEAM_FAULTS[0] }) + '\n');
    assert.notStrictEqual(runSeam(pkgDir, wrongSchema).status, 0, 'a foreign schema must be rejected');

    assert.notStrictEqual(runSeam(pkgDir, path.join(root, 'does-not-exist.json')).status, 0,
      'a missing fault plan must be rejected, never defaulted');
    assert.notStrictEqual(runCli([path.join(pkgDir, 'build.cjs'), SEAM_VERB], { cwd: pkgDir }).status, 0,
      'the seam verb without --plan must be rejected');
  } finally {
    removeScratchTree(root);
  }
});

test('SEAM-GUARD-02: requiring index.js applies NO fault even when a fault plan is present on disk (runtime unreachability)', whenLoaderExists(), () => {
  const clone = cloneBuiltScratch('seamunreach');
  try {
    // A fault plan sitting in the package directory, and pointed at by an
    // env var, must change nothing: the seam is argv-gated on build.cjs only.
    writeFaultPlan(clone.pkgDir, 'ARTIFACT_MUTATE_IN_QUARANTINE');
    const probe = runProbe(loaderProbeSource(clone.loaderPath), {
      cwd: clone.pkgDir,
      env: { R33_NATIVE_SELFTEST_PLAN: path.join(clone.pkgDir, 'fault-plan.json') },
    });
    assertLoaderReady(probe, 'SEAM-GUARD-02: require(index.js) must be unaffected by any fault plan');
  } finally {
    clone.dispose();
  }
});

// ---------------------------------------------------------------------------
// SEAM-GUARD-03: STATIC unreachability. A bounded call-graph walk from the
// production entry `buildAndLoadVerified` must never reach a seam token.
// ---------------------------------------------------------------------------

/** Extracts top-level function bodies by brace matching. */
function extractFunctionBodies(source) {
  const bodies = new Map();
  const declaration = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let match = declaration.exec(source);
  while (match !== null) {
    const openIndex = source.indexOf('{', match.index + match[0].length - 1);
    let depth = 0;
    let end = -1;
    for (let i = openIndex; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) bodies.set(match[1], source.slice(openIndex + 1, end));
    match = declaration.exec(source);
  }
  return bodies;
}

/** Bounded BFS over identifiers that name other extracted functions. */
function reachableFunctionNames(bodies, entryName) {
  const seen = new Set();
  const queue = [entryName];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const body = bodies.get(name);
    if (body === undefined) continue;
    for (const other of bodies.keys()) {
      if (!seen.has(other) && new RegExp('\\b' + other + '\\b').test(body)) queue.push(other);
    }
  }
  return seen;
}

/**
 * Asserts no seam token appears in the transitive call graph of `entryName`.
 * The scope is EXTRACTED (the reachable bodies) and then asserted empty of the
 * tokens -- never a hand-listed set of forbidden substrings over whole files.
 */
function assertSeamUnreachableFromEntry(source, entryName, seamTokens) {
  const bodies = extractFunctionBodies(source);
  assert.ok(bodies.has(entryName),
    'the production entry ' + entryName + '() must be a top-level function in this source (PLAN.md S9.1)');
  const reachable = reachableFunctionNames(bodies, entryName);
  const offenders = [];
  for (const name of reachable) {
    const body = bodies.get(name);
    if (body === undefined) continue;
    for (const token of seamTokens) {
      if (body.includes(token)) offenders.push(name + ' -> ' + token);
    }
  }
  assert.deepStrictEqual(offenders, [],
    'the production entry must not reach the interposition seam transitively; offending edges: ' + JSON.stringify(offenders));
  return reachable;
}

const SEAM_STATIC_FIXTURE_CLEAN = [
  'function buildAndLoadVerified() { return sealInputs() && rebuild(); }',
  'function sealInputs() { return true; }',
  'function rebuild() { return true; }',
  'function applyInterposedFault(plan) { return plan.fault; }',
  'function main(argv) {',
  '  if (argv[0] === "selftest-interpose") { return applyInterposedFault(readPlan(argv)); }',
  '  return buildAndLoadVerified();',
  '}',
  'function readPlan(argv) { return JSON.parse(argv[2]); }',
].join('\n');

const SEAM_STATIC_FIXTURE_LEAKED = SEAM_STATIC_FIXTURE_CLEAN
  .replace('function rebuild() { return true; }',
    'function rebuild() { return applyInterposedFault({ fault: "SOURCE_MUTATE_AFTER_HASH" }); }');

test('positive fixture: the static seam scanner passes a source where the seam is reachable ONLY from the argv branch', () => {
  const reachable = assertSeamUnreachableFromEntry(SEAM_STATIC_FIXTURE_CLEAN, 'buildAndLoadVerified', ['applyInterposedFault', 'selftest-interpose']);
  assert.ok(reachable.has('sealInputs') && reachable.has('rebuild'),
    'precondition: the scanner really does walk into the production callees, so a leak there would be visible');
  assert.ok(!reachable.has('applyInterposedFault'), 'the seam dispatcher must not be reachable from the production entry');
});

test('negative control: the static seam scanner FAILS when a production callee reaches the seam dispatcher (one-line leak)', () => {
  assert.throws(
    () => assertSeamUnreachableFromEntry(SEAM_STATIC_FIXTURE_LEAKED, 'buildAndLoadVerified', ['applyInterposedFault', 'selftest-interpose']), // mutated: watched reachability edge
    assert.AssertionError,
    'a single production callee referencing the seam MUST fail the scanner -- otherwise the seam is unpoliced',
  );
});

test('negative control: the static seam scanner FAILS when the production entry is absent (it cannot pass vacuously)', () => {
  assert.throws(
    () => assertSeamUnreachableFromEntry('function unrelated() { return 1; }', 'buildAndLoadVerified', ['applyInterposedFault']), // mutated: watched entry presence
    assert.AssertionError,
    'a scanner that silently passes when it cannot find the entry point is a check that cannot fail',
  );
});

test('SEAM-GUARD-03: index.js contains ZERO seam references, and build.cjs confines the seam to its argv branch', whenLoaderExists(), () => {
  const loaderSource = fs.readFileSync(LOADER_PATH, 'utf8');
  for (const token of SEAM_TOKENS) {
    assert.ok(!loaderSource.includes(token),
      'index.js must contain zero references to the interposition seam; found ' + JSON.stringify(token));
  }

  const buildSource = fs.readFileSync(BUILD_DRIVER_PATH, 'utf8');
  assert.ok(buildSource.includes(SEAM_VERB),
    'build.cjs must host the ' + SEAM_VERB + ' verb -- otherwise the Tier-2 cases above are testing nothing');
  assertSeamUnreachableFromEntry(buildSource, PRODUCTION_ENTRY_NAME, SEAM_TOKENS);
});

// ---------------------------------------------------------------------------
// First RED (PLAN.md S11.1). Exact sentinel name required by the eight-name
// RED set and by the ordered sub-DAG's WP3-RED exit evidence. Genuinely fails
// today because `scripts/native/r33-provider/index.js` does not exist yet
// (rows 1-13 are WP3-ABI's own dependent unit, toolkit-specialist-owned) --
// the honest, PLAN-designated first-RED reason, not an instrument defect.
// ---------------------------------------------------------------------------
test('R33-RED-LOADER-ABSENT', () => {
  const mod = require(LOADER_PATH);
  assert.strictEqual(typeof mod.providerAbiInfo, 'function',
    'scripts/native/r33-provider/index.js (Path-Manifest row 7) must export providerAbiInfo() (PLAN.md S2.3 export #1)');
  const result = mod.providerAbiInfo();
  assert.ok(result && typeof result === 'object', 'providerAbiInfo() must return a NativeResultV1 object (PLAN.md S2.1)');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'OK');
  assertNativeProviderAbiInfoV1(result.value);
});
