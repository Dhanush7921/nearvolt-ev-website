package com.nearvolt.ev.ui.screens

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import com.nearvolt.ev.data.api.ApiResult
import com.nearvolt.ev.data.api.ChargeRequest
import com.nearvolt.ev.data.prefs.LocalAccountData
import com.nearvolt.ev.ui.AppViewModel
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.ui.theme.Brand
import com.nearvolt.ev.util.Labels
import com.nearvolt.ev.util.Time
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeState(val recent: List<ChargeRequest> = emptyList(), val active: ChargeRequest? = null, val loaded: Boolean = false, val offline: Boolean = false)

class HomeViewModel : ViewModel() {
    private val c = NearVoltApp.instance.container
    val state = MutableStateFlow(HomeState())
    fun load() = viewModelScope.launch {
        when (val r = c.repo.requests("customer")) {
            is ApiResult.Ok -> state.update { it.copy(recent = r.value.items.take(3), active = r.value.items.firstOrNull { x -> x.status in RequestText.ACTIVE }, loaded = true, offline = false) }
            is ApiResult.Err -> state.update { it.copy(loaded = true, offline = r.isOffline) }
        }
    }
}

/** Primary vehicle battery is a manual entry stored with the device-local mirror of the server primary vehicle. */
const val PRIMARY_LOCAL_ID = "server-primary"

