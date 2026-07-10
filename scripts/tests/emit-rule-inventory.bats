#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/emit-rule-inventory.sh (wave qg-artifact-binding, W5) — the
# QG mint-internal derived-artifact producer that enumerates project rules from
# fixed, STRUCTURED sources only (never a prose-scrape of CLAUDE.md).
#
# Coverage map (13 tests):
#   #ERI1  PASS: both real sources present → 3 expected ids, 2 sources w/ correct
#          count/sha256, exit 0
#   #ERI2  PASS: project-constraints.md absent (commitlintrc present) → only the
#          commitlint id, absent source skipped (not fatal)
#   #ERI3  PASS: .commitlintrc.json absent (project-constraints present) → only
#          the pc:* ids, absent source skipped (not fatal)
#   #ERI4  PASS: both sources absent → 0 sources, 0 rules, exit 0 (nothing to
#          check is not a failure)
#   #ERI5  BLOCK: project-constraints.md exists but has ZERO "## " headers →
#          rule-inventory-empty-source, exit 2
#   #ERI6  BLOCK: .commitlintrc.json exists but valid_scopes:[] →
#          rule-inventory-empty-source, exit 2
#   #ERI7  PASS (positive control for #ERI5/#ERI6): real, non-empty sources →
#          non-empty inventory, exit 0
#   #ERI8  PASS: head field == git rev-parse HEAD of the fixture repo
#   #ERI9  PASS: generated_at is a parseable UTC ISO-8601 timestamp
#   #ERI10 PASS (R13 positive control): each source's recorded sha256 matches an
#          independently-computed sha256 of that file's actual bytes
#   #ERI11 R13 PROVENANCE: mutating a source's content between two invocations
#          changes the recorded sha256 to match the NEW content — proving the
#          binding is on live input bytes, never a cached/stale value
#   #ERI12 PASS: .commitlintrc.json's standard commitlint scope-enum shape
#          (rules.scope-enum[2]) is accepted when valid_scopes is absent
#   #ERI13 PASS: rules[] entries carry {id, source} — source points at the
#          relative path that produced each id
#
# Isolation: every test uses mktemp -d + git init + teardown rm -rf.
# Never reads live docs/ tree or live .commitlintrc.json.

SCRIPT="$BATS_TEST_DIRNAME/../sh/emit-rule-inventory.sh"

setup() {
  REPO="$(mktemp -d)"
  git init "$REPO" --quiet
  git -C "$REPO" config user.email "test@test.com"
  git -C "$REPO" config user.name "Test"
  git -C "$REPO" commit --allow-empty --quiet -m "init"
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"
  ACDOC="$REPO/.androidcommondoc"
}

teardown() {
  rm -rf "$REPO"
}

# ── Fixture writers ───────────────────────────────────────────────────────────

# write_constraints_doc — a well-formed docs/guides/project-constraints.md with 2
# "## " headers, producing ids pc:rule-one and pc:rule-two.
write_constraints_doc() {
  mkdir -p "$REPO/docs/guides"
  printf '%s\n' \
    '# Project Constraints' \
    '' \
    '## Rule One' \
    'Do the first thing.' \
    '' \
    '## Rule Two' \
    'Do the second thing.' \
    > "$REPO/docs/guides/project-constraints.md"
}

# write_commitlintrc — a well-formed .commitlintrc.json with valid_scopes,
# producing id commitlint:valid-scopes.
write_commitlintrc() {
  printf '%s\n' '{"valid_scopes": ["core", "tests"]}' > "$REPO/.commitlintrc.json"
}

# inventory_field <jq-style dot-path> — reads a field from the emitted inventory.
inventory_field() {
  python3 - "$ACDOC/rule-inventory.json" "$1" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
key_path = sys.argv[2].lstrip('.')
val = data
for p in key_path.split('.'):
    val = val[p]
print(val)
PYEOF
}

