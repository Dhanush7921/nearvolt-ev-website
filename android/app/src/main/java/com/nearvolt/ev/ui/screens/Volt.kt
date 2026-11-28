package com.nearvolt.ev.ui.screens

import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import com.nearvolt.ev.data.prefs.LocalRules
import com.nearvolt.ev.data.prefs.VoltTurn
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.ui.theme.Brand
import com.nearvolt.ev.volt.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.math.roundToInt

/** Session-wide VOLT state: orb ⇄ full-screen, plus an optional question/vehicle handed over from another screen. */
object VoltController {
    data class Seed(val question: String, val vehicle: VehicleSeed?)
    val open = MutableStateFlow(false)
    val seed = MutableStateFlow<Seed?>(null)
    fun ask(question: String? = null, vehicle: VehicleSeed? = null) { if (question != null || vehicle != null) seed.value = Seed(question.orEmpty(), vehicle); open.value = true }
    fun close() { open.value = false }

    private val lock = Mutex()
    @Volatile private var engine: VoltEngine? = null
    /** Knowledge (114 records, ~120 KB) is parsed once, off the main thread, on first open. */
    suspend fun engine(): VoltEngine = engine ?: lock.withLock {
        engine ?: withContext(Dispatchers.IO) {
            val a = NearVoltApp.instance.assets
            VoltEngine.fromJson(a.open("volt/knowledge.json").bufferedReader().use { it.readText() }, a.open("volt/sources.json").bufferedReader().use { it.readText() })
        }.also { engine = it }
    }
}

data class VoltMsg(val fromUser: Boolean, val text: String, val intent: String? = null, val actions: List<VoltAction> = emptyList(), val sources: List<VoltSource> = emptyList(),
    val confidence: Double? = null)
data class VoltUi(val ready: Boolean = false, val messages: List<VoltMsg> = emptyList(), val thinking: Boolean = false, val vehicleLabel: String? = null,
    val saveHistory: Boolean = true, val error: String? = null)

class VoltViewModel : ViewModel() {
    private val c = NearVoltApp.instance.container
    val state = MutableStateFlow(VoltUi())
    private var ctx = UserContext()
    private var uid: String? = null

    fun init(uid: String) {
        if (this.uid == uid && state.value.ready) return
        this.uid = uid
        viewModelScope.launch {
            val local = c.accountStore.current(uid)
            // Vehicle context = the user's primary garage entry (manual values; never telemetry).
            val p = local.garage.firstOrNull { it.id == PRIMARY_LOCAL_ID }
            ctx = UserContext(vehicle = VehicleContext(capacity = p?.batteryKwh, soc = p?.batteryPercent?.toDouble(),
                connector = p?.connector?.let { connectorWord(it) }))
            runCatching { VoltController.engine() }.onFailure { e -> state.update { it.copy(error = "VOLT knowledge could not be loaded (${e.javaClass.simpleName}).") } }
            state.update { s -> s.copy(ready = true, saveHistory = local.voltSaveHistory, vehicleLabel = p?.let { listOf(it.make, it.model).filter(String::isNotBlank).joinToString(" ").ifBlank { null } },
                messages = local.voltHistory.map { VoltMsg(it.fromUser, it.text, it.intent, it.actions.mapNotNull { a -> runCatching { VoltAction.valueOf(a) }.getOrNull() }) }) }
        }
    }
    fun applySeed(seed: VoltController.Seed) {
        seed.vehicle?.let { v -> ctx = ctx.copy(vehicle = ctx.vehicle.copy(capacity = v.capacity ?: ctx.vehicle.capacity, connector = v.connector ?: ctx.vehicle.connector, model = v.label))
            state.update { it.copy(vehicleLabel = v.label) } }
        if (seed.question.isNotBlank()) send(seed.question)
    }
    fun send(raw: String) {
        val text = raw.trim().take(1200); if (text.isEmpty() || state.value.thinking) return
        state.update { it.copy(messages = it.messages + VoltMsg(true, text), thinking = true) }
        viewModelScope.launch {
            val engine = runCatching { VoltController.engine() }.getOrNull()
            val r = engine?.let { e -> withContext(Dispatchers.Default) { e.respond(text, ctx) } }
            val msg = if (r == null) VoltMsg(false, "VOLT knowledge is unavailable on this device right now.", "unknown")
                else { ctx = r.context
                    VoltMsg(false, r.text, r.intent, r.actions.map { it.type }, r.sourceIds.mapNotNull { engine.sources[it] }, r.confidence) }
            state.update { it.copy(messages = it.messages + msg, thinking = false) }
            uid?.let { u -> c.accountStore.update(u) { d -> LocalRules.addVolt(d, listOf(VoltTurn(true, text, System.currentTimeMillis()),
                VoltTurn(false, msg.text, System.currentTimeMillis(), msg.intent, msg.actions.map { it.name }))) } }
        }
    }
    fun clear() { ctx = ctx.copy(lastIntent = null, lastKnowledgeId = null, calculation = Calculation()); state.update { it.copy(messages = emptyList()) }
        uid?.let { u -> viewModelScope.launch { c.accountStore.update(u) { it.copy(voltHistory = emptyList()) } } } }
    fun setSaveHistory(on: Boolean) { state.update { it.copy(saveHistory = on) }
        uid?.let { u -> viewModelScope.launch { c.accountStore.update(u) { it.copy(voltSaveHistory = on, voltHistory = if (on) it.voltHistory else emptyList()) } } } }

