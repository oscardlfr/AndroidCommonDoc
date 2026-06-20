#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/qg-doc-validators.sh (wave qg-doc-coverage).
#
# Coverage map (10 tests):
#   #DV1  PASS: valid relative link in docs/agents/ → exit 0, cross_refs PASS
#   #DV2  FAIL: broken link in docs/agents/ → exit 2, cross_refs FAIL
#   #DV3  PASS: https:// link skipped (+ at least one valid .md link) → exit 0
#   #DV4  PASS: docs/sub/f.md with all 4 frontmatter fields → exit 0
#   #DV5  FAIL: docs/sub/f.md missing 'slug' → exit 2
#   #DV6  PASS: hub doc (hub.md) is exempt → exit 0
#   #DV7  PASS: archive doc is exempt → exit 0
#   #DV8  JSON has subchecks.cross_refs.status AND subchecks.doc_structure_vitest.status
#   #DV9  JSON top-level result == FAIL when cross_refs fails
#   #DV10 JSON step field == "doc-validator-parity"
#
# Isolation rule: every test uses mktemp -d + teardown rm -rf.
# Never reads live docs/ tree or live .androidcommondoc/.
#
# FRAGILITY CAVEAT: the cross_refs link block uses grep under set -euo pipefail.
# A docs/agents/*.md file with ZERO [text](x.md) links causes grep exit 1 → pipefail abort.
# Every docs/agents/*.md fixture MUST contain at least one resolvable [x](something.md) link.

SCRIPT="$BATS_TEST_DIRNAME/../sh/qg-doc-validators.sh"

setup() {
  FIXTURE="$(mktemp -d)"
  mkdir -p "$FIXTURE/docs/agents"
  mkdir -p "$FIXTURE/.androidcommondoc"
  # git init so HEAD_SHA resolves (script uses git rev-parse HEAD)
  git init "$FIXTURE" --quiet
  git -C "$FIXTURE" config user.email "test@test.com"
  git -C "$FIXTURE" config user.name "Test"
  git -C "$FIXTURE" commit --allow-empty --quiet -m "init"
}

teardown() {
  rm -rf "$FIXTURE"
}

# ── Helper ────────────────────────────────────────────────────────────────────

run_cross_refs() {
  run bash "$SCRIPT" --only cross-refs --project-root "$FIXTURE"
}

read_report_field() {
  # $1 = jq-style path (e.g. '.step')
  python3 - "$FIXTURE/.androidcommondoc/doc-validator-report.json" "$1" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
# Simple dot-path resolver for single-level and nested paths
key_path = sys.argv[2].lstrip('.')
parts = key_path.split('.')
val = data
for p in parts:
    val = val[p]
print(val)
PYEOF
}

# ── #DV1: valid relative link resolves ───────────────────────────────────────

@test "#DV1 PASS: valid relative link in docs/agents/ → exit 0, cross_refs PASS" {
  # a.md links to b.md (which exists); both are in docs/agents/.
  # Frontmatter required: docs/agents/*.md are included in Block 2 frontmatter check.
  printf '%s\n' \
    '---' \
    'scope: [agents]' \
    'sources: [team]' \
    'targets: [developers]' \
    'slug: doc-a' \
    '---' \
    '# A' \
    '' \
    'See [B](b.md) for details.' \
    > "$FIXTURE/docs/agents/a.md"
  printf '%s\n' \
    '---' \
    'scope: [agents]' \
    'sources: [team]' \
    'targets: [developers]' \
    'slug: doc-b' \
    '---' \
    '# B' \
    '' \
    'See [A](a.md) for details.' \
    > "$FIXTURE/docs/agents/b.md"

  run_cross_refs
  [ "$status" -eq 0 ]
  run read_report_field 'subchecks.cross_refs.status'
  [ "$output" = "PASS" ]
}

# ── #DV2: broken relative link → FAIL ────────────────────────────────────────

