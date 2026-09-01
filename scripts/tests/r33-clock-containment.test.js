#!/usr/bin/env node
'use strict';

// WP3-RED first-RED sentinel + shape-oracle suite for the R33 native-provider
// continuous-clock containment algorithm. Frozen contract source: PLAN.md
// "Canonical R33 Native-Provider Production Contract" S4.3 "Step 8
// containment algorithm", S1.1 "Narrow clock/outcome reconciliation", S6.2
// "Exact irreversible cut". Path-Manifest row 18 (this file) targets row 9
// `scripts/lib/runtime-r33-composition.cjs` (toolkit-specialist-owned,
// WP3-COMPOSITION, absent as of this commit) -- the manager-side module that
// executes steps 1-18, including the step-8 containment loop under test here.
//
// SCOPE (dispatch: test-specialist, WP3-RED ONLY): the currently-FAILING
// deliverable is the ONE named sentinel below, `R33-RED-CLOCK-ABSENT`
// (PLAN.md S11.1's eight-name RED set). The full CLOCK-* matrix against a
// REAL spawned provider and REAL continuous clock requires the COMPLETE
// rows-1-11 stack (native addon + wire + composition), not merely row 9's
// own existence -- a genuine end-to-end containment exchange cannot be
// gated on this file's target alone. Once that complete stack lands, this
// file adds one skip-gated existence/factory-contract check (below,
// consistent with `r33-authority-positive.test.js`'s deeper input-validation
// coverage of the same row 9 factory) and the reusable self-contained oracle
// below remains available for WP3-COMPOSITION's real GREEN-phase test to
// cross-check its live containment receipt against.
//
// This file ships a PASSING, deterministic, PLAN-derived reference-oracle
// reimplementation of the exact S4.3 round-selection pseudocode (no clock,
// no socket, no process -- pure arithmetic over injected round fixtures) plus
// negative controls for its two watched invariants (the 100ms containment
// window; the "stop at exactly three recorded passes" cardinality), and a
// small classifier for the S1.1 pre/post-cut outcome split. These PASS today
// and are explicitly NOT part of the required eight-name failing set; they
// become the reusable independent oracle WP3-COMPOSITION's real GREEN-phase
// test can cross-check its live containment receipt against.

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const COMPOSITION_MODULE_PATH = path.resolve(__dirname, '../lib/runtime-r33-composition.cjs'); // Path-Manifest row 9

function compositionExists() {
  return fs.existsSync(COMPOSITION_MODULE_PATH);
}

const COMPOSITION_ABSENT_SKIP_REASON = 'scripts/lib/runtime-r33-composition.cjs (row 9) does not exist yet -- WP3-COMPOSITION dependency; this case is structured to un-skip and execute once it does';

const CONTAINMENT_WINDOW_NS = 100_000_000; // PLAN.md S4.3: round_trip <= 100_000_000
const MAX_ATTEMPTS = 8;
const REQUIRED_PASSES = 3;

/**
 * Pure reference reimplementation of PLAN.md S4.3's round-selection
 * pseudocode. `rounds` is an ordered array of up to eight fixtures:
 *   { managerBeforeNs, providerSampleNs, managerAfterNs, terminal? }
 * A `terminal` field (any truthy string) simulates "timeout, EOF, malformed,
 * auth/correlation/index mismatch, noncanonical MonoNs, or clock regression"
 * (S4.3: "never round-retryable; it immediately stops the root").
 */
function simulateClockContainment(rounds) {
  const recorded = [];
  const attempted = rounds.slice(0, MAX_ATTEMPTS);
  for (const round of attempted) {
    if (round.terminal) {
      return { stopped: true, reason: round.terminal, recorded };
    }
    const roundTripNs = round.managerAfterNs - round.managerBeforeNs;
    assert.ok(roundTripNs >= 0, 'checked_sub: managerAfterNs must never precede managerBeforeNs');
    const contained = round.managerBeforeNs <= round.providerSampleNs && round.providerSampleNs <= round.managerAfterNs;
    const withinWindow = roundTripNs <= CONTAINMENT_WINDOW_NS;
    if (contained && withinWindow) {
      recorded.push({ managerBeforeNs: round.managerBeforeNs, providerSampleNs: round.providerSampleNs, managerAfterNs: round.managerAfterNs, roundTripNs });
      if (recorded.length === REQUIRED_PASSES) break;
    }
  }
  if (recorded.length !== REQUIRED_PASSES) {
    return { stopped: true, reason: 'INSUFFICIENT_ROUNDS', recorded };
  }
  return {
    stopped: false,
    probeRoundCount: REQUIRED_PASSES,
    containmentPassCount: REQUIRED_PASSES,
    bestRoundTripNs: Math.min(...recorded.map((r) => r.roundTripNs)),
    accreditedMonotonicNs: recorded[REQUIRED_PASSES - 1].providerSampleNs, // PLAN.md S4.3: recorded[2].provider_sample_ns
    recorded,
  };
}

