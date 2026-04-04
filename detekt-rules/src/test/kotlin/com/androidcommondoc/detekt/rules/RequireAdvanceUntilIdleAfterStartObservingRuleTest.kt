package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class RequireAdvanceUntilIdleAfterStartObservingRuleTest {
    private val rule = RequireAdvanceUntilIdleAfterStartObservingRule(Config.empty)

    @Test
    fun `flags startObserving without advanceUntilIdle`() {
        val code = """
            import org.junit.jupiter.api.Test

            class FooTest {
                @Test
                fun `test observing`() {
                    val controller = FooController(scope)
                    controller.startObserving()
                    assertThat(controller.state.value).isEqualTo(expected)
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("advanceUntilIdle")
    }

    @Test
    fun `accepts startObserving with advanceUntilIdle`() {
        val code = """
            import org.junit.jupiter.api.Test

            class FooTest {
                @Test
                fun `test observing`() {
                    val controller = FooController(scope)
                    controller.startObserving()
                    advanceUntilIdle()
                    assertThat(controller.state.value).isEqualTo(expected)
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts startObserving with runCurrent`() {
        val code = """
            import org.junit.jupiter.api.Test

            class FooTest {
                @Test
                fun `test observing`() {
                    val controller = FooController(scope)
                    controller.startObserving()
                    runCurrent()
                    assertThat(controller.state.value).isEqualTo(expected)
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores non-test functions`() {
        val code = """
            class FooHelper {
                fun setup() {
                    controller.startObserving()
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores test without startObserving`() {
        val code = """
            import org.junit.jupiter.api.Test

            class FooTest {
                @Test
                fun `test something`() {
                    val result = compute()
                    assertThat(result).isEqualTo(42)
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
