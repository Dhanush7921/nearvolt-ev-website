# Android Studio setup

1. Install Android Studio (current stable) with JDK 17+ and Android SDK Platform **37.1** (compileSdk; current Compose/AndroidX need it). The app targets **API 36** (Google Play requirement for new apps from 31 Aug 2026) with minSdk 26.
2. Open the `android/` folder. Gradle wrapper 9.9.2, AGP 9.5.3, Kotlin 2.4.21 are pinned in `gradle/libs.versions.toml`.
3. Without `google-services.json` the project still builds and unit-tests, but the app shows "App not configured". For a working app add the Firebase files: `app/src/dev/google-services.json`, `app/src/prod/google-services.json`.
4. Flavors: `dev` (`com.nearvolt.ev.dev`, API default `http://10.0.2.2:8080/` for a local backend; cleartext allowed only for that host) and `prod` (`com.nearvolt.ev`).
5. Build properties (gradle property or env var): `NV_DEV_API_BASE_URL`, `NV_PROD_API_BASE_URL`, `NV_GOOGLE_WEB_CLIENT_ID`, `NV_AUTH_LINK_HOST`.
6. Local backend: `cd backend && npm ci && npx firebase emulators:start --project demo-nearvolt --config ../firebase/firebase.json` in one terminal, then run the API against the emulators.

## Release signing
Create an upload key once (keep it and its passwords in a password manager; losing it requires a Play upload-key reset):
```
keytool -genkeypair -v -keystore ~/keys/nearvolt-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
```
Create `android/keystore.properties` (git-ignored): `storeFile=/home/you/keys/nearvolt-upload.jks`, `storePassword=…`, `keyAlias=upload`, `keyPassword=…` — or set `NV_KEYSTORE_FILE`, `NV_KEYSTORE_PASSWORD`, `NV_KEY_ALIAS`, `NV_KEY_PASSWORD` in CI. Enrol in **Play App Signing** (Google holds the app signing key; you upload with the upload key), then add the Play app-signing SHA-1/SHA-256 to Firebase.

Commands: `./gradlew testDevDebugUnitTest lintDevDebug assembleDevDebug` · `./gradlew bundleProdRelease assembleProdRelease` · outputs in `app/build/outputs/{bundle,apk}/prodRelease/`.

## Versioning
`versionName` = semantic version (1.0.0), `versionCode` = +1 for every Play upload. Raise the admin setting `latestVersionCode` to show an optional update; raise `minSupportedVersionCode` only for security/compatibility-critical fixes.
