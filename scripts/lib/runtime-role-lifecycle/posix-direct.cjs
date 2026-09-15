'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the canonical
// POSIX host-action renderer/parser frozen at PLAN.md ~L578, exported for
// direct import by context-provider-gate.js (no model reimplements
// quoting). Pure string transforms -- no injected dependencies. Never
// requires the facade or a sibling module.

function createPosixDirect({}) {
/**
 * Renders `argv` as the canonical POSIX-single-quoted host-action command string.
 * Rejects an empty array, empty/NUL/CR/LF-containing tokens, and non-UTF-8 input.
 * Every token becomes one single-quoted word; each embedded apostrophe becomes the
 * exact five-character sequence `'"'"'`; words join with exactly one ASCII space.
 * @param {string[]} argv
 * @returns {string}
 */
function renderPosixDirect(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error('renderPosixDirect: argv must be a non-empty array');
  }
  const words = argv.map((tok) => {
    if (typeof tok !== 'string' || tok.length === 0) {
      throw new Error('renderPosixDirect: every token must be a non-empty string');
    }
    if (/[\x00\r\n]/.test(tok)) {
      throw new Error('renderPosixDirect: NUL/CR/LF-containing token rejected');
    }
    if (Buffer.from(tok, 'utf8').toString('utf8') !== tok) {
      throw new Error('renderPosixDirect: non-UTF-8 token rejected');
    }
    const escaped = tok.split("'").join('\'"\'"\'');
    return `'${escaped}'`;
  });
  return words.join(' ');
}

/**
 * Parses a canonical POSIX-single-quoted command string produced only by
 * `renderPosixDirect` back into its argv array. Accepts only the closed grammar
 * (single-quoted segments plus the exact embedded-apostrophe sequence, one space
 * between words, no leading/trailing space) and succeeds only when
 * `renderPosixDirect(decoded) === command`.
 * @param {string} command
 * @returns {string[]|null} decoded argv, or null if the command is not canonical.
 */
function parsePosixDirect(command) {
  if (typeof command !== 'string' || command.length === 0) return null;
  const argv = [];
  let i = 0;
  const n = command.length;
  while (i < n) {
    if (command[i] !== "'") return null;
    i += 1;
    let word = '';
    let closed = false;
    while (i < n) {
      if (command[i] === "'") {
        if (command.slice(i, i + 5) === '\'"\'"\'') {
          word += "'";
          i += 5;
          continue;
        }
        i += 1;
        closed = true;
        break;
      }
      if (command[i] === '\x00' || command[i] === '\r' || command[i] === '\n') {
        return null;
      }
      word += command[i];
      i += 1;
    }
    if (!closed) return null;
    argv.push(word);
    if (i === n) break;
    if (command[i] !== ' ') return null;
    i += 1;
    if (i >= n) return null;
  }
  if (argv.length === 0) return null;
  let rendered;
  try {
    rendered = renderPosixDirect(argv);
  } catch (err) {
    return null;
  }
  return rendered === command ? argv : null;
}

  return Object.freeze({
    renderPosixDirect, parsePosixDirect,
  });
}

module.exports = { createPosixDirect };
