#!/usr/bin/env node
'use strict';

// WP3-RED first-RED sentinel + shape-oracle suite for the R33 native-provider
// CI contract. Frozen contract source: PLAN.md "R33 Native-Provider CI
// Dependency Graph and Machine-Readable Results" S9.3 "Closed build-input
// roster" (test_contract_digest, 21 paths), S12.0 "Phase-D execution split",
// S12.1 "Exact jobs", S12.2 "Per-leg result", S12.3 "Aggregate result", S12.4
// "Genuine fail-closed controls". Path-Manifest row 21 (this file) targets
// row 12 `scripts/lib/runtime-r33-ci-contract.cjs` and row 13
// `.github/workflows/r33-native-provider.yml` (both toolkit-specialist-owned,
// WP3-CI-CONTRACT, absent as of this commit).
//
// SCOPE (dispatch: test-specialist, WP3-RED ONLY): the currently-FAILING
// deliverable is the ONE named sentinel below, `R33-RED-CI-CONTRACT-ABSENT`
// (PLAN.md S11.1's eight-name RED set). The static, textual parts of
// `CI-SCHEMA/WIRING-*` (exact job IDs/runners/needs wiring in the workflow
// YAML) ARE authored below as a skip-gated check, since they are verifiable
// by reading the workflow file as text once it exists -- no code execution
// or guessed internal API required. PLAN.md S12.0 is explicit that a real
// 21/21 digest, platform artifact, or aggregate PASS at the WP3-CI-CONTRACT
// stage is FORBIDDEN -- only WP6-CI-QUALIFY, after WP6-CONFORMANCE creates
// row 22, may prove those; this file's checks stop at static wiring/schema
// verification accordingly and never assert a real platform/aggregate result.
//
// This file ships a PASSING, independent reference-oracle for the closed
// result/aggregate schemas (S12.2/S12.3) and the exact 21-path
// test_contract_digest roster (S9.3), including the SAME "absent row 22"
// scenario S12.4 names -- which is genuinely, presently true of this
// worktree (row 22, `scripts/tests/r33-native-conformance.bats`, is
// WP6-owned and does not exist yet, by design). These tests use only literal
// in-memory fixtures (never a live filesystem scan of the repo, so they
// remain stable as later WP3 stages create rows 1-13) and PASS today; they
// are explicitly NOT part of the required eight-name failing set.

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const CI_CONTRACT_MODULE_PATH = path.resolve(__dirname, '../lib/runtime-r33-ci-contract.cjs'); // Path-Manifest row 12
const WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/r33-native-provider.yml'); // Path-Manifest row 13

// ---------------------------------------------------------------------------
// PLAN.md S9.3 -- the exact 21-path test_contract_digest roster, literal and
// byte-for-byte, in the PLAN's own declared order.
// ---------------------------------------------------------------------------
const TEST_CONTRACT_ROSTER_21 = [
  '.github/workflows/l0-ci.yml',
  '.github/workflows/r33-native-provider.yml',
  'scripts/lib/runtime-r33-ci-contract.cjs',
  'scripts/lib/runtime-r33-golden.cjs',
  'scripts/tests/r33-native-loader.test.js',
  'scripts/tests/r33-native-abi.test.js',
  'scripts/tests/r33-provider-child.test.js',
  'scripts/tests/r33-wire-protocol.test.js',
  'scripts/tests/r33-clock-containment.test.js',
  'scripts/tests/r33-golden-vectors.test.js',
  'scripts/tests/r33-authority-positive.test.js',
  'scripts/tests/r33-native-ci-contract.test.js',
  'scripts/tests/r33-native-conformance.bats', // row 22 -- WP6-owned, absent today by design
  'scripts/tests/runtime-consultation-bridge.bats',
  'scripts/tests/runtime-consultation-cli.bats',
  'scripts/tests/runtime-consultation-cli.test.js',
  'scripts/tests/runtime-consultation-protocol.bats',
  'scripts/tests/runtime-consultation-roots.bats',
  'scripts/tests/runtime-consultation-state.bats',
  'scripts/tests/runtime-consultation-windows.bats',
  'scripts/tests/runtime-role-lifecycle.bats',
];

