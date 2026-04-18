package com.androidcommondoc.dokka.markdown

import org.gradle.testkit.runner.GradleRunner
import org.gradle.testkit.runner.TaskOutcome
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Runs the full plugin pipeline on the mini KMP sample project and diffs
 * output against frozen golden files.
 *
 * Uses jvm() target only — iosArm64() triggers a 2GB Kotlin/Native download.
 * Plugin JAR injected via dokkaPlugin(files(...)) using a local Maven repo
 * structure copied into the temp dir — avoids Windows drive-letter path issues.
 */
class GoldenIntegrationTest {

    @TempDir
    lateinit var projectDir: File

    private val pluginJar: File by lazy {
        val jarDir = System.getProperty("pluginJarDir")
            ?.let { File(it) }
            ?: File(System.getProperty("user.dir"), "build/libs")
        jarDir.listFiles { f -> f.name.endsWith(".jar") && !f.name.contains("sources") }
            ?.maxByOrNull { it.lastModified() }
            ?: error("Plugin JAR not found in $jarDir — run :jar first")
    }

    private val expectedDir: File by lazy {
        GoldenIntegrationTest::class.java.classLoader
            .getResource("golden/expected")!!
            .let { File(it.toURI()) }
    }

    @BeforeEach
    fun setup() {
        val srcDir = File(
            GoldenIntegrationTest::class.java.classLoader
                .getResource("golden/sample-project")!!.toURI()
        )
        srcDir.copyRecursively(projectDir, overwrite = true)

        // Create a flat local Maven repository inside the temp dir.
        // Avoids Windows drive-letter path resolution issues with files(...).
        val localRepo = File(projectDir, "local-plugin-repo")
        val repoCoord = "com/androidcommondoc/dokka-markdown-plugin/0.1.0"
        val repoDir = File(localRepo, repoCoord).also { it.mkdirs() }
        pluginJar.copyTo(File(repoDir, "dokka-markdown-plugin-0.1.0.jar"), overwrite = true)
        File(repoDir, "dokka-markdown-plugin-0.1.0.pom").writeText(minimalPom())

        val submoduleBuildContent = """
            plugins {
                kotlin("multiplatform") version "2.3.0"
                id("org.jetbrains.dokka") version "2.2.0"
            }
            kotlin {
                jvm()
                sourceSets {
                    commonMain.dependencies {}
                }
            }
            repositories {
                maven { url = uri(rootProject.file("local-plugin-repo")) }
            }
            dependencies {
                dokkaPlugin("com.androidcommondoc:dokka-markdown-plugin:0.1.0")
            }
        """.trimIndent()

        File(projectDir, "sample-core/build.gradle.kts").writeText(submoduleBuildContent)
        File(projectDir, "sample-data/build.gradle.kts").writeText(submoduleBuildContent)
        File(projectDir, "build.gradle.kts").writeText("")
    }

    @Test
    fun `goldenTest_pluginRunsAndOutputMatchesExpected`() {
        val result = GradleRunner.create()
            .withProjectDir(projectDir)
            .withArguments("dokkaGenerate", "--stacktrace")
            .forwardOutput()
            .build()

        assertTrue(
            result.tasks.any { it.outcome == TaskOutcome.SUCCESS },
            "At least one task should succeed"
        )

        val outputDirs = listOf(
            File(projectDir, "sample-core/build/dokka/html"),
            File(projectDir, "sample-data/build/dokka/html"),
        ).filter { it.exists() }

        assertTrue(outputDirs.isNotEmpty(), "At least one output directory must be created")
        diffAgainstGolden(outputDirs)
    }

    @Test
    fun `goldenTest_secondRun_producesZeroChanges`() {
        val runner = GradleRunner.create()
            .withProjectDir(projectDir)
            .withArguments("dokkaGenerate")
            .forwardOutput()

        runner.build()

        fun collectHashes() = listOf(
            File(projectDir, "sample-core/build/dokka/html"),
            File(projectDir, "sample-data/build/dokka/html"),
        ).filter { it.exists() }.let { collectContentHashes(it) }

        val hashesAfterFirstRun = collectHashes()
        runner.build()
        val hashesAfterSecondRun = collectHashes()

        assertEquals(hashesAfterFirstRun, hashesAfterSecondRun,
            "Second run must produce identical content_hash values (idempotent)")
    }

    private fun diffAgainstGolden(outputDirs: List<File>) {
        val goldenFiles = expectedDir.walkTopDown().filter { it.isFile && it.extension == "md" }
        for (goldenFile in goldenFiles) {
            val relativePath = goldenFile.relativeTo(expectedDir).path.replace("\\", "/")
            val actualFile = outputDirs
                .map { File(it, relativePath) }
                .firstOrNull { it.exists() }
            assertTrue(actualFile != null, "Expected output file missing: $relativePath")

            val goldenLines = goldenFile.readLines(Charsets.UTF_8)
            val actualLines = actualFile.readLines(Charsets.UTF_8)

            val filteredGolden = goldenLines.filterNot { it.startsWith("content_hash:") }
            val filteredActual = actualLines.filterNot { it.startsWith("content_hash:") }

            filteredGolden.zip(filteredActual).forEachIndexed { i, (expected, actual) ->
                assertEquals(expected, actual,
                    "First diff in $relativePath at line ${i + 1}: expected=[$expected] actual=[$actual]")
            }
            assertEquals(filteredGolden.size, filteredActual.size,
                "Line count mismatch in $relativePath: " +
                "expected ${filteredGolden.size} lines, got ${filteredActual.size}")
        }
    }

    private fun collectContentHashes(outputDirs: List<File>): Map<String, String> =
        outputDirs.flatMap { dir ->
            dir.walkTopDown()
                .filter { it.isFile && it.extension == "md" }
                .map { file ->
                    val key = dir.parentFile.name + "/" + file.relativeTo(dir).path.replace("\\", "/")
                    val hash = file.readLines(Charsets.UTF_8)
                        .firstOrNull { it.startsWith("content_hash:") }
                        ?.substringAfter("content_hash:")?.trim() ?: ""
                    key to hash
                }
        }.toMap()

    private fun minimalPom(): String = """
        <?xml version="1.0" encoding="UTF-8"?>
        <project>
          <modelVersion>4.0.0</modelVersion>
          <groupId>com.androidcommondoc</groupId>
          <artifactId>dokka-markdown-plugin</artifactId>
          <version>0.1.0</version>
          <packaging>jar</packaging>
        </project>
    """.trimIndent()
}
