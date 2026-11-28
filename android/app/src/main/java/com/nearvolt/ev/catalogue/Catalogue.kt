package com.nearvolt.ev.catalogue

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Indian EV catalogue (owner-supplied research, cut-off 2026-10-22; built by scripts/build-vehicle-catalogue.py).
 * null always means "not publicly verified" — never zero, never guessed. Nothing here is live data or a booking guarantee.
 */
@Serializable data class CatalogueVehicle(
    val id: String, val brand: String, val ownership: String? = null, val model: String, val variant: String? = null, val year: Int? = null,
    val status: String? = null, val batteryKwh: Double? = null,
    val acSupported: Boolean? = null, val acMaxKw: Double? = null, val dcSupported: Boolean? = null, val dcMaxKw: Double? = null,
    val ac0to100h: Double? = null, val acWindow: String? = null, val dc10to80min: Double? = null, val dc0to100h: Double? = null, val otherDcWindow: String? = null,
    val acConnectorLabel: String? = null, val acConnector: String? = null, val dcConnectorLabel: String? = null, val dcConnector: String? = null,
    val rangeKm: Double? = null, val rangeStandard: String? = null, val batteryEvidence: String? = null, val chargingEvidence: String? = null,
    val sourceUrl: String? = null, val secondarySourceUrl: String? = null, val checkedAt: String? = null, val notes: String? = null,
    val tierScreening: Map<String, String> = emptyMap(),
) {
    val title get() = "$model${variant?.let { " · $it" } ?: ""}"
    val shortBrand get() = brand.substringBefore(" /").replace("JSW MG Motor India", "MG").replace(" Motors", "").replace(" Electric Car Company", "")
    val isCurrent get() = status?.startsWith("Current") == true
    /** App connector codes this configuration verifiably uses (only Type 2 AC / CCS2 DC with supported=true). */
    val verifiedConnectors get() = listOfNotNull(acConnector, dcConnector)
    val searchText by lazy { listOfNotNull(brand, model, variant, acConnectorLabel, dcConnectorLabel, year?.toString()).joinToString(" ").lowercase() }
}
@Serializable data class SupplementaryClaim(val model: String, val batteryAsPrinted: String? = null, val acAsPrinted: String? = null, val dcAsPrinted: String? = null,
    val timeAsPrinted: String? = null, val source: String)
@Serializable data class CatalogueMeta(val researchCutoff: String? = null, val scope: String? = null, val caution: String? = null, val images: String? = null,
    val counts: Map<String, Int> = emptyMap())
@Serializable data class CatalogueFile(val meta: CatalogueMeta, val vehicles: List<CatalogueVehicle>, val supplementaryClaims: List<SupplementaryClaim> = emptyList())

object CatalogueRepo {
    private val json = Json { ignoreUnknownKeys = true }
    private val lock = Mutex()
    @Volatile private var cached: CatalogueFile? = null
    fun parse(text: String): CatalogueFile = json.decodeFromString(CatalogueFile.serializer(), text)
    /** Parsed once per process, off the main thread (≈100 KB asset). */
    suspend fun load(ctx: Context): CatalogueFile = cached ?: lock.withLock {
        cached ?: withContext(Dispatchers.IO) { parse(ctx.assets.open("catalogue/vehicles.json").bufferedReader().use { it.readText() }) }.also { cached = it }
    }
    fun peek() = cached
}

data class CatalogueFilter(val query: String = "", val brand: String? = null, val currentOnly: Boolean = false, val dcOnly: Boolean = false,
    val verifiedAcOnly: Boolean = false, val sort: Sort = Sort.BRAND) {
    enum class Sort { BRAND, RANGE, BATTERY, NEWEST }
}

