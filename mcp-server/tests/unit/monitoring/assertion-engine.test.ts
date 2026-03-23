import { describe, it, expect } from "vitest";
import {
  runAssertions,
  type UpstreamValidation,
} from "../../../src/monitoring/assertion-engine.js";

const UPSTREAM_CONTENT = `
# Kotlin Coroutines Best Practices

## ViewModel Scope

Use viewModelScope.launch for ViewModel-scoped coroutines.
The stateIn operator converts a Flow to a StateFlow using WhileSubscribed(5000).

## Structured Concurrency

Prefer structured concurrency over GlobalScope. Use supervisorScope
for independent child failure isolation.

## Events

Use SharedFlow for one-time events. MutableSharedFlow with replay=0
is the recommended approach for ephemeral UI events.

## Deprecated APIs

The Channel-based approach for UI events is deprecated since Kotlin 1.9.
Use SharedFlow instead of Channel for better lifecycle awareness.
`;

describe("assertion-engine", () => {
  const slug = "viewmodel-state-patterns";

  describe("api_present", () => {
    it("passes when API exists in content", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          { type: "api_present", value: "stateIn", context: "We use stateIn" },
        ],
      };

      const { results, findings } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(true);
      expect(findings).toHaveLength(0);
    });

    it("fails when API is missing", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "api_present",
            value: "collectAsStateWithLifecycle",
            context: "New API we need",
          },
        ],
      };

      const { results, findings } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(false);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe("HIGH");
      expect(findings[0].category).toBe("upstream-api-missing");
    });

    it("provides snippet on match", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "api_present",
            value: "WhileSubscribed",
            context: "Pattern depends on it",
          },
        ],
      };

      const { results } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].snippet).toBeTruthy();
      expect(results[0].snippet).toContain("WhileSubscribed");
    });
  });

  describe("api_absent", () => {
    it("passes when API is not in content", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "api_absent",
            value: "runBlocking",
            context: "Should never be recommended",
          },
        ],
      };

      const { results, findings } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(true);
      expect(findings).toHaveLength(0);
    });

    it("fails when API is found", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "api_absent",
            value: "GlobalScope",
            context: "We avoid GlobalScope",
          },
        ],
      };

      const { results, findings } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(false);
      expect(findings[0].severity).toBe("MEDIUM");
    });
  });

  describe("keyword_absent", () => {
    it("passes when keyword not near qualifier", () => {
      // Use content where "Channel" is far from "recommended"
      const isolatedContent = `
# Introduction

This guide covers Flow operators for modern Android.

## Recommended Approach

Use StateFlow with stateIn for state management.

## Section with many paragraphs between

Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.
Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.
Nulla facilisi. Morbi tristique senectus et netus et malesudum fames ac turpis.
Praesent commodo cursus magna, vel scelerisque nisl consectetur et.

## Deprecated APIs

The Channel-based approach for UI events is deprecated since Kotlin 1.9.
`;
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "keyword_absent",
            value: "Channel",
            qualifier: "recommended",
            context: "We teach SharedFlow not Channel",
          },
        ],
      };

      const { results } = runAssertions(validation, isolatedContent, slug);
      // Channel IS in content but "recommended" is >200 chars away
      expect(results[0].passed).toBe(true);
    });

    it("fails when keyword appears without qualifier filter", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "keyword_absent",
            value: "Channel",
            context: "Should not mention Channel at all",
          },
        ],
      };

      const { results, findings } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(false);
      expect(findings).toHaveLength(1);
    });
  });

  describe("keyword_present", () => {
    it("passes when keyword found", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "keyword_present",
            value: "SharedFlow",
            context: "Upstream must still recommend SharedFlow",
          },
        ],
      };

      const { results } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(true);
    });

    it("fails when keyword missing", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "keyword_present",
            value: "Molecule",
            context: "Expected Molecule mention",
          },
        ],
      };

      const { results, findings } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(false);
      expect(findings).toHaveLength(1);
    });
  });

  describe("pattern_match", () => {
    it("matches regex in content", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "pattern_match",
            value: "WhileSubscribed\\(\\d+\\)",
            context: "WhileSubscribed with timeout parameter",
          },
        ],
      };

      const { results } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(true);
    });

    it("fails on no match", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "pattern_match",
            value: "SharingStarted\\.Lazily",
            context: "Lazily should be mentioned",
          },
        ],
      };

      const { results } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(false);
    });

    it("handles invalid regex gracefully", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "pattern_match",
            value: "[invalid(regex",
            context: "Bad regex",
          },
        ],
      };

      const { results } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(false);
      expect(results[0].detail).toContain("Invalid regex");
    });
  });

  describe("deprecation_scan", () => {
    it("detects deprecation keyword near API name", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "deprecation_scan",
            value: "Channel",
            context: "We need to know if Channel is deprecated",
          },
        ],
      };

      const { results, findings } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(false);
      expect(findings[0].severity).toBe("HIGH");
      expect(findings[0].category).toBe("upstream-deprecation");
    });

    it("passes when no deprecation found", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "deprecation_scan",
            value: "stateIn",
            context: "stateIn should not be deprecated",
          },
        ],
      };

      const { results } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results[0].passed).toBe(true);
    });
  });

  describe("multiple assertions", () => {
    it("runs all assertions and collects findings", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          { type: "api_present", value: "stateIn", context: "Must exist" },
          { type: "api_present", value: "NonExistentApi", context: "Missing" },
          {
            type: "deprecation_scan",
            value: "Channel",
            context: "Deprecated",
          },
        ],
      };

      const { results, findings } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(results).toHaveLength(3);
      expect(results[0].passed).toBe(true); // stateIn found
      expect(results[1].passed).toBe(false); // NonExistentApi missing
      expect(results[2].passed).toBe(false); // Channel deprecated

      expect(findings).toHaveLength(2); // only failures
    });

    it("uses on_failure severity when provided", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "keyword_present",
            value: "Molecule",
            context: "Missing keyword",
          },
        ],
        on_failure: "LOW",
      };

      const { findings } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(findings[0].severity).toBe("LOW");
    });
  });

  describe("finding structure", () => {
    it("generates valid MonitoringFinding", () => {
      const validation: UpstreamValidation = {
        url: "https://example.com/docs",
        assertions: [
          {
            type: "api_present",
            value: "MissingApi",
            context: "Test context",
          },
        ],
      };

      const { findings } = runAssertions(validation, UPSTREAM_CONTENT, slug);
      expect(findings).toHaveLength(1);

      const finding = findings[0];
      expect(finding.slug).toBe(slug);
      expect(finding.source_url).toBe("https://example.com/docs");
      expect(finding.severity).toBe("HIGH");
      expect(finding.category).toBe("upstream-api-missing");
      expect(finding.summary).toContain("MissingApi");
      expect(finding.details).toContain("Test context");
      expect(finding.finding_hash).toHaveLength(16);
    });
  });
});
