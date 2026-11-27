package com.nearvolt.ev.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import com.nearvolt.ev.data.api.ApiResult
import com.nearvolt.ev.data.api.ChargeRequest
import com.nearvolt.ev.push.PushEvents
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.util.Labels
import com.nearvolt.ev.util.Links
import com.nearvolt.ev.util.Time
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

object RequestText {
    fun status(s: String) = when (s) {
        "REQUESTED" -> "Waiting for host"; "ACCEPTED" -> "Accepted"; "ARRIVED" -> "Arrived"; "CHARGING" -> "Charging"
        "COMPLETED" -> "Completed"; "REJECTED" -> "Declined"; "EXPIRED" -> "Expired"; "CANCELLED" -> "Cancelled"; "DISPUTED" -> "Under review"; else -> s
    }
    fun tone(s: String) = when (s) { "COMPLETED", "ACCEPTED", "CHARGING", "ARRIVED" -> Tone.Good; "REQUESTED" -> Tone.Warn; "REJECTED", "EXPIRED", "CANCELLED", "DISPUTED" -> Tone.Bad; else -> Tone.Neutral }
    val ACTIVE = setOf("REQUESTED", "ACCEPTED", "ARRIVED", "CHARGING")
}

data class RequestState(val req: ChargeRequest? = null, val error: ApiResult.Err? = null, val busy: String? = null, val actionError: String? = null)

