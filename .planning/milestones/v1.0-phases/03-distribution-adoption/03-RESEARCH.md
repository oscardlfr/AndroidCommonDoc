# Phase 3: Distribution and Adoption - Research

**Researched:** 2026-03-13
**Domain:** Gradle convention plugins, Claude Code hooks, GitHub Copilot instructions, cross-tool distribution
**Confidence:** HIGH

## Summary

Phase 3 packages the AndroidCommonDoc toolkit (Detekt custom rules, Compose Rules, pattern enforcement) for consumption by external projects through three channels: (1) a Gradle convention plugin in `build-logic/` that bundles all lint enforcement behind a single `plugins { id("androidcommondoc.toolkit") }` application, (2) Claude Code hooks that run Detekt on changed files during AI-assisted development, and (3) generated GitHub Copilot instruction files that enforce the same patterns.

The Gradle convention plugin is a well-established pattern with clear official documentation. It uses precompiled script plugins in an included build, applies the Detekt Gradle plugin (`dev.detekt` for 2.0.0-alpha.2), and adds both the custom rules JAR and Compose Rules 0.5.6 via the `detektPlugins` configuration. Claude Code hooks are a mature feature with a rich JSON input/output protocol -- the PostToolUse event on Write|Edit tools provides the file path of changed files, which a hook script can filter for `.kt` files and run Detekt against. Copilot instructions use `.github/copilot-instructions.md` (plain Markdown) plus optional path-scoped `.instructions.md` files with YAML frontmatter.

**Primary recommendation:** Build the convention plugin as a precompiled script plugin (`androidcommondoc.toolkit.gradle.kts`) with a custom extension DSL for per-concern opt-out. Implement the Claude Code hook as a PostToolUse command hook on `Write|Edit` that runs Detekt CLI on changed Kotlin files. Generate Copilot instructions from the same canonical skill/pattern definitions used by the adapter pipeline.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Full toolkit bundle: single `androidcommondoc.toolkit` plugin configures Detekt + custom rules JAR + Compose Rules 0.5.6 + test configuration + version alignment + all toolkit concerns
- Lives in `AndroidCommonDoc/build-logic/` -- consuming projects include via composite build (`includeBuild("../AndroidCommonDoc/build-logic")`)
- Per-concern opt-out DSL: everything enabled by default, but consuming projects can disable individual concerns (detektRules, composeRules, testConfig) via extension block
- Coexists with consuming project's own `build-logic/` -- Gradle composite builds support multiple build-logic sources
- Pre-commit trigger -- fires before code is committed, catches violations before they enter git history
- Runs actual Detekt with custom rules JAR on changed files -- same engine as CI, guaranteed consistency
- Configurable severity per project: default is block commit, but consuming projects can set warn-only mode via `--mode=block|warn` flag
- Hook configuration distributed via setup script -- existing install scripts extended to configure hooks in consuming project's `.claude/settings.json`
- Generated from canonical source using Phase 1 adapter pattern -- same skill/pattern definitions generate both Claude hooks and Copilot instruction files
- Target location: `.github/copilot-instructions.md` in consuming project
- Generator implemented as script pair (PS1/SH) consistent with Phase 1 adapter architecture
- Both unified and individual setup: `setup-toolkit.sh --project-root ../MyApp` for full setup, individual scripts for selective adoption
- Setup scripts auto-modify consuming project's build files (settings.gradle.kts for includeBuild, module build.gradle.kts for plugin application) -- idempotent, backs up before modifying
- Discovery: keep existing `$ANDROID_COMMON_DOC` env var pattern + `--project-root` flag

