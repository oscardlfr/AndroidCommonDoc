# Phase 8: MCP Server - Research

**Researched:** 2026-03-13
**Domain:** MCP (Model Context Protocol) server with TypeScript SDK, stdio transport, Claude Code integration
**Confidence:** HIGH

## Summary

Phase 8 exposes the AndroidCommonDoc toolkit (pattern docs, skill definitions, validation commands, architecture review prompts) as a standards-compliant MCP server running as a Claude Code subprocess via stdio transport. The TypeScript MCP SDK v1.27.1 is the locked technology choice (production-ready, stable, well-documented). The server is read-only/advisory with no write capabilities.

The MCP TypeScript SDK v1.27.1 provides a high-level `McpServer` class with `registerResource()`, `registerTool()`, and `registerPrompt()` methods that use Zod v3 schemas for input validation. The stdio transport (`StdioServerTransport`) communicates over stdin/stdout with JSON-RPC. The critical Windows constraint is that `console.log()` must NEVER be used -- all logging must go to `console.error()` (stderr) to avoid corrupting the JSON-RPC protocol stream on stdout.

**Primary recommendation:** Build a single TypeScript MCP server in `mcp-server/` at the repo root, using ES Modules, compiled with `tsc`, tested with Vitest, registered via `claude mcp add --transport stdio`. Use `@modelcontextprotocol/sdk@1.27.1` with `zod@3`. Expose 9 docs as resources, 5+ validation scripts as tools, and curated architecture review prompts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- TypeScript compiled (not plain JavaScript) -- type safety, IDE support, enterprise quality
- Full test suite -- unit tests for each tool/resource/prompt handler, integration tests for stdio transport
- ESLint + Prettier for code quality and formatting
- GitHub Actions CI workflow for automated testing on push/PR
- Full README.md with setup instructions, architecture overview, and API reference
- Include a changelog/what's-new resource that summarizes recent changes to patterns, skills, and rules
- Translate `propuesta-integracion-enterprise.md` to English so all resources are consistently English
- Include a consolidated 'validate-all' meta-tool that runs every validation and returns combined results
- Include a setup validation tool that checks if a project is properly configured (env var, hooks, skills, Detekt)
- Report-only approach -- consistent with advisory/no-write-capabilities philosophy
- Configurable rate limiting to prevent runaway agent loops -- defensive enterprise design
- Include a PR-level review prompt that takes a diff and reviews all changed files against relevant patterns
- Include an onboarding prompt that guides new developers through toolkit patterns and setup

### Claude's Discretion
- URI scheme design and resource organization
- Which specific validation scripts become MCP tools
- JSON output schema design
- Script execution and caching strategy
- Prompt content and structure decisions
- Server architecture (monolithic vs plugin system)
- Cross-project and multi-project support
- Authentication (likely none needed for stdio-only)
- Error telemetry approach
- Token-efficient condensed resource format
- Usage analytics
- Batch validation and parallel execution
- Pattern compliance metrics
- Doc search tool
- Skill recommendation intelligence
- Lint configuration resource exposure
- Server location in repo (mcp-server/ at root vs tools/mcp-server/)
- Registration approach (claude mcp add, setup-toolkit.sh, or both)
- Package.json dependencies vs bundled/zero-dependency
- npm publishing vs local-repo-only
- Config approach (config file vs CLI args vs env vars)
- Type exports for external TS consumers
- Test framework (Vitest/Jest/Node test runner)
- Docker support
- Module system (ES Modules vs CommonJS)
- Version endpoint, graceful shutdown, --version flag
- Dynamic filesystem scan vs hardcoded manifest
- Resource templates (parameterized URIs)
- File watching / live update notifications
- Whether skills (16 SKILL.md files) are also exposed as resources
- Whether meta docs (CLAUDE.md/AGENTS.md) are exposed as resources

