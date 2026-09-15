'use strict';

// Filesystem primitives for the TurnReadProjection/v1 `current/` tree: fd-bound/git source reads, durable writes, directory permission hardening, and confined-path validation.

function createTurnProjectionIo({
  TURN_READ_PROJECTION_ENTRY_CAP,
  TURN_READ_PROJECTION_FILE_CAP,
  execFileSync,
  fs,
  path,
  rc,
}) {
function isSafeProjectionRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || path.isAbsolute(value) || value.includes('\\')) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part !== '.git' && !/[\x00-\x1f\x7f]/.test(part));
}

function readFdBoundProjectionSource(sourcePath, cap) {
  let initial;
  try { initial = fs.lstatSync(sourcePath); }
  catch (err) { throw new Error('projection-source-unavailable'); }
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1 || initial.size > cap) {
    throw new Error('projection-source-invalid');
  }
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && initial.uid !== process.getuid()) {
    throw new Error('projection-source-not-owned');
  }
  const fd = fs.openSync(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.dev !== initial.dev || st.ino !== initial.ino || st.size !== initial.size || st.nlink !== 1) {
      throw new Error('projection-source-rebound');
    }
    const bytes = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (n <= 0) break;
      offset += n;
    }
    if (offset !== bytes.length) throw new Error('projection-source-short-read');
    const after = fs.fstatSync(fd);
    const finalPath = fs.lstatSync(sourcePath);
    if (
      after.dev !== st.dev || after.ino !== st.ino || after.size !== st.size || after.nlink !== st.nlink
      || finalPath.isSymbolicLink() || finalPath.dev !== st.dev || finalPath.ino !== st.ino
      || finalPath.size !== st.size || finalPath.nlink !== st.nlink
    ) throw new Error('projection-source-changed-during-read');
    return {
      bytes,
      digest: rc.sha256Buffer(bytes),
      identity: {
        dev: st.dev,
        ino: st.ino,
        size: st.size,
        mode: st.mode & 0o777,
        uid: st.uid,
        nlink: st.nlink,
      },
    };
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncProjectionPath(targetPath) {
  fs.lstatSync(targetPath);
  // FlushFileBuffers requires a write-capable handle on Windows for both
  // regular files and directories. POSIX retains the read-only descriptor.
  const flags = process.platform === 'win32' ? 'r+' : 'r';
  const fd = fs.openSync(targetPath, flags);
  let closed = false;
  try {
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    closed = true;
  } finally {
    if (!closed) { try { fs.closeSync(fd); } catch (err) {} }
  }
}

function writeProjectionBytesDurably(targetPath, bytes) {
  const fd = fs.openSync(targetPath, 'wx', 0o600);
  let closed = false;
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    closed = true;
  } finally {
    if (!closed) { try { fs.closeSync(fd); } catch (err) {} }
  }
  fs.chmodSync(targetPath, 0o400);
}

function writeProjectionFile(stagingRoot, relativePath, bytes, kind, sourceRef, entries) {
  if (
    !isSafeProjectionRelativePath(relativePath) || !Buffer.isBuffer(bytes)
    || bytes.length > TURN_READ_PROJECTION_FILE_CAP
    || entries.length >= TURN_READ_PROJECTION_ENTRY_CAP
  ) {
    throw new Error('projection-entry-invalid');
  }
  const target = path.join(stagingRoot, ...relativePath.split('/'));
  const relativeCheck = path.relative(stagingRoot, target);
  if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) throw new Error('projection-entry-escape');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  writeProjectionBytesDurably(target, bytes);
  entries.push({
    kind, source_ref: sourceRef, projected_path: relativePath,
    size: bytes.length, digest: rc.sha256Buffer(bytes),
  });
}

