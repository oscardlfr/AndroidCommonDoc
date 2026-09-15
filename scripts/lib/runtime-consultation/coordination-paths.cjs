'use strict';

// Coordination-tree confinement and canonical artifact path construction.
// Git topology resolution is delegated one layer down to git-identity.cjs.

const fs = require('fs');
const path = require('path');
const { CliError } = require('./primitives.cjs');
const { gitRevParse, realpathOrSelf } = require('./git-identity.cjs');

function planRootPath(coordRoot, repoId, waveSlug, planDigest) {
  return path.join(coordRoot, repoId, waveSlug, planDigest);
}

/** Recovers `<root>/<repo>/<wave>/<plan>` from an artifact below that tree. */
function planRootFromArtifact(coordRoot, artifactPath) {
  const rel = path.relative(path.resolve(coordRoot), path.resolve(artifactPath));
  const segments = rel.split(path.sep).filter(Boolean);
  if (segments.length < 3) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact path is not confined under coordination_root');
  }
  return path.join(path.resolve(coordRoot), segments[0], segments[1], segments[2]);
}

/** Resolves the deepest existing ancestor while retaining the absent tail. */
function realpathDeepestExisting(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return { real: fs.realpathSync(cur), tail: tail };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const parent = path.dirname(cur);
      if (parent === cur) throw err;
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/** Proves physical, not merely lexical, confinement below coordination_root. */
function assertGenuinelyConfinedUnderRoot(coordRoot, artifactPath) {
  let realCoordRoot;
  try {
    realCoordRoot = fs.realpathSync(coordRoot);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination_root does not resolve: ' + coordRoot);
  }
  const { real: realExistingAncestor, tail } = realpathDeepestExisting(artifactPath);
  const fullReal = tail.length ? path.join(realExistingAncestor, ...tail) : realExistingAncestor;
  const rel = path.relative(realCoordRoot, fullReal);
  if (rel === '' || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact path is not confined under coordination_root once symlinks are resolved: ' + artifactPath);
  }
}

function assertCanonicalFilename(artifactPath, expectedBasename) {
  if (path.basename(artifactPath) !== expectedBasename) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is not referenced at its own canonical filename (' + expectedBasename + '): ' + artifactPath);
  }
}

/** Confines an existing coordination root to its enclosing git worktree. */
function assertRootConfinedToWorktree(existingCoordRoot) {
  let worktreeToplevel;
  try {
    worktreeToplevel = gitRevParse(existingCoordRoot, ['rev-parse', '--show-toplevel']);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root is not inside any git worktree: ' + existingCoordRoot);
  }
  const realWorktree = path.resolve(realpathOrSelf(worktreeToplevel));
  const realCoordRoot = path.resolve(realpathOrSelf(existingCoordRoot));
  const rel = path.relative(realWorktree, realCoordRoot);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root is not confined under its own worktree: ' + existingCoordRoot);
  }
}

function transactionsDir(planRoot) {
  return path.join(planRoot, 'transactions');
}

function transactionDir(planRoot, requestId) {
  return path.join(transactionsDir(planRoot), requestId);
}

function requestPathFor(planRoot, requestId) {
  return path.join(transactionDir(planRoot, requestId), 'request.json');
}

function activationPathFor(txnDir, attemptId) {
  return path.join(txnDir, 'activations', attemptId + '.json');
}

function claimPathFor(txnDir, attemptId) {
  return path.join(txnDir, 'claims', attemptId + '.json');
}

function activeLeasePathFor(txnDir, attemptId) {
  return path.join(txnDir, 'active-leases', attemptId + '.json');
}

function resultPathFor(txnDir, attemptId) {
  return path.join(txnDir, 'results', attemptId + '.json');
}

function deliveryPathFor(txnDir, attemptId) {
  return path.join(txnDir, 'delivery', attemptId + '.json');
}

function activationIntentPathFor(txnDir, attemptId) {
  return path.join(txnDir, 'delivery', attemptId + '.intent.json');
}

function takeoverPathFor(txnDir) {
  return path.join(txnDir, 'takeover.json');
}

function acceptedResultPathFor(txnDir) {
  return path.join(txnDir, 'accepted-result.json');
}

function ackPathFor(txnDir) {
  return path.join(txnDir, 'ack.json');
}

function cancelPathFor(txnDir) {
  return path.join(txnDir, 'cancel.json');
}

function inboxPathFor(planRoot, role, requestId) {
  return path.join(planRoot, 'inbox', role, requestId + '.json');
}

function blobPathFor(planRoot, digest) {
  return path.join(planRoot, 'blobs', digest);
}

function patternEvidencePathFor(txnDir) {
  return path.join(txnDir, 'evidence', 'context7.json');
}

function stopPathFor(base, role, workerSessionId, stopId) {
  return path.join(base, 'workers', role, workerSessionId, 'stops', stopId + '.json');
}

function stopAckPathFor(stopPath, stopId) {
  return path.join(path.dirname(stopPath), stopId + '.ack.json');
}

function assertSafeSegment(segment, label) {
  if (
    typeof segment !== 'string'
    || segment.length === 0
    || segment.includes('/')
    || segment.includes('\\')
    || segment === '.'
    || segment === '..'
    || segment.includes('\0')
  ) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'unsafe path segment for ' + label);
  }
}

const HEX_ID_RE = /^[a-f0-9]{32,128}$/;

function assertHexId(value, label) {
  if (typeof value !== 'string' || !HEX_ID_RE.test(value)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', label + ' must be a lowercase-hex id');
  }
}

module.exports = {
  planRootPath, planRootFromArtifact, realpathDeepestExisting,
  assertGenuinelyConfinedUnderRoot, assertCanonicalFilename, assertRootConfinedToWorktree,
  transactionsDir, transactionDir, requestPathFor,
  activationPathFor, claimPathFor, activeLeasePathFor, resultPathFor, deliveryPathFor,
  activationIntentPathFor, takeoverPathFor, acceptedResultPathFor, ackPathFor, cancelPathFor,
  inboxPathFor, blobPathFor, patternEvidencePathFor, stopPathFor, stopAckPathFor,
  HEX_ID_RE, assertSafeSegment, assertHexId,
};
