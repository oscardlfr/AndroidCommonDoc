# T01: 05-tech-debt-foundation 01

**Slice:** S01 — **Milestone:** M002

## Description

Add ANDROID_COMMON_DOC env var guards to all 8 consumer-facing scripts (4 SH + 4 PS1) and make install-copilot-prompts.sh/ps1 deliver copilot-instructions-generated.md standalone, removing the duplicate logic from setup-toolkit.sh/ps1.

Purpose: Ensure scripts fail fast with actionable errors instead of cryptic Gradle crashes when the env var is missing or points to a bad path. Make the copilot install script self-sufficient so it works independently of setup-toolkit.
Output: 8 modified scripts with env guards, install-copilot-prompts.sh/ps1 delivering all copilot artifacts, setup-toolkit.sh/ps1 Step 4 simplified to pure delegation.

## Must-Haves

- [ ] "Running any setup/install script without ANDROID_COMMON_DOC set exits with code 1 and a clear error showing the exact export command"
- [ ] "Running any setup/install script with ANDROID_COMMON_DOC pointing to a nonexistent directory exits with code 1 and a distinct error"
- [ ] "install-copilot-prompts.sh run standalone delivers .prompt.md, .instructions.md, AND copilot-instructions-generated.md"
- [ ] "setup-toolkit.sh Step 4 no longer has inline copilot-instructions-generated.md delivery logic"
- [ ] "If copilot-instructions-generated.md is missing, install-copilot-prompts.sh warns and skips (does not fail)"

## Files

- `setup/setup-toolkit.sh`
- `setup/setup-toolkit.ps1`
- `setup/install-copilot-prompts.sh`
- `setup/Install-CopilotPrompts.ps1`
- `setup/install-claude-skills.sh`
- `setup/Install-ClaudeSkills.ps1`
- `setup/install-hooks.sh`
- `setup/Install-Hooks.ps1`