function chmodProjectionDirectories(root, mode) {
  const dirs = [];
  function walk(dir) {
    const lst = fs.lstatSync(dir);
    if (!lst.isDirectory() || lst.isSymbolicLink()) throw new Error('projection-directory-invalid');
    dirs.push(dir);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('projection-symlink-rejected');
      if (entry.isDirectory()) walk(child);
      else if (!entry.isFile()) throw new Error('projection-nonregular-rejected');
    }
  }
  walk(root);
  dirs.sort((a, b) => b.length - a.length);
  for (const dir of dirs) fs.chmodSync(dir, mode);
}

function removeProjectionTree(target) {
  if (!fs.existsSync(target)) return;
  chmodProjectionDirectories(target, 0o700);
  fs.rmSync(target, { recursive: true, force: false });
}

function projectionPathSourceDescriptor(sourcePath, source) {
  return {
    type: 'path',
    sourcePath,
    digest: source.digest,
    identity: Object.assign({}, source.identity),
  };
}

function readGitProjectionSource(worker, subjectHead, entryPath, expectedSize, expectedDigest) {
  let listing;
  try {
    listing = execFileSync('git', ['-C', worker.projectRoot, 'ls-tree', '-z', '--full-tree', subjectHead, '--', entryPath], {
      encoding: null, maxBuffer: 64 * 1024, windowsHide: true,
    });
  } catch (err) {
    throw new Error('projection-subject-tree-unresolvable');
  }
  if (!Buffer.isBuffer(listing)) listing = Buffer.from(listing);
  const records = listing.toString('utf8').split('\0').filter((value) => value.length > 0);
  if (records.length !== 1) throw new Error('projection-subject-tree-ambiguous');
  const tab = records[0].indexOf('\t');
  if (tab <= 0 || records[0].slice(tab + 1) !== entryPath) throw new Error('projection-subject-path-mismatch');
  const header = records[0].slice(0, tab).split(' ');
  if (
    header.length !== 3 || !['100644', '100755'].includes(header[0])
    || header[1] !== 'blob' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(header[2])
  ) throw new Error('projection-subject-not-regular-blob');
  let bytes;
  try {
    bytes = execFileSync('git', ['-C', worker.projectRoot, 'cat-file', 'blob', header[2]], {
      encoding: null, maxBuffer: TURN_READ_PROJECTION_FILE_CAP + 1, windowsHide: true,
    });
  } catch (err) {
    throw new Error('projection-subject-blob-unresolvable');
  }
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const digest = rc.sha256Buffer(bytes);
  if (bytes.length !== expectedSize || digest !== expectedDigest) throw new Error('projection-subject-digest-mismatch');
  return {
    bytes,
    sourceRef: 'git:' + subjectHead + ':' + entryPath,
    source: {
      type: 'git-object', subjectHead, entryPath, objectId: header[2],
      gitMode: header[0], size: bytes.length, digest,
    },
  };
}

function subjectBytesForProjection(worker, planRoot, request, entry) {
  if (!Number.isInteger(entry.size) || entry.size < 0 || entry.size > TURN_READ_PROJECTION_FILE_CAP || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest)) {
    return null;
  }
  const blobPath = path.join(planRoot, 'blobs', entry.digest);
  let materialized = null;
  try { materialized = readFdBoundProjectionSource(blobPath, TURN_READ_PROJECTION_FILE_CAP); }
  catch (err) { materialized = null; }
  if (materialized) {
    if (materialized.bytes.length !== entry.size || materialized.digest !== entry.digest) throw new Error('projection-blob-mismatch');
    return {
      bytes: materialized.bytes,
      sourceRef: 'blob:' + entry.digest,
      source: projectionPathSourceDescriptor(blobPath, materialized),
    };
  }
  return readGitProjectionSource(worker, request.subject_head, entry.path, entry.size, entry.digest);
}

  return Object.freeze({
    chmodProjectionDirectories,
    fsyncProjectionPath,
    isSafeProjectionRelativePath,
    projectionPathSourceDescriptor,
    readFdBoundProjectionSource,
    readGitProjectionSource,
    removeProjectionTree,
    subjectBytesForProjection,
    writeProjectionBytesDurably,
    writeProjectionFile,
  });
}

module.exports = Object.freeze({ createTurnProjectionIo });
