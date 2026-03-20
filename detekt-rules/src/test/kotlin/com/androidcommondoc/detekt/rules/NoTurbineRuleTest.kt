package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoTurbineRuleTest {
    private val rule = NoTurbineRule(Config.empty)

    @Test
    fun `reports app cash turbine import`() {
        val code = """
            import app.cash.turbine.test

            suspend fun testFlow() {
                flowOf(1, 2, 3).test {
                    awaitItem()
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("Turbine")
        assertThat(findings[0].message).contains("backgroundScope")
    }

    @Test
    fun `reports turbine testIn import`() {
        val code = """
            import app.cash.turbine.testIn

            suspend fun testFlow() {}
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `reports turbine wildcard import`() {
        val code = """
            import app.cash.turbine.*

            suspend fun testFlow() {}
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `allows flow toList with backgroundScope`() {
        val code = """
            import kotlinx.coroutines.flow.toList
            import kotlinx.coroutines.launch
            import kotlinx.coroutines.test.UnconfinedTestDispatcher

            fun testFlow() {
                val states = mutableListOf<Int>()
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `allows flow first and take`() {
        val code = """
            import kotlinx.coroutines.flow.first
            import kotlinx.coroutines.flow.take

            suspend fun testFlow() {}
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores unrelated cash imports`() {
        val code = """
            import app.cash.sqldelight.db.SqlDriver

            fun createDriver(): SqlDriver? = null
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
