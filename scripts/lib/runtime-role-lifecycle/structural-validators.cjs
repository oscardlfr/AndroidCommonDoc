'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: generic
// closed/allowed key-set checks shared across every registry record family,
// plus the WP3 test-capability gate (mirrors runtime-consultation.cjs's own
// isTestCapability()/RUNTIME_CONSULTATION_TEST_CAPABILITY pattern exactly).
// Never requires the facade or a sibling module.

function createStructuralValidators({}) {
/** Exact, order-independent key-set closure -- no extra, no missing. */
function hasExactKeys(obj, sortedExpectedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const actual = Object.keys(obj).sort();
  if (actual.length !== sortedExpectedKeys.length) return false;
  return actual.every((k, i) => k === sortedExpectedKeys[i]);
}

// Role-binding records have a legitimately variable optional-field shape
// (driver/respawn_count/pending_action_id/team_ensure_action_id/
// failure_reason/updated_at all depend on which transition produced them)
// -- closed here means "no key outside this allowed superset", not an exact
// set. Canonical home for this constant/checker; runtime-bridge-codex.cjs
// imports both rather than keeping its own duplicate.
const ROLE_BINDING_ALLOWED_KEYS = Object.freeze([
  'binding_id', 'created_at', 'driver', 'failure_reason', 'pending_action_id',
  'plan_digest', 'profile_digest', 'respawn_count', 'role', 'schema',
  'session_generation_id', 'state', 'stop_reason', 'team_ensure_action_id', 'updated_at', 'worktree_id',
]);

function hasOnlyAllowedKeys(obj, sortedAllowedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.keys(obj).every((k) => sortedAllowedKeys.includes(k));
}

function validateExpectedRecordFields(record, expected) {
  if (!expected) return true;
  return Object.keys(expected).every((key) => record[key] === expected[key]);
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: Test capability gate (mirrors runtime-consultation.cjs's own
// isTestCapability()/RUNTIME_CONSULTATION_TEST_CAPABILITY pattern exactly).
// ─────────────────────────────────────────────────────────────────────────────

function isTestCapability() {
  return (
    process.env.NODE_ENV === 'test'
    && typeof process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY === 'string'
    && process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY.length > 0
  );
}

const EXECUTOR_CAPABILITY_ENV = 'RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY';

function isFakeExecutorCapability() {
  return isTestCapability()
    && typeof process.env[EXECUTOR_CAPABILITY_ENV] === 'string'
    && process.env[EXECUTOR_CAPABILITY_ENV].length > 0;
}

  return Object.freeze({
    hasExactKeys, ROLE_BINDING_ALLOWED_KEYS, hasOnlyAllowedKeys, validateExpectedRecordFields,
    isTestCapability, EXECUTOR_CAPABILITY_ENV, isFakeExecutorCapability,
  });
}

module.exports = { createStructuralValidators };
