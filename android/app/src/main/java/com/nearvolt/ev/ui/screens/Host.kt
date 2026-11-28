package com.nearvolt.ev.ui.screens

import android.Manifest
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.foundation.background
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import com.nearvolt.ev.data.api.*
import com.nearvolt.ev.location.LocationResult
import com.nearvolt.ev.push.PushEvents
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.util.Labels
import com.nearvolt.ev.util.Time
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.sqrt

data class HostState(val listing: HostListing? = null, val incoming: List<ChargeRequest> = emptyList(), val error: ApiResult.Err? = null,
                     val busy: Boolean = false, val message: String? = null, val saved: Boolean = false, val recent: List<ChargeRequest>? = null)

class HostViewModel : ViewModel() {
    private val c = NearVoltApp.instance.container
    val state = MutableStateFlow(HostState())
    fun load() = viewModelScope.launch {
        when (val l = c.repo.myListing()) { is ApiResult.Ok -> state.update { it.copy(listing = l.value, error = null) }; is ApiResult.Err -> state.update { it.copy(error = l) } }
        (c.repo.requests("host", activeOnly = true) as? ApiResult.Ok)?.let { r -> state.update { it.copy(incoming = r.value.items) } }
        // Statistics use only the host's own request records from the server (first page). No earnings or energy figures exist.
        (c.repo.requests("host") as? ApiResult.Ok)?.let { r -> state.update { it.copy(recent = r.value.items) } }
    }
    fun setAvailable(on: Boolean, hours: Int?) = viewModelScope.launch {
        state.update { it.copy(busy = true, message = null) }
        val until = hours?.let { Instant.now().plus(it.toLong(), ChronoUnit.HOURS).toString() }
        when (val r = c.repo.setAvailability(on, until)) { is ApiResult.Err -> state.update { it.copy(busy = false, message = r.message) }; else -> { state.update { it.copy(busy = false) }; load() } }
    }
    fun save(b: HostProfileBody) = viewModelScope.launch {
        state.update { it.copy(busy = true, message = null, saved = false) }
        when (val r = c.repo.saveListing(b)) { is ApiResult.Ok -> state.update { it.copy(busy = false, listing = r.value, saved = true) }; is ApiResult.Err -> state.update { it.copy(busy = false, message = r.message) } }
    }
    fun submit() = viewModelScope.launch {
        state.update { it.copy(busy = true, message = null) }
        when (val r = c.repo.submitListing()) { is ApiResult.Err -> state.update { it.copy(busy = false, message = r.message) }; else -> { state.update { it.copy(busy = false) }; load() } }
    }
    fun upload(kind: String, uri: Uri) = viewModelScope.launch {
        val ctx = NearVoltApp.instance
        state.update { it.copy(busy = true, message = null) }
        val type = ctx.contentResolver.getType(uri) ?: ""
        val bytes = withContext(Dispatchers.IO) { runCatching { ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() }
        val msg = when {
            bytes == null -> "Could not read the file."
            bytes.size > 10 * 1024 * 1024 -> "File is larger than 10 MB."
            type !in setOf("image/jpeg", "image/png", "image/webp", "application/pdf") -> "Use JPEG, PNG, WebP or PDF."
            else -> when (val r = c.repo.upload(kind, type, bytes)) { is ApiResult.Err -> r.message; else -> null }
        }
        state.update { it.copy(busy = false, message = msg ?: "Uploaded.") }
        load()
    }
    suspend fun currentLocation(): LatLng? = (c.location.current() as? LocationResult.Found)?.fix?.point
}

@Composable
fun HostDashboard(openRequest: (String) -> Unit, openListing: () -> Unit, openHistory: () -> Unit, vm: HostViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.load(); PushEvents.events.collect { vm.load() } }
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val l = s.listing
        item {
            val online = l?.status == "APPROVED" && l.available
            HeroHeader(stringResource(R.string.dash_title), s.incoming.count { it.status == "REQUESTED" }.let { n -> androidx.compose.ui.res.pluralStringResource(R.plurals.dash_hero_sub, n, n) },
                live = online, liveLabel = stringResource(if (online) R.string.dash_online else R.string.dash_offline))
        }
        when {
            l == null && s.error != null -> item { ErrorState(s.error!!) { vm.load() } }
            l == null -> item { LoadingState() }
            else -> {
                item { ListingStatusCard(l, openListing) }
                if (l.status == "APPROVED") item { AvailabilityCard(l, s.busy) { on, h -> vm.setAvailable(on, h) } }
                item { InlineMessage(s.message) }
                item { SectionTitle(stringResource(R.string.dash_incoming)) }
                if (s.incoming.isEmpty()) item { EmptyState(stringResource(R.string.dash_no_requests), stringResource(R.string.dash_no_requests_body)) }
                items(s.incoming, key = { it.id }) { r ->
                    NvCard(onClick = { openRequest(r.id) }, modifier = Modifier.animateItem().sharedElement("req-${r.id}")) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(r.customerName ?: "", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            StatusPill(RequestText.status(r.status), RequestText.tone(r.status))
                        }
                        if (r.urgent && r.batteryPercent != null) StatusPill(stringResource(R.string.battery_urgent, r.batteryPercent), Tone.Bad)
                        Text("${Labels.vehicle(r.vehicleType)} · ${Labels.connector(r.connector)}" + (r.straightLineKm?.let { " · ${Labels.km(it)}" } ?: ""), style = MaterialTheme.typography.bodyMedium)
                        Text(Time.ago(r.createdAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                s.recent?.let { rec -> item { HostStats(rec) } }
                item { HostResponsibilities() }
                item { TextButton(onClick = openHistory) { Text(stringResource(R.string.dash_history)) } }
            }
        }
    }
}

@Composable
private fun ListingStatusCard(l: HostListing, openListing: () -> Unit) {
    val (label, tone, body) = when (l.status) {
        "APPROVED" -> Triple(stringResource(R.string.listing_approved), Tone.Good, stringResource(R.string.listing_approved_body))
        "PENDING_REVIEW" -> Triple(stringResource(R.string.listing_pending), Tone.Warn, stringResource(R.string.listing_pending_body))
        "REJECTED" -> Triple(stringResource(R.string.listing_rejected), Tone.Bad, l.rejectionReason ?: "")
        "SUSPENDED" -> Triple(stringResource(R.string.listing_suspended), Tone.Bad, stringResource(R.string.listing_suspended_body))
        else -> Triple(stringResource(R.string.listing_draft), Tone.Neutral, stringResource(R.string.listing_draft_body))
    }
    NvCard(onClick = openListing) {
        Row(verticalAlignment = Alignment.CenterVertically) { Text(l.displayName.ifBlank { stringResource(R.string.listing_unnamed) }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f)); StatusPill(label, tone) }
        Spacer(Modifier.height(6.dp)); Text(body, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun AvailabilityCard(l: HostListing, busy: Boolean, onSet: (Boolean, Int?) -> Unit) {
    var hours by remember { mutableStateOf<Int?>(null) }
    NvCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(if (l.available) R.string.avail_online else R.string.avail_offline), style = MaterialTheme.typography.titleMedium)
                l.availableUntil?.let { Text(stringResource(R.string.avail_until, Time.display(it)), style = MaterialTheme.typography.bodySmall) }
            }
            Switch(checked = l.available, onCheckedChange = { onSet(it, if (it) hours else null) }, enabled = !busy)
        }
        if (!l.available) {
            Text(stringResource(R.string.avail_for), style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(null, 2, 4, 8).forEach { h -> FilterChip(selected = hours == h, onClick = { hours = h }, label = { Text(h?.let { "$it h" } ?: stringResource(R.string.avail_no_limit)) }) }
            }
        }
        if (l.activeSessions > 0) Text(stringResource(R.string.avail_busy), style = MaterialTheme.typography.bodySmall)
    }
}