    companion object {
        /** Engine connector vocabulary (its regex knows ccs2 / type 2 / chademo …); other app codes are left out rather than guessed. */
        fun connectorWord(code: String) = when (code) { "CCS2" -> "ccs2"; "TYPE2_AC" -> "type 2"; "CHADEMO" -> "chademo"; else -> null }
    }
}

/** Host-mode suggestions map to reviewed knowledge records (dedicated, rcd, extension, home-safety, host-registration, session-pin). */
val HOST_SUGGESTIONS = listOf("Dedicated charging circuit", "Residual current device", "Extension cord charging", "Home charging safety",
    "Become a charging host", "Session PIN verification")
private val SUGGESTIONS = listOf("How long to charge 30 kWh from 20% to 80% at 3.3 kW", "Is a matching connector enough for compatibility?", "My battery is low, what should I do?",
    "How does the session PIN work?", "What is the difference between kW and kWh?", "Tips to extend battery life", "Is it safe to charge in rain?", "What does SOC mean?")

// ============================== FLOATING ORB ==============================
/**
 * Screens register critical controls (emergency button, map controls, bottom panels) with [voltAvoid]. The orb never overlaps a registered
 * area: it moves to the first free edge slot, or hides while none is free. It also hides while the keyboard is open (forms).
 */
object VoltAvoid {
    val rects = androidx.compose.runtime.mutableStateMapOf<String, androidx.compose.ui.geometry.Rect>()
}
fun Modifier.voltAvoid(key: String): Modifier = composed {
    DisposableEffect(key) { onDispose { VoltAvoid.rects.remove(key) } }
    onGloballyPositioned { c ->
        val r = c.boundsInWindow()
        if (VoltAvoid.rects[key] != r) VoltAvoid.rects[key] = r
    }
}

