/**
 * Content fetcher with Jina Reader, raw HTTP, and Android CLI KB integration.
 *
 * Shared infrastructure for:
 * - `validate-upstream` (automated assertions against upstream docs)
 * - `ingest-content` (manual content analysis)
 * - `audit-docs` Wave 3 (upstream validation)
 *
 * Routing by URL scheme:
 * - `kb://android/...`  → Android CLI (`android docs fetch`) — offline-capable
 *                         for cached KB entries after first run.
 * - `https://...`       → Jina Reader (clean markdown), raw HTTP fallback.
 */

import { spawn } from "node:child_process";
import { logger } from "../utils/logger.js";

/** Origin of a fetch result. */
export type FetchSource = "jina" | "raw" | "android-cli";

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
  source: FetchSource;
}

/** Fetch failure. */
export interface FetchError {
  url: string;
  error: string;
  source: FetchSource;
}

export type FetchResult =
  | { ok: true; data: FetchedContent }
  | { ok: false; error: FetchError };

/** Options for content fetching. */
export interface FetchOptions {
  /** Timeout in ms (default: 30000). */
  timeout?: number;
  /** Skip Jina, use raw HTTP only (default: false). Ignored for kb:// URLs. */
  rawOnly?: boolean;
  /** Custom User-Agent header (HTTP paths only). */
  userAgent?: string;
  /**
   * Explicitly prefer a source. If omitted, the source is inferred from the
   * URL scheme (`kb://` → android-cli, `https://` → jina/raw).
   */
  preferredSource?: FetchSource;
  /**
   * Injection point for the Android CLI spawner — allows tests to replace the
   * real child_process spawn with a stub. Production code should not set this.
   */
  androidCliRunner?: AndroidCliRunner;
}

/** Abstraction over running `android docs fetch <url>` for testability. */
export type AndroidCliRunner = (
  args: string[],
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_USER_AGENT = "AndroidCommonDoc-MCP/1.0";
const JINA_PREFIX = "https://r.jina.ai/";
const ANDROID_CLI_SEPARATOR = "----------------------------------------";

/**
 * Fetch content from a URL as clean markdown.
 *
 * Routing:
 * - `kb://` URLs → Android CLI (offline-capable KB fetch).
 * - `https://` URLs → Jina Reader, raw HTTP fallback.
 * - `options.preferredSource` overrides scheme inference.
 */
export async function fetchContent(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const useAndroidCli =
    options.preferredSource === "android-cli" || url.startsWith("kb://");

  if (useAndroidCli) {
    const result = await fetchWithAndroidCli(url, timeout, options.androidCliRunner);
    if (result.ok) return result;
    // `kb://` URLs cannot fall back to HTTP — propagate the error.
    if (url.startsWith("kb://")) return result;
    logger.info(
      `android-cli fetch failed for ${url}: ${result.error.error}, falling back to webfetch`,
    );
  }

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
 * Fetch content via the Android CLI Knowledge Base (`android docs fetch`).
 *
 * Output format (observed on Android CLI v0.7):
 *
 *     Waiting for index to be ready...
 *     Fetching docs from: kb://android/...
 *     Title: <title>
 *     URL: kb://android/...
 *     ----------------------------------------
 *     <markdown body>
 *
 * Errors surface as "No document found for URL: kb://..." on stdout (exit 0)
 * or as non-zero exit codes when the binary is missing / adb fails.
 *
 * The body-after-separator is returned as clean markdown; everything before
 * the 40-dash separator is protocol chatter.
 */
async function fetchWithAndroidCli(
  url: string,
  timeout: number,
  runner?: AndroidCliRunner,
): Promise<FetchResult> {
  if (!url.startsWith("kb://")) {
    return {
      ok: false,
      error: {
        url,
        error: "android-cli source requires a kb:// URI",
        source: "android-cli",
      },
    };
  }

  try {
    const run = runner ?? defaultAndroidCliRunner;
    const { stdout, stderr, exitCode } = await run(
      ["docs", "fetch", url],
      timeout,
    );

    if (exitCode !== 0) {
      // Heuristic classification of common failure modes — avoids leaking
      // Java stack traces while keeping enough signal for diagnostics.
      const firstLine = stderr.trim().split("\n")[0] ?? "unknown error";
      const message = /command not found|ENOENT|is not recognized/i.test(stderr)
        ? `Android CLI not on PATH (install from d.android.com/tools/agents)`
        : `android docs fetch exited ${exitCode}: ${firstLine}`;
      return {
        ok: false,
        error: { url, error: message, source: "android-cli" },
      };
    }

    // Empty KB hit — observed format: "No document found for URL: kb://..."
    if (/^No document found/m.test(stdout)) {
      return {
        ok: false,
        error: {
          url,
          error: `Knowledge Base has no entry for ${url}`,
          source: "android-cli",
        },
      };
    }

    const separatorIdx = stdout.indexOf(ANDROID_CLI_SEPARATOR);
    const body =
      separatorIdx >= 0
        ? stdout.slice(separatorIdx + ANDROID_CLI_SEPARATOR.length)
        : stdout;
    const content = body.trim();

    if (content.length === 0) {
      return {
        ok: false,
        error: {
          url,
          error: "android docs fetch returned empty content",
          source: "android-cli",
        },
      };
    }

    return {
      ok: true,
      data: {
        url,
        content,
        contentHash: await hashContent(content),
        fetchedAt: new Date().toISOString(),
        source: "android-cli",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: { url, error: `android-cli error: ${message}`, source: "android-cli" },
    };
  }
}

/** Default runner that spawns the real `android` binary. */
const defaultAndroidCliRunner: AndroidCliRunner = (args, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn("android", args, { windowsHide: true });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({
          stdout,
          stderr: stderr || `timed out after ${timeoutMs}ms`,
          exitCode: 124,
        });
      }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr: err.message, exitCode: 127 });
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });
  });

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
