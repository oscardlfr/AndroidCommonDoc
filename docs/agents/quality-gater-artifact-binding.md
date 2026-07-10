---
scope: [agents, quality-gate, artifact-binding]
sources: [androidcommondoc]
targets: [all]
slug: quality-gater-artifact-binding
status: active
layer: L0
parent: agents-hub
category: agents
description: "Mint-internal artifact-binding contract (wave qg-artifact-binding): the generic required-step binding loop, the mint_rederived exclusion marker, the derived-artifact (Option B) model for pre-pr/rule-inventory, manifest-evidence-drift, the pre_pr_coverage managed-key contract, and the discovered_rules[] rule_id requirement Step 8 routes here."
---

# quality-gater: Artifact Binding (Mint Internals)

Referenced from [quality-gater](../../setup/agent-templates/quality-gater.md) **Step 8** (Project Rule Cross-Check) for the one gater-facing requirement — authoring `rule_id` on `discovered_rules[]` entries. Everything else on this page documents `emit-push-proof.sh run-qg` internals that no template step invokes directly (Option B, below) — this doc exists so the mechanism is described, not so the gater has more steps to run.

**Problem closed**: before this wave, `quality-gate-manifest.json` declared `pre_pr_coverage` and `discovered_rules` as required content, but `emit-push-proof.sh` only checked their *presence* — never that the content reflected a real `/pre-pr` run or real rule discovery (BACKLOG D5). Two other required steps — `secret-scan` and `doc-validator-parity` — already had real producer scripts, but the mint never opened their reports. This doc covers the fix: a generic binding loop, plus two mint-composed derived artifacts.

---

## Generic Binding Loop

`emit-push-proof.sh run-qg` binds one receipt per qualifying `required_steps[]` entry. The loop runs after verdict→HEAD binding and before committed-tree integrity. A step qualifies iff **all four** hold: `kind == "automatable"`, `artifact` is declared, no `evidence` sub-object is present, and the step is **not** marked `mint_rederived`.

**Loop membership today is exactly `{secret-scan, doc-validator-parity}`** — never by assertion, always mechanically, from each OTHER required step's own marker:

| Step | Why excluded from the loop |
|---|---|
| `test-suite` | carries an `evidence` sub-object — Wave A's bats-evidence checks already cover it |
| `registry-hash` | `mint_rederived: true` — the mint's own post-loop re-run is authoritative (see below) |
| `pre-pr` | `mint_rederived: true` — mint-composed, not gater-measured (see Derived-Artifact Model) |
| `rule-cross-check` | `kind: judgment` — coverage-checked against the rule inventory, not bound here |
| `architect-deliberation` | `kind: judgment` — unchanged verdict-file floor |

For each qualifying step, the mint opens `<repo-root>/<artifact>` and checks, in order:

```
open the artifact                       → die artifact-binding-absent
artifact.head == HEAD                   → die artifact-binding-head
started_at <= generated_at <= now+skew  → die artifact-binding-stale
artifact.status == "PASS"               → die artifact-binding-status
```

Each bound receipt's sha256 (CRLF→LF) is recorded into `push-proof.json`'s `artifact_digests` — additive, same shape as the pre-existing verdict-file digests. The freshness window uses the SAME `report.started_at` floor and skew tolerance as the Wave A bats-evidence checks (see [qg-proof-push-gate](qg-proof-push-gate.md)).

**Envelope prerequisite**: the loop can only bind receipts that carry `head`/`generated_at`/`status`. `secret-scan-report.sh`, `qg-doc-validators.sh`, and `qg-registry-integrity.sh` all additively emit these three fields at every write site (pre-existing fields like `result`, `reason_code`, `tool`, `count` are untouched) — see each producer's own sub-doc ([secret-scan](quality-gater-secret-scan.md), [doc-validator-parity](quality-gater-doc-validator-parity.md), [registry-integrity](quality-gater-registry-integrity.md)) for the per-producer note.

