'use strict';

function createIsolationTopology({ path }) {
  const ISOLATION_ROOT_TOPOLOGY_LAYOUT = Object.freeze({
    root: '.',
    home: 'home',
    codexHome: 'cx',
    tmp: 'tmp',
    xdgCache: 'xdg-cache',
    xdgConfig: 'xdg-config',
    xdgState: 'xdg-state',
    cwd: 'cwd',
  });

  const ISOLATED_PATH_POSIX = '/usr/bin:/bin:/usr/sbin:/sbin';

  const ROOT_PROVISION_INTENT_LIFETIME_MS = 300 * 1000; // PLAN.md ~L1161/1192: root-provision-intent/v1's lifetime constant is exactly 300 seconds.
  const CREDENTIAL_REFRESH_MARGIN_MS = 300 * 1000;

  const LONGEST_CHILD_STATE_FILENAME = 'memories_1.sqlite-shm';
  const CHILD_STATE_PATH_BUDGET_CHARS = 254;

  function isolationRootChildPathBudget(intendedPath) {
    const codexHome = topologyPathsFor(intendedPath).codexHome;
    const longestChildPathLength = codexHome.length + 1 + LONGEST_CHILD_STATE_FILENAME.length;
    if (longestChildPathLength <= CHILD_STATE_PATH_BUDGET_CHARS) {
      return { ok: true, codexHomeLength: codexHome.length, longestChildPathLength };
    }
    return {
      ok: false,
      reason: 'ISOLATION_ROOT_PATH_BUDGET_EXCEEDED',
      codexHomeLength: codexHome.length,
      longestChildPathLength,
      budget: CHILD_STATE_PATH_BUDGET_CHARS,
    };
  }

  function topologyPathsFor(intendedPath) {
    const paths = {};
    for (const layer of Object.keys(ISOLATION_ROOT_TOPOLOGY_LAYOUT)) {
      const rel = ISOLATION_ROOT_TOPOLOGY_LAYOUT[layer];
      paths[layer] = rel === '.' ? intendedPath : path.join(intendedPath, rel);
    }
    return paths;
  }

  function childEnvFromTopology(topologyPaths) {
    if (!topologyPaths || typeof topologyPaths !== 'object') {
      throw new TypeError('childEnvFromTopology requires a topologyPaths object');
    }
    const REQUIRED_LAYERS = ['home', 'codexHome', 'tmp', 'xdgCache', 'xdgConfig', 'xdgState', 'cwd'];
    for (const layer of REQUIRED_LAYERS) {
      if (typeof topologyPaths[layer] !== 'string' || topologyPaths[layer].length === 0) {
        throw new TypeError('childEnvFromTopology: topologyPaths.' + layer + ' must be a non-empty string');
      }
    }
    return {
      cwd: topologyPaths.cwd,
      env: {
        HOME: topologyPaths.home,
        CODEX_HOME: topologyPaths.codexHome,
        TMPDIR: topologyPaths.tmp,
        XDG_CACHE_HOME: topologyPaths.xdgCache,
        XDG_CONFIG_HOME: topologyPaths.xdgConfig,
        XDG_STATE_HOME: topologyPaths.xdgState,
      },
    };
  }
  return {
    ISOLATION_ROOT_TOPOLOGY_LAYOUT,
    ISOLATED_PATH_POSIX,
    ROOT_PROVISION_INTENT_LIFETIME_MS,
    CREDENTIAL_REFRESH_MARGIN_MS,
    isolationRootChildPathBudget,
    topologyPathsFor,
    childEnvFromTopology,
  };
}

module.exports = Object.freeze({ createIsolationTopology });
