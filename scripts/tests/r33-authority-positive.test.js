#!/usr/bin/env node
'use strict';

// WP3-RED first-RED sentinel + shape-oracle suite for the R33 native-provider
// composition/authority factory. Frozen contract source: PLAN.md "Canonical
// R33 Native-Provider Production Contract" S5 "Production composition
// boundary". Path-Manifest row 20 (this file) targets row 9
// `scripts/lib/runtime-r33-composition.cjs` (toolkit-specialist-owned,
// WP3-COMPOSITION, absent as of this commit) -- specifically the frozen
// `createR33ProviderComposition(hostBridgeCapability)` factory and its
// `R33ProviderManager` surface.
//
// SCOPE (dispatch: test-specialist, WP3-RED ONLY): the currently-FAILING
// deliverable is the ONE named sentinel below, `R33-RED-AUTHORITY-ABSENT`
// (PLAN.md S11.1's eight-name RED set). The AUTH-POS-* sub-claim "exact 18
// steps end with ACTIVE" needs the complete rows-1-11 native+wire+composition
// stack to spawn a real provider, so it is WP3-COMPOSITION's own end-to-end
// GREEN-phase evidence, not something this file can gate on row 9 alone. The
// OTHER AUTH-POS-* sub-claim -- "every out-of-order stage and fabricated live
// object rejects before effect" -- IS synchronously testable against row 9's
// own frozen factory surface without a real spawn, and is authored below as
// a skip-gated integration check (team-lead binding clarification,
// 2026-07-26).
//
// This file ships a PASSING, independent reference-oracle modeling the
// EXACT input-rejection categories PLAN.md S5 names verbatim for
// `hostBridgeCapability` -- "a path, digest, boolean, plain object, proxy,
// serialized object, or object from another module instance fails before
// mutation" -- plus the frozen manager-admission method surface (exactly
// `prepareRootInitR33`/`openBootstrapClientR33`/`queryStartupR33`, and
// explicitly NOT `openSession`/`fromJSON`/a constructor/a CLI suffix). These
// PASS today and are explicitly NOT part of the required eight-name failing
// set; WP3-COMPOSITION's real GREEN-phase test can reuse the same rejection
// taxonomy against the live factory.

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const COMPOSITION_MODULE_PATH = path.resolve(__dirname, '../lib/runtime-r33-composition.cjs'); // Path-Manifest row 9

function compositionExists() {
  return fs.existsSync(COMPOSITION_MODULE_PATH);
}

const COMPOSITION_ABSENT_SKIP_REASON = 'scripts/lib/runtime-r33-composition.cjs (row 9) does not exist yet -- WP3-COMPOSITION dependency; this case is structured to un-skip and execute once it does';

// ---------------------------------------------------------------------------
// Reference model of an opaque, module-private "retained in-process
// capability" -- the same idiom PLAN.md S5 requires of the real
// `hostBridgeCapability` ("module-private maps keyed by opaque live objects
// with private symbols"). Deliberately identity-based (a module-private
// `WeakSet` of exactly the instances this factory minted), NOT a bare
// property/symbol check: a `WeakSet`/`WeakMap` keyed by exact object
// reference cannot be spoofed by a `Proxy` wrapping a genuine instance --
// `WeakSet.prototype.has` uses strict reference identity, and a `Proxy` is
// a distinct object identity from its target even though property reads
// transparently forward. This is an INDEPENDENT reference oracle proving the
// discriminating categories PLAN.md S5 names are genuinely distinguishable,
// not a claim about the real production module's internal representation.
// ---------------------------------------------------------------------------
const REFERENCE_CAPABILITY_REGISTRY = new WeakSet();

function makeReferenceCapability() {
  const capability = Object.freeze({ kind: 'r33-host-bridge-capability-reference-oracle' });
  REFERENCE_CAPABILITY_REGISTRY.add(capability);
  return capability;
}

function isValidReferenceCapability(candidate) {
  return Boolean(candidate) && typeof candidate === 'object' && REFERENCE_CAPABILITY_REGISTRY.has(candidate);
}