### Deferred Ideas (OUT OF SCOPE)
- Optional webhooks to external systems (Slack, GitHub) for validation failure notifications
- Streamable HTTP transport (SSE) -- tracked as MCPX-01 in future requirements
- npm publishing for public distribution
- Plugin system for extensibility
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | MCP server skeleton with stdio transport runs as Claude Code subprocess | McpServer + StdioServerTransport from @modelcontextprotocol/sdk v1.27.1; `claude mcp add --transport stdio` registration; ES Module project with TypeScript compilation |
| MCP-02 | 8 pattern docs exposed as MCP resources with docs:// URI scheme | `server.registerResource()` with static URI per doc; docs:// scheme with `docs://androidcommondoc/{name}` pattern; read docs/*.md at runtime |
| MCP-03 | Top 5 validation commands exposed as MCP tools with structured JSON results | `server.registerTool()` with Zod schemas; spawn shell scripts via `child_process.execFile`; parse colored output into structured JSON |
| MCP-04 | Architecture review prompt templates exposed as MCP prompts | `server.registerPrompt()` with argsSchema; Zod for argument validation; return messages array with role/content |
| MCP-05 | MCP server tested on Windows with no stdio corruption | stderr-only logging via `console.error()`; never use `console.log()`; Windows `cmd /c` wrapper for npx; Vitest test suite verifying clean stdout |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.27.1 | MCP server SDK (McpServer, StdioServerTransport, ResourceTemplate) | Official TypeScript SDK; production-ready v1.x; locked decision from roadmap |
| zod | 3.24.x | Schema validation for tool inputs and prompt arguments | Peer dependency of MCP SDK v1.27.1; required for registerTool/registerPrompt |
| typescript | 5.7.x | TypeScript compiler | Locked decision: TypeScript compiled |
| node.js | 24.x (installed: 24.12.0) | Runtime | Already installed on dev machine; MCP SDK supports Node.js |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 3.x | Test framework | Unit tests for handlers, integration tests for transport; fast ESM-native; locked decision: full test suite |
| eslint | 9.x | Linting | Locked decision: ESLint for code quality |
| prettier | 3.x | Formatting | Locked decision: Prettier for formatting |
| @types/node | 22.x | Node.js type definitions | TypeScript compilation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest | Jest | Jest requires more config for ESM; Vitest is faster, ESM-native |
| Vitest | Node test runner | Node test runner lacks watch mode and rich assertions; less ecosystem |
| ESLint 9 flat config | ESLint 8 legacy | ESLint 9 is current; flat config is simpler |

**Installation:**
```bash
cd mcp-server
npm init -y
npm install @modelcontextprotocol/sdk@1.27.1 zod@3
npm install -D typescript @types/node vitest eslint prettier
```

## Architecture Patterns

### Recommended Project Structure
```
mcp-server/
  src/
    index.ts              # Entry point: create server, connect stdio transport
    server.ts             # McpServer factory (testable without transport)
    resources/
      docs.ts             # Pattern doc resources (docs://androidcommondoc/{name})
      skills.ts           # Skill definition resources (if included)
      changelog.ts        # Changelog/what's-new resource
    tools/
      validate-all.ts     # Consolidated meta-tool
      check-freshness.ts      # Doc freshness validation
      verify-kmp.ts            # KMP package verification
      check-version-sync.ts   # Version sync check
      script-parity.ts        # Script parity validation
      setup-check.ts           # Setup validation tool
    prompts/
      architecture-review.ts  # Architecture review prompt
      pr-review.ts            # PR-level review prompt
      onboarding.ts           # Onboarding prompt
    utils/
      logger.ts           # stderr-only logger
      script-runner.ts    # Cross-platform script execution (uses execFile, NOT exec)
      rate-limiter.ts     # Rate limiting for tool invocations
      paths.ts            # ANDROID_COMMON_DOC path resolution
    types/
      results.ts          # Shared JSON result types
  tests/
    unit/
      resources/
        docs.test.ts
      tools/
        validate-all.test.ts
      prompts/
        architecture-review.test.ts
      utils/
        script-runner.test.ts
    integration/
      stdio-transport.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
  eslint.config.mjs
  .prettierrc
  README.md
```