@test "#DV2 FAIL: broken link in docs/agents/ → exit 2, cross_refs FAIL" {
  # a.md has a valid link (b.md) AND a broken link (missing.md).
  # The valid link ensures grep does not abort under pipefail.
  # Both files carry required frontmatter so only the broken link triggers failure.
  printf '%s\n' \
    '---' \
    'scope: [agents]' \
    'sources: [team]' \
    'targets: [developers]' \
    'slug: doc-a' \
    '---' \
    '# A' \
    '' \
    'See [B](b.md) for reference.' \
    'Also see [Missing](missing.md).' \
    > "$FIXTURE/docs/agents/a.md"
  printf '%s\n' \
    '---' \
    'scope: [agents]' \
    'sources: [team]' \
    'targets: [developers]' \
    'slug: doc-b' \
    '---' \
    '# B' \
    '' \
    'Back to [A](a.md).' \
    > "$FIXTURE/docs/agents/b.md"

  run_cross_refs
  [ "$status" -eq 2 ]
  run read_report_field 'subchecks.cross_refs.status'
  [ "$output" = "FAIL" ]
}

# ── #DV3: https:// link skipped (with valid .md link present) ────────────────

@test "#DV3 PASS: https:// link is skipped (plus a valid .md link) → exit 0" {
  # CAVEAT: docs/agents/*.md must have ≥1 .md link to avoid grep-abort.
  # a.md has both a valid .md link (b.md) and an https:// link (skipped).
  # Both files carry required frontmatter.
  printf '%s\n' \
    '---' \
    'scope: [agents]' \
    'sources: [team]' \
    'targets: [developers]' \
    'slug: doc-a' \
    '---' \
    '# A' \
    '' \
    'See [B](b.md) for details.' \
    'Also see [External](https://example.com/doc.md).' \
    > "$FIXTURE/docs/agents/a.md"
  printf '%s\n' \
    '---' \
    'scope: [agents]' \
    'sources: [team]' \
    'targets: [developers]' \
    'slug: doc-b' \
    '---' \
    '# B' \
    '' \
    'Back to [A](a.md).' \
    > "$FIXTURE/docs/agents/b.md"

  run_cross_refs
  [ "$status" -eq 0 ]
  run read_report_field 'subchecks.cross_refs.status'
  [ "$output" = "PASS" ]
}

# ── #DV4: all 4 frontmatter fields present → PASS ────────────────────────────

@test "#DV4 PASS: docs/sub/f.md with all 4 frontmatter fields → exit 0" {
  mkdir -p "$FIXTURE/docs/sub"
  printf '%s\n' \
    '---' \
    'scope: [testing]' \
    'sources: [source-a]' \
    'targets: [target-b]' \
    'slug: my-doc' \
    '---' \
    '# My Doc' \
    > "$FIXTURE/docs/sub/f.md"

  run_cross_refs
  [ "$status" -eq 0 ]
  run read_report_field 'subchecks.cross_refs.status'
  [ "$output" = "PASS" ]
}

# ── #DV5: missing 'slug' frontmatter field → FAIL ────────────────────────────

@test "#DV5 FAIL: docs/sub/f.md missing 'slug' → exit 2" {
  mkdir -p "$FIXTURE/docs/sub"
  printf '%s\n' \
    '---' \
    'scope: [testing]' \
    'sources: [source-a]' \
    'targets: [target-b]' \
    '---' \
    '# My Doc (missing slug)' \
    > "$FIXTURE/docs/sub/f.md"

  run_cross_refs
  [ "$status" -eq 2 ]
  run read_report_field 'subchecks.cross_refs.status'
  [ "$output" = "FAIL" ]
}

# ── #DV6: hub doc is exempt ───────────────────────────────────────────────────

@test "#DV6 PASS: hub doc (hub.md) is exempt from frontmatter check → exit 0" {
  mkdir -p "$FIXTURE/docs/agents"
  # hub.md with no frontmatter; script skips *hub.md files
  printf '%s\n' \
    '# Agents Hub' \
    '' \
    'No frontmatter required for hub docs.' \
    > "$FIXTURE/docs/agents/agents-hub.md"

  run_cross_refs
  [ "$status" -eq 0 ]
  run read_report_field 'subchecks.cross_refs.status'
  [ "$output" = "PASS" ]
}