### Claude's Discretion
- Hooks vs Copilot instructions sync validation approach (extend template-sync-validator vs separate)
- Convention plugin internal implementation details (extension DSL design, task registration)
- Detekt CLI invocation details in hook scripts (classpath, caching strategy)
- Copilot instruction content structure and formatting
- Backup strategy for auto-modified build files
- Setup script error handling and rollback behavior

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LINT-02 | Convention plugins in build-logic/ enable one-line Gradle adoption of all enforcement rules in consuming projects | Convention plugin architecture pattern fully researched: precompiled script plugin, Detekt 2.0.0-alpha.2 plugin ID, detektPlugins configuration, extension DSL for opt-out |
| TOOL-03 | Claude Code hooks enforce patterns in real-time during AI-assisted development | Claude Code hooks API fully documented: PostToolUse event on Write|Edit, JSON input with file_path, decision control via exit codes and JSON output, settings.json configuration |
</phase_requirements>

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| Gradle `kotlin-dsl` plugin | (bundled with Gradle 9.1) | Enables precompiled script plugins in build-logic | Official Gradle mechanism for convention plugins |
| Detekt Gradle Plugin | 2.0.0-alpha.2 | Static analysis for Kotlin | Already used in detekt-rules module; plugin ID is `dev.detekt` |
| Compose Rules (detekt) | 0.5.6 | Compose-specific lint rules | Already integrated in Phase 2; artifact `io.nlopez.compose.rules:detekt:0.5.6` |
| Claude Code Hooks | (built-in) | Real-time pattern enforcement during AI dev | Official Claude Code feature; hooks in `.claude/settings.json` |
| GitHub Copilot Instructions | (built-in) | Pattern guidance for Copilot | Standard `.github/copilot-instructions.md` format |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `jq` | system | Parse JSON stdin in hook scripts | Required for Claude Code command hooks to read tool input |
| python3 | system | Copilot instruction generator (adapter pattern) | Consistent with Phase 1 adapter scripts that use python3 |
| Detekt CLI | 2.0.0-alpha.2 | Run Detekt from hook scripts outside Gradle | Hook scripts invoke Detekt directly on changed files |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Precompiled script plugin (.gradle.kts) | Binary plugin (Plugin<Project> class) | Binary gives more control but precompiled is simpler, sufficient for our needs, and easier to read |
| PostToolUse hook (after write) | PreToolUse hook (before write) | PreToolUse could prevent bad writes but doesn't have file content yet; PostToolUse has file_path of written file |
| Detekt CLI in hooks | Detekt Gradle task in hooks | CLI is faster for single-file checks; Gradle task requires full project resolution |
| `.github/copilot-instructions.md` | `.github/instructions/*.instructions.md` | Path-scoped instructions are more targeted but instructions.md is simpler for initial adoption |

## Architecture Patterns

### Recommended Project Structure
```
AndroidCommonDoc/
  build-logic/
    build.gradle.kts              # kotlin-dsl plugin, Detekt dependency
    settings.gradle.kts           # rootProject.name = "build-logic"
    src/main/kotlin/
      androidcommondoc.toolkit.gradle.kts    # Convention plugin (precompiled)
      com/androidcommondoc/gradle/
        AndroidCommonDocExtension.kt         # Extension DSL class
  .claude/
    hooks/
      detekt-check.sh             # PostToolUse hook script (cross-platform)
    settings.json                 # Updated with hooks configuration
  setup/
    install-claude-skills.sh      # Existing (extended)
    install-copilot-prompts.sh    # Existing (extended)
    install-hooks.sh              # NEW: installs hooks into consuming project
    setup-toolkit.sh              # NEW: unified setup orchestrator
    setup-toolkit.ps1             # NEW: Windows equivalent
  adapters/
    copilot-instructions-adapter.sh  # NEW: generates copilot-instructions.md
```

### Pattern 1: Precompiled Script Convention Plugin
**What:** A `.gradle.kts` file in `build-logic/src/main/kotlin/` that Gradle auto-compiles into a plugin. The filename becomes the plugin ID.
**When to use:** When bundling multiple plugin applications and configurations into one reusable unit.
**Example:**
```kotlin
// Source: Gradle official docs + detekt convention plugin pattern
// File: build-logic/src/main/kotlin/androidcommondoc.toolkit.gradle.kts

plugins {
    id("dev.detekt")
}

// Create extension for opt-out DSL
val toolkitExt = extensions.create<com.androidcommondoc.gradle.AndroidCommonDocExtension>(
    "androidCommonDoc"
)

// Configure Detekt
detekt {
    buildUponDefaultConfig = true
    parallel = true
    config.setFrom(
        files("${rootDir}/path/to/config.yml")  // Will be resolved at evaluation
    )
}

// Add custom rules JAR and Compose Rules via detektPlugins
afterEvaluate {
    if (toolkitExt.detektRules.get()) {
        dependencies {
            "detektPlugins"(files("path/to/detekt-rules-1.0.0.jar"))
        }
    }
    if (toolkitExt.composeRules.get()) {
        dependencies {
            "detektPlugins"("io.nlopez.compose.rules:detekt:0.5.6")
        }
    }
}
```