/** Draggable VOLT orb. Tap opens VOLT full screen. Snaps to a side edge; position is session-only. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BoxScope.VoltOrb(bottomInset: androidx.compose.ui.unit.Dp) {
    val density = LocalDensity.current
    var parent by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    var parentOrigin by remember { mutableStateOf(Offset.Zero) }
    val sizePx = with(density) { 60.dp.toPx() }; val margin = with(density) { 16.dp.toPx() }; val bottomPx = with(density) { bottomInset.toPx() }
    val gap = with(density) { 8.dp.toPx() }
    var pos by rememberSaveable(stateSaver = androidx.compose.runtime.saveable.listSaver(save = { listOf(it.x, it.y) }, restore = { Offset(it[0], it[1]) })) { mutableStateOf(Offset(-1f, -1f)) }
    val reduced = rememberReducedMotion()
    val imeVisible = WindowInsets.isImeVisible
    Box(Modifier.matchParentSize().onSizeChanged { parent = it }.onGloballyPositioned { parentOrigin = it.positionInWindow() })
    if (parent.width == 0) return
    val maxX = parent.width - sizePx - margin; val maxY = parent.height - sizePx - margin - bottomPx
    val preferred = if (pos.x < 0) Offset(maxX, maxY - gap) else Offset(pos.x.coerceIn(margin, maxX), pos.y.coerceIn(margin, maxY))
    var dragging by remember { mutableStateOf(false) }
    // Avoidance: candidate slots in local coordinates, checked against registered window rects.
    val blocked = VoltAvoid.rects.values.toList()
    fun free(p: Offset): Boolean { val r = androidx.compose.ui.geometry.Rect(parentOrigin + p, androidx.compose.ui.geometry.Size(sizePx, sizePx)).inflate(gap)
        return blocked.none { it.overlaps(r) } }
    val slots = listOf(preferred, Offset(maxX, maxY - gap), Offset(margin, maxY - gap), Offset(maxX, parent.height * 0.42f), Offset(margin, parent.height * 0.42f),
        Offset(maxX, margin + parent.height * 0.18f), Offset(margin, margin + parent.height * 0.18f))
    val target = if (dragging) preferred else slots.firstOrNull { it.y in margin..maxY && free(it) }
    val visible = target != null && !imeVisible
    val shown = target ?: preferred
    val ax by animateFloatAsState(shown.x, if (dragging || reduced) snap() else spring(dampingRatio = 0.75f, stiffness = 400f), label = "orbX")
    val ay by animateFloatAsState(shown.y, if (dragging || reduced) snap() else spring(dampingRatio = 0.75f, stiffness = 400f), label = "orbY")
    val alpha by animateFloatAsState(if (visible) 1f else 0f, if (reduced) snap() else tween(160), label = "orbA")
    if (alpha == 0f && !visible) return   // fully hidden: not composed, not focusable, not clickable
    val label = stringResource(R.string.volt_open)
    Box(Modifier.offset { IntOffset(ax.roundToInt(), ay.roundToInt()) }.size(60.dp).graphicsLayerAlpha(alpha)
        .shadow(14.dp, CircleShape, ambientColor = Brand.EmeraldBrand, spotColor = Brand.EmeraldBrand)
        .clip(CircleShape).background(Brush.radialGradient(listOf(Brand.NeonMint, Brand.EmeraldBrand, Color(0xFF071B17))))
        .semantics { contentDescription = label; role = Role.Button }
        .pointerInput(maxX, maxY) {
            detectDragGestures(onDragStart = { dragging = true; if (pos.x < 0) pos = preferred },
                onDragEnd = { dragging = false; pos = Offset(if (pos.x + sizePx / 2 < parent.width / 2) margin else maxX, pos.y.coerceIn(margin, maxY)) },
                onDragCancel = { dragging = false }) { ch, d -> ch.consume(); pos = Offset((pos.x + d.x).coerceIn(0f, parent.width - sizePx), (pos.y + d.y).coerceIn(0f, maxY)) }
        }
        .clickable(enabled = visible, onClickLabel = label) { VoltController.ask() }, contentAlignment = Alignment.Center) {
        VoltMark(Modifier.size(34.dp), animate = !reduced && LocalGraphics.current.decorativeMotion)
    }
}
private fun Modifier.graphicsLayerAlpha(a: Float) = this.graphicsLayer { alpha = a }

/** VOLT's animated mark: a breathing ring with an orbiting spark and a bolt. Static when motion is reduced. */
@Composable
fun VoltMark(modifier: Modifier, animate: Boolean, ring: Color = Color.White) {
    val t = if (animate) rememberInfiniteTransition(label = "volt").animateFloat(0f, 1f, infiniteRepeatable(tween(2400, easing = LinearEasing)), label = "t").value else 0.15f
    Canvas(modifier) {
        val r = size.minDimension / 2; val c = center
        val breathe = 0.86f + 0.08f * kotlin.math.sin(t * 2 * Math.PI).toFloat()
        drawCircle(ring.copy(alpha = 0.35f), r * breathe, c, style = Stroke(r * 0.09f))
        val a = t * 2 * Math.PI
        drawCircle(ring, r * 0.12f, Offset(c.x + r * breathe * kotlin.math.cos(a).toFloat(), c.y + r * breathe * kotlin.math.sin(a).toFloat()))
        val bolt = androidx.compose.ui.graphics.Path().apply {
            moveTo(c.x + r * 0.10f, c.y - r * 0.55f); lineTo(c.x - r * 0.28f, c.y + r * 0.08f); lineTo(c.x - r * 0.02f, c.y + r * 0.08f)
            lineTo(c.x - r * 0.12f, c.y + r * 0.55f); lineTo(c.x + r * 0.30f, c.y - r * 0.10f); lineTo(c.x + r * 0.03f, c.y - r * 0.10f); close() }
        drawPath(bolt, ring)
    }
}

