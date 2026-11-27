package com.nearvolt.ev.ui.screens

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.nearvolt.ev.R
import com.nearvolt.ev.data.api.ApiResult
import com.nearvolt.ev.data.api.Connectors
import com.nearvolt.ev.data.api.ProfileBody
import com.nearvolt.ev.data.api.Vehicle
import com.nearvolt.ev.data.api.VehicleTypes
import com.nearvolt.ev.data.auth.AuthOutcome
import com.nearvolt.ev.ui.AppViewModel
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.ui.theme.Brand
import com.nearvolt.ev.util.Labels
import com.nearvolt.ev.util.Links
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    val pages = listOf(
        Triple(Icons.Outlined.Bolt, R.string.onb1_title, R.string.onb1_body),
        Triple(Icons.Outlined.VerifiedUser, R.string.onb2_title, R.string.onb2_body),
        Triple(Icons.Outlined.Home, R.string.onb3_title, R.string.onb3_body),
    )
    val pager = rememberPagerState { pages.size }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(Brand.heroGradient).systemBarsPadding().padding(24.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.ic_launcher_foreground), null, Modifier.size(48.dp))
            Text("NEARVOLT EV", style = MaterialTheme.typography.titleLarge, color = Brand.Mint)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onDone) { Text(stringResource(R.string.action_skip), color = Brand.Mint) }
        }
        HorizontalPager(pager, Modifier.weight(1f)) { i ->
            val (icon, t, b) = pages[i]
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
                Box(Modifier.size(84.dp).clip(CircleShape).background(Brand.Mint.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) { Icon(icon, null, Modifier.size(40.dp), tint = Brand.Sage) }
                Spacer(Modifier.height(28.dp))
                Text(stringResource(t), style = MaterialTheme.typography.displaySmall, color = Color.White)
                Spacer(Modifier.height(12.dp))
                Text(stringResource(b), style = MaterialTheme.typography.bodyLarge, color = Brand.Mint.copy(alpha = 0.86f))
            }
        }
        Row(Modifier.padding(vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            repeat(pages.size) { i -> Box(Modifier.height(6.dp).width(if (pager.currentPage == i) 28.dp else 10.dp).clip(CircleShape).background(if (pager.currentPage == i) Brand.Sage else Brand.Mint.copy(alpha = 0.3f))) }
        }
        Button(onClick = { if (pager.currentPage < pages.lastIndex) scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } else onDone() },
            modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp), colors = ButtonDefaults.buttonColors(containerColor = Brand.Mint, contentColor = Brand.Forest)) {
            Text(stringResource(if (pager.currentPage < pages.lastIndex) R.string.action_next else R.string.action_get_started))
        }
    }
}

