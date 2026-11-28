package com.nearvolt.ev.volt

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.builtins.serializer
import java.text.Normalizer
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * VOLT AI — Kotlin port of the owner's standalone VOLT AI V1 engine (src/engine TypeScript sources, reviewed 2026-11-28).
 * Deterministic, knowledge-based: rules + normalized token retrieval + validated calculators. It is NOT a generative model.
 * The same 114 knowledge records and the same 115-case benchmark are used (assets/volt, test resources).
 * Any app action it suggests only navigates; protected actions still need the user's explicit confirmation and server authorization.
 */
@Serializable data class Knowledge(
    val id: String, val category: String, val patterns: List<String>, val keywords: List<String> = emptyList(),
    val answer: String, val source: String, val safety: String = "general", val reviewStatus: String, val reviewedAt: String = "",
)
@Serializable data class VoltSource(val title: String, val url: String? = null, val scope: String = "", val checkedAt: String = "")

enum class VoltAction(val label: String) {
    OPEN_MAP("Open map"), FIND_COMPATIBLE_HOST("Find compatible charging"), OPEN_GARAGE("My Garage"), OPEN_ACTIVITY("Activity"),
    OPEN_SUPPORT("Support"), OPEN_SAFETY("Safety centre"), CALCULATE_CHARGING_TIME("Charging calculator"), OPEN_EMERGENCY_DIALER("Emergency options · 112"),
    // V1.4 host shortcuts: shown by the app in Host mode only (the engine never emits them). Navigation only — nothing is approved.
    OPEN_HOST_DASHBOARD("Host dashboard"), OPEN_LISTING("My listing"),
}
data class Action(val type: VoltAction, val label: String)

@Serializable data class VehicleContext(val type: String? = null, val manufacturer: String? = null, val model: String? = null, val capacity: Double? = null,
    val connector: String? = null, val soc: Double? = null, val consumption: Double? = null)
@Serializable data class Calculation(val energy: Double? = null, val power: Double? = null, val target: Double? = null, val efficiency: Double? = null)
@Serializable data class UserContext(val vehicle: VehicleContext = VehicleContext(), val lastIntent: String? = null, val lastKnowledgeId: String? = null,
    val language: String = "en", val calculation: Calculation = Calculation())

data class VoltResponse(val intent: String, val text: String, val confidence: Double, val knowledgeIds: List<String>, val sourceIds: List<String>,
    val actions: List<Action>, val context: UserContext)

object Calculators {
    private fun valid(n: Double, name: String, minV: Double, maxV: Double = Long.MAX_VALUE.toDouble()) { if (!n.isFinite() || n < minV || n > maxV) throw IllegalArgumentException("$name must be between ${fmt(minV)} and ${fmt(maxV)}.") }
    private fun fmt(d: Double) = if (d == Long.MAX_VALUE.toDouble()) "9007199254740991" else if (d % 1.0 == 0.0) d.toLong().toString() else d.toString()
    private fun positive(n: Double, name: String) { valid(n, name, 0.0); if (n == 0.0) throw IllegalArgumentException("$name must be greater than zero.") }
    private fun result(n: Double): Double { if (!n.isFinite() || n > 9007199254740991.0) throw IllegalArgumentException("Result exceeds supported numeric range."); return n }
    fun energyRequired(capacity: Double, current: Double, target: Double): Double {
        positive(capacity, "Capacity"); valid(current, "Current percentage", 0.0, 100.0); valid(target, "Target percentage", 0.0, 100.0)
        if (target < current) throw IllegalArgumentException("Target must be at least the current percentage.")
        return result(capacity * (target - current) / 100)
    }
    fun chargingHours(energy: Double, power: Double, efficiency: Double = 0.9): Double {
        valid(energy, "Energy", 0.0); positive(power, "Power"); positive(efficiency, "Efficiency"); valid(efficiency, "Efficiency", 0.0, 1.0)
        return result(energy / (power * efficiency))
    }
    fun rangeKm(energy: Double, consumption: Double): Double { valid(energy, "Energy", 0.0); positive(consumption, "Consumption"); return result(energy * 1000 / consumption) }
    const val ASSUMPTIONS = "Planning estimate only, not live telemetry. Use usable capacity and realistic consumption. Charging power varies with vehicle limits, temperature and tapering. Efficiency accounts for losses; do not count losses twice."
}

