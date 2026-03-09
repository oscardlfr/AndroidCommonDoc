plugins {
    kotlin("jvm") version "2.3.10"
}

group = "com.androidcommondoc"
version = "1.0.0"

val detektPlugins by configurations.creating

repositories {
    mavenCentral()
}

dependencies {
    // Custom rules (this module's JAR) -- compileOnly since detekt provides at runtime
    compileOnly("dev.detekt:detekt-api:2.0.0-alpha.2")

    // Compose rules -- co-exists alongside custom rules via separate RuleSetProvider
    detektPlugins("io.nlopez.compose.rules:detekt:0.5.6")

    // Test dependencies
    testImplementation("dev.detekt:detekt-test:2.0.0-alpha.2")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation("org.assertj:assertj-core:3.27.3")
}

tasks.withType<Test> {
    useJUnitPlatform()
}
