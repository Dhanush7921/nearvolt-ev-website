package com.nearvolt.ev

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.nearvolt.ev.data.auth.AuthRepository
import com.nearvolt.ev.data.prefs.Prefs
import com.nearvolt.ev.data.repo.NearVoltRepository
import com.nearvolt.ev.location.LocationHelper
import com.nearvolt.ev.push.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers

/** Simple manual dependency container (no DI framework needed at this size). */
class AppContainer(app: Application) {
    val prefs = Prefs(app)
    val auth = AuthRepository(prefs)
    val repo = NearVoltRepository()
    val location = LocationHelper(app)
}

class NearVoltApp : Application() {
    lateinit var container: AppContainer
        private set
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        instance = this
        if (BuildConfig.FIREBASE_CONFIGURED) {
            FirebaseApp.initializeApp(this)
            val appCheck = FirebaseAppCheck.getInstance()
            if (BuildConfig.DEBUG) DebugAppCheck.install(appCheck) else appCheck.installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
            FirebaseCrashlytics.getInstance().isCrashlyticsCollectionEnabled = !BuildConfig.DEBUG
        }
        container = AppContainer(this)
        Notifications.createChannels(this)
    }

    companion object {
        lateinit var instance: NearVoltApp
            private set
    }
}
