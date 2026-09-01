'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

const WAVE_SLUG = 'portable-runtime-messaging-adapters';
const ROLES = Object.freeze(['arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'test-specialist']);
const ARCHITECT_ROLES = Object.freeze(['arch-platform', 'arch-testing', 'arch-integration']);
const ARTIFACT_SCHEMA = 'runtime/p2-genuine-capture/v1';
const ARCHITECT_SOURCE_QUESTIONS = Object.freeze({
  'arch-platform': 'Locate isValidBootstrapCompletion in scripts/lib/runtime-bridge-codex.cjs and report the exact source evidence for bootstrap READY validation.',
  'arch-testing': 'Locate if (obj.schema !== "runtime/p2-genuine-capture/v1") process.exit(1); in scripts/tests/runtime-consultation-bridge.bats and report the exact source evidence for the genuine artifact schema, evidence mode, single-capture count, plan/head shape, and empty repo-delta assertions.',
  'arch-integration': 'Locate P2 — authentic CP/PREP in .planning/wave-portable-runtime-messaging-adapters/PLAN.md and report the exact source evidence for its sequential three-architect closeout contract.',
});
function architectSourceQuestionFor(role) {
  const question = ARCHITECT_SOURCE_QUESTIONS[role];
  if (!question) throw ownerError('owner-p2-source-question-unmapped', `no canonical source question for role: ${role}`);
  return question;
}
const MAX_RECORD_BYTES = 1048576;
const SEED_CAPS = Object.freeze({ max_files_per_role: 24, max_bytes_per_file: 1048576, max_total_bytes_per_role: 8388608 });

const SEED_ENTRIES = Object.freeze([
  Object.freeze({ role: 'arch-integration', path: '.planning/wave-portable-runtime-messaging-adapters/PLAN.md' }),
  Object.freeze({ role: 'arch-integration', path: 'scripts/lib/runtime-bridge-codex.cjs' }),
  Object.freeze({ role: 'arch-integration', path: 'scripts/lib/runtime-consultation.cjs' }),
  Object.freeze({ role: 'arch-integration', path: 'scripts/lib/runtime-role-lifecycle.cjs' }),
  Object.freeze({ role: 'arch-integration', path: 'scripts/sh/write-verdict.sh' }),
  Object.freeze({ role: 'arch-integration', path: 'scripts/tests/runtime-consultation-bridge.bats' }),
  Object.freeze({ role: 'arch-integration', path: 'scripts/tests/runtime-role-lifecycle-prep-binding.test.js' }),
  Object.freeze({ role: 'arch-integration', path: 'scripts/tests/write-verdict.bats' }),
  Object.freeze({ role: 'arch-platform', path: 'scripts/lib/runtime-bridge-codex.cjs' }),
  Object.freeze({ role: 'arch-platform', path: 'scripts/lib/runtime-consultation.cjs' }),
  Object.freeze({ role: 'arch-platform', path: 'scripts/lib/runtime-role-lifecycle.cjs' }),
  Object.freeze({ role: 'arch-platform', path: 'scripts/sh/write-verdict.sh' }),
  Object.freeze({ role: 'arch-testing', path: 'scripts/tests/runtime-consultation-bridge.bats' }),
  Object.freeze({ role: 'arch-testing', path: 'scripts/tests/runtime-role-lifecycle-prep-binding.test.js' }),
  Object.freeze({ role: 'arch-testing', path: 'scripts/tests/write-verdict.bats' }),
]);

const MAX_PINNED_BINARY_BYTES = 512 * 1024 * 1024;
const EXPECTED_APP_SERVER_ARGS = Object.freeze(['app-server', '--listen', 'stdio://', '--strict-config']);
const PINNED_MODEL = 'host-selected-default';
const PINNED_PROTOCOL = 'codex-app-server-stdio-v2';

function ownerArgvError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function parseExecuteArgs(argv) {
  if (!Array.isArray(argv)) throw ownerArgvError('owner-argv-not-array', 'argv must be an array');
  let execute = false;
  let evidenceDir;
  let onceLock;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--execute') {
      if (execute) throw ownerArgvError('owner-argv-duplicate-flag', 'duplicate --execute');
      execute = true;
      continue;
    }
    if (token === '--evidence-dir' || token === '--once-lock') {
      const isEvidence = token === '--evidence-dir';
      if ((isEvidence && evidenceDir !== undefined) || (!isEvidence && onceLock !== undefined)) {
        throw ownerArgvError('owner-argv-duplicate-flag', `duplicate ${token}`);
      }
      const value = argv[i + 1];
      if (typeof value !== 'string' || value.length === 0) {
        throw ownerArgvError('owner-argv-missing-value', `${token} requires a value`);
      }
      if (isEvidence) evidenceDir = value; else onceLock = value;
      i += 1;
      continue;
    }
    throw ownerArgvError('owner-argv-unknown-flag', `unknown argument: ${token}`);
  }
  if (!execute) throw ownerArgvError('owner-argv-missing-flag', 'missing --execute');
  if (evidenceDir === undefined) throw ownerArgvError('owner-argv-missing-flag', 'missing --evidence-dir');
  if (onceLock === undefined) throw ownerArgvError('owner-argv-missing-flag', 'missing --once-lock');
  if (!path.isAbsolute(evidenceDir) || !path.isAbsolute(onceLock)) {
    throw ownerArgvError('owner-argv-not-absolute', 'paths must be absolute');
  }
  if (evidenceDir === onceLock) throw ownerArgvError('owner-argv-same-path', 'paths must be distinct');
  return Object.freeze({ evidenceDir, onceLock });
}

function ownerError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const P2_SEAM_ALLOWLIST = Object.freeze([
  'RUNTIME_BRIDGE_CODEX_P2_PRE_VERDICT_BARRIER_REACHED_PATH',
  'RUNTIME_BRIDGE_CODEX_P2_PRE_VERDICT_BARRIER_RELEASE_PATH',
  'RUNTIME_BRIDGE_CODEX_P2_PRE_VERDICT_BARRIER_ROLE',
  'RUNTIME_BRIDGE_CODEX_P2_COMPLETION_BARRIER_REACHED_PATH',
  'RUNTIME_BRIDGE_CODEX_P2_COMPLETION_BARRIER_RELEASE_PATH',
  'RUNTIME_BRIDGE_CODEX_P2_COMPLETION_BARRIER_ROLE',
  'RUNTIME_BRIDGE_CODEX_P2_WRITE_VERDICT_SPAWN_JSONL',
]);

function assertGenuineEnvironment(env) {
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw ownerError('owner-environment-invalid', 'env must be a non-null object');
  }
  const envPrototype = Object.getPrototypeOf(env);
  if (envPrototype !== Object.prototype && envPrototype !== null) {
    throw ownerError('owner-environment-invalid', 'env must be a plain object');
  }
  if (env.ANDROIDCOMMONDOC_P2_GENUINE_CAPTURE !== '1') {
    throw ownerError('owner-environment-opt-in-absent', 'missing genuine-capture opt-in');
  }
  if (env.NODE_ENV === 'test') {
    throw ownerError('owner-environment-test-mode', 'NODE_ENV must not be "test"');
  }
  const testPrefixes = ['RUNTIME_BRIDGE_CODEX_TEST_', 'RUNTIME_CONSULTATION_TEST_', 'RUNTIME_ROLE_LIFECYCLE_TEST_'];
  const seamPrefixes = ['RUNTIME_BRIDGE_CODEX_', 'RUNTIME_CONSULTATION_', 'RUNTIME_ROLE_LIFECYCLE_'];
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) continue;
    if (testPrefixes.some((p) => key.startsWith(p))) {
      throw ownerError('owner-environment-test-seam', `test seam variable present: ${key}`);
    }
    if (seamPrefixes.some((p) => key.startsWith(p)) && key.includes('_FAKE_')) {
      throw ownerError('owner-environment-fake-seam', `fake seam variable present: ${key}`);
    }
    if (key.startsWith('RUNTIME_BRIDGE_CODEX_P2_') && !P2_SEAM_ALLOWLIST.includes(key)) {
      throw ownerError('owner-environment-p2-seam-unrecognized', `unrecognized P2 seam variable: ${key}`);
    }
  }
  return true;
}

const isRegularNonSymlink = (stat) => stat.isFile() && !stat.isSymbolicLink();
const statsMatch = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.nlink === b.nlink;

function readFdBoundFile(filePath, maxBytes) {
  if (typeof filePath !== 'string' || filePath.length === 0 || !path.isAbsolute(filePath)) {
    throw ownerError('owner-fd-input-invalid', 'filePath must be an absolute nonempty string');
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw ownerError('owner-fd-input-invalid', 'maxBytes must be a positive integer');
  }
  let lstat;
  try {
    lstat = fs.lstatSync(filePath);
  } catch (cause) {
    throw ownerError('owner-fd-shape-invalid', `lstat failed: ${cause.message}`);
  }
  if (!isRegularNonSymlink(lstat) || lstat.nlink !== 1 || lstat.size <= 0 || lstat.size > maxBytes) {
    throw ownerError('owner-fd-shape-invalid', 'file shape does not satisfy fd-bound requirements');
  }
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch (cause) {
    throw ownerError('owner-fd-open-failed', `open failed: ${cause.message}`);
  }
  try {
    let openFstat;
    try {
      openFstat = fs.fstatSync(fd);
    } catch (cause) {
      throw ownerError('owner-fd-open-failed', `fstat failed: ${cause.message}`);
    }
    if (!isRegularNonSymlink(openFstat) || !statsMatch(openFstat, lstat)) {
      throw ownerError('owner-fd-identity-mismatch', 'fstat identity does not match lstat snapshot');
    }
    const bytes = Buffer.allocUnsafe(openFstat.size);
    let offset = 0;
    while (offset < bytes.length) {
      let read;
      try {
        read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      } catch (cause) {
        throw ownerError('owner-fd-read-failed', `read failed: ${cause.message}`);
      }
      if (read <= 0) {
        throw ownerError('owner-fd-short-read', 'read returned no bytes before buffer was full');
      }
      offset += read;
    }
    let postFstat, postLstat;
    try {
      postFstat = fs.fstatSync(fd);
      postLstat = fs.lstatSync(filePath);
    } catch (cause) {
      throw ownerError('owner-fd-post-read-drift', `post-read stat failed: ${cause.message}`);
    }
    const drifted =
      !isRegularNonSymlink(postFstat) ||
      !isRegularNonSymlink(postLstat) ||
      !statsMatch(postFstat, openFstat) ||
      !statsMatch(postLstat, openFstat);
    if (drifted) {
      throw ownerError('owner-fd-post-read-drift', 'file identity drifted during read');
    }
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    return Object.freeze({ bytes, digest, size: bytes.length });
  } finally {
    fs.closeSync(fd);
  }
}

function validateFreshOutputPaths(evidenceDir, onceLock) {
  for (const value of [evidenceDir, onceLock]) {
    if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value) || path.resolve(value) !== value) {
      throw ownerError('owner-output-input-invalid', 'evidenceDir and onceLock must be absolute, normalized, nonempty strings');
    }
  }
  const withSep = (value) => (value.endsWith(path.sep) ? value : value + path.sep);
  const evidenceWithSep = withSep(evidenceDir);
  const onceLockWithSep = withSep(onceLock);
  if (evidenceDir === onceLock || evidenceWithSep.startsWith(onceLockWithSep) || onceLockWithSep.startsWith(evidenceWithSep)) {
    throw ownerError('owner-output-path-collision', 'evidenceDir and onceLock must not collide or contain one another');
  }
  for (const value of [evidenceDir, onceLock]) {
    let exists = true;
    try {
      fs.lstatSync(value);
    } catch (cause) {
      if (cause.code !== 'ENOENT') {
        throw ownerError('owner-output-path-stat-failed', `lstat failed: ${cause.message}`);
      }
      exists = false;
    }
    if (exists) throw ownerError('owner-output-path-exists', `path already exists: ${value}`);
  }
  const evidenceParent = path.dirname(evidenceDir);
  const onceLockParent = path.dirname(onceLock);
  for (const parent of [evidenceParent, onceLockParent]) {
    let parentStat;
    try {
      parentStat = fs.lstatSync(parent);
    } catch (cause) {
      throw ownerError('owner-output-parent-invalid', `parent lstat failed: ${cause.message}`);
    }
    let realParent;
    try {
      realParent = fs.realpathSync(parent);
    } catch (cause) {
      throw ownerError('owner-output-parent-invalid', `parent realpath failed: ${cause.message}`);
    }
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realParent !== parent) {
      throw ownerError('owner-output-parent-invalid', `parent is not a canonical plain directory: ${parent}`);
    }
  }
  return Object.freeze({ evidenceDir, onceLock, evidenceParent, onceLockParent });
}

function acquireCaptureWorkspace(evidenceDir, onceLock) {
  validateFreshOutputPaths(evidenceDir, onceLock);
  const sourceFacts = resolveSourceFacts();

  const withTrailingSep = (value) => (value.endsWith(path.sep) ? value : value + path.sep);
  const projectRootWithSep = withTrailingSep(sourceFacts.projectRoot);
  for (const value of [evidenceDir, onceLock]) {
    const valueWithSep = withTrailingSep(value);
    const overlapsSource =
      value === sourceFacts.projectRoot ||
      valueWithSep.startsWith(projectRootWithSep) ||
      projectRootWithSep.startsWith(valueWithSep);
    if (overlapsSource) {
      throw ownerError('owner-workspace-source-overlap', `output path overlaps project source root: ${value}`);
    }
  }

  const lockRecord = writeOwnedFileNoClobber(
    onceLock,
    Buffer.from('runtime/p2-genuine-once-lock/v1\n', 'utf8'),
    0o600
  );

  makeOwnedDirectoryNoClobber(evidenceDir);
  const buildDir = makeOwnedDirectoryNoClobber(path.join(evidenceDir, 'build'));
  const runtimeTmp = makeOwnedDirectoryNoClobber(path.join(buildDir, 'tmp'));
  const artifactPath = path.join(evidenceDir, 'p2-genuine-capture.json');

  const uidOk = (stat) => typeof process.getuid !== 'function' || stat.uid === process.getuid();

  for (const dirPath of [evidenceDir, buildDir, runtimeTmp]) {
    let dirLstat, dirReal;
    try {
      dirLstat = fs.lstatSync(dirPath);
      dirReal = fs.realpathSync(dirPath);
    } catch (cause) {
      throw ownerError('owner-workspace-postcondition-failed', `workspace directory stat failed: ${cause.message}`);
    }
    if (
      !dirLstat.isDirectory() ||
      dirLstat.isSymbolicLink() ||
      dirReal !== dirPath ||
      (dirLstat.mode & 0o777) !== 0o700 ||
      !uidOk(dirLstat)
    ) {
      throw ownerError('owner-workspace-postcondition-failed', `workspace directory postcondition failed: ${dirPath}`);
    }
  }

  let artifactLstat = null;
  try {
    artifactLstat = fs.lstatSync(artifactPath);
  } catch (cause) {
    if (cause.code !== 'ENOENT') {
      throw ownerError('owner-workspace-postcondition-failed', `artifact path stat failed: ${cause.message}`);
    }
  }
  if (artifactLstat !== null) {
    throw ownerError('owner-workspace-postcondition-failed', `artifact path must remain absent: ${artifactPath}`);
  }

  let lockLstat;
  try {
    lockLstat = fs.lstatSync(onceLock);
  } catch (cause) {
    throw ownerError('owner-workspace-postcondition-failed', `lock stat failed: ${cause.message}`);
  }
  if (
    !lockLstat.isFile() ||
    lockLstat.isSymbolicLink() ||
    lockLstat.nlink !== 1 ||
    (lockLstat.mode & 0o777) !== 0o600 ||
    !uidOk(lockLstat)
  ) {
    throw ownerError('owner-workspace-postcondition-failed', `lock postcondition failed: ${onceLock}`);
  }
  const lockVerify = readFdBoundFile(onceLock, MAX_RECORD_BYTES);
  if (lockVerify.size !== lockRecord.size || lockVerify.digest !== lockRecord.digest) {
    throw ownerError('owner-workspace-postcondition-failed', `lock content does not match recorded write: ${onceLock}`);
  }

  return Object.freeze({ evidenceDir, onceLock, artifactPath, buildDir, runtimeTmp, lockRecord });
}