### Pattern 1: Server Factory (testable without transport)
**What:** Separate McpServer creation from transport connection so handlers can be tested via InMemoryTransport.
**When to use:** Always -- this is the core testing strategy.
**Example:**
```typescript
// Source: MCP TypeScript SDK official docs
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "./resources/docs.js";
import { registerTools } from "./tools/validate-all.js";
import { registerPrompts } from "./prompts/architecture-review.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "androidcommondoc",
    version: "1.0.0",
  });

  registerResources(server);
  registerTools(server);
  registerPrompts(server);

  return server;
}

// src/index.ts (entry point)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AndroidCommonDoc MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

### Pattern 2: Resource Registration (static docs)
**What:** Register each pattern doc as a static MCP resource with `docs://` URI scheme.
**When to use:** For the 8 pattern docs (MCP-02).
**Example:**
```typescript
// Source: MCP TypeScript SDK server.md
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DOCS_DIR = join(process.env.ANDROID_COMMON_DOC ?? ".", "docs");

const PATTERN_DOCS = [
  "compose-resources-patterns",
  "gradle-patterns",
  "kmp-architecture",
  "offline-first-patterns",
  "enterprise-integration",    // translated from propuesta-integracion-enterprise
  "resource-management-patterns",
  "testing-patterns",
  "ui-screen-patterns",
  "viewmodel-state-patterns",
] as const;

export function registerResources(server: McpServer): void {
  for (const docName of PATTERN_DOCS) {
    server.registerResource(
      docName,
      `docs://androidcommondoc/${docName}`,
      {
        title: docName.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        description: `Pattern documentation: ${docName}`,
        mimeType: "text/markdown",
      },
      async (uri) => {
        const fileName = docName === "enterprise-integration"
          ? "enterprise-integration-proposal.md"
          : `${docName}.md`;
        const content = await readFile(join(DOCS_DIR, fileName), "utf-8");
        return {
          contents: [{ uri: uri.href, text: content }],
        };
      }
    );
  }
}
```

### Pattern 3: Tool Registration (script execution)
**What:** Register validation scripts as MCP tools with Zod schemas, executing them via `child_process.execFile` (NOT exec -- prevents shell injection) and parsing output into structured JSON.
**When to use:** For all validation tools (MCP-03).
**Example:**
```typescript
// Source: MCP TypeScript SDK server.md + Node.js child_process docs
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

server.registerTool(
  "check-doc-freshness",
  {
    title: "Check Doc Freshness",
    description: "Compare version references in pattern docs against versions-manifest.json",
    inputSchema: z.object({
      projectRoot: z.string().optional()
        .describe("Path to AndroidCommonDoc root (defaults to ANDROID_COMMON_DOC env var)"),
    }),
  },
  async ({ projectRoot }) => {
    const root = projectRoot ?? process.env.ANDROID_COMMON_DOC ?? ".";
    const scriptPath = join(root, "scripts", "sh", "check-doc-freshness.sh");

    try {
      const { stdout, stderr } = await execFileAsync("bash", [scriptPath, "--project-root", root], {
        timeout: 30000,
        env: { ...process.env, NO_COLOR: "1" },
      });

      const result = parseDocFreshnessOutput(stdout);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "ERROR", error: String(error) }) }],
        isError: true,
      };
    }
  }
);
```

### Pattern 4: Prompt Registration
**What:** Register architecture review prompts that return structured messages for AI agent consumption.
**When to use:** For review and onboarding prompts (MCP-04).
**Example:**
```typescript
// Source: MCP TypeScript SDK server.md
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