### Pattern 2: Extension DSL for Per-Concern Opt-Out
**What:** A Gradle extension class that lets consuming projects disable specific toolkit concerns.
**When to use:** Essential for corporate adoption where teams control what they adopt.
**Example:**
```kotlin
// Source: Gradle Extension API + CONTEXT.md DSL requirement
// File: build-logic/src/main/kotlin/com/androidcommondoc/gradle/AndroidCommonDocExtension.kt

import org.gradle.api.provider.Property

abstract class AndroidCommonDocExtension {
    /** Enable/disable custom Detekt architecture rules. Default: true */
    abstract val detektRules: Property<Boolean>

    /** Enable/disable Compose Rules (mrmans0n 0.5.6). Default: true */
    abstract val composeRules: Property<Boolean>

    /** Enable/disable test configuration conventions. Default: true */
    abstract val testConfig: Property<Boolean>

    init {
        detektRules.convention(true)
        composeRules.convention(true)
        testConfig.convention(true)
    }
}
```

**Consuming project usage:**
```kotlin
// In consuming project's module build.gradle.kts
plugins {
    id("androidcommondoc.toolkit")
}

androidCommonDoc {
    detektRules.set(false)  // Disable custom architecture rules
    // composeRules and testConfig remain enabled (defaults)
}
```

### Pattern 3: Claude Code PostToolUse Hook for Lint Enforcement
**What:** A hook that fires after Write|Edit tools, checks if the file is Kotlin, and runs Detekt on it.
**When to use:** Real-time pattern enforcement during AI-assisted development.
**Example:**
```json
// Source: Claude Code Hooks Reference (code.claude.com/docs/en/hooks)
// File: .claude/settings.json (in consuming project)
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/detekt-check.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

```bash
#!/bin/bash
# .claude/hooks/detekt-check.sh
# Reads PostToolUse JSON from stdin, runs Detekt on .kt files

INPUT=$(cat /dev/stdin)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.file_path')

# Only check Kotlin files
if [[ ! "$FILE_PATH" =~ \.kt$ ]]; then
    exit 0  # Not a Kotlin file, allow
fi

# Run Detekt on the single file
COMMON_DOC="${ANDROID_COMMON_DOC:?}"
RESULT=$(java -jar "$COMMON_DOC/detekt-rules/build/libs/detekt-rules-1.0.0.jar" \
    --input "$FILE_PATH" \
    --config "$COMMON_DOC/detekt-rules/src/main/resources/config/config.yml" \
    2>&1) || true

if [ -n "$RESULT" ] && echo "$RESULT" | grep -q "findings"; then
    # Return feedback to Claude
    echo "{\"decision\": \"block\", \"reason\": \"Detekt violations found:\\n$RESULT\"}"
    exit 0
fi

