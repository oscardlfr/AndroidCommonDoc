#!/usr/bin/env bash
# emit-push-proof.sh — Canonical QG runner + proof emitter/verifier (bl-w47-pr-0c2 T3).
#
# USAGE
#   emit-push-proof.sh --subcommand run-qg   [--slug <wave-slug>] [--repo-root <path>]
#   emit-push-proof.sh --subcommand verify-proof --pushed-sha <sha> [--repo-root <path>]
#
# SUBCOMMANDS
#   run-qg        Canonical QG proof emitter. Loads .androidcommondoc/quality-gate-report.json
#                 (produced by the quality-gater at its Steps 0-9). Attests completeness.
#                 Writes: quality-gate.stamp, pre-pr.stamp (backward-compat),
#                         push-proof.json, push-proof.log (JSONL append).
#                 Does NOT fabricate report content — attests what the quality-gater produced.
#
#                 EVIDENCE BINDING (Wave A): a claimed report.steps[] entry of
#                 {"step":"test-suite","result":"PASS"} is no longer taken on faith. Five
#                 named checks, all die(...) -> exit 2: invalid-step-result, duplicate-
#                 step-id, unknown-step-id, test-suite-evidence-* (backed by a real,
#                 fresh, full-scope, complete, clean bats handoff via
#                 lib/bats-handoff.sh — see test-suite-evidence-{absent,stale,partial,
#                 dirty}), and report-started-at-* (report.started_at must be present
#                 and plausible — the QG-session anchor used as the evidence lookup's
#                 --since floor). push-proof.json additively gains a bats_evidence
#                 object {run_id, head, ok, not_ok, expected, scope, generated_at} (no
#                 filesystem paths); schema_version stays 1.
#
#   verify-proof  Cheap verifier for the git-layer hook. Reads push-proof.json and checks:
#                 schema_version, head, worktree_id, generated_at freshness, manifest_version,
#                 steps_executed coverage, report_digest, bats_evidence binding (present +
#                 .head == pushed_sha — mirrors verify-push-proof.ps1 and
#                 push-authorization-gate.js, all three now at equivalent rigor).
#
#                 IMPORTANT: verify-proof does NOT re-evaluate predicates. Predicate
#                 consistency was enforced at mint (run-qg) and is bound cryptographically
#                 via report_digest. Post-mint tampering with quality-gate-report.json causes
#                 report_digest mismatch and this verifier blocks. This is the "conscious +
#                 detectable" bar: a forged report with correct SKIPs requires bypassing the
#                 real emitter, which is detectable through audit logs and session records.
#                 It is NOT a cryptographic non-bypass guarantee — the same bar applies to
#                 bats_evidence: a hand-authored, well-formed, correct-HEAD handoff file is
#                 not distinguishable from a genuine one by this mechanism alone.
#
# OUTPUT CONFINEMENT
#   All output files are confined to $REPO_ROOT/.androidcommondoc/ via git rev-parse
#   --show-toplevel. Never uses --git-path or --git-common-dir (wrong for worktree data).
#
# EXIT CODES
#   0  success
#   1  usage / argument error
#   2  integrity violation (manifest-drift, deliberation-absent, step-gap, forged proof, etc.)
#
# Fail-CLOSED on all integrity checks. Fail-OPEN ONLY on push-proof.log write failure
# (log append is best-effort; do not block a valid push on log I/O failure).

set -euo pipefail

# ── Script dir (for sourcing lib helpers) ────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Source helpers ────────────────────────────────────────────────────────────
# shellcheck source=lib/manifest-digest.sh
source "$SCRIPT_DIR/lib/manifest-digest.sh"
# shellcheck source=lib/audit-append.sh
source "$SCRIPT_DIR/lib/audit-append.sh"

# ── Constants ─────────────────────────────────────────────────────────────────
MAX_AGE_SECS=1800
SKEW_TOLERANCE=120

# ── Argument parsing ──────────────────────────────────────────────────────────
SUBCOMMAND=""
SLUG_OVERRIDE=""
REPO_ROOT_OVERRIDE=""
PUSHED_SHA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --subcommand)
      SUBCOMMAND="${2:-}"
      shift 2
      ;;
    --slug)
      SLUG_OVERRIDE="${2:-}"
      shift 2
      ;;
    --repo-root)
      REPO_ROOT_OVERRIDE="${2:-}"
      shift 2
      ;;
    --pushed-sha)
      PUSHED_SHA="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,/^$/p' "$0"
      exit 0
      ;;
    *)
      echo "[emit-push-proof] ERROR: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SUBCOMMAND" ]]; then
  echo "[emit-push-proof] ERROR: --subcommand is required (run-qg|verify-proof)" >&2
  exit 1
fi

if [[ "$SUBCOMMAND" != "run-qg" && "$SUBCOMMAND" != "verify-proof" ]]; then
  echo "[emit-push-proof] ERROR: unknown subcommand '$SUBCOMMAND' (must be run-qg|verify-proof)" >&2
  exit 1
fi

if [[ "$SUBCOMMAND" == "verify-proof" && -z "$PUSHED_SHA" ]]; then
  echo "[emit-push-proof] ERROR: --pushed-sha is required for verify-proof" >&2
  exit 1
fi

# ── Repo root resolution ──────────────────────────────────────────────────────
if [[ -n "$REPO_ROOT_OVERRIDE" ]]; then
  REPO_ROOT="$REPO_ROOT_OVERRIDE"
else
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

