import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchContent,
  stripHtmlToText,
  type AndroidCliRunner,
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

  describe("fetchContent — android-cli source", () => {
    const SEPARATOR = "----------------------------------------";
    const successStdout = [
      "Waiting for index to be ready...",
      "Fetching docs from: kb://android/kotlin/flow/stateflow-and-sharedflow",
      "Title: StateFlow and SharedFlow",
      "URL: kb://android/kotlin/flow/stateflow-and-sharedflow",
      SEPARATOR,
      "StateFlow and SharedFlow are Flow APIs that emit state updates to collectors.",
      "",
      "Use stateIn(WhileSubscribed(5_000)) for UI state.",
    ].join("\n");

    it("routes kb:// URLs through the android-cli runner", async () => {
      const runner: AndroidCliRunner = vi.fn().mockResolvedValue({
        stdout: successStdout,
        stderr: "",
        exitCode: 0,
      });

      const result = await fetchContent(
        "kb://android/kotlin/flow/stateflow-and-sharedflow",
        { androidCliRunner: runner },
      );

      expect(runner).toHaveBeenCalledWith(
        ["docs", "fetch", "kb://android/kotlin/flow/stateflow-and-sharedflow"],
        expect.any(Number),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.source).toBe("android-cli");
        expect(result.data.content).toContain("stateIn(WhileSubscribed");
        expect(result.data.content).not.toContain("Waiting for index");
        expect(result.data.content).not.toContain(SEPARATOR);
      }
    });

    it("still invokes the runner when preferredSource=android-cli is set for an https URL, but the adapter refuses (kb:// only)", async () => {
      // Adapter does not spawn the process for non-kb URLs — it short-circuits
      // with a clear error so that the outer fetchContent can decide whether
      // to fall back to webfetch.
      const runner: AndroidCliRunner = vi.fn();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("fallback body"),
      }) as unknown as typeof fetch;

      const result = await fetchContent("https://example.com/docs", {
        preferredSource: "android-cli",
        androidCliRunner: runner,
      });

      // The runner was NOT called (adapter rejects before spawning).
      expect(runner).not.toHaveBeenCalled();
      // The overall fetch succeeds via webfetch fallback.
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.source).toBe("jina");
      }
    });

    it("surfaces 'No document found' as an error without content", async () => {
      const runner: AndroidCliRunner = vi.fn().mockResolvedValue({
        stdout: "Waiting for index...\nNo document found for URL: kb://android/nope",
        stderr: "",
        exitCode: 0,
      });

      const result = await fetchContent("kb://android/nope", {
        androidCliRunner: runner,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.source).toBe("android-cli");
        expect(result.error.error).toContain("no entry");
      }
    });

    it("emits an install-hint error when the binary is not on PATH", async () => {
      const runner: AndroidCliRunner = vi.fn().mockResolvedValue({
        stdout: "",
        stderr: "'android' is not recognized as an internal or external command",
        exitCode: 127,
      });

      const result = await fetchContent("kb://android/any", {
        androidCliRunner: runner,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error).toContain("Android CLI not on PATH");
      }
    });

    it("does NOT fall back to webfetch for kb:// URLs on failure", async () => {
      const runner: AndroidCliRunner = vi.fn().mockResolvedValue({
        stdout: "",
        stderr: "adb offline",
        exitCode: 1,
      });
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await fetchContent("kb://android/foo", {
        androidCliRunner: runner,
      });

      expect(result.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls back to webfetch when preferredSource=android-cli fails on an https URL", async () => {
      const runner: AndroidCliRunner = vi.fn().mockResolvedValue({
        stdout: "",
        stderr: "unreachable",
        exitCode: 1,
      });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("# Fallback content"),
      }) as unknown as typeof fetch;

      // preferredSource=android-cli triggers the adapter first, but the URL
      // is https:// so the adapter rejects it — we then fall through to jina/raw.
      const result = await fetchContent("https://example.com/docs", {
        preferredSource: "android-cli",
        androidCliRunner: runner,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.source).toBe("jina");
        expect(result.data.content).toContain("Fallback content");
      }
    });

    it("treats stdout with no separator as the entire body (defensive)", async () => {
      const runner: AndroidCliRunner = vi.fn().mockResolvedValue({
        stdout: "just body content without a separator",
        stderr: "",
        exitCode: 0,
      });

      const result = await fetchContent("kb://android/bare", {
        androidCliRunner: runner,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.content).toBe("just body content without a separator");
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