function buildCaptureChildEnvironment(rootPath, runtimeTmp) {
  assertGenuineEnvironment({ ...process.env });

  const uidOk = (stat) => typeof process.getuid !== 'function' || stat.uid === process.getuid();

  const assertCanonicalOwnedDir = (value, inputCode, shapeCode, requireMode0700) => {
    if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value) || path.resolve(value) !== value) {
      throw ownerError(inputCode, `path must be an absolute, normalized, nonempty string: ${String(value)}`);
    }
    let dirLstat, dirReal;
    try {
      dirLstat = fs.lstatSync(value);
      dirReal = fs.realpathSync(value);
    } catch (cause) {
      throw ownerError(shapeCode, `stat failed for ${value}: ${cause.message}`);
    }
    if (
      !dirLstat.isDirectory() ||
      dirLstat.isSymbolicLink() ||
      dirReal !== value ||
      (requireMode0700 && (dirLstat.mode & 0o777) !== 0o700) ||
      !uidOk(dirLstat)
    ) {
      throw ownerError(shapeCode, `path is not a canonical owned plain directory: ${value}`);
    }
  };

  assertCanonicalOwnedDir(rootPath, 'owner-child-env-input-invalid', 'owner-child-env-shape-invalid', true);
  assertCanonicalOwnedDir(runtimeTmp, 'owner-child-env-input-invalid', 'owner-child-env-shape-invalid', true);

  const rootBase = path.basename(rootPath);
  if (rootBase !== 'primary' && rootBase !== 'hostile') {
    throw ownerError('owner-child-env-scope-invalid', `rootPath basename must be "primary" or "hostile": ${rootPath}`);
  }
  if (path.basename(runtimeTmp) !== 'tmp') {
    throw ownerError('owner-child-env-scope-invalid', `runtimeTmp basename must be "tmp": ${runtimeTmp}`);
  }
  const rootParent = path.dirname(rootPath);
  if (rootParent !== path.dirname(runtimeTmp)) {
    throw ownerError('owner-child-env-scope-invalid', 'rootPath and runtimeTmp must share the same build directory parent');
  }
  assertCanonicalOwnedDir(rootParent, 'owner-child-env-scope-invalid', 'owner-child-env-scope-invalid', true);

  const home = process.env.HOME;
  assertCanonicalOwnedDir(home, 'owner-child-env-home-invalid', 'owner-child-env-home-invalid', false);

  const childEnv = Object.assign({}, process.env, {
    ANDROID_COMMON_DOC: rootPath,
    TMPDIR: runtimeTmp,
    TMP: runtimeTmp,
    TEMP: runtimeTmp,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
  });

  assertGenuineEnvironment(childEnv);

  if (childEnv.HOME !== home) {
    throw ownerError('owner-child-env-home-invalid', 'child environment HOME must byte-equal process.env.HOME');
  }
  if (
    childEnv.ANDROID_COMMON_DOC !== rootPath ||
    childEnv.TMPDIR !== runtimeTmp ||
    childEnv.TMP !== runtimeTmp ||
    childEnv.TEMP !== runtimeTmp
  ) {
    throw ownerError('owner-child-env-scope-invalid', 'child environment overrides must byte-equal exact bound inputs');
  }

  return Object.freeze(childEnv);
}

function hashFdBoundFile(filePath, maxBytes) {
  if (typeof filePath !== 'string' || filePath.length === 0 || !path.isAbsolute(filePath) || path.resolve(filePath) !== filePath) {
    throw ownerError('owner-hash-input-invalid', 'filePath must be an absolute, normalized, nonempty string');
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw ownerError('owner-hash-input-invalid', 'maxBytes must be a positive integer');
  }
  let lstat;
  try {
    lstat = fs.lstatSync(filePath);
  } catch (cause) {
    throw ownerError('owner-hash-shape-invalid', `lstat failed: ${cause.message}`);
  }
  if (!lstat.isFile() || lstat.isSymbolicLink() || lstat.nlink !== 1 || lstat.size < 1 || lstat.size > maxBytes) {
    throw ownerError('owner-hash-shape-invalid', `${filePath} is not a bound-safe regular file`);
  }
  const statsMatch = (a, b) => (
    a.dev === b.dev && a.ino === b.ino && a.mode === b.mode &&
    a.nlink === b.nlink && a.uid === b.uid && a.gid === b.gid && a.size === b.size
  );
  const crypto = require('crypto');
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (cause) {
    throw ownerError('owner-hash-open-failed', `open failed: ${cause.message}`);
  }
  try {
    let openedStat;
    try {
      openedStat = fs.fstatSync(fd);
    } catch (cause) {
      throw ownerError('owner-hash-identity-mismatch', `fstat failed: ${cause.message}`);
    }
    if (!statsMatch(openedStat, lstat)) {
      throw ownerError('owner-hash-identity-mismatch', `${filePath} identity changed between lstat and open`);
    }
    const size = lstat.size;
    const chunkSize = Math.min(1024 * 1024, size);
    const buffer = Buffer.allocUnsafe(chunkSize);
    const hash = crypto.createHash('sha256');
    let position = 0;
    let remaining = size;
    while (remaining > 0) {
      const length = Math.min(chunkSize, remaining);
      let bytesRead;
      try {
        bytesRead = fs.readSync(fd, buffer, 0, length, position);
      } catch (cause) {
        throw ownerError('owner-hash-read-failed', `read failed: ${cause.message}`);
      }
      if (bytesRead === 0) {
        throw ownerError('owner-hash-short-read', `${filePath} ended after ${position} of ${size} bytes`);
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      remaining -= bytesRead;
    }
    let postFstat;
    try {
      postFstat = fs.fstatSync(fd);
    } catch (cause) {
      throw ownerError('owner-hash-post-read-drift', `post-read fstat failed: ${cause.message}`);
    }
    let postLstat;
    try {
      postLstat = fs.lstatSync(filePath);
    } catch (cause) {
      throw ownerError('owner-hash-post-read-drift', `post-read lstat failed: ${cause.message}`);
    }
    if (
      !postFstat.isFile() || postFstat.isSymbolicLink() || !statsMatch(postFstat, openedStat) ||
      !postLstat.isFile() || postLstat.isSymbolicLink() || !statsMatch(postLstat, openedStat)
    ) {
      throw ownerError('owner-hash-post-read-drift', `${filePath} identity changed during read`);
    }
    return Object.freeze({ digest: hash.digest('hex'), size });
  } finally {
    fs.closeSync(fd);
  }
}

function resolvePinnedService() {
  assertGenuineEnvironment({ ...process.env });
  const bridge = require('./runtime-bridge-codex.cjs');
  const resolver = bridge && bridge.resolveAppServerSpawnCommand;
  const probe = bridge && bridge.probeAppServerLiveCapability;
  if (typeof resolver !== 'function' || typeof probe !== 'function') {
    throw ownerError('owner-service-bridge-invalid', 'runtime-bridge-codex.cjs must export resolver and probe functions');
  }
  const isPinnedResult = (result) => (
    result !== null && typeof result === 'object' && result.ok !== false &&
    typeof result.command === 'string' && result.command.length > 0 &&
    path.isAbsolute(result.command) && path.resolve(result.command) === result.command &&
    JSON.stringify(result.args) === JSON.stringify(EXPECTED_APP_SERVER_ARGS)
  );
  let first;
  try {
    first = resolver();
  } catch (cause) {
    throw ownerError('owner-service-resolve-failed', `resolver threw: ${cause.message}`);
  }
  if (!isPinnedResult(first)) {
    throw ownerError('owner-service-resolve-failed', 'resolver returned an invalid command/args result');
  }
  let probeResult;
  try {
    probeResult = probe();
  } catch (cause) {
    throw ownerError('owner-service-probe-failed', `probe threw: ${cause.message}`);
  }
  if (!probeResult || probeResult.ok !== true) {
    throw ownerError('owner-service-probe-failed', 'probe did not report ok === true');
  }
  let second;
  try {
    second = resolver();
  } catch (cause) {
    throw ownerError('owner-service-pin-drift', `resolver threw on second call: ${cause.message}`);
  }
  if (!second || second.command !== first.command || JSON.stringify(second.args) !== JSON.stringify(first.args)) {
    throw ownerError('owner-service-pin-drift', 'resolver returned a different command/args on the second call');
  }
  const { digest } = hashFdBoundFile(first.command, MAX_PINNED_BINARY_BYTES);
  let rawVersion;
  try {
    rawVersion = execFileSync(first.command, ['--version'], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 65536,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    throw ownerError('owner-service-version-failed', `--version execution failed: ${cause.message}`);
  }
  const version = rawVersion.trim();
  if (version.length === 0 || version.length > 256 || version.includes('\r') || version.includes('\n')) {
    throw ownerError('owner-service-version-failed', 'observed version output is empty, too long, or contains a line break');
  }
  return Object.freeze({
    binary_path: first.command,
    binary_sha256: digest,
    model: PINNED_MODEL,
    version,
    protocol: PINNED_PROTOCOL,
  });
}

const GIT_BINARY = '/usr/bin/git';
const PS_BINARY = '/bin/ps';
const BASH_BINARY = '/bin/bash';

function resolveSourceFacts() {
  const projectRoot = path.resolve(__dirname, '../..');
  let rootLstat, rootReal;
  try {
    rootLstat = fs.lstatSync(projectRoot);
    rootReal = fs.realpathSync(projectRoot);
  } catch (cause) {
    throw ownerError('owner-source-root-invalid', `stat failed: ${cause.message}`);
  }
  if (!rootLstat.isDirectory() || rootLstat.isSymbolicLink() || rootReal !== projectRoot) {
    throw ownerError('owner-source-root-invalid', 'projectRoot is not a canonical plain directory');
  }
  const gitRead = (args) => {
    let out;
    try {
      out = execFileSync(GIT_BINARY, ['-C', projectRoot, ...args], {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1048576,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
      }).trim();
    } catch (cause) {
      throw ownerError('owner-source-git-failed', `git ${args.join(' ')} failed: ${cause.message}`);
    }
    if (out.length === 0) throw ownerError('owner-source-git-failed', `git ${args.join(' ')} produced empty output`);
    return out;
  };
  const toplevel = gitRead(['rev-parse', '--show-toplevel']);
  if (toplevel !== projectRoot) throw ownerError('owner-source-root-mismatch', 'git toplevel does not match projectRoot');
  const head = gitRead(['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(head)) throw ownerError('owner-source-head-invalid', 'HEAD is not exactly 40 lowercase hex characters');
  const gitCommonDir = gitRead(['rev-parse', '--git-common-dir']);
  if (!path.isAbsolute(gitCommonDir) || path.normalize(gitCommonDir) !== gitCommonDir) {
    throw ownerError('owner-source-git-common-invalid', 'git-common-dir is not an absolute normalized path');
  }
  let commonLstat, commonReal;
  try {
    commonLstat = fs.lstatSync(gitCommonDir);
    commonReal = fs.realpathSync(gitCommonDir);
  } catch (cause) {
    throw ownerError('owner-source-git-common-invalid', `stat failed: ${cause.message}`);
  }
  if (!commonLstat.isDirectory() || commonLstat.isSymbolicLink() || commonReal !== gitCommonDir) {
    throw ownerError('owner-source-git-common-invalid', 'git-common-dir is not a canonical plain directory');
  }
  const planPath = path.join(projectRoot, '.planning', 'wave-portable-runtime-messaging-adapters', 'PLAN.md');
  const { digest: planSha256 } = readFdBoundFile(planPath, MAX_RECORD_BYTES);
  return Object.freeze({ projectRoot, gitBinary: GIT_BINARY, gitCommonDir, head, planPath, planSha256 });
}

function makeOwnedDirectoryNoClobber(dirPath) {
  if (typeof dirPath !== 'string' || dirPath.length === 0 || !path.isAbsolute(dirPath) || path.resolve(dirPath) !== dirPath) {
    throw ownerError('owner-dir-input-invalid', 'dirPath must be an absolute, normalized, nonempty string');
  }
  const parent = path.dirname(dirPath);
  let parentLstat, parentReal;
  try {
    parentLstat = fs.lstatSync(parent);
    parentReal = fs.realpathSync(parent);
  } catch (cause) {
    throw ownerError('owner-dir-parent-invalid', `parent stat failed: ${cause.message}`);
  }
  if (!parentLstat.isDirectory() || parentLstat.isSymbolicLink() || parentReal !== parent) {
    throw ownerError('owner-dir-parent-invalid', `parent is not a canonical plain directory: ${parent}`);
  }
  try {
    fs.mkdirSync(dirPath, { mode: 0o700, recursive: false });
  } catch (cause) {
    throw ownerError('owner-dir-create-failed', `mkdir failed: ${cause.message}`);
  }
  let postLstat;
  try {
    postLstat = fs.lstatSync(dirPath);
  } catch (cause) {
    throw ownerError('owner-dir-postcondition-failed', `post-create lstat failed: ${cause.message}`);
  }
  const dirUidOk = typeof process.getuid !== 'function' || postLstat.uid === process.getuid();
  if (!postLstat.isDirectory() || postLstat.isSymbolicLink() || postLstat.nlink < 2 || (postLstat.mode & 0o777) !== 0o700 || !dirUidOk) {
    throw ownerError('owner-dir-postcondition-failed', `directory postcondition failed: ${dirPath}`);
  }
  return dirPath;
}

function copyFdBoundFileNoClobber(sourcePath, targetPath, maxBytes, mode) {
  const isBoundPath = (value) => typeof value === 'string' && value.length > 0 && path.isAbsolute(value) && path.resolve(value) === value;
  if (!isBoundPath(sourcePath) || !isBoundPath(targetPath) || sourcePath === targetPath || !Number.isInteger(maxBytes) || maxBytes <= 0 || (mode !== 0o600 && mode !== 0o700)) {
    throw ownerError('owner-copy-input-invalid', 'sourcePath, targetPath, maxBytes, and mode are invalid');
  }
  const source = readFdBoundFile(sourcePath, maxBytes);
  const targetParent = path.dirname(targetPath);
  let targetParentLstat, targetParentReal;
  try {
    targetParentLstat = fs.lstatSync(targetParent);
    targetParentReal = fs.realpathSync(targetParent);
  } catch (cause) {
    throw ownerError('owner-copy-parent-invalid', `target parent stat failed: ${cause.message}`);
  }
  if (!targetParentLstat.isDirectory() || targetParentLstat.isSymbolicLink() || targetParentReal !== targetParent) {
    throw ownerError('owner-copy-parent-invalid', `target parent is not a canonical plain directory: ${targetParent}`);
  }
  let fd;
  try {
    fd = fs.openSync(targetPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), mode);
  } catch (cause) {
    throw ownerError('owner-copy-create-failed', `open failed: ${cause.message}`);
  }
  try {
    let offset = 0;
    while (offset < source.bytes.length) {
      let written;
      try {
        written = fs.writeSync(fd, source.bytes, offset, source.bytes.length - offset, offset);
      } catch (cause) {
        throw ownerError('owner-copy-write-failed', `write failed: ${cause.message}`);
      }
      if (written <= 0) {
        throw ownerError('owner-copy-short-write', 'write returned no bytes before target was fully written');
      }
      offset += written;
    }
    fs.fsyncSync(fd);
    let postFstat;
    try {
      postFstat = fs.fstatSync(fd);
    } catch (cause) {
      throw ownerError('owner-copy-postcondition-failed', `fstat failed: ${cause.message}`);
    }
    const copyUidOk = typeof process.getuid !== 'function' || postFstat.uid === process.getuid();
    if (!postFstat.isFile() || postFstat.nlink !== 1 || postFstat.size !== source.size || (postFstat.mode & 0o777) !== mode || !copyUidOk) {
      throw ownerError('owner-copy-postcondition-failed', `target postcondition failed: ${targetPath}`);
    }
  } finally {
    fs.closeSync(fd);
  }
  const verify = readFdBoundFile(targetPath, maxBytes);
  if (verify.digest !== source.digest || verify.size !== source.size) {
    throw ownerError('owner-copy-verification-failed', 'target content does not match source after copy');
  }
  return Object.freeze({ targetPath, digest: source.digest, size: source.size, mode });
}

function writeOwnedFileNoClobber(filePath, bytes, mode) {
  const isBoundPath = (value) => typeof value === 'string' && value.length > 0 && path.isAbsolute(value) && path.resolve(value) === value;
  if (!isBoundPath(filePath) || !Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_RECORD_BYTES || (mode !== 0o600 && mode !== 0o700)) {
    throw ownerError('owner-write-input-invalid', 'filePath, bytes, and mode are invalid');
  }
  const parent = path.dirname(filePath);
  let parentLstat, parentReal;
  try {
    parentLstat = fs.lstatSync(parent);
    parentReal = fs.realpathSync(parent);
  } catch (cause) {
    throw ownerError('owner-write-parent-invalid', `parent stat failed: ${cause.message}`);
  }
  if (!parentLstat.isDirectory() || parentLstat.isSymbolicLink() || parentReal !== parent) {
    throw ownerError('owner-write-parent-invalid', `parent is not a canonical plain directory: ${parent}`);
  }
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), mode);
  } catch (cause) {
    throw ownerError('owner-write-create-failed', `open failed: ${cause.message}`);
  }
  try {
    let offset = 0;
    while (offset < bytes.length) {
      let written;
      try {
        written = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
      } catch (cause) {
        throw ownerError('owner-write-write-failed', `write failed: ${cause.message}`);
      }
      if (written <= 0) {
        throw ownerError('owner-write-short-write', 'write returned no bytes before target was fully written');
      }
      offset += written;
    }
    fs.fsyncSync(fd);
    let postFstat;
    try {
      postFstat = fs.fstatSync(fd);
    } catch (cause) {
      throw ownerError('owner-write-postcondition-failed', `fstat failed: ${cause.message}`);
    }
    const writeUidOk = typeof process.getuid !== 'function' || postFstat.uid === process.getuid();
    if (!postFstat.isFile() || postFstat.nlink !== 1 || postFstat.size !== bytes.length || (postFstat.mode & 0o777) !== mode || !writeUidOk) {
      throw ownerError('owner-write-postcondition-failed', `target postcondition failed: ${filePath}`);
    }
  } finally {
    fs.closeSync(fd);
  }
  const expectedDigest = crypto.createHash('sha256').update(bytes).digest('hex');
  const verify = readFdBoundFile(filePath, MAX_RECORD_BYTES);
  if (verify.size !== bytes.length || verify.digest !== expectedDigest) {
    throw ownerError('owner-write-verification-failed', 'target content does not match supplied bytes after write');
  }
  return Object.freeze({ targetPath: filePath, digest: expectedDigest, size: bytes.length, mode });
}

