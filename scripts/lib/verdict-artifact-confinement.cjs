'use strict';
// Canonical path confinement for verdict artifacts (PLAN 3.6-3.7).
// Kept separate from durable I/O so both modules stay focused and reviewable.
const fs = require('fs');
const path = require('path');

function confinementError(message) {
  const error = new Error(message);
  error.reasonCode = 'confinement-failed';
  throw error;
}

function resolveThroughExistingAncestor(targetPath) {
  let candidate = path.resolve(targetPath);
  const missingSegments = [];
  for (;;) {
    try {
      return path.resolve(fs.realpathSync(candidate), ...missingSegments.reverse());
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      missingSegments.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

// Windows junctions report isSymbolicLink()===true via lstat but are not
// rejected by O_NOFOLLOW at open(), so every existing component is checked.
function assertConfinedAncestry(waveDir, targetPath, includeLeaf) {
  const logicalRoot = path.resolve(waveDir);
  let resolvedRoot;
  try {
    resolvedRoot = fs.realpathSync(logicalRoot);
  } catch (error) {
    confinementError('wave directory does not exist: ' + logicalRoot);
  }
  const lexicalTarget = path.resolve(path.isAbsolute(targetPath) ? targetPath : path.join(logicalRoot, targetPath));
  const logicalRelative = path.relative(logicalRoot, lexicalTarget);
  let canonicalTarget;
  try {
    canonicalTarget = resolveThroughExistingAncestor(lexicalTarget);
  } catch (error) {
    confinementError('cannot resolve target ancestry: ' + lexicalTarget);
  }
  const canonicalRelative = path.relative(resolvedRoot, canonicalTarget);
  const targetIsRoot = lexicalTarget === logicalRoot || canonicalTarget === resolvedRoot;
  const logicalConfined = logicalRelative !== '' && !logicalRelative.startsWith('..') && !path.isAbsolute(logicalRelative);
  const canonicalConfined = canonicalRelative !== '' && !canonicalRelative.startsWith('..') && !path.isAbsolute(canonicalRelative);
  if (!targetIsRoot && !logicalConfined && !canonicalConfined) {
    confinementError('target escapes the wave directory: ' + targetPath);
  }
  // Prefer the logical relative path so the walk observes symlinks inside the
  // wave. Use the canonical target only for an alias above the wave root.
  const resolvedTarget = targetIsRoot ? resolvedRoot
    : (logicalConfined ? path.resolve(resolvedRoot, logicalRelative) : canonicalTarget);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if ((relative === '' && !includeLeaf) || relative.startsWith('..') || path.isAbsolute(relative)) {
    confinementError('target escapes the wave directory: ' + targetPath);
  }
  let rootStat;
  try {
    rootStat = fs.lstatSync(logicalRoot);
  } catch (error) {
    confinementError('wave directory does not exist: ' + logicalRoot);
  }
  if (rootStat.isSymbolicLink()) confinementError('wave directory is a symlink: ' + resolvedRoot);
  const segments = relative.split(path.sep);
  let walked = resolvedRoot;
  for (let index = 0; index < segments.length; index += 1) {
    walked = path.join(walked, segments[index]);
    let segmentStat;
    try {
      segmentStat = fs.lstatSync(walked);
    } catch (error) {
      if (!includeLeaf) break;
      confinementError('path component does not exist: ' + walked);
    }
    if (segmentStat.isSymbolicLink()) {
      confinementError('path component is a symlink or reparse point: ' + walked);
    }
  }
  return resolvedTarget;
}

module.exports = { assertConfinedAncestry };
