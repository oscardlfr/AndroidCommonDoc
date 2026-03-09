# T06: 10-doc-intelligence-detekt-generation 06

**Slice:** S06 — **Milestone:** M002

## Description

Create three new skills for AI agent access, a CLI entrypoint for CI use, and a GitHub Actions cron workflow for scheduled monitoring.

Purpose: Completes the multi-tool surface (MCP tools + skills + CI) so monitoring and rule generation are accessible from Claude Code, Copilot, and automated CI pipelines. Skills follow existing SKILL.md format.
Output: 3 skills, CI workflow, CLI entrypoint.

## Must-Haves

- [ ] "Three new skills exist in skills/ directory following existing SKILL.md format"
- [ ] "GitHub Actions cron workflow runs tiered monitoring on schedule"
- [ ] "CI workflow produces downloadable artifact report (not GitHub Issues)"
- [ ] "CLI entrypoint enables CI to run monitoring without MCP transport"
- [ ] "Skills reference MCP tools for programmatic access"

## Files

- `skills/monitor-docs/SKILL.md`
- `skills/generate-rules/SKILL.md`
- `skills/ingest-content/SKILL.md`
- `.github/workflows/doc-monitor.yml`
- `mcp-server/src/cli/monitor-sources.ts`
- `mcp-server/package.json`
