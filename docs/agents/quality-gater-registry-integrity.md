---
scope: [agents, quality-gate, registry]
sources: [androidcommondoc]
targets: [all]
slug: quality-gater-registry-integrity
status: active
layer: L0
parent: agents-hub
category: agents
description: "quality-gater committed-tree registry-integrity step — runs qg-registry-integrity.sh (--require-registry when skills/ exists) and emits registry-hash into the QG report honestly, closing the prior rubber-stamp. Part of the qg-committed-integrity wave guarantees."
---

# quality-gater: Registry Integrity (Committed-Tree Step)

Referenced from [quality-gater](../../setup/agent-templates/quality-gater.md) registry-integrity step. **REQUIRED when `skills/` exists — always runs before Step 10.**

Closes the rubber-stamp gap where `quality-gate-manifest.json` declared `registry-hash` as a required step but nothing actually produced `registry-hash-report.json`. This step runs `qg-registry-integrity.sh` against the committed tree, writes the report honestly, and records the result in `quality-gate-report.json`.

---

## What the step runs

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

REGISTRY_FLAGS="--project-root $PWD"
if [[ -d "skills" ]]; then
  REGISTRY_FLAGS="$REGISTRY_FLAGS --require-registry"
fi

if ri_out="$(bash "${ANDROID_COMMON_DOC:-$PWD}/scripts/sh/qg-registry-integrity.sh" \
      $REGISTRY_FLAGS 2>&1)"; then
  # exit 0 = clean or n/a
  ri_result="$(python3 -c "import json,sys; d=json.load(open('.androidcommondoc/registry-hash-report.json')); print(d.get('result','unknown'))" 2>/dev/null || echo "clean")"
  append_step_json "registry-hash" "true" "PASS" \
    "qg-registry-integrity.sh exit 0 — result: ${ri_result}."
else
  ri_exit=$?
  reason="$(printf '%s' "$ri_out" | tail -5 | tr '\n' ' ' | sed 's/"/\\"/g')"
  append_step_json "registry-hash" "true" "FAIL" \
    "qg-registry-integrity.sh exit $ri_exit — ${reason}"
  echo "[registry-integrity] registry-hash: FAIL (exit $ri_exit). QG cannot proceed to Step 10." >&2
  exit 1   # FAIL QG — do not emit push-proof
fi
```

- **FAIL QG** (exit 1, do not proceed to Step 10) if the script exits non-zero (exit 2 = drift).
- Records the 3-state result (`clean` / `drift` / `n/a`) in `quality-gate-report.json` as step `registry-hash` with `ran=true`.
- `append_step_json` is defined inline because shell functions do not persist across separate Bash invocations (same reason as Step 7.5).

---

## The 3-State Result

| Result | When | QG action |
|--------|------|-----------|
| `clean` | `rehash --check` passes + counts match + all `SKILL.md` present | `registry-hash` PASS |
| `drift` | Hash mismatch, count delta, or missing `SKILL.md` | `registry-hash` FAIL → block QG |
| `n/a` | No `skills/registry.json` and `--require-registry` NOT passed | `registry-hash` PASS (minimal/consumer repo) |

---

## `--require-registry` Semantics

When `skills/` exists in the repo, `run-qg` passes `--require-registry` to `qg-registry-integrity.sh`. With this flag:

- Missing `skills/registry.json` → exit 2 (fail-closed), NOT `n/a`.
- The `n/a` escape is reserved for genuinely-minimal repos (no `skills/` directory) or non-L0 consumers that do not pass the flag.

**Why this matters:** without `--require-registry`, deleting `registry.json` would yield a free `n/a` PASS. The flag closes that bypass.

---

## What `qg-registry-integrity.sh` Actually Checks

The script replicates CI's three `skill-registry` job checks against `--project-root`:

1. **Hash drift**: `rehash-registry.sh --check` (CRLF→LF sha256, never write-mode — no mutation).
2. **Count compare**: `skills/` entry count vs `skills/registry.json` `entries[].type` tallies (same exclusions as `l0-ci.yml`).
3. **SKILL.md presence**: every `skills/*/` subdirectory must have a `SKILL.md`.

Writes `.androidcommondoc/registry-hash-report.json` with explicit `result` field (`clean` / `drift` / `n/a`). Exit 0 for clean/n-a, exit 2 for drift. **Never mutates `skills/registry.json`.**

**Envelope note (wave `qg-artifact-binding`, W2):** all four write sites additively emit `head` (`git rev-parse HEAD`) and `generated_at` (UTC ISO-8601); the two early literal-JSON sites (missing registry + required / missing + not-required) gained both fields plus `status`, the two later Python-composed sites (already carrying a `timestamp`) gained `head`/`status`. This report is `registry-hash`'s `mint_rederived` receipt — the mint re-runs this script itself and reads the fresh envelope for `pre-pr-report.json`'s `registry_hash_freshness` check, never the pre-rerun copy. See [quality-gater-artifact-binding](quality-gater-artifact-binding.md).

---

## How It Closes the Rubber-Stamp

Prior to this wave, `quality-gate-manifest.json` listed `registry-hash` as a required step but the step was populated by the quality-gater manually writing `result: PASS` without calling any script. The manifest predicate was satisfied by the step's presence, not by actual registry verification.

After this wave:
- `qg-registry-integrity.sh` is called at mint time (inside `emit-push-proof.sh run_qg()`) as a committed-tree check.
- The quality-gater also calls it earlier (this step) and records the honest result into `quality-gate-report.json`.
- The `report_digest` in `push-proof.json` cryptographically binds this honest report. Post-mint tampering → digest mismatch → push blocked.

---

## Dogfood Proof

The wave proves this invariant on itself:

1. After editing `quality-gater.md`, the template's registry hash changes.
2. `qg-registry-integrity.sh` is called; if `skills/registry.json` was not regenerated coherently, it exits 2.
3. The wave's own `run-qg` blocks until template + regenerated registry are committed together.
4. `run-qg` prints `result: clean` only when the committed tree is coherent.

This is the exact failure mode from the `qg-doc-coverage` near-miss (PR #221): registry regenerated in worktree but NOT committed → the clean-tree assertion blocks mint; stale committed registry → `rehash --check` mismatch blocks mint.

---

## Related Docs

- [qg-proof-push-gate](qg-proof-push-gate.md) — committed-tree integrity block inside `emit-push-proof.sh run_qg()` (Part 1 clean-tree + Part 2 registry-integrity); `push-proof.json` `artifact_digests` extension
- [quality-gater-hub](quality-gater-hub.md) — hub with all step detail sub-docs
- [quality-gater-doc-validator-parity](quality-gater-doc-validator-parity.md) — parallel step: doc-validator parity (Step 7.5)
