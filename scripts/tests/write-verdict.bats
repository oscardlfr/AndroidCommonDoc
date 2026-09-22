#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# PORT (P2, wave structured-verdict-evidence-contract): scripts/sh/write-verdict.sh
# moves from a mutable, delimiter-surgery Markdown writer to a thin wrapper around the
# immutable-then-CAS-supersedable verdict/v1 JSON contract (PLAN.md sec 3.1-3.3, 3.6).
# Read the CURRENT write-verdict.sh + this file's prior 49 cases in full before writing
# anything below (both done: current script is 633 lines / 49 @test cases, confirmed by
# direct count against PLAN.md's own "port the 49 existing writer cases" instruction).
#
# Designed NEW interface (PLAN.md sec 3.8 names the requirement -- "retains its
# familiar role/phase/slug/stdin surface, adds mandatory request path/digest,
# decision/reason/evidence flags, and delegates all I/O to the CLI/store" -- but not
# the exact flags; my design, flagged for review; evidence-flag shape below is
# arch-platform's answer relayed via arch-testing, not my own guess):
#   write-verdict.sh --role <role> --phase <prep|verify-final> [--slug <slug>]
#     --request <path> --request-sha256 <64hex>
#     --decision <approve|escalate> [--reason-code <code>]
#     [--evidence-file <path> [--evidence-schema <name>]]...  (repeatable; the script
#       computes each file's sha256 itself -- NEVER trust a caller-supplied digest --
#       and derives kind from whether --evidence-schema was supplied for that entry:
#       present -> json-record, omitted -> opaque-file. No separate --evidence-kind.)
#     [--supersede --expected-current-sha256 <64hex>]
#     [--publication-nonce <32-lower-hex>]  LEGACY COMPAT SHIM, PREP-phase only -- see
#       the dedicated section near the end of this file. Present -> reproduces today's
#       exact legacy markdown output verbatim for the out-of-manifest runtime-bridge-
#       codex consumer (task tracker item, team-lead-approved); absent (the normal
#       path, every other case in this file) -> full new JSON system, unaffected.
#   (rationale read from stdin -- same "body comes from stdin" convention as before,
#   just landing in the rationale field instead of free Markdown prose.)
# "Delegates ALL I/O to the CLI/store" is read literally: write-verdict.sh gathers
# flags+stdin, cross-checks the bound --request file's digest and role/phase/wave_slug
# agreement (script-level, since it needs the request bytes anyway to build
# request_ref), then hands the fully-assembled record to the CLI's publish-verdict
# subcommand (backed by publishVerdict(), confirmed by toolkit-specialist to exist,
# argv grammar not yet frozen -- P2's own job to pin, same caveat as
# write-verdict-request.bats) -- shape validation, durability, locking, no-clobber/CAS
# all happen THERE, not reimplemented here. Tests below therefore focus on: argument
# parsing, slug resolution/confinement (script-level, unchanged from every sibling),
# request-file/digest cross-checking (script-level, new), and correct delegation
# (the right decision reaches the right store operation) -- not re-proving
# no-clobber/CAS/durability mechanics themselves, which are already exhaustively
# RED-tested directly against the store in verdict-artifact-store.test.cjs (P1).
#
# ══════════════════ FULL 49-CASE MAPPING (nothing silently dropped) ══════════════════
# PORTED (equivalent JSON-contract case written below):
#   ★V1(WV-1/2), ★V4(WV-8 no-clobber smoke), ★V5(WV-9 prep+verify-final coexist),
#   V6x2(WV-3/4 traversal), invalid-role(WV-5), P2b-WIP/NF1/NF2/NF3(WV-6/7 slug
#   resolution -- unchanged wave-slug.sh, ported as 2 representative cases not 4
#   duplicates, since resolution logic itself is untouched and already exhaustively
#   covered by write-verdict-request.bats's own WVR-9..13), VS-1(WV-10 CAS supersede
#   replaces), VS-3(WV-11 no-clobber-without-supersede-flag smoke), VS-9(WV-12
#   supersede-without-prior-target), WS2-1/WS2-2 REDESIGNED (WV-13/14: head/plan_sha256
#   are now COPIED from the bound request, not independently re-resolved by this
#   script -- see architecture note below), ★V2 (WV-21: kept as a workflow-sanity/
#   fail-fast guard per arch-platform's explicit ruling relayed via arch-testing --
#   NOT a hard security boundary, same framing as the old "No prep verdict found"
#   message -- verify-final without a prior published prep for the same role/wave
#   fails closed before ever attempting a write).
# REPLACED (obsolete mechanism -> new no-clobber/CAS/request-binding equivalent, why):
#   ★V3/VN-3/VN-6 (dual-token guard) -> already-exists (no-clobber), because PREP and
#     VERIFY-FINAL are now SEPARATE FILES (arch-<role>-verdict-prep.json /
#     -verify-final.json), not two token-blocks appended to one mutable file -- there
#     is no shared file for a "dual token" to co-occupy. WV-8 exercises the no-clobber
#     mechanism at the script level; the mechanism itself is P1-tested exhaustively.
#   VS-4 (supersede HEAD-unresolvable) -> MOVED, not replaced: write-verdict.sh no
#     longer independently resolves git HEAD at all (head is copied from the bound
#     request -- see architecture note). The genuinely equivalent "HEAD unresolvable
#     fails closed" case now lives where HEAD actually gets resolved for the first
#     time: write-verdict-request.bats's WVR-15.
#   WS2-3 (PREP fails closed when PLAN.md absent) -> MOVED to write-verdict-request.bats
#     WVR-14, same architecture reason: plan_sha256 is copied from the request, this
#     script never reads PLAN.md directly.
#   WS2-4 (fails closed when HEAD unresolvable) -> MOVED to write-verdict-request.bats
#     WVR-15, same reason as VS-4 above (duplicate listing intentional -- WS2-4 and
#     VS-4 were the SAME underlying HEAD-resolution code path in the old single script;
#     they collapse to the SAME one moved case here, not two).
#   BL-W4-9 sibling (x2 behavioral) + Codex#2 fallback-chain (x2) confinement tests ->
#     the durable WRITE's own confinement (T8) is now the STORE's job
#     (assertConfinedAncestry, pure Node path.resolve/fs.lstatSync, zero dependency on
#     realpath/python3 at all) -- already exhaustively RED-tested in
#     verdict-artifact-store.test.cjs (P1), including the Windows-junction case the old
#     realpath/python3-fallback-chain tests never covered. This script's OWN remaining
#     confinement concern is narrower (the --slug value and --request path arguments
#     it accepts before ever calling the store) -- ported as WV-3/WV-4 (slug) and a new
#     WV-16 (a --request path escaping .planning/ is rejected before the store is ever
#     invoked, proving the wrapper doesn't blindly forward an attacker-controlled path).
#   BL-W4-9 sibling (x2 pure-bash-idiom-only, no script invocation) -> obsolete, these
#     never tested write-verdict.sh at all (pure bash `[[ ]]` string-comparison
#     idiom-correctness fixtures) -- superseded by the actual store's own
#     lstat-walk-based confinement, which those two idiom tests were never modeling.
#   V7 (legacy heredoc APPROVED-FINAL WARN) -> obsolete, no legacy-heredoc detection
#     concept exists for a structured JSON writer; nothing analogous to port.
#   VN-1/VN-2 (stdin body prepended with --- separator before token) -> obsolete
#     Markdown-block shape; REPLACED by WV-15 (stdin content lands verbatim in the
#     rationale JSON field, safely, regardless of what it contains -- see VS-7/VS-8
#     replacement below for the "safely" part).
#   VN-4 (prose mention doesn't false-positive-trigger dual-token scan) -> obsolete,
#     no line-anchored token-scanning exists over structured JSON; nothing to
#     false-positive on.
#   VN-5/VN-7 (bare / bold-form APPROVED-PREP recognized as valid) -> obsolete, JSON's
#     decision field is a strict closed-enum value written by this script itself, never
#     scanned-and-pattern-matched back out of free text in multiple accepted spellings.
#   VS-2 (supersede same HEAD = idempotent byte-identical no-op) -> BEHAVIOR CHANGE, not
#     ported as originally shaped: verdict-artifact-store.cjs's publishSupersede (P1,
#     read directly) performs a fresh temp-write + rename unconditionally -- it has no
#     "new bytes equal old bytes, skip the write" short-circuit the way the old script's
#     byte-identical-block comparison did. A supersede with content identical to current
#     is still a REAL durable write (fresh inode), not a true no-op. This is intentional
#     scope, not a bug this file should paper over: PLAN.md sec 3.6 requires "the store
#     proves the current bytes match the expected digest" for CAS itself, and says
#     nothing about short-circuiting when new==old -- ported as WV-17, asserting the
#     ACTUAL new (changed) behavior explicitly rather than silently assuming the old
#     contract still holds.
#   VS-5 (supersede on PREP-only file with no prior verify-final) -> obsolete as
#     originally shaped (no "PREP-only file" concept when prep/verify-final are
#     separate files) -- the genuinely analogous case, "first publish of verify-final
#     with a valid prep already published for the same role/wave," is exactly WV-9's
#     coexistence case, not a distinct supersede scenario.
#   VS-6 (legacy un-delimited fallback excision) -> obsolete, no delimiters/blocks/
#     fallback-excision concept in JSON at all.
#   VS-7 (body containing END-delimiter text doesn't break block structure) -> REPLACED
#     by WV-15: rationale content containing JSON-special characters (quotes, braces,
#     backslashes, embedded newlines) must round-trip safely without corrupting the
#     record's own JSON structure -- analogous concern (attacker/accidental content
#     breaking the container format), genuinely new mechanism (safe JSON string
#     encoding, not delimiter-avoidance).
#   VS-8/VS-14 (body **HEAD**: prose doesn't poison stored_head extraction / gets
#     sanitized with a WARN) -> REPLACED by WV-15 too: rationale content containing
#     text that LOOKS like a JSON field (e.g. a literal `"head":"aaaa..."` substring)
#     must not affect the ACTUAL head field this script writes (which is copied from
#     the bound request, never parsed back out of rationale) -- structurally impossible
#     to poison by construction once head stops being extracted via text-scanning, but
#     worth one explicit test proving the construction, not just asserting it in prose.
#   VS-10 (legacy fallback WARN on content loss) -> obsolete, no legacy fallback exists
#     to lose content in.
#   VS-11 (BEGIN delimiter in PREP prose doesn't cause PREP excision) -> obsolete, no
#     excision/blocks; PREP and VERIFY-FINAL are separate files, mutually inert.
#   VS-12/VS-13 (multiple stale delimited blocks collapse to one current block) ->
#     obsolete, a JSON file IS one record, not a sequence of appended blocks -- the
#     "multiple blocks in one file" scenario is not constructible in this format.
#   VS-15 (same-HEAD supersede must repair corrupt content, not silently no-op over it)
#     -> obsolete BY CONSTRUCTION, not merely unnecessary: CAS requires
#     --expected-current-sha256 to be the EXACT digest of the CURRENT bytes (P1,
#     verdict-artifact-store.test.cjs's stale-CAS/one-hex-char-diff case), never a
#     same-HEAD-only comparison -- a "corrupt" (i.e. digest-mismatched) file cannot
#     silently pass CAS at all, closing this entire bug class structurally rather than
#     needing a dedicated repair-test here.
#   VS-16 (unterminated delimiter fails closed) -> obsolete, no delimiter-termination
#     concept; a malformed/truncated JSON file is instead caught by the CLI's own
#     decodeRecord+shape validation on read (contract-level, P1) or by this script's own
#     request/digest cross-check on write, not by a bespoke delimiter-balance scan.
#   PPB2-1/2/3 (publication-nonce field) -> RESOLVED, NOT obsolete (reversed from an
#     earlier draft of this file/header): --publication-nonce has a LIVE out-of-
#     manifest production consumer (runtime-bridge-codex's p2-prep-verdict.cjs,
#     confirmed by direct read) that spawns write-verdict.sh with the CURRENT exact
#     argv shape (--role --phase prep --slug --publication-nonce, none of the new P2
#     flags) and validates the result against prep-publication-grammar.cjs's exact
#     byte-for-byte 10-line legacy markdown grammar -- confirmed by direct read of both
#     files, not assumed. team-lead approved a narrow compat shim (task tracker,
#     relayed via arch-testing): --publication-nonce present -> reproduce today's exact
#     markdown output verbatim at the SAME legacy path
#     (.planning/wave-<slug>/arch-<role>-verdict.md, definitionally disjoint from the
#     new arch-<role>-verdict-prep.json/-verify-final.json paths -- different
#     extension, different pattern, no collision); absent -> full new JSON system,
#     completely unaffected. Ported as the dedicated WV-COMPAT-1/2 section near the end
#     of this file (golden-fixture regression + isolation proof), not as PPB2-1/2/3's
#     original publication-nonce-as-a-JSON-field shape (there is no such field in
#     verdict/v1 -- the shim is parallel/legacy, never integrated into the new schema).
#
# NEW cases with no analogue in the original 49 (request/decision/evidence flags are
# entirely new surface PLAN.md sec 3.8 adds):
#   WV-18: --request-sha256 mismatch against the actual request file's real digest
#     fails closed before any write is attempted.
#   WV-19: request.role/phase/wave_slug disagreeing with this invocation's own
#     --role/--phase/resolved-slug fails closed before any write (the SAME class of
#     cross-binding check the CLI's crossCheckBinding proves on READ, sanity-checked
#     here on the WRITE side too so a self-inconsistent verdict is never even attempted).
#   WV-20: --decision escalate without --reason-code fails closed (mirrors
#     validateVerdictShape's own requirement, sanity-checked at the script boundary).
#
# ARCHITECTURE NOTE (read verdict-artifact-store.cjs + verdict-evidence-contract-
# cli.cjs directly before writing any of the above -- confirmed, not assumed): the
# NEW write-verdict.sh's head/plan_sha256 fields are COPIED from the bound --request
# file's own head/plan_sha256 (PLAN.md sec 3.3: verdict.head is "exact request HEAD"),
# never independently re-resolved via `git rev-parse HEAD` or re-hashed from PLAN.md by
# this script itself. This is why WS2-3/WS2-4/VS-4 all collapse into
# write-verdict-request.bats instead of staying here -- that is the ONE place HEAD and
# PLAN.md actually get freshly resolved in the new architecture.
#
# Isolation mirrors write-verdict.bats's own historical convention + write-verdict-
# request.bats exactly: mktemp -d PROJ, throwaway git init -q + one --allow-empty
# commit, explicit per-invocation cd, unset CLAUDE_WAVE_SLUG in setup(). All sha256
# values computed at test-run time -- never hardcoded (CORE NON-VACUITY MANDATE).

