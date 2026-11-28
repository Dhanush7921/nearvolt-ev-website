package com.nearvolt.ev.ui.screens

import android.Manifest
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import com.nearvolt.ev.data.api.*
import com.nearvolt.ev.location.Fix
import com.nearvolt.ev.location.LocationResult
import com.nearvolt.ev.ui.AppViewModel
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.util.Labels
import com.nearvolt.ev.util.Links
import com.nearvolt.ev.util.Time
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

data class FindState(
    val fix: Fix? = null, val locating: Boolean = false, val locationIssue: String? = null, // DENIED | OFF | UNAVAILABLE | MANUAL_FAILED | OUTSIDE
    val loading: Boolean = false, val result: NearbyResponse? = null, val error: ApiResult.Err? = null,
    val vehicleType: String? = null, val connector: String? = null, val radiusKm: Double = 10.0, val exclude: List<String> = emptyList(),
    val active: ChargeRequest? = null, val creating: Boolean = false, val createError: String? = null,
)

class FindViewModel : ViewModel() {
    private val c = NearVoltApp.instance.container
    val state = MutableStateFlow(FindState())
    private var createKey: String? = null

    fun init(me: Me?, exclude: String?) {
        if (state.value.vehicleType == null) state.update { it.copy(vehicleType = me?.vehicle?.type, connector = me?.vehicle?.connector) }
        exclude?.let { e -> state.update { it.copy(exclude = e.split(',').filter(String::isNotBlank)) } }
        loadActive()
    }
    fun loadActive() = viewModelScope.launch {
        (c.repo.requests("customer", activeOnly = true) as? ApiResult.Ok)?.let { r -> state.update { it.copy(active = r.value.items.firstOrNull()) } }
    }
    fun locate() = viewModelScope.launch {
        state.update { it.copy(locating = true, locationIssue = null) }
        when (val r = c.location.current()) {
            is LocationResult.Found -> { state.update { it.copy(fix = r.fix, locating = false) }; c.discovery.update { it.copy(fix = r.fix) }; search() }
            LocationResult.PermissionDenied -> state.update { it.copy(locating = false, locationIssue = "DENIED") }
            LocationResult.ServicesOff -> state.update { it.copy(locating = false, locationIssue = "OFF") }
            LocationResult.Unavailable -> state.update { it.copy(locating = false, locationIssue = "UNAVAILABLE") }
        }
    }
    fun manual(input: String) = viewModelScope.launch {
        state.update { it.copy(locating = true, locationIssue = null) }
        val f = c.location.resolveManual(input)
        if (f == null) state.update { it.copy(locating = false, locationIssue = "MANUAL_FAILED") } else {
            state.update { it.copy(fix = f, locating = false) }; c.discovery.update { it.copy(fix = f) }
            c.auth.currentUser?.uid?.let { uid -> c.accountStore.update(uid) { d -> com.nearvolt.ev.data.prefs.LocalRules.addRecent(d, input, System.currentTimeMillis()) } }
            search()
        }
    }
    fun setFilters(vehicleType: String?, connector: String?) { state.update { it.copy(vehicleType = vehicleType, connector = connector?.ifBlank { null }) }; search() }
    fun search() = viewModelScope.launch {
        val s = state.value
        val fix = s.fix ?: return@launch
        state.update { it.copy(loading = true, error = null) }
        when (val r = c.repo.nearby(fix.point, s.radiusKm, s.connector, s.vehicleType, s.exclude)) {
            is ApiResult.Ok -> { state.update { it.copy(loading = false, result = r.value, locationIssue = if (r.value.serviceArea == null) "OUTSIDE" else null) }
                c.discovery.update { it.copy(nearby = r.value, at = System.currentTimeMillis()) } }
            is ApiResult.Err -> state.update { it.copy(loading = false, error = r) }
        }
    }
    fun create(host: HostSummary, note: String?, battery: Int?, onCreated: (String) -> Unit) = viewModelScope.launch {
        val s = state.value
        val fix = s.fix ?: return@launch
        val key = createKey ?: UUID.randomUUID().toString().also { createKey = it }
        state.update { it.copy(creating = true, createError = null) }
        val body = CreateRequestBody(host.hostId, s.vehicleType ?: host.vehicleTypes.first(), s.connector ?: host.connectors.first(), fix.point, true, note?.ifBlank { null }, battery)
        when (val r = c.repo.createRequest(body, key)) {
            is ApiResult.Ok -> { createKey = null; state.update { it.copy(creating = false, active = r.value) }; onCreated(r.value.id) }
            is ApiResult.Err -> { if (r.code != "OFFLINE") createKey = null; state.update { it.copy(creating = false, createError = r.message) }; if (r.code == "HOST_UNAVAILABLE") search() }
        }
    }
    fun clearCreateError() = state.update { it.copy(createError = null) }
    /** Server accepts 0.5–50 km (nearbyQuery schema); the UI clamps to that range. */
    fun setRadius(km: Double) { state.update { it.copy(radiusKm = km.coerceIn(1.0, 50.0)) }; search() }
    /** Reuse the session's last fix (in-memory only) so Map/Home/Emergency don't re-ask for GPS on every visit. */
    fun adoptCachedFix() { val snap = c.discovery.value; if (state.value.fix == null && snap.fix != null) { state.update { it.copy(fix = snap.fix, result = snap.nearby) }; search() } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FindScreen(app: AppViewModel, exclude: String?, openRequest: (String) -> Unit, vm: FindViewModel = viewModel()) {
    val appState by app.state.collectAsStateWithLifecycle()
    val s by vm.state.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    var selected by remember { mutableStateOf<HostSummary?>(null) }
    var manualOpen by remember { mutableStateOf(false) }
    LaunchedEffect(exclude) { vm.init(appState.me, exclude) }
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.locate() }
    val askLocation: () -> Unit = {
        if (NearVoltApp.instance.container.location.let { it.hasFine() || it.hasCoarse() }) { vm.locate(); Unit }
        else perm.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    PullToRefreshBox(isRefreshing = s.loading, onRefresh = { vm.search(); vm.loadActive() }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { HeroHeader(stringResource(R.string.find_title), stringResource(R.string.find_subtitle)) }
            s.active?.let { a -> item {
                NvCard(onClick = { openRequest(a.id) }, modifier = Modifier.sharedElement("req-${a.id}")) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.ElectricBolt, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) { Text(stringResource(R.string.find_active_request), style = MaterialTheme.typography.titleMedium); Text("${a.hostName} · ${RequestText.status(a.status)}", style = MaterialTheme.typography.bodyMedium) }
                        Icon(Icons.Outlined.ChevronRight, null)
                    }
                }
            } }
            item {
                NvCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.MyLocation, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(s.fix?.label ?: stringResource(R.string.find_no_location), style = MaterialTheme.typography.titleSmall)
                            s.fix?.let { if (it.approximate) Text(stringResource(R.string.find_location_approx), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = askLocation, enabled = !s.locating, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                            if (s.locating) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.find_use_location))
                        }
                        OutlinedButton(onClick = { manualOpen = true }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text(stringResource(R.string.find_enter_location)) }
                    }
                    when (s.locationIssue) {
                        "DENIED" -> InlineMessage(stringResource(R.string.find_issue_denied))
                        "OFF" -> { InlineMessage(stringResource(R.string.find_issue_off)); TextButton(onClick = { ctx.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }) { Text(stringResource(R.string.action_open_settings)) } }
                        "UNAVAILABLE" -> InlineMessage(stringResource(R.string.find_issue_unavailable))
                        "MANUAL_FAILED" -> InlineMessage(stringResource(R.string.find_issue_manual))
                        "OUTSIDE" -> InlineMessage(stringResource(R.string.find_issue_outside))
                    }
                }
            }
            item {
                val nearest = s.result?.items?.firstOrNull { it.bookableNow }
                com.nearvolt.ev.ui.components.EmergencyButton(
                    label = stringResource(if (s.fix == null) R.string.emergency_find_nearest else if (nearest != null) R.string.emergency_nearest_found else R.string.emergency_none),
                    enabled = s.fix == null || nearest != null, loading = s.locating || s.loading,
                ) { if (s.fix == null) askLocation() else nearest?.let { selected = it } }
            }
            if (s.fix != null) item { Filters(s, vm) }
            when {
                s.fix == null -> item { Column { EvIllustration(charging = false, height = 120.dp); EmptyState(stringResource(R.string.find_start_title), stringResource(R.string.find_start_body)) } }
                s.error != null -> item { ErrorState(s.error!!) { vm.search() } }
                s.loading && s.result == null -> item { SkeletonList(3) }
                s.result != null && s.result!!.items.isEmpty() && s.locationIssue != "OUTSIDE" -> item { EmptyState(stringResource(R.string.find_empty_title), stringResource(R.string.find_empty_body)) }
                else -> {
                    s.result?.let { r ->
                        item { Text(stringResource(R.string.find_checked_at, Time.ago(r.checkedAt)) + " · " + stringResource(R.string.find_straight_line_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        if (r.items.any { it.approxArea != null }) item(key = "map") {
                            HostMap(r.items, s.fix?.point, selected?.hostId, MaterialTheme.colorScheme.background.luminance() < 0.5f, onSelect = { selected = it })
                        }
                        items(r.items, key = { it.hostId }) { h -> Box(Modifier.animateItem()) { HostCard(h) { selected = h } } }
                    }
                }
            }
            item {
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { Links.dial(ctx, Links.EMERGENCY) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Sos, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.emergency_call)) }
            }
        }
    }
    if (manualOpen) ManualLocationDialog(onDismiss = { manualOpen = false }) { manualOpen = false; vm.manual(it) }
    selected?.let { h ->
        ModalBottomSheet(onDismissRequest = { selected = null; vm.clearCreateError() }) {
            val batteryOk = appState.config?.capabilities?.batteryPercent == true
            HostDetail(h, s, batteryOk, onRequest = { note, battery -> vm.create(h, note, if (batteryOk) battery else null) { id -> selected = null; openRequest(id) } })
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun Filters(s: FindState, vm: FindViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = s.vehicleType == null, onClick = { vm.setFilters(null, s.connector) }, label = { Text(stringResource(R.string.filter_any_vehicle)) })
            VehicleTypes.ALL.forEach { t -> FilterChip(selected = s.vehicleType == t, onClick = { vm.setFilters(t, s.connector) }, label = { Text(Labels.vehicle(t)) }) }
        }
        ConnectorPicker(s.connector, { vm.setFilters(s.vehicleType, it) }, allowAny = true)
    }
}