@Composable
fun HomeScreen(app: AppViewModel, openMap: () -> Unit, openFind: () -> Unit, openGarage: () -> Unit, openFavourites: () -> Unit, openSafety: () -> Unit,
               openEmergency: () -> Unit, openAlerts: () -> Unit, openAccount: () -> Unit, openRequest: (String) -> Unit, openActivity: () -> Unit,
               vm: HomeViewModel = viewModel(), locationVm: FindViewModel = viewModel(key = "home-location")) {
    val s by vm.state.collectAsStateWithLifecycle()
    val appState by app.state.collectAsStateWithLifecycle()
    val me = appState.me ?: return
    val c = NearVoltApp.instance.container
    val local by remember(me.uid) { c.accountStore.data(me.uid) }.collectAsStateWithLifecycle(LocalAccountData())
    val disco by c.discovery.collectAsStateWithLifecycle()
    val locationState by locationVm.state.collectAsStateWithLifecycle()
    var showLocation by remember { mutableStateOf(false) }
    var manualOpen by remember { mutableStateOf(false) }
    LaunchedEffect(me.uid) { vm.load(); locationVm.init(me, null, loadActiveRequests = false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { locationVm.locate() }
    val locate: () -> Unit = {
        if (c.location.hasFine() || c.location.hasCoarse()) { locationVm.locate(); Unit }
        else permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }
    if (manualOpen) ManualLocationDialog(onDismiss = { manualOpen = false }) { manualOpen = false; locationVm.manual(it) }
    val first = me.name.trim().split(' ').firstOrNull().orEmpty()
    val primaryLocal = local.garage.firstOrNull { it.id == PRIMARY_LOCAL_ID }

    LazyColumn(Modifier.fillMaxSize().ambient(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item(key = "top") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.ic_brand_mark), null, Modifier.size(30.dp))
                Spacer(Modifier.width(8.dp))
                Text("NEARVOLT EV", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                IconButton(onClick = openAlerts) { Icon(Icons.Outlined.Notifications, stringResource(R.string.tab_alerts)) }
                Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer).clickable(onClick = openAccount)
                    .semantics { contentDescription = "Account" }, contentAlignment = Alignment.Center) {
                    Text(me.name.split(' ').filter(String::isNotBlank).take(2).joinToString("") { it.take(1).uppercase() }, style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }
        }
        item(key = "hello") {
            Text(stringResource(R.string.home_hello, first.ifBlank { "there" }), style = MaterialTheme.typography.headlineMedium)
            Text(stringResource(R.string.home_ready), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(onClick = { showLocation = !showLocation }, label = { Text(disco.fix?.label ?: stringResource(R.string.home_set_location), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    leadingIcon = { Icon(Icons.Outlined.LocationOn, null, Modifier.size(18.dp)) }, modifier = Modifier.weight(1f, fill = false))
                ServerStatusChip(appState.config != null, s.offline)
            }
        }
        if (showLocation || disco.fix == null) item(key = "locationPanel") {
            GlassCard {
                Text(stringResource(R.string.find_start_title), style = MaterialTheme.typography.titleMedium)
                Text(disco.fix?.label ?: stringResource(R.string.find_start_body), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = locate, enabled = !locationState.locating, modifier = Modifier.weight(1f)) {
                        if (locationState.locating) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.find_use_location))
                    }
                    OutlinedButton(onClick = { manualOpen = true }, enabled = !locationState.locating, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.find_enter_location)) }
                }
                when (locationState.locationIssue) {
                    "DENIED" -> InlineMessage(stringResource(R.string.find_issue_denied))
                    "OFF" -> InlineMessage(stringResource(R.string.find_issue_off))
                    "UNAVAILABLE" -> InlineMessage(stringResource(R.string.find_issue_unavailable))
                    "MANUAL_FAILED" -> InlineMessage(stringResource(R.string.find_issue_manual))
                    "OUTSIDE" -> InlineMessage(stringResource(R.string.find_issue_outside))
                }
                if (disco.fix != null) TextButton(onClick = openMap) { Text(stringResource(R.string.tab_map)) }
            }
        }
        item(key = "vehicle") { VehicleCard(me.vehicle, primaryLocal, openGarage) }
        item(key = "sos") { EmergencyButton(stringResource(R.string.home_emergency), enabled = true, loading = false, onClick = openEmergency) }
        item(key = "shortcuts") {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Shortcut(Icons.Outlined.Map, stringResource(R.string.home_find_on_map), Modifier.weight(1f), openMap)
                Shortcut(Icons.Outlined.DirectionsCar, stringResource(R.string.garage_title), Modifier.weight(1f), openGarage)
                Shortcut(Icons.Outlined.FavoriteBorder, stringResource(R.string.fav_title), Modifier.weight(1f), openFavourites)
                Shortcut(Icons.Outlined.Shield, stringResource(R.string.safety_short), Modifier.weight(1f), openSafety)
            }
        }
        item(key = "nearby") {
            GlassCard(onClick = openFind, accent = true) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LeadingBadge(Icons.Outlined.EvStation, Tone.Good, 48.dp); Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.home_nearby_title), style = MaterialTheme.typography.titleMedium)
                        val n = disco.nearby?.items?.count { it.bookableNow }
                        Text(if (n != null) stringResource(R.string.home_nearby_count, n, Time.ago(disco.nearby?.checkedAt)) else stringResource(R.string.home_nearby_body),
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(Icons.AutoMirrored.Outlined.ArrowForward, null)
                }
            }
        }
        item(key = "active") {
            val a = s.active
            GlassCard(onClick = { if (a != null) openRequest(a.id) else openMap() }, modifier = if (a != null) Modifier.sharedElement("req-${a.id}") else Modifier) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LeadingBadge(if (a != null) Icons.Outlined.ElectricBolt else Icons.Outlined.DirectionsCar, if (a != null) RequestText.tone(a.status) else Tone.Neutral)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(if (a != null) "${a.hostName} · ${RequestText.status(a.status)}" else stringResource(R.string.home_no_active), style = MaterialTheme.typography.titleSmall)
                        Text(if (a != null) stringResource(R.string.home_active_open) else stringResource(R.string.home_no_active_body), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(Icons.AutoMirrored.Outlined.ArrowForward, null)
                }
            }
        }
        item(key = "recentHead") { SectionHeader(stringResource(R.string.home_recent), stringResource(R.string.action_view_all), openActivity) }
        when {
            !s.loaded -> item(key = "sk") { SkeletonList(2) }
            s.recent.isEmpty() -> item(key = "none") { Text(stringResource(R.string.history_empty_body), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            else -> items(s.recent, key = { "r-" + it.id }) { r ->
                GlassCard(onClick = { openRequest(r.id) }, modifier = Modifier.animateItem()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LeadingBadge(if (r.status == "COMPLETED") Icons.Outlined.TaskAlt else Icons.Outlined.ElectricBolt, RequestText.tone(r.status), 36.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) { Text(r.hostName, style = MaterialTheme.typography.titleSmall); Text(Time.display(r.createdAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        StatusPill(RequestText.status(r.status), RequestText.tone(r.status))
                    }
                }
            }
        }
        item(key = "tip") { GuidanceCard() }
    }
}

@Composable
private fun ServerStatusChip(configLoaded: Boolean, offline: Boolean) {
    val (label, tone) = when { offline -> stringResource(R.string.status_offline) to Tone.Bad; configLoaded -> stringResource(R.string.status_connected) to Tone.Good; else -> stringResource(R.string.status_connecting) to Tone.Warn }
    StatusPill(label, tone)
}

@Composable
fun VehicleCard(server: com.nearvolt.ev.data.api.Vehicle?, local: com.nearvolt.ev.data.prefs.GarageVehicle?, onClick: () -> Unit) {
    GlassCard(onClick = onClick, accent = true) {
        Text(stringResource(R.string.home_my_vehicle), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (server == null) {
            Text(stringResource(R.string.garage_empty), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.garage_empty_body), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@GlassCard
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(listOfNotNull(local?.make?.ifBlank { null }, server.model?.ifBlank { null }).joinToString(" ").ifBlank { Labels.vehicle(server.type) }, style = MaterialTheme.typography.titleLarge)
                Text("${Labels.vehicle(server.type)} · ${Labels.connector(server.connector)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            EvIllustration(Modifier.width(120.dp), charging = false, height = 56.dp)
        }
        Spacer(Modifier.height(8.dp))
        BatteryMeter(local?.batteryPercent, local?.batteryUpdatedAt)
    }
}

/** Animated battery bar for a MANUALLY entered percentage (labelled as such; never presented as telemetry). */
@Composable
fun BatteryMeter(pct: Int?, updatedAt: Long?) {
    if (pct == null) { Text(stringResource(R.string.battery_tap_to_set), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary); return }
    val reduced = rememberReducedMotion()
    val p by animateFloatAsState(pct / 100f, if (reduced) tween(0) else tween(700), label = "battery")
    val low = pct <= 15
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("$pct%", style = MaterialTheme.typography.displaySmall, color = if (low) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.width(12.dp))
        Box(Modifier.weight(1f).height(14.dp).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surfaceVariant)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(p).clip(RoundedCornerShape(50)).background(
                if (low) Brush.horizontalGradient(listOf(MaterialTheme.colorScheme.error, MaterialTheme.colorScheme.error))
                else Brush.horizontalGradient(listOf(Brand.EmeraldBrand, Brand.NeonMint))))
        }
    }
    Text(stringResource(R.string.battery_manual_note, updatedAt?.let { com.nearvolt.ev.util.Time.ago(java.time.Instant.ofEpochMilli(it).toString()) } ?: "—"),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Shortcut(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    GlassCard(onClick = onClick, modifier = modifier) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(6.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun GuidanceCard() {
    val tips = listOf(R.string.tip_1, R.string.tip_2, R.string.tip_3, R.string.tip_4)
    val tip = remember { tips.random() }
    GlassCard {
        Row(verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.Lightbulb, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(10.dp))
            Column { Text(stringResource(R.string.tip_title), style = MaterialTheme.typography.titleSmall); Text(stringResource(tip), style = MaterialTheme.typography.bodyMedium) }
        }
    }
}