function threeCleanPassingRounds(startNs) {
  const rounds = [];
  for (let i = 0; i < 3; i += 1) {
    const base = startNs + i * 1000;
    rounds.push({ managerBeforeNs: base, providerSampleNs: base + 5, managerAfterNs: base + 10 });
  }
  return rounds;
}

test('positive fixture: simulateClockContainment records exactly three passing rounds and stops at the third', () => {
  const result = simulateClockContainment(threeCleanPassingRounds(1_000_000));
  assert.strictEqual(result.stopped, false);
  assert.strictEqual(result.recorded.length, 3, 'exactly three rounds must be recorded (PLAN.md S4.3)');
  assert.strictEqual(result.probeRoundCount, 3);
  assert.strictEqual(result.containmentPassCount, 3);
  assert.strictEqual(result.bestRoundTripNs, 10, 'best_round_trip_ns must be min(round_trip_ns) over the recorded rounds');
  assert.strictEqual(result.accreditedMonotonicNs, result.recorded[2].providerSampleNs,
    'accredited_monotonic_ns must equal recorded[2].provider_sample_ns exactly (PLAN.md S4.3)');
});

test('positive fixture: simulateClockContainment consumes failing rounds without recording, then recovers within eight attempts', () => {
  const rounds = [
    { managerBeforeNs: 100, providerSampleNs: 50, managerAfterNs: 200 }, // fails containment (sample before manager_before)
    { managerBeforeNs: 300, providerSampleNs: 305, managerAfterNs: 300 + CONTAINMENT_WINDOW_NS + 1 }, // fails window (1ns over cap)
    ...threeCleanPassingRounds(2_000_000),
  ];
  const result = simulateClockContainment(rounds);
  assert.strictEqual(result.stopped, false);
  assert.strictEqual(result.recorded.length, 3, 'only the three genuinely passing rounds are recorded; the two failed attempts consume an index without being recorded');
});

test('negative control: simulateClockContainment never recovers when EVERY attempt exceeds the 100ms window (mutated: watched CONTAINMENT_WINDOW_NS property)', () => {
  const rounds = [];
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const base = 1000 + i * 10_000;
    // round_trip = CONTAINMENT_WINDOW_NS + 1: exactly one nanosecond over the frozen cap on every attempt.
    rounds.push({ managerBeforeNs: base, providerSampleNs: base + 1, managerAfterNs: base + CONTAINMENT_WINDOW_NS + 1 });
  }
  const result = simulateClockContainment(rounds);
  assert.strictEqual(result.stopped, true, 'eight consecutive over-window rounds must never satisfy the three-pass requirement');
  assert.strictEqual(result.reason, 'INSUFFICIENT_ROUNDS');
  assert.strictEqual(result.recorded.length, 0, 'zero rounds may be recorded once every attempt violates the containment window');
});

test('boundary: simulateClockContainment accepts round_trip == 100_000_000 exactly and rejects 100_000_001', () => {
  const atCap = simulateClockContainment([
    { managerBeforeNs: 0, providerSampleNs: 1, managerAfterNs: CONTAINMENT_WINDOW_NS },
    ...threeCleanPassingRounds(5_000_000).slice(0, 2),
  ]);
  assert.strictEqual(atCap.recorded.length, 3, 'round_trip_ns == 100_000_000 (the exact cap) must count as passing (PLAN.md S4.3: "<=")');

  const overCap = simulateClockContainment([
    { managerBeforeNs: 0, providerSampleNs: 1, managerAfterNs: CONTAINMENT_WINDOW_NS + 1 },
  ]);
  assert.strictEqual(overCap.recorded.length, 0, 'round_trip_ns == 100_000_001 must NOT count as passing');
});

