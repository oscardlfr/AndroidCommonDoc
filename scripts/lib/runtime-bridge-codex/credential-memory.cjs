'use strict';

function createCredentialMemory({
  crypto,
}) {
  // ── SecretMatcher (PLAN.md ~L1130) ──────────────────────────────────────────

  /**
   * `createSecretMatcher()` -- no constructor dependencies. `register(value,kind)`
   * tracks a raw secret value (`kind` is stored for future forensic/audit use,
   * never used to filter scanning). `scanBytes(buffer)` checks the buffer
   * against every registered value across 8 transforms (raw, JSON-escaped,
   * URL-percent, base64, base64url, hex, SHA-256-hex, SHA-256-base64),
   * generated on demand inside this call's own try/finally and discarded
   * before returning -- no transform state is ever persisted between calls
   * (PLAN.md ~L1130).
   * @returns {{register: function(string, string=): void, scanBytes: function(Buffer): ({ok:true,clean:boolean}|{ok:false,reason:string})}}
   */
  // Block 3's teardown (createRunAuthorities, below) reads/clears a matcher's
  // registered values via this module-private WeakMap, mirroring
  // captureRegistryInternals -- never a public method on the matcher itself.
  const secretMatcherInternals = new WeakMap();

  function createSecretMatcher() {
    const registeredValues = []; // [{value, kind}] -- raw values only; the 8 transforms are always regenerated on demand, never cached here.

    function register(value, kind) {
      if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError('SecretMatcher.register requires a non-empty string value');
      }
      registeredValues.push({ value, kind: typeof kind === 'string' ? kind : 'unknown' });
    }

    function transformsForSecret(secret) {
      const buf = Buffer.from(secret, 'utf8');
      return [
        secret,
        JSON.stringify(secret),
        encodeURIComponent(secret),
        buf.toString('base64'),
        buf.toString('base64url'),
        buf.toString('hex'),
        crypto.createHash('sha256').update(buf).digest('hex'),
        crypto.createHash('sha256').update(buf).digest('base64'),
      ];
    }

    function scanBytes(buffer) {
      if (!Buffer.isBuffer(buffer)) {
        return { ok: false, reason: 'SECRET_MATCHER_INVALID_BUFFER' };
      }
      let transformSets = null;
      try {
        transformSets = registeredValues.map((entry) => transformsForSecret(entry.value));
        for (const set of transformSets) {
          for (const needle of set) {
            // Buffer#indexOf searches raw bytes directly (never decodes the
            // whole haystack to a JS string first) -- safe against arbitrary,
            // possibly-non-UTF8 captured child-process bytes.
            if (needle.length > 0 && buffer.indexOf(needle, 0, 'utf8') !== -1) {
              return { ok: true, clean: false };
            }
          }
        }
        return { ok: true, clean: true };
      } finally {
        // Zero the on-demand transform state before returning (PLAN.md ~L1130:
        // "generated on demand inside scanBytes's own try/finally and zeroed
        // before return -- no separate persisted transform state exists").
        if (transformSets) { for (const set of transformSets) set.length = 0; }
        transformSets = null;
      }
    }

    const matcher = { register, scanBytes };
    secretMatcherInternals.set(matcher, registeredValues);
    return matcher;
  }

  // ── CaptureRegistry (PLAN.md ~L1130) ────────────────────────────────────────

  // CheckpointAuthority (Block 2, below) reads a registry's captured entries
  // AND its hasOverflowed flag via this module-private WeakMap, never via a
  // public method -- PLAN.md ~L1130 is explicit that `allEntries()` is "not
  // exported on any public or semi-public surface", and this file's own
  // module.exports never references this map, so it is unreachable from
  // outside this module.
  const captureRegistryInternals = new WeakMap();

  const CAPTURE_REGISTRY_ENTRY_CAP = 4096;
  const CAPTURE_REGISTRY_PER_ENTRY_CAP_BYTES = 1024 * 1024; // 1 MiB
  const CAPTURE_REGISTRY_TOTAL_CAP_BYTES = 50 * 1024 * 1024; // 50 MiB

  /**
   * `createCaptureRegistry()` -- no constructor dependencies. `register(buffer)`
   * is copy-on-register (never aliases the caller's buffer), strictly
   * append-ordered, capped at 4096 entries / 1 MiB per entry / 50 MiB total,
   * fail-closed on overflow (never silent eviction), retained for the run's
   * entire lifetime. The returned object's own-enumerable surface is EXACTLY
   * `{register}` (PLAN.md ~L1130).
   * @returns {{register: function(Buffer): ({ok:true}|{ok:false,reason:'CAPTURE_REGISTRY_FULL'})}}
   */
  function createCaptureRegistry() {
    const state = { entries: [], totalBytes: 0, hasOverflowed: false };

    function register(buffer) {
      if (!Buffer.isBuffer(buffer)) {
        throw new TypeError('CaptureRegistry.register requires a Buffer');
      }
      if (state.entries.length >= CAPTURE_REGISTRY_ENTRY_CAP) { state.hasOverflowed = true; return { ok: false, reason: 'CAPTURE_REGISTRY_FULL' }; }
      if (buffer.length > CAPTURE_REGISTRY_PER_ENTRY_CAP_BYTES) { state.hasOverflowed = true; return { ok: false, reason: 'CAPTURE_REGISTRY_FULL' }; }
      if (state.totalBytes + buffer.length > CAPTURE_REGISTRY_TOTAL_CAP_BYTES) { state.hasOverflowed = true; return { ok: false, reason: 'CAPTURE_REGISTRY_FULL' }; }
      state.entries.push(Buffer.from(buffer)); // copy-on-register: never alias the caller's own buffer.
      state.totalBytes += buffer.length;
      return { ok: true };
    }

    const registry = { register };
    captureRegistryInternals.set(registry, state);
    return registry;
  }


  function clearSecretMatcherInternal(secretMatcher) {
    const values = secretMatcherInternals.get(secretMatcher);
    if (values) values.length = 0;
  }
  function isSecretMatcherEmpty(secretMatcher) {
    const values = secretMatcherInternals.get(secretMatcher);
    return !values || values.length === 0;
  }

  /** Block 3's teardown reads/clears a registry's entries via the module-private captureRegistryInternals WeakMap (Block 1's own CaptureRegistry never exposes this publicly). */
  function clearCaptureRegistryInternal(captureRegistry) {
    const internals = captureRegistryInternals.get(captureRegistry);
    if (internals) {
      internals.entries.length = 0;
      internals.totalBytes = 0;
      internals.hasOverflowed = false; // a full teardown is a clean slate -- a run that reaches this point was never poisoned (evidenceInvalid would have blocked it), so this cannot mask a real overflow.
    }
  }
  function isCaptureRegistryEmpty(captureRegistry) {
    const internals = captureRegistryInternals.get(captureRegistry);
    return !internals || (internals.entries.length === 0 && internals.totalBytes === 0);
  }

  /**
   * Raw tail of whatever a capture registry has collected, for a diagnostic signal. Reads the same
   * module-private WeakMap the two accessors above use. The TAIL is what matters: a process that
   * dies during startup says why in its last line, not its first. Shaping and redaction belong to
   * the describer that renders this, not here -- which is why the window kept here is deliberately
   * far larger than anything that will be rendered: truncating first and redacting afterwards could
   * split a secret into fragments too short for the describer to recognize.
   * @param {object} captureRegistry
   * @param {number} maxChars
   * @returns {string} '' when nothing was captured.
   */
  function captureRegistryTailText(captureRegistry, maxChars) {
    const internals = captureRegistryInternals.get(captureRegistry);
    if (!internals || internals.entries.length === 0) return '';
    const limit = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 65536;
    const text = Buffer.concat(internals.entries).toString('utf8');
    return text.length <= limit ? text : text.slice(text.length - limit);
  }

  /** Immutable copies used by the checkpoint authority; never exposes either WeakMap. */
  function captureRegistrySnapshot(captureRegistry) {
    const state = captureRegistryInternals.get(captureRegistry);
    if (!state) return null;
    return Object.freeze({
      entries: Object.freeze(state.entries.map((entry) => Buffer.from(entry))),
      totalBytes: state.totalBytes,
      hasOverflowed: state.hasOverflowed,
    });
  }

  function captureRegistryOverflowed(captureRegistry) {
    const state = captureRegistryInternals.get(captureRegistry);
    return !!(state && state.hasOverflowed);
  }

  // CONCURRENCY-FLAKINESS FIX: isTeardownFaultActive(phase) moved from a
  // module-level process.env-reading function into a per-run closure inside
  // createRunAuthorities itself (see testFaultInjection there) -- the
  // process-wide global was visible across concurrently-running, unrelated
  // runs in the same test process. isToctouSwapFaultActive below is
  // confirmed (test-specialist, both of its 2 usages traced) to have zero
  // await between set/clear, so it carries none of that risk and is left
  // exactly as-is -- not migrated speculatively.

  // CORRECTION ROUND Section D: same isXxxFaultActive(phase) convention as
  // every other seam in this file. Phases: 'retirement-pre-unlink',
  // 'cleanup-pre-rename' -- lets a test deterministically construct a
  // same-bytes/same-content-different-inode substitution in the narrow window
  // immediately before the pre-mutation fd-bound re-check, which cannot
  // otherwise be constructed from outside a single synchronous function call
  // without a real concurrent OS process.
  // C3-CLEANUP-E10: 'cleanup-post-rename' added -- same technique, but AFTER
  // the rename+fsync barrier succeeds and BEFORE the post-rename identity
  // re-check, proving inodeMatches (below) catches a POST-rename swap and not
  // only the pre-rename one the other two phases exercise.

  return Object.freeze({ createSecretMatcher, createCaptureRegistry, clearSecretMatcherInternal, isSecretMatcherEmpty, clearCaptureRegistryInternal, isCaptureRegistryEmpty, captureRegistryTailText, captureRegistrySnapshot, captureRegistryOverflowed });
}

module.exports = Object.freeze({ createCredentialMemory });
