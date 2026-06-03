import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectChanges } from "../../../src/monitoring/change-detector.js";
import type { RegistryEntry } from "../../../src/registry/types.js";
import * as sourceChecker from "../../../src/monitoring/source-checker.js";
import type { CheckResult } from "../../../src/monitoring/source-checker.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("detectChanges", () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "detector-test-"));
    manifestPath = path.join(tmpDir, "versions-manifest.json");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── version drift ───────────────────────────────────────────────────────

  it("identifies version drift when upstream version differs from manifest", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: { "kotlinx-coroutines": "1.9.0" } }),
    );

    const entry = makeEntry("viewmodel-state-patterns", [
      { url: "https://github.com/Kotlin/kotlinx.coroutines/releases", type: "github-releases", tier: 1 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "1.10.2",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].category).toBe("version-drift");
    expect(report.findings[0].severity).toBe("MEDIUM");
    expect(report.findings[0].summary).toContain("1.9.0");
    expect(report.findings[0].summary).toContain("1.10.2");
  });

  it("returns no findings when version matches manifest", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: { "kotlinx-coroutines": "1.10.2" } }),
    );

    const entry = makeEntry("testing-patterns", [
      { url: "https://github.com/Kotlin/kotlinx.coroutines/releases", type: "github-releases", tier: 1 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "1.10.2",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    expect(report.findings).toHaveLength(0);
  });

  // ── release body scanning ───────────────────────────────────────────────

  it("adds breaking-change finding when release body contains breaking keyword AND version drifted", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: { "kotlinx-coroutines": "1.9.0" } }),
    );

    const entry = makeEntry("viewmodel-state-patterns", [
      { url: "https://github.com/Kotlin/kotlinx.coroutines/releases", type: "github-releases", tier: 1 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "2.0.0",
      release_body: "## What's new\n\nBreaking change: runBlocking is now deprecated in main thread contexts.",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    const breaking = report.findings.find((f) => f.category === "breaking-change");
    expect(breaking).toBeDefined();
    expect(breaking!.severity).toBe("HIGH");
    expect(breaking!.summary).toContain("2.0.0");
    expect(breaking!.summary).toContain("breaking change");
  });

  it("adds deprecation-in-release finding for deprecation keyword in release body", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: { "kotlinx-coroutines": "1.9.0" } }),
    );

    const entry = makeEntry("viewmodel-state-patterns", [
      { url: "https://github.com/Kotlin/kotlinx.coroutines/releases", type: "github-releases", tier: 1 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "1.10.0",
      release_body: "## Changes\n\nDeprecated: Flow.collect(block) overload. Use collectLatest instead.",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    const dep = report.findings.find((f) => f.category === "deprecation-in-release");
    expect(dep).toBeDefined();
    expect(dep!.severity).toBe("MEDIUM");
  });

  it("does NOT scan release body when version matches manifest (no drift)", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: { "kotlinx-coroutines": "1.10.2" } }),
    );

    const entry = makeEntry("viewmodel-state-patterns", [
      { url: "https://github.com/Kotlin/kotlinx.coroutines/releases", type: "github-releases", tier: 1 },
    ]);

    // Release body contains breaking keyword but version hasn't changed
    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "1.10.2",
      release_body: "Breaking change: this body should not be scanned because version matches.",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    // No drift → no release body scan → no breaking-change finding
    expect(report.findings).toHaveLength(0);
  });

  it("does NOT report breaking change for release body keyword when release_body is absent", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: { "kotlinx-coroutines": "1.9.0" } }),
    );

    const entry = makeEntry("viewmodel-state-patterns", [
      { url: "https://github.com/Kotlin/kotlinx.coroutines/releases", type: "github-releases", tier: 1 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "1.10.2",
      // no release_body
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    // Only version-drift, no breaking-change
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].category).toBe("version-drift");
  });

  // ── doc-page content change ─────────────────────────────────────────────

  it("reports doc-content-changed when hash differs from manifest content_hashes", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        versions: {},
        content_hashes: {
          "https://kotlinlang.org/docs/multiplatform.html": "aabbcc112233",
        },
      }),
    );

    const entry = makeEntry("kmp-architecture", [
      { url: "https://kotlinlang.org/docs/multiplatform.html", type: "doc-page", tier: 2 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://kotlinlang.org/docs/multiplatform.html",
      type: "doc-page",
      status: "ok",
      content_hash: "ddeeff445566",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].category).toBe("doc-content-changed");
    expect(report.findings[0].severity).toBe("LOW");
    expect(report.findings[0].details).toContain("aabbcc");
    expect(report.findings[0].details).toContain("ddeeff");
  });

  it("returns no finding when doc-page hash matches manifest", async () => {
    const knownHash = "aabbcc112233";
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        versions: {},
        content_hashes: {
          "https://kotlinlang.org/docs/multiplatform.html": knownHash,
        },
      }),
    );

    const entry = makeEntry("kmp-architecture", [
      { url: "https://kotlinlang.org/docs/multiplatform.html", type: "doc-page", tier: 2 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://kotlinlang.org/docs/multiplatform.html",
      type: "doc-page",
      status: "ok",
      content_hash: knownHash,
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    expect(report.findings).toHaveLength(0);
  });

  it("returns no finding for doc-page with no baseline hash in manifest (untracked page)", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: {}, content_hashes: {} }),
    );

    const entry = makeEntry("kmp-architecture", [
      { url: "https://kotlinlang.org/docs/multiplatform.html", type: "doc-page", tier: 2 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://kotlinlang.org/docs/multiplatform.html",
      type: "doc-page",
      status: "ok",
      content_hash: "somehash",
      fetched_at: new Date().toISOString(),
    });

    // No known hash → no finding (not an error, just untracked)
    const report = await detectChanges([entry], manifestPath);
    expect(report.findings).toHaveLength(0);
  });

  it("does NOT scan doc-page content for keywords (never)", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        versions: {},
        content_hashes: {
          // Same hash → content unchanged
          "https://kotlinlang.org/docs/multiplatform.html": "existinghash",
        },
      }),
    );

    const entry = makeEntry("kmp-architecture", [
      { url: "https://kotlinlang.org/docs/multiplatform.html", type: "doc-page", tier: 2 },
    ]);

    // Page content contains every keyword — but hash unchanged → no finding
    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://kotlinlang.org/docs/multiplatform.html",
      type: "doc-page",
      status: "ok",
      content_hash: "existinghash",
      raw_content: "deprecated removed breaking change migration required",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    expect(report.findings).toHaveLength(0);
  });

  // ── misc ────────────────────────────────────────────────────────────────

  it("skips entries without monitor_urls", async () => {
    const entry = makeEntry("basic-doc", []);
    const spy = vi.spyOn(sourceChecker, "checkSource");
    const report = await detectChanges([entry]);
    expect(report.findings).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("handles missing versions-manifest.json gracefully", async () => {
    const nonExistentPath = path.join(tmpDir, "non-existent.json");
    const entry = makeEntry("test-doc", [
      { url: "https://github.com/Test/lib/releases", type: "github-releases", tier: 1 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/Test/lib/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "2.0.0",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], nonExistentPath);
    expect(report.errors).toBe(0);
    // No manifest → no version comparison → no findings
    expect(report.findings).toHaveLength(0);
  });

  it("counts errors when checkSource fails", async () => {
    await fs.writeFile(manifestPath, JSON.stringify({ versions: {} }));
    const entry = makeEntry("test-doc", [
      { url: "https://github.com/Test/lib/releases", type: "github-releases", tier: 1 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/Test/lib/releases",
      type: "github-releases",
      status: "error",
      error: "404 Not Found",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    expect(report.errors).toBe(1);
  });

  it("generates deterministic finding_hash for same finding data", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: { "kotlinx-coroutines": "1.9.0" } }),
    );

    const entry = makeEntry("viewmodel-state-patterns", [
      { url: "https://github.com/Kotlin/kotlinx.coroutines/releases", type: "github-releases", tier: 1 },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "1.10.2",
      fetched_at: new Date().toISOString(),
    });

    const [r1, r2] = await Promise.all([
      detectChanges([entry], manifestPath),
      detectChanges([entry], manifestPath),
    ]);

    expect(r1.findings[0].finding_hash).toBe(r2.findings[0].finding_hash);
    expect(r1.findings[0].finding_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  // ── manifest_key explicit resolution ────────────────────────────────────

  it("uses manifest_key directly — no URL heuristic — when manifest_key is present", async () => {
    // versions has both kotlin and kotlinx-coroutines — heuristic would be ambiguous
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        versions: {
          kotlin: "2.3.10",
          "kotlinx-coroutines": "1.10.2",
        },
      }),
    );

    // URL is github.com/JetBrains/kotlin — heuristic would match "kotlin" AND "kotlinx-coroutines"
    // (because "kotlin" is a substring of "kotlinx-coroutines" URL-normalised)
    // manifest_key: kotlin ensures only the "kotlin" key is checked
    const entry = makeEntry("kmp-architecture", [
      {
        url: "https://github.com/JetBrains/kotlin/releases",
        type: "github-releases",
        tier: 1,
        manifest_key: "kotlin",
      },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/JetBrains/kotlin/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "2.3.20",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].summary).toContain("kotlin");
    expect(report.findings[0].summary).toContain("2.3.10");
    expect(report.findings[0].summary).toContain("2.3.20");
    // Must NOT produce a finding for kotlinx-coroutines
    expect(report.findings[0].summary).not.toContain("kotlinx-coroutines");
  });

  it("manifest_key: no finding when upstream matches manifest exactly", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: { kotlin: "2.3.20" } }),
    );

    const entry = makeEntry("kmp-architecture", [
      {
        url: "https://github.com/JetBrains/kotlin/releases",
        type: "github-releases",
        tier: 1,
        manifest_key: "kotlin",
      },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/JetBrains/kotlin/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "2.3.20",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    expect(report.findings).toHaveLength(0);
  });

  it("manifest_key missing from versions: warns and returns no findings (no crash)", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: { agp: "9.0.0" } }), // no "kotlin" key
    );

    const entry = makeEntry("kmp-architecture", [
      {
        url: "https://github.com/JetBrains/kotlin/releases",
        type: "github-releases",
        tier: 1,
        manifest_key: "kotlin",
      },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/JetBrains/kotlin/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "2.3.20",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    expect(report.findings).toHaveLength(0);
    expect(report.errors).toBe(0); // not counted as error — just skipped
  });

  it("heuristic fallback still works when manifest_key is absent", async () => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ versions: { "kotlinx-coroutines": "1.9.0" } }),
    );

    // No manifest_key — relies on URL substring matching
    const entry = makeEntry("testing-patterns", [
      {
        url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
        type: "github-releases",
        tier: 1,
      },
    ]);

    vi.spyOn(sourceChecker, "checkSource").mockResolvedValue({
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      status: "ok",
      latest_version: "1.10.2",
      fetched_at: new Date().toISOString(),
    });

    const report = await detectChanges([entry], manifestPath);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].summary).toContain("kotlinx-coroutines");
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

function makeEntry(
  slug: string,
  monitorUrls: Array<{ url: string; type: string; tier: number }>,
): RegistryEntry {
  return {
    slug,
    filepath: `/docs/${slug}.md`,
    metadata: {
      scope: ["test"],
      sources: ["lib"],
      targets: ["android"],
      monitor_urls: monitorUrls as RegistryEntry["metadata"]["monitor_urls"],
    },
    layer: "L0",
  };
}
