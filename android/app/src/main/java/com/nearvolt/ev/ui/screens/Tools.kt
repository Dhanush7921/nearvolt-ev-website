package com.nearvolt.ev.ui.screens

import android.content.Intent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.nearvolt.ev.NearVoltApp
import com.nearvolt.ev.R
import com.nearvolt.ev.data.prefs.EmergencyContact
import com.nearvolt.ev.data.prefs.LocalAccountData
import com.nearvolt.ev.data.prefs.LocalRules
import com.nearvolt.ev.ui.AppViewModel
import com.nearvolt.ev.ui.components.*
import com.nearvolt.ev.ui.theme.Brand
import com.nearvolt.ev.util.Links
import com.nearvolt.ev.volt.Calculators
import kotlinx.coroutines.launch
import java.util.Locale

// ============================== HUB ==============================
private data class ToolItem(val icon: ImageVector, val title: Int, val body: Int, val route: String?, val tone: Tone = Tone.Good)

@Composable
fun ToolsScreen(app: AppViewModel, onBack: () -> Unit, go: (String) -> Unit) {
    val c = NearVoltApp.instance.container
    val scope = rememberCoroutineScope()
    val lowData by c.prefs.lowData.collectAsStateWithLifecycle(false)
    var feedback by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }
    val items = listOf(
        ToolItem(Icons.Outlined.ElectricCar, R.string.cat_title, R.string.tools_catalogue_body, "catalogue"),
        ToolItem(Icons.Outlined.CompareArrows, R.string.cat_compare, R.string.tools_compare_body, "compare"),
        ToolItem(Icons.Outlined.Power, R.string.tools_connectors, R.string.tools_connectors_body, "connectors"),
        ToolItem(Icons.Outlined.Route, R.string.tools_trip, R.string.tools_trip_body, "trip"),
        ToolItem(Icons.Outlined.Calculate, R.string.est_title, R.string.tools_calc_body, "garage"),
        ToolItem(Icons.Outlined.Shield, R.string.safety_centre, R.string.tools_safety_body, "safety"),
        ToolItem(Icons.Outlined.FactCheck, R.string.tools_checklist, R.string.tools_checklist_body, "checklist"),
        ToolItem(Icons.Outlined.ContactPhone, R.string.tools_contacts, R.string.tools_contacts_body, "contacts", Tone.Warn),
        ToolItem(Icons.Outlined.TravelExplore, R.string.tools_area, R.string.tools_area_body, "area"),
        ToolItem(Icons.Outlined.MenuBook, R.string.tools_glossary, R.string.tools_glossary_body, "glossary"),
        ToolItem(Icons.Outlined.AutoAwesome, R.string.tools_intro, R.string.tools_intro_body, "intro"),
    )
    SubScreen(stringResource(R.string.tools_title), onBack) {
        items.forEach { t -> GlassCard(onClick = { t.route?.let(go) }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LeadingBadge(t.icon, t.tone, 40.dp); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) { Text(stringResource(t.title), style = MaterialTheme.typography.titleSmall)
                    Text(stringResource(t.body), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                Icon(Icons.AutoMirrored.Outlined.ArrowForward, null)
            }
        } }
        GlassCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LeadingBadge(Icons.Outlined.DataSaverOn, Tone.Neutral, 40.dp); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) { Text(stringResource(R.string.tools_lowdata), style = MaterialTheme.typography.titleSmall)
                    Text(stringResource(R.string.tools_lowdata_body), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Switch(lowData, { on -> scope.launch { c.prefs.setLowData(on) } })
            }
        }
        SectionHeader(stringResource(R.string.tools_feedback_head))
        if (sent) InlineMessage(stringResource(R.string.report_sent), isError = false)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { feedback = "app_issue" }, Modifier.weight(1f)) { Icon(Icons.Outlined.BugReport, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.tools_bug)) }
            OutlinedButton(onClick = { feedback = "other" }, Modifier.weight(1f)) { Icon(Icons.Outlined.RateReview, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.tools_feedback)) }
        }
    }
    feedback?.let { cat ->
        ReportDialog(stringResource(if (cat == "app_issue") R.string.tools_bug else R.string.tools_feedback), stringResource(if (cat == "app_issue") R.string.tools_bug_hint else R.string.tools_feedback_hint),
            cat, prefix = (if (cat == "app_issue") "[Bug] " else "[Feedback] ") + "v${com.nearvolt.ev.BuildConfig.VERSION_NAME} (${com.nearvolt.ev.BuildConfig.VERSION_CODE}) Android ${android.os.Build.VERSION.RELEASE}: ",
            onDismiss = { feedback = null }) { sent = true }
    }
}

