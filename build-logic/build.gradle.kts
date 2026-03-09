plugins {
    `java-gradle-plugin`
    kotlin("jvm") version "2.3.0"
}

// Repositories: Maven Central only — no Gradle Plugin Portal required.
// This ensures the build-logic compiles in environments where
// plugins.gradle.org is blocked by a corporate SSL proxy (Gradle 9.x
// moved kotlin-dsl resolution there, breaking proxy-only setups).
repositories {
    mavenCentral()
}

dependencies {
    // Detekt 2.0 Gradle plugin API — needed to call pluginManager.apply("dev.detekt")
    // and configure the DetektExtension programmatically.
    implementation("dev.detekt:dev.detekt.gradle.plugin:2.0.0-alpha.2")

    // Kotlin Gradle plugin — required because the Detekt plugin depends on
    // KotlinBasePlugin at runtime. Without this the Gradle daemon fails with
    // "KotlinBasePlugin not found" when applying dev.detekt.
    implementation("org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.0")
}

gradlePlugin {
    plugins {
        create("toolkit") {
            id = "androidcommondoc.toolkit"
            implementationClass = "com.androidcommondoc.gradle.AndroidCommonDocToolkitPlugin"
        }
    }
}
