#!/usr/bin/env node
'use strict';
const control = require('../lib/wave-control-plane.cjs');

function flags(argv) {
  const out = { verdicts: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--verdict') {
      const raw = argv[++i] || '';
      const at = raw.indexOf('=');
      if (at < 1) throw new Error('INVALID_VERDICT_ARGUMENT');
      out.verdicts.push({ role: raw.slice(0, at), path: raw.slice(at + 1) });
    } else if (key.startsWith('--')) out[key.slice(2)] = argv[++i];
  }
  return out;
}
function emit(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function main() {
  const command = process.argv[2];
  const args = flags(process.argv.slice(3));
  if (!args.root || !args.slug) throw new Error('REQUIRED_ARGUMENT_MISSING');
  if (command === 'init') emit(control.initialize(args.root, args.slug));
  else if (command === 'status') emit(control.status(args.root, args.slug));
  else if (command === 'transition') emit(control.transition(args.root, args.slug, args.to, {
    verdicts: args.verdicts, rebindHead: args['rebind-head'] === 'true',
  }));
  else if (command === 'lifecycle-actions') emit(control.lifecycleActions(args.root, args.slug, args.profile || 'auto'));
  else throw new Error('UNKNOWN_COMMAND');
}
try { main(); } catch (error) { emit({ status: 'REJECTED', reason: error.message }); process.exitCode = 2; }
