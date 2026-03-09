plugins {
    kotlin("jvm") version "2.3.10"
}

group = "com.androidcommondoc"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    testImplementation("com.lemonappdev:konsist:0.17.3")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation("org.assertj:assertj-core:3.27.3")
}

tasks.withType<Test> {
    useJUnitPlatform()
    outputs.upToDateWhen { false } // KONS-05: never UP-TO-DATE
}
