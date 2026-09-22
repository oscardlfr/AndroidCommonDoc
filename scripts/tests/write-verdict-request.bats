#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# RED-first tests for scripts/sh/write-verdict-request.sh (does not exist yet, P2 of
# wave structured-verdict-evidence-contract). Creates immutable verdict-request/v1
# records per PLAN.md sec 3.1/3.2: "The orchestrator invokes it before dispatch and
# passes the resulting path and digest to the architect. A request is immutable and
# single-purpose; it is never overwritten or reused for a second verdict."
#
# Conventions mirrored from the live sibling scripts (fully fine to match
# structurally -- these are NOT runtime-consultation prior art, they are the actual
# scripts this new one joins): write-specialist-dispatch.sh's argument-parsing style,
# slug resolution via scripts/sh/lib/wave-slug.sh (identical priority: --slug >
# CLAUDE_WAVE_SLUG > git branch last-segment > single wave-*/PLAN.md alias),
# _confine_under_planning()/_realpath_resolve()/_shell_physical_resolve() confinement
# triple, _sha256_file() portable helper, HEAD-resolves-to-40-hex-or-fail-closed.
#
# Designed CLI surface (PLAN.md does not pin exact flags/output format -- my design,
# flagged for review, mirrors this file's siblings closely):
#   write-verdict-request.sh --role <arch-role> --phase <prep|verify-final> [--slug <slug>]
#   stdout on success: exactly one line, "<absolute-or-repo-relative-path> <64hex-sha256>"
#     space-separated -- this is what "passes the resulting path and digest to the
#     architect" requires the orchestrator to consume programmatically; write-
#     specialist-dispatch.sh only logs human text to stderr, so this script needs its
#     own parseable stdout contract, unlike its sibling.
#   Output path: .planning/wave-<slug>/verdict-requests/<request_id>.json (PLAN.md sec 3.1)
#   subject.path stored REPO-RELATIVE (e.g. ".planning/wave-<slug>/PLAN.md"), mirroring
#     write-specialist-dispatch.sh's own PLAN_PATH_REL convention for JSON path fields.
#   Exit codes: 0 success, 1 usage/argument error, 2 integrity violation -- identical
#     bucket contract to every sibling script.
#
# OPEN QUESTIONS sent to toolkit-specialist (not yet answered as of writing -- see the
# VERIFY-FINAL subject section below for how this file handles that gap without
# blocking everything else):
#   1. subject.path/sha256 for VERIFY-FINAL (subject.kind="source-manifest"): what file
#      does this actually point at? Not spelled out in PLAN.md. PREP's subject (kind=
#      "plan", pointing at PLAN.md) is unambiguous and fully tested below.
#   2. Does this script delegate to the CLI/store (verdict-evidence-contract-cli.cjs /
#      verdict-artifact-store.cjs's publishNoClobber + computeRequestId) for durable
#      writing and request_id generation, or is a simpler direct bash write acceptable?
#      Tests below assert OBSERVABLE outcomes (request_id is 32 lowercase hex, genuinely
#      random across invocations; output is durably readable back) rather than the
#      internal mechanism, so they hold regardless of which way this is resolved.
#
# Isolation mirrors write-verdict.bats/write-specialist-dispatch.bats exactly: mktemp -d
# PROJ, throwaway git init -q + one --allow-empty commit, explicit per-invocation cd
# (never ambient CWD). All sha256/request_id values are computed/read at test-run time
# -- never hardcoded (CORE NON-VACUITY MANDATE).

SCRIPT="$BATS_TEST_DIRNAME/../sh/write-verdict-request.sh"
WAVE_SLUG="wvr-test-wave"

setup() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m init 2>/dev/null
  # write-verdict-request.sh resolves its own REPO_ROOT via `git rev-parse
  # --show-toplevel`, which can render in a different path style than $PROJ's own
  # mktemp-produced form on Windows (same underlying directory, different string) --
  # computing it here the IDENTICAL way guarantees any test comparing the script's
  # absolute-path output against a $PROJ-based pattern compares like-for-like (task
  # #22, arch-testing, 2026-09-21).
  PROJ_GIT_ROOT="$(git -C "$PROJ" rev-parse --show-toplevel)"
  unset CLAUDE_WAVE_SLUG
}

teardown() {
  rm -rf "$PROJ"
}