class RequestViewModel : ViewModel() {
    private val repo = NearVoltApp.instance.container.repo
    val state = MutableStateFlow(RequestState())
    fun load(id: String) = viewModelScope.launch {
        when (val r = repo.request(id)) { is ApiResult.Ok -> state.update { it.copy(req = r.value, error = null) }; is ApiResult.Err -> state.update { it.copy(error = r) } }
    }
    fun refreshPin() = viewModelScope.launch {
        val id = state.value.req?.id ?: return@launch
        state.update { it.copy(busy = "pin", actionError = null) }
        when (val r = repo.reissuePin(id)) { is ApiResult.Ok -> state.update { it.copy(req = r.value, busy = null) }; is ApiResult.Err -> state.update { it.copy(busy = null, actionError = r.message) } }
    }
    fun act(action: String, reason: String? = null, pin: String? = null) = viewModelScope.launch {
        val id = state.value.req?.id ?: return@launch
        state.update { it.copy(busy = action, actionError = null) }
        when (val r = repo.transition(id, action, reason, pin)) {
            is ApiResult.Ok -> state.update { it.copy(req = r.value, busy = null) }
            is ApiResult.Err -> { state.update { it.copy(busy = null, actionError = r.message) }; load(id) }
        }
    }
    fun rate(stars: Int, comment: String?) = viewModelScope.launch {
        val id = state.value.req?.id ?: return@launch
        state.update { it.copy(busy = "rate") }
        when (val r = repo.feedback(id, stars, comment)) { is ApiResult.Ok -> { state.update { it.copy(busy = null) }; load(id) }; is ApiResult.Err -> state.update { it.copy(busy = null, actionError = r.message) } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RequestScreen(id: String, onBack: () -> Unit, findAlternatives: (String) -> Unit, openSupport: () -> Unit, vm: RequestViewModel = viewModel(key = "req_$id")) {
    val s by vm.state.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Refresh on resume, on matching push, and every 15 s only while the screen is visible and the request is active.
    LaunchedEffect(id) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            launch { PushEvents.events.filter { it == id }.collect { vm.load(id) } }
            while (true) { vm.load(id); delay(15_000); if (vm.state.value.req?.status !in RequestText.ACTIVE && vm.state.value.req != null) break }
        }
    }
    var confirm by remember { mutableStateOf<String?>(null) }
    var pinEntry by remember { mutableStateOf(false) }
    Scaffold(topBar = { TopAppBar(title = { Text(stringResource(R.string.request_title)) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.action_back)) } }) }) { pad ->
        val r = s.req
        when {
            r == null && s.error != null -> Box(Modifier.padding(pad)) { ErrorState(s.error!!) { vm.load(id) } }
            r == null -> LoadingState(Modifier.padding(pad))
            else -> Column(Modifier.padding(pad).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                val isCustomer = r.role == "customer"
                NvCard(modifier = Modifier.sharedElement("req-${r.id}")) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (isCustomer) r.hostName else r.customerName ?: "", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                        StatusPill(RequestText.status(r.status), RequestText.tone(r.status))
                    }
                    Spacer(Modifier.height(6.dp))
                    Text("${Labels.vehicle(r.vehicleType)} · ${Labels.connector(r.connector)}" + (r.straightLineKm?.let { " · ${Labels.km(it)} straight-line" } ?: ""), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    r.batteryPercent?.let { b -> Spacer(Modifier.height(6.dp)); StatusPill(if (r.urgent) stringResource(R.string.battery_urgent, b) else stringResource(R.string.battery_label, b), if (r.urgent) Tone.Bad else Tone.Neutral) }
                    r.note?.let { Spacer(Modifier.height(6.dp)); Text("“$it”", style = MaterialTheme.typography.bodyMedium) }
                    if (r.status == "REQUESTED") {
                        var left by remember(r.expiresAt) { mutableLongStateOf(Time.secondsUntil(r.expiresAt)) }
                        LaunchedEffect(r.expiresAt) { while (left > 0) { delay(1000); left = Time.secondsUntil(r.expiresAt) }; vm.load(id) }
                        Spacer(Modifier.height(8.dp))
                        Text(stringResource(if (isCustomer) R.string.request_waiting else R.string.request_respond_within, "%d:%02d".format(left / 60, left % 60)), style = MaterialTheme.typography.titleSmall)
                        LinearProgressIndicator(progress = { (left / 300f).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                    }
                }
                r.hostLocation?.let { loc ->
                    NvCard {
                        Text(stringResource(R.string.request_address), style = MaterialTheme.typography.titleSmall)
                        Text(loc.address, style = MaterialTheme.typography.bodyLarge)
                        Spacer(Modifier.height(10.dp))
                        PrimaryButton(stringResource(R.string.request_navigate), { Links.navigate(ctx, loc.mapsUrl) })
                    }
                }
                if (isCustomer && r.pinStatus != null) SessionPinCard(r, refreshing = s.busy == "pin") { vm.refreshPin() }
                if (r.status in setOf("ACCEPTED", "ARRIVED", "CHARGING")) EvIllustration(charging = r.status == "CHARGING", height = 120.dp)
                if (r.status == "CHARGING") ChargingProgress(r)
                InlineMessage(s.actionError)
                Actions(r, s.busy, onAct = { a -> when (a) { "cancel", "reject", "dispute" -> confirm = a; "start" -> pinEntry = true; else -> vm.act(a) } }, findAlternatives = { findAlternatives(r.hostId) })
                if (r.status == "COMPLETED" && !r.feedbackGiven) RateCard(busy = s.busy == "rate") { st, c -> vm.rate(st, c) }
                Timeline(r)
                if (r.status in RequestText.ACTIVE) SafetyCard()
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = openSupport, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.action_get_help)) }
                    OutlinedButton(onClick = { Links.dial(ctx, Links.EMERGENCY) }, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.emergency_short)) }
                }
            }
        }
    }
    if (pinEntry) {
        var pin by remember { mutableStateOf("") }
        AlertDialog(onDismissRequest = { pinEntry = false }, title = { Text(stringResource(R.string.pin_enter_title)) },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.pin_enter_body), style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(pin, { v -> pin = v.filter(Char::isDigit).take(4) }, singleLine = true, label = { Text(stringResource(R.string.pin_label)) },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.NumberPassword),
                    textStyle = MaterialTheme.typography.headlineMedium)
                if (s.req?.pinStatus == "LOCKED" || s.req?.pinStatus == "EXPIRED") InlineMessage(stringResource(R.string.pin_ask_refresh))
            } },
            confirmButton = { TextButton(onClick = { vm.act("start", pin = pin); pinEntry = false }, enabled = pin.length == 4) { Text(stringResource(R.string.action_start_charging)) } },
            dismissButton = { TextButton(onClick = { pinEntry = false }) { Text(stringResource(R.string.action_back)) } })
    }
    confirm?.let { a ->
        var reason by remember { mutableStateOf("") }
        AlertDialog(onDismissRequest = { confirm = null },
            title = { Text(stringResource(when (a) { "reject" -> R.string.confirm_reject; "dispute" -> R.string.confirm_dispute; else -> R.string.confirm_cancel })) },
            text = { OutlinedTextField(reason, { reason = it.take(300) }, label = { Text(stringResource(R.string.field_reason_optional)) }) },
            confirmButton = { TextButton(onClick = { vm.act(a, reason.ifBlank { null }); confirm = null }) { Text(stringResource(R.string.action_confirm)) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(stringResource(R.string.action_back)) } })
    }
}