@Composable
fun SignInScreen(vm: AppViewModel) {
    val ctx = LocalContext.current
    val state by vm.state.collectAsStateWithLifecycle()
    val phoneEnabled = state.config?.featureFlags?.get("phoneLogin") == true
    var mode by remember { mutableStateOf("choose") } // choose | email | emailSent | phone | otp
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var registering by remember { mutableStateOf(false) }
    var phone by remember { mutableStateOf("") }
    var otp by remember { mutableStateOf("") }
    var resendIn by remember { mutableIntStateOf(0) }
    var otpExpiresIn by remember { mutableIntStateOf(0) }
    LaunchedEffect(otpExpiresIn) { if (otpExpiresIn > 0) { delay(1000); otpExpiresIn-- } }
    val scope = rememberCoroutineScope()
    LaunchedEffect(resendIn) { if (resendIn > 0) { delay(1000); resendIn-- } }
    LaunchedEffect(state.message) { state.message?.let { error = it; vm.consumeMessage() } }

    fun sendOtp() = scope.launch {
        busy = true; error = null
        when (val r = vm.container.auth.sendOtp("+91$phone")) { is ApiResult.Ok -> { mode = "otp"; otp = ""; resendIn = r.value.resendAfterSeconds; otpExpiresIn = r.value.expiresInSeconds }; is ApiResult.Err -> error = r.message }
        busy = false
    }

    Column(Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Box(Modifier.fillMaxWidth().clip(MaterialTheme.shapes.large).background(com.nearvolt.ev.ui.theme.Brand.heroGradient).padding(vertical = 20.dp), contentAlignment = Alignment.Center) {
            com.nearvolt.ev.ui.components.LogoReveal(size = 72.dp)
        }
        Spacer(Modifier.height(24.dp))
        Text(stringResource(R.string.signin_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.signin_body), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(28.dp))
        AnimatedContent(mode, label = "signin") { m ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when (m) {
                    "choose" -> {
                        PrimaryButton(stringResource(R.string.signin_google), { busy = true; error = null; vm.google(ctx as Activity) { busy = false; error = it } }, loading = busy)
                        SecondaryButton(stringResource(R.string.signin_email), { mode = "email" }, icon = Icons.Outlined.Email)
                        // Phone OTP stays behind the server feature flag until an approved SMS provider exists.
                        val phoneUnavailable = stringResource(R.string.signin_phone_unavailable)
                        SecondaryButton(stringResource(R.string.signin_phone), { if (phoneEnabled) mode = "phone" else error = phoneUnavailable }, icon = Icons.Outlined.Phone)
                    }
                    "email" -> {
                        OutlinedTextField(email, { email = it.trim() }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.field_email)) }, singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                        OutlinedTextField(password, { password = it.take(128) }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.field_password)) }, singleLine = true,
                            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            supportingText = { if (registering) Text(stringResource(R.string.password_rule)) })
                        val emailOk = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$").matches(email)
                        val pwOk = if (registering) password.length >= 8 && password.any(Char::isDigit) && password.any(Char::isLetter) else password.isNotEmpty()
                        PrimaryButton(stringResource(if (registering) R.string.signin_create_account else R.string.signin_with_password), {
                            busy = true; error = null
                            vm.emailAuth(registering, email, password) { busy = false; error = it }
                        }, enabled = emailOk && pwOk, loading = busy)
                        TextButton(onClick = { registering = !registering; error = null }) { Text(stringResource(if (registering) R.string.signin_have_account else R.string.signin_new_account)) }
                        if (!registering) TextButton(onClick = {
                            if (!emailOk) { error = "Enter your email address first." } else { busy = true; error = null; vm.resetPassword(email) { busy = false; if (it == null) mode = "emailSent" else error = it } }
                        }) { Text(stringResource(R.string.signin_forgot)) }
                        TextButton(onClick = { mode = "choose" }) { Text(stringResource(R.string.action_back)) }
                    }
                    "emailSent" -> {
                        NvCard { Icon(Icons.Outlined.MarkEmailRead, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.height(8.dp))
                            Text(stringResource(R.string.signin_reset_sent, email), style = MaterialTheme.typography.bodyLarge) }
                        TextButton(onClick = { mode = "email" }) { Text(stringResource(R.string.action_back)) }
                    }
                    "phone" -> {
                        com.nearvolt.ev.ui.components.PhoneNumberField(phone, { phone = it; error = null }, enabled = !busy)
                        Text(stringResource(R.string.signin_sms_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        PrimaryButton(stringResource(R.string.signin_send_code), { sendOtp() }, enabled = com.nearvolt.ev.ui.components.PhoneRules.validIndian(phone), loading = busy)
                        TextButton(onClick = { mode = "choose"; error = null }) { Text(stringResource(R.string.action_back)) }
                    }
                    "otp" -> {
                        val verify: () -> Unit = {
                            scope.launch { busy = true; error = null
                                when (val o = vm.container.auth.verifyOtp("+91$phone", otp)) { is AuthOutcome.Failed -> { error = o.message; otp = "" }; else -> Unit }
                                busy = false }
                        }
                        Text(stringResource(R.string.signin_code_sent_to, com.nearvolt.ev.ui.components.PhoneRules.mask("+91$phone").orEmpty()), style = MaterialTheme.typography.bodyMedium)
                        com.nearvolt.ev.ui.components.SmsCodeAutofill(active = otpExpiresIn > 0) { code -> otp = code }
                        com.nearvolt.ev.ui.components.OtpBoxes(otp, { otp = it; error = null }, error = error != null, enabled = !busy && otpExpiresIn > 0)
                        Text(if (otpExpiresIn > 0) stringResource(R.string.signin_code_expires_in, otpExpiresIn / 60, otpExpiresIn % 60) else stringResource(R.string.signin_code_expired),
                            style = MaterialTheme.typography.bodySmall, color = if (otpExpiresIn > 0) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
                        PrimaryButton(stringResource(R.string.signin_verify), verify, enabled = otp.length == 6 && otpExpiresIn > 0, loading = busy)
                        TextButton(onClick = { sendOtp() }, enabled = resendIn == 0 && !busy) {
                            Text(if (resendIn > 0) stringResource(R.string.signin_resend_in, resendIn) else stringResource(R.string.signin_resend))
                        }
                        TextButton(onClick = { mode = "phone"; otp = ""; error = null }) { Text(stringResource(R.string.signin_change_number)) }
                    }
                }
            }
        }
        InlineMessage(error)
        Spacer(Modifier.height(24.dp))
        Text(stringResource(R.string.signin_legal), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row { TextButton(onClick = { Links.open(ctx, Links.TERMS) }) { Text(stringResource(R.string.link_terms)) }; TextButton(onClick = { Links.open(ctx, Links.PRIVACY) }) { Text(stringResource(R.string.link_privacy)) } }
    }
}

