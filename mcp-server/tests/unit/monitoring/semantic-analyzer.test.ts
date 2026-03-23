import { describe, it, expect } from "vitest";
import {
  generateAnalysisPrompt,
  parseAnalysisResponse,
  type SemanticAnalysisInput,
} from "../../../src/monitoring/semantic-analyzer.js";

describe("semantic-analyzer", () => {
  describe("generateAnalysisPrompt", () => {
    const input: SemanticAnalysisInput = {
      patternDoc: "# ViewModel Patterns\n\nUse stateIn with WhileSubscribed(5000).",
      upstreamContent: "# Best Practices\n\nUse stateIn for state management.",
      slug: "viewmodel-state-patterns",
    };

    it("includes pattern doc content", () => {
      const prompt = generateAnalysisPrompt(input);
      expect(prompt).toContain("stateIn with WhileSubscribed");
    });

    it("includes upstream content", () => {
      const prompt = generateAnalysisPrompt(input);
      expect(prompt).toContain("Best Practices");
    });

    it("includes slug for context", () => {
      const prompt = generateAnalysisPrompt(input);
      expect(prompt).toContain("viewmodel-state-patterns");
    });

    it("includes focus areas when provided", () => {
      const withFocus: SemanticAnalysisInput = {
        ...input,
        focusAreas: ["Channel deprecation", "SharedFlow migration"],
      };

      const prompt = generateAnalysisPrompt(withFocus);
      expect(prompt).toContain("Channel deprecation");
      expect(prompt).toContain("SharedFlow migration");
    });

    it("omits focus section when no focus areas", () => {
      const prompt = generateAnalysisPrompt(input);
      expect(prompt).not.toContain("Focus Areas");
    });

    it("requests JSON array output", () => {
      const prompt = generateAnalysisPrompt(input);
      expect(prompt).toContain("JSON array");
    });

    it("truncates long content", () => {
      const longInput: SemanticAnalysisInput = {
        patternDoc: "x".repeat(5000),
        upstreamContent: "y".repeat(6000),
        slug: "test",
      };

      const prompt = generateAnalysisPrompt(longInput);
      expect(prompt).toContain("[... truncated ...]");
      expect(prompt.length).toBeLessThan(15000);
    });
  });

  describe("parseAnalysisResponse", () => {
    it("parses valid JSON array", () => {
      const response = JSON.stringify([
        {
          type: "deprecated_api",
          api: "runBlockingTest",
          summary: "runBlockingTest is deprecated",
          details: "Use runTest instead",
          severity: "HIGH",
          suggestedAction: "Replace all runBlockingTest with runTest",
        },
      ]);

      const result = parseAnalysisResponse(response, "test-slug");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].type).toBe("deprecated_api");
      expect(result.findings[0].api).toBe("runBlockingTest");
      expect(result.slug).toBe("test-slug");
    });

    it("handles markdown-fenced JSON", () => {
      const response = '```json\n[{"type":"new_api","summary":"New API","details":"Details","severity":"LOW","suggestedAction":"Add docs"}]\n```';

      const result = parseAnalysisResponse(response, "test");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].type).toBe("new_api");
    });

    it("returns empty findings on invalid JSON", () => {
      const result = parseAnalysisResponse("not json at all", "test");
      expect(result.findings).toHaveLength(0);
    });

    it("returns empty findings on empty array", () => {
      const result = parseAnalysisResponse("[]", "test");
      expect(result.findings).toHaveLength(0);
      expect(result.confidence).toBe(1.0);
    });

    it("filters out invalid findings", () => {
      const response = JSON.stringify([
        { type: "deprecated_api", summary: "Valid", details: "D", severity: "HIGH", suggestedAction: "Fix" },
        { type: "invalid_type", summary: "Bad" },
        { missing: "fields" },
      ]);

      const result = parseAnalysisResponse(response, "test");
      expect(result.findings).toHaveLength(1);
    });

    it("has lower confidence when findings exist", () => {
      const response = JSON.stringify([
        { type: "pattern_drift", summary: "S", details: "D", severity: "MEDIUM", suggestedAction: "A" },
      ]);

      const result = parseAnalysisResponse(response, "test");
      expect(result.confidence).toBeLessThan(1.0);
    });

    it("includes analysis timestamp", () => {
      const result = parseAnalysisResponse("[]", "test");
      expect(result.analysisTimestamp).toBeTruthy();
      expect(new Date(result.analysisTimestamp).getTime()).not.toBeNaN();
    });
  });
});
