#!/usr/bin/env node
// Blocks arch-* agents from writing project files via Bash bypass patterns.
// Companion to architect-self-edit-gate.js (which blocks the Write/Edit tools).
//
// Bypass patterns covered:
//   - heredoc redirect      cat > foo.md <<EOF ... EOF
//   - in-place sed          sed -i '...' file
//   - in-place awk          awk -i inplace ...
//   - python file write     python3 -c "open('foo','w').write(...)"
//   - python heredoc write  python3 <<'EOF' ... open('foo','w') ... EOF
//   - pathlib write         Path('foo').write_text(...) / pathlib.Path('foo').write_bytes(...)
//   - tee to file           tee foo.md (without /dev/null)
//   - plain redirect        > file or >> file to a project path
//
// Exempt write targets (architects DO own these):
//   - os.tmpdir()/*              (debug temp files, cross-platform — Windows + POSIX)
//   - /tmp/* and $TMPDIR/*       (debug temp files, POSIX literal fallback)
//   - /dev/null and /dev/std*    (stream sinks)
//   - .planning/wave*/arch-*-{verdict,cross-verify}.md   (architect write targets)
//   - .androidcommondoc/audit-log.jsonl   (telemetry append)
//   - .claude/wave-quality-gates/arch-*.md   (architect verdict files — BL-W44-S2 fix)
//
// Exit codes:
//   0 = allow (no violation, or non-arch agent, or non-Bash tool, or parse error)
//   2 = block (with `decision: block` + `reason` JSON on stdout)
//
// Wired in .claude/settings.json under PreToolUse → Bash matcher.

const os = require('os');
const OS_TMPDIR = os.tmpdir();

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0); // fail-open on bad input
  }

  if (data.tool_name !== 'Bash') process.exit(0);
  const agentType = (data.agent_type ?? '').toLowerCase();
  if (!agentType.startsWith('arch-')) process.exit(0);
  if (process.env.BASH_WRITE_GATE_BYPASS === '1') process.exit(0);

  const cmd = data.tool_input?.command ?? '';
  if (!cmd) process.exit(0);

  const violation = detectViolation(cmd);
  if (!violation) process.exit(0);

  const reason = '[arch-bash-write-gate] Architect "' + agentType + '" attempted Bash write via "' + violation.kind + '" (target: ' + (violation.target ?? '<inline>') + '). Architects MUST NOT write project files — even via Bash bypass. Delegate via SendMessage(to="team-lead", summary="need {dev}", message="..."). Exempt write targets: /tmp/*, /dev/null, .planning/wave*/arch-*-{verdict,cross-verify}.md, .androidcommondoc/audit-log.jsonl, .claude/wave-quality-gates/arch-*.md.';

  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(2);
});

// ── Detection ────────────────────────────────────────────────────────────────

