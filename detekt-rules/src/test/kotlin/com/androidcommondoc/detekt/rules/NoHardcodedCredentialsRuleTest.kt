package com.androidcommondoc.detekt.rules

import dev.detekt.test.TestConfig
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoHardcodedCredentialsRuleTest {

    private val rule = NoHardcodedCredentialsRule(TestConfig())

    @Test
    fun `password variable with string literal flags`() {
        val code = """
            class Config {
                val databasePassword = "super-secret-password-123"
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("databasePassword")
        assertThat(findings[0].message).contains("hardcoded credential")
    }

    @Test
    fun `apiKey variable with string literal flags`() {
        val code = """
            object Constants {
                val apiKey = "sk-1234567890abcdef"
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `bearerToken variable flags`() {
        val code = """
            class AuthConfig {
                val bearerToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `short value under 6 chars passes`() {
        val code = """
            class Config {
                val password = "test"
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `non-credential variable name passes`() {
        val code = """
            class Config {
                val databaseUrl = "jdbc:postgresql://localhost:5432/mydb"
                val maxRetries = 3
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `function call initializer passes`() {
        val code = """
            class Config {
                val apiKey = System.getenv("API_KEY")
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `string interpolation passes`() {
        val code = """
            class Config {
                val password = "${'$'}{env.PASSWORD}"
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `multiple credential patterns all flag`() {
        val code = """
            class Secrets {
                val masterPassword = "changeme123456"
                val secretKey = "my-super-secret-key"
                val refreshToken = "rt_abc123def456ghi"
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(3)
    }
}