ACDOC_DIR="$REPO_ROOT/.androidcommondoc"
MANIFEST_PATH="$REPO_ROOT/quality-gate-manifest.json"
REPORT_PATH="$ACDOC_DIR/quality-gate-report.json"
PROOF_PATH="$ACDOC_DIR/push-proof.json"
PROOF_LOG="$ACDOC_DIR/push-proof.log"
QG_STAMP_PATH="$ACDOC_DIR/quality-gate.stamp"
PP_STAMP_PATH="$ACDOC_DIR/pre-pr.stamp"

# ── Canonical worktree identifier ─────────────────────────────────────────────
# Single source of truth for mint-time and verify-time: the two MUST agree or
# every proof is rejected as a forgery. Symlinks are resolved because macOS
# `mktemp -d` yields /var/... while `git rev-parse --show-toplevel` yields
# /private/var/... for the same directory. `pwd -P` is POSIX; GNU `realpath`
# does not exist on a BSD userland.
resolve_worktree_id() {
  local root
  root="$(git -C "${1:-.}" rev-parse --show-toplevel 2>/dev/null)" || { echo "UNKNOWN"; return 0; }
  [[ -n "$root" ]] || { echo "UNKNOWN"; return 0; }
  ( cd "$root" 2>/dev/null && pwd -P ) || echo "$root"
}

# ── Slug resolution (mirrors write-verdict.sh) ────────────────────────────────
resolve_slug() {
  if [[ -n "$SLUG_OVERRIDE" ]]; then
    echo "$SLUG_OVERRIDE"
    return
  fi
  if [[ -n "${CLAUDE_WAVE_SLUG:-}" ]]; then
    echo "$CLAUDE_WAVE_SLUG"
    return
  fi
  local branch="" slug=""
  branch="$(git -C "$REPO_ROOT" symbolic-ref --short HEAD 2>/dev/null || git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
  slug="${branch##*/}"
  if [[ -z "$slug" || "$slug" =~ ^(develop|master|main|HEAD)$ ]]; then
    echo "[emit-push-proof] ERROR: cannot resolve wave slug from branch '$branch'. Use --slug." >&2
    exit 2
  fi
  echo "$slug"
}

# ── Subcommand: run-qg ────────────────────────────────────────────────────────

run_qg() {
  # -- 1. Manifest-drift check --------------------------------------------------
  if [[ ! -f "$MANIFEST_PATH" ]]; then
    echo "[emit-push-proof] ERROR: quality-gate-manifest.json not found at $MANIFEST_PATH" >&2
    exit 2
  fi

  local stored_digest derived_digest
  stored_digest="$(python3 - "$MANIFEST_PATH" << 'PYEOF'
import json, sys
print(json.load(open(sys.argv[1], encoding='utf-8'))['protocol_digest'])
PYEOF
)"
  derived_digest="$(canonical_digest "$MANIFEST_PATH")"
  if [[ "$stored_digest" != "$derived_digest" ]]; then
    echo "[emit-push-proof] ERROR: manifest-drift — protocol_digest mismatch. Stored: $stored_digest  Derived: $derived_digest. Regenerate quality-gate-manifest.json." >&2
    exit 2
  fi

  # -- 2. Slug resolution -------------------------------------------------------
  local wave_slug
  wave_slug="$(resolve_slug)"

  # -- 2b. CLASS-aware required-roles (BL-W48 artifact-floor) -------------------
  # Resolve required architect roles from the wave CLASS via wave-topology.yaml
  # class_artifacts (single source of truth). HARNESS == the manifest's static
  # required_roles; DOC/FAST-PATH are CLASS-correct. Exported so both Python
  # blocks honor it; they fall back to the manifest value on FALLBACK/error.
  local _req_roles
  _req_roles="$(node "$REPO_ROOT/scripts/sh/lib/resolve-required-roles.js" "$REPO_ROOT" "$wave_slug" 2>/dev/null || echo FALLBACK)"
  if [[ "$_req_roles" == "DECLARED_MISSING" ]]; then
    echo "[emit-push-proof] ERROR: wave CLASS requires 'declared' architects but PLAN.md has no usable '**Required-Architects**:' token (fail-closed). Add the token or correct the CLASS." >&2
    exit 2
  fi
  if [[ "$_req_roles" == "FALLBACK" ]]; then
    unset ACDOC_REQUIRED_ROLES
  else
    export ACDOC_REQUIRED_ROLES="$_req_roles"
  fi

  # -- 3. Load + validate report + named-predicate enforcement ------------------
  if [[ ! -f "$REPORT_PATH" ]]; then
    echo "[emit-push-proof] ERROR: quality-gate-report.json not found at $REPORT_PATH. Run /quality-gate (Steps 0-9) first." >&2
    exit 2
  fi

  # Compute base/head for predicate evaluation (git diff range)
  local head_sha base_sha
  head_sha="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "UNKNOWN")"
  base_sha="$(git -C "$REPO_ROOT" merge-base HEAD origin/develop 2>/dev/null \
              || git -C "$REPO_ROOT" merge-base HEAD develop 2>/dev/null \
              || git -C "$REPO_ROOT" rev-parse HEAD~1 2>/dev/null \
              || echo "$head_sha")"

  # Collect diff file list once (used by multiple predicates)
  local diff_files=""
  diff_files="$(git -C "$REPO_ROOT" diff --name-only "${base_sha}...${head_sha}" 2>/dev/null || echo "")"

  # -- 3a. Resolve report.started_at (Section A4's report-started-at-* anchor) -----
  # Mirrors emit-qg-result.sh's own started_at extraction pattern. This becomes the
  # --since floor passed to the bats-evidence lookup below, AND is independently
  # validated for presence/plausibility inside the Python pass (report-started-at-*).
  local report_started_at
  report_started_at="$(python3 -c "
import json, sys
try:
    obj = json.load(open(sys.argv[1], encoding='utf-8'))
    print(obj.get('started_at', ''))