// ============================== FULL-SCREEN VOLT ==============================
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun VoltScreen(uid: String, onAction: (VoltAction) -> Unit, hostMode: Boolean = false, vm: VoltViewModel = viewModel(key = "volt-$uid")) {
    val suggestions = if (hostMode) HOST_SUGGESTIONS else SUGGESTIONS
    val s by vm.state.collectAsStateWithLifecycle()
    val seed by VoltController.seed.collectAsStateWithLifecycle()
    LaunchedEffect(uid) { vm.init(uid) }
    LaunchedEffect(seed, s.ready) { val sd = seed; if (sd != null && s.ready) { VoltController.seed.value = null; vm.applySeed(sd) } }
    BackHandler { VoltController.close() }
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val list = rememberLazyListState()
    var input by rememberSaveable { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    var confirmDial by remember { mutableStateOf(false) }
    val reduced = rememberReducedMotion()
    // TTS created only when the user first taps "listen"; released when VOLT closes.
    var tts by remember { mutableStateOf<TextToSpeech?>(null) }
    DisposableEffect(Unit) { onDispose { tts?.stop(); tts?.shutdown() } }
    fun speak(text: String) {
        val existing = tts
        if (existing != null) { existing.stop(); existing.speak(text, TextToSpeech.QUEUE_FLUSH, null, "volt"); return }
        var created: TextToSpeech? = null
        created = TextToSpeech(context) { st -> if (st == TextToSpeech.SUCCESS) { created?.language = Locale("en", "IN"); created?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "volt") } }
        tts = created
    }
    val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { input = it.take(1200) } }
    val voiceIntent = remember { Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN").putExtra(RecognizerIntent.EXTRA_PROMPT, "Ask VOLT") }
    val voiceAvailable = remember { voiceIntent.resolveActivity(context.packageManager) != null }
    LaunchedEffect(s.messages.size, s.thinking) { if (s.messages.isNotEmpty()) { val last = s.messages.size + (if (s.thinking) 1 else 0) - 1; if (reduced) list.scrollToItem(last + 1) else list.animateScrollToItem(last + 1) } }

    val act: (VoltAction) -> Unit = { a -> if (a == VoltAction.OPEN_EMERGENCY_DIALER) confirmDial = true else { VoltController.close(); onAction(a) } }

    Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = {
        TopAppBar(title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(36.dp).clip(CircleShape).background(Brush.radialGradient(listOf(Brand.NeonMint, Brand.EmeraldBrand))), contentAlignment = Alignment.Center) {
                    VoltMark(Modifier.size(22.dp), animate = s.thinking && !reduced) }
                Spacer(Modifier.width(10.dp))
                Column { Text("VOLT AI", style = MaterialTheme.typography.titleMedium); Text(stringResource(R.string.volt_subtitle), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }, actions = {
            Box { IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, stringResource(R.string.volt_menu)) }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem({ Text(stringResource(R.string.volt_clear)) }, { menu = false; confirmClear = true }, leadingIcon = { Icon(Icons.Outlined.DeleteSweep, null) }, enabled = s.messages.isNotEmpty())
                    DropdownMenuItem({ Text(stringResource(R.string.volt_save_history)) }, { vm.setSaveHistory(!s.saveHistory) }, trailingIcon = { Switch(s.saveHistory, null) })
                    DropdownMenuItem({ Text(stringResource(R.string.volt_open_safety)) }, { menu = false; act(VoltAction.OPEN_SAFETY) }, leadingIcon = { Icon(Icons.Outlined.Shield, null) })
                    DropdownMenuItem({ Text(stringResource(R.string.volt_open_support)) }, { menu = false; act(VoltAction.OPEN_SUPPORT) }, leadingIcon = { Icon(Icons.Outlined.SupportAgent, null) })
                }
            }
            IconButton(onClick = { VoltController.close() }) { Icon(Icons.Outlined.Close, stringResource(R.string.volt_close)) }
        })
    }, bottomBar = {
        Surface(tonalElevation = 2.dp) {
            Column(Modifier.navigationBarsPadding().imePadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(input, { input = it.take(1200) }, Modifier.weight(1f), placeholder = { Text(stringResource(R.string.volt_hint)) }, maxLines = 4,
                        shape = RoundedCornerShape(24.dp), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { vm.send(input); input = "" }))
                    if (voiceAvailable) IconButton(onClick = { try { voice.launch(voiceIntent) } catch (_: ActivityNotFoundException) {} }) { Icon(Icons.Outlined.Mic, stringResource(R.string.volt_voice)) }
                    FilledIconButton(onClick = { vm.send(input); input = "" }, enabled = input.isNotBlank() && !s.thinking && s.ready) { Icon(Icons.AutoMirrored.Outlined.Send, stringResource(R.string.volt_send)) }
                }
                Text(stringResource(R.string.volt_disclaimer), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, start = 4.dp))
            }
        }
    }) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize().ambient(), state = list, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "hero") {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(92.dp).clip(CircleShape).background(Brush.radialGradient(listOf(Brand.NeonMint, Brand.EmeraldBrand, Color(0xFF071B17)))), contentAlignment = Alignment.Center) {
                        VoltMark(Modifier.size(52.dp), animate = !reduced && LocalGraphics.current.decorativeMotion) }
                    Spacer(Modifier.height(10.dp))
                    Text(stringResource(R.string.volt_hello), style = MaterialTheme.typography.titleLarge)
                    Text(stringResource(R.string.volt_honest), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    s.vehicleLabel?.let { Spacer(Modifier.height(6.dp)); AssistChip({ act(VoltAction.OPEN_GARAGE) }, label = { Text(stringResource(R.string.volt_vehicle_ctx, it)) },
                        leadingIcon = { Icon(Icons.Outlined.DirectionsCar, null, Modifier.size(16.dp)) }) }
                    s.error?.let { InlineMessage(it) }
                }
            }
            if (hostMode) item(key = "hostCtx") {
                // NEARVOLT's own host requirements (enforced by the server listing schema and request checks), not general advice.
                com.nearvolt.ev.ui.components.GlassCard(accent = true) {
                    Text(stringResource(R.string.volt_host_title), style = MaterialTheme.typography.titleSmall)
                    Text(stringResource(R.string.volt_host_rules), style = MaterialTheme.typography.bodySmall)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(VoltAction.OPEN_HOST_DASHBOARD, VoltAction.OPEN_LISTING, VoltAction.OPEN_SAFETY).forEach { a ->
                            AssistChip({ act(a) }, label = { Text(a.label) }, leadingIcon = { Icon(actionIcon(a), null, Modifier.size(16.dp)) }) }
                    }
                }
            }
            if (s.messages.isEmpty()) item(key = "suggest") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    suggestions.forEach { q -> SuggestionChip({ vm.send(q) }, label = { Text(q) }, enabled = s.ready) }
                }
            }
            items(s.messages.withIndex().toList(), key = { "m${it.index}" }) { (i, m) ->
                Bubble(m, onCopy = { clipboard.setText(AnnotatedString(m.text)) }, onSpeak = { speak(m.text) }, onAction = act,
                    modifier = if (reduced) Modifier else Modifier.animateItem())
            }
            if (s.thinking) item(key = "thinking") { Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.volt_thinking), style = MaterialTheme.typography.bodySmall) } }
            if (s.messages.isNotEmpty()) item(key = "more") {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    suggestions.shuffled(java.util.Random(s.messages.size.toLong())).take(3).forEach { q -> SuggestionChip({ vm.send(q) }, label = { Text(q, maxLines = 1) }) }
                }
            }
        }
    }
    if (confirmClear) AlertDialog(onDismissRequest = { confirmClear = false }, title = { Text(stringResource(R.string.volt_clear)) }, text = { Text(stringResource(R.string.volt_clear_body)) },
        confirmButton = { TextButton(onClick = { confirmClear = false; vm.clear() }) { Text(stringResource(R.string.volt_clear_yes), color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmClear = false }) { Text(stringResource(R.string.action_cancel)) } })
    // Opening the dialler needs an explicit tap; nothing is ever called automatically.
    if (confirmDial) AlertDialog(onDismissRequest = { confirmDial = false }, icon = { Icon(Icons.Outlined.Sos, null, tint = MaterialTheme.colorScheme.error) },
        title = { Text(stringResource(R.string.volt_dial_title)) }, text = { Text(stringResource(R.string.volt_dial_body)) },
        confirmButton = { TextButton(onClick = { confirmDial = false; com.nearvolt.ev.util.Links.dial(context, com.nearvolt.ev.util.Links.EMERGENCY) }) { Text(stringResource(R.string.volt_dial_yes), color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmDial = false; VoltController.close(); onAction(VoltAction.OPEN_EMERGENCY_DIALER) }) { Text(stringResource(R.string.volt_dial_options)) } })
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Bubble(m: VoltMsg, onCopy: () -> Unit, onSpeak: () -> Unit, onAction: (VoltAction) -> Unit, modifier: Modifier) {
    val user = m.fromUser
    val danger = m.intent == "emergency" || m.intent == "safety"
    Row(modifier.fillMaxWidth(), horizontalArrangement = if (user) Arrangement.End else Arrangement.Start) {
        Column(Modifier.widthIn(max = 520.dp).fillMaxWidth(if (user) 0.86f else 0.94f), horizontalAlignment = if (user) Alignment.End else Alignment.Start) {
            Surface(shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = if (user) 20.dp else 6.dp, bottomEnd = if (user) 6.dp else 20.dp),
                color = when { user -> MaterialTheme.colorScheme.primary; danger -> MaterialTheme.colorScheme.errorContainer; else -> MaterialTheme.colorScheme.surfaceVariant }) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                    if (danger && !user) Text(stringResource(if (m.intent == "emergency") R.string.volt_tag_emergency else R.string.volt_tag_safety), style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onErrorContainer)
                    Text(m.text, style = MaterialTheme.typography.bodyMedium, color = when { user -> MaterialTheme.colorScheme.onPrimary; danger -> MaterialTheme.colorScheme.onErrorContainer; else -> MaterialTheme.colorScheme.onSurfaceVariant })
                }
            }
            if (!user) {
                if (m.actions.isNotEmpty()) FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    m.actions.forEach { a -> AssistChip({ onAction(a) }, label = { Text(a.label) }, leadingIcon = { Icon(actionIcon(a), null, Modifier.size(16.dp)) }) }
                }
                val ctx = LocalContext.current
                m.sources.filter { !it.url.isNullOrBlank() }.take(2).forEach { src ->
                    Text("Source: ${src.title}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, maxLines = 1,
                        modifier = Modifier.padding(top = 4.dp).clickable { com.nearvolt.ev.util.Links.open(ctx, src.url!!) })
                }
                Row {
                    IconButton(onClick = onCopy, Modifier.size(36.dp)) { Icon(Icons.Outlined.ContentCopy, stringResource(R.string.volt_copy), Modifier.size(16.dp)) }
                    IconButton(onClick = onSpeak, Modifier.size(36.dp)) { Icon(Icons.Outlined.VolumeUp, stringResource(R.string.volt_listen), Modifier.size(16.dp)) }
                }
            }
        }
    }
}