@Composable
private fun Actions(r: ChargeRequest, busy: String?, onAct: (String) -> Unit, findAlternatives: () -> Unit) {
    val c = r.role == "customer"
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        when (r.status) {
            "REQUESTED" -> if (c) SecondaryButton(stringResource(R.string.action_cancel_request), { onAct("cancel") }, enabled = busy == null)
                else { PrimaryButton(stringResource(R.string.action_accept), { onAct("accept") }, loading = busy == "accept"); SecondaryButton(stringResource(R.string.action_decline), { onAct("reject") }, enabled = busy == null) }
            "ACCEPTED" -> { PrimaryButton(stringResource(if (c) R.string.action_i_arrived else R.string.action_customer_arrived), { onAct("arrive") }, loading = busy == "arrive"); SecondaryButton(stringResource(R.string.action_cancel_request), { onAct("cancel") }, enabled = busy == null) }
            "ARRIVED" -> if (c) Text(stringResource(R.string.request_wait_host_start), style = MaterialTheme.typography.bodyMedium)
                else PrimaryButton(stringResource(R.string.action_start_charging), { onAct("start") }, loading = busy == "start")
            "CHARGING" -> PrimaryButton(stringResource(R.string.action_complete), { onAct("complete") }, loading = busy == "complete")
            "REJECTED", "EXPIRED" -> if (c) PrimaryButton(stringResource(R.string.action_find_another), findAlternatives)
        }
        if (r.status in setOf("ACCEPTED", "ARRIVED", "CHARGING", "COMPLETED")) TextButton(onClick = { onAct("dispute") }, enabled = busy == null) { Text(stringResource(R.string.action_report_problem)) }
    }
}

@Composable
private fun RateCard(busy: Boolean, onRate: (Int, String?) -> Unit) {
    var stars by remember { mutableIntStateOf(0) }
    var comment by remember { mutableStateOf("") }
    NvCard {
        Text(stringResource(R.string.rate_title), style = MaterialTheme.typography.titleMedium)
        Row { (1..5).forEach { i -> IconButton(onClick = { stars = i }, modifier = Modifier.semantics { contentDescription = "$i star" }) { Icon(if (i <= stars) Icons.Outlined.Star else Icons.Outlined.StarOutline, null, tint = MaterialTheme.colorScheme.primary) } } }
        OutlinedTextField(comment, { comment = it.take(500) }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.field_comment_optional)) })
        Spacer(Modifier.height(8.dp))
        PrimaryButton(stringResource(R.string.action_submit), { onRate(stars, comment.ifBlank { null }) }, enabled = stars > 0, loading = busy)
    }
}

