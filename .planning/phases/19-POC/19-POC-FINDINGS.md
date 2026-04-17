# 19-POC: `android layout --diff` Schema Reverse Engineering — FINDINGS

**Status:** ✅ COMPLETE — Exit criterion A (parser design confirmed)
**Execution date:** 2026-04-17
**CLI version tested:** 0.7.15222914 (launcher_version 0.7.15222914)
**Device:** R3CT30KAMEH (Samsung, Android)
**Host:** Windows 11 Pro (Git Bash)

## TL;DR

`android layout --diff` returns a stable, parseable JSON document. Schema is:

```typescript
interface LayoutDiff {
  added: LayoutElement[];
  modified: LayoutElement[];
  // No "removed" key observed — may be absent or empty-by-default
}

interface LayoutElement {
  text?: string;                  // visible text
  "content-desc"?: string;        // a11y description
  interactions?: ("clickable" | "focusable" | "scrollable" | "long-clickable")[];
  center: string;                 // format "[x,y]"
  bounds?: string;                // format "[x1,y1][x2,y2]" — not always present
  "resource-id"?: string;         // Android resource ID
  state?: string[];               // e.g. ["selected"]
  key?: number;                   // snapshot/window ID — NOT stable per-element
}
```

Parser for Plan 19-02 is feasible. Proceed to implementation.

## CLI Installation (Windows, no Admin)

Official installer requires Admin (installs to `C:\ProgramData\AndroidCLI`). Tested manual install without elevation:

```bash
# 1. Download binary directly (no install script)
curl.exe --ssl-no-revoke -fsSL \
  https://edgedl.me.gvt1.com/edgedl/android/cli/latest/windows_x86_64/android.exe \
  -o "C:/Users/<USER>/android-cli/android.exe"

# 2. Add to User PATH (no Admin needed)
powershell.exe -NoProfile -Command "
  \$p = [Environment]::GetEnvironmentVariable('Path', 'User');
  [Environment]::SetEnvironmentVariable('Path', \$p + ';C:\Users\<USER>\android-cli', 'User')
"

# 3. Verify
android --version  # → 0.7.15222914

# 4. Initialize (installs android-cli skill to detected agents)
android init
# Installs to:
#   ~/.gemini/antigravity/skills/android-cli
#   ~/.claude/skills/android-cli              ← Claude Code auto-detected
#   ~/.codex/skills/android-cli
#   ~/.cursor/skills/android-cli
#   ~/.gemini/skills/android-cli
#   ~/.copilot/skills/android-cli
#   ~/.config/opencode/skills/android-cli
```

**Corrective note**: Google's docs show `curl ... | bash` which fails on Windows (HN issue). The correct command is `install.cmd` at:
`https://dl.google.com/android/cli/latest/windows_x86_64/install.cmd`

The Google installer script fetches the binary from:
`https://edgedl.me.gvt1.com/edgedl/android/cli/latest/windows_x86_64/android.exe`

## `android layout` — Schema Confirmed

### Baseline capture (`android layout --pretty`)

```bash
android layout --pretty --output=baseline.json
```

Returns a **JSON array** of element objects:

```json
[
  {
    "interactions": ["scrollable"],
    "center": "[540,1174]",
    "bounds": "[0,75][1080,2274]",
    "resource-id": "coordinator",
    "key": 3506402
  },
  {
    "content-desc": "Volver",
    "interactions": ["clickable", "focusable"],
    "center": "[84,188]",
    "key": 3506402
  },
  {
    "text": "Ajustes de USB",
    "interactions": ["focusable"],
    "center": "[380,188]",
    "key": 3506402
  },
  ...
]
```

### Diff capture (`android layout --diff`)

```bash
android layout --diff --pretty --output=diff.json
```

Returns **object with `added` and `modified` arrays**:

```json
{
  "added": [
    {
      "interactions": ["clickable"],
      "center": "[540,1006]",
      "resource-id": "wsCellLayout"
    },
    {
      "content-desc": "Página 1 de 3., Página predeterminada",
      "interactions": ["clickable"],
      "state": ["selected"],
      "center": "[515,1945]"
    }
  ],
  "modified": []
}
```

## Key Stability Analysis

