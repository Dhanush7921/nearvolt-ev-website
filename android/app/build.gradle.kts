import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Firebase config files are environment-specific and not committed (git-ignored).
// Each flavor uses src/<flavor>/google-services.json, falling back to app/google-services.json.
fun googleServicesFor(flavor: String): File? = listOf("src/$flavor/google-services.json", "google-services.json").map { file(it) }.firstOrNull { it.exists() }
data class FirebaseInfo(val projectId: String, val webClientId: String)
fun firebaseInfo(flavor: String): FirebaseInfo? {
    val f = googleServicesFor(flavor) ?: return null
    @Suppress("UNCHECKED_CAST")
    val json = groovy.json.JsonSlurper().parse(f) as Map<String, Any?>
    val projectId = (json["project_info"] as Map<String, Any?>)["project_id"] as String
    // OAuth *web* client (client_type 3) is what Credential Manager needs as serverClientId.
    val webClient = (json["client"] as List<Map<String, Any?>>).flatMap { (it["oauth_client"] as? List<Map<String, Any?>>).orEmpty() }
        .firstOrNull { (it["client_type"] as? Number)?.toInt() == 3 }?.get("client_id") as? String
    return FirebaseInfo(projectId, webClient.orEmpty())
}
val firebaseByFlavor = mapOf("dev" to firebaseInfo("dev"), "prod" to firebaseInfo("prod"))
if (firebaseByFlavor.values.any { it != null }) {
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
        versionCode = 5
        versionName = "1.3.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Google sign-in needs the OAuth *web* client ID from the Firebase project.
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
            firebaseByFlavor["dev"].let { fb ->
                buildConfigField("boolean", "FIREBASE_CONFIGURED", (fb != null).toString())
                buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${fb?.projectId.orEmpty()}\"")
                buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"${prop("NV_GOOGLE_WEB_CLIENT_ID", fb?.webClientId.orEmpty())}\"")
                // Auth link host is derived from the Firebase project (<project_id>.firebaseapp.com) unless overridden.
                val host = prop("NV_AUTH_LINK_HOST", fb?.let { "${it.projectId}.firebaseapp.com" } ?: "nearvolt-ev.firebaseapp.com")
                manifestPlaceholders["authLinkHost"] = host
                buildConfigField("String", "AUTH_LINK_HOST", "\"$host\"")
            }
            dimension = "env"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            // Defaults to the hosted API so the dev build works on a real phone; set NV_DEV_API_BASE_URL=http://10.0.2.2:8080/ for a local backend on the emulator.
            buildConfigField("String", "API_BASE_URL", "\"${prop("NV_DEV_API_BASE_URL", prop("NV_PROD_API_BASE_URL", "https://api.invalid/"))}\"")
            resValue("string", "app_name", "NEARVOLT Dev")
        }
        create("prod") {
            firebaseByFlavor["prod"].let { fb ->
                buildConfigField("boolean", "FIREBASE_CONFIGURED", (fb != null).toString())
                buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${fb?.projectId.orEmpty()}\"")
                buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"${prop("NV_GOOGLE_WEB_CLIENT_ID", fb?.webClientId.orEmpty())}\"")
                // Auth link host is derived from the Firebase project (<project_id>.firebaseapp.com) unless overridden.
                val host = prop("NV_AUTH_LINK_HOST", fb?.let { "${it.projectId}.firebaseapp.com" } ?: "nearvolt-ev.firebaseapp.com")
                manifestPlaceholders["authLinkHost"] = host
                buildConfigField("String", "AUTH_LINK_HOST", "\"$host\"")
            }
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
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
        // V1.3: a dependency (MapLibre) ships 32-bit x86 libs. We don't support x86 (no split for it); excluding it keeps the
        // universal APK to exactly the three published ABIs (arm64-v8a, armeabi-v7a, x86_64) instead of four.
        jniLibs { excludes += "lib/x86/**" }
    }
    // Telugu/Hindi drafts (pending native-speaker review) are compiled only on request. Safety/legal strings need a
    // separate sign-off flag; without it they fall back to English even when the general drafts are enabled.
    sourceSets.getByName("main") {
        if (prop("NV_I18N_DRAFT") == "true") res.srcDir("src/i18nDraft/res")
        if (prop("NV_I18N_SAFETY_REVIEWED") == "true") res.srcDir("src/i18nSafety/res")
    }
    if (prop("NV_UI_TESTS") == "true") sourceSets.getByName("test") { java.srcDir("src/testUi/java") }
    // MapLibre ships native code for every ABI. Per-ABI APKs keep sideload downloads small; a universal APK is still produced.
    splits { abi { isEnable = true; reset(); include("arm64-v8a", "armeabi-v7a", "x86_64"); isUniversalApk = true } }
    testOptions { unitTests.isReturnDefaultValues = true; unitTests.isIncludeAndroidResources = true }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = false
    }
}

// Flavors without a config file skip google-services processing (prod is guarded below and can never skip it).
tasks.matching { it.name.matches(Regex("process(Dev|Prod)\\w*GoogleServices")) }.configureEach {
    val flavor = if (name.startsWith("processDev")) "dev" else "prod"
    enabled = firebaseByFlavor[flavor] != null
}

// Guard: every prod build (debug or release, APK or AAB, assemble or install) must carry the real Firebase config.
// Values are computed at configuration time so the task actions stay configuration-cache safe.
val prodConfigError: String? = firebaseByFlavor["prod"].let { fb ->
    when {
        fb == null -> "Missing android/app/src/prod/google-services.json. Download it from Firebase console (project nearvolt-ev) before building prod."
        fb.webClientId.isBlank() && prop("NV_GOOGLE_WEB_CLIENT_ID").isBlank() ->
            "google-services.json has no OAuth web client (client_type 3). Enable Google sign-in in Firebase Auth, add SHA-1/SHA-256, and re-download it."
        else -> null
    }
}
tasks.matching { Regex("^(assemble|bundle|install|package)Prod").containsMatchIn(it.name) }.configureEach {
    val err = prodConfigError
    doFirst { if (err != null) throw GradleException(err) }
}

// Guard: a production release must point at a real HTTPS backend.
val prodApiUrlOk = prop("NV_PROD_API_BASE_URL").let { it.startsWith("https://") && !it.contains("invalid") }
tasks.matching { it.name.startsWith("assembleProdRelease") || it.name.startsWith("bundleProdRelease") }.configureEach {
    val ok = prodApiUrlOk
    doFirst { if (!ok) throw GradleException("Set NV_PROD_API_BASE_URL to the deployed HTTPS API URL before building a prod release.") }
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
    implementation(libs.maplibre)
    implementation(libs.play.sms.api)
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
    // JVM Compose UI tests (src/testUi) via Robolectric, opt-in with -PNV_UI_TESTS=true: they download ~100 MB of
    // Android runtime jars on first run, so ordinary unit-test runs stay fast and offline-friendly.
    if (prop("NV_UI_TESTS") == "true") {
        testImplementation(libs.robolectric)
        testImplementation(platform(libs.compose.bom))
        testImplementation(libs.compose.ui.test.junit4)
    }
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.espresso)
    androidTestImplementation(libs.compose.ui.test.junit4)
}