server.registerPrompt(
  "architecture-review",
  {
    title: "Architecture Review",
    description: "Review Kotlin code against AndroidCommonDoc architecture patterns",
    argsSchema: z.object({
      code: z.string().describe("Kotlin code to review"),
      layer: z.enum(["ui", "viewmodel", "domain", "data", "model"]).optional()
        .describe("Specific architecture layer to focus on"),
    }),
  },
  async ({ code, layer }) => {
    const patterns = await loadRelevantPatterns(layer);
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review this Kotlin code against AndroidCommonDoc patterns:\n\n${patterns}\n\n---\n\nCode to review:\n\`\`\`kotlin\n${code}\n\`\`\``,
          },
        },
      ],
    };
  }
);
```

### Pattern 5: Cross-Platform Script Execution
**What:** Detect OS at runtime and run scripts via bash (available on Windows via Git Bash). Uses `execFile` (NOT `exec`) for security.
**When to use:** For every MCP tool that wraps a validation script.
**Example:**
```typescript
// src/utils/script-runner.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export async function runScript(
  scriptBaseName: string,
  args: string[],
  rootDir: string,
  timeoutMs = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const shPath = join(rootDir, "scripts", "sh", `${scriptBaseName}.sh`);

  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      [shPath, ...args],
      {
        timeout: timeoutMs,
        env: { ...process.env, NO_COLOR: "1", ANDROID_COMMON_DOC: rootDir },
        cwd: rootDir,
      }
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.code ?? 1,
    };
  }
}
```

### Pattern 6: stderr-Only Logger
**What:** A logger that ONLY writes to stderr, preventing stdout corruption.
**When to use:** Everywhere in the MCP server. This is CRITICAL for Windows stdio integrity (MCP-05).
**Example:**
```typescript
// src/utils/logger.ts
export const logger = {
  info: (msg: string) => console.error(`[INFO] ${msg}`),
  warn: (msg: string) => console.error(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
  debug: (msg: string) => {
    if (process.env.MCP_DEBUG) console.error(`[DEBUG] ${msg}`);
  },
};
```

### Pattern 7: InMemoryTransport Testing
**What:** Test server handlers without spawning a subprocess by using InMemoryTransport.
**When to use:** All unit tests for resources, tools, and prompts.
**Example:**
```typescript
// tests/unit/resources/docs.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("doc resources", () => {
  let client: Client;

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  it("lists all pattern doc resources", async () => {
    const result = await client.listResources();
    expect(result.resources.length).toBeGreaterThanOrEqual(8);
  });

  it("reads a specific doc resource", async () => {
    const result = await client.readResource({ uri: "docs://androidcommondoc/kmp-architecture" });
    expect(result.contents[0].text).toContain("KMP");
  });
});
```

### Anti-Patterns to Avoid
- **console.log() anywhere in server code:** Corrupts JSON-RPC on stdout. Use console.error() or the stderr logger exclusively.
- **child_process.exec() for script execution:** Spawns a shell and is vulnerable to command injection. Use execFile() instead.
- **Synchronous file reads in handlers:** Block the event loop. Always use async fs operations (readFile, not readFileSync).
- **Hardcoded absolute paths:** Use ANDROID_COMMON_DOC env var or relative path resolution from the server's location.
- **Raw script output as tool results:** Always parse into structured JSON. Strip ANSI color codes before parsing (set NO_COLOR=1 environment variable when invoking scripts).
- **Unbounded script execution:** Always set a timeout (30s default) on child_process calls to prevent hanging.
- **Testing with real stdio transport:** Use InMemoryTransport for unit tests. Reserve real stdio for one integration test.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC protocol | Custom JSON-RPC parser | @modelcontextprotocol/sdk StdioServerTransport | Complex protocol with framing, error codes, bi-directional messaging |
| Schema validation | Manual type checking | Zod v3 schemas with SDK's registerTool | SDK integrates Zod natively; auto-generates tool descriptions |
| ANSI color stripping | Regex replace | NO_COLOR=1 env var when spawning scripts | Standard convention; scripts already check for color support |
| URI template matching | Custom regex | ResourceTemplate from SDK | Handles RFC 6570 URI templates correctly |
| Rate limiting | Custom token bucket | Simple sliding window counter | Only need basic invocation limiting, not distributed rate limiting |
| Test transport | Custom mock transport | InMemoryTransport from SDK | Official testing utility; handles full protocol lifecycle |

**Key insight:** The MCP TypeScript SDK handles all protocol complexity. The server code is purely about reading files, executing scripts, and formatting results. Don't reinvent any protocol-level behavior.

## Common Pitfalls

### Pitfall 1: stdout Corruption on Windows
**What goes wrong:** Any `console.log()` or accidental stdout write corrupts the JSON-RPC stream, causing "Connection closed" errors in Claude Code.
**Why it happens:** MCP stdio transport uses stdout exclusively for JSON-RPC messages. Any non-protocol bytes break the framing.
**How to avoid:**
- NEVER use console.log() anywhere in the codebase
- Use an ESLint rule (`no-console` with `allow: ["error", "warn"]`) to catch violations at build time
- Set up a stderr-only logger utility
- Test stdout cleanliness in CI: verify that server startup produces zero bytes on stdout before receiving a JSON-RPC request
**Warning signs:** "Connection closed" error when Claude Code tries to connect; server works in MCP Inspector but not in Claude Code.

### Pitfall 2: Windows npx Wrapper
**What goes wrong:** On Windows, `npx` commands fail with "Connection closed" because Windows cannot directly execute npm shim scripts.
**Why it happens:** npx is a batch script (.cmd) on Windows that requires `cmd /c` to execute.
**How to avoid:** Don't use npx to start the server. Use `node build/index.js` directly in the `claude mcp add` command. This avoids the npx wrapper issue entirely.
**Warning signs:** Server works when run manually but fails when registered with Claude Code.

### Pitfall 3: Script Execution Path Resolution
**What goes wrong:** Validation scripts can't find their dependencies or the docs/ directory because the working directory is wrong.
**Why it happens:** Claude Code launches the MCP server subprocess from an arbitrary working directory, not from the AndroidCommonDoc repo root.
**How to avoid:**
- Always resolve paths relative to `ANDROID_COMMON_DOC` env var or the server's own `__dirname`
- Pass `--project-root` explicitly to all script invocations
- Set `cwd` in execFile options
**Warning signs:** "File not found" errors in tool responses; scripts work when run manually but fail through MCP.

### Pitfall 4: ES Module Import Paths
**What goes wrong:** TypeScript compilation succeeds but runtime fails with "Cannot find module" errors.
**Why it happens:** ES Modules require explicit `.js` extensions in import paths (even when the source is `.ts`). TypeScript does not add these automatically.
**How to avoid:** Always use `.js` extensions in imports: `import { foo } from "./bar.js"` (not `"./bar"`). Set `"module": "Node16"` and `"moduleResolution": "Node16"` in tsconfig.json.
**Warning signs:** `tsc` compiles clean but `node build/index.js` fails with ERR_MODULE_NOT_FOUND.

### Pitfall 5: Zod Version Mismatch
**What goes wrong:** Runtime errors like "w._parse is not a function" or schema validation failures.
**Why it happens:** MCP SDK v1.27.1 requires Zod v3. Installing Zod v4 causes incompatibility.
**How to avoid:** Pin to `zod@3` in package.json. Do not install `zod@4` or `zod@latest` (which may resolve to v4).
**Warning signs:** Build succeeds but tool invocations fail with cryptic internal errors.

### Pitfall 6: Script Color Codes in JSON Results
**What goes wrong:** Structured JSON results contain ANSI escape sequences like `\033[32m` mixed into text fields.
**Why it happens:** Validation scripts use colored output (log_info, log_ok, etc.) that gets captured in stdout.
**How to avoid:** Set `NO_COLOR=1` in the environment when spawning child processes. Also strip ANSI codes as a safety net.
**Warning signs:** JSON results contain garbage characters or fail to parse.

### Pitfall 7: Long-Running Script Timeouts
**What goes wrong:** MCP tool call hangs indefinitely, blocking the Claude Code agent.
**Why it happens:** Some validation scripts (especially cross-project ones) can take minutes if the target project is large.
**How to avoid:** Set explicit `timeout` on all execFile calls (30s default). Return a timeout error result rather than hanging.
**Warning signs:** Claude Code appears frozen during tool execution.

## Code Examples

Verified patterns from official sources:

### McpServer + StdioServerTransport Setup
```typescript
// Source: https://modelcontextprotocol.io/docs/develop/build-server (TypeScript tab)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "androidcommondoc",
  version: "1.0.0",
});

