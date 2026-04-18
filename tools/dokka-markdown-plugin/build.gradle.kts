plugins {
    kotlin("jvm") version "2.3.0"
    `maven-publish`
    `java-gradle-plugin`
}

gradlePlugin {
    plugins {
        create("dokkaMarkdown") {
            id = "com.androidcommondoc.dokka-markdown"
            implementationClass = "com.androidcommondoc.dokka.markdown.StructuredMarkdownPlugin"
        }
    }
}

// Maven Central only — no plugins.gradle.org needed (corporate SSL proxy constraint).
repositories {
    mavenCentral()
}

dependencies {
    compileOnly("org.jetbrains.dokka:dokka-core:2.2.0")
    compileOnly("org.jetbrains.dokka:dokka-base:2.2.0")

    testImplementation(kotlin("test-junit5"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
    testImplementation("org.jetbrains.dokka:dokka-core:2.2.0")
    testImplementation("org.jetbrains.dokka:dokka-base:2.2.0")
    testImplementation(gradleTestKit())
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
    // L0 rule: sequential on Windows to avoid file-lock races between JVM forks
    maxParallelForks = 1
    forkEvery = 1
    systemProperty("pluginJarDir", layout.buildDirectory.dir("libs").get().asFile.absolutePath)
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            groupId = "com.androidcommondoc"
            artifactId = "dokka-markdown-plugin"
            from(components["java"])
        }
    }
    repositories {
        maven {
            name = "GitHubPackages"
            url = uri("https://maven.pkg.github.com/oscardlfr/AndroidCommonDoc")
            credentials {
                username = System.getenv("GITHUB_ACTOR")
                password = System.getenv("GITHUB_TOKEN")
            }
        }
    }
}
