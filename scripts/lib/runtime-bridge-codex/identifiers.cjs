'use strict';

function createIdentifiers({ RC }) {
  function usageError(message) {
    process.stderr.write('usage error: ' + message + '\n');
    process.exit(RC.USAGE);
  }

  function authError(reason) {
    process.stderr.write('[session-run] rejected: ' + reason + '\n');
    process.exit(RC.AUTH_ISOLATION);
  }

  function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }

  function isTestCapability() {
    return process.env.NODE_ENV === 'test'
      && typeof process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY === 'string'
      && process.env.RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY.length > 0;
  }

  function isP2ConformanceTimingCapability() {
    return isTestCapability()
      || process.env.ANDROIDCOMMONDOC_P2_GENUINE_CAPTURE === '1';
  }

  return Object.freeze({ usageError, authError, arraysEqual, isTestCapability, isP2ConformanceTimingCapability });
}

module.exports = Object.freeze({ createIdentifiers });
