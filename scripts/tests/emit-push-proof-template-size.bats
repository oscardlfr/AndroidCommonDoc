#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for emit-push-proof.sh / emit-push-proof.ps1 — template size gate (Fix 1).
#
# The run-qg subcommand contains an inline (D) gate that calls
# validate-agent-templates.sh --check size-limits before writing the proof/stamp.
# Any agent template exceeding 435 lines causes exit 2 with no stamp written.
#
# The gate is CWD-independent: it passes explicit
#   --templates-dir "$REPO_ROOT/setup/agent-templates"
#   --agents-dir    "$REPO_ROOT/.claude/agents"
# so the check is anchored on --repo-root, not the caller's working directory.
#
# Coverage:
#   TSZ-1: bash — 436-line over-cap fixture → exit non-zero + no stamp written (pins
#          the specific "agent template size cap exceeded" reason, Wave A tightening)
#   TSZ-2: bash — 435-line (real) quality-gater.md → exit 0 + stamp written (canary
#          for BOTH the size cap AND the new report.started_at requirement, Wave A)
#   TSZ-3: ps1 runtime — if powershell.exe/pwsh available, 436-line over-cap → exit!=0 + no stamp
#   TSZ-4: static guard — sh contains explicit --templates-dir + --agents-dir near
#          size-limits (ps1 half DROPPED, Wave A — see #EP-PS1-DISABLED/#EP-PS1-VERIFY)
#   TSZ-5: CWD-independence proof — non-repo CWD + over-cap → gate fires (exit!=0 + no
#          stamp; pins the specific size-gate reason, Wave A tightening)
#   TSZ-6: absent-dir guard — no setup/agent-templates/ → gate is a no-op → exit 0 + stamp written
#   TSZ-9: ps1 static — no 3-arg Join-Path (PowerShell 5.1 compat; 3-arg form requires PS 6+)
#
# Wave A (Section A5a/A5b) — PS1 mint-disable + verify's 8th check:
#   #EP-PS1-DISABLED: ps1 static — Invoke-RunQg is a hard refuse-to-mint (REPLACES
#          TSZ-7/TSZ-8, superseded not repaired: the old no-bash Die/warn-skip branches
#          those tests asserted no longer exist — the whole size/registry-gate body
#          they lived in was deleted along with the rest of the old Invoke-RunQg)
#   #EP-PS1-VERIFY: ps1 static — verify-push-proof.ps1 contains the bats_evidence check
#
# Isolation: every test uses mktemp -d + git init + teardown rm -rf.
# Setup mirrors emit-push-proof.bats exactly (same harness).
#
# Design note: template files must be committed into the temp repo before run-qg
# so the clean-tree assertion (step 4A in run-qg) passes cleanly. Tests that
# exercise the size gate (step 4D) commit their template fixture first, then
# re-capture HEAD to bind verdicts to the correct commit.
#
# Fixture invariant: validate-agent-templates.sh exits 1 when TOTAL_FILES == 0.
# All blocking tests (TSZ-1, TSZ-3, TSZ-5) include >=1 template file in
# setup/agent-templates/ so the failure is the size violation, not an empty dir.
# TSZ-2 (passing path) uses the real quality-gater.md (1 file, 435 lines).

EMITTER="$BATS_TEST_DIRNAME/../sh/emit-push-proof.sh"
EMITTER_PS1="$BATS_TEST_DIRNAME/../ps1/emit-push-proof.ps1"
MANIFEST_SRC="$BATS_TEST_DIRNAME/../../quality-gate-manifest.json"
SCRIPTS_SRC="$BATS_TEST_DIRNAME/.."
REPO_ROOT_SRC="$BATS_TEST_DIRNAME/../.."

