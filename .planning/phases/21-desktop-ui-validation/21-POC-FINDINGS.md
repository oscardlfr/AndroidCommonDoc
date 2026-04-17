# 21-POC: `printToString()` Schema + Determinism — FINDINGS

**Status:** COMPLETE — schema characterized, parser contract drafted, determinism verified (same-JVM). Cross-OS deferred to 21-04 CI.
**Execution date:** 2026-04-17
**Compose version tested:** Compose Multiplatform (JetBrains) — from DawSync `libs.versions.toml`
**Host:** Windows 11 Pro (Git Bash), JDK 17
**Target module:** DawSync `feature:sessions` (desktopTest)

## TL;DR

`onRoot().printToString(Int.MAX_VALUE)` emits a stable, indented text tree that is **byte-identical across repeated captures in the same JVM** after a single-line `Node #N` normalization. Parser contract for Plan 21-01 is feasible with minimal normalization. Proceed to tool implementation.

## Method

Throwaway test `feature/sessions/src/desktopTest/kotlin/.../Poc21SemanticDumpTest.kt` (117 LOC) — captures 3 `SessionsScreen` states (Success-empty, Loading, Error), each 3x within a single Gradle run, writes to `build/poc21/<state>-run<N>.txt`.

Each capture uses:

```kotlin
runComposeUiTest {
    setContent { DawSyncTheme { SessionsScreen(uiState = ..., ...) } }
    waitForIdle()
    val tree = onRoot().printToString(Int.MAX_VALUE)
    File(outDir, "$name-run${idx + 1}.txt").writeText(tree)
}
```

Reasoning for same-screen-3-states over 3-different-screens: schema determinism and state-driven tree divergence are the POC invariants. Running one module avoids cross-module build cost. Sessions-empty was the memory `feedback_ui_validation_broken.md` bug-class target.

## Schema — Observed Output

Example (Error state, abbreviated):

```
Printing with useUnmergedTree = 'false'
Node #1 at (l=0.0, t=0.0, r=1024.0, b=768.0)px
IsTraversalGroup = 'true'
 |-Node #2 at (l=0.0, t=0.0, r=1024.0, b=768.0)px, Tag: 'sessions_screen'
   ContentDescription = '[Sessions]'
    |-Node #3 at (l=0.0, t=0.0, r=1024.0, b=768.0)px, Tag: 'common_error_state'
       |-Node #5 at (l=441.0, t=344.0, r=584.0, b=364.0)px, Tag: 'common_error_message'
       | Text = '[Failed to load sessions]'
       | Actions = [ClearTextSubstitution, GetTextLayoutResult, SetTextSubstitution, ShowTextSubstitution]
       |-Node #6 at (l=467.0, t=380.0, r=558.0, b=420.0)px, Tag: 'common_retry_button'
         Focused = 'false'
         Role = 'Button'
         Shape = 'RoundedCornerShape(topStart = CornerSize(size = 50.0%), ...)'
         Text = '[Reintentar]'
         Actions = [ClearTextSubstitution, GetTextLayoutResult, OnClick, RequestFocus, ...]
         MergeDescendants = 'true'
```

### Fields emitted

| Field | Format | Stability | Parser role |
|---|---|---|---|
| `Printing with useUnmergedTree = '<bool>'` | header, 1 line | stable | skip (header) |
| `Node #<N>` | integer counter | UNSTABLE across @Test methods | normalize to placeholder |
| `at (l=<f>,t=<f>,r=<f>,b=<f>)px` | bounds in density-independent px | stable within machine; possibly DPI-sensitive cross-machine | retain but not identity-critical |
| `Tag: '<string>'` | testTag | STABLE | **identity key (highest precedence)** |
| `ContentDescription = '[<string>]'` | a11y | stable | identity fallback |
| `Text = '[<string>]'` | visible text | stable (but changes → drift) | identity fallback + drift signal |
| `Role = '<Button\|Checkbox\|Image\|...>'` | semantic role | stable | attribute |
| `Actions = [<list>]` | action list | stable (order-sensitive) | attribute |
| `Focused = '<bool>'`, `Selected = '<bool>'` | state booleans | stable | attribute |
| `IsTraversalGroup = '<bool>'` | a11y grouping | stable | attribute |
| `MergeDescendants = '<bool>'` | compose merging | stable | attribute |
| `Shape = '<repr>'` | may include `@<hashcode>` for some shapes | HASHCODE UNSTABLE cross-JVM | normalize `@[0-9a-f]+` → `@STABLE` |
| `[Heading]` | bare token | stable | attribute |
| `ProgressBarRangeInfo = '...'` | range struct | stable | attribute |
| `HorizontalScrollAxisRange = 'ScrollAxisRange(...)'` | scroll range | stable within-machine; depends on viewport | attribute |

### Hierarchy syntax

- Indent increments of 1 space per depth level.
- Child node prefix: ` |-Node #...`
- Pipe continuation ` |` for sibling separation.
- Parent-child is inferable by line prefix length.

## Determinism Verdict

### Same JVM (3 captures in one Gradle run)

