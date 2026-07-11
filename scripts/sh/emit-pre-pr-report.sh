#!/usr/bin/env bash
# emit-pre-pr-report.sh — QG mint-internal derived-artifact producer (wave
# qg-artifact-binding, W3).
#
# Composes pre-pr-report.json from already-bound/authoritative inputs — never
# re-runs anything heavy (no trufflehog, no vitest). Freshness is INHERITED from
# the two W1-bound receipts and the mint's own post-registry-rerun state; this
# script's own generated_at is always "now" (Option B — derived artifact, not a
# separately freshness-bound one; see docs/agents/quality-gater-artifact-binding.md).
#
# Reads:
#   - .androidcommondoc/secret-scan-report.json    (W1-bound receipt)  -> secret_scan
#   - .androidcommondoc/doc-validator-report.json   (W1-bound receipt)  -> digested only
#   - .androidcommondoc/registry-hash-report.json   (mint_rederived — MUST be read
#     AFTER the mint's own registry re-run, never before) -> registry_hash_freshness
#   - `git log <base>..<head>` commit subjects, scope-checked against
#     .commitlintrc.json's valid_scopes                                -> commit_lint
#
# Managed-key contract (W4, binding, fixed constant — extending later is
# additive): secret_scan, registry_hash_freshness, commit_lint are the ONLY keys
# the mint's pre_pr_coverage cross-check reads from this artifact's "checks"
# object. Any OTHER key the gater's own hand-authored /pre-pr output carries is
# untouched by this script and by that cross-check.
#
# Usage:
#   emit-pre-pr-report.sh [--project-root <path>] [--base-sha <sha>] [--head-sha <sha>]
#
# --base-sha/--head-sha are optional. If omitted, this script recomputes them
# with the SAME fallback chain emit-push-proof.sh uses (merge-base HEAD
# origin/develop -> merge-base HEAD develop -> HEAD~1 -> HEAD), so it stays
# standalone-invocable/testable without depending on the mint's internal state.
# The mint itself passes both explicitly (already computed once, earlier in
# run_qg) so the two computations never disagree.
#
# Output: <project-root>/.androidcommondoc/pre-pr-report.json
#   {"step":"pre-pr","head":"<sha>","generated_at":"<iso>","status":"PASS|FAIL",
#    "checks":{"secret_scan":...,"registry_hash_freshness":...,"commit_lint":...},
#    "evidence_digests":{"<relative-path>":"<sha256>", ...}}
#
# Exit codes:
#   0  report written (regardless of internal PASS/FAIL — this script REPORTS,
#      it does not gate; the mint's own pre_pr_coverage cross-check gates)
#   1  usage / argument error

set -euo pipefail

PROJECT_ROOT="${PWD}"
BASE_SHA=""
HEAD_SHA_ARG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"; shift 2 ;;
        --base-sha)
            BASE_SHA="$2"; shift 2 ;;
        --head-sha)
            HEAD_SHA_ARG="$2"; shift 2 ;;
        --help|-h)
            sed -n '2,/^$/p' "$0"
            exit 0 ;;
        *)
            echo "[emit-pre-pr-report] ERROR: unknown argument: $1" >&2
            exit 1 ;;
    esac
done

REPORT_DIR="${PROJECT_ROOT}/.androidcommondoc"
mkdir -p "$REPORT_DIR"
REPORT_FILE="${REPORT_DIR}/pre-pr-report.json"

HEAD_SHA="${HEAD_SHA_ARG:-$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")}"
if [[ -z "$BASE_SHA" ]]; then
  BASE_SHA="$(git -C "$PROJECT_ROOT" merge-base HEAD origin/develop 2>/dev/null \
              || git -C "$PROJECT_ROOT" merge-base HEAD develop 2>/dev/null \
              || git -C "$PROJECT_ROOT" rev-parse HEAD~1 2>/dev/null \
              || echo "$HEAD_SHA")"
fi
GENERATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ── commit-lint over base..head ───────────────────────────────────────────────
# A conventional-commit scope, if present, must be one of .commitlintrc.json's
# valid_scopes. No commits in range, or a subject with no scope at all, is not a
# violation (nothing to check).
COMMIT_SUBJECTS="$(git -C "$PROJECT_ROOT" log --format=%s "${BASE_SHA}..${HEAD_SHA}" 2>/dev/null || echo "")"

