'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isTestCapability } = require('../primitives.cjs');

const RENDEZVOUS_MAX_WAIT_MS = 5000;
const RENDEZVOUS_POLL_MS = 20;

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

/**
 * Capability-gated deterministic interleaving seam. It is inert until both
 * the test capability and the exact rendezvous name are present.
 */
function testRendezvous(txnDir, name) {
  if (!isTestCapability()) return;
  if (process.env.RUNTIME_CONSULTATION_TEST_RENDEZVOUS !== name) return;
  const readyPath = path.join(txnDir, '.rendezvous-' + name + '-ready');
  const goPath = path.join(txnDir, '.rendezvous-' + name + '-go');
  fs.writeFileSync(readyPath, String(process.pid));
  const start = Date.now();
  while (!fs.existsSync(goPath)) {
    if (Date.now() - start >= RENDEZVOUS_MAX_WAIT_MS) {
      throw new Error('test rendezvous "' + name + '" timed out waiting for the -go sentinel');
    }
    sleepSync(RENDEZVOUS_POLL_MS);
  }
}

const RUNTIME_M7_RENDEZVOUS_MAX_WAIT_MS = 5000;
const RUNTIME_M7_RENDEZVOUS_POLL_MS = 20;
const RUNTIME_M7_READY_BYTES = Buffer.from('ready\n', 'utf8');
const RUNTIME_M7_GO_BYTES = Buffer.from('go\n', 'utf8');
const M7_REGISTRY_BASE_DIR_LITERAL = 'android-common-doc-runtime';

/**
 * Realpath-validates a rendezvous directory beneath the process tmpdir and
 * outside runtime registry and coordination roots. Any failure skips the
 * test seam rather than changing production behavior.
 */
function resolveSafeM7RendezvousDir(dirRaw, coordRoot) {
  if (typeof dirRaw !== 'string' || dirRaw.length === 0 || !path.isAbsolute(dirRaw)) return null;
  let real;
  try {
    real = fs.realpathSync(dirRaw);
  } catch {
    return null;
  }
  let tmpReal;
  try {
    tmpReal = fs.realpathSync(os.tmpdir());
  } catch {
    return null;
  }
  if (real !== tmpReal && !real.startsWith(tmpReal + path.sep)) return null;
  const registryParent = path.join(tmpReal, M7_REGISTRY_BASE_DIR_LITERAL);
  if (real === registryParent || real.startsWith(registryParent + path.sep)) return null;
  if (typeof coordRoot === 'string' && coordRoot.length > 0) {
    let coordReal;
    try {
      coordReal = fs.realpathSync(coordRoot);
    } catch {
      coordReal = null;
    }
    if (coordReal !== null && (real === coordReal || real.startsWith(coordReal + path.sep))) return null;
  }
  return real;
}

/**
 * M7 deterministic rendezvous producer. Capability and stage gates execute
 * before any filesystem I/O. Once armed, the sentinel is no-clobber and the
 * wait is bounded with a monotonic clock.
 */
function testM7Rendezvous(stage, coordRoot) {
  if (!isTestCapability()) return;
  if (process.env.RUNTIME_M7_TEST_STAGE !== stage) return;
  const dirRaw = process.env.RUNTIME_M7_TEST_RENDEZVOUS_DIR;
  if (typeof dirRaw !== 'string' || dirRaw.length === 0) return;
  const safeDir = resolveSafeM7RendezvousDir(dirRaw, coordRoot);
  if (!safeDir) return;
  const readyPath = path.join(safeDir, stage + '.ready');
  const goPath = path.join(safeDir, stage + '.go');
  fs.writeFileSync(readyPath, RUNTIME_M7_READY_BYTES, { mode: 0o600, flag: 'wx' });
  try { fs.chmodSync(readyPath, 0o600); } catch { /* best-effort hardening, umask already yields 0600 */ }
  const startNs = process.hrtime.bigint();
  while (true) {
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
      if (preLstat.isSymbolicLink() || !preLstat.isFile() || (process.platform !== 'win32' && (preLstat.mode & 0o777) !== 0o600)) {
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
    sleepSync(RUNTIME_M7_RENDEZVOUS_POLL_MS);
  }
}

module.exports = {
  sleepSync,
  testRendezvous,
  testM7Rendezvous,
  resolveSafeM7RendezvousDir,
};
