'use strict';

/**
 * Conservative shell-command intent parser used by advisory runtime hooks.
 *
 * It is intentionally not the push authority: the installed git pre-push hook
 * remains the portable enforcement point.  This parser only decides whether a
 * Bash tool request should receive the additional runtime actor-policy check.
 * It tokenizes executable words, separators and nested command substitutions;
 * quoted prose passed to non-executing commands is never searched as text.
 */

const EXEC_WRAPPERS = new Set([
  'rtk', 'sudo', 'command', 'env', 'xargs', 'time', 'nice', 'nohup',
  'stdbuf', 'setsid', 'doas', 'builtin', 'exec',
]);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const WRAPPER_VALUE_OPTIONS = Object.freeze({
  sudo: new Set(['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from', '-R', '--chroot']),
  doas: new Set(['-u']),
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']),
  nice: new Set(['-n', '--adjustment']),
  stdbuf: new Set(['-i', '--input', '-o', '--output', '-e', '--error']),
  xargs: new Set(['-a', '--arg-file', '-E', '--eof', '-I', '--replace', '-L', '--max-lines', '-n', '--max-args', '-P', '--max-procs', '-s', '--max-chars']),
});
const GIT_VALUE_OPTIONS = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix',
  '--config-env', '--attr-source',
]);
const GIT_FLAG_OPTIONS = new Set([
  '-p', '-P', '--paginate', '--no-pager', '--bare', '--no-replace-objects',
  '--literal-pathspecs', '--no-optional-locks', '--no-lazy-fetch', '-v',
  '--version', '-h', '--help', '--html-path', '--man-path', '--info-path',
]);

function decodeAnsiCString(value) {
  return value.replace(/\\([\\'"abefnrtv])/g, (_m, c) => ({
    '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', e: '\x1b',
    f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
  })[c]);
}

function scan(command) {
  const segments = [];
  const nested = [];
  const pendingHeredocs = [];
  let words = [];
  let word = '';
  let quote = null;
  let ansi = false;
  let ansiStart = -1;

  function pushWord() {
    if (word !== '') words.push(word);
    word = '';
    ansi = false;
    ansiStart = -1;
  }
  function pushSegment() {
    pushWord();
    if (words.length) segments.push(words);
    words = [];
  }
  function readBalanced(start, open, close) {
    let depth = 1;
    let q = null;
    for (let i = start; i < command.length; i += 1) {
      const ch = command[i];
      if (q) {
        if (ch === '\\' && q === '"') i += 1;
        else if (ch === q) q = null;
        continue;
      }
      if (ch === "'" || ch === '"') { q = ch; continue; }
      if (ch === '\\') { i += 1; continue; }
      if (ch === open) depth += 1;
      else if (ch === close && --depth === 0) return i;
    }
    return -1;
  }

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        if (ansi) {
          word = word.slice(0, ansiStart) + decodeAnsiCString(word.slice(ansiStart));
          ansi = false;
          ansiStart = -1;
        }
        quote = null;
      } else if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        word += command[++i];
      } else {
        word += ch;
      }
      continue;
    }
    if (ch === '$' && command[i + 1] === "'") {
      ansi = true;
      ansiStart = word.length;
      quote = "'";
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '$' && command[i + 1] === '(') {
      const end = readBalanced(i + 2, '(', ')');
      if (end !== -1) {
        nested.push(command.slice(i + 2, end));
        word += '__substitution__';
        i = end;
        continue;
      }
    }
    if (ch === '`') {
      let end = i + 1;
      while (end < command.length && command[end] !== '`') {
        if (command[end] === '\\') end += 1;
        end += 1;
      }
      if (end < command.length) {
        nested.push(command.slice(i + 1, end));
        word += '__substitution__';
        i = end;
        continue;
      }
    }
    if (ch === '<' && command[i + 1] === '<') {
      let cursor = i + 2;
      let stripTabs = false;
      if (command[cursor] === '-') { stripTabs = true; cursor += 1; }
      while (command[cursor] === ' ' || command[cursor] === '\t') cursor += 1;
      let delimiter = '';
      const delimiterQuote = command[cursor] === "'" || command[cursor] === '"' ? command[cursor++] : null;
      while (cursor < command.length) {
        const current = command[cursor];
        if (delimiterQuote ? current === delimiterQuote : /[\s;&|(){}]/.test(current)) break;
        delimiter += current;
        cursor += 1;
      }
      if (delimiterQuote && command[cursor] === delimiterQuote) cursor += 1;
      if (delimiter) pendingHeredocs.push({ delimiter, stripTabs });
      word += '__heredoc__';
      i = cursor - 1;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      if (command[i + 1] === '\r' && command[i + 2] === '\n') i += 2;
      else if (command[i + 1] === '\n') i += 1;
      else word += command[++i];
      continue;
    }
    if (ch === '#') {
      if (word === '' && (i === 0 || /\s/.test(command[i - 1]))) {
        while (i < command.length && command[i] !== '\n') i += 1;
        pushSegment();
        continue;
      }
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && command[i + 1] === '\n') i += 1;
      pushSegment();
      while (pendingHeredocs.length) {
        const { delimiter, stripTabs } = pendingHeredocs.shift();
        for (;;) {
          const start = i + 1;
          let end = command.indexOf('\n', start);
          if (end === -1) end = command.length;
          let line = command.slice(start, end).replace(/\r$/, '');
          if (stripTabs) line = line.replace(/^\t+/, '');
          i = end;
          if (line === delimiter || end === command.length) break;
        }
      }
      continue;
    }
    if (/\s/.test(ch)) { pushWord(); continue; }
    if (';&|'.includes(ch)) {
      pushSegment();
      if ((ch === '&' || ch === '|') && command[i + 1] === ch) i += 1;
      continue;
    }
    if ((ch === '(' || ch === '{') && word === '' && words.length === 0) continue;
    if (ch === ')' || ch === '}') { pushSegment(); continue; }
    word += ch;
  }
  pushSegment();
  return { segments, nested };
}

