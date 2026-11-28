package com.nearvolt.ev.data.prefs

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.nearvolt.ev.data.api.NvJson
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.security.MessageDigest

private val Context.accountStore by preferencesDataStore("nearvolt_account_local")

/** A vehicle kept ONLY on this device (no server endpoint exists for multiple vehicles). The server keeps one primary vehicle. */
@Serializable data class GarageVehicle(
    val id: String, val type: String, val connector: String, val make: String = "", val model: String = "",
    val batteryKwh: Double? = null, val batteryPercent: Int? = null, val batteryUpdatedAt: Long? = null,
    /** V1.3: catalogue configuration id (assets/catalogue) the user picked, if any. Specs are read from the catalogue, never copied as "verified". */
    val catalogueId: String? = null,
)
/** One VOLT AI exchange. Text only, kept on this device for this account, cleared with "Clear conversation", sign-out and account deletion. */
@Serializable data class VoltTurn(val fromUser: Boolean, val text: String, val at: Long, val intent: String? = null, val actions: List<String> = emptyList())
/** Favourite = host id + display name only. No coordinates, no address, no cached availability. */
@Serializable data class FavouriteHost(val hostId: String, val name: String, val savedAt: Long)
/** Recent searches store only the text the user typed (manual area search), never GPS coordinates. */
@Serializable data class RecentSearch(val text: String, val at: Long)
@Serializable data class LocalAccountData(
    val garage: List<GarageVehicle> = emptyList(), val favourites: List<FavouriteHost> = emptyList(),
    val recents: List<RecentSearch> = emptyList(), val saveRecents: Boolean = true,
    // V1.3 (all device-local, account-scoped; older stored JSON decodes with these defaults)
    val favVehicles: List<String> = emptyList(), val recentVehicles: List<String> = emptyList(),
    val voltHistory: List<VoltTurn> = emptyList(), val voltSaveHistory: Boolean = true,
    val emergencyContacts: List<EmergencyContact> = emptyList(), val seenIntro13: Boolean = false,
)
/** A personal emergency contact the user typed in. Only used to open the dialler/share sheet; never uploaded. */
@Serializable data class EmergencyContact(val name: String, val phone: String)

/**
 * Account-scoped, device-local storage. Data for each signed-in account lives under a hashed uid key, so two accounts on one
 * phone never see each other's garage/favourites, and sign-out / account deletion wipes the current account's data.
 * Lives in app-private storage (not readable by other apps; excluded from backups via data_extraction_rules).
 */
class AccountStore(private val ctx: Context) {
    private fun key(uid: String) = stringPreferencesKey("acct_" + MessageDigest.getInstance("SHA-256").digest(uid.toByteArray()).joinToString("") { "%02x".format(it) }.take(32))

    fun data(uid: String): Flow<LocalAccountData> = ctx.accountStore.data.map { p ->
        p[key(uid)]?.let { runCatching { NvJson.decodeFromString(LocalAccountData.serializer(), it) }.getOrNull() } ?: LocalAccountData()
    }
    suspend fun current(uid: String) = data(uid).first()

    suspend fun update(uid: String, f: (LocalAccountData) -> LocalAccountData) {
        ctx.accountStore.edit { p ->
            val cur = p[key(uid)]?.let { runCatching { NvJson.decodeFromString(LocalAccountData.serializer(), it) }.getOrNull() } ?: LocalAccountData()
            p[key(uid)] = NvJson.encodeToString(f(cur).let { it.copy(recents = it.recents.take(MAX_RECENTS), favourites = it.favourites.take(MAX_FAVS), garage = it.garage.take(MAX_GARAGE),
                favVehicles = it.favVehicles.take(MAX_FAVS), recentVehicles = it.recentVehicles.take(MAX_RECENT_VEHICLES), voltHistory = it.voltHistory.takeLast(MAX_VOLT),
                emergencyContacts = it.emergencyContacts.take(MAX_CONTACTS)) })
        }
    }
    suspend fun wipe(uid: String) { ctx.accountStore.edit { it.remove(key(uid)) } }

