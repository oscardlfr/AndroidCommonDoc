---
scope: [agents, quality-gate]
sources: [androidcommondoc]
targets: [all]
slug: quality-gater-freshness-gate
category: agents
description: "quality-gater Step Z — Report Freshness Gate (REQUIRED pre-mint). Runs scripts/sh/lib/qg-report-freshness.sh to verify all step reasons are fresh for the current HEAD and authoritative bats count; blocks the mint (exit 1) on stale reasons. Supports structured carry metadata (carried/source_head/current_head/files) for legitimate byte-identical re-mints."
---

# quality-gater: Report Freshness Gate (Step Z)

Referenced from [quality-gater](../../setup/agent-templates/quality-gater.md) Step Z. **REQUIRED — runs after Step Y (registry integrity), before Step 10 (mint).**

Calls `scripts/sh/lib/qg-report-freshness.sh` to verify that every step reason in `quality-gate-report.json` is coherent with the current git HEAD and the authoritative bats count. If the lib exits non-zero, the template records a FAIL entry and exits 1 — the mint (`emit-push-proof.sh --subcommand run-qg`) is never reached.

---

## Intro + Enforcement Model

### What Step Z does

Step Z reads the accumulated `quality-gate-report.json` and passes it through `qg-report-freshness.sh`. The lib enforces three invariants on every step entry:

- **Invariant A (HEAD coherence):** if a step reason contains a HEAD SHA in a context anchor (e.g. `bats PASS @ HEAD=<sha>`), that SHA must equal the current git HEAD.
- **Invariant B (bats-count coherence):** if a step reason embeds an integer in a bats context (`bats N tests passed`, `bats N/N`), N must equal the authoritative bats count from the run-id handoff.
- **Invariant C (result-semantics):** a step with `result: FAIL` must not embed PASS-semantics in its reason.

### When it runs

```
Step Y: registry-hash check     (existing)
Step Z: report-freshness gate   (NEW — this wave)
Step 10: mint emit-push-proof.sh --subcommand run-qg
Step 11: emit-qg-result.sh final
```

### The exit code is the gate

The lib outputs no content on success (exit 0). On failure it writes one line per violation to stderr:

```
[qg-freshness] FAIL: step=<id> reason=<invariant>
```

**Non-zero exit → the template must NOT proceed to Step 10.** The `report-freshness` record appended to `quality-gate-report.json` is **informational only** — `emit-push-proof.sh`/`quality-gate-manifest.json` are **untouched**. The manifest-based step-coverage check in `emit-push-proof.sh` only enforces steps that ARE in `required_steps[]`; it does not block on additional report steps.

This is the same enforcement model used by Step X (path-manifest-audit): exit 1 from the gate, do not proceed.

### What is NOT changed

- `quality-gate-manifest.json` — NOT touched. Adding a manifest entry is unnecessary and would require regenerating `protocol_digest`.
- `emit-push-proof.sh` — NOT edited. The gate sits ahead of it in the template flow.

---

## Canonical Step Z Bash Block

Run inside the quality-gater's Bash session after Step Y completes.

```bash
REPORT_FILE=".androidcommondoc/quality-gate-report.json"

# Extended append_step_json with optional carry fields (8-arg form).
# See "Carry-aware append_step_json" section below for the full definition.
# Inline because shell functions do not persist across separate Bash calls.
append_step_json() {
  local step="$1" ran="$2" result="$3" reason="$4"
  local carried="${5:-false}" source_head="${6:-}" current_head="${7:-}" files_json="${8:-[]}"
  [[ -f "$REPORT_FILE" ]] || printf '{"steps":[]}\n' > "$REPORT_FILE"
  python3 - "$REPORT_FILE" "$step" "$ran" "$result" "$reason" \
            "$carried" "$source_head" "$current_head" "$files_json" << 'PYEOF'
import json,sys
p,step,ran_s,result,reason,carried_s,src_head,cur_head,files_raw = (
    sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],sys.argv[5],
    sys.argv[6],sys.argv[7],sys.argv[8],sys.argv[9])
with open(p,encoding='utf-8') as f: r=json.load(f)
entry = {'step':step,'ran':ran_s=='true','result':result,'reason':reason}
if carried_s == 'true':
    entry['carried'] = True
    entry['source_head'] = src_head
    entry['current_head'] = cur_head
    try:
        entry['files'] = json.loads(files_raw)
    except Exception:
        entry['files'] = []
r.setdefault('steps',[]).append(entry)
with open(p,'w',encoding='utf-8',newline='\n') as f: json.dump(r,f,indent=2); f.write('\n')
PYEOF
}

# --- Step Z: Report Freshness Gate ---

# 1. Discover authoritative bats count from run-id handoff.
HANDOFF_FILE="$(ls .androidcommondoc/bats-result.*.env 2>/dev/null | sort | tail -1)"
if [[ -z "$HANDOFF_FILE" ]]; then
  echo "[Step Z] report-freshness: FAIL — no bats-result.*.env handoff found." >&2
  append_step_json "report-freshness" "true" "FAIL" \
    "Step Z aborted: no bats-result.*.env handoff file; cannot determine authoritative bats count."
  exit 1
fi
BATS_OK="$(grep '^BATS_OK=' "$HANDOFF_FILE" | cut -d= -f2 | tr -d '[:space:]')"
if [[ -z "$BATS_OK" ]]; then
  echo "[Step Z] report-freshness: FAIL — BATS_OK missing from handoff $HANDOFF_FILE." >&2
  append_step_json "report-freshness" "true" "FAIL" \
    "Step Z aborted: BATS_OK key absent in $HANDOFF_FILE."
  exit 1
fi

# 2. Capture current HEAD.
CURRENT_HEAD="$(git rev-parse HEAD)"

# 3. Run the freshness lib.
freshness_exit=0
freshness_stderr="$(bash "${ANDROID_COMMON_DOC:-$PWD}/scripts/sh/lib/qg-report-freshness.sh" \
    --report  "$REPORT_FILE" \
    --head    "$CURRENT_HEAD" \
    --bats-count "$BATS_OK" \
    --repo-root  "$PWD" 2>&1)" || freshness_exit=$?

# 4. Record result and gate.
if [[ "$freshness_exit" -ne 0 ]]; then
  reason="$(printf '%s' "$freshness_stderr" | tr '\n' ' ' | sed 's/"/\\"/g')"
  append_step_json "report-freshness" "true" "FAIL" \
    "qg-report-freshness.sh exit $freshness_exit — ${reason}"
  echo "[Step Z] report-freshness: FAIL (exit $freshness_exit). Do NOT proceed to Step 10." >&2
  exit 1   # FAIL QG — do not mint push-proof
fi

append_step_json "report-freshness" "true" "PASS" \
  "qg-report-freshness.sh exit 0 — all step reasons coherent with HEAD $CURRENT_HEAD bats=$BATS_OK."
```