SCRIPT="$BATS_TEST_DIRNAME/../sh/write-verdict.sh"
WAVE_SLUG="wv-test-wave"

setup() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m init 2>/dev/null
  unset CLAUDE_WAVE_SLUG
}

teardown() {
  rm -rf "$PROJ"
}

_real_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# _seed_request <phase> -> writes a real, well-formed request JSON under
# $PROJ/.planning/wave-$WAVE_SLUG/verdict-requests/ and prints its absolute path.
# Mirrors write-verdict-request.bats's own fixture shape exactly (same schema).
_seed_request() {
  local phase="$1"
  local subject_kind="plan"; [ "$phase" = "verify-final" ] && subject_kind="source-manifest"
  local wave_dir="$PROJ/.planning/wave-$WAVE_SLUG"
  mkdir -p "$wave_dir/verdict-requests" "$wave_dir/source-manifests"
  printf '# Plan\n\nSome plan content.\n' > "$wave_dir/PLAN.md"
  local plan_sha256; plan_sha256="$(_real_sha256 "$wave_dir/PLAN.md")"
  local head_sha; head_sha="$(git -C "$PROJ" rev-parse HEAD)"
  local req_id; req_id="$(node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")"
  local subject_path="PLAN.md" subject_sha256="$plan_sha256"
  if [ "$phase" = "verify-final" ]; then
    subject_path="source-manifests/$req_id.json"
    printf '{"schema":"source-manifest/v1","files":[]}\n' > "$wave_dir/$subject_path"
    subject_sha256="$(_real_sha256 "$wave_dir/$subject_path")"
  fi
  local req_path="$wave_dir/verdict-requests/$req_id.json"
  cat > "$req_path" <<EOF
{"schema":"verdict-request/v1","request_id":"$req_id","role":"arch-testing","phase":"$phase","wave_slug":"$WAVE_SLUG","plan_sha256":"$plan_sha256","head":"$head_sha","subject":{"kind":"$subject_kind","path":"$subject_path","sha256":"$subject_sha256"},"created_at":"2026-09-21T00:00:00Z"}
EOF
  printf '%s' "$req_path"
}

