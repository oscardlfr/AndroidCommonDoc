#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Integration tests: run-qg + committed-tree integrity block
# (qg-committed-integrity wave, Step 2).
#
# Coverage map (4 tests):
#   #CI1  RED  — stale committed registry (clean tree) → run-qg exit 2;
#               "derived artifact drift detected"
#   #CI2  GREEN — coherent committed registry → run-qg exit 0 (mints proof)
#   #CI3  clean-tree BLOCK — uncommitted dirty tracked file → exit 2;
#               "tracked artifact drift detected"
#   #CI4  clean-tree ALLOW — untracked .claude/wave-quality-gates/foo.md → exit 0
#
# Isolation: every test uses mktemp -d + git init + teardown rm -rf.
# setup() commits ALL fixtures so the tree is CLEAN before run-qg.
# HEAD_SHA is captured AFTER the fixture commit (architect-flagged: HEAD-binding breaks
# if captured before the fixture commit).

EMITTER="$BATS_TEST_DIRNAME/../sh/emit-push-proof.sh"
MANIFEST_SRC="$BATS_TEST_DIRNAME/../../quality-gate-manifest.json"
SCRIPTS_SRC="$BATS_TEST_DIRNAME/.."

setup() {
    REPO="$(mktemp -d)"
    git init "$REPO" --quiet
    git -C "$REPO" config user.email "test@test.com"
    git -C "$REPO" config user.name "Test"
    git -C "$REPO" config core.autocrlf false
    git -C "$REPO" commit --allow-empty --quiet -m "feat(core): init"
    git -C "$REPO" checkout -b feature/ci-integrity-test --quiet

    ACDOC="$REPO/.androidcommondoc"
    mkdir -p "$ACDOC"

    # ── .gitignore so .androidcommondoc/ and .planning/wave*/ are invisible ──
    printf '.androidcommondoc/\n.planning/wave*/\n' > "$REPO/.gitignore"

    # ── Copy manifest ──────────────────────────────────────────────────────────
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

    # ── Mirror scripts/sh/ (emitter + registry scripts + lib) ─────────────────
    # wave qg-artifact-binding: run-qg now ALSO invokes emit-rule-inventory.sh and
    # emit-pre-pr-report.sh, mint-internal, strictly after the registry re-run —
    # copy both so #CI2/#CI4 (which reach that far) find them.
    mkdir -p "$REPO/scripts/sh/lib"
    cp "$SCRIPTS_SRC/sh/emit-push-proof.sh"             "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/lib/manifest-digest.sh"          "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/lib/audit-append.sh"             "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/qg-registry-integrity.sh"        "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/rehash-registry.sh"              "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/emit-rule-inventory.sh"          "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/emit-pre-pr-report.sh"           "$REPO/scripts/sh/"

    # ── Build a real skills/ fixture with one skill + correct hash ────────────
    mkdir -p "$REPO/skills/test-skill"
    mkdir -p "$REPO/.claude/agents"
    mkdir -p "$REPO/.claude/commands"
    printf 'name: test-skill\ndescription: test\n' > "$REPO/skills/test-skill/SKILL.md"
    printf 'name: test-agent\n' > "$REPO/.claude/agents/test-agent.md"
    printf '# cmd\n' > "$REPO/.claude/commands/test-cmd.md"

    # Compute the correct hash for the SKILL.md file
    local skill_hash agent_hash cmd_hash
    if command -v sha256sum &>/dev/null; then
        skill_hash="sha256:$(sha256sum "$REPO/skills/test-skill/SKILL.md" | cut -d' ' -f1)"
        agent_hash="sha256:$(sha256sum "$REPO/.claude/agents/test-agent.md" | cut -d' ' -f1)"
        cmd_hash="sha256:$(sha256sum "$REPO/.claude/commands/test-cmd.md" | cut -d' ' -f1)"
    elif command -v shasum &>/dev/null; then
        skill_hash="sha256:$(shasum -a 256 "$REPO/skills/test-skill/SKILL.md" | cut -d' ' -f1)"
        agent_hash="sha256:$(shasum -a 256 "$REPO/.claude/agents/test-agent.md" | cut -d' ' -f1)"
        cmd_hash="sha256:$(shasum -a 256 "$REPO/.claude/commands/test-cmd.md" | cut -d' ' -f1)"
    else
        skill_hash="sha256:$(python3 -c "import hashlib; print(hashlib.sha256(open('$REPO/skills/test-skill/SKILL.md','rb').read()).hexdigest())")"
        agent_hash="sha256:$(python3 -c "import hashlib; print(hashlib.sha256(open('$REPO/.claude/agents/test-agent.md','rb').read()).hexdigest())")"
        cmd_hash="sha256:$(python3 -c "import hashlib; print(hashlib.sha256(open('$REPO/.claude/commands/test-cmd.md','rb').read()).hexdigest())")"
    fi

    # Write the COHERENT registry.json (hashes match committed content)
    cat > "$REPO/skills/registry.json" << EOF
{
  "version": 1,
  "generated": "deterministic",
  "l0_root": ".",
  "entries": [
    {"name": "test-skill",  "type": "skill",   "path": "skills/test-skill/SKILL.md",      "hash": "$skill_hash"},
    {"name": "test-agent",  "type": "agent",   "path": ".claude/agents/test-agent.md",     "hash": "$agent_hash"},
    {"name": "test-cmd",    "type": "command", "path": ".claude/commands/test-cmd.md",     "hash": "$cmd_hash"}
  ]
}
EOF

    # ── Also install resolve-required-roles.js stub (FAST-PATH — no arch verdicts needed) ──
    mkdir -p "$REPO/scripts/sh/lib"
    cat > "$REPO/scripts/sh/lib/resolve-required-roles.js" << 'JSEOF'
// Stub for CI-integrity integration tests: emit [] (FAST-PATH) so run-qg
// does not require arch verdicts or deliberation.
process.stdout.write('[]');
process.exit(0);
JSEOF

    # ── Commit ALL fixtures so the tree is CLEAN before run-qg ────────────────
    git -C "$REPO" add -A
    git -C "$REPO" commit --quiet -m "test(ci-integrity): fixture commit"

    # ── RE-CAPTURE HEAD_SHA AFTER the fixture commit (architect-flagged) ───────
    HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"
}