run_wvr() { # mirrors write-verdict.bats's run_verdict(): explicit cd, never ambient.
  # --separate-stderr (bats 1.5.0+, required by this file's own shebang): the script
  # correctly logs its human-readable confirmation to stderr (matching every sibling
  # script's convention) while stdout carries exactly the documented one-line
  # "<path> <digest>" contract -- bats' default merged $output would otherwise
  # re-corrupt that contract for every test parsing $output below, the same class of
  # bug task #14 fixed on the SCRIPT side (CLI stdout leak); this is the harness-side
  # half of the same fix (arch-testing, 2026-09-21).
  run --separate-stderr bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' $*"
}

run_wvr_no_env() { # for cases that must NOT rely on ambient CLAUDE_WAVE_SLUG.
  run --separate-stderr bash -c "cd '$PROJ' && bash '$SCRIPT' $*"
}

_real_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

_seed_plan() {
  local slug="$1"
  mkdir -p "$PROJ/.planning/wave-$slug"
  printf '# Plan\n\nSome plan content for %s.\n' "$slug" > "$PROJ/.planning/wave-$slug/PLAN.md"
}

REQUEST_ID_RE='^[0-9a-f]{32}$'
SHA256_RE='^[0-9a-f]{64}$'

# ── happy path (PREP) ────────────────────────────────────────────────────────────