function stripPrefixes(words) {
  let out = words.slice();
  const controlPrefixes = new Set(['!', 'if', 'then', 'elif', 'else', 'while', 'until', 'do']);
  while (out.length) {
    while (out.length && controlPrefixes.has(out[0])) out.shift();
    while (out.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(out[0])) out.shift();
    if (!EXEC_WRAPPERS.has(out[0])) break;
    const wrapper = out.shift();
    const valueOptions = WRAPPER_VALUE_OPTIONS[wrapper] || new Set();
    while (out.length && out[0].startsWith('-')) {
      const token = out.shift();
      if (token === '--') break;
      const option = token.split('=', 1)[0];
      if (!token.includes('=') && valueOptions.has(option) && out.length) out.shift();
    }
    if (wrapper === 'env') {
      while (out.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(out[0])) out.shift();
    }
  }
  return out;
}

function gitSubcommand(words) {
  if (executableName(words[0]) !== 'git') return null;
  let i = 1;
  const inlineAliases = new Map();
  while (i < words.length) {
    const token = words[i];
    if (token === '--') { i += 1; continue; }
    if (token === '--exec-path' || token.startsWith('--exec-path=')) { i += 1; continue; }
    const eq = token.indexOf('=');
    const opt = eq === -1 ? token : token.slice(0, eq);
    if (GIT_VALUE_OPTIONS.has(opt)) {
      const value = eq === -1 ? words[i + 1] : token.slice(eq + 1);
      if (opt === '-c') {
        const alias = /^alias\.([A-Za-z0-9._-]+)=(.+)$/.exec(value || '');
        if (alias) inlineAliases.set(alias[1], alias[2]);
      }
      i += eq === -1 ? 2 : 1;
      continue;
    }
    if (GIT_FLAG_OPTIONS.has(token)) { i += 1; continue; }
    const aliasExpansion = inlineAliases.get(token);
    if (aliasExpansion && /^push(?:\s|$)/.test(aliasExpansion.trim())) return 'push';
    return token;
  }
  return null;
}

function executableName(token) {
  const normalized = String(token || '').replaceAll('\\', '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  return base.endsWith('.exe') ? base.slice(0, -4) : base;
}

function classifySegment(rawWords, nested) {
  const words = stripPrefixes(rawWords);
  if (!words.length) return [];
  const intents = [];
  if (gitSubcommand(words) === 'push') intents.push({ kind: 'git-push', argv: words });
  if (executableName(words[0]) === 'gh' && words[1] === 'pr' && words[2] === 'create') {
    intents.push({ kind: 'gh-pr-create', argv: words });
  }
  const executable = executableName(words[0]);
  let shellPayloadIndex = -1;
  if (SHELLS.has(executable)) {
    for (let index = 1; index < words.length; index += 1) {
      if (words[index] === '--') continue;
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(words[index])) { shellPayloadIndex = index + 1; break; }
      if (!words[index].startsWith('-')) break;
      if (['-O', '+O', '--rcfile', '--init-file'].includes(words[index])) index += 1;
    }
  }
  if (shellPayloadIndex !== -1 || executable === 'eval') {
    const payload = executable === 'eval' ? words.slice(1).join(' ') : words.slice(shellPayloadIndex).join(' ');
    if (payload) nested.push(payload);
  }
  return intents;
}

function parseCommandIntent(command, seen = new Set()) {
  if (typeof command !== 'string' || !command.trim() || seen.has(command)) return [];
  seen.add(command);
  const { segments, nested } = scan(command);
  const intents = segments.flatMap((words) => classifySegment(words, nested));
  for (const payload of nested) intents.push(...parseCommandIntent(payload, seen));
  return intents;
}

function hasIntent(command, kind) {
  return parseCommandIntent(command).some((intent) => intent.kind === kind);
}

module.exports = { parseCommandIntent, hasIntent };