setup() {
  REPO="$(mktemp -d)"
  git init "$REPO" --quiet
  git -C "$REPO" config user.email "test@test.com"
  git -C "$REPO" config user.name "Test"
  git -C "$REPO" config core.autocrlf false
  git -C "$REPO" commit --allow-empty --quiet -m "feat(core): init"
  git -C "$REPO" checkout -b feature/test-tsz --quiet
  ACDOC="$REPO/.androidcommondoc"
  mkdir -p "$ACDOC"

  # .gitignore: hide .androidcommondoc/ and .planning/wave*/ from git status
  # (required by the clean-tree assertion in run-qg)
  printf '.androidcommondoc/\n.planning/wave*/\n' > "$REPO/.gitignore"

  # Copy live manifest into isolated repo
  cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

  # Mirror scripts/sh/ into isolated repo so the emitter finds lib/ dependencies
  mkdir -p "$REPO/scripts/sh/lib"
  cp "$SCRIPTS_SRC/sh/emit-push-proof.sh"        "$REPO/scripts/sh/"
  cp "$SCRIPTS_SRC/sh/lib/manifest-digest.sh"     "$REPO/scripts/sh/lib/"
  cp "$SCRIPTS_SRC/sh/lib/audit-append.sh"        "$REPO/scripts/sh/lib/"
  cp "$SCRIPTS_SRC/sh/qg-registry-integrity.sh"   "$REPO/scripts/sh/"
  cp "$SCRIPTS_SRC/sh/rehash-registry.sh"         "$REPO/scripts/sh/"

  # CRITICAL: validate-agent-templates.sh is called by the (D) size gate.
  # It is NOT in the default emit-push-proof.bats harness — copy it explicitly
  # so tests fail for the correct reason (over-cap) rather than script-not-found.
  cp "$SCRIPTS_SRC/sh/validate-agent-templates.sh" "$REPO/scripts/sh/"

  # Commit all fixtures so the tree is CLEAN before run-qg
  git -C "$REPO" add -A
  git -C "$REPO" commit --quiet -m "test(fixtures): initial fixture commit"

  # Re-capture HEAD after fixture commit (used by write_arch_verdicts)
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

  # Create the setup/agent-templates directory in the temp repo.
  # The (D) gate passes --templates-dir "$REPO_ROOT/setup/agent-templates" explicitly,
  # so this dir is always the one validated (CWD-independent).
  TEMPLATES_DIR="$REPO/setup/agent-templates"
  mkdir -p "$TEMPLATES_DIR"

  # .claude/agents may be absent — validate-agent-templates.sh skips an absent --agents-dir.
  # No need to mkdir it unless a test puts agents there.
}

teardown() {
  rm -rf "$REPO"
}

# -- Fixture writers -----------------------------------------------------------

# write_arch_verdicts -- minimal APPROVED-VERIFY-FINAL verdicts for run-qg to pass
# $1=slug, $2=head_sha (default HEAD_SHA)
write_arch_verdicts() {
  local slug="$1"
  local head="${2:-$HEAD_SHA}"
  local wave_dir="$REPO/.planning/wave-$slug"
  mkdir -p "$wave_dir"
  for role in arch-testing arch-platform arch-integration; do
    cat > "$wave_dir/$role-verdict.md" <<EOF
# $role verdict -- wave-$slug

**Phase**: PREP
**Timestamp**: 2026-06-14T00:00:00Z
**Status**: APPROVED-PREP

---

**HEAD**: $head
**Phase**: VERIFY-FINAL
**Timestamp**: 2026-06-14T00:00:00Z
**Status**: APPROVED-VERIFY-FINAL
EOF
  done
}