// Register resources, tools, prompts here...

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

### Static Resource Registration
```typescript
// Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
server.registerResource(
  "kmp-architecture",                          // internal name
  "docs://androidcommondoc/kmp-architecture",  // URI
  {
    title: "KMP Architecture",
    description: "Kotlin Multiplatform architecture patterns and source set hierarchy",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: await readFile(join(docsDir, "kmp-architecture.md"), "utf-8"),
    }],
  })
);
```

### Dynamic Resource with ResourceTemplate
```typescript
// Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

server.registerResource(
  "skill",
  new ResourceTemplate("skills://androidcommondoc/{skillName}", {
    list: async () => ({
      resources: skillNames.map(name => ({
        uri: `skills://androidcommondoc/${name}`,
        name: name,
      })),
    }),
  }),
  { description: "Skill definition", mimeType: "text/markdown" },
  async (uri, { skillName }) => ({
    contents: [{
      uri: uri.href,
      text: await readFile(join(skillsDir, String(skillName), "SKILL.md"), "utf-8"),
    }],
  })
);
```

### Tool Registration with Zod Schema
```typescript
// Source: https://modelcontextprotocol.io/docs/develop/build-server (TypeScript tab)
server.registerTool(
  "verify-kmp-packages",
  {
    title: "Verify KMP Packages",
    description: "Validate KMP package organization and detect forbidden imports in commonMain",
    inputSchema: z.object({
      projectRoot: z.string().describe("Path to the target KMP project root"),
      modulePath: z.string().optional().describe("Specific module path to check (e.g., 'core/data')"),
      strict: z.boolean().default(false).describe("Fail on warnings in addition to errors"),
    }),
  },
  async ({ projectRoot, modulePath, strict }) => {
    const args = ["--project-root", projectRoot];
    if (modulePath) args.push("--module-path", modulePath);
    if (strict) args.push("--strict");

    const result = await runScript("verify-kmp-packages", args, toolkitRoot);
    const parsed = parseKmpVerificationOutput(result.stdout);

    return {
      content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }],
    };
  }
);
```

### Prompt Registration with Arguments
```typescript
// Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
server.registerPrompt(
  "pr-review",
  {
    title: "PR Review",
    description: "Review a pull request diff against AndroidCommonDoc patterns",
    argsSchema: z.object({
      diff: z.string().describe("Git diff output to review"),
      focusAreas: z.string().optional()
        .describe("Comma-separated areas to focus on (e.g., 'viewmodel,testing')"),
    }),
  },
  async ({ diff, focusAreas }) => {
    const patterns = await loadPatternDocs(focusAreas?.split(","));
    return {
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: buildPrReviewPrompt(diff, patterns),
        },
      }],
    };
  }
);
```

### package.json Configuration
```json
{
  "name": "androidcommondoc-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "androidcommondoc-mcp": "./build/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "format": "prettier --write src/ tests/",
    "start": "node build/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.27.1",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### tsconfig.json Configuration
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "tests"]
}
```

### Claude Code Registration
```bash
# Register the MCP server with Claude Code (use absolute path to node script)
claude mcp add --transport stdio androidcommondoc -- node "C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc/mcp-server/build/index.js"