# inventory_rule_ids — prints a sorted, comma-joined list of rules[].id
inventory_rule_ids() {
  python3 -c "
import json
data = json.load(open('$ACDOC/rule-inventory.json', encoding='utf-8'))
print(','.join(sorted(r['id'] for r in data.get('rules', []))))
"
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI1 PASS: both real sources present → 3 expected ids, 2 sources w/ correct count/sha256, exit 0" {
  write_constraints_doc
  write_commitlintrc

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  [ -f "$ACDOC/rule-inventory.json" ]

  run inventory_rule_ids
  [ "$output" = "commitlint:valid-scopes,pc:rule-one,pc:rule-two" ]

  # sources[] has exactly 2 entries: project-constraints.md (count=2) and
  # .commitlintrc.json (count=2, matching its 2-entry valid_scopes list).
  run python3 -c "
import json
d = json.load(open('$ACDOC/rule-inventory.json', encoding='utf-8'))
srcs = {s['path']: s['count'] for s in d['sources']}
assert srcs == {'docs/guides/project-constraints.md': 2, '.commitlintrc.json': 2}, srcs
print('OK')
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI2 PASS: project-constraints.md absent (commitlintrc present) → only the commitlint id, absent source skipped" {
  write_commitlintrc
  # docs/guides/project-constraints.md deliberately NOT created.

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]

  run inventory_rule_ids
  [ "$output" = "commitlint:valid-scopes" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI3 PASS: .commitlintrc.json absent (project-constraints present) → only the pc:* ids, absent source skipped" {
  write_constraints_doc
  # .commitlintrc.json deliberately NOT created.

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]

  run inventory_rule_ids
  [ "$output" = "pc:rule-one,pc:rule-two" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI4 PASS: both sources absent → 0 sources, 0 rules, exit 0 (nothing to check is not a failure)" {
  # Neither source created — an ABSENT source is skipped (not fatal); only a
  # source that EXISTS but parses to zero rules is fatal (see #ERI5/#ERI6).
  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]

  run inventory_field 'sources'
  [ "$output" = "[]" ]
  run inventory_field 'rules'
  [ "$output" = "[]" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI5 BLOCK: project-constraints.md exists with ZERO '## ' headers → rule-inventory-empty-source, exit 2" {
  mkdir -p "$REPO/docs/guides"
  # Present, but no "## " headers at all (only a top-level "# " title).
  printf '%s\n' '# Project Constraints' '' 'No section headers here.' \
    > "$REPO/docs/guides/project-constraints.md"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 2 ]
  [[ "$output" == *"rule-inventory-empty-source"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI6 BLOCK: .commitlintrc.json exists with valid_scopes:[] → rule-inventory-empty-source, exit 2" {
  printf '%s\n' '{"valid_scopes": []}' > "$REPO/.commitlintrc.json"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 2 ]
  [[ "$output" == *"rule-inventory-empty-source"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI7 PASS (positive control for #ERI5/#ERI6): real, non-empty sources → non-empty inventory, exit 0" {
  # A guard that can never fire is worse than none — this proves #ERI5/#ERI6 are
  # exercising a real fail-closed floor, not a script that always dies (or always
  # emits an empty inventory regardless of source content).
  write_constraints_doc
  write_commitlintrc

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]

  run inventory_field 'rules'
  [ "$output" != "[]" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI8 PASS: head field == git rev-parse HEAD of the fixture repo" {
  write_constraints_doc
  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]

  run inventory_field 'head'
  [ "$output" = "$HEAD_SHA" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI9 PASS: generated_at is a parseable UTC ISO-8601 timestamp" {
  write_constraints_doc
  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]

  run inventory_field 'generated_at'
  [[ "$output" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI10 PASS (R13 positive control): each source's recorded sha256 matches an independently-computed sha256 of its actual bytes" {
  write_constraints_doc
  write_commitlintrc
  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]

  run python3 -c "
import hashlib, json
d = json.load(open('$ACDOC/rule-inventory.json', encoding='utf-8'))
for s in d['sources']:
    raw = open('$REPO/' + s['path'], 'rb').read().replace(b'\r\n', b'\n')
    expected = hashlib.sha256(raw).hexdigest()
    assert s['sha256'] == expected, (s['path'], s['sha256'], expected)
print('OK')
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #ERI11  R13 PROVENANCE — mutating a source's content between two invocations
# changes the recorded sha256 to match the NEW content. This is what regression
# R13 actually guards against: derived producers run at mint time so their own
# generated_at is always "now" (trivially fresh) — they are NOT themselves
# freshness-bound; only their declared INPUTS are, via this per-source sha256. A
# script that cached/reused a stale sha256 across invocations (rather than
# recomputing it from live bytes every run) would defeat that binding silently.
# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI11 R13 PROVENANCE: mutating a source's content changes the recorded sha256 to match the new content, not a stale/cached value" {
  write_constraints_doc
  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  local first_sha
  first_sha="$(python3 -c "
import json
d = json.load(open('$ACDOC/rule-inventory.json', encoding='utf-8'))
print(next(s['sha256'] for s in d['sources'] if s['path'] == 'docs/guides/project-constraints.md'))
")"

  # Mutate the source's prose (same 2 headers, different body text) so the rule ids
  # stay identical but the file's bytes — and therefore its sha256 — must change.
  printf '%s\n' \
    '# Project Constraints' \
    '' \
    '## Rule One' \
    'Do the first thing, but DIFFERENTLY now.' \
    '' \
    '## Rule Two' \
    'Do the second thing, but DIFFERENTLY now.' \
    > "$REPO/docs/guides/project-constraints.md"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  local second_sha expected_sha
  second_sha="$(python3 -c "
import json
d = json.load(open('$ACDOC/rule-inventory.json', encoding='utf-8'))
print(next(s['sha256'] for s in d['sources'] if s['path'] == 'docs/guides/project-constraints.md'))
")"
  expected_sha="$(python3 -c "
import hashlib
raw = open('$REPO/docs/guides/project-constraints.md', 'rb').read().replace(b'\r\n', b'\n')
print(hashlib.sha256(raw).hexdigest())
")"

  # The re-generated sha256 must differ from the first run's (proves it is not a
  # cached/frozen value) AND must equal a fresh hash of the mutated content (proves
  # it genuinely reflects the live bytes, not some other stale placeholder).
  [ "$second_sha" != "$first_sha" ]
  [ "$second_sha" = "$expected_sha" ]

  # Same rule ids as before — the mutation only changed prose, not headers.
  run inventory_rule_ids
  [ "$output" = "pc:rule-one,pc:rule-two" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI12 PASS: standard commitlint scope-enum shape (rules.scope-enum[2]) accepted when valid_scopes is absent" {
  # Fallback shape for consumers using the standard commitlint config convention
  # instead of this repo's own top-level 'valid_scopes' shortcut.
  printf '%s\n' '{"rules": {"scope-enum": [2, "always", ["alpha", "beta", "gamma"]]}}' \
    > "$REPO/.commitlintrc.json"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]

  run inventory_rule_ids
  [ "$output" = "commitlint:valid-scopes" ]

  # count reflects the 3-entry scope-enum list, not a hardcoded value.
  run python3 -c "
import json
d = json.load(open('$ACDOC/rule-inventory.json', encoding='utf-8'))
src = next(s for s in d['sources'] if s['path'] == '.commitlintrc.json')
assert src['count'] == 3, src['count']
print('OK')
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#ERI13 PASS: rules[] entries carry {id, source} — source points at the relative path that produced each id" {
  write_constraints_doc
  write_commitlintrc
  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]

  run python3 -c "
import json
d = json.load(open('$ACDOC/rule-inventory.json', encoding='utf-8'))
by_id = {r['id']: r['source'] for r in d['rules']}
assert by_id['pc:rule-one'] == 'docs/guides/project-constraints.md', by_id
assert by_id['pc:rule-two'] == 'docs/guides/project-constraints.md', by_id
assert by_id['commitlint:valid-scopes'] == '.commitlintrc.json', by_id
print('OK')
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}