# ── WV-1/2 (ports ★V1): prep creates a well-formed verdict/v1 JSON at the correct path ──

@test "WV-1 PASS: prep with --decision approve creates a well-formed verdict/v1 JSON bound to its request" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'reviewed and approved\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 0 ]
  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json"
  [ -f "$verdict" ] || return 1
  # Field-value greps below tolerate an optional space after the colon
  # ([[:space:]]*) because publish-record now canonicalizes to 2-space
  # pretty-printed JSON (PLAN.md sec 3.1) rather than the prior compact form.
  grep -qE '"schema":[[:space:]]*"verdict/v1"' "$verdict" || return 1
  grep -qE '"decision":[[:space:]]*"approve"' "$verdict" || return 1
  grep -qE '"phase":[[:space:]]*"prep"' "$verdict" || return 1
}

@test "WV-2 PASS: --decision escalate creates a well-formed, non-authorizing verdict/v1 JSON (T10)" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'scope conflict, escalating\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' \
    bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision escalate --reason-code scope-conflict"
  [ "$status" -eq 0 ]
  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json"
  grep -qE '"decision":[[:space:]]*"escalate"' "$verdict" || return 1
  grep -qE '"reason_code":[[:space:]]*"scope-conflict"' "$verdict" || return 1
}

# ── WV-3/4 (ports V6 x2): slug traversal ────────────────────────────────────────────

