'use strict';

const fs = require('fs');

const S_IFMT = 0o170000n;
const S_IFREG = 0o100000n;
const DEFAULT_MAX_DURABLE_ARTIFACT_BYTES = 1024 * 1024;
const MAX_ENUM_HARD_CAP = 1024;
const MAX_ENUM_KEPT_ENTRIES = 256;

function statIsRegularFile(bigintStat) { return (bigintStat.mode & S_IFMT) === S_IFREG; }

/** Bounded, position-explicit fd read. */
function readAllFromFd(fd, cap) {
  const buf = Buffer.allocUnsafe(cap);
  let total = 0;
  while (total < cap) {
    const n = fs.readSync(fd, buf, total, cap - total, total);
    if (n === 0) break;
    total += n;
  }
  return buf.subarray(0, total);
}

/** Keep the lexicographically first `capacity` candidates without an unbounded allocation. */
function insertBoundedCandidate(list, key, extra, capacity) {
  let i = list.length;
  list.push([key, extra]);
  while (i > 0 && list[i - 1][0] > list[i][0]) {
    const tmp = list[i - 1];
    list[i - 1] = list[i];
    list[i] = tmp;
    i -= 1;
  }
  if (list.length > capacity) list.pop();
}

module.exports = {
  DEFAULT_MAX_DURABLE_ARTIFACT_BYTES,
  MAX_ENUM_HARD_CAP,
  MAX_ENUM_KEPT_ENTRIES,
  insertBoundedCandidate,
  readAllFromFd,
  statIsRegularFile,
};