exit 0  # Clean, allow
```

**Important implementation note:** The CONTEXT.md specifies "pre-commit trigger" -- however, Claude Code hooks don't have a native "pre-git-commit" event. The correct approach is to use a **PreToolUse hook matching Bash** where the command contains `git commit`. This intercepts Claude's commit attempt and runs Detekt on staged files before the commit executes.

### Pattern 4: Composite Build Integration
**What:** Consuming projects include AndroidCommonDoc's build-logic via `includeBuild`.
**When to use:** Always -- this is how the convention plugin is distributed.
**Example:**
```kotlin
// In consuming project's settings.gradle.kts
// Add alongside existing includeBuild entries
includeBuild("../../AndroidCommonDoc/build-logic")
```

No `dependencySubstitution` needed because convention plugins are resolved by plugin ID, not Maven coordinates. Gradle's composite build automatically makes plugins from included builds available.

### Anti-Patterns to Avoid
- **DO NOT publish to Maven Local:** Convention plugins via composite build eliminate the need for local publishing. Publishing adds friction and version management overhead.
- **DO NOT use buildSrc:** The plugin must be usable from external projects. buildSrc is project-scoped and not shareable via composite builds.
- **DO NOT run full Gradle build in hooks:** Hook timeout is 600s max (30s recommended). Run Detekt CLI directly on individual files, not `./gradlew detekt` which resolves the entire project.
- **DO NOT modify detekt.yml in consuming projects:** The convention plugin should bundle its own config. Requiring consumers to maintain detekt.yml defeats the purpose.
- **DO NOT use PreToolUse for file content checks:** PreToolUse fires before the tool runs, so the file content hasn't been written yet. Use PostToolUse which has `tool_input.file_path` of the just-written file.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detekt config distribution | Custom config-merge scripts | Convention plugin `config.setFrom()` with bundled config | Detekt's config composition handles inheritance and override natively |
| Hook JSON parsing | String manipulation in bash | `jq` for JSON extraction | Hook stdin is structured JSON; string parsing is fragile |
| Plugin version alignment | Manual version checks | Gradle version catalog or hardcoded in convention plugin | Convention plugin pins exact versions, consumers don't need to know |
| Cross-platform hook scripts | Separate PS1/SH hook implementations | Single bash script (Claude Code on Windows uses Git Bash) | Claude Code always executes hooks in bash, even on Windows |
| Build file modification | Manual sed/awk edits | python3 with AST-aware parsing or careful regex + backup | Gradle files are Kotlin DSL; naive string replacement breaks on edge cases |

**Key insight:** The convention plugin eliminates most distribution complexity. Consumers add one `includeBuild` and one `plugins { id(...) }` line -- everything else (Detekt version, rules JAR, Compose Rules, config) is managed internally.

## Common Pitfalls

### Pitfall 1: detektPlugins Configuration Scoping
**What goes wrong:** `detektPlugins` dependencies added in a convention plugin don't take effect because they're scoped to the wrong project.
**Why it happens:** When configuring a custom detekt task at the root project level, `detektPlugins` must also be at the root project level -- not in subprojects.
**How to avoid:** In the convention plugin, add `detektPlugins` dependencies directly in the project where the plugin is applied. Use `dependencies { "detektPlugins"(...) }` in the same plugin script that applies `dev.detekt`.
**Warning signs:** Detekt runs but reports no violations from custom rules or Compose Rules.

### Pitfall 2: Gradle Daemon Cache with Custom Rules JAR
**What goes wrong:** After rebuilding the custom rules JAR, Detekt still uses the old rules.
**Why it happens:** Gradle daemon caches classpath entries. A file-based dependency like `files("path/to/jar")` doesn't change its coordinates, so the daemon doesn't reload.
**How to avoid:** Use `--stop` to stop Gradle daemons after rebuilding the rules JAR, or better yet, include `detekt-rules` as a project dependency in the composite build rather than a file reference.
**Warning signs:** New rules or rule changes don't appear even after clean rebuild.

### Pitfall 3: Claude Code Hook JSON Output Must Be Pure
**What goes wrong:** Hook script outputs non-JSON text (bash profile messages, echo statements) before or after the JSON, causing Claude Code to ignore the decision.
**Why it happens:** Shell profile initialization prints messages; debug echo statements leak to stdout.
**How to avoid:** All debug output goes to stderr (`>&2`). Only the final JSON decision goes to stdout. Start hook scripts with `set -euo pipefail` and redirect any noisy subcommands.
**Warning signs:** Hooks run (visible in verbose mode) but decisions are ignored. Claude Code logs "JSON validation failed."

### Pitfall 4: Hook Timeout on Large Files
**What goes wrong:** Detekt analysis takes too long on large files, hook times out (default 600s, recommended 30s).
**Why it happens:** Running Detekt CLI has JVM startup overhead (~2-5s) plus analysis time. On very large files or if JVM is cold, this can exceed timeout.
**How to avoid:** Set reasonable timeout (30s). Skip files larger than a threshold (e.g., 500 lines). Cache the JVM process if possible. Consider using Detekt's `--parallel` flag.
**Warning signs:** Hook script exit code is non-zero but no decision JSON is emitted.

### Pitfall 5: Composite Build Plugin Resolution Order
**What goes wrong:** Consuming project's own convention plugin ID collides with AndroidCommonDoc's plugin ID.
**Why it happens:** If both build-logic directories use similar naming, Gradle resolves the first match.
**How to avoid:** Use a distinctive plugin ID prefix: `androidcommondoc.toolkit` (not `toolkit` or `conventions.detekt`). The CONTEXT.md already specifies this naming.
**Warning signs:** Wrong plugin applied, or "Plugin with id 'X' not found" errors.

### Pitfall 6: Detekt 2.0.0-alpha.2 Plugin ID Migration
**What goes wrong:** Convention plugin uses old `io.gitlab.arturbosch.detekt` plugin ID which doesn't exist for 2.0.0-alpha.2.
**Why it happens:** Most online examples reference the old 1.x plugin ID. Detekt 2.0 migrated to `dev.detekt`.
**How to avoid:** Use `id("dev.detekt")` in the convention plugin. The Maven artifact for the Gradle plugin is `dev.detekt:dev.detekt.gradle.plugin:2.0.0-alpha.2`.
**Warning signs:** "Plugin with id 'io.gitlab.arturbosch.detekt' not found" at build configuration time.

### Pitfall 7: Hook Settings Snapshot at Session Start
**What goes wrong:** Setup script modifies `.claude/settings.json` but hooks don't activate.
**Why it happens:** Claude Code captures a snapshot of hooks at session startup. Mid-session modifications require review via `/hooks` menu.
**How to avoid:** Document in setup output that users must restart Claude Code session (or use `/hooks` to review changes). Setup script should print this instruction.
**Warning signs:** Settings file contains hooks but they never fire.

## Code Examples

### Convention Plugin build.gradle.kts (build-logic module)
```kotlin
// Source: Gradle docs + Detekt convention plugin pattern
// File: build-logic/build.gradle.kts
plugins {
    `kotlin-dsl`
}

