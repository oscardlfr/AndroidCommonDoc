#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { decodePlanBytes, parsePlanClass } = require('../lib/wave-plan-class.cjs');

function fail(reason) {
  process.stderr.write(`[wave-plan-class] ${reason}\n`);
  process.exit(2);
}

function readStableRegularFile(target) {
  if (typeof target !== 'string' || target.length === 0) fail('PLAN_PATH_REQUIRED');
  const absolute = path.resolve(target);
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  let pathStat;
  try { pathStat = fs.lstatSync(absolute, { bigint: true }); }
  catch { fail('PLAN_FILE_UNREADABLE'); }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) fail('PLAN_FILE_UNSAFE');
  let fd;
  try { fd = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow); }
  catch { fail('PLAN_FILE_UNREADABLE'); }
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.dev !== pathStat.dev || before.ino !== pathStat.ino
      || before.size < 0n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail('PLAN_FILE_UNSAFE');
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const identity = ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'];
    if (offset !== bytes.length || identity.some((key) => before[key] !== after[key])) fail('PLAN_FILE_DRIFT');
    return bytes;
  } finally {
    try { fs.closeSync(fd); } catch { /* already failing closed */ }
  }
}

function main(argv) {
  if (argv.length !== 2 || argv[0] !== '--plan') fail('USAGE: --plan <path>');
  const bytes = readStableRegularFile(argv[1]);
  try { process.stdout.write(`${parsePlanClass(decodePlanBytes(bytes))}\n`); }
  catch (error) { fail(error && error.message ? error.message : 'PLAN_CLASS_PARSE_FAILED'); }
}

main(process.argv.slice(2));