except Exception:
    print('')
" "$REPORT_PATH" 2>/dev/null || true)"

  # -- 3b. Resolve bats evidence via the sole CLI parser (Step 1, lib/bats-handoff.sh) --
  # Always exits 0 — meaning lives in evidence.status (ok|stale|absent|malformed),
  # checked by name below (test-suite-evidence-*), never by this call's exit code.
  local bats_evidence_json
  bats_evidence_json="$(bash "$SCRIPT_DIR/lib/bats-handoff.sh" select \
      --repo-root "$REPO_ROOT" --head "$head_sha" --since "$report_started_at" \
      --require-scope full --format json)"

  # All validation + predicate enforcement in one Python pass.
  # Predicate evaluation is mirrored from the bash eval_predicate design
  # (PLAN.md L38-51): one explicit check per named predicate, case-equivalent logic.
  python3 - "$REPORT_PATH" "$MANIFEST_PATH" "$REPO_ROOT" "$diff_files" "$wave_slug" \
      "$report_started_at" "$bats_evidence_json" "$head_sha" "$SKEW_TOLERANCE" << 'PYEOF'
import json, sys, os, re, datetime

report_path        = sys.argv[1]
manifest_path      = sys.argv[2]
repo_root          = sys.argv[3]
diff_files         = sys.argv[4]   # newline-separated list from git diff
wave_slug          = sys.argv[5]   # current wave slug (empty string if no active wave)
report_started_at  = sys.argv[6]   # report.started_at, or '' if absent/unreadable
bats_evidence_raw  = sys.argv[7]   # JSON from lib/bats-handoff.sh select --format json
head_sha_arg       = sys.argv[8]   # current HEAD sha (already computed in bash)
skew_tolerance     = int(sys.argv[9])

def die(msg):
    print(f"[emit-push-proof] ERROR: {msg}", file=sys.stderr)
    sys.exit(2)

# ── Load files ────────────────────────────────────────────────────────────────
try:
    with open(report_path, encoding='utf-8') as f:
        report = json.load(f)
except Exception as e:
    die(f"quality-gate-report.json unreadable/malformed: {e}")

with open(manifest_path, encoding='utf-8') as f:
    manifest = json.load(f)

diff_list = [l for l in diff_files.splitlines() if l.strip()]

# ── Named-predicate evaluation (PLAN.md L38-51 — closed enum) ─────────────────
def eval_predicate(predicate):
    if predicate == 'project_type_gradle_or_hybrid':
        return (os.path.isfile(os.path.join(repo_root, 'settings.gradle')) or
                os.path.isfile(os.path.join(repo_root, 'settings.gradle.kts')))

    elif predicate == 'project_type_node_or_hybrid':
        if os.path.isfile(os.path.join(repo_root, 'package.json')):
            return True
        try:
            for name in os.listdir(repo_root):
                sub = os.path.join(repo_root, name)
                if os.path.isdir(sub) and os.path.isfile(os.path.join(sub, 'package.json')):
                    return True
        except OSError:
            pass
        return False

    elif predicate == 'kt_files_changed':
        return any(f.endswith('.kt') for f in diff_list)

    elif predicate == 'kt_changed_and_gradle':
        return (eval_predicate('kt_files_changed') and
                eval_predicate('project_type_gradle_or_hybrid'))

    elif predicate == 'task_is_code_changes':
        exclude = re.compile(r'^(docs/|.*\.md$|.*\.toml$|.*\.properties$|.*\.yml$|.*\.yaml$)')
        return any(not exclude.match(f) for f in diff_list if f)

    elif predicate == 'kt_and_docs_api_and_gradle':
        return (eval_predicate('kt_files_changed') and
                os.path.isdir(os.path.join(repo_root, 'docs', 'api')) and
                eval_predicate('project_type_gradle_or_hybrid'))

    elif predicate == 'compose_ui_files_changed':
        pat = re.compile(r'(ui|compose)/.*\.kt$')
        return any(pat.search(f) for f in diff_list)

    elif predicate == 'runtime_ui_available':
        # Mechanical check only: baseline dir exists.
        # Env-dependent part (adb/desktop) is attested in report reason; not re-verified.
        return os.path.isdir(os.path.join(repo_root, '.androidcommondoc', 'ui-baseline'))

    elif predicate == 'wave_plan_present':
        # True when an active wave PLAN.md exists (.planning/wave-<slug>/PLAN.md).
        # False (→ honest SKIP) when there is no active wave or no plan file.
        # Inline slug-validation: defense-in-depth (resolve_slug has no allowlist).
        if not wave_slug or not re.match(r'^[A-Za-z0-9._-]+$', wave_slug):
            return False
        plan_path = os.path.join(repo_root, '.planning', f'wave-{wave_slug}', 'PLAN.md')
        return os.path.isfile(plan_path)

    else:
        die(f"unknown predicate '{predicate}'")

# ── Required-role resolution (P1: CLASS-aware, resolved BEFORE deliberation) ───
# BL-W48: CLASS-aware required_roles (resolver, exported by bash as ACDOC_REQUIRED_ROLES)
# overrides the manifest's static value when present; the manifest value is the fallback
# (identical for HARNESS). FAST-PATH resolves to [] (class_artifacts architects: []) ->
# architect deliberation + verdicts are NOT required for it.
arb_step = next((s for s in manifest.get('required_steps', []) if s['id'] == 'architect-deliberation'), None)
_rr = os.environ.get('ACDOC_REQUIRED_ROLES', '')
required_roles = json.loads(_rr) if _rr else (arb_step.get('required_roles', []) if arb_step else [])

