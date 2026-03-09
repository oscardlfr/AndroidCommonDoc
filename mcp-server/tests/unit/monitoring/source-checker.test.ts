import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkSource } from "../../../src/monitoring/source-checker.js";
import type { MonitorUrl } from "../../../src/registry/types.js";

describe("checkSource", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('extracts latest version from GitHub releases API for type "github-releases"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          tag_name: "v1.10.2",
          name: "1.10.2",
          body: "## Changes\n\nFixed a performance issue.",
        }),
    }) as unknown as typeof fetch;

    const monitorUrl: MonitorUrl = {
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      tier: 1,
    };

    const result = await checkSource(monitorUrl);
    expect(result.status).toBe("ok");
    expect(result.latest_version).toBe("1.10.2");
    expect(result.release_body).toBe("## Changes\n\nFixed a performance issue.");
    expect(result.type).toBe("github-releases");
    expect(result.url).toBe(monitorUrl.url);
    expect(result.fetched_at).toBeDefined();
  });

  it("strips leading v from GitHub release tag_name", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          tag_name: "v2.3.10",
        }),
    }) as unknown as typeof fetch;

    const monitorUrl: MonitorUrl = {
      url: "https://github.com/JetBrains/kotlin/releases",
      type: "github-releases",
      tier: 1,
    };

    const result = await checkSource(monitorUrl);
    expect(result.latest_version).toBe("2.3.10");
  });

  it('returns SHA-256 content hash for type "doc-page" without raw_content', async () => {
    const pageContent = "<html><body>Kotlin Multiplatform docs</body></html>";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(pageContent),
    }) as unknown as typeof fetch;

    const monitorUrl: MonitorUrl = {
      url: "https://kotlinlang.org/docs/multiplatform.html",
      type: "doc-page",
      tier: 2,
    };

    const result = await checkSource(monitorUrl);
    expect(result.status).toBe("ok");
    expect(result.content_hash).toBeDefined();
    expect(result.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.raw_content).toBeUndefined();
    expect(result.type).toBe("doc-page");
  });

  it('extracts latest version from Maven Central API for type "maven-central"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          response: {
            numFound: 1,
            docs: [{ latestVersion: "9.0.0" }],
          },
        }),
    }) as unknown as typeof fetch;

    const monitorUrl: MonitorUrl = {
      url: "https://search.maven.org/solrsearch/select?q=a:gradle&rows=1&wt=json",
      type: "maven-central",
      tier: 1,
    };

    const result = await checkSource(monitorUrl);
    expect(result.status).toBe("ok");
    expect(result.latest_version).toBe("9.0.0");
  });

  it("handles HTTP 404 errors gracefully with error status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }) as unknown as typeof fetch;

    const monitorUrl: MonitorUrl = {
      url: "https://github.com/nonexistent/repo/releases",
      type: "github-releases",
      tier: 1,
    };

    const result = await checkSource(monitorUrl);
    expect(result.status).toBe("error");
    expect(result.error).toBeDefined();
  });

  it("handles HTTP 429 rate limiting as unreachable (transient)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    }) as unknown as typeof fetch;

    const monitorUrl: MonitorUrl = {
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      tier: 1,
    };

    const result = await checkSource(monitorUrl);
    expect(result.status).toBe("unreachable");
    expect(result.error).toBeDefined();
  });

  it("handles network errors as unreachable", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;

    const monitorUrl: MonitorUrl = {
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      tier: 1,
    };

    const result = await checkSource(monitorUrl);
    expect(result.status).toBe("unreachable");
    expect(result.error).toBeDefined();
  });

  it("handles timeout via AbortController as unreachable", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const error = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(error);
    }) as unknown as typeof fetch;

    const monitorUrl: MonitorUrl = {
      url: "https://slow-server.example.com/page",
      type: "doc-page",
      tier: 2,
    };

    const result = await checkSource(monitorUrl);
    expect(result.status).toBe("unreachable");
    expect(result.error).toBeDefined();
  });
});
