package com.androidcommondoc.konsist

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.SoftAssertions
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Validates that every skill directory has a properly structured SKILL.md file.
 *
 * Uses plain JUnit file operations (no Konsist AST needed since this validates
 * filesystem structure and markdown content, not Kotlin source).
 *
 * Tests run from konsist-tests/ so the project root is accessed via `File("..")`.
 */
class SkillStructureTest {

    private val projectRoot = File("..")
    private val skillsDir = File(projectRoot, "skills")

    private val skillDirs: List<File> by lazy {
        val dirs = skillsDir.listFiles { f -> f.isDirectory }?.toList() ?: emptyList()
        dirs.sortedBy { it.name }
    }

    @Test
    fun `every skill directory has a SKILL_md file`() {
        require(skillsDir.exists()) {
            "Canary: skills/ directory not found at ${skillsDir.canonicalPath}"
        }
        require(skillDirs.isNotEmpty()) {
            "Canary: no skill directories found in ${skillsDir.canonicalPath}"
        }

        val softly = SoftAssertions()
        for (dir in skillDirs) {
            val skillMd = File(dir, "SKILL.md")
            softly.assertThat(skillMd.exists())
                .withFailMessage(
                    "Skill directory '${dir.name}' is missing SKILL.md. " +
                        "Create skills/${dir.name}/SKILL.md with required frontmatter. " +
                        "See skills/run/SKILL.md for reference format."
                )
                .isTrue()
        }
        softly.assertAll()
    }

    @Test
    fun `every SKILL_md has required frontmatter sections`() {
        require(skillsDir.exists()) {
            "Canary: skills/ directory not found at ${skillsDir.canonicalPath}"
        }
        require(skillDirs.isNotEmpty()) {
            "Canary: no skill directories found in ${skillsDir.canonicalPath}"
        }

        val softly = SoftAssertions()
        for (dir in skillDirs) {
            val skillMd = File(dir, "SKILL.md")
            if (!skillMd.exists()) continue

            val content = skillMd.readText()
            val lines = content.lines()
            val name = dir.name

            // Check 1: File is non-empty
            softly.assertThat(content.isNotBlank())
                .withFailMessage(
                    "SKILL.md in '$name' is empty. " +
                        "See skills/run/SKILL.md for reference format."
                )
                .isTrue()

            // Check 2: Has YAML frontmatter (starts with ---)
            softly.assertThat(content.startsWith("---"))
                .withFailMessage(
                    "SKILL.md in '$name' is missing YAML frontmatter (must start with ---). " +
                        "See skills/run/SKILL.md for reference format."
                )
                .isTrue()

            // Check 3: Frontmatter contains 'name:' field
            softly.assertThat(lines.any { it.trimStart().startsWith("name:") })
                .withFailMessage(
                    "SKILL.md in '$name' is missing required 'name:' frontmatter field. " +
                        "See skills/run/SKILL.md for reference format."
                )
                .isTrue()

            // Check 4: Frontmatter contains 'description:' field
            softly.assertThat(lines.any { it.trimStart().startsWith("description:") })
                .withFailMessage(
                    "SKILL.md in '$name' is missing required 'description:' frontmatter field. " +
                        "See skills/run/SKILL.md for reference format."
                )
                .isTrue()

            // Check 5: Has a markdown heading (## section)
            softly.assertThat(lines.any { it.startsWith("##") })
                .withFailMessage(
                    "SKILL.md in '$name' has no ## section headings. " +
                        "Expected at least '## Usage Examples'. " +
                        "See skills/run/SKILL.md for reference format."
                )
                .isTrue()

            // Check 6: File has at least 10 lines (not a stub)
            softly.assertThat(lines.size)
                .withFailMessage(
                    "SKILL.md in '$name' has only ${lines.size} lines (expected >= 10). " +
                        "This looks like a stub. Add complete documentation. " +
                        "See skills/run/SKILL.md for reference format."
                )
                .isGreaterThanOrEqualTo(10)
        }
        softly.assertAll()
    }

    @Test
    fun `skill count matches expected range`() {
        require(skillsDir.exists()) {
            "Canary: skills/ directory not found at ${skillsDir.canonicalPath}"
        }

        val count = skillDirs.size

        assertThat(count)
            .withFailMessage {
                "Expected at least 10 skill directories, found $count. " +
                    "Was a skill accidentally deleted? " +
                    "Current skills: ${skillDirs.map { it.name }}"
            }
            .isGreaterThanOrEqualTo(10)
    }
}