private fun actionIcon(a: VoltAction) = when (a) {
    VoltAction.OPEN_MAP, VoltAction.FIND_COMPATIBLE_HOST -> Icons.Outlined.Map; VoltAction.OPEN_GARAGE -> Icons.Outlined.DirectionsCar
    VoltAction.OPEN_ACTIVITY -> Icons.Outlined.History; VoltAction.OPEN_SUPPORT -> Icons.Outlined.SupportAgent; VoltAction.OPEN_SAFETY -> Icons.Outlined.Shield
    VoltAction.CALCULATE_CHARGING_TIME -> Icons.Outlined.Calculate; VoltAction.OPEN_EMERGENCY_DIALER -> Icons.Outlined.Sos
    VoltAction.OPEN_HOST_DASHBOARD -> Icons.Outlined.SpaceDashboard; VoltAction.OPEN_LISTING -> Icons.Outlined.EvStation
}

/** Full-screen VOLT layer that grows out of the orb and shrinks back into it on close. */
@Composable
fun VoltOverlay(uid: String, onAction: (VoltAction) -> Unit, hostMode: Boolean = false) {
    val open by VoltController.open.collectAsStateWithLifecycle()
    val reduced = rememberReducedMotion()
    AnimatedVisibility(open, enter = if (reduced) fadeIn(tween(1)) else fadeIn(tween(200)) + scaleIn(tween(320, easing = FastOutSlowInEasing), 0.6f, TransformOrigin(0.9f, 0.88f)),
        exit = if (reduced) fadeOut(tween(1)) else fadeOut(tween(180)) + scaleOut(tween(240), 0.6f, TransformOrigin(0.9f, 0.88f))) {
        VoltScreen(uid, onAction, hostMode)
    }
}
