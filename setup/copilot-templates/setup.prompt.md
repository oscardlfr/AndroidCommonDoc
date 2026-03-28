<!-- GENERATED from skills/setup/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Interactive wizard to fully configure a new or existing project to consume AndroidCommonDoc (L0). Covers skills, agents, Detekt rules, Konsist guards, CI workflow, PR template, and MCP server wiring. Creates l0-manifest.json, syncs selected assets, and verifies the result. Bilingual output (EN + ES)."
---

Interactive wizard to fully configure a new or existing project to consume AndroidCommonDoc (L0). Covers skills, agents, Detekt rules, Konsist guards, CI workflow, PR template, and MCP server wiring. Creates l0-manifest.json, syncs selected assets, and verifies the result. Bilingual output (EN + ES).

## Instructions

## Usage Examples / Ejemplos de uso

```
/setup                                          # full interactive wizard (recommended)
/setup --project-root /path/to/my-project
/setup --layer L1                               # shared-library manifest template
/setup --mode warn                              # hook severity (default: warn)
/setup --detekt all|custom|none|skip
/setup --skills all|custom|none
/setup --agents all|custom|none
/setup --guards                                 # install Konsist guard tests
/setup --ci                                     # copy CI template + PR template
/setup --mcp                                    # print MCP server config snippet
/setup --dry-run
/setup --verify-only
/setup --force
```

> **Bootstrap note:** `/setup` lives in AndroidCommonDoc. Run it **from the
> AndroidCommonDoc directory** pointing at your project — no prior installation needed:
>
> ```bash
> cd "$ANDROID_COMMON_DOC"
> /setup --project-root /path/to/my-project
> ```

## Parameters / Parámetros

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--project-root PATH` | cwd | Target project root |
| `--layer L1\|L2` | `L2` | Manifest template (L1 = shared lib, L2 = app) |
| `--mode block\|warn` | `warn` | Claude Code hook severity |
| `--detekt all\|custom\|none\|skip` | prompt | Detekt rules adoption |
| `--skills all\|custom\|none` | prompt | Skill adoption mode |
| `--agents all\|custom\|none` | prompt | Agent adoption mode |
| `--guards` | prompt | Install Konsist structural guard tests |
| `--ci` | prompt | Copy CI workflow template + PR template |
| `--mcp` | prompt | Print MCP server config snippet for Claude Desktop |
| `--skip-gradle` | false | Skip all Gradle modifications |
| `--skip-hooks` | false | Skip Claude Code hooks |
| `--skip-copilot` | false | Skip Copilot instructions |
| `--dry-run` | false | Preview without writing files |
| `--verify-only` | false | Verification checklist only |
| `--force` | false | Overwrite existing manifest / detekt.yml |

---

## Behavior / Comportamiento

### Step 0 — Validate, detect, run wizards, print plan

1. Check `ANDROID_COMMON_DOC` is set. Detect project type and AGP version:

```bash
# Gradle project?
IS_GRADLE=false
{ [ -f "$PROJECT_ROOT/settings.gradle.kts" ] || \
  [ -f "$PROJECT_ROOT/settings.gradle" ]; } && IS_GRADLE=true

# KMP vs Android-only
# Detects: kotlin("multiplatform"), id("org.jetbrains.kotlin.multiplatform"),
# alias(libs.plugins.kotlin.multiplatform), alias(libs.plugins.kotlinMultiplatform),
# Groovy: id 'org.jetbrains.kotlin.multiplatform'
PROJECT_TYPE="unknown"
grep -rqE 'kotlin\("multiplatform"\)|org\.jetbrains\.kotlin\.multiplatform|libs\.plugins\.kotlin[Mm]ultiplatform|libs\.plugins\.kotlin\.multiplatform' \
    "$PROJECT_ROOT" --include="*.gradle.kts" --include="*.gradle" 2>/dev/null \
  && PROJECT_TYPE="kmp"
grep -rqE 'com\.android\.library|com\.android\.application' \
    "$PROJECT_ROOT" --include="*.gradle.kts" --include="*.gradle" 2>/dev/null \
  && [ "$PROJECT_TYPE" = "unknown" ] && PROJECT_TYPE="android-only"

