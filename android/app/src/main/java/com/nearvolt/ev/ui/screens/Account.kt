package com.nearvolt.ev.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nearvolt.ev.BuildConfig
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import com.nearvolt.ev.data.api.*
import com.nearvolt.ev.data.auth.AuthOutcome
import com.nearvolt.ev.ui.AppViewModel
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.util.Links
import com.nearvolt.ev.util.Time
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class NotificationsViewModel : ViewModel() {
    private val repo = NearVoltApp.instance.container.repo
    val items = MutableStateFlow<List<AppNotification>>(emptyList()); val error = MutableStateFlow<ApiResult.Err?>(null); val loading = MutableStateFlow(true)
    fun load() = viewModelScope.launch {
        loading.value = true
        when (val r = repo.notifications()) { is ApiResult.Ok -> { items.value = r.value.items; error.value = null }; is ApiResult.Err -> error.value = r }
        loading.value = false
    }
    fun readAll() = viewModelScope.launch { repo.readAll(); load() }
}

@Composable
fun NotificationsScreen(open: (String) -> Unit, vm: NotificationsViewModel = viewModel()) {
    val items by vm.items.collectAsStateWithLifecycle(); val err by vm.error.collectAsStateWithLifecycle(); val loading by vm.loading.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.load() }
    var cat by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("all") }
    fun catOf(t: String) = when { t.contains("safety") -> "safety"; t.startsWith("request") -> "requests"; t.startsWith("account") || t.startsWith("host") -> "account"; else -> "system" }
    val shown = if (cat == "all") items else items.filter { catOf(it.type) == cat }
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(listOf("all" to R.string.filter_all, "requests" to R.string.alerts_cat_requests, "account" to R.string.alerts_cat_account, "safety" to R.string.alerts_cat_safety, "system" to R.string.alerts_cat_system), key = { it.first }) { (k, l) ->
                    FilterChip(cat == k, { cat = k }, label = { Text(stringResource(l)) }) }
            }
        }
        item {
            HeroHeader(stringResource(R.string.alerts_title), items.count { !it.read }.let { n -> androidx.compose.ui.res.pluralStringResource(R.plurals.alerts_hero_sub, n, n) })
            if (items.any { !it.read }) TextButton(onClick = vm::readAll) { Text(stringResource(R.string.alerts_read_all)) }
        }
        when {
            err != null && items.isEmpty() -> item { ErrorState(err!!) { vm.load() } }
            loading && items.isEmpty() -> item { LoadingState() }
            items.isEmpty() -> item { EmptyState(stringResource(R.string.alerts_empty_title), stringResource(R.string.alerts_empty_body)) }
            else -> items(shown, key = { it.id }) { n ->
                NvCard(onClick = n.requestId?.let { id -> { open(id) } }, modifier = Modifier.animateItem()) {
                    Row(verticalAlignment = Alignment.Top) {
                        val (ic, tone) = when {
                            n.type.contains("rejected") || n.type.contains("expired") || n.type.contains("cancel") || n.type.contains("dispute") -> Icons.Outlined.ErrorOutline to Tone.Bad
                            n.type.contains("new") -> Icons.Outlined.NotificationsActive to Tone.Warn
                            n.type.startsWith("request") -> Icons.Outlined.ElectricBolt to Tone.Good
                            else -> Icons.Outlined.Campaign to Tone.Neutral
                        }
                        LeadingBadge(ic, tone)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(n.title, style = MaterialTheme.typography.titleSmall, fontWeight = if (n.read) FontWeight.Normal else FontWeight.Bold)
                            Text(n.body, style = MaterialTheme.typography.bodyMedium)
                            Text(Time.ago(n.at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (!n.read) Box(Modifier.padding(top = 6.dp).size(8.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
                    }
                }
            }
        }
    }
}

@Composable
fun AccountScreen(app: AppViewModel, openSupport: () -> Unit, openGarage: () -> Unit = {}, openFavourites: () -> Unit = {}, openSafety: () -> Unit = {}) {
    val s by app.state.collectAsStateWithLifecycle()
    val me = s.me ?: return
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = NearVoltApp.instance.container
    var editing by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var linkPhone by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.account_title), style = MaterialTheme.typography.headlineMedium)
        NvCard {
            Box(Modifier.size(64.dp).background(androidx.compose.ui.graphics.Brush.sweepGradient(listOf(com.nearvolt.ev.ui.theme.Brand.NeonMint, MaterialTheme.colorScheme.primary, com.nearvolt.ev.ui.theme.Brand.NeonMint)), CircleShape).padding(3.dp)
                .background(MaterialTheme.colorScheme.primaryContainer, CircleShape), contentAlignment = Alignment.Center) {
                Text(me.name.split(' ').filter(String::isNotBlank).take(2).joinToString("") { it.take(1).uppercase() }, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Spacer(Modifier.height(10.dp))
            Text(me.name, style = MaterialTheme.typography.titleLarge)
            Text(listOfNotNull(me.email, com.nearvolt.ev.ui.components.PhoneRules.mask(me.phone)).joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (me.canDrive) StatusPill(stringResource(R.string.role_customer), Tone.Good)
                if (me.canHost) StatusPill(stringResource(R.string.role_host), Tone.Good)
            }
            TextButton(onClick = { editing = true }) { Text(stringResource(R.string.account_edit)) }
        }
        if (me.phone == null && s.config?.featureFlags?.get("phoneLogin") == true) SecondaryButton(stringResource(R.string.account_link_phone), { linkPhone = true }, icon = Icons.Outlined.Phone)
        ModeSwitch(app)
        if (!s.hostMode && me.canDrive) {
            SecondaryButton(stringResource(R.string.garage_title), openGarage, icon = Icons.Outlined.DirectionsCar)
            SecondaryButton(stringResource(R.string.fav_title), openFavourites, icon = Icons.Outlined.FavoriteBorder)
        }
        SecondaryButton(stringResource(R.string.safety_centre), openSafety, icon = Icons.Outlined.Shield)
        SectionTitle(stringResource(R.string.account_appearance))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("system" to R.string.theme_system, "light" to R.string.theme_light, "dark" to R.string.theme_dark).forEach { (k, l) -> FilterChip(s.theme == k, { app.setTheme(k) }, label = { Text(stringResource(l)) }) }
        }
        val graphics by c.prefs.graphics.collectAsStateWithLifecycle("adaptive")
        SectionTitle(stringResource(R.string.graphics_title))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("adaptive" to R.string.graphics_adaptive, "ultra" to R.string.graphics_ultra, "lite" to R.string.graphics_lite).forEach { (k, l) ->
                FilterChip(graphics == k, { scope.launch { c.prefs.setGraphics(k) } }, label = { Text(stringResource(l)) }) }
        }
        Text(stringResource(R.string.graphics_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SectionTitle(stringResource(R.string.privacy_title))
        SecondaryButton(stringResource(R.string.settings_notifications), {
            runCatching { ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.packageName)) }
        }, icon = Icons.Outlined.Notifications)
        SecondaryButton(stringResource(R.string.settings_location), {
            runCatching { ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", ctx.packageName, null))) }
        }, icon = Icons.Outlined.LocationOn)
        val clearedMsg = stringResource(R.string.settings_cleared)
        SecondaryButton(stringResource(R.string.settings_clear_local), { scope.launch { c.accountStore.wipe(me.uid); msg = clearedMsg } }, icon = Icons.Outlined.DeleteSweep)
        SectionTitle(stringResource(R.string.account_help))
        SecondaryButton(stringResource(R.string.faq_title), openSafety, icon = Icons.Outlined.HelpOutline)
        SecondaryButton(stringResource(R.string.account_support), openSupport, icon = Icons.Outlined.SupportAgent)
        SecondaryButton(stringResource(R.string.link_privacy), { Links.open(ctx, Links.PRIVACY) }, icon = Icons.Outlined.PrivacyTip)
        SecondaryButton(stringResource(R.string.link_terms), { Links.open(ctx, Links.TERMS) }, icon = Icons.Outlined.Description)
        Text(stringResource(R.string.account_disclaimer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        InlineMessage(msg)
        SecondaryButton(stringResource(R.string.action_sign_out), { app.signOut() }, icon = Icons.AutoMirrored.Outlined.Logout)
        TextButton(onClick = { deleting = true }) { Text(stringResource(R.string.account_delete), color = MaterialTheme.colorScheme.error) }
        Text("NEARVOLT EV ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (editing) EditProfileDialog(me, onDismiss = { editing = false }) { body ->
        scope.launch { when (val r = c.repo.saveProfile(body)) { is ApiResult.Ok -> { app.onProfileChanged(r.value.copy(admin = me.admin)); editing = false }; is ApiResult.Err -> msg = r.message } }
    }
    if (linkPhone) LinkPhoneDialog(onDismiss = { linkPhone = false }) { linkPhone = false; app.refresh() }
    if (deleting) {
        var busy by remember { mutableStateOf(false) }
        AlertDialog(onDismissRequest = { if (!busy) deleting = false }, title = { Text(stringResource(R.string.delete_title)) }, text = { Text(stringResource(R.string.delete_body)) },
            confirmButton = { TextButton(enabled = !busy, onClick = { busy = true; scope.launch {
                when (val r = c.repo.deleteAccount()) { is ApiResult.Ok -> { deleting = false; app.deleted() }; is ApiResult.Err -> { busy = false; deleting = false; msg = r.message } }
            } }) { Text(stringResource(R.string.delete_confirm), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { deleting = false }, enabled = !busy) { Text(stringResource(R.string.action_cancel)) } })
    }
}

@Composable
private fun EditProfileDialog(me: Me, onDismiss: () -> Unit, onSave: (ProfileBody) -> Unit) {
    var name by remember { mutableStateOf(me.name) }
    var type by remember { mutableStateOf(me.vehicle?.type ?: "car") }
    var connector by remember { mutableStateOf(me.vehicle?.connector ?: "TYPE2_AC") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.account_edit)) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { OutlinedTextField(name, { name = it.take(80) }, label = { Text(stringResource(R.string.field_name)) }, singleLine = true); VehicleFields(type, { type = it }, connector, { connector = it }) } },
        confirmButton = { TextButton(onClick = { onSave(ProfileBody(name.trim(), Vehicle(type, me.vehicle?.model, connector))) }, enabled = name.trim().length >= 2) { Text(stringResource(R.string.action_save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } })
}

@Composable
private fun LinkPhoneDialog(onDismiss: () -> Unit, onLinked: () -> Unit) {
    val c = NearVoltApp.instance.container
    val scope = rememberCoroutineScope()
    var phone by remember { mutableStateOf("") }; var otp by remember { mutableStateOf("") }; var sent by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }; var busy by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.account_link_phone)) },
        text = { Column {
            OutlinedTextField(phone, { phone = it.filter { ch -> ch.isDigit() }.take(10) }, label = { Text(stringResource(R.string.field_mobile)) }, prefix = { Text("+91 ") }, singleLine = true, enabled = !sent)
            if (sent) OutlinedTextField(otp, { otp = it.filter(Char::isDigit).take(6) }, label = { Text(stringResource(R.string.field_otp)) }, singleLine = true)
            InlineMessage(err)
        } },
        confirmButton = { TextButton(enabled = !busy && (if (sent) otp.length == 6 else phone.length == 10), onClick = { busy = true; err = null; scope.launch {
            if (!sent) { when (val r = c.auth.sendOtp(phone)) { is ApiResult.Ok -> sent = true; is ApiResult.Err -> err = r.message } }
            else when (val o = c.auth.verifyOtp(phone, otp)) { is AuthOutcome.Failed -> err = o.message; else -> onLinked() }
            busy = false
        } }) { Text(stringResource(if (sent) R.string.signin_verify else R.string.signin_send_code)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } })
}