- **FAIL QG** (exit 1, do not proceed to Step 10) if the lib exits non-zero — stale HEAD, stale bats count, or PASS-semantics on a FAIL step.
- `append_step_json` is defined inline because shell functions do not persist across separate Bash invocations (same reason as Steps 7.5 and Y).
- The 8-arg form of `append_step_json` is defined here; existing 4-arg call sites in the same session continue to work (args 5–8 default to non-carry values).

---

## Carry-Aware `append_step_json` (Canonical 8-Arg Form)

When a step is legitimately re-minted (byte-identical carry), the agent emits structured carry metadata in the step object. The full 8-arg form of `append_step_json` (defined in the Step Z block above) is the canonical version. The quality-gater template retains the 4-arg form to stay within its 435-line cap; this sub-doc is the authority for the extended version.

The extra args are optional and default to non-carry values; existing call sites that pass only 4 args continue to work unchanged (no backward-compat break).

### Carry Validation

When `carried` is absent or false, the step must pass invariants A/B/C (Leg 2).

When `carried: true` the lib validates the following fields (all four are required):

| Field | Requirement |
|-------|-------------|
| `source_head` | Non-empty string (the HEAD the result was originally produced at) |
| `current_head` | Must equal the current git HEAD passed via `--head` |
| `files` | Non-empty list of repo-relative, git-tracked paths (no abs, no `..`, no globs) |

The lib then runs `git diff --quiet <source_head> <current_head> -- <files...>` to assert byte-identical content. If the diff is non-empty, the carry is rejected.

If all carry fields are valid and files are byte-identical: the step bypasses invariants A/B/C for that entry (continue). If any field is invalid or the diff is non-empty: the lib exits 1 and emits a `[qg-freshness] FAIL:` line.

---

## Carry Metadata JSON Schema

A step that legitimately carries a previous run's result:

```json
{
  "step": "path-manifest-audit",
  "ran": true,
  "result": "PASS",
  "reason": "Carried from prior run: files unchanged between source and current HEAD.",
  "carried": true,
  "source_head": "8f65831abc1234567890abcdef1234567890abcd",
  "current_head": "8f65831abc1234567890abcdef1234567890abcd",
  "files": [
    "scripts/sh/emit-qg-result.sh",
    "scripts/tests/emit-qg-result.bats"
  ]
}
```

When `carried: true` and `source_head == current_head` (same commit), the git diff is empty and the check always passes — a common pattern for same-HEAD re-mints.

### Emitting Carry Metadata from the Template

```bash
# Example: carry a step that only touches two files that are byte-identical
CARRY_FILES='["scripts/sh/emit-qg-result.sh","scripts/tests/emit-qg-result.bats"]'
append_step_json "path-manifest-audit" "true" "PASS" \
  "Carried from prior run: files unchanged between source and current HEAD." \
  "true" "$PRIOR_HEAD" "$CURRENT_HEAD" "$CARRY_FILES"
```

---

## Related Docs

- [quality-gater-hub](quality-gater-hub.md) — hub with all step detail sub-docs
- [quality-gater-registry-integrity](quality-gater-registry-integrity.md) — Step Y (registry integrity) that runs immediately before Step Z
- [quality-gater-doc-validator-parity](quality-gater-doc-validator-parity.md) — Step 7.5 (doc-validator parity)
- [qg-proof-push-gate](qg-proof-push-gate.md) — Step 10 mint (`emit-push-proof.sh run-qg`) that Step Z gates
