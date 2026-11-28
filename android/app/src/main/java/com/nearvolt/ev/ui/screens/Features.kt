package com.nearvolt.ev.ui.screens

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import com.nearvolt.ev.data.api.ApiResult
import com.nearvolt.ev.data.api.ProfileBody
import com.nearvolt.ev.data.api.Vehicle
import com.nearvolt.ev.data.api.VehicleTypes
import com.nearvolt.ev.data.prefs.*
import com.nearvolt.ev.ui.AppViewModel
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.util.Labels
import com.nearvolt.ev.util.Links
import com.nearvolt.ev.util.Time
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SubScreen(title: String, onBack: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Scaffold(topBar = { TopAppBar(title = { Text(title) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.action_back)) } }) }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().ambient().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

// ============================== MY GARAGE ==============================
@Composable
fun GarageScreen(app: AppViewModel, onBack: () -> Unit) {
    val appState by app.state.collectAsStateWithLifecycle()
    val me = appState.me ?: return
    val c = NearVoltApp.instance.container
    val local by remember(me.uid) { c.accountStore.data(me.uid) }.collectAsStateWithLifecycle(LocalAccountData())
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf<GarageVehicle?>(null) }
    var msg by remember { mutableStateOf<String?>(null) }
    val primaryLocal = local.garage.firstOrNull { it.id == PRIMARY_LOCAL_ID }
    SubScreen(stringResource(R.string.garage_title), onBack) {
        VehicleCard(me.vehicle, primaryLocal) { me.vehicle?.let { v -> editing = primaryLocal ?: GarageVehicle(PRIMARY_LOCAL_ID, v.type, v.connector, model = v.model.orEmpty()) } }
        Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.CloudDone, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.garage_primary_synced), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        InlineMessage(msg)
        SectionHeader(stringResource(R.string.garage_other))
        val others = local.garage.filter { it.id != PRIMARY_LOCAL_ID }
        if (others.isEmpty()) Text(stringResource(R.string.garage_other_empty), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        others.forEach { v ->
            GlassCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LeadingBadge(Icons.Outlined.DirectionsCar, Tone.Neutral); Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(listOf(v.make, v.model).filter(String::isNotBlank).joinToString(" ").ifBlank { Labels.vehicle(v.type) }, style = MaterialTheme.typography.titleMedium)
                        Text("${Labels.vehicle(v.type)} · ${Labels.connector(v.connector)}" + (v.batteryKwh?.let { " · ${it} kWh" } ?: ""), style = MaterialTheme.typography.bodySmall)
                        Text(stringResource(R.string.garage_device_only), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Row {
                    TextButton(onClick = { editing = v }) { Text(stringResource(R.string.account_edit)) }
                    TextButton(onClick = {
                        // Making a vehicle primary updates the server profile (existing API); the old primary stays on this device.
                        scope.launch {
                            when (val r = c.repo.saveProfile(ProfileBody(me.name, Vehicle(v.type, listOf(v.make, v.model).filter(String::isNotBlank).joinToString(" ").ifBlank { null }, v.connector)))) {
                                is ApiResult.Ok -> {
                                    val old = me.vehicle; val oldLocal = primaryLocal
                                    c.accountStore.update(me.uid) { d ->
                                        var n = LocalRules.removeVehicle(d, v.id).let { LocalRules.removeVehicle(it, PRIMARY_LOCAL_ID) }
                                        if (old != null) n = LocalRules.upsertVehicle(n, (oldLocal ?: GarageVehicle("", old.type, old.connector, model = old.model.orEmpty())).copy(id = UUID.randomUUID().toString()))
                                        LocalRules.upsertVehicle(n, v.copy(id = PRIMARY_LOCAL_ID))
                                    }
                                    app.onProfileChanged(r.value.copy(admin = me.admin)); msg = null
                                }
                                is ApiResult.Err -> msg = r.message
                            }
                        }
                    }) { Text(stringResource(R.string.garage_make_primary)) }
                    TextButton(onClick = { scope.launch { c.accountStore.update(me.uid) { LocalRules.removeVehicle(it, v.id) } } }) { Text(stringResource(R.string.action_remove), color = MaterialTheme.colorScheme.error) }
                }
            }
        }
        SecondaryButton(stringResource(R.string.garage_add), { editing = GarageVehicle(UUID.randomUUID().toString(), me.vehicle?.type ?: "car", me.vehicle?.connector ?: "TYPE2_AC") }, icon = Icons.Outlined.Add)
        SectionHeader(stringResource(R.string.est_title))
        EstimatorCard(primaryLocal?.batteryKwh, primaryLocal?.batteryPercent)
    }
    editing?.let { v ->
        VehicleDialog(v, isPrimary = v.id == PRIMARY_LOCAL_ID, onDismiss = { editing = null }) { saved ->
            editing = null
            scope.launch {
                c.accountStore.update(me.uid) { LocalRules.upsertVehicle(it, saved) }
                if (saved.id == PRIMARY_LOCAL_ID) {
                    // Server-synced fields of the primary: type, connector, model (existing profile API).
                    val model = listOf(saved.make, saved.model).filter(String::isNotBlank).joinToString(" ").ifBlank { null }
                    if (me.vehicle?.type != saved.type || me.vehicle?.connector != saved.connector || me.vehicle?.model != model) {
                        when (val r = c.repo.saveProfile(ProfileBody(me.name, Vehicle(saved.type, model, saved.connector)))) {
                            is ApiResult.Ok -> app.onProfileChanged(r.value.copy(admin = me.admin)); is ApiResult.Err -> msg = r.message
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun VehicleDialog(v: GarageVehicle, isPrimary: Boolean, catalogueNote: String? = null, onDismiss: () -> Unit, onSave: (GarageVehicle) -> Unit) {
    var type by remember { mutableStateOf(v.type) }; var connector by remember { mutableStateOf(v.connector) }
    var make by remember { mutableStateOf(v.make) }; var model by remember { mutableStateOf(v.model) }
    var kwh by remember { mutableStateOf(v.batteryKwh?.toString().orEmpty()) }
    var pct by remember { mutableFloatStateOf((v.batteryPercent ?: 50).toFloat()) }
    var pctSet by remember { mutableStateOf(v.batteryPercent != null) }
    val kwhVal = kwh.toDoubleOrNull()
    val kwhOk = kwh.isBlank() || (kwhVal != null && kwhVal > 0 && kwhVal <= 300)
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(if (isPrimary) R.string.garage_edit_primary else R.string.garage_vehicle)) },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { VehicleTypes.ALL.forEach { t -> FilterChip(type == t, { type = t }, label = { Text(Labels.vehicle(t)) }) } }
            ConnectorPicker(connector, { connector = it })
            OutlinedTextField(make, { make = it.take(40) }, label = { Text(stringResource(R.string.garage_make)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(model, { model = it.take(40) }, label = { Text(stringResource(R.string.field_model_optional)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(kwh, { kwh = it.filter { ch -> ch.isDigit() || ch == '.' }.take(6) }, label = { Text(stringResource(R.string.garage_capacity)) }, singleLine = true, isError = !kwhOk,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), supportingText = { Text(stringResource(R.string.garage_capacity_hint)) }, modifier = Modifier.fillMaxWidth())
            Text(stringResource(R.string.battery_question, pct.toInt()), style = MaterialTheme.typography.titleSmall)
            Slider(pct, { pct = it; pctSet = true }, valueRange = 0f..100f, steps = 99)
            Text(stringResource(R.string.battery_manual_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            catalogueNote?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
            if (isPrimary) Text(stringResource(R.string.garage_sync_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } },
        confirmButton = { TextButton(enabled = kwhOk, onClick = { onSave(v.copy(type = type, connector = connector, make = make.trim(), model = model.trim(), batteryKwh = kwhVal,
            batteryPercent = if (pctSet) pct.toInt() else v.batteryPercent, batteryUpdatedAt = if (pctSet) System.currentTimeMillis() else v.batteryUpdatedAt)) }) { Text(stringResource(R.string.action_save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } })
}

/** Battery & charging estimator: energy = capacity × (target − current) / 100; time = energy / power. Always labelled as an estimate. */
@Composable
fun EstimatorCard(capacity: Double?, current: Int?) {
    var cap by remember(capacity) { mutableStateOf(capacity?.toString().orEmpty()) }
    var cur by remember(current) { mutableFloatStateOf((current ?: 20).toFloat()) }
    var target by remember { mutableFloatStateOf(80f) }
    var power by remember { mutableStateOf("3.3") }
    val est = ChargeEstimator.estimate(cap.toDoubleOrNull() ?: -1.0, cur.toDouble(), target.toDouble(), power.toDoubleOrNull() ?: -1.0)
    GlassCard {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(cap, { cap = it.filter { c -> c.isDigit() || c == '.' }.take(6) }, Modifier.weight(1f), label = { Text(stringResource(R.string.est_capacity)) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            OutlinedTextField(power, { power = it.filter { c -> c.isDigit() || c == '.' }.take(5) }, Modifier.weight(1f), label = { Text(stringResource(R.string.est_power)) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        }
        Text(stringResource(R.string.est_current, cur.toInt()), style = MaterialTheme.typography.bodyMedium)
        Slider(cur, { cur = it; if (target <= it) target = (it + 1).coerceAtMost(100f) }, valueRange = 0f..99f)
        Text(stringResource(R.string.est_target, target.toInt()), style = MaterialTheme.typography.bodyMedium)
        Slider(target, { target = it.coerceAtLeast(cur + 1) }, valueRange = 1f..100f)
        if (est != null) {
            Text(stringResource(R.string.est_result, String.format(Locale.US, "%.1f", est.energyKwh), ChargeEstimator.formatHours(est.hours)), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
        } else Text(stringResource(R.string.est_invalid), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(R.string.est_disclaimer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ============================== FAVOURITES & RECENTS ==============================
@Composable
fun FavouritesScreen(app: AppViewModel, onBack: () -> Unit, openMap: () -> Unit) {
    val appState by app.state.collectAsStateWithLifecycle()
    val uid = appState.me?.uid ?: return
    val c = NearVoltApp.instance.container
    val local by remember(uid) { c.accountStore.data(uid) }.collectAsStateWithLifecycle(LocalAccountData())
    val disco by c.discovery.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    SubScreen(stringResource(R.string.fav_title), onBack) {
        Text(stringResource(R.string.fav_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (local.favourites.isEmpty()) EmptyState(stringResource(R.string.fav_empty), stringResource(R.string.fav_empty_body), stringResource(R.string.home_find_on_map), openMap)
        local.favourites.forEach { f ->
            // Validate against the latest live server result of this session; never show saved data as live availability.
            val live = disco.nearby?.items?.firstOrNull { it.hostId == f.hostId }
            GlassCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LeadingBadge(Icons.Outlined.Favorite, if (live?.bookableNow == true) Tone.Good else Tone.Neutral); Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(live?.displayName ?: f.name, style = MaterialTheme.typography.titleMedium)
                        Text(when {
                            live != null -> stringResource(R.string.fav_live, stringResource(if (live.bookableNow) R.string.host_status_available else R.string.host_status_unavailable), Labels.km(live.straightLineKm), Time.ago(disco.nearby?.checkedAt))
                            disco.nearby != null -> stringResource(R.string.fav_not_in_results)
                            else -> stringResource(R.string.fav_unknown)
                        }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = { scope.launch { c.accountStore.update(uid) { d -> d.copy(favourites = d.favourites.filterNot { it.hostId == f.hostId }) } } }) {
                        Icon(Icons.Outlined.Delete, stringResource(R.string.fav_remove)) }
                }
            }
        }
        if (local.favourites.isNotEmpty()) TextButton(onClick = { scope.launch { c.accountStore.update(uid) { it.copy(favourites = emptyList()) } } }) { Text(stringResource(R.string.action_clear_all)) }
        SectionHeader(stringResource(R.string.recent_title), if (local.recents.isNotEmpty()) stringResource(R.string.action_clear_all) else null) { scope.launch { c.accountStore.update(uid) { it.copy(recents = emptyList()) } } }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.recent_save), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Switch(local.saveRecents, { on -> scope.launch { c.accountStore.update(uid) { it.copy(saveRecents = on, recents = if (on) it.recents else emptyList()) } } })
        }
        Text(stringResource(R.string.recent_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        local.recents.forEach { r ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.History, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
                Text(r.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                IconButton(onClick = { scope.launch { c.accountStore.update(uid) { d -> d.copy(recents = d.recents.filterNot { it.text == r.text }) } } }) { Icon(Icons.Outlined.Close, stringResource(R.string.action_remove)) }
            }
        }
    }
}

// ============================== EMERGENCY MODE ==============================
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmergencyScreen(app: AppViewModel, onBack: () -> Unit, openRequest: (String) -> Unit, vm: FindViewModel = viewModel(key = "emergency")) {
    val appState by app.state.collectAsStateWithLifecycle()
    val s by vm.state.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    val c = NearVoltApp.instance.container
    val uid = appState.me?.uid
    val local by remember(uid) { if (uid != null) c.accountStore.data(uid) else kotlinx.coroutines.flow.flowOf(LocalAccountData()) }.collectAsStateWithLifecycle(LocalAccountData())
    var selected by remember { mutableStateOf<com.nearvolt.ev.data.api.HostSummary?>(null) }
    var manualOpen by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.init(appState.me, null); vm.adoptCachedFix() }
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.locate() }
    val locate: () -> Unit = { if (c.location.hasFine() || c.location.hasCoarse()) vm.locate() else perm.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
    val battery = local.garage.firstOrNull { it.id == PRIMARY_LOCAL_ID }
    val nearest = s.result?.items?.firstOrNull { it.bookableNow }
    SubScreen(stringResource(R.string.emg_title), onBack) {
        // Emergency actions are never delayed by animation.
        GlassCard(accent = true) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LeadingBadge(Icons.Outlined.Sos, Tone.Bad, 48.dp); Spacer(Modifier.width(12.dp))
                Column { Text(stringResource(R.string.emg_heading), style = MaterialTheme.typography.titleLarge); Text(stringResource(R.string.emg_disclaimer), style = MaterialTheme.typography.bodySmall) }
            }
        }
        s.active?.let { a -> GlassCard(onClick = { openRequest(a.id) }) { Text(stringResource(R.string.find_active_request), style = MaterialTheme.typography.titleSmall); Text("${a.hostName} · ${RequestText.status(a.status)}") } }
        GlassCard(onClick = locate) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.MyLocation, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.emg_location), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(s.fix?.label ?: stringResource(R.string.find_no_location), style = MaterialTheme.typography.titleMedium)
                }
                if (s.locating) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                TextButton(onClick = { manualOpen = true }) { Text(stringResource(R.string.find_enter_location)) }
            }
        }
        GlassCard {
            Text(stringResource(R.string.emg_battery), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            BatteryMeter(battery?.batteryPercent, battery?.batteryUpdatedAt)
            if ((battery?.batteryPercent ?: 100) <= 15) Text(stringResource(R.string.emg_low), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            Text(stringResource(R.string.emg_battery_confirm_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        when {
            s.fix == null -> PrimaryButton(stringResource(R.string.emergency_find_nearest), locate, loading = s.locating)
            s.loading && s.result == null -> SkeletonList(1)
            s.error != null -> ErrorState(s.error!!) { vm.search() }
            nearest == null -> InlineMessage(stringResource(R.string.emergency_none))
            else -> {
                Text(stringResource(R.string.emg_nearest), style = MaterialTheme.typography.titleSmall)
                HostCard(nearest) { selected = nearest }
                PrimaryButton(stringResource(R.string.detail_request), { selected = nearest })
            }
        }
        OutlinedButton(onClick = { Links.dial(ctx, Links.EMERGENCY) }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Icon(Icons.Outlined.Call, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.emergency_call)) }
        Text(stringResource(R.string.emg_dial_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SectionHeader(stringResource(R.string.emg_guidance))
        listOf(R.string.emg_g1, R.string.emg_g2, R.string.emg_g3, R.string.emg_g4).forEach { Text("• " + stringResource(it), style = MaterialTheme.typography.bodyMedium) }
    }
    if (manualOpen) ManualLocationDialog(onDismiss = { manualOpen = false }) { manualOpen = false; vm.manual(it) }
    selected?.let { h ->
        ModalBottomSheet(onDismissRequest = { selected = null; vm.clearCreateError() }) {
            val batteryOk = appState.config?.capabilities?.batteryPercent == true
            // Same compatibility + battery confirmation + host acceptance + PIN flow as normal requests: no shortcuts in emergencies.
            HostDetail(h, s, batteryOk, onRequest = { note, b, sc -> vm.create(h, note, if (batteryOk) b else null, sc) { id -> selected = null; openRequest(id) } })
        }
    }
}

// ============================== SAFETY CENTRE ==============================
@Composable
fun SafetyScreen(onBack: () -> Unit, openSupport: () -> Unit) {
    val ctx = LocalContext.current
    SubScreen(stringResource(R.string.safety_centre), onBack) {
        GlassCard(accent = true) {
            Row(verticalAlignment = Alignment.CenterVertically) { LeadingBadge(Icons.Outlined.VerifiedUser, Tone.Good, 52.dp); Spacer(Modifier.width(14.dp))
                Column { Text(stringResource(R.string.safety_hero), style = MaterialTheme.typography.titleLarge); Text(stringResource(R.string.safety_hero_body), style = MaterialTheme.typography.bodySmall) } }
        }
        Expandable(Icons.Outlined.ElectricBolt, R.string.safety_s1_t, R.string.safety_body, R.string.safety_s1_b)
        Expandable(Icons.Outlined.Power, R.string.safety_s2_t, R.string.safety_s2_b)
        Expandable(Icons.Outlined.Bolt, R.string.safety_s3_t, R.string.safety_s3_b)
        Expandable(Icons.Outlined.Verified, R.string.safety_s4_t, R.string.onb2_body, R.string.safety_s4_b)
        Expandable(Icons.Outlined.Warning, R.string.safety_s5_t, R.string.safety_s5_b)
        Expandable(Icons.Outlined.Emergency, R.string.safety_s6_t, R.string.support_emergency, R.string.emg_disclaimer)
        Expandable(Icons.Outlined.PrivacyTip, R.string.safety_s7_t, R.string.consent_data_body, R.string.listing_location_privacy)
        SectionHeader(stringResource(R.string.faq_title))
        Expandable(Icons.Outlined.HelpOutline, R.string.faq_q1, R.string.faq_a1)
        Expandable(Icons.Outlined.HelpOutline, R.string.faq_q2, R.string.faq_a2)
        Expandable(Icons.Outlined.HelpOutline, R.string.faq_q3, R.string.faq_a3)
        Expandable(Icons.Outlined.HelpOutline, R.string.faq_q4, R.string.charging_no_metering)
        PrimaryButton(stringResource(R.string.safety_report), openSupport)
        SecondaryButton(stringResource(R.string.account_support), openSupport, icon = Icons.Outlined.SupportAgent)
        OutlinedButton(onClick = { Links.dial(ctx, Links.EMERGENCY) }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Icon(Icons.Outlined.Call, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.emergency_call)) }
        Text(stringResource(R.string.account_disclaimer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Expandable card (card expansion animation; instant when motion is reduced). */
@Composable
private fun Expandable(icon: ImageVector, title: Int, vararg body: Int) {
    var open by rememberSaveable { mutableStateOf(false) }
    val reduced = rememberReducedMotion()
    val rot by androidx.compose.animation.core.animateFloatAsState(if (open) 180f else 0f, label = "chev")
    GlassCard(onClick = { open = !open }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(12.dp))
            Text(stringResource(title), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Icon(Icons.Outlined.ExpandMore, null, Modifier.rotate(rot))
        }
        if (reduced) { if (open) body.forEach { Spacer(Modifier.height(8.dp)); Text(stringResource(it), style = MaterialTheme.typography.bodyMedium) } }
        else AnimatedVisibility(open, enter = expandVertically(), exit = shrinkVertically()) {
            Column { body.forEach { Spacer(Modifier.height(8.dp)); Text(stringResource(it), style = MaterialTheme.typography.bodyMedium) } }
        }
    }
}
