/**
 * Tests for the setup-check MCP tool.
 *
 * Checks 1-6 (env-var, docs, scripts-sh, scripts-ps1, skills, agents): the
 * tests below run against the actual AndroidCommonDoc repo (arguments: {}),
 * so setup-check should report PASS for most checks (docs/, scripts/, etc.
 * exist).
 *
 * Check 7 (pre-push-hook-installed, H1 Push Authority Bootstrap): its tests
 * MUST use an explicit, isolated projectRoot (temp dir + git init) instead
 * -- never the live-repo default and never a child_process mock. Whether
 * the live AndroidCommonDoc repo happens to have its own git-layer hook
 * installed at test-run time is an environment-dependent accident (fresh
 * clone vs. bootstrapped dev machine vs. CI runner), not a deterministic
 * fixture (arch-testing Check 5 / feedback_empirical_test_target_isolation.md).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSetupCheckTool } from "../../../src/tools/setup-check.js";
import type { ValidationResult } from "../../../src/types/results.js";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { getToolkitRoot } from "../../../src/utils/paths.js";

/**
 * Real AndroidCommonDoc repo root -- source of the REAL canonical scripts
 * (verify-git-hooks.sh, pre-push-hook.sh, install-git-hooks.sh) copied/
 * invoked into each isolated fixture below. NEVER used as the `projectRoot`
 * argument itself -- Check 7's tests must never depend on the live repo's
 * own, environment-dependent hook-installation state.
 */
const REAL_ROOT = getToolkitRoot();

/**
 * Builds a fresh, isolated projectRoot: a temp dir + `git init`, mirroring
 * the bats suite's own fixture discipline (mktemp -d + git init, never the
 * live repo). Seeds minimal docs/scripts/skills/agents scaffolding so
 * Checks 1-6 independently PASS -- this is what lets the Check 7 tests below
 * prove the overall result stays PASS (failCount unaffected) regardless of
 * whether Check 7 itself is PASS or WARN. Copies the REAL
 * verify-git-hooks.sh + pre-push-hook.sh in (never a child_process mock) so
 * Check 7's delegation is genuine, then optionally installs a canonical
 * hook via the REAL install-git-hooks.sh invoked from the source tree.
 */
function createIsolatedProjectRoot(options: { installHook: boolean }): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "setup-check-fixture-"));

  execFileSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  execFileSync("git", ["config", "user.email", "vitest@test.local"], {
    cwd: root,
    encoding: "utf8",
  });
  execFileSync("git", ["config", "user.name", "Vitest Test"], {
    cwd: root,
    encoding: "utf8",
  });

  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(path.join(root, "docs", "placeholder.md"), "# placeholder\n");

  mkdirSync(path.join(root, "scripts", "sh"), { recursive: true });
  mkdirSync(path.join(root, "scripts", "ps1"), { recursive: true });

  mkdirSync(path.join(root, "skills", "dummy-skill"), { recursive: true });
  writeFileSync(
    path.join(root, "skills", "dummy-skill", "SKILL.md"),
    "# dummy skill\n",
  );

  mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });

  copyFileSync(
    path.join(REAL_ROOT, "scripts", "sh", "verify-git-hooks.sh"),
    path.join(root, "scripts", "sh", "verify-git-hooks.sh"),
  );
  copyFileSync(
    path.join(REAL_ROOT, "scripts", "sh", "pre-push-hook.sh"),
    path.join(root, "scripts", "sh", "pre-push-hook.sh"),
  );

  if (options.installHook) {
    execFileSync(
      "bash",
      [path.join(REAL_ROOT, "scripts", "sh", "install-git-hooks.sh"), root],
      { encoding: "utf8" },
    );
  }

  return root;
}

describe("setup-check tool", () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerSetupCheckTool(server);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "setup-check");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
  });

  it("returns structured ValidationResult JSON", async () => {
    const result = await client.callTool({
      name: "setup-check",
      arguments: {},
    });

    expect(result.content).toHaveLength(1);
    const content = result.content[0];
    expect(content).toHaveProperty("type", "text");

    const parsed = JSON.parse(
      (content as { type: "text"; text: string }).text,
    ) as ValidationResult;
    expect(parsed).toHaveProperty("status");
    expect(["PASS", "FAIL", "ERROR"]).toContain(parsed.status);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("details");
    expect(parsed).toHaveProperty("duration_ms");
    expect(Array.isArray(parsed.details)).toBe(true);
  });

  it("validates project configuration with correct checks", async () => {
    const result = await client.callTool({
      name: "setup-check",
      arguments: {},
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as ValidationResult;

    // Verify expected checks are present
    const checkNames = parsed.details.map((d) => d.check);
    expect(checkNames).toContain("docs-directory");
    expect(checkNames).toContain("scripts-sh-directory");
    expect(checkNames).toContain("scripts-ps1-directory");

    // docs/ and scripts/ exist in the AndroidCommonDoc repo, so these should PASS
    const docsCheck = parsed.details.find((d) => d.check === "docs-directory");
    expect(docsCheck?.status).toBe("PASS");

    const shCheck = parsed.details.find(
      (d) => d.check === "scripts-sh-directory",
    );
    expect(shCheck?.status).toBe("PASS");
  });

  it("Check 7 (pre-push-hook-installed) is PASS when the git-layer hook is installed and canonical", async () => {
    const root = createIsolatedProjectRoot({ installHook: true });
    try {
      const result = await client.callTool({
        name: "setup-check",
        arguments: { projectRoot: root },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as ValidationResult;

      const hookCheck = parsed.details.find(
        (d) => d.check === "pre-push-hook-installed",
      );
      expect(hookCheck?.status).toBe("PASS");
      expect(hookCheck?.message).toBe(
        "git-layer pre-push hook is installed and canonical",
      );
      // Q6 (settled, arch-platform Item 6): Check 7 never increments
      // failCount either way -- the overall result must stay PASS here too.
      expect(parsed.status).toBe("PASS");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("Check 7 (pre-push-hook-installed) is WARN, not FAIL, when the git-layer hook is missing -- and the overall result stays PASS", async () => {
    const root = createIsolatedProjectRoot({ installHook: false });
    try {
      const result = await client.callTool({
        name: "setup-check",
        arguments: { projectRoot: root },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as ValidationResult;

      const hookCheck = parsed.details.find(
        (d) => d.check === "pre-push-hook-installed",
      );
      expect(hookCheck?.status).toBe("WARN");
      expect(hookCheck?.message).toBe(
        "pre-push hook is not installed/canonical (hook-absent) -- run 'make install-git-hooks' to fix",
      );
      // Q6 (settled, arch-platform Item 6): a missing/drifted hook is a WARN
      // diagnostic, never a FAIL -- failCount is unaffected, so the overall
      // result stays PASS as long as Checks 1-6 pass independently (proven
      // here via the isolated fixture's own minimal scaffolding).
      expect(parsed.status).toBe("PASS");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
