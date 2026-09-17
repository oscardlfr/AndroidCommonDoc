#!/usr/bin/env node
'use strict';

// run-bats-sharded.cjs -- Bats parallelization orchestrator.
//
// scripts/sh/run-bats.sh is NOT modified and is not concurrency-safe against
// itself (see feedback_run_bats_not_concurrency_safe in project memory: two
// invocations against the same project root corrupt each other's TAP
// plan-count parsing when they share a log path). This tool makes N SAFE
// concurrent invocations possible by giving each one its own --log, its own
// run-bats.sh-assigned BATS_RUN_ID/TMPDIR/registries (already isolated per
// invocation, independent of this tool -- see bats-parallel-design.md), and
// then aggregating the results into ONE handoff.
//
// Why the aggregate handoff is the hard part, not the parallel execution:
// emit-qg-result.sh requires BATS_SCOPE=="full" (scripts/sh/emit-qg-result.sh,
// select_bats_handoff --require-scope full), and run-bats.sh only ever writes
// full when it was given NO positional targets. A sharded run always passes
// explicit file lists, so every PER-SHARD handoff is legitimately "targeted"
// and the quality gate would reject it outright. Writing BATS_SCOPE=full on
// the aggregate is exactly the kind of claim this project has been burned by
// fabricating before -- so it is earned here, not asserted: the shard plan
// (scripts/tools/plan-bats-shards.cjs) is proven exhaustive and duplicate-free
// by its own test suite, and THIS tool independently verifies each shard
// actually ran the exact file set it was assigned, via the same
// BATS_TARGET_DIGEST (git hash-object over the sorted target list) run-bats.sh
// itself already writes to every handoff -- not trusted, recomputed and
// compared.
//
// Failure is fail-closed and specific, never a silent partial success:
// a missing shard handoff, an incomplete shard, a shard whose digest doesn't
// match what it was assigned, a HEAD that drifted between shards (someone
// committed mid-run), a duplicate BATS_RUN_ID, or a total/expected mismatch
// all abort before anything is published. A real per-case test failure is NOT
// one of these -- it still produces a valid, published aggregate with
// BATS_VERDICT=fail; failures must be visible, never disappear into "the
// aggregate didn't run".
//
// The final log is named by the aggregate's own run-id
// (suite-bats.sharded.<run_id>.log), never the shared default
// .androidcommondoc/suite-bats.log a bare `bats <file>` spot-check writes to
// -- so a spot-check afterward cannot silently overwrite full-roster evidence.

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────
// Pure, independently-testable helpers. No process spawning, no filesystem
// writes -- everything below this line is exercised directly by
// run-bats-sharded.test.js against synthetic fixtures, never a real bats run.
// ─────────────────────────────────────────────────────────────────────────

/** Mirrors run-bats.sh's own BATS_TARGET_DIGEST computation exactly: sorted
 * target list, one per line (each `printf '%s\n'`-terminated), through
 * `git hash-object --stdin`. Must match byte-for-byte or a healthy shard
 * reads as tampered. */
function computeTargetDigest(files, gitBin = 'git') {
  const input = files.slice().sort().map((f) => f + '\n').join('');
  const out = spawnSync(gitBin, ['hash-object', '--stdin'], { input, encoding: 'utf8' });
  if (out.status !== 0 || out.error) {
    throw new Error('computeTargetDigest: git hash-object failed: ' + (out.stderr || out.error));
  }
  return out.stdout.trim();
}

/** One KEY=value per line, exactly what run-bats.sh writes and
 * bats-handoff.sh's handoff_get parses -- never `source`d. */
function parseHandoffEnv(text) {
  const obj = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) obj[m[1]] = m[2];
  }
  return obj;
}