@Composable
internal fun HostCard(h: HostSummary, onClick: () -> Unit) {
    val status = when { h.bookableNow -> stringResource(R.string.host_status_available) to Tone.Good; !h.openNow -> stringResource(R.string.host_status_closed) to Tone.Neutral; else -> stringResource(R.string.host_status_unavailable) to Tone.Warn }
    NvCard(onClick = onClick, modifier = Modifier.semantics { contentDescription = "${h.displayName}, ${Labels.km(h.straightLineKm)}, ${status.first}" }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(h.displayName, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            StatusPill(status.first, status.second)
        }
        Spacer(Modifier.height(6.dp))
        Text("${Labels.km(h.straightLineKm)} · ${Labels.kw(h.powerKw)} · ${h.connectors.joinToString { Labels.connector(it) }}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        h.rating?.let { Text("★ ${it.average} (${it.count})", style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
internal fun HostDetail(h: HostSummary, s: FindState, batterySupported: Boolean, favourite: Boolean = false, onFavourite: (() -> Unit)? = null, onRequest: (String?, Int?) -> Unit) {
    var confirmed by remember { mutableStateOf(false) }
    var battery by remember { mutableFloatStateOf(20f) }
    var batteryConfirmed by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    val connector = s.connector ?: h.connectors.firstOrNull().orEmpty()
    val compatible = (s.connector == null || h.connectors.contains(s.connector)) && (s.vehicleType == null || h.vehicleTypes.contains(s.vehicleType))
    Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 32.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LeadingBadge(Icons.Outlined.EvStation, if (h.bookableNow) Tone.Good else Tone.Neutral, 48.dp); Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(h.displayName, style = MaterialTheme.typography.headlineSmall)
                StatusPill(stringResource(if (h.bookableNow) R.string.host_status_available else R.string.host_status_unavailable), if (h.bookableNow) Tone.Good else Tone.Neutral)
            }
            if (onFavourite != null) IconButton(onClick = onFavourite) {
                Icon(if (favourite) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder, stringResource(if (favourite) R.string.fav_remove else R.string.fav_add), tint = MaterialTheme.colorScheme.primary)
            }
        }
        h.availabilityUpdatedAt?.let { Text(stringResource(R.string.data_updated, Time.ago(it)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Text(stringResource(R.string.detail_distance, Labels.km(h.straightLineKm)), style = MaterialTheme.typography.bodyMedium)
        DetailRow(stringResource(R.string.detail_power), "${Labels.kw(h.powerKw)} · ${if (h.phase == "three") "3-phase" else "1-phase"} · ${h.chargerType}")
        DetailRow(stringResource(R.string.detail_connectors), h.connectors.joinToString { Labels.connector(it) })
        DetailRow(stringResource(R.string.detail_vehicles), h.vehicleTypes.joinToString { Labels.vehicle(it) })
        Text(stringResource(R.string.detail_privacy_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!h.bookableNow) InlineMessage(stringResource(R.string.detail_not_bookable))
        else if (!compatible) InlineMessage(stringResource(R.string.detail_incompatible))
        else {
            OutlinedTextField(note, { note = it.take(300) }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.field_note_optional)) }, maxLines = 3)
            if (batterySupported) {
                Text(stringResource(R.string.battery_question, battery.toInt()), style = MaterialTheme.typography.titleSmall)
                Slider(battery, { battery = it; batteryConfirmed = false }, valueRange = 0f..100f, steps = 19,
                    modifier = Modifier.semantics { contentDescription = "Remaining battery ${battery.toInt()} percent" })
                CheckRow(batteryConfirmed, { batteryConfirmed = it }, stringResource(R.string.battery_confirm, battery.toInt()))
            }
            CheckRow(confirmed, { confirmed = it }, stringResource(R.string.detail_confirm_compat, Labels.connector(connector), Labels.kw(h.powerKw)))
            InlineMessage(s.createError)
            PrimaryButton(stringResource(R.string.detail_request), { onRequest(note, battery.toInt()) }, enabled = confirmed && (batteryConfirmed || !batterySupported), loading = s.creating)
        }
    }
}

@Composable
fun DetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(110.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}

@Composable
internal fun ManualLocationDialog(onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.manual_title)) },
        text = { Column { Text(stringResource(R.string.manual_body), style = MaterialTheme.typography.bodyMedium); Spacer(Modifier.height(8.dp))
            OutlinedTextField(text, { text = it.take(200) }, label = { Text(stringResource(R.string.manual_field)) }, singleLine = false, maxLines = 3) } },
        confirmButton = { TextButton(onClick = { onSubmit(text.trim()) }, enabled = text.trim().length >= 3) { Text(stringResource(R.string.action_search)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } })
}
