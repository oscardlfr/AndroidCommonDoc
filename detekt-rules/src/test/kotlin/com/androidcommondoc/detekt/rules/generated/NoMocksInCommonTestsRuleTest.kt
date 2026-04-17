package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoMocksInCommonTestsRuleTest {
    private val rule = NoMocksInCommonTestsRule(Config.empty)

    @Test
    fun `reports violating code`() {
        val code = """
            import io.mockk
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts compliant code`() {
        val code = """
            import pure Kotlin fake class
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}