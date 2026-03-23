/**
 * Content fetcher with Jina Reader integration and raw HTTP fallback.
 *
 * Shared infrastructure for:
 * - `validate-upstream` (automated assertions against upstream docs)
 * - `ingest-content` (manual content analysis)
 * - `audit-docs` Wave 3 (upstream validation)
 *
 * Fetches URL content as clean markdown. Jina Reader is preferred
 * (strips nav, ads, renders JS pages). Raw HTTP is the fallback.
 */

import { logger } from "../utils/logger.js";

/** Result of a content fetch operation. */
export interface FetchedContent {
  url: string;
  /** Clean markdown content. */
  content: string;
  /** SHA-256 hex hash of content. */
  contentHash: string;
  /** ISO-8601 timestamp of fetch. */
  fetchedAt: string;
  /** Which method succeeded. */
  source: "jina" | "raw";
}

/** Fetch failure. */
export interface FetchError {
  url: string;
  error: string;
  source: "jina" | "raw";
}

export type FetchResult =
  | { ok: true; data: FetchedContent }
  | { ok: false; error: FetchError };

/** Options for content fetching. */
export interface FetchOptions {
  /** Timeout in ms (default: 15000). */
  timeout?: number;
  /** Skip Jina, use raw HTTP only (default: false). */
  rawOnly?: boolean;
  /** Custom User-Agent header. */
  userAgent?: string;
}

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_USER_AGENT = "AndroidCommonDoc-MCP/1.0";
const JINA_PREFIX = "https://r.jina.ai/";

/**
 * Fetch content from a URL as clean markdown.
 * Tries Jina Reader first, falls back to raw HTTP.
 */
export async function fetchContent(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  // Try Jina Reader first (unless rawOnly)
  if (!options.rawOnly) {
    const jinaResult = await fetchWithJina(url, timeout, userAgent);
    if (jinaResult.ok) return jinaResult;
    logger.info(`Jina fetch failed for ${url}: ${jinaResult.error.error}, trying raw HTTP`);
  }

  // Fallback to raw HTTP
  return fetchRaw(url, timeout, userAgent);
}

/**
 * Fetch via Jina Reader — returns clean markdown.
 */
async function fetchWithJina(
  url: string,
  timeout: number,
  userAgent: string,
): Promise<FetchResult> {
  const jinaUrl = `${JINA_PREFIX}${url}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/plain",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        ok: false,
        error: { url, error: `Jina HTTP ${response.status}`, source: "jina" },
      };
    }

    const content = await response.text();
    if (!content || content.trim().length === 0) {
      return {
        ok: false,
        error: { url, error: "Jina returned empty content", source: "jina" },
      };
    }

    return {
      ok: true,
      data: {
        url,
        content: content.trim(),
        contentHash: await hashContent(content),
        fetchedAt: new Date().toISOString(),
        source: "jina",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: { url, error: `Jina error: ${message}`, source: "jina" },
    };
  }
}

/**
 * Fetch via raw HTTP — basic HTML stripping.
 */
async function fetchRaw(
  url: string,
  timeout: number,
  userAgent: string,
): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": userAgent },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        ok: false,
        error: { url, error: `HTTP ${response.status}`, source: "raw" },
      };
    }

    const raw = await response.text();
    const content = stripHtmlToText(raw);

    if (!content || content.trim().length === 0) {
      return {
        ok: false,
        error: { url, error: "Empty content after stripping", source: "raw" },
      };
    }

    return {
      ok: true,
      data: {
        url,
        content: content.trim(),
        contentHash: await hashContent(content),
        fetchedAt: new Date().toISOString(),
        source: "raw",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: { url, error: `Raw error: ${message}`, source: "raw" },
    };
  }
}

/**
 * Strip HTML tags and decode entities for basic text extraction.
 * Not a full parser — good enough for grep/assertion matching.
 */
export function stripHtmlToText(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // Replace block elements with newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Remove remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * SHA-256 hash of content string.
 */
async function hashContent(content: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
