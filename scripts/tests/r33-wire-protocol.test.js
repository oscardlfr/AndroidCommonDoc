#!/usr/bin/env node
'use strict';

// WP3-RED first-RED sentinel + shape-oracle suite for the R33 native-provider
// closed wire contract. Frozen contract source: PLAN.md "Canonical R33
// Native-Provider Production Contract" S3.1 "Encoding, parsing, and scalar
// grammar", S3.2 "Bootstrap-only frames", S3.3 "Frozen ProviderHelloV3", S3.4
// "Frozen provider request/response frames", S3.5 "Frozen control handshake",
// S3.6 "Frozen descriptor handshake", S3.7 "Descriptor batch transfer".
// Path-Manifest row 17 (this file) targets row 10
// `scripts/lib/runtime-r33-wire.cjs` and (per its shared Path-Manifest
// association) row 8 `scripts/lib/runtime-r33-provider.cjs` -- both
// toolkit-specialist-owned, WP3-WIRE, absent as of this commit.
//
// SCOPE (dispatch: test-specialist, WP3-RED ONLY): the currently-FAILING
// deliverable is the ONE named sentinel below, `R33-RED-WIRE-ABSENT` (PLAN.md
// S11.1's eight-name RED set). `WIRE-CAP-*` (the three frame-class byte caps,
// PLAN.md S3.1) is authored below as a self-contained, always-run oracle,
// since it is pure data independent of the wire module's internal API.
// `WIRE-SHAPE-*`/`WIRE-AUTH-*` (every one-key mutation on the wire, every
// bootstrap domain/HMAC tag, both transcript Finished chains) are flagged
// below as an open design question rather than guessed at, since PLAN.md S3
// deliberately does not fix `runtime-r33-wire.cjs`'s internal function names
// the way it fixes the native ABI's 45 exports -- see the comment immediately
// above the sentinel test for the exact reasoning.
//
// Unlike the native ABI (S2.3, a closed JS-callable export surface) or the
// composition factory (S5, a closed JS-callable class surface),
// `runtime-r33-wire.cjs`'s internal function names are NOT frozen by the
// PLAN -- only the ON-WIRE byte/schema contract is (S3.1-S3.7). This file's
// shape-oracle instruments therefore validate the closed record/frame SHAPES
// directly (the genuine frozen contract), independent of whichever internal
// API toolkit-specialist chooses to expose them through; they PASS today and
// are explicitly NOT part of the required eight-name failing set.

const assert = require('node:assert');
const { test } = require('node:test');
const path = require('node:path');

const WIRE_MODULE_PATH = path.resolve(__dirname, '../lib/runtime-r33-wire.cjs'); // Path-Manifest row 10
const PROVIDER_CHILD_MODULE_PATH = path.resolve(__dirname, '../lib/runtime-r33-provider.cjs'); // Path-Manifest row 8