private val DAYS = listOf("mon", "tue", "wed", "thu", "fri", "sat", "sun")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ListingEditor(vm: HostViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { vm.load() }
    val l = s.listing ?: return LoadingState()
    val eq = l.equipment
    var name by remember(l.uid) { mutableStateOf(l.displayName) }
    var address by remember(l.uid) { mutableStateOf(l.address) }
    var lat by remember(l.uid) { mutableStateOf(l.location?.lat?.toString().orEmpty()) }
    var lng by remember(l.uid) { mutableStateOf(l.location?.lng?.toString().orEmpty()) }
    var chargerType by remember(l.uid) { mutableStateOf(eq?.chargerType ?: "socket") }
    var connectors by remember(l.uid) { mutableStateOf(eq?.connectors?.toSet() ?: setOf("DOMESTIC_15A")) }
    var vehicles by remember(l.uid) { mutableStateOf(eq?.vehicleTypes?.toSet() ?: setOf("two_wheeler")) }
    var voltage by remember(l.uid) { mutableStateOf(eq?.voltageV?.toString() ?: "230") }
    var current by remember(l.uid) { mutableStateOf(eq?.currentA?.toString() ?: "15") }
    var phase by remember(l.uid) { mutableStateOf(eq?.phase ?: "single") }
    var power by remember(l.uid) { mutableStateOf(eq?.powerKw?.toString() ?: "") }
    var capacity by remember(l.uid) { mutableIntStateOf(eq?.capacity ?: 1) }
    val firstSlot = l.hours?.values?.firstOrNull { it.isNotEmpty() }?.firstOrNull()
    var open by remember(l.uid) { mutableStateOf(firstSlot?.open ?: "08:00") }
    var close by remember(l.uid) { mutableStateOf(firstSlot?.close ?: "22:00") }
    var days by remember(l.uid) { mutableStateOf(l.hours?.filterValues { it.isNotEmpty() }?.keys ?: DAYS.toSet()) }
    val d = l.selfDeclaration
    var earthing by remember(l.uid) { mutableStateOf(d?.earthing ?: false) }
    var rcd by remember(l.uid) { mutableStateOf(d?.rcdOrElcb ?: false) }
    var dedicated by remember(l.uid) { mutableStateOf(d?.dedicatedCircuit ?: false) }
    var cabling by remember(l.uid) { mutableStateOf(d?.ratedCabling ?: false) }
    var covered by remember(l.uid) { mutableStateOf(d?.dryCoveredArea ?: false) }
    var accurate by remember(l.uid) { mutableStateOf(d?.accurateInformation ?: false) }
    val editable = l.status in setOf("DRAFT", "REJECTED", "PENDING_REVIEW", "APPROVED")
    val v = voltage.toDoubleOrNull(); val a = current.toDoubleOrNull()
    val maxKw = if (v != null && a != null) v * a * (if (phase == "three") sqrt(3.0) else 1.0) / 1000 else null
    val timeOk = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
    val valid = name.trim().length >= 2 && address.trim().length >= 5 && lat.toDoubleOrNull() != null && lng.toDoubleOrNull() != null && connectors.isNotEmpty() && vehicles.isNotEmpty() &&
        v != null && a != null && (power.toDoubleOrNull() ?: 0.0) > 0 && timeOk.matches(open) && timeOk.matches(close) && earthing && rcd && cabling && covered && accurate
    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { it?.let { u -> vm.upload("photo", u) } }
    val docPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let { u -> vm.upload("document", u) } }
    val locPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) scope.launch { vm.currentLocation()?.let { lat = "%.6f".format(Locale.US, it.lat); lng = "%.6f".format(Locale.US, it.lng) } }
    }

    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val steps = listOf(name.trim().length >= 2 && address.trim().length >= 5, lat.toDoubleOrNull() != null && lng.toDoubleOrNull() != null,
            connectors.isNotEmpty() && vehicles.isNotEmpty() && (power.toDoubleOrNull() ?: 0.0) > 0, timeOk.matches(open) && timeOk.matches(close),
            earthing && rcd && cabling && covered && accurate, l.photos >= 2 && l.documents >= 1)
        HeroHeader(stringResource(R.string.listing_title), stringResource(R.string.listing_progress, steps.count { it }, steps.size))
        val prog by androidx.compose.animation.core.animateFloatAsState(steps.count { it } / steps.size.toFloat(), label = "listing")
        LinearProgressIndicator(progress = { prog }, modifier = Modifier.fillMaxWidth().height(6.dp), strokeCap = androidx.compose.ui.graphics.StrokeCap.Round)
        if (l.status == "APPROVED") Text(stringResource(R.string.listing_reverify_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SectionTitle(stringResource(R.string.listing_place))
        OutlinedTextField(name, { name = it.take(60) }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.field_listing_name)) }, singleLine = true, enabled = editable)
        OutlinedTextField(address, { address = it.take(300) }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.field_address_private)) }, enabled = editable, maxLines = 3)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(lat, { lat = it.take(12) }, Modifier.weight(1f), label = { Text("Latitude") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), enabled = editable)
            OutlinedTextField(lng, { lng = it.take(12) }, Modifier.weight(1f), label = { Text("Longitude") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), enabled = editable)
        }
        SecondaryButton(stringResource(R.string.listing_use_here), { locPerm.launch(Manifest.permission.ACCESS_FINE_LOCATION) }, icon = Icons.Outlined.MyLocation, enabled = editable)
        Text(stringResource(R.string.listing_location_privacy), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

        SectionTitle(stringResource(R.string.listing_equipment))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("socket", "wallbox", "portable").forEach { t -> FilterChip(chargerType == t, { chargerType = t }, label = { Text(t.replaceFirstChar(Char::uppercase)) }) } }
        Text(stringResource(R.string.field_connectors), style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Connectors.ALL.forEach { c -> FilterChip(c in connectors, { connectors = if (c in connectors) connectors - c else connectors + c }, label = { Text(Labels.connector(c)) }) } }
        Text(stringResource(R.string.field_vehicles), style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { VehicleTypes.ALL.forEach { t -> FilterChip(t in vehicles, { vehicles = if (t in vehicles) vehicles - t else vehicles + t }, label = { Text(Labels.vehicle(t)) }) } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(voltage, { voltage = it.take(5) }, Modifier.weight(1f), label = { Text("Voltage (V)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            OutlinedTextField(current, { current = it.take(5) }, Modifier.weight(1f), label = { Text("Current (A)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("single" to "1-phase", "three" to "3-phase").forEach { (k, lbl) -> FilterChip(phase == k, { phase = k }, label = { Text(lbl) }) } }
        OutlinedTextField(power, { power = it.take(6) }, Modifier.fillMaxWidth(), label = { Text("Charging power (kW)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            supportingText = { maxKw?.let { Text(stringResource(R.string.listing_power_hint, "%.1f".format(Locale.US, it))) } })
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.field_capacity), Modifier.weight(1f))
            IconButton(onClick = { if (capacity > 1) capacity-- }) { Icon(Icons.Outlined.Remove, "−") }; Text("$capacity"); IconButton(onClick = { if (capacity < 4) capacity++ }) { Icon(Icons.Outlined.Add, "+") }
        }

        SectionTitle(stringResource(R.string.listing_hours))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { DAYS.forEach { dd -> FilterChip(dd in days, { days = if (dd in days) days - dd else days + dd }, label = { Text(dd.replaceFirstChar(Char::uppercase)) }) } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(open, { open = it.take(5) }, Modifier.weight(1f), label = { Text(stringResource(R.string.field_opens)) }, singleLine = true, isError = !timeOk.matches(open))
            OutlinedTextField(close, { close = it.take(5) }, Modifier.weight(1f), label = { Text(stringResource(R.string.field_closes)) }, singleLine = true, isError = !timeOk.matches(close))
        }
        Text(stringResource(R.string.listing_hours_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

        SectionTitle(stringResource(R.string.listing_safety))
        Text(stringResource(R.string.listing_safety_body), style = MaterialTheme.typography.bodySmall)
        CheckRow(earthing, { earthing = it }, stringResource(R.string.decl_earthing))
        CheckRow(rcd, { rcd = it }, stringResource(R.string.decl_rcd))
        CheckRow(dedicated, { dedicated = it }, stringResource(R.string.decl_dedicated))
        CheckRow(cabling, { cabling = it }, stringResource(R.string.decl_cabling))
        CheckRow(covered, { covered = it }, stringResource(R.string.decl_covered))
        CheckRow(accurate, { accurate = it }, stringResource(R.string.decl_accurate))

        InlineMessage(s.message, isError = s.message != "Uploaded.")
        if (s.saved) InlineMessage(stringResource(R.string.listing_saved), isError = false)
        PrimaryButton(stringResource(R.string.action_save), {
            vm.save(HostProfileBody(name.trim(), address.trim(), LatLng(lat.toDouble(), lng.toDouble()),
                Equipment(chargerType, connectors.toList(), vehicles.toList(), v!!, a!!, phase, power.toDouble(), capacity),
                DAYS.associateWith { if (it in days) listOf(HoursSlot(open, close)) else emptyList() },
                SelfDeclaration(earthing, rcd, dedicated, cabling, covered, accurate)))
        }, enabled = valid && editable, loading = s.busy)

        SectionTitle(stringResource(R.string.listing_files))
        Text(stringResource(R.string.listing_files_body, l.photos, l.documents), style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, modifier = Modifier.weight(1f), enabled = !s.busy && l.location != null) { Text(stringResource(R.string.listing_add_photo)) }
            OutlinedButton(onClick = { docPicker.launch(arrayOf("application/pdf", "image/jpeg", "image/png")) }, modifier = Modifier.weight(1f), enabled = !s.busy && l.location != null) { Text(stringResource(R.string.listing_add_doc)) }
        }
        if (l.status in setOf("DRAFT", "REJECTED")) {
            Spacer(Modifier.height(8.dp))
            PrimaryButton(stringResource(R.string.listing_submit), { vm.submit() }, enabled = l.location != null && l.photos >= 2 && l.documents >= 1 && !s.busy)
            Text(stringResource(R.string.listing_submit_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun HostStats(rec: List<ChargeRequest>) {
    val done = rec.count { it.status == "COMPLETED" }; val active = rec.count { it.status in RequestText.ACTIVE }
    val missed = rec.count { it.status in setOf("REJECTED", "EXPIRED", "CANCELLED") }
    GlassCard {
        Text(stringResource(R.string.host_stats_title), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.host_stats_basis, rec.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        if (rec.size < 3) { Text(stringResource(R.string.host_stats_few), style = MaterialTheme.typography.bodyMedium); return@GlassCard }
        val reduced = rememberReducedMotion()
        listOf(Triple(R.string.filter_completed, done, MaterialTheme.colorScheme.primary), Triple(R.string.filter_active, active, com.nearvolt.ev.ui.theme.Brand.NeonMint),
            Triple(R.string.host_stats_missed, missed, MaterialTheme.colorScheme.outline)).forEach { (label, n, color) ->
            val frac by androidx.compose.animation.core.animateFloatAsState(n / rec.size.toFloat(), if (reduced) androidx.compose.animation.core.tween(0) else androidx.compose.animation.core.tween(700), label = "bar")
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
                Text(stringResource(label), style = MaterialTheme.typography.bodySmall, modifier = Modifier.width(96.dp))
                Box(Modifier.weight(1f).height(10.dp).background(MaterialTheme.colorScheme.surfaceVariant, androidx.compose.foundation.shape.RoundedCornerShape(50))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(frac).background(color, androidx.compose.foundation.shape.RoundedCornerShape(50))) }
                Text(" $n", style = MaterialTheme.typography.labelLarge, modifier = Modifier.width(36.dp))
            }
        }
    }
}

@Composable
private fun HostResponsibilities() {
    GlassCard {
        Row(verticalAlignment = Alignment.CenterVertically) { LeadingBadge(Icons.Outlined.Shield, Tone.Good, 36.dp); Spacer(Modifier.width(10.dp))
            Text(stringResource(R.string.host_resp_title), style = MaterialTheme.typography.titleSmall) }
        listOf(R.string.host_resp_1, R.string.host_resp_2, R.string.host_resp_3, R.string.host_resp_4).forEach { Text("• " + stringResource(it), style = MaterialTheme.typography.bodyMedium) }
    }
}