# ── Deliberation evidence (required ONLY when the CLASS requires architects) ───
# FAST-PATH (required_roles == []) carries no architect deliberation; skip the floor.
delib = report.get('deliberation') or {}
if required_roles:
    if not delib:
        die("deliberation-evidence-absent: 'deliberation' block missing from report")
    consulted = delib.get('architects_consulted') or []
    if not consulted:
        die("deliberation-evidence-absent: deliberation.architects_consulted is empty")
    if not delib.get('incorporated_at'):
        die("deliberation-evidence-absent: deliberation.incorporated_at is absent")
    consulted_set = set(consulted)
    for role in required_roles:
        if role not in consulted_set:
            die(f"deliberation-role-incomplete: required role '{role}' absent from report.deliberation.architects_consulted {sorted(consulted_set)}")

# ── Pre-PR coverage ───────────────────────────────────────────────────────────
if not report.get('pre_pr_coverage'):
    die("runtime-report-incomplete: pre_pr_coverage absent from report")

# ── Discovered rules ──────────────────────────────────────────────────────────
discovered = report.get('discovered_rules') or []
if not discovered:
    die("runtime-report-incomplete: discovered_rules absent or empty")
for entry in discovered:
    if not entry.get('verified_by'):
        die(f"runtime-report-incomplete: discovered_rules entry missing verified_by: {entry}")

# ── Section A4: five named hard checks, all die(...) -> exit 2 ────────────────
# Checked BEFORE the step index is built below, so a duplicate/unknown id is caught
# here rather than silently last-write-wins-collapsed by the dict comprehension.
steps_list = report.get('steps') or []

# invalid-step-result: every steps[].result in {PASS, FAIL, SKIP}. Scoped to
# steps[].result only -- discovered_rules[].result free text is untouched.
_VALID_RESULTS = {'PASS', 'FAIL', 'SKIP'}
for _s in steps_list:
    _r = _s.get('result')
    if _r not in _VALID_RESULTS:
        die(f"invalid-step-result: step '{_s.get('step', '<unknown>')}' has result={_r!r}, must be one of {sorted(_VALID_RESULTS)}")

# duplicate-step-id: reject two entries sharing a step id (closes the last-wins
# overwrite the dict comprehension below would otherwise silently perform).
_seen_ids = set()
for _s in steps_list:
    _sid = _s.get('step')
    if _sid is None:
        continue
    if _sid in _seen_ids:
        die(f"duplicate-step-id: step id '{_sid}' appears more than once in report.steps[]")
    _seen_ids.add(_sid)

# unknown-step-id: every steps[].step in required_steps | conditional_steps |
# informational_steps. informational_steps is declared exactly ["report-freshness"]
# (Step 9) -- #EP-UNK+ is the positive control proving it is accepted, not rejected.
_required_ids      = {rs['id'] for rs in manifest.get('required_steps', [])}
_conditional_ids    = {cs['id'] for cs in manifest.get('conditional_steps', [])}
_informational_ids  = set(manifest.get('informational_steps', []))
_known_ids = _required_ids | _conditional_ids | _informational_ids
for _s in steps_list:
    _sid = _s.get('step')
    if _sid is not None and _sid not in _known_ids:
        die(f"unknown-step-id: step id '{_sid}' is not in required_steps, conditional_steps, or informational_steps")

# ── Step index ────────────────────────────────────────────────────────────────
# Duplicates already rejected above, so last-write-wins here is now unreachable, not a bug.
steps = {s['step']: s for s in steps_list if 'step' in s}

# report-started-at-*: report.started_at must be present and parse as UTC
# %Y-%m-%dT%H:%M:%SZ; plausibility bound now-86400 <= started_at <= now+skew_tolerance.
# This is the D6 / in-scope check -- distinct from the pre-existing, untouched
# scripts/sh/lib/qg-report-freshness.sh (step-reason staleness).
if not report_started_at:
    die("report-started-at-absent: report.started_at is missing (was --init run before the bats run?)")
