'use strict';

// Runs the isolated P2 PREP verdict child (a fresh arch-platform/-testing/-integration review), its test-only pre/post-write barriers, and reads back its landed verdict.

function createP2PrepVerdict({
  CANONICAL_ROLES,
  canonicalJSONStringify,
  fs,
  isP2ConformanceTimingCapability,
  isSafeProjectionRelativePath,
  path,
  readFdBoundProjectionSource,
  rll,
  sha256String,
  spawnSync,
}) {
function p2PrepVerdictRefFor(waveSlug, role) {
  if (typeof waveSlug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(waveSlug)) {
    throw new Error('p2-prep-verdict-wave-slug-invalid');
  }
  if (!['arch-platform', 'arch-testing', 'arch-integration'].includes(role)) {
    throw new Error('p2-prep-verdict-role-invalid');
  }
  const verdictRef = '.planning/wave-' + waveSlug + '/arch-' + role.slice('arch-'.length) + '-verdict.md';
  if (!isSafeProjectionRelativePath(verdictRef) || !verdictRef.endsWith('.md')) {
    throw new Error('p2-prep-verdict-ref-invalid');
  }
  return verdictRef;
}

function runP2TestPreVerdictBarrier(role) {
  const reachedInput = process.env.RUNTIME_BRIDGE_CODEX_P2_PRE_VERDICT_BARRIER_REACHED_PATH;
  const releaseInput = process.env.RUNTIME_BRIDGE_CODEX_P2_PRE_VERDICT_BARRIER_RELEASE_PATH;
  const roleInput = process.env.RUNTIME_BRIDGE_CODEX_P2_PRE_VERDICT_BARRIER_ROLE;
  if (reachedInput === undefined && releaseInput === undefined && roleInput === undefined) return;
  if (!isP2ConformanceTimingCapability()) return;
  if (!CANONICAL_ROLES.includes(role)) throw new Error('p2-test-pre-verdict-barrier-role-invalid');
  if (roleInput !== undefined) {
    if (!CANONICAL_ROLES.includes(roleInput)) {
      throw new Error('p2-test-pre-verdict-barrier-role-filter-invalid');
    }
    if (roleInput !== role) return;
  }
  if (
    typeof reachedInput !== 'string' || reachedInput.length === 0 || !path.isAbsolute(reachedInput)
    || typeof releaseInput !== 'string' || releaseInput.length === 0 || !path.isAbsolute(releaseInput)
  ) throw new Error('p2-test-pre-verdict-barrier-config-invalid');
  let parentReal;
  try {
    const reachedParent = fs.realpathSync(path.dirname(reachedInput));
    const releaseParent = fs.realpathSync(path.dirname(releaseInput));
    if (reachedParent !== releaseParent) throw new Error('parent-mismatch');
    parentReal = reachedParent;
    const parentStat = fs.lstatSync(parentReal);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('parent-invalid');
    if (typeof process.getuid === 'function' && parentStat.uid !== process.getuid()) {
      throw new Error('parent-owner-invalid');
    }
  } catch (err) {
    throw new Error('p2-test-pre-verdict-barrier-parent-invalid');
  }
  const resolveLeaf = (input) => {
    const leaf = path.basename(input);
    if (leaf.length === 0 || leaf === '.' || leaf === '..') {
      throw new Error('p2-test-pre-verdict-barrier-leaf-invalid');
    }
    return path.join(parentReal, leaf);
  };
  const reachedPath = resolveLeaf(reachedInput);
  const releasePath = resolveLeaf(releaseInput);
  if (reachedPath === releasePath) throw new Error('p2-test-pre-verdict-barrier-path-collision');
  try {
    fs.lstatSync(releasePath);
    throw new Error('release-preexisting');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw new Error('p2-test-pre-verdict-barrier-release-preexisting');
  }
  try {
    fs.writeFileSync(reachedPath, 'reached\n', { flag: 'wx', mode: 0o600 });
  } catch (err) {
    throw new Error('p2-test-pre-verdict-barrier-publish-failed');
  }
  const deadlineMs = Date.now() + 15000;
  while (Date.now() < deadlineMs) {
    try {
      const st = fs.lstatSync(releasePath);
      if (st.isSymbolicLink() || !st.isFile()) throw new Error('p2-test-pre-verdict-barrier-release-invalid');
      if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
        throw new Error('p2-test-pre-verdict-barrier-release-owner-invalid');
      }
      return;
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  throw new Error('p2-test-pre-verdict-barrier-timeout');
}

function runP2TestPostWriteVerdictHooks(argv, role) {
  const reachedInput = process.env.RUNTIME_BRIDGE_CODEX_P2_COMPLETION_BARRIER_REACHED_PATH;
  const releaseInput = process.env.RUNTIME_BRIDGE_CODEX_P2_COMPLETION_BARRIER_RELEASE_PATH;
  const observationInput = process.env.RUNTIME_BRIDGE_CODEX_P2_WRITE_VERDICT_SPAWN_JSONL;
  const roleInput = process.env.RUNTIME_BRIDGE_CODEX_P2_COMPLETION_BARRIER_ROLE;
  if (reachedInput === undefined && releaseInput === undefined && observationInput === undefined && roleInput === undefined) return;
  if (!isP2ConformanceTimingCapability()) return;
  if (!CANONICAL_ROLES.includes(role)) throw new Error('p2-test-completion-hooks-role-invalid');
  if (roleInput !== undefined) {
    if (!CANONICAL_ROLES.includes(roleInput)) {
      throw new Error('p2-test-completion-hooks-role-filter-invalid');
    }
    if (roleInput !== role) return;
  }
  if (
    typeof reachedInput !== 'string' || reachedInput.length === 0 || !path.isAbsolute(reachedInput)
    || typeof releaseInput !== 'string' || releaseInput.length === 0 || !path.isAbsolute(releaseInput)
    || typeof observationInput !== 'string' || observationInput.length === 0 || !path.isAbsolute(observationInput)
    || !Array.isArray(argv) || argv.length === 0 || argv.some((value) => typeof value !== 'string')
  ) throw new Error('p2-test-completion-hooks-config-invalid');
  let parentReal;
  try {
    const parents = [reachedInput, releaseInput, observationInput]
      .map((value) => fs.realpathSync(path.dirname(value)));
    if (!parents.every((value) => value === parents[0])) {
      throw new Error('parent-mismatch');
    }
    parentReal = parents[0];
    const parentStat = fs.lstatSync(parentReal);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('parent-invalid');
    if (typeof process.getuid === 'function' && parentStat.uid !== process.getuid()) {
      throw new Error('parent-owner-invalid');
    }
  } catch (err) {
    throw new Error('p2-test-completion-hooks-parent-invalid');
  }
  const resolveLeaf = (input) => {
    const leaf = path.basename(input);
    if (leaf.length === 0 || leaf === '.' || leaf === '..') {
      throw new Error('p2-test-completion-hooks-leaf-invalid');
    }
    return path.join(parentReal, leaf);
  };
  const reachedPath = resolveLeaf(reachedInput);
  const releasePath = resolveLeaf(releaseInput);
  const observationPath = resolveLeaf(observationInput);
  if (new Set([reachedPath, releasePath, observationPath]).size !== 3) {
    throw new Error('p2-test-completion-hooks-path-collision');
  }
  try {
    fs.lstatSync(releasePath);
    throw new Error('release-preexisting');
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw new Error('p2-test-completion-hooks-release-preexisting');
  }
  const observation = {
    schema: 'runtime/p2-write-verdict-spawn-observation/v1',
    sequence: 1,
    argv_digest: sha256String(canonicalJSONStringify(argv)),
  };
  try {
    fs.writeFileSync(
      observationPath, canonicalJSONStringify(observation) + '\n',
      { flag: 'ax', mode: 0o600 },
    );
    fs.writeFileSync(reachedPath, 'reached\n', { flag: 'wx', mode: 0o600 });
  } catch (err) {
    throw new Error('p2-test-completion-hooks-publish-failed');
  }
  const deadlineMs = Date.now() + 15000;
  while (Date.now() < deadlineMs) {
    try {
      const st = fs.lstatSync(releasePath);
      if (st.isSymbolicLink() || !st.isFile()) {
        throw new Error('p2-test-completion-hooks-release-invalid');
      }
      if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
        throw new Error('p2-test-completion-hooks-release-owner-invalid');
      }
      return;
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    } catch (err) {
      throw new Error('p2-test-completion-hooks-wait-failed');
    }
  }
  throw new Error('p2-test-completion-hooks-timeout');
}

function runAndReadPrepVerdict(worker, intent, options) {
  if (!worker || typeof worker.projectRoot !== 'string' || !path.isAbsolute(worker.projectRoot)) {
    throw new Error('p2-prep-worker-root-invalid');
  }
  if (!intent || typeof intent.wave_slug !== 'string' || typeof intent.role !== 'string'
      || typeof intent.publication_nonce !== 'string') {
    throw new Error('p2-prep-intent-invalid');
  }
  if (options !== undefined && (
    options === null || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).length !== 1 || typeof options.allowSpawn !== 'boolean'
  )) throw new Error('p2-prep-verdict-options-invalid');
  const allowSpawn = options === undefined ? true : options.allowSpawn;
  const verdictRef = p2PrepVerdictRefFor(intent.wave_slug, intent.role);
  const verdictPath = path.resolve(worker.projectRoot, verdictRef);
  const relative = path.relative(worker.projectRoot, verdictPath);
  if (relative === '' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('p2-prep-verdict-path-escape');
  }

  let absent = false;
  try {
    fs.lstatSync(verdictPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') absent = true;
    else throw new Error('p2-prep-verdict-precheck-failed');
  }

  if (absent && !allowSpawn) {
    return { ok: false, reason: 'verdict-absent', verdictRef, verdictPath };
  }
  if (absent) {
    // Sequence 15 extraction moved this module one directory deeper than the
    // pre-extraction monolith (scripts/lib/ -> scripts/lib/runtime-bridge-codex/).
    const scriptPath = path.resolve(__dirname, '..', '..', 'sh', 'write-verdict.sh');
    const childArgv = [
      scriptPath,
      '--role', intent.role,
      '--phase', 'prep',
      '--slug', intent.wave_slug,
      '--publication-nonce', intent.publication_nonce,
    ];
    const child = spawnSync('bash', childArgv, {
      cwd: worker.projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      encoding: 'utf8',
      timeout: 15000,
      killSignal: 'SIGKILL',
      maxBuffer: 65536,
    });
    if (child.error) throw new Error('p2-prep-write-verdict-spawn-failed');
    if (child.signal) throw new Error('p2-prep-write-verdict-signaled');
    if (child.status !== 0) throw new Error('p2-prep-write-verdict-nonzero');
    runP2TestPostWriteVerdictHooks(['bash', ...childArgv], worker.role);
  }

  let source;
  try {
    source = readFdBoundProjectionSource(verdictPath, 65536);
  } catch (err) {
    return { ok: false, reason: 'verdict-read-failed', verdictRef, verdictPath };
  }
  const grammar = rll.validatePrepPublicationGrammar(source.bytes, intent);
  return {
    ok: grammar.ok,
    reason: grammar.ok ? null : (grammar.reason || 'grammar-invalid'),
    verdictRef,
    verdictPath,
    bytes: source.bytes,
    digest: source.digest,
    grammar,
  };
}

  return Object.freeze({
    p2PrepVerdictRefFor,
    runAndReadPrepVerdict,
    runP2TestPostWriteVerdictHooks,
    runP2TestPreVerdictBarrier,
  });
}

module.exports = Object.freeze({ createP2PrepVerdict });
