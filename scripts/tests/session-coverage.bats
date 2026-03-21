#!/usr/bin/env bats
# =============================================================================
# Full coverage tests for session changes:
#  - PS1/SH function parity (structural)
#  - Kover fallback order and edge cases (functional)
#  - Workflow @master consistency (no @main)
#  - GH Actions expression syntax (no double-quoted string literals)
#  - README new sections coherence
#  - Setup wizard W0 auto-discovery documentation
#  - Coverage-detect lib 6/6 function parity
#  - auto-sync single-quote fix
# =============================================================================

L0_ROOT="$BATS_TEST_DIRNAME/../.."
SH_DIR="$L0_ROOT/scripts/sh"
PS1_DIR="$L0_ROOT/scripts/ps1"
SH_LIB="$SH_DIR/lib/coverage-detect.sh"
PS1_LIB="$PS1_DIR/lib/Coverage-Detect.ps1"
README="$L0_ROOT/README.md"
SETUP_SKILL="$L0_ROOT/skills/setup/SKILL.md"
TOPOLOGY_DOC="$L0_ROOT/docs/architecture/layer-topology.md"

setup() {
    source "$SH_LIB"
    WORK_DIR=$(mktemp -d)
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ===========================================================================
# A. PS1/SH lib function parity — structural (6/6)
# ===========================================================================

@test "parity: SH has 6 coverage-detect functions" {
    count=$(grep -c "^[a-z_]*() {" "$SH_LIB" | tr -d ' \r')
    [ "$count" -eq 6 ]
}

@test "parity: PS1 has 6 coverage-detect functions" {
    count=$(grep -c "^function " "$PS1_LIB" | tr -d ' \r')
    [ "$count" -eq 6 ]
}

@test "parity: Detect-CoverageTool exists in PS1" {
    grep -q "function Detect-CoverageTool" "$PS1_LIB"
}

@test "parity: Get-CoverageGradleTask exists in PS1" {
    grep -q "function Get-CoverageGradleTask" "$PS1_LIB"
}

@test "parity: Get-KoverTaskFallbacks exists in PS1" {
    grep -q "function Get-KoverTaskFallbacks" "$PS1_LIB"
}

@test "parity: Get-CoverageXmlPath exists in PS1" {
    grep -q "function Get-CoverageXmlPath" "$PS1_LIB"
}

@test "parity: Get-CoverageReportDir exists in PS1" {
    grep -q "function Get-CoverageReportDir" "$PS1_LIB"
}

@test "parity: Get-CoverageDisplayName exists in PS1" {
    grep -q "function Get-CoverageDisplayName" "$PS1_LIB"
}

@test "parity: PS1 Detect-CoverageTool checks build-logic" {
    grep -q "build-logic" "$PS1_LIB"
}

@test "parity: PS1 Detect-CoverageTool checks libs.versions.toml" {
    grep -q "libs.versions.toml" "$PS1_LIB"
}

@test "parity: PS1 Detect-CoverageTool checks kover report dir" {
    grep -q "reports/kover" "$PS1_LIB"
}

@test "parity: PS1 Detect-CoverageTool checks jacoco report dir" {
    grep -q "reports/jacoco" "$PS1_LIB"
}

@test "parity: PS1 Detect-CoverageTool defaults to jacoco" {
    # Last return in the function should be "jacoco"
    grep -q 'return "jacoco"' "$PS1_LIB"
}

@test "parity: PS1 run-parallel-coverage-suite has ExcludeCoverage" {
    grep -q "ExcludeCoverage" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

@test "parity: PS1 run-changed-modules-tests has ExcludeCoverage" {
    grep -q "ExcludeCoverage" "$PS1_DIR/run-changed-modules-tests.ps1"
}

@test "parity: PS1 run-parallel has kover fallback retry (Get-KoverTaskFallbacks)" {
    grep -q "Get-KoverTaskFallbacks" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

@test "parity: PS1 run-parallel has partial-success retry (missingCov)" {
    grep -q "missingCov\|Batch partial" "$PS1_DIR/run-parallel-coverage-suite.ps1"
}

@test "parity: PS1 gradle-run has kover fallback" {
    grep -q "fallback" "$PS1_DIR/gradle-run.ps1"
}

# ===========================================================================
# B. Kover fallback edge cases (functional)
# ===========================================================================

@test "kover fallbacks: desktop — all 3 task names are distinct" {
    result=$(get_kover_task_fallbacks "true")
    count=$(echo "$result" | tr ' ' '\n' | sort -u | wc -l | tr -d ' \r')
    [ "$count" -eq 3 ]
}

@test "kover fallbacks: non-desktop — all 3 task names are distinct" {
    result=$(get_kover_task_fallbacks "false")
    count=$(echo "$result" | tr ' ' '\n' | sort -u | wc -l | tr -d ' \r')
    [ "$count" -eq 3 ]
}

@test "kover fallbacks: desktop first is koverXmlReportDesktop" {
    first=$(get_kover_task_fallbacks "true" | awk '{print $1}')
    [ "$first" = "koverXmlReportDesktop" ]
}

@test "kover fallbacks: non-desktop first is koverXmlReportDebug" {
    first=$(get_kover_task_fallbacks "false" | awk '{print $1}')
    [ "$first" = "koverXmlReportDebug" ]
}

@test "kover fallbacks: koverXmlReport (plain) always present in desktop" {
    result=$(get_kover_task_fallbacks "true")
    echo "$result" | grep -q "koverXmlReport "
}

@test "kover fallbacks: koverXmlReport (plain) always present in non-desktop" {
    result=$(get_kover_task_fallbacks "false")
    echo "$result" | grep -q "koverXmlReport "
}

@test "kover fallbacks: desktop and non-desktop have different ordering" {
    desk=$(get_kover_task_fallbacks "true" | awk '{print $1}')
    nodk=$(get_kover_task_fallbacks "false" | awk '{print $1}')
    [ "$desk" != "$nodk" ]
}

# ===========================================================================
# C. Workflow @master consistency (no @main)
# ===========================================================================

@test "workflow: reusable-architecture-guards uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/.github/workflows/reusable-architecture-guards.yml"
    grep -q "@master" "$L0_ROOT/.github/workflows/reusable-architecture-guards.yml"
}

@test "workflow: reusable-audit-report uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/.github/workflows/reusable-audit-report.yml"
    grep -q "@master" "$L0_ROOT/.github/workflows/reusable-audit-report.yml"
}

@test "workflow: reusable-commit-lint uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/.github/workflows/reusable-commit-lint.yml"
    grep -q "@master" "$L0_ROOT/.github/workflows/reusable-commit-lint.yml"
}

