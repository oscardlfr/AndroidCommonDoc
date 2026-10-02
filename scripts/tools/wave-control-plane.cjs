#!/usr/bin/env node
'use strict';
const control = require('../lib/wave-control-plane.cjs');

function flags(argv, command) {
  const out = { verdicts: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--verdict') {
      const raw = argv[++i] || '';
      if (command === 'qg-attempt') {
        out.verdict = raw;
      } else {
        const at = raw.indexOf('=');
        if (at < 1) throw new Error('INVALID_VERDICT_ARGUMENT');
        out.verdicts.push({ role: raw.slice(0, at), path: raw.slice(at + 1) });
      }
    } else if (key.startsWith('--')) out[key.slice(2)] = argv[++i];
  }
  return out;
}
function emit(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function main() {
  const command = process.argv[2];
  const args = flags(process.argv.slice(3), command);
  if (!args.root || !args.slug) throw new Error('REQUIRED_ARGUMENT_MISSING');
  const expectedRevision = args['expected-revision'] === undefined ? undefined : Number(args['expected-revision']);
  if (command === 'init') emit(control.initialize(args.root, args.slug));
  else if (command === 'status') emit(control.status(args.root, args.slug));
  else if (command === 'transition') emit(control.transition(args.root, args.slug, args.to, {
    verdicts: args.verdicts, rebindHead: args['rebind-head'] === 'true', expectedRevision,
    preverifyReceipt: args['preverify-receipt'], qgAttempt: args['qg-attempt'],
  }));
  else if (command === 'preverify') emit(control.preverify(args.root, args.slug, { expectedRevision }));
  else if (command === 'qg-attempt') emit(control.qgAttempt(args.root, args.slug, args.verdict, {
    expectedRevision, checks: args.checks ? JSON.parse(args.checks) : {},
  }));
  else if (command === 'rework') emit(control.rework(args.root, args.slug, {
    expectedRevision, failReceipt: args['fail-receipt'],
  }));
  else if (command === 'lifecycle-actions') emit(control.lifecycleActions(args.root, args.slug, args.profile || 'auto'));
  else throw new Error('UNKNOWN_COMMAND');
}
// Reasons that name a missing step carry the recovery, so nobody has to read the source to continue.
const HINTS = { WAVE_NOT_INITIALIZED: 'wave not initialized: run `wave-control init --slug <slug>` for this wave first' };
try { main(); } catch (error) {
  emit({ status: 'REJECTED', reason: error.message, ...(HINTS[error.message] ? { message: HINTS[error.message] } : {}) });
  process.exitCode = 2;
}
