package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoDefaultDispatcherInTestsRuleTest {
    private val rule = NoDefaultDispatcherInTestsRule(Config.empty)

    @Test
    fun `reports violating code`() {
        val code = """
            class MyClass {
                val events = Dispatchers.DefaultUnit>()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts compliant code`() {
        val code = """
            class MyClass {
                val events = injected testDispatcher parameter<Unit>()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}