# AGP version — prefer version catalog, fall back to build.gradle.kts
AGP_VERSION=$(grep -E '^agp\s*=' "$PROJECT_ROOT/gradle/libs.versions.toml" 2>/dev/null \
  | head -1 | sed 's/.*"\(.*\)"/\1/')
# Fallback: scan root build.gradle.kts for AGP classpath version
if [ -z "$AGP_VERSION" ]; then
  AGP_VERSION=$(grep -rE 'com\.android\.tools\.build:gradle:([0-9]+\.[0-9]+\.[0-9]+)' \
      "$PROJECT_ROOT" --include="*.gradle.kts" --include="*.gradle" 2>/dev/null \
    | head -1 | sed 's/.*:\([0-9][0-9.]*\).*/\1/')
fi
[ -z "$AGP_VERSION" ] && AGP_VERSION="unknown"
```

Print detected context before any wizard:
```
Detected:  Android-only  |  AGP 8.9.1  |  Kotlin 2.3.0
ℹ️  flat-module-names rule (AGP 9+ bug) does not apply to this project.
ℹ️  Use AndroidLibraryConventionPlugin, not KmpLibraryConventionPlugin.
ℹ️  See: docs/gradle/gradle-patterns-android-only.md
```

2. Run all wizards (W1–W8) for any component not specified via flag.
3. Print full plan table before writing anything.

```
┌──────────────────────────────────────────────────────┐
│  AndroidCommonDoc /setup                             │
├──────────────────────────────────────────────────────┤
│  L0 root:      /path/to/AndroidCommonDoc             │
│  Project root: /path/to/my-project                   │
│  Project type: Android-only  (AGP 8.9.1)            │
│  Layer:        L2                                    │
│  Hook mode:    warn                                  │
│  Skills:       custom  (testing + build + guides)    │
│  Agents:       custom  (test-specialist + ui-spec)   │
│  Detekt:       custom  (9/17 rules active)           │
│  Guards:       yes     (package: com.myapp)          │
│  CI template:  yes                                   │
│  MCP server:   show snippet                          │
│  Model profile: balanced                             │
│  Dry run:      false                                 │
└──────────────────────────────────────────────────────┘
Proceed? [Y/n]
```

---

### Wizard W0 — Layer topology (always shown first)

Auto-discovers L0/L1 sources by scanning sibling directories (`../`, `../../`),
`$ANDROID_COMMON_DOC` env var, and any existing `l0-manifest.json`.

**Discovery markers:**
- **L0**: has `skills/registry.json` + `mcp-server/` (no `l0-manifest.json`)
- **L1**: has `skills/registry.json` + `l0-manifest.json` (own registry + consumes upstream)
- **L2**: has `l0-manifest.json` only (consumer, no own registry)

```
Scanning for L0/L1 sources...

Discovered sources:
  ✅ L0: AndroidCommonDoc → ../AndroidCommonDoc (from $ANDROID_COMMON_DOC)
  ✅ L1: shared-kmp-libs   → ../shared-kmp-libs  (found nearby)

Suggested topology: chain
  Found L1 (shared-kmp-libs) — chain topology lets you inherit its conventions.

Use these sources? [Y/n]
  (n = enter paths manually)
```

If the user confirms, the wizard uses the discovered paths directly.
If the user declines, fall back to manual prompts:

```
Layer topology:
  (1) flat (Recommended)  — This project consumes L0 directly
  (2) chain               — This project inherits from a parent layer (L1→L0)
