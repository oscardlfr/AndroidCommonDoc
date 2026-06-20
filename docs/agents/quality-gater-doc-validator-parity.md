---
scope: [agents, quality-gate]
sources: [androidcommondoc]
targets: [all]
slug: quality-gater-doc-validator-parity
category: agents
description: "quality-gater Step 7.5 — Doc-Validator Parity (REQUIRED). Runs scripts/sh/qg-doc-validators.sh (cross_refs + doc_structure_vitest) toolkit-root-aware and emits doc-validator-parity into the QG report; replicates the CI doc-validators locally so local-QG-green implies CI-green for docs."
---

# quality-gater: Doc-Validator Parity (Step 7.5)

Referenced from [quality-gater](../../setup/agent-templates/quality-gater.md) Step 7.5. **REQUIRED — always runs.**

Replicates the EXACT CI doc-validators locally so **local-QG-green implies CI-green for docs** (closes the PR #220 gap). Runs the shared wrapper `scripts/sh/qg-doc-validators.sh` **toolkit-root-aware** (no hardcoded `cd mcp-server`, so the deployed template also works in consumer projects without a local `mcp-server/`). The wrapper runs BOTH subchecks — `cross_refs` (drift-audit `doc-cross-refs` parity: `docs/agents/*.md` relative links + `docs/*/*.md` frontmatter `scope/sources/targets/slug`) and `doc_structure_vitest` (the REAL `validate-doc-structure` via `npx vitest run tests/integration/doc-structure.test.ts`) — and writes the combined `.androidcommondoc/doc-validator-report.json`. Enforced as the `doc-validator-parity` entry in `quality-gate-manifest.json` `required_steps[]`.

```bash
REPORT_FILE=".androidcommondoc/quality-gate-report.json"
append_step_json() {
  local step="$1" ran="$2" result="$3" reason="$4"
  [[ -f "$REPORT_FILE" ]] || echo '{"steps":[]}' > "$REPORT_FILE"
  python3 - "$REPORT_FILE" "$step" "$ran" "$result" "$reason" << 'PYEOF'
import json,sys
p,step,ran_s,result,reason=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],sys.argv[5]
with open(p,encoding='utf-8') as f: r=json.load(f)
r.setdefault('steps',[]).append({'step':step,'ran':ran_s=='true','result':result,'reason':reason})
with open(p,'w',encoding='utf-8',newline='\n') as f: json.dump(r,f,indent=2); f.write('\n')
PYEOF
}

if dv_out="$(bash "${ANDROID_COMMON_DOC:-$PWD}/scripts/sh/qg-doc-validators.sh" \
      --project-root "$PWD" \
      --toolkit-root "${ANDROID_COMMON_DOC:-$PWD}" 2>&1)"; then
  append_step_json "doc-validator-parity" "true" "PASS" \
    "qg-doc-validators.sh exit 0 — cross_refs + doc_structure_vitest parity PASS."
else
  dv_exit=$?
  reason="$(printf '%s' "$dv_out" | tail -5 | tr '\n' ' ' | sed 's/"/\\"/g')"
  append_step_json "doc-validator-parity" "true" "FAIL" "qg-doc-validators.sh exit $dv_exit — ${reason}"
  echo "[Step 7.5] doc-validator-parity: FAIL (exit $dv_exit). QG cannot proceed to Step 10." >&2
  exit 1   # FAIL QG — do not emit push-proof
fi
```

- **FAIL QG** (exit 1, do not proceed to Step 10) if the wrapper exits non-zero — a doc frontmatter / size / cross-ref violation, exactly as CI's `doc-cross-refs` + `doc-structure` would fail.
- The combined `.androidcommondoc/doc-validator-report.json` carries both subchecks (`cross_refs`, `doc_structure_vitest`) each with `status/head/command/summary`.
- In a consumer project without a resolvable `<toolkit-root>/mcp-server`, `doc_structure_vitest` degrades to SKIP (the wrapper does not fail on a missing toolkit); `cross_refs` still runs.
- `append_step_json` is defined inline here because shell functions do not persist across the quality-gater's separate Bash invocations (the same reason Step X redefines it).
