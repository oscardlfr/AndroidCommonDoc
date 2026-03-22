package com.androidcommondoc.detekt.rules

import dev.detekt.test.TestConfig
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class RequireRunCatchingCancellableRuleTest {

    private val rule = RequireRunCatchingCancellableRule(TestConfig())

    @Test
    fun `suspend fun with catch Exception flags`() {
        val code = """
            suspend fun fetchData(): String {
                try {
                    return api.call()
                } catch (e: Exception) {
                    return "fallback"
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("CancellationException")
        assertThat(findings[0].message).contains("fetchData")
    }

    @Test
    fun `non-suspend fun with catch Exception passes`() {
        val code = """
            fun parseData(input: String): Int {
                try {
                    return input.toInt()
                } catch (e: Exception) {
                    return 0
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `file importing CancellationException passes`() {
        val code = """
            import kotlinx.coroutines.CancellationException

            suspend fun fetchData(): String {
                try {
                    return api.call()
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    return "fallback"
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `suspend fun catching specific exception passes`() {
        val code = """
            import java.io.IOException

            suspend fun readFile(): String {
                try {
                    return file.readText()
                } catch (e: IOException) {
                    return "default"
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `multiple catch blocks only flags Exception catches in suspend`() {
        val code = """
            suspend fun complexOperation(): String {
                try {
                    return doWork()
                } catch (e: IllegalArgumentException) {
                    return "bad arg"
                } catch (e: Exception) {
                    return "fallback"
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `nested function - only suspend is flagged`() {
        val code = """
            fun outerFunction() {
                try {
                    doSomething()
                } catch (e: Exception) {
                    handleError()
                }
            }
            
            suspend fun innerSuspend() {
                try {
                    fetchRemote()
                } catch (e: Exception) {
                    logError(e)
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("innerSuspend")
    }
}