```

If **flat**: `topology: "flat"`, `sources` = `[{ layer: "L0", path: l0_source }]`.

If **chain**: ask for the parent layer path:
```
Parent layer path (relative to this project):
> ../../shared-kmp-libs
Parent layer name (e.g. L1):
> L1
```
Then `topology: "chain"`, `sources` = `[{ layer: "L0", path: l0_source, role: "tooling" }, { layer: "L1", path: parent_path, role: "ecosystem" }]`.

Validate that each source path contains `skills/registry.json` before proceeding.

**Discovery engine:** `mcp-server/src/sync/layer-discovery.ts` — `discoverLayers()`, `classifyRepo()`, `suggestTopology()`.

> `--topology flat` or `--topology chain --parent PATH` → skip this wizard.

---

### Wizard W1 — Skill selection (if `--skills` not set)

Show categories with their skills. Multi-select toggle (space = toggle, enter = confirm).

```
Which skill categories do you want to import?
  [x] testing    — test, test-full, test-full-parallel, test-changed,
                   auto-cover, coverage, coverage-full, android-test
  [x] build      — lint-resources, run, verify-kmp
  [x] guides     — pre-pr, git-flow, commit-lint, sync-l0, setup
  [ ] security   — sbom, sbom-analyze, sbom-scan
  [ ] ui         — accessibility, best-practices, core-web-vitals,
                   performance, seo, web-quality-audit
  [ ] docs       — readme-audit
  [ ] domain     — extract-errors
  [ ] validation — audit-l0
```

Offer fine-grained opt-out per skill after category selection.
Translate into `exclude_skills` / `exclude_categories` in the manifest.

> `--skills all` → include everything. `--skills none` → mode: explicit (add manually later).

---

### Wizard W2 — Agent selection (if `--agents` not set)

Agents split into two groups. Show descriptions so user can choose:

```
User-facing agents (invoke directly in Claude Code):
  [x] test-specialist         — Reviews test code for pattern compliance
  [x] ui-specialist           — Reviews Compose UI for consistency
  [x] beta-readiness-agent    — Deep audit before beta release
  [x] release-guardian-agent  — Scans for debug flags / secrets before publish
  [x] cross-platform-validator— Validates feature parity across platforms
  [x] doc-alignment-agent     — Proactive doc / code alignment scanner

Internal agents (invoked by quality-gate-orchestrator — install all or none):
  [x] quality-gate-orchestrator   — Unified quality gate runner
  [x] doc-code-drift-detector     — Pattern doc version drift detection
  [x] script-parity-validator     — PS1 / SH script equivalence
  [x] skill-script-alignment      — Skills reference correct scripts
  [x] template-sync-validator     — Claude commands ↔ Copilot template parity
```

> Internal agents are best adopted as a group. If quality-gate-orchestrator
> is selected, recommend selecting all internal agents.

Translate deselected agents into `exclude_agents` in the manifest.

> `--agents all` → keep everything. `--agents none` → exclude all agents.

---

### Wizard W3 — Detekt rules (if `--detekt` not set and IS_GRADLE=true)

```
Do you want to configure AndroidCommonDoc Detekt architecture rules? [y/N]
→ [all] Activate all 17  [custom] Choose per rule  [none] Install, disable all
```

**custom** — per-rule prompt grouped by category, `?` shows pattern doc link:

```
State & Exposure
  [y/?] SealedUiState             UiState must be sealed interface
  [y/?] MutableStateFlowExposed   Must not expose MutableStateFlow publicly
  [y/?] WhileSubscribedTimeout    stateIn() must use WhileSubscribed(5_000)
ViewModel Boundaries
  [y/?] NoPlatformDeps            No Context/Resources/UIKit in ViewModels
  [y/?] NoHardcodedStringsInViewModel
  [y/?] NoHardcodedDispatchers    Inject dispatchers, don't hardcode them
Coroutine Safety
  [y/?] CancellationExceptionRethrow
  [y/?] NoRunCatchingInCoroutineScope
  [y/?] NoSilentCatch
  [y/?] NoLaunchInInit
Architecture Guards
  [y/?] NoChannelForUiEvents
  [y/?] NoChannelForNavigation
  [y/?] NoMagicNumbersInUseCase
KMP / Time Safety
  [y/?] PreferKotlinTimeClock     Use kotlin.time.Clock.System, not kotlinx.datetime.Clock
  [y/?] NoSystemCurrentTimeMillis Use Clock.System instead of System.currentTimeMillis()
  [y/?] NoJavaTimeInCommonMain    java.time/security/text forbidden in commonMain
