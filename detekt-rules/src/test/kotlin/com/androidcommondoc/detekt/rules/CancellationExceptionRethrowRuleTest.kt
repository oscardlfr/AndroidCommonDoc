package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class CancellationExceptionRethrowRuleTest {
    private val rule = CancellationExceptionRethrowRule(Config.empty)

    @Test
    fun `reports CancellationException caught but not rethrown`() {
        val code = """
            import kotlinx.coroutines.CancellationException

            fun doWork() {
                try {
                    suspendWork()
                } catch (e: CancellationException) {
                    log(e)
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("CancellationException")
    }

    @Test
    fun `reports CancellationException caught with empty block`() {
        val code = """
            import kotlinx.coroutines.CancellationException

            fun doWork() {
                try {
                    suspendWork()
                } catch (e: CancellationException) {
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts CancellationException properly rethrown`() {
        val code = """
            import kotlinx.coroutines.CancellationException

            fun doWork() {
                try {
                    suspendWork()
                } catch (e: CancellationException) {
                    throw e
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores non-CancellationException catch`() {
        val code = """
            fun doWork() {
                try {
                    work()
                } catch (e: IOException) {
                    log(e)
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `reports bare Exception catch without rethrow`() {
        val code = """
            fun doWork() {
                try {
                    suspendWork()
                } catch (e: Exception) {
                    log(e)
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("CancellationException")
    }

    @Test
    fun `accepts Exception catch when preceding sibling rethrows CancellationException`() {
        val code = """
            import kotlinx.coroutines.CancellationException

            fun doWork() {
                try {
                    suspendWork()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    log(e)
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `reports Exception catch when sibling CancellationException catch does not rethrow`() {
        val code = """
            import kotlinx.coroutines.CancellationException

            fun doWork() {
                try {
                    suspendWork()
                } catch (e: CancellationException) {
                    log(e)
                } catch (e: Exception) {
                    log(e)
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(2)
    }

    @Test
    fun `accepts Exception catch with coroutineContext ensureActive call`() {
        val code = """
            fun doWork() {
                try {
                    suspendWork()
                } catch (e: Exception) {
                    coroutineContext.ensureActive()
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts Exception catch with currentCoroutineContext ensureActive call`() {
        val code = """
            fun doWork() {
                try {
                    suspendWork()
                } catch (e: Exception) {
                    currentCoroutineContext().ensureActive()
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts Exception catch with bare ensureActive call`() {
        val code = """
            fun doWork() {
                try {
                    suspendWork()
                } catch (e: Exception) {
                    ensureActive()
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `reports CancellationException catch with ensureActive but no rethrow`() {
        val code = """
            import kotlinx.coroutines.CancellationException

            fun doWork() {
                try {
                    suspendWork()
                } catch (e: CancellationException) {
                    coroutineContext.ensureActive()
                }
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }
}
