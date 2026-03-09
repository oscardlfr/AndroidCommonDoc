package com.androidcommondoc.konsist.support

import com.lemonappdev.konsist.api.Konsist
import com.lemonappdev.konsist.api.container.KoScope
import java.io.File

/**
 * Centralized scope creation with canary assertions for all Konsist tests.
 *
 * Every method asserts the returned scope is non-empty to prevent vacuous passes.
 * Paths are resolved relative to the konsist-tests/ working directory (when running
 * via `./gradlew test` from konsist-tests/).
 *
 * Konsist's [scopeFromDirectory] internally prepends the project root to relative paths,
 * so we pass relative paths (not absolute) to avoid path duplication on Windows.
 * We validate directory existence separately via [java.io.File] before passing to Konsist.
 */
object ScopeFactory {

    /**
     * Scope for detekt-rules production Kotlin sources.
     * Expected: >= 6 files (1 provider + 5 rules).
     */
    fun detektRulesScope(): KoScope {
        val relativePath = "../detekt-rules/src/main/kotlin"
        validateDirectoryExists(relativePath)
        val scope = Konsist.scopeFromDirectory(relativePath)
        val fileCount = scope.files.toList().size
        require(fileCount >= 6) {
            "Canary: detekt-rules scope has $fileCount files (expected >= 6). " +
                "Working dir: ${System.getProperty("user.dir")}. " +
                "Check that konsist-tests/ is adjacent to detekt-rules/."
        }
        return scope
    }

    /**
     * Scope for detekt-rules test Kotlin sources.
     * Expected: >= 5 files (5 test classes).
     */
    fun detektRulesTestScope(): KoScope {
        val relativePath = "../detekt-rules/src/test/kotlin"
        validateDirectoryExists(relativePath)
        val scope = Konsist.scopeFromDirectory(relativePath)
        val fileCount = scope.files.toList().size
        require(fileCount >= 5) {
            "Canary: detekt-rules test scope has $fileCount files (expected >= 5). " +
                "Working dir: ${System.getProperty("user.dir")}. " +
                "Check that konsist-tests/ is adjacent to detekt-rules/."
        }
        return scope
    }

    /**
     * Scope for build-logic production Kotlin sources.
     * Expected: >= 1 file (AndroidCommonDocExtension.kt).
     */
    fun buildLogicScope(): KoScope {
        val relativePath = "../build-logic/src/main/kotlin"
        validateDirectoryExists(relativePath)
        val scope = Konsist.scopeFromDirectory(relativePath)
        val fileCount = scope.files.toList().size
        require(fileCount >= 1) {
            "Canary: build-logic scope has $fileCount files (expected >= 1). " +
                "Working dir: ${System.getProperty("user.dir")}. " +
                "Check that konsist-tests/ is adjacent to build-logic/."
        }
        return scope
    }

    /**
     * Scope for test fixture files (intentional violations).
     * Expected: >= 1 file per fixture directory.
     */
    fun fixtureScope(fixturePath: String): KoScope {
        val relativePath = "src/test/resources/fixtures/$fixturePath"
        validateDirectoryExists(relativePath)
        val scope = Konsist.scopeFromDirectory(relativePath)
        val fileCount = scope.files.toList().size
        require(fileCount >= 1) {
            "Canary: fixture scope '$fixturePath' has $fileCount files (expected >= 1). " +
                "Working dir: ${System.getProperty("user.dir")}. " +
                "Check that fixture files exist at $relativePath."
        }
        return scope
    }

    /**
     * Validates that a relative directory path exists and is a directory.
     *
     * This check runs before passing the path to Konsist's scopeFromDirectory,
     * providing a clear error message if the directory is missing (rather than
     * Konsist's internal "Directory does not exist" error which concatenates paths
     * incorrectly on Windows).
     */
    private fun validateDirectoryExists(relativePath: String) {
        val file = File(relativePath)
        require(file.exists() && file.isDirectory) {
            "Directory not found: ${file.canonicalPath} " +
                "(from relative path: '$relativePath', " +
                "working dir: ${System.getProperty("user.dir")})"
        }
    }
}
