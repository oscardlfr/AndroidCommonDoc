#!/usr/bin/env node
// context-provider-write-gate.js — PreToolUse/Bash hook
// Owns the CP bundle-write grammar (PLAN.md ~L5465): validates
// scripts/sh/write-bundle.sh's own argv grammar defense-in-depth BEFORE the
// script ever runs, catching a malformed/injected invocation earlier and
// uniformly, and blocks any Bash command that writes directly into
// .planning/wave-*/context-bundles/*.md WITHOUT going through write-bundle.sh
// at all (a bypass of the sanctioned writer).
//
// stdin JSON in, official hookSpecificOutput PreToolUse decision out: deny
// via {hookSpecificOutput:{hookEventName:'PreToolUse', permissionDecision:
// 'deny', permissionDecisionReason}} + exit 0, vs allow via the same schema
// with permissionDecision:'allow' + exit 0; fail-open (bare exit 0, no
// stdout) on any internal/parse error. This hook only ever analyzes
// tool_input.command as text -- it never executes it.
//
// M7 Correction (m7-correction-spec.md §3): the REAL write-bundle.sh
// call-site shape (that script's own usage comment, and every real caller:
// .claude/agents/context-provider.md, setup/agent-templates/
// context-provider.md) is a HEREDOC --
//   bash scripts/sh/write-bundle.sh --role <role> --plan-id "<plan_id>" <<'BODY'
//   ...body...
//   BODY
// -- never a flat argv string. parsePosixDirect's closed single-quoted-per-
// token grammar was built for HOOK-CONSTRUCTED commands (the lifecycle-CLI
// family) and is empirically NOT usable here: it returns null on BOTH the
// full heredoc string AND the natural unquoted/double-quoted argv prefix
// alone (verified directly -- neither shape a real caller ever produces
// satisfies renderPosixDirect's own single-quoted-per-token output form).
// This file therefore implements its own narrow, bounded structural
// tokenizer for THIS exact call-site shape (bash/sh + the exact resolved
// write-bundle.sh path + a flat `--flag value` argv prefix + one recognized
// `<<'BODY'` heredoc marker) -- never a reuse of parsePosixDirect. A future
// reader should not "fix" this into calling parsePosixDirect again: that
// grammar is closed-single-quoted-only and this call site is not.

const path = require('path');

// Grammar transcribed verbatim from scripts/sh/write-bundle.sh (read from
// disk before writing this gate) -- the SAME regexes the script itself
// enforces, never a looser/divergent copy.
const ROLE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PLAN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9/#._-]*$/;
const SLUG_RE = /^[a-z0-9][a-z0-9.-]*$/;
const SLUG_REJECT_LIST = ['develop', 'master', 'main', 'HEAD'];
// A write/append/tee operation whose target path contains context-bundles/ --
// write-bundle.sh itself never accepts that path as an argv token (it always
// computes it internally from --slug/--role), so ANY direct occurrence here
// is a bypass of the sanctioned writer, never a legitimate write-bundle.sh flag.
const BYPASS_WRITE_RE = /(>>?|\btee\b)[^&|;]*context-bundles\//;

const WRITE_BUNDLE_SH_PATH = path.resolve(__dirname, '../../scripts/sh/write-bundle.sh');
const ALLOWED_FLAGS = ['--role', '--plan-id', '--slug'];
// Anchored full-match against the heredoc SUFFIX of the command (everything
// from the first `<<'` onward): the marker must be exactly the single-quoted
// literal 'BODY' (never unquoted/double-quoted -- which would allow
// $()/`` expansion inside the body -- and never a different marker name),
// and nothing may follow the closing `BODY` line (rejects trailing
// chaining appended after an otherwise well-formed invocation).
const HEREDOC_RE = /^<<'BODY'\n([\s\S]*)\nBODY$/;

/**
 * Takes one token off the front of `text`: either a `"..."` double-quoted
 * segment (unquoted, requires whitespace or end-of-string immediately after
 * the closing quote -- no glued trailing chars) or a bare run of
 * non-whitespace characters. Single quotes are never part of this grammar
 * (the real call sites never use them for these flags) -- encountering one
 * is treated as malformed rather than silently mis-tokenized.
 * @param {string} text
 * @returns {{value:string,rest:string}|null}
 */
function takeToken(text) {
  if (text.length === 0) return null;
  if (text[0] === '"') {
    const end = text.indexOf('"', 1);
    if (end === -1) return null;
    const value = text.slice(1, end);
    let i = end + 1;
    if (i < text.length && !/\s/.test(text[i])) return null;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    return { value, rest: text.slice(i) };
  }
  if (text[0] === "'") return null;
  let i = 0;
  while (i < text.length && !/\s/.test(text[i])) i += 1;
  const value = text.slice(0, i);
  let j = i;
  while (j < text.length && /\s/.test(text[j])) j += 1;
  return { value, rest: text.slice(j) };
}

function resolveCandidatePath(raw, projectRoot) {
  const candidate = path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
  return path.resolve(candidate).replace(/\\/g, '/');
}

