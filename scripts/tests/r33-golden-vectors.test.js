#!/usr/bin/env node
'use strict';

// WP3-RED first-RED sentinel + shape-oracle suite for the R33 native-provider
// golden-vector digest formulas. Frozen contract source: PLAN.md "Canonical
// R33 Native-Provider Production Contract" S3.1 "Encoding, parsing, and
// scalar grammar" (canonical(x), LP(x)), S3.2 (`bootstrap_prelude_digest`,
// `bootstrapFrameAuth`), S3.4 (`request_digest`), S3.7 (`entries_digest`,
// `manifest_digest`). Path-Manifest row 19 (this file) targets row 10
// `scripts/lib/runtime-r33-wire.cjs` and row 11
// `scripts/lib/runtime-r33-golden.cjs` (both toolkit-specialist-owned,
// WP3-WIRE, absent as of this commit).
//
// SCOPE (dispatch: test-specialist, WP3-RED ONLY): the currently-FAILING
// deliverable is the ONE named sentinel below, `R33-RED-GOLDEN-ABSENT`
// (PLAN.md S11.1's eight-name RED set). Cross-checking the REAL production
// golden generator's byte-exact output against this file's independent
// oracle (below) requires calling into `runtime-r33-golden.cjs`'s own
// generator function(s), whose name(s) PLAN.md S3 deliberately does not fix
// (unlike the closed native ABI in S2.3) -- this is the SAME open design
// question flagged in `r33-wire-protocol.test.js` (guessing an unspecified
// API risks a naming mismatch masquerading as a false contract RED). Once
// WP3-WIRE documents its chosen generator API, the cross-check wiring is a
// small addition against the oracle already below.
//
// This file ships a PASSING, independent, PLAN-derived reference-oracle
// reimplementation of the exact canonical()/LP()/domain-separated-SHA256
// construction rules (S3.1/S3.2/S3.4/S3.7), with negative controls for
// exactly the failure classes PLAN.md S11.2 calls out by name: "LP omission
// on either leg, missing NUL domain separator, ... unsorted keys, wrong auth
// domain". These PASS today and are explicitly NOT part of the required
// eight-name failing set; the real WP3-WIRE golden generator's eventual
// output can be cross-checked against this same oracle.

const assert = require('node:assert');
const { test } = require('node:test');
const crypto = require('node:crypto');
const path = require('node:path');

const GOLDEN_MODULE_PATH = path.resolve(__dirname, '../lib/runtime-r33-golden.cjs'); // Path-Manifest row 11
const WIRE_MODULE_PATH = path.resolve(__dirname, '../lib/runtime-r33-wire.cjs'); // Path-Manifest row 10

// ---------------------------------------------------------------------------
// PLAN.md S3.1 `canonical(x)` -- "existing byte-for-byte sorted-key canonical
// JSON" -- and `LP(x)=uint32_be(byte_length(x))||x`. Pure, independent
// reimplementation (no dependency on production code) used solely as a
// reference oracle for the byte-construction RULES the real golden generator
// must also satisfy.
// ---------------------------------------------------------------------------
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

function lp(buf) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// PLAN.md S3.4: `request_digest = SHA256(UTF8(canonical(ProviderRequestV3 without auth_tag)))`.
// No domain separator, no LP -- the simplest of the family, isolating
// canonical() correctness from domain-separation/framing correctness.
function requestDigestHex(recordWithoutAuthTag) {
  return sha256Hex(Buffer.from(canonicalJson(recordWithoutAuthTag), 'utf8'));
}

// PLAN.md S3.2: `bootstrap_prelude_digest = SHA256(UTF8(domain) || 0x00 || LP(UTF8(canonical(record))))`.
function domainSeparatedDigestWithLpHex(domain, record) {
  return sha256Hex(Buffer.concat([
    Buffer.from(domain, 'utf8'),
    Buffer.from([0x00]),
    lp(Buffer.from(canonicalJson(record), 'utf8')),
  ]));
}

// PLAN.md S3.7: `entries_digest = SHA256(UTF8(domain) || 0x00 || UTF8(canonical(entries)))`.
// Deliberately NO LP -- distinct from the prelude-digest family above.
function domainSeparatedDigestNoLpHex(domain, value) {
  return sha256Hex(Buffer.concat([
    Buffer.from(domain, 'utf8'),
    Buffer.from([0x00]),
    Buffer.from(canonicalJson(value), 'utf8'),
  ]));
}

test('positive fixture: canonicalJson is key-order-independent (sorted-key canonical JSON, PLAN.md S3.1)', () => {
  const a = canonicalJson({ b: 2, a: 1, c: { z: 9, y: 8 } });
  const b = canonicalJson({ a: 1, c: { y: 8, z: 9 }, b: 2 });
  assert.strictEqual(a, b, 'canonicalJson must produce byte-identical output regardless of input key order');
  assert.strictEqual(a, '{"a":1,"b":2,"c":{"y":8,"z":9}}');
});

test('positive fixture: canonicalJson is deterministic across repeated calls', () => {
  const fixture = { schema: 'runtime/provider-client-hello/v3', capability_id: 'a'.repeat(32), client_nonce: 'x'.repeat(43) };
  assert.strictEqual(canonicalJson(fixture), canonicalJson(fixture));
});

