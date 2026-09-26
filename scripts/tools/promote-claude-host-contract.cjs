#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { promoteClaudeHostContract } = require('../lib/claude-host-contract-promotion.cjs');

function parse(argv) {
  const out = { projectRoot: process.cwd(), observerPath: null, evidenceRoot: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--project-root') out.projectRoot = argv[++i];
    else if (flag === '--evidence-root') out.evidenceRoot = argv[++i];
    else if (flag === '--observer-path') out.observerPath = argv[++i];
    else throw new Error(`UNKNOWN_ARGUMENT:${flag}`);
  }
  if (!out.evidenceRoot) throw new Error('REQUIRED_ARGUMENT_MISSING:--evidence-root');
  out.projectRoot = path.resolve(out.projectRoot);
  out.evidenceRoot = path.resolve(out.evidenceRoot);
  if (out.observerPath) out.observerPath = path.resolve(out.observerPath);
  return out;
}

try {
  const result = promoteClaudeHostContract(parse(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, reason: error.message }) + '\n');
  process.exitCode = 1;
}