@Composable
fun VerifyEmailScreen(vm: AppViewModel) {
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }
    var isError by remember { mutableStateOf(true) }
    val email = vm.container.auth.currentUser?.email.orEmpty()
    Column(Modifier.fillMaxSize().systemBarsPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Spacer(Modifier.height(24.dp))
        Icon(Icons.Outlined.MarkEmailUnread, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Text(stringResource(R.string.verify_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.verify_body, email), style = MaterialTheme.typography.bodyLarge)
        InlineMessage(msg, isError)
        PrimaryButton(stringResource(R.string.verify_done), { busy = true; msg = null
            vm.checkVerified { ok -> busy = false; if (!ok) { isError = true; msg = "Not verified yet. Open the link in the email, then tap again." } } }, loading = busy)
        SecondaryButton(stringResource(R.string.verify_resend), { vm.resendVerification { e -> isError = e != null; msg = e ?: "Verification email sent." } })
        TextButton(onClick = { vm.signOut() }) { Text(stringResource(R.string.action_sign_out)) }
    }
}

@Composable
fun ConsentScreen(vm: AppViewModel) {
    val ctx = LocalContext.current
    var terms by remember { mutableStateOf(false) }
    var location by remember { mutableStateOf(true) }
    var notifications by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    Column(Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.consent_title), style = MaterialTheme.typography.headlineMedium)
        NvCard {
            Text(stringResource(R.string.consent_role_title), style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(6.dp))
            Text(stringResource(R.string.consent_role_body), style = MaterialTheme.typography.bodyMedium)
        }
        NvCard {
            Text(stringResource(R.string.consent_data_title), style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(6.dp))
            Text(stringResource(R.string.consent_data_body), style = MaterialTheme.typography.bodyMedium)
            Row { TextButton(onClick = { Links.open(ctx, Links.TERMS) }) { Text(stringResource(R.string.link_terms)) }; TextButton(onClick = { Links.open(ctx, Links.PRIVACY) }) { Text(stringResource(R.string.link_privacy)) } }
        }
        CheckRow(terms, { terms = it }, stringResource(R.string.consent_terms_check))
        CheckRow(location, { location = it }, stringResource(R.string.consent_location_check))
        CheckRow(notifications, { notifications = it }, stringResource(R.string.consent_notif_check))
        InlineMessage(error)
        PrimaryButton(stringResource(R.string.action_continue), {
            busy = true; error = null
            if (notifications && Build.VERSION.SDK_INT >= 33) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            vm.acceptConsents(location, notifications) { busy = false; error = it }
        }, enabled = terms, loading = busy)
        TextButton(onClick = { vm.signOut() }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text(stringResource(R.string.action_sign_out)) }
    }
}