@test "WV-3 FAIL: slug with .. traversal exits 2 and writes nothing" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'x\n' | bash '$SCRIPT' --role arch-testing --phase prep --slug '../evil' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 2 ]
  [ ! -d "$PROJ/.planning/wave-../evil" ]
}

@test "WV-4 FAIL: slug with / traversal exits 2" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'x\n' | bash '$SCRIPT' --role arch-testing --phase prep --slug 'foo/bar' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 2 ]
}

# ── WV-5 (ports invalid-role) ────────────────────────────────────────────────────────

@test "WV-5 FAIL: invalid role exits 2" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-bogus --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 2 ]
}

# ── WV-6/7 (ports P2b x4, representative pair -- resolution logic itself is unchanged ──
# wave-slug.sh and already exhaustively covered by write-verdict-request.bats WVR-9..13)

@test "WV-6 BLOCK: reject-list slug 'develop' exits 2 (representative P2b case)" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'x\n' | bash '$SCRIPT' --role arch-testing --phase prep --slug develop \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 2 ]
}

@test "WV-7 PASS: CLAUDE_WAVE_SLUG env var resolves the slug when --slug is omitted (representative P2b case)" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" ]
}

# ── WV-8 (ports ★V4/★V3/VN-3/VN-6, dual-token->no-clobber): duplicate prep exits non-zero ──

@test "WV-8 FAIL: a second prep for the same role/wave exits 2 (no-clobber, script-level smoke, not merely non-zero)" {
  # -eq 2, not -ne 0, for the same vacuous-pass reason as WV-12/WV-21.
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  bash -c "cd '$PROJ' && printf 'first\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve" >/dev/null 2>&1

  run bash -c "cd '$PROJ' && printf 'second\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 2 ]
  grep -qE '"rationale":[[:space:]]*"first' "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" || return 1
}

# ── WV-9 (ports ★V5): prep and verify-final coexist as separate files ──────────────

@test "WV-9 PASS: prep and verify-final for the same role/wave coexist as separate files, neither touches the other" {
  local req_prep req_prep_sha256 req_vf req_vf_sha256
  req_prep="$(_seed_request prep)"
  req_prep_sha256="$(_real_sha256 "$req_prep")"
  bash -c "cd '$PROJ' && printf 'prep body\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req_prep' --request-sha256 '$req_prep_sha256' --decision approve" >/dev/null 2>&1

  req_vf="$(_seed_request verify-final)"
  req_vf_sha256="$(_real_sha256 "$req_vf")"
  local evidence_file="$PROJ/.planning/wave-$WAVE_SLUG/evidence.txt"
  printf 'evidence\n' > "$evidence_file"
  run bash -c "cd '$PROJ' && printf 'final body\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' \
    --request '$req_vf' --request-sha256 '$req_vf_sha256' --decision approve \
    --evidence-file '$evidence_file'"
  [ "$status" -eq 0 ]

  local prep_file="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json"
  local vf_file="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-verify-final.json"
  [ -f "$prep_file" ] || return 1
  [ -f "$vf_file" ] || return 1
  grep -qE '"rationale":[[:space:]]*"prep body' "$prep_file" || return 1
  grep -qE '"rationale":[[:space:]]*"final body' "$vf_file" || return 1
}

# ── WV-10 (ports VS-1): --supersede with a fresh request + correct CAS digest replaces ──

@test "WV-10 PASS: --supersede with a fresh request and correct --expected-current-sha256 replaces the target" {
  # Fixture fix (#24): seed a prep verdict first, mirroring WV-9's pattern -- without
  # this, the FIRST (bare, non-`run`) verify-final write below trips write-verdict.sh's
  # own "no prior PREP" guard (WV-21) and aborts the test under bats' `set -e` before
  # the supersede behavior under test ever runs.
  local req_prep req_prep_sha256
  req_prep="$(_seed_request prep)"
  req_prep_sha256="$(_real_sha256 "$req_prep")"
  bash -c "cd '$PROJ' && printf 'prep body\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req_prep' --request-sha256 '$req_prep_sha256' --decision approve" >/dev/null 2>&1

  local req1 req1_sha256
  req1="$(_seed_request verify-final)"
  req1_sha256="$(_real_sha256 "$req1")"
  local ev="$PROJ/.planning/wave-$WAVE_SLUG/evidence.txt"; printf 'e\n' > "$ev"
  bash -c "cd '$PROJ' && printf 'v1\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' \
    --request '$req1' --request-sha256 '$req1_sha256' --decision approve \
    --evidence-file '$ev'" >/dev/null 2>&1

  local vf_file="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-verify-final.json"
  local current_sha256; current_sha256="$(_real_sha256 "$vf_file")"

  # Fresh commit + fresh request for the rebind (PLAN.md sec 3.6: rebind requires a
  # fresh request, never the same one -- also proves WV's own replay refusal doesn't
  # false-positive on a genuine fresh rebind).
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test commit -q --allow-empty -m second 2>/dev/null
  local req2 req2_sha256
  req2="$(_seed_request verify-final)"
  req2_sha256="$(_real_sha256 "$req2")"

  run bash -c "cd '$PROJ' && printf 'v2\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' \
    --request '$req2' --request-sha256 '$req2_sha256' --decision approve \
    --evidence-file '$ev' \
    --supersede --expected-current-sha256 '$current_sha256'"
  [ "$status" -eq 0 ]
  grep -qE '"rationale":[[:space:]]*"v2' "$vf_file" || return 1
}

