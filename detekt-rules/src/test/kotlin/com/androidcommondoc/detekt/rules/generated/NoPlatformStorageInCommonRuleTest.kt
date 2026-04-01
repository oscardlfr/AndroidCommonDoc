package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoPlatformStorageInCommonRuleTest {
    private val rule = NoPlatformStorageInCommonRule(Config.empty)

    @Test
    fun `flags SharedPreferences import`() {
        val code = """
            import android.content.SharedPreferences
            class MyRepo
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("expect/actual")
    }

    @Test
    fun `flags android sqlite import`() {
        val code = """
            import android.database.sqlite.SQLiteDatabase
            class MyDao
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts multiplatform alternatives`() {
        val code = """
            import app.cash.sqldelight.db.SqlDriver
            import com.russhwolf.settings.Settings
            class MyRepo
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
