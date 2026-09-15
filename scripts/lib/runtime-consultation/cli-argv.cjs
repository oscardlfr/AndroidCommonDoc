'use strict';

// Frozen command-line ABI for runtime-consultation. This module is deliberately
// pure apart from the test-capability read delegated to primitives.cjs.

const path = require('path');
const { CliError, isTestCapability } = require('./primitives.cjs');

const BOOLEAN_FLAGS = Object.freeze(['fixed-ids', 'fixed-clock']);

const ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND = Object.freeze({
  'root-init': 'requester',
  'root-validate': 'requester',
  'publish-blob': 'requester',
  'publish-request': 'requester',
  dispatch: 'requester',
  'record-delivery': 'requester',
  takeover: 'requester',
  'await-result': 'requester',
  'accept-result': 'requester',
  'transaction-ack': 'requester',
  cancel: 'requester',
  'worker-stop': 'requester',
  cleanup: 'requester',
  validate: 'requester',
  claim: 'target',
  'lease-heartbeat': 'target',
  'publish-result': 'target',
  'worker-stop-ack': 'target',
});

const ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY = Object.freeze({
  requester: 'requester-binding',
  target: 'target-binding',
});

/**
 * Per-command closed flag allowlist (Frozen CLI ABI, PLAN.md ~L750: "no WP2 naming
 * latitude" -- every flag name a subcommand accepts is exactly this list; anything
 * else is USAGE_ERROR/INVALID_ARGUMENT, RCC-argv-7). `fixed-ids`/`fixed-clock` are
 * closed test-capability-gated flags accepted UNIFORMLY across every command.
 */
const BASE_COMMAND_FLAGS = {
  'root-init': ['coordination-root'],
  'root-validate': ['coordination-root'],
  validate: ['coordination-root', 'kind', 'artifact'],
  'publish-request': ['coordination-root', 'plan', 'subject-bundle', 'intent'],
  'publish-blob': ['coordination-root', 'plan', 'subject-bundle', 'entry'],
  dispatch: ['coordination-root', 'request'],
  'record-delivery': ['coordination-root', 'request', 'attempt', 'epoch', 'driver', 'outcome', 'commit-point'],
  claim: ['coordination-root', 'request', 'role', 'worker-session'],
  'lease-heartbeat': ['coordination-root', 'request', 'claim'],
  takeover: ['coordination-root', 'request'],
  'publish-result': ['coordination-root', 'request', 'claim', 'content', 'blocked-reason'],
  'await-result': ['coordination-root', 'request', 'timeout'],
  'accept-result': ['coordination-root', 'request'],
  'transaction-ack': ['coordination-root', 'request', 'disposition'],
  cancel: ['coordination-root', 'request', 'reason'],
  'worker-stop': ['coordination-root', 'role', 'worker-session', 'kind', 'request'],
  'worker-stop-ack': ['coordination-root', 'stop', 'disposition'],
  cleanup: ['coordination-root', 'request'],
};

/** Complete-at-construction CLI contract; no facade load mutates shared state. */
const COMMAND_FLAGS = Object.freeze(Object.fromEntries(
  Object.entries(BASE_COMMAND_FLAGS).map(([command, commandFlags]) => {
    const authority = ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND[command];
    const grantFlag = authority ? [ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY[authority]] : [];
    return [command, Object.freeze(commandFlags.concat(BOOLEAN_FLAGS, grantFlag))];
  }),
));

/** Path-valued CLI tokens have an independent portable byte cap. */
const PATH_FLAG_NAMES = Object.freeze([
  'coordination-root', 'request', 'plan', 'artifact', 'claim', 'stop', 'subject-bundle', 'entry',
]);
const MAX_PATH_TOKEN_BYTES = 2048;

/** Parses `--flag value` pairs (plus known boolean flags) after the subcommand token. */
function parseFlags(argv, command) {
  const allowedFlags = COMMAND_FLAGS[command] || [];
  const out = {};
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (typeof tok !== 'string' || !tok.startsWith('--')) {
      throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'unexpected argument: ' + tok);
    }
    const name = tok.slice(2);
    if (!allowedFlags.includes(name)) {
      throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'unrecognized flag for ' + command + ': --' + name);
    }
    if (BOOLEAN_FLAGS.includes(name)) {
      if (Object.prototype.hasOwnProperty.call(out, name)) {
        throw new CliError('USAGE_ERROR', 'DUPLICATE_ARGUMENT', 'duplicate --' + name);
      }
      out[name] = true;
      i += 1;
      continue;
    }
    const val = argv[i + 1];
    if (val === undefined) {
      throw new CliError('USAGE_ERROR', 'MISSING_ARGUMENT', 'missing value for --' + name);
    }
    if (PATH_FLAG_NAMES.includes(name) && Buffer.byteLength(val, 'utf8') > MAX_PATH_TOKEN_BYTES) {
      throw new CliError('INVALID', 'INVALID_ARGUMENT', '--' + name + ' exceeds the 2048-byte path-token cap');
    }
    if (Object.prototype.hasOwnProperty.call(out, name)) {
      throw new CliError('USAGE_ERROR', 'DUPLICATE_ARGUMENT', 'duplicate --' + name);
    }
    out[name] = val;
    i += 2;
  }
  if (('fixed-ids' in out || 'fixed-clock' in out) && !isTestCapability()) {
    throw new CliError('INVALID', 'INVALID_ARGUMENT', '--fixed-ids/--fixed-clock require the test capability');
  }
  if (process.env.RUNTIME_CONSULTATION_ACL_PROBE) {
    if (process.env.RUNTIME_CONSULTATION_ACL_PROBE !== 'unverifiable') {
      throw new CliError('INVALID', 'INVALID_ARGUMENT', 'RUNTIME_CONSULTATION_ACL_PROBE has an unsupported value');
    }
    if (!isTestCapability() || !out['fixed-ids'] || !out['fixed-clock']) {
      throw new CliError('INVALID', 'INVALID_ARGUMENT', 'RUNTIME_CONSULTATION_ACL_PROBE requires the test capability plus both --fixed-ids and --fixed-clock');
    }
  }
  return out;
}

function requireFlags(flags, names) {
  for (const name of names) {
    if (!(name in flags)) {
      throw new CliError('USAGE_ERROR', 'MISSING_ARGUMENT', 'missing required --' + name);
    }
  }
}

function resolveAbsolute(p) {
  return path.resolve(p);
}

module.exports = {
  BOOLEAN_FLAGS, COMMAND_FLAGS, PATH_FLAG_NAMES, MAX_PATH_TOKEN_BYTES,
  ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND, ROLE_COMMAND_GRANT_FLAG_FOR_AUTHORITY,
  parseFlags, requireFlags, resolveAbsolute,
};
