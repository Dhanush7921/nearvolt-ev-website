package com.nearvolt.ev.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import com.nearvolt.ev.catalogue.*
import com.nearvolt.ev.data.api.ApiResult
import com.nearvolt.ev.data.api.TicketBody
import com.nearvolt.ev.data.prefs.GarageVehicle
import com.nearvolt.ev.data.prefs.LocalAccountData
import com.nearvolt.ev.data.prefs.LocalRules
import com.nearvolt.ev.ui.AppViewModel
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.ui.theme.Brand
import com.nearvolt.ev.util.Links
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.UUID

/** Session-only compare tray (max 3 configurations). Not persisted. */
object CompareTray {
    val ids = MutableStateFlow<List<String>>(emptyList())
    const val MAX = 3
    fun toggle(id: String): Boolean {
        var ok = true
        ids.update { if (id in it) it - id else if (it.size >= MAX) { ok = false; it } else it + id }
        return ok
    }
}

data class CatalogueUi(val file: CatalogueFile? = null, val error: String? = null, val filter: CatalogueFilter = CatalogueFilter())

class CatalogueViewModel : ViewModel() {
    val state = MutableStateFlow(CatalogueUi(CatalogueRepo.peek()))
    init { if (state.value.file == null) viewModelScope.launch {
        runCatching { CatalogueRepo.load(NearVoltApp.instance) }.onSuccess { f -> state.update { it.copy(file = f) } }
            .onFailure { e -> state.update { it.copy(error = "Vehicle catalogue could not be loaded (${e.javaClass.simpleName}).") } }
    } }
    fun filter(f: (CatalogueFilter) -> CatalogueFilter) = state.update { it.copy(filter = f(it.filter)) }
}

private fun fmt(d: Double) = if (d % 1.0 == 0.0) d.toInt().toString() else String.format(Locale.US, "%.1f", d)
private const val NV = "Not publicly verified"