---

## The `mint_rederived` Marker

`mint_rederived: true` on a `required_steps[]` entry means **the mint produces this artifact itself** — either by RE-RUNNING a producer script, or by COMPOSING it internally from other already-bound inputs. Either way the step is not a gater-measured receipt, so the generic binding loop excludes it by name, never by omission.

Two steps carry this marker today, for two different mechanisms:

- **`registry-hash`** — re-run. The mint calls `qg-registry-integrity.sh` against the committed tree (Part 2 of committed-tree integrity — see [qg-proof-push-gate](qg-proof-push-gate.md)), which overwrites `registry-hash-report.json` on every exit path. Binding the pre-re-run receipt and then overwriting it would be ambiguous; binding the post-re-run receipt would be tautological (the mint checking its own output against itself). **Resolution: never bind it — re-derive it.**
- **`pre-pr`** — compose. `emit-pre-pr-report.sh` (mint-internal, see below) writes `pre-pr-report.json` strictly AFTER the loop and the registry re-run. Without the marker, `pre-pr`'s own manifest entry (`kind: automatable`, `artifact` declared, no `evidence`) would independently satisfy all four loop criteria — and since its artifact does not exist yet when the loop runs, every mint would die `artifact-binding-absent` on `pre-pr`. The marker is kept alongside `pre-pr`'s honest `artifact` field: dropping the field would misrepresent `pre-pr` as artifact-less, when it genuinely produces one, just not through this loop.

---

## Derived-Artifact Model (Option B)

Two producers run **mint-internally** — invoked by `emit-push-proof.sh` itself (after the registry re-run and the template-size gate), never by a quality-gater template step, and never pointed to by a new numbered step:

| Script | Writes | Reads |
|---|---|---|
| `emit-pre-pr-report.sh` (NEW) | `.androidcommondoc/pre-pr-report.json` | the two loop-bound receipts, the post-registry-rerun state, `git log base..head` commit subjects |
| `emit-rule-inventory.sh` (NEW) | `.androidcommondoc/rule-inventory.json` | `docs/guides/project-constraints.md` (`^## ` headers), `.commitlintrc.json` (`valid_scopes`) |

Both scripts are standalone-invocable and independently bats-tested, but the **mint** calls them — not the gater. This is why the Step 8 pointer (below) is the only gater-facing surface this mechanism adds: no new required step, no new template pointer for either script (Option B — avoids needing an artifact to exist before the mint that would produce it even runs).

Neither derived artifact is itself freshness-bound — its own `generated_at` is always "now" by construction. What IS bound is its **inputs**: `emit-pre-pr-report.sh` reads receipts the loop already froze to HEAD; `emit-rule-inventory.sh` records a per-source sha256 for every source file it parses, so a source mutated after generation is detectable even though the inventory's own timestamp cannot prove that by itself.

**Fail-closed floor**: `emit-rule-inventory.sh` exits 2 (`rule-inventory-empty-source`) if any source file that *exists* parses to zero rules — a guard that can never fire is worse than none.

---

## `manifest-evidence-drift`

A drift-guard, not a new enforcement source. The mint hardcodes `{require_scope: 'full', max_not_ok: 0, require_complete: True}` in its Wave-A bats-evidence checks — those literals never change at runtime. This check asserts the manifest's OWN declared `required_steps[].test-suite.evidence` sub-object still reads the same three values. If the manifest is edited to claim something looser (e.g. `require_scope: "targeted"`) without the mint's hardcoded logic changing to match, `manifest-evidence-drift` fires — the manifest can never *silently* imply looser enforcement than the mint actually performs. The mint's own hardcoded predicates remain the sole source of enforcement; this check only keeps the manifest's documentation of that intent honest.

---

## `pre_pr_coverage` Managed-Key Contract