- The `key` field has the **same value** (`3506402`) for ALL elements in a baseline capture — it is a **snapshot/window identifier**, NOT a stable per-element ID.
- Elements should be identified by combinations of: `resource-id` (most stable), `text` / `content-desc` (user-facing but translatable), or `bounds` (positional, unstable across rotations/resolutions).
- **Parser design implication**: deduplication key for layout-diff findings = `resource-id` + `text|content-desc` + `bounds`.

## Error Matrix

| Scenario | CLI behavior | Exit code | Stderr format |
|---|---|---|---|
| No baseline snapshot | Returns full layout as `added` on first `--diff` call | 0 | empty |
| Immediate `--diff` (no state change) | `{"added": [], "modified": []}` | 0 | empty |
| Wrong device serial (`--device=NONEXISTENT`) | Java stack trace: `AdbDeviceFailResponseException: 'device offline'` | ≠0 | multi-line Java exception |
| Device screen off (locked) | Returns lockscreen layout elements (clock, battery, notifications) | 0 | — |
| Multiple devices + no `--device` | `adb.exe: more than one device/emulator` | ≠0 | single-line |
| Offline device | Same as wrong serial (offline = unavailable) | ≠0 | Java exception |

**Parser must handle**:
- JSON output (success path)
- Java stack trace patterns (`Exception:`, `at com.android...`) → convert to structured error
- Simple adb error messages (`adb.exe: more than one device`)
- **UTF-8 handling**: Windows `cmd.exe` mangles non-ASCII (`batería` → `bater�a`). Must read stdout as UTF-8 explicitly or pipe to file.

## `android screen capture --annotate` — Format

Output: PNG file, size ~20-25% larger than non-annotated due to overlay bounding boxes.

```bash
android screen capture --annotate --output=annotated.png
```

- Draws labeled bounding boxes with `#N` labels over clickable elements
- `#N` → (x,y) mapping NOT exposed as side file or stdout
- Use `android screen resolve --screenshot=annotated.png --string="input tap #5"` to translate `#5` → `input tap X Y`
- `#N` IDs are **not stable across captures** (inferred — no evidence they persist)

## `android docs` — Format

### `android docs search <query>`

```
Waiting for index to be ready...
[first run only] Knowledge Base zip not found. Downloading...
[first run only] Downloading Knowledge Base ... ...
[first run only] Index created with 4808 items and committed.
Searching docs for: <query>
1. <Title>
   URL: kb://android/topic/...
   <description snippet>

2. <Title>
   URL: kb://android/topic/...
   <description snippet>

...
```

- **NOT JSON** — human-readable text
- Parser must use regex to extract numbered items: `/^\d+\.\s+(.+)\n\s+URL:\s+(kb:\/\/\S+)\n/m`
- First run: ~10s latency (downloads KB zip + builds index)
- Subsequent: <1s

### `android docs fetch <kb://URL>`

```
Waiting for index to be ready...
Fetching docs from: kb://android/kotlin/flow/stateflow-and-sharedflow
Title: StateFlow and SharedFlow
URL: kb://android/kotlin/flow/stateflow-and-sharedflow
----------------------------------------
<Markdown body...>
```

- Returns **markdown body** after the `----` separator
- Preserves code blocks, links, headings
- Invalid URL: `No document found for URL: kb://...` (stdout, not stderr)
- **Parser strategy**: split on `----------------------------------------` and take tail as content

## Parser Design Recommendations

### For `android-layout-diff.ts` (Plan 19-02)

```typescript
interface LayoutDiffResult {
  ok: true;
  added: LayoutElement[];
  modified: LayoutElement[];
}

interface LayoutDiffError {
  ok: false;
  kind: "adb_offline" | "no_device" | "multi_device" | "json_parse" | "unknown";
  message: string;
  stderr?: string;
}

async function parseLayoutDiff(stdout: string, stderr: string, exitCode: number): Promise<LayoutDiffResult | LayoutDiffError> {
  if (exitCode !== 0) {
    if (stderr.includes("AdbDeviceFailResponseException")) return { ok: false, kind: "adb_offline", message: "Device offline", stderr };
    if (stderr.includes("more than one device")) return { ok: false, kind: "multi_device", message: "Multiple devices — specify --device=<serial>", stderr };
    return { ok: false, kind: "unknown", message: stderr.trim().split("\n")[0] ?? "Unknown error", stderr };
  }
  try {
    const parsed = JSON.parse(stdout) as { added?: LayoutElement[]; modified?: LayoutElement[] };
    return { ok: true, added: parsed.added ?? [], modified: parsed.modified ?? [] };
  } catch (e) {
    return { ok: false, kind: "json_parse", message: `JSON parse failed: ${(e as Error).message}` };
  }
}
```

