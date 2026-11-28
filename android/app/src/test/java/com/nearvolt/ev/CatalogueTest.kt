package com.nearvolt.ev

import com.nearvolt.ev.catalogue.*
import com.nearvolt.ev.catalogue.CompatibilityEngine.Level
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class CatalogueTest {
    private val cat = CatalogueRepo.parse(File("src/main/assets/catalogue/vehicles.json").readText())
    private fun v(id: String) = cat.vehicles.first { it.id == id }

    @Test fun countsAndIntegrity() {
        assertEquals(62, cat.vehicles.size); assertEquals(19, cat.supplementaryClaims.size)
        assertEquals(62, cat.vehicles.map { it.id }.toSet().size)
        assertTrue(cat.vehicles.all { it.sourceUrl?.startsWith("http") == true })
        // Unverified is null, never zero.
        assertTrue(cat.vehicles.none { it.batteryKwh == 0.0 || it.acMaxKw == 0.0 || it.dcMaxKw == 0.0 })
        // Only verified, supported inlets map to app connector codes.
        assertTrue(cat.vehicles.all { (it.acConnector == null || it.acSupported == true) && (it.dcConnector == null || it.dcSupported == true) })
        assertTrue(cat.vehicles.flatMap { it.verifiedConnectors }.all { it in setOf("TYPE2_AC", "CCS2") })
    }
    @Test fun knownRecords() {
        val punch = v("IN-EV-026"); assertEquals(30.0, punch.batteryKwh!!, 0.0); assertEquals(7.2, punch.acMaxKw!!, 0.0); assertEquals(65.0, punch.dcMaxKw!!, 0.0)
        val reva = v("IN-EV-001"); assertNull(reva.acConnector); assertNull(reva.dcConnector); assertEquals(6.0, reva.ac0to100h!!, 0.0)
        assertNull(v("IN-EV-031").acMaxKw)   // Harrier.ev: AC limit not publicly verified
    }
    @Test fun search() {
        assertTrue(CatalogueSearch.apply(cat.vehicles, CatalogueFilter(query = "nexon")).all { it.model.contains("Nexon", true) })
        assertTrue(CatalogueSearch.apply(cat.vehicles, CatalogueFilter(dcOnly = true)).all { it.dcSupported == true })
        val byRange = CatalogueSearch.apply(cat.vehicles, CatalogueFilter(sort = CatalogueFilter.Sort.RANGE))
        assertNull(byRange.last().rangeKm)   // unknowns sort last, never treated as 0 km
    }
    @Test fun compatTypeTwoHost() {
        val r = CompatibilityEngine.screen(v("IN-EV-026"), listOf("TYPE2_AC"), 11.0)
        assertEquals(Level.SCREENED_MATCH, r.level); assertEquals(7.2, r.effectiveAcKw!!, 0.0)   // limited by vehicle, not station
        assertTrue(r.reasons.any { it.contains("not a guarantee") })
    }
    @Test fun compatUnverifiedLimitIsNotAMatch() {
        val r = CompatibilityEngine.screen(v("IN-EV-031"), listOf("TYPE2_AC"), 7.2)
        assertEquals(Level.UNVERIFIED, r.level); assertNull(r.effectiveAcKw); assertFalse(r.blocksRequest)
    }
    @Test fun compatLegacyCarIsUnverifiedNotCompatible() {
        assertEquals(Level.UNVERIFIED, CompatibilityEngine.screen(v("IN-EV-001"), listOf("TYPE2_AC"), 7.2).level)
    }
    @Test fun compatDomesticSocketNeverIncompatible() {
        val r = CompatibilityEngine.screen(v("IN-EV-026"), listOf("DOMESTIC_15A"), 3.3); assertEquals(Level.UNVERIFIED, r.level); assertFalse(r.blocksRequest)
    }
    @Test fun compatMismatchIsIncompatible() {
        val r = CompatibilityEngine.screen(v("IN-EV-026"), listOf("CHADEMO"), 50.0); assertEquals(Level.INCOMPATIBLE, r.level); assertTrue(r.blocksRequest)
    }
    @Test fun chargeTime() {
        val e = ChargeTime.acEstimate(v("IN-EV-026"), 20.0, 80.0, 11.0)!!
        assertEquals(18.0, e.energyKwh, 1e-9); assertEquals(7.2, e.powerKw, 0.0); assertEquals(18.0 / (7.2 * 0.9), e.hours, 1e-9)
        assertNull(ChargeTime.acEstimate(v("IN-EV-026"), 80.0, 20.0, 7.2)); assertNull(ChargeTime.acEstimate(v("IN-EV-026"), 20.0, 80.0, 0.0))
        // No DC estimate exists at all — only claims with their SOC window.
        assertTrue(ChargeTime.claims(v("IN-EV-026")).all { it.window.isNotBlank() })
        assertEquals("2 h 30 min", ChargeTime.hours(2.5)); assertEquals("45 min", ChargeTime.hours(0.75))
    }
}
