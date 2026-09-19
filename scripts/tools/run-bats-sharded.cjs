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
// match what it was assigned, incoherent per-shard counts (non-integer,
// negative, OK+NOT_OK != TOTAL, or a VERDICT that doesn't match them), a
// BATS_SCOPE other than "targeted" on any per-shard handoff, a BATS_LOG that
// doesn't match the exact path this orchestrator itself assigned that shard,
// a BATS_HEAD that doesn't match the HEAD frozen once before the first shard
// launched (never merely "the same as each other" -- aggregateHandoffs' own
// mutual-consistency check is a second, independent, weaker layer beneath
// this one), a duplicate BATS_RUN_ID, or a total/expected mismatch all abort
// before anything is published. A real per-case test failure is NOT one of
// these -- it still produces a valid, published aggregate with
// BATS_VERDICT=fail; failures must be visible, never disappear into "the
// aggregate didn't run".
//
// A shard's own reported handoff path is untrusted (parsed from that shard's
// stderr, which a buggy or compromised run-bats.sh fully controls) --
// confineHandoffPath requires it to resolve (symlinks included) to exactly
// this run's own results directory, match the expected filename shape, and
// be a real regular file, never a symlink, before it is ever read OR later
// unlinked; cleanupRunArtifacts itself unlinks single files only (lstat+
// isFile guarded), never `rmSync(...,{recursive:true})`, so nothing this
// tool tracks can ever become a recursive-delete primitive even via a TOCTOU
// swap between confinement and cleanup.
//
// The final log is named by the aggregate's own run-id
// (suite-bats.sharded.<run_id>.log), never the shared default
// .androidcommondoc/suite-bats.log a bare `bats <file>` spot-check writes to
// -- so a spot-check afterward cannot silently overwrite full-roster evidence.
//
// SIGINT/SIGTERM/SIGHUP: block new shards, SIGTERM every live child's WHOLE
// process group (run-bats.sh chains through npm/bats/bats-exec-suite/
// bats-exec-file/bats-exec-test -- a real multi-level tree, not a single
// process), wait boundedly, SIGKILL only survivors, remove every artifact
// this invocation created, and exit 128+signum -- guaranteed to be the
// signal's own code even if it arrives so late that a fully valid aggregate
// already published (decideExitCode), and never silently reported as
// "shutdown complete" if a child still hasn't confirmed dead once the kill
// wait itself expires (state.shutdownSurvivors). Never publish on any signal
// path. See run-bats-sharded-signals.test.js for the RED this closes: an
// earlier version had no handler at all, so a signal reached the
// orchestrator's own process while leaving the entire child tree running as
// orphans forever.
//
// win32 is refused fail-closed before anything else runs (no killpg
// equivalent, no POSIX process groups); run-bats.sh's own serial mode
// remains the supported Windows path. A shard's spawn-level failure (a bad
// bash command, an unreadable script) is caught via child.on('error') and
// resolved as an ordinary shard failure, never left to crash the whole
// orchestrator as an unhandled exception outside main()'s own catch.

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
 * between concurrent shards writing to the same .androidcommondoc/ dir. Pure
 * string parsing, no filesystem access -- confineHandoffPath (below) is what
 * decides whether the result is safe to ever read or delete. */
function extractHandoffPath(stderrText) {
  const m = stderrText.match(HANDOFF_WRITTEN_RE);
  return m ? m[1] : null;
}

const HANDOFF_BASENAME_RE = /^bats-result\.[^/]+\.env$/;

/** extractHandoffPath's return value is untrusted: it is parsed from a
 * shard's OWN stderr text, which a compromised or merely buggy run-bats.sh
 * (or fixture standing in for it) fully controls. Downstream, this path gets
 * `readFileSync`'d and later `unlink`'d during abort cleanup -- an
 * unconfined path there is a read-anything/delete-anything primitive handed
 * to whatever wrote that stderr line. Confines it to exactly `resultsDir`
 * (realpath-resolved, so a symlinked ancestor cannot smuggle the leaf
 * elsewhere), requires the expected `bats-result.<anything>.env` shape, and
 * requires the leaf itself (lstat'd on the ORIGINAL path, before resolution)
 * to be a real regular file, never a symlink -- a symlink AT the leaf would
 * otherwise let a shard point "its own handoff" at an arbitrary target the
 * realpath check alone would still resolve into resultsDir's own listing. */