// ============================== CATALOGUE LIST ==============================
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogueScreen(app: AppViewModel, onBack: () -> Unit, openVehicle: (String) -> Unit, openCompare: () -> Unit, vm: CatalogueViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val uid = app.state.collectAsStateWithLifecycle().value.me?.uid
    val c = NearVoltApp.instance.container
    val local by remember(uid) { uid?.let { c.accountStore.data(it) } ?: kotlinx.coroutines.flow.flowOf(LocalAccountData()) }.collectAsStateWithLifecycle(LocalAccountData())
    val compare by CompareTray.ids.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }   // 0 all, 1 favourites, 2 recent
    var showClaims by rememberSaveable { mutableStateOf(false) }
    Scaffold(topBar = { TopAppBar(title = { Text(stringResource(R.string.cat_title)) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.action_back)) } }) },
        bottomBar = { AnimatedVisibility(compare.isNotEmpty()) {
            Surface(tonalElevation = 3.dp, modifier = Modifier.navigationBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.cat_compare_count, compare.size, CompareTray.MAX), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                    TextButton(onClick = { CompareTray.ids.value = emptyList() }) { Text(stringResource(R.string.action_clear_all)) }
                    Button(onClick = openCompare, enabled = compare.size >= 2) { Text(stringResource(R.string.cat_compare)) }
                }
            }
        } }) { pad ->
        val file = s.file
        if (file == null) { Box(Modifier.padding(pad)) { if (s.error != null) CenterState(Icons.Outlined.ErrorOutline, stringResource(R.string.cat_title), s.error!!) else LoadingState() }; return@Scaffold }
        val base = when (tab) { 1 -> file.vehicles.filter { it.id in local.favVehicles }; 2 -> local.recentVehicles.mapNotNull { id -> file.vehicles.firstOrNull { it.id == id } }; else -> file.vehicles }
        val list = remember(base, s.filter, tab) { if (tab == 2) CatalogueSearch.apply(base, s.filter.copy(sort = CatalogueFilter.Sort.BRAND)).let { r -> base.filter { it in r } } else CatalogueSearch.apply(base, s.filter) }
        val brands = remember(file) { file.vehicles.map { it.brand }.distinct().sorted() }
        LazyColumn(Modifier.padding(pad).fillMaxSize().ambient(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "intro") {
                GlassCard(accent = true) {
                    Text(stringResource(R.string.cat_intro_title, file.vehicles.size, file.vehicles.map { it.brand to it.model }.distinct().size), style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.cat_intro_body, file.meta.researchCutoff ?: "—"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item(key = "search") {
                OutlinedTextField(s.filter.query, { q -> vm.filter { it.copy(query = q.take(60)) } }, Modifier.fillMaxWidth(), singleLine = true,
                    leadingIcon = { Icon(Icons.Outlined.Search, null) }, placeholder = { Text(stringResource(R.string.cat_search_hint)) },
                    trailingIcon = { if (s.filter.query.isNotEmpty()) IconButton(onClick = { vm.filter { it.copy(query = "") } }) { Icon(Icons.Outlined.Close, stringResource(R.string.action_clear_all)) } },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search))
            }
            item(key = "tabs") {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    listOf(stringResource(R.string.cat_all), stringResource(R.string.cat_favourites, local.favVehicles.size), stringResource(R.string.cat_recent)).forEachIndexed { i, l ->
                        SegmentedButton(tab == i, { tab = i }, SegmentedButtonDefaults.itemShape(i, 3)) { Text(l, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
            item(key = "brands") {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(s.filter.brand == null, { vm.filter { it.copy(brand = null) } }, label = { Text(stringResource(R.string.cat_all_brands)) })
                    brands.forEach { b -> FilterChip(s.filter.brand == b, { vm.filter { f -> f.copy(brand = if (f.brand == b) null else b) } },
                        label = { Text(file.vehicles.first { it.brand == b }.shortBrand) }) }
                }
            }
            item(key = "filters") {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilterChip(s.filter.currentOnly, { vm.filter { it.copy(currentOnly = !it.currentOnly) } }, label = { Text(stringResource(R.string.cat_f_current)) })
                    FilterChip(s.filter.dcOnly, { vm.filter { it.copy(dcOnly = !it.dcOnly) } }, label = { Text(stringResource(R.string.cat_f_dc)) })
                    FilterChip(s.filter.verifiedAcOnly, { vm.filter { it.copy(verifiedAcOnly = !it.verifiedAcOnly) } }, label = { Text(stringResource(R.string.cat_f_verified_ac)) })
                    var open by remember { mutableStateOf(false) }
                    Box {
                        AssistChip({ open = true }, label = { Text(stringResource(R.string.cat_sort, stringResource(sortLabel(s.filter.sort)))) }, leadingIcon = { Icon(Icons.Outlined.Sort, null, Modifier.size(18.dp)) })
                        DropdownMenu(open, { open = false }) { CatalogueFilter.Sort.entries.forEach { so -> DropdownMenuItem({ Text(stringResource(sortLabel(so))) }, { vm.filter { it.copy(sort = so) }; open = false }) } }
                    }
                }
            }
            item(key = "count") { Text(stringResource(R.string.cat_results, list.size), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (list.isEmpty()) item(key = "empty") { EmptyState(stringResource(R.string.cat_empty), stringResource(if (tab == 1) R.string.cat_empty_fav else R.string.cat_empty_body)) }
            items(list, key = { it.id }) { v ->
                VehicleRow(v, favourite = v.id in local.favVehicles, inCompare = v.id in compare, modifier = Modifier.animateItem(), onClick = { openVehicle(v.id) },
                    onCompare = { CompareTray.toggle(v.id) })
            }
            item(key = "claimsHead") {
                Spacer(Modifier.height(6.dp))
                GlassCard(onClick = { showClaims = !showClaims }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LeadingBadge(Icons.Outlined.HelpOutline, Tone.Warn, 36.dp); Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(R.string.cat_claims_title, file.supplementaryClaims.size), style = MaterialTheme.typography.titleSmall)
                            Text(stringResource(R.string.cat_claims_body), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(if (showClaims) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null)
                    }
                }
            }
            if (showClaims) items(file.supplementaryClaims, key = { "claim-" + it.model }) { cl ->
                GlassCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(cl.model, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f)); StatusPill(stringResource(R.string.cat_unverified), Tone.Warn)
                    }
                    listOfNotNull(cl.batteryAsPrinted?.let { "Battery (kWh), as printed: $it" }, cl.acAsPrinted?.let { "AC, as printed: $it" }, cl.dcAsPrinted?.let { "DC, as printed: $it" },
                        cl.timeAsPrinted?.let { "Time, as printed: $it" }).forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                    Text(cl.source, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

private fun sortLabel(s: CatalogueFilter.Sort) = when (s) { CatalogueFilter.Sort.BRAND -> R.string.cat_sort_brand; CatalogueFilter.Sort.RANGE -> R.string.cat_sort_range
    CatalogueFilter.Sort.BATTERY -> R.string.cat_sort_battery; CatalogueFilter.Sort.NEWEST -> R.string.cat_sort_newest }

@Composable
private fun VehicleRow(v: CatalogueVehicle, favourite: Boolean, inCompare: Boolean, modifier: Modifier, onClick: () -> Unit, onCompare: () -> Unit) {
    GlassCard(onClick = onClick, modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            VehicleArt(v, Modifier.size(64.dp, 48.dp), compact = true)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(v.shortBrand.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    if (favourite) { Spacer(Modifier.width(4.dp)); Icon(Icons.Outlined.Favorite, null, Modifier.size(12.dp), tint = MaterialTheme.colorScheme.primary) }
                }
                Text(v.model, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(v.variant, v.year?.toString()).joinToString(" · "), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(listOf(v.batteryKwh?.let { "${fmt(it)} kWh" } ?: "kWh n/v", v.rangeKm?.let { "${fmt(it)} km*" } ?: "range n/v",
                    if (v.dcSupported == true) "DC" else if (v.dcSupported == false) "AC only" else "DC n/v").joinToString(" · "), style = MaterialTheme.typography.labelMedium)
            }
            IconButton(onClick = onCompare) {
                Icon(if (inCompare) Icons.Outlined.CheckCircle else Icons.Outlined.CompareArrows, stringResource(if (inCompare) R.string.cat_compare_remove else R.string.cat_compare_add),
                    tint = if (inCompare) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (!v.isCurrent) Text(v.status ?: "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Original vector illustration (no third-party images: no image rights were established for any catalogue vehicle). Always labelled. */
@Composable
fun VehicleArt(v: CatalogueVehicle, modifier: Modifier, compact: Boolean = false) {
    val seed = (v.model.hashCode() and 0x7fffffff)
    val hue = listOf(Brand.EmeraldBrand, Brand.NeonMint, Color(0xFF3FB98A), Color(0xFF7FD6B7))[seed % 4]
    val body = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.82f)
    val bg = MaterialTheme.colorScheme.surfaceVariant
    Box(modifier.clip(RoundedCornerShape(if (compact) 12.dp else 20.dp)).background(Brush.linearGradient(listOf(bg, hue.copy(alpha = 0.22f))))
        .semantics { contentDescription = "Illustration of ${v.model}; not a photograph" }) {
        Canvas(Modifier.fillMaxSize().padding(if (compact) 6.dp else 18.dp)) {
            val w = size.width; val h = size.height
            val suv = v.model.contains("XUV", true) || v.model.contains("Harrier", true) || v.model.contains("XEV", true) || v.model.contains("BE ", true) || v.model.contains("Safari", true)
            val roof = if (suv) 0.22f else 0.34f
            // body + cabin (generic hatch/SUV silhouette)
            drawRoundRect(body, Offset(0f, h * 0.48f), Size(w, h * 0.32f), CornerRadius(h * 0.14f))
            val cabin = androidx.compose.ui.graphics.Path().apply {
                moveTo(w * 0.18f, h * 0.5f); lineTo(w * 0.32f, h * roof); lineTo(w * 0.70f, h * roof); lineTo(w * 0.86f, h * 0.5f); close() }
            drawPath(cabin, body)
            drawPath(androidx.compose.ui.graphics.Path().apply { moveTo(w * 0.26f, h * 0.49f); lineTo(w * 0.35f, h * (roof + 0.05f)); lineTo(w * 0.66f, h * (roof + 0.05f)); lineTo(w * 0.77f, h * 0.49f); close() }, bg.copy(alpha = 0.85f))
            drawLine(hue, Offset(w * 0.04f, h * 0.62f), Offset(w * 0.96f, h * 0.62f), strokeWidth = h * 0.035f)   // emerald light bar
            listOf(0.24f, 0.76f).forEach { x -> drawCircle(Color(0xFF151A18), h * 0.12f, Offset(w * x, h * 0.8f)); drawCircle(hue, h * 0.05f, Offset(w * x, h * 0.8f)) }
            if (v.dcSupported == true) drawCircle(hue, h * 0.05f, Offset(w * 0.92f, h * 0.54f), style = Stroke(h * 0.02f))
        }
        if (!compact) Text(stringResource(R.string.cat_illustration), Modifier.align(Alignment.BottomStart).padding(10.dp).clip(RoundedCornerShape(50))
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.8f)).padding(horizontal = 8.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall)
    }
}

// ============================== VEHICLE DETAIL ==============================
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VehicleDetailScreen(app: AppViewModel, id: String, onBack: () -> Unit, openCompare: () -> Unit, openMap: () -> Unit, openEmergency: () -> Unit, openGarage: () -> Unit,
                        askVolt: (String, VehicleSeed) -> Unit, vm: CatalogueViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val me = app.state.collectAsStateWithLifecycle().value.me ?: return
    val c = NearVoltApp.instance.container
    val local by remember(me.uid) { c.accountStore.data(me.uid) }.collectAsStateWithLifecycle(LocalAccountData())
    val disco by c.discovery.collectAsStateWithLifecycle()
    val compare by CompareTray.ids.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val snack = remember { SnackbarHostState() }
    val v = s.file?.vehicles?.firstOrNull { it.id == id }
    var garageDraft by remember { mutableStateOf<GarageVehicle?>(null) }
    var report by remember { mutableStateOf(false) }
    val msgCompareFull = stringResource(R.string.cat_compare_full, CompareTray.MAX)
    val msgAdded = stringResource(R.string.cat_added_garage)
    val msgSent = stringResource(R.string.report_sent)
    LaunchedEffect(v?.id) { if (v != null) c.accountStore.update(me.uid) { LocalRules.viewedVehicle(it, v.id) } }
    Scaffold(topBar = { TopAppBar(title = { Text(v?.model ?: stringResource(R.string.cat_title), maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.action_back)) } },
        actions = { if (v != null) {
            val fav = v.id in local.favVehicles
            IconButton(onClick = { scope.launch { c.accountStore.update(me.uid) { LocalRules.toggleFavVehicle(it, v.id) } } }) {
                Icon(if (fav) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder, stringResource(if (fav) R.string.fav_remove else R.string.fav_add), tint = MaterialTheme.colorScheme.primary) }
        } }) }, snackbarHost = { SnackbarHost(snack) }) { pad ->
        if (v == null) { Box(Modifier.padding(pad)) { if (s.file == null) LoadingState() else CenterState(Icons.Outlined.SearchOff, stringResource(R.string.cat_empty), id) }; return@Scaffold }
        Column(Modifier.padding(pad).fillMaxSize().ambient().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            VehicleArt(v, Modifier.fillMaxWidth().height(170.dp))
            Text(v.brand, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Text(v.title, style = MaterialTheme.typography.headlineSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                StatusPill(v.status ?: "Status unknown", if (v.isCurrent) Tone.Good else Tone.Neutral)
                v.year?.let { StatusPill(stringResource(R.string.cat_year, it), Tone.Neutral) }
                v.ownership?.let { StatusPill(it, Tone.Neutral) }
            }
            // ---- actions
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { garageDraft = GarageVehicle(UUID.randomUUID().toString(), "car", v.acConnector ?: v.dcConnector ?: (me.vehicle?.connector ?: "TYPE2_AC"),
                    make = v.shortBrand, model = v.title.take(40), batteryKwh = v.batteryKwh, catalogueId = v.id) }) { Icon(Icons.Outlined.Add, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.cat_add_garage)) }
                OutlinedButton(onClick = { if (!CompareTray.toggle(v.id)) scope.launch { snack.showSnackbar(msgCompareFull) } }) {
                    Text(stringResource(if (v.id in compare) R.string.cat_compare_remove else R.string.cat_compare_add)) }
                if (compare.size >= 2) TextButton(onClick = openCompare) { Text(stringResource(R.string.cat_compare)) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip({ askVolt(ctxQuestion(v), VehicleSeed.of(v)) }, label = { Text(stringResource(R.string.cat_ask_volt)) }, leadingIcon = { Icon(Icons.Outlined.AutoAwesome, null, Modifier.size(18.dp)) })
                AssistChip(openMap, label = { Text(stringResource(R.string.cat_find_compatible)) }, leadingIcon = { Icon(Icons.Outlined.Map, null, Modifier.size(18.dp)) })
                AssistChip(openEmergency, label = { Text(stringResource(R.string.home_emergency)) }, leadingIcon = { Icon(Icons.Outlined.Sos, null, Modifier.size(18.dp)) })
            }
            // ---- specs
            SectionHeader(stringResource(R.string.cat_specs))
            GlassCard {
                Spec(stringResource(R.string.cat_battery), v.batteryKwh?.let { "${fmt(it)} kWh" }, v.batteryEvidence)
                Spec(stringResource(R.string.cat_range), v.rangeKm?.let { "${fmt(it)} km" }, v.rangeStandard?.let { "claimed · $it" })
                HorizontalDivider(Modifier.padding(vertical = 6.dp))
                Spec(stringResource(R.string.cat_ac), when (v.acSupported) { true -> v.acConnectorLabel ?: "Supported"; false -> "Not supported"; null -> null }, null)
                Spec(stringResource(R.string.cat_ac_max), v.acMaxKw?.let { "${fmt(it)} kW" }, "vehicle on-board charger acceptance")
                Spec(stringResource(R.string.cat_dc), when (v.dcSupported) { true -> v.dcConnectorLabel ?: "Supported"; false -> "Not supported"; null -> null }, null)
                Spec(stringResource(R.string.cat_dc_max), v.dcMaxKw?.let { "${fmt(it)} kW" }, "peak acceptance, not sustained")
                Spec(stringResource(R.string.cat_charging_evidence), v.chargingEvidence, null)
            }
            // ---- charging times: claims vs estimate, never mixed
            SectionHeader(stringResource(R.string.cat_charge_times))
            GlassCard {
                Text(stringResource(R.string.cat_claims_head), style = MaterialTheme.typography.titleSmall)
                val claims = ChargeTime.claims(v)
                if (claims.isEmpty()) Text(stringResource(R.string.cat_no_claims), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                claims.forEach { cl -> Spec("${cl.label} · ${cl.window}", cl.value, null) }
                Text(stringResource(R.string.cat_dc_no_extrapolate), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            VehicleEstimator(v, local.garage.firstOrNull { it.catalogueId == v.id }?.batteryPercent)
            // ---- compatibility against the hosts of this session's last search (no new request; approximate areas only)
            SectionHeader(stringResource(R.string.cat_compat))
            GlassCard {
                val hosts = disco.nearby?.items.orEmpty()
                if (hosts.isEmpty()) Text(stringResource(R.string.cat_compat_none), style = MaterialTheme.typography.bodyMedium)
                else {
                    val res = hosts.map { CompatibilityEngine.screen(v, it.connectors, it.powerKw, it.chargerType) }
                    val m = res.count { it.level == CompatibilityEngine.Level.SCREENED_MATCH }; val u = res.count { it.level == CompatibilityEngine.Level.UNVERIFIED }
                    val x = res.count { it.level == CompatibilityEngine.Level.INCOMPATIBLE }
                    Text(stringResource(R.string.cat_compat_summary, hosts.size, m, u, x), style = MaterialTheme.typography.bodyMedium)
                }
                Text(stringResource(R.string.cat_compat_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = openMap) { Text(stringResource(R.string.cat_request_via_map)) }
            }
            // ---- sources
            SectionHeader(stringResource(R.string.cat_sources))
            GlassCard {
                v.sourceUrl?.let { u -> TextButton(onClick = { Links.open(ctx, u) }) { Icon(Icons.Outlined.OpenInNew, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(host(u), maxLines = 1, overflow = TextOverflow.Ellipsis) } }
                v.secondarySourceUrl?.let { u -> TextButton(onClick = { Links.open(ctx, u) }) { Icon(Icons.Outlined.OpenInNew, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(host(u), maxLines = 1, overflow = TextOverflow.Ellipsis) } }
                Text(stringResource(R.string.cat_checked, v.checkedAt ?: "—"), style = MaterialTheme.typography.bodySmall)
                v.notes?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                TextButton(onClick = { report = true }) { Icon(Icons.Outlined.Flag, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.cat_report)) }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
    garageDraft?.let { d ->
        VehicleDialog(d, isPrimary = false, catalogueNote = if (v?.verifiedConnectors.isNullOrEmpty()) stringResource(R.string.cat_garage_connector_unverified) else stringResource(R.string.cat_garage_connector_verified),
            onDismiss = { garageDraft = null }) { saved ->
            garageDraft = null
            scope.launch { c.accountStore.update(me.uid) { LocalRules.upsertVehicle(it, saved) }; snack.showSnackbar(msgAdded) }
        }
    }
    if (report && v != null) ReportDialog(title = stringResource(R.string.cat_report), hint = stringResource(R.string.cat_report_hint), category = "other",
        prefix = "[Vehicle data] ${v.id} ${v.brand} ${v.title}: ", onDismiss = { report = false }) { scope.launch { snack.showSnackbar(msgSent) } }
}

private fun host(u: String) = runCatching { java.net.URI(u).host?.removePrefix("www.") }.getOrNull() ?: u
private fun ctxQuestion(v: CatalogueVehicle) = if (v.batteryKwh != null) "How long to charge ${fmt(v.batteryKwh)} kWh from 20% to 80%" else "Is ${v.model} compatible with my charger?"

/** Vehicle context handed to VOLT AI. Only catalogue facts (null when unverified). */
data class VehicleSeed(val label: String, val capacity: Double?, val connector: String?) {
    companion object { fun of(v: CatalogueVehicle) = VehicleSeed("${v.shortBrand} ${v.model}", v.batteryKwh, v.acConnectorLabel?.takeIf { v.acConnector != null }?.lowercase()) }
}

@Composable
private fun Spec(label: String, value: String?, note: String?) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.Top) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.45f))
        Column(Modifier.weight(0.55f), horizontalAlignment = Alignment.End) {
            Text(value ?: NV, style = MaterialTheme.typography.bodyMedium, fontWeight = if (value != null) FontWeight.SemiBold else FontWeight.Normal,
                color = if (value != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            if (value != null && note != null) Text(note, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun VehicleEstimator(v: CatalogueVehicle, savedPct: Int?) {
    var cur by remember(savedPct) { mutableFloatStateOf((savedPct ?: 20).toFloat()) }
    var target by remember { mutableFloatStateOf(80f) }
    var charger by rememberSaveable { mutableFloatStateOf(3.3f) }
    GlassCard(accent = true) {
        Text(stringResource(R.string.cat_estimate_head), style = MaterialTheme.typography.titleSmall)
        if (v.batteryKwh == null) { Text(stringResource(R.string.cat_estimate_no_battery), style = MaterialTheme.typography.bodySmall); return@GlassCard }
        Text(stringResource(R.string.cat_charger_power), style = MaterialTheme.typography.labelMedium)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(2.2f, 3.3f, 7.2f, 11f).forEach { p -> FilterChip(charger == p, { charger = p }, label = { Text("${fmt(p.toDouble())} kW AC") }) }
        }
        Text(stringResource(R.string.est_current, cur.toInt()), style = MaterialTheme.typography.bodyMedium)
        Slider(cur, { cur = it; if (target <= it) target = (it + 1).coerceAtMost(100f) }, valueRange = 0f..99f)
        Text(stringResource(R.string.est_target, target.toInt()), style = MaterialTheme.typography.bodyMedium)
        Slider(target, { target = it.coerceAtLeast(cur + 1) }, valueRange = 1f..100f)
        val e = ChargeTime.acEstimate(v, cur.toDouble(), target.toDouble(), charger.toDouble())
        if (e != null) {
            Text("≈ ${ChargeTime.hours(e.hours)}", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.primary)
            Text(stringResource(R.string.cat_estimate_detail, String.format(Locale.US, "%.1f", e.energyKwh), cur.toInt(), target.toInt(), e.powerBasis), style = MaterialTheme.typography.bodySmall)
            Text(e.assumptions, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else Text(stringResource(R.string.est_invalid), style = MaterialTheme.typography.bodySmall)
    }
}

// ============================== COMPARE ==============================
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CompareScreen(onBack: () -> Unit, openVehicle: (String) -> Unit, vm: CatalogueViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val ids by CompareTray.ids.collectAsStateWithLifecycle()
    val list = ids.mapNotNull { id -> s.file?.vehicles?.firstOrNull { it.id == id } }
    Scaffold(topBar = { TopAppBar(title = { Text(stringResource(R.string.cat_compare)) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.action_back)) } }) }) { pad ->
        if (list.size < 2) { Box(Modifier.padding(pad)) { EmptyState(stringResource(R.string.cat_compare_empty), stringResource(R.string.cat_compare_empty_body), stringResource(R.string.action_back), onBack) }; return@Scaffold }
        val rows: List<Pair<Int, (CatalogueVehicle) -> String?>> = listOf(
            R.string.cat_battery to { v -> v.batteryKwh?.let { "${fmt(it)} kWh" } }, R.string.cat_range to { v -> v.rangeKm?.let { "${fmt(it)} km${v.rangeStandard?.let { s -> " ($s)" } ?: ""}" } },
            R.string.cat_ac to { v -> when (v.acSupported) { true -> v.acConnectorLabel ?: "Yes"; false -> "No"; null -> null } }, R.string.cat_ac_max to { v -> v.acMaxKw?.let { "${fmt(it)} kW" } },
            R.string.cat_dc to { v -> when (v.dcSupported) { true -> v.dcConnectorLabel ?: "Yes"; false -> "No"; null -> null } }, R.string.cat_dc_max to { v -> v.dcMaxKw?.let { "${fmt(it)} kW" } },
            R.string.cat_ac_0_100 to { v -> v.ac0to100h?.let { ChargeTime.hours(it) } }, R.string.cat_dc_10_80 to { v -> v.dc10to80min?.let { "${it.toInt()} min" } },
            R.string.cat_year_label to { v -> v.year?.toString() }, R.string.cat_status to { v -> v.status })
        Column(Modifier.padding(pad).fillMaxSize().ambient().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                list.forEach { v -> GlassCard(onClick = { openVehicle(v.id) }, modifier = Modifier.weight(1f)) {
                    VehicleArt(v, Modifier.fillMaxWidth().height(56.dp), compact = true)
                    Text(v.shortBrand, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    Text(v.model, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(v.variant ?: "", style = MaterialTheme.typography.labelSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    TextButton(onClick = { CompareTray.toggle(v.id) }, contentPadding = PaddingValues(0.dp)) { Text(stringResource(R.string.action_remove)) }
                } }
            }
            rows.forEach { (label, get) ->
                GlassCard {
                    Text(stringResource(label), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        list.forEach { v -> val x = get(v)
                            Text(x ?: "n/v", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, fontWeight = if (x != null) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (x != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
            Text(stringResource(R.string.cat_compare_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// ============================== shared: report / feedback via existing support tickets ==============================
/** Sends through the existing /support/tickets API (existing categories; no backend change). Nothing is "sent" unless the server accepts it. */
@Composable
fun ReportDialog(title: String, hint: String, category: String, prefix: String, onDismiss: () -> Unit, onSent: () -> Unit) {
    val repo = NearVoltApp.instance.container.repo
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }; var err by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text(title) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(text, { text = it.take(1500) }, Modifier.fillMaxWidth().heightIn(min = 120.dp), label = { Text(hint) })
            Text(stringResource(R.string.report_privacy), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            InlineMessage(err)
        }
    }, confirmButton = {
        TextButton(enabled = !busy && text.trim().length >= 5, onClick = { busy = true; scope.launch {
            when (val r = repo.createTicket(TicketBody(category, (prefix + text.trim()).take(2000)))) { is ApiResult.Ok -> { onDismiss(); onSent() }; is ApiResult.Err -> err = r.message }
            busy = false } }) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.action_submit)) }
    }, dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } })
}
