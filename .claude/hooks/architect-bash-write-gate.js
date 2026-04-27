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
//   - tee to file           tee foo.md (without /dev/null)
//   - plain redirect        > file or >> file to a project path
//
// Exempt write targets (architects DO own these):
//   - /tmp/* and $TMPDIR/*       (debug temp files)
//   - /dev/null and /dev/std*    (stream sinks)
//   - .planning/wave*/arch-*-verdict.md   (architect verdict files)
//   - .androidcommondoc/audit-log.jsonl   (telemetry append)
//
// Exit codes:
//   0 = allow (no violation, or non-arch agent, or non-Bash tool, or parse error)
//   2 = block (with `decision: block` + `reason` JSON on stdout)
//
// Wired in .claude/settings.json under PreToolUse → Bash matcher.

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

  const cmd = data.tool_input?.command ?? '';
  if (!cmd) process.exit(0);

  const violation = detectViolation(cmd);
  if (!violation) process.exit(0);

  const reason = '[arch-bash-write-gate] Architect "' + agentType + '" attempted Bash write via "' + violation.kind + '" (target: ' + (violation.target ?? '<inline>') + '). Architects MUST NOT write project files — even via Bash bypass. Delegate via SendMessage(to="team-lead", summary="need {dev}", message="..."). Exempt write targets: /tmp/*, /dev/null, .planning/wave*/arch-*-verdict.md, .androidcommondoc/audit-log.jsonl.';

  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(2);
});

// ── Detection ────────────────────────────────────────────────────────────────

const HEREDOC_RE = /<<-?\s*['"]?[A-Za-z_]\w*['"]?/;
const REDIRECT_RE = /(?:^|[^0-9&>])>{1,2}\s*(['"]?)([^\s<>|&;'"]+)\1/g;
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
const TEE_WRITE_RE = /\btee\s+(?:-a\s+|--append\s+)?(['"]?)([^-\s|<>;&'"]+)\1/;

function isExemptTarget(target) {
  if (!target) return false;
  if (target === '/dev/null') return true;
  if (target.startsWith('/dev/')) return true;
  if (target.startsWith('/tmp/') || target === '/tmp') return true;
  if (target.startsWith('$TMPDIR/') || target.startsWith('${TMPDIR}/')) return true;
  if (/\.planning[\\/]wave[\w.-]+[\\/]arch-[^\s/\\]+-verdict\.md$/.test(target)) return true;
  if (/\.androidcommondoc[\\/]audit-log\.jsonl$/.test(target)) return true;
  return false;
}

function detectViolation(cmd) {
  if (HEREDOC_RE.test(cmd)) {
    const target = firstNonExemptRedirectTarget(cmd);
    if (target !== undefined) {
      return { kind: 'heredoc redirect', target };
    }
  }

  if (SED_INPLACE_RE.test(cmd)) {
    return { kind: 'sed -i' };
  }

  if (AWK_INPLACE_RE.test(cmd)) {
    return { kind: 'awk -i inplace' };
  }

  if (PYTHON_WRITE_RE.test(cmd)) {
    return { kind: "python -c open(...,'w')" };
  }

  if (PYTHON_HEREDOC_WRITE_RE.test(cmd)) {
    return { kind: "python <<EOF open(...,'w')" };
  }

  for (const match of cmd.matchAll(new RegExp(TEE_WRITE_RE.source, 'g'))) {
    const target = match[2];
    if (target && !isExemptTarget(target)) {
      return { kind: 'tee write', target };
    }
  }

  const target = firstNonExemptRedirectTarget(cmd);
  if (target !== undefined) {
    return { kind: 'shell redirect', target };
  }

  return null;
}

function firstNonExemptRedirectTarget(cmd) {
  const re = new RegExp(REDIRECT_RE.source, 'g');
  let m;
  while ((m = re.exec(cmd)) !== null) {
    const target = m[2];
    if (!target) continue;
    if (!isExemptTarget(target)) return target;
  }
  return undefined;
}
