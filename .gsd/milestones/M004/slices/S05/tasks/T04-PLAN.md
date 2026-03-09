# T04: 14.3-skill-materialization-registry 04

**Slice:** S05 — **Milestone:** M004

## Description

Build the skill validation MCP tool (MATL-06) and simplify the Claude Code adapter pipeline by removing the 16 redundant adapter-generated commands from L0 (MATL-04). Claude Code discovers skills/*/SKILL.md directly -- no intermediate command generation needed.

Purpose: Validation tool provides a safety net against broken skills. Adapter simplification removes redundant intermediaries.
Output: `validate-skills.ts` MCP tool + 16 generated commands deleted from L0 + updated adapter

## Must-Haves

- [ ] "Skill validation tool parses all SKILL.md files and verifies frontmatter completeness"
- [ ] "Validation checks referenced scripts exist on disk"
- [ ] "Validation checks registry.json is in sync with filesystem"
- [ ] "16 adapter-generated commands removed from L0 .claude/commands/ (Claude Code reads skills directly)"
- [ ] "16 standalone commands remain in .claude/commands/"
- [ ] "Copilot adapter retained and still works"

## Files

- `mcp-server/src/tools/validate-skills.ts`
- `mcp-server/tests/unit/tools/validate-skills.test.ts`
- `mcp-server/src/tools/index.ts`
- `.claude/commands/android-test.md`
- `.claude/commands/auto-cover.md`
- `.claude/commands/coverage.md`
- `.claude/commands/coverage-full.md`
- `.claude/commands/extract-errors.md`
- `.claude/commands/run.md`
- `.claude/commands/sbom.md`
- `.claude/commands/sbom-analyze.md`
- `.claude/commands/sbom-scan.md`
- `.claude/commands/sync-versions.md`
- `.claude/commands/test.md`
- `.claude/commands/test-changed.md`
- `.claude/commands/test-full.md`
- `.claude/commands/test-full-parallel.md`
- `.claude/commands/validate-patterns.md`
- `.claude/commands/verify-kmp.md`
- `adapters/claude-adapter.sh`