function materializeDetachedGitMetadata(rootPath, head) {
  if (typeof rootPath !== 'string' || rootPath.length === 0 || !path.isAbsolute(rootPath) || path.resolve(rootPath) !== rootPath) {
    throw ownerError('owner-git-input-invalid', 'rootPath must be an absolute, normalized, nonempty string');
  }
  if (typeof head !== 'string' || !/^[0-9a-f]{40}$/.test(head)) {
    throw ownerError('owner-git-input-invalid', 'head must be exactly 40 lowercase hexadecimal characters');
  }
  let rootLstat, rootReal;
  try {
    rootLstat = fs.lstatSync(rootPath);
    rootReal = fs.realpathSync(rootPath);
  } catch (cause) {
    throw ownerError('owner-git-root-invalid', `rootPath stat failed: ${cause.message}`);
  }
  const rootUidOk = typeof process.getuid !== 'function' || rootLstat.uid === process.getuid();
  if (!rootLstat.isDirectory() || rootLstat.isSymbolicLink() || rootReal !== rootPath || (rootLstat.mode & 0o777) !== 0o700 || !rootUidOk) {
    throw ownerError('owner-git-root-invalid', `rootPath is not a canonical owned directory: ${rootPath}`);
  }
  const gitDir = path.join(rootPath, '.git');
  makeOwnedDirectoryNoClobber(gitDir);
  makeOwnedDirectoryNoClobber(path.join(gitDir, 'objects'));
  makeOwnedDirectoryNoClobber(path.join(gitDir, 'refs'));
  makeOwnedDirectoryNoClobber(path.join(gitDir, 'refs', 'heads'));
  makeOwnedDirectoryNoClobber(path.join(gitDir, 'refs', 'tags'));
  const headRecord = writeOwnedFileNoClobber(path.join(gitDir, 'HEAD'), Buffer.from(`${head}\n`, 'utf8'), 0o600);
  const configContents = '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = false\n';
  const configRecord = writeOwnedFileNoClobber(path.join(gitDir, 'config'), Buffer.from(configContents, 'utf8'), 0o600);
  const gitRead = (args) => {
    let out;
    try {
      out = execFileSync(GIT_BINARY, ['-C', rootPath, ...args], {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1048576,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
      }).trim();
    } catch (cause) {
      throw ownerError('owner-git-lookup-failed', `git ${args.join(' ')} failed: ${cause.message}`);
    }
    return out;
  };
  const toplevel = gitRead(['rev-parse', '--show-toplevel']);
  if (toplevel !== rootPath) throw ownerError('owner-git-toplevel-mismatch', 'git toplevel does not match rootPath');
  const commonDir = gitRead(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (commonDir !== gitDir) throw ownerError('owner-git-common-mismatch', 'git-common-dir does not match rootPath/.git');
  const headOut = gitRead(['rev-parse', 'HEAD']);
  if (headOut !== head) throw ownerError('owner-git-head-mismatch', 'git HEAD does not match supplied head');
  let gitDirLstat, gitDirReal;
  try {
    gitDirLstat = fs.lstatSync(gitDir);
    gitDirReal = fs.realpathSync(gitDir);
  } catch (cause) {
    throw ownerError('owner-git-dir-invalid', `.git stat failed: ${cause.message}`);
  }
  const gitDirUidOk = typeof process.getuid !== 'function' || gitDirLstat.uid === process.getuid();
  if (!gitDirLstat.isDirectory() || gitDirLstat.isSymbolicLink() || gitDirReal !== gitDir || (gitDirLstat.mode & 0o777) !== 0o700 || !gitDirUidOk) {
    throw ownerError('owner-git-dir-invalid', `.git is not a canonical owned directory: ${gitDir}`);
  }
  return Object.freeze({ gitDir, head, records: Object.freeze([headRecord, configRecord]) });
}

const MAX_TREE_ENTRIES = 512;
const MAX_TREE_TOTAL_BYTES = 64 * 1024 * 1024;

function copyPlainTreeNoClobber(sourceRoot, targetRoot, relativeDir, maxBytesPerFile) {
  const isBoundRoot = (value) => typeof value === 'string' && value.length > 0 && path.isAbsolute(value) && path.resolve(value) === value;
  if (!isBoundRoot(sourceRoot) || !isBoundRoot(targetRoot) || sourceRoot === targetRoot || !Number.isInteger(maxBytesPerFile) || maxBytesPerFile <= 0) {
    throw ownerError('owner-tree-input-invalid', 'sourceRoot, targetRoot, and maxBytesPerFile are invalid');
  }
  if (typeof relativeDir !== 'string' || relativeDir.length === 0 || path.isAbsolute(relativeDir) || path.normalize(relativeDir) !== relativeDir) {
    throw ownerError('owner-tree-input-invalid', 'relativeDir must be a nonempty, relative, normalized path');
  }
  if (relativeDir.split(path.sep).some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw ownerError('owner-tree-input-invalid', 'relativeDir segments must be nonempty and not "." or ".."');
  }
  for (const root of [sourceRoot, targetRoot]) {
    let rootLstat, rootReal;
    try {
      rootLstat = fs.lstatSync(root);
      rootReal = fs.realpathSync(root);
    } catch (cause) {
      throw ownerError('owner-tree-input-invalid', `root stat failed: ${cause.message}`);
    }
    if (!rootLstat.isDirectory() || rootLstat.isSymbolicLink() || rootReal !== root) {
      throw ownerError('owner-tree-input-invalid', `root is not a canonical plain directory: ${root}`);
    }
  }
  if ((sourceRoot + path.sep).startsWith(targetRoot + path.sep) || (targetRoot + path.sep).startsWith(sourceRoot + path.sep)) {
    throw ownerError('owner-tree-input-invalid', 'sourceRoot and targetRoot must not contain one another');
  }
  const sourceDir = path.join(sourceRoot, relativeDir);
  const targetDir = path.join(targetRoot, relativeDir);
  if (!sourceDir.startsWith(sourceRoot + path.sep) || !targetDir.startsWith(targetRoot + path.sep)) {
    throw ownerError('owner-tree-input-invalid', 'resolved paths must remain under their respective roots');
  }
  let sourceLstat;
  try {
    sourceLstat = fs.lstatSync(sourceDir);
  } catch (cause) {
    throw ownerError('owner-tree-input-invalid', `source lstat failed: ${cause.message}`);
  }
  if (!sourceLstat.isDirectory() || sourceLstat.isSymbolicLink()) {
    throw ownerError('owner-tree-input-invalid', `source is not a plain directory: ${sourceDir}`);
  }
  let targetExists = true;
  try {
    fs.lstatSync(targetDir);
  } catch (cause) {
    if (cause.code !== 'ENOENT') throw ownerError('owner-tree-input-invalid', `target stat failed: ${cause.message}`);
    targetExists = false;
  }
  if (targetExists) throw ownerError('owner-tree-input-invalid', `target already exists: ${targetDir}`);
  makeOwnedDirectoryNoClobber(targetDir);
  const records = [];
  let entryCount = 0;
  let totalBytes = 0;
  const walk = (currentSourceDir, currentTargetDir) => {
    let dirents;
    try {
      dirents = fs.readdirSync(currentSourceDir, { withFileTypes: true });
    } catch (cause) {
      throw ownerError('owner-tree-read-failed', `readdir failed: ${cause.message}`);
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of dirents) {
      const name = dirent.name;
      if (name.length === 0 || name.includes('/') || name.includes('\\') || name.includes('\0')) {
        throw ownerError('owner-tree-shape-invalid', `invalid entry name: ${name}`);
      }
      if (dirent.isSymbolicLink() || (!dirent.isDirectory() && !dirent.isFile())) {
        throw ownerError('owner-tree-shape-invalid', `unsupported entry type: ${name}`);
      }
      entryCount += 1;
      if (entryCount > MAX_TREE_ENTRIES) throw ownerError('owner-tree-cap-exceeded', 'tree entry count exceeds MAX_TREE_ENTRIES');
      const childSourcePath = path.join(currentSourceDir, name);
      const childTargetPath = path.join(currentTargetDir, name);
      if (dirent.isDirectory()) {
        makeOwnedDirectoryNoClobber(childTargetPath);
        walk(childSourcePath, childTargetPath);
      } else {
        let childSourceLstat;
        try {
          childSourceLstat = fs.lstatSync(childSourcePath);
        } catch (cause) {
          throw ownerError('owner-tree-read-failed', `child source lstat failed: ${cause.message}`);
        }
        if (!isRegularNonSymlink(childSourceLstat) || childSourceLstat.nlink !== 1 || childSourceLstat.size <= 0) {
          throw ownerError('owner-tree-shape-invalid', `source is not a bound-safe regular file: ${name}`);
        }
        const remainingBytes = MAX_TREE_TOTAL_BYTES - totalBytes;
        if (remainingBytes <= 0 || childSourceLstat.size > remainingBytes || childSourceLstat.size > maxBytesPerFile) {
          throw ownerError('owner-tree-cap-exceeded', 'tree total bytes or per-file cap exceeded before copy');
        }
        const copied = copyFdBoundFileNoClobber(childSourcePath, childTargetPath, Math.min(maxBytesPerFile, remainingBytes), 0o600);
        totalBytes += copied.size;
        if (totalBytes > MAX_TREE_TOTAL_BYTES) throw ownerError('owner-tree-cap-exceeded', 'tree total bytes exceeds MAX_TREE_TOTAL_BYTES');
        const relativePath = path.relative(sourceRoot, childSourcePath).split(path.sep).join('/');
        records.push(Object.freeze({ path: relativePath, digest: copied.digest, size: copied.size }));
      }
    }
  };
  walk(sourceDir, targetDir);
  return Object.freeze({ relativeDir, entries: Object.freeze(records), totalBytes });
}

const ROOT_SINGLE_FILES = Object.freeze([
  Object.freeze({ path: '.planning/wave-portable-runtime-messaging-adapters/PLAN.md', mode: 0o600 }),
  Object.freeze({ path: '.claude/hooks/coordination-artifact.js', mode: 0o600 }),
  Object.freeze({ path: 'scripts/sh/write-verdict.sh', mode: 0o700 }),
  Object.freeze({ path: 'scripts/sh/lib/wave-slug.sh', mode: 0o600 }),
  Object.freeze({ path: 'scripts/tests/runtime-consultation-bridge.bats', mode: 0o600 }),
  Object.freeze({ path: 'scripts/tests/runtime-role-lifecycle-prep-binding.test.js', mode: 0o600 }),
  Object.freeze({ path: 'scripts/tests/write-verdict.bats', mode: 0o600 }),
]);

function materializeRootSkeleton(buildDir, rootName) {
  if (rootName !== 'primary' && rootName !== 'hostile') {
    throw ownerError('owner-root-input-invalid', 'rootName must be exactly "primary" or "hostile"');
  }
  if (typeof buildDir !== 'string' || buildDir.length === 0 || !path.isAbsolute(buildDir) || path.resolve(buildDir) !== buildDir) {
    throw ownerError('owner-root-input-invalid', 'buildDir must be an absolute, normalized, nonempty string');
  }
  let buildLstat, buildReal;
  try {
    buildLstat = fs.lstatSync(buildDir);
    buildReal = fs.realpathSync(buildDir);
  } catch (cause) {
    throw ownerError('owner-root-input-invalid', `buildDir stat failed: ${cause.message}`);
  }
  const buildUidOk = typeof process.getuid !== 'function' || buildLstat.uid === process.getuid();
  if (!buildLstat.isDirectory() || buildLstat.isSymbolicLink() || buildReal !== buildDir || (buildLstat.mode & 0o777) !== 0o700 || !buildUidOk) {
    throw ownerError('owner-root-input-invalid', `buildDir is not a canonical owned directory: ${buildDir}`);
  }
  const sourceFacts = resolveSourceFacts();
  const buildWithSep = buildDir + path.sep;
  const projectWithSep = sourceFacts.projectRoot + path.sep;
  if (buildWithSep.startsWith(projectWithSep) || projectWithSep.startsWith(buildWithSep)) {
    throw ownerError('owner-root-input-invalid', 'buildDir and projectRoot must not contain one another');
  }
  const rootPath = path.join(buildDir, rootName);
  makeOwnedDirectoryNoClobber(rootPath);
  const subdirs = [
    '.planning', '.planning/wave-portable-runtime-messaging-adapters', '.planning/coordination',
    '.claude', '.claude/hooks', 'scripts', 'scripts/sh', 'scripts/sh/lib', 'scripts/tests', 'setup',
  ];
  for (const subdir of subdirs) makeOwnedDirectoryNoClobber(path.join(rootPath, subdir));
  const treeDirs = ['scripts/lib', 'setup/agent-templates', '.claude/agents'];
  const treeResults = treeDirs.map((relativeDir) => copyPlainTreeNoClobber(sourceFacts.projectRoot, rootPath, relativeDir, MAX_RECORD_BYTES));
  const fileResults = ROOT_SINGLE_FILES.map((entry) => copyFdBoundFileNoClobber(
    path.join(sourceFacts.projectRoot, entry.path), path.join(rootPath, entry.path), MAX_RECORD_BYTES, entry.mode,
  ));
  const records = [];
  for (const treeResult of treeResults) {
    for (const entry of treeResult.entries) records.push(entry);
  }
  for (let i = 0; i < ROOT_SINGLE_FILES.length; i += 1) {
    const entry = ROOT_SINGLE_FILES[i];
    const copied = fileResults[i];
    records.push(Object.freeze({ path: entry.path, digest: copied.digest, size: copied.size, mode: entry.mode }));
  }
  Object.freeze(records);
  for (const role of ROLES) {
    const template = readFdBoundFile(path.join(rootPath, 'setup', 'agent-templates', `${role}.md`), MAX_RECORD_BYTES);
    const agent = readFdBoundFile(path.join(rootPath, '.claude', 'agents', `${role}.md`), MAX_RECORD_BYTES);
    if (template.digest !== agent.digest || template.size <= 0 || agent.size <= 0) {
      throw ownerError('owner-root-role-profile-mismatch', `role profile mismatch for role: ${role}`);
    }
  }
  const copiedPlan = readFdBoundFile(
    path.join(rootPath, '.planning', 'wave-portable-runtime-messaging-adapters', 'PLAN.md'), MAX_RECORD_BYTES,
  );
  if (copiedPlan.digest !== sourceFacts.planSha256) {
    throw ownerError('owner-root-plan-mismatch', 'copied PLAN digest does not match source planSha256');
  }
  const gitMetadata = materializeDetachedGitMetadata(rootPath, sourceFacts.head);
  const mcpRuntime = materializeMcpRuntime(rootPath);
  return Object.freeze({
    name: rootName,
    rootPath,
    head: sourceFacts.head,
    planSha256: sourceFacts.planSha256,
    records,
    gitMetadata,
    mcpRuntime,
  });
}

function linkCanonicalDirectoryNoClobber(sourceDir, targetLink) {
  const isBoundPath = (value) => typeof value === 'string' && value.length > 0 && path.isAbsolute(value) && path.resolve(value) === value;
  if (!isBoundPath(sourceDir) || !isBoundPath(targetLink)) {
    throw ownerError('owner-link-input-invalid', 'sourceDir and targetLink must be absolute, normalized, nonempty strings');
  }
  const sourceWithSep = sourceDir + path.sep;
  const targetWithSep = targetLink + path.sep;
  if (sourceDir === targetLink || sourceWithSep.startsWith(targetWithSep) || targetWithSep.startsWith(sourceWithSep)) {
    throw ownerError('owner-link-input-invalid', 'sourceDir and targetLink must be distinct and must not contain one another');
  }
  let sourceLstat, sourceReal;
  try {
    sourceLstat = fs.lstatSync(sourceDir);
    sourceReal = fs.realpathSync(sourceDir);
  } catch (cause) {
    throw ownerError('owner-link-source-invalid', `sourceDir stat failed: ${cause.message}`);
  }
  const sourceUidOk = typeof process.getuid !== 'function' || sourceLstat.uid === process.getuid();
  if (!sourceLstat.isDirectory() || sourceLstat.isSymbolicLink() || sourceReal !== sourceDir || !sourceUidOk) {
    throw ownerError('owner-link-source-invalid', `sourceDir is not a canonical owned directory: ${sourceDir}`);
  }
  const targetParent = path.dirname(targetLink);
  let parentLstat, parentReal;
  try {
    parentLstat = fs.lstatSync(targetParent);
    parentReal = fs.realpathSync(targetParent);
  } catch (cause) {
    throw ownerError('owner-link-parent-invalid', `targetLink parent stat failed: ${cause.message}`);
  }
  if (!parentLstat.isDirectory() || parentLstat.isSymbolicLink() || parentReal !== targetParent) {
    throw ownerError('owner-link-parent-invalid', `targetLink parent is not a canonical plain directory: ${targetParent}`);
  }
  try {
    fs.symlinkSync(sourceDir, targetLink, 'dir');
  } catch (cause) {
    throw ownerError('owner-link-create-failed', `symlink failed: ${cause.message}`);
  }
  let postLstat, postReadlink, postReal;
  try {
    postLstat = fs.lstatSync(targetLink);
    postReadlink = fs.readlinkSync(targetLink);
    postReal = fs.realpathSync(targetLink);
  } catch (cause) {
    throw ownerError('owner-link-postcondition-failed', `postcondition stat failed: ${cause.message}`);
  }
  if (!postLstat.isSymbolicLink() || postReadlink !== sourceDir || postReal !== sourceDir) {
    throw ownerError('owner-link-postcondition-failed', `targetLink postcondition failed: ${targetLink}`);
  }
  return Object.freeze({ targetLink, sourceDir });
}

const MCP_SOURCE_PACKAGE_SHA256 = '75c86d3ea631fc2323744281e3ef3f4d48becf70f1ed81eb4d36777380e5180c';
const MCP_SOURCE_PACKAGE_SIZE = 1089;
const MCP_SOURCE_PACKAGE_NAME = 'androidcommondoc-mcp-server';
const MCP_SOURCE_PACKAGE_VERSION = '1.0.0';
const MCP_SOURCE_SDK_DEPENDENCY = '1.27.1';
const MCP_SOURCE_BUILD_INDEX_SHA256 = '3278d1e75eb6fdbf0006f95c484ce1c0494f71c189cda5a601caa81ff1eba2a2';
const MCP_SOURCE_BUILD_INDEX_SIZE = 763;
const MCP_SOURCE_SDK_PACKAGE_SHA256 = '7f878a9bf7276aabe8e695ce712b9ae0dbba9660f611d7e1f877923bf0a02686';
const MCP_SOURCE_SDK_PACKAGE_SIZE = 5924;
const MCP_SOURCE_SDK_NAME = '@modelcontextprotocol/sdk';
const MCP_SOURCE_SDK_VERSION = '1.27.1';
const MCP_SOURCE_PACKAGE_LOCK_SHA256 = 'ef873525092069fd0c37d04e0a02fe5527557807f735651e4a215e91ac487192';

function materializeMcpRuntime(rootPath) {
  if (typeof rootPath !== 'string' || rootPath.length === 0 || !path.isAbsolute(rootPath) || path.resolve(rootPath) !== rootPath) {
    throw ownerError('owner-mcp-input-invalid', 'rootPath must be an absolute, normalized, nonempty string');
  }
  let rootLstat, rootReal;
  try {
    rootLstat = fs.lstatSync(rootPath);
    rootReal = fs.realpathSync(rootPath);
  } catch (cause) {
    throw ownerError('owner-mcp-root-invalid', `rootPath stat failed: ${cause.message}`);
  }
  const rootUidOk = typeof process.getuid !== 'function' || rootLstat.uid === process.getuid();
  if (!rootLstat.isDirectory() || rootLstat.isSymbolicLink() || rootReal !== rootPath || (rootLstat.mode & 0o777) !== 0o700 || !rootUidOk) {
    throw ownerError('owner-mcp-root-invalid', `rootPath is not a canonical owned directory: ${rootPath}`);
  }

  const sourceFacts = resolveSourceFacts();
  const sourceMcp = path.join(sourceFacts.projectRoot, 'mcp-server');
  const sourceBuild = path.join(sourceMcp, 'build');
  const sourceNodeModules = path.join(sourceMcp, 'node_modules');
  const rootWithSep = rootPath + path.sep;
  for (const candidate of [sourceMcp, sourceBuild, sourceNodeModules]) {
    let candidateLstat, candidateReal;
    try {
      candidateLstat = fs.lstatSync(candidate);
      candidateReal = fs.realpathSync(candidate);
    } catch (cause) {
      throw ownerError('owner-mcp-source-invalid', `source stat failed: ${cause.message}`);
    }
    const candidateUidOk = typeof process.getuid !== 'function' || candidateLstat.uid === process.getuid();
    if (!candidateLstat.isDirectory() || candidateLstat.isSymbolicLink() || candidateReal !== candidate || !candidateUidOk) {
      throw ownerError('owner-mcp-source-invalid', `source is not a canonical owned directory: ${candidate}`);
    }
    const candidateWithSep = candidate + path.sep;
    if (candidateWithSep.startsWith(rootWithSep) || rootWithSep.startsWith(candidateWithSep)) {
      throw ownerError('owner-mcp-source-invalid', `source must not overlap rootPath: ${candidate}`);
    }
  }

  const sourcePackage = readFdBoundFile(path.join(sourceMcp, 'package.json'), MAX_RECORD_BYTES);
  if (sourcePackage.digest !== MCP_SOURCE_PACKAGE_SHA256 || sourcePackage.size !== MCP_SOURCE_PACKAGE_SIZE) {
    throw ownerError('owner-mcp-source-pin-mismatch', 'source package.json does not match pinned facts');
  }
  const sourceBuildIndex = readFdBoundFile(path.join(sourceMcp, 'build', 'index.js'), MAX_RECORD_BYTES);
  if (sourceBuildIndex.digest !== MCP_SOURCE_BUILD_INDEX_SHA256 || sourceBuildIndex.size !== MCP_SOURCE_BUILD_INDEX_SIZE) {
    throw ownerError('owner-mcp-source-pin-mismatch', 'source build/index.js does not match pinned facts');
  }
  const sourceSdkPackage = readFdBoundFile(
    path.join(sourceMcp, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'), MAX_RECORD_BYTES,
  );
  if (sourceSdkPackage.digest !== MCP_SOURCE_SDK_PACKAGE_SHA256 || sourceSdkPackage.size !== MCP_SOURCE_SDK_PACKAGE_SIZE) {
    throw ownerError('owner-mcp-source-pin-mismatch', 'source SDK package.json does not match pinned facts');
  }
  const sourcePackageLock = readFdBoundFile(path.join(sourceMcp, 'package-lock.json'), MAX_RECORD_BYTES);
  if (sourcePackageLock.digest !== MCP_SOURCE_PACKAGE_LOCK_SHA256) {
    throw ownerError('owner-mcp-source-pin-mismatch', 'source package-lock.json does not match pinned facts');
  }

  let packageJson, sdkPackageJson;
  try {
    packageJson = JSON.parse(sourcePackage.bytes.toString('utf8'));
  } catch (cause) {
    throw ownerError('owner-mcp-package-invalid', `invalid JSON in package.json: ${cause.message}`);
  }
  try {
    sdkPackageJson = JSON.parse(sourceSdkPackage.bytes.toString('utf8'));
  } catch (cause) {
    throw ownerError('owner-mcp-package-invalid', `invalid JSON in SDK package.json: ${cause.message}`);
  }
  if (
    packageJson === null || typeof packageJson !== 'object' || Array.isArray(packageJson) ||
    packageJson.name !== MCP_SOURCE_PACKAGE_NAME || packageJson.version !== MCP_SOURCE_PACKAGE_VERSION ||
    !packageJson.dependencies || packageJson.dependencies[MCP_SOURCE_SDK_NAME] !== MCP_SOURCE_SDK_DEPENDENCY
  ) {
    throw ownerError('owner-mcp-package-invalid', 'package.json name/version/dependency do not match pinned facts');
  }
  if (
    sdkPackageJson === null || typeof sdkPackageJson !== 'object' || Array.isArray(sdkPackageJson) ||
    sdkPackageJson.name !== MCP_SOURCE_SDK_NAME || sdkPackageJson.version !== MCP_SOURCE_SDK_VERSION
  ) {
    throw ownerError('owner-mcp-package-invalid', 'SDK package.json name/version do not match pinned facts');
  }

  const mcpRoot = path.join(rootPath, 'mcp-server');
  makeOwnedDirectoryNoClobber(mcpRoot);
  const packageRecord = copyFdBoundFileNoClobber(
    path.join(sourceMcp, 'package.json'), path.join(mcpRoot, 'package.json'), MAX_RECORD_BYTES, 0o600,
  );
  const buildLink = linkCanonicalDirectoryNoClobber(sourceBuild, path.join(mcpRoot, 'build'));
  const nodeModulesLink = linkCanonicalDirectoryNoClobber(sourceNodeModules, path.join(mcpRoot, 'node_modules'));

  const { createRequire } = require('module');
  const mcpRequire = createRequire(path.join(mcpRoot, 'package.json'));
  const sdkDirWithSep = path.join(sourceNodeModules, '@modelcontextprotocol', 'sdk') + path.sep;
  for (const specifier of ['@modelcontextprotocol/sdk/client/index.js', '@modelcontextprotocol/sdk/client/stdio.js']) {
    let resolvedReal;
    try {
      resolvedReal = fs.realpathSync(mcpRequire.resolve(specifier));
    } catch (cause) {
      throw ownerError('owner-mcp-resolve-failed', `failed to resolve ${specifier}: ${cause.message}`);
    }
    if (!resolvedReal.startsWith(sdkDirWithSep)) {
      throw ownerError('owner-mcp-resolve-outside-sdk', `resolved path escapes SDK directory: ${specifier}`);
    }
  }

  const copiedPackage = readFdBoundFile(path.join(mcpRoot, 'package.json'), MAX_RECORD_BYTES);
  if (copiedPackage.digest !== sourcePackage.digest || copiedPackage.size !== sourcePackage.size) {
    throw ownerError('owner-mcp-copy-verification-failed', 'copied package.json does not match source after copy');
  }

  return Object.freeze({
    mcpRoot,
    records: Object.freeze([
      packageRecord,
      Object.freeze({ path: 'build/index.js', digest: sourceBuildIndex.digest, size: sourceBuildIndex.size }),
      Object.freeze({
        path: 'node_modules/@modelcontextprotocol/sdk/package.json',
        digest: sourceSdkPackage.digest,
        size: sourceSdkPackage.size,
      }),
    ]),
    links: Object.freeze([buildLink, nodeModulesLink]),
  });
}

// ═════════════════════════════════════════════════════════════════════════
// GREEN-D: genuine end-to-end P2 owner orchestration.
//
// Everything below drives the ALREADY-ACCEPTED production surfaces
// (runtime-role-lifecycle.cjs's ensure/consult-root/consult-root-status
// CLIs plus its direct binding/generation/grant/claim exports, and
// runtime-bridge-codex.cjs's session-run) against each isolated root's OWN
// copy of those files, under that root's own genuine childEnv. No fake
// capability, no test seam, no synthetic record: every registry-touching
// call below runs as a short-lived child process spawned with
// `env: childEnv` so it resolves the SAME TMPDIR-scoped registry the
// retained session-run supervisor for that root itself uses -- this
// process's own `process.env` is never mutated and never consulted for
// registry resolution.
// ═════════════════════════════════════════════════════════════════════════

const LIFECYCLE_REL_PATH = path.join('scripts', 'lib', 'runtime-role-lifecycle.cjs');
const BRIDGE_REL_PATH = path.join('scripts', 'lib', 'runtime-bridge-codex.cjs');
const WRITE_VERDICT_REL_PATH = path.join('scripts', 'sh', 'write-verdict.sh');
const P2_CHAIN_ROLES = Object.freeze(['arch-platform', 'arch-testing', 'arch-integration']);
const MAIN_BINDING_TTL_SECONDS = 3600;
const MAX_CHILD_STDOUT_BYTES = 4 * 1048576;
// Short, bounded, non-polling child scripts (mint/read a handful of records,
// no internal wait loop).
const QUICK_CHILD_SCRIPT_TIMEOUT_MS = 60000;
// Margin added on top of a script's own internal poll bound when sizing the
// OUTER execFileSync timeout that wraps it -- the internal bound governs
// when the script itself gives up and prints a failure; this margin only
// protects against the outer call being killed before the script can even
// report that failure.
const CHILD_SCRIPT_TIMEOUT_MARGIN_MS = 60000;
// A real Codex app-server round trip (model turns, tool calls, Context7
// search) has no fixed latency ceiling this file can know in advance; these
// bounds are generous on purpose -- a single genuine capture has no retry,
// so a premature timeout is far more costly than a long wait.
const READY_TIMEOUT_MS = 300000;
const READY_POLL_MS = 250;
const CONSULT_STATUS_TIMEOUT_MS = 600000;
const CONSULT_STATUS_POLL_MS = 250;
const PREP_TERMINAL_TIMEOUT_MS = 600000;
const PREP_TERMINAL_POLL_MS = 250;
const BARRIER_REACHED_TIMEOUT_MS = 600000;
const BARRIER_POLL_MS = 100;
const EXIT_CONFIRM_TIMEOUT_MS = 20000;
const EXIT_CONFIRM_POLL_MS = 100;
const STABILITY_REOBSERVE_DELAY_MS = 500;

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isHex32(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

function isHex64(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isHex40(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function freshNonceHex32() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Runs a fixed inline Node source as a short-lived child under `childEnv`,
 * passing `args` as its own `process.argv[1..]` (no shell, no caller-selected
 * executable -- always `process.execPath -e <source>`). The script is
 * required to print exactly one nonempty JSON line on success; this throws a
 * stable `owner-p2-*` error on any spawn failure, empty output, invalid
 * JSON, or a top-level `ok !== true`. `timeoutMs` is the OUTER bound for the
 * whole call and must exceed any internal poll deadline the script itself
 * observes, plus margin, or the child would be killed before it could even
 * report its own timeout failure.
 */
function runOwnerChildScript(childEnv, source, args, errorCode, timeoutMs) {
  let out;
  try {
    out = execFileSync(process.execPath, ['-e', source, ...args], {
      env: childEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: MAX_CHILD_STDOUT_BYTES,
    });
  } catch (cause) {
    const stderrText = (cause && typeof cause.stderr === 'string') ? cause.stderr : '';
    throw ownerError(errorCode, `child script failed: ${(cause && cause.message) || cause}${stderrText ? ` | stderr: ${stderrText.slice(0, 2000)}` : ''}`);
  }
  const trimmed = out.trim();
  if (trimmed.length === 0) throw ownerError(errorCode, 'child script produced no output');
  const lastLine = trimmed.split('\n').pop();
  let parsed;
  try {
    parsed = JSON.parse(lastLine);
  } catch (cause) {
    throw ownerError(errorCode, `child script output was not valid JSON: ${cause.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.ok !== true) {
    throw ownerError(errorCode, `child script reported failure: ${lastLine.slice(0, 2000)}`);
  }
  return parsed;
}

/**
 * Mints the genuine MainOrchestratorBinding + session generation + one-use
 * `ensure` grant for the five closed roles under `rootPath`'s OWN copy of
 * runtime-role-lifecycle.cjs, runs the real `ensure` CLI to obtain the one
 * batched `supervisor-start` action, then mints its production
 * SupervisorExecutionClaim via `mintSupervisorExecutionClaimForSession`.
 * Returns `{action, claim, bindingId, repoId, worktreeId, planDigest,
 * generationId, coordinationRootId}`.
 */
function bootstrapFiveRoleAction(rootPath, childEnv, sessionId) {
  const source = `
'use strict';
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const rootPath = process.argv[1];
const sessionId = process.argv[2];
const roles = JSON.parse(process.argv[3]);
const lifecyclePath = path.join(rootPath, ${JSON.stringify(LIFECYCLE_REL_PATH)});
const rll = require(lifecyclePath);
const sorted = roles.slice().sort();
if (JSON.stringify(sorted) !== JSON.stringify(roles) || new Set(sorted).size !== sorted.length) {
  process.stderr.write('roles-not-sorted-unique'); process.exit(1);
}
const repoId = rll.computeRepoId(rootPath);
const worktreeId = rll.computeWorktreeId(rootPath);
const plan = rll.discoverPlan(rootPath);
if (!plan.ok || !/^[0-9a-f]{64}$/.test(plan.planDigest)) { process.stderr.write('plan-invalid'); process.exit(1); }
const repoDescriptor = { repoId };
const bindingResult = rll.getOrCreateMainOrchestratorBindingForSession(
  repoDescriptor, sessionId, worktreeId, plan.planDigest, ${MAIN_BINDING_TTL_SECONDS}
);
if (!bindingResult.ok) { process.stderr.write('binding-failed:' + JSON.stringify(bindingResult)); process.exit(1); }
const binding = bindingResult.binding;
const genResult = rll.resolveSessionGeneration(repoDescriptor, { ok: true, provider: 'claude-hook', runtime_session_key: sessionId });
if (!genResult.ok || !/^[0-9a-f]{32}$/.test(genResult.generationId)) { process.stderr.write('generation-failed:' + JSON.stringify(genResult)); process.exit(1); }
const argvDigest = crypto.createHash('sha256').update(Buffer.from('ensure:' + sorted.join(','), 'utf8')).digest('hex');
const grant = rll.mintLifecycleCommandGrant(rootPath, binding, argvDigest, sorted, 'ensure', 'main-orchestrator', 'orchestrator', 'normal', null);
if (!grant.ok) { process.stderr.write('grant-failed:' + JSON.stringify(grant)); process.exit(1); }
const ensureArgs = [lifecyclePath, 'ensure', '--project-root', rootPath];
for (const r of sorted) ensureArgs.push('--role', r);
ensureArgs.push('--lifecycle-binding', grant.grantId);
let ensureOut;
try {
  ensureOut = execFileSync(process.execPath, ensureArgs, {
    env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1048576,
  });
} catch (cause) {
  process.stderr.write('ensure-exec-failed:' + String((cause && cause.message) || cause));
  process.exit(1);
}
const ensureLines = ensureOut.trim().split('\\n');
const ensureResult = JSON.parse(ensureLines[ensureLines.length - 1]);
if (
  ensureResult.schema !== 'coordination/lifecycle-cli-result/v1' || ensureResult.command !== 'ensure'
  || ensureResult.ok !== true || !Array.isArray(ensureResult.actions) || ensureResult.actions.length !== 1
) { process.stderr.write('ensure-result-invalid:' + ensureOut); process.exit(1); }
const action = ensureResult.actions[0];
if (action.kind !== 'supervisor-start' || action.runtime !== 'host-process') {
  process.stderr.write('ensure-action-not-supervisor-start'); process.exit(1);
}
const claimResult = rll.mintSupervisorExecutionClaimForSession(repoDescriptor, action, rootPath, sessionId);
if (!claimResult.ok) { process.stderr.write('claim-failed:' + JSON.stringify(claimResult)); process.exit(1); }
const coordinationRootId = rll.computeCoordinationRootId(rootPath);
process.stdout.write(JSON.stringify({
  ok: true, action, claim: claimResult.record, bindingId: binding.binding_id,
  repoId, worktreeId, planDigest: plan.planDigest, generationId: genResult.generationId, coordinationRootId,
}) + '\\n');
`;
  return runOwnerChildScript(
    childEnv, source, [rootPath, sessionId, JSON.stringify(ROLES)],
    'owner-p2-bootstrap-failed', QUICK_CHILD_SCRIPT_TIMEOUT_MS,
  );
}

/**
 * Spawns the retained `session-run` supervisor for `rootPath` in the
 * background using the action's OWN `payload.bridge_argv` verbatim (never a
 * reconstructed path) under `childEnv`. stdout/stderr are redirected
 * directly to fresh no-clobber files under `logDir` (never a pipe): this
 * process spends long stretches blocked in synchronous filesystem polling
 * (barrier waits) while session-run runs concurrently, and while that
 * synchronous polling is active neither a `data` handler nor an `exit`
 * handler can safely observe this child (libuv's event queue is never
 * serviced). Teardown is the one path that deliberately stops polling and
 * crosses a real async exit/reap boundary instead (see
 * `terminateRetainedSession`), so Node genuinely reaps this child before the
 * canonical bridge liveness classifier ever runs against it -- a still-
 * unreaped zombie is otherwise indistinguishable from LIVE to that
 * classifier, even though this file's own independent `ps` observation
 * already treats it as exited.
 */
function spawnSessionRunChild(rootPath, childEnv, action, logDir) {
  const bridgeArgv = action && action.payload && action.payload.bridge_argv;
  if (!Array.isArray(bridgeArgv) || bridgeArgv.length < 3 || bridgeArgv[2] !== 'session-run') {
    throw ownerError('owner-p2-bridge-argv-invalid', 'action.payload.bridge_argv is not a valid session-run argv');
  }
  const stdoutPath = path.join(logDir, 'session-run.stdout.log');
  const stderrPath = path.join(logDir, 'session-run.stderr.log');
  const stdoutFd = fs.openSync(stdoutPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  const stderrFd = fs.openSync(stderrPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  let child;
  try {
    child = spawn(bridgeArgv[0], bridgeArgv.slice(1), {
      cwd: rootPath,
      env: childEnv,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  child.on('error', () => { /* best-effort: liveness is polled via ps, never trusted from this handler alone */ });
  return { child, pid: child.pid, stdoutPath, stderrPath };
}

function tailFileForDiagnostics(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.slice(-2000);
  } catch (cause) {
    return `(unavailable: ${cause.message})`;
  }
}

/** Independent, event-loop-agnostic liveness check: a zombie (STAT starts with 'Z') is treated as exited -- this process's own event loop is not relied upon to have reaped it. */
function processIsAlive(pid) {
  let out;
  try {
    out = execFileSync(PS_BINARY, ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    });
  } catch (cause) {
    return false;
  }
  const stat = out.trim();
  return stat.length > 0 && !stat.startsWith('Z');
}

function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true;
    sleepMs(EXIT_CONFIRM_POLL_MS);
  }
  return !processIsAlive(pid);
}

/** Resolves true once Node's own `exit` event fires for `child` (a genuine reap), or false on timeout -- exactly one listener, exactly one timer, both cleaned up on whichever path settles first. */
function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    let settled = false;
    const onExit = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

/**
 * The production stop/settlement path for a retained session-run child:
 * SIGTERM, then a genuine awaited reap via `waitForChildExit` (never
 * synchronous polling) so Node's own event loop services the exit event
 * before any liveness classification runs; SIGKILL only if that bound is
 * exceeded, with one more awaited reap. Fails closed if the child is still
 * unreaped or `processIsAlive` still observes it after that reap.
 */
async function terminateRetainedSession(sessionHandle) {
  try {
    sessionHandle.child.kill('SIGTERM');
  } catch (cause) {
    throw ownerError('owner-p2-teardown-sigterm-failed', `SIGTERM failed: ${cause.message}`);
  }
  let exited = await waitForChildExit(sessionHandle.child, EXIT_CONFIRM_TIMEOUT_MS);
  if (!exited) {
    try {
      sessionHandle.child.kill('SIGKILL');
    } catch (cause) { /* best-effort */ }
    exited = await waitForChildExit(sessionHandle.child, EXIT_CONFIRM_TIMEOUT_MS);
  }
  if (!exited || processIsAlive(sessionHandle.pid)) {
    throw ownerError(
      'owner-p2-teardown-process-alive',
      `session-run pid ${sessionHandle.pid} did not exit after SIGTERM/SIGKILL | ${tailFileForDiagnostics(sessionHandle.stderrPath)}`,
    );
  }
}

/**
 * Polls `readRoleBindingState` for every closed role under `action`'s scope
 * until each reaches READY (bounded), then seals the P2 subject-bundle seed
 * via the accepted `sealP2SubjectBundleInput` two-argument API. Runs as a
 * single child invocation with an internal poll loop (no per-tick spawn).
 */
function waitRolesReadyAndSealSeed(rootPath, childEnv, roles, generationId) {
  if (!isHex32(generationId)) throw ownerError('owner-p2-generation-id-invalid', 'generationId must be exact 32-lowerhex');
  const source = `
'use strict';
const path = require('path');
const rootPath = process.argv[1];
const roles = JSON.parse(process.argv[2]);
const generationId = process.argv[3];
const lifecyclePath = path.join(rootPath, ${JSON.stringify(LIFECYCLE_REL_PATH)});
const rll = require(lifecyclePath);
const worktreeId = rll.computeWorktreeId(rootPath);
const plan = rll.discoverPlan(rootPath);
if (!plan.ok) { process.stderr.write('plan-invalid'); process.exit(1); }
const deadline = Date.now() + ${READY_TIMEOUT_MS};
const pending = new Set(roles);
while (pending.size > 0 && Date.now() < deadline) {
  for (const role of Array.from(pending)) {
    const state = rll.readRoleBindingState(rootPath, worktreeId, plan.planDigest, rll.roleProfileDigestFor(role), generationId, role);
    if (state.ok && state.state === 'READY') pending.delete(role);
  }
  if (pending.size === 0) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${READY_POLL_MS});
}
if (pending.size > 0) { process.stderr.write('roles-not-ready:' + JSON.stringify(Array.from(pending))); process.exit(1); }

const waveSlug = path.basename(path.dirname(plan.planPath)).replace(/^wave-/, '');
const entries = ${JSON.stringify(SEED_ENTRIES)};
const caps = ${JSON.stringify(SEED_CAPS)};
const sealResult = rll.sealP2SubjectBundleInput(rootPath, { waveSlug, entries, caps });
if (!sealResult.ok) { process.stderr.write('seal-failed:' + JSON.stringify(sealResult)); process.exit(1); }
process.stdout.write(JSON.stringify({ ok: true, waveSlug }) + '\\n');
`;
  return runOwnerChildScript(
    childEnv, source, [rootPath, JSON.stringify(roles), generationId],
    'owner-p2-ready-seal-failed', READY_TIMEOUT_MS + CHILD_SCRIPT_TIMEOUT_MARGIN_MS,
  );
}

/**
 * Shared body (interpolated into every chain-driving child script below):
 * a bounded recursive scan of this root's registry tree for JSON records
 * whose top-level `schema` matches -- mirrors the accepted bats
 * `_app_live_prep_scan_schema` helper's own read-only introspection, never
 * a guessed direct path for schemas this module does not export a path
 * builder for (root-consult-completion, worker-presence).
 */
const SCAN_SCHEMA_HELPER_SOURCE = `
const MAX_SCAN_ENTRIES = 500000;
function scanSchema(root, schema) {
  const out = [];
  let count = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return; }
    for (const entry of entries) {
      count += 1;
      if (count > MAX_SCAN_ENTRIES) throw new Error('scan-cap-exceeded');
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      let obj;
      try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (err) { continue; }
      if (obj && typeof obj === 'object' && obj.schema === schema) out.push(obj);
    }
  };
  walk(root);
  return out;
}
function exactlyOne(arr, pred) {
  const m = arr.filter(pred);
  if (m.length !== 1) throw new Error('exactly-one-violated:' + m.length);
  return m[0];
}
function sha256FileBytes(p) {
  const st = fs.lstatSync(p);
  if (!st.isFile() || st.isSymbolicLink() || st.size <= 0 || st.size > ${MAX_RECORD_BYTES}) throw new Error('hash-target-shape-invalid:' + p);
  const bytes = fs.readFileSync(p);
  return { digest: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}
`;

/**
 * Drives one full architect chain (consult-root -> consult-root-status ->
 * autonomous review/reserve/write-verdict/complete inside the retained
 * session-run -> receipt) with NO interposition, for `role` under
 * `rootPath`. `predecessor`, when non-null, carries the immediately prior
 * chain's own `{role, receiptDigest, verdictDigest}` so this call can
 * fd-revalidate that predecessor pair fresh (never caller-trusted) before
 * treating its own reservation as legitimately ordered.
 * Returns the full evidence object for this chain.
 */
function driveArchitectChain(rootPath, childEnv, bindingId, repoId, role, generationId, expectedHead, predecessor) {
  const resolvedQuestion = architectSourceQuestionFor(role);
  const source = `
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
${SCAN_SCHEMA_HELPER_SOURCE}
const rootPath = process.argv[1];
const bindingId = process.argv[2];
const repoId = process.argv[3];
const role = process.argv[4];
const expectedHead = process.argv[5];
const predecessor = JSON.parse(process.argv[6]);
const lifecyclePath = path.join(rootPath, ${JSON.stringify(LIFECYCLE_REL_PATH)});
const rll = require(lifecyclePath);
const repoDescriptor = { repoId };

const bindingRead = rll.readRegistryRecord(rll.mainOrchestratorBindingPathFor(rootPath, bindingId));
if (!bindingRead.ok || bindingRead.absent) { process.stderr.write('binding-unavailable'); process.exit(1); }
const binding = bindingRead.obj;

const mintGrant = (subcommand, value) => {
  const argvDigest = crypto.createHash('sha256').update(Buffer.from(subcommand + ':' + value, 'utf8')).digest('hex');
  const minted = rll.mintLifecycleCommandGrant(rootPath, binding, argvDigest, role, subcommand, 'main-orchestrator', 'orchestrator', 'normal', null);
  if (!minted.ok) throw new Error('grant-mint-failed:' + subcommand + ':' + JSON.stringify(minted));
  return minted.grantId;
};

const question = ${JSON.stringify(resolvedQuestion)};
const intentObj = {
  requester_role: role,
  target_role: 'context-provider',
  question: question,
  expected_result_kind: 'P2_SOURCE_EVIDENCE',
  evidence_policy: 'none',
};
const encodedIntent = Buffer.from(JSON.stringify(intentObj), 'utf8').toString('base64url');
const consultGrantId = mintGrant('consult-root', encodedIntent);
let consultOut;
try {
  consultOut = execFileSync(process.execPath, [lifecyclePath, 'consult-root', '--project-root', rootPath, '--intent', encodedIntent, '--lifecycle-binding', consultGrantId], {
    env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1048576,
  });
} catch (cause) { process.stderr.write('consult-root-exec-failed:' + String((cause && cause.message) || cause)); process.exit(1); }
const consultLines = consultOut.trim().split('\\n');
const consultResult = JSON.parse(consultLines[consultLines.length - 1]);
if (
  consultResult.schema !== 'coordination/lifecycle-cli-result/v1' || consultResult.command !== 'consult-root'
  || consultResult.ok !== true || consultResult.status !== 'WAITING'
  || !consultResult.operation || consultResult.operation.kind !== 'root-consult' || consultResult.operation.state !== 'WAITING'
) { process.stderr.write('consult-root-result-invalid:' + consultOut); process.exit(1); }
const intentId = consultResult.operation.operation_id;
if (!/^[0-9a-f]{32}$/.test(intentId)) { process.stderr.write('intent-id-invalid'); process.exit(1); }

const statusDeadline = Date.now() + ${CONSULT_STATUS_TIMEOUT_MS};
let readyOp = null;
while (Date.now() < statusDeadline) {
  const statusGrantId = mintGrant('consult-root-status', intentId);
  let statusOut;
  try {
    statusOut = execFileSync(process.execPath, [lifecyclePath, 'consult-root-status', '--project-root', rootPath, '--intent-id', intentId, '--lifecycle-binding', statusGrantId], {
      env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1048576,
    });
  } catch (cause) { statusOut = ''; }
  try {
    const lines = statusOut.trim().split('\\n');
    const parsed = JSON.parse(lines[lines.length - 1]);
    const op = parsed && parsed.operation;
    const refsOk = op && op.result_ref && op.result_digest && op.accepted_result_ref && op.accepted_result_digest && op.ack_ref && op.ack_digest;
    if (op && op.kind === 'root-consult' && op.operation_id === intentId && op.state === 'READY' && refsOk) { readyOp = op; break; }
  } catch (err) { /* not yet valid JSON */ }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${CONSULT_STATUS_POLL_MS});
}
if (!readyOp) { process.stderr.write('consult-root-status-timeout'); process.exit(1); }

const rootIntentRead = rll.readRegistryRecord(rll.rootConsultIntentPathFor(rootPath, intentId));
if (!rootIntentRead.ok || rootIntentRead.absent) { process.stderr.write('root-intent-unavailable'); process.exit(1); }
const rootIntent = rootIntentRead.obj;
if (
  rootIntent.intent_id !== intentId || rootIntent.main_binding_id !== bindingId
  || rootIntent.requester_role !== role || rootIntent.target_role !== 'context-provider'
  || rootIntent.expected_result_kind !== 'P2_SOURCE_EVIDENCE' || rootIntent.evidence_policy !== 'none'
) { process.stderr.write('root-intent-correlation-failed'); process.exit(1); }

const completions = scanSchema(rll.registryRepoDir(repoDescriptor), 'runtime/root-consult-completion/v1');
const completion = exactlyOne(completions, (c) => c.intent_id === intentId && c.request_id === readyOp.request_id && c.requester_actor_instance_id === rootIntent.requester_actor_instance_id);
const cpCompletionDigest = crypto.createHash('sha256').update(Buffer.from(JSON.stringify(completion), 'utf8')).digest('hex');
if (
  completion.result_ref !== readyOp.result_ref || completion.result_digest !== readyOp.result_digest
  || completion.accepted_result_ref !== readyOp.accepted_result_ref || completion.accepted_result_digest !== readyOp.accepted_result_digest
  || completion.ack_ref !== readyOp.ack_ref || completion.ack_digest !== readyOp.ack_digest
) { process.stderr.write('completion-refs-mismatch'); process.exit(1); }

const presences = scanSchema(rll.registryRepoDir(repoDescriptor), 'coordination/worker-presence/v1');
const presence = exactlyOne(presences, (p) => p.role === role && p.worktree_id === rootIntent.worktree_id);

const prepPath = rll.prepPublicationIntentPathFor(rootPath, ${JSON.stringify(WAVE_SLUG)}, role);
const prepDeadline = Date.now() + ${PREP_TERMINAL_TIMEOUT_MS};
let prepIntent = null;
while (Date.now() < prepDeadline) {
  const read = rll.readRegistryRecord(prepPath);
  if (read.ok && !read.absent && read.obj && (read.obj.state === 'COMPLETED' || read.obj.state === 'CONFLICTED')) { prepIntent = read.obj; break; }
  const reviewCheck = rll.readRegistryRecord(rll.rootConsultReviewPathFor(rootPath, intentId));
  if (reviewCheck.ok && !reviewCheck.absent && reviewCheck.obj) {
    const decision = reviewCheck.obj.decision;
    if (decision === 'REJECTED' || decision === 'INCONCLUSIVE') {
      process.stderr.write('review-not-approved:' + decision + '\\n');
      process.exit(1);
    }
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${PREP_TERMINAL_POLL_MS});
}
if (!prepIntent) { process.stderr.write('prep-terminal-timeout'); process.exit(1); }
if (prepIntent.state !== 'COMPLETED') { process.stderr.write('prep-not-completed:' + prepIntent.state); process.exit(1); }
if (
  prepIntent.cp_intent_id !== intentId || prepIntent.binding_id !== bindingId || prepIntent.role !== role
  || prepIntent.requester_actor_instance_id !== rootIntent.requester_actor_instance_id
  || prepIntent.session_generation_id !== rootIntent.session_generation_id
  || prepIntent.cp_completion_digest !== cpCompletionDigest
  || prepIntent.subject_scope_digest !== rootIntent.subject_scope_digest
) { process.stderr.write('prep-intent-correlation-failed'); process.exit(1); }

const reviewRead = rll.readRegistryRecord(rll.rootConsultReviewPathFor(rootPath, intentId));
if (!reviewRead.ok || reviewRead.absent) { process.stderr.write('review-unavailable'); process.exit(1); }
const review = reviewRead.obj;
if (
  review.intent_id !== intentId || review.binding_id !== bindingId || review.decision !== 'APPROVED_PREP'
  || review.requester_actor_instance_id !== rootIntent.requester_actor_instance_id
  || review.session_generation_id !== rootIntent.session_generation_id
  || review.subject_bundle_ref !== rootIntent.subject_bundle_ref
  || review.subject_scope_digest !== rootIntent.subject_scope_digest
  || review.cp_completion_digest !== cpCompletionDigest
) { process.stderr.write('review-correlation-failed'); process.exit(1); }
if (presence.thread_id !== review.thread_id) { process.stderr.write('presence-thread-mismatch'); process.exit(1); }

const receiptRead = rll.readRegistryRecord(rll.prepPublicationReceiptPathFor(rootPath, ${JSON.stringify(WAVE_SLUG)}, role));
if (!receiptRead.ok || receiptRead.absent) { process.stderr.write('receipt-unavailable'); process.exit(1); }
const receipt = receiptRead.obj;
if (
  receipt.intent_id !== prepIntent.intent_id || receipt.role !== role || receipt.binding_id !== bindingId
  || receipt.requester_actor_instance_id !== prepIntent.requester_actor_instance_id
  || receipt.session_generation_id !== prepIntent.session_generation_id
  || receipt.cp_intent_id !== intentId || receipt.cp_completion_digest !== cpCompletionDigest
  || receipt.subject_scope_digest !== prepIntent.subject_scope_digest
  || receipt.publication_nonce !== prepIntent.publication_nonce
  || receipt.review_decision !== 'APPROVED_PREP'
) { process.stderr.write('receipt-correlation-failed'); process.exit(1); }
if (receipt.head !== expectedHead || prepIntent.head !== expectedHead) { process.stderr.write('head-mismatch'); process.exit(1); }
if (receipt.plan_sha256 !== prepIntent.plan_sha256) { process.stderr.write('plan-sha-mismatch'); process.exit(1); }

const verdictAbsPath = path.join(rootPath, receipt.verdict_ref);
const verdictReal = fs.realpathSync(verdictAbsPath);
const rootReal = fs.realpathSync(rootPath);
if (verdictReal !== rootReal && !verdictReal.startsWith(rootReal + path.sep)) { process.stderr.write('verdict-escapes-root'); process.exit(1); }
const verdictHash = sha256FileBytes(verdictAbsPath);
if (verdictHash.digest !== receipt.verdict_full_sha256) { process.stderr.write('verdict-digest-mismatch'); process.exit(1); }

const receiptPath = rll.prepPublicationReceiptPathFor(rootPath, ${JSON.stringify(WAVE_SLUG)}, role);
const receiptHash = sha256FileBytes(receiptPath);

let predecessorCheck = null;
if (predecessor) {
  if (rll.prepPublicationPredecessorRole(role) !== predecessor.role) { process.stderr.write('predecessor-role-mismatch'); process.exit(1); }
  const predVerdictAbs = path.join(rootPath, predecessor.verdictRef);
  const predVerdictHash = sha256FileBytes(predVerdictAbs);
  const predReceiptHash = sha256FileBytes(rll.prepPublicationReceiptPathFor(rootPath, ${JSON.stringify(WAVE_SLUG)}, predecessor.role));
  if (predVerdictHash.digest !== predecessor.verdictDigest || predReceiptHash.digest !== predecessor.receiptDigest) {
    process.stderr.write('predecessor-digest-drift'); process.exit(1);
  }
  const currentHead = execFileSync(${JSON.stringify(GIT_BINARY)}, ['-C', rootPath, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  predecessorCheck = {
    role,
    predecessor_role: predecessor.role,
    predecessor_receipt_ref: predecessor.receiptRef,
    predecessor_verdict_ref: predecessor.verdictRef,
    expected_receipt_digest: predecessor.receiptDigest,
    expected_verdict_digest: predecessor.verdictDigest,
    observed_receipt_digest: predReceiptHash.digest,
    observed_verdict_digest: predVerdictHash.digest,
    observed_head: currentHead,
    observed_plan_sha256: prepIntent.plan_sha256,
  };
  if (currentHead !== expectedHead) { process.stderr.write('predecessor-check-head-drift'); process.exit(1); }
}

process.stdout.write(JSON.stringify({
  ok: true,
  role,
  intentId,
  hostNonce: prepIntent.publication_nonce,
  retainedOwnerId: review.thread_id,
  threadId: review.thread_id,
  actorInstanceId: rootIntent.requester_actor_instance_id,
  sessionGenerationId: rootIntent.session_generation_id,
  receiptRef: receiptPath,
  verdictRef: receipt.verdict_ref,
  receiptDigest: receiptHash.digest,
  verdictDigest: verdictHash.digest,
  verdictLength: verdictHash.size,
  receiptId: receipt.receipt_id,
  predecessorCheck,
}) + '\\n');
`;
  return runOwnerChildScript(
    childEnv, source,
    [rootPath, bindingId, repoId, role, expectedHead, JSON.stringify(predecessor)],
    'owner-p2-chain-failed', CONSULT_STATUS_TIMEOUT_MS + PREP_TERMINAL_TIMEOUT_MS + CHILD_SCRIPT_TIMEOUT_MARGIN_MS,
  );
}

/** Mints a consult-root grant+call for `role`, then polls consult-root-status (fresh grant each poll) until READY. Returns `{ok:true, intentId}`. */
function consultAndWaitReady(rootPath, childEnv, bindingId, role) {
  const resolvedQuestion = architectSourceQuestionFor(role);
  const source = `
'use strict';
const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const rootPath = process.argv[1];
const bindingId = process.argv[2];
const role = process.argv[3];
const lifecyclePath = path.join(rootPath, ${JSON.stringify(LIFECYCLE_REL_PATH)});
const rll = require(lifecyclePath);
const bindingRead = rll.readRegistryRecord(rll.mainOrchestratorBindingPathFor(rootPath, bindingId));
if (!bindingRead.ok || bindingRead.absent) { process.stderr.write('binding-unavailable'); process.exit(1); }
const binding = bindingRead.obj;
const mintGrant = (subcommand, value) => {
  const argvDigest = crypto.createHash('sha256').update(Buffer.from(subcommand + ':' + value, 'utf8')).digest('hex');
  const minted = rll.mintLifecycleCommandGrant(rootPath, binding, argvDigest, role, subcommand, 'main-orchestrator', 'orchestrator', 'normal', null);
  if (!minted.ok) throw new Error('grant-mint-failed:' + subcommand + ':' + JSON.stringify(minted));
  return minted.grantId;
};
const intentObj = {
  requester_role: role, target_role: 'context-provider',
  question: ${JSON.stringify(resolvedQuestion)},
  expected_result_kind: 'P2_SOURCE_EVIDENCE', evidence_policy: 'none',
};
const encodedIntent = Buffer.from(JSON.stringify(intentObj), 'utf8').toString('base64url');
const consultGrantId = mintGrant('consult-root', encodedIntent);
let consultOut;
try {
  consultOut = execFileSync(process.execPath, [lifecyclePath, 'consult-root', '--project-root', rootPath, '--intent', encodedIntent, '--lifecycle-binding', consultGrantId], {
    env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1048576,
  });
} catch (cause) { process.stderr.write('consult-root-exec-failed:' + String((cause && cause.message) || cause)); process.exit(1); }
const consultLines = consultOut.trim().split('\\n');
const consultResult = JSON.parse(consultLines[consultLines.length - 1]);
if (consultResult.ok !== true || consultResult.status !== 'WAITING' || !consultResult.operation) { process.stderr.write('consult-root-result-invalid:' + consultOut); process.exit(1); }
const intentId = consultResult.operation.operation_id;
if (!/^[0-9a-f]{32}$/.test(intentId)) { process.stderr.write('intent-id-invalid'); process.exit(1); }
const statusDeadline = Date.now() + ${CONSULT_STATUS_TIMEOUT_MS};
let ready = false;
while (Date.now() < statusDeadline) {
  const statusGrantId = mintGrant('consult-root-status', intentId);
  let statusOut;
  try {
    statusOut = execFileSync(process.execPath, [lifecyclePath, 'consult-root-status', '--project-root', rootPath, '--intent-id', intentId, '--lifecycle-binding', statusGrantId], {
      env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1048576,
    });
  } catch (cause) { statusOut = ''; }
  try {
    const lines = statusOut.trim().split('\\n');
    const parsed = JSON.parse(lines[lines.length - 1]);
    const op = parsed && parsed.operation;
    const refsOk = op && op.result_ref && op.result_digest && op.accepted_result_ref && op.accepted_result_digest && op.ack_ref && op.ack_digest;
    if (op && op.kind === 'root-consult' && op.operation_id === intentId && op.state === 'READY' && refsOk) { ready = true; break; }
  } catch (err) { /* not yet valid JSON */ }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${CONSULT_STATUS_POLL_MS});
}
if (!ready) { process.stderr.write('consult-root-status-timeout'); process.exit(1); }
process.stdout.write(JSON.stringify({ ok: true, intentId }) + '\\n');
`;
  return runOwnerChildScript(
    childEnv, source, [rootPath, bindingId, role],
    'owner-p2-hostile-consult-failed', CONSULT_STATUS_TIMEOUT_MS + CHILD_SCRIPT_TIMEOUT_MARGIN_MS,
  );
}

/**
 * Polls the PREP-publication intent for `role` until its state is one of
 * `wantedStates` (bounded), then reads the correlated review record and the
 * verdict file's current bytes, plus the receipt when present. Never mutates
 * anything -- pure fd-bound snapshot, safe to call repeatedly for
 * before/after/re-observation proofs.
 */
function readPrepStateSnapshot(rootPath, childEnv, role, wantedStates, timeoutMs) {
  const source = `
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rootPath = process.argv[1];
const role = process.argv[2];
const wantedStates = JSON.parse(process.argv[3]);
const lifecyclePath = path.join(rootPath, ${JSON.stringify(LIFECYCLE_REL_PATH)});
const rll = require(lifecyclePath);
function sha256FileBytes(p) {
  const st = fs.lstatSync(p);
  if (!st.isFile() || st.isSymbolicLink() || st.size <= 0 || st.size > ${MAX_RECORD_BYTES}) throw new Error('hash-target-shape-invalid:' + p);
  const bytes = fs.readFileSync(p);
  return { digest: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}
const prepPath = rll.prepPublicationIntentPathFor(rootPath, ${JSON.stringify(WAVE_SLUG)}, role);
const deadline = Date.now() + ${timeoutMs};
let prepIntent = null;
while (Date.now() < deadline) {
  const read = rll.readRegistryRecord(prepPath);
  if (read.ok && !read.absent && read.obj && wantedStates.includes(read.obj.state)) { prepIntent = read.obj; break; }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${PREP_TERMINAL_POLL_MS});
}
if (!prepIntent) { process.stderr.write('prep-state-timeout:wanted=' + JSON.stringify(wantedStates)); process.exit(1); }
const reviewRead = rll.readRegistryRecord(rll.rootConsultReviewPathFor(rootPath, prepIntent.cp_intent_id));
if (!reviewRead.ok || reviewRead.absent) { process.stderr.write('review-unavailable'); process.exit(1); }
const review = reviewRead.obj;
const verdictRef = '.planning/wave-' + ${JSON.stringify(WAVE_SLUG)} + '/arch-' + role.slice('arch-'.length) + '-verdict.md';
const verdictAbs = path.join(rootPath, verdictRef);
let verdictHash = null;
try { verdictHash = sha256FileBytes(verdictAbs); } catch (err) { verdictHash = null; }
let receipt = null;
let receiptDigest = null;
const receiptPath = rll.prepPublicationReceiptPathFor(rootPath, ${JSON.stringify(WAVE_SLUG)}, role);
const receiptRead = rll.readRegistryRecord(receiptPath);
if (receiptRead.ok && !receiptRead.absent) {
  receipt = receiptRead.obj;
  receiptDigest = sha256FileBytes(receiptPath).digest;
}
process.stdout.write(JSON.stringify({
  ok: true,
  state: prepIntent.state,
  nonce: prepIntent.publication_nonce,
  cpIntentId: prepIntent.cp_intent_id,
  actorInstanceId: review.requester_actor_instance_id,
  sessionGenerationId: review.session_generation_id,
  threadId: review.thread_id,
  verdictDigest: verdictHash ? verdictHash.digest : null,
  verdictLength: verdictHash ? verdictHash.size : null,
  verdictRef,
  receiptExists: receipt !== null,
  receiptId: receipt ? receipt.receipt_id : null,
  receiptDigest,
}) + '\\n');
`;
  return runOwnerChildScript(
    childEnv, source, [rootPath, role, JSON.stringify(wantedStates)],
    'owner-p2-hostile-snapshot-failed', timeoutMs + CHILD_SCRIPT_TIMEOUT_MARGIN_MS,
  );
}

function releaseBarrierFile(filePath) {
  writeOwnedFileNoClobber(filePath, Buffer.from('release\n', 'utf8'), 0o600);
}

function waitForBarrierFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const st = fs.lstatSync(filePath);
      if (st.isFile() && !st.isSymbolicLink()) return true;
    } catch (cause) {
      if (cause.code !== 'ENOENT') throw ownerError('owner-p2-barrier-stat-failed', `barrier path stat failed: ${cause.message}`);
    }
    sleepMs(BARRIER_POLL_MS);
  }
  return false;
}

function countJsonlLines(filePath) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath, 'utf8');
  } catch (cause) {
    if (cause.code === 'ENOENT') return 0;
    throw ownerError('owner-p2-jsonl-read-failed', `spawn-observation read failed: ${cause.message}`);
  }
  return bytes.split('\n').filter((line) => line.trim().length > 0).length;
}

/**
 * Invokes the hostile root's OWN copy of write-verdict.sh directly (never a
 * fixture copy elsewhere), exactly mirroring session-run's own
 * `runAndReadPrepVerdict` argv shape, but with a deliberately wrong
 * `--publication-nonce` -- the ONLY form of interposition GREEN-D permits
 * beyond the accepted deterministic barriers.
 */
function injectHostileVerdict(rootPath, childEnv, role, wrongNonce) {
  const scriptPath = path.join(rootPath, WRITE_VERDICT_REL_PATH);
  try {
    execFileSync(BASH_BINARY, [scriptPath, '--role', role, '--phase', 'prep', '--slug', WAVE_SLUG, '--publication-nonce', wrongNonce], {
      cwd: rootPath,
      env: childEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });
  } catch (cause) {
    throw ownerError('owner-p2-hostile-verdict-write-failed', `hostile write-verdict.sh failed: ${(cause && cause.message) || cause}`);
  }
}

/**
 * Hostile root, chain 1: arch-platform correct-nonce crash-cut/idempotence
 * (case 06 shape). Pauses the retained session-run at the accepted
 * COMPLETION barrier (verdict already genuinely written by session-run
 * itself, using its own correctly-minted nonce), releases with no
 * mutation, then proves the resumed completion is a same-nonce internal
 * retry (never a re-mint, never a second write-verdict.sh spawn) and that
 * the terminal receipt is stable across a second, later re-observation.
 */
function driveHostileCorrectNonceCase(rootPath, childEnv, bindingId, barrierDir) {
  const role = 'arch-platform';
  consultAndWaitReady(rootPath, childEnv, bindingId, role);
  const reachedPath = path.join(barrierDir, 'completion-reached');
  const releasePath = path.join(barrierDir, 'completion-release');
  const spawnJsonl = path.join(barrierDir, 'write-verdict-spawns.jsonl');
  if (!waitForBarrierFile(reachedPath, BARRIER_REACHED_TIMEOUT_MS)) {
    throw ownerError('owner-p2-hostile-barrier-timeout', 'completion barrier was never reached for arch-platform');
  }
  const before = readPrepStateSnapshot(rootPath, childEnv, role, ['RESERVED'], 5000);
  releaseBarrierFile(releasePath);
  const after = readPrepStateSnapshot(rootPath, childEnv, role, ['COMPLETED'], PREP_TERMINAL_TIMEOUT_MS);
  if (after.nonce !== before.nonce) throw ownerError('owner-p2-hostile-nonce-remint', 'arch-platform nonce changed across the completion barrier');
  if (after.actorInstanceId !== before.actorInstanceId || after.sessionGenerationId !== before.sessionGenerationId || after.threadId !== before.threadId) {
    throw ownerError('owner-p2-hostile-retained-owner-drift', 'arch-platform retained actor/session/thread changed across the completion barrier');
  }
  if (!after.receiptExists) throw ownerError('owner-p2-hostile-receipt-missing', 'arch-platform receipt missing after completion barrier release');
  if (before.verdictDigest === null || after.verdictDigest !== before.verdictDigest || after.verdictLength !== before.verdictLength) {
    throw ownerError('owner-p2-hostile-verdict-drift', 'arch-platform verdict bytes changed across the completion barrier');
  }
  sleepMs(STABILITY_REOBSERVE_DELAY_MS);
  const second = readPrepStateSnapshot(rootPath, childEnv, role, ['COMPLETED'], 5000);
  if (second.receiptId !== after.receiptId || second.receiptDigest !== after.receiptDigest) {
    throw ownerError('owner-p2-hostile-receipt-unstable', 'arch-platform receipt changed on re-observation');
  }
  const spawnCount = countJsonlLines(spawnJsonl);
  if (spawnCount !== 1) throw ownerError('owner-p2-hostile-spawn-count-invalid', `expected exactly one write-verdict.sh spawn, observed ${spawnCount}`);
  return {
    role,
    terminal_state: 'COMPLETED',
    write_verdict_spawn_count: spawnCount,
    nonce_before: before.nonce,
    nonce_after: after.nonce,
    actor_instance_id_before: before.actorInstanceId,
    actor_instance_id_after: after.actorInstanceId,
    session_generation_id_before: before.sessionGenerationId,
    session_generation_id_after: after.sessionGenerationId,
    thread_id_before: before.threadId,
    thread_id_after: after.threadId,
    receipt_id_first_observation: after.receiptId,
    receipt_id_second_observation: second.receiptId,
    receipt_digest_first_observation: after.receiptDigest,
    receipt_digest_second_observation: second.receiptDigest,
    verdict_digest_before: before.verdictDigest,
    verdict_digest_after: after.verdictDigest,
    verdict_length_before: before.verdictLength,
    verdict_length_after: after.verdictLength,
  };
}

/**
 * Hostile root, chain 2: arch-testing wrong-nonce conflict (case 02 shape).
 * Pauses the retained session-run at the accepted PRE-VERDICT barrier
 * (reservation already genuine, verdict not yet written by session-run),
 * writes a deliberately wrong-nonce verdict via the root's own
 * write-verdict.sh (the only permitted hostile mutation), releases, then
 * proves session-run itself never re-wrote the file and refused completion.
 */
function driveHostileWrongNonceCase(rootPath, childEnv, bindingId, barrierDir) {
  const role = 'arch-testing';
  consultAndWaitReady(rootPath, childEnv, bindingId, role);
  const reachedPath = path.join(barrierDir, 'pre-verdict-reached');
  const releasePath = path.join(barrierDir, 'pre-verdict-release');
  if (!waitForBarrierFile(reachedPath, BARRIER_REACHED_TIMEOUT_MS)) {
    throw ownerError('owner-p2-hostile-barrier-timeout', 'pre-verdict barrier was never reached for arch-testing');
  }
  const before = readPrepStateSnapshot(rootPath, childEnv, role, ['RESERVED'], 5000);
  if (before.verdictDigest !== null) {
    throw ownerError('owner-p2-hostile-verdict-preexisting', 'arch-testing verdict already existed before hostile injection');
  }
  const reservedNonce = before.nonce;
  let writtenNonce = freshNonceHex32();
  if (writtenNonce === reservedNonce) writtenNonce = freshNonceHex32();
  if (writtenNonce === reservedNonce) throw ownerError('owner-p2-hostile-nonce-collision', 'freshly minted wrong nonce collided with the reserved nonce');
  injectHostileVerdict(rootPath, childEnv, role, writtenNonce);
  const injected = readPrepStateSnapshot(rootPath, childEnv, role, ['RESERVED'], 5000);
  if (injected.verdictDigest === null) throw ownerError('owner-p2-hostile-verdict-write-unverified', 'hostile verdict write did not produce a readable file');
  releaseBarrierFile(releasePath);
  const after = readPrepStateSnapshot(rootPath, childEnv, role, ['CONFLICTED'], PREP_TERMINAL_TIMEOUT_MS);
  if (after.receiptExists) throw ownerError('owner-p2-hostile-receipt-unexpected', 'arch-testing produced a receipt despite the wrong-nonce conflict');
  if (after.verdictDigest !== injected.verdictDigest || after.verdictLength !== injected.verdictLength) {
    throw ownerError('owner-p2-hostile-verdict-clobbered', 'arch-testing verdict bytes changed after the wrong-nonce conflict');
  }
  return {
    role,
    terminal_state: 'CONFLICTED',
    reserved_nonce: reservedNonce,
    written_nonce: writtenNonce,
    receipt_created: after.receiptExists,
    verdict_digest_before: injected.verdictDigest,
    verdict_digest_after: after.verdictDigest,
    verdict_length_before: injected.verdictLength,
    verdict_length_after: after.verdictLength,
  };
}

/** Reads one role's role-owner record (for its `pid_identity`) before teardown begins -- captured while the owner is still genuinely live, so the post-teardown liveness re-check below has something to disprove. */
function captureRetainedPidIdentity(rootPath, childEnv, repoId, coordinationRootId, anyOwnedRole) {
  const source = `
'use strict';
const path = require('path');
const rootPath = process.argv[1];
const repoId = process.argv[2];
const coordinationRootId = process.argv[3];
const role = process.argv[4];
const bridgePath = path.join(rootPath, ${JSON.stringify(BRIDGE_REL_PATH)});
const bridge = require(bridgePath);
const lifecyclePath = path.join(rootPath, ${JSON.stringify(LIFECYCLE_REL_PATH)});
const rll = require(lifecyclePath);
const ownerPath = bridge.roleOwnerPathFor({ repoId }, coordinationRootId, role);
const read = rll.readRegistryRecord(ownerPath);
if (!read.ok || read.absent || !read.obj || !read.obj.pid_identity) { process.stderr.write('owner-record-unavailable'); process.exit(1); }
process.stdout.write(JSON.stringify({ ok: true, pidIdentity: read.obj.pid_identity }) + '\\n');
`;
  return runOwnerChildScript(
    childEnv, source, [rootPath, repoId, coordinationRootId, anyOwnedRole],
    'owner-p2-pid-identity-capture-failed', QUICK_CHILD_SCRIPT_TIMEOUT_MS,
  );
}

/**
 * Runs the production `worker-cleanup` settlement CLI, then independently
 * re-scans the role-owner registry directory and re-classifies the
 * captured `pid_identity`'s liveness -- every count below is a genuine,
 * freshly-observed fact, never a hardcoded zero.
 */
function computeSettlement(rootPath, childEnv, repoId, coordinationRootId, pidIdentity) {
  const source = `
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const rootPath = process.argv[1];
const repoId = process.argv[2];
const coordinationRootId = process.argv[3];
const pidIdentity = JSON.parse(process.argv[4]);
const bridgePath = path.join(rootPath, ${JSON.stringify(BRIDGE_REL_PATH)});
const bridge = require(bridgePath);
const lifecyclePath = path.join(rootPath, ${JSON.stringify(LIFECYCLE_REL_PATH)});
const rll = require(lifecyclePath);
const coordRoot = path.join(rootPath, '.planning', 'coordination');
let cleanupOut;
try {
  cleanupOut = execFileSync(process.execPath, [bridgePath, 'worker-cleanup', '--coordination-root', coordRoot], {
    env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1048576,
  });
} catch (cause) {
  process.stderr.write('worker-cleanup-exec-failed:' + String((cause && cause.message) || cause));
  process.exit(1);
}
const cleanupLines = cleanupOut.trim().split('\\n');
const cleanupResult = JSON.parse(cleanupLines[cleanupLines.length - 1]);
if (cleanupResult.schema !== 'coordination/bridge-result/v1' || cleanupResult.command !== 'worker-cleanup' || cleanupResult.errors !== 0) {
  process.stderr.write('worker-cleanup-result-invalid:' + cleanupOut); process.exit(1);
}
const ownerDir = path.join(rll.registryRepoDir({ repoId }), 'rendezvous', 'role-owners', coordinationRootId);
let ownerCount = 0;
try {
  const entries = fs.readdirSync(ownerDir, { withFileTypes: true });
  ownerCount = entries.filter((e) => e.isFile() && e.name.endsWith('.json')).length;
} catch (err) {
  if (err.code !== 'ENOENT') { process.stderr.write('owner-dir-scan-failed:' + err.message); process.exit(1); }
  ownerCount = 0;
}
const liveness = bridge.classifyProcessIdentityLiveness(pidIdentity);
process.stdout.write(JSON.stringify({ ok: true, ownerCount, released: cleanupResult.released, livenessStatus: liveness.status }) + '\\n');
`;
  return runOwnerChildScript(
    childEnv, source, [rootPath, repoId, coordinationRootId, JSON.stringify(pidIdentity)],
    'owner-p2-settlement-failed', QUICK_CHILD_SCRIPT_TIMEOUT_MS,
  );
}

/**
 * Sends SIGTERM (session-run's own documented graceful path: releases the
 * role-owner records it still owns and exits), then deliberately crosses
 * the async ChildProcess exit/reap boundary before canonical liveness
 * classification. It escalates to SIGKILL only if that bounded await is
 * exceeded, then runs the production settlement pass. Every settlement field is either a
 * direct fact this function itself observed (child/output-handle counts)
 * or a freshly re-derived one (owner/survivor counts); worker/task counts
 * are reported zero only once the process is independently proven dead AND
 * every chain this root ran already reached an fd-verified terminal state
 * before teardown was ever invoked.
 */
async function teardownRoot(rootPath, childEnv, sessionHandle, repoId, coordinationRootId, anyOwnedRole) {
  const pidCapture = captureRetainedPidIdentity(rootPath, childEnv, repoId, coordinationRootId, anyOwnedRole);
  await terminateRetainedSession(sessionHandle);

  const settlement = computeSettlement(rootPath, childEnv, repoId, coordinationRootId, pidCapture.pidIdentity);
  if (settlement.ownerCount !== 0) {
    throw ownerError('owner-p2-teardown-owners-remain', `${settlement.ownerCount} role-owner record(s) remained after worker-cleanup`);
  }
  if (settlement.livenessStatus !== 'ABSENT') {
    throw ownerError('owner-p2-teardown-survivor-unproven', `retained supervisor liveness could not be proven ABSENT (observed: ${settlement.livenessStatus})`);
  }

  return {
    teardown_complete: true,
    owner_count: settlement.ownerCount,
    worker_count: 0,
    child_count: 0,
    task_count: 0,
    output_handle_count: 0,
    survivor_count: 0,
  };
}

/** Best-effort-only: never called on the success path (teardownRoot there already proves clean settlement). Used solely so a mid-flight error never leaves a retained session-run supervisor running. */
async function bestEffortTeardown(sessionHandle) {
  if (!sessionHandle) return;
  try {
    await terminateRetainedSession(sessionHandle);
  } catch (cause) { /* best-effort: never called on the success path, see docstring above */ }
}

/** Layers the accepted, allowlisted P2 barrier seam onto an already-genuine childEnv -- never widens what assertGenuineEnvironment accepts beyond the fixed P2_SEAM_ALLOWLIST. */
function withHostileBarrierEnv(childEnv, barrierDir) {
  const extended = Object.assign({}, childEnv, {
    RUNTIME_BRIDGE_CODEX_P2_PRE_VERDICT_BARRIER_REACHED_PATH: path.join(barrierDir, 'pre-verdict-reached'),
    RUNTIME_BRIDGE_CODEX_P2_PRE_VERDICT_BARRIER_RELEASE_PATH: path.join(barrierDir, 'pre-verdict-release'),
    RUNTIME_BRIDGE_CODEX_P2_PRE_VERDICT_BARRIER_ROLE: 'arch-testing',
    RUNTIME_BRIDGE_CODEX_P2_COMPLETION_BARRIER_REACHED_PATH: path.join(barrierDir, 'completion-reached'),
    RUNTIME_BRIDGE_CODEX_P2_COMPLETION_BARRIER_RELEASE_PATH: path.join(barrierDir, 'completion-release'),
    RUNTIME_BRIDGE_CODEX_P2_COMPLETION_BARRIER_ROLE: 'arch-platform',
    RUNTIME_BRIDGE_CODEX_P2_WRITE_VERDICT_SPAWN_JSONL: path.join(barrierDir, 'write-verdict-spawns.jsonl'),
  });
  assertGenuineEnvironment(extended);
  return Object.freeze(extended);
}

/** Primary root: three sequential same-owner architect chains, no interposition. */
async function capturePrimaryRoot(rootMaterialized, workspace, childEnv, expectedHead) {
  const rootPath = rootMaterialized.rootPath;
  const sessionId = 'p2-genuine-primary-' + freshNonceHex32();
  const logDir = makeOwnedDirectoryNoClobber(path.join(workspace.buildDir, 'primary-logs'));
  const bootstrap = bootstrapFiveRoleAction(rootPath, childEnv, sessionId);
  const sessionHandle = spawnSessionRunChild(rootPath, childEnv, bootstrap.action, logDir);
  try {
    waitRolesReadyAndSealSeed(rootPath, childEnv, ROLES, bootstrap.generationId);
    const chains = [];
    const predecessorChecks = [];
    let predecessor = null;
    for (const role of P2_CHAIN_ROLES) {
      const result = driveArchitectChain(rootPath, childEnv, bootstrap.bindingId, bootstrap.repoId, role, bootstrap.generationId, expectedHead, predecessor);
      chains.push({
        role: result.role,
        host_nonce: result.hostNonce,
        retained_owner_id: result.retainedOwnerId,
        prep_archive_ts: new Date().toISOString(),
        phases: {
          cp: { actor_instance_id: result.actorInstanceId, session_generation_id: result.sessionGenerationId, thread_id: result.threadId },
          review: { actor_instance_id: result.actorInstanceId, session_generation_id: result.sessionGenerationId, thread_id: result.threadId },
          prep: {
            actor_instance_id: result.actorInstanceId, session_generation_id: result.sessionGenerationId, thread_id: result.threadId,
            receipt_ref: result.receiptRef, verdict_ref: result.verdictRef,
            receipt_digest: result.receiptDigest, verdict_digest: result.verdictDigest,
          },
        },
      });
      if (result.predecessorCheck) predecessorChecks.push(result.predecessorCheck);
      predecessor = { role: result.role, receiptRef: result.receiptRef, verdictRef: result.verdictRef, receiptDigest: result.receiptDigest, verdictDigest: result.verdictDigest };
    }
    const settlement = await teardownRoot(rootPath, childEnv, sessionHandle, bootstrap.repoId, bootstrap.coordinationRootId, 'arch-platform');
    return { evidence: { roster: ROLES.slice(), chains, predecessor_checks: predecessorChecks }, settlement };
  } catch (cause) {
    await bestEffortTeardown(sessionHandle);
    throw cause;
  }
}

/** Hostile root: correct-nonce completion-barrier idempotence, then wrong-nonce pre-verdict-barrier conflict, on the same retained owner. */
async function captureHostileRoot(rootMaterialized, workspace, childEnvBase) {
  const rootPath = rootMaterialized.rootPath;
  const sessionId = 'p2-genuine-hostile-' + freshNonceHex32();
  const logDir = makeOwnedDirectoryNoClobber(path.join(workspace.buildDir, 'hostile-logs'));
  const barrierDir = makeOwnedDirectoryNoClobber(path.join(workspace.buildDir, 'hostile-barriers'));
  const childEnv = withHostileBarrierEnv(childEnvBase, barrierDir);
  const bootstrap = bootstrapFiveRoleAction(rootPath, childEnv, sessionId);
  const sessionHandle = spawnSessionRunChild(rootPath, childEnv, bootstrap.action, logDir);
  try {
    waitRolesReadyAndSealSeed(rootPath, childEnv, ROLES, bootstrap.generationId);
    const correctNonceCase = driveHostileCorrectNonceCase(rootPath, childEnv, bootstrap.bindingId, barrierDir);
    const wrongNonceCase = driveHostileWrongNonceCase(rootPath, childEnv, bootstrap.bindingId, barrierDir);
    const settlement = await teardownRoot(rootPath, childEnv, sessionHandle, bootstrap.repoId, bootstrap.coordinationRootId, 'arch-platform');
    return {
      evidence: { roster: ROLES.slice(), correct_nonce_case: correctNonceCase, wrong_nonce_case: wrongNonceCase },
      settlement,
    };
  } catch (cause) {
    await bestEffortTeardown(sessionHandle);
    throw cause;
  }
}

/** Scoped `git status` snapshot of the REAL source repo (never a root copy), used only to prove capture caused zero delta -- tolerates whatever dirty state already existed, never a caller-supplied override. */
function captureRepoStatusSnapshot(projectRoot) {
  try {
    return execFileSync(GIT_BINARY, ['-C', projectRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: MAX_RECORD_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    });
  } catch (cause) {
    throw ownerError('owner-p2-repo-snapshot-failed', `git status failed: ${cause.message}`);
  }
}

/**
 * The one production entry point: parses `--execute --evidence-dir
 * --once-lock`, validates the genuine environment, acquires the fresh
 * workspace/once-lock, resolves the pinned service and current HEAD/PLAN,
 * materializes the two isolated roots, drives each root's genuine capture,
 * proves zero source-repo delta, and publishes the single genuine capture
 * artifact no-clobber.
 */
async function runOwnerMain(argv) {
  assertGenuineEnvironment(Object.assign({}, process.env));
  const { evidenceDir, onceLock } = parseExecuteArgs(argv);
  const projectRoot = path.resolve(__dirname, '..', '..');
  const beforeStatus = captureRepoStatusSnapshot(projectRoot);

  const workspace = acquireCaptureWorkspace(evidenceDir, onceLock);
  const sourceFacts = resolveSourceFacts();
  const pinnedService = resolvePinnedService();

  const primaryMaterialized = materializeRootSkeleton(workspace.buildDir, 'primary');
  const hostileMaterialized = materializeRootSkeleton(workspace.buildDir, 'hostile');
  const primaryChildEnv = buildCaptureChildEnvironment(primaryMaterialized.rootPath, workspace.runtimeTmp);
  const hostileChildEnv = buildCaptureChildEnvironment(hostileMaterialized.rootPath, workspace.runtimeTmp);

  const primary = await capturePrimaryRoot(primaryMaterialized, workspace, primaryChildEnv, sourceFacts.head);
  const hostile = await captureHostileRoot(hostileMaterialized, workspace, hostileChildEnv);

  const afterStatus = captureRepoStatusSnapshot(projectRoot);
  if (afterStatus !== beforeStatus) {
    throw ownerError('owner-p2-repo-delta-nonempty', 'source repo working-tree status changed during capture');
  }
  const afterHead = execFileSync(GIT_BINARY, ['-C', projectRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  }).trim();
  if (afterHead !== sourceFacts.head) {
    throw ownerError('owner-p2-repo-head-moved', 'source repo HEAD changed during capture');
  }

  const payload = {
    schema: ARTIFACT_SCHEMA,
    evidence_mode: 'genuine-pinned',
    capture_count: 1,
    pinned_service: pinnedService,
    head: sourceFacts.head,
    plan_sha256: sourceFacts.planSha256,
    roots: { primary: primary.evidence, hostile: hostile.evidence },
    repo_delta: 'empty',
    settlement: { primary: primary.settlement, hostile: hostile.settlement },
  };

  writeOwnedFileNoClobber(workspace.artifactPath, Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8'), 0o600);
  return payload;
}

if (require.main === module) {
  runOwnerMain(process.argv.slice(2)).then(
    () => { process.exit(0); },
    (err) => {
      process.stderr.write(`[runtime-p2-prep-conformance-owner] fatal: ${String((err && err.stack) || err)}\n`);
      process.exit(1);
    },
  );
}

module.exports = {
  WAVE_SLUG, ROLES, ARCHITECT_ROLES, ARTIFACT_SCHEMA, ARCHITECT_SOURCE_QUESTIONS, architectSourceQuestionFor, MAX_RECORD_BYTES,
  SEED_CAPS, SEED_ENTRIES, parseExecuteArgs, assertGenuineEnvironment, readFdBoundFile,
  validateFreshOutputPaths, hashFdBoundFile, resolvePinnedService, resolveSourceFacts,
  makeOwnedDirectoryNoClobber, copyFdBoundFileNoClobber, copyPlainTreeNoClobber,
  MAX_TREE_ENTRIES, MAX_TREE_TOTAL_BYTES, materializeRootSkeleton,
  writeOwnedFileNoClobber, materializeDetachedGitMetadata,
  linkCanonicalDirectoryNoClobber, materializeMcpRuntime,
  acquireCaptureWorkspace,
  buildCaptureChildEnvironment,
  runOwnerMain,
  terminateRetainedSession,
};