try:
    _started_dt = datetime.datetime.strptime(report_started_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
except ValueError:
    die(f"report-started-at-absent: report.started_at is not parseable as UTC %Y-%m-%dT%H:%M:%SZ: {report_started_at!r}")
_now_dt = datetime.datetime.now(datetime.timezone.utc)
_age_secs = (_now_dt - _started_dt).total_seconds()
if _age_secs > 86400:
    die(f"report-started-at-implausible: report.started_at is {_age_secs:.0f}s in the past (max 86400s -- intentional max-staleness bound, not unlimited replay protection)")
if _age_secs < -skew_tolerance:
    die(f"report-started-at-implausible: report.started_at is {-_age_secs:.0f}s in the future (max {skew_tolerance}s skew)")

# test-suite-evidence-*: a claimed test-suite: PASS is accepted only when backed by
# real, fresh, full-scope, complete, clean evidence -- plus a sanity floor that closes
# BOTH ok==0 (tautological alone) AND total==expected (Amendment A, required -- without
# it, ok=5,not_ok=0,total=5,expected=999,complete=true would pass every other check).
_test_suite_entry = steps.get('test-suite')
if _test_suite_entry is not None and _test_suite_entry.get('result') == 'PASS':
    try:
        _evidence = json.loads(bats_evidence_raw)
    except Exception:
        die("test-suite-evidence-absent: bats evidence JSON unparseable")

    if _evidence.get('status') != 'ok':
        die(f"test-suite-evidence-absent: bats evidence status={_evidence.get('status')!r} (expected 'ok')")
    if _evidence.get('head') != head_sha_arg:
        die(f"test-suite-evidence-stale: bats evidence head={_evidence.get('head')!r} != current HEAD={head_sha_arg!r}")
    if _evidence.get('scope') != 'full':
        die(f"test-suite-evidence-partial: bats evidence scope={_evidence.get('scope')!r} (expected 'full')")
    if _evidence.get('complete') is not True:
        die(f"test-suite-evidence-partial: bats evidence complete={_evidence.get('complete')!r} (expected true)")
    if _evidence.get('not_ok', 1) != 0:
        die(f"test-suite-evidence-dirty: bats evidence not_ok={_evidence.get('not_ok')!r} (expected 0)")

    # Sanity floor (Amendment A, REQUIRED) -- "a guard that cannot fail is worse than none".
    _ok_n, _expected_n, _total_n, _not_ok_n = (
        _evidence.get('ok', 0), _evidence.get('expected', 0),
        _evidence.get('total', 0), _evidence.get('not_ok', 0),
    )
    if not (isinstance(_ok_n, int) and _ok_n > 0):
        die(f"test-suite-evidence-absent: bats evidence ok={_ok_n!r} fails sanity floor (must be > 0)")
    if not (isinstance(_expected_n, int) and _expected_n > 0):
        die(f"test-suite-evidence-absent: bats evidence expected={_expected_n!r} fails sanity floor (must be > 0)")
    if _total_n != _ok_n + _not_ok_n:
        die(f"test-suite-evidence-absent: bats evidence total={_total_n!r} != ok+not_ok={_ok_n + _not_ok_n} (sanity floor)")
    if _total_n != _expected_n:
        die(f"test-suite-evidence-absent: bats evidence total={_total_n!r} != expected={_expected_n!r} (sanity floor, Amendment A -- closes the ok=5,not_ok=0,total=5,expected=999,complete=true bypass)")

# ── Required steps coverage ───────────────────────────────────────────────────
# Required steps must be ran=true AND result=PASS. SKIP / not-ran / absent all fail.
# P1: 'architect-deliberation' is required ONLY when the CLASS requires architects
# (required_roles non-empty); FAST-PATH (architects: []) does not require it.
for rs in manifest.get('required_steps', []):
    sid = rs['id']
    if sid == 'architect-deliberation' and not required_roles:
        continue
    if sid not in steps:
        die(f"step-coverage-gap: required step '{sid}' absent from report steps[]")
    entry = steps[sid]
    if entry.get('result') != 'PASS' or not entry.get('ran'):
        die(f"step-not-pass: required step '{sid}' must be ran=true + result=PASS, got ran={entry.get('ran')!r} result={entry.get('result')!r}")

# ── Conditional steps: structural coverage + predicate enforcement ─────────────
for cs in manifest.get('conditional_steps', []):
    sid       = cs['id']
    predicate = cs['predicate']
    if sid not in steps:
        die(f"step-coverage-gap: conditional step '{sid}' absent from report steps[]")
    entry  = steps[sid]
    ran    = entry.get('ran')
    result = entry.get('result', '')
    reason = (entry.get('reason') or '').strip()

    # Structural checks
    if ran is False and result != 'SKIP':
        die(f"unjustified-skip: step '{sid}' ran=false but result='{result}' (not SKIP)")
    if result == 'SKIP' and not reason:
        die(f"unjustified-skip: step '{sid}' result=SKIP but reason is empty/missing")
    if ran is True and result == 'FAIL':
        die(f"step-failed: conditional step '{sid}' has result=FAIL")

    # Predicate enforcement (PLAN.md L56-66)
    pred_true  = eval_predicate(predicate)
    env_attest = bool(cs.get('env_attested', False))
    if pred_true and result == 'SKIP':
        # env_attested steps: predicate-true + SKIP + non-empty reason is allowed —
        # the runtime env check is delegated to the quality-gater's attested reason.
        if not (env_attest and reason):
            die(f"inconsistent-skip: predicate '{predicate}' is TRUE but step '{sid}' shows SKIP in report")
    if pred_true and result == 'FAIL':
        die(f"mandatory-step-not-pass: predicate '{predicate}' is TRUE but step '{sid}' has result=FAIL")
    # pred_true + PASS -> valid; pred_false + SKIP+reason -> valid; pred_false + PASS -> valid
    # env_attest + pred_true + SKIP+reason -> valid (runtime env delegated to attested reason)

print("VALIDATION_PASS", file=sys.stderr)
PYEOF

  # -- 3b. Verify arch verdict files (verdict→HEAD binding) ---------------------
  # Reads arch-*-verdict.md files directly from .planning/wave-<slug>/.
  # Every matched file must carry APPROVED-VERIFY-FINAL and **HEAD**: == final HEAD.
  # No silent PREP-only skip: any matched file missing VERIFY-FINAL is a hard error.
  # sha256(file, CRLF->LF) per verdict collected into artifact_digests for proof.json.
  local artifact_digests_json
  artifact_digests_json="$(python3 - "$REPORT_PATH" "$REPO_ROOT" "$wave_slug" "$head_sha" << 'PYEOF'
import sys, os, re, hashlib, json

report_path = sys.argv[1]
repo_root   = sys.argv[2]
wave_slug   = sys.argv[3]
final_head  = sys.argv[4]

def die(code, msg):
    print(f"[emit-push-proof] ERROR: {msg}", file=sys.stderr)
    sys.exit(code)

# ── CLASS-aware required_roles (P1: resolved FIRST; FAST-PATH == [] skips the floor) ──
manifest = json.load(open(os.path.join(repo_root, 'quality-gate-manifest.json'), encoding='utf-8'))
arb_step = next((s for s in manifest.get('required_steps', []) if s['id'] == 'architect-deliberation'), None)
_rr = os.environ.get('ACDOC_REQUIRED_ROLES', '')
required_roles = json.loads(_rr) if _rr else (arb_step.get('required_roles', []) if arb_step else [])

wave_dir = os.path.join(repo_root, '.planning', f'wave-{wave_slug}')
digests = {}
if required_roles:
    # The CLASS requires architects: wave dir + VERIFY-FINAL + HEAD-bound verdicts must exist.
    if not os.path.isdir(wave_dir):
        die(2, f"verdict-head-binding: wave dir not found: {wave_dir}")
    verdict_files = [f for f in os.listdir(wave_dir) if re.match(r'arch-.*-verdict\.md$', f)]
    if not verdict_files:
        die(2, f"verdict-head-binding: no arch-*-verdict.md files found in {wave_dir}")
    for fname in verdict_files:
        fpath = os.path.join(wave_dir, fname)
        with open(fpath, 'r', encoding='utf-8') as f:
            content = f.read()
        # Must contain APPROVED-VERIFY-FINAL
        if 'APPROVED-VERIFY-FINAL' not in content:
            die(2, f"verdict-head-binding: {fname} does not contain APPROVED-VERIFY-FINAL — re-run VERIFY-FINAL at final HEAD")
        # Must contain **HEAD**: <sha> matching final HEAD
        m = re.search(r'^\*\*HEAD\*\*:\s*([0-9a-f]{40})', content, re.MULTILINE)
        if not m:
            die(2, f"verdict-head-binding: {fname} missing **HEAD**: field — re-run write-verdict.sh --phase verify-final at final HEAD")
        verdict_head = m.group(1)
        if verdict_head != final_head:
            die(2, f"verdict-head-binding: {fname} HEAD ({verdict_head}) != final HEAD ({final_head}) — stale verdict, re-run VERIFY-FINAL")
        # Digest the file (CRLF->LF)
        raw = open(fpath, 'rb').read().replace(b'\r\n', b'\n')
        digests[fname] = hashlib.sha256(raw).hexdigest()

# ── Per-role verdict-file check (P1) ─────────────────────────────────────────
# For each required_role, a VERIFY-FINAL + HEAD-bound arch-<role>-verdict.md must exist.
# required_roles was resolved at the top of this block (empty for FAST-PATH -> no-op loop).
verdict_basenames = set(digests.keys())  # already verified VERIFY-FINAL + HEAD-bound
for role in required_roles:
    # required_roles values carry the 'arch-' prefix (e.g. "arch-platform").
    # write-verdict.sh strips it via ${ROLE#arch-} → file is "arch-platform-verdict.md".
    # Strip here too so f'arch-{short}-verdict.md' matches what write-verdict.sh produces.
    short = role[5:] if role.startswith('arch-') else role
    expected = f'arch-{short}-verdict.md'
    if expected not in verdict_basenames:
        die(2, f"deliberation-role-incomplete: required verdict file '{expected}' missing or not VERIFY-FINAL+HEAD-bound in {wave_dir}")

# Write digests to stdout as JSON for bash to capture
print(json.dumps(digests))
PYEOF
)"

  # -- 4. Committed-tree integrity (Part 1: clean-tree + Part 2: registry) ------
  # Runs AFTER verdict->HEAD binding, BEFORE report_digest.
  # (A) Clean-tree assertion: git status --porcelain must be empty except
  #     paths matching ^\.claude/wave-quality-gates/ (QG sentinel files).
  #     .planning/wave*/ and .androidcommondoc/ are gitignored -> invisible.
  local _dirty_lines _dirty_fail
  _dirty_lines="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null || true)"
  _dirty_fail=0
  while IFS= read -r _line; do
    [[ -z "$_line" ]] && continue
    # XY + space + path; extract path (field 3+)
    _path="${_line:3}"
    if [[ ! "$_path" =~ ^\.claude/wave-quality-gates/ ]]; then
      _dirty_fail=1
      echo "[emit-push-proof] DIRTY: $_line" >&2
    fi
  done <<< "$_dirty_lines"
  if [[ $_dirty_fail -ne 0 ]]; then
    echo "[emit-push-proof] ERROR: tracked artifact drift detected; commit regenerated artifact, re-seal verdicts, rerun QG." >&2
    exit 2
  fi

  # (B) Registry integrity: call shared script (same logic as CI skill-registry job).
  #     Pass --require-registry when the repo has a skills/ directory.
  local _ri_flags=""
  if [[ -d "$REPO_ROOT/skills" ]]; then
    _ri_flags="--require-registry"
  fi
  if ! bash "$SCRIPT_DIR/qg-registry-integrity.sh" --project-root "$REPO_ROOT" $_ri_flags >&2; then
    echo "[emit-push-proof] ERROR: derived artifact drift detected; commit regenerated artifact, re-seal verdicts, rerun QG." >&2
    exit 2
  fi

  # (D) Template size gate: block mint if any agent template exceeds its cap.
  #     Guard: only when setup/agent-templates/ exists (mirrors registry -d skills guard).
  #     Repos/fixtures without the dir have no templates to size-check — N/A, not a bypass.
  #     CWD-independent: pass explicit dirs matching REPO_ROOT (mirrors --project-root pattern).
  #     Inline exit-code gate — NOT a required_steps[] entry.
  if [[ -d "$REPO_ROOT/setup/agent-templates" ]]; then
    if ! bash "$SCRIPT_DIR/validate-agent-templates.sh" \
        --check size-limits \
        --templates-dir "$REPO_ROOT/setup/agent-templates" \
        --agents-dir "$REPO_ROOT/.claude/agents" >&2; then
      echo "[emit-push-proof] ERROR: agent template size cap exceeded; trim template, rerun QG." >&2
      exit 2
    fi
  fi

  # (C) Record registry digest into artifact_digests (additive; schema_version stays 1).
  #     sha256(skills/registry.json, CRLF->LF). Merged before the proof-write step.
  if [[ -f "$REPO_ROOT/skills/registry.json" ]]; then
    local _reg_digest
    _reg_digest="$(python3 - "$REPO_ROOT/skills/registry.json" << 'PYEOF'