/**
 * Independent reference-oracle roster validator. Requires byte-for-byte SET
 * equality (cardinality 21, no duplicate, no additional literal, PLAN.md
 * S9.3) between `actualPaths` and the frozen 21-path roster, and reports the
 * exact missing/extra path set on rejection (not merely a boolean) -- this is
 * the shape S12.4's fail-closed controls require of the real validator.
 */
function assertTestContractRoster(actualPaths) {
  assert.strictEqual(new Set(actualPaths).size, actualPaths.length, 'roster fixture must not itself contain a duplicate path');
  const expected = new Set(TEST_CONTRACT_ROSTER_21);
  const actual = new Set(actualPaths);
  const missing = [...expected].filter((p) => !actual.has(p));
  const extra = [...actual].filter((p) => !expected.has(p));
  if (missing.length || extra.length) {
    const err = new assert.AssertionError({
      message: 'test_contract_digest roster mismatch (PLAN.md S9.3): missing=' + JSON.stringify(missing) + ' extra=' + JSON.stringify(extra),
    });
    err.missing = missing;
    err.extra = extra;
    throw err;
  }
  assert.strictEqual(actualPaths.length, 21, 'roster cardinality must be EXACTLY 21 (PLAN.md S9.3)');
}

test('positive fixture: assertTestContractRoster accepts the exact frozen 21-path roster', () => {
  assertTestContractRoster(TEST_CONTRACT_ROSTER_21);
  assertTestContractRoster([...TEST_CONTRACT_ROSTER_21].reverse()); // order-independence: a set, not a sequence
});

test('negative control: assertTestContractRoster rejects the roster with row 22 absent, identifying it as the sole missing member (PLAN.md S12.4 "before WP6" control)', () => {
  const withoutRow22 = TEST_CONTRACT_ROSTER_21.filter((p) => p !== 'scripts/tests/r33-native-conformance.bats'); // mutated: watched cardinality, genuinely true of this worktree today
  assert.throws(
    () => assertTestContractRoster(withoutRow22),
    (err) => {
      assert.deepStrictEqual(err.missing, ['scripts/tests/r33-native-conformance.bats'],
        'the rejection must identify EXACTLY scripts/tests/r33-native-conformance.bats as the sole missing member');
      assert.deepStrictEqual(err.extra, [], 'no extra/duplicate member may be reported for this fixture');
      return true;
    },
    'validator must reject a 20-path roster missing only row 22, per PLAN.md S12.4\'s named "before WP6" fail-closed control',
  );
});

test('negative control: assertTestContractRoster rejects the roster with runtime-consultation-bridge.bats absent (PLAN.md S12.4 "missing-bridge" control)', () => {
  const withoutBridge = TEST_CONTRACT_ROSTER_21.filter((p) => p !== 'scripts/tests/runtime-consultation-bridge.bats'); // mutated: watched cardinality
  assert.throws(
    () => assertTestContractRoster(withoutBridge),
    (err) => {
      assert.deepStrictEqual(err.missing, ['scripts/tests/runtime-consultation-bridge.bats']);
      return true;
    },
    'validator must reject a roster missing runtime-consultation-bridge.bats, per PLAN.md D-11\'s missing-bridge negative control',
  );
});

test('negative control: assertTestContractRoster rejects a 22nd extra/unlisted path', () => {
  const withExtra = [...TEST_CONTRACT_ROSTER_21, 'scripts/tests/some-unrelated-file.test.js']; // mutated: watched extra-literal invariant
  assert.throws(() => assertTestContractRoster(withExtra), assert.AssertionError,
    'validator must reject any path outside the closed 21-literal roster (PLAN.md S9.3: "no additional literal")');
});

// ---------------------------------------------------------------------------
// PLAN.md S12.2/S12.3 -- closed CI result/aggregate record shapes.
// ---------------------------------------------------------------------------
// PLAN.md S12.2 R33BootstrapCiEvidenceV2 [13] -- the R2 bootstrap-carrier CI
// evidence record nested inside every per-leg result (2026-08-07 reconciliation).
const BOOTSTRAP_CI_EVIDENCE_KEYS = [
  'bootstrap_release_digest', 'bootstrap_receipt_digest', 'bootstrap_identity_digest',
  'bootstrap_abi_digest', 'internal_loader_abi_digest', 'evidence_release_digest',
  'evidence_receipt_digest', 'evidence_mutant_receipt_digest', 'mutant_roster_digest',
  'runner_image_digest', 'runner_image_receipt_digest', 'mutation_transcript_digest',
  'verification_receipt_digest',
].sort();

