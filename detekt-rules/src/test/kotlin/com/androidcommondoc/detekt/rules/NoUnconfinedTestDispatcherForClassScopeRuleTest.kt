package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoUnconfinedTestDispatcherForClassScopeRuleTest {
    private val rule = NoUnconfinedTestDispatcherForClassScopeRule(Config.empty)

    @Test
    fun `flags UnconfinedTestDispatcher as named constructor arg`() {
        val code = """
            val vm = FooViewModel(dispatcher = UnconfinedTestDispatcher())
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("FooViewModel")
    }

    @Test
    fun `flags UnconfinedTestDispatcher as positional constructor arg`() {
        val code = """
            val useCase = SomeUseCase(fakeRepo, UnconfinedTestDispatcher())
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("SomeUseCase")
    }

    @Test
    fun `accepts UnconfinedTestDispatcher in backgroundScope plus expression`() {
        val code = """
            backgroundScope.launch(backgroundScope.coroutineContext + UnconfinedTestDispatcher()) {
                flow.toList(states)
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts UnconfinedTestDispatcher in launch argument`() {
        val code = """
            backgroundScope.launch(UnconfinedTestDispatcher()) {
                flow.toList(states)
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts UnconfinedTestDispatcher in async argument`() {
        val code = """
            backgroundScope.async(UnconfinedTestDispatcher()) {
                flow.first()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts UnconfinedTestDispatcher assigned to variable`() {
        val code = """
            val dispatcher = UnconfinedTestDispatcher()
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