// ============================== CONNECTOR GUIDE ==============================
private data class ConnectorInfo(val code: String, val name: String, val kind: String, val body: String, val draw: DrawScope.(Color, Color) -> Unit)

private fun pin(d: DrawScope, c: Color, x: Float, y: Float, r: Float) = d.drawCircle(c, r, Offset(x * d.size.width, y * d.size.height))

/** Original schematic drawings (not to scale, not manufacturer artwork). */
private val CONNECTORS = listOf(
    ConnectorInfo("TYPE2_AC", "Type 2 (IEC 62196-2)", "AC · 1- or 3-phase",
        "The common AC inlet on current Indian cars. Charging speed is limited by the smaller of the charger's output and the car's on-board charger.") { fg, bg ->
        val w = size.width; val h = size.height; val r = h * 0.07f
        drawPath(androidx.compose.ui.graphics.Path().apply { moveTo(w * 0.22f, h * 0.18f); lineTo(w * 0.78f, h * 0.18f); arcTo(androidx.compose.ui.geometry.Rect(w * 0.1f, h * 0.05f, w * 0.9f, h * 0.95f), -30f, 240f, false); close() }, fg, style = Stroke(h * 0.04f))
        listOf(0.38f to 0.32f, 0.62f to 0.32f, 0.27f to 0.55f, 0.5f to 0.55f, 0.73f to 0.55f, 0.38f to 0.76f, 0.62f to 0.76f).forEach { (x, y) -> pin(this, fg, x, y, r) }
    },
    ConnectorInfo("CCS2", "CCS2 (Combo 2)", "DC fast + AC",
        "A Type 2 upper section plus two large DC pins below. DC power tapers as the battery fills, so published 10–80% times are the only reliable DC figures.") { fg, _ ->
        val w = size.width; val h = size.height
        drawRoundRect(fg, Offset(w * 0.2f, h * 0.06f), Size(w * 0.6f, h * 0.5f), CornerRadius(h * 0.2f), style = Stroke(h * 0.035f))
        listOf(0.37f to 0.2f, 0.63f to 0.2f, 0.3f to 0.36f, 0.5f to 0.36f, 0.7f to 0.36f).forEach { (x, y) -> pin(this, fg, x, y, h * 0.045f) }
        drawRoundRect(fg, Offset(w * 0.25f, h * 0.62f), Size(w * 0.5f, h * 0.32f), CornerRadius(h * 0.14f), style = Stroke(h * 0.035f))
        pin(this, fg, 0.38f, 0.78f, h * 0.09f); pin(this, fg, 0.62f, 0.78f, h * 0.09f)
    },
    ConnectorInfo("DOMESTIC_15A", "Indian 15 A 3-pin socket", "AC wall socket",
        "Not a vehicle inlet. Cars that allow it charge through their own portable charger (EVSE). Needs a dedicated, properly earthed circuit with RCD protection — never an extension cord or multi-plug.") { fg, _ ->
        val w = size.width; val h = size.height
        drawRoundRect(fg, Offset(w * 0.18f, h * 0.08f), Size(w * 0.64f, h * 0.84f), CornerRadius(h * 0.12f), style = Stroke(h * 0.035f))
        pin(this, fg, 0.5f, 0.3f, h * 0.1f); pin(this, fg, 0.36f, 0.68f, h * 0.075f); pin(this, fg, 0.64f, 0.68f, h * 0.075f)
    },
    ConnectorInfo("BHARAT_AC001", "Bharat AC-001", "AC · public, legacy",
        "Indian public AC charger specification using industrial 3-pin outlets; low power per outlet. Mostly seen with older fleet vehicles.") { fg, _ ->
        val w = size.width; val h = size.height
        drawCircle(fg, h * 0.42f, Offset(w / 2, h / 2), style = Stroke(h * 0.035f))
        pin(this, fg, 0.5f, 0.25f, h * 0.08f); pin(this, fg, 0.36f, 0.66f, h * 0.08f); pin(this, fg, 0.64f, 0.66f, h * 0.08f)
    },
    ConnectorInfo("BHARAT_DC001", "Bharat DC-001", "Low-voltage DC · legacy",
        "Indian low-power DC specification used by early fleet EVs. Not compatible with CCS2 cars.") { fg, _ ->
        val w = size.width; val h = size.height
        drawRoundRect(fg, Offset(w * 0.16f, h * 0.12f), Size(w * 0.68f, h * 0.76f), CornerRadius(h * 0.3f), style = Stroke(h * 0.035f))
        pin(this, fg, 0.36f, 0.4f, h * 0.1f); pin(this, fg, 0.64f, 0.4f, h * 0.1f)
        listOf(0.3f, 0.43f, 0.57f, 0.7f).forEach { pin(this, fg, it, 0.7f, h * 0.045f) }
    },
    ConnectorInfo("LECCS", "LECCS (light EV)", "2- and 3-wheelers",
        "Indian light-EV connector standard for scooters and auto-rickshaws (AC and DC). Not used by cars.") { fg, _ ->
        val w = size.width; val h = size.height
        drawRoundRect(fg, Offset(w * 0.24f, h * 0.18f), Size(w * 0.52f, h * 0.64f), CornerRadius(h * 0.16f), style = Stroke(h * 0.035f))
        listOf(0.38f to 0.4f, 0.62f to 0.4f, 0.38f to 0.62f, 0.62f to 0.62f).forEach { (x, y) -> pin(this, fg, x, y, h * 0.06f) }
    },
    ConnectorInfo("CHADEMO", "CHAdeMO", "DC · rare in India",
        "Japanese DC standard. Very few vehicles sold in India use it; a CCS2 car cannot use a CHAdeMO charger without manufacturer-approved equipment.") { fg, _ ->
        val w = size.width; val h = size.height
        drawCircle(fg, h * 0.43f, Offset(w / 2, h / 2), style = Stroke(h * 0.035f))
        pin(this, fg, 0.38f, 0.42f, h * 0.1f); pin(this, fg, 0.62f, 0.42f, h * 0.1f)
        listOf(0.36f, 0.5f, 0.64f).forEach { pin(this, fg, it, 0.72f, h * 0.04f) }
    },
)