repositories {
    mavenCentral()
    gradlePluginPortal()
}

dependencies {
    // Detekt Gradle plugin API (for precompiled script plugin to reference)
    implementation("dev.detekt:dev.detekt.gradle.plugin:2.0.0-alpha.2")
}
```

### Convention Plugin settings.gradle.kts (build-logic module)
```kotlin
// File: build-logic/settings.gradle.kts
rootProject.name = "build-logic"
```

### Consuming Project settings.gradle.kts Addition
```kotlin
// Added by setup-toolkit.sh to consuming project's settings.gradle.kts
// No dependencySubstitution needed for plugin resolution
includeBuild("../../AndroidCommonDoc/build-logic")
```

### Claude Code Hook Configuration (consuming project .claude/settings.json)
```json
// Source: Claude Code Hooks Reference (code.claude.com/docs/en/hooks)
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/detekt-pre-commit.sh",
            "timeout": 60,
            "statusMessage": "Running AndroidCommonDoc pattern checks..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/detekt-post-write.sh",
            "timeout": 30,
            "statusMessage": "Checking patterns..."
          }
        ]
      }
    ]
  }
}
```

**Two-hook strategy:**
1. **PostToolUse on Write|Edit**: Immediate feedback after Claude writes/edits a Kotlin file. Returns `decision: "block"` with violation details so Claude corrects the code immediately. This is the "real-time" enforcement.
2. **PreToolUse on Bash**: Intercepts `git commit` commands. Reads staged `.kt` files, runs Detekt, and returns `permissionDecision: "deny"` if violations found. This is the "pre-commit" gate.

### Hook Script: Post-Write Check
```bash
#!/bin/bash
# .claude/hooks/detekt-post-write.sh
# Runs after Claude writes/edits a file. Checks Kotlin files against patterns.
set -euo pipefail