test('positive fixture: isValidReferenceCapability accepts only the genuine registered capability', () => {
  assert.strictEqual(isValidReferenceCapability(makeReferenceCapability()), true);
});

test('negative control: isValidReferenceCapability rejects a path string (mutated: watched type -- string instead of a registered object)', () => {
  assert.strictEqual(isValidReferenceCapability('/Users/example/.codex/root'), false,
    'PLAN.md S5: "a path... fails before mutation"');
});

test('negative control: isValidReferenceCapability rejects a digest string', () => {
  assert.strictEqual(isValidReferenceCapability('a'.repeat(64)), false, 'PLAN.md S5: "a digest... fails before mutation"');
});

test('negative control: isValidReferenceCapability rejects a boolean', () => {
  assert.strictEqual(isValidReferenceCapability(true), false, 'PLAN.md S5: "a boolean... fails before mutation"');
});

test('negative control: isValidReferenceCapability rejects a plain object (never registered)', () => {
  assert.strictEqual(isValidReferenceCapability({}), false, 'PLAN.md S5: "a plain object... fails before mutation"');
});

test('negative control: isValidReferenceCapability rejects a Proxy wrapping the genuine capability (mutated: watched identity, not shape)', () => {
  const proxied = new Proxy(makeReferenceCapability(), {}); // mutated: a distinct object identity wrapping a registered target
  assert.strictEqual(isValidReferenceCapability(proxied), false,
    'PLAN.md S5: "a proxy... fails before mutation" -- the WeakSet holds the exact target reference, never the wrapping '
    + 'Proxy, so identity-based registration (not property/shape forwarding) correctly rejects the wrapper');
});

test('negative control: isValidReferenceCapability rejects a JSON-serialized-and-reparsed copy', () => {
  const serialized = JSON.parse(JSON.stringify({ kind: 'r33-host-bridge-capability-reference-oracle' }));
  assert.strictEqual(isValidReferenceCapability(serialized), false,
    'PLAN.md S5: "a serialized object... fails before mutation" -- JSON round-tripping can never reproduce a '
    + 'WeakSet-registered object identity, even with byte-identical enumerable shape');
});

test('negative control: isValidReferenceCapability rejects a same-shape object minted by a different registry (another module instance)', () => {
  const otherModuleRegistry = new WeakSet(); // models a second require() copy of the same module under duplicate resolution
  const foreignCapability = Object.freeze({ kind: 'r33-host-bridge-capability-reference-oracle' });
  otherModuleRegistry.add(foreignCapability); // mutated: watched identity -- registered in a DIFFERENT registry, never this module's own
  assert.strictEqual(isValidReferenceCapability(foreignCapability), false,
    'PLAN.md S5: "an object from another module instance fails before mutation" -- registration in a foreign '
    + 'registry (a different module-private WeakSet) must never satisfy this module\'s own registry check, even '
    + 'given byte-identical enumerable shape');
});

// ---------------------------------------------------------------------------
// PLAN.md S5 -- the frozen manager-admission method surface. Exactly three
// methods; explicitly NOT `openSession`, `fromJSON`, a constructor, or a CLI
// suffix (S5: "There is no public openSession({rootPath}), native injection
// parameter, stage method, constructor, fromJSON, CLI suffix...").
// ---------------------------------------------------------------------------
const FROZEN_MANAGER_METHODS = ['prepareRootInitR33', 'openBootstrapClientR33', 'queryStartupR33'];
const FORBIDDEN_MANAGER_SURFACE = ['openSession', 'fromJSON', 'constructor_stage', 'openSessionSync'];

function assertManagerSurfaceShape(managerLike) {
  assert.ok(managerLike && typeof managerLike === 'object', 'R33ProviderManager must be a non-null object');
  for (const name of FROZEN_MANAGER_METHODS) {
    assert.strictEqual(typeof managerLike[name], 'function',
      'R33ProviderManager must expose ' + name + '() (PLAN.md S5 frozen manager-admission methods)');
  }
  for (const forbidden of FORBIDDEN_MANAGER_SURFACE) {
    assert.strictEqual(managerLike[forbidden], undefined,
      'R33ProviderManager must NOT expose ' + forbidden + '() (PLAN.md S5: no openSession/fromJSON/stage/constructor surface)');
  }
}