import hashlib, sys
content = open(sys.argv[1], 'rb').read().replace(b'\r\n', b'\n')
print(hashlib.sha256(content).hexdigest())
PYEOF
)"
    artifact_digests_json="$(python3 -c "
import json, sys
d = json.loads(sys.argv[1])
d['skills/registry.json'] = sys.argv[2]
print(json.dumps(d))
" "$artifact_digests_json" "$_reg_digest")"
  fi

  # -- 5. Compute report_digest (sha256 of report file, CRLF->LF) ---------------
  local report_digest
  report_digest="$(python3 - "$REPORT_PATH" << 'PYEOF'
import hashlib, sys
content = open(sys.argv[1], 'rb').read().replace(b'\r\n', b'\n')
print(hashlib.sha256(content).hexdigest())
PYEOF
)"

  # -- 6. Collect steps_executed (required steps) --------------------------------
  local steps_executed_json
  steps_executed_json="$(python3 - "$MANIFEST_PATH" "$REPORT_PATH" << 'PYEOF'
import json, sys
manifest = json.load(open(sys.argv[1], encoding='utf-8'))
report   = json.load(open(sys.argv[2], encoding='utf-8'))
steps    = {s['step']: s for s in (report.get('steps') or []) if 'step' in s}
executed = []
for rs in manifest.get('required_steps', []):
    sid   = rs['id']
    entry = steps.get(sid, {})
    executed.append({"step": sid, "result": entry.get("result", ""), "ran": bool(entry.get("ran"))})
