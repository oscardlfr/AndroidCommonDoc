package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoMagicNumbersInUseCaseRuleTest {
    private val rule = NoMagicNumbersInUseCaseRule(Config.empty)

    @Test
    fun `reports magic number in UseCase`() {
        val code = """
            class RetryUseCase {
                suspend operator fun invoke() {
                    repeat(3) { attempt ->
                        doOperation()
                    }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("3")
    }

    @Test
    fun `reports large timeout magic number`() {
        val code = """
            class FetchDataUseCase {
                suspend operator fun invoke() {
                    withTimeout(5000L) { api.fetch() }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("5000")
    }

    @Test
    fun `accepts 0 and 1 as boundary values`() {
        val code = """
            class PaginationUseCase {
                suspend operator fun invoke(page: Int) {
                    if (page == 0) return
                    val index = page - 1
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts named constants in companion object`() {
        val code = """
            class RetryUseCase {
                companion object {
                    const val MAX_RETRIES = 3
                    const val TIMEOUT_MS = 5000L
                }
                suspend operator fun invoke() {
                    repeat(MAX_RETRIES) { doOperation() }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts magic numbers in non-UseCase class`() {
        val code = """
            class UserRepository {
                suspend fun paginate() = api.fetch(page = 2)
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
