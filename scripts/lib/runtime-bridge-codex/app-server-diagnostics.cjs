'use strict';

// Extracted verbatim from runtime-bridge-codex.cjs: pure signal/diagnostic
// formatting helpers for the owned app-server child and its RPC connection.
// Every function operates only on its explicit parameters plus Node
// built-ins (process.kill), so this factory accepts no dependencies. Never
// requires the facade or either sibling facade, directly or transitively.

function createAppServerDiagnostics() {
  /**
   * Renders a child's captured stderr as an optional signal segment. Everything that could turn a
   * diagnostic into a leak or a parsing hazard is handled here rather than at any call site:
   * credentials are removed by shape (an authorization header, a JWT, a prefixed key) and by the
   * name of the field carrying them, then any remaining long unbroken token-shaped run (never the
   * shape of a path segment or an English word) is replaced; characters outside a conservative
   * printable set are dropped, runs of whitespace collapse to a single space, and colons -- the
   * signal's own field separator -- are neutralized. The result is capped, keeping the end.
   * Redaction runs on the WHOLE captured text, before any cap, so no secret can survive by being
   * split across a truncation boundary.
   * @param {string} text
   * @param {number} [maxChars]
   * @returns {string} '' when there is nothing to report.
   */
  function redactSignalText(text, maxChars) {
    if (typeof text !== 'string' || text.length === 0) return '';
    const limit = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 240;
    // Length alone is not a safe test: a JWT segment, a short key, or a value split by punctuation
    // can all fall under any threshold worth setting. Redact by well-known shape and by the name of
    // the field carrying the value first, then by length for everything unrecognized.
    let cleaned = text
      .replace(/(?:bearer|basic)\s+\S+/gi, '<redacted>')
      .replace(/\beyJ[A-Za-z0-9._-]+/g, '<redacted>')
      .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|ghu|xox[baprs])[-_][A-Za-z0-9_-]+/gi, '<redacted>')
      .replace(/((?:api|access|secret|auth|session|refresh|private)[ _-]?(?:key|token|secret|id)?\s*[=:]\s*)\S+/gi, '$1<redacted>')
      .replace(/[A-Za-z0-9+\/=_-]{24,}/g, '<redacted>');
    cleaned = cleaned.replace(/[^\x20-\x7e]+/g, ' ').replace(/:/g, ';').replace(/\s+/g, ' ').trim();
    if (cleaned.length === 0) return '';
    return cleaned.length <= limit ? cleaned : '...' + cleaned.slice(cleaned.length - limit);
  }

  function describeOwnedChildStderr(text, maxChars) {
    const capped = redactSignalText(text, maxChars);
    return capped.length === 0 ? '' : ':stderr-' + capped;
  }

  /**
   * Composes the session-run shutdown signal for a failed BORN-provenance proof, preserving
   * the failing step, its sub-reason and the observed latency. The win32 proof previously
   * returned a bare {ok:false} for six distinct conditions, so a live rejection could not be
   * attributed. Diagnostic composition only: no deadline, authority or acceptance rule moves.
   * @param {{ok?:boolean,reason?:string,subReason?:string|null}|null|undefined} provenance
   * @param {number} elapsedMs
   * @returns {string}
   */
  function describeBornProvenanceFailure(provenance, elapsedMs, childState, childStderr) {
    const reason = provenance && typeof provenance.reason === 'string' && provenance.reason.length > 0
      ? provenance.reason
      : 'no-reason-reported';
    const sub = provenance && typeof provenance.subReason === 'string' && provenance.subReason.length > 0
      ? ':' + provenance.subReason
      : '';
    const ms = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : -1;
    const child = typeof childState === 'string' && childState.length > 0 ? ':child-' + childState : '';
    return 'APP_SERVER_BORN_PROVENANCE_UNAVAILABLE:' + reason + sub + ':after-' + ms + 'ms' + child
      + describeOwnedChildStderr(childStderr);
  }

  /**
   * Is this archive refusal the peer telling us it has no such thread at all?
   *
   * Measured against the installed codex app-server (0.153.4): `thread/archive` answers
   * `{code:-32600, message:"no rollout found for thread id <id>"}` for a thread this same connection
   * started moments earlier, with or without a turn. Archive's own post-condition -- that the thread
   * is no longer active on the server -- is already satisfied by a server that has no record of it,
   * so this specific refusal is an idempotent success rather than a fault. Deliberately narrow: the
   * exact code AND the peer's own phrase, never "any -32600" and never "any archive failure", so a
   * genuine disagreement about state still stops the connection.
   * @param {{code?:unknown,message?:unknown}|null|undefined} error
   * @returns {boolean}
   */
  function isUnknownThreadArchiveError(error) {
    if (!error || typeof error !== 'object' || error.code !== -32600) return false;
    return typeof error.message === 'string' && error.message.toLowerCase().indexOf('no rollout found') !== -1;
  }

  /**
   * Renders an app-server JSON-RPC error payload as a signal fragment. Without this, every failed
   * control-plane call collapses to its own generic '<method>-error-response' label, which is true of
   * a wrong parameter shape, an unknown method, a refused state transition and a backend outage
   * alike -- and those need different fixes. The peer's own code and message are the only things
   * that separate them. Redacted through the same pipeline as captured child stderr, so a message
   * that happens to echo a token cannot leak, and colon-free so it can never break the signal's own
   * field separator.
   * @param {{code?:unknown,message?:unknown}|null|undefined} error
   * @returns {string} '' when there is nothing to report.
   */
  function describeRpcError(error) {
    if (!error || typeof error !== 'object') return '';
    const parts = [];
    if (Number.isFinite(error.code)) parts.push('code=' + String(error.code));
    const message = redactSignalText(typeof error.message === 'string' ? error.message : '', 160);
    if (message.length > 0) parts.push('message=' + message);
    return parts.length === 0 ? '' : parts.join(' ');
  }

  /**
   * Snapshots what actually became of the owned child at the moment a BORN-provenance proof was
   * rejected. A `process-absent` observation is ambiguous on its own: the child may have exited on
   * its own terms, been signalled, or still be running while the observer misreported it. Each of
   * those calls for a different fix, so record which one it was. Read-only: it never signals the
   * child (`process.kill(pid, 0)` only tests for existence) and never changes any outcome.
   * @param {{exitCode?:(number|null),signalCode?:(string|null),pid?:number}|null|undefined} child
   * @returns {string}
   */
  function describeOwnedChildState(child) {
    if (!child) return 'unknown';
    if (child.signalCode) return 'signalled-' + String(child.signalCode);
    if (child.exitCode !== undefined && child.exitCode !== null) return 'exited-' + String(child.exitCode);
    if (Number.isInteger(child.pid) && child.pid > 0) {
      try { process.kill(child.pid, 0); return 'still-running'; }
      catch (err) { return err && err.code === 'ESRCH' ? 'gone-without-exit-event' : 'liveness-unknown'; }
    }
    return 'unknown';
  }

  /**
   * Renders the death of a retained app-server child. Reaching READY and then losing the child is a
   * different failure from never reaching it, and the only facts that distinguish one cause from
   * another -- did it exit, was it signalled, how long did it survive, what did it say on the way
   * out -- were all discarded by the bare signal this replaces.
   * @param {(number|null)} code
   * @param {(string|null)} signal
   * @param {number} elapsedMs lifetime of the child, from spawn.
   * @param {string} [childStderr]
   * @returns {string}
   */
  function describeOwnedChildExit(code, signal, elapsedMs, childStderr) {
    const how = signal ? 'signalled-' + String(signal)
      : (code !== undefined && code !== null ? 'exited-' + String(code) : 'unknown');
    const ms = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : -1;
    return 'APP_SERVER_CHILD_EXIT:' + how + ':after-' + ms + 'ms' + describeOwnedChildStderr(childStderr);
  }

  /**
   * Renders a thread-start rejection with the reason the transport already computed. `threadStart`
   * distinguishes a stopped connection, a wrong phase, a busy thread lifecycle, a lost tracking
   * state, an invalid response and a reused archived id -- every one of which calls for a different
   * fix -- but the call site collapsed them into one bare signal, so a live rejection said only that
   * something went wrong. The child's own stderr is appended when it had anything to say.
   * @param {{ok?:boolean,reason?:string}|null|undefined} threadResult
   * @param {number} elapsedMs
   * @param {string} [childStderr]
   * @returns {string}
   */
  function describeThreadStartFailure(threadResult, elapsedMs, childStderr) {
    const reason = threadResult && typeof threadResult.reason === 'string' && threadResult.reason.length > 0
      ? threadResult.reason
      : 'no-reason-reported';
    const ms = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : -1;
    return 'APP_SERVER_THREAD_START_FAILED:' + reason + ':after-' + ms + 'ms'
      + describeOwnedChildStderr(childStderr);
  }

  /**
   * Composes the session-run shutdown signal for a failed `initialize`, preserving the
   * connection's own sub-reason and the observed latency. Previously the sub-reason was
   * dropped and only the bare signal survived, so a live failure could not be told apart
   * from a timeout, a rejected response, a schema violation or a concurrent STOP -- and the
   * outer `cleanup-failed` reason then masked it further. Diagnostic composition only: it
   * changes no deadline, no authority and no acceptance rule.
   * @param {{ok?:boolean,reason?:string}|null|undefined} initResult
   * @param {number} elapsedMs
   * @returns {string}
   */
  function describeInitializeFailure(initResult, elapsedMs, childStderr) {
    const reason = initResult && typeof initResult.reason === 'string' && initResult.reason.length > 0
      ? initResult.reason
      : 'no-reason-reported';
    const ms = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : -1;
    return 'APP_SERVER_INITIALIZE_FAILED:' + reason + ':after-' + ms + 'ms'
      + describeOwnedChildStderr(childStderr);
  }

  return Object.freeze({
    redactSignalText, describeOwnedChildStderr, describeBornProvenanceFailure,
    isUnknownThreadArchiveError, describeRpcError, describeOwnedChildState,
    describeOwnedChildExit, describeThreadStartFailure, describeInitializeFailure,
  });
}

module.exports = Object.freeze({ createAppServerDiagnostics });