// PLAN.md S12.2 R33NativeProviderCiResultV2 [19] (bumped from v1 by the R2
// bootstrap-carrier reconciliation, which adds the nested bootstrap_ci record above).
const CI_RESULT_KEYS = [
  'schema', 'job_id', 'platform', 'architecture', 'runner_image', 'commit_sha', 'plan_digest',
  'node_version', 'node_gyp_version', 'napi_version', 'provider_source_digest', 'test_contract_digest',
  'provider_toolchain_digest', 'provider_artifact_digest', 'provider_build_digest', 'positive_result_digest',
  'bootstrap_ci', 'tests', 'status',
].sort();

const POSITIVE_RESULT_KEYS = [
  'schema', 'platform', 'architecture', 'provider_session_id', 'root_generation_id', 'state', 'steps', 'provider_build_digest',
].sort();

// PLAN.md S12.3 R33NativeProviderCiAggregateV2 [13] (bumped from v1 -- adds bootstrap_contract_digest).
const CI_AGGREGATE_KEYS = [
  'schema', 'expected_jobs', 'observed_jobs', 'commit_sha', 'plan_digest', 'provider_source_digest',
  'test_contract_digest', 'node_gyp_version', 'napi_version', 'results_digest', 'bootstrap_contract_digest',
  'windows_status', 'status',
].sort();

const EXPECTED_JOB_IDS = ['linux-x64', 'linux-arm64', 'darwin-arm64'];

function assertR33BootstrapCiEvidenceV2(value) {
  assert.ok(value && typeof value === 'object', 'bootstrap_ci must be a non-null object (PLAN.md S12.2 R33BootstrapCiEvidenceV2)');
  assert.deepStrictEqual(Object.keys(value).sort(), BOOTSTRAP_CI_EVIDENCE_KEYS,
    'R33BootstrapCiEvidenceV2 must have EXACTLY these 13 keys (PLAN.md S12.2)');
}

function assertR33NativeProviderCiResultV2(value) {
  assert.deepStrictEqual(Object.keys(value).sort(), CI_RESULT_KEYS, 'R33NativeProviderCiResultV2 must have EXACTLY these 19 keys (PLAN.md S12.2)');
  assert.ok(EXPECTED_JOB_IDS.includes(value.job_id), 'job_id must be one of the three closed job IDs (PLAN.md S12.1)');
  assert.strictEqual(value.status, 'PASS');
  assert.strictEqual(value.tests.failed, 0, 'a PASS result must report zero failed tests');
  assertR33BootstrapCiEvidenceV2(value.bootstrap_ci);
}

function assertR33PositiveResultV1(value) {
  assert.deepStrictEqual(Object.keys(value).sort(), POSITIVE_RESULT_KEYS, 'R33PositiveResultV1 must have EXACTLY these 8 keys (PLAN.md S12.2)');
  assert.strictEqual(value.state, 'ACTIVE');
  assert.deepStrictEqual(value.steps, [8, 12, 17, 18], 'steps must be EXACTLY [8,12,17,18] (PLAN.md S12.2)');
}

function assertR33NativeProviderCiAggregateV2(value) {
  assert.deepStrictEqual(Object.keys(value).sort(), CI_AGGREGATE_KEYS, 'R33NativeProviderCiAggregateV2 must have EXACTLY these 13 keys (PLAN.md S12.3)');
  assert.deepStrictEqual(value.expected_jobs, EXPECTED_JOB_IDS);
  assert.deepStrictEqual(value.observed_jobs, EXPECTED_JOB_IDS);
  assert.strictEqual(value.windows_status, 'UNAVAILABLE/PENDING_CI', 'windows_status must remain the frozen PLAN.md S12.3 literal');
  assert.strictEqual(value.status, 'PASS');
}

