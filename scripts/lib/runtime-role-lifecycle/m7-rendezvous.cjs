'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: M7 section 10.1's
// deterministic test-rendezvous seams -- inert test-instrumentation plumbing
// only, never authority/schema behavior. Composed after runtimeIdentity and
// privateRegistry (needs their coordinationRootPathFor/registryBaseDir).
// Never requires the facade or a sibling module.

function createM7Rendezvous({
  fs, path, os, realpathOrSelf, registryBaseDir, coordinationRootPathFor, isTestCapability,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// M7 §10.1: deterministic test-rendezvous seams (Fase 0 prerequisite -- these
// exact producers do not exist in the baseline; this is inert
// test-instrumentation plumbing only, never authority/schema behavior).
// Mirrors runtime-consultation.cjs's own isTestCapability()/testRendezvous()
// shape, but stricter per the contract: no-clobber (never a clobbering
// writeFileSync), explicit mode 0600, exact bytes (never a PID string), and a
// caller-supplied directory (never a fixed txnDir) that must realpath beneath
// the process's own tmpdir (the suite's private test root) and outside this
// repo's registry/coordination roots. Gated on BOTH this file's own
// RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY (isTestCapability()) and the shared
// RUNTIME_M7_TEST_STAGE/RUNTIME_M7_TEST_RENDEZVOUS_DIR pair -- production and
// tests without every gate perform ZERO filesystem I/O (no stat, no read)
// before returning. No sentinel is an authority artifact.
// ─────────────────────────────────────────────────────────────────────────────

const RUNTIME_M7_RENDEZVOUS_MAX_WAIT_MS = 5000;
const RUNTIME_M7_RENDEZVOUS_POLL_MS = 20;
const RUNTIME_M7_READY_BYTES = Buffer.from('ready\n', 'utf8');
const RUNTIME_M7_GO_BYTES = Buffer.from('go\n', 'utf8');

function m7SleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

/**
 * Realpath-validates `dirRaw` beneath the process's own tmpdir (the suite's
 * private test root) and outside this repo's registry/coordination roots --
 * returns the resolved real path, or null on ANY failure (never throws; the
 * caller must skip the rendezvous, never fail production behavior, per M7
 * §10.1's "fail closed / skip... do not throw into production behavior").
 * @param {string} dirRaw
 * @param {string} projectRoot
 * @returns {string|null}
 */
function resolveSafeM7RendezvousDir(dirRaw, projectRoot) {
  if (typeof dirRaw !== 'string' || dirRaw.length === 0 || !path.isAbsolute(dirRaw)) return null;
  let real;
  try {
    real = fs.realpathSync(dirRaw);
  } catch {
    return null;
  }
  const tmpReal = realpathOrSelf(os.tmpdir());
  if (real !== tmpReal && !real.startsWith(tmpReal + path.sep)) return null;
  const forbidden = [];
  // M7 defect 12: exclude the ENTIRE registry base (every repo-id's own
  // subdirectory), never just this repo's own -- a rendezvous dir nested
  // under a DIFFERENT repo-id's subtree of the SAME base registry is equally
  // unsafe.
  try { forbidden.push(realpathOrSelf(registryBaseDir())); } catch { /* unresolvable -- nothing to forbid against */ }
  try { forbidden.push(realpathOrSelf(coordinationRootPathFor(projectRoot))); } catch { /* unresolvable -- nothing to forbid against */ }
  for (const candidateReal of forbidden) {
    if (typeof candidateReal !== 'string' || candidateReal.length === 0) continue;
    if (real === candidateReal || real.startsWith(candidateReal + path.sep)) return null;
  }
  return real;
}

/**
 * M7 §10.1 deterministic rendezvous producer. No-op (zero I/O) unless
 * NODE_ENV=test, a non-empty RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY, AND both
 * RUNTIME_M7_TEST_STAGE===stage and a safely-scoped
 * RUNTIME_M7_TEST_RENDEZVOUS_DIR are present. When armed: no-clobber writes
 * regular mode-0600 "<stage>.ready" with exact bytes "ready\n", then polls
 * (bounded 5000ms) for regular mode-0600 "<stage>.go" with exact bytes "go\n"
 * before returning. Throws (never hangs) if the bound is exceeded once armed
 * -- a hung rendezvous must fail loud, never hang the test suite.
 * @param {string} stage
 * @param {string} projectRoot
 */
function testM7Rendezvous(stage, projectRoot) {
  if (!isTestCapability()) return;
  if (process.env.RUNTIME_M7_TEST_STAGE !== stage) return;
  const dirRaw = process.env.RUNTIME_M7_TEST_RENDEZVOUS_DIR;
  if (typeof dirRaw !== 'string' || dirRaw.length === 0) return;
  const safeDir = resolveSafeM7RendezvousDir(dirRaw, projectRoot);
  if (!safeDir) return;
  const readyPath = path.join(safeDir, stage + '.ready');
  const goPath = path.join(safeDir, stage + '.go');
  fs.writeFileSync(readyPath, RUNTIME_M7_READY_BYTES, { mode: 0o600, flag: 'wx' });
  try { fs.chmodSync(readyPath, 0o600); } catch { /* best-effort hardening, umask already yields 0600 */ }
  // M7 defect 12: a monotonic clock (never Date.now(), which a wall-clock
  // adjustment could move backward mid-poll) bounds the wait.
  const startNs = process.hrtime.bigint();
  while (true) {
    // M7 GREEN section 4.11 (R14, TOCTOU fix) / M7 CORRECTION round 1 (C10):
    // never validate one inode and read another path. lstat records
    // pre-open identity (dev/ino) and rejects an obvious symlink/wrong-mode
    // entry -- genuinely ENOENT is the ordinary "not written yet" case
    // (kept polling below); ANY OTHER existing-but-invalid case (symlink,
    // wrong mode, non-regular, or an identity drift between lstat and the
    // open) throws IMMEDIATELY with a message containing the stable literal
    // M7_RENDEZVOUS_INVALID_GO_SENTINEL, never silently retried as if it
    // simply were not ready yet and never falling through to the generic
    // timeout below. O_NOFOLLOW on the open itself is the REAL symlink
    // protection (throws ELOOP on a symlink planted between the lstat and
    // the open); fstat on the ALREADY-OPEN fd re-proves regular-file/
    // exact-0600 and (when the platform exposes numeric dev/ino) correlates
    // back to the pre-open identity, so a same-path swap to a different
    // inode is caught too; the bytes are then read from that SAME held fd,
    // never a fresh path lookup, and the fd is always closed.
    let preLstat;
    try {
      preLstat = fs.lstatSync(goPath);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        throw new Error('M7_RENDEZVOUS_INVALID_GO_SENTINEL: .go sentinel could not be stat-verified (' + ((err && err.code) || 'unknown') + ')');
      }
      preLstat = null;
    }
    if (preLstat !== null) {
      if (preLstat.isSymbolicLink() || !preLstat.isFile() ||
          (process.platform !== 'win32' && (preLstat.mode & 0o777) !== 0o600)) {
        throw new Error('M7_RENDEZVOUS_INVALID_GO_SENTINEL: .go sentinel is not a genuine owner-only regular file');
      }
      let fd;
      try {
        fd = fs.openSync(goPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      } catch (err) {
        throw new Error('M7_RENDEZVOUS_INVALID_GO_SENTINEL: .go sentinel could not be opened (' + ((err && err.code) || 'unknown') + ')');
      }
      let goBytes;
      try {
        const st = fs.fstatSync(fd);
        const identityStable = typeof preLstat.dev !== 'number' || typeof preLstat.ino !== 'number'
          || (st.dev === preLstat.dev && st.ino === preLstat.ino);
        if (!st.isFile() || (process.platform !== 'win32' && (st.mode & 0o777) !== 0o600) || !identityStable) {
          throw new Error('M7_RENDEZVOUS_INVALID_GO_SENTINEL: .go sentinel identity/shape changed between lstat and open');
        }
        goBytes = fs.readFileSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      if (goBytes.equals(RUNTIME_M7_GO_BYTES)) return;
    }
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    if (elapsedMs >= RUNTIME_M7_RENDEZVOUS_MAX_WAIT_MS) {
      throw new Error('M7 test rendezvous "' + stage + '" timed out waiting for the go sentinel');
    }
    m7SleepSync(RUNTIME_M7_RENDEZVOUS_POLL_MS);
  }
}

  return Object.freeze({
    m7SleepSync, resolveSafeM7RendezvousDir, testM7Rendezvous,
  });
}

module.exports = { createM7Rendezvous };
