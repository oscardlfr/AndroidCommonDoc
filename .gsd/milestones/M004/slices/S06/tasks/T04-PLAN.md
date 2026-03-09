# T04: 15-claude-md-ecosystem-alignment 04

**Slice:** S06 — **Milestone:** M004

## Description

Run smoke tests to verify behavioral rules are preserved, build Copilot adapter for CLAUDE.md, and perform final ecosystem validation with human checkpoint.

Purpose: Prove that the CLAUDE.md rewrite preserved every behavioral rule (no silent drops), extend the adapter pipeline to generate Copilot instructions from CLAUDE.md as SSOT, and get human confirmation that the ecosystem is coherent.
Output: Copilot adapter, integration tests, smoke test results, human-verified ecosystem

## Must-Haves

- [ ] "Smoke test confirms all behavioral rules from canonical checklist are preserved in the rewritten CLAUDE.md files"
- [ ] "Copilot instructions generated from rewritten CLAUDE.md files for at least AndroidCommonDoc project"
- [ ] "Integration test validates all 4 CLAUDE.md files against template structure and canonical coverage"
- [ ] "Human verifies that CLAUDE.md ecosystem is coherent and the delegation model works"

## Files

- `adapters/claude-md-copilot-adapter.sh`
- `adapters/generate-all.sh`
- `mcp-server/tests/integration/claude-md-validation.test.ts`