class SupportViewModel : ViewModel() {
    private val repo = NearVoltApp.instance.container.repo
    val tickets = MutableStateFlow<List<Ticket>>(emptyList()); val message = MutableStateFlow<String?>(null); val busy = MutableStateFlow(false)
    fun load() = viewModelScope.launch { (repo.tickets() as? ApiResult.Ok)?.let { tickets.value = it.value.items } }
    fun send(category: String, text: String, requestId: String?, done: () -> Unit) = viewModelScope.launch {
        busy.value = true
        when (val r = repo.createTicket(TicketBody(category, text, requestId))) { is ApiResult.Ok -> { message.value = null; done(); load() }; is ApiResult.Err -> message.value = r.message }
        busy.value = false
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SupportScreen(onBack: () -> Unit, vm: SupportViewModel = viewModel()) {
    val tickets by vm.tickets.collectAsStateWithLifecycle(); val msg by vm.message.collectAsStateWithLifecycle(); val busy by vm.busy.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    var category by remember { mutableStateOf("app_issue") }
    var text by remember { mutableStateOf("") }
    var sent by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.load() }
    val cats = listOf("unsafe_charging" to R.string.cat_unsafe, "host_issue" to R.string.cat_host, "customer_issue" to R.string.cat_customer, "app_issue" to R.string.cat_app, "account" to R.string.cat_account, "other" to R.string.cat_other)
    Scaffold(topBar = { TopAppBar(title = { Text(stringResource(R.string.support_title)) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.action_back)) } }) }) { pad ->
        Column(Modifier.padding(pad).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            HeroHeader(stringResource(R.string.support_title), stringResource(R.string.support_hero_sub))
            NvCard { Row(verticalAlignment = Alignment.CenterVertically) { LeadingBadge(Icons.Outlined.Sos, Tone.Bad); Spacer(Modifier.width(12.dp))
                Text(stringResource(R.string.support_emergency), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f)) }
                TextButton(onClick = { Links.dial(ctx, Links.EMERGENCY) }) { Text(stringResource(R.string.emergency_call)) } }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { cats.forEach { (k, l) -> FilterChip(category == k, { category = k }, label = { Text(stringResource(l)) }) } }
            OutlinedTextField(text, { text = it.take(2000) }, Modifier.fillMaxWidth().heightIn(min = 120.dp), label = { Text(stringResource(R.string.support_message)) })
            InlineMessage(msg)
            if (sent) InlineMessage(stringResource(R.string.support_sent), isError = false)
            PrimaryButton(stringResource(R.string.action_submit), { vm.send(category, text.trim(), null) { text = ""; sent = true } }, enabled = text.trim().length >= 5, loading = busy)
            if (tickets.isNotEmpty()) SectionTitle(stringResource(R.string.support_my_tickets))
            tickets.forEach { t -> NvCard { Text("${t.category.replace('_', ' ')} · ${t.status.lowercase()}", style = MaterialTheme.typography.titleSmall); Text(t.message, maxLines = 2, style = MaterialTheme.typography.bodyMedium); t.resolution?.let { Text(it, style = MaterialTheme.typography.bodySmall) } } }
        }
    }
}