@test "workflow: reusable-kmp-safety-check uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/.github/workflows/reusable-kmp-safety-check.yml"
    grep -q "@master" "$L0_ROOT/.github/workflows/reusable-kmp-safety-check.yml"
}

@test "workflow: reusable-lint-resources uses @master not @main" {
    ! grep -q "@main" "$L0_ROOT/.github/workflows/reusable-lint-resources.yml"
    grep -q "@master" "$L0_ROOT/.github/workflows/reusable-lint-resources.yml"
}

@test "workflow: README workflow examples use @master not @main" {
    ! grep -q "reusable-.*@main" "$README"
    grep -q "reusable-.*@master" "$README"
}

@test "workflow: all reusable workflows have @master" {
    for wf in "$L0_ROOT"/.github/workflows/reusable-*.yml; do
        if grep -q "@main" "$wf"; then
            echo "FAIL: $(basename "$wf") has @main"
            return 1
        fi
    done
}

# ===========================================================================
# D. GH Actions expression syntax — no double-quoted string literals
# ===========================================================================

@test "syntax: auto-sync template has no double-quoted literals in expressions" {
    # ${{ ... || "value" }} is invalid — must be ${{ ... || 'value' }}
    ! grep -E '\$\{\{[^}]*\|\|[^}]*"[A-Za-z]' "$L0_ROOT/setup/templates/workflows/l0-auto-sync.yml"
}

