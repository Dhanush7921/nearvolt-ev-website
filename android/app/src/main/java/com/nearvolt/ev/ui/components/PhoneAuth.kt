package com.nearvolt.ev.ui.components

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status

/** Countries the backend can verify today. Only India (+91) is supported; others are listed as "coming soon". */
data class Country(val iso: String, val dial: String, val flag: String, val name: String, val supported: Boolean)
val COUNTRIES = listOf(Country("IN", "+91", "🇮🇳", "India", true))

object PhoneRules {
    /** Indian mobile numbers: 10 digits starting 6–9. */
    fun validIndian(d: String) = d.length == 10 && d[0] in '6'..'9'
    fun digits(raw: String) = raw.filter(Char::isDigit).let { if (it.length > 10 && it.startsWith("91")) it.drop(2) else it }.take(10)
    /** "+91 ••••• •3210" — never show a full number on shared screens. */
    fun mask(e164: String?): String? {
        val d = e164?.filter(Char::isDigit) ?: return null
        if (d.length < 4) return null
        val cc = if (e164.startsWith("+91") || (d.length == 12 && d.startsWith("91"))) "+91 " else "+"
        return cc + "••••• •" + d.takeLast(4)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhoneNumberField(digits: String, onDigits: (String) -> Unit, enabled: Boolean = true) {
    var menu by remember { mutableStateOf(false) }
    val c = COUNTRIES.first()
    val err = digits.length == 10 && !PhoneRules.validIndian(digits)
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box {
            OutlinedButton(onClick = { menu = true }, enabled = enabled, modifier = Modifier.height(56.dp).padding(top = 8.dp),
                shape = RoundedCornerShape(12.dp), contentPadding = PaddingValues(horizontal = 12.dp)) { Text("${c.flag} ${c.dial}") }
            DropdownMenu(menu, { menu = false }) {
                COUNTRIES.forEach { k -> DropdownMenuItem(text = { Text("${k.flag} ${k.name} (${k.dial})") }, onClick = { menu = false }) }
                DropdownMenuItem(text = { Text("More countries coming soon", style = MaterialTheme.typography.bodySmall) }, onClick = {}, enabled = false)
            }
        }
        OutlinedTextField(digits, { onDigits(PhoneRules.digits(it)) }, Modifier.weight(1f), enabled = enabled, singleLine = true,
            label = { Text("Mobile number") }, isError = err,
            supportingText = { Text(if (err) "Indian mobile numbers start with 6, 7, 8 or 9." else "${digits.length}/10") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
    }
}

/** Six separate boxes over one hidden field (paste and keyboard autofill both work). */
@Composable
fun OtpBoxes(value: String, onValue: (String) -> Unit, error: Boolean = false, enabled: Boolean = true) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    BasicTextField(value, { onValue(it.filter(Char::isDigit).take(6)) }, enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.focusRequester(focus).semantics { contentDescription = "6-digit verification code, ${value.length} entered" },
        decorationBox = {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
                repeat(6) { i ->
                    val active = i == value.length
                    val border by animateColorAsState(when { error -> MaterialTheme.colorScheme.error; active -> MaterialTheme.colorScheme.primary; else -> MaterialTheme.colorScheme.outlineVariant }, label = "otp")
                    Box(Modifier.size(width = 46.dp, height = 56.dp).border(if (active) 2.dp else 1.dp, border, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                        Text(value.getOrNull(i)?.toString() ?: "", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                    }
                }
            }
        })
}

/**
 * Automatic OTP detection with the SMS User Consent API: no SMS permission, the user approves reading one message.
 * Works only on devices with Google Play services; typing the code always works.
 */
@Composable
fun SmsCodeAutofill(active: Boolean, onCode: (String) -> Unit) {
    val ctx = LocalContext.current
    val current by rememberUpdatedState(onCode)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK) {
            val msg = r.data?.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE).orEmpty()
            Regex("(?<!\\d)(\\d{6})(?!\\d)").find(msg)?.groupValues?.get(1)?.let(current)
        }
    }
    DisposableEffect(active) {
        if (!active) return@DisposableEffect onDispose { }
        runCatching { SmsRetriever.getClient(ctx).startSmsUserConsent(null) }
        val rx = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                if (i.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
                @Suppress("DEPRECATION") val status = i.extras?.get(SmsRetriever.EXTRA_STATUS) as? Status ?: return
                if (status.statusCode == CommonStatusCodes.SUCCESS) {
                    @Suppress("DEPRECATION") val consent = i.extras?.getParcelable<Intent>(SmsRetriever.EXTRA_CONSENT_INTENT) ?: return
                    runCatching { launcher.launch(consent) }
                }
            }
        }
        ContextCompat.registerReceiver(ctx, rx, IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION), SmsRetriever.SEND_PERMISSION, null, ContextCompat.RECEIVER_EXPORTED)
        onDispose { runCatching { ctx.unregisterReceiver(rx) } }
    }
}