Testing Patterns
  [y/?] NoTurbine                 Use backgroundScope + flow.toList(), not Turbine
```

Write `detekt.yml` with only disabled rules under `AndroidCommonDoc:`.

> **Detekt 2.0 coordinates**: Plugin ID is `dev.detekt` (NOT `io.gitlab.arturbosch.detekt`).
> Group ID is `dev.detekt`. Version: `2.0.0-alpha.2`. See `docs/guides/detekt-migration-v2.md`.
> If using the `androidcommondoc.toolkit` convention plugin, this is handled automatically.

---

### Wizard W4 — Konsist guard tests (if `--guards` not set and IS_GRADLE=true)

```
Do you want to install Konsist structural guard tests? [y/N]

Guards enforce architecture at test time (module boundaries, naming, layer
isolation). They require a root package name.

  Root package (e.g. com.mycompany.myapp): _
```

If confirmed, run:
```bash
bash "$L0_ROOT/setup/install-guard-tests.sh" \
  --package "$ROOT_PACKAGE" \
  --target "$PROJECT_ROOT" \
  ${DRY_RUN:+--dry-run} \
  ${FORCE:+--force}
```

Installs: `NamingGuardTest.kt`, `ArchitectureGuardTest.kt`,
`ModuleIsolationGuardTest.kt`, `PackageGuardTest.kt`,
`GuardScopeFactory.kt`, `konsist-guard/build.gradle.kts`.

> Skip automatically if not a Gradle project or if `--skip-gradle` passed.

---

### Wizard W5 — CI workflow + PR template + auto-sync (if `--ci` not set)

```
Do you want to copy the CI workflow template and PR template? [y/N]

  .github/workflows/ci.yml             ← reusable L0 workflows + project jobs
  .github/workflows/l0-auto-sync.yml   ← auto-sync from upstream on push + daily cron
  .github/workflows/release.yml        ← auto-release with version bump + changelog + tag
  .github/pull_request_template.md     ← standard PR checklist
```

If confirmed:
- Copy `setup/github-workflows/ci-template.yml` → `$PROJECT_ROOT/.github/workflows/ci.yml`
  (replace `<org>` placeholder with the detected GitHub remote org if available)
- Copy `setup/templates/workflows/l0-auto-sync.yml` → `$PROJECT_ROOT/.github/workflows/l0-auto-sync.yml`
- Copy `setup/templates/workflows/release.yml` → `$PROJECT_ROOT/.github/workflows/release.yml`
  (only if `version.properties` exists or user confirms Git Flow + Conventional Commits)
- Copy `setup/github-workflows/pull_request_template.md` → `$PROJECT_ROOT/.github/pull_request_template.md`

Detect GitHub remote org:
```bash
git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null \
  | sed -E 's|.*github.com[:/]([^/]+)/.*|\1|'
```

> Skip if `.github/workflows/ci.yml` already exists and `--force` not passed.

---

### Wizard W6 — MCP server (if `--mcp` not set)

```
Do you want to connect the MCP server to Claude Desktop? [y/N]

The MCP server exposes 17 tools (validate-all, monitor-sources,
generate-detekt-rules, sync-vault, find-pattern, ...) over stdio.
```

If confirmed, detect OS and print the ready-to-paste snippet:

**macOS/Linux:**
```
Add to: ~/Library/Application Support/Claude/claude_desktop_config.json
        (macOS) or ~/.config/Claude/claude_desktop_config.json (Linux)

{
  "mcpServers": {
    "androidcommondoc": {
      "command": "npx",
      "args": ["tsx", "<L0_ROOT>/mcp-server/src/index.ts"],
      "env": { "ANDROID_COMMON_DOC": "<L0_ROOT>" }
    }
  }
}

Restart Claude Desktop after adding this entry.
Full guide: docs/guides/getting-started/06-mcp-server.md
```

No files are written for this step — print only.

---

### Step 1 — Toolkit installation

```bash
bash "$L0_ROOT/setup/setup-toolkit.sh" \
  --project-root "$PROJECT_ROOT" \
  --mode "${MODE:-warn}" \
  ${DRY_RUN:+--dry-run} \
  ${SKIP_GRADLE:+--skip-gradle} \
  ${SKIP_HOOKS:+--skip-hooks} \
  ${SKIP_COPILOT:+--skip-copilot}