# ── WV-11 (ports VS-3): supersede without --supersede flag rejects (no-clobber smoke) ──

@test "WV-11 FAIL: writing verify-final a second time WITHOUT --supersede exits 2 (not merely non-zero)" {
  # -eq 2, not -ne 0, for the same vacuous-pass reason as WV-12/WV-21.
  # Fixture fix (#24): seed a prep verdict first -- see WV-10's comment for why.
  local req_prep req_prep_sha256
  req_prep="$(_seed_request prep)"
  req_prep_sha256="$(_real_sha256 "$req_prep")"
  bash -c "cd '$PROJ' && printf 'prep body\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req_prep' --request-sha256 '$req_prep_sha256' --decision approve" >/dev/null 2>&1

  local req1 req1_sha256
  req1="$(_seed_request verify-final)"
  req1_sha256="$(_real_sha256 "$req1")"
  local ev="$PROJ/.planning/wave-$WAVE_SLUG/evidence.txt"; printf 'e\n' > "$ev"
  bash -c "cd '$PROJ' && printf 'v1\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' \
    --request '$req1' --request-sha256 '$req1_sha256' --decision approve \
    --evidence-file '$ev'" >/dev/null 2>&1

  run bash -c "cd '$PROJ' && printf 'v2\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' \
    --request '$req1' --request-sha256 '$req1_sha256' --decision approve \
    --evidence-file '$ev'"
  [ "$status" -eq 2 ]
  grep -qE '"rationale":[[:space:]]*"v1' "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-verify-final.json" || return 1
}

# ── WV-12 (ports VS-9): --supersede with no existing target exits non-zero ─────────

@test "WV-12 FAIL: --supersede against a target that does not exist yet exits 2 (integrity violation, not merely non-zero)" {
  # Deliberately status -eq 2, not a vague -ne 0: this codebase's own exit-code
  # convention reserves 2 for integrity violations vs 1 for usage errors. -ne 0 would
  # vacuously pass right now against the CURRENT (unmodified) script too, since an
  # unrecognized --request flag already exits 1 for an unrelated reason -- pinning the
  # exact code is what makes this genuinely RED until the real check exists.
  local req req_sha256
  req="$(_seed_request verify-final)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve \
    --supersede --expected-current-sha256 $(printf 'a%.0s' $(seq 1 64))"
  [ "$status" -eq 2 ]
  [ ! -f "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-verify-final.json" ]
}

# ── WV-13/14 (REDESIGNED WS2-1/WS2-2): head/plan_sha256 are COPIED from the request ──

@test "WV-13 PASS: verdict.head equals the bound request's head, not independently re-resolved" {
  local req req_sha256 request_head
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  request_head="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).head)" "$req")"

  # Advance HEAD AFTER the request was created but BEFORE writing the verdict -- if
  # this script re-resolved HEAD itself (old behavior) the verdict would get the NEW
  # head; the new architecture must still use the REQUEST's (now-stale) head.
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test commit -q --allow-empty -m drift 2>/dev/null
  local current_head; current_head="$(git -C "$PROJ" rev-parse HEAD)"
  [ "$request_head" != "$current_head" ] || return 1

  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 0 ]
  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json"
  grep -qE "\"head\":[[:space:]]*\"$request_head\"" "$verdict" || return 1
  ! grep -qE "\"head\":[[:space:]]*\"$current_head\"" "$verdict"
}

@test "WV-14 PASS: verdict.plan_sha256 equals the bound request's plan_sha256, not independently re-hashed" {
  local req req_sha256 request_plan_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  request_plan_sha256="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).plan_sha256)" "$req")"

  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 0 ]
  grep -qE "\"plan_sha256\":[[:space:]]*\"$request_plan_sha256\"" "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" || return 1
}

# ── WV-15 (replaces VS-7/VS-8/VS-14): rationale content is safely embedded, never ──
# scanned/extracted-from for any field this script itself writes

@test "WV-15 PASS: rationale containing JSON-special characters and field-lookalike text is safely embedded and never poisons head/decision" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  local real_head; real_head="$(git -C "$PROJ" rev-parse HEAD)"
  local tricky_body
  tricky_body='Body with "quotes", a {brace}, a back\slash,'"$(printf '\n')"'an embedded newline, and a fake "head":"'"$(printf 'b%.0s' $(seq 1 40))"'" field'

  run bash -c "cd '$PROJ' && printf '%s\n' \"$tricky_body\" | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 0 ]
  local verdict="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json"

  # The file must still be valid JSON (proves safe encoding, not delimiter-avoidance).
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$verdict"

  # The REAL head field (copied from the request) must be untouched by the fake one
  # embedded in the rationale text.
  grep -qE "\"head\":[[:space:]]*\"$real_head\"" "$verdict" || return 1
  grep -qE '"decision":[[:space:]]*"approve"' "$verdict" || return 1
}

# ── WV-16 (replaces the confinement-mechanics half of BL-W4-9/Codex#2): a --request ──
# path escaping .planning/ is rejected by this script before the store is ever invoked

@test "WV-16 FAIL: a --request path escaping .planning/ is rejected before any write is attempted" {
  local outside="$PROJ/outside-request.json"
  cp "$(_seed_request prep)" "$outside" 2>/dev/null || true
  # _seed_request already wrote a real request; just point --request at a copy OUTSIDE
  # .planning/ entirely.
  local req; req="$(_seed_request prep)"
  cp "$req" "$outside"
  local outside_sha256; outside_sha256="$(_real_sha256 "$outside")"
  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$outside' --request-sha256 '$outside_sha256' --decision approve"
  [ "$status" -eq 2 ]
  [ ! -f "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" ]
}

