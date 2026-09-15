'use strict';

// Constructs, source-validates and durably closes the TurnReadProjection/v1 `current/` tree a retained worker turn is granted read access to.

function createTurnProjectionBuild({
  TURN_READ_PROJECTION_ENTRY_CAP,
  TURN_READ_PROJECTION_FILE_CAP,
  TURN_READ_PROJECTION_TOTAL_CAP,
  canonicalJSONStringify,
  chmodProjectionDirectories,
  crypto,
  fs,
  fsyncProjectionPath,
  hasExactKeys,
  isHexActionId,
  isSafeProjectionRelativePath,
  path,
  projectionPathSourceDescriptor,
  rc,
  readFdBoundProjectionSource,
  readGitProjectionSource,
  removeProjectionTree,
  resolveCanonicalRoleProfile,
  subjectBytesForProjection,
  writeProjectionBytesDurably,
  writeProjectionFile,
}) {
function validateProjectionSources(worker, projection) {
  if (!projection || !Array.isArray(projection.sources) || projection.sources.length > TURN_READ_PROJECTION_ENTRY_CAP + 4) {
    return { ok: false, reason: 'projection-source-set-invalid' };
  }
  try {
    for (const source of projection.sources) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('projection-source-descriptor-invalid');
      if (source.type === 'path') {
        const current = readFdBoundProjectionSource(source.sourcePath, TURN_READ_PROJECTION_FILE_CAP);
        if (
          current.digest !== source.digest
          || current.identity.dev !== source.identity.dev || current.identity.ino !== source.identity.ino
          || current.identity.size !== source.identity.size || current.identity.mode !== source.identity.mode
          || current.identity.uid !== source.identity.uid || current.identity.nlink !== source.identity.nlink
        ) throw new Error('projection-authoritative-source-drift');
        continue;
      }
      if (source.type === 'git-object') {
        const current = readGitProjectionSource(
          worker, source.subjectHead, source.entryPath, source.size, source.digest,
        );
        if (current.source.objectId !== source.objectId || current.source.gitMode !== source.gitMode) {
          throw new Error('projection-git-source-drift');
        }
        continue;
      }
      if (source.type === 'role-profile') {
        const current = resolveCanonicalRoleProfile(worker.role);
        if (!current.ok || current.digest !== source.digest || Buffer.byteLength(current.bytes, 'utf8') !== source.size) {
          throw new Error('projection-role-profile-drift');
        }
        continue;
      }
      throw new Error('projection-source-type-invalid');
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'turn-read-projection-source-validation-failed:' + String((err && err.message) || err) };
  }
}