# With environment variable
claude mcp add --transport stdio --env ANDROID_COMMON_DOC="C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc" androidcommondoc -- node "C:/Users/34645/AndroidStudioProjects/AndroidCommonDoc/mcp-server/build/index.js"

# Verify registration
claude mcp list
claude mcp get androidcommondoc
```

### Vitest Configuration
```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
    testTimeout: 30000,
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MCP SDK v1.x (Zod v3) | SDK v2.x pre-alpha (Zod v4) | Q1 2026 (in progress) | v1.27.1 is stable and recommended for production; v2 not yet ready |
| server.tool() shorthand | server.registerTool() | SDK v1.20+ | registerTool is the recommended method with full metadata support |
| Custom JSON-RPC + SSE | StdioServerTransport | SDK v1.0 | No need to implement protocol |
| ESLint 8 + .eslintrc | ESLint 9 flat config | 2024 | Simpler config, better TS support |
| Jest | Vitest | 2023-2024 | Vitest is now the standard for ESM-first TypeScript projects |
| SSE transport | Streamable HTTP | MCP spec 2025 | SSE deprecated; but for local stdio, irrelevant |

**Deprecated/outdated:**
- `server.tool()` shorthand: Still works but `server.registerTool()` provides full metadata (title, annotations)
- SSE transport: Deprecated in favor of Streamable HTTP; not relevant for this phase (stdio only)
- Zod v4 with MCP SDK v1.x: Causes runtime errors; stick with Zod v3

## Open Questions

1. **Exact InMemoryTransport import path in v1.27.1**
   - What we know: The SDK exports InMemoryTransport for testing
   - What's unclear: The exact import path may be `@modelcontextprotocol/sdk/inMemory.js` or `@modelcontextprotocol/sdk/inMemory/index.js`
   - Recommendation: Verify during implementation by checking node_modules exports; fall back to spawning the server as a subprocess test if needed

