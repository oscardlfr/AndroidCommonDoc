import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchContent,
  stripHtmlToText,
  type FetchResult,
} from "../../../src/monitoring/content-fetcher.js";

describe("content-fetcher", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("fetchContent", () => {
    it("returns content from Jina Reader when available", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("# Page Title\n\nSome content about stateIn"),
      }) as unknown as typeof fetch;

      const result = await fetchContent("https://example.com/docs");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.source).toBe("jina");
        expect(result.data.content).toContain("stateIn");
        expect(result.data.contentHash).toBeTruthy();
        expect(result.data.fetchedAt).toBeTruthy();
      }
    });

    it("falls back to raw HTTP when Jina fails", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (callCount === 1) {
          // Jina fails
          return Promise.resolve({ ok: false, status: 503 });
        }
        // Raw succeeds
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve("<html><body><p>Raw content</p></body></html>"),
        });
      }) as unknown as typeof fetch;

      const result = await fetchContent("https://example.com/docs");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.source).toBe("raw");
        expect(result.data.content).toContain("Raw content");
      }
    });

    it("skips Jina when rawOnly is true", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("<p>Direct fetch</p>"),
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await fetchContent("https://example.com", {
        rawOnly: true,
      });

      expect(result.ok).toBe(true);
      // Should only call once (raw), not twice (jina + raw)
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain("r.jina.ai");
    });

    it("returns error when both Jina and raw fail", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }) as unknown as typeof fetch;

      const result = await fetchContent("https://example.com/broken");

      expect(result.ok).toBe(false);
    });

    it("returns error on network timeout", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new Error("AbortError"),
      ) as unknown as typeof fetch;

      const result = await fetchContent("https://example.com/slow", {
        timeout: 100,
      });

      expect(result.ok).toBe(false);
    });

    it("returns error on empty Jina content", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Jina returns empty
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("   "),
          });
        }
        // Raw also empty
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve("   "),
        });
      }) as unknown as typeof fetch;

      const result = await fetchContent("https://example.com/empty");
      expect(result.ok).toBe(false);
    });

    it("generates different hashes for different content", async () => {
      const results: FetchResult[] = [];

      for (const content of ["Content A", "Content B"]) {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve(content),
        }) as unknown as typeof fetch;

        results.push(await fetchContent("https://example.com", { rawOnly: true }));
      }

      expect(results[0].ok && results[1].ok).toBe(true);
      if (results[0].ok && results[1].ok) {
        expect(results[0].data.contentHash).not.toBe(
          results[1].data.contentHash,
        );
      }
    });
  });

  describe("stripHtmlToText", () => {
    it("strips HTML tags", () => {
      expect(stripHtmlToText("<p>Hello</p>")).toBe("Hello");
    });

    it("removes script and style blocks", () => {
      const html = '<p>Keep</p><script>alert("x")</script><style>.x{}</style>';
      expect(stripHtmlToText(html)).toBe("Keep");
    });

    it("decodes HTML entities", () => {
      expect(stripHtmlToText("&amp; &lt; &gt; &quot;")).toBe('& < > "');
    });

    it("converts block elements to newlines", () => {
      const html = "<p>One</p><p>Two</p>";
      expect(stripHtmlToText(html)).toContain("One\nTwo");
    });

    it("collapses excessive whitespace", () => {
      expect(stripHtmlToText("  too   much   space  ")).toBe("too much space");
    });

    it("handles empty input", () => {
      expect(stripHtmlToText("")).toBe("");
    });

    it("removes HTML comments", () => {
      expect(stripHtmlToText("before<!-- comment -->after")).toBe(
        "beforeafter",
      );
    });
  });
});
