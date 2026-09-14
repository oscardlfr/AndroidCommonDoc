'use strict';

const fs = require('fs');
const { CliError, isTestCapability, sha256Buffer } = require('../primitives.cjs');
const {
  DEFAULT_MAX_DURABLE_ARTIFACT_BYTES,
  readAllFromFd,
  statIsRegularFile,
} = require('./common.cjs');

const DURABLE_ABSENT = 'ABSENT';
const DURABLE_PENDING = 'PENDING';
const DURABLE_PRESENT = 'PRESENT';

/** Capability-gated deterministic mid-read mutation seam. */
function injectReadMutationFault(artifactPath) {
  if (!isTestCapability()) return;
  const kind = process.env.RUNTIME_CONSULTATION_FAULT_READ_MUTATE;
  if (!kind) return;
  try {
    if (kind === 'chmod') fs.chmodSync(artifactPath, 0o640);
    else if (kind === 'grow') fs.appendFileSync(artifactPath, 'X');
    else if (kind === 'hardlink') fs.linkSync(artifactPath, artifactPath + '.evil-hardlink');
    else if (kind === 'rewrite') fs.writeFileSync(artifactPath, fs.readFileSync(artifactPath));
    else if (kind === 'rebind') {
      const other = artifactPath + '.rebind-src';
      fs.writeFileSync(other, fs.readFileSync(artifactPath), { mode: 0o600 });
      fs.renameSync(other, artifactPath);
    }
  } catch (e) { /* best-effort test seam */ }
}

/**
 * Build the durable reader against the facade's lock-token and closed-schema
 * authorities. Explicit injection preserves a one-way module DAG: storage does
 * not import the transaction/lock layer that consumes it.
 */