function confineHandoffPath(rawPath, resultsDir) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return { ok: false, reason: 'SHARD_HANDOFF_MISSING' };
  }
  let canonicalPath;
  let canonicalDir;
  try {
    canonicalPath = fs.realpathSync(rawPath);
    canonicalDir = fs.realpathSync(resultsDir);
  } catch (err) {
    return { ok: false, reason: 'SHARD_HANDOFF_MISSING' };
  }
  if (path.dirname(canonicalPath) !== canonicalDir) {
    return { ok: false, reason: 'SHARD_HANDOFF_PATH_ESCAPES_RESULTS_DIR' };
  }
  if (!HANDOFF_BASENAME_RE.test(path.basename(canonicalPath))) {
    return { ok: false, reason: 'SHARD_HANDOFF_NAME_INVALID' };
  }
  let leafStat;
  try {
    leafStat = fs.lstatSync(rawPath);
  } catch (err) {
    return { ok: false, reason: 'SHARD_HANDOFF_MISSING' };
  }
  if (leafStat.isSymbolicLink()) return { ok: false, reason: 'SHARD_HANDOFF_IS_SYMLINK' };
  if (!leafStat.isFile()) return { ok: false, reason: 'SHARD_HANDOFF_NOT_REGULAR_FILE' };
  return { ok: true, canonicalPath };
}

/** Validates ONE shard's result against what it was assigned AND against
 * ground truth this orchestrator itself already knows (never merely internal
 * self-consistency): non-negative integer counts whose OK+NOT_OK genuinely
 * sums to TOTAL, a VERDICT that actually matches those counts, BATS_SCOPE
 * pinned to "targeted" (only the aggregate may ever claim "full"), the exact
 * HEAD frozen before any shard launched (never merely equal across shards --
 * see aggregateHandoffs for that separate, weaker check), and the exact log
 * path this orchestrator itself assigned this shard. Every failure is a
 * distinct, named reason -- never a bare false. */
function validateShardResult({ handoff, expectedFiles, gitBin, frozenHead, expectedLogPath }) {
  if (!handoff) return { ok: false, reason: 'SHARD_HANDOFF_MISSING' };
  if (handoff.BATS_COMPLETE !== 'true') return { ok: false, reason: 'SHARD_INCOMPLETE' };
  const okCt = Number(handoff.BATS_OK);
  const notOkCt = Number(handoff.BATS_NOT_OK);
  const expectedCt = Number(handoff.BATS_EXPECTED);
  const totalCt = Number(handoff.BATS_TOTAL);
  if (![okCt, notOkCt, expectedCt, totalCt].every((n) => Number.isInteger(n) && n >= 0)) {
    return { ok: false, reason: 'SHARD_COUNTS_NOT_NONNEGATIVE_INTEGERS' };
  }
  if (totalCt !== expectedCt) return { ok: false, reason: 'SHARD_COUNT_MISMATCH' };
  if (okCt + notOkCt !== totalCt) return { ok: false, reason: 'SHARD_OK_NOTOK_SUM_MISMATCH' };
  const coherentVerdict = notOkCt === 0 ? 'pass' : 'fail';
  if (handoff.BATS_VERDICT !== coherentVerdict) return { ok: false, reason: 'SHARD_VERDICT_INCOHERENT' };
  if (handoff.BATS_SCOPE !== 'targeted') return { ok: false, reason: 'SHARD_SCOPE_NOT_TARGETED' };
  if (typeof frozenHead !== 'string' || frozenHead.length === 0) {
    return { ok: false, reason: 'SHARD_FROZEN_HEAD_REQUIRED' };
  }
  if (handoff.BATS_HEAD !== frozenHead) return { ok: false, reason: 'SHARD_HEAD_DRIFTED' };
  if (typeof expectedLogPath !== 'string' || expectedLogPath.length === 0) {
    return { ok: false, reason: 'SHARD_EXPECTED_LOG_PATH_REQUIRED' };
  }
  if (handoff.BATS_LOG !== expectedLogPath) return { ok: false, reason: 'SHARD_LOG_PATH_MISMATCH' };
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
  confineHandoffPath,
  validateShardResult,
  aggregateHandoffs,
  renumberTap,
  caseIdentities,
  decideExitCode,
  resolvePlatform,
  createRunState,
  requestShutdown,
  cleanupRunArtifacts,
};