const HANDOFF_WRITTEN_RE = /\[run-bats\] handoff written: (.+?) \(/;

/** Extracts the exact handoff path a single run-bats.sh invocation wrote,
 * from that invocation's OWN stderr -- avoids any directory-snapshot race
 * between concurrent shards writing to the same .androidcommondoc/ dir. */
function extractHandoffPath(stderrText) {
  const m = stderrText.match(HANDOFF_WRITTEN_RE);
  return m ? m[1] : null;
}

/** Validates ONE shard's result against what it was assigned. Every failure
 * is a distinct, named reason -- never a bare false. */
function validateShardResult({ handoff, expectedFiles, gitBin }) {
  if (!handoff) return { ok: false, reason: 'SHARD_HANDOFF_MISSING' };
  if (handoff.BATS_COMPLETE !== 'true') return { ok: false, reason: 'SHARD_INCOMPLETE' };
  if (handoff.BATS_TOTAL !== handoff.BATS_EXPECTED) return { ok: false, reason: 'SHARD_COUNT_MISMATCH' };
  let expectedDigest;
  try {
    expectedDigest = computeTargetDigest(expectedFiles, gitBin);
  } catch (err) {
    return { ok: false, reason: 'SHARD_DIGEST_COMPUTE_FAILED' };
  }
  if (!handoff.BATS_TARGET_DIGEST || handoff.BATS_TARGET_DIGEST !== expectedDigest) {
    return { ok: false, reason: 'SHARD_FILE_SET_MISMATCH' };
  }
  return { ok: true };
}

/** Aggregates N already-individually-validated shard handoffs. Fails closed
 * on any cross-shard inconsistency rather than silently summing. */
function aggregateHandoffs(shardHandoffs, expectedShardCount) {
  if (shardHandoffs.length !== expectedShardCount) {
    return { ok: false, reason: 'SHARD_COUNT_MISSING', found: shardHandoffs.length, expected: expectedShardCount };
  }
  if (shardHandoffs.length === 0) return { ok: false, reason: 'NO_SHARDS' };
  const head = shardHandoffs[0].BATS_HEAD;
  const seenRunIds = new Set();
  let ok = 0, notOk = 0, expected = 0, total = 0;
  for (const h of shardHandoffs) {
    if (h.BATS_HEAD !== head) return { ok: false, reason: 'SHARD_HEAD_MISMATCH' };
    if (seenRunIds.has(h.BATS_RUN_ID)) return { ok: false, reason: 'SHARD_RUN_ID_DUPLICATE' };
    seenRunIds.add(h.BATS_RUN_ID);
    const hOk = Number(h.BATS_OK), hNotOk = Number(h.BATS_NOT_OK), hExp = Number(h.BATS_EXPECTED), hTot = Number(h.BATS_TOTAL);
    if (![hOk, hNotOk, hExp, hTot].every(Number.isInteger)) return { ok: false, reason: 'SHARD_COUNTS_NOT_INTEGER' };
    ok += hOk; notOk += hNotOk; expected += hExp; total += hTot;
  }
  if (total !== expected) return { ok: false, reason: 'AGGREGATE_COUNT_MISMATCH', total, expected };
  return { ok: true, head, facts: { ok, notOk, expected, total } };
}

/** Renumbers N shards' raw bats TAP logs into ONE stream with a single
 * `1..TOTAL` plan. Per-shard plan lines and TAP-version headers are dropped;
 * ok/not-ok lines are renumbered sequentially; any other line (diagnostic
 * `#` blocks trailing a failure) passes through unchanged, in order, so it
 * stays attached to the case above it. */
function renumberTap(shardLogTexts) {
  const bodyLines = [];
  let n = 0;
  for (const text of shardLogTexts) {
    for (const line of text.split(/\r?\n/)) {
      if (line === '') continue;
      if (/^\d+\.\.\d+$/.test(line)) continue;
      if (/^TAP version/i.test(line)) continue;
      const m = line.match(/^(ok|not ok)\s+\d+(.*)$/);
      if (m) {
        n += 1;
        bodyLines.push(m[1] + ' ' + n + m[2]);
      } else {
        bodyLines.push(line);
      }
    }
  }
  return { text: '1..' + n + '\n' + bodyLines.join('\n') + '\n', total: n };
}

/** Case identity for serial/parallel equivalence: the description text after
 * the ok/not-ok-and-number prefix, sorted -- proves the exact SET of cases
 * ran is identical, not merely the count. */
function caseIdentities(tapText) {
  const names = [];
  for (const line of tapText.split(/\r?\n/)) {
    const m = line.match(/^(?:ok|not ok)\s+\d+\s+(.*)$/);
    if (m) names.push(m[1]);
  }
  return names.slice().sort();
}

module.exports = {
  computeTargetDigest,
  parseHandoffEnv,
  extractHandoffPath,
  validateShardResult,
  aggregateHandoffs,
  renumberTap,
  caseIdentities,
};

// ─────────────────────────────────────────────────────────────────────────
// CLI driver -- everything below is exercised by the one real end-to-end run,
// not by the fast unit tests above.
// ─────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write('[run-bats-sharded] FATAL: ' + (err && err.stack || err) + '\n');
    process.exit(1);
  });
}

