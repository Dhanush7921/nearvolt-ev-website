import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Firebase config files are environment-specific and not committed. Apply the plugins only when present,
// so the project still opens and unit-tests in Android Studio before Firebase is configured.
val hasGoogleServices = listOf("google-services.json", "src/dev/google-services.json", "src/prod/google-services.json")
    .any { file(it).exists() }
if (hasGoogleServices) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
    apply(plugin = libs.plugins.crashlytics.get().pluginId)
}

// Release signing: keystore.properties (local, git-ignored) or CI environment variables. Never committed.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(key: String, env: String): String? = keystoreProps.getProperty(key) ?: System.getenv(env)
val hasReleaseSigning = signingValue("storeFile", "NV_KEYSTORE_FILE") != null

fun prop(name: String, default: String = ""): String = (project.findProperty(name) as String?) ?: System.getenv(name) ?: default

android {
    namespace = "com.nearvolt.ev"
    compileSdk {
        version = release(37) { minorApiLevel = 1 }
    }

    defaultConfig {
        applicationId = "com.nearvolt.ev"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Google sign-in needs the OAuth *web* client ID from the Firebase project.
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"${prop("NV_GOOGLE_WEB_CLIENT_ID")}\"")
        buildConfigField("boolean", "FIREBASE_CONFIGURED", hasGoogleServices.toString())
        // Host used for passwordless email links (Firebase Hosting domain; Dynamic Links are not used).
        manifestPlaceholders["authLinkHost"] = prop("NV_AUTH_LINK_HOST", "nearvolt-ev-prod.firebaseapp.com")
        buildConfigField("String", "AUTH_LINK_HOST", "\"${prop("NV_AUTH_LINK_HOST", "nearvolt-ev-prod.firebaseapp.com")}\"")
        androidResources.localeFilters += listOf("en", "te", "hi")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(signingValue("storeFile", "NV_KEYSTORE_FILE")!!)
                storePassword = signingValue("storePassword", "NV_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "NV_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "NV_KEY_PASSWORD")
            }
        }
    }

    flavorDimensions += "env"
    productFlavors {
        create("dev") {
            dimension = "env"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            // Defaults to the hosted API so the dev build works on a real phone; set NV_DEV_API_BASE_URL=http://10.0.2.2:8080/ for a local backend on the emulator.
            buildConfigField("String", "API_BASE_URL", "\"${prop("NV_DEV_API_BASE_URL", prop("NV_PROD_API_BASE_URL", "https://api.invalid/"))}\"")
            resValue("string", "app_name", "NEARVOLT Dev")
        }
        create("prod") {
            dimension = "env"
            buildConfigField("String", "API_BASE_URL", "\"${prop("NV_PROD_API_BASE_URL", "https://api.invalid/")}\"")
            resValue("string", "app_name", "NEARVOLT EV")
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
        resValues = true
    }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
    testOptions { unitTests.isReturnDefaultValues = true }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = false
    }
}

// Guard: a production release must point at a real HTTPS backend.
tasks.matching { it.name.startsWith("assembleProdRelease") || it.name.startsWith("bundleProdRelease") }.configureEach {
    doFirst {
        val url = prop("NV_PROD_API_BASE_URL")
        require(url.startsWith("https://") && !url.contains("invalid")) { "Set NV_PROD_API_BASE_URL to the deployed Cloud Run HTTPS URL before building a prod release." }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons.extended)
    implementation(libs.credentials)
    implementation(libs.credentials.play)
    implementation(libs.googleid)
    implementation(libs.play.location)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.crashlytics)
    implementation(libs.firebase.appcheck.playintegrity)
    debugImplementation(libs.firebase.appcheck.debug)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.play)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.espresso)
    androidTestImplementation(libs.compose.ui.test.junit4)
}
