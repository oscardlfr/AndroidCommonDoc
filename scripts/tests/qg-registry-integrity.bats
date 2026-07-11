#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/qg-registry-integrity.sh
#
# Coverage map (9 tests):
#   #RI1  clean → exit 0; report .result=="clean"                     [GREEN]
#   #RI2  stale hash → exit 2; report .result=="drift"                [GREEN]
#   #RI3  count mismatch (extra skill dir not in registry) → exit 2   [GREEN]
#   #RI4  missing SKILL.md → exit 2                                    [GREEN]
#   #RI5  NO-MUTATION: registry.json byte-identical before/after --check run  [GREEN]
#   #RI6  --require-registry + missing registry.json → exit 2         [GREEN]
#   #RI7  no-flag + missing registry.json → exit 0; .result=="n/a"    [GREEN]
#   #RI8  COUNT-EXCLUSION PRECISION: skill dir named "registry-backup"
#         (matches exclusion pattern) does NOT inflate count           [GREEN]
#   #RI9  REGRESSION: zero non-excluded skills dirs → exit 0, result==clean
#         (grep zero-match guard — would abort before bc32539)         [GREEN]
#
# Isolation: every test uses mktemp -d + teardown rm -rf.
# NEVER reads live skills/registry.json.

SCRIPT="$BATS_TEST_DIRNAME/../sh/qg-registry-integrity.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    mkdir -p "$WORK_DIR/skills/my-skill"
    mkdir -p "$WORK_DIR/.claude/agents"
    mkdir -p "$WORK_DIR/.claude/commands"

    # Create test files
    printf 'name: my-skill\n' > "$WORK_DIR/skills/my-skill/SKILL.md"
    printf 'name: test-agent\n' > "$WORK_DIR/.claude/agents/test-agent.md"
    printf '# Command\n' > "$WORK_DIR/.claude/commands/test-cmd.md"

    # wave qg-artifact-binding (W2): write_report_and_exit now merges {head,
    # generated_at, status} into every one of the 4 write sites (envelope
    # normalization). git-init WORK_DIR so head resolves to a REAL sha (not the
    # script's "unknown" fallback) — #RI1/#RI2/#RI7 assert against it below.
    git -C "$WORK_DIR" init --quiet
    git -C "$WORK_DIR" config user.email "test@test.com"
    git -C "$WORK_DIR" config user.name "Test"
    git -C "$WORK_DIR" commit --allow-empty --quiet -m "init"
    WORK_HEAD="$(git -C "$WORK_DIR" rev-parse HEAD)"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ── Helpers ───────────────────────────────────────────────────────────────────

# compute_hash <file>  — portable sha256 (matches rehash-registry.sh logic)
compute_hash() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        python3 -c "import hashlib; print(hashlib.sha256(open('$1','rb').read()).hexdigest())"
    fi
}

# write_registry_with_hashes <skill_hash> <agent_hash> <cmd_hash>
write_registry_with_hashes() {
    local skill_hash="$1"
    local agent_hash="$2"
    local cmd_hash="$3"
    cat > "$WORK_DIR/skills/registry.json" << EOF
{
  "version": 1,
  "generated": "deterministic",
  "l0_root": ".",
  "entries": [
    {"name": "my-skill",   "type": "skill",   "path": "skills/my-skill/SKILL.md",            "hash": "$skill_hash"},
    {"name": "test-agent", "type": "agent",   "path": ".claude/agents/test-agent.md",         "hash": "$agent_hash"},
    {"name": "test-cmd",   "type": "command", "path": ".claude/commands/test-cmd.md",         "hash": "$cmd_hash"}
  ]
}
EOF
}

# write_correct_registry — writes registry.json with hashes matching actual files
write_correct_registry() {
    local h_skill h_agent h_cmd
    h_skill="sha256:$(compute_hash "$WORK_DIR/skills/my-skill/SKILL.md")"
    h_agent="sha256:$(compute_hash "$WORK_DIR/.claude/agents/test-agent.md")"
    h_cmd="sha256:$(compute_hash "$WORK_DIR/.claude/commands/test-cmd.md")"
    write_registry_with_hashes "$h_skill" "$h_agent" "$h_cmd"
}

# parse_report_result — reads .result from the written registry-hash-report.json
parse_report_result() {
    python3 - "$WORK_DIR/.androidcommondoc/registry-hash-report.json" << 'PYEOF'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d['result'])
PYEOF
}