@Composable
fun SetupScreen(vm: AppViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val me = state.me
    var role by remember { mutableStateOf(me?.role ?: "customer") }
    var name by remember { mutableStateOf(me?.name.orEmpty()) }
    var vehicleType by remember { mutableStateOf(me?.vehicle?.type ?: "car") }
    var connector by remember { mutableStateOf(me?.vehicle?.connector ?: "TYPE2_AC") }
    var model by remember { mutableStateOf(me?.vehicle?.model.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.setup_title), style = MaterialTheme.typography.headlineMedium)
        if (me?.role == null) {
            Text(stringResource(R.string.setup_role_q), style = MaterialTheme.typography.titleMedium)
            RoleCard(Icons.Outlined.ElectricCar, stringResource(R.string.role_customer), stringResource(R.string.role_customer_body), role == "customer") { role = "customer" }
            RoleCard(Icons.Outlined.Home, stringResource(R.string.role_host), stringResource(R.string.role_host_body), role == "host") { role = "host" }
            Text(stringResource(R.string.setup_role_locked), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        OutlinedTextField(name, { name = it.take(80) }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.field_name)) }, singleLine = true)
        Text(stringResource(R.string.setup_vehicle), style = MaterialTheme.typography.titleMedium)
        VehicleFields(vehicleType, { vehicleType = it }, connector, { connector = it })
        OutlinedTextField(model, { model = it.take(80) }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.field_model_optional)) }, singleLine = true)
        InlineMessage(error)
        PrimaryButton(stringResource(R.string.action_save_continue), {
            busy = true; error = null
            vm.completeSetup(role, ProfileBody(name.trim(), Vehicle(vehicleType, model.trim().ifBlank { null }, connector))) { busy = false; error = it }
        }, enabled = name.trim().length >= 2, loading = busy)
    }
}

@Composable
private fun RoleCard(icon: ImageVector, title: String, body: String, selected: Boolean, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer),
        border = if (selected) androidx.compose.foundation.BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) { Text(title, style = MaterialTheme.typography.titleMedium); Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            RadioButton(selected = selected, onClick = null)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VehicleFields(type: String, onType: (String) -> Unit, connector: String, onConnector: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        VehicleTypes.ALL.forEach { t -> FilterChip(selected = type == t, onClick = { onType(t) }, label = { Text(Labels.vehicle(t)) }) }
    }
    ConnectorPicker(connector, onConnector)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectorPicker(value: String?, onChange: (String) -> Unit, allowAny: Boolean = false) {
    var open by remember { mutableStateOf(false) }
    val anyLabel = stringResource(R.string.filter_any_connector)
    ExposedDropdownMenuBox(open, { open = it }) {
        OutlinedTextField(value?.let { Labels.connector(it) } ?: anyLabel, {}, readOnly = true, label = { Text(stringResource(R.string.field_connector)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) }, modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable))
        ExposedDropdownMenu(open, { open = false }) {
            if (allowAny) DropdownMenuItem(text = { Text(anyLabel) }, onClick = { onChange(""); open = false })
            Connectors.ALL.forEach { c -> DropdownMenuItem(text = { Text(Labels.connector(c)) }, onClick = { onChange(c); open = false }) }
        }
    }
}

/** Cinematic launch screen shown while configuration loads (also covers a Render cold start, which can take ~1 minute). */
@Composable
fun SplashScreen() {
    var slow by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(6_000); slow = true }
    Box(Modifier.fillMaxSize().background(com.nearvolt.ev.ui.theme.Brand.heroGradient), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            com.nearvolt.ev.ui.components.LogoReveal(size = 112.dp, loop = true)
            Spacer(Modifier.height(8.dp))
            Text("NEARVOLT EV", style = MaterialTheme.typography.headlineMedium, color = com.nearvolt.ev.ui.theme.Brand.Mint)
            Text(stringResource(R.string.splash_tagline), style = MaterialTheme.typography.bodyMedium, color = com.nearvolt.ev.ui.theme.Brand.Sage)
            Spacer(Modifier.height(28.dp))
            com.nearvolt.ev.ui.components.EnergyFlowBar(Modifier.width(160.dp), 4.dp)
            if (slow) { Spacer(Modifier.height(14.dp)); Text(stringResource(R.string.splash_waking), style = MaterialTheme.typography.bodySmall, color = com.nearvolt.ev.ui.theme.Brand.Sage) }
        }
    }
}