function buildTurnReadProjection(worker, item, acceptedChildren) {
  const planRoot = path.dirname(path.dirname(path.dirname(item.requestPath)));
  const txnDir = path.dirname(item.requestPath);
  const staging = path.join(worker.readViewRoot, '.staging-' + crypto.randomBytes(8).toString('hex'));
  const current = path.join(worker.readViewRoot, 'current');
  const retired = path.join(worker.readViewRoot, '.retired-' + crypto.randomBytes(8).toString('hex'));
  fs.chmodSync(worker.readViewRoot, 0o700);
  fs.mkdirSync(staging, { mode: 0o700 });
  const entries = [];
  const sources = [];
  let totalBytes = 0;
  try {
    const accountBytes = (bytes) => {
      totalBytes += bytes.length;
      if (totalBytes > TURN_READ_PROJECTION_TOTAL_CAP) throw new Error('projection-total-cap-exceeded');
    };
    const addSource = (relativePath, sourcePath, kind, sourceRef) => {
      const source = readFdBoundProjectionSource(sourcePath, TURN_READ_PROJECTION_FILE_CAP);
      accountBytes(source.bytes);
      writeProjectionFile(staging, relativePath, source.bytes, kind, sourceRef, entries);
      sources.push(projectionPathSourceDescriptor(sourcePath, source));
      return source;
    };
    // A P5 mixed review is not a P2 root-consult transaction and has no transaction tree: the
    // lifecycle CLI publishes exactly two records for it, root-consult-intents/<id>.json and
    // mixed-review-subjects/<id>.json. Everything below this branch -- <planRoot>/plan_ref, the
    // activation, the claim, the subject-bundle manifest -- belongs to that P2 shape, so asking for
    // it here failed on the very first source and the reviewer could never take its turn. The read
    // view a verdict genuinely needs is the intent it must answer, the subject it must judge and
    // the role profile it must judge as; every one of those bytes is host-derived, exactly like
    // P2's, and is projected through the same staging/validate/chmod path with the same caps.
    const isMixedReviewTurn = item.expectedResultKind === 'P5_MIXED_REVIEW_VERDICT';
    if (!isMixedReviewTurn) addSource('plan/PLAN.md', path.join(planRoot, 'plan_ref'), 'plan', 'plan_ref');
    const profileBytes = Buffer.from(worker.profileBytes, 'utf8');
    accountBytes(profileBytes);
    writeProjectionFile(staging, 'role/profile.md', profileBytes, 'role-profile', 'canonical-role-profile:' + worker.profileDigest, entries);
    sources.push({ type: 'role-profile', digest: worker.profileDigest, size: profileBytes.length });
    if (isMixedReviewTurn) {
      addSource('intent/request.json', item.requestPath, 'request', 'request:' + item.requestId);
      // The DURABLE subject record, not the caller's in-memory copy of it. Going through addSource
      // is what makes it a `path` source, which validateProjectionSources re-reads and re-identifies
      // before the turn is allowed to start -- the same anti-drift guarantee every other projected
      // file already has. The record is self-verifying (it stores the digest of its own text) and
      // the caller has already checked that digest before dispatching this turn.
      if (typeof item.subjectPath !== 'string' || item.subjectPath.length === 0) {
        throw new Error('projection-mixed-review-subject-missing');
      }
      addSource('subject/subject.json', item.subjectPath, 'subject', 'mixed-review-subject:' + item.rootRequestId);
    } else {
    addSource('transaction/request.json', item.requestPath, 'request', 'request:' + item.requestId);
    addSource('transaction/activation.json', path.join(txnDir, 'activations', item.attemptId + '.json'), 'activation', 'activation:' + item.attemptId);
    addSource('transaction/claim.json', item.claimPath, 'claim', 'claim:' + item.attemptId);

    const request = JSON.parse(readFdBoundProjectionSource(item.requestPath, TURN_READ_PROJECTION_FILE_CAP).bytes.toString('utf8'));
    const bundlePath = path.join(planRoot, 'subject-bundles', request.subject_scope_digest, 'manifest.json');
    const bundle = readFdBoundProjectionSource(bundlePath, TURN_READ_PROJECTION_FILE_CAP);
    if (bundle.digest !== request.subject_scope_digest) throw new Error('projection-subject-bundle-digest-mismatch');
    sources.push(projectionPathSourceDescriptor(bundlePath, bundle));
    const bundleObj = JSON.parse(bundle.bytes.toString('utf8'));
    if (!bundleObj || bundleObj.schema !== 'coordination/subject-bundle-manifest/v1' || !Array.isArray(bundleObj.entries) || bundleObj.entries.length > TURN_READ_PROJECTION_ENTRY_CAP) {
      throw new Error('projection-subject-bundle-invalid');
    }
    const seenSubjectPaths = new Set();
    for (const entry of bundleObj.entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !isSafeProjectionRelativePath(entry.path) || seenSubjectPaths.has(entry.path)) {
        throw new Error('projection-subject-entry-invalid');
      }
      seenSubjectPaths.add(entry.path);
      const subject = subjectBytesForProjection(worker, planRoot, request, entry);
      if (subject) {
        accountBytes(subject.bytes);
        writeProjectionFile(staging, 'subject/' + entry.path, subject.bytes, 'subject', subject.sourceRef, entries);
        sources.push(subject.source);
      } else {
        entries.push({ kind: 'subject-metadata', source_ref: 'manifest:' + entry.path, projected_path: null, size: 0, digest: rc.sha256Buffer(Buffer.alloc(0)) });
      }
    }
    }

    for (const child of acceptedChildren || []) {
      if (!child || !child.dependency || !isHexActionId(child.dependency.request_id)) throw new Error('projection-dependency-invalid');
      const prefix = 'dependencies/' + child.dependency.request_id + '/';
      addSource(prefix + 'accepted-result.json', child.acceptedPath, 'accepted-child', 'accepted:' + child.dependency.request_id);
      addSource(prefix + 'result.json', child.resultPath, 'child-result', 'result:' + child.dependency.request_id);
    }

    const manifest = {
      schema: 'coordination/turn-read-projection/v1',
      request_id: item.requestId,
      root_request_id: item.rootRequestId,
      role: worker.role,
      worker_session_id: worker.workerSessionId,
      thread_id: worker.threadId,
      entries: entries.slice().sort((a, b) => String(a.projected_path).localeCompare(String(b.projected_path))),
      created_at: new Date().toISOString(),
    };
    const manifestBytes = Buffer.from(canonicalJSONStringify(manifest), 'utf8');
    accountBytes(manifestBytes);
    writeProjectionBytesDurably(path.join(staging, 'manifest.json'), manifestBytes);
    chmodProjectionDirectories(staging, 0o500);
    fsyncProjectionPath(staging);

    if (fs.existsSync(current)) fs.renameSync(current, retired);
    fs.renameSync(staging, current);
    fsyncProjectionPath(worker.readViewRoot);
    if (fs.existsSync(retired)) removeProjectionTree(retired);
    fs.chmodSync(worker.readViewRoot, 0o500);
    return { ok: true, manifestDigest: rc.sha256Buffer(manifestBytes), current, sources };
  } catch (err) {
    try { if (fs.existsSync(staging)) removeProjectionTree(staging); } catch (cleanupErr) { /* fail below */ }
    try { fs.chmodSync(worker.readViewRoot, 0o500); } catch (cleanupErr) { /* fail below */ }
    return { ok: false, reason: 'turn-read-projection-build-failed:' + String((err && err.message) || err) };
  }
}
function validateTurnReadProjection(worker, projection) {
  try {
    const current = path.join(worker.readViewRoot, 'current');
    const rootStat = fs.lstatSync(worker.readViewRoot);
    const currentStat = fs.lstatSync(current);
    const assertOwnedProjectionNode = (st, expectedKind, expectedMode) => {
      if (
        (expectedKind === 'directory' ? !st.isDirectory() : !st.isFile())
        || st.isSymbolicLink() || (expectedKind === 'file' && st.nlink !== 1)
      ) throw new Error('projection-node-invalid');
      if (process.platform !== 'win32') {
        if ((st.mode & 0o777) !== expectedMode) throw new Error('projection-node-mode-invalid');
        if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error('projection-node-owner-invalid');
      }
    };
    assertOwnedProjectionNode(rootStat, 'directory', 0o500);
    assertOwnedProjectionNode(currentStat, 'directory', 0o500);
    const rootEntries = fs.readdirSync(worker.readViewRoot, { withFileTypes: true });
    if (
      rootEntries.length !== 1 || rootEntries[0].name !== 'current'
      || !rootEntries[0].isDirectory() || rootEntries[0].isSymbolicLink()
    ) return { ok: false, reason: 'projection-sibling-view-present' };

    const manifestRead = readFdBoundProjectionSource(path.join(current, 'manifest.json'), TURN_READ_PROJECTION_FILE_CAP);
    if (manifestRead.digest !== projection.manifestDigest) return { ok: false, reason: 'projection-manifest-drift' };
    assertOwnedProjectionNode(fs.lstatSync(path.join(current, 'manifest.json')), 'file', 0o400);
    const manifest = JSON.parse(manifestRead.bytes.toString('utf8'));
    if (
      !manifest || !hasExactKeys(manifest, [
        'created_at', 'entries', 'request_id', 'role', 'root_request_id',
        'schema', 'thread_id', 'worker_session_id',
      ])
      || manifest.schema !== 'coordination/turn-read-projection/v1'
      || manifest.role !== worker.role || manifest.worker_session_id !== worker.workerSessionId
      || manifest.thread_id !== worker.threadId || !Array.isArray(manifest.entries)
      || manifest.entries.length > TURN_READ_PROJECTION_ENTRY_CAP
      // ROOT-INGRESS-E2E finding: a root-consult's own request_id (and its
      // root_request_id, always equal for a depth:0 request) is the CLI's
      // preallocated 32-hex id, never genId()'s 64-hex -- same shape isHexActionId
      // already validates elsewhere in this file (line 585). An ordinary/
      // root-source request_id is 64-hex and still satisfies this open-ended check.
      || !isHexActionId(manifest.request_id)
      || !isHexActionId(manifest.root_request_id)
      || !Number.isFinite(Date.parse(manifest.created_at))
    ) return { ok: false, reason: 'projection-manifest-invalid' };
    const expectedFiles = new Set(['manifest.json']);
    let projectedBytes = manifestRead.bytes.length;
    let previousSortKey = null;
    for (const entry of manifest.entries) {
      if (
        !entry || typeof entry !== 'object' || Array.isArray(entry)
        || !hasExactKeys(entry, ['digest', 'kind', 'projected_path', 'size', 'source_ref'])
        || typeof entry.kind !== 'string' || entry.kind.length === 0 || Buffer.byteLength(entry.kind, 'utf8') > 256
        || typeof entry.source_ref !== 'string' || entry.source_ref.length === 0 || Buffer.byteLength(entry.source_ref, 'utf8') > 4096
        || !Number.isInteger(entry.size) || entry.size < 0 || entry.size > TURN_READ_PROJECTION_FILE_CAP
        || !/^[a-f0-9]{64}$/.test(entry.digest)
      ) return { ok: false, reason: 'projection-entry-invalid' };
      const sortKey = String(entry.projected_path);
      if (previousSortKey !== null && previousSortKey.localeCompare(sortKey) > 0) return { ok: false, reason: 'projection-entry-order-invalid' };
      previousSortKey = sortKey;
      if (entry.projected_path === null) {
        if (entry.kind !== 'subject-metadata' || entry.size !== 0 || entry.digest !== rc.sha256Buffer(Buffer.alloc(0))) {
          return { ok: false, reason: 'projection-metadata-entry-invalid' };
        }
        continue;
      }
      if (!isSafeProjectionRelativePath(entry.projected_path) || expectedFiles.has(entry.projected_path)) return { ok: false, reason: 'projection-entry-invalid' };
      expectedFiles.add(entry.projected_path);
      const projectedPath = path.join(current, ...entry.projected_path.split('/'));
      const read = readFdBoundProjectionSource(projectedPath, TURN_READ_PROJECTION_FILE_CAP);
      assertOwnedProjectionNode(fs.lstatSync(projectedPath), 'file', 0o400);
      if (read.bytes.length !== entry.size || read.digest !== entry.digest) return { ok: false, reason: 'projection-entry-drift' };
      projectedBytes += read.bytes.length;
      if (projectedBytes > TURN_READ_PROJECTION_TOTAL_CAP) return { ok: false, reason: 'projection-total-cap-exceeded' };
    }
    const actualFiles = new Set();
    function walk(dir, prefix) {
      const lst = fs.lstatSync(dir);
      assertOwnedProjectionNode(lst, 'directory', 0o500);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? prefix + '/' + entry.name : entry.name;
        const child = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error('projection-symlink-rejected');
        if (entry.isDirectory()) walk(child, rel);
        else if (entry.isFile()) {
          assertOwnedProjectionNode(fs.lstatSync(child), 'file', 0o400);
          actualFiles.add(rel);
        }
        else throw new Error('projection-nonregular-rejected');
      }
    }
    walk(current, '');
    if (actualFiles.size !== expectedFiles.size || Array.from(expectedFiles).some((file) => !actualFiles.has(file))) {
      return { ok: false, reason: 'projection-extra-or-missing-entry' };
    }
    const sourceValidation = validateProjectionSources(worker, projection);
    if (!sourceValidation.ok) return sourceValidation;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'turn-read-projection-validation-failed:' + String((err && err.message) || err) };
  }
}

