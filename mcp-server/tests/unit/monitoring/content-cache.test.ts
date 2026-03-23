import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ContentCache } from "../../../src/monitoring/content-cache.js";
import type { FetchedContent } from "../../../src/monitoring/content-fetcher.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("content-cache", () => {
  let tempDir: string;
  let cache: ContentCache;

  const sampleContent: FetchedContent = {
    url: "https://example.com/docs/api",
    content: "# API Docs\n\nstateIn is recommended",
    contentHash: "abc123",
    fetchedAt: new Date().toISOString(),
    source: "jina",
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "cache-test-"));
    cache = new ContentCache({ projectRoot: tempDir, defaultTtlHours: 24 });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null for uncached URL", async () => {
    const result = await cache.get("https://not-cached.com");
    expect(result).toBeNull();
  });

  it("stores and retrieves content", async () => {
    await cache.set(sampleContent);
    const result = await cache.get(sampleContent.url);

    expect(result).not.toBeNull();
    expect(result!.url).toBe(sampleContent.url);
    expect(result!.content).toBe(sampleContent.content);
    expect(result!.contentHash).toBe(sampleContent.contentHash);
    expect(result!.source).toBe("jina");
  });

  it("returns null for expired entry", async () => {
    const expiredContent: FetchedContent = {
      ...sampleContent,
      fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
    };

    await cache.set(expiredContent);
    const result = await cache.get(expiredContent.url); // default TTL = 24h

    expect(result).toBeNull();
  });

  it("respects custom TTL", async () => {
    const recentContent: FetchedContent = {
      ...sampleContent,
      fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    };

    await cache.set(recentContent, 1); // TTL = 1h

    // Should be expired with 1h TTL
    const result = await cache.get(recentContent.url, 1);
    expect(result).toBeNull();

    // But fresh with 24h TTL
    const result2 = await cache.get(recentContent.url, 24);
    expect(result2).not.toBeNull();
  });

  it("has() returns true for fresh entries", async () => {
    await cache.set(sampleContent);
    expect(await cache.has(sampleContent.url)).toBe(true);
  });

  it("has() returns false for missing entries", async () => {
    expect(await cache.has("https://missing.com")).toBe(false);
  });

  it("invalidate() removes cached entry", async () => {
    await cache.set(sampleContent);
    expect(await cache.has(sampleContent.url)).toBe(true);

    await cache.invalidate(sampleContent.url);
    expect(await cache.has(sampleContent.url)).toBe(false);
  });

  it("invalidate() is safe on non-existent entry", async () => {
    await expect(
      cache.invalidate("https://never-cached.com"),
    ).resolves.not.toThrow();
  });

  it("uses deterministic path for same URL", () => {
    const path1 = cache.pathForUrl("https://example.com/a");
    const path2 = cache.pathForUrl("https://example.com/a");
    const path3 = cache.pathForUrl("https://example.com/b");

    expect(path1).toBe(path2);
    expect(path1).not.toBe(path3);
  });

  it("creates cache directory on first write", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync(cache.getCacheDir())).toBe(false);

    await cache.set(sampleContent);
    expect(existsSync(cache.getCacheDir())).toBe(true);
  });

  it("different URLs get different cache files", async () => {
    const content2: FetchedContent = {
      ...sampleContent,
      url: "https://other.com/docs",
      content: "Different content",
    };

    await cache.set(sampleContent);
    await cache.set(content2);

    const r1 = await cache.get(sampleContent.url);
    const r2 = await cache.get(content2.url);

    expect(r1!.content).toBe(sampleContent.content);
    expect(r2!.content).toBe(content2.content);
  });
});