object CatalogueSearch {
    fun apply(all: List<CatalogueVehicle>, f: CatalogueFilter): List<CatalogueVehicle> {
        val words = f.query.lowercase().split(' ').filter { it.isNotBlank() }
        val r = all.filter { v ->
            (f.brand == null || v.brand == f.brand) && (!f.currentOnly || v.isCurrent) && (!f.dcOnly || v.dcSupported == true) &&
                (!f.verifiedAcOnly || v.acMaxKw != null) && words.all { w -> v.searchText.contains(w) }
        }
        return when (f.sort) {
            CatalogueFilter.Sort.BRAND -> r.sortedWith(compareBy({ it.brand }, { it.model }, { it.year ?: 0 }))
            CatalogueFilter.Sort.RANGE -> r.sortedWith(compareByDescending<CatalogueVehicle> { it.rangeKm ?: -1.0 }.thenBy { it.model })   // unknowns last
            CatalogueFilter.Sort.BATTERY -> r.sortedWith(compareByDescending<CatalogueVehicle> { it.batteryKwh ?: -1.0 }.thenBy { it.model })
            CatalogueFilter.Sort.NEWEST -> r.sortedWith(compareByDescending<CatalogueVehicle> { it.year ?: 0 }.thenBy { it.model })
        }
    }
}

/**
 * Compatibility SCREENING between a catalogue configuration and a NEARVOLT host charger.
 * - Station output (host) and vehicle acceptance (catalogue) are kept separate; effective AC power = min(both) only when both are known.
 * - A matching connector is NOT proof of compatibility; the best result is SCREENED_MATCH, never "guaranteed".
 * - Unknown data -> UNVERIFIED, which never authorizes charging by itself (request flow still needs the user's confirmation,
 *   host acceptance and the server-side checks + session PIN).
 */
object CompatibilityEngine {
    enum class Level { SCREENED_MATCH, UNVERIFIED, INCOMPATIBLE }
    data class Result(val level: Level, val sharedConnectors: List<String>, val effectiveAcKw: Double?, val reasons: List<String>) {
        /** Only an INCOMPATIBLE result blocks; anything else still needs explicit user confirmation + host acceptance + server checks. */
        val blocksRequest get() = level == Level.INCOMPATIBLE
    }
    private val SOCKETS = setOf("DOMESTIC_15A", "INDUSTRIAL_16A")
    private val AC = setOf("TYPE2_AC", "BHARAT_AC001", "LECCS")
    private val DC = setOf("CCS2", "BHARAT_DC001", "CHADEMO", "GBT")

    fun screen(v: CatalogueVehicle, hostConnectors: List<String>, hostPowerKw: Double?, hostChargerType: String? = null): Result {
        val reasons = mutableListOf<String>()
        val shared = v.verifiedConnectors.filter { it in hostConnectors }
        // Is everything about the car's inlets known? (AC side known, and DC side known or verified absent.)
        val acKnown = v.acSupported == false || v.acConnector != null
        val dcKnown = v.dcSupported == false || v.dcConnector != null
        if (shared.isEmpty()) {
            if (hostConnectors.isEmpty()) return Result(Level.UNVERIFIED, emptyList(), null, listOf("The charger did not list its connectors."))
            // A wall socket is not a vehicle inlet: many cars charge from it with their own portable charger (EVSE). Never "incompatible", never verified.
            if (hostConnectors.any { it in SOCKETS }) return Result(Level.UNVERIFIED, emptyList(), null,
                listOf("This host offers a ${hostConnectors.filter { it in SOCKETS }.joinToString { if (it == "DOMESTIC_15A") "15 A home socket" else "16 A industrial socket" }}. It needs your vehicle's own portable charger rated for that socket and a properly earthed circuit — not verified here."))
            return if (acKnown && dcKnown && v.verifiedConnectors.isNotEmpty())
                Result(Level.INCOMPATIBLE, emptyList(), null, listOf("Charger connectors (${hostConnectors.joinToString()}) do not match this vehicle's verified inlets (${v.verifiedConnectors.joinToString()})."))
            else Result(Level.UNVERIFIED, emptyList(), null, listOf("This configuration's inlet is not publicly verified (${listOfNotNull(v.acConnectorLabel, v.dcConnectorLabel).joinToString(" / ").ifBlank { "unknown" }}). Check the vehicle manual or VIN."))
        }
        var effective: Double? = null
        val acShared = shared.any { it in AC }
        if (acShared) {
            val hp = hostPowerKw?.takeIf { it > 0 }
            when {
                hp != null && v.acMaxKw != null -> { effective = minOf(hp, v.acMaxKw); reasons += "AC power is limited to ${fmt(effective)} kW (charger ${fmt(hp)} kW, vehicle on-board charger ${fmt(v.acMaxKw)} kW)." }
                hp != null -> reasons += "Charger offers ${fmt(hp)} kW AC; this vehicle's on-board charger limit is not publicly verified, so actual power may be lower."
                else -> reasons += "Charger power is not listed."
            }
        }
        if (shared.any { it in DC }) reasons += if (v.dcMaxKw != null) "DC acceptance up to ${fmt(v.dcMaxKw)} kW (peak, not sustained)." else "DC acceptance limit not publicly verified."
        reasons += "A matching connector is a screening result, not a guarantee. Confirm voltage, phase, cable and the vehicle manual before charging."
        val level = if (acShared && v.acMaxKw != null || !acShared && v.dcMaxKw != null) Level.SCREENED_MATCH else Level.UNVERIFIED
        return Result(level, shared, effective, reasons)
    }
    private fun fmt(d: Double) = if (d % 1.0 == 0.0) d.toInt().toString() else "%.1f".format(java.util.Locale.US, d)
}

