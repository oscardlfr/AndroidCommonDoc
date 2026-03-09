package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoSilentCatchRuleTest {
    private val rule = NoSilentCatchRule(Config.empty)

    @Test
    fun `reports silent catch(Exception) with empty body`() {
        val code = """
            fun doWork() {
                try {
                    riskyOperation()
                } catch (e: Exception) {
                    // intentionally ignored
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("catch(Exception)")
    }

    @Test
    fun `reports silent catch(Throwable) logging only`() {
        val code = """
            fun doWork() {
                try {
                    riskyOperation()
                } catch (e: Throwable) {
                    Log.e("TAG", "error: ${'$'}{e.message}")
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts catch(Exception) with rethrow`() {
        val code = """
            fun doWork() {
                try {
                    riskyOperation()
                } catch (e: Exception) {
                    logger.error(e)
                    throw e
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts specific exception type without rethrow`() {
        val code = """
            fun doWork() {
                try {
                    parseJson(data)
                } catch (e: JsonParseException) {
                    _state.update { ErrorState(e.message) }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts catch(Exception) with wrap and throw`() {
        val code = """
            fun doWork() {
                try {
                    riskyOperation()
                } catch (e: Exception) {
                    throw DomainException.Unknown(e)
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `reports silent catch(RuntimeException)`() {
        val code = """
            fun compute() {
                try {
                    calculate()
                } catch (e: RuntimeException) {
                    defaultValue = 0
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }
}