# ─────────────────────────────────────────────────────────────────────────────
# #RI1  clean — exit 0; report .result=="clean"
# All three checks pass (hash, count, SKILL.md).
# ─────────────────────────────────────────────────────────────────────────────
@test "#RI1 PASS: clean registry → exit 0 and report result==clean" {
    write_correct_registry
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    result="$(parse_report_result)"
    [ "$result" = "clean" ]

    # wave qg-artifact-binding (W2): envelope normalization — result==clean maps to
    # status==PASS, and head/generated_at are stamped (additive, on top of the
    # pre-existing result/timestamp/checks keys).
    local report="$WORK_DIR/.androidcommondoc/registry-hash-report.json"
    local status_val head_val generated_at_val
    status_val="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['status'])" "$report")"
    [ "$status_val" = "PASS" ]
    head_val="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['head'])" "$report")"
    [ "$head_val" = "$WORK_HEAD" ]
    generated_at_val="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['generated_at'])" "$report")"
    [[ "$generated_at_val" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RI2  stale hash → exit 2; JSON report .result=="drift"
# Stored hash for my-skill is intentionally wrong.
# Asserts the JSON report (not just exit code) carries result="drift".
# ─────────────────────────────────────────────────────────────────────────────
@test "#RI2 BLOCK: stale hash → exit 2 and report result==drift" {
    # Correct agent + cmd hashes, stale skill hash
    local h_agent h_cmd
    h_agent="sha256:$(compute_hash "$WORK_DIR/.claude/agents/test-agent.md")"
    h_cmd="sha256:$(compute_hash "$WORK_DIR/.claude/commands/test-cmd.md")"
    write_registry_with_hashes "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
                                "$h_agent" "$h_cmd"

    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 2 ]
    result="$(parse_report_result)"
    [ "$result" = "drift" ]

    # wave qg-artifact-binding (W2): result==drift maps to status==FAIL.
    local report="$WORK_DIR/.androidcommondoc/registry-hash-report.json"
    local status_val
    status_val="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['status'])" "$report")"
    [ "$status_val" = "FAIL" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RI3  count mismatch — extra skill dir on filesystem not in registry → exit 2
# Registry has 1 skill entry; filesystem has 2 skill dirs.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RI3 BLOCK: count mismatch (extra skill dir on filesystem) → exit 2" {
    write_correct_registry
    # Add an extra skill dir + SKILL.md (so SKILL.md check passes, count check fails)
    mkdir -p "$WORK_DIR/skills/extra-skill"
    printf 'name: extra-skill\n' > "$WORK_DIR/skills/extra-skill/SKILL.md"

    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 2 ]
    result="$(parse_report_result)"
    [ "$result" = "drift" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RI4  missing SKILL.md — skill dir exists but has no SKILL.md → exit 2
# ─────────────────────────────────────────────────────────────────────────────
@test "#RI4 BLOCK: missing SKILL.md in skill dir → exit 2" {
    write_correct_registry
    # Add a skill dir without a SKILL.md (and add it to registry so count matches)
    mkdir -p "$WORK_DIR/skills/no-skill-md"
    local h_skill h_agent h_cmd h_no
    h_skill="sha256:$(compute_hash "$WORK_DIR/skills/my-skill/SKILL.md")"
    h_agent="sha256:$(compute_hash "$WORK_DIR/.claude/agents/test-agent.md")"
    h_cmd="sha256:$(compute_hash "$WORK_DIR/.claude/commands/test-cmd.md")"
    # Write registry with matching counts (include no-skill-md as a skill entry)
    cat > "$WORK_DIR/skills/registry.json" << EOF
{
  "version": 1,
  "generated": "deterministic",
  "l0_root": ".",
  "entries": [
    {"name": "my-skill",      "type": "skill",   "path": "skills/my-skill/SKILL.md",        "hash": "$h_skill"},
    {"name": "no-skill-md",   "type": "skill",   "path": "skills/no-skill-md/SKILL.md",     "hash": "sha256:0000"},
    {"name": "test-agent",    "type": "agent",   "path": ".claude/agents/test-agent.md",     "hash": "$h_agent"},
    {"name": "test-cmd",      "type": "command", "path": ".claude/commands/test-cmd.md",     "hash": "$h_cmd"}
  ]
}
EOF

    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 2 ]
    result="$(parse_report_result)"
    [ "$result" = "drift" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RI5  NO-MUTATION: registry.json byte-identical before/after a --check run
# Hard design principle: script must NEVER write to skills/registry.json.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RI5 NO-MUTATION: skills/registry.json unchanged after --check run" {
    write_correct_registry
    local before after
    before="$(cat "$WORK_DIR/skills/registry.json")"

    bash "$SCRIPT" --project-root "$WORK_DIR" || true

    after="$(cat "$WORK_DIR/skills/registry.json")"
    [ "$before" = "$after" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RI6  --require-registry + missing registry.json → exit 2
# Load-bearing CI-path guarantee: deleting registry.json must NOT yield a free pass.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RI6 BLOCK: --require-registry + missing registry.json → exit 2" {
    # Deliberately do NOT write registry.json
    run bash "$SCRIPT" --project-root "$WORK_DIR" --require-registry
    [ "$status" -eq 2 ]
    result="$(parse_report_result)"
    [ "$result" = "drift" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RI7  no-flag + missing registry.json → exit 0; report .result=="n/a"
# Minimal / non-L0 consumer path: no registry.json + no --require-registry → n/a.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RI7 PASS: no --require-registry + missing registry.json → exit 0 and result==n/a" {
    # Deliberately do NOT write registry.json
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    result="$(parse_report_result)"
    [ "$result" = "n/a" ]

    # wave qg-artifact-binding (W2): result==n/a ALSO maps to status==PASS ("nothing to
    # check" is not a failure) — this is the third leg of the clean/n-a -> PASS,
    # drift -> FAIL mapping (see #RI1/#RI2's sibling assertions).
    local report="$WORK_DIR/.androidcommondoc/registry-hash-report.json"
    local status_val
    status_val="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['status'])" "$report")"
    [ "$status_val" = "PASS" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RI8  COUNT-EXCLUSION PRECISION: skill dir named "registry-backup"
# Matches the "registry|params|schema" exclusion pattern and must NOT inflate
# the filesystem count → still exit 0 clean (guards parity with CI's exact exclusion).
# ─────────────────────────────────────────────────────────────────────────────
@test "#RI8 PASS: skill dir named 'registry-backup' excluded from count → still clean" {
    write_correct_registry
    # Add a dir whose name matches the exclusion pattern "registry"
    mkdir -p "$WORK_DIR/skills/registry-backup"
    # (No SKILL.md — excluded from SKILL.md check too via the "registry" name exclusion)

    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    result="$(parse_report_result)"
    [ "$result" = "clean" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RI9  REGRESSION: zero non-excluded skills dirs does not abort (grep zero-match guard)
#
# Before bc32539:  FS_SKILLS=$(ls "$SKILLS_DIR" | grep -vE "registry|params|schema" | wc -l)
#   → grep exits 1 when NO lines match (zero non-excluded entries); under set -euo pipefail
#     the bare assignment propagates grep's exit 1 → script aborts before writing any report
#     → exit 1, NO report file.
# After  bc32539:  FS_SKILLS=$({ ls "$SKILLS_DIR" | grep -vE ... || true; } | wc -l ...)
#   → grep exit 1 is swallowed by || true → wc -l sees empty input → FS_SKILLS=0
#   → counts match REG_SKILLS=0 → exit 0, result=="clean".
#
# This case FAILED before bc32539 (exit 1, no report) and PASSES now — true regression guard.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RI9 regression: zero non-excluded skills dirs does not abort (grep zero-match guard)" {
    # Use an isolated temp dir so setup()'s my-skill dir does not contaminate the count.
    RI9_DIR="$(mktemp -d)"

    # skills/ contains ONLY an excluded-name dir → no non-excluded entries (FS_SKILLS=0)
    mkdir -p "$RI9_DIR/skills/registry-foo"
    printf 'name: registry-foo\n' > "$RI9_DIR/skills/registry-foo/SKILL.md"

    # Empty agents/ and commands/ dirs (count=0 each, matching empty registry)
    mkdir -p "$RI9_DIR/.claude/agents"
    mkdir -p "$RI9_DIR/.claude/commands"

    # registry.json with entries:[] → REG_SKILLS=0, REG_AGENTS=0, REG_COMMANDS=0
    # All counts match FS counts → clean.
    cat > "$RI9_DIR/skills/registry.json" << 'EOF'
{
  "version": 1,
  "generated": "deterministic",
  "l0_root": ".",
  "entries": []
}
EOF

    run bash "$SCRIPT" --project-root "$RI9_DIR" --require-registry

    # exit 0 (NOT 1 — the old grep-abort produced exit 1 with no report)
    [ "$status" -eq 0 ]

    # report file was written (old bug: script aborted before mkdir -p / write_report_and_exit)
    [ -f "$RI9_DIR/.androidcommondoc/registry-hash-report.json" ]

    # result == "clean"
    result="$(python3 - "$RI9_DIR/.androidcommondoc/registry-hash-report.json" << 'PYEOF'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d['result'])
PYEOF
)"
    [ "$result" = "clean" ]

    rm -rf "$RI9_DIR"
}
