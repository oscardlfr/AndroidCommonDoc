# AndroidCommonDoc MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that exposes the AndroidCommonDoc toolkit -- pattern docs, skill definitions, validation tools, and architecture review prompts -- for AI agent consumption via the stdio transport.

## Overview

This server makes the AndroidCommonDoc toolkit programmatically accessible to Claude Code and other MCP-compatible clients. Instead of manually searching documentation or running validation scripts, an AI agent can:

- **Read** pattern documentation as MCP resources
- **Invoke** validation tools that wrap quality gate scripts
- **Use** curated prompt templates for architecture and PR review

The server communicates over **stdio** using JSON-RPC, running as a subprocess managed by Claude Code. All logging goes to stderr to keep the JSON-RPC stream on stdout clean.

## Prerequisites

- **Node.js** >= 18 (tested with v24)
- **Git Bash** on Windows (for shell script execution via validation tools)
- **Claude Code** (for MCP registration and usage)

## Installation

```bash
cd mcp-server
npm install
npm run build
```

## Registration with Claude Code

Register the compiled server with Claude Code using the `claude mcp add` command:

```bash
claude mcp add \
  --transport stdio \
  --env ANDROID_COMMON_DOC="C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc" \
  androidcommondoc \
  -- node "C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc/mcp-server/build/index.js"
```

Verify registration:

```bash
claude mcp list
```

You should see `androidcommondoc` in the output. Claude Code will automatically start the server as a subprocess when needed.

> **Note:** Use `node build/index.js` directly -- not `npx`. On Windows, `npx` uses a `.cmd` wrapper that can corrupt the stdio transport.

## Architecture

```
mcp-server/
  src/
    index.ts              # Entry point: stdio transport connection
    server.ts             # Server factory (testable via InMemoryTransport)
    resources/
      index.ts            # Resource registration aggregator
      docs.ts             # 9 pattern doc resources (docs://)
      skills.ts           # Dynamic skill resources (skills://)
      changelog.ts        # Changelog resource (changelog://)
    tools/
      index.ts            # Tool registration aggregator + rate limiter
      check-freshness.ts  # Doc freshness validation
      verify-kmp.ts       # KMP package verification
      check-version-sync.ts  # Version sync check
      script-parity.ts    # SH/PS1 script parity
      setup-check.ts      # Project setup validation
      validate-all.ts     # Meta-tool: run all gates
    prompts/
      index.ts            # Prompt registration aggregator
      architecture-review.ts  # Architecture review prompt
      pr-review.ts        # PR review prompt
      onboarding.ts       # Developer onboarding prompt
    utils/
      logger.ts           # stderr-only logger (MCP-05 compliance)
      paths.ts            # Toolkit root / docs / skills path resolution
      script-runner.ts    # Cross-platform execFile wrapper
      rate-limiter.ts     # Sliding window rate limiter
      rate-limit-guard.ts # Rate limit check utility
    types/
      results.ts          # ValidationResult, ToolResult types
  tests/
    unit/                 # Unit tests per module
    integration/          # Full integration + stdio cleanliness tests
```

**Key patterns:**
- **Server factory:** `createServer()` returns a configured `McpServer` without binding to a transport, enabling testing via `InMemoryTransport`.
- **stderr-only logging:** All output goes to `console.error()`. An ESLint `no-console` rule prevents accidental `console.log()` usage that would corrupt the JSON-RPC stream.
- **Rate limiting:** A shared sliding window limiter (30 calls / 60 seconds) prevents runaway agent loops across all tools.

## Resources

Resources are read-only content available via `client.readResource()`.

### Pattern Documentation (`docs://`)

| Resource URI | Description |
|---|---|
| `docs://androidcommondoc/kmp-architecture` | Kotlin Multiplatform architecture and source set hierarchy |
| `docs://androidcommondoc/viewmodel-state-patterns` | ViewModel UiState, StateFlow, and event handling patterns |
| `docs://androidcommondoc/testing-patterns` | Testing with runTest, fakes, UnconfinedTestDispatcher |
| `docs://androidcommondoc/ui-screen-patterns` | Compose screen structure, navigation, state hoisting |
| `docs://androidcommondoc/compose-resources-patterns` | Compose resource placement and multi-module patterns |
| `docs://androidcommondoc/gradle-patterns` | Gradle build patterns, convention plugins, version catalog |
| `docs://androidcommondoc/offline-first-patterns` | Offline-first data architecture patterns |
| `docs://androidcommondoc/resource-management-patterns` | Resource management and lifecycle patterns |
| `docs://androidcommondoc/enterprise-integration` | Enterprise integration proposal (translated from Spanish) |