The gater's hand-authored `report.pre_pr_coverage` (Step 2, `/pre-pr` output — 12 prose-valued keys, unchanged) is never compared for full equality against the mint's derived `pre-pr-report.json.checks` — the mint cannot reproduce project-judgment keys like `kmp_safety` or `dep_freshness`. Instead:

1. **Managed keys — fixed constant in the mint**: `secret_scan` (→ `secret-scan-report.json.status`), `registry_hash_freshness` (→ post-registry-rerun status: `PASS` iff result is `clean` or `n/a`), `commit_lint` (→ the mint's own `base..HEAD` commit-lint over conventional-commit scopes). Extending this set later is additive.
2. **Presence**: every managed key MUST appear in `pre_pr_coverage` — a missing one dies `pre-pr-coverage-drift`.
3. **Normalization**: each managed value is reduced to its leading status token (`PASS|FAIL|SKIP|N/A`) via one fixed regex, tolerating prose tails (e.g. `"PASS - trufflehog 3.95.8, 0 verified findings"` → `PASS`).
4. **Agreement**: the normalized token MUST equal the mint's derived status for that key, else `pre-pr-coverage-drift`.
5. **Unmanaged keys** (the other 9): pass through unchecked — the gater's to author, untouched by this contract.

---

## `discovered_rules[]` — the `rule_id` Requirement (Gater-Facing)

**The one requirement a quality-gater run must actually act on.** Step 1 (Project Rule Discovery) must author a `rule_id` on every `report.discovered_rules[]` entry. At mint time, the mint diffs `emit-rule-inventory.sh`'s freshly-generated rule ids against `discovered_rules[].rule_id` — every inventory id must be present, or the mint dies `rule-coverage-gap`. `discovered_rules` may be a **superset** of the inventory (project-specific rules with no structured source are fine) but never a subset. PASS/FAIL per rule stays the gater's own judgment — this check enforces *coverage*, not verdicts.

Inventory rule ids today (stable, source-derived — see `emit-rule-inventory.sh`):
- `pc:<slugified-header>` — one per `^## ` header in `docs/guides/project-constraints.md`
- `commitlint:valid-scopes` — one combined rule for `.commitlintrc.json`'s `valid_scopes` array

`rule-cross-check`'s manifest `kind` is `judgment` (not `automatable`) — its old circular `artifact` (`quality-gate-report.json` checking itself) is dropped. Coverage is checked against the independent rule inventory instead, closing the tautology.

---

## Non-Goals (this doc's scope)

- **Not a new gater step.** Nothing here adds a Step N — the derived-artifact producers are mint-internal (Option B).
- **Not push-detection.** This binding contract governs `run-qg`/`verify-proof` logic after a push attempt is already identified; the separate, best-effort `isGitPushCommand` command-string detector is a different, unrelated subsystem (see `BACKLOG.md`'s CRITICAL entry).
- **Not evidence reproducibility.** The loop binds the newest receipt at HEAD; it does not detect that an earlier same-HEAD run of a producer disagreed (tracked separately in `BACKLOG.md`).

---

## Related Docs

- [qg-proof-push-gate](qg-proof-push-gate.md) — the full `run-qg`/`verify-proof` subsystem this loop lives inside; `bats_evidence` 9-key completeness predicate; committed-tree integrity Parts 1-3
- [quality-gater-secret-scan](quality-gater-secret-scan.md) — Step S, one of the two loop members
- [quality-gater-doc-validator-parity](quality-gater-doc-validator-parity.md) — Step 7.5, the other loop member; also owns the `hub_reachability` subcheck this doc's own reachability depends on
- [quality-gater-registry-integrity](quality-gater-registry-integrity.md) — `registry-hash`, excluded via `mint_rederived`
- [quality-gate-protocol](quality-gate-protocol.md) — the sequential Steps 0-11 this mechanism sits underneath
- [quality-gater-hub](quality-gater-hub.md) — hub with all step-detail sub-docs
