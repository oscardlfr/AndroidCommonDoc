package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoRunCatchingInCoroutineScopeRuleTest {
    private val rule = NoRunCatchingInCoroutineScopeRule(Config.empty)

    @Test
    fun `reports runCatching inside ViewModel`() {
        val code = """
            class LoginViewModel : ViewModel() {
                fun login(email: String) {
                    viewModelScope.launch {
                        val result = runCatching { repository.login(email) }
                    }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("CancellationException")
    }

    @Test
    fun `accepts runCatching outside ViewModel`() {
        val code = """
            class UserRepository {
                suspend fun fetchUser(id: String): Result<User> {
                    return runCatching { api.getUser(id) }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `reports runCatching at ViewModel top-level function`() {
        val code = """
            class SearchViewModel : ViewModel() {
                fun search(query: String) = runCatching { performSearch(query) }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts explicit try-catch with rethrow in ViewModel`() {
        val code = """
            class LoginViewModel : ViewModel() {
                fun login(email: String) {
                    viewModelScope.launch {
                        try {
                            repository.login(email)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            _state.update { LoginUiState.Error(e.message) }
                        }
                    }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
