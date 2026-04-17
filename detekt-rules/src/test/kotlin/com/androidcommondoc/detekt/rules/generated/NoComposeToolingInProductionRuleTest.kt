package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoComposeToolingInProductionRuleTest {
    private val rule = NoComposeToolingInProductionRule(Config.empty)

    @Test
    fun `reports violating code`() {
        val code = """
            import androidx.compose.ui.tooling
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts compliant code`() {
        val code = """
            import move @Preview composables to commonTest or a -previews module
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}