print(json.dumps(executed))
PYEOF
)"

  # -- 7. Timestamps + identifiers -----------------------------------------------
  local now_ts worktree_id manifest_version
  now_ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  worktree_id="$(resolve_worktree_id "$REPO_ROOT")"
  manifest_version="$(python3 - "$MANIFEST_PATH" << 'PYEOF'
import json, sys
print(json.load(open(sys.argv[1], encoding='utf-8'))['manifest_version'])
PYEOF
)"

  # -- 8. Write backward-compat stamps ------------------------------------------
  mkdir -p "$ACDOC_DIR"

  local branch_name
  branch_name="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "UNKNOWN")"

  printf '{"verdict":"PASS","timestamp":"%s","head":"%s","branch":"%s","source":"emit-push-proof.sh run-qg"}\n' \
    "$now_ts" "$head_sha" "$branch_name" > "$QG_STAMP_PATH"

  printf '{"verdict":"PASS","timestamp":"%s","head":"%s","branch":"%s","source":"emit-push-proof.sh run-qg"}\n' \
    "$now_ts" "$head_sha" "$branch_name" > "$PP_STAMP_PATH"

  # -- 9. Write push-proof.json (includes artifact_digests from step 4, and
  #       bats_evidence from step 3b -- additive; schema_version stays 1) ---------
  python3 - "$PROOF_PATH" "$now_ts" "$head_sha" "$worktree_id" \
      "$manifest_version" "$report_digest" "$wave_slug" "$steps_executed_json" \
      "$artifact_digests_json" "$bats_evidence_json" << 'PYEOF'
import json, sys

proof_path        = sys.argv[1]
now_ts            = sys.argv[2]
head_sha          = sys.argv[3]
worktree_id       = sys.argv[4]
manifest_version  = int(sys.argv[5])
report_digest     = sys.argv[6]
wave_slug         = sys.argv[7]
steps_executed    = json.loads(sys.argv[8])
artifact_digests  = json.loads(sys.argv[9])

try:
    _ev = json.loads(sys.argv[10])
except Exception:
    _ev = {}
# Exactly {run_id, head, ok, not_ok, expected, scope, generated_at} -- no filesystem
# paths (bats-handoff.sh's CLI never emits one). status/complete/total are the CLI's
# own selection metadata and are intentionally NOT persisted into the proof.
bats_evidence = {
    "run_id":       _ev.get("run_id", ""),
    "head":         _ev.get("head", ""),
    "ok":           _ev.get("ok", 0),
    "not_ok":       _ev.get("not_ok", 0),
    "expected":     _ev.get("expected", 0),
    "scope":        _ev.get("scope", ""),
    "generated_at": _ev.get("generated_at", ""),
}

proof = {
    "schema_version":    1,
    "head":              head_sha,
    "worktree_id":       worktree_id,
    "generated_at":      now_ts,
    "wave_slug":         wave_slug,
    "manifest_version":  manifest_version,
    "steps_executed":    steps_executed,
    "report_digest":     report_digest,
    "artifact_digests":  artifact_digests,
    "bats_evidence":     bats_evidence,
}

with open(proof_path, 'w', encoding='utf-8') as f:
    json.dump(proof, f, indent=2)
    f.write('\n')
PYEOF

  # -- 10. Append to push-proof.log (fail-OPEN) ----------------------------------
  {
    printf '{"ts":"%s","event":"push-proof-emitted","head":"%s","wave_slug":"%s","report_digest":"%s","worktree_id":"%s"}\n' \
      "$now_ts" "$head_sha" "$wave_slug" "$report_digest" "$worktree_id"
  } >> "$PROOF_LOG" 2>/dev/null || true

  # Also emit to audit-log.jsonl via shared helper
  audit_append "$REPO_ROOT" "push-proof-emitted" "pass" \
    "\"head\":\"${head_sha}\",\"wave_slug\":\"${wave_slug}\",\"report_digest\":\"${report_digest}\"" \
    2>/dev/null || true

  echo "[emit-push-proof] run-qg: PASS — proof minted at $PROOF_PATH; stamps written." >&2
  exit 0
}

