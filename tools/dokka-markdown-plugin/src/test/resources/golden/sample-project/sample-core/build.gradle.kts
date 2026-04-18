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
