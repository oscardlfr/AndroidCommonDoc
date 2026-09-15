'use strict';

function createIsolationIdentity({ fs, rc }) {
  const IDENTITY_TUPLE_FIELDS = Object.freeze(['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'ctimeNs', 'mtimeNs']);
  const CONFIG_TOML_MAX_BYTES = 16 * 1024;
  function identityTupleFromStat(st) {
    const tuple = {};
    for (const field of IDENTITY_TUPLE_FIELDS) tuple[field] = st[field].toString();
    return tuple;
  }

  function fdBoundIdentityTuple(targetPath) {
    const initialLstat = fs.lstatSync(targetPath, { bigint: true });
    if (initialLstat.isSymbolicLink()) throw new Error('IDENTITY_SYMLINK_REJECTED');
    const fd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd, { bigint: true });
      if (st.dev !== initialLstat.dev || st.ino !== initialLstat.ino) {
        throw new Error('IDENTITY_MISMATCH_LSTAT_VS_FD');
      }
      const finalLstat = fs.lstatSync(targetPath, { bigint: true });
      if (finalLstat.isSymbolicLink() || finalLstat.dev !== initialLstat.dev || finalLstat.ino !== initialLstat.ino) {
        throw new Error('IDENTITY_MISMATCH_PATH_SWAPPED');
      }
      return identityTupleFromStat(st);
    } finally {
      try { fs.closeSync(fd); } catch (err) { /* best-effort */ }
    }
  }

  function fdBoundConfigIdentityAndDigest(configPath) {
    const initialLstat = fs.lstatSync(configPath, { bigint: true });
    if (initialLstat.isSymbolicLink()) throw new Error('IDENTITY_SYMLINK_REJECTED');
    const fd = fs.openSync(configPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd, { bigint: true });
      if (st.dev !== initialLstat.dev || st.ino !== initialLstat.ino) {
        throw new Error('IDENTITY_MISMATCH_LSTAT_VS_FD');
      }
      if (st.size > BigInt(CONFIG_TOML_MAX_BYTES)) throw new Error('IDENTITY_CONFIG_OVERSIZED');
      const size = Number(st.size);
      const buf = Buffer.alloc(size);
      let offset = 0;
      while (offset < buf.length) {
        const bytesRead = fs.readSync(fd, buf, offset, buf.length - offset, null);
        if (bytesRead <= 0) break;
        offset += bytesRead;
      }
      if (offset !== size) throw new Error('IDENTITY_CONFIG_SHORT_READ');
      const stAfter = fs.fstatSync(fd, { bigint: true });
      if (stAfter.dev !== st.dev || stAfter.ino !== st.ino || stAfter.mode !== st.mode || stAfter.nlink !== st.nlink || stAfter.size !== st.size) {
        throw new Error('IDENTITY_MISMATCH_DURING_READ');
      }
      const finalLstat = fs.lstatSync(configPath, { bigint: true });
      if (finalLstat.isSymbolicLink() || finalLstat.dev !== initialLstat.dev || finalLstat.ino !== initialLstat.ino) {
        throw new Error('IDENTITY_MISMATCH_PATH_SWAPPED');
      }
      return { identity: identityTupleFromStat(st), digest: rc.sha256Buffer(buf), text: buf.toString('utf8') };
    } finally {
      try { fs.closeSync(fd); } catch (err) { /* best-effort */ }
    }
  }

  const CHILD_WRITABLE_TOPOLOGY_LAYERS = Object.freeze(['home', 'codexHome', 'tmp', 'xdgCache', 'xdgConfig', 'xdgState']);
  const CHILD_WRITABLE_IDENTITY_FIELDS = Object.freeze(['dev', 'ino', 'mode', 'uid', 'gid']);

  function identityTuplesEqual(a, b, fields) {
    for (const field of (fields || IDENTITY_TUPLE_FIELDS)) {
      if (a[field] !== b[field]) return false;
    }
    return true;
  }

  function captureFinalIdentitySnapshot(record) {
    const topologyIdentity = {};
    for (const layer of Object.keys(record.topologyPaths)) {
      topologyIdentity[layer] = fdBoundIdentityTuple(record.topologyPaths[layer]);
    }
    const configResult = fdBoundConfigIdentityAndDigest(record.configPath);
    return { topologyIdentity, configIdentity: configResult.identity, configDigest: configResult.digest };
  }

  function finalIdentitySnapshotsMatch(a, b) {
    if (a.configDigest !== b.configDigest) return false;
    if (!identityTuplesEqual(a.configIdentity, b.configIdentity)) return false; // config.toml itself is always host-owned -- full tuple.
    for (const layer of Object.keys(a.topologyIdentity)) {
      const fields = CHILD_WRITABLE_TOPOLOGY_LAYERS.includes(layer) ? CHILD_WRITABLE_IDENTITY_FIELDS : IDENTITY_TUPLE_FIELDS;
      if (!identityTuplesEqual(a.topologyIdentity[layer], b.topologyIdentity[layer], fields)) return false;
    }
    return true;
  }
  return {
    IDENTITY_TUPLE_FIELDS,
    CONFIG_TOML_MAX_BYTES,
    CHILD_WRITABLE_TOPOLOGY_LAYERS,
    CHILD_WRITABLE_IDENTITY_FIELDS,
    identityTupleFromStat,
    fdBoundIdentityTuple,
    fdBoundConfigIdentityAndDigest,
    identityTuplesEqual,
    captureFinalIdentitySnapshot,
    finalIdentitySnapshotsMatch,
  };
}

module.exports = Object.freeze({ createIsolationIdentity });