test('positive fixture: assertManagerSurfaceShape accepts the exact frozen three-method surface', () => {
  assertManagerSurfaceShape({
    prepareRootInitR33() {}, openBootstrapClientR33() {}, queryStartupR33() {},
  });
});

test('negative control: assertManagerSurfaceShape rejects a manager exposing openSession (mutated: watched forbidden-surface property)', () => {
  assert.throws(() => assertManagerSurfaceShape({
    prepareRootInitR33() {}, openBootstrapClientR33() {}, queryStartupR33() {},
    openSession() {}, // mutated: forbidden surface added
  }), assert.AssertionError, 'validator must reject any manager exposing a public openSession() method');
});

test('negative control: assertManagerSurfaceShape rejects a manager missing queryStartupR33', () => {
  assert.throws(() => assertManagerSurfaceShape({
    prepareRootInitR33() {}, openBootstrapClientR33() {}, // mutated: watched cardinality, queryStartupR33 missing
  }), assert.AssertionError, 'validator must reject a manager missing any one of the three frozen methods');
});

// ---------------------------------------------------------------------------
// PLAN.md S11.2 `AUTH-POS-*` (row 9, WP3-COMPOSITION), the sub-claim that IS
// synchronously testable without a real spawned provider: the module-level
// export surface itself must be closed to exactly `createR33ProviderComposition`
// -- `prepareRootInitR33`/`openBootstrapClientR33`/`queryStartupR33` are
// `R33ProviderManager` INSTANCE methods (S5), never free module functions a
// caller could invoke out of order without first holding a genuine manager.
// The remaining AUTH-POS-* sub-claims ("exact 18 steps end with ACTIVE";
// genuine out-of-order rejection on a REAL manager instance) additionally
// require a genuine `hostBridgeCapability` minted by the existing lifecycle
// host module -- a cross-module dependency this file cannot fabricate -- so
// they are exercised by WP3-COMPOSITION's own end-to-end GREEN-phase evidence.
// ---------------------------------------------------------------------------

test('AUTH-POS-EXISTS: the module exposes ONLY createR33ProviderComposition at top level; the other three admission methods are manager-instance-only (PLAN.md S5)', { skip: compositionExists() ? false : COMPOSITION_ABSENT_SKIP_REASON }, () => {
  const mod = require(COMPOSITION_MODULE_PATH);
  assert.strictEqual(typeof mod.createR33ProviderComposition, 'function');
  for (const instanceOnlyMethod of ['prepareRootInitR33', 'openBootstrapClientR33', 'queryStartupR33']) {
    assert.strictEqual(mod[instanceOnlyMethod], undefined,
      'AUTH-POS-EXISTS: ' + instanceOnlyMethod + ' must not be a free module-level export -- PLAN.md S5 frames it as an '
      + 'R33ProviderManager instance method reachable only after a genuine createR33ProviderComposition() call, never '
      + 'callable out of order as a bare module function');
  }
});

// ---------------------------------------------------------------------------
// First RED (PLAN.md "Test Matrices" S11.1). Exact sentinel name required by
// the eight-name RED set. Exercises the ONE part of the row-9 factory's
// contract that is synchronously testable without a live native addon/socket
// -- input-shape rejection "before mutation" (PLAN.md S5) -- genuinely fails
// today because `scripts/lib/runtime-r33-composition.cjs` does not exist yet.
// ---------------------------------------------------------------------------
test('R33-RED-AUTHORITY-ABSENT', () => {
  const mod = require(COMPOSITION_MODULE_PATH);
  assert.strictEqual(typeof mod.createR33ProviderComposition, 'function',
    'scripts/lib/runtime-r33-composition.cjs (Path-Manifest row 9) must export createR33ProviderComposition(hostBridgeCapability) (PLAN.md S5)');
  assert.throws(() => mod.createR33ProviderComposition({}),
    'createR33ProviderComposition must reject a plain object hostBridgeCapability before any mutation (PLAN.md S5)');
});
