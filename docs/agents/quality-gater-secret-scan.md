---
scope: [agents, quality-gate]
sources: [androidcommondoc]
targets: [all]
slug: quality-gater-secret-scan
category: agents
status: active
layer: L0
description: "quality-gater Step S — Secret Scan (REQUIRED pre-mint). Runs scripts/sh/secret-scan-report.sh; absent/erroring scanner = FAIL; never PASS/SKIPPED on absence; blocks the mint (exit 1) on non-PASS. Exit code is the gate; report record is informational."
---

# quality-gater: Secret Scan (Step S)

Referenced from [quality-gater](../../setup/agent-templates/quality-gater.md) Step S. **REQUIRED — runs after Step Z (report freshness), before Step 10 (mint).**

Calls `scripts/sh/secret-scan-report.sh` to perform a real secret scan. If the script exits non-zero, the template records a FAIL entry and exits 1 — the mint (`emit-push-proof.sh --subcommand run-qg`) is never reached.

---

## Intro + Enforcement Model

### What Step S does

Step S invokes the canonical `secret-scan-report.sh` producer, which:

- Runs the configured secret scanner (e.g., TruffleHog).
- Writes `.androidcommondoc/secret-scan-report.json` with fields:
  `status` / `reason_code` / `tool` / `version` / `count`.
- Exits 0 on PASS; exits non-zero on any failure (scan failure, absent/erroring scanner, findings detected).

**Absent or erroring scanner = FAIL, never PASS or SKIPPED.**

### When it runs

```
Step Z: report-freshness gate    (existing)
Step S: secret-scan              (NEW — this wave)
Step 10: mint emit-push-proof.sh --subcommand run-qg
Step 11: emit-qg-result.sh final
```

### The exit code is the gate

The script writes `.androidcommondoc/secret-scan-report.json` on every run. The QG reads only the exit code:

- **Exit 0** → `append_step_json secret-scan true PASS "<reason>"` → proceed to Step 10.
- **Non-zero** → `append_step_json secret-scan true FAIL "<reason>"` → **exit 1; do NOT proceed to Step 10 / mint proof.**

The `secret-scan-report.json` file is **informational only** — `emit-push-proof.sh` and `quality-gate-manifest.json` are **untouched**. The manifest-based step-coverage check in `emit-push-proof.sh` only enforces steps that are in `required_steps[]`; it does not block on additional report steps.

This is the same enforcement model used by Step X (path-manifest-audit) and Step Z (report-freshness): exit 1 from the gate, do not proceed.

### What is NOT changed

- `quality-gate-manifest.json` — NOT touched. Adding a manifest entry is unnecessary and would require regenerating `protocol_digest`.
- `emit-push-proof.sh` — NOT edited. The gate sits ahead of it in the template flow.

### Explicit boundary: `/pre-pr` SKIP is NOT a QG secret-scan PASS

A `/pre-pr` secret-scan result of `SKIPPED` (e.g., from `mcp__androidcommondoc__scan-secrets` when the scanner is absent) does **NOT** satisfy this step. Step S requires `secret-scan-report.sh` to be invoked and exit 0. An absent or erroring scanner causes a non-zero exit from the script → FAIL, never PASS/SKIPPED.

---

### Hardened `/pre-pr` MCP scanner semantics

The MCP `scan-secrets` tool (used by `/pre-pr` Step 5.6) is now fail-closed for the present-but-erroring case:

- **absent scanner** → `status: SKIPPED` (non-blocking INFO; preserved for `/pre-pr` where "I couldn't scan" ≠ "no secrets found")
- **present but erroring** → `status: FAIL` + `reason_code: SCANNER_ERROR` (blocks `/pre-pr`)
- **CRITICAL or HIGH findings detected** → `status: FAIL` + `reason_code: SECRETS_FOUND` (blocks `/pre-pr`)
- **clean scan** → `status: PASS` + `reason_code: OK`

This preserves the intentional semantic split: `/pre-pr` absent → SKIPPED/INFO (non-blocking), while QG Step S (`secret-scan-report.sh`) absent → FAIL (blocking). Both paths now agree: **present-but-erroring = FAIL; findings = FAIL**.