// ─────────────────────────────────────────────────────────────────────────
// CLI driver -- everything below is exercised by the one real end-to-end run,
// not by the fast unit tests above.
// ─────────────────────────────────────────────────────────────────────────

// Module-scoped so the top-level error handler below can find it: an error
// (e.g. SHARD_HANDOFF_MISSING) racing a signal must still let the signal's
// OWN teardown finish before the process exits, rather than the error path
// exiting first and truncating an in-flight kill/wait/escalate/cleanup
// sequence -- one more way "signal, error and finally" must converge without
// a double, or a half-done, teardown.
let currentRunState = null;

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

// Test-only override so the win32 fail-closed preflight is exercisable from
// any host -- this can only ever make the tool THINK it is on a MORE
// restrictive platform than it really is (win32 refuses to even attempt a
// run), never the reverse, so it needs no isTestCapability()-style gate: a
// real win32 host has no way to use this to bypass its own rejection, and a
// real POSIX host that sets it by accident only loses availability, never
// safety.
function resolvePlatform() {
  return process.env.RUN_BATS_SHARDED_TEST_PLATFORM || process.platform;
}

// Overridable ONLY via env, specifically so the signal-handling test suite
// can run fast without touching these generous production defaults.
// Functions, not module-load-time constants: a direct in-process test (never
// a real subprocess spawn) requires() this module once, before it could ever
// set an override env var -- a `const` frozen at that first require would
// make every direct-call test pay the full 5s/2s production defaults
// regardless of what it sets afterward. Reading process.env at CALL time
// costs nothing production cares about and makes requestShutdown directly
// unit-testable with a synthetic, never-clearing liveChildren entry instead
// of trying to win an inherently-unreliable real-process-death race.
function gracefulWaitMs() { return Number(process.env.RUN_BATS_SHARDED_GRACEFUL_WAIT_MS) || 5000; }
function killWaitMs() { return Number(process.env.RUN_BATS_SHARDED_KILL_WAIT_MS) || 2000; }
const POLL_MS = 25;

const SIGNAL_EXIT_CODE = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });

/** A signal received at ANY point during this run always wins the final exit
 * code, even if it arrived so late that a fully valid aggregate was already
 * published: main()'s own post-runPool continuation and a signal handler are
 * both single synchronous spans with no await between them, so Node is free
 * to run either first when both become ready around the same moment --
 * state.shuttingDown can legitimately still read false at every earlier
 * checkpoint even though a signal is genuinely in flight. Whoever sent it is
 * owed the signal's own semantic exit code regardless of which span won that
 * race, never the verdict's. Pure and independent of real timing so this
 * exact guarantee is unit-testable without forcing the race itself. */
