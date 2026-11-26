package com.nearvolt.ev.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.nearvolt.ev.BuildConfig
import com.nearvolt.ev.R
import com.nearvolt.ev.ui.components.CenterState
import com.nearvolt.ev.ui.components.PrimaryButton
import com.nearvolt.ev.ui.screens.ConsentScreen
import com.nearvolt.ev.ui.screens.MainScreen
import com.nearvolt.ev.ui.screens.OnboardingScreen
import com.nearvolt.ev.ui.screens.SetupScreen
import com.nearvolt.ev.ui.screens.SignInScreen
import com.nearvolt.ev.ui.theme.NearVoltTheme

@Composable
fun NearVoltRoot(vm: AppViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    NearVoltTheme(s.theme) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            AnimatedContent(s.phase, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "phase") { phase ->
                when (phase) {
                    Phase.Loading -> Box(Modifier.fillMaxSize())
                    Phase.NotConfigured -> Gate(stringResource(R.string.gate_config_title), stringResource(R.string.gate_config_body), null, null)
                    Phase.UpdateRequired -> UpdateGate()
                    Phase.Maintenance -> Gate(stringResource(R.string.gate_maintenance_title), s.config?.maintenance?.message?.ifBlank { null } ?: stringResource(R.string.gate_maintenance_body), stringResource(R.string.action_retry)) { vm.refresh() }
                    Phase.Error -> Column(Modifier.fillMaxSize()) {
                        Box(Modifier.weight(1f)) { Gate(stringResource(R.string.state_error_title), s.message ?: stringResource(R.string.state_error_body), stringResource(R.string.action_retry)) { vm.refresh() } }
                        if (vm.container.auth.currentUser != null) TextButton(onClick = { vm.signOut() }, modifier = Modifier.align(Alignment.CenterHorizontally).navigationBarsPadding().padding(bottom = 16.dp)) { Text(stringResource(R.string.action_sign_out)) }
                    }
                    Phase.Onboarding -> OnboardingScreen(onDone = vm::finishOnboarding)
                    Phase.SignIn -> SignInScreen(vm)
                    Phase.VerifyEmail -> com.nearvolt.ev.ui.screens.VerifyEmailScreen(vm)
                    Phase.Consent -> ConsentScreen(vm)
                    Phase.Setup -> SetupScreen(vm)
                    Phase.Main -> MainScreen(vm)
                }
            }
            s.emailLinkNeedsEmail?.let { link -> EmailConfirmDialog(onConfirm = { vm.completeLink(link, it) }) }
        }
    }
}

@Composable
private fun Gate(title: String, body: String, action: String?, onAction: (() -> Unit)?) {
    Column(Modifier.fillMaxSize().systemBarsPadding().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Image(painterResource(R.drawable.ic_brand_mark), null, Modifier.size(72.dp))
        Spacer(Modifier.height(16.dp))
        CenterState(Icons.Outlined.Build, title, body, action, onAction)
    }
}

@Composable
private fun UpdateGate() {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxSize().systemBarsPadding().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        CenterState(Icons.Outlined.SystemUpdate, stringResource(R.string.gate_update_title), stringResource(R.string.gate_update_body))
        PrimaryButton(stringResource(R.string.action_update), {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=${BuildConfig.APPLICATION_ID}")))
        })
    }
}

@Composable
private fun EmailConfirmDialog(onConfirm: (String) -> Unit) {
    var email by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = {}, title = { Text(stringResource(R.string.email_confirm_title)) },
        text = { Column { Text(stringResource(R.string.email_confirm_body)); Spacer(Modifier.height(8.dp)); OutlinedTextField(email, { email = it.trim() }, singleLine = true, label = { Text(stringResource(R.string.field_email)) }) } },
        confirmButton = { TextButton(onClick = { onConfirm(email) }, enabled = email.contains('@')) { Text(stringResource(R.string.action_continue)) } })
}