# write_valid_bats_handoff -- writes a well-formed, full-scope, HEAD-bound bats
# handoff into $ACDOC (Wave A: run-qg's test-suite-evidence-* check requires real
# evidence behind any claimed "test-suite": PASS step). HEAD is re-derived from git at
# call time. generated_at is captured strictly after the caller's own started_at
# timestamp, satisfying select_bats_handoff's --since floor (real wall-clock ordering
# only moves forward within one test).
write_valid_bats_handoff() {
  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  local generated_at
  generated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local run_id="wave-a-fixture-$$-${RANDOM}"
  mkdir -p "$ACDOC"
  {
    printf 'BATS_OK=%s\n'           "42"
    printf 'BATS_NOT_OK=%s\n'       "0"
    printf 'BATS_EXPECTED=%s\n'     "42"
    printf 'BATS_TOTAL=%s\n'        "42"
    printf 'BATS_COMPLETE=%s\n'     "true"
    printf 'BATS_VERDICT=%s\n'      "pass"
    printf 'BATS_LOG=%s\n'          "/dev/null"
    printf 'BATS_HEAD=%s\n'         "$head"
    printf 'BATS_RUN_ID=%s\n'       "$run_id"
    printf 'BATS_GENERATED_AT=%s\n' "$generated_at"
    printf 'BATS_SCOPE=%s\n'        "full"
  } > "$ACDOC/bats-result.${run_id}.env"
}

