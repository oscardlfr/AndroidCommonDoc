package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoMocksInCommonTestsRuleTest {
    private val rule = NoMocksInCommonTestsRule(Config.empty)

    @Test
    fun `flags io mockk import`() {
        val code = """
            import io.mockk.every
            class MyTest
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("fakes")
    }

    @Test
    fun `flags org mockito import`() {
        val code = """
            import org.mockito.Mockito
            class MyTest
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts non-mock imports`() {
        val code = """
            import kotlin.test.Test
            import kotlinx.coroutines.test.runTest
            class MyTest
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