@Composable
fun ConnectorGuideScreen(onBack: () -> Unit) {
    SubScreen(stringResource(R.string.tools_connectors), onBack) {
        Text(stringResource(R.string.conn_intro), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        CONNECTORS.forEach { c ->
            GlassCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val fg = MaterialTheme.colorScheme.primary; val bg = MaterialTheme.colorScheme.surface
                    Box(Modifier.size(84.dp).clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceVariant).semantics { contentDescription = "Schematic of ${c.name}" }) {
                        Canvas(Modifier.fillMaxSize().padding(12.dp)) { c.draw(this, fg, bg) }
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(c.name, style = MaterialTheme.typography.titleSmall); StatusPill(c.kind, Tone.Neutral)
                        Spacer(Modifier.height(4.dp)); Text(c.body, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        Text(stringResource(R.string.conn_never_force), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
}

// ============================== SAFETY CHECKLIST ==============================
private val CHECKLIST = listOf(
    "Before" to listOf("The host accepted your request in the app", "Connector and power match your vehicle manual", "Cable, plug and socket show no cracks, burn marks or moisture",
        "The circuit is earthed and protected (RCD/RCCB) — ask the host if unsure", "You and the host can see the session PIN screen"),
    "During" to listOf("Cable is not coiled tightly, pinched or a trip hazard", "No extension cords or multi-plug adapters", "Stop immediately on heat, smell, sparks or tripping breakers"),
    "After" to listOf("Stop the session in the vehicle/charger before unplugging", "Return the cable neatly and confirm completion in the app", "Report any problem from Activity → the session"),
)

@Composable
fun ChecklistScreen(onBack: () -> Unit, openSupport: () -> Unit) {
    val checked = remember { mutableStateMapOf<String, Boolean>() }
    val total = CHECKLIST.sumOf { it.second.size }; val done = checked.count { it.value }
    SubScreen(stringResource(R.string.tools_checklist), onBack) {
        GlassCard(accent = true) {
            Text(stringResource(R.string.check_progress, done, total), style = MaterialTheme.typography.titleMedium)
            LinearProgressIndicator(progress = { done / total.toFloat() }, Modifier.fillMaxWidth().padding(top = 6.dp))
            Text(stringResource(R.string.check_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        CHECKLIST.forEach { (section, list) ->
            SectionHeader(section)
            GlassCard { list.forEach { item -> CheckRow(checked[item] == true, { checked[item] = it }, item) } }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { checked.clear() }, Modifier.weight(1f)) { Text(stringResource(R.string.check_reset)) }
            OutlinedButton(onClick = openSupport, Modifier.weight(1f)) { Text(stringResource(R.string.volt_open_support)) }
        }
    }
}

// ============================== GLOSSARY & FAQ ==============================
private val GLOSSARY = listOf(
    "kW (kilowatt)" to "Power — how fast energy flows. A 3.3 kW charger delivers up to 3.3 kWh per hour before losses.",
    "kWh (kilowatt-hour)" to "Energy — how much is stored or used. Battery size is quoted in kWh.",
    "SOC (state of charge)" to "Battery level as a percentage. Charging windows such as 10–80% refer to SOC.",
    "On-board charger (OBC)" to "The converter inside the car that limits AC charging power. A 7.2 kW OBC cannot take 11 kW even from an 11 kW charger.",
    "AC charging" to "Slow/medium charging through the car's on-board charger. Typical for homes.",
    "DC fast charging" to "The charger feeds the battery directly. Power is highest at low SOC and tapers as the battery fills.",
    "Tapering" to "Charging power reduces as the battery fills or heats up. It's why 80–100% takes much longer.",
    "Usable vs gross capacity" to "Gross is the total battery size; usable is what the car lets you use. Estimates should use usable capacity.",
    "MIDC / ARAI range" to "Indian test-cycle range claims. Real-world range is usually lower and depends on speed, AC use and load.",
    "RCD / RCCB" to "A safety device that cuts power on earth leakage. Required protection for any EV charging circuit.",
    "EVSE" to "The charging equipment (wall box or portable unit) between the supply and the car.",
    "Session PIN" to "NEARVOLT's one-time code the host enters to start charging, so only the accepted customer can start a session.",
)
private val FAQ = listOf(
    "Does NEARVOLT show exact host addresses?" to "No. Before acceptance you only see an approximate area (about 1 km). The exact location is shared after the host accepts your request.",
    "Is a matching connector enough?" to "No. It is a screening step. Power limits, phase, cable and the vehicle manual still matter. The app never treats unknown compatibility as confirmed.",
    "Is VOLT AI a chatbot like ChatGPT?" to "No. VOLT answers from a reviewed, local EV knowledge base with calculators. It does not generate free-form answers and works offline.",
    "Why do charging times differ from the brochure?" to "Brochure figures cover a specific SOC window and conditions. Temperature, supply voltage, battery health and tapering change real times.",
    "What should I do if something looks unsafe?" to "Stop, keep distance, and do not touch damaged equipment. Call 112 in an emergency, then report it from the session in Activity.",
)

@Composable
fun GlossaryScreen(onBack: () -> Unit) {
    var q by rememberSaveable { mutableStateOf("") }
    val ql = q.trim().lowercase()
    SubScreen(stringResource(R.string.tools_glossary), onBack) {
        OutlinedTextField(q, { q = it.take(40) }, Modifier.fillMaxWidth(), singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) }, placeholder = { Text(stringResource(R.string.glossary_search)) })
        SectionHeader(stringResource(R.string.glossary_terms))
        GLOSSARY.filter { ql.isEmpty() || it.first.lowercase().contains(ql) || it.second.lowercase().contains(ql) }.forEach { (t, d) ->
            GlassCard { Text(t, style = MaterialTheme.typography.titleSmall); Text(d, style = MaterialTheme.typography.bodyMedium) } }
        SectionHeader(stringResource(R.string.glossary_faq))
        FAQ.filter { ql.isEmpty() || it.first.lowercase().contains(ql) || it.second.lowercase().contains(ql) }.forEach { (t, d) ->
            var open by rememberSaveable(t) { mutableStateOf(false) }
            GlassCard(onClick = { open = !open }) {
                Row(verticalAlignment = Alignment.CenterVertically) { Text(t, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f)); Icon(if (open) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null) }
                if (open) Text(d, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

// ============================== EMERGENCY CONTACTS + CONSENT LOCATION SHARE ==============================
@Composable
fun EmergencyContactsScreen(app: AppViewModel, onBack: () -> Unit) {
    val me = app.state.collectAsStateWithLifecycle().value.me ?: return
    val c = NearVoltApp.instance.container
    val local by remember(me.uid) { c.accountStore.data(me.uid) }.collectAsStateWithLifecycle(LocalAccountData())
    val disco by c.discovery.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope(); val ctx = LocalContext.current
    var editing by remember { mutableStateOf<Int?>(null) }   // -1 new
    var share by remember { mutableStateOf(false) }
    SubScreen(stringResource(R.string.tools_contacts), onBack) {
        GlassCard(accent = true) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LeadingBadge(Icons.Outlined.Sos, Tone.Bad, 44.dp); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) { Text(stringResource(R.string.contacts_112), style = MaterialTheme.typography.titleSmall)
                    Text(stringResource(R.string.contacts_112_body), style = MaterialTheme.typography.bodySmall) }
                FilledTonalButton(onClick = { Links.dial(ctx, Links.EMERGENCY) }) { Text("112") }
            }
        }
        SectionHeader(stringResource(R.string.contacts_personal), if (local.emergencyContacts.size < 5) stringResource(R.string.contacts_add) else null) { editing = -1 }
        if (local.emergencyContacts.isEmpty()) Text(stringResource(R.string.contacts_empty), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        local.emergencyContacts.forEachIndexed { i, ct ->
            GlassCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LeadingBadge(Icons.Outlined.Person, Tone.Neutral, 36.dp); Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) { Text(ct.name, style = MaterialTheme.typography.titleSmall); Text(ct.phone, style = MaterialTheme.typography.bodySmall) }
                    IconButton(onClick = { Links.dial(ctx, ct.phone) }) { Icon(Icons.Outlined.Call, stringResource(R.string.contacts_call, ct.name)) }
                    IconButton(onClick = { editing = i }) { Icon(Icons.Outlined.Edit, stringResource(R.string.account_edit)) }
                    IconButton(onClick = { scope.launch { c.accountStore.update(me.uid) { d -> d.copy(emergencyContacts = d.emergencyContacts.filterIndexed { j, _ -> j != i }) } } }) {
                        Icon(Icons.Outlined.Delete, stringResource(R.string.action_remove)) }
                }
            }
        }
        Text(stringResource(R.string.contacts_device_only), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SectionHeader(stringResource(R.string.share_title))
        GlassCard {
            Text(stringResource(if (disco.fix != null) R.string.share_body else R.string.share_no_fix), style = MaterialTheme.typography.bodyMedium)
            PrimaryButton(stringResource(R.string.share_action), { share = true }, enabled = disco.fix != null)
        }
    }
    editing?.let { idx ->
        val cur = local.emergencyContacts.getOrNull(idx)
        var name by remember(idx) { mutableStateOf(cur?.name.orEmpty()) }; var phone by remember(idx) { mutableStateOf(cur?.phone.orEmpty()) }
        val ok = LocalRules.validContact(name.trim(), phone.trim())
        AlertDialog(onDismissRequest = { editing = null }, title = { Text(stringResource(R.string.contacts_add)) }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it.take(40) }, label = { Text(stringResource(R.string.field_name)) }, singleLine = true)
                OutlinedTextField(phone, { phone = it.filter { ch -> ch.isDigit() || ch == '+' || ch == ' ' }.take(16) }, label = { Text(stringResource(R.string.contacts_phone)) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), isError = phone.isNotBlank() && !ok)
            }
        }, confirmButton = { TextButton(enabled = ok, onClick = {
            val ct = EmergencyContact(name.trim(), phone.replace(" ", "").trim())
            scope.launch { c.accountStore.update(me.uid) { d -> d.copy(emergencyContacts = if (idx >= 0 && idx < d.emergencyContacts.size) d.emergencyContacts.mapIndexed { j, x -> if (j == idx) ct else x } else d.emergencyContacts + ct) } }
            editing = null }) { Text(stringResource(R.string.action_save)) } },
            dismissButton = { TextButton(onClick = { editing = null }) { Text(stringResource(R.string.action_cancel)) } })
    }
    val fix = disco.fix
    if (share && fix != null) {
        // The user's OWN location only (never a host's). Shown in full before the system share sheet opens; nothing is sent by the app.
        val text = "NEARVOLT EV — I'm sharing my location: ${fix.label}${if (fix.approximate) " (approximate)" else ""}. " +
            "Map: https://www.openstreetmap.org/?mlat=${"%.5f".format(Locale.US, fix.point.lat)}&mlon=${"%.5f".format(Locale.US, fix.point.lng)}#map=16/${"%.5f".format(Locale.US, fix.point.lat)}/${"%.5f".format(Locale.US, fix.point.lng)}"
        AlertDialog(onDismissRequest = { share = false }, title = { Text(stringResource(R.string.share_confirm_title)) }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(stringResource(R.string.share_confirm_body)); GlassCard { Text(text, style = MaterialTheme.typography.bodySmall) } }
        }, confirmButton = { TextButton(onClick = { share = false
            ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null)) }) { Text(stringResource(R.string.share_action)) } },
            dismissButton = { TextButton(onClick = { share = false }) { Text(stringResource(R.string.action_cancel)) } })
    }
}

