/**
 * Deterministic assertion engine for upstream content validation (Layer 1).
 *
 * Parses `validate_upstream` frontmatter and runs assertions against
 * fetched content. Pure grep/regex — no LLM.
 *
 * Assertion types:
 * - api_present: API name must exist in upstream content
 * - api_absent: API name must NOT exist in upstream content
 * - keyword_absent: keyword must NOT appear near qualifier
 * - keyword_present: keyword MUST appear in content
 * - pattern_match: regex must match in content
 * - deprecation_scan: scan for deprecation keywords near specified APIs
 */

import type { MonitoringFinding, FindingSeverity } from "../registry/types.js";
import { createHash } from "node:crypto";

/** A single assertion from frontmatter. */
export interface UpstreamAssertion {
  type:
    | "api_present"
    | "api_absent"
    | "keyword_absent"
    | "keyword_present"
    | "pattern_match"
    | "deprecation_scan";
  /** API name, keyword, or regex pattern. */
  value: string;
  /** Context word for keyword_absent (e.g. "recommended"). */
  qualifier?: string;
  /** Why this assertion matters — shown in findings. */
  context: string;
}

/** A validate_upstream entry from frontmatter. */
export interface UpstreamValidation {
  url: string;
  assertions: UpstreamAssertion[];
  /** Default severity for failures (default: MEDIUM). */
  on_failure?: FindingSeverity;
  /** Cache TTL override in hours. */
  cache_ttl?: number;
}

/** Result of running a single assertion. */
export interface AssertionResult {
  assertion: UpstreamAssertion;
  passed: boolean;
  /** Detail about why it failed (empty if passed). */
  detail: string;
  /** Snippet of upstream content around the match/miss (max 200 chars). */
  snippet?: string;
}

/** DEPRECATION_KEYWORDS used by deprecation_scan. */
const DEPRECATION_KEYWORDS = [
  "deprecated",
  "deprecation",
  "removed",
  "no longer supported",
  "no longer recommended",
  "will be removed",
  "marked deprecated",
  "superseded by",
  "replaced by",
];

/** Context window size (chars) for keyword proximity matching. */
const CONTEXT_WINDOW = 200;

/**
 * Run all assertions for a validation entry against fetched content.
 */
export function runAssertions(
  validation: UpstreamValidation,
  content: string,
  slug: string,
): { results: AssertionResult[]; findings: MonitoringFinding[] } {
  const results: AssertionResult[] = [];
  const findings: MonitoringFinding[] = [];
  const defaultSeverity = validation.on_failure ?? "MEDIUM";

  for (const assertion of validation.assertions) {
    const result = runSingleAssertion(assertion, content);
    results.push(result);

    if (!result.passed) {
      findings.push({
        slug,
        source_url: validation.url,
        severity: severityForType(assertion.type, defaultSeverity),
        category: categoryForType(assertion.type),
        summary: summaryForAssertion(assertion, result),
        details: result.detail,
        finding_hash: hashFinding(slug, validation.url, assertion),
      });
    }
  }

  return { results, findings };
}

/**
 * Run a single assertion against content.
 */
function runSingleAssertion(
  assertion: UpstreamAssertion,
  content: string,
): AssertionResult {
  switch (assertion.type) {
    case "api_present":
      return checkApiPresent(assertion, content);
    case "api_absent":
      return checkApiAbsent(assertion, content);
    case "keyword_absent":
      return checkKeywordAbsent(assertion, content);
    case "keyword_present":
      return checkKeywordPresent(assertion, content);
    case "pattern_match":
      return checkPatternMatch(assertion, content);
    case "deprecation_scan":
      return checkDeprecationScan(assertion, content);
  }
}

function checkApiPresent(
  assertion: UpstreamAssertion,
  content: string,
): AssertionResult {
  const regex = new RegExp(`\\b${escapeRegex(assertion.value)}\\b`, "i");
  const match = regex.exec(content);

  if (match) {
    return {
      assertion,
      passed: true,
      detail: `API "${assertion.value}" found in upstream content`,
      snippet: extractSnippet(content, match.index),
    };
  }

  return {
    assertion,
    passed: false,
    detail: `API "${assertion.value}" NOT found in upstream content. ${assertion.context}`,
  };
}

function checkApiAbsent(
  assertion: UpstreamAssertion,
  content: string,
): AssertionResult {
  const regex = new RegExp(`\\b${escapeRegex(assertion.value)}\\b`, "i");
  const match = regex.exec(content);

  if (!match) {
    return {
      assertion,
      passed: true,
      detail: `API "${assertion.value}" correctly absent from upstream`,
    };
  }

  return {
    assertion,
    passed: false,
    detail: `API "${assertion.value}" found in upstream but should not be. ${assertion.context}`,
    snippet: extractSnippet(content, match.index),
  };
}

function checkKeywordAbsent(
  assertion: UpstreamAssertion,
  content: string,
): AssertionResult {
  const keyword = assertion.value;
  const qualifier = assertion.qualifier;

  const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "gi");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (!qualifier) {
      // No qualifier — any mention is a failure
      return {
        assertion,
        passed: false,
        detail: `Keyword "${keyword}" found in upstream content. ${assertion.context}`,
        snippet: extractSnippet(content, match.index),
      };
    }

    // Check if qualifier appears within context window
    const window = content.substring(
      Math.max(0, match.index - CONTEXT_WINDOW),
      Math.min(content.length, match.index + keyword.length + CONTEXT_WINDOW),
    );

    if (new RegExp(`\\b${escapeRegex(qualifier)}\\b`, "i").test(window)) {
      return {
        assertion,
        passed: false,
        detail: `Keyword "${keyword}" found near "${qualifier}" in upstream. ${assertion.context}`,
        snippet: extractSnippet(content, match.index),
      };
    }
  }

  return {
    assertion,
    passed: true,
    detail: qualifier
      ? `Keyword "${keyword}" not found near "${qualifier}" in upstream`
      : `Keyword "${keyword}" not found in upstream`,
  };
}

