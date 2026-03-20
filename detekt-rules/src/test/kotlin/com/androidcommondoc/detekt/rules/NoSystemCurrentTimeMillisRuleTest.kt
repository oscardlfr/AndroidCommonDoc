package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoSystemCurrentTimeMillisRuleTest {
    private val rule = NoSystemCurrentTimeMillisRule(Config.empty)

    @Test
    fun `reports System currentTimeMillis call`() {
        val code = """
            fun timestamp(): Long = System.currentTimeMillis()
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("System.currentTimeMillis()")
        assertThat(findings[0].message).contains("Clock.System")
    }

    @Test
    fun `reports System currentTimeMillis in variable assignment`() {
        val code = """
            fun doWork() {
                val start = System.currentTimeMillis()
                doStuff()
                val elapsed = System.currentTimeMillis() - start
            }
            fun doStuff() {}
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(2)
    }

    @Test
    fun `allows Clock System now toEpochMilliseconds`() {
        val code = """
            import kotlin.time.Clock
            import kotlin.time.ExperimentalTime

            @OptIn(ExperimentalTime::class)
            fun timestamp(): Long = Clock.System.now().toEpochMilliseconds()
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores currentTimeMillis on non-System receiver`() {
        val code = """
            class MyClock {
                fun currentTimeMillis(): Long = 0L
            }
            fun test() {
                val clock = MyClock()
                clock.currentTimeMillis()
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores unrelated System calls`() {
        val code = """
            fun env() = System.getenv("HOME")
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