function decideExitCode(state, verdict) {
  if (state.shutdownSignal) return SIGNAL_EXIT_CODE[state.shutdownSignal] || 1;
  return verdict === 'pass' ? 0 : 1;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** Everything one invocation needs to track to shut down cleanly: which
 * children are alive right now (so a signal can reach them and so `runPool`
 * knows a shutdown is in progress), and which files THIS invocation has
 * created or is about to create (so an abort can remove exactly those, never
 * more, never relying on a second pass finding them some other way). */
function createRunState() {
  return {
    shuttingDown: false,
    shutdownSignal: null,
    shutdownPromise: null,
    shutdownSurvivors: null,
    liveChildren: new Set(),
    shardLogPaths: [],
    completedHandoffPaths: [],
    aggregateLogPath: null,
    aggregateHandoffPath: null,
    cleanupDone: false,
  };
}

/** Removes every artifact this invocation is tracking. Idempotent by design
 * (guarded on cleanupDone) so it converges safely whether it is reached via
 * the signal path, an error path, or both racing each other -- never a
 * double-delete (harmless anyway) and, more importantly, never a caller
 * mistaking "cleanup ran" for "safe to publish anyway". Every tracked path
 * here is a FILE this invocation itself created or (for completedHandoffPaths)
 * already confined via confineHandoffPath -- lstat+isFile before unlink is
 * belt-and-suspenders against a TOCTOU swap, never recursive: nothing this
 * invocation tracks is ever legitimately a directory, so `rmSync(...,
 * {recursive:true})` here would only ever be a liability, not a feature. */
function cleanupRunArtifacts(state) {
  if (state.cleanupDone) return;
  state.cleanupDone = true;
  const paths = [...state.shardLogPaths, ...state.completedHandoffPaths, state.aggregateLogPath, state.aggregateHandoffPath]
    .filter(Boolean);
  for (const p of paths) {
    try {
      if (!fs.lstatSync(p).isFile()) continue;
      fs.unlinkSync(p);
    } catch (err) { /* already gone, or never existed -- best effort */ }
  }
}

/** Sends `signal` to a child's WHOLE process group, not just the direct PID.
 * run-bats.sh's own children (npm, bats, bats-exec-suite, bats-exec-file,
 * bats-exec-test) inherit its process group by default -- observed directly
 * as a real multi-level tree during this tool's own development -- so
 * signaling only child.pid would leave every descendant running as an
 * orphan. Requires the child to have been spawned with `detached: true`
 * (which calls setsid(), making child.pid its own process group id); the
 * negative-pid form of kill() then addresses the whole group in one call. */
function signalGroup(child, signal) {
  if (child.pid == null) return;
  try { process.kill(-child.pid, signal); } catch (err) { /* group or process already gone */ }
}

/** Orchestrates a clean shutdown: block new work, signal everything alive,
 * wait boundedly for a graceful exit, escalate only the survivors, then
 * remove every tracked artifact. Idempotent at the call site (main() only
 * ever invokes this once per signal via `state.shutdownPromise`), and safe
 * even if called with zero live children (a signal that lands between
 * shards still must block future ones and clean up). */
async function requestShutdown(state, signal) {
  state.shuttingDown = true;
  state.shutdownSignal = signal;
  process.stderr.write('[run-bats-sharded] received ' + signal + ' -- blocking new shards, signaling '
    + state.liveChildren.size + ' live child process group(s)\n');

  for (const child of state.liveChildren) signalGroup(child, 'SIGTERM');

  const gracefulWindow = gracefulWaitMs();
  const gracefulDeadline = Date.now() + gracefulWindow;
  while (state.liveChildren.size > 0 && Date.now() < gracefulDeadline) await sleep(POLL_MS);

  if (state.liveChildren.size > 0) {
    process.stderr.write('[run-bats-sharded] ' + state.liveChildren.size
      + ' child process group(s) survived SIGTERM within ' + gracefulWindow + 'ms -- escalating to SIGKILL\n');
    for (const child of state.liveChildren) signalGroup(child, 'SIGKILL');
    const killDeadline = Date.now() + killWaitMs();
    while (state.liveChildren.size > 0 && Date.now() < killDeadline) await sleep(POLL_MS);
  }

  cleanupRunArtifacts(state);
  if (state.liveChildren.size > 0) {
    // SIGKILL cannot itself be ignored, but this orchestrator's OWN view of
    // "alive" only clears via a child's 'close' event -- if that never fires
    // within KILL_WAIT_MS (a wedged kernel-level reap, a signal that silently
    // missed its target's actual process group), claiming "shutdown complete"
    // would be a fabricated success. Record exactly which pids never
    // confirmed dead and say so unambiguously; the exit code is still the
    // signal's own (set by main()/the top-level catch from
    // state.shutdownSignal, unconditionally, regardless of this) -- this is
    // about the MESSAGE never lying, not about inventing a second exit-code
    // lane for an already-signaled process.
    state.shutdownSurvivors = [...state.liveChildren].map((c) => c.pid);
    process.stderr.write('[run-bats-sharded] FATAL: ' + state.liveChildren.size
      + ' child process group(s) survived SIGKILL escalation and never confirmed dead -- pid(s): '
      + state.shutdownSurvivors.join(',') + '. Shutdown is NOT complete.\n');
    return;
  }
  process.stderr.write('[run-bats-sharded] shutdown complete after ' + signal + '; nothing published\n');
}

/** Installs handlers that hand off to requestShutdown exactly once: the
 * check-then-set on state.shutdownPromise is synchronous (calling an async
 * function runs synchronously up to its first await), so two signals
 * arriving back to back -- or the same signal twice -- cannot start a second,
 * overlapping teardown or let a later signal override the exit code the
 * first one already committed to. */
function installSignalHandlers(state) {
  for (const signal of Object.keys(SIGNAL_EXIT_CODE)) {
    process.on(signal, () => {
      if (!state.shutdownPromise) state.shutdownPromise = requestShutdown(state, signal);
    });
  }
}

function runBatsShard({ root, files, logPath, state, bashCmd }) {
  return new Promise((resolve) => {
    if (state.shuttingDown) { resolve({ code: null, stderr: '', aborted: true }); return; }
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
    //
    // detached: true (POSIX setsid()) puts this child in its OWN new process
    // group rather than this tool's -- required so signalGroup's negative-pid
    // kill() addresses exactly this child's descendants, never accidentally
    // this orchestrator process's own group (which it shares with whatever
    // shell launched it).
    const child = spawn(bashCmd || 'bash', [
      path.join(root, 'scripts', 'sh', 'run-bats.sh'),
      '--project-root', root,
      '--log', logPath,
      ...files,
    ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    state.liveChildren.add(child);
    let stderr = '';
    let spawnError = null;
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.stdout.on('data', () => { /* discarded -- the handoff + log are the evidence, not stdout */ });
    // Without this listener, a spawn-level failure (bad bashCmd, EACCES, a
    // deleted/unreadable script) throws an uncaught 'error' event -- Node's
    // default behavior for an EventEmitter's 'error' with no listener --
    // crashing the whole orchestrator as an unhandled exception that bypasses
    // main().catch() entirely (a thrown/rejected Promise, which that IS built
    // to handle) and skips graceful shutdown/cleanup altogether. Recording it
    // and still resolving (via the 'close' Node also emits for a failed
    // spawn) keeps this exactly one more ordinary shard failure, reported
    // through the SAME SHARD_HANDOFF_MISSING path as any other shard that
    // never wrote a handoff -- never a process-ending crash.
    child.on('error', (err) => { spawnError = err; });
    child.on('close', (code) => {
      state.liveChildren.delete(child);
      resolve(spawnError ? { code, stderr, spawnError: spawnError.message } : { code, stderr });
    });
  });
}

async function runPool(items, limit, worker, state) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    for (;;) {
      // Checked BEFORE dequeuing, not just inside the worker: a shard whose
      // turn has not come up yet must never start once a signal has landed,
      // not merely abort quickly after starting.
      if (state.shuttingDown) return;
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
    confineHandoffPath: confinePath, validateShardResult: validateShard, aggregateHandoffs: aggregate,
    renumberTap: renumber } = module.exports;

  // win32 fail-closed preflight: this tool spawns POSIX bash and signals
  // whole process groups via negative-pid kill(), neither of which Windows
  // supports (Windows has no killpg equivalent; a negative pid there is not
  // "this process's group", it is simply not a valid target). Silently
  // attempting either would produce partial, misleading behavior -- an
  // unsignalable child on abort, or a spawn that never resolves the way this
  // tool assumes. Refuse before touching anything else, not after failing
  // partway through. run-bats.sh itself remains the supported Windows path
  // (serial, already portable).
  if (resolvePlatform() === 'win32') {
    process.stderr.write('[run-bats-sharded] UNSUPPORTED_PLATFORM:win32 -- this tool requires POSIX process-group signaling (bash + negative-pid kill()), neither of which Windows provides. Use run-bats.sh directly (serial) on Windows.\n');
    process.exitCode = 2;
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.projectRoot);

  // Frozen ONCE, before any shard launches -- every shard's own BATS_HEAD is
  // held to this exact value (validateShardResult), never merely to each
  // other's (aggregateHandoffs' own, weaker, internal-consistency check).
  // Without this, a coordinated or coincidentally-identical wrong HEAD across
  // every shard would sail through unnoticed.
  const headRaw = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (headRaw.status !== 0) throw new Error('git rev-parse HEAD failed: ' + headRaw.stderr);
  const frozenHead = headRaw.stdout.trim();

  const planRaw = spawnSync('node', [
    path.join(root, 'scripts', 'tools', 'plan-bats-shards.cjs'),
    '--suite-root', args.suiteRoot, '--shard-count', String(args.shardCount), '--json',
  ], { cwd: root, encoding: 'utf8' });
  if (planRaw.status !== 0) throw new Error('plan-bats-shards.cjs failed: ' + planRaw.stderr);
  const plan = JSON.parse(planRaw.stdout);

  const state = createRunState();
  currentRunState = state;
  installSignalHandlers(state);

  const logDir = path.join(root, '.androidcommondoc');
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = nowUtc().replace(/[:.]/g, '');
  const shardLogPaths = plan.shards.map((s) => path.join(logDir, 'suite-bats.shard' + s.index + '.' + stamp + '.log'));
  // Tracked from the moment the paths are DECIDED, not from when a shard
  // finishes -- a shard aborted mid-write still leaves a partial file at
  // exactly this path, and cleanup must find it without needing to ask the
  // (possibly already-killed) shard what it was doing.
  state.shardLogPaths = shardLogPaths.slice();

  // Test-only: lets the child.on('error') hardening be exercised with a
  // genuinely unspawnable command (see resolvePlatform's own reasoning --
  // this can only make a shard fail to spawn, never fake success, so it
  // needs no isTestCapability()-style gate either).
  const bashCmd = process.env.RUN_BATS_SHARDED_TEST_BASH_CMD || undefined;

  process.stderr.write('[run-bats-sharded] launching ' + plan.shards.length + ' shard(s), max-parallel=' + args.maxParallel + '\n');
  const runs = await runPool(plan.shards, args.maxParallel, async (shard, i) => {
    const files = shard.files; // repo-relative path strings, per plan-bats-shards.cjs's --json output
    const logPath = shardLogPaths[i];
    const { code, stderr, aborted } = await runBatsShard({ root, files, logPath, state, bashCmd });
    const rawHandoffPath = aborted ? null : extractPath(stderr);
    const confinement = rawHandoffPath ? confinePath(rawHandoffPath, logDir) : { ok: false, reason: 'SHARD_HANDOFF_MISSING' };
    if (confinement.ok) state.completedHandoffPaths.push(confinement.canonicalPath);
    return { shard, files, code, stderr, aborted, logPath, confinement };
  }, state);

  if (state.shuttingDown) {
    if (state.shutdownPromise) await state.shutdownPromise;
    const code = SIGNAL_EXIT_CODE[state.shutdownSignal] || 1;
    process.stderr.write('[run-bats-sharded] aborted by ' + state.shutdownSignal + ' -- exiting ' + code + ', nothing published\n');
    process.exitCode = code;
    return;
  }

  const validated = [];
  for (const run of runs) {
    if (!run.confinement.ok) {
      throw new Error('shard ' + run.shard.index + ': ' + run.confinement.reason + ' (exit ' + run.code + ')\n' + run.shard.index + ' stderr tail: ' + run.stderr.slice(-800));
    }
    const handoff = parseEnv(fs.readFileSync(run.confinement.canonicalPath, 'utf8'));
    const verdict = validateShard({
      handoff, expectedFiles: run.files, gitBin: 'git', frozenHead, expectedLogPath: run.logPath,
    });
    if (!verdict.ok) {
      throw new Error('shard ' + run.shard.index + ': ' + verdict.reason + ' (handoff=' + run.confinement.canonicalPath + ')');
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

  // Belt and suspenders: every shard already finished by this point (checked
  // above, right after runPool), so there is nothing left to signal -- but a
  // signal landing in the narrow window between that check and this one must
  // still block publication, not merely have set a flag nothing reads again.
  if (state.shuttingDown) {
    if (state.shutdownPromise) await state.shutdownPromise;
    process.exitCode = SIGNAL_EXIT_CODE[state.shutdownSignal] || 1;
    return;
  }

  const runId = stamp + '-agg-' + process.pid + '-' + Math.floor(Math.random() * 100000);
  const aggLogPath = path.join(logDir, 'suite-bats.sharded.' + runId + '.log');
  const handoffPath = path.join(logDir, 'bats-result.' + runId + '.env');
  const handoffTmp = path.join(logDir, 'bats-result-tmp-' + process.pid + '.' + Math.floor(Math.random() * 100000) + '.env');
  // Tracked BEFORE writing: if a signal lands between the log write and the
  // handoff rename below, cleanup must still be able to find and remove
  // whatever partial state exists, not just what existed when this function
  // started.
  state.aggregateLogPath = aggLogPath;
  state.aggregateHandoffPath = handoffPath;

  fs.writeFileSync(aggLogPath, tapText, { mode: 0o644 });

  const complete = agg.facts.total === agg.facts.expected;
  const verdict = agg.facts.notOk === 0 && complete ? 'pass' : 'fail';
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

  if (state.shuttingDown) {
    // The handoff was never renamed into its final, discoverable name -- only
    // a `-tmp-` file bats-handoff.sh's own filename regex never matches
    // exists, and cleanup (tracking aggregateHandoffPath, its FINAL name, not
    // the tmp one) will not remove a file it was never told about. Track and
    // remove the tmp file explicitly here rather than leaving that gap.
    try { fs.rmSync(handoffTmp, { force: true }); } catch (err) { /* best effort */ }
    if (state.shutdownPromise) await state.shutdownPromise;
    cleanupRunArtifacts(state);
    process.exitCode = SIGNAL_EXIT_CODE[state.shutdownSignal] || 1;
    return;
  }
  fs.renameSync(handoffTmp, handoffPath);

  process.stderr.write('[run-bats-sharded] aggregate handoff written: ' + handoffPath
    + ' (verdict=' + verdict + ' complete=' + complete + ' total=' + agg.facts.total + ')\n');

  // Publication just genuinely completed -- the file is real, valid, and
  // stays (retroactively unpublishing a fully-written, valid result would be
  // its own new hazard, not a fix). What can still be WRONG is the exit code:
  // main()'s own continuation and a signal handler are both single synchronous
  // spans in this event loop with no await between them, so Node is free to
  // run either one first if a signal lands right as the last shard finishes
  // -- state.shuttingDown may still read false here even though a signal is
  // genuinely in flight. Whoever sent it is owed the signal's own exit code
  // regardless of which span won that race, never the verdict's -- see
  // decideExitCode, unit-testable on its own without needing to actually
  // force this timing race in a real subprocess.
  if (state.shutdownSignal && state.shutdownPromise) await state.shutdownPromise;
  process.exitCode = decideExitCode(state, verdict);
}

// Invoked last, after every declaration above -- SIGNAL_EXIT_CODE and the
// rest are `const`/`function` bindings main() and its error handler both
// read, and calling main() any earlier (this file's own first draft did,
// right after the exports block) hits a genuine ReferenceError: `const` is
// not hoisted the way a function declaration is, so main() would run before
// its own dependencies existed. Found by actually running the signal test
// suite against this file, not by inspection.
if (require.main === module) {
  main().catch(async (err) => {
    process.stderr.write('[run-bats-sharded] FATAL: ' + (err && err.stack || err) + '\n');
    if (currentRunState && currentRunState.shutdownPromise) {
      await currentRunState.shutdownPromise;
      process.exitCode = SIGNAL_EXIT_CODE[currentRunState.shutdownSignal] || 1;
      return;
    }
    process.exitCode = 1;
  });
}
