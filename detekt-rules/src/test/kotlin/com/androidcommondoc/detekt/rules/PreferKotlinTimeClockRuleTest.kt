package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class PreferKotlinTimeClockRuleTest {
    private val rule = PreferKotlinTimeClockRule(Config.empty)

    @Test
    fun `reports kotlinx datetime Clock import`() {
        val code = """
            import kotlinx.datetime.Clock

            fun now() = Clock.System.now()
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("kotlinx.datetime.Clock")
        assertThat(findings[0].message).contains("kotlin.time.Clock.System")
    }

    @Test
    fun `reports kotlinx datetime Clock System import`() {
        val code = """
            import kotlinx.datetime.Clock.System

            fun now() = System.now()
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `allows kotlin time Clock import`() {
        val code = """
            import kotlin.time.Clock
            import kotlin.time.ExperimentalTime

            @OptIn(ExperimentalTime::class)
            fun now() = Clock.System.now()
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `allows kotlinx datetime Instant import (exception for parsing)`() {
        val code = """
            import kotlinx.datetime.Instant

            fun parse(s: String) = Instant.parse(s)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `allows kotlinx datetime toLocalDateTime (exception for formatting)`() {
        val code = """
            import kotlinx.datetime.toLocalDateTime
            import kotlinx.datetime.TimeZone

            fun format(instant: kotlinx.datetime.Instant) =
                instant.toLocalDateTime(TimeZone.currentSystemDefault())
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores unrelated imports`() {
        val code = """
            import kotlinx.coroutines.flow.StateFlow
            import kotlin.time.Duration

            val x = 1
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