teardown() {
    rm -rf "$REPO"
}

# ── Fixture writers ───────────────────────────────────────────────────────────

# write_valid_bats_handoff — writes a well-formed, full-scope, HEAD-bound bats handoff
# into $ACDOC (Wave A: run-qg's test-suite-evidence-* check requires real evidence
# behind any claimed "test-suite": PASS step). HEAD is re-derived from git at call time.
# generated_at is captured strictly after the caller's own started_at timestamp,
# satisfying select_bats_handoff's --since floor (real wall-clock ordering only moves
# forward within one test).
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

# write_valid_artifact_receipts — writes HEAD-bound, fresh, status:PASS
# secret-scan-report.json + doc-validator-report.json into $ACDOC (wave
# qg-artifact-binding, W1). These are the ONLY two required_steps[] loop members
# (registry-hash and pre-pr are both mint_rederived, excluded structurally) — every
# run-qg-to-PASS fixture in this file must stage both, else run-qg dies
# artifact-binding-absent before ever reaching #CI1's/#CI3's own intended die-code.
write_valid_artifact_receipts() {
    local head
    head="$(git -C "$REPO" rev-parse HEAD)"
    local generated_at
    generated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    mkdir -p "$ACDOC"
    printf '{"status":"PASS","reason_code":"OK","tool":"trufflehog","version":"test","count":0,"head":"%s","generated_at":"%s"}\n' \
        "$head" "$generated_at" > "$ACDOC/secret-scan-report.json"
    printf '{"step":"doc-validator-parity","ran":true,"result":"PASS","status":"PASS","head":"%s","generated_at":"%s","summary":"test fixture"}\n' \
        "$head" "$generated_at" > "$ACDOC/doc-validator-report.json"
}

