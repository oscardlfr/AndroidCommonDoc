package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class WhileSubscribedTimeoutRuleTest {
    private val rule = WhileSubscribedTimeoutRule(Config.empty)

    @Test
    fun `reports WhileSubscribed with no timeout`() {
        val code = """
            import kotlinx.coroutines.flow.SharingStarted

            val state = flow.stateIn(scope, SharingStarted.WhileSubscribed(), initial)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("timeout")
    }

    @Test
    fun `reports WhileSubscribed with zero timeout`() {
        val code = """
            import kotlinx.coroutines.flow.SharingStarted

            val state = flow.stateIn(scope, SharingStarted.WhileSubscribed(0), initial)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts WhileSubscribed with 5000 timeout`() {
        val code = """
            import kotlinx.coroutines.flow.SharingStarted

            val state = flow.stateIn(scope, SharingStarted.WhileSubscribed(5000), initial)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts WhileSubscribed with underscore formatted timeout`() {
        val code = """
            import kotlinx.coroutines.flow.SharingStarted

            val state = flow.stateIn(scope, SharingStarted.WhileSubscribed(5_000), initial)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores SharingStarted Eagerly`() {
        val code = """
            import kotlinx.coroutines.flow.SharingStarted

            val state = flow.stateIn(scope, SharingStarted.Eagerly, initial)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