test('negative control: simulateClockContainment immediately stops on a terminal fault, never round-retryable', () => {
  const rounds = [
    { managerBeforeNs: 0, providerSampleNs: 1, managerAfterNs: 2, terminal: 'CLOCK_REGRESSION' }, // mutated: watched terminal-fault property
    ...threeCleanPassingRounds(9_000_000), // must NEVER be reached
  ];
  const result = simulateClockContainment(rounds);
  assert.strictEqual(result.stopped, true);
  assert.strictEqual(result.reason, 'CLOCK_REGRESSION');
  assert.strictEqual(result.recorded.length, 0, 'a terminal fault must stop the root immediately, consuming no further rounds');
});

// ---------------------------------------------------------------------------
// PLAN.md S1.1 "Narrow clock/outcome reconciliation" -- the exact two-row
// pre-cut/post-cut outcome split this design reconciles (narrowly replacing
// only these two named R3.3 rows, per S1.1's own table).
// ---------------------------------------------------------------------------
function classifyClockFailureOutcome({ cutCrossed, writable }) {
  if (!cutCrossed) {
    return 'UNAVAILABLE/DRIVER_UNAVAILABLE';
  }
  return writable ? 'FINAL/STOPPED/ROOT_GENERATION_STOP' : 'STOPPED';
}

test('positive fixture: classifyClockFailureOutcome maps pre-cut failure to UNAVAILABLE/DRIVER_UNAVAILABLE', () => {
  assert.strictEqual(classifyClockFailureOutcome({ cutCrossed: false, writable: true }), 'UNAVAILABLE/DRIVER_UNAVAILABLE');
});

test('positive fixture: classifyClockFailureOutcome maps post-cut writable failure to FINAL/STOPPED/ROOT_GENERATION_STOP', () => {
  assert.strictEqual(classifyClockFailureOutcome({ cutCrossed: true, writable: true }), 'FINAL/STOPPED/ROOT_GENERATION_STOP');
});

test('negative control: classifyClockFailureOutcome must never report UNAVAILABLE once the cut is crossed (mutated: cutCrossed=true, writable=false)', () => {
  const outcome = classifyClockFailureOutcome({ cutCrossed: true, writable: false });
  assert.notStrictEqual(outcome, 'UNAVAILABLE/DRIVER_UNAVAILABLE',
    'PLAN.md S1.1: once the cut is crossed, the same observation is NEVER UNAVAILABLE again, regardless of writability');
  assert.strictEqual(outcome, 'STOPPED');
});

test('CLOCK-BOOTSTRAP-EXISTS: row 9 exposes the frozen createR33ProviderComposition factory the step-8 loop runs inside (PLAN.md S5)', { skip: compositionExists() ? false : COMPOSITION_ABSENT_SKIP_REASON }, () => {
  const mod = require(COMPOSITION_MODULE_PATH);
  assert.strictEqual(typeof mod.createR33ProviderComposition, 'function',
    'CLOCK-BOOTSTRAP-EXISTS: scripts/lib/runtime-r33-composition.cjs must export createR33ProviderComposition(hostBridgeCapability) (PLAN.md S5); '
    + 'the genuine 8-round exchange this file models (simulateClockContainment above) additionally requires the complete native addon and wire '
    + 'layers (rows 1-11) to be spawnable, so it is exercised end-to-end by WP3-COMPOSITION\'s own GREEN-phase evidence, not gated on this check alone');
});

// ---------------------------------------------------------------------------
// First RED (PLAN.md "Test Matrices" S11.1). Exact sentinel name required by
// the eight-name RED set. Genuinely fails today because
// `scripts/lib/runtime-r33-composition.cjs` does not exist yet -- honest
// first-RED absence, not an instrument defect. (The full positive-call
// exercise of `createR33ProviderComposition` against this same row lives in
// `r33-authority-positive.test.js`, PLAN.md S5, to avoid duplicating identical
// assertions across the two files that share row 9.)
// ---------------------------------------------------------------------------
test('R33-RED-CLOCK-ABSENT', () => {
  const mod = require(COMPOSITION_MODULE_PATH);
  assert.ok(mod !== undefined,
    'scripts/lib/runtime-r33-composition.cjs (Path-Manifest row 9) must exist before its step-8 clock '
    + 'containment algorithm (PLAN.md S4.3) can be exercised against a real spawned provider');
});
