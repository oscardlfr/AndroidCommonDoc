/**
 * Tests for the validate-skills MCP tool.
 *
 * Verifies skill frontmatter validation, dependency checking,
 * registry sync detection, project sync validation, and structured
 * JSON output.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  validateSkillFrontmatter,
  validateDependencies,
  validateRegistrySync,
  validateProjectSync,
  validateSkills,
  type ValidationIssue,
  type ValidationResult,
} from "../../../src/tools/validate-skills.js";

describe("validate-skills", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "validate-skills-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // validateSkillFrontmatter
  // -----------------------------------------------------------------------

  describe("validateSkillFrontmatter", () => {
    it("returns success when all SKILL.md files have valid frontmatter", async () => {
      // Create a valid skill
      const skillDir = path.join(tmpDir, "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---
name: test-skill
description: A test skill for validation
allowed-tools:
  - Read
  - Grep
---

# Test Skill
`,
      );

      const issues = await validateSkillFrontmatter(
        path.join(tmpDir, "skills"),
      );
      const errors = issues.filter((i) => i.level === "error");

      expect(errors).toHaveLength(0);
    });

    it("reports error when SKILL.md missing required frontmatter field (name)", async () => {
      // Create a skill with missing name
      const skillDir = path.join(tmpDir, "skills", "bad-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---
description: A skill without a name
allowed-tools:
  - Read
---

# Bad Skill
`,
      );

      const issues = await validateSkillFrontmatter(
        path.join(tmpDir, "skills"),
      );
      const errors = issues.filter((i) => i.level === "error");

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].category).toBe("frontmatter");
      expect(errors[0].message).toContain("name");
    });

    it("reports error when SKILL.md missing required frontmatter field (description)", async () => {
      const skillDir = path.join(tmpDir, "skills", "no-desc");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---
name: no-desc
allowed-tools:
  - Read
---

# No Description Skill
`,
      );

      const issues = await validateSkillFrontmatter(
        path.join(tmpDir, "skills"),
      );
      const errors = issues.filter((i) => i.level === "error");

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("description");
    });

    it("reports warning when SKILL.md has non-array allowed-tools", async () => {
      const skillDir = path.join(tmpDir, "skills", "bad-tools");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---
name: bad-tools
description: Skill with non-array allowed-tools
allowed-tools: Read
---

# Bad Tools
`,
      );

      const issues = await validateSkillFrontmatter(
        path.join(tmpDir, "skills"),
      );
      const warnings = issues.filter((i) => i.level === "warning");

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain("allowed-tools");
    });

    it("checks agent frontmatter (tools field present)", async () => {
      // Create an agents directory with an agent file
      const agentsDir = path.join(tmpDir, ".claude", "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(
        path.join(agentsDir, "test-agent.md"),
        `---
description: An agent without tools field
---

# Test Agent
`,
      );

      const issues = await validateSkillFrontmatter(
        path.join(tmpDir, "skills"),
        path.join(tmpDir, ".claude", "agents"),
      );
      const warnings = issues.filter((i) => i.level === "warning");

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.message.includes("tools"))).toBe(true);
    });

    it("reports warning when disable-model-invocation is present but not boolean", async () => {
      const skillDir = path.join(tmpDir, "skills", "bad-disable");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---
name: bad-disable
description: Skill with non-boolean disable-model-invocation
allowed-tools:
  - Read
disable-model-invocation: "yes"
---

# Bad Disable
`,
      );

      const issues = await validateSkillFrontmatter(
        path.join(tmpDir, "skills"),
      );
      const warnings = issues.filter((i) => i.level === "warning");

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain("disable-model-invocation");
    });
  });

  // -----------------------------------------------------------------------
  // validateDependencies
  // -----------------------------------------------------------------------

  describe("validateDependencies", () => {
    it("reports warning when SKILL.md references non-existent script in dependencies", async () => {
      // Create skill directory structure
      const skillDir = path.join(tmpDir, "skills", "dep-skill");
      await mkdir(skillDir, { recursive: true });

      const entries = [
        {
          name: "dep-skill",
          type: "skill" as const,
          path: "skills/dep-skill/SKILL.md",
          description: "",
          category: "testing",
          tier: "core" as const,
          hash: "sha256:abc123",
          dependencies: [
            "scripts/sh/nonexistent.sh",
            "scripts/ps1/nonexistent.ps1",
          ],
          frontmatter: {},
        },
      ];

      const issues = await validateDependencies(tmpDir, entries);
      const warnings = issues.filter((i) => i.level === "warning");

      expect(warnings.length).toBe(2);
      expect(warnings[0].category).toBe("dependency");
      expect(warnings[0].message).toContain("nonexistent");
    });

    it("returns no issues when dependencies exist on disk", async () => {
      // Create the script files
      const shDir = path.join(tmpDir, "scripts", "sh");
      const ps1Dir = path.join(tmpDir, "scripts", "ps1");
      await mkdir(shDir, { recursive: true });
      await mkdir(ps1Dir, { recursive: true });
      await writeFile(path.join(shDir, "gradle-run.sh"), "#!/bin/bash\n");
      await writeFile(path.join(ps1Dir, "gradle-run.ps1"), "# powershell\n");

      const entries = [
        {
          name: "run-skill",
          type: "skill" as const,
          path: "skills/run-skill/SKILL.md",
          description: "",
          category: "build",
          tier: "core" as const,
          hash: "sha256:abc123",
          dependencies: [
            "scripts/sh/gradle-run.sh",
            "scripts/ps1/gradle-run.ps1",
          ],
          frontmatter: {},
        },
      ];

      const issues = await validateDependencies(tmpDir, entries);

      expect(issues).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // validateRegistrySync
  // -----------------------------------------------------------------------

  describe("validateRegistrySync", () => {
    it("reports error when registry.json entry has hash mismatch with actual file content", async () => {
      // Create a skill and a registry.json with wrong hash
      const skillDir = path.join(tmpDir, "skills", "hash-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---
name: hash-skill
description: A skill to test hash checking
allowed-tools:
  - Read
---

# Hash Skill
`,
      );

      // Write registry.json with a bad hash
      await writeFile(
        path.join(tmpDir, "skills", "registry.json"),
        JSON.stringify(
          {
            version: 1,
            generated: "2026-01-01T00:00:00Z",
            l0_root: tmpDir,
            entries: [
              {
                name: "hash-skill",
                type: "skill",
                path: "skills/hash-skill/SKILL.md",
                hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                dependencies: [],
                frontmatter: {},
              },
            ],
          },
          null,
          2,
        ),
      );

      const issues = await validateRegistrySync(tmpDir);
      const errors = issues.filter((i) => i.level === "error");

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].category).toBe("registry-sync");
      expect(errors[0].message).toContain("hash mismatch");
    });

    it("reports error when filesystem has skill not in registry.json", async () => {
      // Create two skills but only register one
      const skillDir1 = path.join(tmpDir, "skills", "registered-skill");
      const skillDir2 = path.join(tmpDir, "skills", "unregistered-skill");
      await mkdir(skillDir1, { recursive: true });
      await mkdir(skillDir2, { recursive: true });

      await writeFile(
        path.join(skillDir1, "SKILL.md"),
        `---
name: registered-skill
description: Registered
allowed-tools:
  - Read
---
`,
      );
      await writeFile(
        path.join(skillDir2, "SKILL.md"),
        `---
name: unregistered-skill
description: Not registered
allowed-tools:
  - Read
---
`,
      );

      // Registry only has one
      const { computeHash } = await import(
        "../../../src/registry/skill-registry.js"
      );
      const hash1 = await computeHash(path.join(skillDir1, "SKILL.md"));

      await writeFile(
        path.join(tmpDir, "skills", "registry.json"),
        JSON.stringify(
          {
            version: 1,
            generated: "2026-01-01T00:00:00Z",
            l0_root: tmpDir,
            entries: [
              {
                name: "registered-skill",
                type: "skill",
                path: "skills/registered-skill/SKILL.md",
                hash: hash1,
                dependencies: [],
                frontmatter: {},
              },
            ],
          },
          null,
          2,
        ),
      );

      const issues = await validateRegistrySync(tmpDir);
      const errors = issues.filter((i) => i.level === "error");

      expect(errors.length).toBeGreaterThan(0);
      expect(
        errors.some((e) => e.message.includes("not in registry")),
      ).toBe(true);
    });

    it("reports error when registry.json has entry for file that doesn't exist", async () => {
      // Create skills dir with no skills
      await mkdir(path.join(tmpDir, "skills"), { recursive: true });

      await writeFile(
        path.join(tmpDir, "skills", "registry.json"),
        JSON.stringify(
          {
            version: 1,
            generated: "2026-01-01T00:00:00Z",
            l0_root: tmpDir,
            entries: [
              {
                name: "ghost-skill",
                type: "skill",
                path: "skills/ghost-skill/SKILL.md",
                hash: "sha256:deadbeef",
                dependencies: [],
                frontmatter: {},
              },
            ],
          },
          null,
          2,
        ),
      );

      const issues = await validateRegistrySync(tmpDir);
      const errors = issues.filter((i) => i.level === "error");

      expect(errors.length).toBeGreaterThan(0);
      expect(
        errors.some((e) => e.message.includes("not on disk")),
      ).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // validateProjectSync
  // -----------------------------------------------------------------------

  describe("validateProjectSync", () => {
    it("accepts optional project parameter for cross-project validation", async () => {
      // Create a project with l0-manifest.json
      const projectRoot = path.join(tmpDir, "my-project");
      await mkdir(projectRoot, { recursive: true });

      // Create a skill file in the project
      const skillDir = path.join(projectRoot, "skills", "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---
name: test-skill
description: Test
allowed-tools:
  - Read
---
# Test
`,
      );

      const { computeHash } = await import(
        "../../../src/registry/skill-registry.js"
      );
      const hash = await computeHash(path.join(skillDir, "SKILL.md"));

      // Create manifest with correct checksum
      await writeFile(
        path.join(projectRoot, "l0-manifest.json"),
        JSON.stringify(
          {
            version: 1,
            l0_source: "../AndroidCommonDoc",
            last_synced: "2026-01-01T00:00:00Z",
            selection: {
              mode: "include-all",
              exclude_skills: [],
              exclude_agents: [],
              exclude_commands: [],
              exclude_categories: [],
            },
            checksums: {
              "skills/test-skill/SKILL.md": hash,
            },
            l2_specific: { commands: [], agents: [] },
          },
          null,
          2,
        ),
      );

      const issues = await validateProjectSync(projectRoot);
      const errors = issues.filter((i) => i.level === "error");

      expect(errors).toHaveLength(0);
    });

    it("reports error when project file checksum mismatches manifest", async () => {
      const projectRoot = path.join(tmpDir, "drift-project");
      await mkdir(projectRoot, { recursive: true });

      // Create a skill file
      const skillDir = path.join(projectRoot, "skills", "drift-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---
name: drift-skill
description: Drifted
allowed-tools:
  - Read
---
# Drifted
`,
      );

      // Manifest has wrong checksum
      await writeFile(
        path.join(projectRoot, "l0-manifest.json"),
        JSON.stringify(
          {
            version: 1,
            l0_source: "../AndroidCommonDoc",
            last_synced: "2026-01-01T00:00:00Z",
            selection: {
              mode: "include-all",
              exclude_skills: [],
              exclude_agents: [],
              exclude_commands: [],
              exclude_categories: [],
            },
            checksums: {
              "skills/drift-skill/SKILL.md":
                "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            },
            l2_specific: { commands: [], agents: [] },
          },
          null,
          2,
        ),
      );

      const issues = await validateProjectSync(projectRoot);
      const errors = issues.filter((i) => i.level === "error");

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("checksum mismatch");
    });
  });

  // -----------------------------------------------------------------------
  // validateSkills (orchestrator function)
  // -----------------------------------------------------------------------

  describe("validateSkills", () => {
    it("returns structured JSON with errors, warnings, and summary counts", async () => {
      // Create a valid skill and valid registry
      const skillDir = path.join(tmpDir, "skills", "good-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---
name: good-skill
description: A good skill
allowed-tools:
  - Read
  - Grep
---

# Good Skill
`,
      );

      const { computeHash } = await import(
        "../../../src/registry/skill-registry.js"
      );
      const hash = await computeHash(path.join(skillDir, "SKILL.md"));

      await writeFile(
        path.join(tmpDir, "skills", "registry.json"),
        JSON.stringify(
          {
            version: 1,
            generated: "2026-01-01T00:00:00Z",
            l0_root: tmpDir,
            entries: [
              {
                name: "good-skill",
                type: "skill",
                path: "skills/good-skill/SKILL.md",
                description: "A good skill",
                category: "testing",
                tier: "core",
                hash,
                dependencies: [],
                frontmatter: {
                  name: "good-skill",
                  description: "A good skill",
                  "allowed-tools": ["Read", "Grep"],
                },
              },
            ],
          },
          null,
          2,
        ),
      );

      const result = await validateSkills(tmpDir);

      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("warnings");
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("summary");
      expect(typeof result.valid).toBe("boolean");
      expect(typeof result.errors).toBe("number");
      expect(typeof result.warnings).toBe("number");
      expect(Array.isArray(result.issues)).toBe(true);
      expect(typeof result.summary).toBe("string");

      // Should be valid since everything is correct
      expect(result.valid).toBe(true);
      expect(result.errors).toBe(0);
    });

    it("aggregates issues from all validation phases", async () => {
      // Create a skill with missing description AND wrong hash in registry
      const skillDir = path.join(tmpDir, "skills", "multi-issue");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        `---
name: multi-issue
allowed-tools:
  - Read
---

# Multi Issue Skill
`,
      );

      await writeFile(
        path.join(tmpDir, "skills", "registry.json"),
        JSON.stringify(
          {
            version: 1,
            generated: "2026-01-01T00:00:00Z",
            l0_root: tmpDir,
            entries: [
              {
                name: "multi-issue",
                type: "skill",
                path: "skills/multi-issue/SKILL.md",
                hash: "sha256:wrong",
                dependencies: ["scripts/sh/nonexistent.sh"],
                frontmatter: {},
              },
            ],
          },
          null,
          2,
        ),
      );

      const result = await validateSkills(tmpDir);

      // Should have errors from frontmatter (missing description) + registry sync (hash mismatch)
      expect(result.valid).toBe(false);
      expect(result.errors).toBeGreaterThan(0);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });
});
