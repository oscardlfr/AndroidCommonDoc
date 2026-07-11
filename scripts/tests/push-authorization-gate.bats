#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for .claude/hooks/push-authorization-gate.js (BL-W47 Commits 10a/10b/10d).
# Replaces the two retired gates: quality-gate-pre-push.sh and pre-push-pre-pr-gate.js.
#
# Gate contract (H1 -- Push Authority Bootstrap REWRITE; the stamp/proof-content
# fallback described by earlier revisions of this comment is fully removed):
#   - Peer/subagent (non-empty agent_type) + git push → BLOCK (exit 2), unconditionally
#   - Main orchestrator (empty agent_type) + git-layer pre-push hook installed,
#     executable, marker-bearing, AND byte-identical (CRLF-normalized) to canonical
#     scripts/sh/pre-push-hook.sh (verified via scripts/sh/verify-git-hooks.sh,
#     delegated to via spawnSync) → ALLOW (exit 0)
#   - Main orchestrator + hook absent / not executable / marker-missing / drifted
#     → BLOCK (exit 2) -- unconditional, regardless of any stamp/proof/bats_evidence
#     state; push-authorization-gate.js no longer reads push-proof.json or any
#     .androidcommondoc/*.stamp file at all (Design Fidelity User-3)
#   - Main orchestrator + verify-git-hooks.sh invocation itself throws, errors, times
#     out, or exits non-zero for any reason → BLOCK (exit 2), LOCALLY handled, never
#     the file's own global fail-open catch (Amendment 3)
#   - PUSH_AUTHORIZATION_BYPASS=1 → ALLOW regardless of agent or hook state
#   - "rtk git push" command string → also BLOCK for peers (regex covers both forms)
#   - Non-push commands → always ALLOW (exit 0)
#
# Infra: JSON-piped-to-node. All stamp files written to tmpdir (never live project).
# setup() also copies scripts/sh/verify-git-hooks.sh and the canonical
# scripts/sh/pre-push-hook.sh source into the isolated $PROJECT_ROOT, since the
# main-orchestrator branch resolves the verifier script path relative to
# $PROJECT_ROOT (via CLAUDE_PROJECT_DIR) -- without both files present, every
# main-orchestrator test would hit a generic "script not found" failure instead of
# a real reason code.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/push-authorization-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR}/push-auth-input-$$.json"

setup() {
  # Isolated project root in tmpdir; no real .git/hooks present unless the test creates one.
  # git init + initial commit so getHeadSha() returns a valid 40-hex SHA for stamp binding.
  # Without git init, HEAD is null and the hook's head-binding check is silently skipped,
  # masking PA-5 locally when the live repo's pre-push hook leaks in via cwd traversal.
  PROJECT_ROOT="${BATS_TEST_TMPDIR}/proj-$$"
  STAMP_DIR="$PROJECT_ROOT/.androidcommondoc"
  mkdir -p "$STAMP_DIR"
  git -C "$PROJECT_ROOT" init -q 2>/dev/null
  git -C "$PROJECT_ROOT" config user.email "bats@test.local"
  git -C "$PROJECT_ROOT" config user.name "Bats Test"
  git -C "$PROJECT_ROOT" commit --allow-empty -q -m "init" 2>/dev/null
  HEAD_SHA="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
  unset PUSH_AUTHORIZATION_BYPASS
  # H1: the main-orchestrator branch of push-authorization-gate.js now delegates to
  # scripts/sh/verify-git-hooks.sh via spawnSync, resolved as
  # path.join(projectRoot, 'scripts', 'sh', 'verify-git-hooks.sh') -- so the verifier
  # script itself must exist inside the isolated PROJECT_ROOT for that spawnSync call
  # to find and execute it at all. Without this, bash exits 127 (script not found,
  # empty stdout) for EVERY main-orchestrator test regardless of hook state, and the
  # gate's reasonCode extraction (which reads only stdout) falls back to "unknown" --
  # masking every real reason code below behind a generic, indistinguishable failure.
  # verify-git-hooks.sh's OWN canonical-source-missing check (checked FIRST,
  # unconditionally) reads "$REPO_ROOT/scripts/sh/pre-push-hook.sh", so the canonical
  # source must ALSO be present at that path -- separate from any per-test
  # .git/hooks/pre-push INSTALL below, which is the installed-hook location the
  # verifier compares the canonical source against, not the source itself.
  mkdir -p "$PROJECT_ROOT/scripts/sh"
  cp "$BATS_TEST_DIRNAME/../sh/verify-git-hooks.sh" "$PROJECT_ROOT/scripts/sh/verify-git-hooks.sh"
  cp "$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh" "$PROJECT_ROOT/scripts/sh/pre-push-hook.sh"
}

teardown() {
  rm -rf "${BATS_TEST_TMPDIR}/proj-$$"
}

# Build JSON envelope for a Bash tool call.
# Args: <command> [agent_type]
make_input() {
  local cmd="$1" agent="${2-}"
  python3 - "$cmd" "$agent" "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd, agent, path = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"tool_name": "Bash", "tool_input": {"command": cmd}}
if agent:
    payload["agent_type"] = agent
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | PUSH_AUTHORIZATION_BYPASS='' CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
}

