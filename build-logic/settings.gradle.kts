// Allow consuming projects to resolve the plugin from Maven Central
// without requiring access to plugins.gradle.org.
pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()   // kept as fallback — safe when accessible
    }
}

rootProject.name = "build-logic"