// ---------------------------------------------------------------------------
// PLAN.md S3.2-S3.6 -- closed frame/record key registries, literal and
// exhaustive. Every array below is the exact frozen key list in the PLAN's
// own declared order (order is not itself part of the JSON-object contract,
// but is preserved here for direct traceability back to PLAN.md).
// ---------------------------------------------------------------------------
const FRAME_KEY_REGISTRY = {
  // S3.3 Frozen ProviderHelloV3 [13]
  ProviderHelloV3: ['kind', 'protocol_profile', 'control_protocol', 'handle_protocol', 'provider_name',
    'provider_abi', 'provider_build_digest', 'control_endpoint_id', 'provider_session_id',
    'root_generation_id', 'runtime_owner_root_id', 'clock_domain_id', 'state'],
  // S3.2 Bootstrap-only frames [15,5,5,6,5,6]
  ProviderBootstrapPreludeV1: ['schema', 'protocol_profile', 'control_protocol', 'handle_protocol',
    'provider_name', 'provider_abi', 'provider_build_digest', 'control_endpoint_id', 'provider_session_id',
    'root_generation_id', 'runtime_owner_root_id', 'clock_domain_id', 'clock_domain_precommit_digest',
    'correlation_id', 'auth_tag'],
  ProviderBootstrapHelloEnvelopeV1: ['schema', 'correlation_id', 'bootstrap_prelude_digest', 'hello', 'auth_tag'],
  ClockProbeV1: ['schema', 'correlation_id', 'bootstrap_prelude_digest', 'round_index', 'auth_tag'],
  ClockSampleV1: ['schema', 'correlation_id', 'bootstrap_prelude_digest', 'round_index', 'provider_sample_monotonic_ns', 'auth_tag'],
  ClockCommitV1: ['schema', 'correlation_id', 'bootstrap_prelude_digest', 'receipt', 'auth_tag'],
  ClockCommitAckV1: ['schema', 'correlation_id', 'bootstrap_prelude_digest', 'clock_domain_receipt_digest', 'state', 'auth_tag'],
  // S3.4 Frozen provider request/response frames [14,15]
  ProviderRequestV3: ['schema', 'control_protocol', 'channel', 'connection_id', 'seq', 'operation_id',
    'provider_session_id', 'root_generation_id', 'runtime_owner_root_id', 'clock_domain_id',
    'deadline_monotonic_ns', 'method', 'body', 'auth_tag'],
  ProviderResponseV3: ['schema', 'control_protocol', 'connection_id', 'seq', 'operation_id', 'request_digest',
    'provider_session_id', 'root_generation_id', 'runtime_owner_root_id', 'clock_domain_id', 'outcome',
    'status', 'provider_code', 'body', 'auth_tag'],
  // S3.5 Frozen control handshake [7,11,5] (ControlServerHelloCoreV3 is projection-only, never wire)
  ClientHelloV3: ['schema', 'capability_id', 'provider_session_id', 'root_generation_id', 'runtime_owner_root_id', 'clock_domain_id', 'client_nonce'],
  ServerHelloV3: ['schema', 'capability_id', 'provider_session_id', 'root_generation_id', 'runtime_owner_root_id',
    'clock_domain_id', 'connection_id', 'client_nonce', 'server_nonce', 'transcript_digest', 'server_finished'],
  ClientFinishedV3: ['schema', 'capability_id', 'connection_id', 'transcript_digest', 'client_finished'],
  // S3.6 Frozen descriptor handshake [8,12,5] (DescriptorServerHelloCoreV2 is projection-only)
  DescriptorClientHelloV2: ['schema', 'capability_id', 'provider_session_id', 'root_generation_id',
    'runtime_owner_root_id', 'clock_domain_id', 'control_endpoint_id', 'client_nonce'],
  DescriptorServerHelloV2: ['schema', 'capability_id', 'provider_session_id', 'root_generation_id',
    'runtime_owner_root_id', 'clock_domain_id', 'control_endpoint_id', 'connection_id', 'client_nonce',
    'server_nonce', 'descriptor_transcript_digest', 'descriptor_server_finished'],
  DescriptorClientFinishedV2: ['schema', 'capability_id', 'connection_id', 'descriptor_transcript_digest', 'descriptor_client_finished'],
  // S3.7 Descriptor batch transfer [18,3,4,18,9,6,16]
  HandleBatchManifestV1: ['schema', 'batch_id', 'authorization_id', 'descriptor_transfer_capability_id',
    'operation_capability_id', 'provider_session_id', 'root_generation_id', 'coordination_root_id',
    'actor_instance_id', 'request_id', 'request_digest', 'transaction_id', 'scope_id', 'entries',
    'entries_digest', 'manifest_digest', 'sent_at', 'auth_tag'],
  HandleBatchEntryV1: ['scm_index', 'role', 'expected_identity_security_digest'],
  HandleBindingV1: ['scm_index', 'role', 'handle_id', 'identity_security_digest'],
  HandleTransferReceiptV1: ['schema', 'batch_id', 'descriptor_transfer_capability_id', 'authorization_id',
    'manifest_digest', 'handle_set_id', 'handle_bindings', 'handle_vector_digest', 'coordination_root_id',
    'request_id', 'request_digest', 'transaction_id', 'scope_id', 'state', 'provider_session_id',
    'root_generation_id', 'received_at', 'receipt_auth_tag'],
  HandleTransferNackV1: ['schema', 'descriptor_transfer_capability_id', 'batch_id', 'authorization_id',
    'state', 'code', 'retryable', 'received_at', 'receipt_auth_tag'],
  HandleTransferQueryReceiptV1: ['schema', 'batch_id', 'state', 'receipt', 'close_receipt', 'updated_at'],
  HandleSetCloseReceiptV1: ['schema', 'handle_set_id', 'batch_id', 'handle_vector_digest', 'coordination_root_id',
    'transaction_id', 'scope_id', 'request_id', 'request_digest', 'provider_session_id', 'root_generation_id',
    'reason', 'state', 'close_outcome', 'closed_at', 'receipt_auth_tag'],
};