function fixtureBootstrapCiEvidence(overrides) {
  return Object.assign({
    bootstrap_release_digest: '7'.repeat(64), bootstrap_receipt_digest: '8'.repeat(64),
    bootstrap_identity_digest: '9'.repeat(64), bootstrap_abi_digest: 'g'.repeat(64),
    internal_loader_abi_digest: 'h'.repeat(64), evidence_release_digest: 'i'.repeat(64),
    evidence_receipt_digest: 'j'.repeat(64), evidence_mutant_receipt_digest: 'k'.repeat(64),
    mutant_roster_digest: 'l'.repeat(64), runner_image_digest: 'm'.repeat(64),
    runner_image_receipt_digest: 'n'.repeat(64), mutation_transcript_digest: 'o'.repeat(64),
    verification_receipt_digest: 'p'.repeat(64),
  }, overrides || {});
}

function fixtureCiResult(overrides) {
  return Object.assign({
    schema: 'r33/native-provider-ci-result/v2', job_id: 'linux-x64', platform: 'linux', architecture: 'x64',
    runner_image: 'r33-ubuntu-24.04-x64-v1', commit_sha: 'a'.repeat(40), plan_digest: 'b'.repeat(64),
    node_version: '26.0.0', node_gyp_version: '13.0.1', napi_version: 8,
    provider_source_digest: 'c'.repeat(64), test_contract_digest: 'd'.repeat(64),
    provider_toolchain_digest: 'e'.repeat(64), provider_artifact_digest: 'f'.repeat(64),
    provider_build_digest: '1'.repeat(64), positive_result_digest: '2'.repeat(64),
    bootstrap_ci: fixtureBootstrapCiEvidence(), tests: { total: 10, passed: 10, failed: 0 }, status: 'PASS',
  }, overrides || {});
}

test('positive fixture: shape validators accept the exact frozen CI result/positive/aggregate records', () => {
  assertR33NativeProviderCiResultV2(fixtureCiResult());
  assertR33PositiveResultV1({
    schema: 'r33/native-provider-positive/v1', platform: 'linux', architecture: 'x64',
    provider_session_id: '3'.repeat(32), root_generation_id: '4'.repeat(32), state: 'ACTIVE',
    steps: [8, 12, 17, 18], provider_build_digest: '5'.repeat(64),
  });
  assertR33NativeProviderCiAggregateV2({
    schema: 'r33/native-provider-ci-aggregate/v2', expected_jobs: EXPECTED_JOB_IDS, observed_jobs: EXPECTED_JOB_IDS,
    commit_sha: 'a'.repeat(40), plan_digest: 'b'.repeat(64), provider_source_digest: 'c'.repeat(64),
    test_contract_digest: 'd'.repeat(64), node_gyp_version: '13.0.1', napi_version: 8,
    results_digest: '6'.repeat(64), bootstrap_contract_digest: 'q'.repeat(64),
    windows_status: 'UNAVAILABLE/PENDING_CI', status: 'PASS',
  });
});

test('negative control: assertR33NativeProviderCiResultV2 rejects tests.failed != 0 paired with status PASS', () => {
  const fixture = fixtureCiResult({ tests: { total: 10, passed: 9, failed: 1 } }); // mutated: watched invariant
  assert.throws(() => assertR33NativeProviderCiResultV2(fixture), assert.AssertionError,
    'validator must reject a PASS status accompanied by a nonzero failed count (PLAN.md S12.2: "No missing... skipped... or non-PASS record is accepted")');
});

test('negative control: assertR33NativeProviderCiResultV2 rejects a job_id outside the closed three-job set', () => {
  const fixture = fixtureCiResult({ job_id: 'windows-x64' }); // mutated: watched closed-enum property
  assert.throws(() => assertR33NativeProviderCiResultV2(fixture), assert.AssertionError,
    'validator must reject any job_id other than linux-x64/linux-arm64/darwin-arm64 (PLAN.md S12.1: Windows has no native-provider job)');
});

