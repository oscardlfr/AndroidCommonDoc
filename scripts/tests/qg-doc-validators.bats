#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/qg-doc-validators.sh (wave qg-doc-coverage).
#
# Coverage map (14 tests):
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
#   #DV11 PASS: zero-.md-link docs/agents file → exit 0, cross_refs PASS (|| true guard regression)
#   #DV12 PASS: ANDROID_COMMON_DOC is exported to the vitest child, matching --toolkit-root (BL-W4-2)
#   #DV13 PASS: every docs/agents/*.md reachable from agents-hub.md → exit 0, hub_reachability PASS
#         (wave qg-artifact-binding, W10)
#   #DV14 FAIL: an unlinked docs/agents/*.md (orphan) → exit 2, hub_reachability FAIL, names the
#         orphan (wave qg-artifact-binding, W10 — Regression Matrix `hub_reachability` row)
#
# Isolation rule: every test uses mktemp -d + teardown rm -rf.
# Never reads live docs/ tree or live .androidcommondoc/.
# Regression: a docs/agents/*.md file with ZERO [text](x.md) links is ALLOWED — the cross_refs link grep is guarded with `|| true` (degrades to an empty list, no set -e abort). #DV11 locks this in.

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

# wave qg-artifact-binding (W10): hub_reachability is scoped to docs/agents/ only.
run_hub_reachability() {
  run bash "$SCRIPT" --only hub-reachability --project-root "$FIXTURE"
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

# ── #DV12: ANDROID_COMMON_DOC reaches the vitest child (BL-W4-2) ─────────────
# TOOLKIT_ROOT is derived from --toolkit-root (or $ANDROID_COMMON_DOC) but was never
# re-exported before the vitest child spawn (run_doc_structure_vitest, L183), so the
# child re-resolved the toolkit root independently via paths.ts's getToolkitRoot() and
# never saw the parent's intended root. This stubs `npx` on PATH to capture the
# ANDROID_COMMON_DOC value visible INSIDE the "vitest" child's own environment,
# proving the fix's export reaches the child end-to-end (not merely a parent-shell
# variable). Pre-fix: the child sees "UNSET" (no ambient ANDROID_COMMON_DOC is set for
# this test). Post-fix: the child sees the exact --toolkit-root value.

@test "#DV12 PASS: ANDROID_COMMON_DOC is exported to the vitest child, matching --toolkit-root" {
  local toolkit_root="$FIXTURE/toolkit-alt-root"
  mkdir -p "$toolkit_root/mcp-server"
  printf '{}' > "$toolkit_root/mcp-server/package.json"

  # Stub npx: when invoked as `npx vitest ...`, capture the ANDROID_COMMON_DOC visible
  # in ITS OWN environment and simulate a passing vitest run.
  local stub_bin="$FIXTURE/stub-bin"
  mkdir -p "$stub_bin"
  local capture_file="$FIXTURE/npx-env-capture.txt"
  cat > "$stub_bin/npx" <<STUBEOF
#!/usr/bin/env bash
if [ "\$1" = "vitest" ]; then
  printf '%s' "\${ANDROID_COMMON_DOC:-UNSET}" > "$capture_file"
  echo "1 passed (stub)"
  exit 0
fi
exit 127
STUBEOF
  chmod +x "$stub_bin/npx"

  run env PATH="$stub_bin:$PATH" bash "$SCRIPT" --project-root "$FIXTURE" --toolkit-root "$toolkit_root" --only structure
  [ "$status" -eq 0 ]
  [ -f "$capture_file" ]
  [ "$(cat "$capture_file")" = "$toolkit_root" ]

  run read_report_field 'subchecks.doc_structure_vitest.status'
  [ "$output" = "PASS" ]
}

# ── #DV13/#DV14: hub_reachability (wave qg-artifact-binding, W10) ────────────
# Every docs/agents/*.md must be reachable from agents-hub.md by following relative
# markdown links transitively. Scoped to docs/agents/ only (repo-wide reachability
# is out of scope — see docs/agents/quality-gater-artifact-binding.md's Non-Goals).

@test "#DV13 PASS: every docs/agents/*.md reachable from agents-hub.md → exit 0, hub_reachability PASS" {
  printf '%s\n' \
    '# Agents Hub' \
    '' \
    'See [Child](child.md) for details.' \
    > "$FIXTURE/docs/agents/agents-hub.md"
  printf '%s\n' \
    '# Child' \
    '' \
    'Back to [Hub](agents-hub.md).' \
    > "$FIXTURE/docs/agents/child.md"

  run_hub_reachability
  [ "$status" -eq 0 ]
  run read_report_field 'subchecks.hub_reachability.status'
  [ "$output" = "PASS" ]
}

@test "#DV14 FAIL: an unlinked docs/agents/*.md (orphan) → exit 2, hub_reachability FAIL, names the orphan" {
  printf '%s\n' \
    '# Agents Hub' \
    '' \
    'See [Child](child.md) for details.' \
    > "$FIXTURE/docs/agents/agents-hub.md"
  printf '%s\n' \
    '# Child' \
    '' \
    'Back to [Hub](agents-hub.md).' \
    > "$FIXTURE/docs/agents/child.md"
  # orphan.md is never linked from agents-hub.md (directly or transitively).
  printf '%s\n' \
    '# Orphan' \
    '' \
    'Nothing links to this file.' \
    > "$FIXTURE/docs/agents/orphan.md"

  run_hub_reachability
  [ "$status" -eq 2 ]
  run read_report_field 'subchecks.hub_reachability.status'
  [ "$output" = "FAIL" ]
  run read_report_field 'subchecks.hub_reachability.summary'
  [[ "$output" == *"orphan.md"* ]]
}