function createDurableReaders(dependencies) {
  const { isValidLockTokenFor, parseJsonOrSchemaInvalid, assertClosedShape } = dependencies;

  function classifyDurableRead(artifactPath, policy) {
    policy = policy || {};
    const maxSize = policy.maxSize === undefined ? DEFAULT_MAX_DURABLE_ARTIFACT_BYTES : policy.maxSize;
    const immutablePath = policy.immutablePath === undefined ? true : policy.immutablePath;
    if (immutablePath === false && !isValidLockTokenFor(policy.lockToken, artifactPath)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a mutable (immutablePath:false) durable read requires an authentic transition-lock token for this txnDir: ' + artifactPath);
    }
    const isPosix = process.platform !== 'win32';
    let fd;
    try {
      fd = fs.openSync(artifactPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ENOENT') return { state: DURABLE_ABSENT };
      if (err && err.code === 'ELOOP') {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is a symlink (rejected at open): ' + artifactPath);
      }
      throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact could not be opened no-follow: ' + artifactPath + ' (' + (err && err.code) + ')');
    }
    try {
      const st1 = fs.fstatSync(fd, { bigint: true });
      if (!statIsRegularFile(st1)) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is not a regular file: ' + artifactPath);
      }
      if (isPosix && typeof process.getuid === 'function' && st1.uid !== BigInt(process.getuid())) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is not owner-confined: ' + artifactPath);
      }
      if (isPosix && (st1.mode & 0o777n) !== 0o600n) {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact mode is not owner-only 0600: ' + artifactPath);
      }
      if (st1.nlink === 2n) return { state: DURABLE_PENDING };
      if (st1.nlink !== 1n) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact nlink=' + st1.nlink + ' is not a recognized durable/in-flight state: ' + artifactPath);
      }
      if (st1.size > BigInt(maxSize)) {
        throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact exceeds max durable size (' + st1.size + '>' + maxSize + '): ' + artifactPath);
      }
      injectReadMutationFault(artifactPath);
      const bytes = readAllFromFd(fd, Number(st1.size) + 1);
      if (BigInt(bytes.length) !== st1.size) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact read length (' + bytes.length + ') != size snapshot (' + st1.size + '): ' + artifactPath);
      }
      const st2 = fs.fstatSync(fd, { bigint: true });
      if (st2.dev !== st1.dev || st2.ino !== st1.ino || st2.nlink !== st1.nlink || st2.size !== st1.size || st2.mode !== st1.mode || st2.uid !== st1.uid || st2.gid !== st1.gid || st2.ctimeNs !== st1.ctimeNs || st2.mtimeNs !== st1.mtimeNs) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact identity changed during read (rewrite/chmod/hardlink/growth): ' + artifactPath);
      }
      if (st2.nlink !== 1n) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact nlink!=1 in the final snapshot: ' + artifactPath);
      }
      if (immutablePath) {
        let lst;
        try {
          lst = fs.lstatSync(artifactPath, { bigint: true });
        } catch (err) {
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact path vanished after read: ' + artifactPath);
        }
        if (lst.dev !== st1.dev || lst.ino !== st1.ino || lst.nlink !== st1.nlink || lst.size !== st1.size || lst.mode !== st1.mode || lst.uid !== st1.uid || lst.gid !== st1.gid || lst.ctimeNs !== st1.ctimeNs || lst.mtimeNs !== st1.mtimeNs) {
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact path rebound or invariants changed after read: ' + artifactPath);
        }
      }
      let obj;
      if (policy.parse || policy.shape) {
        obj = parseJsonOrSchemaInvalid(bytes);
        if (policy.shape) policy.shape(obj, artifactPath);
      }
      return {
        state: DURABLE_PRESENT, bytes: bytes, obj: obj,
        dev: st1.dev, ino: st1.ino, nlink: st1.nlink, size: st1.size,
        mode: st1.mode, uid: st1.uid, gid: st1.gid, ctimeNs: st1.ctimeNs, mtimeNs: st1.mtimeNs,
      };
    } finally {
      try { fs.closeSync(fd); } catch (e) { /* already closed */ }
    }
  }

  function pendingDurableStop(artifactPath) {
    const e = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact in the nlink==2 in-flight window, not yet durable: ' + artifactPath);
    e.durablePending = true;
    return e;
  }

  function absentDurableStop(artifactPath, policy) {
    const e = new CliError('INVALID', policy.absentDetail || 'SCHEMA_INVALID', policy.absentMessage || ('artifact not found: ' + artifactPath));
    e.durableAbsent = true;
    return e;
  }

  function readDurableBytes(artifactPath, policy) {
    policy = policy || {};
    const r = classifyDurableRead(artifactPath, policy);
    if (r.state === DURABLE_ABSENT) throw absentDurableStop(artifactPath, policy);
    if (r.state === DURABLE_PENDING) throw pendingDurableStop(artifactPath);
    return r.bytes;
  }

  function readDurableBytesOptional(artifactPath, policy) {
    const r = classifyDurableRead(artifactPath, policy || {});
    if (r.state === DURABLE_ABSENT) return null;
    if (r.state === DURABLE_PENDING) throw pendingDurableStop(artifactPath);
    return r.bytes;
  }

  function readJsonDurable(artifactPath, policy) {
    policy = Object.assign({ parse: true }, policy || {});
    const r = classifyDurableRead(artifactPath, policy);
    if (r.state === DURABLE_ABSENT) throw absentDurableStop(artifactPath, policy);
    if (r.state === DURABLE_PENDING) throw pendingDurableStop(artifactPath);
    return r.obj;
  }

  function readJsonDurableOptional(artifactPath, policy) {
    policy = Object.assign({ parse: true }, policy || {});
    const r = classifyDurableRead(artifactPath, policy);
    if (r.state === DURABLE_ABSENT) return null;
    if (r.state === DURABLE_PENDING) throw pendingDurableStop(artifactPath);
    return r.obj;
  }

  function readDurableRecord(artifactPath, policy) {
    policy = policy || {};
    const r = classifyDurableRead(artifactPath, policy);
    if (r.state === DURABLE_ABSENT) throw absentDurableStop(artifactPath, policy);
    if (r.state === DURABLE_PENDING) throw pendingDurableStop(artifactPath);
    return {
      bytes: r.bytes, obj: parseJsonOrSchemaInvalid(r.bytes), digest: sha256Buffer(r.bytes),
      dev: r.dev, ino: r.ino, nlink: r.nlink, size: r.size, mode: r.mode, uid: r.uid, gid: r.gid, ctimeNs: r.ctimeNs, mtimeNs: r.mtimeNs,
    };
  }

  function readClosedRecord(artifactPath, fieldDefs, policy) {
    const rec = readDurableRecord(artifactPath, policy);
    assertClosedShape(rec.obj, fieldDefs);
    return rec;
  }

  function readClosedRecordOptional(artifactPath, fieldDefs, policy) {
    const bytes = readDurableBytesOptional(artifactPath, policy);
    if (bytes === null) return null;
    const obj = parseJsonOrSchemaInvalid(bytes);
    assertClosedShape(obj, fieldDefs);
    return { bytes: bytes, obj: obj, digest: sha256Buffer(bytes) };
  }

  return {
    absentDurableStop,
    classifyDurableRead,
    pendingDurableStop,
    readClosedRecord,
    readClosedRecordOptional,
    readDurableBytes,
    readDurableBytesOptional,
    readDurableRecord,
    readJsonDurable,
    readJsonDurableOptional,
  };
}

module.exports = {
  DURABLE_ABSENT,
  DURABLE_PENDING,
  DURABLE_PRESENT,
  createDurableReaders,
  injectReadMutationFault,
};