# ── #DV7: archive doc is exempt ──────────────────────────────────────────────

@test "#DV7 PASS: docs/archive/old.md is exempt from frontmatter check → exit 0" {
  mkdir -p "$FIXTURE/docs/archive"
  # archive doc with no frontmatter; script skips docs/archive/* files
  printf '%s\n' \
    '# Old Doc' \
    '' \
    'Archived content; no frontmatter required.' \
    > "$FIXTURE/docs/archive/old.md"

  run_cross_refs
  [ "$status" -eq 0 ]
  run read_report_field 'subchecks.cross_refs.status'
  [ "$output" = "PASS" ]
}

# ── #DV8: JSON has both subcheck status fields ────────────────────────────────

@test "#DV8 PASS: JSON has subchecks.cross_refs.status AND subchecks.doc_structure_vitest.status" {
  # Minimal valid fixture (no docs → all checks PASS by default)
  run_cross_refs
  # Both subcheck keys must be present in the JSON report
  run python3 - "$FIXTURE/.androidcommondoc/doc-validator-report.json" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
subs = data.get('subchecks', {})
assert 'cross_refs' in subs, "missing subchecks.cross_refs"
assert 'status' in subs['cross_refs'], "missing subchecks.cross_refs.status"
assert 'doc_structure_vitest' in subs, "missing subchecks.doc_structure_vitest"
assert 'status' in subs['doc_structure_vitest'], "missing subchecks.doc_structure_vitest.status"
print("OK")
PYEOF
  [ "$status" -eq 0 ]
  [[ "$output" =~ "OK" ]]
}

# ── #DV9: top-level result == FAIL when cross_refs fails ─────────────────────

@test "#DV9 FAIL: JSON top-level result == FAIL when cross_refs fails" {
  # Introduce a broken link to trigger cross_refs FAIL.
  # Files carry frontmatter so only the broken link (no-such-file.md) causes failure.
  printf '%s\n' \
    '---' \
    'scope: [agents]' \
    'sources: [team]' \
    'targets: [developers]' \
    'slug: doc-a' \
    '---' \
    '# A' \
    '' \
    'See [B](b.md) and [Missing](no-such-file.md).' \
    > "$FIXTURE/docs/agents/a.md"
  printf '%s\n' \
    '---' \
    'scope: [agents]' \
    'sources: [team]' \
    'targets: [developers]' \
    'slug: doc-b' \
    '---' \
    '# B' \
    '' \
    'Back to [A](a.md).' \
    > "$FIXTURE/docs/agents/b.md"

  run bash "$SCRIPT" --only cross-refs --project-root "$FIXTURE" || true
  run read_report_field 'result'
  [ "$output" = "FAIL" ]
}

# ── #DV10: JSON step field == "doc-validator-parity" ─────────────────────────

@test "#DV10 PASS: JSON step field == 'doc-validator-parity'" {
  run_cross_refs
  run read_report_field 'step'
  [ "$output" = "doc-validator-parity" ]
}

# ── #DV11: zero-.md-link file does not abort under set -e/pipefail ───────────
# Regression guard for the || true fix in the link-grep pipeline.
# Without the guard: grep exit 1 on zero matches → pipefail → set -e abort → non-zero exit.
# With the guard: LINKS="" (empty), inner for-loop is a no-op → exit 0, cross_refs PASS.

@test "#DV11 PASS: docs/agents/nolinks.md with valid frontmatter but ZERO .md links → exit 0, cross_refs PASS" {
  # nolinks.md has all 4 required frontmatter fields but no [text](*.md) links at all.
  printf '%s\n' \
    '---' \
    'scope: [agents]' \
    'sources: [team]' \
    'targets: [developers]' \
    'slug: no-links-doc' \
    '---' \
    '# No Links Doc' \
    '' \
    'This file contains no markdown links to other .md files.' \
    'It may reference https://example.com but no relative links.' \
    > "$FIXTURE/docs/agents/nolinks.md"

  run_cross_refs
  [ "$status" -eq 0 ]
  run read_report_field 'subchecks.cross_refs.status'
  [ "$output" = "PASS" ]
}