@test "syntax: dispatch workflow has no double-quoted literals in expressions" {
    ! grep -E '\$\{\{[^}]*\|\|[^}]*"[A-Za-z]' "$L0_ROOT/.github/workflows/l0-sync-dispatch.yml"
}

@test "syntax: auto-sync SOURCE_LAYER uses single quotes" {
    grep -q "|| 'L0'" "$L0_ROOT/setup/templates/workflows/l0-auto-sync.yml"
}

@test "syntax: auto-sync SOURCE_COMMIT uses single quotes" {
    grep -q "|| 'scheduled'" "$L0_ROOT/setup/templates/workflows/l0-auto-sync.yml"
}

# ===========================================================================
# E. README new sections coherence
# ===========================================================================

@test "README: coverage-detect description mentions all detection paths" {
    desc=$(grep "coverage-detect" "$README" | grep "^|" | head -1)
    echo "$desc" | grep -q "build file"
    echo "$desc" | grep -q "build-logic"
    echo "$desc" | grep -q "libs.versions.toml"
}

@test "README: run-parallel description mentions auto-detect" {
    desc=$(grep "run-parallel-coverage-suite" "$README" | grep "^|" | head -1)
    echo "$desc" | grep -q "auto-detect\|Auto-detect"
}

@test "README: run-parallel description mentions exclude-coverage" {
    desc=$(grep "run-parallel-coverage-suite" "$README" | grep "^|" | head -1)
    echo "$desc" | grep -q "exclude-coverage"
}

@test "README: coverage workflow has step 4b KOVER RECOVERY" {
    grep -q "4b.*KOVER RECOVERY\|KOVER RECOVERY" "$README"
}

@test "README: coverage workflow has step 2 EXCLUDE" {
    grep -q "DISCOVER MODULES.*EXCLUDE\|exclude-coverage" "$README"
}

@test "README: Updating section has Automatic and Manual subsections" {
    grep -q "### Automatic" "$README"
    grep -q "### Manual" "$README"
}

@test "README: Updating section describes dispatch + cron" {
    grep -q "dispatch" "$README"
    grep -q "cron\|daily" "$README"
}

@test "README: skills note mentions --exclude-coverage" {
    grep -q 'exclude-coverage.*modules\|--exclude-coverage' "$README"
}

@test "README: directory tree includes l0-sync-dispatch.yml" {
    grep -q "l0-sync-dispatch.yml" "$README"
}

@test "README: directory tree includes l0-auto-sync.yml" {
    grep -q "l0-auto-sync.yml" "$README"
}

# ===========================================================================
# F. Setup wizard W0 auto-discovery docs
# ===========================================================================

@test "wizard W0: mentions auto-discovery" {
    grep -q "auto-discover\|Auto-discover\|discoverLayers\|discovery" "$SETUP_SKILL"
}

@test "wizard W0: documents L0 marker (registry + mcp-server)" {
    grep -q "registry.json.*mcp-server\|mcp-server.*registry" "$SETUP_SKILL" || \
    grep -q "skills/registry.json" "$SETUP_SKILL"
}

@test "wizard W0: documents L1 marker (registry + manifest)" {
    grep -q "registry.json.*l0-manifest\|l0-manifest.*registry" "$SETUP_SKILL" || \
    grep -q "L1.*registry.*manifest\|L1.*manifest.*registry" "$SETUP_SKILL"
}

@test "wizard W0: references layer-discovery.ts" {
    grep -q "layer-discovery" "$SETUP_SKILL"
}

@test "wizard W0: suggests topology based on discovery" {
    grep -q "suggestTopology\|Suggested topology\|suggest.*topology" "$SETUP_SKILL"
}

@test "wizard W0: allows manual fallback" {
    grep -q "manually\|manual\|enter paths" "$SETUP_SKILL"
}

# ===========================================================================
# G. Layer topology doc — auto-sync completeness
# ===========================================================================

@test "topology doc: has dispatch and cron subsections" {
    grep -q "### 1.*Dispatch\|Dispatch.*instant" "$TOPOLOGY_DOC"
    grep -q "### 2.*Scheduled\|Scheduled.*safety" "$TOPOLOGY_DOC"
}