INPUT=$(cat /dev/stdin)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path')

# Only check Kotlin files
[[ "$FILE_PATH" =~ \.kt$ ]] || exit 0

# Determine toolkit location
COMMON_DOC="${ANDROID_COMMON_DOC:-}"
if [ -z "$COMMON_DOC" ]; then
    # Try relative path from project
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    COMMON_DOC="$(cd "$SCRIPT_DIR/../../../AndroidCommonDoc" 2>/dev/null && pwd)" || exit 0
fi

RULES_JAR="$COMMON_DOC/detekt-rules/build/libs/detekt-rules-1.0.0.jar"
CONFIG="$COMMON_DOC/detekt-rules/src/main/resources/config/config.yml"

# Skip if rules JAR not built
[ -f "$RULES_JAR" ] || exit 0

# Run Detekt CLI on single file
DETEKT_RESULT=$(java -cp "$COMMON_DOC/detekt-rules/build/libs/*" \
    dev.detekt.cli.Main \
    --input "$FILE_PATH" \
    --config "$CONFIG" \
    --plugins "$RULES_JAR" \
    2>&1) || DETEKT_EXIT=$?

if [ "${DETEKT_EXIT:-0}" -ne 0 ] && [ -n "$DETEKT_RESULT" ]; then
    # Feed violations back to Claude as context
    jq -n --arg reason "$DETEKT_RESULT" '{
        decision: "block",
        reason: ("AndroidCommonDoc pattern violations found. Fix these before proceeding:\n" + $reason)
    }'
fi

exit 0
```

### Hook Script: Pre-Commit Gate
```bash
#!/bin/bash
# .claude/hooks/detekt-pre-commit.sh
# PreToolUse hook on Bash -- intercepts git commit to validate staged files.
set -euo pipefail

INPUT=$(cat /dev/stdin)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Only intercept git commit commands
[[ "$COMMAND" =~ ^git\ commit ]] || exit 0

# Get staged Kotlin files
STAGED_KT=$(git diff --cached --name-only --diff-filter=ACM | grep '\.kt$' || true)
[ -z "$STAGED_KT" ] && exit 0

# Run Detekt on staged files
COMMON_DOC="${ANDROID_COMMON_DOC:-}"
[ -z "$COMMON_DOC" ] && exit 0

RULES_JAR="$COMMON_DOC/detekt-rules/build/libs/detekt-rules-1.0.0.jar"
CONFIG="$COMMON_DOC/detekt-rules/src/main/resources/config/config.yml"
[ -f "$RULES_JAR" ] || exit 0

# Determine mode from project config (block or warn)
MODE="${ANDROID_COMMON_DOC_MODE:-block}"

DETEKT_RESULT=$(echo "$STAGED_KT" | tr '\n' ',' | \
    java -cp "$COMMON_DOC/detekt-rules/build/libs/*" \
    dev.detekt.cli.Main \
    --input "$(echo "$STAGED_KT" | tr '\n' ',')" \
    --config "$CONFIG" \
    --plugins "$RULES_JAR" \
    2>&1) || DETEKT_EXIT=$?

if [ "${DETEKT_EXIT:-0}" -ne 0 ] && [ -n "$DETEKT_RESULT" ]; then
    if [ "$MODE" = "block" ]; then
        jq -n --arg reason "$DETEKT_RESULT" '{
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: ("Pattern violations in staged files:\n" + $reason)
            }
        }'
    else
        # Warn mode: allow commit but add context
        jq -n --arg ctx "$DETEKT_RESULT" '{
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "allow",
                additionalContext: ("WARNING: Pattern violations found (warn-only mode):\n" + $ctx)
            }
        }'
    fi
fi

exit 0
```

### Copilot Instructions Generation (adapter pattern)
```bash
#!/bin/bash
# adapters/copilot-instructions-adapter.sh
# Generates .github/copilot-instructions.md from canonical pattern docs
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

