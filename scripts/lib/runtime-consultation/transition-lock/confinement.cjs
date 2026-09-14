'use strict';

const fs = require('fs');
const path = require('path');
const { CliError } = require('../primitives.cjs');

/** Canonical containment: `artifactPath` is `base` itself or strictly beneath it (no `..`, no sibling-prefix). */
function isPathWithin(base, artifactPath) {
  const rel = path.relative(base, path.resolve(artifactPath));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/**
 * Rejects a transition directory outside its coordination root, or any
 * symlink in the already-existing ancestor chain. Lock callers never create
 * the transaction directory, so every component must already exist.
 */
function assertAncestorChainConfined(root, targetDir) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetDir);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel === '' || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock directory is not lexically confined under its own coordination root: ' + resolvedTarget);
  }
  let lst;
  try {
    lst = fs.lstatSync(resolvedRoot);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root does not exist or could not be stat-verified: ' + resolvedRoot);
  }
  if (lst.isSymbolicLink()) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root is a symlink (rejected): ' + resolvedRoot);
  }
  let walked = resolvedRoot;
  for (const seg of rel.split(path.sep)) {
    walked = path.join(walked, seg);
    let segLst;
    try {
      segLst = fs.lstatSync(walked);
    } catch (err) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock ancestor path component does not exist or could not be stat-verified: ' + walked);
    }
    if (segLst.isSymbolicLink()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock ancestor path component is a symlink (rejected): ' + walked);
    }
  }
}

module.exports = { isPathWithin, assertAncestorChainConfined };
