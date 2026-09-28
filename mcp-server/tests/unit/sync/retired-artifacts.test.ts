import { createHash } from "node:crypto";
import { access, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  planRetiredArtifactReconciliation,
  syncL0,
} from "../../../src/sync/sync-engine.js";
import { createDefaultManifest, readManifest, writeManifest, type Manifest } from "../../../src/sync/manifest-schema.js";

const RETIRED_PATH = ".claude/agents/team-lead.md";
const REAL_L0_ROOT = path.resolve(import.meta.dirname, "../../../..");
const HISTORICAL_FIXTURE = path.join(
  REAL_L0_ROOT,
  "mcp-server/tests/fixtures/retired-team-lead-v6.2.1.md.fixture",
);
const HISTORICAL_TEAM_LEAD_SHA256 = "01c2f6e75d4e441bae0975ab459afda8501e0dbe57a2d60cf1827cd42ed969ba";
const LEGACY_CONTENT = `---\nname: team-lead\ntemplate_version: "6.2.1"\n---\n\nLegacy L0 team lead.\n`;
const LEGACY_SHA256 = createHash("sha256").update(LEGACY_CONTENT).digest("hex");

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    ...createDefaultManifest("../l0"),
    ...overrides,
  };
}

async function writeTombstone(toolkitRoot: string): Promise<void> {
  const registry = path.join(toolkitRoot, "skills", "sync-l0", "retired-artifacts.json");
  await mkdir(path.dirname(registry), { recursive: true });
  await writeFile(registry, JSON.stringify({
    format_version: "1.0",
    artifacts: [{
      id: "R001",
      kind: "agent",
      path: RETIRED_PATH,
      retired_in: "test",
      replacement: "docs/replacement.md",
      known_l0_sha256: [LEGACY_SHA256],
    }],
  }, null, 2));
}