python3 -c "
import os, json

docs_dir = 'docs'
output_lines = []
output_lines.append('# AndroidCommonDoc Coding Patterns')
output_lines.append('')
output_lines.append('Follow these patterns when writing Kotlin/KMP code in this project.')
output_lines.append('')

# Extract key patterns from each doc
for doc in sorted(os.listdir(docs_dir)):
    if not doc.endswith('.md'):
        continue
    with open(os.path.join(docs_dir, doc)) as f:
        content = f.read()
    # Extract title and key rules
    lines = content.split('\n')
    title = next((l.lstrip('# ').strip() for l in lines if l.startswith('# ')), doc)
    output_lines.append(f'## {title}')
    output_lines.append('')
    # Extract DO/DON'T patterns
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('- **DO') or stripped.startswith('- **DON'):
            output_lines.append(stripped)
    output_lines.append('')

print('\n'.join(output_lines))
" > setup/copilot-templates/copilot-instructions-generated.md
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `io.gitlab.arturbosch.detekt` plugin ID | `dev.detekt` plugin ID | Detekt 2.0.0-alpha.0 (2024) | Must use new ID; old ID doesn't resolve for 2.0 alpha |
| Simple exit code hooks | JSON decision control with `hookSpecificOutput` | Claude Code hooks v2 (2025) | Richer control: allow/deny/ask, tool input modification, additional context |
| `.github/copilot-instructions.md` only | + `.instructions.md` with `applyTo` YAML frontmatter | July 2025 | Path-scoped instructions possible for targeted guidance |
| Hook scripts only for Claude Code hooks | + prompt/agent hook types | 2025 | Can use LLM-evaluated hooks, but command hooks are better for deterministic checks |

**Deprecated/outdated:**
- `io.gitlab.arturbosch.detekt` plugin ID: Replaced by `dev.detekt` in 2.0.0-alpha series
- Top-level `decision`/`reason` for PreToolUse: Replaced by `hookSpecificOutput.permissionDecision`. Old format still works but is deprecated.
- Claude Code exit code 2 as only blocking mechanism: JSON output with `decision: "block"` is now preferred for PostToolUse events

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bash script tests (functional) + Gradle plugin verification |
| Config file | None yet -- Wave 0 gap |
| Quick run command | `bash .claude/hooks/detekt-post-write.sh < test-input.json` |
| Full suite command | `cd detekt-rules && ./gradlew test && cd ../build-logic && ./gradlew assemble` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LINT-02 | Convention plugin applies Detekt + custom rules + Compose Rules | smoke | `cd build-logic && ./gradlew assemble` (plugin compiles) | No -- Wave 0 |
| LINT-02 | Per-concern opt-out DSL works | functional | Apply plugin with `detektRules.set(false)`, verify no custom rules loaded | No -- Wave 0 |
| TOOL-03 | Post-write hook detects pattern violations in .kt files | functional | `echo '{"tool_input":{"file_path":"test.kt"}}' \| bash .claude/hooks/detekt-post-write.sh` | No -- Wave 0 |
| TOOL-03 | Pre-commit hook blocks commit with violations | functional | `echo '{"tool_input":{"command":"git commit -m test"}}' \| bash .claude/hooks/detekt-pre-commit.sh` | No -- Wave 0 |
| TOOL-03 | Hook script produces valid JSON output | unit | `echo '...' \| bash hook.sh \| jq .` (exit 0 = valid JSON) | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `cd build-logic && ./gradlew assemble` + hook smoke tests
- **Per wave merge:** Full suite including detekt-rules tests
- **Phase gate:** Convention plugin applies successfully in mock project + hooks produce correct JSON for test inputs

### Wave 0 Gaps
- [ ] `build-logic/build.gradle.kts` -- convention plugin project setup
- [ ] `build-logic/settings.gradle.kts` -- build-logic settings
- [ ] `.claude/hooks/detekt-post-write.sh` -- post-write hook script
- [ ] `.claude/hooks/detekt-pre-commit.sh` -- pre-commit hook script
- [ ] Test fixtures for hook JSON input (mock PostToolUse/PreToolUse payloads)
- [ ] Setup script smoke test (dry-run on mock project directory)