/**
 * Narrow structural recognizer for the real write-bundle.sh call-site shape.
 * Never a substring/basename match -- `tokens[0]` must be exactly `bash`/
 * `sh`, and the script path token must resolve to the exact canonical
 * write-bundle.sh path (absolute as-is, or resolved against projectRoot when
 * relative -- mirroring the real, documented unquoted-relative call-site
 * form) before ANYTHING past that point is inspected.
 * @returns {{recognized:false}|{recognized:true,ok:true}|{recognized:true,ok:false,reason:string}}
 */
function recognizeWriteBundleInvocation(cmd, projectRoot) {
  const interpMatch = /^(bash|sh)\s+/.exec(cmd);
  if (!interpMatch) return { recognized: false };
  const afterInterp = cmd.slice(interpMatch[0].length);
  const pathToken = takeToken(afterInterp);
  if (!pathToken || pathToken.value.length === 0) return { recognized: false };
  const resolvedCandidate = resolveCandidatePath(pathToken.value, projectRoot);
  const canonical = path.resolve(WRITE_BUNDLE_SH_PATH).replace(/\\/g, '/');
  if (resolvedCandidate !== canonical) return { recognized: false };

  // Recognized as a genuine write-bundle.sh invocation attempt -- every
  // failure from here on is an explicit block, never a fall-through.
  let cursor = pathToken.rest;
  const flagTokens = [];
  while (cursor.length > 0 && !cursor.startsWith("<<'")) {
    const tok = takeToken(cursor);
    if (!tok) {
      return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] malformed argv prefix in write-bundle.sh invocation (unterminated quote).' };
    }
    flagTokens.push(tok.value);
    cursor = tok.rest;
  }
  if (!cursor.startsWith("<<'")) {
    return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] a write-bundle.sh invocation requires the canonical <<\'BODY\' heredoc body.' };
  }
  if (flagTokens.length === 0 || flagTokens.length % 2 !== 0) {
    return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] malformed --flag value argv prefix in write-bundle.sh invocation.' };
  }

  const values = {};
  for (let i = 0; i < flagTokens.length; i += 2) {
    const flag = flagTokens[i];
    const value = flagTokens[i + 1];
    if (!ALLOWED_FLAGS.includes(flag)) {
      return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] unrecognized flag in write-bundle.sh invocation: ' + flag };
    }
    if (Object.prototype.hasOwnProperty.call(values, flag)) {
      return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] duplicate flag in write-bundle.sh invocation: ' + flag };
    }
    values[flag] = value;
  }

  if (!HEREDOC_RE.test(cursor)) {
    return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] non-canonical heredoc form (must be exactly <<\'BODY\' ... BODY at the very end of the command, no trailing content, no unquoted marker).' };
  }

  const role = values['--role'];
  if (typeof role !== 'string') {
    return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] --role is required.' };
  }
  if (!ROLE_RE.test(role)) {
    return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] --role value is invalid: \'' + role + '\' -- must match ' + ROLE_RE };
  }
  const planId = values['--plan-id'];
  if (typeof planId !== 'string') {
    return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] --plan-id is required.' };
  }
  if (!PLAN_ID_RE.test(planId)) {
    return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] --plan-id value is invalid (malformed, or contains an embedded newline / YAML-injection shape)' };
  }
  const slug = Object.prototype.hasOwnProperty.call(values, '--slug') ? values['--slug'] : null;
  if (slug !== null) {
    if (SLUG_REJECT_LIST.includes(slug)) {
      return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] --slug \'' + slug + '\' is a protected branch name and cannot be used as a wave slug.' };
    }
    if (!SLUG_RE.test(slug)) {
      return { recognized: true, ok: false, reason: '[CP-WRITE-GATE] --slug value is invalid: \'' + slug + '\' -- must match ' + SLUG_RE };
    }
  }

  return { recognized: true, ok: true };
}

// Official PreToolUse deny contract (code.claude.com/docs/en/hooks): exit 0,
// hookSpecificOutput{hookEventName:'PreToolUse', permissionDecision:'deny',
// permissionDecisionReason} -- never the deprecated top-level decision:'block'
// + exit 2 shape.
function block(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    if (toolName !== 'Bash') process.exit(0);
    const toolInput = (data.tool_input && typeof data.tool_input === 'object') ? data.tool_input : {};
    const cmd = toolInput.command;
    if (typeof cmd !== 'string' || cmd.length === 0) process.exit(0);

    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const recognition = recognizeWriteBundleInvocation(cmd, projectRoot);
    if (recognition.recognized) {
      if (!recognition.ok) block(recognition.reason);
      // Owning allow: this gate never rewrites the command, it only judges
      // it -- but per PLAN.md ~L600 an owning hook still returns a complete,
      // explicit hookSpecificOutput (never a bare, silent exit 0).
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: Object.assign({}, toolInput),
        },
      }));
      process.exit(0);
    }

    if (BYPASS_WRITE_RE.test(cmd)) {
      block('[CP-WRITE-GATE] Direct write into a context-bundles/ path detected without going through scripts/sh/write-bundle.sh -- use write-bundle.sh, the sanctioned CP bundle writer.');
    }

    process.exit(0); // unrelated bash command -- allow.
  } catch (e) {
    // Fail open -- never block due to script/parse error.
    process.exit(0);
  }
});