const HEREDOC_RE = /<<-?\s*['"]?[A-Za-z_]\w*['"]?/;
const SED_INPLACE_RE = /\bsed\s+(?:[^|<>;&'"]*?(?:-i\b|--in-place\b))/;
const AWK_INPLACE_RE = /\bawk\s+[^|<>;&'"]*?-i\s+inplace\b/;
// `python -c "...open(<file>, 'w')..."` — covers both wrapping quote styles
// and `open()`-style write modes. We don't enforce that the wrapping quote
// closes before a pipe/semi, because architect bypasses are typically a
// single python -c invocation.
const PYTHON_WRITE_RE = /\bpython3?\s+-c\b[^|;&]*?open\s*\([^)]*['"]w[+ab]?['"]/;
// `python3 <<'PYEOF' ... open(<file>,'w') ... PYEOF` — heredoc bypass that
// avoided the `-c` form during W31.5/W31.6 (audit log entry 2026-04-21
// arch-platform editing MIGRATIONS.json). Distinct from PYTHON_WRITE_RE
// because heredoc-fed scripts can contain newlines that the [^|;&] class
// blocks above filter out.
const PYTHON_HEREDOC_WRITE_RE =
  /\bpython3?\s+<<-?\s*['"]?[A-Za-z_]\w*['"]?[\s\S]*?open\s*\([^)]*['"]w[+ab]?['"]/;
// Captures the file path from `open('<path>', 'w')` positional-arg form.
// Declare WITHOUT /g — each call site uses new RegExp(PYTHON_OPEN_TARGET_RE.source, 'g')
// to reset lastIndex state. Mirrors tee handler pattern at line 119.
// kind: "python -c open(...,'w')"  — used by both shell and heredoc forms below.
//        "python <<EOF open(...,'w')" — distinct kind for heredoc bypass form.
const PYTHON_OPEN_TARGET_RE = /\bopen\s*\(\s*['"]([^'"]+)['"][^)]*['"]w[+ab]?['"]/;
// Captures the file path from `Path('<path>').write_text(` and `pathlib.Path(...)` forms.
// Backreference \1 enforces quote consistency (single or double, not mixed).
// Does NOT match: variable args Path(var), raw strings Path(r'...'), f-strings Path(f'...').
// Conservative: those unmatched forms fall through to no-violation (fail-open).
// Declare WITHOUT /g — call sites use new RegExp(PATHLIB_WRITE_RE.source, 'g').
const PATHLIB_WRITE_RE = /(?:pathlib\.)?Path\s*\(\s*(["'])([^"']+)\1\s*\)\.(?:write_text|write_bytes)\s*\(/;
const TEE_WRITE_RE = /\btee\s+(?:-a\s+|--append\s+)?(['"]?)([^-\s|<>;&'"]+)\1/;

function isExemptTarget(target) {
  if (!target) return false;
  if (target === '/dev/null') return true;
  if (target.startsWith('/dev/')) return true;
  const norm = normalizePath(target);
  const normTmp = normalizePath(OS_TMPDIR);
  if (norm.startsWith(normTmp + '/') || norm === normTmp) return true;
  if (target.startsWith('/tmp/') || target === '/tmp') return true;
  if (target.startsWith('$TMPDIR/') || target.startsWith('${TMPDIR}/')) return true;
  if (/\.planning[\\/]wave[\w.-]+[\\/](?:pr\d+-)?arch-[^\s/\\]+-(?:verdict|cross-verify)\.md$/.test(target)) return true;
  if (/\.androidcommondoc[\\/]audit-log\.jsonl$/.test(target)) return true;
  // Architect verdict files in .claude/wave-quality-gates/arch-*.md
  // Pattern: **/.claude/wave-quality-gates/arch-<anything>.md
  // Allows arch-platform-prep-bl-w44-s2-pr1.md, arch-testing-verify-*, etc.
  // Does NOT allow bl-w44-s2-pr1.md (sentinel files — quality-gater writes those, not architects).
  if (/(?:^|[\\/])\.claude[\\/]wave-quality-gates[\\/]arch-[^\s/\\]+\.md$/.test(norm)) return true;
  return false;
}

function detectViolation(cmd) {
  // Scan only non-body lines so heredoc body content is never misread as
  // a redirect. The opener line (which contains the real target) is included.
  const commandLines = splitCommandLines(cmd);

  const redirectTargets = [];
  for (const line of commandLines) {
    collectRedirectTargets(line, redirectTargets);
  }

  const firstBadRedirect = redirectTargets.find(t => t && !isExemptTarget(t));
  if (firstBadRedirect !== undefined) {
    const isHeredoc = HEREDOC_RE.test(cmd);
    return { kind: isHeredoc ? 'heredoc redirect' : 'shell redirect', target: firstBadRedirect };
  }

  if (SED_INPLACE_RE.test(cmd)) {
    return { kind: 'sed -i' };
  }

  if (AWK_INPLACE_RE.test(cmd)) {
    return { kind: 'awk -i inplace' };
  }

  if (PYTHON_WRITE_RE.test(cmd)) {
    let foundTarget = false;
    for (const match of cmd.matchAll(new RegExp(PYTHON_OPEN_TARGET_RE.source, 'g'))) {
      foundTarget = true;
      const target = match[1];
      if (target && !isExemptTarget(target)) {
        return { kind: "python -c open(...,'w')", target };
      }
    }
    if (!foundTarget) {
      // Defensive: PYTHON_WRITE_RE matched but no capture — block conservatively.
      return { kind: "python -c open(...,'w')", target: '<inline>' };
    }
  }

  if (PYTHON_HEREDOC_WRITE_RE.test(cmd)) {
    let foundTarget = false;
    for (const match of cmd.matchAll(new RegExp(PYTHON_OPEN_TARGET_RE.source, 'g'))) {
      foundTarget = true;
      const target = match[1];
      if (target && !isExemptTarget(target)) {
        return { kind: "python <<EOF open(...,'w')", target };
      }
    }
    if (!foundTarget) {
      // Defensive: PYTHON_HEREDOC_WRITE_RE matched but no capture — block conservatively.
      return { kind: "python <<EOF open(...,'w')", target: '<inline>' };
    }
  }

  if (PATHLIB_WRITE_RE.test(cmd)) {
    let foundTarget = false;
    for (const match of cmd.matchAll(new RegExp(PATHLIB_WRITE_RE.source, 'g'))) {
      foundTarget = true;
      const target = match[2]; // group 1 = quote char, group 2 = path
      if (target && !isExemptTarget(target)) {
        return { kind: "python pathlib.Path(...).write_text()", target };
      }
    }
    if (!foundTarget) {
      // Defensive: PATHLIB_WRITE_RE matched but no capture — block conservatively.
      return { kind: "python pathlib.Path(...).write_text()", target: '<inline>' };
    }
  }

  for (const match of cmd.matchAll(new RegExp(TEE_WRITE_RE.source, 'g'))) {
    const target = match[2];
    if (target && !isExemptTarget(target)) {
      return { kind: 'tee write', target };
    }
  }

  return null;
}

// Returns only the non-body lines of a command (heredoc bodies are skipped).
// Malformed heredoc (no terminator) → remaining lines treated as body and
// skipped, which is fail-open (no false block on malformed input).
function splitCommandLines(cmd) {
  const lines = cmd.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const hd = /<<(-?)\s*(?:'([^']+)'|"([^"]+)"|(\S+))/.exec(line);
    if (hd) {
      const dashed = hd[1] === '-';
      const delim = hd[2] || hd[3] || hd[4];
      result.push(line); // opener line: included (real redirect target is here)
      i++;
      // skip body lines until the terminating delimiter
      while (i < lines.length) {
        const bodyLine = lines[i];
        const trimmed = dashed ? bodyLine.replace(/^\t+/, '') : bodyLine;
        i++;
        if (trimmed === delim) break;
      }
    } else {
      result.push(line);
      i++;
    }
  }
  return result;
}

// Structural bash tokenizer: walks the line character-by-character, tracking
// quote state and skipping over non-redirect > characters (e.g. -> arrows,
// --flag> patterns, >= comparisons, >>= shift-assign, 2>&1 fd duplication).
// Only yields targets for genuine shell output redirects: >/>> preceded by an
// optional fd digit (or nothing) and NOT preceded by -, =, another >, or &.
function collectRedirectTargets(line, targets) {
  const len = line.length;
  let i = 0;
  while (i < len) {
    const ch = line[i];

    // Skip single-quoted strings (no escapes inside '...')
    if (ch === "'") {
      i++;
      while (i < len && line[i] !== "'") i++;
      i++; // closing quote
      continue;
    }

    // Skip double-quoted strings (handle \" escapes)
    if (ch === '"') {
      i++;
      while (i < len && line[i] !== '"') {
        if (line[i] === '\\') i++; // skip escaped char
        i++;
      }
      i++; // closing quote
      continue;
    }

    // Look for > redirect operator
    if (ch === '>') {
      // Determine what precedes the >
      const prev = i > 0 ? line[i - 1] : '';

      // Reject: -> arrow, --flag>, >= comparison, >>= shift, 2>&1 fd-dup &>
      if (prev === '-' || prev === '=' || prev === '>' || prev === '&') {
        i++;
        continue;
      }

      // Accept: optional leading digit (fd number like 2>) or word boundary
      // prev is digit (fd redirect like 2>), space, ;, |, (, or start-of-line
      const isValidPreceding = prev === '' || /[\d\s;|(]/.test(prev);
      if (!isValidPreceding) {
        i++;
        continue;
      }

      // Skip optional second > (>>)
      let j = i + 1;
      if (j < len && line[j] === '>') j++;

      // Reject >= (append-assign or comparison)
      if (j < len && line[j] === '=') {
        i++;
        continue;
      }

      // Reject >& fd duplication (e.g. >&2, 2>&1)
      if (j < len && line[j] === '&') {
        i++;
        continue;
      }

      // Skip whitespace after >
      while (j < len && (line[j] === ' ' || line[j] === '\t')) j++;

      if (j >= len) { i++; continue; }

      // Extract the target token (up to whitespace, |, ;, &, <, >)
      const startQ = line[j];
      let target = '';
      if (startQ === "'" || startQ === '"') {
        // Quoted target
        j++;
        while (j < len && line[j] !== startQ) {
          if (startQ === '"' && line[j] === '\\') j++;
          target += line[j++];
        }
        j++; // closing quote
      } else {
        while (j < len && !/[\s|;&<>]/.test(line[j])) {
          target += line[j++];
        }
      }

      if (target) targets.push(target);
      i = j;
      continue;
    }

    i++;
  }
}