# write_quality_gate_report — writes a valid quality-gate-report.json
# $1=extra_steps_json (default ""), $2=override_deliberation_json (default "")
#
# NOTE: The fixture commit includes .sh scripts and .json (non-doc, non-yaml) files,
# so the `task_is_code_changes` predicate evaluates TRUE. The `production-file-verify`
# conditional step must therefore be PASS (not SKIP) — this is enforced by emit-push-proof.sh.
# We override it to PASS here to satisfy the predicate consistency check.
#
# Wave A: also stamps report.started_at and writes a matching valid bats handoff (via
# write_valid_bats_handoff) BY DEFAULT — this helper's report always defaults
# test-suite to PASS, so run-qg's report-started-at-* and test-suite-evidence-* checks
# now fire unconditionally, before #CI1/#CI3's own intended die-code is ever reached.
write_quality_gate_report() {
    local extra_steps="${1:-}"
    local override_deliberation="${2:-}"
    local started_at
    started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    # 51b0d63: run-qg's report-head-* check requires report.head present and equal to
    # the current HEAD. Re-derived fresh from git at call time (never a cached shell
    # variable), mirroring write_valid_bats_handoff's own established pattern.
    local report_head
    report_head="$(git -C "$REPO" rev-parse HEAD)"
    python3 - "$ACDOC/quality-gate-report.json" "$REPO/quality-gate-manifest.json" \
        "${extra_steps}" "${override_deliberation}" "$started_at" "$report_head" << 'PYEOF'
import json, sys

report_path         = sys.argv[1]
manifest_path       = sys.argv[2]
extra_steps_raw     = sys.argv[3]
override_delib_raw  = sys.argv[4]
started_at          = sys.argv[5]
report_head         = sys.argv[6]

manifest = json.load(open(manifest_path, encoding='utf-8'))

steps = []
for rs in manifest.get('required_steps', []):
    steps.append({"step": rs['id'], "ran": True, "result": "PASS"})
for cs in manifest.get('conditional_steps', []):
    # Default: SKIP all conditional steps with reason.
    # production-file-verify must be PASS because task_is_code_changes is TRUE
    # (the fixture commit includes .sh script files which are code changes).
    if cs['id'] == 'production-file-verify':
        steps.append({"step": cs['id'], "ran": True, "result": "PASS"})
    else:
        steps.append({"step": cs['id'], "ran": False, "result": "SKIP",
                      "reason": "predicate false in isolated test repo"})

if extra_steps_raw.strip():
    extras = json.loads(extra_steps_raw)
    by_id = {s['step']: s for s in steps}
    for e in extras:
        by_id[e['step']] = e
    steps = list(by_id.values())

# FAST-PATH resolver stub means no architect deliberation required.
# Keep deliberation block absent (or minimal) — FAST-PATH skips the floor.
deliberation = {
    "architects_consulted": [],
    "incorporated_at": "2026-06-14T00:00:00Z",
}
if override_delib_raw.strip():
    override = json.loads(override_delib_raw)
    deliberation.update(override)

report = {
    "started_at": started_at,
    "head": report_head,
    "deliberation": deliberation,
    # wave qg-artifact-binding (W4): managed-key-subset contract — write_valid_
    # artifact_receipts (called below) stages a matching status:PASS secret-scan
    # receipt; this repo's registry.json is coherent (setup() writes matching
    # hashes) so the mint's post-rerun registry-hash result is "clean" -> PASS;
    # no .commitlintrc.json is copied in so commit_lint has nothing to check -> PASS.
    "pre_pr_coverage": {
        "status": "PASS", "modules": 1,
        "secret_scan": "PASS", "registry_hash_freshness": "PASS", "commit_lint": "PASS",
    },
    "discovered_rules": [
        {"rule": "committed-tree-integrity", "rule_id": "committed-tree-integrity",
         "verified_by": "qg-committed-integrity.bats"}
    ],
    "steps": steps,
}
with open(report_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
    f.write('\n')
PYEOF
    write_valid_bats_handoff
    write_valid_artifact_receipts
}

# run_emitter — always passes --repo-root so the emitter uses the isolated repo
run_emitter() {
    run bash -c "SKIP_PUSH_GATE= PUSH_AUTHORIZATION_BYPASS= \
        CLAUDE_WAVE_SLUG=ci-integrity-test bash '$EMITTER' --repo-root '$REPO' $*"
}

# ─────────────────────────────────────────────────────────────────────────────
# #CI1  RED — stale committed registry (clean tree) → run-qg exit 2
# Template/file committed; registry NOT rehashed → hash mismatch → "derived artifact drift".
# The tree is clean (the stale registry is committed, not just modified), so
# clean-tree assertion passes but registry-integrity check fires.
# ─────────────────────────────────────────────────────────────────────────────
@test "#CI1 BLOCK: stale committed registry (clean tree) → exit 2; derived artifact drift" {
    # Modify SKILL.md content and commit it WITHOUT rehashing registry.json
    printf 'name: test-skill\ndescription: MODIFIED CONTENT\n' > "$REPO/skills/test-skill/SKILL.md"
    git -C "$REPO" add skills/test-skill/SKILL.md
    git -C "$REPO" commit --quiet -m "chore: update skill content without rehashing"
    # RE-CAPTURE HEAD after this additional commit
    HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

    write_quality_gate_report

    run_emitter --subcommand run-qg
    [ "$status" -eq 2 ]
    [[ "$output" == *"derived artifact drift detected"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #CI2  GREEN — coherent committed registry → run-qg exit 0 (mints proof)
# Template + registry committed coherently; tree is clean.
# The committed hashes match the committed files → both checks pass → proof mints.
# ─────────────────────────────────────────────────────────────────────────────
@test "#CI2 PASS: coherent committed registry → run-qg exit 0 (proof minted)" {
    # setup() already committed SKILL.md + matching registry.json → coherent
    write_quality_gate_report

    run_emitter --subcommand run-qg
    [ "$status" -eq 0 ]
    # push-proof.json must have been written
    [ -f "$ACDOC/push-proof.json" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #CI3  clean-tree BLOCK — uncommitted dirty tracked file → exit 2
# Modify a tracked file WITHOUT committing → git status shows dirty → clean-tree
# assertion fires BEFORE registry check.
# ─────────────────────────────────────────────────────────────────────────────
@test "#CI3 BLOCK: uncommitted tracked file change → exit 2; tracked artifact drift" {
    # Modify a tracked file but do NOT git add / commit
    printf 'DIRTY CONTENT\n' > "$REPO/skills/registry.json"

    write_quality_gate_report

    run_emitter --subcommand run-qg
    [ "$status" -eq 2 ]
    [[ "$output" == *"tracked artifact drift detected"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #CI4  clean-tree ALLOW — untracked .claude/wave-quality-gates/foo.md → exit 0
# An untracked sentinel file in .claude/wave-quality-gates/ is the ONE allowed
# exception. run-qg must proceed past the clean-tree assertion (exit 0 if rest valid).
# ─────────────────────────────────────────────────────────────────────────────
@test "#CI4 PASS: untracked .claude/wave-quality-gates/foo.md → clean-tree passes → exit 0" {
    # Create the untracked sentinel (NOT git-added, NOT committed)
    mkdir -p "$REPO/.claude/wave-quality-gates"
    printf 'sentinel\n' > "$REPO/.claude/wave-quality-gates/foo.md"

    write_quality_gate_report

    run_emitter --subcommand run-qg
    [ "$status" -eq 0 ]
    [ -f "$ACDOC/push-proof.json" ]
}
