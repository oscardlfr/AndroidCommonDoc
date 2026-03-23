/**
 * Disk cache for fetched upstream content.
 *
 * Stores content at `.androidcommondoc/upstream-cache/{sha256(url)}.json`.
 * TTL-based invalidation. Shared by validate-upstream, ingest-content, audit-docs.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { logger } from "../utils/logger.js";
import type { FetchedContent } from "./content-fetcher.js";

/** Cached content entry on disk. */
export interface CachedEntry {
  url: string;
  content: string;
  contentHash: string;
  fetchedAt: string;
  source: "jina" | "raw";
  ttlHours: number;
}

/** Cache configuration. */
export interface CacheOptions {
  /** Project root — cache lives at `{projectRoot}/.androidcommondoc/upstream-cache/`. */
  projectRoot: string;
  /** Default TTL in hours (default: 24). */
  defaultTtlHours?: number;
}

const DEFAULT_TTL_HOURS = 24;

/**
 * Content cache backed by disk.
 */
export class ContentCache {
  private readonly cacheDir: string;
  private readonly defaultTtl: number;

  constructor(options: CacheOptions) {
    this.cacheDir = path.join(
      options.projectRoot,
      ".androidcommondoc",
      "upstream-cache",
    );
    this.defaultTtl = options.defaultTtlHours ?? DEFAULT_TTL_HOURS;
  }

  /**
   * Get cached content for a URL, if fresh.
   * Returns null if not cached or expired.
   */
  async get(url: string, ttlHours?: number): Promise<FetchedContent | null> {
    const filePath = this.pathForUrl(url);

    if (!existsSync(filePath)) return null;

    try {
      const raw = await readFile(filePath, "utf-8");
      const entry = JSON.parse(raw) as CachedEntry;

      const ttl = ttlHours ?? entry.ttlHours ?? this.defaultTtl;
      const fetchedAt = new Date(entry.fetchedAt).getTime();
      const age = (Date.now() - fetchedAt) / (1000 * 60 * 60);

      if (age > ttl) {
        logger.info(`Cache expired for ${url} (age: ${age.toFixed(1)}h, ttl: ${ttl}h)`);
        return null;
      }

      return {
        url: entry.url,
        content: entry.content,
        contentHash: entry.contentHash,
        fetchedAt: entry.fetchedAt,
        source: entry.source,
      };
    } catch (error) {
      logger.warn(`Cache read error for ${url}: ${error}`);
      return null;
    }
  }

  /**
   * Store fetched content in cache.
   */
  async set(data: FetchedContent, ttlHours?: number): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });

    const entry: CachedEntry = {
      url: data.url,
      content: data.content,
      contentHash: data.contentHash,
      fetchedAt: data.fetchedAt,
      source: data.source,
      ttlHours: ttlHours ?? this.defaultTtl,
    };

    const filePath = this.pathForUrl(data.url);

    try {
      await writeFile(filePath, JSON.stringify(entry, null, 2), "utf-8");
    } catch (error) {
      logger.warn(`Cache write error for ${data.url}: ${error}`);
    }
  }

  /**
   * Check if a URL has a fresh cache entry without reading the full content.
   */
  async has(url: string, ttlHours?: number): Promise<boolean> {
    return (await this.get(url, ttlHours)) !== null;
  }

  /**
   * Invalidate a cached entry.
   */
  async invalidate(url: string): Promise<void> {
    const filePath = this.pathForUrl(url);
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(filePath);
    } catch {
      // File didn't exist — fine
    }
  }

  /**
   * File path for a URL's cache entry.
   */
  pathForUrl(url: string): string {
    const hash = createHash("sha256").update(url).digest("hex");
    return path.join(this.cacheDir, `${hash}.json`);
  }

  /**
   * Get the cache directory path.
   */
  getCacheDir(): string {
    return this.cacheDir;
  }
}
