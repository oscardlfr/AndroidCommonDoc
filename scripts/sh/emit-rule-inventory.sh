#!/usr/bin/env bash
# emit-rule-inventory.sh — QG mint-internal derived-artifact producer (wave
# qg-artifact-binding, W5).
#
# Enumerates project rules from fixed, STRUCTURED sources only (never a
# prose-scrape of CLAUDE.md, which would yield ~1 rule — a guard that could
# never fire) and emits a fresh, HEAD-bound, per-source-sha256-pinned inventory.
# Consumed by the mint's rule-coverage-gap check (emit-push-proof.sh), which
# diffs this inventory's rule ids against the quality-gater's own
# report.discovered_rules[].
#
# Sources (structured, not prose):
#   - docs/guides/project-constraints.md  — one rule per "^## " header
#   - .commitlintrc.json                  — one rule for the valid_scopes set
#
# A source that is simply ABSENT is skipped (not fatal — an L1/L2 consumer may
# lack one). A source that EXISTS but parses to zero rules is fatal
# (rule-inventory-empty-source) — a guard that can never fire is worse than none.
#
# Mint-internal (Option B, same model as emit-pre-pr-report.sh): the mint invokes
# this script itself, after the registry re-run / template-size gate. Generated
# from sources the mint HEAD-binds and sha256-records at generation time, so the
# artifact is fresh by construction — its own generated_at is always "now" and is
# NOT itself freshness-bound. Only its declared INPUTS are provenance-pinned (via
# per-source sha256), which is what regression R13 (source-content mutation must
# be detected) actually checks.
#
# Usage:
#   emit-rule-inventory.sh [--project-root <path>]
#
# Output: <project-root>/.androidcommondoc/rule-inventory.json
#   {"head":"<sha>","generated_at":"<iso>",
#    "sources":[{"path":...,"count":...,"sha256":...}, ...],
#    "rules":[{"id":...,"source":...}, ...]}
#
# Exit codes:
#   0  inventory emitted (zero or more sources present, all non-empty)
#   1  usage / argument error
#   2  rule-inventory-empty-source — a source file EXISTS but parses to zero rules

set -euo pipefail

PROJECT_ROOT="${PWD}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"; shift 2 ;;
        --help|-h)
            sed -n '2,/^$/p' "$0"
            exit 0 ;;
        *)
            echo "[emit-rule-inventory] ERROR: unknown argument: $1" >&2
            exit 1 ;;
    esac
done

REPORT_DIR="${PROJECT_ROOT}/.androidcommondoc"
mkdir -p "$REPORT_DIR"
REPORT_FILE="${REPORT_DIR}/rule-inventory.json"

HEAD_SHA="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"
GENERATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

python3 - "$PROJECT_ROOT" "$REPORT_FILE" "$HEAD_SHA" "$GENERATED_AT" << 'PYEOF'
import hashlib, json, os, re, sys

project_root, report_file, head_sha, generated_at = sys.argv[1:5]


def die(msg):
    print(f"[emit-rule-inventory] ERROR: rule-inventory-empty-source: {msg}", file=sys.stderr)
    sys.exit(2)


def sha256_of(path):
    raw = open(path, 'rb').read().replace(b'\r\n', b'\n')
    return hashlib.sha256(raw).hexdigest()


def slugify(text):
    s = text.strip().lower()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')


sources = []
rules = []

# ── Source 1: docs/guides/project-constraints.md — one rule per "^## " header ──
pc_rel = 'docs/guides/project-constraints.md'
pc_path = os.path.join(project_root, pc_rel)
if os.path.isfile(pc_path):
    with open(pc_path, encoding='utf-8') as f:
        pc_text = f.read()
    headers = [m.group(1).strip() for m in re.finditer(r'^## (.+)$', pc_text, re.MULTILINE)]
    pc_count = len(headers)
    if pc_count == 0:
        die(f"{pc_rel} exists but contains zero '## ' headers")
    sources.append({"path": pc_rel, "count": pc_count, "sha256": sha256_of(pc_path)})
    for h in headers:
        rules.append({"id": f"pc:{slugify(h)}", "source": pc_rel})

# ── Source 2: .commitlintrc.json — valid_scopes, one combined rule ──────────────
cl_rel = '.commitlintrc.json'
cl_path = os.path.join(project_root, cl_rel)
if os.path.isfile(cl_path):
    with open(cl_path, encoding='utf-8') as f:
        cl = json.load(f)
    # Prefer this repo's convention (top-level 'valid_scopes'); fall back to the
    # standard commitlint scope-enum rule shape for other consumers.
    valid_scopes = cl.get('valid_scopes')
    if valid_scopes is None:
        try:
            valid_scopes = cl['rules']['scope-enum'][2]
        except Exception:
            valid_scopes = []
    cl_count = len(valid_scopes)
    if cl_count == 0:
        die(f"{cl_rel} exists but valid_scopes parses to zero entries")
    sources.append({"path": cl_rel, "count": cl_count, "sha256": sha256_of(cl_path)})
    rules.append({"id": "commitlint:valid-scopes", "source": cl_rel})

inventory = {
    "head": head_sha,
    "generated_at": generated_at,
    "sources": sources,
    "rules": rules,
}

with open(report_file, 'w', encoding='utf-8') as f:
    json.dump(inventory, f, indent=2)
    f.write('\n')

print(
    f"[emit-rule-inventory] wrote {len(rules)} rule(s) from {len(sources)} source(s) to {report_file}",
    file=sys.stderr,
)
PYEOF
