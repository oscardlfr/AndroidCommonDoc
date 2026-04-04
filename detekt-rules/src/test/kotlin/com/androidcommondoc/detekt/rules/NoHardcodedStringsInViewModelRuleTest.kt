package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoHardcodedStringsInViewModelRuleTest {
    private val rule = NoHardcodedStringsInViewModelRule(Config.empty)

    @Test
    fun `reports hardcoded user-facing string in ViewModel`() {
        val code = """
            class LoginViewModel : ViewModel() {
                fun onError() {
                    _state.update { LoginUiState.Error("Invalid email or password") }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("StringResource")
    }

    @Test
    fun `accepts StringResource usage`() {
        val code = """
            class LoginViewModel : ViewModel() {
                fun onError() {
                    _state.update { LoginUiState.Error(StringResource(R.string.login_error_invalid)) }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts empty string`() {
        val code = """
            class FormViewModel : ViewModel() {
                fun clear() {
                    _state.update { it.copy(inputText = "") }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts string in companion object constant`() {
        val code = """
            class AuthViewModel : ViewModel() {
                companion object {
                    const val TAG = "AuthViewModel"
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts hardcoded string in non-ViewModel`() {
        val code = """
            class UserRepository {
                fun getErrorMessage() = "Something went wrong"
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `reports hardcoded string used as id argument`() {
        val code = """
            class ProfileViewModel : ViewModel() {
                fun onProfileLoad() {
                    _state.update { it.copy(id = "user-123") }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("StringResource")
    }

    @Test
    fun `accepts string inside StringResource`() {
        val code = """
            class LoginViewModel : ViewModel() {
                fun onError() {
                    _state.update { LoginUiState.Error(StringResource("login_error")) }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts string inside UiText StringResource`() {
        val code = """
            class LoginViewModel : ViewModel() {
                fun onError() {
                    _state.update { LoginUiState.Error(UiText.StringResource("login_error")) }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `reports multiple hardcoded strings in same ViewModel`() {
        val code = """
            class OnboardingViewModel : ViewModel() {
                fun onStep1Error() {
                    _state.update { it.copy(error = "Enter a valid name") }
                }
                fun onStep2Error() {
                    _state.update { it.copy(error = "Enter a valid email") }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(2)
    }
}