## Open Questions

1. **Detekt CLI classpath for standalone invocation**
   - What we know: Detekt CLI needs `detekt-cli.jar` plus the custom rules JAR on classpath. The built `detekt-rules-1.0.0.jar` only contains the rules, not the Detekt CLI itself.
   - What's unclear: Whether to bundle detekt-cli.jar in the toolkit, download it on setup, or invoke via Gradle.
   - Recommendation: Include a thin wrapper that downloads/caches detekt-cli.jar on first hook invocation, or bundle it in the `detekt-rules/build/libs/` output. Claude's discretion per CONTEXT.md.

2. **Template-sync-validator extension vs separate sync check**
   - What we know: The existing template-sync-validator checks Claude commands vs wrapper templates vs Copilot prompts. The new hooks and copilot-instructions need parity verification.
   - What's unclear: Whether the existing agent's scope should expand or a dedicated check is cleaner.
   - Recommendation: Extend template-sync-validator with a new Step 8: HOOK-COPILOT PARITY check that compares the patterns enforced by hooks against those described in copilot-instructions.md. The existing agent already validates cross-surface consistency -- this is a natural extension.

3. **Build file auto-modification safety**
   - What we know: Setup scripts need to add `includeBuild("../../AndroidCommonDoc/build-logic")` to settings.gradle.kts and `id("androidcommondoc.toolkit")` to module build.gradle.kts files.
   - What's unclear: How to safely parse and modify Kotlin DSL build files without breaking existing content.
   - Recommendation: Use simple string insertion with marker comments (e.g., `// AndroidCommonDoc toolkit -- managed by setup script`). Always create `.bak` backup before modification. Require idempotency by checking if marker already exists.

## Sources

### Primary (HIGH confidence)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) - Complete hooks API including events, matchers, JSON I/O, decision control, settings locations
- [Gradle Pre-compiled Script Plugins](https://docs.gradle.org/current/userguide/implementing_gradle_plugins_precompiled.html) - Official docs for convention plugin mechanism
- [Gradle Convention Plugins](https://docs.gradle.org/current/userguide/implementing_gradle_plugins_convention.html) - Convention plugin patterns
- [Detekt Gradle Plugin](https://detekt.dev/docs/gettingstarted/gradle/) - Plugin ID `dev.detekt`, configuration API
- [Compose Rules Detekt Integration](https://mrmans0n.github.io/compose-rules/detekt/) - Artifact coordinates, Detekt 2.0 compatibility confirmed

### Secondary (MEDIUM confidence)
- [Detekt Convention Plugin (staticvar.dev)](https://staticvar.dev/post/detekt-convention-plugin/) - Implementation pattern for convention plugin with detektPlugins configuration
- [Jadarma Detekt Conventions (2025)](https://jadarma.github.io/blog/posts/2025/04/convenient-detekt-conventions/) - Build-logic structure and config patterns
- [GitHub Copilot Custom Instructions](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot) - `.github/copilot-instructions.md` format and `.instructions.md` with `applyTo`
- [Detekt 2.0 Maven Group Migration](https://github.com/detekt/detekt/issues/8432) - `dev.detekt` replaces `io.gitlab.arturbosch.detekt`

### Tertiary (LOW confidence)
- Detekt CLI standalone invocation from hook scripts -- no official docs found for running Detekt CLI with custom rules JAR outside of Gradle. The classpath approach is extrapolated from Detekt's own test infrastructure. Needs validation during implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All technologies are well-documented with official references. Versions match existing project state.
- Architecture: HIGH - Convention plugin pattern is well-established (Gradle official docs). Claude Code hooks API is thoroughly documented with exact JSON schemas.
- Pitfalls: HIGH - Pitfalls drawn from official docs (hook JSON purity, plugin ID migration) and verified community reports (detektPlugins scoping).
- Detekt CLI invocation: MEDIUM - Standalone CLI usage outside Gradle is less documented. May need adjustment during implementation.

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable patterns, unlikely to change)
