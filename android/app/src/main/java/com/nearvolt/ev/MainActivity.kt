package com.nearvolt.ev

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.nearvolt.ev.push.Notifications
import com.nearvolt.ev.ui.AppViewModel
import com.nearvolt.ev.ui.NearVoltRoot

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { vm.state.value.loading }
        enableEdgeToEdge()
        handle(intent)
        setContent { NearVoltRoot(vm) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        intent ?: return
        intent.getStringExtra(Notifications.EXTRA_REQUEST_ID)?.let { vm.openRequest(it) }
        intent.data?.toString()?.let { if (vm.container.auth.isEmailLink(it)) vm.onEmailLink(it) }
    }
}
