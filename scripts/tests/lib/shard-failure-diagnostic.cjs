'use strict';

// Permanent test helper: when a real run-bats-sharded.cjs subprocess exits
// non-zero, this builds a rich, redacted diagnostic report explaining WHY.
// Production's own error message is deliberately terse (shard index + reason
// + handoff path only -- see run-bats-sharded.cjs's `throw new Error('shard '
// + ...)` in main()), which is correct for its own FATAL-and-exit use case,
// but insufficient for triaging an intermittent, CI-only SHARD_INCOMPLETE
// after the fact with no other log capture available (the bats-post CI job
// uploads no artifacts on failure). This never touches production code and
// never invents information: every field is either passed in by the caller
// (already known before the spawn) or read from what the failed run itself
// left on disk. Never includes a full environment dump or secret-shaped
// values -- only the specific named fields below.

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const rbs = require('../../tools/run-bats-sharded.cjs');

const TAP_TAIL_LINES = 40;

function readTailLines(filePath, maxLines) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { exists: false, size: null, tail: null, readError: err.code || String(err) };
  }
  let size = null;
  try { size = fs.statSync(filePath).size; } catch { /* best-effort only, content already read above */ }
  const lines = content.split(/\r?\n/);
  return { exists: true, size, tail: lines.slice(-maxLines).join('\n') };
}

function extractHandoffPathFromStderr(stderr) {
  const m = typeof stderr === 'string' ? stderr.match(/handoff=(\S+?)\)/) : null;
  return m ? m[1] : null;
}

function extractShardIndexFromStderr(stderr) {
  const m = typeof stderr === 'string' ? stderr.match(/\bshard (\d+):/) : null;
  return m ? m[1] : null;
}

// Best-effort, informational only: a coarse OS-level scan for any bats/
// run-bats-sharded-related process still alive after the spawn returned.
// This is NOT the orchestrator's own internal state.liveChildren (that
// object belongs to a process that has already exited by the time this
// diagnostic runs) -- it is the closest external, portable approximation:
// did anything related get left running behind the reported exit.
function scanKnownBatsProcesses() {
  try {
    const out = execFileSync('ps', ['-eo', 'pid,ppid,stat,comm'], { encoding: 'utf8' });
    const relevant = out.split('\n').filter((line, i) => i === 0 || /bats|run-bats/i.test(line));
    return relevant.length > 1 ? relevant.join('\n') : '(none found)';
  } catch (err) {
    return '(process scan unavailable: ' + (err && err.code ? err.code : String(err)) + ')';
  }
}

/**
 * Builds a redacted, multi-field diagnostic string for a failed
 * run-bats-sharded.cjs spawnSync invocation.
 *
 * @param {object} args
 * @param {{status:?number,signal:?string,stdout:?string,stderr:?string}} args.result - the spawnSync result
 * @param {string[]} args.command - the exact argv used (already known by the caller, never re-derived)
 * @param {string} args.cwd
 * @param {string} args.head - the HEAD the caller expects this run to be bound to
 * @param {string[]} [args.expectedFiles] - best-effort; only affects the digest-mismatch leg of validateShardResult
 * @param {string} [args.gitBin]
 */
function buildShardFailureDiagnostic({ result, command, cwd, head, expectedFiles, gitBin }) {
  const lines = [];
  lines.push('=== shard failure diagnostic ===');
  lines.push('head: ' + (head || '(unknown)'));
  lines.push('platform: ' + process.platform);
  lines.push('shard-id: ' + (extractShardIndexFromStderr(result && result.stderr) || '(not found in stderr)'));
  lines.push('command: ' + JSON.stringify(command));
  lines.push('cwd: ' + cwd);
  lines.push('exit code: ' + (result ? result.status : '(no result)'));
  lines.push('signal: ' + ((result && result.signal) || '(none)'));
  lines.push('--- child stdout ---');
  lines.push((result && result.stdout) || '(empty)');
  lines.push('--- child stderr ---');
  lines.push((result && result.stderr) || '(empty)');

  const handoffPath = extractHandoffPathFromStderr(result && result.stderr);
  lines.push('expected handoff path: ' + (handoffPath || '(not found in stderr)'));

  let handoff = null;
  if (handoffPath) {
    let raw = null;
    try {
      raw = fs.readFileSync(handoffPath, 'utf8');
    } catch (err) {
      lines.push('handoff exists: false (' + (err.code || String(err)) + ')');
    }
    if (raw !== null) {
      lines.push('handoff exists: true');
      lines.push('--- handoff content ---');
      lines.push(raw);
      handoff = rbs.parseHandoffEnv(raw);
      lines.push(
        'expected=' + handoff.BATS_EXPECTED + ' ok=' + handoff.BATS_OK + ' not_ok=' + handoff.BATS_NOT_OK
        + ' total=' + handoff.BATS_TOTAL + ' complete=' + handoff.BATS_COMPLETE
        + ' scope=' + handoff.BATS_SCOPE + ' verdict=' + handoff.BATS_VERDICT,
      );
      lines.push('run-id: ' + (handoff.BATS_RUN_ID || '(missing from handoff)'));
      lines.push('tap/log path: ' + (handoff.BATS_LOG || '(missing from handoff)'));
      if (handoff.BATS_LOG) {
        const tapInfo = readTailLines(handoff.BATS_LOG, TAP_TAIL_LINES);
        lines.push('tap/log exists: ' + tapInfo.exists + (tapInfo.size !== null ? ' size=' + tapInfo.size + 'B' : ''));
        if (tapInfo.exists) {
          lines.push('--- tap/log tail (last ' + TAP_TAIL_LINES + ' lines) ---');
          lines.push(tapInfo.tail);
        } else if (tapInfo.readError) {
          lines.push('tap/log read error: ' + tapInfo.readError);
        }
      }
    }
  } else {
    lines.push('run-id: (unknown, no handoff path found)');
  }

  const verdict = rbs.validateShardResult({
    handoff,
    expectedFiles: expectedFiles || [],
    gitBin: gitBin || 'git',
    frozenHead: head,
    expectedLogPath: handoff ? handoff.BATS_LOG : undefined,
  });
  lines.push('validateShardResult reason: ' + verdict.reason);

  lines.push('known bats/run-bats processes still visible:');
  lines.push(scanKnownBatsProcesses());
  lines.push('=== end diagnostic ===');
  return lines.join('\n');
}

module.exports = { buildShardFailureDiagnostic };
