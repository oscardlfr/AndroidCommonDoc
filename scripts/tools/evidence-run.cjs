#!/usr/bin/env node
'use strict';
const fs = require('fs');
const evidence = require('../lib/evidence-run-record.cjs');
function args(argv) { const out = {}; for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1]; return out; }
function emit(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
try {
  const command = process.argv[2];
  const a = args(process.argv.slice(3));
  if (command === 'start') emit(evidence.start({
    root: a.root,
    producer: a.producer,
    target: a.target,
    targetDigest: a['target-sha256'] || '',
    scope: a.scope,
    waveSlug: a.wave,
    toolVersions: a['tool-versions'] ? JSON.parse(a['tool-versions']) : null,
  }));
  else if (command === 'finish') {
    const current = JSON.parse(fs.readFileSync(a.record, 'utf8'));
    emit(evidence.finish(current, { verdict: a.verdict, counts: { total: Number(a.total), failed: Number(a.failed) }, artifact: a.artifact }));
  } else if (command === 'compare') {
    const records = String(a.records || '').split(',').filter(Boolean).map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
    emit({ status: 'OK', run_ids: evidence.requireAgreement(records, Number(a.minimum || 2)).map((r) => r.run_id) });
  } else throw new Error('UNKNOWN_COMMAND');
} catch (error) { emit({ status: 'REJECTED', reason: error.message }); process.exitCode = 2; }
