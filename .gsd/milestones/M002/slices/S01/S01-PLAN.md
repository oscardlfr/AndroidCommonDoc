# S01: Tech Debt Foundation

**Goal:** Add ANDROID_COMMON_DOC env var guards to all 8 consumer-facing scripts (4 SH + 4 PS1) and make install-copilot-prompts.
**Demo:** Add ANDROID_COMMON_DOC env var guards to all 8 consumer-facing scripts (4 SH + 4 PS1) and make install-copilot-prompts.

## Must-Haves


## Tasks

- [x] **T01: 05-tech-debt-foundation 01**
  - Add ANDROID_COMMON_DOC env var guards to all 8 consumer-facing scripts (4 SH + 4 PS1) and make install-copilot-prompts.sh/ps1 deliver copilot-instructions-generated.md standalone, removing the duplicate logic from setup-toolkit.sh/ps1.

Purpose: Ensure scripts fail fast with actionable errors instead of cryptic Gradle crashes when the env var is missing or points to a bad path. Make the copilot install script self-sufficient so it works independently of setup-toolkit.
Output: 8 modified scripts with env guards, install-copilot-prompts.sh/ps1 delivering all copilot artifacts, setup-toolkit.sh/ps1 Step 4 simplified to pure delegation.
- [x] **T02: 05-tech-debt-foundation 02**
  - Refactor quality-gate-orchestrator.md to delegate to individual gate agents instead of inlining their logic, and delete the 5 orphaned validate-phase01-*.sh scripts.

Purpose: Eliminate the drift problem where the orchestrator's inlined copy of gate logic falls behind individual agent updates (this already caused INT-05 in v1.0). Clean up orphaned scripts that produce noise in quality gate runs.
Output: Slim orchestrator (~80-100 lines) that reads individual agents at runtime. 5 orphaned scripts deleted.

## Files Likely Touched

- `setup/setup-toolkit.sh`
- `setup/setup-toolkit.ps1`
- `setup/install-copilot-prompts.sh`
- `setup/Install-CopilotPrompts.ps1`
- `setup/install-claude-skills.sh`
- `setup/Install-ClaudeSkills.ps1`
- `setup/install-hooks.sh`
- `setup/Install-Hooks.ps1`
- `.claude/agents/quality-gate-orchestrator.md`
- `scripts/sh/validate-phase01-pattern-docs.sh`
- `scripts/sh/validate-phase01-param-manifest.sh`
- `scripts/sh/validate-phase01-skill-pipeline.sh`
- `scripts/sh/validate-phase01-agents-md.sh`
- `scripts/sh/validate-phase01-param-drift.sh`