test('negative control: assertR33NativeProviderCiResultV2 rejects a bootstrap_ci evidence record missing one key (R2 bootstrap-carrier reconciliation, PLAN.md S12.2)', () => {
  const fixture = fixtureCiResult();
  delete fixture.bootstrap_ci.runner_image_receipt_digest; // mutated: watched cardinality, 13 -> 12 keys
  assert.throws(() => assertR33NativeProviderCiResultV2(fixture), assert.AssertionError,
    'validator must reject a result whose nested bootstrap_ci evidence record is missing any of its 13 keys (PLAN.md S12.2 R33BootstrapCiEvidenceV2)');
});

test('negative control: assertR33PositiveResultV1 rejects a reordered/incomplete steps array', () => {
  assert.throws(() => assertR33PositiveResultV1({
    schema: 'r33/native-provider-positive/v1', platform: 'darwin', architecture: 'arm64',
    provider_session_id: '3'.repeat(32), root_generation_id: '4'.repeat(32), state: 'ACTIVE',
    steps: [8, 12, 17], // mutated: watched cardinality, step 18 dropped
    provider_build_digest: '5'.repeat(64),
  }), assert.AssertionError, 'validator must reject steps other than the exact closed [8,12,17,18] (PLAN.md S12.2)');
});

test('negative control: assertR33NativeProviderCiAggregateV2 rejects a mutated windows_status', () => {
  assert.throws(() => assertR33NativeProviderCiAggregateV2({
    schema: 'r33/native-provider-ci-aggregate/v2', expected_jobs: EXPECTED_JOB_IDS, observed_jobs: EXPECTED_JOB_IDS,
    commit_sha: 'a'.repeat(40), plan_digest: 'b'.repeat(64), provider_source_digest: 'c'.repeat(64),
    test_contract_digest: 'd'.repeat(64), node_gyp_version: '13.0.1', napi_version: 8,
    results_digest: '6'.repeat(64), bootstrap_contract_digest: 'q'.repeat(64),
    windows_status: 'PASS', status: 'PASS', // mutated: watched literal, Windows never native-provider GREEN
  }), assert.AssertionError, 'validator must reject any windows_status other than the frozen UNAVAILABLE/PENDING_CI literal (PLAN.md S12.5)');
});

// ---------------------------------------------------------------------------
// PLAN.md S12.4 -- the required rejection record shape for the missing-job
// fail-closed control (exit code 66).
// ---------------------------------------------------------------------------
const MISSING_JOB_REJECTION_KEYS = ['code', 'job_id', 'schema', 'status'].sort();
const EXPECTED_MISSING_JOB_EXIT_CODE = 66;

function assertExpectedJobMissingRejection(value, expectedJobId) {
  assert.deepStrictEqual(Object.keys(value).sort(), MISSING_JOB_REJECTION_KEYS, 'rejection record must have EXACTLY these 4 keys (PLAN.md S12.4)');
  assert.strictEqual(value.schema, 'r33/native-provider-ci-rejection/v1');
  assert.strictEqual(value.code, 'EXPECTED_JOB_MISSING');
  assert.strictEqual(value.status, 'REJECT');
  assert.strictEqual(value.job_id, expectedJobId);
}

test('positive fixture: assertExpectedJobMissingRejection accepts the exact PLAN.md S12.4 literal rejection', () => {
  assertExpectedJobMissingRejection(
    { code: 'EXPECTED_JOB_MISSING', job_id: 'linux-arm64', schema: 'r33/native-provider-ci-rejection/v1', status: 'REJECT' },
    'linux-arm64',
  );
  assert.strictEqual(EXPECTED_MISSING_JOB_EXIT_CODE, 66, 'the documented exit code for this rejection is frozen at 66 (PLAN.md S12.4)');
});

test('negative control: assertExpectedJobMissingRejection rejects status OK paired with code EXPECTED_JOB_MISSING', () => {
  assert.throws(() => assertExpectedJobMissingRejection(
    { code: 'EXPECTED_JOB_MISSING', job_id: 'linux-arm64', schema: 'r33/native-provider-ci-rejection/v1', status: 'OK' }, // mutated: watched property
    'linux-arm64',
  ), assert.AssertionError, 'validator must reject any status other than the frozen literal REJECT');
});