# write_quality_gate_report -- writes a valid quality-gate-report.json with all required
# steps PASS and all conditional steps SKIP (same template as emit-push-proof.bats)
#
# Wave A: also stamps report.started_at and writes a matching valid bats handoff (via
# write_valid_bats_handoff) BY DEFAULT -- test-suite defaults to PASS here, so run-qg's
# report-started-at-* and test-suite-evidence-* checks now fire unconditionally, before
# TSZ-1/TSZ-2/TSZ-5/TSZ-6's own intended (D) size-gate outcome is ever reached.
write_quality_gate_report() {
  local started_at
  started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  python3 - "$ACDOC/quality-gate-report.json" "$REPO/quality-gate-manifest.json" "$started_at" <<'PYEOF'
import json, sys

manifest = json.load(open(sys.argv[2], encoding='utf-8'))
started_at = sys.argv[3]

steps = []
for rs in manifest.get('required_steps', []):
    steps.append({"step": rs['id'], "ran": True, "result": "PASS"})
for cs in manifest.get('conditional_steps', []):
    if cs['id'] == 'production-file-verify':
        steps.append({"step": cs['id'], "ran": True, "result": "PASS"})
    else:
        steps.append({"step": cs['id'], "ran": False, "result": "SKIP",
                      "reason": "predicate false in isolated test repo"})

report = {
    "started_at": started_at,
    "deliberation": {
        "architects_consulted": ["arch-platform", "arch-testing", "arch-integration"],
        "incorporated_at": "2026-06-14T00:00:00Z",
    },
    "pre_pr_coverage": {"status": "PASS", "modules": 3},
    "discovered_rules": [
        {"rule": "two-stamp-gate", "verified_by": "pre-push-hook.bats"}
    ],
    "steps": steps,
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
    f.write('\n')
PYEOF
  write_valid_bats_handoff
}

# write_overcap_template -- writes an agent template padded to 436 lines (one over the 435 cap).
# Uses a valid frontmatter block so the ONLY failure is the size limit.
# $1=filename (basename, placed in TEMPLATES_DIR)
write_overcap_template() {
  local fname="$1"
  # Write valid frontmatter (8 lines)
  cat > "$TEMPLATES_DIR/$fname" <<'FRONTEOF'
---
name: test-overcap
description: Over-cap fixture template for TSZ tests
tools: [Read, Bash]
model: claude-opus-4-5
token_budget: 10000
template_version: "1.0.0"
---
FRONTEOF
  # Pad to exactly 436 lines total.
  python3 - "$TEMPLATES_DIR/$fname" <<'PYEOF'
import sys
path = sys.argv[1]
current = sum(1 for _ in open(path, encoding='utf-8'))
with open(path, 'a') as f:
    needed = 436 - current
    for i in range(needed):
        f.write(f"# padding line {i+1}\n")
PYEOF
  # Verify the count
  local actual
  actual="$(wc -l < "$TEMPLATES_DIR/$fname" | tr -d ' \r')"
  if [[ "$actual" -ne 436 ]]; then
    echo "ERROR: write_overcap_template produced $actual lines, expected 436" >&2
    return 1
  fi
}

# TSZ-1  bash -- 436-line over-cap fixture -> exit non-zero AND no stamp written
#
# Load-bearing invariant: quality-gate.stamp MUST NOT exist when the size gate fires.
# This is the regression test for Fix 1: if the (D) gate is removed/bypassed the
# stamp would be written regardless, and this test catches that.
#
# The overcap template is committed before run-qg so the clean-tree check (step 4A)
# passes cleanly and the size gate (step 4D) is what actually fires.
# CWD note: the gate is CWD-independent (explicit --templates-dir), so CWD does not
# affect which template dir is checked. We still cd to REPO to keep it clean.
@test "TSZ-1 BLOCK (bash): 436-line over-cap template → exit≠0 AND no quality-gate.stamp" {
  write_overcap_template "overcap-fixture.md"

  # Commit the template so the clean-tree check (step 4A) does not fire first.
  git -C "$REPO" add -A
  git -C "$REPO" commit --quiet -m "test(fixtures): add overcap template"
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

  write_arch_verdicts "test-slug"
  write_quality_gate_report

  # Gate is CWD-independent; run from REPO to avoid any side effects.
  run bash -c "cd '$REPO' && CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"

  # Exit must be non-zero (the (D) gate returns exit 2)
  [ "$status" -ne 0 ]

  # The stamp MUST NOT have been written -- this is the load-bearing invariant
  [ ! -f "$ACDOC/quality-gate.stamp" ]

  # Wave A tightening: a bare exit-nonzero + stamp-absent check would ALSO pass on
  # report-started-at-absent (an earlier, unrelated die) without ever reaching the (D)
  # size gate this test exists to protect -- pin the actual size-gate failure reason.
  [[ "$output" == *"agent template size cap exceeded"* ]]
}

# TSZ-2  bash -- real quality-gater.md (435 lines) -> exit 0 AND stamp written
#
# Copies the actual quality-gater.md from the live repo to confirm the in-production
# template does not itself trigger the over-cap gate.
#
# The template is committed before run-qg so the clean-tree check (step 4A) passes.
# Fixture invariant: with quality-gater.md present, TOTAL_FILES >= 1 so
# validate-agent-templates.sh does not exit-1 on empty-dir.
@test "TSZ-2 PASS (bash): real quality-gater.md (≤435 lines) → exit 0 AND stamp written" {
  # Copy the live quality-gater.md template -- this is the 435-line production template
  local src="$REPO_ROOT_SRC/setup/agent-templates/quality-gater.md"
  if [[ ! -f "$src" ]]; then
    skip "setup/agent-templates/quality-gater.md not found -- cannot run TSZ-2"
  fi
  cp "$src" "$TEMPLATES_DIR/quality-gater.md"

  # Commit the template so the clean-tree check (step 4A) does not fire.
  git -C "$REPO" add -A
  git -C "$REPO" commit --quiet -m "test(fixtures): add quality-gater.md template"
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

  write_arch_verdicts "test-slug"
  write_quality_gate_report

  run bash -c "cd '$REPO' && CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"

  # Exit must be 0
  [ "$status" -eq 0 ]

  # The stamp MUST have been written
  [ -f "$ACDOC/quality-gate.stamp" ]
}

# TSZ-3  ps1 runtime -- if powershell is available, 436-line over-cap -> exit!=0 + no stamp
#
# This test exercises the actual PowerShell code path end-to-end.
# It is skipped on CI (ubuntu) where powershell is not available.
# On this Windows host (powershell.exe present) it runs and acts as
# the authoritative runtime proof of Fix 1 in the ps1 path.
@test "TSZ-3 BLOCK (ps1 runtime): 436-line over-cap → exit≠0 AND no quality-gate.stamp" {
  # Detect powershell availability
  local ps_bin=""
  if command -v powershell.exe &>/dev/null; then
    ps_bin="powershell.exe"
  elif command -v pwsh &>/dev/null; then
    ps_bin="pwsh"
  fi

  if [[ -z "$ps_bin" ]]; then
    skip "powershell not available"
  fi

  write_overcap_template "overcap-fixture.md"

  # Commit the template so the clean-tree check passes before the size gate fires.
  git -C "$REPO" add -A
  git -C "$REPO" commit --quiet -m "test(fixtures): add overcap template for ps1"
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

  write_arch_verdicts "test-slug"
  write_quality_gate_report

  # Copy ps1 script into temp repo scripts/ps1/ so lib/ references resolve
  mkdir -p "$REPO/scripts/ps1"
  cp "$EMITTER_PS1" "$REPO/scripts/ps1/"

  # Invoke ps1 emitter directly against the temp repo.
  # The ps1 gate is CWD-independent (passes explicit --templates-dir rooted at RepoRoot).
  run bash -c "
    cd '$REPO'
    SLUG='test-slug'
    PS1_EMITTER='$REPO/scripts/ps1/emit-push-proof.ps1'
    '$ps_bin' -NoProfile -File \"\$PS1_EMITTER\" \
      -Subcommand run-qg \
      -Slug \"\$SLUG\" \
      -RepoRoot '$REPO'
    "

  # Exit must be non-zero (Die exits with code 2)
  [ "$status" -ne 0 ]

  # The stamp MUST NOT have been written
  [ ! -f "$ACDOC/quality-gate.stamp" ]
}

# TSZ-4  static guard -- sh contains explicit --templates-dir + --agents-dir
#
# This test ALWAYS runs (even on CI ubuntu where powershell is absent).
# Asserts that the sh emitter contains the CWD-independence wiring:
#   - validate-agent-templates.sh is called
#   - --check size-limits is passed
#   - --templates-dir is passed (anchors on REPO_ROOT, not CWD)
#   - --agents-dir is passed (anchors on REPO_ROOT, not CWD)
#   - A fail-closed branch exists
#
# This catches a regression back to CWD-dependent behavior: if either --templates-dir
# or --agents-dir is removed, the gate silently fails from a non-repo CWD.
#
# Wave A: the ps1 HALF of this test is dropped, not repaired. emit-push-proof.ps1's
# Invoke-RunQg is now a hard refuse-to-mint (515 -> 182 lines, Section A5a) with no
# size-gate call at all -- asserting these strings there would mean re-adding dead
# parity text to a script that refuses to mint. That refusal satisfies this test's own
# underlying purpose ("the PS1 mint must not bypass the size/registry gates") more
# strongly than parity ever did. See #EP-PS1-DISABLED / #EP-PS1-VERIFY for the PS1-side
# coverage this wave replaces TSZ-7/TSZ-8 with.
@test "TSZ-4 STATIC: sh contains --templates-dir + --agents-dir near size-limits call" {
  local sh_file="$EMITTER"

  [ -f "$sh_file" ]  || { echo "MISSING: $sh_file"  >&2; return 1; }

  # validate-agent-templates.sh must be referenced
  grep -q "validate-agent-templates.sh" "$sh_file" \
    || { echo "sh MISSING: 'validate-agent-templates.sh'" >&2; return 1; }

  # --check flag must be present
  grep -q -- "--check" "$sh_file" \
    || { echo "sh MISSING: '--check' flag" >&2; return 1; }

  # size-limits selector must be present
  grep -q "size-limits" "$sh_file" \
    || { echo "sh MISSING: 'size-limits'" >&2; return 1; }

  # --templates-dir must be passed (CWD-independence)
  grep -q -- "--templates-dir" "$sh_file" \
    || { echo "sh MISSING: '--templates-dir' flag — gate is CWD-dependent without it" >&2; return 1; }

  # --agents-dir must be passed (CWD-independence)
  grep -q -- "--agents-dir" "$sh_file" \
    || { echo "sh MISSING: '--agents-dir' flag — gate is CWD-dependent without it" >&2; return 1; }

  # Fail-closed branch: non-zero exits emit-push-proof.sh with exit 2
  grep -q "exit 2" "$sh_file" \
    || { echo "sh MISSING: 'exit 2' fail-closed branch" >&2; return 1; }
}

# TSZ-5  CWD-independence proof -- non-repo CWD + over-cap -> gate fires
#
# This is the whole point of the Fix 1 CWD fix (arch-platform Option A).
# The gate is invoked from a working directory that is NOT the repo root
# (e.g. /tmp). Without the explicit --templates-dir flag the gate would find
# zero templates (or the wrong ones) and silently pass (false-PASS).
# With the fix, the gate is anchored on --repo-root via explicit dir args,
# so it fires regardless of CWD.
#
# Failure mode without the fix: validate-agent-templates.sh finds no
# setup/agent-templates/ from /tmp → TOTAL_FILES==0 → exit 1 (no-files error),
# OR finds the bats runner's live templates (all ≤435) → PASS. Either way the
# over-cap template in REPO is not inspected. TSZ-5 catches that regression.
@test "TSZ-5 CWD-INDEPENDENT: non-repo CWD + over-cap → gate fires (exit≠0 + no stamp)" {
  write_overcap_template "overcap-fixture.md"

  # Commit the template so the clean-tree check (step 4A) does not fire first.
  git -C "$REPO" add -A
  git -C "$REPO" commit --quiet -m "test(fixtures): add overcap template"
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

  write_arch_verdicts "test-slug"
  write_quality_gate_report

  # Deliberately choose a non-repo working directory.
  # Use BATS_TEST_TMPDIR (bats-managed tmpdir, guaranteed non-repo) if available,
  # otherwise fall back to /tmp — both are outside the AndroidCommonDoc worktree.
  local non_repo_cwd
  non_repo_cwd="${BATS_TEST_TMPDIR:-/tmp}"

  # Run the emitter from a non-repo CWD. --repo-root still points at REPO.
  # The (D) gate must use --templates-dir anchored on --repo-root, not on CWD.
  run bash -c "cd '$non_repo_cwd' && CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"

  # Exit must be non-zero (size gate fires because REPO has the 436-line template)
  [ "$status" -ne 0 ]

  # The stamp MUST NOT have been written
  [ ! -f "$ACDOC/quality-gate.stamp" ]

  # Wave A tightening: a bare exit-nonzero + stamp-absent check would ALSO pass on
  # report-started-at-absent (an earlier, unrelated die) without ever reaching the (D)
  # size gate this test exists to protect -- pin the actual size-gate failure reason.
  [[ "$output" == *"agent template size cap exceeded"* ]]
}

# TSZ-6  absent-dir guard -- no setup/agent-templates/ -> gate is a no-op -> run_qg succeeds
#
# The (D) gate is guarded by:
#   bash:  [[ -d "$REPO_ROOT/setup/agent-templates" ]]
#   ps1:   Test-Path $templatesDir -PathType Container
#
# When setup/agent-templates/ is absent the gate is entirely skipped — no validate-agent-templates.sh
# call, no exit 2.  This allows template-less repos (fixtures, L1/L2 projects) to mint proofs without
# error.  It is NOT a bypass: there are no templates to size-check, so N/A is correct behavior.
#
# Regression guard: if someone removes the -d guard in the future, run_qg would call
# validate-agent-templates.sh against an absent dir → TOTAL_FILES==0 → exit 1 → run_qg exits 2
# → stamp never written.  This test catches that regression.
#
# Setup: TEMPLATES_DIR is created in setup() but NOT populated here — we explicitly
# remove it so the guard condition is false.  All other run_qg preconditions are satisfied
# (clean tree, manifest, arch verdicts, valid report) so the ONLY variable is the absent dir.
@test "TSZ-6 NO-OP (bash): absent setup/agent-templates/ → (D) gate skipped → exit 0 AND stamp written" {
  # Explicitly ensure setup/agent-templates/ does NOT exist in the temp repo.
  # setup() creates TEMPLATES_DIR but has not written anything into it;
  # remove it so the -d guard condition is false.
  rm -rf "$TEMPLATES_DIR"

  # No templates to commit — tree is already clean from setup() initial commit.
  # HEAD_SHA is still valid from setup().

  write_arch_verdicts "test-slug"
  write_quality_gate_report

  run bash -c "cd '$REPO' && CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"

  # Exit must be 0: the (D) gate is a no-op when setup/agent-templates/ is absent
  [ "$status" -eq 0 ]

  # The stamp MUST have been written: run_qg completes normally
  [ -f "$ACDOC/quality-gate.stamp" ]
}

# #EP-PS1-DISABLED  ps1 static — Invoke-RunQg is a hard refuse-to-mint, not a silent
# no-op or a partial/untested proof-writing path.
#
# REPLACES TSZ-7/TSZ-8 (superseded, not repaired — Wave A, Section A5a). Those two
# tests asserted no-bash "Die ... cannot run template/registry size check" strings
# from the OLD Invoke-RunQg body, which contained the full size-gate/registry-gate/
# bash-detection logic. That logic is gone entirely: Invoke-RunQg (515 -> 182 total
# ps1 lines) now unconditionally prints the refuse-to-mint message and exits 2 before
# any bash-detection branch is ever reached — re-adding those dead strings to a
# script that refuses to mint would test nothing real. The underlying purpose those
# tests protected ("the PS1 mint must not bypass the size/registry gates") is now
# satisfied more strongly: there is no mint path left to bypass at all.
@test "#EP-PS1-DISABLED static: emit-push-proof.ps1 Invoke-RunQg refuses to mint, writes no proof" {
  local ps1="$BATS_TEST_DIRNAME/../ps1/emit-push-proof.ps1"
  run grep -c "run-qg is disabled in the PowerShell path pending evidence binding" "$ps1"
  [ "$output" != "0" ]
  # No proof-writing call anywhere in the file -- a push-proof.json path write would
  # indicate a bypass of the refuse-to-mint contract.
  run grep -c "push-proof.json" "$ps1"
  [ "$output" = "0" ]
}

# #EP-PS1-VERIFY  ps1 static — verify-push-proof.ps1 carries the same bats_evidence
# 8th check as bash's verify_proof and push-authorization-gate.js's in-JS fallback
# (Wave A, Section A5b). No pwsh needed for a static assertion.
@test "#EP-PS1-VERIFY static: verify-push-proof.ps1 contains the bats_evidence check" {
  local ps1="$BATS_TEST_DIRNAME/../ps1/verify-push-proof.ps1"
  run grep -c "bats_evidence" "$ps1"
  [ "$output" != "0" ]
  run grep -c "bats_evidence missing from push-proof.json" "$ps1"
  [ "$output" != "0" ]
  run grep -c "bats_evidence.head -ne" "$ps1"
  [ "$output" != "0" ]
}

# TSZ-9  ps1 static — no 3-arg Join-Path (PowerShell 5.1 compat)
#
# PowerShell 5.1 supports only 2-argument Join-Path.
# The 3-argument form `Join-Path A B C` (using -AdditionalChildPath) requires PS 6+.
# All 3-arg Join-Path calls must be nested: `Join-Path (Join-Path A B) C`.
# This guard catches any regression back to the 3-arg form.
@test "TSZ-9 ps1 uses no 3-arg Join-Path (PowerShell 5.1 compat)" {
  local ps1="$BATS_TEST_DIRNAME/../ps1/emit-push-proof.ps1"
  # 3-arg form 'Join-Path A B C' requires PS 6+ (-AdditionalChildPath); 5.1 supports only 2 args
  run grep -cE "Join-Path +'?[^()'|]+'? +'?[^()'|]+'? +'?[^()'|]+'?" "$ps1"
  [ "$output" = "0" ]
}
