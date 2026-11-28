package com.nearvolt.ev

import com.nearvolt.ev.data.api.HostSummary
import com.nearvolt.ev.data.api.NvJson
import com.nearvolt.ev.data.prefs.*
import com.nearvolt.ev.ui.screens.MapFilters
import kotlinx.serialization.encodeToString
import org.junit.Assert.*
import org.junit.Test

class V12Test {
    // ---- Battery & charging estimator ----
    @Test fun estimatorFormula() {
        val e = ChargeEstimator.estimate(40.5, 20.0, 80.0, 7.2)!!
        assertEquals(24.3, e.energyKwh, 1e-9)            // 40.5 × 60 / 100
        assertEquals(24.3 / 7.2, e.hours, 1e-9)           // 3.375 h
        assertEquals("3 h 23 min", ChargeEstimator.formatHours(e.hours))
        assertEquals("45 min", ChargeEstimator.formatHours(0.75))
    }
    @Test fun estimatorRejectsInvalidInput() {
        assertNull(ChargeEstimator.estimate(0.0, 20.0, 80.0, 7.0))
        assertNull(ChargeEstimator.estimate(40.0, 80.0, 80.0, 7.0))   // target must exceed current
        assertNull(ChargeEstimator.estimate(40.0, 90.0, 20.0, 7.0))
        assertNull(ChargeEstimator.estimate(40.0, -1.0, 80.0, 7.0))
        assertNull(ChargeEstimator.estimate(40.0, 20.0, 101.0, 7.0))
        assertNull(ChargeEstimator.estimate(40.0, 20.0, 80.0, 0.0))
    }

    // ---- Favourites privacy ----
    @Test fun favouritesStoreNoLocationOrAvailability() {
        val d = LocalRules.toggleFavourite(LocalAccountData(), "h1", "Sai Home Charging", 1L)
        val json = NvJson.encodeToString(d)
        assertTrue(json.contains("h1")); assertFalse(json.contains("lat")); assertFalse(json.contains("lng"))
        assertFalse(json.contains("bookable")); assertFalse(json.contains("address"))
        assertEquals(0, LocalRules.toggleFavourite(d, "h1", "x", 2L).favourites.size)   // toggle removes
    }

    // ---- Recent searches never persist precise locations ----
    @Test fun recentsRejectCoordinatesAndRespectOptOut() {
        var d = LocalRules.addRecent(LocalAccountData(), "MVP Colony", 1L)
        assertEquals(listOf("MVP Colony"), d.recents.map { it.text })
        d = LocalRules.addRecent(d, "17.7231, 83.3013", 2L)
        d = LocalRules.addRecent(d, "https://maps.app.goo.gl/abc", 3L)
        assertEquals(1, d.recents.size)
        d = LocalRules.addRecent(d, "mvp colony", 4L)                                   // de-duplicated
        assertEquals(1, d.recents.size)
        val off = LocalRules.addRecent(d.copy(saveRecents = false), "Gajuwaka", 5L)
        assertEquals(1, off.recents.size)
        var many = LocalAccountData(); for (i in 1..20) many = LocalRules.addRecent(many, "Area number $i", i.toLong())
        assertEquals(AccountStore.MAX_RECENTS, many.recents.size)
    }

    // ---- Garage persistence logic ----
    @Test fun garageUpsertAndRemove() {
        val v = GarageVehicle("a", "car", "TYPE2_AC", "Tata", "Nexon EV", 40.5, 43, 1L)
        var d = LocalRules.upsertVehicle(LocalAccountData(), v)
        d = LocalRules.upsertVehicle(d, v.copy(batteryPercent = 50))
        assertEquals(1, d.garage.size); assertEquals(50, d.garage[0].batteryPercent)
        val round = NvJson.decodeFromString(LocalAccountData.serializer(), NvJson.encodeToString(d))
        assertEquals(d, round)                                                           // survives persistence
        assertTrue(LocalRules.removeVehicle(d, "a").garage.isEmpty())
    }

    // ---- Map filters (client-side refinement of server results) ----
    @Test fun mapFilters() {
        val hosts = listOf(HostSummary("a", "A", 1.0, powerKw = 3.3, bookableNow = true), HostSummary("b", "B", 2.0, powerKw = 11.0, bookableNow = false),
            HostSummary("c", "C", 3.0, powerKw = 30.0, bookableNow = true))
        assertEquals(listOf("a", "c"), MapFilters(availableOnly = true).apply(hosts).map { it.hostId })
        assertEquals(listOf("a"), MapFilters(power = "le7").apply(hosts).map { it.hostId })
        assertEquals(listOf("b"), MapFilters(power = "7to22").apply(hosts).map { it.hostId })
        assertEquals(listOf("c"), MapFilters(power = "gt22", availableOnly = true).apply(hosts).map { it.hostId })
        assertFalse(MapFilters().active)
    }
}