```

Pass `--skip-gradle` when `--detekt skip` and user did not request Gradle.

---

### Step 2 — Detekt setup (conditional)

**2a** Compile JAR if missing.
**2b** Write `detekt.yml` based on W3 mode (all / custom / none). Skip entirely if `skip`.
**2c** Verify plugin adoption scope — the `androidcommondoc.toolkit` plugin must be applied
to **every module** that should run Detekt, not just the root project.

For KMP projects, recommend one of these patterns:

**Convention plugin (recommended):**
```kotlin
// build-logic/src/main/kotlin/your-kmp-library.gradle.kts
plugins {
    id("androidcommondoc.toolkit")
}
```
Then apply `your-kmp-library` to each module's `build.gradle.kts`.

**Subprojects block (quick but less targeted):**
```kotlin
// root build.gradle.kts
subprojects {
    apply(plugin = "androidcommondoc.toolkit")
}
```

> ⚠ **Common mistake**: applying the toolkit plugin only to the root project or only to
> pure-JVM modules. Detekt 2.0 creates per-source-set tasks (`detektCommonMainSourceSet`,
> `detektDesktopMainSourceSet`, etc.) **per module** — a module without the plugin gets
> zero Detekt tasks. If only 4 out of 20 modules show Detekt tasks, the plugin is
> missing from the other 16.

---

### Step 3 — Create `l0-manifest.json`

Populate `selection` block from W1 + W2 choices. Use W0 topology choice:
- **flat**: `createDefaultManifest(l0_source)`
- **chain**: `createChainManifest([{ layer: "L0", ... }, { layer: "L1", ... }])`

Do not overwrite without `--force`.

---

### Step 4 — Sync L0 skills and agents

```
Read skills/sync-l0/SKILL.md
```

Only selected skills and agents are materialised. Skip if `--dry-run`.

---

### Step 5 — Konsist guards (conditional on W4)

Run `install-guard-tests.sh` with confirmed package name. Skip if declined or non-Gradle.

---

### Step 6 — CI + PR templates + auto-sync workflow (conditional on W5)

Copy templates. Replace `<org>` placeholder. Include `l0-auto-sync.yml` for automatic upstream sync. Include `release.yml` if the project uses Git Flow + Conventional Commits. Skip if declined or files exist without `--force`.

---

### Wizard W7 — GSD Integration (if `~/.gsd/` exists)

> **Only shown if** GSD-2 is detected (`~/.gsd/` directory exists).
> If GSD-2 is NOT detected, this step is silently skipped.

```
GSD-2 detected. Sync L0 skills + agents to GSD? [y/N]

This makes all AndroidCommonDoc skills and agents discoverable by GSD-2:
- Skills → ~/.gsd/agent/skills/l0/
- Agents → ~/.gsd/agent/agents/ (as invocable subagents)
```

If confirmed:
```bash
# Sync skills to GSD
bash "$L0_ROOT/scripts/sh/sync-gsd-skills.sh" --source all \
  ${DRY_RUN:+--dry-run} ${VERBOSE:+--verbose}

# Sync agents to GSD (so subagent can invoke them)
bash "$L0_ROOT/scripts/sh/sync-gsd-agents.sh" --target user \
  --project-root "$L0_ROOT" \
  ${DRY_RUN:+--dry-run} ${VERBOSE:+--verbose}
```

Then ask separately:
```
Enable auto-sync hook for future sessions? [y/N]