function parseArgs(argv) {
  const out = { shardCount: null, maxParallel: null, projectRoot: null, suiteRoot: 'scripts/tests' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--shard-count') out.shardCount = parseInt(argv[++i], 10);
    else if (a === '--max-parallel') out.maxParallel = parseInt(argv[++i], 10);
    else if (a === '--project-root') out.projectRoot = argv[++i];
    else if (a === '--suite-root') out.suiteRoot = argv[++i];
    else throw new Error('unrecognized argument: ' + a);
  }
  if (!Number.isInteger(out.shardCount) || out.shardCount < 1) throw new Error('--shard-count must be a positive integer');
  if (out.maxParallel === null) out.maxParallel = out.shardCount;
  if (!Number.isInteger(out.maxParallel) || out.maxParallel < 1) throw new Error('--max-parallel must be a positive integer');
  if (!out.projectRoot) throw new Error('--project-root is required (this tool never infers it)');
  return out;
}

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function runBatsShard({ root, files, logPath }) {
  return new Promise((resolve) => {
    // stdio[0] MUST be 'ignore', not the default open pipe: some scripts this
    // suite exercises read stdin unconditionally when it is not a terminal
    // (write-verdict.sh:605, `[[ -t 0 ]] || stdin_content="$(cat)"`, correct
    // behavior for its own normal callers). Node's default spawn() stdio is
    // ['pipe','pipe','pipe'] -- a pipe this process never writes to or closes
    // -- so that `cat` blocks forever waiting for EOF that never arrives.
    // Found empirically: shard4 hung for over an hour on write-verdict.bats's
    // V7 case, confirmed via `lsof` (fd 0 was an open, unread unix socket) and
    // reproduced/fixed by this one line -- not a concurrency defect in the
    // test suite itself, a defect in how this tool spawned its children.
    const child = spawn('bash', [
      path.join(root, 'scripts', 'sh', 'run-bats.sh'),
      '--project-root', root,
      '--log', logPath,
      ...files,
    ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.stdout.on('data', () => { /* discarded -- the handoff + log are the evidence, not stdout */ });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    for (;;) {
      const i = next; next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

async function main() {
  const { computeTargetDigest: digestOf, parseHandoffEnv: parseEnv, extractHandoffPath: extractPath,
    validateShardResult: validateShard, aggregateHandoffs: aggregate, renumberTap: renumber } = module.exports;

  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.projectRoot);

  const planRaw = spawnSync('node', [
    path.join(root, 'scripts', 'tools', 'plan-bats-shards.cjs'),
    '--suite-root', args.suiteRoot, '--shard-count', String(args.shardCount), '--json',
  ], { cwd: root, encoding: 'utf8' });
  if (planRaw.status !== 0) throw new Error('plan-bats-shards.cjs failed: ' + planRaw.stderr);
  const plan = JSON.parse(planRaw.stdout);

  const logDir = path.join(root, '.androidcommondoc');
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = nowUtc().replace(/[:.]/g, '');
  const shardLogPaths = plan.shards.map((s) => path.join(logDir, 'suite-bats.shard' + s.index + '.' + stamp + '.log'));

  process.stderr.write('[run-bats-sharded] launching ' + plan.shards.length + ' shard(s), max-parallel=' + args.maxParallel + '\n');
  const runs = await runPool(plan.shards, args.maxParallel, async (shard, i) => {
    const files = shard.files; // repo-relative path strings, per plan-bats-shards.cjs's --json output
    const { code, stderr } = await runBatsShard({ root, files, logPath: shardLogPaths[i] });
    const handoffPath = extractPath(stderr);
    return { shard, files, code, stderr, handoffPath };
  });

  const validated = [];
  for (const run of runs) {
    if (!run.handoffPath || !fs.existsSync(run.handoffPath)) {
      throw new Error('shard ' + run.shard.index + ': SHARD_HANDOFF_MISSING (exit ' + run.code + ')\n' + run.shard.index + ' stderr tail: ' + run.stderr.slice(-800));
    }
    const handoff = parseEnv(fs.readFileSync(run.handoffPath, 'utf8'));
    const verdict = validateShard({ handoff, expectedFiles: run.files, gitBin: 'git' });
    if (!verdict.ok) {
      throw new Error('shard ' + run.shard.index + ': ' + verdict.reason + ' (handoff=' + run.handoffPath + ')');
    }
    validated.push(handoff);
  }

  const agg = aggregate(validated, plan.shards.length);
  if (!agg.ok) throw new Error('aggregation failed: ' + JSON.stringify(agg));

  // BATS_SCOPE=full is a claim that the roster AS IT EXISTS was fully run.
  // The plan was fixed before the first shard launched; if a *.bats file was
  // added or removed under suite-root while shards were running, that claim
  // would be earned against a roster that no longer exists. Re-discover and
  // fail closed on drift rather than publish scope=full against a stale set.
  const rescanRaw = spawnSync('node', [
    path.join(root, 'scripts', 'tools', 'plan-bats-shards.cjs'),
    '--suite-root', args.suiteRoot, '--shard-count', String(args.shardCount), '--json',
  ], { cwd: root, encoding: 'utf8' });
  if (rescanRaw.status !== 0) throw new Error('post-run roster rescan failed: ' + rescanRaw.stderr);
  const rescanFiles = new Set(JSON.parse(rescanRaw.stdout).shards.flatMap((s) => s.files));
  const plannedFiles = new Set(plan.shards.flatMap((s) => s.files));
  const added = [...rescanFiles].filter((f) => !plannedFiles.has(f));
  const removed = [...plannedFiles].filter((f) => !rescanFiles.has(f));
  if (added.length > 0 || removed.length > 0) {
    throw new Error('ROSTER_DRIFT_DURING_RUN: the *.bats set under ' + args.suiteRoot
      + ' changed while shards were running -- added=' + JSON.stringify(added) + ' removed=' + JSON.stringify(removed)
      + '. Refusing to publish scope=full against a roster that no longer matches disk.');
  }

  const shardLogTexts = shardLogPaths.map((p) => fs.readFileSync(p, 'utf8'));
  const { text: tapText, total: tapTotal } = renumber(shardLogTexts);
  if (tapTotal !== agg.facts.total) {
    throw new Error('AGGREGATE_TAP_COUNT_MISMATCH: renumbered TAP has ' + tapTotal + ' cases, handoffs summed to ' + agg.facts.total);
  }

  const runId = stamp + '-agg-' + process.pid + '-' + Math.floor(Math.random() * 100000);
  const aggLogPath = path.join(logDir, 'suite-bats.sharded.' + runId + '.log');
  fs.writeFileSync(aggLogPath, tapText, { mode: 0o644 });

  const complete = agg.facts.total === agg.facts.expected;
  const verdict = agg.facts.notOk === 0 && complete ? 'pass' : 'fail';
  const handoffPath = path.join(logDir, 'bats-result.' + runId + '.env');
  const handoffTmp = path.join(logDir, 'bats-result-tmp-' + process.pid + '.' + Math.floor(Math.random() * 100000) + '.env');
  const lines = [
    'BATS_OK=' + agg.facts.ok,
    'BATS_NOT_OK=' + agg.facts.notOk,
    'BATS_EXPECTED=' + agg.facts.expected,
    'BATS_TOTAL=' + agg.facts.total,
    'BATS_COMPLETE=' + complete,
    'BATS_VERDICT=' + verdict,
    'BATS_LOG=' + aggLogPath,
    'BATS_HEAD=' + agg.head,
    'BATS_RUN_ID=' + runId,
    'BATS_GENERATED_AT=' + nowUtc(),
    'BATS_SCOPE=full',
    'BATS_TARGET_DIGEST=' + digestOf(plan.shards.flatMap((s) => s.files)),
    'BATS_ENV_FINGERPRINT=' + os.platform() + '-' + os.arch() + '-sharded' + plan.shards.length,
  ];
  fs.writeFileSync(handoffTmp, lines.join('\n') + '\n');
  fs.renameSync(handoffTmp, handoffPath);

  process.stderr.write('[run-bats-sharded] aggregate handoff written: ' + handoffPath
    + ' (verdict=' + verdict + ' complete=' + complete + ' total=' + agg.facts.total + ')\n');
  process.exitCode = verdict === 'pass' ? 0 : 1;
}
