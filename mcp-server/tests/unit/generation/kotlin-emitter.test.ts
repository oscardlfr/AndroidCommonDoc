import { describe, it, expect } from "vitest";
import {
  emitRule,
  emitRuleSetProviderUpdate,
} from "../../../src/generation/kotlin-emitter.js";
import type { RuleDefinition } from "../../../src/registry/types.js";

describe("emitRule", () => {
  describe("banned-import rules", () => {
    const rule: RuleDefinition = {
      id: "prefer-kotlin-time",
      type: "banned-import",
      message: "Use kotlin.time instead of kotlinx.datetime for durations",
      detect: {
        banned_import: "kotlinx.datetime.Instant",
        prefer: "kotlin.time.Instant",
      },
    };

    it("produces valid Kotlin with visitImportDirective override", () => {
      const result = emitRule(rule);
      expect(result).not.toBeNull();
      expect(result).toContain("visitImportDirective");
      expect(result).toContain("importDirective: KtImportDirective");
      expect(result).toContain("super.visitImportDirective(importDirective)");
      expect(result).toContain("importedFqName?.asString()");
      expect(result).toContain('startsWith("kotlinx.datetime.Instant")');
    });

    it("includes correct imports for banned-import", () => {
      const result = emitRule(rule)!;
      expect(result).toContain("import dev.detekt.api.Config");
      expect(result).toContain("import dev.detekt.api.Entity");
      expect(result).toContain("import dev.detekt.api.Finding");
      expect(result).toContain("import dev.detekt.api.Rule");
      expect(result).toContain(
        "import org.jetbrains.kotlin.psi.KtImportDirective",
      );
    });

    it("includes prefer message in finding", () => {
      const result = emitRule(rule)!;
      expect(result).toContain("kotlin.time.Instant");
    });
  });

  describe("prefer-construct rules", () => {
    const rule: RuleDefinition = {
      id: "sealed-ui-state",
      type: "prefer-construct",
      message: "UiState must be sealed interface, not data class",
      detect: {
        class_suffix: "UiState",
        must_be: "sealed",
      },
    };

    it("produces valid Kotlin with visitClass override", () => {
      const result = emitRule(rule);
      expect(result).not.toBeNull();
      expect(result).toContain("visitClass");
      expect(result).toContain("klass: KtClass");
      expect(result).toContain("super.visitClass(klass)");
    });

    it("checks class suffix and modifier", () => {
      const result = emitRule(rule)!;
      expect(result).toContain('endsWith("UiState")');
      expect(result).toContain("isSealed()");
    });

    it("includes correct imports for prefer-construct", () => {
      const result = emitRule(rule)!;
      expect(result).toContain("import org.jetbrains.kotlin.psi.KtClass");
    });
  });

  describe("banned-usage rules", () => {
    const rule: RuleDefinition = {
      id: "no-channel-events",
      type: "banned-usage",
      message: "Use MutableSharedFlow instead of Channel for UI events",
      detect: {
        in_class_extending: "ViewModel",
        banned_initializer: "Channel<",
        prefer: "MutableSharedFlow",
      },
    };

    it("produces valid Kotlin with visitClass + property check", () => {
      const result = emitRule(rule);
      expect(result).not.toBeNull();
      expect(result).toContain("visitClass");
      expect(result).toContain("klass: KtClass");
      expect(result).toContain('Channel<"');
    });

    it("checks supertype when in_class_extending is specified", () => {
      const result = emitRule(rule)!;
      expect(result).toContain("ViewModel");
      expect(result).toContain("superTypeListEntries");
    });

    it("includes correct imports for banned-usage", () => {
      const result = emitRule(rule)!;
      expect(result).toContain("import org.jetbrains.kotlin.psi.KtClass");
      expect(result).toContain("import org.jetbrains.kotlin.psi.KtProperty");
    });

    it("includes prefer alternative in message", () => {
      const result = emitRule(rule)!;
      expect(result).toContain("MutableSharedFlow");
    });
  });

  describe("banned-usage without in_class_extending", () => {
    const rule: RuleDefinition = {
      id: "no-run-blocking",
      type: "banned-usage",
      message: "Do not use runBlocking in production code",
      detect: {
        banned_initializer: "runBlocking",
        prefer: "coroutineScope",
      },
    };

    it("skips supertype check when in_class_extending is not specified", () => {
      const result = emitRule(rule)!;
      expect(result).not.toContain("superTypeListEntries");
    });
  });

  describe("class naming", () => {
    it("converts kebab-case rule id to PascalCase class name with Rule suffix", () => {
      const rule: RuleDefinition = {
        id: "prefer-kotlin-time",
        type: "banned-import",
        message: "test",
        detect: { banned_import: "x", prefer: "y" },
      };
      const result = emitRule(rule)!;
      expect(result).toContain("class PreferKotlinTimeRule");
    });

    it("handles single word rule id", () => {
      const rule: RuleDefinition = {
        id: "test",
        type: "banned-import",
        message: "test",
        detect: { banned_import: "x", prefer: "y" },
      };
      const result = emitRule(rule)!;
      expect(result).toContain("class TestRule");
    });
  });

  describe("package declaration", () => {
    it("uses generated package", () => {
      const rule: RuleDefinition = {
        id: "test-rule",
        type: "banned-import",
        message: "test",
        detect: { banned_import: "x", prefer: "y" },
      };
      const result = emitRule(rule)!;
      expect(result).toContain(
        "package com.androidcommondoc.detekt.rules.generated",
      );
    });
  });

  describe("hand_written rules", () => {
    it("returns null for hand_written rules", () => {
      const rule: RuleDefinition = {
        id: "sealed-ui-state",
        type: "prefer-construct",
        message: "test",
        detect: { class_suffix: "UiState", must_be: "sealed" },
        hand_written: true,
        source_rule: "SealedUiStateRule.kt",
      };
      const result = emitRule(rule);
      expect(result).toBeNull();
    });
  });
});

describe("emitRuleSetProviderUpdate", () => {
  it("generates import statements and rule references", () => {
    const result = emitRuleSetProviderUpdate([
      "PreferKotlinTimeRule",
      "NoRunBlockingRule",
    ]);
    expect(result).toContain(
      "import com.androidcommondoc.detekt.rules.generated.PreferKotlinTimeRule",
    );
    expect(result).toContain(
      "import com.androidcommondoc.detekt.rules.generated.NoRunBlockingRule",
    );
    expect(result).toContain("::PreferKotlinTimeRule");
    expect(result).toContain("::NoRunBlockingRule");
  });

  it("returns empty string for empty array", () => {
    const result = emitRuleSetProviderUpdate([]);
    expect(result).toBe("");
  });
});
