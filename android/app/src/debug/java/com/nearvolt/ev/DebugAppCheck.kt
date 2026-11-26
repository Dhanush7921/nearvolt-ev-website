package com.nearvolt.ev

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/** Debug builds use the App Check debug provider (register the logged debug token in the Firebase console). */
object DebugAppCheck {
    fun install(appCheck: FirebaseAppCheck) = appCheck.installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
}
