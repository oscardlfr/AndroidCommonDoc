package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoDefaultDispatcherInTestsRuleTest {
    private val rule = NoDefaultDispatcherInTestsRule(Config.empty)

    @Test
    fun `flags Dispatchers Default usage`() {
        val code = """
            import kotlinx.coroutines.Dispatchers
            fun doWork() {
                val dispatcher = Dispatchers.Default
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("testDispatcher")
    }

    @Test
    fun `accepts Dispatchers IO`() {
        val code = """
            import kotlinx.coroutines.Dispatchers
            fun doWork() {
                val dispatcher = Dispatchers.IO
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts injected dispatcher`() {
        val code = """
            fun doWork(dispatcher: CoroutineDispatcher) {
                val scope = CoroutineScope(dispatcher)
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
