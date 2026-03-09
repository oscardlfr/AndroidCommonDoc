package com.androidcommondoc.gradle

import org.gradle.api.provider.Property

/**
 * Extension DSL for the `androidcommondoc.toolkit` convention plugin.
 *
 * All concerns are enabled by default. Consuming projects can disable
 * individual concerns via the `androidCommonDoc` block:
 *
 * ```kotlin
 * androidCommonDoc {
 *     detektRules.set(false)      // Disable custom architecture rules
 *     composeRules.set(false)     // Disable Compose Rules 0.5.6
 *     testConfig.set(false)       // Disable test configuration conventions
 *     formattingRules.set(false)  // Disable ktlint formatting rules
 * }
 * ```
 */
abstract class AndroidCommonDocExtension {

    /** Enable/disable custom Detekt architecture rules JAR. Default: true */
    abstract val detektRules: Property<Boolean>

    /** Enable/disable Compose Rules (mrmans0n 0.5.6). Default: true */
    abstract val composeRules: Property<Boolean>

    /** Enable/disable test configuration conventions (maxParallelForks=1, useJUnitPlatform). Default: true */
    abstract val testConfig: Property<Boolean>

    /** Enable/disable ktlint formatting rules via detekt-rules-ktlint-wrapper. Default: false
     *
     * Disabled by default because in legacy projects ktlint generates ~300 formatting
     * issues (trailing commas, newlines) that bury the 13 architecture rules.
     * Enable explicitly when the project is ready to enforce formatting via Detekt.
     */
    abstract val formattingRules: Property<Boolean>

    init {
        detektRules.convention(true)
        composeRules.convention(true)
        testConfig.convention(true)
        formattingRules.convention(false)
    }
}