function checkKeywordPresent(
  assertion: UpstreamAssertion,
  content: string,
): AssertionResult {
  const regex = new RegExp(`\\b${escapeRegex(assertion.value)}\\b`, "i");
  const match = regex.exec(content);

  if (match) {
    return {
      assertion,
      passed: true,
      detail: `Keyword "${assertion.value}" found in upstream`,
      snippet: extractSnippet(content, match.index),
    };
  }

  return {
    assertion,
    passed: false,
    detail: `Keyword "${assertion.value}" NOT found in upstream. ${assertion.context}`,
  };
}

function checkPatternMatch(
  assertion: UpstreamAssertion,
  content: string,
): AssertionResult {
  try {
    const regex = new RegExp(assertion.value, "i");
    const match = regex.exec(content);

    if (match) {
      return {
        assertion,
        passed: true,
        detail: `Pattern /${assertion.value}/ matched in upstream`,
        snippet: extractSnippet(content, match.index),
      };
    }

    return {
      assertion,
      passed: false,
      detail: `Pattern /${assertion.value}/ NOT matched in upstream. ${assertion.context}`,
    };
  } catch {
    return {
      assertion,
      passed: false,
      detail: `Invalid regex pattern: ${assertion.value}`,
    };
  }
}

function checkDeprecationScan(
  assertion: UpstreamAssertion,
  content: string,
): AssertionResult {
  const api = assertion.value;
  const apiRegex = new RegExp(`\\b${escapeRegex(api)}\\b`, "gi");
  let match: RegExpExecArray | null;

  while ((match = apiRegex.exec(content)) !== null) {
    const window = content.substring(
      Math.max(0, match.index - CONTEXT_WINDOW),
      Math.min(content.length, match.index + api.length + CONTEXT_WINDOW),
    );

    for (const keyword of DEPRECATION_KEYWORDS) {
      if (new RegExp(keyword, "i").test(window)) {
        // Extra check: skip "use {api} instead of X" — that recommends the API, not deprecates it
        const useApiInstead = new RegExp(
          `use\\s+${escapeRegex(api)}\\s+instead`,
          "i",
        );
        if (useApiInstead.test(window)) continue;

        return {
          assertion,
          passed: false,
          detail: `API "${api}" found near deprecation keyword "${keyword}" in upstream. ${assertion.context}`,
          snippet: extractSnippet(content, match.index),
        };
      }
    }
  }

  return {
    assertion,
    passed: true,
    detail: `No deprecation signals found for API "${api}" in upstream`,
  };
}

// --- Helpers ---

function summaryForAssertion(
  assertion: UpstreamAssertion,
  result: AssertionResult,
): string {
  const verb = result.passed ? "passed" : "FAILED";
  switch (assertion.type) {
    case "api_present":
      return `${verb}: API "${assertion.value}" ${result.passed ? "exists" : "missing"} in upstream`;
    case "api_absent":
      return `${verb}: API "${assertion.value}" ${result.passed ? "absent" : "found"} in upstream`;
    case "keyword_absent":
      return `${verb}: keyword "${assertion.value}" ${result.passed ? "absent" : "found near"} "${assertion.qualifier ?? ""}" in upstream`;
    case "keyword_present":
      return `${verb}: keyword "${assertion.value}" ${result.passed ? "found" : "missing"} in upstream`;
    case "pattern_match":
      return `${verb}: pattern /${assertion.value}/ ${result.passed ? "matched" : "not matched"} in upstream`;
    case "deprecation_scan":
      return `${verb}: API "${assertion.value}" ${result.passed ? "not deprecated" : "deprecated"} in upstream`;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSnippet(content: string, matchIndex: number): string {
  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(content.length, matchIndex + 120);
  let snippet = content.substring(start, end).replace(/\n/g, " ").trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < content.length) snippet = `${snippet}...`;
  return snippet;
}

function severityForType(
  type: UpstreamAssertion["type"],
  fallback: FindingSeverity,
): FindingSeverity {
  switch (type) {
    case "api_present":
    case "deprecation_scan":
      return "HIGH";
    case "api_absent":
    case "keyword_absent":
      return "MEDIUM";
    default:
      return fallback;
  }
}

function categoryForType(type: UpstreamAssertion["type"]): string {
  switch (type) {
    case "api_present":
      return "upstream-api-missing";
    case "api_absent":
      return "upstream-api-unexpected";
    case "keyword_absent":
    case "keyword_present":
      return "upstream-keyword-conflict";
    case "deprecation_scan":
      return "upstream-deprecation";
    case "pattern_match":
      return "upstream-pattern-drift";
  }
}

function hashFinding(
  slug: string,
  url: string,
  assertion: UpstreamAssertion,
): string {
  return createHash("sha256")
    .update(`${slug}:${url}:${assertion.type}:${assertion.value}`)
    .digest("hex")
    .substring(0, 16);
}
