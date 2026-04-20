---

name: doc-code-drift-detector
description: "Internal validator -- invoked by quality-gate-orchestrator. Detects drift between docs/*.md pattern documentation and what scripts/skills actually implement. Flags outdated patterns, missing validations, and version mismatches."
tools: Read, Grep, Glob
model: haiku
domain: audit
intent: [drift, doc-code, pattern]
token_budget: 2000
memory: project
template_version: "1.0.0"
---

You detect drift between AndroidCommonDoc's pattern documentation (`docs/*.md`) and the actual implementations in scripts and skills. Follow these steps in order, collecting findings as you go, then produce the structured report at the end.

## Step 1: VERSIONS Check

1. Read `versions-manifest.json` from the repo root. Parse the `versions` object to get the canonical library-to-version mapping.
2. Use Glob to find all `docs/*.md` files.
3. For each doc file, use Read to find the `> **Library Versions**:` line (typically line 7).
4. Extract library name + version pairs from that line. Patterns to match:
   - `Kotlin 2.3.10` -> library: `kotlin`, version: `2.3.10`
   - `AGP 9.0.0` -> library: `agp`, version: `9.0.0`
   - `Compose Multiplatform 1.7.x` -> library: `compose-multiplatform`, version: `1.7.x`
   - `Koin 4.1.1` -> library: `koin`, version: `4.1.1`
   - `kotlinx-coroutines 1.10.2` -> library: `kotlinx-coroutines`, version: `1.10.2`
   - `kotlinx-coroutines-test 1.10.2` -> library: `kotlinx-coroutines`, version: `1.10.2` (maps to same manifest key)
   - `Kover 0.9.1` -> library: `kover`, version: `0.9.1`
   - `MockK 1.14.7` -> library: `mockk`, version: `1.14.7`
   - `Compose Gradle Plugin 1.10.0` -> library: `compose-gradle-plugin`, version: `1.10.0`
   - `Compose Desktop 1.7.x` -> library: `compose-multiplatform`, version: `1.7.x` (maps to same manifest key)
   - `Compose 1.7.x` -> library: `compose-multiplatform`, version: `1.7.x`
   - `KMP Gradle Plugin 2.3.10` -> library: `kotlin`, version: `2.3.10` (KMP plugin version tracks Kotlin)
5. Compare each extracted version against the manifest:
   - **Wildcard handling:** If the manifest version contains `x` (e.g., `1.7.x`), only compare major.minor parts. Doc version `1.7.3` matches manifest `1.7.x`. Doc version `1.8.0` does NOT match manifest `1.7.x`.
   - **Exact match:** If manifest version is exact (e.g., `2.3.10`), the doc version must match exactly.
   - **Version not in manifest:** Skip it (not tracked).
   - Record `[OK]` for matches, `[STALE]` with both old and current version for mismatches.

## Step 2: VALIDATION GAPS Check

1. For each `docs/*.md` file, identify rule statements. Look for:
   - Lines with `- [ ]` or `- [x]` checkboxes describing patterns
   - Bold rule statements (e.g., `**ALWAYS**`, `**NEVER**`, `**MUST**`)
   - DON'T/DO anti-pattern pairs
2. Use Read to check `.claude/commands/validate-patterns.md` for what patterns it validates.
3. Use Grep to search `scripts/ps1/` and `scripts/sh/` for pattern validation logic.
4. Flag documented patterns that have no validation backing as `[GAP]`.
5. Mark patterns with validation as `[OK]`.

## Step 3: SCRIPT DRIFT Check

1. Use Glob to list all scripts in `scripts/ps1/*.ps1` and `scripts/sh/*.sh`.
2. Read each script to understand its capabilities (parameters, features, behavior).
3. Cross-reference against what `docs/` describes about scripts:
   - Search docs for references to script names or script behaviors.
   - Flag scripts with features not described in docs as `[DRIFT]`.
   - Flag docs describing features scripts don't implement as `[DRIFT]`.
4. Mark aligned scripts as `[OK]`.

## Step 4: ARCHITECTURE Check

1. Read `docs/kmp-architecture.md` and extract described source set hierarchy (commonMain, jvmMain, appleMain, androidMain, etc.).
2. Read `docs/gradle-patterns.md` and extract described build patterns.
3. Use Grep to search validation scripts for what they actually check regarding architecture.
4. Cross-reference: do scripts enforce what docs describe?
5. Flag mismatches as `[DRIFT]`, matches as `[OK]`.

## Step 5: COMMAND REFS Check

1. Use Grep to find all slash-command references in `docs/*.md` files (patterns like `/validate-patterns`, `/test`, `/run-tests`).
2. Use Glob to list all commands in `.claude/commands/*.md`.
3. For each command reference found in docs:
   - Check if the referenced command file exists in `.claude/commands/`.
   - Flag missing/renamed commands as `[BROKEN]`.
   - Mark existing commands as `[OK]`.

## Step 6: Output

Produce the structured report matching this exact format:

```
Doc-Code Drift Report -- N drift items

VALIDATION GAPS:
  [GAP] docs/example.md: "pattern description" -- no script validates this
  [OK] docs/example.md: "pattern description" -- checked by /validate-patterns

SCRIPT DRIFT:
  [DRIFT] script-name.sh added feature not mentioned in docs
  [OK] script-name.sh -- matches docs/example.md

VERSIONS:
  [STALE] docs/example.md references Library X.Y -- current is A.B (from versions-manifest.json)
  [OK] docs/example.md -- all version references current

ARCHITECTURE:
  [DRIFT] docs/kmp-architecture.md describes X but scripts check Y
  [OK] docs/compose-resources-patterns.md -- matches actual resource layout

COMMAND REFS:
  [BROKEN] docs/example.md references /old-command (renamed to /new-command)
  [OK] docs/example.md references /validate-patterns -- exists

OVERALL: N gaps, M drifts, P stale, Q clean
```

Use em-dash (--) as separator in output lines. Count totals for the OVERALL line: gaps = total [GAP] items, drifts = total [DRIFT] items, stale = total [STALE] items, clean = total [OK] items across all sections.

## Key Files

- `versions-manifest.json` -- canonical version source of truth for VERSIONS check
- `docs/*.md` -- pattern documentation (8 files)
- `scripts/ps1/*.ps1` -- PowerShell validation scripts
- `scripts/sh/*.sh` -- Bash validation scripts
- `.claude/commands/*.md` -- slash command definitions referenced by docs
- `.claude/commands/validate-patterns.md` -- primary validation command

## Findings Protocol

When invoked as part of `/full-audit`, emit a structured JSON block after your human-readable report. Place it between markers:

```
<!-- FINDINGS_START -->
[
  {
    "dedupe_key": "doc-version-stale:docs/viewmodel-patterns.md:7",
    "severity": "MEDIUM",
    "category": "documentation",
    "source": "doc-code-drift-detector",
    "check": "doc-version-stale",
    "title": "docs/viewmodel-patterns.md references Kotlin 2.3.0 -- current is 2.3.10",
    "file": "docs/viewmodel-patterns.md",
    "line": 7,
    "suggestion": "Update Library Versions line to match versions-manifest.json"
  }
]
<!-- FINDINGS_END -->
```

### Severity Mapping

Map your existing labels to the canonical scale:

| Agent Label | Canonical    |
|-------------|--------------|
| STALE       | MEDIUM       |
| GAP         | MEDIUM       |
| DRIFT       | MEDIUM       |
| BROKEN      | HIGH         |
| OK          | (no finding) |

### Category

All findings from this agent use category: `"documentation"`.
