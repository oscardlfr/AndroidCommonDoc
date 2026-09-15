'use strict';

// Git-derived repository identity and tamper-evident topology sealing. This
// module depends only on Node built-ins and lowest-level primitives.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { sha256Buffer, sha256String } = require('./primitives.cjs');

function gitRevParse(cwd, args) {
  return execFileSync('git', ['-C', cwd].concat(args),
    { encoding: 'utf8', windowsHide: true }).trim();
}

function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch (err) {
    return p;
  }
}

/** `repo_id = sha256(realpath(git rev-parse --path-format=absolute --git-common-dir))`. */
function computeRepoId(cwd) {
  const commonDir = gitRevParse(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return sha256String(realpathOrSelf(commonDir));
}

/** `worktree_id = sha256(realpath(git rev-parse --show-toplevel))`. */
function computeWorktreeId(cwd) {
  const toplevel = gitRevParse(cwd, ['rev-parse', '--show-toplevel']);
  return sha256String(realpathOrSelf(toplevel));
}

function statIdentityOrNull(p) {
  try {
    const st = fs.lstatSync(p);
    return {
      dev: st.dev, ino: st.ino, mode: st.mode, uid: st.uid, nlink: st.nlink,
      birthtimeMs: st.birthtimeMs,
      isDirectory: st.isDirectory(), isFile: st.isFile(), isSymbolicLink: st.isSymbolicLink(),
    };
  } catch (err) {
    return null;
  }
}

function readlinkOrNull(p) {
  try {
    return fs.readlinkSync(p);
  } catch (err) {
    return null;
  }
}

/**
 * Opens without following links, binds the read to `priorStat`, and validates
 * identity again after reading. Returns null on any failure.
 */
function readFdBoundFileOrNull(p, priorStat) {
  let bytes = null;
  let fd;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (opened.isFile() && opened.dev === priorStat.dev && opened.ino === priorStat.ino) {
      const chunks = [];
      const buf = Buffer.alloc(65536);
      let read;
      while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) chunks.push(Buffer.from(buf.subarray(0, read)));
      const afterStat = fs.fstatSync(fd);
      if (afterStat.dev === opened.dev && afterStat.ino === opened.ino && afterStat.size === opened.size) {
        bytes = Buffer.concat(chunks);
      }
    }
  } catch (err) {
    bytes = null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (err) { /* best effort */ } }
  }
  return bytes;
}

/** Captures the concrete facts behind a resolved project/common-dir pair. */
function sealGitIdentityFor(projectReal, gitCommonDirReal) {
  const gitEntryPath = path.join(projectReal, '.git');
  const gitEntryStat = statIdentityOrNull(gitEntryPath);
  const gitEntrySymlinkTarget = gitEntryStat && gitEntryStat.isSymbolicLink ? readlinkOrNull(gitEntryPath) : null;
  const resolvedGitEntry = realpathOrSelf(gitEntryPath);
  const resolvedGitEntryStat = statIdentityOrNull(resolvedGitEntry);
  let gitdirFileSha256 = null;
  let gitdirTargetReal = null;
  let isLinkedWorktree = false;
  if (resolvedGitEntryStat && resolvedGitEntryStat.isFile) {
    isLinkedWorktree = true;
    const bytes = readFdBoundFileOrNull(resolvedGitEntry, resolvedGitEntryStat);
    if (bytes) {
      gitdirFileSha256 = sha256Buffer(bytes);
      const match = bytes.toString('utf8').match(/^gitdir:\s*(.+?)\s*$/m);
      const rawTarget = match ? match[1] : null;
      gitdirTargetReal = rawTarget
        ? realpathOrSelf(path.isAbsolute(rawTarget) ? rawTarget : path.resolve(projectReal, rawTarget))
        : null;
    }
  } else if (resolvedGitEntryStat && resolvedGitEntryStat.isDirectory) {
    gitdirTargetReal = resolvedGitEntry;
  }

  let commondirStat = null;
  let commondirSymlinkTarget = null;
  let commondirSha256 = null;
  let commondirTargetReal = null;
  if (isLinkedWorktree && gitdirTargetReal) {
    const commondirPath = path.join(gitdirTargetReal, 'commondir');
    commondirStat = statIdentityOrNull(commondirPath);
    commondirSymlinkTarget = commondirStat && commondirStat.isSymbolicLink ? readlinkOrNull(commondirPath) : null;
    if (commondirStat && commondirStat.isFile) {
      const bytes = readFdBoundFileOrNull(commondirPath, commondirStat);
      if (bytes) {
        commondirSha256 = sha256Buffer(bytes);
        const raw = bytes.toString('utf8').replace(/\r?\n+$/, '');
        commondirTargetReal = raw
          ? realpathOrSelf(path.isAbsolute(raw) ? raw : path.resolve(gitdirTargetReal, raw))
          : null;
      }
    }
  }

  return {
    projectRealStat: statIdentityOrNull(projectReal),
    gitEntryStat,
    gitEntrySymlinkTarget,
    resolvedGitEntry,
    resolvedGitEntryStat,
    gitdirFileSha256,
    gitdirTargetReal,
    gitdirTargetStat: gitdirTargetReal ? statIdentityOrNull(gitdirTargetReal) : null,
    isLinkedWorktree,
    commondirStat,
    commondirSymlinkTarget,
    commondirSha256,
    commondirTargetReal,
    gitCommonDirReal,
    gitCommonDirStat: statIdentityOrNull(gitCommonDirReal),
  };
}

function statIdentityEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  // nlink is deliberately excluded: for a directory it changes whenever an
  // ordinary immediate child directory is created or removed.
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid
    && a.birthtimeMs === b.birthtimeMs
    && a.isDirectory === b.isDirectory && a.isFile === b.isFile
    && a.isSymbolicLink === b.isSymbolicLink;
}

/** Exact field comparison, intentionally independent of JSON key order. */
function gitTopologySealsMatch(a, b) {
  if (!a || !b) return false;
  return statIdentityEqual(a.projectRealStat, b.projectRealStat)
    && statIdentityEqual(a.gitEntryStat, b.gitEntryStat)
    && a.gitEntrySymlinkTarget === b.gitEntrySymlinkTarget
    && a.resolvedGitEntry === b.resolvedGitEntry
    && statIdentityEqual(a.resolvedGitEntryStat, b.resolvedGitEntryStat)
    && a.gitdirFileSha256 === b.gitdirFileSha256
    && a.gitdirTargetReal === b.gitdirTargetReal
    && statIdentityEqual(a.gitdirTargetStat, b.gitdirTargetStat)
    && a.isLinkedWorktree === b.isLinkedWorktree
    && statIdentityEqual(a.commondirStat, b.commondirStat)
    && a.commondirSymlinkTarget === b.commondirSymlinkTarget
    && a.commondirSha256 === b.commondirSha256
    && a.commondirTargetReal === b.commondirTargetReal
    && a.gitCommonDirReal === b.gitCommonDirReal
    && statIdentityEqual(a.gitCommonDirStat, b.gitCommonDirStat);
}

/** Proves that a linked worktree's commondir bytes agree with git's result. */
function sealCorrelatesWithGitCommonDir(seal, gitCommonDirReal) {
  if (!seal) return false;
  if (!seal.isLinkedWorktree) return true;
  if (!seal.commondirTargetReal) return false;
  return seal.commondirTargetReal === gitCommonDirReal;
}

/** Generic sealed cache for expensive git-derived per-project facts. */
function resolveSealedGitCache(cacheMap, projectRoot, deriveFn) {
  const existing = cacheMap.get(projectRoot);
  if (existing) {
    const freshSeal = sealGitIdentityFor(existing.derived.projectReal, existing.derived.gitCommonDirReal);
    if (!gitTopologySealsMatch(existing.seal, freshSeal)) {
      return { ok: false, reason: 'git-topology-seal-mismatch' };
    }
    if (!sealCorrelatesWithGitCommonDir(freshSeal, existing.derived.gitCommonDirReal)) {
      return { ok: false, reason: 'git-topology-commondir-correlation-mismatch' };
    }
    return { ok: true, derived: existing.derived };
  }
  let result;
  try {
    result = deriveFn(projectRoot);
  } catch (err) {
    return { ok: false, reason: 'git-topology-unresolvable' };
  }
  if (!result.ok) return result;
  const seal = sealGitIdentityFor(result.projectReal, result.gitCommonDirReal);
  if (!sealCorrelatesWithGitCommonDir(seal, result.gitCommonDirReal)) {
    return { ok: false, reason: 'git-topology-commondir-correlation-mismatch' };
  }
  cacheMap.set(projectRoot, { derived: result, seal });
  return { ok: true, derived: result };
}

function computeSubjectHead(cwd) {
  return gitRevParse(cwd, ['rev-parse', 'HEAD']);
}

function computeCoordRootId(coordRoot) {
  return sha256String(realpathOrSelf(coordRoot));
}

module.exports = {
  gitRevParse, realpathOrSelf, computeRepoId, computeWorktreeId,
  statIdentityOrNull, readlinkOrNull, readFdBoundFileOrNull,
  sealGitIdentityFor, statIdentityEqual, gitTopologySealsMatch,
  sealCorrelatesWithGitCommonDir, resolveSealedGitCache,
  computeSubjectHead, computeCoordRootId,
};