// PLAN.md D-03/D-04 cross-check: the exact literal count sequences the PLAN's
// own DESIGN-GO checklist asserts, independently reconstructed from the
// registry above (not merely copied) to catch a registry entry miscount.
const EXPECTED_BOOTSTRAP_COUNTS = [15, 5, 5, 6, 5, 6];
const EXPECTED_REQ_RESP_CONTROL_DESCRIPTOR_COUNTS = [14, 15, 7, 11, 5, 8, 12, 5];
const EXPECTED_BATCH_COUNTS = [18, 3, 4, 18, 9, 6, 16];

function assertClosedFrameShape(frameName, value) {
  const expectedKeys = FRAME_KEY_REGISTRY[frameName];
  assert.ok(expectedKeys, 'unknown frame name in test fixture: ' + frameName);
  assert.ok(value && typeof value === 'object', frameName + ' must be a non-null object');
  assert.deepStrictEqual(Object.keys(value).sort(), [...expectedKeys].sort(),
    frameName + ' must have EXACTLY these ' + expectedKeys.length + ' keys (PLAN.md S3.x, no additionalProperties)');
}

function fixtureFor(frameName, overrides) {
  const base = {};
  for (const key of FRAME_KEY_REGISTRY[frameName]) base[key] = 'fixture-value';
  return Object.assign(base, overrides || {});
}

test('registry self-check: bootstrap/req-resp-control-descriptor/batch key counts equal PLAN.md D-03/D-04 literal sequences', () => {
  const bootstrapCounts = ['ProviderBootstrapPreludeV1', 'ProviderBootstrapHelloEnvelopeV1', 'ClockProbeV1',
    'ClockSampleV1', 'ClockCommitV1', 'ClockCommitAckV1'].map((n) => FRAME_KEY_REGISTRY[n].length);
  assert.deepStrictEqual(bootstrapCounts, EXPECTED_BOOTSTRAP_COUNTS, 'bootstrap frame key counts must equal PLAN.md D-03 (15/5/5/6/5/6)');

  const reqRespControlDescriptorCounts = ['ProviderRequestV3', 'ProviderResponseV3', 'ClientHelloV3',
    'ServerHelloV3', 'ClientFinishedV3', 'DescriptorClientHelloV2', 'DescriptorServerHelloV2',
    'DescriptorClientFinishedV2'].map((n) => FRAME_KEY_REGISTRY[n].length);
  assert.deepStrictEqual(reqRespControlDescriptorCounts, EXPECTED_REQ_RESP_CONTROL_DESCRIPTOR_COUNTS,
    'request/response/control/descriptor key counts must equal PLAN.md D-04 (14/15/7/11/5/8/12/5)');

  const batchCounts = ['HandleBatchManifestV1', 'HandleBatchEntryV1', 'HandleBindingV1',
    'HandleTransferReceiptV1', 'HandleTransferNackV1', 'HandleTransferQueryReceiptV1',
    'HandleSetCloseReceiptV1'].map((n) => FRAME_KEY_REGISTRY[n].length);
  assert.deepStrictEqual(batchCounts, EXPECTED_BATCH_COUNTS, 'descriptor batch key counts must equal PLAN.md D-04 (18/3/4/18/9/6/16)');
});

test('positive fixture: assertClosedFrameShape accepts the exact frozen shape for every registered frame', () => {
  for (const frameName of Object.keys(FRAME_KEY_REGISTRY)) {
    assertClosedFrameShape(frameName, fixtureFor(frameName));
  }
});

test('negative control: assertClosedFrameShape rejects ProviderHelloV3 missing "state" (13 -> 12 keys)', () => {
  const fixture = fixtureFor('ProviderHelloV3');
  delete fixture.state; // mutated: watched cardinality
  assert.throws(() => assertClosedFrameShape('ProviderHelloV3', fixture), assert.AssertionError,
    'validator must reject ProviderHelloV3 with any key missing (PLAN.md S3.3: no fourteenth key, no missing key)');
});

test('negative control: assertClosedFrameShape rejects ProviderHelloV3 with an added correlation_id (13 -> 14 keys)', () => {
  const fixture = fixtureFor('ProviderHelloV3', { correlation_id: 'nope' }); // mutated: watched extra-key invariant
  assert.throws(() => assertClosedFrameShape('ProviderHelloV3', fixture), assert.AssertionError,
    'validator must reject an added correlation_id on ProviderHelloV3 (PLAN.md S3.3: "There is no correlation_id... in this tuple")');
});

test('negative control: assertClosedFrameShape rejects ClockCommitV1 with an inlined round_index (5 -> 6 keys)', () => {
  const fixture = fixtureFor('ClockCommitV1', { round_index: 1 }); // mutated: watched closed-set property
  assert.throws(() => assertClosedFrameShape('ClockCommitV1', fixture), assert.AssertionError,
    'validator must reject any key outside ClockCommitV1\'s closed 5-key set (PLAN.md S3.2)');
});