## Canonical Step S Bash Block

Run inside the quality-gater's Bash session after Step Z completes.

```bash
REPORT_FILE=".androidcommondoc/quality-gate-report.json"

# append_step_json — inline because shell functions do not persist across separate Bash calls.
append_step_json() {
  local step="$1" ran="$2" result="$3" reason="$4"
  [[ -f "$REPORT_FILE" ]] || printf '{"steps":[]}\n' > "$REPORT_FILE"
  python3 - "$REPORT_FILE" "$step" "$ran" "$result" "$reason" << 'PYEOF'
import json,sys
p,step,ran_s,result,reason=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],sys.argv[5]
with open(p,encoding='utf-8') as f: r=json.load(f)
r.setdefault('steps',[]).append({'step':step,'ran':ran_s=='true','result':result,'reason':reason})
with open(p,'w',encoding='utf-8',newline='\n') as f: json.dump(r,f,indent=2); f.write('\n')
PYEOF
}

# --- Step S: Secret Scan (REQUIRED — pre-mint) ---

scan_exit=0
bash "${ANDROID_COMMON_DOC:-$PWD}/scripts/sh/secret-scan-report.sh" \
    "${ANDROID_COMMON_DOC:-$PWD}" || scan_exit=$?

# Read structured result from the report file for the reason string.
scan_reason=""
SCAN_REPORT=".androidcommondoc/secret-scan-report.json"
if [[ -f "$SCAN_REPORT" ]]; then
  scan_tool="$(python3 -c "import json,sys; d=json.load(open('$SCAN_REPORT')); print(d.get('tool','unknown'))" 2>/dev/null || echo 'unknown')"
  scan_ver="$(python3 -c "import json,sys; d=json.load(open('$SCAN_REPORT')); print(d.get('version','?'))" 2>/dev/null || echo '?')"
  scan_count="$(python3 -c "import json,sys; d=json.load(open('$SCAN_REPORT')); print(d.get('count',0))" 2>/dev/null || echo '0')"
  scan_reason="scanner=${scan_tool} v${scan_ver}, ${scan_count} verified findings"
else
  scan_reason="secret-scan-report.json absent — scanner failed to produce output"
fi

if [[ "$scan_exit" -ne 0 ]]; then
  append_step_json "secret-scan" "true" "FAIL" \
    "secret-scan-report.sh exit ${scan_exit} — ${scan_reason}"
  echo "[Step S] secret-scan: FAIL (exit ${scan_exit}). Do NOT proceed to Step 10." >&2
  exit 1   # FAIL QG — do not mint push-proof
fi

append_step_json "secret-scan" "true" "PASS" \
  "secret-scan-report.sh exit 0 — ${scan_reason}"
```

- **FAIL QG** (exit 1, do not proceed to Step 10) if `secret-scan-report.sh` exits non-zero.
- `append_step_json` is defined inline because shell functions do not persist across separate Bash invocations (same reason as Steps 7.5, Y, and Z).
- A `/pre-pr` SKIP is NOT a QG secret-scan PASS; the required PASS requires a real scan (absent/erroring scanner = FAIL, never PASS/SKIPPED).

---

## Report Format Row

The Step S result appears in the quality-gater's Report Format step table:

```
| S. Secret Scan | PASS/FAIL | scanner=<tool> v<version>, <count> verified findings; absent/error → FAIL (never SKIPPED) |
```

---

## Related Docs

- [quality-gater-hub](quality-gater-hub.md) — hub with all step detail sub-docs
- [quality-gater-freshness-gate](quality-gater-freshness-gate.md) — Step Z (report freshness) that runs immediately before Step S
- [quality-gater-registry-integrity](quality-gater-registry-integrity.md) — Step Y (registry integrity)
- [quality-gater-doc-validator-parity](quality-gater-doc-validator-parity.md) — Step 7.5 (doc-validator parity)
- [qg-proof-push-gate](qg-proof-push-gate.md) — Step 10 mint (`emit-push-proof.sh run-qg`) that Step S gates