# Write a stamp file (quality-gate.stamp or pre-pr.stamp).
# Args: <filename> [verdict=PASS] [age_secs=0] [head=""]
write_stamp() {
  local fname="$1" verdict="${2:-PASS}" age_secs="${3:-0}" head="${4:-}"
  python3 - "$STAMP_DIR/$fname" "$verdict" "$age_secs" "$head" <<'PYEOF'
import json, sys, time, datetime
path, verdict, age_secs, head = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
ts = datetime.datetime.fromtimestamp(time.time() - age_secs, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(path, "w") as f:
    json.dump({"verdict": verdict, "timestamp": ts, "head": head}, f)
PYEOF
}

# H1 NOTE: write_canonical_proof() and patch_bats_evidence_field() (the in-JS
# 7/8/13-check push-proof.json + quality-gate-report.json fixture writers, and the
# bats_evidence-field mutator built on top of them) were removed here. Both are
# fully dead post-H1: they existed solely to construct fixtures for the in-JS
# fallback (JS :319-523, checks 1-13) that push-authorization-gate.js's
# main-orchestrator branch no longer has -- that branch delegates 100% to
# verify-git-hooks.sh and never reads push-proof.json, quality-gate-report.json, or
# any .androidcommondoc/*.stamp file again (Design Fidelity User-3: pure
# precondition, no new schema field, nothing to verify at this layer). Their former
# callers (PA-JS1-4, PA-CR3-A/B, #PAG-EV1/#PAG-EV2, #PAG-BE1-5) are deleted below as
# dead code exercising an unreachable path; PA-4c/PA-5/#PAG-EV3 (which also used to
# call write_canonical_proof) had those now-inert calls dropped rather than kept, to
# avoid misleadingly implying proof content still matters. write_stamp() above
# remains live (PA-6-10 still use it) and is unaffected.

# ── Peer/subagent BLOCK cases ────────────────────────────────────────────────

@test "PA-1 BLOCK: peer agent (non-empty agent_type) + git push → blocked unconditionally" {
  make_input "git push origin feature/test" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
  [[ "$output" == *"toolkit-specialist"* ]]
}

@test "PA-2 BLOCK: peer agent + rtk git push → also blocked (rtk prefix covered by regex)" {
  make_input "rtk git push origin feature/test" "arch-platform"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-3 BLOCK: suffix-rotated peer (toolkit-specialist-2) + git push → blocked" {
  make_input "git push origin feature/test" "toolkit-specialist-2"
  run_hook
  [ "$status" -eq 2 ]
}

# ── Main orchestrator: pre-push hook installed → ALLOW ──────────────────────

@test "PA-4 ALLOW: main (empty agent_type) + git push + ACDoc pre-push hook installed → allowed" {
  # P1b fix: gate must verify the hook contains the ACDOC-PRE-PUSH-GATE marker — not just
  # check existsSync. Install the real marker-bearing hook from the repo source.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  cp "$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh" "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-4b BLOCK: main + bare stub hook (no ACDOC marker) → blocked on hook-marker-missing (H1: no stamp fallback remains)" {
  # Codex repro (P1b, pre-H1): a foreign tool's bare stub hook 'exit 0' should NOT be
  # trusted. H1 REWRITE (PLAN v2 Path-Manifest Group D, arch-testing Check 3/3d): the
  # in-JS stamp-validation fallback this test originally exercised (JS :319-523, now
  # fully removed) no longer exists at all -- the main-orchestrator branch delegates
  # 100% to scripts/sh/verify-git-hooks.sh. A marker-less stub trips that verifier's
  # hook-marker-missing check (chain: canonical source present via setup(), hook file
  # present+executable [both satisfied] -- no ACDOC-PRE-PUSH-GATE marker [TRIPPED]) --
  # BLOCKED regardless of any stamp state, so the stamp-writing lines this test used
  # to need are gone; keeping them would misleadingly imply they still matter.
  #
  # Tightened (arch-testing 3d, the sharpest single item in PREP review): the original
  # loose 3-way OR (*"stamp"*/*"pre-pr"*/*"quality-gate"*) proved only "some stamp-ish
  # word appeared somewhere" -- it would have silently stayed green even against a
  # gate that blocks for a completely unrelated reason, had the new install-instruction
  # text happened to also mention "quality-gate" by house-style coincidence (it does
  # not, in the landed text, but a loose substring is fragile by construction and
  # proves nothing about WHICH check fired). Pin the structured decision field PLUS
  # the specific hook-marker-missing reason code instead.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  printf '#!/bin/sh\nexit 0\n' > "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-marker-missing"* ]]
}

@test "PA-4c BLOCK: main + bare stub hook (no ACDOC marker) + canonical-valid proof → blocked on hook-marker-missing (H1 outcome-flip)" {
  # OUTCOME-FLIP (PLAN v2 Path-Manifest Group D / Risk R7, arch-testing Check 3/3b):
  # this test used to ALLOW via the removed in-JS stamp-validation fallback's full
  # 7/8-check pass -- proof content, once "canonical-valid", was enough to earn a
  # push even through a marker-less stub hook. Under H1 that fallback no longer
  # exists: push-authorization-gate.js's main-orchestrator branch never reads
  # push-proof.json/stamp files at all, so no amount of valid proof content can
  # substitute for hook state anymore (Design Fidelity User-3 -- pure precondition,
  # this gate does not gain a new schema field, it just stops looking at the old
  # ones). The bare, marker-less stub trips verify-git-hooks.sh's hook-marker-missing
  # check the same way PA-4b's does -- this fixture differs from PA-4b only in that
  # it ALSO writes a flawless canonical proof, which now has zero bearing on the
  # outcome. The stamp/proof-writing calls are deliberately dropped (not merely
  # left inert) since keeping them would misleadingly suggest they still matter.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  printf '#!/bin/sh\nexit 0\n' > "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-marker-missing"* ]]
}

# ── Main orchestrator: no pre-push hook + fallback stamps ───────────────────

@test "PA-5 BLOCK: main + no pre-push hook + canonical-valid proof → blocked on hook-absent (H1 outcome-flip)" {
  # OUTCOME-FLIP (PLAN v2 Path-Manifest Group D / Risk R7, arch-testing Check 3/3b):
  # this was the flagship "fallback still works" ALLOW test -- no hook at all, but a
  # flawless canonical proof (valid stamps + full 7/8-check-passing push-proof.json)
  # used to be sufficient on its own. Under H1 there is no fallback left: the
  # main-orchestrator branch delegates 100% to verify-git-hooks.sh, which only knows
  # about the git-layer hook's installation/canonicalness -- it never reads
  # push-proof.json or any .stamp file. With no .git/hooks/pre-push installed at all,
  # the chain trips hook-absent (canonical-source-missing satisfied via setup()'s new
  # scripts/sh/pre-push-hook.sh copy; hook-absent TRIPPED since no installed hook
  # exists) -- BLOCKED, regardless of proof content. Stamp/proof writes dropped: they
  # no longer affect the outcome, and keeping them would misleadingly suggest
  # otherwise. See #PAG-HOOKCHECK-ABSENT below for the dedicated, explicitly-named
  # H1 regression pin for this same hook-absent reason code; this test is retained
  # under its original PA-5 name for continuity with the wave's R7 inventory.
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-absent"* ]]
}

#
# PA-6..PA-10 (H1 NOTE, found during the R7 pass, not individually named in the W-C
# dispatch's own itemized list but sharing the exact same doomed shape as the tests
# that were named): all five fixtures install NO pre-push hook and previously
# differentiated FIVE distinct stamp problems (missing quality-gate.stamp, missing
# pre-pr.stamp, stale quality-gate.stamp, stale pre-pr.stamp, FAIL verdict). Every
# one of those problems lived entirely inside the removed in-JS fallback
# (JS :319-523) -- push-authorization-gate.js's main-orchestrator branch no longer
# reads .androidcommondoc/*.stamp at all post-H1, so none of these five variations
# can produce a different outcome any more: all five now hit the identical
# hook-absent path (no hook installed, canonical source present via setup()), the
# same shape as PA-5 above and #PAG-HOOKCHECK-ABSENT below. Their old assertions
# (exact-substring "quality-gate.stamp" / "pre-pr.stamp") do not appear anywhere in
# the new block messages (verified against the landed JS text) and would fail
# loudly, not silently -- confirming these are genuinely dead, not just stale.
# Retained (not deleted) as five historical fixture-shape pins per-stamp-scenario,
# each individually tightened to the new hook-absent reason, since the dispatch's
# explicit disposition list did not name them for deletion and a conservative
# tighten-in-place avoids second-guessing that scope boundary; flagged for
# arch-testing review as an extension beyond the six named items.
#
@test "PA-6 BLOCK: main + no pre-push hook + missing quality-gate.stamp → blocked on hook-absent (H1: stamps no longer read)" {
  # Only pre-pr.stamp present; quality-gate.stamp absent -- irrelevant post-H1.
  write_stamp "pre-pr.stamp" "PASS" 0 ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-absent"* ]]
}

@test "PA-7 BLOCK: main + no pre-push hook + missing pre-pr.stamp → blocked on hook-absent (H1: stamps no longer read)" {
  write_stamp "quality-gate.stamp" "PASS" 0 ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-absent"* ]]
}

@test "PA-8 BLOCK: main + no pre-push hook + stale quality-gate.stamp (35 min) → blocked on hook-absent (H1: stamps no longer read)" {
  write_stamp "quality-gate.stamp" "PASS" $((35 * 60)) ""
  write_stamp "pre-pr.stamp"       "PASS" 0             ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-absent"* ]]
}

@test "PA-9 BLOCK: main + no pre-push hook + stale pre-pr.stamp (35 min) → blocked on hook-absent (H1: stamps no longer read)" {
  write_stamp "quality-gate.stamp" "PASS" 0             ""
  write_stamp "pre-pr.stamp"       "PASS" $((35 * 60)) ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-absent"* ]]
}

@test "PA-10 BLOCK: main + no pre-push hook + FAIL verdict in quality-gate.stamp → blocked on hook-absent (H1: stamps no longer read)" {
  write_stamp "quality-gate.stamp" "FAIL" 0 ""
  write_stamp "pre-pr.stamp"       "PASS" 0 ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-absent"* ]]
}

# ── Bypass ────────────────────────────────────────────────────────────────────

@test "PA-11 ALLOW: PUSH_AUTHORIZATION_BYPASS=1 allows peer push regardless" {
  make_input "git push origin feature/test" "toolkit-specialist"
  run bash -c "cat '$INPUT_FILE' | PUSH_AUTHORIZATION_BYPASS=1 CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "PA-12 ALLOW: PUSH_AUTHORIZATION_BYPASS=1 allows main push with no stamps" {
  # No stamps at all — bypass should still allow
  make_input "git push origin feature/test"
  run bash -c "cat '$INPUT_FILE' | PUSH_AUTHORIZATION_BYPASS=1 CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── Non-push commands: always ALLOW ──────────────────────────────────────────

@test "PA-13 ALLOW: git commit (non-push) from peer passes through" {
  make_input "git commit -m 'chore: update'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-14 ALLOW: non-Bash tool from peer passes through" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({"tool_name": "Read", "tool_input": {"file_path": "foo.md"}, "agent_type": "toolkit-specialist"}, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-15 ALLOW: malformed JSON → fail-open (exit 0)" {
  printf '%s' '{not json' > "$INPUT_FILE"
  run_hook
  [ "$status" -eq 0 ]
}

# ── CR-3 (df1a5d1): unconditional head-sha validation in push-authorization-gate

# ── P2a: segment-aware push detector — compound + prose false-positive ────────
# Codex repro cases: the old single-regex isGitPushCommand fired on prose strings
# and missed compound commands (echo ok && git push ...).

@test "PA-P2A-5 BLOCK: peer + compound 'echo ok && git push origin x' → blocked (segment-aware)" {
  # Codex repro: old regex didn't catch compound commands — segment-aware fix must catch the
  # second segment 'git push origin x' even though the full string starts with 'echo ok'.
  make_input "echo ok && git push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-6 BLOCK: peer + 'true; git push origin x' (semicolon separator) → blocked" {
  make_input "true; git push origin x" "arch-platform"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-7 ALLOW: main + printf prose 'remember: git push origin feature/test' → isGitPushCommand returns false → exit 0" {
  # False-positive fix (P2a): prose inside a printf/echo string is NOT a real push command.
  # RED trace: BEFORE fix, the single-regex `\bgit\s+push\b` fires on the literal text
  # inside the printf argument → isGitPushCommand returns true → gate reaches stamp check
  # → no stamps + no hook → exit 2 (blocked for wrong reason).
  # GREEN trace: AFTER fix, the segment-aware detector strips quoted spans (or only inspects
  # real shell segments) → isGitPushCommand returns false → gate exits 0 immediately at
  # `if (!isGitPushCommand(cmd)) process.exit(0)` before any stamp logic.
  # Assertion: plain exit 0 — no stamp fallback reached, no hook checked.
  make_input "printf 'remember: git push origin feature/test\n'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-P2A-8 ALLOW: main + 'echo \"git push\"' (push in double-quoted string) → exit 0" {
  # Same false-positive fix: 'git push' inside a double-quoted echo argument is prose.
  # BEFORE fix: regex fires on the echo argument text → stamp fallback → exit 2.
  # AFTER fix: segment-aware detector ignores quoted spans → exit 0.
  make_input 'echo "git push"'
  run_hook
  [ "$status" -eq 0 ]
}

# ── P2a follow-up: shell-exec wrapper bypass (CodeRabbit/Codex — post-ship) ────
# The segment-aware quote-strip correctly kills printf/echo prose (PA-P2A-7/8),
# but also strips the PAYLOAD of sh/bash -c "..." — which is EXECUTED code, not prose.
# Fix: recurse into sh|bash|zsh|dash|ksh -c/-lc payloads before quote-stripping.
# PA-P2A-9/10/11: RED now (exits 0, should be 2); GREEN after toolkit's recursive fix.
# PA-P2A-12/13: guard cases — must stay/go GREEN (no over-block).

@test "PA-P2A-9 BLOCK: peer + sh -c 'git push origin x' → BLOCK (shell-exec wrapper)" {
  # Bypass: isGitPushCommand strips the quoted 'git push origin x' payload as prose.
  # Fix: detect sh -c / bash -lc pattern → recurse into quoted payload.
  # BEFORE fix: exits 0 (push allowed through wrapper). RED.
  # AFTER fix: recursive detection finds 'git push origin x' → exit 2.
  make_input "sh -c 'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-10 BLOCK: peer + bash -lc \"git push origin x\" → BLOCK (login-shell wrapper)" {
  # Same bypass via bash -lc (login shell invocation).
  # BEFORE fix: exits 0. RED.
  # AFTER fix: recursive detection → exit 2.
  make_input 'bash -lc "git push origin x"' "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-11 BLOCK: peer + sh -c 'echo ok && git push origin x' → BLOCK (compound in payload)" {
  # Compound command inside sh -c payload — recursive detection must handle && in payload.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: recurse into payload → segment-aware split finds 'git push origin x' → exit 2.
  make_input "sh -c 'echo ok && git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-12 ALLOW: peer + sh -c \"echo 'git push'\" → ALLOW (payload only echoes prose)" {
  # Guard: recursing into the sh -c payload finds 'echo ...' not a real push.
  # The echo argument 'git push' is prose inside the payload — must NOT over-block.
  # Must stay GREEN before and after the fix.
  make_input "sh -c \"echo 'git push'\"" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-P2A-13 ALLOW: main + printf 'remember: git push origin x' (no stamps) → ALLOW (prose still works)" {
  # Guard: confirms PA-P2A-7-style prose detection still works after recursive fix.
  # main role + no stamps + no hook → prose correctly not detected → exit 0.
  # Must stay GREEN before and after the fix.
  make_input "printf 'remember: git push origin x\n'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-P2A-14 BLOCK: peer + zsh -c 'git push origin x' → BLOCK (zsh shell-exec wrapper)" {
  # Same class of bypass as PA-P2A-9/10 — zsh -c wraps executed payload.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: recursive shell-exec detection finds 'git push' → exit 2.
  make_input "zsh -c 'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-15 BLOCK: peer + env sh -c 'git push origin x' → BLOCK (env-prefixed shell exec)" {
  # env sh -c is another shell-exec pattern; 'env' before 'sh' must not bypass detection.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: recursive detection handles env-prefixed shell launch → exit 2.
  make_input "env sh -c 'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-16 BLOCK: peer + eval 'git push origin x' → BLOCK (eval bypass)" {
  # eval executes its argument as a shell command — 'git push' inside the string is real.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: eval detected as a shell-exec wrapper → recurse → exit 2.
  make_input "eval 'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-17 BLOCK: peer + \$(git push origin x) command-substitution → BLOCK" {
  # Command substitution \$(git push ...) executes the command.
  # The segment-aware detector strips \$(...) content as a quoted span → bypassed.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: command-substitution content inspected → exit 2.
  make_input '$(git push origin x)' "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-18 BLOCK: peer + backtick \`git push origin x\` command-substitution → BLOCK" {
  # Backtick command substitution — same as \$(...) but legacy syntax.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: backtick content inspected → exit 2.
  make_input '`git push origin x`' "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-19 BLOCK: peer + command git push origin x → BLOCK (command builtin bypass)" {
  # 'command' builtin bypasses shell functions/aliases but still executes git push.
  # isGitPushCommand must recognise 'command git push' as a push.
  # BEFORE fix: exits 0 (not matched by /^git\s+push\b/ after strip). RED.
  # AFTER fix: 'command' prefix stripped → git push detected → exit 2.
  make_input "command git push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-20 BLOCK: peer + xargs git push → BLOCK (xargs bypass)" {
  # xargs passes stdin lines as arguments to git push — real push execution.
  # BEFORE fix: exits 0. RED.
  # AFTER fix: xargs git push pattern detected → exit 2.
  make_input "xargs git push" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-21 BLOCK: peer + time git push origin x → BLOCK (time prefix bypass)" {
  # 'time' measures execution time of the command — git push still executes.
  # BEFORE fix: exits 0 (time not stripped, git push not first token). RED.
  # AFTER fix: time/nice/sudo prefix stripping extended → git push detected → exit 2.
  make_input "time git push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-23 BLOCK: peer + eval git push origin x (unquoted) → BLOCK (eval prefix-strip)" {
  # Unquoted form: 'eval git push origin x' — the whole remainder IS the push command.
  # Differs from PA-P2A-16 which tests eval 'git push origin x' (quoted payload).
  # BEFORE fix: 'eval' not stripped → first token 'eval' ≠ 'git' → exits 0. RED.
  # AFTER fix: eval stripped as a prefix → 'git push origin x' detected → exit 2.
  make_input "eval git push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-24 BLOCK: peer + bash -lc \$'git push origin x' (ANSI-C quoting) → BLOCK" {
  # ANSI-C quoting $'...' is treated as a quoted span by the Pass-1 quote-strip regex,
  # so the payload 'git push origin x' is stripped as prose before shell-exec recursion.
  # Fix: extend Pass-1 regexes to also match $'...' spans so they are NOT stripped.
  # BEFORE fix: $'git push origin x' stripped → shell-exec payload empty → exits 0. RED.
  # AFTER fix: $'...' preserved → recursive detection finds 'git push origin x' → exit 2.
  make_input "bash -lc \$'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-25 BLOCK: peer + sh -c \$'echo ok && git push origin x' (ANSI-C compound) → BLOCK" {
  # Compound command inside an ANSI-C-quoted sh -c payload.
  # BEFORE fix: $'...' stripped → recursive payload empty → exits 0. RED.
  # AFTER fix: payload preserved → segment split finds 'git push origin x' → exit 2.
  make_input "sh -c \$'echo ok && git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-26 BLOCK: peer + eval \$'git push origin x' (ANSI-C eval payload) → BLOCK" {
  # eval with ANSI-C-quoted argument — $'git push origin x' is the executed command.
  # BEFORE fix: $'...' stripped as prose → 'eval' prefix-stripped → nothing left → exits 0. RED.
  # AFTER fix: $'...' preserved → eval recursion finds 'git push origin x' → exit 2.
  make_input "eval \$'git push origin x'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"push-authorization-gate"* ]]
}

@test "PA-P2A-27 ALLOW: peer + echo \$'git push' (ANSI-C prose) → ALLOW (no real push)" {
  # Guard: $'git push' inside an echo argument is prose — must NOT over-block.
  # Stays GREEN before and after the ANSI-C fix.
  make_input "echo \$'git push'" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PA-P2A-22 ALLOW: peer + echo \"\$(date) pushed ok\" → ALLOW (command-sub in prose, no real push)" {
  # Guard: command substitution \$(date) inside an echo argument is prose — the command
  # inside \$() is 'date', not 'git push'. Must NOT over-block.
  # Stays GREEN before and after the deep fix.
  make_input 'echo "$(date) pushed ok"' "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# ── H1 dead-code disposition (PLAN v2 Path-Manifest Group D / Risk R7, the
# complete itemized W-C pass) ──────────────────────────────────────────────────
#
# DELETED below: PA-CR3-A/PA-CR3-B (head-format validation), PA-JS1-4 (in-JS
# required-step-coverage / tampered-report / manifest_version-mismatch checks),
# #PAG-EV1/#PAG-EV2 (bats_evidence absent/mismatched), #PAG-BE1-5 (bats_evidence
# completeness sub-checks: not_ok/scope/complete/total/ok). Every one of these
# fixtures installs NO pre-push hook and exercises a piece of the in-JS fallback
# (JS :319-523) that push-authorization-gate.js's main-orchestrator branch no
# longer has at all -- under H1 every one of them would hit the new hook-absent
# BLOCK before ever reaching the stamp/proof-content logic they claim to test,
# making them silently test nothing (PA-JS1's own loose `*"BLOCKED"*` assertion is
# the sharpest illustration: it would keep passing, for the wrong reason, forever).
# Consolidated to ONE representative "no-hook-installed, any stamp/proof state,
# still BLOCK for hook-absent reason" test per the plan's own explicit disposition
# rule -- see #PAG-HOOKCHECK-ABSENT below (and PA-5/PA-6-10 above, independently).
#
# KEPT + FLIPPED: #PAG-EV3 (below) -- was the ALLOW positive control proving
# #PAG-EV1/#PAG-EV2 exercised a real check rather than an unconditional block.
# Since EV1/EV2 are deleted, EV3's original justification no longer applies, but
# the wave's own W-C disposition list explicitly names it as a required
# outcome-flip (ALLOW -> BLOCK), not a deletion -- retained under its original
# name for R7-inventory continuity. Post-flip its fixture is functionally
# identical to PA-5 (both: canonical proof, no hook -> hook-absent BLOCK) since
# push-authorization-gate.js no longer inspects push-proof.json content at all;
# the near-duplication is intentional and documented, not an oversight.

@test "#PAG-EV3 BLOCK: no hook installed + canonical-valid proof (well-formed bats_evidence) → blocked on hook-absent (H1 outcome-flip)" {
  # OUTCOME-FLIP (PLAN v2 Path-Manifest Group D / Risk R7, arch-testing Check 3/3b,
  # the SECOND outcome-flip alongside PA-4c/PA-5). Originally: "in-JS fallback --
  # bats_evidence.head matches pushed SHA -- still passes", proving #PAG-EV1/EV2
  # (now deleted) were exercising a real check. Under H1 there is no in-JS
  # fallback left to be a positive control FOR -- push-authorization-gate.js never
  # reads push-proof.json/bats_evidence at all once the fallback is removed, so
  # even a flawless, fully-bound bats_evidence no longer earns an ALLOW through
  # this file. Stamp/proof writes dropped (identical reasoning to PA-4c/PA-5
  # above): they have zero bearing on the outcome now, and keeping them would
  # misleadingly suggest otherwise.
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-absent"* ]]
}

# ── H1 new tests (PLAN v2 Path-Manifest Group D / W-C items 4-5): the
# main-orchestrator branch's rewritten verify-git-hooks.sh delegation, exercised
# directly and minimally (zero incidental stamp/proof setup, since none of it is
# read anymore) ──────────────────────────────────────────────────────────────────

@test "#PAG-HOOKCHECK-ABSENT BLOCK: main + no pre-push hook installed at all → exit 2, decision:block + hook-absent (H1 new test)" {
  # New test (W-C item 4): dedicated, explicitly-named positive assertion that the
  # rewritten main-orchestrator branch fails closed when no .git/hooks/pre-push
  # exists at all -- the representative "no-hook-installed, any stamp/proof state,
  # still BLOCK for hook-absent reason" case the wave's own R7 disposition rule
  # calls for. PA-5/PA-6-10 above independently confirm the same reason code from
  # their own (now-irrelevant) stamp-shaped fixtures; this is the clean, minimal,
  # canonical version with zero incidental setup.
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-absent"* ]]
}

@test "#PAG-HOOKCHECK-DRIFTED BLOCK: main + drifted pre-push hook (marker intact, 1 byte changed) → exit 2, decision:block + hook-drifted (H1 new test)" {
  # New test (W-C item 4): the rewritten branch must BLOCK when the installed hook
  # is present, executable, and marker-bearing but NOT byte-identical
  # (CRLF-normalized) to the canonical scripts/sh/pre-push-hook.sh source --
  # proving the new --git-path + sha256 predicate actually replaced the old
  # existsSync-plus-marker-substring-only check (P1b), which never compared
  # content at all. Drift fixture mirrors verify-git-hooks.bats's own
  # write_drifted_hook(): copy the canonical source, then flip ONLY its last line
  # ("exit 0" -> "exit 1") so the ACDOC-PRE-PUSH-GATE marker (line 2) stays fully
  # intact -- proving hook-drifted fires on a sha mismatch specifically, not a
  # marker-missing false-positive. Targeted by list-index (last element), never
  # text search, so this can never collide with the marker line or the
  # SKIP_PUSH_GATE bypass branch's own unrelated "exit 0".
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  python3 - "$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh" "$PROJECT_ROOT/.git/hooks/pre-push" <<'PYEOF'
import sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, "rb") as f:
    lines = f.readlines()
last = lines[-1]
assert last.rstrip(b"\n") == b"exit 0", "canonical source's last line changed: " + repr(last)
lines[-1] = last.replace(b"exit 0", b"exit 1")
with open(dst, "wb") as f:
    f.writelines(lines)
PYEOF
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-drifted"* ]]
}

@test "#PAG-HOOKCHECK-ALLOW ALLOW (positive control): main + canonical pre-push hook installed → exit 0 via verify-git-hooks.sh (H1 new test)" {
  # New test (W-C item 4): positive control paired with #PAG-HOOKCHECK-ABSENT/
  # -DRIFTED above -- without it, a broken verifier that blocks every
  # main-orchestrator push unconditionally would still pass both BLOCK tests,
  # proving nothing about whether a CORRECT install is actually recognized. Same
  # fixture shape as the pre-existing PA-4 (kept, unchanged, still green under H1
  # since a byte-identical canonical install trips none of verify-git-hooks.sh's 5
  # reason codes) -- named explicitly for the H1 rewrite so the three
  # #PAG-HOOKCHECK-* tests read as one coherent, self-contained BLOCK/BLOCK/ALLOW
  # triad.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  cp "$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh" "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-AMEND3 BLOCK: main + malformed verify-git-hooks.sh invocation → exit 2, decision:block (Amendment 3, never the global fail-open)" {
  # Amendment 3 (Codex round 1, PLAN v2 Design Fidelity table + Risk R1b): a
  # failed/malformed verify-git-hooks.sh invocation must be caught LOCALLY (JS
  # result.status !== 0 branch, lines 302-311) and BLOCK -- it must NEVER bubble
  # to this file's own outer `catch { process.exit(0); }` (JS lines 318-321), a
  # deliberate fail-open for genuine parse/crash errors in THIS gate's own JSON
  # handling, not meant to cover a verifier failure.
  #
  # Malformed, not merely absent: overwrite setup()'s copied verify-git-hooks.sh
  # with a genuine bash syntax error (an unterminated `[` test with no matching
  # `]`/`fi`) -- bash exits non-zero on a parse failure before any of the 5 real
  # reason codes could ever be printed, and stdout stays empty (the syntax error
  # goes to stderr), so reasonCode falls back to "unknown". This is the literal
  # "invocation itself fails" wording of Amendment 3, a different branch shape
  # from #PAG-HOOKCHECK-ABSENT/-DRIFTED above (which exercise a WORKING verifier
  # correctly reporting a real reason code, not a broken one).
  #
  # Revert-one-prove-red: deleting the local `if (result.status !== 0) { block(...);
  # return; }` handler (JS 302-311) would let this exact malformed-invocation
  # scenario fall through to the bare `process.exit(0)` at JS line 316 -- a silent
  # ALLOW despite the verifier never having produced a clean pass. This test would
  # go red the instant that happened.
  printf 'if [ this is not valid bash syntax\n' > "$PROJECT_ROOT/scripts/sh/verify-git-hooks.sh"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

# ── Peer-block CONTRACT test — NOT a fail-open regression pin; see #PAG-GUARD ────
#
# Asserts the peer-block contract: agent_type != '' + git push => exit 2 +
# decision:block, with PA-4 (the identical marker-bearing fixture) as its positive
# control for the main orchestrator. Would catch a future refactor that drops or
# weakens the agent_type check entirely.
#
# THIS TEST PASSES AGAINST THE PRE-9336e5e CODE TOO, BY DESIGN — that is a fact about
# block()'s own mechanics, not a flaw in the test. block() calls process.exit(2)
# SYNCHRONOUSLY whenever stdout.write() returns true, which it always does for this
# hook's ~200-byte JSON payload (nowhere near a pipe's high-water mark). So even
# without the `return` that follows the peer-block call, block() still exits 2 before
# the later `if (hookIsACDoc) process.exit(0)` fall-through — reached via NO `else`,
# the line labelled "Main orchestrator" a few lines down is a comment, not a branch —
# can ever execute.
#
# That fall-through is REACHABLE (there is no else) but UNOBSERVABLE at this payload
# size (block() never defers to 'drain' here). Those are different facts, and only
# the second is why this test can't catch a missing `return`: do not read "reachable"
# as "belt-and-braces" — that single `return` is the SOLE guard. Delete it and put
# stdout under genuine backpressure and the FIXED code would deadlock instead (the
# 5s escape-hatch timer is already cleared by the time block() would defer to
# 'drain'), so a runtime test for this fail-open hangs on CORRECT code — only a
# static check fits. #PAG-GUARD (below) is the ONLY test in this suite that can
# detect the missing `return`; see its own red-then-green verification.
#
# ADDENDUM — found vacuous by an actual `git push`, not a test: this fixture uses the
# BARE command shape ("git push origin feature/test"), no shell wrapper. That is NOT
# the shape this repo's agents actually issue — the mandated invocation wraps through
# `env PATH="$HOME/.local/gnubin-l0:..." bash -c 'cd <repo>\n<command>'` for GNU-userland
# reasons. isGitPushCommand splits on &&/||/;/| but never on a literal newline, so a
# bash -c payload whose FIRST LINE is `cd ...` is one segment starting with `cd` —
# never recognized as a push at all, for ANY agent_type, peer or main. This test was
# GREEN, unbroken, for the entire period that bypass existed, because it never once
# exercised the wrapped shape. See #PAG-PEER-WRAPPED / #PAG-MAIN-STALE-WRAPPED below,
# which cover the shape this repo actually uses and were RED against the unfixed hook
# before being written. Keep this test — it is still a real contract pin for the bare
# shape — but its green never was, and is not now, evidence that the peer-block holds
# for every invocation shape a peer might actually use.

@test "#PAG-PEER-BLOCK BLOCK: peer + git push + ACDoc pre-push hook installed → exit 2 + decision:block (peer-block contract)" {
  # The marker-bearing real pre-push-hook.sh must be installed (hookIsACDoc=true) so
  # the fixture matches PA-4's, its positive control — proving this block is
  # specifically about agent_type, not an unconditional block on every push through
  # this hook.
  mkdir -p "$PROJECT_ROOT/.git/hooks"
  cp "$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh" "$PROJECT_ROOT/.git/hooks/pre-push"
  chmod +x "$PROJECT_ROOT/.git/hooks/pre-push"
  make_input "git push origin feature/test" "toolkit-specialist"
  run_hook
  # Assert BOTH exit code and the actual decision JSON — a crash also exits non-zero
  # (e.g. Node's default uncaught-exception exit code), so exit-code alone cannot
  # distinguish "blocked with a message" from "died". The outer catch{} fail-open would
  # make a crash exit 0, not nonzero — but a corrupted intermediate state could still
  # exit nonzero for the wrong reason, so pin the real payload too.
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"push-authorization-gate"* ]]
}

# ── #PAG-PEER-WRAPPED / #PAG-MAIN-STALE-WRAPPED — the real bypass shape ─────────
#
# Found by an actual `git push`, not a test: team-lead's own push went through with
# 58-minute-stale stamps and no pre-push hook installed. Root cause: isGitPushCommand
# splits a command on &&, ||, ;, | — never on a literal newline — then anchors
# ^git push per segment. This repo's mandated invocation shape is
# `env PATH="$HOME/.local/gnubin-l0:..." bash -c 'cd <repo>\n<real command>'` (the GNU
# userland requires the env-prefix; the newline separates cd from the payload). A
# bash -c body whose FIRST LINE is `cd ...` is one segment beginning with `cd`, so
# isGitPushCommand returns false for the WHOLE string — and :174's
# `if (!isGitPushCommand(cmd)) process.exit(0)` runs before the peer-block (:200) and
# before the stamp/staleness check either one is ever reached. Nobody issues the bare
# shape #PAG-PEER-BLOCK tests; everybody issues this one.
#
# RED confirmed against the last-committed pre-fix hook (1653eb5, via a scratch copy —
# .claude/hooks/ was never touched to get this evidence) before writing these
# assertions: both #PAG-PEER-WRAPPED and #PAG-MAIN-STALE-WRAPPED exit=0 with NO output
# at all — a silent ALLOW, not even a decision JSON, because the early exit at :174
# fires before the hook ever forms an opinion. toolkit-specialist is fixing
# isGitPushCommand in parallel; these two assert the CORRECT (post-fix) behavior, so
# they are RED until that fix lands and GREEN after — do not weaken them to match
# today's behavior.

@test "#PAG-PEER-WRAPPED BLOCK: peer + newline-wrapped bash -c 'cd <repo>\ngit push' → exit 2 + decision:block (the real bypass shape)" {
  local wrapped_cmd
  wrapped_cmd="env PATH=\"\$HOME/.local/gnubin-l0:/opt/homebrew/bin:\$PATH\" bash -c 'cd $PROJECT_ROOT"$'\n'"git push -u origin br'"
  make_input "$wrapped_cmd" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

@test "#PAG-MAIN-STALE-WRAPPED BLOCK: main + same wrapped command + no hook installed → exit 2, hook-absent reason (H1: stamps no longer read)" {
  # This is literally the shape of team-lead's real push tonight: main orchestrator,
  # wrapped invocation, no pre-push hook installed. This test's CORE purpose --
  # proving isGitPushCommand recognizes the wrapped/newline shape at all -- is
  # entirely about isGitPushCommand (JS :101-176), which H1 leaves byte-identical;
  # that root-cause narrative above is unaffected by this wave.
  #
  # What DOES change: under H1 the main-orchestrator branch no longer reads
  # .androidcommondoc/*.stamp at all, so the stale-stamp writes that used to
  # produce the BLOCK here are now irrelevant (dropped, not left as misleading
  # dead setup) -- the block now fires purely because no hook is installed
  # (hook-absent), independent of any stamp state.
  #
  # Tightened (arch-testing 3d, same reasoning as PA-4b above): the original loose
  # 3-way OR (*"stamp"*/*"pre-pr"*/*"quality-gate"*) proved only "some stamp-ish
  # word appeared somewhere", not WHICH check fired -- pin the structured decision
  # field PLUS the specific hook-absent reason code instead.
  local wrapped_cmd
  wrapped_cmd="env PATH=\"\$HOME/.local/gnubin-l0:/opt/homebrew/bin:\$PATH\" bash -c 'cd $PROJECT_ROOT"$'\n'"git push -u origin br'"
  make_input "$wrapped_cmd"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"hook-absent"* ]]
}

# ── Positive controls — pin what must NOT change alongside what must ───────────
# Verified against the same pre-fix hook snapshot: all six already behave as asserted
# today. They exist so a fix aimed at #PAG-PEER-WRAPPED/#PAG-MAIN-STALE-WRAPPED cannot
# silently overcorrect into blocking real non-push commands, blocking prose that merely
# mentions "git push", or — the sharpest risk — regressing the &&/;-separated and
# leading-newline shapes that already work today for the wrong reason to still work.

@test "#PAG-WRAPPED-NONPUSH ALLOW: peer + wrapped non-push bash -c 'cd /tmp\necho hi' → exit 0 (not a push at all)" {
  local wrapped_cmd
  wrapped_cmd="bash -c 'cd /tmp"$'\n'"echo hi'"
  make_input "$wrapped_cmd" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-PROSE-SH ALLOW: main + sh -c \"echo 'git push'\" (prose, no real push) → exit 0" {
  make_input "sh -c \"echo 'git push'\""
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-PROSE-PRINTF ALLOW: main + printf 'git push' (prose, no real push) → exit 0" {
  make_input "printf 'git push'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-PROSE-ANSI ALLOW: main + echo \$'git push' (ANSI-C prose, no real push) → exit 0" {
  make_input "echo \$'git push'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-PEER-AND-BLOCK BLOCK: peer + 'cd /tmp && git push origin x' (already-working && path) → exit 2, regression pin" {
  # Already blocks today via the &&-splitting path (segment-aware detector already
  # inspects each &&-separated segment). Pinned so a fix for the newline case cannot
  # silently regress the already-working && case.
  make_input "cd /tmp && git push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

@test "#PAG-PEER-LEADING-NEWLINE BLOCK: peer + bash -c '\ngit push origin x' (leading newline only, no cd) → exit 2, regression pin" {
  # Already blocks today: with no 'cd' prefix, the one newline-containing segment
  # trims down to a leading blank line + 'git push origin x' — trimming leading
  # whitespace before the ^git push anchor check means this shape is caught even
  # though the fix for #PAG-PEER-WRAPPED (which has a non-whitespace 'cd' prefix
  # before the same anchor) has not landed yet. Pinned so a newline-splitting fix
  # doesn't accidentally special-case "payload starts with a newline" into an allow.
  local wrapped_cmd
  wrapped_cmd="bash -c '"$'\n'"git push origin x'"
  make_input "$wrapped_cmd" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
}

# ── #PAG-PEER-AMP / #PAG-AMP-CONTROL — the bare-& half of 3c64643's bypass fix ─────
#
# 3c64643 added TWO separators to isGitPushCommand's split: `\r?\n` (covered above by
# #PAG-PEER-WRAPPED/#PAG-MAIN-STALE-WRAPPED/#PAG-PEER-LEADING-NEWLINE) and bare `&`
# (background), covered by neither — every existing PA-P2A-* case uses the COMPOUND
# `&&` operator, which already split before 3c64643 (it has always had its own literal
# alternative). Not one fed a bare `&`. `sleep 1 & git push origin main` sequences two
# commands exactly like `sleep 1 ; git push origin main` from the shell's point of
# view, so without the bare-`&` alternative the whole string is one segment starting
# with `sleep`, never reaching the `^git push` anchor.
#
# RED confirmed against a scratch copy of the REAL, CURRENT hook with ONLY the bare
# `&` alternative removed from the split regex (`&&` left intact, listed first, exactly
# as shipped) — not against pre-3c64643, which would conflate this half with the
# newline half and let the newline separator do the work instead. .claude/hooks/ was
# never touched to get this evidence:
#   peer + "sleep 1 & git push origin main"  → exit=0, no output (silent ALLOW — the bug)
#   peer + "sleep 1 & echo hi"                → exit=0 (correct either way, not a push)
#   peer + "echo ok && git push origin x"     → exit=2, BLOCK (confirms && does NOT
#                                                depend on & being present at all — it
#                                                matches its own separate, earlier-listed
#                                                alternative, so PA-P2A-5's green is not
#                                                an accident of ordering)
# Then GREEN against the real, current hook for the same three.
# ─────────────────────────────────────────────────────────────────────────────
@test "#PAG-PEER-AMP BLOCK: peer + 'sleep 1 & git push origin main' (bare background operator) → exit 2 + decision:block" {
  make_input "sleep 1 & git push origin main" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

@test "#PAG-AMP-CONTROL ALLOW: peer + 'sleep 1 & echo hi' (bare & but no push) → exit 0" {
  # Without this, #PAG-PEER-AMP would pass against a hook that blocks every
  # ampersand-containing command unconditionally, proving nothing.
  make_input "sleep 1 & echo hi" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# ── #PAG-GLOBALOPT-* / #PAG-ANSIC-* / #PAG-PEER-LINECONT — 3f23add + 737c1b9 ────────
#
# Three more evasions of isGitPushCommand's ^git\s+push\b anchor, each closed by its
# own commit, each needing its own isolated regression (same N-behaviours-need-N-
# regressions shape as #PAG-PEER-AMP before it):
#
# 1. GLOBAL GIT OPTIONS (3f23add): git's own -C/-c/--git-dir/etc. consumed between
#    `git` and the subcommand defeat the anchor — `git -C /tmp push` never reduces to
#    `git push` without stripping the global option first.
# 2. ANSI-C ESCAPE DECODE (3f23add): Pass 1 recurses into `$'...'` payloads, but a
#    LITERAL backslash-n inside genuine $'...' quoting is two printable characters
#    until bash decodes it — nothing splits on two printable characters, so
#    `bash -c $'cd /tmp\ngit push'` (literal backslash-n) reaches one un-splittable
#    segment.
# 3. LINE CONTINUATION (737c1b9): a backslash immediately before a newline is a shell
#    JOINER (removed; the two lines become one command) — but the separator split
#    treats every bare newline as a boundary, so without collapsing the continuation
#    first, `git -C /tmp \<newline>push` gets cut exactly at the join point into two
#    non-matching segments (`git -C /tmp \` and `push origin x`), neither reducing to
#    `git push`.
#
# RED confirmed for all three against scratch copies of the 737c1b9 baseline (the
# last-committed state at authoring time), each with EXACTLY ONE element reverted —
# never more than one at once, which would conflate which fix a given regression pins:
#   no global-opt stripping:   "git -C /tmp push origin x"          → exit=0 (bug)
#                              "git -c credential.helper= push..."  → exit=0 (bug)
#   decodeAnsiCEscapes no-op:  "bash -c $'cd /tmp\ngit push...'"    → exit=0 (bug)
#   no line-cont collapse:     "git -C /tmp \<newline>push..."      → exit=0 (bug)
# .claude/hooks/ never touched to get this evidence. Then GREEN against the real,
# current hook for all seven cases (three bugs + four controls) below.
#
# Real-newline fixtures (#PAG-PEER-LINECONT / #PAG-LINECONT-COMMIT) are built via
# $'\n' concatenation, NEVER $(printf '\n') — command substitution strips trailing
# newlines and would silently test `git -C /tmp \push` instead of the intended
# `git -C /tmp \<newline>push`. Verified via a python round-trip during authoring that
# the JSON-encoded command field genuinely contains a 0x0a byte before trusting it.
# ─────────────────────────────────────────────────────────────────────────────
@test "#PAG-GLOBALOPT-C BLOCK: peer + 'git -C /tmp push origin x' (global option before subcommand) → exit 2 + decision:block" {
  make_input "git -C /tmp push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

@test "#PAG-GLOBALOPT-CONFIG BLOCK: peer + 'git -c credential.helper= push origin x' (second global-option form) → exit 2 + decision:block" {
  make_input "git -c credential.helper= push origin x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

@test "#PAG-GLOBALOPT-COMMIT ALLOW (positive control): peer + 'git -C /tmp commit -m x' (global option before a non-push) → exit 0" {
  # Without this, a hook that blocks every command containing a git global option
  # would pass #PAG-GLOBALOPT-C/-CONFIG for the wrong reason.
  make_input "git -C /tmp commit -m x" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-ANSIC-NL BLOCK: peer + bash -c \$'cd /tmp\\ngit push origin x' (genuine \$'...' quoting, literal backslash-n) → exit 2 + decision:block" {
  local cmd
  cmd='bash -c $'\''cd /tmp\ngit push origin x'\'''
  make_input "$cmd" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

@test "#PAG-ANSIC-PLAINQUOTE ALLOW (negative control): peer + bash -c 'echo a\\ngit push' (plain quotes, bash does NOT decode) → exit 0" {
  # The discriminating control: plain '...' quoting is never eligible for ANSI-C
  # decoding, so bash treats the whole thing as one literal argument and no push ever
  # runs. Unconditional decoding (not gated on genuine $'...') would over-block this.
  local cmd
  cmd='bash -c '\''echo a\ngit push'\'''
  make_input "$cmd" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "#PAG-PEER-LINECONT BLOCK: peer + 'git -C /tmp \\<newline>push origin x' (shell line continuation) → exit 2 + decision:block" {
  # Real newline via \$'\n' concatenation — NEVER \$(printf '\n'), which strips a
  # trailing newline and would silently test 'git -C /tmp \push' instead.
  local cmd
  cmd="git -C /tmp \\"$'\n'"push origin x"
  make_input "$cmd" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

@test "#PAG-LINECONT-COMMIT ALLOW (positive control): peer + 'git -C /tmp \\<newline>commit -m x' (continuation into a non-push) → exit 0" {
  local cmd
  cmd="git -C /tmp \\"$'\n'"commit -m x"
  make_input "$cmd" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# ── #PAG-GUARD — static invariant: every block( call site is immediately followed by
# return ────────────────────────────────────────────────────────────────────────────
#
# WHY this invariant exists (for the next person tempted to delete a `return`): block()
# only calls process.exit(2) synchronously when stdout.write() succeeds; under
# backpressure it defers exit to the 'drain' event. Without `return` immediately after,
# execution continues past a decision that has already been made, ending in an
# accidental ALLOW — either a deref-throw swallowed by the outer catch{}'s fail-open, or
# (the real, historical case — #PAG-PEER-BLOCK above) a silent fall-through to a later
# unconditional process.exit(0). Neither failure mode crashes loudly; both look like a
# normal allow.
#
# Model/precedent: scripts/tests/portable-shell-guards.bats (Wave B, same problem shape).
#
# SANITY FLOOR IS THE WHOLE POINT (repo memory: "a guard that cannot fail is worse than
# no guard" — a detector that scans and finds zero block( call sites reports "0
# violations", indistinguishable from "0 call sites", and would pass against an empty
# file, a moved file, or a broken regex).
#
# FLOOR RE-DERIVED FOR H1 (PLAN v2 Risk R9 / Path-Manifest Group D, its own explicit
# W-C line item — NOT a mechanical drop of the old number). Pre-H1 history: the file
# had exactly 20 call sites when the >=15 floor was FIRST chosen (loose enough that a
# half-broken regex finding, say, 9 would still fail; tight enough that ==20 would have
# been brittle and failed spuriously the moment anyone added or removed a legitimate
# block() call during ordinary maintenance); wave qg-artifact-binding's W7 completeness
# checks (9-13) later added 5 more block() call sites on top of that (20 -> 25) without
# ever needing to bump the threshold, confirming >=15 was loose enough to absorb real
# growth. H1 removes the entire ~205-line best-effort fallback (JS :319-523, ~24 of
# those ~25 call sites) and replaces it with a rewritten main-orchestrator branch that
# delegates to verify-git-hooks.sh — the file now has exactly **5** legitimate call
# sites: the peer/subagent block (1) plus the four distinct, LOCALLY-handled
# verify-git-hooks.sh failure modes Amendment 3 requires (spawnSync throw, result.error,
# result.status===null timeout/signal, result.status!==0 non-zero exit — 4). Re-verified
# by direct read of the landed 322-line file: block( token matches at exactly 5
# non-comment, non-definition lines (247, 276, 285, 294, 304).
#
# Applying the SAME discipline that produced >=15 from a baseline of 20 (loose enough to
# survive ordinary maintenance -- adding, removing, or consolidating a block() call or
# two -- tight enough to fail loudly if the parser breaks or the verification invariant
# is gutted) to the new baseline of 5: the new floor is **>=3**. This tolerates losing
# up to two call sites to a future refactor (e.g. collapsing two of the four
# verify-git-hooks.sh failure branches into one shared handler) without a brittle,
# spurious break, while still failing loudly the moment the count crashes to 0, 1, or 2
# — which would mean either the parser broke (file moved/emptied/unreadable) or the
# security invariant itself was gutted (e.g. most of Amendment 3's exhaustive local
# failure-mode handling silently disappeared, or the peer-block was dropped). An exact
# `==5` was rejected for the same reason `==20` was rejected originally: it would fail
# spuriously on ordinary maintenance. A floor of `>=1` or `>=2` was rejected as too loose
# at this smaller scale: it would still pass even if 3 of the file's 5 essential
# branches vanished — precisely the "just lower the number without re-deriving it"
# trap this guard exists to prevent (repo memory, restated here per the same
# discipline the original comment documents: do not mechanically drop the threshold
# without writing down the new reasoning).
#
# Four shapes the parser must survive (originally verified against the pre-H1 real file
# AND against a deliberately-broken copy with one return removed, to confirm this is
# non-vacuous; the parser logic itself is UNCHANGED by H1 and must keep surviving all
# four even though the post-H1 live file happens to exercise only shapes 1, 3, and 4
# today — shape 2 could be reintroduced by a future edit, e.g. a catch-block one-liner,
# and the parser must not silently mishandle it if so):
#   1. Multi-line call: `block(\n  '...'\n);` then `return;` on the NEXT physical line.
#      All 5 of today's call sites (247, 276, 285, 294, 304) use this shape.
#   2. catch-oneliner:  `catch { block('...'); return; }` — return on the SAME line,
#      immediately after `);` with no line break. Not currently present in the live
#      file post-H1 (it lived in the removed fallback); parser support retained.
#   3. Leading comment: a line starting with `//` that merely mentions `block()` in
#      prose (the INVARIANT comment block above `function block` does this twice) — must
#      be excluded, not counted as a call site.
#   4. TRAILING comment: `return; // ... mentions block() in a later comment ...` — the
#      trailing `//` must be stripped BEFORE searching for `block(`, or this line is
#      miscounted as an extra call site whose "next line" is a comment continuation, not
#      `return` — a false violation on the very line that documents the invariant. This
#      is the shape that produced 1 false positive while developing this detector (a
#      naive "does this line end in );" check breaks on shape 2, since `);` there is
#      followed by more code on the same line, not end-of-line — fixed by searching for
#      the ");" substring at any position, not requiring it at end-of-line).
@test "#PAG-GUARD static: every block( call site in the hook is immediately followed by return" {
  local hook="$BATS_TEST_DIRNAME/../../.claude/hooks/push-authorization-gate.js"
  [ -f "$hook" ]

  run python3 - "$hook" << 'PYEOF'
import re, sys

path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    lines = f.readlines()

def strip_comment(line):
    # Strip from the first // onward. Safe for THIS file specifically: verified no
    # line's genuine (non-comment) content contains a literal "//" (e.g. no URLs).
    idx = line.find('//')
    return line if idx == -1 else line[:idx]

cleaned = [strip_comment(l) for l in lines]

# Call sites: lines containing `block(` as a token, excluding the `function block(`
# definition and excluding lines that are pure comments (already blanked above).
call_sites = []
for i, line in enumerate(cleaned):
    if re.search(r'function\s+block\s*\(', line):
        continue
    m = re.search(r'\bblock\s*\(', line)
    if m:
        call_sites.append((i, m.start()))

violations = []
for (i, col) in call_sites:
    # Find the first ");" substring from (i, col) onward, scanning forward up to 15
    # lines (covers multi-line calls). Searching for the substring anywhere on the
    # line (not requiring end-of-line) is what survives shape 2 (catch-oneliner).
    close_pos = None
    search_from = col
    for j in range(i, min(i + 15, len(cleaned))):
        idx = cleaned[j].find(');', search_from if j == i else 0)
        if idx != -1:
            close_pos = (j, idx + 2)
            break
    if close_pos is None:
        violations.append((i + 1, 'no closing ); found within 15 lines'))
        continue

    close_line_idx, after_idx = close_pos
    remainder = cleaned[close_line_idx][after_idx:]
    if re.search(r'\breturn\s*;', remainder):
        continue  # shape 2: return on the same line as the close

    if remainder.strip() != '':
        violations.append((i + 1, f'trailing code after close, no return: {remainder!r}'))
        continue

    # shape 1: return on the next non-blank line
    k = close_line_idx + 1
    while k < len(cleaned) and cleaned[k].strip() == '':
        k += 1
    if k < len(cleaned) and re.match(r'^\s*return\s*;', cleaned[k]):
        continue

    violations.append((i + 1, f'no return immediately after close at line {close_line_idx + 1}'))

print(f'call_sites={len(call_sites)}')
print(f'violations={len(violations)}')
for ln, reason in violations:
    print(f'VIOLATION at line {ln}: {reason}')
PYEOF
  [ "$status" -eq 0 ]

  local call_sites violations
  call_sites="$(printf '%s\n' "$output" | python3 -c "import sys; print(next(l.split('=')[1] for l in sys.stdin if l.startswith('call_sites=')))")"
  violations="$(printf '%s\n' "$output" | python3 -c "import sys; print(next(l.split('=')[1] for l in sys.stdin if l.startswith('violations=')))")"

  # Sanity floor FIRST: fails loudly if the parser is broken, not if the code is.
  # H1 (PLAN v2 Risk R9): re-derived from 20/>=15 to 5/>=3 -- see the header comment
  # above this test for the full re-derivation and why >=3 (not ==5, not >=1/>=2).
  [ "$call_sites" -ge 3 ]
  [ "$violations" -eq 0 ]
}