python3 - "$PROJECT_ROOT" "$REPORT_FILE" "$HEAD_SHA" "$GENERATED_AT" "$COMMIT_SUBJECTS" << 'PYEOF'
import hashlib, json, os, re, sys

project_root, report_file, head_sha, generated_at, commit_subjects = sys.argv[1:6]


def sha256_of(path):
    raw = open(path, 'rb').read().replace(b'\r\n', b'\n')
    return hashlib.sha256(raw).hexdigest()


def read_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


evidence_digests = {}
checks = {}

# ── secret_scan (W1-bound receipt) ───────────────────────────────────────────
ss_rel = '.androidcommondoc/secret-scan-report.json'
ss_path = os.path.join(project_root, ss_rel)
ss = read_json(ss_path)
if ss is not None:
    evidence_digests[ss_rel] = sha256_of(ss_path)
checks['secret_scan'] = (ss or {}).get('status', 'FAIL')

# ── doc-validator receipt: digested for provenance, not itself a managed key ──
dv_rel = '.androidcommondoc/doc-validator-report.json'
dv_path = os.path.join(project_root, dv_rel)
dv = read_json(dv_path)
if dv is not None:
    evidence_digests[dv_rel] = sha256_of(dv_path)

# ── registry_hash_freshness (mint_rederived; MUST be read post-registry-rerun) ─
rh_rel = '.androidcommondoc/registry-hash-report.json'
rh_path = os.path.join(project_root, rh_rel)
rh = read_json(rh_path)
if rh is not None:
    evidence_digests[rh_rel] = sha256_of(rh_path)
_rh_result = (rh or {}).get('result')
checks['registry_hash_freshness'] = 'PASS' if _rh_result in ('clean', 'n/a') else 'FAIL'

# ── commit_lint: replicates scripts/sh/commit-msg-hook.sh's canonical
#    semantics (the authoritative local validator) instead of scope-only
#    matching. For each commit subject in base..head, a violation is:
#      (a) the subject does NOT match Conventional Commits format --
#          type(scope)?!?: description, type restricted to the fixed enum
#          below (mirrors commit-msg-hook.sh's CC_PATTERN). This catches an
#          invalid type (e.g. "wip(core): ..."), a non-conventional subject,
#          or a malformed "type(scope)!:"; OR
#      (b) a scope IS present and neither the full scope nor its first
#          segment (compound scopes like "core-error-sdk" -> "core",
#          mirroring commit-msg-hook.sh + commit-scope-validation-gate.js)
#          is in valid_scopes -- only enforced when valid_scopes is
#          non-empty; empty/absent valid_scopes accepts any scope (matches
#          reusable-commit-lint.yml's "empty = any scope accepted"), but
#          format is STILL enforced in that case.
#    Merge commit first lines are exempt (mirrors commit-msg-hook.sh's
#    fast-pass). No commits in range -> PASS (nothing to check).
cl_path = os.path.join(project_root, '.commitlintrc.json')
valid_scopes = []
cl = read_json(cl_path)
if cl is not None:
    valid_scopes = cl.get('valid_scopes')
    if valid_scopes is None:
        try:
            valid_scopes = cl['rules']['scope-enum'][2]
        except Exception:
            valid_scopes = []

CC_PATTERN = re.compile(
    r'^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(([^)]+)\))?!?: .+'
)
violations = []
for subject in commit_subjects.splitlines():
    subject = subject.strip()
    if not subject:
        continue
    if subject.startswith('Merge '):
        continue  # merge commit fast-pass -- mirrors commit-msg-hook.sh
    m = CC_PATTERN.match(subject)
    if not m:
        violations.append(subject)  # invalid type / non-conventional format
        continue
    scope = m.group(3)
    if not scope:
        continue  # no scope present -- nothing further to validate
    first_segment = scope.split('-', 1)[0]
    if valid_scopes and scope not in valid_scopes and first_segment not in valid_scopes:
        violations.append(subject)
checks['commit_lint'] = 'FAIL' if violations else 'PASS'

overall_status = 'PASS' if all(v == 'PASS' for v in checks.values()) else 'FAIL'

report = {
    "step": "pre-pr",
    "head": head_sha,
    "generated_at": generated_at,
    "status": overall_status,
    "checks": checks,
    "evidence_digests": evidence_digests,
}
if violations:
    report["commit_lint_violations"] = violations

with open(report_file, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2)
    f.write('\n')

print(f"[emit-pre-pr-report] wrote {report_file} (status={overall_status})", file=sys.stderr)
PYEOF