class VoltEngine(val knowledge: List<Knowledge>, val sources: Map<String, VoltSource> = emptyMap()) {
    companion object {
        private val json = Json { ignoreUnknownKeys = true }
        fun fromJson(knowledgeJson: String, sourcesJson: String? = null) = VoltEngine(
            json.decodeFromString(kotlinx.serialization.builtins.ListSerializer(Knowledge.serializer()), knowledgeJson),
            sourcesJson?.let { json.decodeFromString(kotlinx.serialization.builtins.MapSerializer(String.serializer(), VoltSource.serializer()), it) } ?: emptyMap())

        private val synonyms = mapOf("battary" to "battery", "batery" to "battery", "battrery" to "battery", "batteries" to "battery", "chargingg" to "charging",
            "chargin" to "charging", "charger" to "charging", "chargers" to "charging", "kilometres" to "range", "kilometers" to "range", "kms" to "range",
            "automobile" to "vehicle", "car" to "vehicle", "cars" to "vehicle", "scooty" to "scooter", "nearvolt" to "nearvolt", "vizag" to "visakhapatnam",
            "plug" to "connector", "plugs" to "connector", "cost" to "price", "duration" to "duration", "works" to "work", "varies" to "vary", "stores" to "store",
            "discharging" to "discharge")
        private val stop = "what is a an the are of for to i my can do does it me please tell about how and in on with you would should explain give some why mean meaning describe".split(' ').toSet()
        private val zeroWidth = Regex("[\u200B-\u200D\uFEFF]")
        private val nonWord = Regex("[^\\p{L}\\p{N}%.\\s-]")
        private val ws = Regex("\\s+")

        fun normalize(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFKC).lowercase().replace(zeroWidth, "").replace(nonWord, " ")
            .split(ws).joinToString(" ") { synonyms[it] ?: it }.trim()
        fun tokens(s: String) = normalize(s).split(ws).filter { it.isNotEmpty() && it !in stop }

        fun distance(a: String, b: String): Int {
            if (abs(a.length - b.length) > 1) return 2
            val d = IntArray(b.length + 1) { it }
            for (i in 1..a.length) { var prev = d[0]; d[0] = i
                for (j in 1..b.length) { val old = d[j]; d[j] = minOf(d[j] + 1, d[j - 1] + 1, prev + if (a[i - 1] == b[j - 1]) 0 else 1); prev = old } }
            return d[b.length]
        }
        // JS \b with the default (non-unicode) flag is ASCII-based; Java's \b is too unless UNICODE_CHARACTER_CLASS is set.
        private fun r(p: String) = Regex(p)
        private val reEmergency = r("\\b(smoke|smoking|fire|flames|burning|sparks|sparking|electrocut|electric shock|hissing|swollen|swelling|bulging|leaking|overheating|crash|collision|flooded|stranded.*(?:road|highway))\\b")
        private val reUnsafe = r("\\b(bypass|disable|remove|override|bridge|short)\\b.*\\b(bms|rcd|earth|ground|fuse|protection|safety|interlock)\\b|\\b(diy|homemade|rewire)\\b|exposed wire")
        private val reInjection = r("ignore.*(?:instruction|rule)|system prompt|api key|password|secret key|execute|<script|javascript:")
        private val reGreeting = r("^(hi|hello|hey|namaste|నమస్కారం|నమస్తే|హాయ్|नमस्ते)[.!\\s]*$")
        private val reLowBattery = r("\\b(low battery|battery (?:is )?low|running out|battery dead|out of charge|stranded)\\b")
        private val reFind = r("\\b(find|nearby|near me|nearest|open map|locate)\\b.*\\b(charging|host|station|map)\\b|\\b(charging|host|station)\\b.*\\b(nearby|near me|nearest)\\b|^open map$")
        private val reCompat = r("\\b(compatible|compatibility|fit|adapter)\\b")
        private val reVehicle = r("\\b(vehicle profile|my vehicle|garage)\\b")
        private val reCalcWord = r("\\b(calculate|estimate|how long|how far)\\b|\\d")
        private val reCalc = r("\\b(calculate|estimate|how long|how far|hours|time|energy required|range)\\b")
        private val reFollow = r("^(and |what about |now |then |at |to |use |same|how long|how far)")
        private val reNumOnly = r("^[-\\d.]+\\s*(kw|kwh|%)$")
        private val reMore = r("^(and |what about |tell me more|explain more|why|is it safe)")
    }