This adds a SessionStart hook that syncs skills whenever you start Claude Code.
You can disable it later with: /sync-gsd-skills --disable-hook
```

If auto-sync confirmed:
```bash
bash "$L0_ROOT/scripts/sh/sync-gsd-skills.sh" --enable-hook
```

> See: `skills/sync-gsd-skills/SKILL.md` and `skills/sync-gsd-agents/SKILL.md` for full details.

---

### Wizard W8 — Model Profile (always shown)

```
Which agent model profile do you want to use?

  Profiles control which AI model each agent runs on:
  [1] budget    — All haiku (cheapest, fastest)
  [2] balanced  — Haiku for static checks, Sonnet for reasoning (default)
  [3] advanced  — Opus for orchestration + deep analysis, Sonnet for rest
  [4] quality   — All opus (maximum quality, highest cost)

  Select [1-4] or press Enter for balanced: _
```

If confirmed:
1. Copy `.claude/model-profiles.json` from L0 to the project (if not already present)
2. Set `"current"` to the selected profile name
3. Update all agent `.md` frontmatter `model:` lines to match the profile:
   - For each agent: `model = overrides[agent] ?? default_model`
4. Report changes:
```
Model profile: balanced
  full-audit-orchestrator:  sonnet
  quality-gate-orchestrator: sonnet
  script-parity-validator:  haiku
  ...
  15 agents configured.
```

> The user can change profiles later with `/set-model-profile <profile>`.

---

### Step 7 — Verification checklist

```bash
# Core
ANDROID_COMMON_DOC is set and points to valid L0 root
l0-manifest.json exists and has checksums
Skills count matches selection (ls .claude/skills/ vs manifest)
Agents synced (.claude/agents/ count matches manifest)
Hooks installed (.claude/hooks/ has detekt-pre-commit.sh + detekt-post-write.sh)

# Conditional (only if opted in)
Detekt JAR exists at $L0_ROOT/detekt-rules/build/libs/detekt-rules-1.0.0.jar
detekt.yml exists in project root
Guard tests directory exists (konsist-guard/ or equivalent)
.github/workflows/ci.yml exists
.github/workflows/l0-auto-sync.yml exists
.github/workflows/release.yml exists (if Git Flow confirmed)
Model-profiles.json exists in .claude/