function closeTurnReadProjection(worker) {
  try {
    fs.chmodSync(worker.readViewRoot, 0o700);
    const rootEntries = fs.readdirSync(worker.readViewRoot, { withFileTypes: true });
    if (rootEntries.length > 8) throw new Error('projection-cleanup-entry-cap-exceeded');
    for (const entry of rootEntries) {
      if (
        !entry.isDirectory() || entry.isSymbolicLink()
        || !(
          entry.name === 'current'
          || /^\.staging-[a-f0-9]{16}$/.test(entry.name)
          || /^\.retired-[a-f0-9]{16}$/.test(entry.name)
        )
      ) throw new Error('projection-cleanup-foreign-entry');
    }
    const current = path.join(worker.readViewRoot, 'current');
    if (rootEntries.some((entry) => entry.name === 'current')) {
      const retired = path.join(worker.readViewRoot, '.retired-' + crypto.randomBytes(8).toString('hex'));
      fs.renameSync(current, retired);
      fsyncProjectionPath(worker.readViewRoot);
    }
    for (const entry of fs.readdirSync(worker.readViewRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && /^\.(?:staging|retired)-[a-f0-9]{16}$/.test(entry.name)) {
        removeProjectionTree(path.join(worker.readViewRoot, entry.name));
      }
    }
    fsyncProjectionPath(worker.readViewRoot);
    fs.chmodSync(worker.readViewRoot, 0o500);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'turn-read-projection-close-failed' };
  }
}

  return Object.freeze({
    buildTurnReadProjection,
    closeTurnReadProjection,
    validateProjectionSources,
    validateTurnReadProjection,
  });
}

module.exports = Object.freeze({ createTurnProjectionBuild });