### Skill Definitions (`skills://`)

Dynamic resources discovered from the `skills/` directory at request time.

| Resource URI | Description |
|---|---|
| `skills://androidcommondoc/{skillName}` | SKILL.md content for any skill (e.g., `verify-kmp`, `test-full`, `coverage`) |

Use `client.listResources()` to discover all available skills.

### Changelog (`changelog://`)

| Resource URI | Description |
|---|---|
| `changelog://androidcommondoc/latest` | Recent git history + RETROSPECTIVE.md content |

## Tools

Tools are invocable operations via `client.callTool()`. All tools return structured JSON with a `status` field (`PASS`, `FAIL`, `ERROR`, or `TIMEOUT`).

| Tool Name | Description | Input Schema |
|---|---|---|
| `check-doc-freshness` | Compare version references in pattern docs against versions-manifest.json | `{ projectRoot?: string }` |
| `verify-kmp-packages` | Validate KMP package organization and detect forbidden imports | `{ projectRoot: string, modulePath?: string, strict?: boolean }` |
| `check-version-sync` | Check version synchronization across version catalog and consumers | `{ projectRoot?: string }` |
| `script-parity` | Validate that scripts/sh/ and scripts/ps1/ have matching basenames | `{ projectRoot?: string }` |
| `setup-check` | Validate project configuration: env var, docs, scripts, skills, agents | `{ projectRoot?: string }` |
| `validate-all` | Run all validation gates and return combined PASS/FAIL results | `{ projectRoot?: string, gates?: string }` |
| `rate-limit-status` | Check current rate limit status (30 calls per minute) | `{}` |

**Rate limiting:** All tools share a 30-calls-per-60-seconds rate limiter. The `rate-limit-status` tool reports current limits.

## Prompts

Prompts are curated message templates via `client.getPrompt()`.

| Prompt Name | Description | Arguments |
|---|---|---|
| `architecture-review` | Review Kotlin code against architecture patterns, citing specific rules | `code: string`, `layer?: "ui" \| "viewmodel" \| "domain" \| "data" \| "model"` |
| `pr-review` | Review a git diff against relevant pattern docs | `diff: string`, `focusAreas?: string` (comma-separated: viewmodel, testing, ui, kmp, etc.) |
| `onboarding` | Guide new developers through toolkit patterns and setup | `projectType?: "android" \| "kmp" \| "ios"` |

## Development

### Build

```bash
npm run build    # TypeScript compilation to build/
```

### Test

```bash
npm test         # Run all tests (Vitest)
npm run test:watch  # Watch mode
```

### Lint and Format

```bash
npm run lint     # ESLint (enforces no-console, TypeScript rules)
npm run format   # Prettier formatting
```

### Run locally

```bash
npm start        # Starts server on stdio (for testing with MCP Inspector)
```

## CI

GitHub Actions runs on every push and PR to `main`/`master` when `mcp-server/` files change.

**Matrix:** Ubuntu + Windows (to verify MCP-05 stdio cleanliness on Windows)

**Steps:** Install dependencies, build TypeScript, run tests, lint.

See `.github/workflows/mcp-server-ci.yml`.

## Troubleshooting

### "Connection closed" when registering with Claude Code
- **Cause:** stdout corruption from stray `console.log()` or Windows `npx` wrapper.
- **Fix:** Always use `node build/index.js` directly (not `npx`). Verify no `console.log` in source: `npm run lint` catches violations.

### Scripts fail with "File not found"
- **Cause:** Working directory mismatch. Claude Code launches the subprocess from an arbitrary directory.
- **Fix:** Set the `ANDROID_COMMON_DOC` environment variable via `--env` flag in `claude mcp add`. The server resolves all paths relative to this root.

### "Cannot find module" at runtime
- **Cause:** Missing `.js` extensions in TypeScript imports.
- **Fix:** Run `npm run build` to recompile. All imports use `.js` extensions per ES Module + Node16 resolution requirements.

### Validation tools time out
- **Cause:** Target project is large or scripts are slow.
- **Fix:** All tool executions have a 30-second timeout. If a specific script needs more time, pass `projectRoot` to target a specific subtree.

### Rate limit errors
- **Cause:** More than 30 tool calls in 60 seconds (usually a runaway agent loop).
- **Fix:** Wait 60 seconds for the window to reset, or check `rate-limit-status` tool for current limits.