@Composable
private fun Timeline(r: ChargeRequest) {
    NvCard {
        Text(stringResource(R.string.request_timeline), style = MaterialTheme.typography.titleSmall)
        r.history.forEach { e ->
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.CheckCircle, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(8.dp))
                Text(RequestText.status(e.to), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                Text(Time.display(e.at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SafetyCard() = NvCard {
    Row { Icon(Icons.Outlined.HealthAndSafety, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.safety_title), style = MaterialTheme.typography.titleSmall) }
    Spacer(Modifier.height(6.dp))
    Text(stringResource(R.string.safety_body), style = MaterialTheme.typography.bodyMedium)
}

class HistoryViewModel : ViewModel() {
    private val repo = NearVoltApp.instance.container.repo
    val items = MutableStateFlow<List<ChargeRequest>>(emptyList())
    val error = MutableStateFlow<ApiResult.Err?>(null)
    val loading = MutableStateFlow(false)
    private var cursor: String? = null; private var end = false
    fun load(asRole: String, reset: Boolean = false) = viewModelScope.launch {
        if (loading.value || (end && !reset)) return@launch
        if (reset) { cursor = null; end = false }
        loading.value = true
        when (val r = repo.requests(asRole, cursor = cursor)) {
            is ApiResult.Ok -> { items.value = (if (reset) emptyList() else items.value) + r.value.items; cursor = r.value.nextCursor; end = cursor == null; error.value = null }
            is ApiResult.Err -> error.value = r
        }
        loading.value = false
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(asRole: String, open: (String) -> Unit, onBack: (() -> Unit)? = null, vm: HistoryViewModel = viewModel(key = "hist_$asRole")) {
    val items by vm.items.collectAsStateWithLifecycle(); val err by vm.error.collectAsStateWithLifecycle(); val loading by vm.loading.collectAsStateWithLifecycle()
    LaunchedEffect(asRole) { vm.load(asRole, reset = true) }
    Column {
        if (onBack != null) TopAppBar(title = { Text(stringResource(R.string.history_title)) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.action_back)) } })
        LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (onBack == null) item { Text(stringResource(R.string.history_title), style = MaterialTheme.typography.headlineMedium) }
            when {
                err != null && items.isEmpty() -> item { ErrorState(err!!) { vm.load(asRole, true) } }
                loading && items.isEmpty() -> item { LoadingState() }
                items.isEmpty() -> item { EmptyState(stringResource(R.string.history_empty_title), stringResource(R.string.history_empty_body)) }
                else -> {
                    items(items, key = { it.id }) { r ->
                        NvCard(onClick = { open(r.id) }, modifier = Modifier.animateItem().sharedElement("req-${r.id}")) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                LeadingBadge(if (r.status == "COMPLETED") Icons.Outlined.TaskAlt else if (r.status in RequestText.ACTIVE) Icons.Outlined.ElectricBolt else Icons.Outlined.History, RequestText.tone(r.status))
                                Spacer(Modifier.width(12.dp))
                                Text(if (asRole == "customer") r.hostName else r.customerName ?: "", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                                StatusPill(RequestText.status(r.status), RequestText.tone(r.status))
                            }
                            Text(Time.display(r.createdAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    item { LaunchedEffect(items.size) { vm.load(asRole) } }
                }
            }
        }
    }
}

@Composable
private fun SessionPinCard(r: ChargeRequest, refreshing: Boolean, onRefresh: () -> Unit) {
    NvCard {
        Text(stringResource(R.string.pin_title), style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(6.dp))
        when (r.pinStatus) {
            "ACTIVE" -> {
                Text(r.pin.orEmpty().toCharArray().joinToString("  "), style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.semantics { contentDescription = "PIN " + r.pin.orEmpty().toCharArray().joinToString(" ") })
                Text(stringResource(R.string.pin_share_body), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            "LOCKED" -> InlineMessage(stringResource(R.string.pin_locked))
            else -> InlineMessage(stringResource(R.string.pin_expired))
        }
        TextButton(onClick = onRefresh, enabled = !refreshing) { Text(stringResource(R.string.pin_refresh)) }
    }
}

/** Elapsed-time view while charging. NEARVOLT EV has no metering hardware, so no energy (kWh) figure is shown. */
@Composable
private fun ChargingProgress(r: ChargeRequest) {
    val startedAt = r.history.lastOrNull { it.to == "CHARGING" }?.at
    var elapsed by remember(startedAt) { mutableLongStateOf(-Time.secondsUntil(startedAt)) }
    LaunchedEffect(startedAt) { while (true) { elapsed = -Time.secondsUntil(startedAt); delay(1000) } }
    NvCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.ElectricBolt, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.charging_in_progress), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            if (elapsed >= 0) Text("%d:%02d:%02d".format(elapsed / 3600, elapsed / 60 % 60, elapsed % 60), style = MaterialTheme.typography.titleMedium)
        }
        Spacer(Modifier.height(10.dp))
        com.nearvolt.ev.ui.components.EnergyFlowBar(Modifier.fillMaxWidth())
        Text(stringResource(R.string.charging_no_metering), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
