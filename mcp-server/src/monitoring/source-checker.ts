/**
 * Source checker for fetching upstream documentation sources.
 *
 * Checks GitHub releases, Maven Central, and documentation pages
 * to detect version changes and content modifications. Uses global
 * fetch (Node 18+) with AbortController for timeouts.
 */

import { createHash } from "node:crypto";
import type { MonitorUrl, MonitorUrlType } from "../registry/types.js";
import { logger } from "../utils/logger.js";

/** Timeout in milliseconds for HTTP requests. */
const FETCH_TIMEOUT_MS = 15_000;

/** Result of checking a single upstream source. */
export interface CheckResult {
  url: string;
  type: MonitorUrlType;
  status: "ok" | "error" | "unreachable";
  content_hash?: string;
  latest_version?: string;
  /** Release notes body for the latest release (github-releases only). */
  release_body?: string;
  /** @deprecated Raw page content — use content_hash for change detection instead. */
  raw_content?: string;
  error?: string;
  fetched_at: string;
}

/**
 * Extract owner and repo from a GitHub URL.
 * Supports: https://github.com/{owner}/{repo}/releases
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+?)(?:\/releases)?(?:\/|$)/,
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Check a single upstream source URL and return the result.
 *
 * @param monitorUrl - The monitoring URL configuration from frontmatter
 * @returns Check result with status, version, hash, or error details
 */
export async function checkSource(monitorUrl: MonitorUrl): Promise<CheckResult> {
  const base: Pick<CheckResult, "url" | "type" | "fetched_at"> = {
    url: monitorUrl.url,
    type: monitorUrl.type,
    fetched_at: new Date().toISOString(),
  };

  logger.info(`Checking source: ${monitorUrl.url} (${monitorUrl.type})`);

  try {
    switch (monitorUrl.type) {
      case "github-releases":
        return await checkGitHubReleases(monitorUrl.url, base);
      case "maven-central":
        return await checkMavenCentral(monitorUrl.url, base);
      case "doc-page":
        return await checkDocPage(monitorUrl.url, base);
      case "changelog":
        return await checkDocPage(monitorUrl.url, base);
      default:
        return {
          ...base,
          status: "error",
          error: `Unsupported URL type: ${monitorUrl.type}`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Source check failed for ${monitorUrl.url}: ${message}`);
    return {
      ...base,
      status: "unreachable",
      error: message,
    };
  }
}

/**
 * Check GitHub releases API for the latest version.
 */
async function checkGitHubReleases(
  url: string,
  base: Pick<CheckResult, "url" | "type" | "fetched_at">,
): Promise<CheckResult> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    return {
      ...base,
      status: "error",
      error: `Could not parse GitHub URL: ${url}`,
    };
  }

  const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/latest`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!response.ok) {
      return handleHttpError(response, base);
    }

    const data = (await response.json()) as {
      tag_name?: string;
      body?: string;
    };
    const version = data.tag_name?.replace(/^v/, "") ?? undefined;

    return {
      ...base,
      status: "ok",
      latest_version: version,
      release_body: data.body ?? undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check Maven Central for the latest version of an artifact.
 */
async function checkMavenCentral(
  url: string,
  base: Pick<CheckResult, "url" | "type" | "fetched_at">,
): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      return handleHttpError(response, base);
    }

    const data = (await response.json()) as {
      response?: { docs?: Array<{ latestVersion?: string }> };
    };
    const version = data.response?.docs?.[0]?.latestVersion ?? undefined;

    return {
      ...base,
      status: "ok",
      latest_version: version,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check a documentation page for content changes via SHA-256 hash.
 */
async function checkDocPage(
  url: string,
  base: Pick<CheckResult, "url" | "type" | "fetched_at">,
): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      return handleHttpError(response, base);
    }

    const text = await response.text();
    const hash = createHash("sha256").update(text).digest("hex");

    return {
      ...base,
      status: "ok",
      content_hash: hash,
      // raw_content intentionally omitted — change detection uses content_hash only
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Map HTTP error responses to appropriate CheckResult status.
 */
function handleHttpError(
  response: { status: number; statusText: string },
  base: Pick<CheckResult, "url" | "type" | "fetched_at">,
): CheckResult {
  const isTransient = response.status === 429 || response.status >= 500;
  return {
    ...base,
    status: isTransient ? "unreachable" : "error",
    error: `HTTP ${response.status}: ${response.statusText}`,
  };
}