# ── Subcommand: verify-proof ──────────────────────────────────────────────────

verify_proof() {
  if [[ ! -f "$PROOF_PATH" ]]; then
    echo "[emit-push-proof] ERROR: push-proof.json not found at $PROOF_PATH. Run /quality-gate first." >&2
    exit 2
  fi

  if [[ ! -f "$MANIFEST_PATH" ]]; then
    echo "[emit-push-proof] ERROR: quality-gate-manifest.json not found at $MANIFEST_PATH" >&2
    exit 2
  fi

  if [[ ! -f "$REPORT_PATH" ]]; then
    echo "[emit-push-proof] ERROR: quality-gate-report.json not found at $REPORT_PATH" >&2
    exit 2
  fi

  local worktree_id
  worktree_id="$(resolve_worktree_id "$REPO_ROOT")"

  python3 - "$PROOF_PATH" "$MANIFEST_PATH" "$REPORT_PATH" \
      "$PUSHED_SHA" "$worktree_id" "$MAX_AGE_SECS" "$SKEW_TOLERANCE" << 'PYEOF'
import json, sys, time, calendar, datetime, hashlib

proof_path    = sys.argv[1]
manifest_path = sys.argv[2]
report_path   = sys.argv[3]
pushed_sha    = sys.argv[4]
worktree_id   = sys.argv[5]
max_age       = int(sys.argv[6])
skew_tol      = int(sys.argv[7])

def die(msg):
    print(f"[emit-push-proof] ERROR: {msg}", file=sys.stderr)
    sys.exit(2)

# -- 1. Load proof ----------------------------------------------------------------
try:
    with open(proof_path, encoding='utf-8') as f:
        proof = json.load(f)
except Exception as e:
    die(f"push-proof.json unreadable/malformed: {e}")

# -- 2. Schema version ------------------------------------------------------------
if proof.get('schema_version') != 1:
    die(f"push-proof.json schema_version unknown: {proof.get('schema_version')}")

# -- 3. head == pushed_sha --------------------------------------------------------
if proof.get('head') != pushed_sha:
    die(f"proof head ({proof.get('head')}) != pushed SHA ({pushed_sha})")

# -- 4. worktree_id ---------------------------------------------------------------
if proof.get('worktree_id') != worktree_id:
    die(f"proof worktree_id ({proof.get('worktree_id')}) != current worktree ({worktree_id})")

# -- 5. Freshness (<=1800s, >=-120s skew) ----------------------------------------
ts = proof.get('generated_at') or ''
try:
    epoch = calendar.timegm(time.strptime(ts, "%Y-%m-%dT%H:%M:%SZ"))
except ValueError:
    try:
        epoch = int(datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
    except Exception:
        die(f"push-proof.json generated_at unparseable: '{ts}'")

now = int(time.time())
age = now - epoch
if age < -skew_tol:
    die(f"push-proof.json has future timestamp (skew={-age}s, max allowed={skew_tol}s)")
if age > max_age:
    die(f"push-proof.json stale ({age // 60} min old, max {max_age // 60} min)")

# -- 6. manifest_version match ----------------------------------------------------
with open(manifest_path, encoding='utf-8') as f:
    manifest = json.load(f)
if proof.get('manifest_version') != manifest.get('manifest_version'):
    die(f"manifest_version mismatch: proof={proof.get('manifest_version')} manifest={manifest.get('manifest_version')}")

# -- 7. steps_executed covers all required_steps with PASS -----------------------
executed = {s['step']: s for s in (proof.get('steps_executed') or []) if 'step' in s}
for rs in manifest.get('required_steps', []):
    sid = rs['id']
    if sid not in executed:
        die(f"step-coverage-gap: required step '{sid}' absent from proof steps_executed")
    if executed[sid].get('result') != 'PASS':
        die(f"step-coverage-gap: required step '{sid}' not PASS in proof (result={executed[sid].get('result')})")

# -- 8. report_digest: recompute sha256(report, CRLF->LF) ------------------------
content    = open(report_path, 'rb').read().replace(b'\r\n', b'\n')
recomputed = hashlib.sha256(content).hexdigest()
if recomputed != proof.get('report_digest'):
    die(f"report_digest mismatch: stored={proof.get('report_digest')} recomputed={recomputed} — quality-gate-report.json may have been tampered with post-mint")

# -- 9. bats_evidence binding: present + head matches pushed_sha ------------------
# A half-done Section A4 would mint correctly (run_qg's five named checks) but verify
# permissively -- this closes that gap. This is the design doc's "8th check" (counting
# schema_version..report_digest as checks 1-7; this file's own comment numbering above
# additionally counts "Load proof" as step 1, so this lands as "-- 9." here). Mirrors
# the rigor of the other two verifiers (verify-push-proof.ps1, push-authorization-
# gate.js) -- all three now carry equivalent 8-check rigor.
bats_evidence = proof.get('bats_evidence')
if not bats_evidence:
    die("bats_evidence missing from push-proof.json — proof was minted before this wave's evidence binding, or evidence was stripped. Re-run /quality-gate.")
if bats_evidence.get('head') != pushed_sha:
    die(f"bats_evidence.head ({bats_evidence.get('head')}) != pushed SHA ({pushed_sha}) — proof's test-suite evidence does not correspond to the pushed commit")

print("[emit-push-proof] verify-proof: PASS", file=sys.stderr)
PYEOF

  exit 0
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "$SUBCOMMAND" in
  run-qg)       run_qg ;;
  verify-proof) verify_proof ;;
esac