# ── WV-17 (replaces VS-2, documents the ACTUAL new behavior -- see header) ──────────

@test "WV-17 PASS: supersede with content identical to current still performs a fresh durable write, NOT a byte-preserving no-op (behavior change from the old script, documented not assumed)" {
  # Fixture fix (#24): seed a prep verdict first -- see WV-10's comment for why.
  local req_prep req_prep_sha256
  req_prep="$(_seed_request prep)"
  req_prep_sha256="$(_real_sha256 "$req_prep")"
  bash -c "cd '$PROJ' && printf 'prep body\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req_prep' --request-sha256 '$req_prep_sha256' --decision approve" >/dev/null 2>&1

  local req1 req1_sha256
  req1="$(_seed_request verify-final)"
  req1_sha256="$(_real_sha256 "$req1")"
  local ev="$PROJ/.planning/wave-$WAVE_SLUG/evidence.txt"; printf 'e\n' > "$ev"
  bash -c "cd '$PROJ' && printf 'same\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' \
    --request '$req1' --request-sha256 '$req1_sha256' --decision approve \
    --evidence-file '$ev'" >/dev/null 2>&1

  local vf_file="$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-verify-final.json"
  local before_sha256; before_sha256="$(_real_sha256 "$vf_file")"

  git -C "$PROJ" -c user.email=test@example.com -c user.name=test commit -q --allow-empty -m second 2>/dev/null
  local req2 req2_sha256
  req2="$(_seed_request verify-final)"
  req2_sha256="$(_real_sha256 "$req2")"

  # Re-supersede with a FRESH request but structurally-equivalent content shape --
  # the resulting bytes will still differ (in_reply_to/request_ref/created_at change),
  # so this is not literally "same bytes twice", but proves the CAS path is a real
  # write every time, never a cached/preserved-inode shortcut.
  run bash -c "cd '$PROJ' && printf 'same\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' \
    --request '$req2' --request-sha256 '$req2_sha256' --decision approve \
    --evidence-file '$ev' \
    --supersede --expected-current-sha256 '$before_sha256'"
  [ "$status" -eq 0 ]
  local after_sha256; after_sha256="$(_real_sha256 "$vf_file")"
  [ "$after_sha256" != "$before_sha256" ] || return 1
}

# ── WV-18 (NEW): --request-sha256 mismatch fails closed ───────────────────────────

@test "WV-18 FAIL: --request-sha256 not matching the actual request file's real digest exits 2, writes nothing" {
  local req
  req="$(_seed_request prep)"
  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 $(printf 'f%.0s' $(seq 1 64)) --decision approve"
  [ "$status" -eq 2 ]
  [ ! -f "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" ]
}

# ── WV-19 (NEW): request/invocation role-phase-wave agreement enforced before write ──

@test "WV-19 FAIL: a request bound for a different role than --role fails closed, writes nothing" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-platform --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 2 ]
  [ ! -f "$PROJ/.planning/wave-$WAVE_SLUG/arch-platform-verdict-prep.json" ]
}

# ── WV-20 (NEW): escalate without --reason-code fails closed ──────────────────────

@test "WV-20 FAIL: --decision escalate without --reason-code exits 2, writes nothing" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision escalate"
  [ "$status" -eq 2 ]
  [ ! -f "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" ]
}

# ── WV-21 (ports ★V2, kept as a workflow-sanity/fail-fast guard per arch-platform's ──
# explicit ruling relayed via arch-testing -- NOT a hard security boundary, same
# framing as the old "No prep verdict found" message.

@test "WV-21 FAIL: verify-final without a prior published prep for the same role/wave fails closed (exit 2, not merely non-zero)" {
  # -eq 2, not -ne 0, for the same vacuous-pass reason documented at WV-12: an
  # unrecognized --request flag against the CURRENT script already exits 1 for an
  # unrelated reason, which -ne 0 would wrongly accept as this specific guard.
  local req req_sha256
  req="$(_seed_request verify-final)"
  req_sha256="$(_real_sha256 "$req")"
  local ev="$PROJ/.planning/wave-$WAVE_SLUG/evidence.txt"; printf 'e\n' > "$ev"
  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve --evidence-file '$ev'"
  [ "$status" -eq 2 ]
  [ ! -f "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-verify-final.json" ]
}

# ══════════════ Publication-nonce legacy compat shim (task tracker item, team-lead ═══
# approved, 6 mandatory rules relayed via arch-testing/arch-platform (expanded from an
# earlier 3-condition draft -- see the header's RESOLVED note for full provenance):
# (1) activates ONLY on explicit --publication-nonce presence with --phase prep, never
#     auto-detection/absent-args/fallback -- WV-COMPAT-7.
# (2) reproduces the legacy artifact byte-for-byte -- WV-COMPAT-1.
# (3) rejects any combination with new request/digest/decision/evidence args,
#     --supersede, or non-empty stdin -- WV-COMPAT-3/4/5/6/9.
# (4) structured path stays exclusively JSON/request-bound/no-fallback -- WV-COMPAT-2
#     plus every non-nonce case in this file (WV-1..21) collectively.
# (5) RED/GREEN for bidirectional isolation, ambiguous combinations, exact output, and
#     non-authorization of the structured path -- WV-COMPAT-1 (extended)/2/8.
# (6) documented exception + retirement owner -- a P4 docs task, intentionally
#     untested here (no test can assert an ownership decision).
# NOT part of the original 49 cases or PLAN.md's normative verdict/v1 schema -- a
# narrow, deliberate parallel mechanism for one out-of-manifest consumer (runtime-
# bridge-codex's p2-prep-verdict.cjs), never integrated into the new JSON contract.

