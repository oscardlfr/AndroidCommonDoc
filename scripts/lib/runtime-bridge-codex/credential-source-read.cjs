'use strict';

function createCredentialSourceRead({
  fs,
  path,
  windowsPrivateDirectoryAcl,
  windowsAclSnapshotsEqual,
  hasExactKeys,
}) {
  // ── CredentialSourceProvider/v1 (PLAN.md ~L1128) ────────────────────────────

  const CREDENTIAL_SOURCE_MAX_BYTES = 64 * 1024; // 64 KiB -- generous for any real credential blob, comfortably under the oversized-fixture test's 8 MiB probe.
  // hasExactKeys requires its second argument PRE-SORTED (it sorts only the
  // actual object's own keys, not the expected list) -- alphabetical order.
  const CREDENTIAL_SOURCE_ALLOWED_KEYS_SORTED = Object.freeze(['credentials', 'expiresAt', 'otherCredentialFields', 'sourceIdentity']);

  /**
   * Minimal, dependency-free JSON duplicate-key detector: walks `text`
   * tracking string-literal escaping and a STACK of per-object "keys already
   * seen" Sets, pushed on `{` (a `null` marker on `[`, since arrays have no
   * keys) and popped on the matching close. A key is checked against the Set
   * at the TOP of the stack only -- the object it directly belongs to -- so a
   * key name legitimately reused between a parent and a nested child object is
   * never confused for a duplicate, but two occurrences of the SAME key
   * WITHIN THE SAME object are caught regardless of nesting depth (THIRD HARD
   * NO-GO RESPONSE Block D: extended from the prior top-level-only check,
   * which missed a duplicate inside e.g. the nested "credentials" object).
   * Used to catch what `JSON.parse` itself would otherwise silently resolve
   * via last-write-wins.
   * @returns {boolean} true if ANY object in `text` contains a duplicate key.
   */
  function hasDuplicateJsonKeyAnyDepth(text) {
    let i = 0;
    const len = text.length;
    const stack = []; // each entry: Set (an object's own keys-seen-so-far) or null (array -- no keys).
    let expectKey = false;
    while (i < len) {
      const ch = text[i];
      if (ch === '"') {
        const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
        const isKeyPosition = top !== undefined && top !== null && expectKey;
        i += 1;
        let raw = '"';
        while (i < len && text[i] !== '"') {
          if (text[i] === '\\' && i + 1 < len) { raw += text[i] + text[i + 1]; i += 2; continue; }
          raw += text[i]; i += 1;
        }
        raw += '"';
        i += 1; // closing quote
        if (isKeyPosition) {
          let keyName;
          try { keyName = JSON.parse(raw); } catch (err) { keyName = raw; } // malformed escape -- real JSON.parse(text) below will reject the document properly either way.
          if (top.has(keyName)) return true;
          top.add(keyName);
          expectKey = false;
        }
        continue;
      }
      if (ch === '{') { stack.push(new Set()); expectKey = true; i += 1; continue; }
      if (ch === '[') { stack.push(null); expectKey = false; i += 1; continue; }
      if (ch === '}' || ch === ']') { stack.pop(); i += 1; continue; }
      const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
      if (top !== undefined && top !== null && ch === ',') { expectKey = true; i += 1; continue; }
      if (top !== undefined && top !== null && ch === ':') { expectKey = false; i += 1; continue; }
      i += 1; // whitespace, array elements, or any other character not otherwise handled.
    }
    return false;
  }

  /**
   * Shared fd-bound read mechanics behind the FD-test CredentialSourceProvider
   * variant: `open(O_NOFOLLOW)` (never follows a symlinked credential path),
   * bounded read (rejects oversized/truncatable content outright rather than
   * silently truncating-and-parsing), and duplicate-top-level-key rejection
   * (never JSON.parse's silent last-write-wins).
   * @returns {{ok:true,credentials:object,otherCredentialFields:object,expiresAt:string,sourceIdentity:string}|{ok:false,reason:string}}
   */
  /**
   * Group A / C4 slice (2026-08-10): a second, standalone fd-bound, TOCTOU-safe
   * reader -- lstat(path) -> reject non-regular/symlink -> open(O_NOFOLLOW) ->
   * fstat(fd) -> require current real owner (uid match, POSIX-only), exact
   * mode 0600, nlink===1, and pre-open identity match -> bounded read through
   * that SAME fd -> post-read re-fstat requiring stable identity (dev/ino/
   * mode/nlink/size) -> strict (fatal) UTF-8 decode. The raw byte buffer is
   * zeroized in a finally block immediately after decoding, before this
   * function ever returns -- credential material must not linger in memory
   * beyond this frame. Returns the decoded text plus the pre-open lstat
   * snapshot so the caller can run its OWN final re-lstat check after
   * whatever shape-specific parsing it does (the one remaining risk window --
   * CPU-bound JSON parsing touches no fd and is caller-specific). Mirrors
   * readCredentialSourceFd's own established fd-bound TOCTOU sequence
   * (identical checks/reason-codes/order) but is deliberately its OWN,
   * separate function rather than a shared extraction: readCredentialSourceFd
   * is also directly exercised by pre-existing structural/source-scan tests
   * that require its owner/mode/nlink/re-fstat checks to remain literally
   * inline within ITS OWN function body, so factoring them out from under it
   * would regress those tests even though the resulting behavior would be
   * identical -- this function exists so createCredentialSourceProvider's real
   * ~/.codex/auth.json reader (below) can reuse the SAME hardening pattern
   * without disturbing readCredentialSourceFd's own body/tests.
   * @param {string} filePath
   * @param {number} maxBytes
   * @returns {{ok:true,text:string,initialLstat:object}|{ok:false,reason:string}}
   */
  function readOwnedStableBuffer(filePath, maxBytes) {
    let initialWindowsAcl;
    if (process.platform === 'win32') {
      initialWindowsAcl = windowsPrivateDirectoryAcl(path.dirname(filePath), { mode: 'validate' });
      if (!initialWindowsAcl || initialWindowsAcl.ok !== true) return { ok: false, reason: 'CREDENTIAL_SOURCE_DIR_INSECURE' };
    }
    let initialLstat;
    try {
      initialLstat = fs.lstatSync(filePath, { bigint: true });
    } catch (err) {
      return { ok: false, reason: 'CREDENTIAL_SOURCE_OPEN_FAILED' };
    }
    if (initialLstat.isSymbolicLink()) return { ok: false, reason: 'CREDENTIAL_SOURCE_SYMLINK_REJECTED' };

    let fd;
    try {
      fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ELOOP') return { ok: false, reason: 'CREDENTIAL_SOURCE_SYMLINK_REJECTED' };
      return { ok: false, reason: 'CREDENTIAL_SOURCE_OPEN_FAILED' };
    }
    let buf = null;
    try {
      const st = fs.fstatSync(fd, { bigint: true });
      if (!st.isFile()) return { ok: false, reason: 'CREDENTIAL_SOURCE_NOT_REGULAR_FILE' };
      // HARD NO-GO RESPONSE Block D: verify current owner, exact mode, and
      // nlink===1 BEFORE trusting any content -- a credential file owned by a
      // different user, world-writable, or hard-linked elsewhere is no longer
      // accepted identically to a genuinely safe one. process.getuid is POSIX-
      // only (absent on Windows); the owner check is skipped there rather than
      // thrown on, consistent with this fd-bound mechanism being a POSIX-first
      // hardening layer.
      if (typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_OWNER_MISMATCH' };
      }
      if (process.platform !== 'win32' && (st.mode & 0o777n) !== 0o600n) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_MODE_INVALID' };
      }
      if (st.nlink !== 1n) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_NLINK_INVALID' };
      }
      if (st.dev !== initialLstat.dev || st.ino !== initialLstat.ino) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_IDENTITY_MISMATCH' }; // swapped between the pre-open lstat and the fd's own fstat.
      }
      if (st.size > BigInt(maxBytes)) return { ok: false, reason: 'CREDENTIAL_SOURCE_OVERSIZED' };
      const size = Number(st.size);
      buf = Buffer.alloc(size);
      let offset = 0;
      while (offset < buf.length) {
        const bytesRead = fs.readSync(fd, buf, offset, buf.length - offset, null);
        if (bytesRead <= 0) break;
        offset += bytesRead;
      }
      if (offset !== size) return { ok: false, reason: 'CREDENTIAL_SOURCE_SHORT_READ' };

      const stAfter = fs.fstatSync(fd, { bigint: true });
      if (stAfter.dev !== st.dev || stAfter.ino !== st.ino || stAfter.mode !== st.mode || stAfter.nlink !== st.nlink || stAfter.size !== st.size) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_IDENTITY_MISMATCH' }; // changed identity/metadata DURING the read.
      }
      if (process.platform === 'win32') {
        const finalWindowsAcl = windowsPrivateDirectoryAcl(path.dirname(filePath), { mode: 'validate' });
        if (!finalWindowsAcl || finalWindowsAcl.ok !== true || !windowsAclSnapshotsEqual(initialWindowsAcl, finalWindowsAcl)) {
          return { ok: false, reason: 'CREDENTIAL_SOURCE_DIR_CHANGED_DURING_READ' };
        }
      }

      // THIRD HARD NO-GO RESPONSE Block D: strict (fatal) UTF-8 decoding --
      // Buffer#toString('utf8') silently replaces invalid sequences with
      // U+FFFD and trusts the corrupted result; TextDecoder's fatal mode
      // throws instead, so an invalid byte sequence is a hard rejection, never
      // a silently-corrupted-but-accepted value.
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (err) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_INVALID_UTF8' };
      }
      return { ok: true, text, initialLstat };
    } finally {
      // Group A / C4 slice (2026-08-10): zeroize the raw byte buffer
      // regardless of outcome -- credential material must not linger in
      // memory beyond this function's frame.
      if (buf) buf.fill(0);
      try { fs.closeSync(fd); } catch (err) { /* best-effort close */ }
    }
  }

  /**
   * THIRD HARD NO-GO RESPONSE Block D: full sequence is now lstat(path) ->
   * open(O_NOFOLLOW) -> fstat(fd) -> bounded read -> re-fstat(fd) ->
   * re-lstat(path), all identity comparisons via BigInt-precision stats
   * (matching this file's own established identityTupleFor precedent) -- the
   * fd's own identity is cross-checked against the pre-open lstat (catches a
   * swap between lstat and open), and BOTH a post-read re-fstat and a final
   * re-lstat of the path confirm nothing changed identity throughout the
   * entire operation, never trusted from a single snapshot taken once.
   */
  function readCredentialSourceFd(credentialPath) {
    let initialLstat;
    try {
      initialLstat = fs.lstatSync(credentialPath, { bigint: true });
    } catch (err) {
      return { ok: false, reason: 'CREDENTIAL_SOURCE_OPEN_FAILED' };
    }
    if (initialLstat.isSymbolicLink()) return { ok: false, reason: 'CREDENTIAL_SOURCE_SYMLINK_REJECTED' };

    let fd;
    try {
      fd = fs.openSync(credentialPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ELOOP') return { ok: false, reason: 'CREDENTIAL_SOURCE_SYMLINK_REJECTED' };
      return { ok: false, reason: 'CREDENTIAL_SOURCE_OPEN_FAILED' };
    }
    try {
      const st = fs.fstatSync(fd, { bigint: true });
      if (!st.isFile()) return { ok: false, reason: 'CREDENTIAL_SOURCE_NOT_REGULAR_FILE' };
      // HARD NO-GO RESPONSE Block D: verify current owner, exact mode, and
      // nlink===1 BEFORE trusting any content -- a credential file owned by a
      // different user, world-writable, or hard-linked elsewhere is no longer
      // accepted identically to a genuinely safe one. process.getuid is POSIX-
      // only (absent on Windows); the owner check is skipped there rather than
      // thrown on, consistent with this fd-bound mechanism being a POSIX-first
      // hardening layer.
      if (typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_OWNER_MISMATCH' };
      }
      // POSIX mode bits are authoritative only on POSIX. On Windows Node's
      // synthetic mode is not an NTFS access-control boundary; production
      // credential reads are protected by the owner-private DACL snapshots in
      // readOwnedStableBuffer instead.
      if (process.platform !== 'win32' && (st.mode & 0o777n) !== 0o600n) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_MODE_INVALID' };
      }
      if (st.nlink !== 1n) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_NLINK_INVALID' };
      }
      if (st.dev !== initialLstat.dev || st.ino !== initialLstat.ino) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_IDENTITY_MISMATCH' }; // swapped between the pre-open lstat and the fd's own fstat.
      }
      if (st.size > BigInt(CREDENTIAL_SOURCE_MAX_BYTES)) return { ok: false, reason: 'CREDENTIAL_SOURCE_OVERSIZED' };
      const size = Number(st.size);
      const buf = Buffer.alloc(size);
      let offset = 0;
      while (offset < buf.length) {
        const bytesRead = fs.readSync(fd, buf, offset, buf.length - offset, null);
        if (bytesRead <= 0) break;
        offset += bytesRead;
      }
      if (offset !== size) return { ok: false, reason: 'CREDENTIAL_SOURCE_SHORT_READ' };

      const stAfter = fs.fstatSync(fd, { bigint: true });
      if (stAfter.dev !== st.dev || stAfter.ino !== st.ino || stAfter.mode !== st.mode || stAfter.nlink !== st.nlink || stAfter.size !== st.size) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_IDENTITY_MISMATCH' }; // changed identity/metadata DURING the read.
      }

      // THIRD HARD NO-GO RESPONSE Block D: strict (fatal) UTF-8 decoding --
      // Buffer#toString('utf8') silently replaces invalid sequences with
      // U+FFFD and trusts the corrupted result; TextDecoder's fatal mode
      // throws instead, so an invalid byte sequence is a hard rejection, never
      // a silently-corrupted-but-accepted value.
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (err) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_INVALID_UTF8' };
      }
      if (hasDuplicateJsonKeyAnyDepth(text)) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_DUPLICATE_KEY' };
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_INVALID_JSON' };
      }
      if (!hasExactKeys(parsed, CREDENTIAL_SOURCE_ALLOWED_KEYS_SORTED)) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_INVALID_SHAPE' };
      }
      // HARD NO-GO RESPONSE Block D (property 6): hasExactKeys only validates
      // the TOP-LEVEL key SET is exactly right -- it says nothing about the
      // TYPE of each value. `credentials`/`otherCredentialFields` must
      // themselves genuinely be objects (never null, an array, or a bare
      // primitive) -- a `credentials` field that is a JSON string, for
      // instance, previously passed this check and every one before it,
      // reaching `finishHoldingLock`'s own `sourceResult.credentials || {}`,
      // which only guards FALSY values -- a non-empty string sailed through
      // untouched, silently treated as if it were a valid credentials object.
      if (parsed.credentials === null || typeof parsed.credentials !== 'object' || Array.isArray(parsed.credentials)) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_NESTED_VALUE_INVALID' };
      }
      if (parsed.otherCredentialFields === null || typeof parsed.otherCredentialFields !== 'object' || Array.isArray(parsed.otherCredentialFields)) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_NESTED_VALUE_INVALID' };
      }

      let finalLstat;
      try {
        finalLstat = fs.lstatSync(credentialPath, { bigint: true });
      } catch (err) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_IDENTITY_MISMATCH' };
      }
      if (finalLstat.isSymbolicLink() || finalLstat.dev !== initialLstat.dev || finalLstat.ino !== initialLstat.ino) {
        return { ok: false, reason: 'CREDENTIAL_SOURCE_IDENTITY_MISMATCH' }; // the PATH itself was swapped during the operation.
      }

      return {
        ok: true,
        credentials: parsed.credentials,
        otherCredentialFields: parsed.otherCredentialFields,
        expiresAt: parsed.expiresAt,
        // HARD NO-GO RESPONSE Block D: sourceIdentity is now HOST-derived
        // (credentialPath itself -- the caller-supplied constructor parameter,
        // never influenced by the file's own content) rather than trusted
        // directly from the parsed JSON -- a credential file can no longer
        // self-report an arbitrary sourceIdentity.
        sourceIdentity: credentialPath,
      };
    } finally {
      try { fs.closeSync(fd); } catch (err) { /* best-effort close */ }
    }
  }

  return Object.freeze({ CREDENTIAL_SOURCE_MAX_BYTES, hasDuplicateJsonKeyAnyDepth, readOwnedStableBuffer, readCredentialSourceFd });
}

module.exports = Object.freeze({ createCredentialSourceRead });
