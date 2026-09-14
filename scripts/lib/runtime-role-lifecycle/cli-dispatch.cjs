'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs per the mailbox's own
// fallback rule: "CLI dispatch table and main() may remain in the facade only
// if total facade <=1,500 lines; otherwise extract a frozen CLI dispatcher
// factory." The subcommand-name-to-handler table and the CLI entry point
// itself, unchanged. Never requires the facade or a sibling module.

function createCliDispatch({
  usageError, makeResult, RC, emitAndExit,
  handleProbe, handleEnsure, handleNotify, handleActionFailed, handleReady, handleWaitReady,
  handleStatus, handleConsultRoot, handleMixedReviewRequest, handleConsultRootStatus,
  handleRootSource, handleRootSourceStatus, handleRotate, handleStopOwned,
}) {

const HANDLERS = Object.freeze({
  probe: handleProbe,
  ensure: handleEnsure,
  notify: handleNotify,
  'action-failed': handleActionFailed,
  ready: handleReady,
  'wait-ready': handleWaitReady,
  status: handleStatus,
  'consult-root': handleConsultRoot,
  'mixed-review-request': handleMixedReviewRequest,
  'consult-root-status': handleConsultRootStatus,
  'root-source': handleRootSource,
  'root-source-status': handleRootSourceStatus,
  rotate: handleRotate,
  'stop-owned': handleStopOwned,
});

/**
 * CLI entry point. Never throws: any unexpected internal error is caught and
 * reported as one valid rc7 envelope rather than an uncaught-exception stack trace,
 * so stdout is always exactly one closed-shape JSON line.
 * @param {string[]} argv
 * @returns {never}
 */
function main(argv) {
  try {
    const subcommand = argv[0];
    const handler = HANDLERS[subcommand];
    if (!handler) {
      usageError('');
      return;
    }
    handler(argv.slice(1));
  } catch (err) {
    const knownCommand = typeof argv[0] === 'string' && HANDLERS[argv[0]] ? argv[0] : '';
    emitAndExit(makeResult(knownCommand, RC.INTERNAL, 'INVALID', 'INTERNAL_ERROR', [], []));
  }
}

  return Object.freeze({
    HANDLERS, main,
  });
}

module.exports = { createCliDispatch };