/** Charging-time information. Manufacturer claims and estimates are always kept separate and labelled. */
object ChargeTime {
    data class Claim(val label: String, val window: String, val value: String)
    data class Estimate(val energyKwh: Double, val hours: Double, val powerKw: Double, val powerBasis: String, val assumptions: String)
    const val EFFICIENCY = 0.9

    fun claims(v: CatalogueVehicle): List<Claim> = buildList {
        v.ac0to100h?.let { add(Claim("AC, manufacturer", "0–100%", hours(it))) }
        v.acWindow?.takeIf { v.ac0to100h == null }?.let { add(Claim("AC, published", "as published", it)) }
        v.dc10to80min?.let { add(Claim("DC, manufacturer", "10–80%", "${it.toInt()} min")) }
        v.dc0to100h?.let { add(Claim("DC, manufacturer", "0–100%", hours(it))) }
        v.otherDcWindow?.let { add(Claim("DC, published", "as published", it)) }
    }

    /**
     * AC-only planning estimate. DC is never extrapolated from peak power (DC tapers heavily); only published DC claims are shown.
     * Returns null for invalid input or missing battery size.
     */
    fun acEstimate(v: CatalogueVehicle, currentPct: Double, targetPct: Double, chargerKw: Double): Estimate? {
        val cap = v.batteryKwh ?: return null
        if (chargerKw <= 0 || chargerKw > 50 || currentPct !in 0.0..100.0 || targetPct !in 0.0..100.0 || targetPct <= currentPct) return null
        val power = v.acMaxKw?.let { minOf(it, chargerKw) } ?: chargerKw
        val basis = if (v.acMaxKw != null) "min(charger ${fmt(chargerKw)} kW, vehicle ${fmt(v.acMaxKw)} kW)" else "charger ${fmt(chargerKw)} kW — vehicle limit unverified, may be slower"
        val energy = cap * (targetPct - currentPct) / 100.0
        return Estimate(energy, energy / (power * EFFICIENCY), power, basis,
            "Planning estimate, not telemetry. Assumes ${(EFFICIENCY * 100).toInt()}% charging efficiency and the listed battery capacity (may be gross, not usable). Temperature, battery condition and supply voltage change real times.")
    }
    fun hours(h: Double): String { val m = Math.round(h * 60); return if (m < 60) "$m min" else if (m % 60 == 0L) "${m / 60} h" else "${m / 60} h ${m % 60} min" }
    private fun fmt(d: Double) = if (d % 1.0 == 0.0) d.toInt().toString() else "%.1f".format(java.util.Locale.US, d)
}