test('negative control: assertClosedFrameShape rejects HandleBatchEntryV1 missing "role" (3 -> 2 keys)', () => {
  const fixture = fixtureFor('HandleBatchEntryV1');
  delete fixture.role; // mutated: watched cardinality
  assert.throws(() => assertClosedFrameShape('HandleBatchEntryV1', fixture), assert.AssertionError,
    'validator must reject HandleBatchEntryV1 with any key missing (PLAN.md S3.7)');
});

test('negative control: assertClosedFrameShape rejects ServerHelloV3 with a stray auth_tag (11 -> 12 keys)', () => {
  const fixture = fixtureFor('ServerHelloV3', { auth_tag: 'nope' }); // mutated: watched invariant
  assert.throws(() => assertClosedFrameShape('ServerHelloV3', fixture), assert.AssertionError,
    'validator must reject an added auth_tag on ServerHelloV3 (PLAN.md S3.5: "ClientHelloV3 and ServerHelloV3 have '
    + 'no per-frame auth_tag; their authentication is the frozen transcript/KDF/Finished exchange")');
});

// ---------------------------------------------------------------------------
// PLAN.md S3.7 `DescriptorBatchHeaderV1 [12 bytes]` -- fixed binary header:
// ASCII("ACDH") || uint8(1) || uint8(1 /* SCOPE_HANDLES */) || uint16_be(3) ||
// uint32_be(manifest_byte_length).
// ---------------------------------------------------------------------------
function buildDescriptorBatchHeaderV1(manifestByteLength) {
  const buf = Buffer.alloc(12);
  buf.write('ACDH', 0, 'ascii');
  buf.writeUInt8(1, 4); // version
  buf.writeUInt8(1, 5); // kind: SCOPE_HANDLES
  buf.writeUInt16BE(3, 6); // exactly three accredited directory FDs
  buf.writeUInt32BE(manifestByteLength, 8);
  return buf;
}

function assertDescriptorBatchHeaderV1(buf, expectedManifestByteLength) {
  assert.strictEqual(buf.length, 12, 'DescriptorBatchHeaderV1 must be EXACTLY 12 bytes (PLAN.md S3.7)');
  assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'ACDH', 'header magic must be ASCII "ACDH"');
  assert.strictEqual(buf.readUInt8(4), 1, 'header version must be 1');
  assert.strictEqual(buf.readUInt8(5), 1, 'header kind must be 1 (SCOPE_HANDLES)');
  assert.strictEqual(buf.readUInt16BE(6), 3, 'header FD count must be exactly 3 (three accredited directory FDs)');
  assert.strictEqual(buf.readUInt32BE(8), expectedManifestByteLength, 'header manifest_byte_length must match the actual manifest length');
}

test('positive fixture: buildDescriptorBatchHeaderV1/assertDescriptorBatchHeaderV1 round-trip the exact 12-byte header', () => {
  const header = buildDescriptorBatchHeaderV1(256);
  assertDescriptorBatchHeaderV1(header, 256);
});

test('negative control: assertDescriptorBatchHeaderV1 rejects a corrupted magic (ACDH -> ACDX)', () => {
  const header = buildDescriptorBatchHeaderV1(256);
  header.write('X', 3, 'ascii'); // mutated: watched magic bytes
  assert.throws(() => assertDescriptorBatchHeaderV1(header, 256), assert.AssertionError,
    'validator must reject any header not starting with the exact ASCII "ACDH" magic');
});

test('negative control: assertDescriptorBatchHeaderV1 rejects a wrong FD count (3 -> 2)', () => {
  const header = buildDescriptorBatchHeaderV1(256);
  header.writeUInt16BE(2, 6); // mutated: watched fixed count
  assert.throws(() => assertDescriptorBatchHeaderV1(header, 256), assert.AssertionError,
    'validator must reject any header FD count other than the fixed 3 (PLAN.md S3.7: "exactly three int FDs")');
});

// ---------------------------------------------------------------------------
// PLAN.md S11.2 `WIRE-CAP-*` -- the three frame-class byte caps (PLAN.md
// S3.1's table) are pure constants, independent of whichever internal API
// `runtime-r33-wire.cjs` eventually exposes them through, so this family is
// authored here as a self-contained, ALWAYS-RUN oracle (no `skip` gate
// needed) exactly like this file's frame-shape registry above.
// ---------------------------------------------------------------------------
const FRAME_CLASS_CAPS = {
  BOOTSTRAP_AND_CONTROL_DESCRIPTOR_PREFRAMES: 4096,
  CLOCK_COMMIT_AND_PROVIDER_REQUEST_RESPONSE: 16777216,
  DESCRIPTOR_REPLY_PAYLOAD: 8192,
};