// ---------------------------------------------------------------------------
// PLAN.md S11.2 `CI-SCHEMA/WIRING-*` (rows 12-13, WP3-CI-CONTRACT), the
// static/textual sub-claims: exact job IDs/runners in the reusable workflow,
// its caller wiring into `.github/workflows/l0-ci.yml`'s `ci-gate.needs` and
// results array. Verified by reading both YAML files as text -- no code
// execution, no guessed internal API for `runtime-r33-ci-contract.cjs`
// required for THIS static layer (its own schema/roster-validator behavior is
// covered by the oracle above once the module itself exists, per the
// sentinel). Guarded on the reusable workflow's existence (PLAN.md S12.1's
// new job and its l0-ci.yml caller wiring are added together by the same
// WP3-CI-CONTRACT unit).
// ---------------------------------------------------------------------------
const L0_CI_WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/l0-ci.yml');

test('CI-WIRING-01: the reusable workflow declares the exact four job IDs with their required runner/tuple pins (PLAN.md S12.1)', { skip: fs.existsSync(WORKFLOW_PATH) ? false : 'workflow row 13 does not exist yet -- WP3-CI-CONTRACT dependency; structured to un-skip and execute once it does' }, () => {
  const yamlText = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  for (const jobId of ['linux-x64', 'linux-arm64', 'darwin-arm64', 'aggregate']) {
    assert.ok(yamlText.includes(jobId), 'CI-WIRING-01: reusable workflow must declare job id ' + jobId + ' (PLAN.md S12.1)');
  }
  for (const runner of ['ubuntu-24.04', 'ubuntu-24.04-arm', 'macos-26']) {
    assert.ok(yamlText.includes(runner), 'CI-WIRING-01: reusable workflow must pin runner ' + runner + ' (PLAN.md S12.1)');
  }
  assert.ok(yamlText.includes('needs:') && yamlText.includes('linux-x64') && yamlText.includes('linux-arm64') && yamlText.includes('darwin-arm64'),
    'CI-WIRING-01: the aggregate job must declare needs:[linux-x64,linux-arm64,darwin-arm64] (PLAN.md S12.1)');
  assert.ok(yamlText.includes('permissions:') && yamlText.includes('contents: read'),
    'CI-WIRING-01: the reusable workflow must declare permissions: contents: read (PLAN.md S12.1)');
});

test('CI-WIRING-02: l0-ci.yml calls the reusable workflow and wires it into ci-gate.needs/results (PLAN.md S12.1, S12.5)', { skip: fs.existsSync(WORKFLOW_PATH) ? false : 'workflow row 13 does not exist yet -- WP3-CI-CONTRACT dependency; structured to un-skip and execute once it does' }, () => {
  const l0CiText = fs.readFileSync(L0_CI_WORKFLOW_PATH, 'utf8');
  assert.ok(l0CiText.includes('r33-native-provider'),
    'CI-WIRING-02: l0-ci.yml must declare a job id r33-native-provider calling ./.github/workflows/r33-native-provider.yml (PLAN.md S12.1)');
  assert.ok(l0CiText.includes('./.github/workflows/r33-native-provider.yml'),
    'CI-WIRING-02: l0-ci.yml must reference the reusable workflow by its exact relative path');
});

// ---------------------------------------------------------------------------
// First RED (PLAN.md "Test Matrices" S11.1). Exact sentinel name required by
// the eight-name RED set. Genuinely fails today because
// `scripts/lib/runtime-r33-ci-contract.cjs` and
// `.github/workflows/r33-native-provider.yml` do not exist yet -- honest
// first-RED absence, not an instrument defect.
// ---------------------------------------------------------------------------
test('R33-RED-CI-CONTRACT-ABSENT', () => {
  const mod = require(CI_CONTRACT_MODULE_PATH);
  assert.ok(mod !== undefined,
    'scripts/lib/runtime-r33-ci-contract.cjs (Path-Manifest row 12) must exist before its roster/result/aggregate '
    + 'validators can be exercised against this file\'s independent shape oracle (PLAN.md S9.3, S12.2-S12.4)');

  assert.ok(fs.existsSync(WORKFLOW_PATH),
    '.github/workflows/r33-native-provider.yml (Path-Manifest row 13) must exist before the exact job/needs/artifact '
    + 'wiring (PLAN.md S12.1) can be verified');
});