# GSD (only if W7 confirmed)
GSD skills synced (ls ~/.gsd/agent/skills/l0/ | wc -l > 0)
GSD agents synced (ls ~/.gsd/agent/agents/ has L0 agents)
GSD agent parity (bash $L0_ROOT/scripts/sh/check-agent-parity.sh)
```

---

### Step 8 — Final summary

```
╔════════════════════════════════════════════════════════╗
║           /setup — AndroidCommonDoc                    ║
╠════════════════════════════════════════════════════════╣
║  Toolkit            ✅ hooks + Copilot + Gradle        ║
║  l0-manifest.json   ✅ Created (layer: L2)             ║
║  Skills synced      ✅ 18 skills (testing+build+guides)║
║  Agents synced      ✅ 8 agents                        ║
║  Detekt JAR         ✅ Ready                           ║  ← conditional
║  detekt.yml         ✅ custom (9 active / 4 disabled)  ║  ← conditional
║  Konsist guards     ✅ 5 guard files (com.myapp)       ║  ← conditional
║  CI workflow        ✅ .github/workflows/ci.yml        ║  ← conditional
║  Auto-sync          ✅ .github/workflows/l0-auto-sync  ║  ← conditional
║  PR template        ✅ .github/pull_request_template   ║  ← conditional
║  MCP server         ℹ️  Snippet printed above          ║  ← conditional
║  GSD skills         ✅ 40 skills synced                ║  ← conditional
║  GSD agents         ✅ 15 agents synced as subagents   ║  ← conditional
║  Model profile      ✅ balanced (8 sonnet, 7 haiku)   ║
╠════════════════════════════════════════════════════════╣
║  Overall:  ✅ READY — restart Claude Code              ║
╚════════════════════════════════════════════════════════╝
```

Every row is conditional — only shown if that component was configured.

---

### Step 9 — Post-setup health check and next actions

After setup completes, offer to run a health check and suggest next actions based on what was installed.

```
Setup complete. Run post-setup health check? [Y/n]
```

If confirmed, execute these checks and report:

**1. MCP connectivity (if W6 confirmed):**
```bash
# Test if MCP server starts and responds
cd "$L0_ROOT/mcp-server" && timeout 10 node build/index.js < /dev/null 2>&1 | head -5
```
If the server binary doesn't exist: `⚠ MCP server not built. Run: cd $L0_ROOT/mcp-server && npm ci && npm run build`

**2. Detekt rules (if W3 confirmed):**
```bash
# Verify JAR is built and rules load
java -jar "$L0_ROOT/detekt-rules/build/libs/detekt-rules-1.0.0.jar" 2>&1 || true
ls "$L0_ROOT/detekt-rules/build/libs/detekt-rules-1.0.0.jar" 2>/dev/null
```
If JAR missing: `⚠ Detekt rules JAR not built. Run: cd $L0_ROOT/detekt-rules && ./gradlew jar`

**3. GSD agent parity (if W7 confirmed):**
```bash
bash "$L0_ROOT/scripts/sh/check-agent-parity.sh" --project-root "$L0_ROOT" --target user
```

**4. Registry hash freshness:**
```bash
bash "$L0_ROOT/scripts/sh/rehash-registry.sh" --project-root "$L0_ROOT" --check
```

**5. Suggest next actions based on context:**

```
╔════════════════════════════════════════════════════════╗
║  Recommended Next Actions                              ║
╠════════════════════════════════════════════════════════╣
║  /pre-pr              Validate everything before PR    ║
║  /test core:domain    Test a specific module           ║
║  /validate-patterns   Check code against L0 patterns   ║
║  /verify-kmp          Validate KMP source sets         ║
║  /set-model-profile   Change agent model tier          ║
╠════════════════════════════════════════════════════════╣
║  MCP (if snippet not installed yet):                   ║
║  Add the snippet above to claude_desktop_config.json   ║
║  then restart Claude Desktop.                          ║
╚════════════════════════════════════════════════════════╝
```

For AI agents executing this wizard: **offer to run the top recommended action** instead of just printing the table. Example:

```
Setup complete. Would you like me to run /pre-pr to validate the installation?
```

---

### Next steps (printed at the very end)

```
Next steps:
  1. Restart Claude Code for hooks and skills to activate
  2. MCP: add snippet to claude_desktop_config.json, restart Claude Desktop
  3. CI: review .github/workflows/ci.yml — replace <org> if not auto-detected
  4. Run /pre-pr to validate the full installation
  5. Run /test <module> to verify your test setup works
```

---

## Important Rules / Reglas importantes

1. **Wizard before action** — never write files before the user confirms choices.
2. **Every component is opt-in** — Detekt, guards, CI, MCP, agents: all have a y/N prompt.
3. **Never overwrite existing files** without `--force` (manifest, detekt.yml, ci.yml, guards).
4. **`l0_source` must be relative** — absolute paths break portability.
5. **`--dry-run` shows exactly what would be written** — manifest diff, detekt.yml content, file list.
6. **`--verify-only` is always read-only** — safe on any project at any time.
7. **Internal agents are best adopted as a group** — warn if quality-gate-orchestrator selected without the internal validators.
8. **MCP wizard prints only** — no files written; user pastes the snippet manually.
9. **Report every step outcome** — no silent failures.

---

## Cross-References / Referencias cruzadas

- Skill: `/sync-l0` — Step 4 delegates here
- Skill: `/pre-pr` — run after setup to validate PR-readiness
- Script: `setup/setup-toolkit.sh` — Steps 1 delegates here
- Script: `setup/install-guard-tests.sh` — Step 5 delegates here
- Doc: [`docs/guides/getting-started.md`](../docs/guides/getting-started.md)
- Doc: [`docs/guides/getting-started/03-manifest.md`](../docs/guides/getting-started/03-manifest.md)
- Doc: [`docs/guides/getting-started/05-detekt-layers.md`](../docs/guides/getting-started/05-detekt-layers.md)
- Doc: [`docs/guides/getting-started/06-mcp-server.md`](../docs/guides/getting-started/06-mcp-server.md)
- Doc: [`docs/guides/getting-started/07-ci-workflows.md`](../docs/guides/getting-started/07-ci-workflows.md)
