package com.nearvolt.ev.ui.screens

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import com.nearvolt.ev.data.api.HostSummary
import com.nearvolt.ev.data.api.VehicleTypes
import com.nearvolt.ev.data.prefs.LocalAccountData
import com.nearvolt.ev.data.prefs.LocalRules
import com.nearvolt.ev.ui.AppViewModel
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.util.Labels
import com.nearvolt.ev.util.Time
import kotlinx.coroutines.launch

/** Client-side refinements on top of the server's compatible results (server already filters vehicle/connector). */
data class MapFilters(val availableOnly: Boolean = false, val power: String = "any") {
    fun apply(items: List<HostSummary>) = items.filter { h ->
        (!availableOnly || h.bookableNow) && when (power) { "le7" -> h.powerKw <= 7.0; "7to22" -> h.powerKw > 7.0 && h.powerKw <= 22.0; "gt22" -> h.powerKw > 22.0; else -> true }
    }
    val active get() = availableOnly || power != "any"
}

/**
 * Dedicated full-screen map tab. Reuses the existing MapLibre + OpenFreeMap engine (HostMap) and the existing FindViewModel
 * (same authorized /hosts/nearby endpoint, same request creation flow). The map composes only while this tab is visible and
 * is destroyed when the user leaves it (HostMap's lifecycle observer), so no tiles load in the background.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun MapScreen(app: AppViewModel, openRequest: (String) -> Unit, openEmergency: () -> Unit, openAlerts: () -> Unit, vm: FindViewModel = viewModel(key = "map")) {
    val appState by app.state.collectAsStateWithLifecycle()
    val s by vm.state.collectAsStateWithLifecycle()
    val c = NearVoltApp.instance.container
    val uid = appState.me?.uid
    val local by remember(uid) { if (uid != null) c.accountStore.data(uid) else kotlinx.coroutines.flow.flowOf(LocalAccountData()) }.collectAsStateWithLifecycle(LocalAccountData())
    val scope = rememberCoroutineScope()
    // Low-data mode: start in list view so no map tiles are fetched until the user switches to the map.
    // null = user hasn't chosen in this visit; until the preference is known the list is shown (no tile fetch).
    val lowData by c.prefs.lowData.collectAsStateWithLifecycle(null)
    var userListMode by rememberSaveable { mutableStateOf<Boolean?>(null) }
    // null until the preference is read: render neither map nor list (no tile fetch, no list→map flash).
    val listMode: Boolean? = userListMode ?: lowData
    var filters by remember { mutableStateOf(MapFilters()) }
    var filterSheet by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<HostSummary?>(null) }
    var manualOpen by remember { mutableStateOf(false) }
    var recenter by remember { mutableIntStateOf(0) }
    var mapFailed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.init(appState.me, null); vm.adoptCachedFix() }
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.locate() }
    val locate: () -> Unit = {
        if (c.location.hasFine() || c.location.hasCoarse()) { vm.locate(); Unit }
        else perm.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }
    val hosts = remember(filters, s.result) { filters.apply(s.result?.items.orEmpty()) }
    val initialCenter = appState.config?.serviceAreas?.firstOrNull()?.center
    val dark = isDarkSurface()
    val showList = listMode == true || mapFailed
    val modeKnown = listMode != null || mapFailed
    LaunchedEffect(s.fix, s.loading, hosts) {
        if (!s.creating && selected != null && (s.loading || hosts.none { it.hostId == selected?.hostId })) {
            selected = null
            vm.clearCreateError()
        }
    }

    Column(Modifier.fillMaxSize()) {
        // ---- Top glass controls ----
        Column(Modifier.fillMaxWidth().voltAvoid("map-top").padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            GlassCard(overMap = true) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LeadingBadge(Icons.Outlined.Map, Tone.Good, 36.dp); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.map_title), style = MaterialTheme.typography.titleMedium)
                        Text(s.fix?.label ?: stringResource(R.string.map_subtitle), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                    IconButton(onClick = { manualOpen = true }) { Icon(Icons.Outlined.Search, stringResource(R.string.find_enter_location)) }
                    IconButton(onClick = openAlerts) { Icon(Icons.Outlined.Notifications, stringResource(R.string.tab_alerts)) }
                }
            }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(!showList, { userListMode = false; mapFailed = false }, SegmentedButtonDefaults.itemShape(0, 2), icon = {}) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.Outlined.Map, null, Modifier.size(16.dp))
                        Text(stringResource(R.string.map_tab))
                    }
                }
                SegmentedButton(showList, { userListMode = true }, SegmentedButtonDefaults.itemShape(1, 2), icon = {}) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.Outlined.List, null, Modifier.size(16.dp))
                        Text(stringResource(R.string.map_list))
                    }
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(s.vehicleType != null || s.connector != null || filters.active, { filterSheet = true }, label = { Text(stringResource(R.string.map_filters)) },
                    leadingIcon = { Icon(Icons.Outlined.Tune, null, Modifier.size(18.dp)) })
                FilterChip(filters.availableOnly, { filters = filters.copy(availableOnly = !filters.availableOnly) }, label = { Text(stringResource(R.string.map_available)) })
                AssistChip({ filterSheet = true }, label = { Text(stringResource(R.string.map_radius, s.radiusKm.toInt())) })
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
        // ---- Map or list body ----
        if (modeKnown) AnimatedContent(showList, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "mapList", modifier = Modifier.fillMaxSize()) { list ->
            if (!list) {
                if (s.fix != null || initialCenter != null) HostMap(hosts, s.fix?.point, selected?.hostId, dark, onSelect = { selected = it }, modifier = Modifier.fillMaxSize(),
                    fullScreen = true, recenterKey = recenter, initialCenter = initialCenter, onFailed = { mapFailed = true })
                else Box(Modifier.fillMaxSize().ambient(), contentAlignment = Alignment.Center) { EvIllustration(Modifier.padding(32.dp), charging = false, height = 160.dp) }
            } else {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (mapFailed) item { InlineMessage(stringResource(R.string.map_failed_list)) }
                    when {
                        s.loading && s.result == null -> item { SkeletonList(4) }
                        s.error != null -> item { ErrorState(s.error!!) { vm.search() } }
                        s.fix != null && hosts.isEmpty() -> item { EmptyState(stringResource(R.string.find_empty_title), stringResource(if (filters.active) R.string.map_empty_filtered else R.string.find_empty_body)) }
                        s.fix == null -> item { EmptyState(stringResource(R.string.find_start_title), stringResource(R.string.find_start_body)) }
                        else -> items(hosts, key = { it.hostId }) { h ->
                            Box(Modifier.animateItem()) { HostCard(h) { selected = h } }
                        }
                    }
                }
            }
        }

        // ---- Right controls ----
        if (modeKnown && !showList) Column(Modifier.align(Alignment.CenterEnd).voltAvoid("map-controls").padding(end = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SmallFloatingActionButton(onClick = { if (s.fix != null) recenter++ else if (!s.locating) locate() }, containerColor = MaterialTheme.colorScheme.surface) {
                if (s.locating) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.MyLocation, stringResource(R.string.map_recenter))
            }
        }

        }
        // ---- Bottom summary ----
        Column(Modifier.fillMaxWidth().voltAvoid("map-bottom").padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            GlassCard(overMap = true) {
                when {
                    s.fix == null -> {
                        Text(stringResource(R.string.find_start_title), style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.find_start_body), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = locate, enabled = !s.locating, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.find_use_location)) }
                            OutlinedButton(onClick = { manualOpen = true }, enabled = !s.locating, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.find_enter_location)) }
                        }
                        when (s.locationIssue) {
                            "DENIED" -> InlineMessage(stringResource(R.string.find_issue_denied))
                            "OFF" -> InlineMessage(stringResource(R.string.find_issue_off))
                            "UNAVAILABLE" -> InlineMessage(stringResource(R.string.find_issue_unavailable))
                            "MANUAL_FAILED" -> InlineMessage(stringResource(R.string.find_issue_manual))
                            else -> Unit
                        }
                    }
                    s.error != null -> {
                        InlineMessage(s.error!!.message)
                        TextButton(onClick = { vm.search() }) { Text(stringResource(R.string.action_retry)) }
                    }
                    s.loading && s.result == null -> { Text(stringResource(R.string.map_loading), style = MaterialTheme.typography.titleSmall); Spacer(Modifier.height(6.dp)); EnergyFlowBar(Modifier.fillMaxWidth(), 4.dp) }
                    else -> {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(stringResource(R.string.map_count, hosts.size, hosts.count { it.bookableNow }), style = MaterialTheme.typography.titleMedium)
                                Text(stringResource(R.string.map_freshness, s.radiusKm.toInt(), Time.ago(s.result?.checkedAt)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (s.loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        }
                        if (s.locationIssue == "OUTSIDE") InlineMessage(stringResource(R.string.find_issue_outside))
                    }
                }
            }
            OutlinedButton(onClick = openEmergency, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.outlinedButtonColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Icon(Icons.Outlined.Sos, null, tint = MaterialTheme.colorScheme.error); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.home_emergency))
            }
        }
    }

    if (manualOpen) ManualLocationDialog(onDismiss = { manualOpen = false }) { manualOpen = false; vm.manual(it) }
    if (filterSheet) ModalBottomSheet(onDismissRequest = { filterSheet = false }) {
        MapFilterSheet(s, filters, onApply = { v, connector, radius, f ->
            selected = null; filters = f; vm.applyMapFilters(v, connector, radius); filterSheet = false
        })
    }
    selected?.let { h ->
        val fav = local.favourites.any { it.hostId == h.hostId }
        ModalBottomSheet(onDismissRequest = { selected = null; vm.clearCreateError() }) {
            val batteryOk = appState.config?.capabilities?.batteryPercent == true
            HostDetail(h, s, batteryOk, favourite = fav,
                onFavourite = uid?.let { u -> { scope.launch { c.accountStore.update(u) { d -> LocalRules.toggleFavourite(d, h.hostId, h.displayName, System.currentTimeMillis()) } } } },
                onRequest = { note, battery, sc -> vm.create(h, note, if (batteryOk) battery else null, sc) { id -> selected = null; openRequest(id) } })
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MapFilterSheet(s: FindState, f: MapFilters, onApply: (String?, String?, Double, MapFilters) -> Unit) {
    var radius by remember { mutableFloatStateOf(s.radiusKm.toFloat()) }
    var vehicle by remember { mutableStateOf(s.vehicleType) }
    var connector by remember { mutableStateOf(s.connector) }
    var draft by remember { mutableStateOf(f) }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.map_filter_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.field_vehicles), style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(vehicle == null, { vehicle = null }, label = { Text(stringResource(R.string.filter_any_vehicle)) })
            VehicleTypes.ALL.forEach { t -> FilterChip(vehicle == t, { vehicle = t }, label = { Text(Labels.vehicle(t)) }) }
        }
        Text(stringResource(R.string.field_connector), style = MaterialTheme.typography.titleSmall)
        ConnectorPicker(connector, { connector = it }, allowAny = true)
        Text(stringResource(R.string.detail_power), style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("any" to "Any", "le7" to "≤ 7 kW", "7to22" to "7–22 kW", "gt22" to "> 22 kW").forEach { (k, l) ->
                FilterChip(draft.power == k, { draft = draft.copy(power = k) }, label = { Text(l) })
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.map_available_only), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Switch(draft.availableOnly, { draft = draft.copy(availableOnly = it) })
        }
        Text(stringResource(R.string.map_radius, radius.toInt()), style = MaterialTheme.typography.titleSmall)
        Slider(radius, { radius = it }, valueRange = 1f..50f, steps = 48)
        Text(stringResource(R.string.find_straight_line_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { draft = MapFilters(); vehicle = null; connector = null; radius = 10f }, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.action_reset)) }
            Button(onClick = { onApply(vehicle, connector, radius.toDouble(), draft) }, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.action_done)) }
        }
    }
}