2. **Git Bash availability on Windows**
   - What we know: The dev machine has bash available (Git Bash), Node.js v24.12.0
   - What's unclear: Whether Claude Code's subprocess environment includes Git Bash in PATH
   - Recommendation: Test bash availability at server startup; log a warning if unavailable and document PowerShell fallback

3. **ANDROID_COMMON_DOC env var in Claude Code subprocess**
   - What we know: Claude Code passes env vars via `--env` flag in `claude mcp add`
   - What's unclear: Whether the env var persists across Claude Code restarts / sessions
   - Recommendation: Accept both env var and CLI arg (`--root`) for flexibility; default to server's `__dirname/../` as fallback

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | `mcp-server/vitest.config.ts` (Wave 0 creation) |
| Quick run command | `cd mcp-server && npx vitest run` |
| Full suite command | `cd mcp-server && npx vitest run --coverage` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | Server starts, connects via stdio, responds to initialize | integration | `cd mcp-server && npx vitest run tests/integration/stdio-transport.test.ts` | Wave 0 |
| MCP-02 | 8+ docs listed as resources, content readable | unit | `cd mcp-server && npx vitest run tests/unit/resources/docs.test.ts` | Wave 0 |
| MCP-03 | 5+ tools listed, invocable, return structured JSON | unit | `cd mcp-server && npx vitest run tests/unit/tools/` | Wave 0 |
| MCP-04 | Prompts listed, retrievable with arguments | unit | `cd mcp-server && npx vitest run tests/unit/prompts/` | Wave 0 |
| MCP-05 | No stdout corruption; stderr-only logging | unit+integration | `cd mcp-server && npx vitest run tests/unit/utils/logger.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd mcp-server && npx vitest run`
- **Per wave merge:** `cd mcp-server && npx vitest run --coverage`
- **Phase gate:** Full suite green + manual `claude mcp add` registration test

### Wave 0 Gaps
- [ ] `mcp-server/package.json` -- project initialization with all dependencies
- [ ] `mcp-server/tsconfig.json` -- TypeScript configuration
- [ ] `mcp-server/vitest.config.ts` -- Vitest configuration
- [ ] `mcp-server/eslint.config.mjs` -- ESLint flat config
- [ ] `mcp-server/.prettierrc` -- Prettier configuration
- [ ] `mcp-server/tests/` directory structure -- test scaffolding
- [ ] `docs/enterprise-integration-proposal.md` -- English translation of propuesta-integracion-enterprise.md

## Sources

### Primary (HIGH confidence)
- [MCP TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk) - v1.27.1 is latest v1.x, released Feb 24 2025; v2 pre-alpha on main branch
- [MCP Official Build Server Tutorial](https://modelcontextprotocol.io/docs/develop/build-server) - TypeScript tab: full McpServer + StdioServerTransport example with Zod v3
- [MCP SDK server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) - registerResource, registerTool, registerPrompt, ResourceTemplate API
- [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp) - `claude mcp add` syntax, scope options, Windows notes, environment variables

### Secondary (MEDIUM confidence)
- [MCP SDK Zod compatibility issues](https://github.com/modelcontextprotocol/typescript-sdk/issues/555) - Zod v3 required for SDK v1.x; v4 causes runtime errors
- [MCP Server debugging guide](https://www.stainless.com/mcp/error-handling-and-debugging-mcp-servers) - stdio corruption, stderr logging, Windows pitfalls
- [Vitest MCP server testing pattern](https://medium.com/@rajasekaran.parthiban7/%EF%B8%8F-mcp-server-node-js-typescript-vitest-k6-f056dad97288) - InMemoryTransport + Vitest best practices

### Tertiary (LOW confidence)
- InMemoryTransport exact import path for v1.27.1 -- needs runtime verification during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - SDK v1.27.1 is well-documented, Zod v3 peer dep confirmed, TypeScript setup is standard
- Architecture: HIGH - Factory pattern, resource/tool/prompt separation, stderr-only logging are all verified patterns
- Pitfalls: HIGH - stdout corruption, Windows npx, Zod v4 incompatibility, ES Module paths are all documented issues
- Validation: MEDIUM - InMemoryTransport import path needs runtime verification; test patterns are sound

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (30 days; MCP SDK v1.x is stable with no breaking changes expected)