# Condition 2(a): byte-identical regression test. Golden structure is SOURCE-DERIVED
# (see report to arch-testing), not captured via a live pre-Wave-3 execution -- a
# direct cross-reference of write-verdict.sh's own heredoc template (lines 367-381 at
# the time of this writing) against prep-publication-grammar.cjs's exact validator
# (lines 42-139), both read in full. Every line except Timestamp (wall-clock, asserted
# by format+window instead) must match byte-for-byte. The strongest possible proof is
# included: the REAL production grammar module is invoked against the script's actual
# output, not just a string-shape assertion.

@test "WV-COMPAT-1 PASS: --publication-nonce reproduces today's exact legacy markdown output (golden fixture, source-derived) and the real grammar validator accepts it" {
  local nonce="0123456789abcdef0123456789abcdef"
  local wave_dir="$PROJ/.planning/wave-$WAVE_SLUG"
  mkdir -p "$wave_dir"
  printf '# Plan\n\nSome plan content.\n' > "$wave_dir/PLAN.md"
  local real_plan_sha256; real_plan_sha256="$(_real_sha256 "$wave_dir/PLAN.md")"
  local real_head; real_head="$(git -C "$PROJ" rev-parse HEAD)"

  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' --publication-nonce '$nonce'"
  [ "$status" -eq 0 ]

  local legacy_file="$wave_dir/arch-testing-verdict.md"
  [ -f "$legacy_file" ] || return 1

  [ "$(sed -n '1p' "$legacy_file")" = "# arch-testing verdict — wave-$WAVE_SLUG" ] || return 1
  [ "$(sed -n '2p' "$legacy_file")" = "" ] || return 1
  [ "$(sed -n '3p' "$legacy_file")" = "**Phase**: PREP" ] || return 1
  [ "$(sed -n '5p' "$legacy_file")" = "**Status**: APPROVED-PREP" ] || return 1
  [ "$(sed -n '6p' "$legacy_file")" = "**PREP-HEAD**: $real_head" ] || return 1
  [ "$(sed -n '7p' "$legacy_file")" = "**PLAN_SHA256**: $real_plan_sha256" ] || return 1
  [ "$(sed -n '8p' "$legacy_file")" = "**PUBLICATION-NONCE**: $nonce" ] || return 1

  local line4; line4="$(sed -n '4p' "$legacy_file")"
  [[ "$line4" =~ ^\*\*Timestamp\*\*:\ [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 1

  local total_lines; total_lines="$(wc -l < "$legacy_file" | tr -d ' \r')"
  [ "$total_lines" -eq 9 ] || return 1

  # Strongest proof: run the file through the REAL production validator, not just a
  # shape assertion. validatePrepPublicationGrammar itself uses none of its factory's
  # injected deps (confirmed by direct read), so stubs are safe here.
  local verify_script="$PROJ/__verify-grammar.cjs"
  cat > "$verify_script" <<'NODEEOF'
const { createPrepPublicationGrammar } = require(process.argv[2]);
const noop = () => {};
const grammar = createPrepPublicationGrammar({
  isCanonicalIsoUtc: noop, hasExactKeys: noop, canonicalJSONStringify: noop,
  sha256Buffer: noop, registryRepoDir: noop, readRegistryRecord: noop,
  writeRegistryRecordReplace: noop, path: require('path'), crypto: require('crypto'),
  isHexDigest64: noop, isSafeP2SubjectPath: noop, nowIsoForRegistry: noop,
  PREP_PUBLICATION_INTENT_CORRELATED_FIELDS: [], PREP_PUBLICATION_INTENT_STATES: [],
  PREP_PUBLICATION_INTENT_KEYS: [], PREP_PUBLICATION_RECEIPT_SCHEMA: 'x',
  PREP_PUBLICATION_RECEIPT_KEYS: [], validatePrepPublicationIntentRecord: noop,
  validatePrepPublicationReceiptRecord: noop, prepPublicationIntentPathFor: noop,
  prepPublicationReceiptPathFor: noop,
});
const bytes = require('fs').readFileSync(process.argv[3]);
const intent = {
  role: process.argv[4], wave_slug: process.argv[5], head: process.argv[6],
  plan_sha256: process.argv[7], publication_nonce: process.argv[8],
};
const result = grammar.validatePrepPublicationGrammar(bytes, intent);
if (!result.ok) { process.stderr.write('GRAMMAR REJECTED: ' + result.reason + '\n'); process.exit(1); }
process.exit(0);
NODEEOF
  run node "$verify_script" "$BATS_TEST_DIRNAME/../lib/runtime-role-lifecycle/prep-publication-grammar.cjs" \
    "$legacy_file" arch-testing "$WAVE_SLUG" "$real_head" "$real_plan_sha256" "$nonce"
  [ "$status" -eq 0 ] || return 1

  # rule 5, second isolation direction (arch-testing, 2026-09-21): the nonce path must
  # not ALSO produce any structured-system side effect -- no JSON verdict, no request
  # ever created/consumed. Complements WV-COMPAT-8's stronger "even if fed to the new
  # reader it's rejected" proof with a simpler "it never even tried" construction proof.
  [ ! -e "$wave_dir/arch-testing-verdict-prep.json" ] || return 1
  [ -z "$(ls -A "$wave_dir/verdict-requests" 2>/dev/null)" ] || return 1
}

# Condition 2(b) + condition 1 (isolation, already structurally confirmed by disjoint
# paths -- this test proves it end-to-end rather than by inspection alone).

@test "WV-COMPAT-2 PASS: a normal call WITHOUT --publication-nonce never touches the legacy .md path, goes through the new JSON system untouched" {
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && printf 'x\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 0 ]
  [ -f "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" ] || return 1
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md" ]
}

# ══════════════ WV-COMPAT-3..8 (rule 3 + rule 5 additions, arch-platform-specified ═══
# 2026-09-21 in direct follow-up review): --publication-nonce is a narrow, mutually-
# exclusive legacy path -- any combination with new-system flags or non-empty stdin
# must fail closed (rule 3), and the legacy artifact must never be recognized as
# authorizing anything by the new structured system's own reader (rule 5's strongest
# requirement -- proven against the REAL CLI/contract code, same "strongest possible
# proof" philosophy as WV-COMPAT-1's grammar-validator check, not a shape assertion).
# One scenario per @test (matches this file's WV-18/19/20 convention) rather than a
# parameterized/looped case, so a regression in one combination names itself directly.
# Same isolation/fixture conventions as WV-COMPAT-1/2 above.

@test "WV-COMPAT-3 FAIL: --publication-nonce combined with --request/--request-sha256/--decision exits 2, writes neither the legacy nor the new-system artifact" {
  local nonce="0123456789abcdef0123456789abcdef"
  local req req_sha256
  req="$(_seed_request prep)"
  req_sha256="$(_real_sha256 "$req")"
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --publication-nonce '$nonce' --request '$req' --request-sha256 '$req_sha256' --decision approve"
  [ "$status" -eq 2 ]
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md" ] || return 1
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" ] || return 1
}

@test "WV-COMPAT-4 FAIL: --publication-nonce combined with --evidence-file exits 2, writes neither artifact" {
  local nonce="0123456789abcdef0123456789abcdef"
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  local ev="$PROJ/.planning/wave-$WAVE_SLUG/evidence.txt"; printf 'e\n' > "$ev"
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --publication-nonce '$nonce' --evidence-file '$ev'"
  [ "$status" -eq 2 ]
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md" ] || return 1
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" ] || return 1
}

@test "WV-COMPAT-5 FAIL: --publication-nonce combined with bare --supersede exits 2, writes neither artifact" {
  local nonce="0123456789abcdef0123456789abcdef"
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --publication-nonce '$nonce' --supersede"
  [ "$status" -eq 2 ]
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md" ] || return 1
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" ] || return 1
}

@test "WV-COMPAT-6 FAIL: --publication-nonce with non-empty stdin exits 2, writes neither artifact (contrast WV-COMPAT-1's no-stdin-at-all invocation)" {
  local nonce="0123456789abcdef0123456789abcdef"
  run bash -c "cd '$PROJ' && printf 'unexpected rationale text\n' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --publication-nonce '$nonce'"
  [ "$status" -eq 2 ]
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md" ] || return 1
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" ] || return 1
}

@test "WV-COMPAT-7 FAIL: --publication-nonce with --phase verify-final exits 2, writes neither artifact (nonce activates for PREP only)" {
  local nonce="0123456789abcdef0123456789abcdef"
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase verify-final --slug '$WAVE_SLUG' \
    --publication-nonce '$nonce'"
  [ "$status" -eq 2 ]
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md" ] || return 1
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-verify-final.json" ] || return 1
}

@test "WV-COMPAT-8 PASS: the legacy --publication-nonce artifact is never recognized as authorizing anything by the new structured system's own validate path (real CLI/contract code, not a shape assertion)" {
  local nonce="0123456789abcdef0123456789abcdef"
  local wave_dir="$PROJ/.planning/wave-$WAVE_SLUG"
  mkdir -p "$wave_dir"
  printf '# Plan\n\nSome plan content.\n' > "$wave_dir/PLAN.md"
  local real_plan_sha256; real_plan_sha256="$(_real_sha256 "$wave_dir/PLAN.md")"
  local real_head; real_head="$(git -C "$PROJ" rev-parse HEAD)"

  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' --publication-nonce '$nonce'"
  [ "$status" -eq 0 ]
  local legacy_file="$wave_dir/arch-testing-verdict.md"
  [ -f "$legacy_file" ] || return 1

  # Feed the exact legacy artifact into the NEW system's own validate subcommand --
  # readConfinedFile/decodeRecord's checks reject the markdown bytes outright (caught
  # internally, no crash), so wellFormed/authorizes stay at their false defaults
  # (verdict-evidence-contract.cjs's composeResult: authorizes requires wellFormed
  # among other bound fields) -- confirmed by direct read of contract.cjs before
  # writing this assertion.
  # --separate-stderr (task #20, arch-testing, 2026-09-21): this environment has
  # NO_COLOR/FORCE_COLOR both set, which makes node print a startup warning to
  # stderr on some invocations -- bats' default merged $output would corrupt the
  # clean JSON line the next `run node -e` step below parses via JSON.parse. Same
  # fix class as task #19's write-verdict-request.bats harness gap.
  local cli="$BATS_TEST_DIRNAME/../lib/verdict-evidence-contract-cli.cjs"
  run --separate-stderr bash -c "cd '$PROJ' && node '$cli' validate --path '.planning/wave-$WAVE_SLUG/arch-testing-verdict.md' \
    --expect-role arch-testing --expect-phase prep --expect-wave-slug '$WAVE_SLUG' \
    --expect-plan-sha256 '$real_plan_sha256' --expect-head '$real_head'"
  [ "$status" -eq 0 ] || return 1

  run node -e '
const r = JSON.parse(process.argv[1]);
process.exit(r.wellFormed === false && r.authorizes === false ? 0 : 1);
' "$output"
  [ "$status" -eq 0 ] || return 1
}

@test "WV-COMPAT-9 FAIL: --publication-nonce combined with a fully-formed --supersede --expected-current-sha256 exits 2, writes neither artifact (closes the loophole WV-COMPAT-5's bare --supersede case alone wouldn't: proves the mutual-exclusion check fires even when --supersede's OWN completeness requirement is independently satisfied)" {
  local nonce="0123456789abcdef0123456789abcdef"
  run bash -c "cd '$PROJ' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' --role arch-testing --phase prep --slug '$WAVE_SLUG' \
    --publication-nonce '$nonce' --supersede --expected-current-sha256 $(printf 'a%.0s' $(seq 1 64))"
  [ "$status" -eq 2 ]
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md" ] || return 1
  [ ! -e "$PROJ/.planning/wave-$WAVE_SLUG/arch-testing-verdict-prep.json" ] || return 1
}
