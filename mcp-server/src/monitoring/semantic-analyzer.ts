/**
 * Semantic analyzer — Layer 2 LLM analysis (optional, --profile deep only).
 *
 * When Layer 1 detects content change or a validation failure,
 * this module provides a structured prompt for LLM analysis.
 * The actual LLM call is made by the agent (not by this module) —
 * this module prepares the prompt and parses the response.
 *
 * Cost-controlled: only invoked on detected changes (~$0.03/doc).
 */

import { logger } from "../utils/logger.js";

/** Input for semantic analysis. */
export interface SemanticAnalysisInput {
  /** Our pattern doc content (markdown). */
  patternDoc: string;
  /** Upstream content (markdown, fetched). */
  upstreamContent: string;
  /** Pattern doc slug for context. */
  slug: string;
  /** Specific areas to focus on (from failed Layer 1 assertions). */
  focusAreas?: string[];
}

/** A single semantic finding. */
export interface SemanticFinding {
  type: "deprecated_api" | "changed_recommendation" | "new_api" | "pattern_drift";
  api?: string;
  summary: string;
  details: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  suggestedAction: string;
}

/** Full semantic analysis result. */
export interface SemanticAnalysisResult {
  slug: string;
  findings: SemanticFinding[];
  confidence: number;
  analysisTimestamp: string;
}

/**
 * Generate the LLM prompt for semantic analysis.
 * Returns a structured prompt that the agent can send to the LLM.
 */
export function generateAnalysisPrompt(input: SemanticAnalysisInput): string {
  const focusSection = input.focusAreas?.length
    ? `\n## Focus Areas\nPay special attention to these areas where Layer 1 detected potential issues:\n${input.focusAreas.map((a) => `- ${a}`).join("\n")}\n`
    : "";

  return `You are a documentation validation expert for Kotlin Multiplatform projects.

Compare our internal pattern documentation against the upstream official documentation.
Identify discrepancies, deprecated APIs, changed recommendations, and new APIs we should document.

## Our Pattern Document (slug: ${input.slug})

\`\`\`markdown
${truncateContent(input.patternDoc, 3000)}
\`\`\`

## Upstream Official Documentation

\`\`\`markdown
${truncateContent(input.upstreamContent, 4000)}
\`\`\`
${focusSection}
## Instructions

Respond with a JSON array of findings. Each finding must have:
- type: "deprecated_api" | "changed_recommendation" | "new_api" | "pattern_drift"
- api: the specific API name (if applicable)
- summary: one-line description
- details: full explanation
- severity: "HIGH" | "MEDIUM" | "LOW"
- suggestedAction: what should be updated in our doc

Only report real discrepancies. Do NOT report stylistic differences or content that is simply organized differently.

If there are no discrepancies, return an empty array: []

Respond ONLY with the JSON array, no markdown fences, no explanation.`;
}

/**
 * Parse the LLM response into structured findings.
 * Handles common LLM output formats (raw JSON, markdown-fenced JSON).
 */
export function parseAnalysisResponse(
  response: string,
  slug: string,
): SemanticAnalysisResult {
  let findings: SemanticFinding[] = [];

  try {
    // Strip markdown fences if present
    let cleaned = response.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      findings = parsed.filter(isValidFinding);
    } else {
      logger.warn(`Semantic analysis response is not an array for ${slug}`);
    }
  } catch (error) {
    logger.warn(`Failed to parse semantic analysis response for ${slug}: ${error}`);
  }

  return {
    slug,
    findings,
    confidence: findings.length > 0 ? 0.8 : 1.0,
    analysisTimestamp: new Date().toISOString(),
  };
}

/**
 * Type guard for semantic findings.
 */
function isValidFinding(obj: unknown): obj is SemanticFinding {
  if (typeof obj !== "object" || obj === null) return false;
  const f = obj as Record<string, unknown>;
  return (
    typeof f.type === "string" &&
    ["deprecated_api", "changed_recommendation", "new_api", "pattern_drift"].includes(
      f.type,
    ) &&
    typeof f.summary === "string" &&
    typeof f.details === "string" &&
    typeof f.severity === "string" &&
    ["HIGH", "MEDIUM", "LOW"].includes(f.severity) &&
    typeof f.suggestedAction === "string"
  );
}

/**
 * Truncate content to fit within token budget.
 */
function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.substring(0, maxChars) + "\n\n[... truncated ...]";
}