    companion object { const val MAX_RECENTS = 8; const val MAX_FAVS = 50; const val MAX_GARAGE = 10; const val MAX_RECENT_VEHICLES = 10; const val MAX_VOLT = 80; const val MAX_CONTACTS = 5 }
}

/** Pure helpers (unit-tested). */
object LocalRules {
    fun toggleFavourite(d: LocalAccountData, hostId: String, name: String, now: Long): LocalAccountData =
        if (d.favourites.any { it.hostId == hostId }) d.copy(favourites = d.favourites.filterNot { it.hostId == hostId })
        else d.copy(favourites = listOf(FavouriteHost(hostId, name.take(80), now)) + d.favourites)

    fun addRecent(d: LocalAccountData, text: String, now: Long): LocalAccountData {
        val t = text.trim().take(120)
        if (!d.saveRecents || t.length < 3 || looksLikeCoordinates(t)) return d
        return d.copy(recents = (listOf(RecentSearch(t, now)) + d.recents.filterNot { it.text.equals(t, true) }).take(AccountStore.MAX_RECENTS))
    }
    /** Coordinates / map links are precise locations: never persisted. */
    fun looksLikeCoordinates(t: String) = Regex("-?\\d{1,3}\\.\\d{3,}\\s*,\\s*-?\\d{1,3}\\.\\d{3,}").containsMatchIn(t) || t.contains("maps", true) || t.contains("goo.gl", true)

    fun upsertVehicle(d: LocalAccountData, v: GarageVehicle) = d.copy(garage = if (d.garage.any { it.id == v.id }) d.garage.map { if (it.id == v.id) v else it } else d.garage + v)
    fun removeVehicle(d: LocalAccountData, id: String) = d.copy(garage = d.garage.filterNot { it.id == id })
    fun toggleFavVehicle(d: LocalAccountData, id: String) = d.copy(favVehicles = if (id in d.favVehicles) d.favVehicles - id else listOf(id) + d.favVehicles)
    fun viewedVehicle(d: LocalAccountData, id: String) = d.copy(recentVehicles = (listOf(id) + d.recentVehicles.filterNot { it == id }).take(AccountStore.MAX_RECENT_VEHICLES))
    fun addVolt(d: LocalAccountData, turns: List<VoltTurn>) = if (!d.voltSaveHistory) d else d.copy(voltHistory = (d.voltHistory + turns.map { it.copy(text = it.text.take(2000)) }).takeLast(AccountStore.MAX_VOLT))
    /** Indian mobile or landline-ish digits only (with optional +91); 6–13 digits. Name ≤ 40 chars. */
    fun validContact(name: String, phone: String) = name.isNotBlank() && name.length <= 40 && Regex("^\\+?\\d{6,13}$").matches(phone.replace(" ", ""))
}

/** Charging estimate. Inputs are user-entered; output is an estimate, never telemetry. */
object ChargeEstimator {
    data class Estimate(val energyKwh: Double, val hours: Double)
    /** Returns null for invalid input (non-positive capacity/power, out-of-range or target ≤ current). */
    fun estimate(capacityKwh: Double, currentPct: Double, targetPct: Double, powerKw: Double): Estimate? {
        if (capacityKwh <= 0 || capacityKwh > 300 || powerKw <= 0 || powerKw > 400) return null
        if (currentPct !in 0.0..100.0 || targetPct !in 0.0..100.0 || targetPct <= currentPct) return null
        val e = capacityKwh * (targetPct - currentPct) / 100.0
        return Estimate(e, e / powerKw)
    }
    fun formatHours(h: Double): String { val m = Math.round(h * 60); return if (m < 60) "$m min" else "${m / 60} h ${m % 60} min" }
}
