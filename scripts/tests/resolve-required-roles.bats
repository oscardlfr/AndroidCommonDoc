#!/usr/bin/env bats
#
# Tests for scripts/sh/lib/resolve-required-roles.js (BL-W48 artifact-floor resolver).
# Verifies CLASS-aware required-role resolution from .claude/registry/wave-topology.yaml
# `class_artifacts`: HARNESS (fixed list), DOC (declared via PLAN.md token), FAST-PATH
# (empty), DOC-no-token (fail-closed DECLARED_MISSING), unknown slug (HARNESS fail-safe),
# unresolvable root (FALLBACK), and usage error.
#
# Fixtures are temp wave dirs under the real .planning/ (gitignored) so the resolver
# reads the real wave-topology.yaml + yaml module; teardown removes them.

RESOLVER="$BATS_TEST_DIRNAME/../../scripts/sh/lib/resolve-required-roles.js"
PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"

# make_wave <slug-suffix> <class> [required-architects-line]
make_wave() {
  local dir="$PROJECT_ROOT/.planning/wave-rrtest-$1"
  mkdir -p "$dir"
  printf '%s' "$2" > "$dir/CLASS"
  if [ -n "${3-}" ]; then
    printf '# fixture\n**Class**: %s\n**Required-Architects**: %s\n' "$2" "$3" > "$dir/PLAN.md"
  else
    printf '# fixture\n**Class**: %s\n' "$2" > "$dir/PLAN.md"
  fi
}

teardown() {
  rm -r "$PROJECT_ROOT"/.planning/wave-rrtest-* 2>/dev/null || true
}

@test "HARNESS resolves to the 3 fixed architects" {
  make_wave harness HARNESS
  run node "$RESOLVER" "$PROJECT_ROOT" "rrtest-harness"
  [ "$status" -eq 0 ]
  [ "$output" = '["arch-platform","arch-testing","arch-integration"]' ]
}

@test "DOC with **Required-Architects** token resolves to the declared list" {
  make_wave doc DOC "arch-platform, arch-testing"
  run node "$RESOLVER" "$PROJECT_ROOT" "rrtest-doc"
  [ "$status" -eq 0 ]
  [ "$output" = '["arch-platform","arch-testing"]' ]
}

@test "DOC without the token fails closed (DECLARED_MISSING)" {
  make_wave docm DOC
  run node "$RESOLVER" "$PROJECT_ROOT" "rrtest-docm"
  [ "$status" -eq 0 ]
  [ "$output" = "DECLARED_MISSING" ]
}

@test "FAST-PATH resolves to empty (no architects required)" {
  make_wave fast FAST-PATH
  run node "$RESOLVER" "$PROJECT_ROOT" "rrtest-fast"
  [ "$status" -eq 0 ]
  [ "$output" = "[]" ]
}

@test "unknown slug (no wave dir) falls safe to the HARNESS default class" {
  run node "$RESOLVER" "$PROJECT_ROOT" "rrtest-nonexistent-zzz"
  [ "$status" -eq 0 ]
  [ "$output" = '["arch-platform","arch-testing","arch-integration"]' ]
}

@test "CLASS sentinel takes precedence over the PLAN **Class** token" {
  # sentinel says FAST-PATH, PLAN body says HARNESS -> sentinel wins -> []
  local dir="$PROJECT_ROOT/.planning/wave-rrtest-prec"
  mkdir -p "$dir"
  printf 'FAST-PATH' > "$dir/CLASS"
  printf '# fixture\n**Class**: HARNESS\n' > "$dir/PLAN.md"
  run node "$RESOLVER" "$PROJECT_ROOT" "rrtest-prec"
  [ "$status" -eq 0 ]
  [ "$output" = "[]" ]
}

@test "unresolvable repo root yields FALLBACK (caller uses manifest static value)" {
  run node "$RESOLVER" "/nonexistent-root-xyz-bl-w48" "rrtest-harness"
  [ "$status" -eq 0 ]
  [ "$output" = "FALLBACK" ]
}

@test "missing arguments is a usage error (exit 3)" {
  run node "$RESOLVER"
  [ "$status" -eq 3 ]
}

@test "decoy **Class**: marker in prose before ### Wave Class heading does not fool resolveClass() (BL-W4-1 JS surface)" {
  # No CLASS sentinel file — forces resolveClass() to fall through to PLAN.md parsing
  # (the 8 cases above via make_wave() always seed a CLASS sentinel or omit PLAN.md
  # entirely, so none of them exercise this regex fallback path at all).
  #
  # CORRECTED per arch-testing (Finding 4) + arch-platform: the decoy must be a REAL,
  # DIFFERENT class whose failure mode is the actual security-relevant one — NOT a
  # nonsense string (resolve-required-roles.js:70 self-heals an UNKNOWN class name back
  # to the HARNESS default via `classArtifacts[cls] || classArtifacts[default_class]`,
  # which would make a bogus decoy tautological — old and fixed code would both resolve
  # to the same 3-architect array). FAST-PATH is a REAL class whose architects spec is
  # the literal empty array `[]` (no required architects) — the worst-case fail-open
  # outcome PLAN.md's own Risks section warns about ("a wrong anchor could... drop the
  # required-architects floor, fail-open, not fail-closed").
  #
  # A decoy **Class**: FAST-PATH marker sits in prose BEFORE the real ### Wave Class
  # heading, whose own **Class**: HARNESS is the value that must win. The old unanchored
  # regex (plan.match(/\*\*Class\*\*:\s*.../)) matches the FIRST occurrence anywhere in
  # the file — the decoy — resolving to FAST-PATH's `[]` (architect floor silently
  # dropped). The fixed section-anchored resolver must instead find HARNESS inside the
  # heading and return its fixed 3-architect array.
  local dir="$PROJECT_ROOT/.planning/wave-rrtest-decoy"
  mkdir -p "$dir"
  printf '# fixture\n\nSome prose mentioning a **Class**: FAST-PATH label as an example,\nwritten before the real heading below — this is a decoy.\n\n### Wave Class\n\n**Class**: HARNESS\n' \
    > "$dir/PLAN.md"
  run node "$RESOLVER" "$PROJECT_ROOT" "rrtest-decoy"
  [ "$status" -eq 0 ]
  [ "$output" = '["arch-platform","arch-testing","arch-integration"]' ]
}
