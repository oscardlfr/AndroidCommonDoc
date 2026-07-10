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

Replicates the CI doc-validators locally so **local-QG-green implies CI-green for docs** (closes the PR #220 gap) — full parity holds in **toolkit mode** (with `mcp-server/` resolvable); in a consumer project without it, `doc_structure_vitest` degrades to SKIP (only `cross_refs` runs), as noted below. Runs the shared wrapper `scripts/sh/qg-doc-validators.sh` **toolkit-root-aware** (no hardcoded `cd mcp-server`, so the deployed template also works in consumer projects without a local `mcp-server/`). The wrapper runs **three subchecks** — `cross_refs` (drift-audit `doc-cross-refs` parity: `docs/agents/*.md` relative links + `docs/*/*.md` frontmatter `scope/sources/targets/slug`), `doc_structure_vitest` (the REAL `validate-doc-structure` via `npx vitest run tests/integration/doc-structure.test.ts`), and `hub_reachability` (wave `qg-artifact-binding`, W10 — every `docs/agents/*.md` must be reachable from `agents-hub.md` by following relative markdown links transitively; scoped to `docs/agents/` only, repo-wide reachability is out of scope) — and writes the combined `.androidcommondoc/doc-validator-report.json`. Enforced as the `doc-validator-parity` entry in `quality-gate-manifest.json` `required_steps[]`.

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
- The combined `.androidcommondoc/doc-validator-report.json` carries three subchecks (`cross_refs`, `doc_structure_vitest`, `hub_reachability`) each with `status`/`head`/`command`/`summary`; the top level additionally carries `status`/`head`/`generated_at` (wave `qg-artifact-binding` W2 — the envelope the mint's generic binding loop needs to HEAD/freshness-bind this receipt). See [quality-gater-artifact-binding](quality-gater-artifact-binding.md).
- In a consumer project without a resolvable `<toolkit-root>/mcp-server`, `doc_structure_vitest` degrades to SKIP (the wrapper does not fail on a missing toolkit); `cross_refs` still runs.
- `append_step_json` is defined inline here because shell functions do not persist across the quality-gater's separate Bash invocations (the same reason Step X redefines it).
- **Negative-parity-proof cleanup (REQUIRED):** the negative parity proof intentionally runs the wrapper on a scratch bad-doc, which writes `doc-validator-report.json` with `result: FAIL`. After the scratch is reverted, you MUST RE-RUN this step on the clean tree so `.androidcommondoc/doc-validator-report.json` shows top-level `result: PASS` (both subchecks PASS) at the final HEAD. The minted push-proof's required-step artifact, `quality-gate-report.json`, and the stamps MUST all agree on PASS at the same HEAD — a `FAIL` artifact left behind by the proof is a blocking inconsistency.
