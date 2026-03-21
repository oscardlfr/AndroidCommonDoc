package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtImportDirective

/**
 * Forbids java.time.* and other JVM-only APIs in commonMain source sets.
 *
 * These APIs are not available in Kotlin/Native or Kotlin/JS. Use expect/actual
 * declarations or kotlinx.datetime equivalents instead.
 *
 * Forbidden packages:
 * - java.time.* (Instant, DateTimeFormatter, ZoneId, etc.)
 * - java.security.* (MessageDigest, etc.)
 * - java.text.* (Normalizer, etc.)
 *
 * AST-only: checks import directives. File path detection for commonMain
 * is done via file path heuristic (contains "commonMain" or "shared").
 *
 * When the file path cannot be determined (e.g. in tests), the rule checks
 * all files. Configure `onlyCommonMain: true` (default) to restrict to
 * commonMain paths, or `onlyCommonMain: false` to check all source sets.
 */
class NoJavaTimeInCommonMainRule(config: Config) : Rule(
    config,
    "java.time/java.security/java.text APIs are forbidden in commonMain — use expect/actual or kotlinx.datetime"
) {
    private val onlyCommonMain: Boolean = config.valueOrDefault("onlyCommonMain", true)

    private val forbiddenPrefixes = listOf(
        "java.time.",
        "java.security.",
        "java.text.",
    )

    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)

        if (onlyCommonMain) {
            val filePath = importDirective.containingKtFile.virtualFilePath
            if (!isCommonMain(filePath)) return
        }

        val importPath = importDirective.importPath?.pathStr ?: return

        val isForbidden = forbiddenPrefixes.any { importPath.startsWith(it) }

        if (isForbidden) {
            report(
                Finding(
                    Entity.from(importDirective),
                    "Import '$importPath' is a JVM-only API forbidden in commonMain. " +
                        "Use expect/actual declarations or kotlinx.datetime equivalents."
                )
            )
        }
    }

    private val platformSourceSets = listOf(
        "/androidMain/", "/desktopMain/", "/iosMain/", "/appleMain/",
        "/jvmMain/", "/nativeMain/", "/jsMain/", "/wasmMain/",
        "/androidUnitTest/", "/desktopTest/", "/iosTest/",
    )

    private fun isCommonMain(filePath: String): Boolean {
        val normalized = filePath.replace('\\', '/')
        // Explicitly exclude platform source sets (Detekt 2.0 per-source-set tasks
        // may report files without full path context)
        if (platformSourceSets.any { normalized.contains(it) }) return false
        return normalized.contains("/commonMain/") || normalized.contains("/shared/")
    }
}