@test "topology doc: setup instructions for L0 and downstream" {
    grep -q "L0.*source\|downstream" "$TOPOLOGY_DOC"
    grep -q "downstream-repos.json" "$TOPOLOGY_DOC"
}

@test "topology doc: mentions DOWNSTREAM_SYNC_TOKEN" {
    grep -q "DOWNSTREAM_SYNC_TOKEN" "$TOPOLOGY_DOC"
}

@test "topology doc: cross-references both workflow files" {
    grep -q "l0-sync-dispatch.yml" "$TOPOLOGY_DOC"
    grep -q "l0-auto-sync.yml" "$TOPOLOGY_DOC"
}

# ===========================================================================
# H. Detection functional: build-logic + libs.versions.toml paths
# ===========================================================================

@test "detect: convention plugin in build-logic .gradle.kts file" {
    mkdir -p "$WORK_DIR/project/feature/home"
    mkdir -p "$WORK_DIR/project/build-logic/convention"
    echo '' > "$WORK_DIR/project/settings.gradle.kts"
    echo 'android {}' > "$WORK_DIR/project/feature/home/build.gradle.kts"
    echo '// clean' > "$WORK_DIR/project/build.gradle.kts"
    echo 'plugins { id("org.jetbrains.kotlinx.kover") }' > "$WORK_DIR/project/build-logic/convention/module.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/project/feature/home/build.gradle.kts")
    [ "$result" = "kover" ]
}

@test "detect: libs.versions.toml with kover plugin alias" {
    mkdir -p "$WORK_DIR/project/module"
    mkdir -p "$WORK_DIR/project/gradle"
    echo '' > "$WORK_DIR/project/settings.gradle.kts"
    echo 'android {}' > "$WORK_DIR/project/module/build.gradle.kts"
    echo '// clean' > "$WORK_DIR/project/build.gradle.kts"
    printf '[plugins]\nkover = { id = "org.jetbrains.kotlinx.kover", version.ref = "kover" }' > "$WORK_DIR/project/gradle/libs.versions.toml"
    result=$(detect_coverage_tool "$WORK_DIR/project/module/build.gradle.kts")
    [ "$result" = "kover" ]
}

@test "detect: neither build-logic nor toml → defaults to jacoco" {
    mkdir -p "$WORK_DIR/project/module"
    mkdir -p "$WORK_DIR/project/gradle"
    echo '' > "$WORK_DIR/project/settings.gradle.kts"
    echo 'android {}' > "$WORK_DIR/project/module/build.gradle.kts"
    echo '// no kover anywhere' > "$WORK_DIR/project/build.gradle.kts"
    # Empty gradle dir and no build-logic
    echo '# empty' > "$WORK_DIR/project/gradle/libs.versions.toml"
    result=$(detect_coverage_tool "$WORK_DIR/project/module/build.gradle.kts")
    [ "$result" = "jacoco" ]
}

@test "detect: xml path for kover desktop variant" {
    mkdir -p "$WORK_DIR/mod/build/reports/kover"
    echo '<r/>' > "$WORK_DIR/mod/build/reports/kover/reportDesktop.xml"
    result=$(get_coverage_xml_path "kover" "$WORK_DIR/mod" "true")
    echo "$result" | grep -q "reportDesktop.xml"
}

@test "detect: xml path for kover falls back to any .xml" {
    mkdir -p "$WORK_DIR/mod/build/reports/kover"
    echo '<r/>' > "$WORK_DIR/mod/build/reports/kover/custom.xml"
    result=$(get_coverage_xml_path "kover" "$WORK_DIR/mod" "true")
    echo "$result" | grep -q "custom.xml"
}

@test "detect: report dir for kover is build/reports/kover" {
    result=$(get_coverage_report_dir "kover")
    [ "$result" = "build/reports/kover" ]
}

@test "detect: report dir for jacoco is build/reports/jacoco" {
    result=$(get_coverage_report_dir "jacoco")
    [ "$result" = "build/reports/jacoco" ]
}