| State | Raw diff (run1↔run2) | After `Node #N` normalization |
|---|---|---|
| Sessions Loading | IDENTICAL | IDENTICAL |
| Sessions Empty-Success | IDENTICAL | IDENTICAL |
| Sessions Error | differs (Node #1 vs Node #9) | IDENTICAL |

Normalization rule: `s/Node #[0-9]+/Node #N/g` is sufficient. Confirmed via `sed + diff` comparison — see `build/poc21/*.norm` artifacts.

### Cross-JVM (theoretical; baseline-commit + later-verify scenario)

Unstable fields that MUST be normalized before diff:
1. `Node #N` — composition-counter-based, differs on every process start
2. `@<hashcode>` suffix in object reprs (observed: `HorizontalScrollableClipShape@c22ad75`) — differs on every JVM

Proposed normalization (parser-side, baseline-side, before comparison):

```typescript
function normalize(raw: string): string {
  return raw
    .replace(/Node #[0-9]+/g, "Node #N")
    .replace(/@[0-9a-f]{5,}/g, "@HASH");
}
```

### Cross-OS (Windows ↔ Linux CI)

**Deferred to 21-04** (CI workflow). Risk mitigations:

- Compose desktop rendering is pure JVM (Skia backend); no adb/native-bridge layer.
- We use `Tag:` as identity first, `ContentDescription` / `Text` as fallbacks — all font-agnostic.
- Bounds (`l,t,r,b`) could vary by DPI/font metrics but are NOT used as identity.
- If discovered drift on 21-04 ubuntu runner: extend normalizer to bucket-round coordinates, OR omit coords from diff target.

## `SemanticNode` Parser Contract

Proposed TS type for `mcp-server/src/tools/compose-semantic-diff.ts`:

```typescript
export interface SemanticNode {
  /** Ordinal within tree, not the raw Node #N (which is normalized away). */
  depth: number;
  /** Pixel bounds from `(l,t,r,b)px`. Optional because a bare node line has only Node #N + bounds. */
  bounds?: { l: number; t: number; r: number; b: number };
  /** Content of `Tag: '...'` — primary identity. */
  testTag?: string;
  /** Content of `ContentDescription = '[...]'` — unwrapped. */
  contentDescription?: string;
  /** Content of `Text = '[...]'`. */
  text?: string;
  /** Content of `Role = '...'`. */
  role?: string;
  /** Content of `Actions = [...]`. */
  actions: string[];
  /** Any remaining attributes, keyed by the raw attribute name. */
  extras: Record<string, string>;
  /** Children in tree order. */
  children: SemanticNode[];
}
```

## Element Identity (mirrors android-layout-diff)

Precedence: `testTag > contentDescription > text > "<role>@<depth-index>"`. Collision risk low because testTags in DawSync follow `DawSyncTestTags.Sessions.SCREEN` pattern with domain-scoped names.

Dedupe key prefix: `compose-semantic-diff:<category>:<identity>`. No collision with `android-layout-diff:<category>:<identity>` prefix.

## Exit Criteria Check

1. ✅ `printToString()` captured for ≥3 DawSync desktop screens (states) — see artifacts.
2. ✅ 3 consecutive runs produce identical output after trivial `Node #N` normalization.
3. ✅ `SemanticNode` parser contract drafted.
4. ✅ Parser IS required — text-diff-only is a non-starter because of `Node #N` churn and future `@hashcode` noise on cross-JVM; structured diff also enables severity heuristics.
5. ⚠️ Linux/Windows variance — **deferred to 21-04** (CI ubuntu runner will exercise this). Documented mitigations above.

## Residual Risks (for 21-01 implementer)

1. **Bounds sensitivity to DPI/font**: If ubuntu CI produces different `l,t,r,b`, the parser can still diff by identity (testTag/text) without bounds. Bounds become informational, not identity-critical.
2. **`@hashcode` in Shape reprs**: normalizer handles this. One line observed in empty state — may be more in other screens. Tests should cover a fixture with ≥2 distinct `@hashcode` patterns.
3. **Compose upgrade churn**: `printToString()` format is not a stable public contract. If Compose changes the output, the parser breaks. Mitigation: pin compose-multiplatform version in `libs.versions.toml`, include a parser fixture test that will fail loudly on format change.
4. **testTag dedupe across multiple instances**: if two `Card`s share a tag (e.g., in a list), identity collides. Not observed in POC; parser should include depth-index as tiebreaker.

## Open Follow-ups (not blocking 21-01)

1. Re-measure on Linux after CI workflow exists (21-04).
2. Measure a baseline containing a RecyclerView/LazyColumn with identical-tag items — confirm depth-index tiebreaker works.
3. Consider whether to include `Shape` in diff at all — verbose, largely decorative, and often has `@hashcode`. Candidate for default-omit.

## Artifacts

Under `DawSync/feature/sessions/build/poc21/` (ephemeral, not committed):

- `sessions-empty-run{1,2,3}.txt` — 9.9K each
- `sessions-loading-run{1,2,3}.txt` — 548B each
- `sessions-error-run{1,2,3}.txt` — 1.0K each
- `*.norm` files — post-`sed` normalization checks

**POC test file** `DawSync/feature/sessions/src/desktopTest/kotlin/com/dawsync/feature/sessions/Poc21SemanticDumpTest.kt` — slated for deletion after 21-POC commit to keep DawSync working tree clean. Baseline fixtures for 21-01 tests are extracted into the L0 repo (below).

## Fixtures for Plan 21-01 tests

Verbatim captures will be distilled into TS fixtures at `mcp-server/tests/unit/tools/compose-semantic-diff.test.ts` during 21-01. Key artifacts to retain:

- Minimal valid tree (loading state, 548B) — base parser test
- Mid-complexity tree (error state, 1.0K) — diff + findings test
- Full tree (empty state, 9.9K) — normalization + depth-nesting test

## Exit Decision

**PROCEED to Plan 21-01** — implement `compose-semantic-diff.ts` MCP tool + CLI wrappers. Parser design is clear, normalization is minimal (2 regex), and schema is documented enough to write unit tests before running against a live baseline.
