package com.androidcommondoc.konsist

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Validates that every SH script has a matching PS1 script (and vice versa).
 *
 * This ensures cross-platform parity: every automation available on macOS/Linux
 * is also available on Windows. Uses plain JUnit file operations (no Konsist AST
 * needed since this validates filesystem structure, not Kotlin source).
 *
 * Tests run from konsist-tests/ so the project root is accessed via `File("..")`.
 */
class ScriptParityTest {

    private val projectRoot = File("..")
    private val shDir = File(projectRoot, "scripts/sh")
    private val ps1Dir = File(projectRoot, "scripts/ps1")

    @Test
    fun `every sh script has a matching ps1 script`() {
        require(shDir.exists()) {
            "Canary: scripts/sh/ directory not found at ${shDir.canonicalPath}"
        }
        require(ps1Dir.exists()) {
            "Canary: scripts/ps1/ directory not found at ${ps1Dir.canonicalPath}"
        }

        val shScripts = shDir.listFiles { f -> f.extension == "sh" && !f.isDirectory }
            ?.map { it.nameWithoutExtension }?.toSet() ?: emptySet()
        val ps1Scripts = ps1Dir.listFiles { f -> f.extension == "ps1" && !f.isDirectory }
            ?.map { it.nameWithoutExtension }?.toSet() ?: emptySet()

        require(shScripts.isNotEmpty()) {
            "Canary: no .sh scripts found in ${shDir.canonicalPath}"
        }

        val missingPs1 = shScripts - ps1Scripts

        assertThat(missingPs1)
            .withFailMessage {
                "SH scripts without PS1 counterpart: $missingPs1. " +
                    "Create matching .ps1 files in scripts/ps1/ for each, " +
                    "or remove the orphaned .sh scripts if they are no longer needed."
            }
            .isEmpty()
    }

    @Test
    fun `every ps1 script has a matching sh script`() {
        require(shDir.exists()) {
            "Canary: scripts/sh/ directory not found at ${shDir.canonicalPath}"
        }
        require(ps1Dir.exists()) {
            "Canary: scripts/ps1/ directory not found at ${ps1Dir.canonicalPath}"
        }

        val shScripts = shDir.listFiles { f -> f.extension == "sh" && !f.isDirectory }
            ?.map { it.nameWithoutExtension }?.toSet() ?: emptySet()
        val ps1Scripts = ps1Dir.listFiles { f -> f.extension == "ps1" && !f.isDirectory }
            ?.map { it.nameWithoutExtension }?.toSet() ?: emptySet()

        require(ps1Scripts.isNotEmpty()) {
            "Canary: no .ps1 scripts found in ${ps1Dir.canonicalPath}"
        }

        val missingSh = ps1Scripts - shScripts

        assertThat(missingSh)
            .withFailMessage {
                "PS1 scripts without SH counterpart: $missingSh. " +
                    "Create matching .sh files in scripts/sh/ for each, " +
                    "or remove the orphaned .ps1 scripts if they are no longer needed."
            }
            .isEmpty()
    }
}
