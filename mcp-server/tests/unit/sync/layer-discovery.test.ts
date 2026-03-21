import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

import {
  classifyRepo,
  discoverLayers,
  formatDiscovery,
  suggestTopology,
  type DiscoveryResult,
} from "../../../src/sync/layer-discovery.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeL0(dir: string): void {
  mkdirSync(join(dir, "skills"), { recursive: true });
  writeFileSync(join(dir, "skills", "registry.json"), '{"entries":[]}');
  mkdirSync(join(dir, "mcp-server"), { recursive: true });
}

function makeL1(dir: string, l0RelPath: string = "../L0"): void {
  mkdirSync(join(dir, "skills"), { recursive: true });
  writeFileSync(join(dir, "skills", "registry.json"), '{"entries":[]}');
  writeFileSync(
    join(dir, "l0-manifest.json"),
    JSON.stringify({
      version: 2,
      sources: [{ layer: "L0", path: l0RelPath, role: "tooling" }],
      topology: "flat",
      last_synced: "2026-01-01T00:00:00Z",
      selection: { mode: "include-all", exclude_skills: [], exclude_agents: [], exclude_commands: [], exclude_categories: [] },
      checksums: {},
      l2_specific: { commands: [], agents: [], skills: [] },
    }),
  );
}

function makeL2(dir: string, sources: Array<{ layer: string; path: string; role: string }>): void {
  writeFileSync(
    join(dir, "l0-manifest.json"),
    JSON.stringify({
      version: 2,
      sources,
      topology: sources.length > 1 ? "chain" : "flat",
      last_synced: "2026-01-01T00:00:00Z",
      selection: { mode: "include-all", exclude_skills: [], exclude_agents: [], exclude_commands: [], exclude_categories: [] },
      checksums: {},
      l2_specific: { commands: [], agents: [], skills: [] },
    }),
  );
}

// ---------------------------------------------------------------------------
// classifyRepo
// ---------------------------------------------------------------------------