function assertFrameWithinCap(frameClass, byteLength) {
  const cap = FRAME_CLASS_CAPS[frameClass];
  assert.ok(cap !== undefined, 'unknown frame class: ' + frameClass);
  assert.ok(byteLength >= 1 && byteLength <= cap,
    frameClass + ' frame of ' + byteLength + ' bytes must be within 1..' + cap + ' (PLAN.md S3.1)');
}

test('positive fixture: assertFrameWithinCap accepts the exact frozen three frame-class caps at their boundary', () => {
  assertFrameWithinCap('BOOTSTRAP_AND_CONTROL_DESCRIPTOR_PREFRAMES', 4096);
  assertFrameWithinCap('CLOCK_COMMIT_AND_PROVIDER_REQUEST_RESPONSE', 16777216);
  assertFrameWithinCap('DESCRIPTOR_REPLY_PAYLOAD', 8192);
  assertFrameWithinCap('BOOTSTRAP_AND_CONTROL_DESCRIPTOR_PREFRAMES', 1); // minimum
});

test('negative control: assertFrameWithinCap rejects cap+1 for every frame class (mutated: watched boundary, one byte over)', () => {
  for (const [frameClass, cap] of Object.entries(FRAME_CLASS_CAPS)) {
    assert.throws(() => assertFrameWithinCap(frameClass, cap + 1), assert.AssertionError,
      frameClass + ' must reject exactly cap+1 (' + (cap + 1) + ' bytes)');
  }
});

test('negative control: assertFrameWithinCap rejects a bootstrap-class byte length crossing into the request/response cap (mutated: watched per-class cap, not a shared global cap)', () => {
  assert.throws(() => assertFrameWithinCap('BOOTSTRAP_AND_CONTROL_DESCRIPTOR_PREFRAMES', 5000),
    assert.AssertionError, 'a bootstrap preframe of 5000 bytes must be rejected -- the 16,777,216 cap belongs only to the clock-commit/request/response class, never bootstrap preframes (PLAN.md S3.1)');
});

// ---------------------------------------------------------------------------
// First RED (PLAN.md "Test Matrices" S11.1). Exact sentinel name required by
// the eight-name RED set. `runtime-r33-wire.cjs`'s internal JS export surface
// is implementation-defined (not frozen by the PLAN beyond the wire-byte
// contract exercised above), so this sentinel's genuine, PLAN-derived
// obligation is existence/loadability of both row-10 and row-8 modules --
// which genuinely fails today because neither exists yet.
//
// OPEN DESIGN QUESTION (reported to team-lead/arch-testing, not silently
// dropped): the deeper WIRE-SHAPE-*/WIRE-AUTH-* behavioral matrix (every
// one-key mutation rejected on the wire, every bootstrap domain/HMAC tag,
// both transcript Finished chains) requires either (a) calling into
// `runtime-r33-wire.cjs`'s own encode/decode functions, whose names PLAN.md
// S3 deliberately does not fix (unlike the closed native ABI in S2.3), or (b)
// a full socket exchange with a real spawned child, which itself requires
// the native `makeSocketpairStream()` export (row 6/7, also absent) to
// construct a genuine AF_UNIX socketpair for slot 5 -- a plain OS pipe stand
// -in (as used in r33-provider-child.test.js's structural smoke tests) is
// insufficient because `adoptInheritedConn`/`peerCred` require real socket
// semantics. Until WP3-WIRE either documents its chosen internal API or a
// decision is made to exercise this matrix only through the real socketpair
// once WP3-ABI lands, these two families are not authored as guessed-API
// tests here to avoid a naming mismatch masquerading as a false contract RED.
// ---------------------------------------------------------------------------
test('R33-RED-WIRE-ABSENT', () => {
  const wireMod = require(WIRE_MODULE_PATH);
  assert.ok(wireMod && (typeof wireMod === 'object' || typeof wireMod === 'function'),
    'scripts/lib/runtime-r33-wire.cjs (Path-Manifest row 10) must exist and export a non-empty module '
    + '(PLAN.md S3: closed wire contract encode/decode/frame helpers)');

  const providerChildMod = require(PROVIDER_CHILD_MODULE_PATH);
  assert.ok(providerChildMod !== undefined,
    'scripts/lib/runtime-r33-provider.cjs (Path-Manifest row 8) must exist alongside the wire module '
    + '(PLAN.md S2.3: the sealed child entrypoint that performs the Prelude->Hello exchange over it)');
});
