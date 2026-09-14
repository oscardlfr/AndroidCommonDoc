'use strict';

// Extracted verbatim from runtime-bridge-codex.cjs: the JSONL wire-framing
// primitives used by createAppServerConnection. Pure -- operates only on its
// explicit parameters and Node built-ins (TextDecoder/Buffer), so this
// factory accepts no dependencies. Never requires the facade or either
// sibling facade, directly or transitively.

function createAppServerFraming() {
  // R7: an internal safety bound on a single unterminated (no '\n' yet) buffered
  // line -- NOT protocol authority, purely an accelerator/OOM guard. A hostile
  // or badly-broken transport that never sends a newline must not be allowed to
  // grow `buffer` without limit.
  const MAX_JSONL_FRAME_BYTES = 4 * 1024 * 1024;

  /**
   * Incrementally feeds raw bytes, splitting on '\n' and JSON-parsing each
   * complete line as exactly one plain object -- never an array/string/
   * number/boolean/null, and never carrying an invented `jsonrpc` member
   * (PLAN.md ~L903: "app-server frames are {id,method,params} / {id,result|
   * error} with no invented jsonrpc member"). A malformed line reports
   * onError and is skipped; it does not corrupt buffering of subsequent
   * lines (the caller's own protocol-phase logic decides whether continuing
   * after a malformed frame is safe). A blank line is tolerated silently
   * (neither a frame nor an error) -- some writers emit a stray one.
   *
   * R9: uses `TextDecoder('utf-8', {fatal:true})` decoded incrementally (not
   * `chunk.toString('utf8')`, and no longer `StringDecoder`) so a multi-byte
   * UTF-8 character split across two chunk boundaries decodes correctly, AND a
   * genuinely invalid byte sequence throws synchronously instead of silently
   * substituting U+FFFD (which was ambiguous with a legitimately-encoded
   * U+FFFD already present in a valid payload -- Codex NO-GO P2). Accepts an
   * optional `shouldStop()` predicate, checked before each line is parsed --
   * once true (the caller's connection has begun terminal STOP), no further
   * buffered line in the SAME chunk is parsed or dispatched, even if several
   * arrived together (A1: a malformed frame must STOP delivery of anything
   * queued behind it in the same read). An unterminated partial line that
   * exceeds `MAX_JSONL_FRAME_BYTES` is reported via onError and the buffer is
   * dropped (never retained) -- a safety bound, not protocol authority.
   * @param {(frame: object) => void} onFrame
   * @param {(reason: string, rawLine: string|null) => void} onError
   * @param {() => boolean} [shouldStop]
   * @returns {(chunk: Buffer|string) => void}
   */
  function createJsonlFrameFeeder(onFrame, onError, shouldStop) {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let poisoned = false; // R8: this feeder's OWN permanent fail-closed latch -- independent of an external `shouldStop`, so a standalone/unit-tested feeder (no wrapping connection) still never "recovers" after a fatal condition.
    return function feed(chunk) {
      if (poisoned || (shouldStop && shouldStop())) return;
      let decoded;
      if (Buffer.isBuffer(chunk)) {
        try {
          decoded = decoder.decode(chunk, { stream: true });
        } catch (err) {
          poisoned = true;
          buffer = '';
          onError('invalid-utf8-encoding', null);
          return;
        }
      } else {
        decoded = chunk;
      }
      buffer += decoded;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        if (poisoned || (shouldStop && shouldStop())) { buffer = ''; return; }
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.length === 0) continue;
        // R8 (item 10): the 4MiB safety bound must apply to a COMPLETE line
        // too, not merely an unterminated leftover -- a single overlong
        // complete line used to be parsed regardless of size.
        if (Buffer.byteLength(line, 'utf8') > MAX_JSONL_FRAME_BYTES) {
          poisoned = true;
          buffer = '';
          onError('frame-too-large-complete-line', null);
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          onError('malformed-json', line);
          continue;
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          onError('frame-not-object', line);
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(parsed, 'jsonrpc')) {
          onError('frame-has-invented-jsonrpc-member', line);
          continue;
        }
        onFrame(parsed);
      }
      if (buffer.length > 0 && Buffer.byteLength(buffer, 'utf8') > MAX_JSONL_FRAME_BYTES) {
        poisoned = true;
        buffer = '';
        onError('frame-too-large-no-newline', null);
      }
    };
  }

  /**
   * Writes exactly one canonical JSON object + one trailing '\n' as a single
   * write() call. No shape validation -- callers construct exact frames.
   * `onFlushed(err)`, when supplied, is Node's own write-completion callback
   * (fires once the chunk is fully flushed to the underlying transport, or
   * with an Error if the write itself failed) -- this is the mechanism used
   * to distinguish "confirmed-before-commit" (the write itself failed) from
   * "possibly-delivered" (the write flushed; anything after that is
   * ambiguous until a response/EOF/timeout resolves it), per PLAN.md ~L934
   * ("Once the line is fully flushed... is ambiguous/possibly-delivered").
   * A synchronous throw from `.write()` itself (rare, but not impossible for
   * a hostile/broken transport) is also routed through `onFlushed`, never
   * left to propagate and crash the caller.
   */
  function writeJsonlFrame(writable, obj, onFlushed) {
    const line = JSON.stringify(obj) + '\n';
    try {
      writable.write(line, 'utf8', onFlushed);
    } catch (err) {
      if (typeof onFlushed === 'function') onFlushed(err);
    }
  }

  return Object.freeze({ MAX_JSONL_FRAME_BYTES, createJsonlFrameFeeder, writeJsonlFrame });
}

module.exports = Object.freeze({ createAppServerFraming });