// ============================== TRIP ASSISTANT ==============================
@Composable
fun TripScreen(app: AppViewModel, onBack: () -> Unit, openMap: () -> Unit) {
    val me = app.state.collectAsStateWithLifecycle().value.me ?: return
    val c = NearVoltApp.instance.container
    val local by remember(me.uid) { c.accountStore.data(me.uid) }.collectAsStateWithLifecycle(LocalAccountData())
    val p = local.garage.firstOrNull { it.id == PRIMARY_LOCAL_ID }
    var cap by remember(p?.batteryKwh) { mutableStateOf(p?.batteryKwh?.toString().orEmpty()) }
    var soc by remember(p?.batteryPercent) { mutableFloatStateOf((p?.batteryPercent ?: 60).toFloat()) }
    var dist by rememberSaveable { mutableStateOf("") }
    var cons by rememberSaveable { mutableStateOf("140") }
    var reserve by rememberSaveable { mutableFloatStateOf(15f) }
    SubScreen(stringResource(R.string.tools_trip), onBack) {
        Text(stringResource(R.string.trip_intro), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        GlassCard {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(dist, { dist = it.filter { ch -> ch.isDigit() || ch == '.' }.take(6) }, Modifier.weight(1f), label = { Text(stringResource(R.string.trip_distance)) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedTextField(cap, { cap = it.filter { ch -> ch.isDigit() || ch == '.' }.take(6) }, Modifier.weight(1f), label = { Text(stringResource(R.string.est_capacity)) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            }
            OutlinedTextField(cons, { cons = it.filter { ch -> ch.isDigit() || ch == '.' }.take(5) }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.trip_consumption)) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), supportingText = { Text(stringResource(R.string.trip_consumption_hint)) })
            Text(stringResource(R.string.est_current, soc.toInt()), style = MaterialTheme.typography.bodyMedium); Slider(soc, { soc = it }, valueRange = 0f..100f)
            Text(stringResource(R.string.trip_reserve, reserve.toInt()), style = MaterialTheme.typography.bodyMedium); Slider(reserve, { reserve = it }, valueRange = 5f..30f)
        }
        val d = dist.toDoubleOrNull(); val k = cap.toDoubleOrNull(); val w = cons.toDoubleOrNull()
        val result = runCatching {
            if (d == null || k == null || w == null || d <= 0 || d > 2000 || k <= 0 || k > 300 || w < 40 || w > 400) null
            else { val avail = Calculators.energyRequired(k, 0.0, soc.toDouble()); val range = Calculators.rangeKm(avail, w)
                val needKwh = d * w / 1000; val arrivePct = (avail - needKwh) / k * 100; Triple(range, needKwh, arrivePct) }
        }.getOrNull()
        GlassCard(accent = true) {
            if (result == null) Text(stringResource(R.string.trip_fill), style = MaterialTheme.typography.bodyMedium)
            else {
                val (range, need, arrive) = result
                Text(stringResource(R.string.trip_range, String.format(Locale.US, "%.0f", range)), style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.trip_need, String.format(Locale.US, "%.1f", need)), style = MaterialTheme.typography.bodyMedium)
                val ok = arrive >= reserve
                Text(if (arrive < 0) stringResource(R.string.trip_not_reachable) else stringResource(R.string.trip_arrive, String.format(Locale.US, "%.0f", arrive)),
                    style = MaterialTheme.typography.titleSmall, color = if (ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                if (!ok) { Text(stringResource(R.string.trip_charge_first, reserve.toInt()), style = MaterialTheme.typography.bodySmall); TextButton(onClick = openMap) { Text(stringResource(R.string.home_find_on_map)) } }
            }
            Text(Calculators.ASSUMPTIONS, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// ============================== SERVICE AREA ==============================
@Composable
fun ServiceAreaScreen(app: AppViewModel, onBack: () -> Unit, openHome: () -> Unit) {
    val st by app.state.collectAsStateWithLifecycle()
    val disco by NearVoltApp.instance.container.discovery.collectAsStateWithLifecycle()
    val areas = st.config?.serviceAreas.orEmpty()
    SubScreen(stringResource(R.string.tools_area), onBack) {
        GlassCard(accent = true) {
            Text(stringResource(R.string.area_live), style = MaterialTheme.typography.titleSmall)
            if (areas.isEmpty()) Text(stringResource(R.string.area_unknown), style = MaterialTheme.typography.bodyMedium)
            areas.forEach { a -> Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.CheckCircle, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp)); Text(a.name, style = MaterialTheme.typography.bodyLarge) } }
        }
        GlassCard {
            Text(stringResource(R.string.area_you), style = MaterialTheme.typography.titleSmall)
            val inside = disco.nearby?.serviceArea
            Text(when {
                disco.fix == null -> stringResource(R.string.area_no_fix)
                inside != null -> stringResource(R.string.area_inside, inside.name)
                disco.nearby != null -> stringResource(R.string.area_outside)
                else -> stringResource(R.string.area_checking)
            }, style = MaterialTheme.typography.bodyMedium)
            if (disco.fix?.approximate == true) Text(stringResource(R.string.loc_approx_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = openHome) { Text(stringResource(R.string.area_set_location)) }
        }
        Text(stringResource(R.string.area_expansion), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ============================== FEATURE INTRO ==============================
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FeatureIntro(onDone: () -> Unit) {
    val pages = listOf(Triple(Icons.Outlined.ElectricCar, R.string.intro_1_t, R.string.intro_1_b), Triple(Icons.Outlined.AutoAwesome, R.string.intro_2_t, R.string.intro_2_b),
        Triple(Icons.Outlined.Shield, R.string.intro_3_t, R.string.intro_3_b), Triple(Icons.Outlined.Handyman, R.string.intro_4_t, R.string.intro_4_b))
    val pager = rememberPagerState { pages.size }
    val scope = rememberCoroutineScope()
    androidx.activity.compose.BackHandler { onDone() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().systemBarsPadding().ambient().padding(24.dp)) {
            Row { Spacer(Modifier.weight(1f)); TextButton(onClick = onDone) { Text(stringResource(R.string.intro_skip)) } }
            HorizontalPager(pager, Modifier.weight(1f)) { i ->
                val (icon, t, b) = pages[i]
                Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(120.dp).clip(CircleShape).background(androidx.compose.ui.graphics.Brush.radialGradient(listOf(Brand.NeonMint, Brand.EmeraldBrand))), contentAlignment = Alignment.Center) {
                        if (i == 1) VoltMark(Modifier.size(64.dp), animate = !rememberReducedMotion()) else Icon(icon, null, Modifier.size(56.dp), tint = Color.White) }
                    Spacer(Modifier.height(24.dp))
                    Text(stringResource(t), style = MaterialTheme.typography.headlineSmall, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(b), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.Center) {
                repeat(pages.size) { i -> Box(Modifier.padding(4.dp).size(if (pager.currentPage == i) 22.dp else 8.dp, 8.dp).clip(CircleShape)
                    .background(if (pager.currentPage == i) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant)) }
            }
            PrimaryButton(stringResource(if (pager.currentPage == pages.lastIndex) R.string.intro_start else R.string.intro_next),
                { if (pager.currentPage == pages.lastIndex) onDone() else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } }, Modifier.fillMaxWidth())
        }
    }
}
