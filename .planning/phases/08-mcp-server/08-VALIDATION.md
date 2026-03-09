---
phase: 8
slug: mcp-server
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | `mcp-server/vitest.config.ts` (Wave 0 installs) |
| **Quick run command** | `cd mcp-server && npx vitest run` |
| **Full suite command** | `cd mcp-server && npx vitest run --coverage` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd mcp-server && npx vitest run`
- **After every plan wave:** Run `cd mcp-server && npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | MCP-01 | integration | `cd mcp-server && npx vitest run tests/integration/stdio-transport.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | MCP-02 | unit | `cd mcp-server && npx vitest run tests/unit/resources/docs.test.ts` | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 2 | MCP-03 | unit | `cd mcp-server && npx vitest run tests/unit/tools/` | ❌ W0 | ⬜ pending |
| 08-04-01 | 04 | 2 | MCP-04 | unit | `cd mcp-server && npx vitest run tests/unit/prompts/` | ❌ W0 | ⬜ pending |
| 08-05-01 | 01 | 1 | MCP-05 | unit+integration | `cd mcp-server && npx vitest run tests/unit/utils/logger.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `mcp-server/package.json` — project initialization with all dependencies
- [ ] `mcp-server/tsconfig.json` — TypeScript configuration
- [ ] `mcp-server/vitest.config.ts` — Vitest configuration
- [ ] `mcp-server/eslint.config.mjs` — ESLint flat config
- [ ] `mcp-server/.prettierrc` — Prettier configuration
- [ ] `mcp-server/tests/` directory structure — test scaffolding
- [ ] `docs/enterprise-integration-proposal.md` — English translation of propuesta-integracion-enterprise.md

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `claude mcp add` registers server | MCP-01 | Requires Claude Code CLI interaction | Run `claude mcp add --transport stdio androidcommondoc -- node mcp-server/build/index.js`, then `claude mcp list` |
| Claude Code lists tools/resources/prompts | MCP-01 | Requires Claude Code runtime | Start Claude Code, verify tools/resources/prompts appear in available tools |
| Server works on Windows without stdio corruption | MCP-05 | Requires Windows runtime environment | Start server via Claude Code on Windows, invoke a tool, verify no "Connection closed" errors |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
