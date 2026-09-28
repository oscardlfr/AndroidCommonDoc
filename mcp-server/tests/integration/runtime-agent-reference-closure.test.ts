import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ROLES = [
  "arch-platform", "arch-testing", "arch-integration", "context-provider",
  "doc-updater", "toolkit-specialist", "test-specialist", "verifier",
  "quality-gater", "planner",
] as const;
type RegistryEntry = {
  name: string;
  type: "skill" | "agent" | "command";
  path: string;
  frontmatter?: Record<string, unknown>;
};

function materializableSkills(): RegistryEntry[] {
  const registry = JSON.parse(readFileSync(path.join(ROOT, "skills/registry.json"), "utf8")) as {
    entries: RegistryEntry[];
  };
  return registry.entries.filter((entry) =>
    entry.type === "skill" && entry.frontmatter?.runtime_scope !== "l0-source-only");
}
const CONSUMER_OWNED_DOCS = new Set([
  "docs/business/business-strategy-pricing.md",
]);

function launcherOperationIds(): Set<string> {
  const launcher = readFileSync(path.join(ROOT, ".claude/runtime/l0-toolkit-launcher.cjs"), "utf8");
  return new Set([...launcher.matchAll(/^\s{2}'([a-z0-9-]+)':\s*\{/gm)].map((match) => match[1]));
}

function validateRole(role: string, source: string): string[] {
  const errors: string[] = [];
  if (source.includes("../../docs/")) errors.push("consumer-relative-doc");
  if (/\$\{?ANDROID_COMMON_DOC/.test(source)) errors.push("ambient-toolkit-root");
  for (const match of source.matchAll(/(?<!l0doc:)(docs\/[A-Za-z0-9_./-]+\.md)/g)) {
    if (!CONSUMER_OWNED_DOCS.has(match[1])) errors.push(`unclassified-runtime-doc:${match[1]}`);
  }
  for (const match of source.matchAll(/l0doc:(docs\/[A-Za-z0-9_./-]+\.md)(?:#[A-Za-z0-9_.-]+)?/g)) {
    if (!existsSync(path.join(ROOT, match[1]))) errors.push(`runtime-doc-missing:${match[1]}`);
  }
  const operationIds = launcherOperationIds();
  for (const match of source.matchAll(/l0-toolkit-launcher\.cjs run ([a-z0-9-]+)/g)) {
    if (!operationIds.has(match[1])) errors.push(`runtime-operation-unknown:${match[1]}`);
  }
  const hasRawCommand = (value: string) =>
    /(?:^|[`\s])(?:bash|node|source|cd)\s+(scripts\/|mcp-server(?:\/|\s))/m.test(value);
  if (hasRawCommand(source)) {
    const consumerLocalBundle = role === "context-provider"
      && !hasRawCommand(source.replace(/bash scripts\/sh\/write-bundle\.sh/g, ""));
    const explicitlySourceOnly = role === "toolkit-specialist"
      && source.includes("TOOLKIT_SPECIALIST_SOURCE_ONLY");
    const l0ManifestMaintenance = role === "doc-updater"
      && source.includes("This section is L0-source-only")
      && !hasRawCommand(source.replace(/node mcp-server\/build\/cli\/generate-template\.js/g, ""));
    if (!consumerLocalBundle && !explicitlySourceOnly && !l0ManifestMaintenance) errors.push("ambiguous-runtime-command");
  }
  return errors;
}

function validateRuntimeSkill(source: string): string[] {
  const errors: string[] = [];
  if (/^l0_requires:\s*ANDROID_COMMON_DOC\s*$/m.test(source)
      || /\$\{?ANDROID_COMMON_DOC|\$env:ANDROID_COMMON_DOC/i.test(source)) {
    errors.push("ambient-toolkit-root");
  }
  if (/\/Users\/[^/\s]+\/|[A-Za-z]:\\Users\\/i.test(source)) {
    errors.push("host-specific-path");
  }
  const operationIds = launcherOperationIds();
  for (const match of source.matchAll(/l0-toolkit-launcher\.cjs run ([a-z0-9-]+)/g)) {
    if (!operationIds.has(match[1])) errors.push(`runtime-operation-unknown:${match[1]}`);
  }
  return errors;
}

describe("runtime agent reference closure", () => {
  it("keeps all ten runtime role mirrors portable and fully classified", () => {
    for (const role of ROLES) {
      const canonical = readFileSync(path.join(ROOT, "setup/agent-templates", `${role}.md`), "utf8");
      const installed = readFileSync(path.join(ROOT, ".claude/agents", `${role}.md`), "utf8");
      expect(installed, `${role} mirror`).toBe(canonical);
      expect(validateRole(role, canonical), role).toEqual([]);
    }
  });

  it("keeps every materializable registry skill independent of ambient or host-specific toolkit paths", () => {
    const skills = materializableSkills();
    expect(skills.length).toBeGreaterThan(50);
    for (const skill of skills) {
      const source = readFileSync(path.join(ROOT, skill.path), "utf8");
      expect(validateRuntimeSkill(source), skill.name).toEqual([]);
    }
  });

  it("fails the contract for an unknown operation, missing or unclassified runtime doc, ambient root, or raw toolkit command", () => {
    const portable = readFileSync(path.join(ROOT, "setup/agent-templates/planner.md"), "utf8");
    expect(validateRole("planner", `${portable}\nnode .claude/runtime/l0-toolkit-launcher.cjs run missing-op`))
      .toContain("runtime-operation-unknown:missing-op");
    expect(validateRole("planner", `${portable}\n[lost](l0doc:docs/agents/not-present.md)`))
      .toContain("runtime-doc-missing:docs/agents/not-present.md");
    expect(validateRole("planner", `${portable}\nRead docs/agents/context-bundle-schema.md`))
      .toContain("unclassified-runtime-doc:docs/agents/context-bundle-schema.md");
    expect(validateRole("doc-updater", `${portable}\nRead docs/business/business-strategy-pricing.md`))
      .not.toContain("unclassified-runtime-doc:docs/business/business-strategy-pricing.md");
    expect(validateRole("planner", `${portable}\necho $ANDROID_COMMON_DOC`))
      .toContain("ambient-toolkit-root");
    expect(validateRole("planner", `${portable}\nbash scripts/sh/missing.sh`))
      .toContain("ambiguous-runtime-command");
    expect(validateRuntimeSkill("echo $ANDROID_COMMON_DOC")).toContain("ambient-toolkit-root");
    expect(validateRuntimeSkill("l0_requires: ANDROID_COMMON_DOC")).toContain("ambient-toolkit-root");
    expect(validateRuntimeSkill("echo $env:ANDROID_COMMON_DOC")).toContain("ambient-toolkit-root");
    expect(validateRuntimeSkill("Read /Users/example/AndroidCommonDoc/docs/a.md"))
      .toContain("host-specific-path");
  });
});