@test "WVR-1 PASS: prep creates a well-formed verdict-request/v1 JSON at the correct confined path" {
  _seed_plan "$WAVE_SLUG"
  run_wvr --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]

  local out_path out_digest
  out_path="$(printf '%s' "$output" | awk '{print $1}')"
  out_digest="$(printf '%s' "$output" | awk '{print $2}')"
  [[ "$out_digest" =~ $SHA256_RE ]] || return 1

  # Resolve out_path whether the script printed it absolute or repo-relative.
  local abs_path="$out_path"
  [[ "$out_path" = /* || "$out_path" =~ ^[A-Za-z]:/ ]] || abs_path="$PROJ/$out_path"
  [ -f "$abs_path" ] || return 1
  [[ "$abs_path" == "$PROJ_GIT_ROOT/.planning/wave-$WAVE_SLUG/verdict-requests/"*".json" ]] || return 1

  local real_digest
  real_digest="$(_real_sha256 "$abs_path")"
  [ "$out_digest" = "$real_digest" ] || return 1

  # Field-value greps below tolerate an optional space after the colon
  # ([[:space:]]*) because publish-record now canonicalizes to 2-space
  # pretty-printed JSON (PLAN.md sec 3.1) rather than the prior compact form.
  grep -qE '"schema":[[:space:]]*"verdict-request/v1"' "$abs_path" || return 1
  grep -qE '"role":[[:space:]]*"arch-testing"' "$abs_path" || return 1
  grep -qE '"phase":[[:space:]]*"prep"' "$abs_path" || return 1
  grep -qE "\"wave_slug\":[[:space:]]*\"$WAVE_SLUG\"" "$abs_path" || return 1
  grep -qE '"kind":[[:space:]]*"plan"' "$abs_path" || return 1
}

@test "WVR-2 PASS: prep's subject points at PLAN.md with its real sha256 at run time" {
  _seed_plan "$WAVE_SLUG"
  local real_plan_sha256
  real_plan_sha256="$(_real_sha256 "$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md")"

  run_wvr --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]
  local out_path abs_path
  out_path="$(printf '%s' "$output" | awk '{print $1}')"
  abs_path="$out_path"
  [[ "$out_path" = /* || "$out_path" =~ ^[A-Za-z]:/ ]] || abs_path="$PROJ/$out_path"

  grep -qE "\"plan_sha256\":[[:space:]]*\"$real_plan_sha256\"" "$abs_path" || return 1
  # subject.sha256 mirrors plan_sha256 for PREP (subject IS the plan).
  grep -qE "\"sha256\":[[:space:]]*\"$real_plan_sha256\"" "$abs_path" || return 1
}

@test "WVR-3 PASS: prep's head field matches real git rev-parse HEAD at run time" {
  _seed_plan "$WAVE_SLUG"
  local real_head
  real_head="$(git -C "$PROJ" rev-parse HEAD)"
  run_wvr --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]
  local out_path abs_path
  out_path="$(printf '%s' "$output" | awk '{print $1}')"
  abs_path="$out_path"
  [[ "$out_path" = /* || "$out_path" =~ ^[A-Za-z]:/ ]] || abs_path="$PROJ/$out_path"
  grep -qE "\"head\":[[:space:]]*\"$real_head\"" "$abs_path" || return 1
}

# ── request_id: shape + genuine randomness (CORE NON-VACUITY) ──────────────────────

@test "WVR-4 PASS: request_id is exactly 32 lowercase hex characters (128-bit)" {
  _seed_plan "$WAVE_SLUG"
  run_wvr --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]
  local out_path abs_path req_id
  out_path="$(printf '%s' "$output" | awk '{print $1}')"
  abs_path="$out_path"
  [[ "$out_path" = /* || "$out_path" =~ ^[A-Za-z]:/ ]] || abs_path="$PROJ/$out_path"
  req_id="$(basename "$abs_path" .json)"
  [[ "$req_id" =~ $REQUEST_ID_RE ]] || return 1
  grep -qE "\"request_id\":[[:space:]]*\"$req_id\"" "$abs_path" || return 1
}

@test "WVR-5 PASS: two invocations produce genuinely different request_id values (not a fixed/derived constant)" {
  _seed_plan "$WAVE_SLUG"
  run_wvr --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]
  local first_path first_id
  first_path="$(printf '%s' "$output" | awk '{print $1}')"
  [[ "$first_path" = /* || "$first_path" =~ ^[A-Za-z]:/ ]] || first_path="$PROJ/$first_path"
  first_id="$(basename "$first_path" .json)"

  # verify-final needs a resolvable base ref for its source-manifest diff (HEAD~1 at
  # minimum) -- setup()'s single --allow-empty commit alone leaves no parent commit to
  # diff against, so the base-ref fallback chain (origin/develop -> develop -> HEAD~1)
  # exhausts and the script correctly fails closed. Mirrors WVR-18/19's own second
  # commit (task #22, arch-testing, 2026-09-21).
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test commit -q --allow-empty -m second 2>/dev/null

  run_wvr --role arch-testing --phase verify-final --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]
  local second_path second_id
  second_path="$(printf '%s' "$output" | awk '{print $1}')"
  [[ "$second_path" = /* || "$second_path" =~ ^[A-Za-z]:/ ]] || second_path="$PROJ/$second_path"
  second_id="$(basename "$second_path" .json)"

  [ "$first_id" != "$second_id" ] || return 1
}

# ── created_at ────────────────────────────────────────────────────────────────────

@test "WVR-6 PASS: created_at is a UTC ISO-8601 seconds timestamp" {
  _seed_plan "$WAVE_SLUG"
  run_wvr --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]
  local out_path abs_path
  out_path="$(printf '%s' "$output" | awk '{print $1}')"
  abs_path="$out_path"
  [[ "$out_path" = /* || "$out_path" =~ ^[A-Za-z]:/ ]] || abs_path="$PROJ/$out_path"
  grep -qE '"created_at":[[:space:]]*"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z"' "$abs_path" || return 1
}

# ── role/phase enum validation ──────────────────────────────────────────────────────

@test "WVR-7 FAIL: invalid role exits 2, writes nothing" {
  _seed_plan "$WAVE_SLUG"
  run_wvr --role arch-bogus --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [ -z "$(ls -A "$PROJ/.planning/wave-$WAVE_SLUG/verdict-requests" 2>/dev/null)" ]
}

@test "WVR-8 FAIL: invalid phase exits 2, writes nothing" {
  _seed_plan "$WAVE_SLUG"
  run_wvr --role arch-testing --phase implement --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [ -z "$(ls -A "$PROJ/.planning/wave-$WAVE_SLUG/verdict-requests" 2>/dev/null)" ]
}

# ── slug traversal / resolution (mirrors write-verdict.bats V6 + P2b exactly) ──────

@test "WVR-9 FAIL: slug with .. traversal exits 2 and writes nothing" {
  run_wvr --role arch-testing --phase prep --slug "../evil"
  [ "$status" -eq 2 ]
  [ ! -d "$PROJ/.planning/wave-../evil" ]
}

@test "WVR-10 FAIL: slug with / traversal exits 2" {
  run_wvr --role arch-testing --phase prep --slug "foo/bar"
  [ "$status" -eq 2 ]
}

@test "WVR-11 BLOCK: reject-list slug 'develop' exits 2" {
  run_wvr_no_env --role arch-testing --phase prep --slug "develop"
  [ "$status" -eq 2 ]
}

@test "WVR-12 BLOCK: reject-list slug 'master' exits 2" {
  run_wvr_no_env --role arch-testing --phase prep --slug "master"
  [ "$status" -eq 2 ]
}

@test "WVR-13 PASS: CLAUDE_WAVE_SLUG env var resolves the slug when --slug is omitted" {
  _seed_plan "$WAVE_SLUG"
  run_wvr --role arch-testing --phase prep
  [ "$status" -eq 0 ]
  local out_path abs_path
  out_path="$(printf '%s' "$output" | awk '{print $1}')"
  abs_path="$out_path"
  [[ "$out_path" = /* || "$out_path" =~ ^[A-Za-z]:/ ]] || abs_path="$PROJ/$out_path"
  [[ "$abs_path" == "$PROJ_GIT_ROOT/.planning/wave-$WAVE_SLUG/"* ]] || return 1
}

# ── HEAD / PLAN.md fail-closed (mirrors write-verdict.bats WS2-3/WS2-4 exactly) ────

@test "WVR-14 FAIL: fails closed when PLAN.md is absent (deliberately not seeded)" {
  run_wvr --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"Plan"* || "$stderr" == *"plan"* ]] || return 1
  [ -z "$(ls -A "$PROJ/.planning/wave-$WAVE_SLUG/verdict-requests" 2>/dev/null)" ]
}

@test "WVR-15 FAIL: fails closed when HEAD is unresolvable (fresh repo, no commit)" {
  local empty_proj
  empty_proj="$(mktemp -d)"
  git -C "$empty_proj" init -q 2>/dev/null
  mkdir -p "$empty_proj/.planning/wave-$WAVE_SLUG"
  printf '# Plan\n' > "$empty_proj/.planning/wave-$WAVE_SLUG/PLAN.md"

  # Bypasses run_wvr() (needs $empty_proj, not $PROJ) so needs its own --separate-stderr
  # -- same reason as run_wvr()/run_wvr_no_env() above, this test checks stderr content.
  run --separate-stderr bash -c "cd '$empty_proj' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"HEAD"* ]] || return 1
  [ -z "$(ls -A "$empty_proj/.planning/wave-$WAVE_SLUG/verdict-requests" 2>/dev/null)" ]

  rm -rf "$empty_proj"
}

# ── output confinement (mirrors write-verdict.bats's BL-W4-9 sibling exactly) ──────

@test "WVR-16 FAIL: symlink planted inside .planning/ escaping to a '.planning-evil' sibling is rejected end-to-end" {
  local evil_dir="$PROJ/.planning-evil"
  mkdir -p "$evil_dir"
  mkdir -p "$PROJ/.planning"
  node - "$evil_dir" "$PROJ/.planning/wave-$WAVE_SLUG" <<'NODE'
const fs = require('fs');
fs.symlinkSync(process.argv[2], process.argv[3], process.platform === 'win32' ? 'junction' : 'dir');
NODE

  run_wvr --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [ -z "$(ls -A "$evil_dir" 2>/dev/null)" ] || return 1
}

# ── no-clobber (defense-in-depth: collision is astronomically unlikely given a ────
# genuinely random 128-bit request_id, but PLAN.md sec 3.2 is explicit that "a request
# is immutable and single-purpose; it is never overwritten or reused" -- a bare
# exists-check-then-write is exactly the class of bug PLAN.md sec 3.6 forbids for the
# verdict writer, and there is no principled reason the request writer should be held
# to a lower durability bar just because collision is rare rather than impossible.)

@test "WVR-17 FAIL: writing to an already-occupied request path (simulated collision) is rejected, not silently overwritten" {
  _seed_plan "$WAVE_SLUG"
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG/verdict-requests"
  local fake_id="ffffffffffffffffffffffffffffffff"
  local occupied="$PROJ/.planning/wave-$WAVE_SLUG/verdict-requests/$fake_id.json"
  printf '{"pre-existing":"content"}\n' > "$occupied"
  local before_bytes
  before_bytes="$(cat "$occupied")"

  # This test can only force the collision path if the script's request_id generation
  # is interceptable; absent that seam, this proves the ORDINARY case still never
  # targets an occupied path by construction (WVR-5 already proves genuine randomness).
  # Kept here as an explicit, named assertion of the no-clobber REQUIREMENT rather than
  # silently assuming it -- if a future implementation adds a deterministic/injectable
  # request_id seam for testing, tighten this to force the exact collision.
  run_wvr --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]
  local out_path abs_path
  out_path="$(printf '%s' "$output" | awk '{print $1}')"
  abs_path="$out_path"
  [[ "$out_path" = /* || "$out_path" =~ ^[A-Za-z]:/ ]] || abs_path="$PROJ/$out_path"
  [ "$abs_path" != "$occupied" ] || return 1
  [ "$(cat "$occupied")" = "$before_bytes" ] || return 1
}

# ── VERIFY-FINAL subject (open question 1 -- RESOLVED, arch-platform via toolkit- ──
# specialist): freshly generated by this script at request-creation time via
# `git diff --name-only <base>..HEAD` (same as qg-path-audit.sh), base ref resolved
# via emit-push-proof.sh's own existing fallback chain: `git merge-base HEAD
# origin/develop || git merge-base HEAD develop || git rev-parse HEAD~1`. Sorted file
# list, persisted as its own small artifact at
# .planning/wave-<slug>/source-manifests/<request-id>.json (sibling to
# verdict-requests/<request-id>.json, same immutable/request-scoped lifecycle).
# subject.path/subject.sha256 point at that artifact and its real digest. Neither
# location counts toward the 55-path Path Manifest (.planning/wave-<slug>/ is entirely
# gitignored runtime data, same category as the request/verdict/dispatch files
# themselves). Manifest's OWN internal shape is my design choice (not pinned by either
# answer), flagged for review: {"schema":"source-manifest/v1","files":[...]} -- a
# schema-tagged object, mirroring every other artifact's own "schema" field in this
# wave, rather than a bare untagged array.

@test "WVR-18 PASS: verify-final generates a source-manifest artifact via real git diff, referenced by subject.path/sha256" {
  _seed_plan "$WAVE_SLUG"
  # setup()'s single --allow-empty commit is the repo's only history so far. Add a
  # second commit changing 2 known files, giving a deterministic
  # `git diff --name-only <base>..HEAD`. No develop branch and no origin remote exist
  # in this throwaway repo, so the base-ref fallback chain can only land on the FINAL
  # tier (git rev-parse HEAD~1) -- the one genuinely reachable/exercisable here.
  mkdir -p "$PROJ/src"
  printf 'a\n' > "$PROJ/src/alpha.txt"
  printf 'b\n' > "$PROJ/src/beta.txt"
  git -C "$PROJ" add src/alpha.txt src/beta.txt
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test commit -q -m "add files" 2>/dev/null

  local base_ref; base_ref="$(git -C "$PROJ" rev-parse HEAD~1)"
  local expected_files; expected_files="$(git -C "$PROJ" diff --name-only "$base_ref"..HEAD | sort)"
  [ -n "$expected_files" ] || return 1

  run_wvr --role arch-testing --phase verify-final --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]
  local out_path abs_path
  out_path="$(printf '%s' "$output" | awk '{print $1}')"
  abs_path="$out_path"
  [[ "$out_path" = /* || "$out_path" =~ ^[A-Za-z]:/ ]] || abs_path="$PROJ/$out_path"
  local req_id; req_id="$(basename "$abs_path" .json)"

  grep -qE '"kind":[[:space:]]*"source-manifest"' "$abs_path" || return 1

  local manifest_rel
  manifest_rel="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).subject.path)" "$abs_path")"
  [[ "$manifest_rel" == *"source-manifests/$req_id.json"* ]] || return 1

  local manifest_abs="$manifest_rel"
  [[ "$manifest_rel" = /* || "$manifest_rel" =~ ^[A-Za-z]:/ ]] || manifest_abs="$PROJ_GIT_ROOT/.planning/wave-$WAVE_SLUG/$manifest_rel"
  [ -f "$manifest_abs" ] || return 1

  local manifest_sha256 subject_sha256
  manifest_sha256="$(_real_sha256 "$manifest_abs")"
  subject_sha256="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).subject.sha256)" "$abs_path")"
  [ "$manifest_sha256" = "$subject_sha256" ] || return 1

  local actual_files
  actual_files="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).files.join('\n'))" "$manifest_abs")"
  [ "$actual_files" = "$expected_files" ] || return 1

  grep -qE '"schema":[[:space:]]*"source-manifest/v1"' "$manifest_abs" || return 1
}

@test "WVR-19 PASS: the source-manifest artifact is itself confined under .planning/wave-<slug>/, not written outside it" {
  _seed_plan "$WAVE_SLUG"
  printf 'a\n' > "$PROJ/only-file.txt"
  git -C "$PROJ" add only-file.txt
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test commit -q -m "one file" 2>/dev/null

  run_wvr --role arch-testing --phase verify-final --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]
  local out_path abs_path
  out_path="$(printf '%s' "$output" | awk '{print $1}')"
  abs_path="$out_path"
  [[ "$out_path" = /* || "$out_path" =~ ^[A-Za-z]:/ ]] || abs_path="$PROJ/$out_path"

  local manifest_rel manifest_abs
  manifest_rel="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).subject.path)" "$abs_path")"
  manifest_abs="$manifest_rel"
  [[ "$manifest_rel" = /* || "$manifest_rel" =~ ^[A-Za-z]:/ ]] || manifest_abs="$PROJ_GIT_ROOT/.planning/wave-$WAVE_SLUG/$manifest_rel"
  [[ "$manifest_abs" == "$PROJ_GIT_ROOT/.planning/wave-$WAVE_SLUG/"* ]] || return 1
}
