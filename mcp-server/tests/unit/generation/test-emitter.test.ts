import { describe, it, expect } from "vitest";
import { emitRuleTest } from "../../../src/generation/test-emitter.js";
import {
  emitConfigEntry,
  emitFullConfig,
} from "../../../src/generation/config-emitter.js";
import type { RuleDefinition } from "../../../src/registry/types.js";

describe("emitRuleTest", () => {
  describe("common test patterns", () => {
    const rule: RuleDefinition = {
      id: "prefer-kotlin-time",
      type: "banned-import",
      message: "Use kotlin.time instead of kotlinx.datetime",
      detect: {
        banned_import: "kotlinx.datetime.Instant",
        prefer: "kotlin.time.Instant",
      },
    };

    it("produces Kotlin test class with violations and compliant code samples", () => {
      const result = emitRuleTest(rule);
      expect(result).not.toBeNull();
      expect(result).toContain("reports violating code");
      expect(result).toContain("accepts compliant code");
    });

    it("uses Config.empty, rule.lint(code), assertThat(findings)", () => {
      const result = emitRuleTest(rule)!;
      expect(result).toContain("Config.empty");
      expect(result).toContain("rule.lint(code)");
      expect(result).toContain("assertThat(findings)");
    });

    it("emitted test class name matches rule class name + Test suffix", () => {
      const result = emitRuleTest(rule)!;
      expect(result).toContain("class PreferKotlinTimeRuleTest");
    });

    it("emitted test package is com.androidcommondoc.detekt.rules.generated", () => {
      const result = emitRuleTest(rule)!;
      expect(result).toContain(
        "package com.androidcommondoc.detekt.rules.generated",
      );
    });

    it("includes correct test imports", () => {
      const result = emitRuleTest(rule)!;
      expect(result).toContain("import dev.detekt.api.Config");
      expect(result).toContain("import dev.detekt.test.lint");
      expect(result).toContain(
        "import org.assertj.core.api.Assertions.assertThat",
      );
      expect(result).toContain("import org.junit.jupiter.api.Test");
    });

    it("instantiates rule with Config.empty", () => {
      const result = emitRuleTest(rule)!;
      expect(result).toContain(
        "private val rule = PreferKotlinTimeRule(Config.empty)",
      );
    });
  });

  describe("banned-import tests", () => {
    const rule: RuleDefinition = {
      id: "prefer-kotlin-time",
      type: "banned-import",
      message: "Use kotlin.time instead of kotlinx.datetime",
      detect: {
        banned_import: "kotlinx.datetime.Instant",
        prefer: "kotlin.time.Instant",
      },
    };

    it("has violating import + compliant alternative import", () => {
      const result = emitRuleTest(rule)!;
      // Violating code should import the banned thing
      expect(result).toContain("kotlinx.datetime.Instant");
      // Compliant code should import the preferred thing
      expect(result).toContain("kotlin.time.Instant");
    });

    it("violation test expects hasSize(1)", () => {
      const result = emitRuleTest(rule)!;
      expect(result).toContain("hasSize(1)");
    });

    it("compliant test expects isEmpty()", () => {
      const result = emitRuleTest(rule)!;
      expect(result).toContain("isEmpty()");
    });
  });

  describe("prefer-construct tests", () => {
    const rule: RuleDefinition = {
      id: "sealed-ui-state",
      type: "prefer-construct",
      message: "UiState must be sealed interface",
      detect: {
        class_suffix: "UiState",
        must_be: "sealed",
      },
    };

    it("has violating class declaration + compliant sealed declaration", () => {
      const result = emitRuleTest(rule)!;
      // Violating: non-sealed class with the suffix
      expect(result).toContain("UiState");
      // Compliant: sealed class/interface with the suffix
      expect(result).toContain("sealed");
    });

    it("emitted test class name matches rule class name", () => {
      const result = emitRuleTest(rule)!;
      expect(result).toContain("class SealedUiStateRuleTest");
      expect(result).toContain(
        "private val rule = SealedUiStateRule(Config.empty)",
      );
    });
  });

  describe("banned-usage tests", () => {
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

    it("has violating initializer + compliant alternative", () => {
      const result = emitRuleTest(rule)!;
      // Violating: class with Channel<
      expect(result).toContain("Channel<");
      // Compliant: class with MutableSharedFlow
      expect(result).toContain("MutableSharedFlow");
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
      const result = emitRuleTest(rule);
      expect(result).toBeNull();
    });
  });
});

describe("emitConfigEntry", () => {
  it("produces valid YAML-like config entry with rule active=true", () => {
    const rule: RuleDefinition = {
      id: "prefer-kotlin-time",
      type: "banned-import",
      message: "test",
      detect: { banned_import: "x", prefer: "y" },
    };

    const result = emitConfigEntry(rule);
    expect(result.ruleId).toBe("PreferKotlinTimeRule");
    expect(result.entry).toContain("PreferKotlinTimeRule:");
    expect(result.entry).toContain("active: true");
  });
});

describe("emitFullConfig", () => {
  it("produces complete AndroidCommonDoc section for detekt config", () => {
    const rules: RuleDefinition[] = [
      {
        id: "prefer-kotlin-time",
        type: "banned-import",
        message: "test",
        detect: { banned_import: "x", prefer: "y" },
      },
      {
        id: "sealed-ui-state",
        type: "prefer-construct",
        message: "test",
        detect: { class_suffix: "UiState", must_be: "sealed" },
        hand_written: true,
        source_rule: "SealedUiStateRule.kt",
      },
    ];

    const result = emitFullConfig(rules);
    expect(result).toContain("AndroidCommonDoc:");
    expect(result).toContain("PreferKotlinTimeRule:");
    expect(result).toContain("active: true");
    // Hand-written rules should be included with reference comment
    expect(result).toContain("SealedUiStateRule");
  });

  it("handles empty rules array", () => {
    const result = emitFullConfig([]);
    expect(result).toContain("AndroidCommonDoc:");
  });
});
