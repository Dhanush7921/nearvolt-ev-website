package com.nearvolt.ev

import com.google.firebase.appcheck.FirebaseAppCheck

/** Release builds never include the debug provider. */
object DebugAppCheck {
    @Suppress("UNUSED_PARAMETER") fun install(appCheck: FirebaseAppCheck) = Unit
}
