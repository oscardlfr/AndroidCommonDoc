---
scope: [agents, quality-gate]
sources: [androidcommondoc]
targets: [all]
slug: quality-gater-freshness-gate
category: agents
description: "quality-gater Step Z — Report Freshness Gate (REQUIRED pre-mint). Runs scripts/sh/lib/qg-report-freshness.sh to verify all step reasons are fresh for the current HEAD and authoritative bats count; blocks the mint (exit 1) on stale reasons. Authoritative bats count is discovered via the shared lib/bats-handoff.sh selector (Wave A), not raw filename-sort. Supports structured carry metadata (carried/source_head/current_head/files) for legitimate byte-identical re-mints."
---

# quality-gater: Report Freshness Gate (Step Z)

Referenced from [quality-gater](../../setup/agent-templates/quality-gater.md) Step Z. **REQUIRED — runs after Step Y (registry integrity), before Step 10 (mint).**

Calls `scripts/sh/lib/qg-report-freshness.sh` to verify that every step reason in `quality-gate-report.json` is coherent with the current git HEAD and the authoritative bats count. If the lib exits non-zero, the template records a FAIL entry and exits 1 — the mint (`emit-push-proof.sh --subcommand run-qg`) is never reached.

**Two different "freshness" mechanisms — do not conflate them:**
- **Step Z's own freshness (this doc; unchanged by Wave A):** `qg-report-freshness.sh`'s Invariants A/B/C (below) check whether the TEXT of each step's `reason` field is still coherent with the current HEAD and bats count.
- **Evidence-selection freshness (NEW, Wave A):** before Step Z's invariants even run, something has to decide WHICH bats handoff file counts as authoritative ground truth in the first place. That selection is now `lib/bats-handoff.sh`'s `select_bats_handoff --since <report.started_at> --require-scope full` call (see "Canonical Step Z Bash Block" below) — a different mechanism, unrelated to `qg-report-freshness.sh`. `emit-push-proof.sh`'s own `report-started-at-*` mint-time check uses the same `--since` anchor independently; see [qg-proof-push-gate](qg-proof-push-gate.md).

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

**Non-zero exit → the template must NOT proceed to Step 10.** The `report-freshness` record appended to `quality-gate-report.json` is **informational only** — it carries no weight in `emit-push-proof.sh`'s manifest-based step-coverage check, which only enforces `required_steps[]`/`conditional_steps[]` membership (see "What is NOT changed" below for the precise manifest boundary, corrected as of Wave A).

This is the same enforcement model used by Step X (path-manifest-audit): exit 1 from the gate, do not proceed.

### What is NOT changed

- `quality-gate-manifest.json`'s `required_steps[]`, `conditional_steps[]`, and `protocol_digest` — NOT touched by this gate. Wave A does add `"report-freshness"` to the manifest's separate `informational_steps` array (see [qg-proof-push-gate](qg-proof-push-gate.md)) solely so `emit-push-proof.sh`'s `unknown-step-id` check recognizes the id when it appears in `quality-gate-report.json`'s `steps[]` — that array is not a `protocol_digest` input and carries no step-coverage weight of its own.
- `emit-push-proof.sh` — NOT edited by this gate. Step Z sits ahead of it in the template flow; `emit-push-proof.sh` never invokes `qg-report-freshness.sh`.

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

# 1. Capture current HEAD (needed by both the evidence lookup below and the freshness lib).
CURRENT_HEAD="$(git rev-parse HEAD)"

# 2. Resolve report.started_at — the QG-session anchor stamped by emit-qg-result.sh --init
#    (Wave A, D6 fix). This is the --since floor for the evidence lookup in step 3; it is
#    a DIFFERENT mechanism than this Step's own freshness invariants in step 4 — see the
#    disambiguation note above.
STARTED_AT="$(python3 -c "
import json, sys
try:
    obj = json.load(open(sys.argv[1], encoding='utf-8'))
    print(obj.get('started_at', ''))
except Exception:
    print('')
" "$REPORT_FILE" 2>/dev/null || true)"

# 3. Discover authoritative bats evidence via the shared selector (Wave A — replaces the
#    old `ls .androidcommondoc/bats-result.*.env | sort | tail -1` filename-sort pick,
#    which took the lexicographically-last file with NO HEAD check and NO scope check,
#    silently accepting a foreign-HEAD or targeted-run handoff as authoritative).
source "${ANDROID_COMMON_DOC:-$PWD}/scripts/sh/lib/bats-handoff.sh"
select_bats_handoff --repo-root "${ANDROID_COMMON_DOC:-$PWD}" --head "$CURRENT_HEAD" \
    --since "$STARTED_AT" --require-scope full

if [[ "$BH_STATUS" != "ok" ]]; then
  echo "[Step Z] report-freshness: FAIL — select_bats_handoff status=$BH_STATUS (need ok; HEAD=$CURRENT_HEAD since=$STARTED_AT scope=full)." >&2
  append_step_json "report-freshness" "true" "FAIL" \
    "Step Z aborted: select_bats_handoff returned status=$BH_STATUS (expected ok) for HEAD=$CURRENT_HEAD since=$STARTED_AT require-scope=full — cannot determine authoritative bats count."
  exit 1
fi
BATS_OK="$BH_OK"

# 4. Run the freshness lib.
freshness_exit=0
freshness_stderr="$(bash "${ANDROID_COMMON_DOC:-$PWD}/scripts/sh/lib/qg-report-freshness.sh" \
    --report  "$REPORT_FILE" \
    --head    "$CURRENT_HEAD" \
    --bats-count "$BATS_OK" \
    --repo-root  "$PWD" 2>&1)" || freshness_exit=$?

# 5. Record result and gate.
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