    private val corpus = knowledge.filter { it.reviewStatus != "needs-review" }.map { it to it.patterns.map { p -> tokens(p) } }

    fun retrieve(query: String): List<Pair<Knowledge, Double>> {
        val q = tokens(query)
        return corpus.map { (entry, patterns) ->
            var score = 0.0
            for (p in patterns) {
                val hit = q.count { t -> p.any { w -> w == t || (t.length > 4 && w.length > 4 && distance(t, w) <= 1) } }
                val exact = q.isNotEmpty() && q.joinToString(" ") == p.joinToString(" ")
                val v = if (exact) 1.0 else if (hit > 0) hit.toDouble() / max(q.size, p.size) * 0.82 + min(hit, 3) * 0.04 else 0.0
                score = max(score, v)
            }
            entry to score
        }.sortedByDescending { it.second }   // stable sort, same tie order as JS Array.sort (stable since ES2019)
    }

    private fun num(n: String, re: Regex) = re.find(n)?.groupValues?.get(1)?.toDoubleOrNull()

    fun extractEntities(input: String, context: UserContext): UserContext {
        val n = normalize(input)
        var v = context.vehicle; var c = context.calculation
        val cap = num(n, Regex("(-?\\d+(?:\\.\\d+)?)\\s*kwh\\b"))
        if (cap != null && !Regex("(?:available|usable|remaining|required|energy|need)\\s*-?\\d+(?:\\.\\d+)?\\s*kwh").containsMatchIn(n)) v = v.copy(capacity = cap)
        num(n, Regex("(?:at|current|remaining|from|battery is)\\s*(-?\\d+(?:\\.\\d+)?)\\s*%"))?.let { v = v.copy(soc = it) }
        num(n, Regex("(?:to|target)\\s*(-?\\d+(?:\\.\\d+)?)\\s*%"))?.let { c = c.copy(target = it) }
        num(n, Regex("(-?\\d+(?:\\.\\d+)?)\\s*kw\\b"))?.let { c = c.copy(power = it) }
        num(n, Regex("(-?\\d+(?:\\.\\d+)?)\\s*wh\\s*(?:per\\s*)?(?:km|range)"))?.let { v = v.copy(consumption = it) }
        num(n, Regex("(?:efficiency\\s*)(-?\\d+(?:\\.\\d+)?)\\s*%"))?.let { c = c.copy(efficiency = it / 100) }
        Regex("\\b(ccs2|ccs1|type 2|type 1|chademo|nacs|j1772)\\b").find(n)?.let { v = v.copy(connector = it.groupValues[1]) }
        return context.copy(vehicle = v, calculation = c)
    }