describe("classifyRepo", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "classify-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("classifies L0: has registry + mcp-server, no manifest", () => {
    const l0 = join(tempDir, "L0");
    mkdirSync(l0);
    makeL0(l0);
    expect(classifyRepo(l0)).toBe("L0");
  });

  it("classifies L1: has registry + manifest", () => {
    const l1 = join(tempDir, "L1");
    mkdirSync(l1);
    makeL1(l1);
    expect(classifyRepo(l1)).toBe("L1");
  });

  it("classifies L2: has manifest only, no registry", () => {
    const l2 = join(tempDir, "L2");
    mkdirSync(l2);
    makeL2(l2, [{ layer: "L0", path: "../L0", role: "tooling" }]);
    expect(classifyRepo(l2)).toBe("L2");
  });

  it("classifies unknown: no markers", () => {
    const empty = join(tempDir, "empty");
    mkdirSync(empty);
    expect(classifyRepo(empty)).toBe("unknown");
  });

  it("classifies unknown: nonexistent path", () => {
    expect(classifyRepo(join(tempDir, "no-such-dir"))).toBe("unknown");
  });

  it("classifies unknown: random project (has gradle but no L0 markers)", () => {
    const proj = join(tempDir, "java-app");
    mkdirSync(proj);
    writeFileSync(join(proj, "build.gradle.kts"), "plugins {}");
    expect(classifyRepo(proj)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// discoverLayers
// ---------------------------------------------------------------------------

describe("discoverLayers", () => {
  let workspace: string;

  beforeEach(() => {
    // Nest workspace 2 levels deep so parent scan doesn't escape into tmpdir
    // where other test suites may have created L0-like dirs
    const base = mkdtempSync(join(tmpdir(), "discover-ws-"));
    workspace = join(base, "isolated", "root");
    mkdirSync(workspace, { recursive: true });
    delete process.env.ANDROID_COMMON_DOC;
  });

  afterEach(() => {
    // Remove the full base (3 levels up from workspace = isolated/root)
    const base = join(workspace, "..", "..");
    rmSync(base, { recursive: true, force: true });
    delete process.env.ANDROID_COMMON_DOC;
  });

  it("discovers L0 in sibling directory", () => {
    const l0 = join(workspace, "AndroidCommonDoc");
    const project = join(workspace, "MyApp");
    mkdirSync(l0);
    mkdirSync(project);
    makeL0(l0);

    const result = discoverLayers(project);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].role).toBe("L0");
    expect(result.layers[0].name).toBe("AndroidCommonDoc");
    expect(result.layers[0].source).toBe("scan");
  });

  it("discovers L0 and L1 in sibling directories", () => {
    const l0 = join(workspace, "AndroidCommonDoc");
    const l1 = join(workspace, "shared-kmp-libs");
    const project = join(workspace, "DawSync");
    mkdirSync(l0);
    mkdirSync(l1);
    mkdirSync(project);
    makeL0(l0);
    makeL1(l1, "../AndroidCommonDoc");

    const result = discoverLayers(project);
    expect(result.layers).toHaveLength(2);
    // Sorted: L0 first, L1 second
    expect(result.layers[0].role).toBe("L0");
    expect(result.layers[1].role).toBe("L1");
  });

  it("prioritizes ANDROID_COMMON_DOC env var for L0", () => {
    const l0 = join(workspace, "custom-path-l0");
    const project = join(workspace, "MyApp");
    mkdirSync(l0);
    mkdirSync(project);
    makeL0(l0);

    process.env.ANDROID_COMMON_DOC = l0;
    const result = discoverLayers(project);

    const envLayer = result.layers.find(l => l.source === "env");
    expect(envLayer).toBeDefined();
    expect(envLayer!.role).toBe("L0");
  });

  it("extracts sources from existing l0-manifest.json", () => {
    const l0 = join(workspace, "AndroidCommonDoc");
    const project = join(workspace, "MyApp");
    mkdirSync(l0);
    mkdirSync(project);
    makeL0(l0);
    makeL2(project, [{ layer: "L0", path: "../AndroidCommonDoc", role: "tooling" }]);

    const result = discoverLayers(project);
    const manifestLayer = result.layers.find(l => l.source === "manifest");
    expect(manifestLayer).toBeDefined();
    expect(manifestLayer!.role).toBe("L0");
  });

  it("reads v1 manifest with l0_source field", () => {
    const l0 = join(workspace, "AndroidCommonDoc");
    const project = join(workspace, "OldProject");
    mkdirSync(l0);
    mkdirSync(project);
    makeL0(l0);
    writeFileSync(
      join(project, "l0-manifest.json"),
      JSON.stringify({
        version: 1,
        l0_source: "../AndroidCommonDoc",
        last_synced: "2026-01-01T00:00:00Z",
        selection: { mode: "include-all", exclude_skills: [], exclude_agents: [], exclude_commands: [], exclude_categories: [] },
        checksums: {},
        l2_specific: { commands: [], agents: [], skills: [] },
      }),
    );

    const result = discoverLayers(project);
    expect(result.layers.some(l => l.name === "AndroidCommonDoc")).toBe(true);
  });

  it("deduplicates: env + scan + manifest for same repo", () => {
    const l0 = join(workspace, "AndroidCommonDoc");
    const project = join(workspace, "MyApp");
    mkdirSync(l0);
    mkdirSync(project);
    makeL0(l0);
    makeL2(project, [{ layer: "L0", path: "../AndroidCommonDoc", role: "tooling" }]);
    process.env.ANDROID_COMMON_DOC = l0;

    const result = discoverLayers(project);
    const l0Layers = result.layers.filter(l => l.role === "L0");
    expect(l0Layers).toHaveLength(1); // deduplicated
  });

  it("warns when manifest source path doesn't exist", () => {
    const project = join(workspace, "Broken");
    mkdirSync(project);
    makeL2(project, [{ layer: "L0", path: "../NonExistent", role: "tooling" }]);

    const result = discoverLayers(project);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("not found");
  });

  it("warns when ANDROID_COMMON_DOC points to nonexistent path", () => {
    const project = join(workspace, "MyApp");
    mkdirSync(project);
    process.env.ANDROID_COMMON_DOC = join(workspace, "ghost");

    const result = discoverLayers(project);
    expect(result.warnings.some(w => w.includes("does not exist"))).toBe(true);
  });

  it("does not discover itself", () => {
    const project = join(workspace, "SelfTest");
    mkdirSync(project);
    makeL0(project); // project is L0 itself

    const result = discoverLayers(project);
    expect(result.layers).toHaveLength(0);
    expect(result.projectRole).toBe("L0");
  });

  it("classifies the project's own role", () => {
    const l0 = join(workspace, "L0");
    const l1 = join(workspace, "L1");
    const l2 = join(workspace, "L2");
    mkdirSync(l0); makeL0(l0);
    mkdirSync(l1); makeL1(l1);
    mkdirSync(l2); makeL2(l2, [{ layer: "L0", path: "../L0", role: "tooling" }]);

    expect(discoverLayers(l0).projectRole).toBe("L0");
    expect(discoverLayers(l1).projectRole).toBe("L1");
    expect(discoverLayers(l2).projectRole).toBe("L2");
  });

  it("skips hidden directories during scan", () => {
    const hidden = join(workspace, ".hidden-l0");
    const project = join(workspace, "MyApp");
    mkdirSync(hidden);
    mkdirSync(project);
    makeL0(hidden);

    const result = discoverLayers(project);
    expect(result.layers).toHaveLength(0);
  });

  it("returns empty layers for isolated project", () => {
    // Create a deeply nested workspace so parent scan doesn't find real repos
    const isolated = join(workspace, "deep", "nest", "IsolatedApp");
    mkdirSync(isolated, { recursive: true });

    const result = discoverLayers(isolated);
    expect(result.layers).toHaveLength(0);
    expect(result.projectRole).toBe("unknown");
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatDiscovery
// ---------------------------------------------------------------------------

describe("formatDiscovery", () => {
  it("formats empty result", () => {
    const result: DiscoveryResult = { layers: [], projectRole: "unknown", warnings: [] };
    expect(formatDiscovery(result)).toContain("No L0/L1 sources found");
  });

  it("formats discovered layers with source tags", () => {
    const result: DiscoveryResult = {
      layers: [
        { absolutePath: "/ws/L0", relativePath: "../L0", role: "L0", name: "AndroidCommonDoc", source: "env", valid: true },
        { absolutePath: "/ws/L1", relativePath: "../L1", role: "L1", name: "shared-kmp-libs", source: "scan", valid: true },
      ],
      projectRole: "L2",
      warnings: [],
    };
    const output = formatDiscovery(result);
    expect(output).toContain("L0: AndroidCommonDoc");
    expect(output).toContain("$ANDROID_COMMON_DOC");
    expect(output).toContain("L1: shared-kmp-libs");
    expect(output).toContain("found nearby");
  });

  it("shows invalid marker for missing paths", () => {
    const result: DiscoveryResult = {
      layers: [
        { absolutePath: "/ws/L0", relativePath: "../L0", role: "L0", name: "L0", source: "manifest", valid: false },
      ],
      projectRole: "L2",
      warnings: [],
    };
    const output = formatDiscovery(result);
    expect(output).toContain("❌");
  });
});

// ---------------------------------------------------------------------------
// suggestTopology
// ---------------------------------------------------------------------------

describe("suggestTopology", () => {
  it("suggests flat when only L0 found", () => {
    const result: DiscoveryResult = {
      layers: [
        { absolutePath: "/ws/L0", relativePath: "../L0", role: "L0", name: "L0", source: "scan", valid: true },
      ],
      projectRole: "L2",
      warnings: [],
    };
    expect(suggestTopology(result).topology).toBe("flat");
  });

  it("suggests chain when L1 found and project is not L1", () => {
    const result: DiscoveryResult = {
      layers: [
        { absolutePath: "/ws/L0", relativePath: "../L0", role: "L0", name: "L0", source: "scan", valid: true },
        { absolutePath: "/ws/L1", relativePath: "../L1", role: "L1", name: "shared-kmp-libs", source: "scan", valid: true },
      ],
      projectRole: "L2",
      warnings: [],
    };
    const suggestion = suggestTopology(result);
    expect(suggestion.topology).toBe("chain");
    expect(suggestion.reason).toContain("shared-kmp-libs");
  });

  it("suggests flat when project IS L1 (it consumes L0 directly)", () => {
    const result: DiscoveryResult = {
      layers: [
        { absolutePath: "/ws/L0", relativePath: "../L0", role: "L0", name: "L0", source: "scan", valid: true },
      ],
      projectRole: "L1",
      warnings: [],
    };
    expect(suggestTopology(result).topology).toBe("flat");
  });

  it("suggests flat when no sources found at all", () => {
    const result: DiscoveryResult = { layers: [], projectRole: "unknown", warnings: [] };
    expect(suggestTopology(result).topology).toBe("flat");
  });
});