async function writeLegacyAgent(projectRoot: string, content = LEGACY_CONTENT): Promise<void> {
  const destination = path.join(projectRoot, RETIRED_PATH);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

describe("permanent retired-artifact tombstones", () => {
  let root: string;
  let projectRoot: string;
  let toolkitRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "retired-artifacts-"));
    projectRoot = path.join(root, "consumer");
    toolkitRoot = path.join(root, "l0");
    await mkdir(projectRoot, { recursive: true });
    await writeTombstone(toolkitRoot);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("pins the audited 6.2.1 team-lead digest in both retirement registries", async () => {
    const historicalBytes = await readFile(HISTORICAL_FIXTURE);
    expect(createHash("sha256").update(historicalBytes).digest("hex"))
      .toBe(HISTORICAL_TEAM_LEAD_SHA256);
    const tombstones = JSON.parse(await readFile(
      path.join(REAL_L0_ROOT, "skills", "sync-l0", "retired-artifacts.json"), "utf8",
    ));
    const migrations = JSON.parse(await readFile(
      path.join(REAL_L0_ROOT, "setup", "agent-templates", "MIGRATIONS.json"), "utf8",
    ));
    expect(tombstones.artifacts[0].known_l0_sha256).toEqual([HISTORICAL_TEAM_LEAD_SHA256]);
    expect(migrations.templates["team-lead"]["RETIRED-W31.6"].known_l0_sha256)
      .toEqual([HISTORICAL_TEAM_LEAD_SHA256]);
  });

  it("production tombstone admits and ordinary sync removes the immutable historical fixture", async () => {
    const historicalBytes = await readFile(HISTORICAL_FIXTURE);
    const destination = path.join(projectRoot, RETIRED_PATH);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, historicalBytes);
    const realManifest = manifest({
      sources: [{ layer: "L0", path: REAL_L0_ROOT, role: "tooling" }],
      selection: {
        mode: "explicit",
        exclude_skills: [],
        exclude_agents: [],
        exclude_commands: [],
        exclude_categories: [],
        exclude_hooks: [],
      },
      checksums: { [RETIRED_PATH]: `sha256:${HISTORICAL_TEAM_LEAD_SHA256}` },
    });
    const plan = await planRetiredArtifactReconciliation(
      projectRoot,
      REAL_L0_ROOT,
      realManifest,
    );
    expect(plan.removePaths).toEqual([RETIRED_PATH]);
    await writeManifest(path.join(projectRoot, "l0-manifest.json"), realManifest);

    const report = await syncL0(projectRoot, REAL_L0_ROOT);

    expect(report.errors).toEqual([]);
    expect(report.removedPaths).toContain(RETIRED_PATH);
    await expect(access(destination)).rejects.toThrow();
  });

  it("production tombstone rejects a one-byte mutation of the historical fixture", async () => {
    const historicalBytes = await readFile(HISTORICAL_FIXTURE);
    const mutated = Buffer.from(historicalBytes);
    mutated[mutated.length - 2] ^= 1;
    const destination = path.join(projectRoot, RETIRED_PATH);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, mutated);

    await expect(planRetiredArtifactReconciliation(
      projectRoot,
      REAL_L0_ROOT,
      manifest(),
    )).rejects.toThrow(`retired-artifact-local-content-conflict:${RETIRED_PATH}`);
    expect(await readFile(destination)).toEqual(mutated);
  });

  it("admits only the exact historical bytes at the exact retired path", async () => {
    await writeLegacyAgent(projectRoot);
    const plan = await planRetiredArtifactReconciliation(projectRoot, toolkitRoot, manifest());
    expect(plan.removePaths).toEqual([RETIRED_PATH]);
    expect(plan.observedSha256[RETIRED_PATH]).toBe(LEGACY_SHA256);
  });

  it("recognizes an L0-materialized copy after stripping provenance headers", async () => {
    const materialized = LEGACY_CONTENT.replace(
      "template_version: \"6.2.1\"\n",
      `template_version: "6.2.1"\nl0_source: /old/l0\nl0_hash: sha256:${LEGACY_SHA256}\nl0_synced: 2026-04-25T00:00:00Z\n`,
    );
    await writeLegacyAgent(projectRoot, materialized);
    const plan = await planRetiredArtifactReconciliation(projectRoot, toolkitRoot, manifest({
      checksums: { [RETIRED_PATH]: `sha256:${LEGACY_SHA256}` },
    }));
    expect(plan.removePaths).toEqual([RETIRED_PATH]);
    expect(plan.removeChecksumPaths).toEqual([RETIRED_PATH]);
  });

  it("preserves and rejects locally modified retired content", async () => {
    await writeLegacyAgent(projectRoot, `${LEGACY_CONTENT}\nlocal change\n`);
    await expect(planRetiredArtifactReconciliation(projectRoot, toolkitRoot, manifest()))
      .rejects.toThrow(`retired-artifact-local-content-conflict:${RETIRED_PATH}`);
    expect(await readFile(path.join(projectRoot, RETIRED_PATH), "utf8")).toContain("local change");
  });

  it("preserves and rejects symlinks", async () => {
    const target = path.join(root, "target.md");
    await writeFile(target, LEGACY_CONTENT);
    await mkdir(path.dirname(path.join(projectRoot, RETIRED_PATH)), { recursive: true });
    await symlink(target, path.join(projectRoot, RETIRED_PATH));
    await expect(planRetiredArtifactReconciliation(projectRoot, toolkitRoot, manifest()))
      .rejects.toThrow(`retired-artifact-not-regular-file:${RETIRED_PATH}`);
  });

  it("preserves and rejects hardlinked retired content", async () => {
    const target = path.join(root, "shared-team-lead.md");
    await writeFile(target, LEGACY_CONTENT);
    await mkdir(path.dirname(path.join(projectRoot, RETIRED_PATH)), { recursive: true });
    await link(target, path.join(projectRoot, RETIRED_PATH));

    await expect(planRetiredArtifactReconciliation(projectRoot, toolkitRoot, manifest()))
      .rejects.toThrow(`retired-artifact-not-regular-file:${RETIRED_PATH}`);
    expect(await readFile(target, "utf8")).toBe(LEGACY_CONTENT);
    expect(await readFile(path.join(projectRoot, RETIRED_PATH), "utf8")).toBe(LEGACY_CONTENT);
  });

  it("rejects a symlinked agents directory before traversing outside the consumer", async () => {
    const outside = path.join(root, "outside-agents");
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "team-lead.md"), LEGACY_CONTENT);
    await mkdir(path.join(projectRoot, ".claude"), { recursive: true });
    await symlink(outside, path.join(projectRoot, ".claude", "agents"));

    await expect(planRetiredArtifactReconciliation(projectRoot, toolkitRoot, manifest()))
      .rejects.toThrow(`retired-artifact-unsafe-parent:${RETIRED_PATH}`);
    expect(await readFile(path.join(outside, "team-lead.md"), "utf8")).toBe(LEGACY_CONTENT);
  });

  it("rejects ambiguous casing instead of deleting it", async () => {
    await writeLegacyAgent(projectRoot);
    const exact = path.join(projectRoot, RETIRED_PATH);
    const variant = path.join(path.dirname(exact), "Team-Lead.md");
    try {
      await writeFile(variant, LEGACY_CONTENT);
    } catch {
      return; // Case-insensitive filesystems cannot represent the ambiguous state.
    }
    if (!(await readdir(path.dirname(exact))).includes("Team-Lead.md")) return;
    await expect(planRetiredArtifactReconciliation(projectRoot, toolkitRoot, manifest()))
      .rejects.toThrow(`retired-artifact-ambiguous-consumer-path:${RETIRED_PATH}`);
  });

  it("preserves project-owned L2 declarations and fails closed", async () => {
    await writeLegacyAgent(projectRoot);
    await expect(planRetiredArtifactReconciliation(projectRoot, toolkitRoot, manifest({
      l2_specific: { commands: [], agents: ["team-lead"], skills: [] },
    }))).rejects.toThrow(`retired-artifact-declared-l2-specific:${RETIRED_PATH}`);
  });

  it("rejects a manifest checksum that does not prove known L0 provenance", async () => {
    await writeLegacyAgent(projectRoot);
    await expect(planRetiredArtifactReconciliation(projectRoot, toolkitRoot, manifest({
      checksums: { [RETIRED_PATH]: `sha256:${"a".repeat(64)}` },
    }))).rejects.toThrow(`retired-artifact-unrecognized-manifest-provenance:${RETIRED_PATH}`);
  });

  it("prevents a retired artifact from being reintroduced by the toolkit", async () => {
    await writeLegacyAgent(toolkitRoot);
    await expect(planRetiredArtifactReconciliation(projectRoot, toolkitRoot, manifest()))
      .rejects.toThrow(`retired-artifact-reintroduced-in-toolkit:${RETIRED_PATH}`);
  });

  it("ordinary additive sync removes the exact tombstone without requiring --prune", async () => {
    await mkdir(path.join(toolkitRoot, "skills", "test"), { recursive: true });
    await writeFile(path.join(toolkitRoot, "skills", "test", "SKILL.md"), [
      "---", "name: test", "description: test", "---", "", "# Test", "",
    ].join("\n"));
    await writeLegacyAgent(projectRoot);
    await writeManifest(path.join(projectRoot, "l0-manifest.json"), manifest());

    const report = await syncL0(projectRoot, toolkitRoot);

    expect(report.errors).toEqual([]);
    expect(report.removedPaths).toContain(RETIRED_PATH);
    await expect(access(path.join(projectRoot, RETIRED_PATH))).rejects.toThrow();
    expect((await readManifest(path.join(projectRoot, "l0-manifest.json"))).checksums[RETIRED_PATH]).toBeUndefined();
  });

  it("--prune applies the same permanent tombstone independently of orphan cleanup", async () => {
    await mkdir(path.join(toolkitRoot, "skills", "test"), { recursive: true });
    await writeFile(path.join(toolkitRoot, "skills", "test", "SKILL.md"), [
      "---", "name: test", "description: test", "---", "", "# Test", "",
    ].join("\n"));
    await writeLegacyAgent(projectRoot);
    await writeManifest(path.join(projectRoot, "l0-manifest.json"), manifest());

    const report = await syncL0(projectRoot, toolkitRoot, { prune: true });

    expect(report.errors).toEqual([]);
    expect(report.removedPaths).toContain(RETIRED_PATH);
    await expect(access(path.join(projectRoot, RETIRED_PATH))).rejects.toThrow();
  });

  it("dry-run reports retirement but leaves the file and manifest untouched", async () => {
    await mkdir(path.join(toolkitRoot, "skills", "test"), { recursive: true });
    await writeFile(path.join(toolkitRoot, "skills", "test", "SKILL.md"), [
      "---", "name: test", "description: test", "---", "", "# Test", "",
    ].join("\n"));
    await writeLegacyAgent(projectRoot);
    const original = manifest({ checksums: { [RETIRED_PATH]: `sha256:${LEGACY_SHA256}` } });
    await writeManifest(path.join(projectRoot, "l0-manifest.json"), original);

    const report = await syncL0(projectRoot, toolkitRoot, { dryRun: true });

    expect(report.removedPaths).toContain(RETIRED_PATH);
    await expect(access(path.join(projectRoot, RETIRED_PATH))).resolves.toBeUndefined();
    expect((await readManifest(path.join(projectRoot, "l0-manifest.json"))).checksums[RETIRED_PATH])
      .toBe(`sha256:${LEGACY_SHA256}`);
  });
});