test('negative control: naive JSON.stringify (canonicalization disabled) is NOT key-order-independent, unlike canonicalJson', () => {
  const x = { b: 2, a: 1 };
  const y = { a: 1, b: 2 };
  assert.notStrictEqual(JSON.stringify(x), JSON.stringify(y), // mutated: watched property (key-sorting disabled)
    'a naive stringify without key-sorting is expected to differ by key order -- this is exactly the defect canonicalJson exists to prevent');
  assert.strictEqual(canonicalJson(x), canonicalJson(y), 'canonicalJson must remain order-independent for the identical two fixtures');
});

test('positive fixture: requestDigestHex changes when the record payload changes (no constant-function collision)', () => {
  const base = { schema: 'runtime/transition-lock-provider-request/v3', seq: '1', method: 'hello' };
  const changed = Object.assign({}, base, { seq: '2' });
  const d1 = requestDigestHex(base);
  const d2 = requestDigestHex(changed);
  assert.notStrictEqual(d1, d2, 'changing one field must change the digest');
  assert.strictEqual(d1, requestDigestHex(base), 'the same exact record must reproduce the identical digest (determinism)');
  assert.match(d1, /^[0-9a-f]{64}$/, 'digest must be 64-lowercase-hex sha256');
});

test('negative control: LP omission on either leg changes the digest (PLAN.md S11.2 named negative)', () => {
  const domain = 'runtime/provider-bootstrap-prelude/v1';
  const record = { schema: 'runtime/provider-bootstrap-prelude/v1', provider_abi: 3 };
  const withLp = domainSeparatedDigestWithLpHex(domain, record);
  const withoutLp = domainSeparatedDigestNoLpHex(domain, record); // mutated: watched LP-framing property, deliberately omitted
  assert.notStrictEqual(withLp, withoutLp,
    'a bootstrap_prelude_digest computed WITHOUT the required LP() framing (S3.2) must not silently collide with the correctly-framed digest');
});

test('negative control: a missing NUL domain separator changes the digest', () => {
  const domain = 'runtime/handle-batch-entries/v1';
  const entries = [{ scm_index: 0, role: 'subject-worktree-root', expected_identity_security_digest: 'a'.repeat(64) }];
  const withNul = domainSeparatedDigestNoLpHex(domain, entries);
  const withoutNulBuf = Buffer.concat([Buffer.from(domain, 'utf8'), Buffer.from(canonicalJson(entries), 'utf8')]); // mutated: watched 0x00 separator, omitted
  const withoutNul = sha256Hex(withoutNulBuf);
  assert.notStrictEqual(withNul, withoutNul,
    'entries_digest (S3.7) computed without the mandatory 0x00 domain separator must not collide with the correctly-separated digest');
});

test('negative control: wrong auth domain (bootstrap prelude vs. hello-envelope) changes the digest for the identical payload', () => {
  const record = { schema: 'runtime/provider-bootstrap-prelude/v1', provider_abi: 3 };
  const preludeDigest = domainSeparatedDigestWithLpHex('runtime/provider-bootstrap-prelude/v1', record);
  const wrongDomainDigest = domainSeparatedDigestWithLpHex('runtime/provider-bootstrap-hello-envelope/v1', record); // mutated: watched domain string
  assert.notStrictEqual(preludeDigest, wrongDomainDigest,
    'PLAN.md S3.2: "The domains are exactly each frame\'s schema plus /auth" -- swapping the domain for an identical payload must never collide');
});

test('negative control: entries_digest and manifest_digest formulas (both no-LP, S3.7) are not interchangeable despite the same shape rule', () => {
  const entries = [{ scm_index: 0, role: 'git-common-dir', expected_identity_security_digest: 'b'.repeat(64) }];
  const asEntriesDigest = domainSeparatedDigestNoLpHex('runtime/handle-batch-entries/v1', entries);
  const asManifestDigest = domainSeparatedDigestNoLpHex('runtime/handle-batch-manifest/v1', entries); // mutated: watched domain (record-vs-receipt-family digest confusion)
  assert.notStrictEqual(asEntriesDigest, asManifestDigest,
    'PLAN.md S11.2 named negative "record-vs-receipt digest confusion": distinct domains over the same bytes must never collide');
});

// ---------------------------------------------------------------------------
// First RED (PLAN.md "Test Matrices" S11.1). Exact sentinel name required by
// the eight-name RED set. Genuinely fails today because
// `scripts/lib/runtime-r33-golden.cjs` (and its `runtime-r33-wire.cjs`
// dependency) do not exist yet -- honest first-RED absence, not an
// instrument defect.
// ---------------------------------------------------------------------------
test('R33-RED-GOLDEN-ABSENT', () => {
  const goldenMod = require(GOLDEN_MODULE_PATH);
  assert.ok(goldenMod !== undefined,
    'scripts/lib/runtime-r33-golden.cjs (Path-Manifest row 11) must exist before its generator can be cross-checked '
    + 'against this file\'s independent canonical()/LP()/domain-separated-digest oracle (PLAN.md S3, S11.2 GOLDEN-*)');

  const wireMod = require(WIRE_MODULE_PATH);
  assert.ok(wireMod !== undefined,
    'scripts/lib/runtime-r33-wire.cjs (Path-Manifest row 10) must exist alongside the golden generator '
    + '(PLAN.md S3: the golden vectors describe bytes produced by the wire layer)');
});