    fun respond(input: String, previous: UserContext = UserContext()): VoltResponse {
        var c = extractEntities(input.take(1200), previous)
        val n = normalize(input)
        var intent = "unknown"
        fun make(text: String, confidence: Double = 0.95, ids: List<String> = emptyList(), actions: List<Action> = emptyList()): VoltResponse =
            VoltResponse(intent, text, confidence, ids, ids.mapNotNull { id -> knowledge.firstOrNull { it.id == id }?.source }.distinct(), actions,
                c.copy(lastIntent = intent, lastKnowledgeId = ids.firstOrNull()))
        fun act(t: VoltAction, l: String) = Action(t, l)

        if (input.isBlank() || input.length > 1200) return make("Please enter an EV question of 1–1,200 characters.", 0.0)
        // Safety precedence (same order as the TS engine).
        if (reEmergency.containsMatchIn(n)) { intent = "emergency"
            return make("If there is smoke, fire, electric shock or immediate danger: move away, keep others clear and dial 112 in India. Do not touch damaged equipment, open the battery or attempt repairs. If there is no immediate danger, stop using the affected equipment and contact qualified service. No call is placed automatically.",
                1.0, listOf("emergency-number", "damaged", "swelling"), listOf(act(VoltAction.OPEN_EMERGENCY_DIALER, "Emergency options · 112"))) }
        if (reUnsafe.containsMatchIn(n)) { intent = "safety"
            return make("Do not bypass electrical protection or improvise charging wiring. Stop using the equipment and ask a qualified electrician or authorized vehicle service to assess it.",
                1.0, listOf("home-safety", "high-voltage"), listOf(act(VoltAction.OPEN_SAFETY, "Charging safety"))) }
        if (reInjection.containsMatchIn(n)) return make("I cannot disclose credentials, execute code or change safety rules. I can help with EV knowledge and estimates.", 0.0)
        if (reGreeting.containsMatchIn(input.trim().lowercase())) { intent = "greeting"
            return make(when (c.language) { "te" -> "నమస్కారం! EV గురించి అడగండి. Technical answers are currently in English."
                "hi" -> "नमस्ते! EV के बारे में पूछें। Technical answers are currently in English."
                else -> "Hello, I’m VOLT AI. Ask about charging, battery care or your next electric journey. I use local knowledge, not a generative model." }) }
        val pct = Regex("(\\d+)\\s*%").find(n)?.groupValues?.get(1)?.toDoubleOrNull()
        if (reLowBattery.containsMatchIn(n) || (Regex("\\b[0-9]+\\s*%").containsMatchIn(n) && n.contains("battery") && pct != null && pct <= 10)) { intent = "low-battery"
            return make("Find a safe place to stop before charge runs out. Confirm a reachable, compatible charger or use NEARVOLT emergency charging. Availability depends on nearby verified hosts accepting your request. Do not continue driving based only on a calculated range.",
                0.98, listOf("low-battery", "live-hosts"), listOf(act(VoltAction.FIND_COMPATIBLE_HOST, "Find compatible charging"), act(VoltAction.OPEN_SUPPORT, "Assistance options"))) }
        if (reFind.containsMatchIn(n)) { intent = "find-charging"
            // NEARVOLT-integrated wording (the standalone said "requires integration"); results still come only from the live map.
            return make("Open the map to see verified NEARVOLT hosts near you. Availability shown there comes from the server; I cannot see it myself. Always confirm connector compatibility before requesting.",
                1.0, listOf("live-hosts"), listOf(act(VoltAction.OPEN_MAP, "Open map"))) }
        if (reCompat.containsMatchIn(n)) { intent = "compatibility"
            return make("Confirm the exact vehicle, connector, charger specifications and manufacturer approval. ${c.vehicle.connector?.let { "Your entered connector is $it; this is not independently verified. " } ?: ""}Matching plug shape alone does not certify compatibility. Never force or improvise adapters.",
                0.95, listOf("compatibility", "connector"), listOf(act(VoltAction.OPEN_GARAGE, "Add vehicle details"))) }
        if (reVehicle.containsMatchIn(n)) { intent = "vehicle"
            return make("Add your vehicle in My Garage. I use your entered capacity, percentage and consumption for estimates; no live vehicle telemetry is connected.", 1.0, listOf("vehicle-profile"), listOf(act(VoltAction.OPEN_GARAGE, "My Garage"))) }
        val concept = retrieve(n).firstOrNull()
        if (!reCalcWord.containsMatchIn(n) && concept != null && concept.second >= 0.57 && concept.first.category in setOf("time", "energy", "range", "battery")) {
            intent = concept.first.category; return make(concept.first.answer, min(0.97, concept.second), listOf(concept.first.id)) }
        val hasNumericContext = Regex("\\d").containsMatchIn(n) && Regex("kwh|kw|%|wh").containsMatchIn(n)
        val follow = reFollow.containsMatchIn(n) || reNumOnly.containsMatchIn(n)
        val calcPrev = previous.lastIntent in setOf("time", "energy", "range")
        if (reCalc.containsMatchIn(n) || ((follow || hasNumericContext) && calcPrev)) {
            intent = when {
                Regex("\\b(range|how far|distance)\\b").containsMatchIn(n) -> "range"
                Regex("\\b(energy required|energy needed|calculate energy|estimate energy)\\b").containsMatchIn(n) -> "energy"
                Regex("\\b(time|how long|hours)\\b").containsMatchIn(n) -> "time"
                else -> if (calcPrev) previous.lastIntent!! else "time"
            }
            val v = c.vehicle; val x = c.calculation
            try {
                if (intent == "range") {
                    var available: Double? = Regex("(?:available|usable|remaining)\\s*(-?\\d+(?:\\.\\d+)?)\\s*kwh").find(n)?.groupValues?.get(1)?.toDouble()
                    if (available == null && v.capacity != null && v.soc != null) available = Calculators.energyRequired(v.capacity, 0.0, v.soc)
                    if (available == null || v.consumption == null) return make("Enter available energy and consumption, for example “range with available 12 kWh at 150 Wh/km”, or add capacity, percentage and consumption in My Garage.",
                        0.9, listOf("range-formula"), listOf(act(VoltAction.CALCULATE_CHARGING_TIME, "Open calculators")))
                    return make("Estimated range: ${"%.1f".format(java.util.Locale.US, Calculators.rangeKm(available, v.consumption))} km, using ${"%.2f".format(java.util.Locale.US, available)} kWh and ${fmtNum(v.consumption)} Wh/km. Keep a reserve. ${Calculators.ASSUMPTIONS}", 0.95, listOf("range-formula"))
                }
                var energy: Double? = Regex("(?:required|energy|need)\\s*(-?\\d+(?:\\.\\d+)?)\\s*kwh").find(n)?.groupValues?.get(1)?.toDouble()
                if (energy == null && v.capacity != null && v.soc != null && x.target != null) energy = Calculators.energyRequired(v.capacity, v.soc, x.target)
                if (energy == null && follow) energy = x.energy
                if (energy == null) return make("What are your usable battery capacity, current percentage and target percentage? For example: “40 kWh, from 20% to 80%”. For time, also provide effective power in kW.",
                    0.9, listOf("energy-formula"), listOf(act(VoltAction.CALCULATE_CHARGING_TIME, "Open calculators")))
                c = c.copy(calculation = c.calculation.copy(energy = energy))
                if (intent == "energy") { Calculators.chargingHours(energy, 1.0, 1.0); return make("Estimated battery energy required: ${"%.2f".format(java.util.Locale.US, energy)} kWh. ${Calculators.ASSUMPTIONS}", 0.95, listOf("energy-formula")) }
                if (x.power == null) return make("Required battery energy: ${"%.2f".format(java.util.Locale.US, energy)} kWh. What effective charging power in kW should I use? Efficiency defaults to 90% unless you specify it.", 0.95, listOf("time-formula"))
                val eff = x.efficiency ?: 0.9
                return make("Estimated charging time: ${"%.2f".format(java.util.Locale.US, Calculators.chargingHours(energy, x.power, eff))} hours for ${"%.2f".format(java.util.Locale.US, energy)} kWh at ${fmtNum(x.power)} kW and ${"%.0f".format(java.util.Locale.US, eff * 100)}% efficiency. ${Calculators.ASSUMPTIONS}", 0.95, listOf("time-formula"))
            } catch (e: IllegalArgumentException) { return make("I cannot calculate that: ${e.message}", 1.0, emptyList(), listOf(act(VoltAction.CALCULATE_CHARGING_TIME, "Check calculator inputs"))) }
        }
        if (reMore.containsMatchIn(n) && previous.lastKnowledgeId != null && tokens(n).size <= 2) {
            intent = "follow-up"
            knowledge.firstOrNull { it.id == previous.lastKnowledgeId }?.let { return make("Continuing our previous topic: ${it.answer} For a more specific answer, mention the aspect you want to explore.", 0.7, listOf(it.id)) }
        }
        val best = retrieve(n).firstOrNull()
        if (best != null && best.second >= 0.57) {
            intent = best.first.category
            val actions = when (intent) { "host", "request", "pin" -> listOf(act(VoltAction.OPEN_ACTIVITY, "Activity")); "support" -> listOf(act(VoltAction.OPEN_SUPPORT, "Support options"))
                "trip" -> listOf(act(VoltAction.CALCULATE_CHARGING_TIME, "Estimate your range")); "safety", "home" -> listOf(act(VoltAction.OPEN_SAFETY, "Safety checklist")); else -> emptyList() }
            return make(best.first.answer, min(0.97, best.second), listOf(best.first.id), actions)
        }
        return make("I don’t have a sufficiently reliable answer in my reviewed knowledge. Try a more specific EV question, or consult the vehicle manual. I cannot provide live prices, vehicle diagnostics, weather or host availability.", best?.second ?: 0.0)
    }
    private fun fmtNum(d: Double) = if (d % 1.0 == 0.0) d.toLong().toString() else d.toString()
}
