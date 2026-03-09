# Skills Reference — Claude Code + GitHub Copilot

Detailed usage guide for all AndroidCommonDoc skills. For setup and installation, see [README.md](README.md).

Both Claude Code and GitHub Copilot use the same skills backed by the same scripts:

| Claude Code | GitHub Copilot |
|------------|---------------|
| `.claude/commands/test.md` | `.github/prompts/test.prompt.md` |
| `.claude/commands/coverage.md` | `.github/prompts/coverage.prompt.md` |
| `CLAUDE.md` (project rules) | `.github/copilot-instructions.md` |
| _(none)_ | `.github/instructions/*.instructions.md` (path-specific) |

---

## Available Skills

| Skill | Description | Projects |
|-------|-------------|----------|
| `/test` | Run tests with smart retry | All |
| `/test-full` | Run ALL tests + full coverage report | All |
| `/test-full-parallel` | ALL tests in parallel (1 Gradle invocation, ~2-3x faster) | All |
| `/test-changed` | Run tests ONLY on modules with uncommitted changes | All |
| `/coverage` | Analyze coverage gaps (no test run) | All |
| `/coverage-full` | Complete coverage report from existing data | All |
| `/auto-cover` | Auto-generate tests for coverage gaps | All |
| `/extract-errors` | Extract build/test errors with fix suggestions | All |
| `/run` | Build, install and run app with log capture | All |
| `/android-test` | Run instrumented tests on device/emulator | Android |
| `/verify-kmp` | Validate KMP architecture | KMP only |
| `/sync-versions` | Compare dependency versions | KMP only |
| `/validate-patterns` | Validate code against documented patterns | Apps |
| `/sbom` | Generate CycloneDX SBOM | All |
| `/sbom-analyze` | Analyze SBOM dependencies and licenses | All |
| `/sbom-scan` | Scan SBOM for CVEs with Trivy | All |

---

## Skill Usage Examples

### /test - Run Tests

```
/test                                      # Auto-detect test type
/test core:domain                          # Module-specific tests
/test core:data --test-type common         # commonTest via desktopTest
/test feature:home --test-type androidUnit # androidUnitTest only
/test core:model --skip-coverage           # Skip coverage generation
/test core:data --coverage-tool jacoco     # Force JaCoCo coverage
```

### /test-full - Full Suite with Coverage

```
/test-full                                      # All applicable tests + report
/test-full --include-shared                     # Include shared-libs
/test-full --test-type common                   # Only commonTest
/test-full --skip-tests --min-lines 10          # Regenerate report only
/test-full --coverage-tool kover                # Use Kover instead of JaCoCo
```

### /test-full-parallel - Parallel Suite (Fast)

```
/test-full-parallel                                    # All tests, parallel
/test-full-parallel --include-shared                   # Include shared-libs
/test-full-parallel --fresh-daemon                     # Clean daemon first
/test-full-parallel --coverage-only                    # Only 4 core modules
/test-full-parallel --skip-tests --min-lines 5         # Report only
/test-full-parallel --coverage-tool jacoco             # Force JaCoCo coverage
```

### /test-changed - Changed Modules Only

```
/test-changed                               # Test all changed modules
/test-changed --show-modules                # Preview (dry run)
/test-changed --staged-only                 # Only staged changes
/test-changed --include-shared              # Include shared-libs
/test-changed --coverage-tool none          # Skip coverage generation
```

### /coverage - Analyze Coverage

```
/coverage                                   # All modules
/coverage --module-filter "core:domain"     # Specific module
/coverage --coverage-tool kover             # Use Kover reports
```

### /auto-cover - Generate Tests

```
/auto-cover core:domain                     # Generate tests for gaps
/auto-cover core:data --max-tests 5
/auto-cover feature:home --dry-run
/auto-cover core:model --coverage-tool jacoco
```

### /verify-kmp - Validate Architecture

```
/verify-kmp                                 # Whole project
/verify-kmp core:data                       # Specific module
/verify-kmp --strict --verbose
```

### /sync-versions - Compare Versions

```
/sync-versions                              # Compare with shared-libs
/sync-versions --projects MyProject
/sync-versions --source shared-libs --json
```

---

## Workflows

### Daily Development

1. **After writing code**: `/test-changed` (tests only changed modules)
2. **Before commit**: `/test-changed --staged-only`
3. **Before PR**: `/coverage` + `/verify-kmp`
4. **Compilation errors**: `/extract-errors`
5. **UI/integration tests**: `/test feature:devices --test-type androidInstrumented`

### Full Validation (Pre-PR / Pre-Release)

1. **Full suite (fast)**: `/test-full-parallel --include-shared`
2. **Cross-platform only**: `/test-full-parallel --test-type common`
3. **Android unit only**: `/test-full --test-type androidUnit`
4. **Review report**: See generated `coverage-full-report.md`

### Maintenance

1. **Align versions**: `/sync-versions --projects MyApp`
2. **Improve coverage**: `/auto-cover core:data --target 90`
3. **Review architecture**: `/verify-kmp --strict`
4. **View coverage gaps**: `/test-full --skip-tests --min-lines 5`

### CI/CD

Scripts can be used directly in CI pipelines:

```bash
# macOS / Linux
COMMON_DOC="${ANDROID_COMMON_DOC:?Set ANDROID_COMMON_DOC}"
bash "$COMMON_DOC/scripts/sh/run-parallel-coverage-suite.sh" --project-path .
```

```powershell
# Windows
& "$env:ANDROID_COMMON_DOC\scripts\ps1\run-parallel-coverage-suite.ps1" -ProjectPath .
```

---

## Local Configuration

Each project can override defaults via `.test-config.json`:

```json
{
  "coverageThresholds": {
    "minimum": 60,
    "target": 80
  },
  "skipModules": ["androidApp", "iosApp"],
  "defaultPlatform": "desktop"
}
```

---

## Updating Skills

Wrappers call central scripts at runtime. To update:

1. **Script change in AndroidCommonDoc** — applies automatically
2. **Template change** — re-run installer with `--force` / `-Force`
3. **New skill** — create template + re-run installer

---

## Troubleshooting

### "ANDROID_COMMON_DOC not set"

```bash
# macOS/Linux
echo $ANDROID_COMMON_DOC
# If empty: export ANDROID_COMMON_DOC="/absolute/path/to/AndroidCommonDoc"
```

```powershell
# Windows
echo $env:ANDROID_COMMON_DOC
# If empty: $env:ANDROID_COMMON_DOC = "C:\absolute\path\to\AndroidCommonDoc"
```

### Skills not appearing

1. Verify `.claude/commands/` (or `.github/prompts/`) exists in the project
2. Restart Claude Code / reload Copilot Chat
3. Run `/help` to see available skills

---

### Coverage Tool Selection

All test and coverage skills support `--coverage-tool`:

| Value | Behavior |
|-------|----------|
| `jacoco` | JaCoCo XML reports (default) |
| `kover` | Kover XML reports |
| `auto` | Auto-detect from project config |
| `none` | Skip coverage entirely |

---

Last updated: 2026-03-12