### For `content-fetcher.ts` android-cli adapter (Plan 19-01)

```typescript
async function fetchWithAndroidCli(kbUri: string): Promise<FetchResult> {
  if (!kbUri.startsWith("kb://")) {
    return { ok: false, error: { url: kbUri, error: "android-cli source requires kb:// URI", source: "android-cli" } };
  }
  // spawn("android", ["docs", "fetch", kbUri], { encoding: "utf-8" })
  // Split stdout on "----------------------------------------" and take tail
  // If stdout matches /^No document found/, return error
  // ...
}
```

## Deduplication Key for Findings

For `android-layout-diff` MCP tool findings, the dedupe_key should be:

```
layout-diff:<category>:<resource-id or text>:<bounds or center>
```

Example: `layout-diff:added:wsCellLayout:[540,1006]`

This prevents dup findings if the same layout anti-pattern is caught by multiple checks.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Schema change in v0.8 | MEDIUM | Version check via `android --version`; warn if not `0.7.x` |
| `modified[]` schema still unknown (only saw `[]` in all tests) | MEDIUM | Defer strict typing of `modified` until we observe a non-empty case; treat as `LayoutElement[]` permissively |
| Non-ASCII UTF-8 garbled on Windows cmd.exe | LOW | Always invoke with `--output=<file>` and read file as UTF-8; do NOT rely on stdout |
| No `removed` key means we can't detect disappeared elements | MEDIUM | Compute removed-set ourselves by diffing full baseline against current — requires two full captures, not just `--diff` |
| Java stack trace on error is multi-line | LOW | Parse first line, preserve rest in `stderr` field of error |
| First `docs search` latency ~10s | LOW | Cache the KB index existence check; warn on first run |

## Exit Decision

**✅ OPTION A** — Proceed to Plan 19-02 implementation.

Schema is stable enough, edge cases are identifiable, parser design is clear. The only meaningful blind spot is the shape of `modified[]` elements — which we mitigate by treating them as the same `LayoutElement` type and adjusting later if field differences appear in real usage.

## Artifacts Captured

All under `C:\Users\34645\AppData\Local\Temp\poc19\`:

- `baseline.json` (275 lines) — full layout of USB settings screen
- `baseline.png` (176 KB) — screenshot plain
- `baseline_annotated.png` (220 KB) — screenshot with labeled bounding boxes
- `diff_empty.json` — `--diff` immediately after baseline (no state change)
- `diff_home.json` (303 lines) — `--diff` after HOME press (major layout change)
- `diff_settings.json` — `--diff` after reopening Settings (24 added elements)

These are ephemeral; do NOT commit PNG or JSON device captures (contain user-identifiable layout text).

## Open Follow-ups (not blocking 19-02)

1. **Capture a real `modified[]` case** (PARTIAL): additional tests after initial POC — dark mode toggle (`adb shell cmd uimode night yes`), scroll via `adb shell input swipe`, and Calculator launch all produced `modified: []` empty. `added[]` works as expected when new elements enter the viewport. Conclusion: `modified[]` is likely reserved for **in-place attribute changes** (e.g., `state: ["selected"]` flipping on a tab) without structural change. It is rare in navigation-driven flows. Parser treats it as `LayoutElement[]` permissively — schema gap is acceptable.
2. **Test with Compose app on device**: baseline was native Samsung Settings. Need to verify schema consistency with Compose-based UI (DawSync). DawSync NOT installed on test device; deferred to Plan 19-02 when we build DawSync.
3. **Test `android run --apks=... --device=R3CT30KAMEH`**: deploy flow for the narrow MCP bridge in Plan 19-04.
4. **Device lockscreen behavior**: the CLI returns lockscreen layout elements without error when the device is locked. If tests require app-level layouts, the test runner must keep the device unlocked (or use a device with no lock).

## Sources

- Android CLI overview: https://developer.android.com/tools/agents/android-cli
- Install command from HN thread: https://news.ycombinator.com/item?id=47797665
- Binary URL: https://edgedl.me.gvt1.com/edgedl/android/cli/latest/windows_x86_64/android.exe
- Installer script: https://dl.google.com/android/cli/latest/windows_x86_64/install.cmd
- Skills spec: https://agentskills.io/specification
